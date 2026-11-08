# MiroFish source and preparation evidence

MiroFish source: https://github.com/666ghj/MiroFish

Supported immutable commit: `7657031ac01184afe2cb220f5ee3545573b5e843`.
Corresponding source archive: https://github.com/666ghj/MiroFish/archive/7657031ac01184afe2cb220f5ee3545573b5e843.tar.gz
The local `vendor/MiroFish` checkout is ignored and unchanged. `tools/setup_mirofish.ps1` reconstructs it at the exact revision. The AGPL license is retained in `docs/MIROFISH-AGPL-3.0.txt`. Local adaptation source is in `tools/mirofish_worker.py`; there are no upstream file edits.

## Actual preparation, 8 November 2026

Tested environment: Windows, CPython 3.12.14, isolated `.venv-mirofish`, actual `camel-oasis==0.2.5`, `camel-ai==0.2.78`, `openai==1.109.1`, and `zep-cloud==3.25.0`. Exact resolved dependency versions are retained in `tools/requirements-mirofish.lock`. Resolving upstream's broad dependency ranges initially selected incompatible MCP 2.3.0; the standalone social import failed before any social model call. A compatible `mcp==1.26.0` pin was applied. This does not change MiroFish source. Upstream's own older lockfile selected MCP 1.24.0; this adapter records the successfully executed 1.26.0 environment separately.

Three actual `OasisProfileGenerator.generate_profile_from_entity(..., use_llm=True)` calls produced three retained model-generated profiles. After independent review, the canonical episode was regenerated with raw SDK response retention: every exported persona exactly matches a nonempty `persona` field in a successful raw response. Missing, empty, bio-only, and upstream-authored fallback summaries do not qualify. The actual upstream Reddit exporter wrote the profile file. Zep enrichment was not configured or used.

Profile-only call usage: 3 calls, 1,972 input tokens, 1,412 output tokens, estimated $0.003048 at the verified standard `gpt-4.1-mini` rates. This is a token-based estimate, not an account invoice. The authorized preparation cap is $10. Official model/pricing source checked on 8 November 2026: https://developers.openai.com/api/docs/models/gpt-4.1-mini ($0.40 input and $1.60 output per million tokens). The model is marked deprecated in current documentation, but actual profile calls succeeded. No provider call occurs in the frontend or during replay.

The canonical `public/data/mirofish-v1.json` records the **target integration**: all three genuine model-generated profiles, one actual autonomous social round with three active representatives, three successful `create_post` platform traces, no seeded posts, and exactly one accepted structured help request (H19). Its source ID `reddit-trace-6` refers to the retained database's actual SQLite `rowid`. The other two posts remain post-run generated-speech evidence and do not become requests; their unsupported/unstated facts are never copied into the live exercise.

Canonical hardened episode: 6 calls, 4,712 input tokens, 1,760 output tokens, estimated **$0.0047008**. Including the earlier episode, this build used 12 calls, 9,400 input tokens, 3,504 output tokens, estimated **$0.0093664** total. The failed social import made no model call. These are token-based estimates, not a billing invoice. The approved artifact SHA-256 is `24d0fe5f9878e41ff791628885c5206c0f46041ad9ece4fd2a69c76563bdfd9a`. No claim of empirically realistic social timing is made.

Canonical private evidence is retained under `.private/mirofish-l6u41ega/`: complete raw SDK responses, original exported personas, complete preparation manifest, usage/request-hash ledger, profile/social logs, actual SQLite database/schema/trace, and normalized evidence. The superseded first episode remains recoverable privately. Raw evidence is excluded from the public repository; only the approved synthetic artifact is bundled.

## Thin adaptation

- Import the actual generator module while bypassing unrelated eager `app.services` imports. No replacement profile generator exists.
- Set locale English and supply only the frozen actor context plus generic storm power outage. No fleet, kits, shelter capacity, household network gap, road preset, other households, or future events is supplied to preparation.
- Append the exact allowed help-request JSON instruction to each retained original persona. Both original persona and appended instruction are retained in the approved artifact.
- Use the actual pinned `RedditSimulationRunner`, with one round, all three household representatives active at hour zero, activity level 1, min/max selected agents 3, both multipliers 1, and no initial posts. The action menu is explicitly limited to `CREATE_POST` and `DO_NOTHING`; action choice remains an autonomous `LLMAction`.
- Configure model retries 0, request timeout 30 seconds, max output 1,600 tokens, max request 50,000 UTF-8 bytes, and at most 30 SDK attempts across the whole preparation. A conservative pre-request token cost reservation rejects calls above the configured budget. Process timeouts do not guarantee that already-started provider billing stops.
- Run profiles and social in separate bounded child processes (180 seconds per phase); terminate the process tree on timeout. Private work directories are unique. Completed public artifacts are created exclusively and cannot be overwritten by the command.
- Normalize only successful platform `create_post`/`create_comment` traces from this unseeded autonomous round, attributable to the matching actor and exact complete fact references. Unstructured prose remains evidence only. A first-round accepted candidate maps to exercise minute 5; the fallback rule attempts minute 10.

## Reproduction

```powershell
powershell -ExecutionPolicy Bypass -File tools/setup_mirofish.ps1
.venv-mirofish/Scripts/python.exe tools/prepare_mirofish.py --input fixtures/actor-context-v1.json --output public/data/new-episode.json --key-file C:/path/to/authorized-key.txt --budget-usd 10
python -m unittest discover -s tools/tests
npm run test:pack
```

The key file is read only into process memory. Keys are not copied into the repository. Private generated traces and usage receipts remain under ignored `.private/`; review raw evidence before sharing. `inputHash` covers the complete controlled inputs in `fixtures/preparation-manifest-v1.json`: upstream revision, actor facts, entity names/summaries, exact appended instructions, model settings, and social episode controls. Python generates this same manifest and uses its values. Actual SDK requests also have private hashes. Resume refuses missing or changed original manifests, models, or instructions. Browser validation compares exact actor contexts, supported model, exact instructions, and the supported manifest hash. Structural validation establishes compatibility, not cryptographic proof of provider authorship.
