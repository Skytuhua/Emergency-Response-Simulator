# Catastrophe Response Simulator

A fictional 60-minute storm-response exercise. Create conditions, find households that cannot report their needs, dispatch constrained resources, and compare the resulting run with a deterministic baseline.

## Run locally

Tested development runtime: Node 24.14.0 and npm 11.9.0 on Windows.

```powershell
npm ci
npm run build
npm run demo
```

Open http://127.0.0.1:4173. `demo` serves the production build with a strict port. For development use `npm run dev`. Fonts and map graphics are local; the browser simulation does not call a model provider.

If port 4173 is occupied, use `npm run demo -- --port 4175` and open http://127.0.0.1:4175. The production browser checks in this build used that alternative port.

## Exercise

Setup opens with three steps: **Conditions → Resources → Review**. Defaults are prefilled and Back preserves edits. The default is seed 42, 24 homes, two four-seat vans (V1 is accessible), one response crew, three kits, two shelters with eight places each, and a southeast communications outage.

The dashboard starts paused. Select a home and use its contextual action: **Check home & run**, **Deliver kit & run**, or **Send transport & run**. The fastest feasible team/shelter is suggested; choices remain editable. Successful dispatch starts playback. A sent team remains in progress until delivery or shelter drop-off.

**Homes**, **Teams**, **Activity**, and **Details** open secondary drawers. The **Exercise** menu contains import, export, new exercise, and finish. Selecting a home, opening a drawer, new urgency, and hiding the tab pause playback. Closing a drawer leaves the clock paused. **+1 min** pauses and advances one minute. Playback remains two real seconds per simulated minute at1×.

For the golden path, send C1 to check H19 at minute0, pause or step to8, then send V1 to H19/East Shelter. Pickup is16 and drop-off24. Results use **Overview / Compare / Homes / Details** tabs.

Export paused or completed runs to JSON. Reloading the page discards an unsaved run. Import validates the whole file before installing it, replays the recorded decisions, and opens paused. Replay preserves decisions; restart preserves conditions and clears decisions; edit conditions creates a new scenario.

The bundled [recorded default run](public/data/default-run.json) is a replay-validated recovery fixture: all six needs completed, three urgent needs on time, three kits consumed, and nine shelter places occupied. Import it to inspect saved decisions; **Restart same conditions** begins a fresh exercise. This is a scripted witness, separate from the comparison baseline.

## Verification

```powershell
npm run typecheck
npm test
npm run build
python -m unittest discover -s tools/tests
```

With the production preview running at port 4175, `npm run test:browser` checks the wizard, 26 desktop states at 1366×768 and 1440×900, readable controls/map labels, golden path, minute-17 replay, invalid-import preservation, results tabs, shortages, keyboard panels, and compact reflow. Evidence stays under ignored `.private/browser-evidence/simpler/`. Set `APP_URL` for another origin; this revision was tested at 43179. `npx playwright install chromium` installs the browser. `npm run demo:record` records `.private/demo-recording/simpler-response-demo.webm`.

The master plan defines acceptance. See `docs/evidence/build-status.md` for executed checks and unresolved gates. Automated fixtures do not establish operational emergency-response validity or competition eligibility.

## MiroFish preparation

Preparation is separate from the browser. See [UPSTREAM.md](UPSTREAM.md) for the pinned source, installation, actual integration outcome, and evidence. No test fixture is a substitute for verified LLM generation or an autonomous OASIS action.

The UI reports the loaded artifact's integration level. If no approved compatible artifact exists, deterministic reporting keeps the offline exercise usable and MiroFish remains explicitly blocked. A compatible artifact changes validated report timing, never physical needs or response capacities.

## Scope and attribution

This is an independent synthetic training prototype inspired by the supplied State Farm challenge and interface references. It is not an official State Farm service. No real household data, weather prediction, clinical triage, or operational dispatch is provided.

UI primitives are adapted from [shadcn/ui](https://github.com/shadcn-ui/ui). The captured source revision is `42f3bb63b46a69e52a24bd005cdc9ec15ba7a7b9`; its MIT license is retained in `docs/shadcn-LICENSE.md`. Import paths and application styling are customized. See `THIRD_PARTY_NOTICES.md` and `UPSTREAM.md` for MiroFish source and license obligations.

Project source is provided under AGPL-3.0 in `LICENSE`; third-party components retain their respective notices.
