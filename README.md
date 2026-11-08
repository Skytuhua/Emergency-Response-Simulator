# Catastrophe Response Simulator

Observe a fictional storm response on real Dallas streets. Residents report needs, an automatic coordinator assigns constrained teams, and assistance counts only when supplies arrive or transport reaches a shelter. The current default covers **24 fictional homes and 60 simulated minutes**.

## Run locally

Tested development runtime: Node 24.14.0 and npm 11.9.0 on Windows.

```powershell
npm ci
npm run build
npm run demo
```

Open http://127.0.0.1:4173. `demo` serves the production build with a strict port; use `npm run dev` for development. If needed, choose another port with `npm run demo -- --port 4175`. Fonts, approved resident output and map geometry are local. Playback makes no model calls.

## Observe a simulation

**Start simulation** begins the default Dallas response immediately. **Customize conditions** opens **Conditions → Resources → Review**. Defaults are seed 42, a southeast communications outage, open roads, two four-seat vans (V1 is accessible), one response crew, three kits and two shelters with eight places each.

Follow the prepared resident source flow, moving teams and read-only coordinator. The coordinator uses public reports and completed on-site checks, ranks feasible known urgent needs, and checks unreported homes. A resident's prepared context does not give the coordinator knowledge of an unreceived need. Assignment and boarding are distinct from completed assistance.

Selecting a home and receiving a new urgent report leave desktop playback running. Opening **Details**, a resident's **Full source & custody**, or another secondary panel pauses it; closing inspection leaves it paused. Below 1200px, selecting a home opens the focused Coordinator panel and pauses for inspection. Hiding the tab also pauses. Use **Pause / Resume**, **1× / 2× / 4×**, or **Advance one minute**; a one-minute advance pauses first. At 1×, one simulated minute takes two real seconds.

The **Exercise** panel contains import, export, restart, new simulation and **View outcomes**. View outcomes completes automatic coordination through minute 60. Results provide **Overview / Compare / Homes / Details** views, including completed help, timely urgent help, unchecked homes, resources and household timelines.

Export a run to JSON before reloading the page. Import validates and replays recorded decisions before replacing the active run, then opens paused. **Replay decisions** also stays paused. **Restart simulation / Restart same conditions** clears decisions and starts fresh automatic coordination with the same conditions. **New simulation / Edit conditions** returns to setup.

The actual prepared default automatic run completes **six needs for 15 people**, with **two of three urgent needs on time**. H19 completes at minute **36**, after its minute-30 deadline. The saved [Dallas witness](public/data/default-dallas-run.json) is separately authored: H19 check/pickup/completion occur at **6/12/21**. The retained [Riverdale witness](public/data/default-run.json) uses **8/16/24**. Neither witness is a measurement of the automatic coordinator.

## Verification

```powershell
npm run typecheck
npm test
npm run build
.venv-mirofish/Scripts/python.exe -m unittest discover -s tools/tests
.venv-mirofish/Scripts/python.exe -m unittest discover -s tests -p dallas_import_test.py
```

The Python preparation tests use the isolated environment described in [UPSTREAM.md](UPSTREAM.md) and make no provider calls. For browser checks or a demo recording, start the production preview and point the scripts at its origin:

```powershell
npx playwright install chromium
$env:APP_URL = 'http://127.0.0.1:4173'
npm run test:browser
npm run demo:record
```

See [automatic observation evidence](docs/evidence/automatic-observation.md) for the current check scope and prior native browser observations. Scripted checks and recordings do not establish first-time human comprehension or final user visual acceptance.

## Prepared residents and scope

The bundled [Dallas artifact](public/data/mirofish-dallas-v1.json) contains three actual `gpt-6.1-terra` low-reasoning profiles and three genuine autonomous MiroFish/OASIS posts, normalized into accepted requests. The other 21 homes follow reporting rules. Reports are prepared before playback; scheduling, routing, resources and completion are deterministic. The first autonomous round maps to minute 5 as an explicit exercise assumption, and an outage can block receipt.

Total preparation across Dallas, Riverdale Terra and the original `gpt-4.1-mini` episodes is **estimated $0.0472764 / $10**; this is a token-price estimate, not an invoice. Original [4.1-mini output](public/data/mirofish-4.1-mini-v1.json), its [saved run](public/data/default-run-4.1-mini-v1.json), and the separate [Riverdale Terra artifact](public/data/mirofish-v1.json) remain preserved. [UPSTREAM.md](UPSTREAM.md) records source pins, provenance, budget controls and preparation commands.

The current map uses frozen real OpenStreetMap streets and driving routes, with fictional residents, incidents, shelters and capacities. The separate interactive map with pan and zoom has not landed. Further mobile integration is deferred.

PR #6's population-grounded, six-hour Dallas design is the intended release specification; its runtime integration is **planned, not implemented** in this 24-home application. The four files under [the v2 scenario design](docs/scenarios/dallas-synthetic-v2/README.md) remain design records, not implemented population fit or calibration. Follow the [integrated Dallas implementation plan](docs/superpowers/plans/2026-11-08-integrated-dallas-v2.md) for the remaining work. A real four-of-five uncoached comprehension study has not been performed.

## Attribution

This independent synthetic training prototype is inspired by the supplied State Farm challenge and interface references. It is not an official State Farm service and provides no real household data, weather prediction, clinical triage or operational dispatch validation.

UI primitives are adapted from [shadcn/ui](https://github.com/shadcn-ui/ui), captured at `42f3bb63b46a69e52a24bd005cdc9ec15ba7a7b9`; the MIT license is retained in [docs/shadcn-LICENSE.md](docs/shadcn-LICENSE.md). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [UPSTREAM.md](UPSTREAM.md) and [Dallas map attribution](docs/DALLAS-MAP.md) for source and license obligations. Project source is provided under AGPL-3.0 in [LICENSE](LICENSE); third-party components retain their notices.
