# Implementation handoff and acceptance

## Ownership and current limits

This package owns only `docs/scenarios/dallas-synthetic-v2/`. It was designed in parallel with the active application session. No runtime, fixture, provider setting, paid request, shared branch, or shared Git index was changed to produce it.

Source inspection on 2026-11-08 found these migration gates:

| Current implementation | Required v2 seam |
| --- | --- |
| Frozen three-profile, three-agent, one-round artifact and minute-5 requests | Separate behavior-episode version, time-indexed observations/actions, cohort manifest |
| 24 households; four schematic neighborhoods | Admitted tract geography, household/person records, approximate spatial support |
| Fixed 60-minute horizon | Run-specific 360-minute horizon and event ordering |
| Delivery or relocation, short fixed service times | Versioned service-duration assumptions and interruption states |
| Static closures in scenario creation | Effective/known times, dynamic route revision, stranded/unsupported cases |
| Rule-based automatic scheduling | Versioned policies and observation-snapshot decision evidence |
| 500-command limit | Explicit resource and safety bounds adequate to the admitted workload, separately tested |
| Scale experiment repeats existing 24 placements | Distinct capacity-supported households and benchmark disclosure |

File paths and limits can change while the main session works; verify at implementation. Do not widen v1 validators or make old artifacts appear to satisfy v2.

## Proposed parallel implementation lanes

| Lane | Ownership proposal | Deliverable / dependency |
| --- | --- | --- |
| Data | New population tooling, source manifests, population fixtures | Admitted geography, controls, generated households and fit receipt |
| World/engine | New v2 models, event processing, routing integration, accounting | Dynamic truth/observation separation; requires agreed contracts |
| Behavior | Versioned preparation manifest and MiroFish adapter, behavioral sampling | Real actor/action provenance; requires population/world contracts |
| Policy/evaluation | Coordinator policies, experiment harness and metrics | Paired comparisons; requires observations and resources |
| Observer | Persona/event visualization and accessible inspection | Consumes event DTOs only; no duplicated policy/world truth |

Parent owns shared contract integration. Workers are not alone in the codebase and must not revert one another. Concurrent work touching shared files should be delivered through small patches or sequential integration, rather than parallel edits to the same hotspot. All changes/fixes go through PRs.

## Admission gates

**Data:** source bytes and SHA-256 retained; year/vintage/universe declared; estimates and margins of error parsed; JSON/CSV schema checked; missing/suppressed/sentinel values rejected or explicitly excluded; tract coverage and road buffer validated; licensing and redistribution reviewed. Census API key unavailable is an acquisition blocker for API use, not a reason to fabricate data. Official bulk files are the preferred no-key alternative.

**Population:** unique people/households; exact population/accounting relationships; whole-household donor sampling; fit convergence/error receipt; joint/distribution checks; residential capacity or approximate-block placement evidence; no claim of actual residents at a point; honest count of group-quarter exclusions. If only 1,000 households can be materialized, call it a synthetic workload/sample, not the area's full population.

**Mechanics:** no double reservation or negative supplies/seats; no assignment based on hidden needs or biographies; received reports distinct from attempts; no future-event leakage; inaccessible/unreachable cases remain waiting; closures and interruptions preserve actual positions and resources; event cutoff and ties replay identically; completed assistance traced to completed missions. Mutate private truth while holding public observations fixed and confirm the policy returns the same decision.

**LLM:** successful raw response and actual upstream action linked to each `llm-direct` claim; invalid/incomplete/refused outputs fail before action execution; actor facts immutable; unsupported actions cannot invent facts; model/effort/contracts match exact inputs; admitted cohorts fit the locked cumulative budget; zero paid calls in playback/tests. Existing three-person artifacts stay labeled and usable under their original contracts.

**Experiments:** common exogenous inputs across policies; no look-ahead; actual generated need and person counts reported; policy-dependent behavior explained; per-seed metrics retained, including failed runs; report paired differences and simulation spread. Predeclare sensitivities before inspecting outcome improvements.

## Proposed sensitivity design

All values below are uncalibrated engineering assumptions for the separate 1,000-household reference workload. They are not Dallas estimates. Baseline versus one factor at a time avoids an uncontrolled factorial expansion.

| Parameter | Baseline | Sensitivity values |
| --- | --- | --- |
| Need incidence (households) | 10% | 5%, 20% |
| Communication-loss exposure | 20% | 0%, 40% |
| Background first-report delay (fixed) | 20 minutes | 5, 60 minutes |
| Background reporting propensity | 80% | 60%, 100% |
| Urgent share of need households | 30% | 15%, 45% |
| Accessible-place requirement among relocation-need households | 10% require one place | 5%, 20% |
| Delivery / relocation need mix | 50% / 50% | 75/25, 25/75 |
| Assessment duration | 10 minutes | 5, 15 minutes |
| Delivery service duration | 10 minutes | 5, 15 minutes |
| Boarding and drop-off duration | 10 minutes each | 5, 20 minutes each |
| Flood-closure share of drivable centerline length | 5% | 0%, 10% |
| Travel time multiplier | 1 | 0.5, 1.5 |
| Check-capacity reservation | 25% | 0%, 50% |

Use exact-duration fixtures first. Stochastic duration distributions require separately documented bounded distributions; do not silently treat these medians/endpoints as empirical distributions. Overlapping polygons are reconciled so communication-loss and closure targets are measured over the admitted support, not obtained by double-counting. Closure selection must preserve the declared cluster mechanism and report actual exposure/connectivity, even if the exact percentage is unattainable.

Reference onset fractions are 40%/40%/20% at minutes 0/60/120; urgent/nonurgent service targets are onset +90/+180 minutes. Failed background report attempts retry every 30 minutes. Use the hash-ranked selection and largest-remainder rules in the design. Direct LLM action contexts must match recorded exogenous observations; assistance-dependent generation is disabled in the initial comparison and fallbacks are counted. Add regressions for unmatched prepared contexts, suppression after completed assistance, and changed histories never receiving false `llm-direct` attribution.

Facility/vehicle admission must check the capability matrix, six-place maximum, one included accessible place in compatible vans, two 150-place synthetic shelters, safe legal access nodes, and unsupported oversized households. Record an explicit per-household accessible-place requirement and its manifest hash; missing is not zero. A 7+ member household stays present in the population and unmet-need metrics even when the reference fleet cannot carry it. No split transfers, neighbor relays or spontaneous self-relocation may run before their mechanics exist.

Design review: independent initial and final design reviews completed. The initial review's reproducibility, prepared-action-context and resource-capability findings were corrected; the final review found one remaining support-demand allocation gap, corrected with the explicit seeded 10% reference allocation above. JSON parsing, parameter consistency, local document links and credential-pattern checks passed. These are design checks, not runtime or source-calibration evidence.

## Performance and review

Benchmark 100, 1,000 and 10,000 distinct synthetic households. Expand the supported geography or use evidenced multiunit capacity instead of recycling 24 points. Run five cold and ten warm trials per size with model/network calls disabled. Measure population load, observation projection, routing, coordination, minute advancement, summarization, memory and browser frame behavior separately; keep hardware and timing receipts. UI virtualization/aggregation must preserve exact counts and inspectability.

Proposed initial desktop engineering targets at 1,000 households: p95 minute-plus-policy processing below 100 ms and p95 pause/selection response below 200 ms on the recorded test machine. These are targets, not results; if missed, profile before optimizing. The 10,000-household run begins as a stress test, not a release promise. Correctness failures block performance claims regardless of speed.

Independent reviewers check data universes, time boundaries, route interruption, hidden-state access, budget/provenance and claims. First-time observers should identify what is happening, see a resident-to-request-to-assistance chain, and distinguish waiting from completed help without manual dispatch or coaching. The proposed 4-of-5 user-comprehension target remains unperformed until real participants are observed.

## Current evidence and unresolved items

This design has source research and code inspection only. No new population fit, hydraulic model, historical calibration, v2 simulation, participant test or paid generation was executed. Exact admitted population counts, complete tract/road downloads, building capacities, historical outage/closure tapes, resource availability and operational response-duration distributions remain acquisition or validation work.

The existing repeated-placement scale receipt is useful performance evidence for its stated workload; it cannot substitute for v2 demographic/spatial validation. Do not tune the local population or response to countywide incident totals.
