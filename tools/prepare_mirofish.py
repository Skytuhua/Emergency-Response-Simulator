"""Bounded preparation entrypoint. Secrets remain process-local and out of artifacts."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from normalize_mirofish import ROOT, SOURCE_COMMIT, build_artifact, load_contract, preparation_manifest
from mirofish_worker import MODEL_ENDPOINT, TOTAL_BUDGET_USD, _money, budget_lock, cumulative_spend
from terra_responses import TERRA_MODEL


def preflight_model(work: Path, key: str) -> Path:
    """Verify exact account-visible model access with a GET, never generation."""
    from openai import OpenAI
    receipt = {"model": TERRA_MODEL, "endpoint": MODEL_ENDPOINT, "available": False,
               "statusCode": None, "checkedAt": datetime.now(timezone.utc).isoformat()}
    try:
        with OpenAI(api_key=key, base_url="https://api.openai.com/v1", max_retries=0, timeout=15) as client:
            model = client.models.retrieve(TERRA_MODEL)
        receipt.update(available=model.id == TERRA_MODEL, statusCode=200)
    except Exception as error:
        status = getattr(error, "status_code", None)
        receipt["statusCode"] = status if type(status) is int else None
    path = work / f"model-preflight-{uuid.uuid4().hex}.json"
    with path.open("x", encoding="utf-8") as evidence:
        json.dump(receipt, evidence, indent=2)
    if not receipt["available"]:
        raise RuntimeError("GPT-6.1 Terra is unavailable to this account or its exact model GET failed; sanitized private receipt retained")
    return path


def kill_tree(process: subprocess.Popen) -> None:
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    else:
        import signal
        os.killpg(process.pid, signal.SIGKILL)


def verify_resume_manifest(work: Path, expected: dict) -> None:
    manifest = work / 'preparation-manifest.json'
    if not manifest.is_file() or json.loads(manifest.read_text(encoding='utf-8')) != expected:
        raise ValueError('Resume preparation inputs differ or are missing. Regenerate profiles in a new work directory.')
    evidence = json.loads((work / 'profiles-evidence.json').read_text(encoding='utf-8'))
    profiles = evidence.get('profiles', [])
    if evidence.get('model') != expected['profiles']['model'] or len(profiles) != len(expected['entities']):
        raise ValueError('Resume profiles do not match the supported preparation model and actor count.')
    for entity in expected['entities']:
        matching = [profile for profile in profiles if profile.get('householdId') == entity['uuid']]
        if len(matching) != 1 or matching[0].get('instruction') != entity['instruction']:
            raise ValueError('Resume profile instructions differ from the original preparation inputs.')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "fixtures/actor-context-v1.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--key-file", type=Path, help="Read an authorized key without copying it into the project")
    parser.add_argument("--model", default=TERRA_MODEL, help="New preparation runs exclusively use GPT-6.1 Terra LOW")
    parser.add_argument("--budget-usd", type=float, required=True)
    parser.add_argument("--resume-work", type=Path, help="Retry only the social phase from a private preparation directory")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output exists. Choose a new output path; completed artifacts are never overwritten.")
    if not 0 < args.budget_usd <= 10:
        parser.error("Preparation budget must be explicitly configured, above zero and at most $10.")
    if args.model != TERRA_MODEL:
        parser.error("New preparation calls require exact gpt-6.1-terra LOW; legacy artifacts remain replayable.")
    # Validate the entire frozen contract and manifest before secret access or work creation.
    try:
        contract = load_contract(args.input)
        manifest = preparation_manifest(contract, args.model)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    key = (args.key_file.read_text(encoding="utf-8-sig").strip().strip('"') if args.key_file else os.environ.get("OPENAI_API_KEY", ""))
    # A supplied text document may have a label; extract only a valid key internally.
    key_match = re.search(r"sk-[A-Za-z0-9_-]+", key)
    if not key_match:
        parser.error("Authorized OpenAI key was not found. Key content was not printed.")
    key = key_match.group(0)
    actual = subprocess.check_output(["git", "-C", str(ROOT / "vendor/MiroFish"), "rev-parse", "HEAD"], text=True).strip()
    if actual != SOURCE_COMMIT:
        parser.error("MiroFish source revision does not match the supported pinned commit.")
    private = ROOT / ".private"
    private.mkdir(exist_ok=True)
    try:
        with budget_lock(private):
            remaining = TOTAL_BUDGET_USD - cumulative_spend(private)
        if _money(args.budget_usd) > remaining:
            parser.error("Requested run budget exceeds the remaining cumulative $10 preparation allowance.")
    except (ValueError, RuntimeError) as error:
        parser.error(str(error))
    if args.resume_work:
        work = args.resume_work.resolve()
        if work.parent != private.resolve() or not (work / "profiles-evidence.json").is_file():
            parser.error("Resume directory must be a completed profile preparation directly inside .private.")
        if json.loads((work / "contract.json").read_text(encoding="utf-8")) != contract:
            parser.error("Resume context differs from the frozen preparation contract.")
        try:
            verify_resume_manifest(work, manifest)
        except ValueError as error:
            parser.error(str(error))
    else:
        work = Path(tempfile.mkdtemp(prefix="mirofish-", dir=private))
        (work / "contract.json").write_text(json.dumps(contract), encoding="utf-8")
        (work / "preparation-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    try:
        preflight_receipt = preflight_model(work, key)
    except RuntimeError as error:
        parser.error(str(error))
    env = dict(os.environ, OPENAI_API_KEY=key, LLM_API_KEY=key, LLM_MODEL_NAME=args.model,
               LLM_BASE_URL="https://api.openai.com/v1", PYTHONUTF8="1", MIROFISH_BUDGET_USD=str(args.budget_usd),
               MIROFISH_PREFLIGHT_RECEIPT=str(preflight_receipt),
               MIROFISH_LANG="en", ZEP_API_KEY="", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    results = {}
    for phase in (("social",) if args.resume_work else ("profiles", "social")):
        if phase == "social" and not (work / "profiles-evidence.json").exists():
            break
        if phase == "social":
            profiles = json.loads((work / "profiles-evidence.json").read_text(encoding="utf-8")).get("profiles", [])
            if len(profiles) != 3 or any(profile.get("outcome") != "llm" for profile in profiles):
                results[phase] = "skipped-unverified-profiles"
                break
        process = subprocess.Popen([sys.executable, str(ROOT / "tools/mirofish_worker.py"), phase, str(work)],
                                   env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   start_new_session=os.name != "nt", cwd=work)
        try:
            output, _ = process.communicate(timeout=180)
            results[phase] = process.returncode
        except subprocess.TimeoutExpired:
            kill_tree(process)
            output, _ = process.communicate()
            results[phase] = "timeout"
        safe = output.decode("utf-8", errors="replace").replace(key, "[REDACTED]")
        (work / f"{phase}.log").write_text(safe, encoding="utf-8")
        print(f"{phase}: {'completed' if results[phase] == 0 else 'failed or timed out'}; private evidence retained")
    profile_file = work / "profiles-evidence.json"
    social_file = work / "social-evidence.json"
    profile = json.loads(profile_file.read_text(encoding='utf-8')) if profile_file.exists() else {"model":args.model,"profiles":[]}
    social = json.loads(social_file.read_text(encoding='utf-8')) if social_file.exists() else {"detail":"Social preparation failed or timed out; see private evidence."}
    artifact = build_artifact(contract, profile, social)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation makes concurrent invocations unable to replace a completed artifact.
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(artifact, file, indent=2, ensure_ascii=False)
    print(json.dumps({"integration":artifact["generationOutcome"], "verifiedProfiles":sum(p["outcome"] == "llm" for p in artifact["profiles"]),
                      "acceptedRequests":len(artifact["candidates"]), "workDirectory":str(work), "phases":results}))
    return 0 if artifact["generationOutcome"] != "blocked" else 2


if __name__ == "__main__":
    raise SystemExit(main())
