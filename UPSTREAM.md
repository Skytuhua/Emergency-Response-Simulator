# MiroFish source and preparation evidence

Last updated: 2026-11-08. Expanded preparation and earlier v1 episodes have separate artifacts and input identities.

MiroFish source: https://github.com/666ghj/MiroFish at immutable commit `7657031ac01184afe2cb220f5ee3545573b5e843`. The ignored `vendor/MiroFish` checkout is unchanged. `tools/setup_mirofish.ps1` reconstructs the pinned source and isolated dependencies. The upstream AGPL license is retained in `docs/MIROFISH-AGPL-3.0.txt`; local adaptation is in `tools/`.

## Expanded Dallas preparation: Terra low

The current expanded bundle, `public/data/dallas-v2-scenario.json`, contains **24 source-verified `gpt-6.1-terra` profiles and 47 admitted prepared MiroFish/OASIS actions**. These belong to the 3,061-household, 5,306-person, six-hour scenario. One invalid actor-local action was rejected without retry. The model is the exact OpenAI API ID `gpt-6.1-terra`, through Responses with `reasoning.effort=low`; the application does not infer that ID from a T3 model label. The provider/account gate checks the exact model before generation. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-terra) records the supported API interface and options.

Each cohort is limited to six households. The actual pinned MiroFish profile generator creates one profile per actor; the actual OASIS runner chooses a report or wait at two frozen local moments. The reference selection ranks eligible households before outcomes are known. Its eligibility condition requires a need followed by a local phone-network change. This selected group is not a representative behavior sample of all Dallas residents.

Only the actor's frozen local context is supplied: household size, the declared accessible-place requirement, current call connection and current local need, with its start time and deadline. Those facts are tied to the population, map, event and support hashes. Other households' posts, fleet state, global hidden needs, future outcomes and coordinator decisions do not enter the actor's context. Persona names, ages, professions and narrative are invented background; they are not triage features.

Prepared output is used only when its exact local context matches playback. A completed need suppresses its pending action. Missing or changed contexts use the declared background reporting rules with a recorded reason. Custom road edits disable prepared actions for that run and use those rules; the original artifact is retained without rebinding. A model-selected report is an attempt: the simulated connection determines whether the coordinator receives it. The LLM does not decide physical travel, resource use, arrival or completion. Those remain engine rules. No provider call occurs in browser playback, replay or automated tests.

`tools/v2/prepare_behavior.py` freezes inputs without reading credentials, then executes only with an explicit coordinator gate and the shared cumulative **$10** budget. `tools/v2/project_budget.py` shares the canonical physical ledger with the earlier preparation path. Whole-cohort allowances, outstanding reservations and logical attempt limits are checked under the same operating-system lock. Failed or uncertain calls keep their conservative reservation. A new directory cannot reset an already registered opportunity. Both SDK and upstream paid retries are disabled; each cohort retains the 30-request, 50,000-byte request and 4,096-output-token bounds. At this checkpoint, cumulative actual plus conservative reserved exposure is **$0.2914029 / $10**. This is not an invoice; actual usage estimates and reserved allowances are distinct.

The worker starts in UTF-8 mode before upstream imports. Cohort 2 encountered a Windows default-encoding failure after its six successful profiles and before any social request. The reviewed `--resume-profiles-only` path reused the same profiles, work directory, manifest, gate, allowance, counters and episode scaffold. It rejects any previous social attempt or partial episode, and uses a single-use recovery claim. The six profiles were not generated again. The final admitted count above includes all four prepared cohorts after source checks and strict TypeScript admission.

The browser bundle contains approved synthetic output, compact source evidence and input hashes. Full provider envelopes, reasoning, authorization data, the key file, raw donor downloads and detailed private preparation logs remain outside the public repository. Compact provenance supports local verification against retained receipts; it is not a provider-signed authorship certificate. The current source-conditioned runtime and its limitations are documented in [expanded Dallas evidence](docs/evidence/dallas-expanded-runtime.md).

Pinned preparation dependencies remain `camel-ai==0.2.78`, `camel-oasis==0.2.5` and `openai==1.109.1`, with MiroFish source commit `7657031ac01184afe2cb220f5ee3545573b5e843`.

Offline preparation validation:

```powershell
.venv-mirofish/Scripts/python.exe -m unittest discover -s tools/v2/tests
node tools/v2/build_default.mjs --behavior=C:/path/to/reviewed-cohort-set.json
```

The build command validates and constructs the scenario without provider calls. Public promotion additionally uses `--publish` after content and provenance review. Paid execution requires the original frozen manifest, original private work directory, explicit gate, authorized key file and remaining cumulative budget. The earlier v1 reproduction command below does not prepare an expanded v2 cohort.

## Earlier Dallas v1 prepared output: Terra low

`public/data/mirofish-dallas-v1.json` contains a separate genuine Dallas preparation, bound to `storm-dallas-v1`, the frozen Dallas street dataset and its three synthetic representative home nodes. Six completed OpenAI Responses calls identify exact `gpt-6.1-terra` with low reasoning. Actual pinned MiroFish/OASIS produced three exact-response-verified personas and three successful autonomous posts, all accepted by the strict fact-reference normalizer. The first-round-to-minute-5 mapping remains an explicit exercise assumption.

Dallas usage: 5,562 input / 2,697 output tokens, six calls, estimated **$0.019047**. Before expanded v2 preparation, the three earlier episode families totaled **24 calls and estimated $0.0472764 / $10** (including both Terra episodes and original gpt-4.1-mini preparation). The Dallas episode had a separate $1 allowance. No additional provider calls are needed for automatic playback or visualization.

Dallas complete input hash: `f1f98271f7c423fa1dc0a851c67837c228c81ddd05bfd3c992502110e1c3d20b`; actor digest: `41a8c28b2da65f9519a19e6426514a86328724021c0d0cca3f84499386fd4062`; map dataset digest: `ba2017a31c639b4f26060bdd41ca575a536c3ae7080a8fa8a8ec9340c01e8ed6`. Artifact SHA-256: Windows preparation bytes `793ac3a0ece9cd64e6eb4aaf1a918523ab8598f640eeab7363f7feeab7a0a2ed`; repository LF bytes `a8dd374398ed77c0c997004e54fff09f0f3e5861c3bd4691e15af06dc0b716bd`.

Private raw receipts remain in `.private/mirofish-hoyvt38t/`. Only the approved synthetic artifact is public. Riverdale artifacts cannot be injected into Dallas; all original artifacts and saved runs remain replayable under their original identities. The separately named `default-dallas-run.json` is an authored engine-regression witness, not an automatic coordination result or operational validation.

## Earlier Riverdale v1 prepared output: Terra low

`public/data/mirofish-v1.json` now contains actual OpenAI **gpt-6.1-terra**, with **reasoning.effort=low**, generated through the **Responses API**. Official model ID, supported reasoning option, tool transport, and standard short-context price were verified against https://developers.openai.com/api/docs/models/gpt-6.1-terra on 8 November 2026. The authorized account's exact model GET returned 200 before generation; all six retained generation responses identify the exact model and low effort. This is API evidence, not an inference from a T3/Codex display label.

The actual pinned OasisProfileGenerator produced three profiles. Every exported persona exactly matches a nonempty `persona` in a completed raw response. The actual pinned RedditSimulationRunner/OASIS then ran one autonomous LLMAction round: three active representatives, three successful posts, zero seeded posts, and three strictly accepted structured requests (H02, H19, H09; actual SQLite source row IDs 4, 5, 6). Unstructured or unsupported facts never become physical simulation truth.

The first social attempt was blocked before any social API call: pinned CAMEL overwrites its requested zero SDK retries with a base-constructor default of three. The adapter now constrains both actual SDK clients to zero, while CallGuard independently verifies zero at the I/O boundary. The unchanged retained profiles/manifest were resumed for a successful social round. No model was substituted and no old output was relabeled.

Terra episode: **6 paid calls, 5,348 input tokens, 2,703 output tokens, estimated $0.018863**. Output counts already include reasoning tokens. Including the original 12 gpt-4.1-mini calls ($0.0093664), the cumulative estimate at that historical checkpoint was **$0.0282294**, under the authorized **$10 cumulative cap**. It excludes the later Dallas v1 and expanded v2 episodes. These are conservative standard token-price estimates, not account invoices; cached-input discounts are not deducted. This episode had a separate $1 run allowance. No provider call occurs in the frontend, during replay, or in automated tests.

Private receipts remain in ignored `.private/mirofish-3c11dr3r/`: account preflight, complete raw Responses objects, exact SDK output, request hashes, usage/reservation ledger, profiles, unseeded platform database/schema/traces, and phase logs. Browser validation requires the model-specific complete manifest hash `4b5c2eb1432d0146f1e5962df091f993a0a633b25778c605eabdd61c4970e00a`, explicit Responses/low metadata, exact actor contexts and instructions. This establishes structural compatibility; it is not cryptographic proof of remote authorship.

Approved Terra artifact SHA-256: Windows preparation bytes `43b6d218f21cddfcd29b24b4da1a3b22b0cee77259bd765e59c1eedd0a324428`; LF repository bytes `da1a85ca8d7eab161b178a78ac213ef9a9a2b68a499b35a1bf90ccf981796720`.

## Original output retained accurately

`public/data/mirofish-4.1-mini-v1.json` preserves the original **gpt-4.1-mini** artifact. It contains three verified profiles, three autonomous posts, no seeded posts, and one accepted H19 request. The original saved run remains at `public/data/default-run-4.1-mini-v1.json`; it still imports and replays with its original artifact. The updated default saved run embeds the actual Terra artifact.

Original canonical episode: 6 calls, 4,712 input / 1,760 output tokens, estimated $0.0047008. Earlier episode: 6 calls, 4,688 input / 1,744 output, $0.0046656. Total legacy preparation: $0.0093664. Original receipts remain privately recoverable; the failed social import made no model call. Legacy rates were $0.40 input / $1.60 output per million tokens, verified against https://developers.openai.com/api/docs/models/gpt-4.1-mini.

Original artifact SHA-256: Windows bytes `24d0fe5f9878e41ff791628885c5206c0f46041ad9ece4fd2a69c76563bdfd9a`; LF repository bytes `d661847725cb4cb7f25c7ef13077cd7f8025c52d76a2ca878020cc052995f5e3`. Legacy complete input hash remains `25c44ff50fc81cb8a38b991c56bb71f8736961d3db3337b37c8a7f1cf7565321`.

## Earlier v1 adaptation and bounds

- Import actual upstream modules without unrelated eager server/graph imports; no replacement generator or scripted social posts. Zep enrichment is unused.
- Supply only frozen synthetic actor facts, generic storm context, and exact allowed-request instructions. Fleet, kits, shelter capacities, household outage, roads, other households and future events are not sent to the model.
- Translate pinned Chat Completions callers into Responses text/function objects. Original reasoning items are retained privately for valid tool continuations; unknown or altered histories fail before I/O. Incomplete/refused outputs cannot execute actions or establish persona provenance.
- Actual OASIS/CAMEL executes returned social function calls. The adapter translates transport objects, not the choice of action.
- Use direct OpenAI endpoint, zero SDK retries, 30-second request timeout, 4,096 output tokens including reasoning, and separate 32,768-token CAMEL context retention. Upstream temperature is not forwarded. The 50,000-byte bound applies to the fully expanded Responses body, including replayed reasoning.
- Before each call, reserve every request byte as a token plus 4,096 overhead, at $2.50/M input and $5/M output. A shared operating-system lock and persistent per-run ledger enforce both explicit run allowance and the cumulative $10 cap, including audited legacy spend. Failed/uncertain calls retain their conservative reservation; conversion failures still record raw usage. At most 30 attempts are allowed per preparation directory. No assumption that a timeout makes a call free is made.
- Run profile/social phases in separate processes with 180-second limits; terminate only their process tree on timeout. New work directories and completed output files are created exclusively. Resume rejects changed or missing original manifests, models, actor instructions or inputs.
- Accept only successful autonomous platform posts/comments attributable to the matching verified actor and exact complete fact references. Partial preparation exports profiles only. First-round accepted requests map to exercise minute 5; otherwise deterministic rules attempt minute 10. Outages can prevent receipt. This timing is a declared exercise assumption, not empirical social behavior.

## Earlier v1 reproduction

```powershell
powershell -ExecutionPolicy Bypass -File tools/setup_mirofish.ps1
.venv-mirofish/Scripts/python.exe tools/prepare_mirofish.py --input fixtures/actor-context-v1.json --output public/data/new-episode.json --key-file C:/path/to/authorized-key.txt --model gpt-6.1-terra --budget-usd 1
.venv-mirofish/Scripts/python.exe -m unittest discover -s tools/tests
npm run test:pack
```

Use an explicit run allowance below the remaining cumulative budget. The authorized key is read into process memory; never add it or private preparation receipts to source control. Tests require the pinned OpenAI SDK (`python -m pip install openai==1.109.1`); full preparation additionally requires the isolated locked MiroFish environment. Raw synthetic output still requires review before public promotion.
