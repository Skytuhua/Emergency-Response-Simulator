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

Create opens first. The default is seed 42, 24 households, two four-seat vans (V1 is accessible), one assessment/supply crew, three kits, two shelters with eight places each, and a southeast household communications outage. Teams retain working radios.

The response screen starts paused. Select H19 and send the crew for a welfare check. Its assessment finishes at minute 8. Dispatch accessible van V1 to H19 and Shelter A at that minute. Boarding finishes at minute 16; drop-off finishes at minute 24. Dispatch reserves resources; assistance is complete only after delivery or shelter drop-off.

Use the HTML household list for keyboard selection. Selection, new urgent observations, and switching away from the tab pause playback. Step advances one simulated minute. Default playback is two real seconds per simulated minute, with labeled faster options. Finish advances the remaining simulation to minute 60; it does not invent decisions.

Export paused or completed runs to JSON. Reloading the page discards an unsaved run. Import validates the whole file before installing it, replays the recorded decisions, and opens paused. Replay preserves decisions; restart preserves conditions and clears decisions; edit conditions creates a new scenario.

The bundled [recorded default run](public/data/default-run.json) is a replay-validated recovery fixture: all six needs completed, three urgent needs on time, three kits consumed, and nine shelter places occupied. Import it to inspect saved decisions; **Restart same conditions** begins a fresh exercise. This is a scripted witness, separate from the comparison baseline.

## Verification

```powershell
npm run typecheck
npm test
npm run build
python -m unittest discover -s tools/tests
```

With the production preview running at port 4175, `npm run test:browser` checks the golden household path, a minute-17 export/import, invalid-import preservation, results, restart, external network isolation, and desktop/mobile layout. It saves evidence under ignored `.private/browser-evidence/`. Set `APP_URL` to use a different preview origin. `npx playwright install chromium` installs the test browser. `npm run demo:record` records the three-minute scripted demonstration to ignored `.private/demo-recording/`.

The master plan defines acceptance. See `docs/evidence/build-status.md` for executed checks and unresolved gates. Automated fixtures do not establish operational emergency-response validity or competition eligibility.

## MiroFish preparation

Preparation is separate from the browser. See [UPSTREAM.md](UPSTREAM.md) for the pinned source, installation, actual integration outcome, and evidence. No test fixture is a substitute for verified LLM generation or an autonomous OASIS action.

The UI reports the loaded artifact's integration level. If no approved compatible artifact exists, deterministic reporting keeps the offline exercise usable and MiroFish remains explicitly blocked. A compatible artifact changes validated report timing, never physical needs or response capacities.

## Scope and attribution

This is an independent synthetic training prototype inspired by the supplied State Farm challenge and interface references. It is not an official State Farm service. No real household data, weather prediction, clinical triage, or operational dispatch is provided.

UI primitives are adapted from [shadcn/ui](https://github.com/shadcn-ui/ui). The captured source revision is `42f3bb63b46a69e52a24bd005cdc9ec15ba7a7b9`; its MIT license is retained in `docs/shadcn-LICENSE.md`. Import paths and application styling are customized. See `THIRD_PARTY_NOTICES.md` and `UPSTREAM.md` for MiroFish source and license obligations.

Project source is provided under AGPL-3.0 in `LICENSE`; third-party components retain their respective notices.
