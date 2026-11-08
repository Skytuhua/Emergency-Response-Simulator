# Dallas synthetic storm: automatic response scenario design

Design version: `dallas-synthetic-v2-draft1`, 2026-11-08. Status: **design for implementation; no new population, hazard calibration, model preparation, or scenario execution is claimed by this package**.

The user observes an automatic simulation of residents experiencing disruption, attempting to get help, and receiving assistance from constrained response teams. The purpose is to examine urgent needs, coordination, and people the response may overlook. People, needs, facilities, and incident outcomes are synthetic. Streets and aggregate population constraints can be sourced from real data.

## Recommended scenario

**Dallas storm response, six simulated hours.** Use the August 21-22, 2022 flooding as a documented historical analogue, with a current-planning population and road snapshot. This is not a reconstruction of that event. The Census 2020-2024 ACS period, current road snapshot, and assumed incident tape must each retain their own dates. Historical validation would require time-aligned inputs and independent observations.

| Part | Proposed default | Evidence status |
| --- | --- | --- |
| Geographic support | Complete Dallas County tracts `48113001502` and `48113002200`; verify polygons and adjacency before admission | Candidate support identified by official TIGERweb; boundary files not bundled here |
| Population | Every synthetic household needed to match admitted occupied-household controls in those tracts; resident total derived from household records | Counts pending source acquisition; no invented Dallas total |
| Benchmark | Separate 1,000-household workload; test 100 and 10,000 households separately | Experimental size, not an observed population count |
| Simulation clock | 360 minutes, starting at analogue 06:00 America/Chicago | Assumption; not a historical incident timeline |
| Hazard | Versioned, spatially clustered synthetic incident schedule | Assumption informed by historical context; not flood physics |
| Response | Automatic assistance and proactive checks using available observations | Explicit rules; not LLM or clinical triage |
| AI sample | Target 24 directly generated household representatives, admitted in cohorts of six | Future preparation target, budget-dependent; currently only three are supported |
| Model | `gpt-6.1-terra`, Responses API, reasoning `low` | Existing integration setting; new actors require new receipts |
| Initial resources | Four check crews, four six-seat vans (two accessible), 250 household supply bundles, 300 shelter places | Synthetic stress-test assumptions; not Dallas response capacity |

The current roughly 1.3 by 1.9 km road-query rectangle intersects ten census tracts. It cannot inherit a whole tract's population by copying its totals. The selected two complete adjacent tracts have combined bounds west -96.792356, south 32.784067, east -96.761406, north 32.800134. Expand roads to cover their polygon union plus a proposed 500 m routing buffer and explicit exit nodes; residents belong only within the admitted tract polygons. Buffer roads do not introduce uncounted external demand. Reject incomplete coverage. See [sources and acquisition gates](SOURCES.md).

## 1. Population that represents an area

Use official occupied-household, household-size, age, vehicle-access, housing, language, and disability-related aggregate controls where available. Use household and person microdata to preserve relationships within families. Do not independently sample every characteristic: that can produce impossible households and unsupported correlations. Census survey estimates describe a multi-year population, not identified people or live conditions.

Preparation pipeline:

1. Freeze tract polygons, Census release/table metadata, estimate and margin-of-error fields, and a suitable overlapping PUMS donor pool. Acquire downloadable official files if API credentials are unavailable. Reject HTTP 200 HTML, suppressed values, sentinels, incorrect geographic vintages, and missing keys rather than accepting them as data.
2. Reconcile household and person universes. Household totals exclude group quarters; do not silently force nursing homes, dormitories, and other group quarters into family households. Record any excluded population separately.
3. Fit household donor weights to supported aggregate controls with an established iterative fitting method; preserve whole household membership. Declare tolerance, convergence, zero-cell treatment, and incompatible-control handling. If the fit fails, mark the geography unsupported; do not silently replace it with uniform random residents.
4. Integerize with a recorded random seed. Person count is computed from the resulting household members. Report both pre-integerization fit and final integerized errors. Small cells need an absolute-error check as well as percentages.
5. Place households on residentially supported blocks or capacity-supported residential buildings, then connect their access points to legal road nodes. Multiple apartments may share an access node, but must have distinct household/unit IDs and an explicit capacity basis. When only block-level placement is supported, label it approximate; do not invent precise real addresses.
6. Export a source/fit receipt and immutable population hash before generating personas or needs.

No individual biography, disability, income, ethnicity, or medical condition is attributed to an actual Dallas address. Neighborhood aggregate vulnerability can identify coverage gaps; it does not reveal an individual's need. Disability prevalence does not directly determine wheelchair transport demand, household consent, acute illness, or urgency. Unsupported assistance requirements remain synthetic scenario parameters.

### Population release checks

- Exact internal totals: household sizes equal person count; IDs unique; age/relationship records coherent; all units geographically supported; group-quarter exclusions disclosed.
- Initial engineering tolerances: occupied-household integer target exact; supported major control shares within 2 percentage points; rare controls within two households/persons **or** their declared rounded target tolerance. These are design thresholds, not a statistical validation standard. Record every control and error, including failures.
- Compare joint distributions and household relationships with the donor pool and available published cross-tabs, not just separate marginals. Unsupported correlations remain unverified.
- Keep estimate uncertainty separate from fitting error. A good fit to uncertain controls is not proof of local household truth.

## 2. Evolving disruption, needs, and reports

The first implementable hazard is an inspectable incident tape. It can show a spreading disruption without inventing a hydraulic forecast. Rainfall, road closure, household power, and communications are separate layers; one does not mechanically prove another.

| Minute | Assumed event | Required recorded effects |
| --- | --- | --- |
| 0 | Heavy-rain context and initial needs | Incident IDs, affected zones, initial observations |
| 30 | Household communication failures begin | Sending channels unavailable in defined polygons; responder radios modeled separately |
| 60 | Selected streets close and new needs appear | Exact edge IDs, effective time, discovery time, and affected household IDs |
| 120 | Maximum configured disruption | Added incident effects; no resetting earlier unresolved needs |
| 240 | Partial recovery begins | Selected channels restored; closures reopen only through explicit events |
| 360 | Observation window ends | Ongoing missions, waiting needs, and uncontacted homes retained |

Every event stores `effectiveAt`, `observedAt` or `null`, source/assumption ID, affected entities, and any end/review time. The world can contain a closure before responders learn it. Dispatch cannot read undiscovered events.

Default need incidence is 10% of households, with 5% and 20% sensitivity runs. This is a synthetic workload parameter. Select affected households through the declared exposure/support model; household traits alone do not create disaster needs. Partition needs into delivery and relocation with an explicit assumed mix. Report actual household and resident counts by need. Multiple residents in one household are not multiple independent requests.

### Reproducible reference recipe (all assumptions)

The first supported workload uses seed `20261108`. Allocate the 10% need count across admitted tracts proportional to admitted households, then choose households by stable hash rank within each tract; this initial selection is not a flood-damage probability model. Assign half the selected needs to delivery and half to relocation, independent of demographic traits. Allocate need onset 40%/40%/20% to minutes 0/60/120. Mark a seeded 30% of needs urgent, with service targets onset +90 minutes; other targets are onset +180 minutes. Onset/urgency are private world facts until reported or discovered. Physical exposure models can replace this reference sampler only under a new versioned recipe.

Round a single fractional count with `floor(fraction * eligibleCount + 0.5)`. Allocate multi-category counts by largest remainder, with category ID as the tie-break. Rank entities by SHA-256 of `seed|recipeVersion|field|entityId`; the field key prevents selection order from changing other draws. Freeze selected IDs and counts in the experiment receipt. These rules also apply to scenario masks: admit only in-support household/road IDs, use recorded spatial clusters, and report actual achieved exposure rather than forcing an impossible percentage.

Among need households using the background behavior model, select 80% to attempt reporting; the other 20% do not self-report within this window and require discovery. The first attempt is exactly onset +20 minutes. Failed attempts retry every 30 minutes until received, need resolved, or the window ends. Once received, no duplicate requests are created; retries update delivery history. Initial background neighbor messaging and spontaneous self-relocation are disabled. First-report delay and reporting propensity have declared sensitivities. Direct LLM actors follow their retained legal actions instead; report their realized behavior separately, without pretending their small sample measures population propensity.

A service target is a modeled response objective, not a prediction of death or clinical deterioration. Needs can appear over time, remain unmet, be resolved by a modeled self-help event, or require assistance. Every transition needs a source event; request text cannot create physical facts.

Communication attempts and receipt are distinct. Residents can attempt a message while the network is down, retry later, or contact a modeled neighbor. Unreceived requests are not visible to the coordinator. Duplicate messages update one need record; contradictory/uncertain reports retain source, time, and confidence classification without erasing the history. New behavior such as neighbor messaging must be implemented and validated before being enabled.

No FEMA flood-risk zone or remote gauge value is converted directly into a property's water depth. A future flood-depth tier needs terrain/drainage, rainfall, boundary conditions, a documented physical model, and independently checked inundation data. No such tier is delivered here.

## 3. Automatic response and physical accounting

Users observe, pause, change playback speed, inspect residents, and compare scenarios. They do not manually choose rescue missions or complete tasks to earn an outcome.

The response policy receives only coordinator observations: received reports, completed checks, public disruptions and known route closures, elapsed waiting times, and available resources. Private personas, true undiscovered needs, future events, and full-world overlays cannot enter that policy interface.

Proposed comparison policies:

- **Received-order response:** help in order of received reports; available check crews may check unknown homes when no received need can use them.
- **Current urgency-first response:** prioritize observed urgent needs, service targets, and feasible completion; use remaining feasible capacity for checks.
- **Urgency plus coverage:** the same assistance rule, with one of four check crews initially reserved for uncontacted households in public disruption zones. If no eligible check is feasible, release that crew for other feasible work. The allocation is an experimental hypothesis; test 0%, 25%, and 50% check-capacity reservation.

No policy gets hidden resident facts. Stable IDs break ties. Accessibility and compatible seats/shelters are constraints, and demographic attributes are not priority scores. Log reasons based on observed evidence for each automatic choice. Discovery can starve under a sustained urgent queue in the existing policy; measure that rather than assuming the proposed policy wins.

The engine owns supply use, seats, shelter reservation/occupancy, mission progress, availability, and completion. Assistance is counted only after the service or shelter drop-off finishes. Do not count an assigned or en-route mission as completed. Replenishment, staff shift changes, self-relocation, or resource arrivals occur only through explicit supported events.

Reference capabilities: check crews can check and deliver one household bundle, vans can transport and perform their required pickup verification but cannot perform proactive checks or supply deliveries. The reserved check crew therefore competes with delivery work in that crew pool. Vans have six total modeled occupant places; an accessible van includes one modeled accessible place within those six, not an extra place. Both synthetic shelters have 150 total places; shelter A accepts the modeled accessible-transport requirement, shelter B does not. The canonical household requirement is a separate assumed scenario fact, not inferred from Census disability.

For the reference recipe, allocate exactly one accessible-place requirement to a seeded 10% of relocation-need households using the same count-rounding and field-keyed ranking rules. Assign an explicit zero to the others; missing values must fail admission rather than default to zero. Test 5% and 20% as sensitivities. This is an assumed service-demand mix, independent of disability prevalence. Freeze each household's requirement, the requirement-manifest hash and actual demand counts in the experiment receipt before persona generation.

Keep households together in the reference version. More than six residents or more than one accessible-place requirement cannot be transported by this fleet and remain explicitly unsupported; do not truncate household size or fake a split transfer. Supply bundles serve one household regardless of its size, an explicit service-unit simplification. Admit one synthetic base and two shelters only after assigning safe, connected legal access nodes in the expanded graph. Record facility ID, synthetic status, node ID, capabilities, capacity, opening times and hazard exposure. Their coordinates remain pending graph admission; no real shelter's operating capacity is claimed. Facility closure blocks new assignments and retains existing occupants; subsequent evacuation requires an explicit supported event and resource allocation.

### Routes and event ordering

Respect one-way, access and turn restrictions on the frozen graph. Ordinary vans cannot enter declared unsafe flooded edges. Replan from the next safe node when a future segment becomes unavailable. If an edge becomes unsafe while a unit occupies it, record an interrupted/stranded mission at its actual position; hold its passengers/resources and require an explicit supported recovery event. Do not teleport the unit to a safe node or silently complete its mission. Specialist water rescue is unsupported until a separate capability is modeled.

At each time boundary: apply world changes; reconcile in-flight movement and interruptions; complete eligible arrivals/service using the new safety state; publish reports and checks whose delivery is possible; then make automatic assignments. Stable event IDs resolve same-time ties. Replay must reproduce this order. Final cutoff keeps incomplete missions open; no completion is inferred beyond minute 360.

## 4. An honest, visible LLM role

The population generator provides structured facts. The LLM creates a bounded sample of resident backgrounds and actions consistent with those facts. Most residents use documented stochastic behavior; they are not all directly LLM-generated.

Target 24 direct household representatives in four six-household cohorts, selected to cover exposure, household size, communications access and modeled support requirements. This illustrative sample is not representative evidence of behavior rates. Each actor gets at most three initial generation opportunities: persona; response to an exogenous need onset; response to an exogenous communications change. Actual SDK calls and continuations are recorded. There are no paid per-resident/per-minute calls during playback.

Each cohort must fit an explicit preparation allowance and the remaining **$10 cumulative project cap** under the existing shared ledger. The parent verifies the live ledger before proposing any allowance; this design authorizes no additional spend. Keep retries disabled, request/output bounds, raw successful receipts and failed-call reservations. Existing per-directory attempt limits remain; cohort partitioning cannot be used to retry an otherwise exhausted request. Start with one cohort and grow only after its cost, legality and provenance checks pass. If 24 actors do not fit, show the admitted count honestly.

Use a v2 manifest binding population, map, hazard and behavior contracts; prompts; allowed observations/actions; model/effort; upstream commit; adapter version; and response hashes. The LLM sees only the actor's local facts, messages received and known events at that time. It cannot invent hazard truth, physical capacity, medical outcomes, or completed assistance.

For the first paired-policy experiment, prepare actions only against common exogenous observations and retain their exact observation-context hashes. Assistance-dependent resident decisions are disabled. A prepared action executes only if its context hash and current legality match; actions invalidated by completed assistance are recorded as suppressed, never replayed as fresh model decisions. A missing/changed context uses an explicitly labeled behavior-model fallback, with the reason and fallback count retained. Future assistance-dependent decisions require pre-generated branches for each exact context or separately authorized generation outside playback; do not reuse an action from a different history while claiming `llm-direct` behavior.

The observer can inspect an actual chain: resident background -> observed event -> original generated action -> send attempt -> receipt/failure -> coordination -> travel -> completion/waiting. Each link references a real source action or engine event. Use source categories `llm-direct`, `behavior-model`, and `authored-fixture`; a sampled resident derived from an archetype remains sampled. The LLM does not make the current rule-based coordinator an AI triage system.

## 5. Experiments and what results mean

Run each policy against the same population, hazard tape, exogenous behavior draws, resource settings and start time. Key random draws by entity/event/seed so policy iteration order cannot change the random stream. The first comparison disables assistance-dependent resident decisions; post-completion suppression can still differ and is recorded. Future feedback models must retain common exogenous inputs and identify policy-dependent branches; do not claim the received-message tape is identical after outcomes diverge.

Start with 30 paired seeds for the baseline and predeclared single-factor sensitivities. Extend toward 100 only when unstable. Avoid an uncontrolled full factorial sweep. Keep the LLM artifact fixed for the first analysis; report that behavior varies conditionally on that prepared sample. Model-output variability needs separately generated and independently budgeted artifacts.

Measure urgent-service waiting times and completion, unmet-need minutes, uncontacted households, undiscovered actual needs (debrief-only truth), accessible-transport waits, unreachable households, completed residents, shelter use, and resource deficits. Separate detected need from total true need. Compare tradeoffs and unresolved cases; do not reward or score the viewer.

Simulation percentile bands describe conditional modeled variability. They are not confidence intervals for real Dallas outcomes. A result that varies little under an untested assumption can still be wrong.

Evidence levels must remain separate: **execution verified**, **population fit checked**, **hazard calibrated**, **behavior calibrated**, and **held-out event tested**. The last three begin unperformed. The historical analogue and an accurate population fit alone do not validate disaster response. A held-out flood/event or time period must not be used to tune the parameters it later tests.

## 6. Feasible delivery order

1. Freeze/admit source snapshots and geography; implement population generation and fit receipts independently of the app.
2. Add v2 contracts, dynamic events and 360-minute accounting; retain existing v1 saves, actors and 60-minute behavior unchanged.
3. Add automatic policy comparisons and coverage checks with deterministic replay and hidden-state tests.
4. Expand MiroFish preparation, validate one cohort, then consider more within the remaining budget.
5. Connect observer visuals to event/persona provenance; benchmark distinct population placements and complete the evidence report.

Each is a separate implementation PR with named ownership and its own acceptance gates. This documentation PR implements none of them. See [handoff and acceptance](HANDOFF.md), [source register](SOURCES.md), and [machine-readable design parameters](scenario-design.json).
