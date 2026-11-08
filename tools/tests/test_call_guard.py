"""Offline financial and transport boundaries for Terra preparation."""
from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from contextlib import redirect_stderr

import httpx
from openai import AsyncOpenAI, OpenAI
from openai.resources.chat.completions import AsyncCompletions, Completions

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mirofish_worker
import prepare_mirofish
from normalize_mirofish import canonical_hash, verified_model_persona
from test_terra_responses import AsyncResponsesEndpoint, ResponsesEndpoint, function, message, request, response


def sdk_resource(endpoint):
    return SimpleNamespace(_client=SimpleNamespace(responses=endpoint, max_retries=0,
        base_url="https://api.openai.com/v1/"))


class RaisingEndpoint:
    def create(self, **kwargs):
        raise TimeoutError("Uncertain transport outcome")


class CallGuardTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(callable(getattr(mirofish_worker.CallGuard, "create", None)),
                        "CallGuard does not yet reserve and execute Responses requests")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.private = Path(self.temp.name)
        self.work = self.private / "mirofish-current"
        self.work.mkdir()
        (self.work / "preparation-manifest.json").write_text(json.dumps({
            "profiles": {"model": "gpt-6.1-terra"}}), encoding="utf-8")
        self.receipt = self.work / "model-preflight-fixture.json"
        self.receipt.write_text(json.dumps({"model": "gpt-6.1-terra", "available": True,
            "statusCode": 200, "endpoint": "https://api.openai.com/v1/models/gpt-6.1-terra"}), encoding="utf-8")
        self.env = patch.dict(os.environ, {"MIROFISH_BUDGET_USD": "1",
            "MIROFISH_PREFLIGHT_RECEIPT": str(self.receipt), "LLM_MODEL_NAME": "gpt-6.1-terra"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def ledger(self):
        return json.loads((self.work / "usage.json").read_text(encoding="utf-8"))

    def test_sync_reserves_actual_translated_payload_and_prices_usage_once(self):
        guard = mirofish_worker.CallGuard(self.work)
        endpoint = ResponsesEndpoint(response([message('{"persona":"Actual resident"}')]))
        guard.create(sdk_resource(endpoint), request(response_format={"type": "json_object"}))
        record = self.ledger()[0]
        actual = endpoint.requests[0]
        self.assertNotIn("messages", actual)
        self.assertEqual(record["requestHash"], canonical_hash(actual))
        self.assertEqual(record["requestBytes"], len(json.dumps(actual, allow_nan=False).encode("utf-8")))
        self.assertEqual(actual["max_output_tokens"], 4096)
        self.assertAlmostEqual(record["reservedUsd"], ((record["requestBytes"] + 4096) * 2.5 + 4096 * 5) / 1_000_000)
        self.assertAlmostEqual(record["estimatedUsd"], 0.00045)
        self.assertAlmostEqual(record["chargedUsd"], 0.00045)
        self.assertEqual(record["reasoningTokens"], 30)
        self.assertEqual(record["cachedInputTokens"], 25)
        self.assertEqual(record["status"], "success")
        self.assertTrue(verified_model_persona(list(guard.responses.values()), "Actual resident"))

    def test_async_calls_share_the_durable_reservation_and_raw_receipt_contract(self):
        guard = mirofish_worker.CallGuard(self.work)
        pending_statuses = []

        async def run():
            ready = asyncio.Event()

            class GatedEndpoint:
                calls = 0

                async def create(endpoint, **kwargs):
                    endpoint.calls += 1
                    if endpoint.calls == 2:
                        pending_statuses.extend(record["status"] for record in self.ledger())
                        ready.set()
                    await ready.wait()
                    return response([message("{}")])

            endpoint = GatedEndpoint()
            return await asyncio.gather(guard.acreate(sdk_resource(endpoint), request()),
                                        guard.acreate(sdk_resource(endpoint), request()))

        results = asyncio.run(run())
        self.assertEqual(len(results), 2)
        self.assertEqual(pending_statuses, ["started", "started"])
        self.assertEqual([record["status"] for record in self.ledger()], ["success", "success"])
        self.assertTrue((self.work / "responses-0.json").is_file())
        self.assertTrue((self.work / "responses-1.json").is_file())

    def test_uncertain_failure_keeps_its_reservation_charged_across_restart(self):
        guard = mirofish_worker.CallGuard(self.work)
        with self.assertRaises(TimeoutError):
            guard.create(sdk_resource(RaisingEndpoint()), request())
        failed = self.ledger()[0]
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["chargedUsd"], failed["reservedUsd"])
        self.assertNotIn("estimatedUsd", failed)
        os.environ["MIROFISH_BUDGET_USD"] = str(failed["reservedUsd"])
        endpoint = ResponsesEndpoint()
        with self.assertRaises(RuntimeError):
            mirofish_worker.CallGuard(self.work).create(sdk_resource(endpoint), request())
        self.assertEqual(endpoint.requests, [])

    def test_conversion_failure_still_accounts_received_usage_and_keeps_ceiling(self):
        guard = mirofish_worker.CallGuard(self.work)
        endpoint = ResponsesEndpoint(response([], status="failed",
            error={"code": "server_error", "message": "Fixture failure"}))
        with self.assertRaises(ValueError):
            guard.create(sdk_resource(endpoint), request())
        record = self.ledger()[0]
        self.assertEqual((record["inputTokens"], record["outputTokens"], record["reasoningTokens"]), (100, 70, 30))
        self.assertAlmostEqual(record["estimatedUsd"], 0.00045)
        self.assertEqual(record["chargedUsd"], record["reservedUsd"])
        self.assertEqual(record["status"], "failed")

    def test_incomplete_and_refusal_cannot_prove_a_model_persona(self):
        variants = [response([message('{"persona":"Resident"}')], status="incomplete",
                            incomplete_details={"reason": "max_output_tokens"}),
                    response([{"id": "msg_refusal", "type": "message", "role": "assistant", "status": "completed",
                               "content": [{"type": "refusal", "refusal": "Fixture refusal"}]}])]
        for raw in variants:
            with self.subTest(status=raw.status):
                guard = mirofish_worker.CallGuard(self.work)
                with self.assertRaises(RuntimeError):
                    guard.create(sdk_resource(ResponsesEndpoint(raw)), request())
                self.assertFalse(verified_model_persona(list(guard.responses.values()), "Resident"))
                record = self.ledger()[-1]
                self.assertEqual(record["status"], "rejected")
                self.assertEqual(record["chargedUsd"], record["reservedUsd"])

    def test_expanded_reasoning_history_is_bounded_before_a_second_call(self):
        guard = mirofish_worker.CallGuard(self.work)
        endpoint = ResponsesEndpoint(response([
            {"id": "rs_large", "type": "reasoning", "summary": [], "encrypted_content": "r" * 51000}, function()]))
        guard.create(sdk_resource(endpoint), request())
        history = request()["messages"] + [{"role": "assistant", "content": "", "tool_calls": [
            {"id": "call_post", "type": "function", "function": {"name": "create_post", "arguments": '{"content":"Help"}'}}]},
            {"role": "tool", "tool_call_id": "call_post", "content": "Done"}]
        with self.assertRaises(RuntimeError):
            guard.create(sdk_resource(endpoint), request(messages=history))
        self.assertEqual(len(endpoint.requests), 1)
        self.assertEqual(len(self.ledger()), 1)

    def test_cumulative_cap_includes_other_terra_runs_and_audited_legacy_baseline(self):
        other = self.private / "mirofish-other"
        other.mkdir()
        (other / "preparation-manifest.json").write_text('{"profiles":{"model":"gpt-6.1-terra"}}', encoding="utf-8")
        (other / "usage.json").write_text('[{"status":"started","reservedUsd":9.98,"chargedUsd":9.98}]', encoding="utf-8")
        legacy = self.private / "mirofish-legacy"
        legacy.mkdir()
        (legacy / "preparation-manifest.json").write_text('{"profiles":{"model":"gpt-4.1-mini"}}', encoding="utf-8")
        (legacy / "usage.json").write_text('[{"reservedUsd":999}]', encoding="utf-8")
        endpoint = ResponsesEndpoint()
        with self.assertRaises(RuntimeError):
            mirofish_worker.CallGuard(self.work).create(sdk_resource(endpoint), request())
        self.assertEqual(endpoint.requests, [])
        self.assertFalse((self.work / "usage.json").exists())

    def test_run_budget_call_count_and_client_retries_fail_before_network(self):
        endpoint = ResponsesEndpoint()
        os.environ["MIROFISH_BUDGET_USD"] = "0.000001"
        with self.assertRaises(RuntimeError):
            mirofish_worker.CallGuard(self.work).create(sdk_resource(endpoint), request())
        os.environ["MIROFISH_BUDGET_USD"] = "1"
        (self.work / "usage.json").write_text(json.dumps([
            {"status": "success", "reservedUsd": 0.01, "chargedUsd": 0} for _ in range(30)]), encoding="utf-8")
        with self.assertRaises(RuntimeError):
            mirofish_worker.CallGuard(self.work).create(sdk_resource(endpoint), request())
        client = sdk_resource(endpoint)
        client._client.max_retries = 2
        with self.assertRaises(ValueError):
            mirofish_worker.CallGuard(self.work).create(client, request())
        self.assertEqual(endpoint.requests, [])

    def test_missing_successful_account_preflight_blocks_generation(self):
        self.receipt.unlink()
        endpoint = ResponsesEndpoint()
        with self.assertRaises(ValueError):
            mirofish_worker.CallGuard(self.work).create(sdk_resource(endpoint), request())
        self.assertEqual(endpoint.requests, [])

    def test_model_preflight_retains_only_sanitized_availability_receipt(self):
        client = MagicMock()
        client.__enter__.return_value = client
        client.models.retrieve.return_value = SimpleNamespace(id="gpt-6.1-terra")
        with patch("openai.OpenAI", return_value=client):
            path = prepare_mirofish.preflight_model(self.work, "unit-test-placeholder")
        client.models.retrieve.assert_called_once_with("gpt-6.1-terra")
        receipt = json.loads(path.read_text(encoding="utf-8"))
        self.assertTrue(receipt["available"])
        self.assertEqual(receipt["endpoint"], "https://api.openai.com/v1/models/gpt-6.1-terra")
        self.assertNotIn("unit-test-placeholder", path.read_text(encoding="utf-8"))
        error = RuntimeError("Sensitive provider error unit-test-placeholder")
        client.models.retrieve.side_effect = error
        with patch("openai.OpenAI", return_value=client), self.assertRaises(RuntimeError) as raised:
            prepare_mirofish.preflight_model(self.work, "unit-test-placeholder")
        self.assertNotIn("Sensitive", str(raised.exception))
        self.assertNotIn("unit-test-placeholder", "".join(p.read_text(encoding="utf-8") for p in self.work.glob("model-preflight-*.json")))

    def test_install_routes_real_sync_and_async_chat_resources_through_responses(self):
        paths = []

        def transport(http_request):
            paths.append(http_request.url.path)
            return httpx.Response(200, json=response([message("{}")]).model_dump(mode="json"))

        guard = mirofish_worker.CallGuard(self.work)
        with patch.object(Completions, "create", Completions.create), patch.object(AsyncCompletions, "create", AsyncCompletions.create):
            guard.install()
            with OpenAI(api_key="unit-test-placeholder", max_retries=0,
                http_client=httpx.Client(transport=httpx.MockTransport(transport))) as client:
                client.chat.completions.create(**request())

            async def run():
                async with AsyncOpenAI(api_key="unit-test-placeholder", max_retries=0,
                    http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport))) as client:
                    return await client.chat.completions.create(**request())

            asyncio.run(run())
        self.assertEqual(paths, ["/v1/responses", "/v1/responses"])
        self.assertEqual([record["status"] for record in self.ledger()], ["success", "success"])

    def test_legacy_model_cli_is_rejected_before_key_loading_or_network(self):
        argv = ["prepare_mirofish.py", "--model", "gpt-4.1-mini", "--budget-usd", "1", "--output",
                str(self.work / "artifact.json"), "--key-file", str(self.work / "nonexistent-secret.txt")]
        with patch.object(sys, "argv", argv), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
            prepare_mirofish.main()
        self.assertEqual(raised.exception.code, 2)

    def test_guard_rejects_a_work_manifest_that_would_escape_cumulative_accounting(self):
        (self.work / "preparation-manifest.json").write_text('{"profiles":{"model":"gpt-4.1-mini"}}', encoding="utf-8")
        with self.assertRaises(ValueError):
            mirofish_worker.CallGuard(self.work)


if __name__ == "__main__":
    unittest.main()
