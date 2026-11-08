# Automatic observation evidence

**Last updated:** 2026-11-08

This note covers the automatic-observation working changes on `feat/automatic-observation`, based on `8bfa4fa`. It describes the current 24-home, 60-minute application. It does not establish completion of the [integrated Dallas v2 release plan](../superpowers/plans/2026-11-08-integrated-dallas-v2.md).

## Current behavior and source

| Area | Source | Current behavior |
| --- | --- | --- |
| Setup and lifecycle | [`App.tsx`](../../src/App.tsx), [`Creator.tsx`](../../src/ui/Creator.tsx) | Dallas defaults; direct Start or optional Conditions / Resources / Review. Fresh start and restart initialize automatic coordination and start playback. |
| Coordinator | [`automatic.ts`](../../src/sim/automatic.ts), [`observe.ts`](../../src/sim/observe.ts) | Decisions consume public observation, prioritize feasible known urgent needs and check unreported homes. Each reservation is followed by a fresh observation. Physical needs remain separate from received knowledge. |
| Observation | [`Simulation.tsx`](../../src/ui/Simulation.tsx), [`ObservationInspector.tsx`](../../src/ui/ObservationInspector.tsx) | Read-only homes, teams, requests and waiting reasons. Desktop home selection and newly discovered urgency do not pause. Secondary panels, source disclosure and hidden tabs pause; closing inspection does not resume. Compact home selection opens Coordinator inspection and pauses. |
| Resident evidence | [`PersonaFlow.tsx`](../../src/ui/PersonaFlow.tsx) | Prepared persona → stored request → receipt or blocked attempt → assignment → completed assistance. Full retained source is inspectable. Persona context and coordinator knowledge are distinguished. |
| Results | [`Results.tsx`](../../src/ui/Results.tsx) | Overview / Compare / Homes / Details; completed help, timely urgent help, waiting people, unchecked homes, final resources and household event timelines. Boarding is not completion. |
| Persistence | [`run-file.ts`](../../src/run-file.ts) | Validates and replays recorded decisions before installation. Import and replay remain paused. Restart clears decisions and resumes fresh automatic coordination. Playback and replay make no model calls. |

At 1×, the clock advances one simulated minute per two real seconds. One-minute advance pauses first. View outcomes continues automatic coordination to the minute-60 cutoff. An unsaved run is lost on page reload.

## Prepared input and measured outcome

The current default is `storm-dallas-v1`, seed 42, 24 fictional homes, two vans, one crew, three kits, two eight-place shelters and a southeast communications outage. Real Dallas OpenStreetMap geometry is frozen locally. Homes, needs, resource capacities and travel-time assumptions are synthetic. The separate interactive pan/zoom map leaf has not landed.

[`mirofish-dallas-v1.json`](../../public/data/mirofish-dallas-v1.json) contains three actual Terra-low model profiles and three genuine autonomous posts from pinned MiroFish/OASIS, accepted as structured requests for H02, H09 and H19. The remaining 21 homes use reporting rules. An accepted first-round request attempts receipt at minute 5 by exercise assumption; communications can prevent receipt, while an on-site assessment can independently establish public facts. Preparation does not make the runtime coordinator an LLM policy.

The parent coordinator reports the actual default automatic outcome as **6 of 6 needs completed, 15 people helped, 2 of 3 urgent needs timely, zero people still waiting and six homes unchecked**. H19 completes at minute **36**, after deadline **30**. The prior native browser report below also records those visible outcomes; this documentation update did not rerun the simulation.

| Retained evidence | Meaning | H19 timing |
| --- | --- | --- |
| Current automatic default | Actual deterministic coordination, including its late urgent completion | Completion 36 |
| [`default-dallas-run.json`](../../public/data/default-dallas-run.json) | Separately authored Dallas engine/replay witness | Check 6, pickup 12, completion 21 |
| [`default-run.json`](../../public/data/default-run.json) | Retained Riverdale Terra engine/replay witness | Check 8, pickup 16, completion 24 |
| [`default-run-4.1-mini-v1.json`](../../public/data/default-run-4.1-mini-v1.json) | Original saved run with its original model artifact | Preserved under original identity |

The Dallas witness's timely result must not replace the automatic outcome in demonstrations or claims. The Riverdale Terra and original 4.1-mini artifacts are preserved separately. Total preparation is **estimated $0.0472764 against the $10 cumulative cap**, including all three preparation families. This is a conservative token-price estimate, not an account invoice. See [UPSTREAM.md](../../UPSTREAM.md) for exact identity, retained receipts and budget boundaries.

## Validation and evidence custody

The parent coordinator personally ran these checks for the working integration. They are parent-run results, not tests independently executed by the documentation author. The full TypeScript suite and production build below were rerun after the command-cap replay correction:

| Check | Reported result |
| --- | --- |
| `npm test` | 148 tests passed across 22 suites |
| `npm run build` | Passed |
| Targeted policy/controller suites and `npm run typecheck` after the cap correction | 20 tests and typecheck passed |
| `.venv-mirofish/Scripts/python.exe -m unittest discover -s tools/tests` | 52 preparation/adapter tests passed; no provider calls |
| `.venv-mirofish/Scripts/python.exe -m unittest discover -s tests -p dallas_import_test.py` | 6 importer tests passed |

Independent review found a rare command-cap status event that did not survive replay. The parent reproduced the failing regression, changed the visible blockage status to derive from retained command metadata instead of a wrapper-only event, and verified exact event-history equality after export/parse/replay at the 500-command boundary. The targeted and full checks above passed after that correction.

Relevant retained regressions include [`automatic.test.ts`](../../tests/automatic.test.ts), [`ui.test.tsx`](../../tests/ui.test.tsx), [`observation-ui.test.tsx`](../../tests/observation-ui.test.tsx), [`persona-flow.test.tsx`](../../tests/persona-flow.test.tsx) and [`results-ui.test.tsx`](../../tests/results-ui.test.tsx). They cover public-only decisions, resource conservation, minute-60 boundaries, deterministic replay, automatic lifecycle, inspection pause behavior, source custody and completed-assistance presentation. Coverage here is a description of inspected tests, not independent approval of author changes.

The ignored `.private/observation-desktop-report.md` records **prior native T3 Preview observations** on the automatic UI, including visible screenshots and live geometry at 1366×768, 1440×900, 1696×1020, 1072×1258 and 732×1330. It records 14px essential simulation/persona text, 12px map labels, equal document/viewport widths, accessible focused Residents/Coordinator panels, keyboard pause/focus restoration, moving teams, H19 completion at 36, and the visible default outcome above. These observations preceded this documentation update; they are not a newly executed browser pass or final user visual acceptance. Private captures remain under the report's listed T3 browser-artifact paths.

Browser and recording scripts are being updated for the automatic flow. Run them against an explicitly selected production preview origin:

```powershell
npm run build
npm run demo
# In another shell:
$env:APP_URL = 'http://127.0.0.1:4173'
npm run test:browser
npm run demo:record
```

Install Chromium with `npx playwright install chromium` if needed. This note makes no fresh browser-script or recording success claim until their final receipts are delivered. Earlier manual-dispatch screenshots, recordings and counts in other evidence notes remain historical.

## Remaining release work

The four files in [`docs/scenarios/dallas-synthetic-v2/`](../scenarios/dallas-synthetic-v2/README.md), originally introduced at `a276a09b81e94968d7b53ae173a67b3df9aaa75b`, are preserved design records. PR #6's population-grounded, 360-minute Dallas scenario is the intended release specification. Its population fit, expanded assets, v2 mechanics/policies, behavior admission, replay and observer integration are **planned, not implemented** in the current runtime. The [implementation plan](../superpowers/plans/2026-11-08-integrated-dallas-v2.md) states the dependencies and admission gates.

The separate interactive map leaf, further phone integration, a real four-of-five uncoached comprehension study, population/behavior calibration, operational emergency-response validity and final user visual acceptance are not established by this evidence. No new provider call or source acquisition was performed for this documentation update.
