# Expanded desktop interface evidence

The expanded Dallas observer is the default application. It loads 3,061 simulated homes and 5,306 residents for a 360-minute automatic simulation. The welcome screen offers default start, customization and saved-run import. Earlier saved runs open in an import-only compatibility view.

## Interface changes

The selected-home panel shows current simulated needs, the request outcome and the response. Needs not yet known to teams are labeled separately and are not sent to the coordinator. Optional source details distinguish a planned call or wait from recorded events. Call failure, receipt, an unexecuted plan, a skipped action and completed assistance remain separate states. A home with one completed need and another waiting need shows **Some help completed**.

Activity, waiting reasons, response approaches, errors and results use brief descriptions. Selected profile text, source records, identifiers and hashes remain inspectable in closed disclosures. Raw action payloads are not displayed. This is a presentation change: stored simulation records, source hashes, model output, event messages and replay identities are unchanged.

The map uses house outlines containing exact group counts. Zooming reveals smaller groups and individual homes; the renderer retains every home in the global group membership and reports viewport visibility separately. Neighboring groups merge to keep count digits readable. A selected home's position and ID remain exact within the simulated placement data. Group buttons open a keyboard-accessible member list. These positions are approximate simulated allocations, not real addresses.

Both map explanation rows and the dashboard footer were removed. OpenStreetMap credit remains visible in the legend. Map failures use a compact **Reload map** control. **Skip to the end** is in **Run options**. Confirmation dialogs fit their content. **Time elapsed** identifies the `00:42 / 06:00` display as duration since the scenario began.

## Historical checks before setup integration

The following observations refer to the earlier integrated observer and do not verify the subsequent onboarding, setup, base selection, road edits or resource controls.

The coordinator ran the complete unit/component suite after the integrated fixes: **40 files / 274 tests passed** on 2026-11-08. This includes legacy engine/run-file paths, expanded source admission, reservations, replay, timer behavior, stale asynchronous replay handling, truthful call states, partial completion, map grouping and dialog lifecycle. A previous broad run caught a stale lowercase tooltip expectation; that failure was retained and corrected before this passing run.

`npm run build` passed. Vite emitted a warning for the approximately 947 kB minified application chunk; no load-speed improvement is inferred from a successful build.

`node tools/browser-check.mjs` passed at **1366×768, 1440×900 and 1696×1020**. Each view had all five resident stages and its source button visible, no page scrolling or horizontal overflow, and a 14px minimum for the measured essential labels. Confirmation height was 213px. The script completed the actual expanded automatic run and exercised **Overview / Compare / Homes / Details**; its tab checks do not certify completed comparison values. It intercepted **105 map-tile requests locally**, with zero live tile requests, unexpected external requests or uncaught page errors. The public artifact loaded for that run contained six prepared profiles; later preparation admission is separate from this UI receipt.

The coordinator also inspected the native shared preview at 1696×1020 with actual OSM tiles, an advancing 3,061-home / 5,306-person simulation, plain call states and house-shaped counted markers. The map worker subsequently checked collision handling at all three desktop sizes using local fixture tiles. The live observation does not certify provider availability at another time, every zoom level, or user visual acceptance.

## Independent review

An independent reviewer passed 50 focused tests plus two separately authored counterexamples and fresh type checking. It found two issues, both corrected and rechecked: stale panels surviving a restart/import, and partial assistance being labeled fully completed. The reviewer approved the final scoped UI/controller/map changes, with no unresolved critical, high or medium finding. It inspected retained desktop screenshots; it did not independently run a live OSM or provider session.

The browser-check and recording entry points use the expanded observation flow with fixture tiles. The preserved legacy scripts are historical and are not an alternate main application entry point. Updating a script is not evidence that a new recording was produced or reviewed.

## Setup and limits

Customization stores a validated setup overlay with the run. The base snaps to a reachable street node within the tract boundary; road overrides and resource quantities affect the automatic engine. Road edits disable the prepared AI actions for that run and use the declared reporting rules. The default resource counts are adjustable exercise assumptions, not a measured Dallas allocation.

These checks do not establish an uncoached four-of-five participant result, a physical screen-reader/device session, validated emergency triage, disaster or behavior calibration, real resident reports, or citywide deployment. Mobile integration remains deferred. Source-supported population size and model-generated profiles do not establish predictive accuracy. The separate evaluation report records scale/performance measurements and their actual gates.
