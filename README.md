# Catastrophe Response Simulator

Observe an automatic storm response across **3,061 simulated Dallas homes and 5,306 residents over six hours**. Residents try to report needs, teams respond using information they receive, and help counts after delivery or arrival at shelter.

The streets are real. Residents, home locations, incidents, response resources and outcomes are simulated. Census data shapes the population; this does not establish that the disaster or behavior is realistic or calibrated.

## Run locally

Tested development runtime: Node 24.14.0 and npm 11.9.0 on Windows.

```powershell
npm ci
npm run build
npm run demo
```

Open http://127.0.0.1:4173. The expanded Dallas simulation is the main flow. Earlier saved runs remain importable in a compatibility view. Use `npm run dev` for development or choose another preview port with `npm run demo -- --port 4175`.

Playback uses local data and makes no model calls. The basemap loads standard OpenStreetMap tiles; routing uses the separately frozen Dallas street graph, including turn restrictions and simulated closures. Drag to pan, zoom to reveal more homes, or select a counted house to inspect its members. Tile failure keeps the local road and response overlays. [Map behavior and terms](docs/INTERACTIVE-MAP.md) describe attribution and provider limits.

## Observe the response

Choose **Start simulation** to use the defaults, or **Customize setup** to choose a base, edit road blocks and adjust response resources. The response runs automatically after starting. The base is snapped to a reachable street point inside the simulation boundary; its displayed location is the location used by teams. User-edited road blocks last for the run. The defaults are adjustable exercise assumptions, not measured Dallas allocations.

Select a home to see its simulated needs, request outcome and response. A need not yet known to response teams is labeled separately; it does not enter their decisions until reported or checked. A planned call is not a received call, and assistance counts only after delivery or arrival at shelter.

**Run / Pause**, speed and **Advance one minute** control playback. At 1×, one simulated minute takes one real second. **Time elapsed** measures time since the scenario began. Choosing a home keeps playback running. Opening an inspection panel or hiding the tab pauses; closing a panel leaves it paused.

**Find a home** opens the searchable home list. **Sources** holds assumptions and source records. A resident's **Source & timeline** separates the plan from recorded events; identifiers and hashes are under **Technical evidence**. **Run options** contains save, open, restart and **Skip to the end**. Export before leaving to keep a run. Imported runs open paused after their recorded decisions and accounting have been checked.

Results use **Overview / Compare / Homes / Details** tabs. They show people in homes that received some help, urgent needs helped on time, people in homes with unmet needs, homes not checked, needs teams did not find, resource use and home histories. Unchecked homes may or may not need help. Assignment, a completed check, and boarding do not count as completed assistance. A home with another waiting need shows partial help.

The response approach is **Urgent needs and home checks**. Comparisons use the same starting conditions with **First requests first** and **Most urgent first**. These are alternative simulation rules, not validated recommendations for an emergency service. The [evaluation report](docs/evidence/dallas-v2-evaluation.md) separates the 30-seed background-behavior experiment from prepared AI examples, performance tests and unperformed validation.

## Population and prepared residents

The expanded population covers adjacent Census tracts `48113001502` and `48113002200`, with a 500 m road-data buffer. Whole household memberships are sampled from public Census PUMS donors and matched to compatible ACS household/person controls. Household and person totals match; individual secondary measures retain documented residuals and survey uncertainty. Home positions are approximate allocations using Census blocks, not real addresses or verified current building capacity. [Source and fit records](fixtures/v2/sources/) retain the admitted inputs and limitations.

The currently published expanded artifact contains **24 actual `gpt-6.1-terra` low-reasoning profiles and 47 admitted prepared MiroFish/OASIS actions**. Other homes follow declared simulation rules. The profiles and actions were generated before playback, checked against frozen local contexts, and admitted with source evidence. A changed situation can cause a prepared action to be skipped or replaced by the declared reporting rules. Custom road edits disable prepared actions for that run and use the reporting rules; the stored artifact is not relabeled or rebound. Routing, resource accounting and completion follow the simulation engine.

The original four-file [scenario design](docs/scenarios/dallas-synthetic-v2/README.md) remains a historical design record. The [integration plan](docs/superpowers/plans/2026-11-08-integrated-dallas-v2.md) tracks implementation gates. Preparation remains bounded by the cumulative **$10 maximum**, including earlier model episodes and conservative reservations. The recorded cumulative actual plus conservative reserved amount is **$0.2914029**; this is not an invoice. One invalid actor-local action was rejected without retry. [UPSTREAM.md](UPSTREAM.md) documents source pins, the provider bridge and private preparation controls. Credentials, raw provider envelopes, reasoning and donor downloads stay outside the public repository.

The earlier Dallas and Riverdale artifacts and run format remain preserved. The earlier automatic 24-home run completes six needs for 15 people, including two of three urgent needs on time. Its H19 completes at minute 36. The separately authored [Dallas witness](public/data/default-dallas-run.json) uses 6/12/21 for H19 check/pickup/completion; the [Riverdale witness](public/data/default-run.json) uses 8/16/24. These are distinct from expanded simulation outcomes. Original [4.1-mini output](public/data/mirofish-4.1-mini-v1.json), [its saved run](public/data/default-run-4.1-mini-v1.json), and [Riverdale Terra output](public/data/mirofish-v1.json) remain unchanged.

## Verification

```powershell
npm run typecheck
npm test -- --maxWorkers=1
npm run build
.venv-mirofish/Scripts/python.exe -m unittest discover -s tools/tests
.venv-mirofish/Scripts/python.exe -m unittest discover -s tools/v2/tests
```

With a local preview running:

```powershell
$env:APP_URL = 'http://127.0.0.1:4173'
npm run test:browser
npm run demo:record
```

For the setup map, start `npm run dev` on port 43184 and run `node tools/browser-check-setup.mjs`.

The expanded browser check and recorder intercept map tiles with a local fixture and make no live OSM or model requests. The legacy scripts are retained for historical testing and are not an alternate main application entry point. [Expanded interface evidence](docs/evidence/expanded-interface.md) distinguishes fixture browser checks, native observation, independent review and user acceptance. [Earlier automatic evidence](docs/evidence/automatic-observation.md) describes the separate 24-home version.

Further mobile integration is deferred. Uncoached first-time comprehension testing, historical disaster calibration, live emergency validation and citywide deployment have not been demonstrated. The source-supported population size is not a measure of predictive accuracy. The 10,000-household source-admission gate remains blocked rather than duplicating supported homes.

## Attribution

This independent simulation prototype follows the supplied State Farm challenge and interface references. It is not an official State Farm service. It contains no real resident reports and provides no weather prediction, clinical triage or validated operational dispatch.

UI primitives are adapted from [shadcn/ui](https://github.com/shadcn-ui/ui), captured at `42f3bb63b46a69e52a24bd005cdc9ec15ba7a7b9`; the MIT license is retained in [docs/shadcn-LICENSE.md](docs/shadcn-LICENSE.md). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [UPSTREAM.md](UPSTREAM.md) and [Dallas map attribution](docs/DALLAS-MAP.md). Project source uses AGPL-3.0 in [LICENSE](LICENSE); third-party components retain their licenses.
