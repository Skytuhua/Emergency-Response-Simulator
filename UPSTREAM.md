# MiroFish source and preparation evidence

MiroFish source: https://github.com/666ghj/MiroFish at immutable commit `7657031ac01184afe2cb220f5ee3545573b5e843`. The ignored `vendor/MiroFish` checkout is unchanged. `tools/setup_mirofish.ps1` reconstructs the pinned source and isolated dependencies. The upstream AGPL license is retained in `docs/MIROFISH-AGPL-3.0.txt`; local adaptation is in `tools/`.

## Current prepared output: Terra low

`public/data/mirofish-v1.json` now contains actual OpenAI **gpt-6.1-terra**, with **reasoning.effort=low**, generated through the **Responses API**. Official model ID, supported reasoning option, tool transport, and standard short-context price were verified against https://developers.openai.com/api/docs/models/gpt-6.1-terra on 8 November 2026. The authorized account's exact model GET returned 200 before generation; all six retained generation responses identify the exact model and low effort. This is API evidence, not an inference from a T3/Codex display label.

The actual pinned OasisProfileGenerator produced three profiles. Every exported persona exactly matches a nonempty `persona` in a completed raw response. The actual pinned RedditSimulationRunner/OASIS then ran one autonomous LLMAction round: three active representatives, three successful posts, zero seeded posts, and three strictly accepted structured requests (H02, H19, H09; actual SQLite source row IDs 4, 5, 6). Unstructured or unsupported facts never become physical simulation truth.

The first social attempt was blocked before any social API call: pinned CAMEL overwrites its requested zero SDK retries with a base-constructor default of three. The adapter now constrains both actual SDK clients to zero, while CallGuard independently verifies zero at the I/O boundary. The unchanged retained profiles/manifest were resumed for a successful social round. No model was substituted and no old output was relabeled.

Terra episode: **6 paid calls, 5,348 input tokens, 2,703 output tokens, estimated $0.018863**. Output counts already include reasoning tokens. Including the original 12 gpt-4.1-mini calls ($0.0093664), total preparation is **estimated $0.0282294**, under the authorized **$10 cumulative cap**. These are conservative standard token-price estimates, not account invoices; cached-input discounts are not deducted. This episode had a separate $1 run allowance. No provider call occurs in the frontend, during replay, or in automated tests.

Private receipts remain in ignored `.private/mirofish-3c11dr3r/`: account preflight, complete raw Responses objects, exact SDK output, request hashes, usage/reservation ledger, profiles, unseeded platform database/schema/traces, and phase logs. Browser validation requires the model-specific complete manifest hash `4b5c2eb1432d0146f1e5962df091f993a0a633b25778c605eabdd61c4970e00a`, explicit Responses/low metadata, exact actor contexts and instructions. This establishes structural compatibility; it is not cryptographic proof of remote authorship.

Approved Terra artifact SHA-256: Windows preparation bytes `43b6d218f21cddfcd29b24b4da1a3b22b0cee77259bd765e59c1eedd0a324428`; LF repository bytes `da1a85ca8d7eab161b178a78ac213ef9a9a2b68a499b35a1bf90ccf981796720`.

## Original output retained accurately

`public/data/mirofish-4.1-mini-v1.json` preserves the original **gpt-4.1-mini** artifact. It contains three verified profiles, three autonomous posts, no seeded posts, and one accepted H19 request. The original saved run remains at `public/data/default-run-4.1-mini-v1.json`; it still imports and replays with its original artifact. The updated default saved run embeds the actual Terra artifact.

Original canonical episode: 6 calls, 4,712 input / 1,760 output tokens, estimated $0.0047008. Earlier episode: 6 calls, 4,688 input / 1,744 output, $0.0046656. Total legacy preparation: $0.0093664. Original receipts remain privately recoverable; the failed social import made no model call. Legacy rates were $0.40 input / $1.60 output per million tokens, verified against https://developers.openai.com/api/docs/models/gpt-4.1-mini.

Original artifact SHA-256: Windows bytes `24d0fe5f9878e41ff791628885c5206c0f46041ad9ece4fd2a69c76563bdfd9a`; LF repository bytes `d661847725cb4cb7f25c7ef13077cd7f8025c52d76a2ca878020cc052995f5e3`. Legacy complete input hash remains `25c44ff50fc81cb8a38b991c56bb71f8736961d3db3337b37c8a7f1cf7565321`.

## Thin adaptation and bounds

- Import actual upstream modules without unrelated eager server/graph imports; no replacement generator or scripted social posts. Zep enrichment is unused.
- Supply only frozen synthetic actor facts, generic storm context, and exact allowed-request instructions. Fleet, kits, shelter capacities, household outage, roads, other households and future events are not sent to the model.
- Translate pinned Chat Completions callers into Responses text/function objects. Original reasoning items are retained privately for valid tool continuations; unknown or altered histories fail before I/O. Incomplete/refused outputs cannot execute actions or establish persona provenance.
- Actual OASIS/CAMEL executes returned social function calls. The adapter translates transport objects, not the choice of action.
- Use direct OpenAI endpoint, zero SDK retries, 30-second request timeout, 4,096 output tokens including reasoning, and separate 32,768-token CAMEL context retention. Upstream temperature is not forwarded. The 50,000-byte bound applies to the fully expanded Responses body, including replayed reasoning.
- Before each call, reserve every request byte as a token plus 4,096 overhead, at $2.50/M input and $5/M output. A shared operating-system lock and persistent per-run ledger enforce both explicit run allowance and the cumulative $10 cap, including audited legacy spend. Failed/uncertain calls retain their conservative reservation; conversion failures still record raw usage. At most 30 attempts are allowed per preparation directory. No assumption that a timeout makes a call free is made.
- Run profile/social phases in separate processes with 180-second limits; terminate only their process tree on timeout. New work directories and completed output files are created exclusively. Resume rejects changed or missing original manifests, models, actor instructions or inputs.
- Accept only successful autonomous platform posts/comments attributable to the matching verified actor and exact complete fact references. Partial preparation exports profiles only. First-round accepted requests map to exercise minute 5; otherwise deterministic rules attempt minute 10. Outages can prevent receipt. This timing is a declared exercise assumption, not empirical social behavior.

## Reproduction

```powershell
powershell -ExecutionPolicy Bypass -File tools/setup_mirofish.ps1
.venv-mirofish/Scripts/python.exe tools/prepare_mirofish.py --input fixtures/actor-context-v1.json --output public/data/new-episode.json --key-file C:/path/to/authorized-key.txt --model gpt-6.1-terra --budget-usd 1
.venv-mirofish/Scripts/python.exe -m unittest discover -s tools/tests
npm run test:pack
```

Use an explicit run allowance below the remaining cumulative budget. The authorized key is read into process memory; never add it or private preparation receipts to source control. Tests require the pinned OpenAI SDK (`python -m pip install openai==1.109.1`); full preparation additionally requires the isolated locked MiroFish environment. Raw synthetic output still requires review before public promotion.
