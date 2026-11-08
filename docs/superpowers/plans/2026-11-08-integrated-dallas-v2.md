# Integrated Dallas Simulation Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` for the parallel lanes below. Freeze shared interfaces before implementation; each task requires a failing regression, a passing implementation and independent review.

**Goal:** Integrate PR #6's population-grounded, six-hour Dallas scenario into the current automatic observer application.

**Architecture:** Keep v1 artifacts and replay unchanged behind a tagged runtime adapter. Build a separately admitted v2 world, public coordinator projection, prepared behavior pipeline and observer UI; integrate the isolated interactive-map leaf through its existing props.

**Tech stack:** TypeScript, React, shadcn primitives, Vitest, Playwright and offline Python acquisition/preparation tools.

**Specification:** [Scenario](../../scenarios/dallas-synthetic-v2/README.md), [source gates](../../scenarios/dallas-synthetic-v2/SOURCES.md), [handoff](../../scenarios/dallas-synthetic-v2/HANDOFF.md) and [exact recipe](../../scenarios/dallas-synthetic-v2/scenario-design.json).

The user has directed that PR #6's scenario design be implemented in the current automatic-observation release. It is the release specification, not a deferred documentation project. Preserve the four source files at `docs/scenarios/dallas-synthetic-v2/` and their original commit `a276a09b81e94968d7b53ae173a67b3df9aaa75b`.

## Release behavior

The observer starts a simulation and watches synthetic residents, reports, automatic coordination, travel and completed assistance. There are no responder assignments, rescue tasks, rewards or win conditions for the user. The integrated default will cover complete adjacent tracts **48113001502 and 48113002200**, use actual streets over their union plus a **500 m routing buffer**, and run the **360-minute** versioned synthetic analogue described in the design.

Population totals come from admitted occupied-household controls, not an arbitrary round number. A separate **1,000-household workload** and 10,000-household stress test remain separately labeled. Geographic/demographic fit does not establish accurate disaster impacts, behavior or response predictions. Historical material supplies context until local calibration evidence exists.

The working 24-home automatic Dallas simulation is a tested integration foundation, not completion of this v2 release. Current actual automatic results differ from the authored regression witness: six needs completed, two of three urgent needs timely, with H19 completing late at minute 36. Do not tune hidden truth to manufacture a favorable demonstration.

## First gate: freeze contracts

Coordinator owns new `src/v2/contracts.ts`, `src/v2/hash.ts`, `src/v2/admission.ts` and `src/runtime.ts`, plus App/default/import wiring. Preserve the exact v1 validators, artifacts and saved-run behavior; do not widen v1 to accept v2.

- `ScenarioBundleV2`: recipe/engine versions, 360-minute horizon, population mode, source statuses, resource/facility settings and hashes of map, population, events, support requirements and behavior assets.
- `PopulationBundleV2`: distinct household/person IDs, complete membership, geographic support, donor/fit/placement receipts, explicit group-quarter exclusions and legal access nodes. No record claims to identify a real resident at a map point.
- `NeedStateV2`: stable need ID, onset, deadline, status and timestamped observations. An earlier check finding no need cannot suppress a later onset.
- `WorldEventV2`: stable ID, effective time, separately recorded observation time and typed source/payload. Use an explicitly ordered integer-millisecond event boundary.
- `CoordinatorObservationV2`: received reports/checks, known closures, public requirements, waits and resources only. It excludes biographies, unreported needs, private closures and future events.
- `ResidentContextV2` / `PreparedActionV2`: actor-local exogenous observations, exact canonical context hash, opportunity/time, original action and verified origin. Preparation never supplies global hidden truth to a policy.
- `ObserverSnapshotV2`: display aggregates, inspectable evidence pointers and public coordination. Resident-side prepared evidence is distinguished from coordinator knowledge; private unmet/undiscovered totals enter debrief only.
- `RunFileV2`: frozen assets embedded once, engine/policy versions, ordered commands/outcomes and public decision evidence, expected state/trace digests and explicit continuation lineage. Replaying uses recorded commands, not the latest policy implementation.

Freeze cross-language canonical bytes, source-byte versus normalized-asset hashes, and seeded ranking as UTF-8 SHA-256 of `seed|recipeVersion|field|entityId`, with stable byte-order ID ties. Round single counts with `floor(f*n + 0.5)` and multiple categories by largest remainder. Runtime state/trace digests exclude only the documented run-instance ID and local replay lineage; normalize references consistently without omitting commands, evidence, resource state or physical cursors. Compare canonical state and trace under a new replay run ID before accepting the contract.

Version-specific byte/count/time bounds must be measured on actual admitted assets and worst-case 360-minute runs before admission. Keep v1's 1 MiB / 500-command / 5,000-item limits. App's pre-read size gate must dispatch by supported format. Reject excessive nesting, corrupted assets and incompatible hashes before allocating large structures.

## Parallel ownership and dependencies

Use three workers plus the coordinator at most. Workers are not alone and must preserve others' changes. Freeze shared DTOs first; deliver integration patches for parent-owned hotspots instead of editing them concurrently.

| Lane | Exclusive ownership | Deliverable |
| --- | --- | --- |
| A — data/population | `tools/v2/acquire_sources.py`, `fit_population.py`, `import_roads.py`; `fixtures/v2/sources/`, population/map manifests; data tests | Retained official inputs, admitted full polygons/buffered roads, fitted complete households/persons and placement receipts |
| B — world mechanics | `src/v2/world.ts`, `events.ts`, `movement.ts`, `resources.ts`, `observe.ts`; world/mechanics tests | 360-minute needs/reports/retries, private/known disruptions, legal motion, interruptions and conserved resources |
| C — behavior | `tools/v2/prepare_behavior.py`, normalizer/context tools; versioned behavior fixtures/tests | No-spend context validation first; genuine bounded Terra cohorts and explicit fallback/suppression later |
| D — policies/evaluation | `src/v2/policies/`, `tools/v2/compare_policies.*`; policy/experiment tests | Exact `received-order-v2`, `urgency-first-v2` and `urgency-plus-coverage-v2` policies; public-only decisions and 30 paired seeds |
| E — persistence | `src/v2/run-file.ts`, replay/digest helpers and import tests | Bounded self-contained v2 replay, state/trace identity, safe continuation and v1 compatibility |
| F — observer | `src/ui/v2/` components/CSS and observer tests | Population aggregation, accessible inspection, resident-to-assistance chains and descriptive outcomes |

**Wave 1:** A, B and C against the frozen contracts. C performs offline preparation work while data is acquired. **Wave 2:** D, E and F after the world emits stable DTOs. Coordinator integrates runtime/defaults and browser/recording scripts. An independent reviewer takes a freed slot after each material leaf and again on the integrated candidate.

`src/ui/TownMap.tsx` and the interactive-map modules were reserved to the user's isolated map leaf, PR #7 (`fa030b85`), now merged into this foundation. Do not replace them in parallel. Preserve its props/model interface, real-street routing geometry and legacy schematic mode; coordinate any further package changes with that owner. V2 aggregation wraps/reuses that leaf through agreed geographic feature IDs and bounds.

Coordinator owns `src/ui/v2/map-adapter.ts` and its DTO contract, without editing the reserved map renderer or package files concurrently. Freeze `MapSceneV2` with EPSG:4326 bounds, `household:`, `person:`, `cluster:` and `unit:` feature-ID namespaces, geographic positions/route cursors and selection resolution. Cluster member IDs and exact household/person totals remain separate from rendered feature count; every household remains inspectable through an accessible list. Publish only known closure overlays to the public map. Resident-side attempt evidence uses its separate observer lane and never changes coordinator knowledge. The map owner must explicitly admit the additive scene/layer input after its present leaf lands; a cast from v2 to `ObservationView` is not integration. Test unchanged map/public output under private-closure/need mutations and exact totals/selection before and after clustering.

## Data admission work

Live planning probes confirmed official no-key [table-based ACS bulk files](https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/) and [2020–2024 Texas PUMS files](https://www2.census.gov/programs-surveys/acs/data/pums/2024/5-Year/) are available. Four core controls plus donors advertise about **468 MB** transfer; all eight controls plus donors about **1.02 GB**. Avoid the roughly 12 GB all-table archive. Check storage and stream/filter inputs rather than expanding everything into memory.

Planning queries returned both tracts and corroborated adjacency; candidate donor support is **STATE 48 / PUMA 02313**, using 2020-based PUMAs. These are availability probes, not admitted source artifacts. Retain exact bytes, times, hashes, vintage, variable metadata and licenses; validate local polygon topology, positive-area PUMA support and the 500 m metric buffer before admission.

1. Acquire polygons/metadata and core household controls B11001, B11016, B08201 and B25008. Retain estimates, margins of error and annotations; reject HTML, sentinel/missing values and incompatible headers.
2. Stream Texas housing/person donors using current `STATE`, `TYPEHUGQ`, `NP`, `WGTP`, `SERIALNO`, `SPORDER` and `PUMA` fields. Preserve complete household membership and the 7+ tail. Do not use obsolete `ST` or dual-PUMA assumptions without actual header evidence.
3. Fit occupied-household controls and reconcile person totals, then validate joint distributions and placement capacity. Raw group-quarter-inclusive age/language, civilian-noninstitutionalized disability and vacant-inclusive housing margins cannot all constrain these donors unchanged. Admit only compatible transformations; use the others as qualified checks/context until their universes are reconciled.

Expanded roads, residential placement and safe facility nodes require new immutable assets. Buffer roads do not add external households. Reusing the original 24 points for thousands is not spatial admission. If only a synthetic workload is ready, identify it as such; do not label it the full tract population.

## World and policy correctness

Implement the design's seeded 0/60/120-minute onset fractions, onset-relative urgent/nonurgent targets, reporting propensity/delays, 30-minute failed-attempt retries and explicit support-demand allocation. Keep these authored assumptions separate from measured Census controls and historical context.

- Preserve incoming-edge/direction context through pickup, dwell, subsequent missions and reroutes. A stop at a home must not erase a turn restriction.
- Keep private effective closures separate from observed closures. Dispatch against public evidence; do not let private-world feasibility rejection disclose an unknown closure. Unsafe encounters publish evidence and trigger replan/stranding under the declared event order.
- Never teleport a vehicle or let it traverse a declared flooded edge freely. Interrupted missions retain actual position, passengers/cargo and mission-owned reservations until a modeled completion/abort/recovery transition releases them.
- Freeze supply depot/staging/loading semantics before implementation. Track available/reserved/loaded/consumed resources and accessible places without double counting. Six-place vans include their accessible place. Unsupported 7+ households remain present and waiting; no unimplemented split transfer or self-relocation is invented.
- Policies consume only `CoordinatorObservationV2`. Test identical decisions when private truth changes under a fixed public snapshot. Record the snapshot hash, rule and evidence IDs with decisions; imported history must not be relabeled as automatic or direct-LLM behavior.

## Genuine behavior and spending

The existing authorized OpenAI cap remains **$10 cumulative**; the current estimate is **$0.0472764**, leaving an estimated **$9.9527236** before new reservations. No new paid call was made for planning. Credentials remain private, and playback/tests make zero model calls.

Target **24 new direct actors in cohorts of six**. Freeze v2 population, actor-local contexts and manifests first. Reverify exact `gpt-6.1-terra`, low reasoning, account access and price; admit each whole cohort against the locked live ledger using request/output/retry worst cases. Existing authorization persists within that cap. A failed/uncertain call retains its reservation; stop or reduce the admitted cohort if it cannot fit. Do not substitute another model or fabricate the target count.

The existing ledger discovers immediate `.private` child directories by `preparation-manifest.json` and `profiles.model`. Coordinator owns its integration: pin one canonical physical project ledger/lock root across worktrees and preparers; refuse wrong roots and malformed/unregistered ledgers. V2 must either retain that discovery shape or atomically migrate all accepted legacy/v2 manifest versions under the same lock before allowing calls. Nested cohort folders and a new manifest shape must never make existing reservations disappear. One logical opportunity has one global attempt identity across cohort directories. Test legacy plus v2 plus failed reservations together, including concurrent admissions. Keep retries disabled and the existing 30-attempt-per-directory limit.

Successful provider output and actual upstream action must link to every direct claim. Current three-person v1 artifacts remain unchanged. Only exact matching prepared contexts may be replayed across policies/seeds; changed histories use counted suppression or labeled behavior rules. Fix common exogenous inputs for paired comparisons and report actual direct coverage per seed. Illustrative biographies and traits never become hidden triage features.

Each direct actor targets three opportunities; count actual provider requests, tool continuations and retries rather than assuming one call per opportunity. Across every policy/seed report: direct personas admitted, actors with matching eligible opportunities, direct actions executed, suppressed actions, fallback actions and reasons. A retained biography alone does not prove live or direct behavior during that run.

## Independently reviewable implementation tasks

The source package is preserved history: its `not-implemented` flags remain accurate for that design artifact. New runtime manifests and evidence receipts carry implementation status. Each task uses tests first, then the smallest implementation, targeted verification and a focused feature-branch commit/PR. Review fixes follow the same PR path.

### 1. Contracts and legacy protection — coordinator

- [ ] Pin the accepted automatic-foundation SHA and artifact hashes in `fixtures/v2/legacy-baseline.json`. Capture accepted schematic/Dallas v1 outcomes, trace and 8/16/24-minute H19 regression in `tests/v2/legacy-compat.test.ts`. This baseline includes the separately reviewed public dispatch-context correction; do not accidentally promise the older event text.
- [ ] Define the named DTOs above in `src/v2/contracts.ts`, canonical hashing in `src/v2/hash.ts`, composition admission in `src/v2/admission.ts` and tagged v1/v2 dispatch in `src/runtime.ts`. Freeze engine resolver, per-version limits, integer-ms event phases, policy order keys, map adapter and physical supply-location rules before workers consume them.
- [ ] Add `tests/v2/contracts.test.ts`: null design hashes fail runtime admission; a v2 bundle fails the v1 parser; byte 1,048,577, command 501, array 5,001 and minute 61 still fail v1. Canonical fixtures match Python/TypeScript; replay identity normalization retains command/evidence changes.
- [ ] Run `npx vitest run tests/v2/contracts.test.ts tests/v2/legacy-compat.test.ts` and `npm run typecheck`; independent review must accept the contract before wave 1.

### 2. Admitted geography and population — lane A

- [ ] In `tools/v2/acquire_sources.py` and `tools/v2/tests/test_sources.py`, first reject HTML, truncated ZIPs, duplicate members, incompatible vintages/universes, sentinel controls and hash mismatches. Retain raw official sources privately; publish only reviewed compact inputs, licenses, metadata and receipts under `fixtures/v2/`.
- [ ] Add `fit_population.py`, `import_roads.py`, `src/v2/data-admission.ts` and population tests. Assert whole-member households, exact IDs/totals, 7+ tails, source-backed group-quarter exclusion receipt, fit errors, legal access, positive-area PUMA support, full tract support and 500 m metric buffer. Reject copied 24-point population inflation.
- [ ] Run `python -m unittest discover -s tools/v2/tests` plus `npx vitest run tests/v2/data-admission.test.ts`. Hand off actual counts, source/asset hashes, placement capacity, exclusions and rejected controls. No admitted data means no full-tract default claim.

### 3. World mechanics and tiny six-hour slice — lane B

- [ ] Write `tests/v2/world.test.ts`, `movement.test.ts` and `accounting.test.ts` against a distinct authored mechanics fixture. Pin delayed onset after an earlier no-need check, onset+20 reporting failure, 30-minute retry, duplicate reports, same-time safety/completion ordering and cutoff minute 360.
- [ ] Implement `src/v2/world.ts`, `events.ts`, `movement.ts`, `resources.ts` and `observe.ts` with the frozen contract. Test incoming-arc continuity after dwell/pickup, unknown closure encounter without a dispatch oracle, unsafe occupied edges, actual position, interrupted passengers/cargo and mission-owned reservations.
- [ ] Assert last-kit/seat contention, six people including one accessible place, unsupported seven-person household and explicit shelter closure. Freeze a declared depot/staging/loading abstraction with conserved supply location; do not inherit the global v1 kit pool implicitly.
- [ ] Run the three named suites; hand off a deterministic 360-minute state/event trace, invariant receipts and public projection. No policy/UI imports in world modules.

### 4. Prepared behavior and shared budget — lane C

- [ ] First add no-spend tests for `src/v2/behavior.ts`, `behavior-artifact.ts`, `tools/v2/prepare_behavior.py` and `normalize_behavior.py`: exact actor-local hashes, wrong-context fallback, post-assistance suppression, legal action bounds, actual source-chain counts and zero network calls during replay.
- [ ] Coordinator serializes shared ledger changes before this lane uses them. Add legacy/v2 concurrent-reservation, wrong-root/nested-folder, failed-call and resumed-opportunity tests to `tools/v2/tests/test_budget.py`. Preserve no SDK retries and existing per-directory ceilings.
- [ ] After admitted data/context handoff, reserve one cohort's concrete worst-case allowance under the live cumulative lock, reverify the exact model/account and generate six actors. Review source custody, legality, cost and published fields before admitting another cohort, up to the real target of 24.
- [ ] Run `python -m unittest discover -s tools/v2/tests` and `npx vitest run tests/v2/behavior.test.ts`; deliver per-action provenance, source hashes, actual direct/fallback/suppression counts and spend/reservation receipts.

### 5. Policies, persistence and observer — wave 2, three separate owners

- [ ] D implements the exact three policies in `src/v2/policies/` and `tests/v2/policies.test.ts`. Define received-time/deadline/feasible-completion order keys and stable IDs; reserve the lowest-ID eligible check crews for the 25% reference coverage rule, release when no eligible check is feasible, and test 0%/50% sensitivities. Under byte-identical public observations, private needs/closures/personas must never alter decisions or evidence.
- [ ] E implements `src/v2/run-file.ts`, `limits.ts` and `tests/v2/run-file.test.ts`: bounded format bootstrap, supported engine resolution, embedded assets once, offline partial/stranded replay, equal state/trace with new identity, and continuation preserving prior origin. Reject changed assets, decisions, commands, depth/count/byte excess and unknown versions before replay work.
- [ ] F implements `src/ui/v2/` against observer DTOs and `tests/v2/observer.test.tsx`: actual persona/report/receipt/decision/arrival/completion chains, exact aggregate counts, cluster/list selection, keyboard inspection and descriptive outcomes. No manual assignment controls, duplicated world logic or hidden closure access. Root integrates the reserved map leaf through the agreed adapter.
- [ ] Each owner runs its named suite and typecheck, then receives independent review before integration. D freezes the 30-seed list, field keys, fixed behavior hash and sensitivity matrix before measuring policy improvements.

### 6. Default integration and release evidence — coordinator plus independent review

- [ ] Wire the admitted v2 runtime through App Start/import/export/horizon handling. Finish-to-cutoff is bounded/asynchronous with stale-run fencing; importing and details pause, and playback remains offline. Keep legacy imports and archived original artifacts available.
- [ ] Run the full actual admitted default for all 360 minutes, including resource invariants, observed routes, persona traces, UI inspection and exact export/replay. Record actual household/person/road/event counts in `docs/evidence/dallas-v2-release.md`; the 1,000-household benchmark does not stand in for this run.
- [ ] Run `npm test`, `npm run build`, offline Python tests, updated browser checks, 30 paired seeds and the distinct 100/1,000/10,000 workload trials. Report failed cases and per-seed behavior denominators. Independent reviewers check source admission, private/public separation, physical accounting, provenance, budget and desktop observation separately.
- [ ] Switch the default only after those gates pass, update recording/submission claims to actual evidence, and keep participant comprehension explicitly unperformed until observed. Phone integration remains deferred.

## Release sequence and evidence gates

1. Integrate the automatic foundation, preserved PR #6 design and this plan into the PR #6 branch, based on the Dallas foundation. Keep it open/draft until the integrated runtime gates pass; no direct main changes.
2. Freeze contracts and a small authored 360-minute mechanics fixture. It must demonstrate delayed need onset, failed/retried reports, rerouting/interruption, oversized support, accounting and exact export/replay before population-scale claims.
3. Run wave 1; admit the complete tract population, expanded roads, support requirements, facilities and event recipe only after their receipts pass. Then run wave 2 and integrate the interactive-map leaf without overlapping its ownership.
4. Execute 30 paired seeds under the same exogenous inputs. Preserve failed runs and report completed people, timely urgent service, unmet-need minutes, overlooked needs, unchecked homes, unsupported households and resource deficits. Predeclare sensitivity settings; simulation spread is not empirical predictive confidence.
5. Benchmark 100, 1,000 and 10,000 distinct supported households: five cold and ten warm trials, separate load/projection/routing/policy/step/summary/memory/UI receipts. At 1,000, proposed p95 targets are <100 ms step-plus-policy and <200 ms observer response; these remain targets until measured.
6. Verify keyboard/source inspection, desktop panels at 1366×768, 1440×900 and 1696×1020, and accessible focused panels at the supplied 1072×1258/732×1330 sizes. Further phone integration stays deferred. Real 4-of-5 uncoached comprehension testing remains unperformed until people are observed.
7. Switch default Start to the admitted v2 bundle only after independent source, mechanics, secrecy, budget, replay and observer review. Report population fit, historical calibration, behavior calibration and participant evidence separately. The release is not complete merely because the design or a larger counter is displayed.
