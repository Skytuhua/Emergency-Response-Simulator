"""Network-free contracts for the bounded Terra Responses adapter."""
from __future__ import annotations

import asyncio
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import httpx
from openai import AsyncOpenAI, OpenAI
from openai.types.chat import ChatCompletion
from openai.types.responses import Response

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    from terra_responses import TerraResponsesBridge
except ModuleNotFoundError as error:
    if error.name != "terra_responses":
        raise
    TerraResponsesBridge = None


def response(output: list[dict], **changes) -> Response:
    payload = {
        "id": "resp_fixture", "object": "response", "created_at": 1794096000,
        "model": "gpt-6.1-terra", "status": "completed", "output": output,
        "parallel_tool_calls": False, "tools": [], "tool_choice": "auto",
        "service_tier": "default",
        "usage": {"input_tokens": 100, "output_tokens": 70, "total_tokens": 170,
                  "input_tokens_details": {"cached_tokens": 25},
                  "output_tokens_details": {"reasoning_tokens": 30}},
    }
    payload.update(changes)
    return Response.model_validate(payload)


def message(*texts: str) -> dict:
    return {"id": "msg_fixture", "type": "message", "role": "assistant", "status": "completed",
            "content": [{"type": "output_text", "text": text, "annotations": []} for text in texts]}


def function(call_id="call_post", name="create_post", arguments='{"content":"Help"}') -> dict:
    return {"id": "fc_" + call_id, "type": "function_call", "call_id": call_id,
            "name": name, "arguments": arguments, "status": "completed"}


def request(**changes) -> dict:
    payload = {"model": "gpt-6.1-terra", "messages": [
        {"role": "system", "content": "Return JSON for the supplied resident."},
        {"role": "user", "content": "A fictional resident."}],
        "temperature": 0.7, "max_tokens": 32768, "stream": False}
    payload.update(changes)
    return payload


class ResponsesEndpoint:
    def __init__(self, *responses):
        self.responses = iter(responses)
        self.requests = []

    def create(self, **kwargs):
        self.requests.append(copy.deepcopy(kwargs))
        return next(self.responses)


class AsyncResponsesEndpoint(ResponsesEndpoint):
    async def create(self, **kwargs):
        return super().create(**kwargs)


def resource(endpoint):
    return SimpleNamespace(_client=SimpleNamespace(responses=endpoint))


class TerraResponsesTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(TerraResponsesBridge, "The Terra Responses bridge is missing")
        self.bridge = TerraResponsesBridge()

    def test_profile_preserves_exact_model_text_and_fixed_request_limits(self):
        endpoint = ResponsesEndpoint(response([message('{"persona":', '"Resident Å"}\n')]))
        original = request(response_format={"type": "json_object"}, max_completion_tokens=99999)
        before = copy.deepcopy(original)
        result = self.bridge.create(resource(endpoint), original, 0)
        self.assertIsInstance(result, ChatCompletion)
        self.assertEqual(result.choices[0].message.content, '{"persona":"Resident Å"}\n')
        self.assertEqual(result.choices[0].finish_reason, "stop")
        self.assertEqual(original, before)
        self.assertEqual(endpoint.requests, [{
            "model": "gpt-6.1-terra", "input": before["messages"],
            "max_output_tokens": 4096, "reasoning": {"effort": "low"},
            "service_tier": "default", "store": False, "stream": False,
            "include": ["reasoning.encrypted_content"], "text": {"format": {"type": "json_object"}},
        }])

    def test_usage_keeps_reasoning_and_cache_details_without_adding_them_twice(self):
        endpoint = ResponsesEndpoint(response([message("{}")]))
        result = self.bridge.create(resource(endpoint), request(), 0)
        self.assertEqual(result.usage.prompt_tokens, 100)
        self.assertEqual(result.usage.completion_tokens, 70)
        self.assertEqual(result.usage.total_tokens, 170)
        self.assertEqual(result.usage.prompt_tokens_details.cached_tokens, 25)
        self.assertEqual(result.usage.completion_tokens_details.reasoning_tokens, 30)

    def test_retains_full_raw_response_including_reasoning_and_status(self):
        raw = response([{"type": "reasoning", "id": "rs_fixture", "summary": [],
                         "encrypted_content": "opaque-fixture"}, message('{"persona":"From model"}')])
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            TerraResponsesBridge(work).create(resource(ResponsesEndpoint(raw)), request(), 7)
            retained = json.loads((work / "responses-7.json").read_text(encoding="utf-8"))
            self.assertEqual(retained, raw.model_dump(mode="json"))
            self.assertEqual(list(work.iterdir()), [work / "responses-7.json"])

    def test_function_tools_and_named_choice_use_responses_shape(self):
        endpoint = ResponsesEndpoint(response([function()]))
        tool = {"type": "function", "function": {"name": "create_post", "description": "Post content",
                "parameters": {"type": "object", "properties": {"content": {"type": "string"}},
                               "required": ["content"]}}}
        result = self.bridge.create(resource(endpoint), request(tools=[tool],
            tool_choice={"type": "function", "function": {"name": "create_post"}}, parallel_tool_calls=False), 0)
        self.assertEqual(endpoint.requests[0]["tools"], [{"type": "function", "name": "create_post",
            "description": "Post content", "parameters": tool["function"]["parameters"], "strict": False}])
        self.assertEqual(endpoint.requests[0]["tool_choice"], {"type": "function", "name": "create_post"})
        self.assertFalse(endpoint.requests[0]["parallel_tool_calls"])
        call = result.choices[0].message.tool_calls[0]
        self.assertEqual((call.id, call.type, call.function.name, call.function.arguments),
                         ("call_post", "function", "create_post", '{"content":"Help"}'))
        self.assertEqual(result.choices[0].finish_reason, "tool_calls")

    def test_auto_required_and_none_tool_choices_survive_translation(self):
        for choice in ("auto", "required", "none"):
            with self.subTest(choice=choice):
                endpoint = ResponsesEndpoint(response([message("Done")]))
                self.bridge.create(resource(endpoint), request(tool_choice=choice), 0)
                self.assertEqual(endpoint.requests[0]["tool_choice"], choice)

    def test_history_replays_original_ordered_reasoning_and_all_function_items_once(self):
        output = [
            {"type": "reasoning", "id": "rs_history", "summary": [], "encrypted_content": "opaque-history"},
            message("I will post."), function(), function("call_idle", "do_nothing", "{}"),
        ]
        endpoint = ResponsesEndpoint(response(output), response([message("Completed")]))
        first_request = request()
        self.bridge.create(resource(endpoint), first_request, 0)
        # CAMEL reserializes arguments and can store one assistant message per call.
        history = first_request["messages"] + [
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "call_post", "type": "function", "function": {
                    "name": "create_post", "arguments": '{"content": "Help"}'}}]},
            {"role": "tool", "tool_call_id": "call_post", "content": "{'success': True}"},
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "call_idle", "type": "function", "function": {"name": "do_nothing", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "call_idle", "content": "{'success': True}"},
            {"role": "user", "content": "Continue."},
        ]
        self.bridge.create(resource(endpoint), request(messages=history), 1)
        self.assertEqual(endpoint.requests[1]["input"], first_request["messages"] + output + [
            {"type": "function_call_output", "call_id": "call_post", "output": "{'success': True}"},
            {"type": "function_call_output", "call_id": "call_idle", "output": "{'success': True}"},
            {"role": "user", "content": "Continue."},
        ])

    def test_changed_or_unknown_function_history_is_rejected_before_network(self):
        endpoint = ResponsesEndpoint(response([function()]))
        self.bridge.create(resource(endpoint), request(), 0)
        for call_id, name, args in (("unknown", "create_post", '{"content":"Help"}'),
                                    ("call_post", "create_post", '{"content":"Changed"}'),
                                    ("call_post", "do_nothing", "{}")):
            with self.subTest(call_id=call_id, name=name, args=args):
                history = request()["messages"] + [{"role": "assistant", "content": "", "tool_calls": [
                    {"id": call_id, "type": "function", "function": {"name": name, "arguments": args}}]}]
                with self.assertRaises(ValueError):
                    self.bridge.create(resource(endpoint), request(messages=history), 1)
        self.assertEqual(len(endpoint.requests), 1)

    def test_incomplete_response_cannot_execute_function_calls(self):
        for reason in ("max_output_tokens", "content_filter"):
            with self.subTest(reason=reason):
                endpoint = ResponsesEndpoint(response([message('{"persona":"Partial'), function()],
                    status="incomplete", incomplete_details={"reason": reason}))
                result = self.bridge.create(resource(endpoint), request(), 0)
                self.assertEqual(result.choices[0].finish_reason, "length")
                self.assertIsNone(result.choices[0].message.tool_calls)
                self.assertEqual(result.choices[0].message.content, '{"persona":"Partial')

    def test_refusal_and_missing_usage_do_not_invent_profile_text(self):
        raw = response([{"type": "message", "id": "msg_refusal", "role": "assistant", "status": "completed",
            "content": [{"type": "refusal", "refusal": "Cannot produce that profile."}]}], usage=None)
        result = self.bridge.create(resource(ResponsesEndpoint(raw)), request(), 0)
        self.assertEqual(result.choices[0].message.content, "")
        self.assertEqual(result.choices[0].message.refusal, "Cannot produce that profile.")
        self.assertEqual(result.choices[0].finish_reason, "content_filter")
        self.assertIsNone(result.usage)

    def test_other_models_and_unsupported_requests_never_reach_network(self):
        endpoint = ResponsesEndpoint()
        cases = [request(model="gpt-4.1-mini"), request(stream=True), request(n=2),
                 request(reasoning_effort="high"), request(extra_body={"store": True}),
                 request(response_format={"type": "json_schema", "json_schema": {}}),
                 request(tools=[{"type": "web_search"}]),
                 request(messages=[{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "x"}}]}]),
                 request(messages=[{"role": "tool", "tool_call_id": "unknown", "content": "result"}])]
        for value in cases:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    self.bridge.create(resource(endpoint), value, 0)
        self.assertEqual(endpoint.requests, [])

    def test_invalid_indices_and_existing_evidence_are_rejected_before_network(self):
        endpoint = ResponsesEndpoint(response([message("{}")]))
        for index in (-1, True, "0"):
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.bridge.create(resource(endpoint), request(), index)
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / "responses-0.json").write_text("original", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                TerraResponsesBridge(work).create(resource(endpoint), request(), 0)
            self.assertEqual((work / "responses-0.json").read_text(encoding="utf-8"), "original")
        self.assertEqual(endpoint.requests, [])

    def test_failed_or_wrong_model_raw_response_is_retained_without_fallback(self):
        for changes in ({"status": "failed", "error": {"code": "server_error", "message": "Fixture error"}},
                        {"model": "gpt-4.1-mini"}):
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as directory:
                work = Path(directory)
                endpoint = ResponsesEndpoint(response([], **changes))
                with self.assertRaises(ValueError):
                    TerraResponsesBridge(work).create(resource(endpoint), request(), 3)
                self.assertTrue((work / "responses-3.json").is_file())
                self.assertEqual(len(endpoint.requests), 1)

    def test_async_path_uses_async_responses_and_retains_real_chat_type(self):
        endpoint = AsyncResponsesEndpoint(response([message('{"persona":"Async resident"}')]))
        with tempfile.TemporaryDirectory() as directory:
            result = asyncio.run(TerraResponsesBridge(Path(directory)).acreate(resource(endpoint), request(), 4))
            self.assertIsInstance(result, ChatCompletion)
            self.assertEqual(result.choices[0].message.content, '{"persona":"Async resident"}')
            self.assertEqual(endpoint.requests[0]["reasoning"], {"effort": "low"})
            self.assertTrue((Path(directory) / "responses-4.json").is_file())

    def test_installed_sdk_serializes_both_resource_paths_without_network(self):
        captured = []
        raw = response([message('{"persona":"SDK fixture"}')]).model_dump(mode="json")

        def transport(http_request):
            captured.append((http_request.url.path, json.loads(http_request.content)))
            return httpx.Response(200, json=raw)

        with OpenAI(api_key="unit-test-placeholder", base_url="https://unit-test.invalid/v1",
                    http_client=httpx.Client(transport=httpx.MockTransport(transport)), max_retries=0) as client:
            sync_result = self.bridge.create(client.chat.completions, request(response_format={"type": "json_object"}), 0)

        async def run_async():
            async with AsyncOpenAI(api_key="unit-test-placeholder", base_url="https://unit-test.invalid/v1",
                http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)), max_retries=0) as client:
                return await self.bridge.acreate(client.chat.completions, request(), 1)

        async_result = asyncio.run(run_async())
        for result in (sync_result, async_result):
            self.assertIsInstance(result, ChatCompletion)
            self.assertEqual(result.choices[0].message.content, '{"persona":"SDK fixture"}')
        self.assertEqual([path for path, body in captured], ["/v1/responses", "/v1/responses"])
        for path, body in captured:
            self.assertEqual(body["model"], "gpt-6.1-terra")
            self.assertEqual(body["reasoning"], {"effort": "low"})
            self.assertEqual(body["max_output_tokens"], 4096)
            self.assertEqual(body["service_tier"], "default")
            self.assertFalse(body["store"])
            self.assertNotIn("max_tokens", body)
            self.assertNotIn("temperature", body)


if __name__ == "__main__":
    unittest.main()
