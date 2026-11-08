# Expanded Dallas runtime and source evidence

Last updated: 2026-11-08. This describes the local integrated application and admitted data. Public PR checks, native observations and human review are separate evidence.

## What is implemented

The default application loads `public/data/dallas-v2-scenario.json`: **3,061 simulated households, 5,306 residents and 360 minutes**. The welcome screen offers default start, optional setup, and saved-run import. The original run parser and an import-only compatibility view remain available for earlier files; the earlier application is not a main navigation choice. Users control playback and inspect evidence while coordination remains automatic.

The current expanded bundle contains **24 source-verified Terra-low resident profiles and 47 admitted prepared actions**. One invalid actor-local action was rejected without retry. Other households follow declared reporting rules. [UPSTREAM.md](../../UPSTREAM.md) separates the expanded preparation from the earlier Dallas, Riverdale Terra and original 4.1-mini episodes.

The selected-home view shows current simulated needs, the request outcome, and response status. Needs not yet known to response teams are identified separately and are not sent to the coordinator. Optional source details distinguish planned actions from recorded outcomes. A prepared action is not a received call. Assignment, a finished check or boarding is not completed assistance. A household with one completed need and another waiting need remains partially helped. Source panels retain identifiers, hashes and selected source evidence under closed technical disclosures; raw action payloads are not displayed. Hash consistency does not authenticate a provider.

## Population and geography

The population covers the complete adjacent tracts below. Both are within the admitted Texas PUMA `02313` geography.

| Census tract | Occupied households | People in those households |
| --- | ---: | ---: |
| `48113001502` | 1,284 | 2,329 |
| `48113002200` | 1,777 | 2,977 |
| Total | 3,061 | 5,306 |

The [source receipts](../../fixtures/v2/sources/source-receipts-v2.json) identify 18 public Census/OSM acquisitions by URL, vintage, retrieval time, bytes and raw hash. The [data manifest](../../fixtures/v2/sources/data-assets-v2.json) binds the normalized assets. Raw state/national files and donor serial-number custody remain private; the public fixtures contain normalized source information and simulated records.

ACS 2020-2024 tables B11001, B11016 and B08201 describe households; B25008 describes people in occupied housing. Their totals have different survey uncertainty and are not forced into an impossible exact fit. The fitter makes household and occupied-person totals exact, while retaining 84 measures with their margins of error, achieved values and residuals. The declared secondary tolerance is 2 percentage points for supported major measures or 2 units for rare cells; the largest absolute retained residual is 45 units. A published survey zero can use the declared rare-cell tolerance. These values are documented in the [fit receipt](../../fixtures/v2/population/fit-receipt-v2.json), not hidden by a generic fit label.

Occupied housing donors require `RT=H`, `STATE=48`, `PUMA=02313`, `TYPEHUGQ=1`, positive household weight and a positive household size. String `STATE/SERIALNO` joins and unique person-order values preserve whole membership. Person weights are diagnostic; household weights drive donor sampling. The selected population retains two 7-person and two 9-person households. Member traits and correlations come from whole public-use donors; tract-level disability, language, age or other relationships have not been independently calibrated.

The excluded group-quarters estimate is **187**, derived from ACS total population minus occupied-housing persons. It is an uncertain difference across tables, not a known count of excluded real residents.

The exact tract union has a **500 m** routing buffer. Its geometry is stored in EPSG:4326 and checked in metric EPSG:32614; the admitted tracts share a boundary without an uncovered gap. The buffer adds routing context, not residents.

Home placement uses 2020 Census housing-unit weights in 75 positive-housing blocks. It produces 3,061 distinct simulated unit IDs and coordinates linked to 192 admitted road access nodes. The largest modeled access distance is 166.47 m. These are approximate positions inside admitted tract/block geometry. Block weights do not verify current buildings, addresses, occupancy or driveway access. See the [placement receipt](../../fixtures/v2/population/placement-receipt-v2.json) and [geometry admission](../../fixtures/v2/geography/geometry-admission-v2.json).

## Streets used by the engine

The expanded road database contains **1,313 nodes, 1,828 edges and 68 turn restrictions**. It comes from the retained OpenStreetMap snapshot dated `2026-11-08T12:12:21Z`. Its public local motorcar profile excludes motorways, service/restricted ways, unsupported conditional/via-way restrictions and disconnected components. The source is real street data; it is not a current emergency-access survey.

The v2 importer also fails closed when component reduction would remove the target of an applicable only-turn restriction. The correction removes the affected incoming way and recomputes until stable. The [correction receipt](../../fixtures/v2/maps/restriction-correction-v2.json) preserves the forbidden-U-turn counterexample and 576 unchanged access/facility routing witnesses. Earlier v1 assets remain unchanged.

Routes use this frozen graph, its direction rules, incoming turn state and known road closures. Movement follows actual route positions. A closure can require a new route, block a mission or strand a team on its current edge. Travel uses a declared constant **12 km/h** assumption. It contains no live traffic, measured response delay or emergency road exemptions. Standard OSM tiles supply visual context separately; their availability does not determine engine routes. See [interactive map behavior](../INTERACTIVE-MAP.md).

| Normalized asset | Canonical SHA-256 |
| --- | --- |
| Road graph | `2de02d74b4adbac80363fbf038ea58f0b66f13c66692be133a50a18e2d339132` |
| Population | `7636315e146817ad04c70f8ef93ceda387d84f6b4a8f56ffd5844310644bf83b` |
| Geography | `bbe359084e5d18177fd540d17a1b5c7af5ee2ba51d0547c8cfa7fad14bb49581` |
| Facilities | `8b0fb288c976eb30acb050bf3c07e91361876a4ca858dc20e1a73db0357e721e` |

## Simulated events and response

The reference seed is `20261108`. Its recipe gives **306 homes** a need, with onset counts 123/122/61 at minutes 0/60/120. There are 92 urgent needs and equal 153/153 delivery/transport needs. Urgent deadlines are 90 minutes after onset; other targets are 180 minutes after onset. These are scenario assumptions. The 2022 Dallas flood supplies context, not a calibrated hydraulic or historical incident replay.

A spatial phone-network loss initially affects 612 homes, with halves restored at minutes 120 and 240. The road-closure mask selects about 5% of retained centerline length, excludes modeled staging approaches near facilities, changes at minutes 0/30/120 and is announced at 0/90/150. Partial reopening occurs at minute 240. The spatial masks do not depend on hidden need assignment. Background reporting covers 80% of need households, begins 20 minutes after onset and retries every 30 minutes. Ten percent of relocation households are assigned one accessible-place requirement independently as a support assumption; this is not inferred from donor disability or persona text.

The default setup has four check/delivery crews, four six-place vans, two included accessible places across two vans, 250 household supply bundles and 300 shelter places. These adjustable exercise capacities are not a measured or calibrated Dallas allocation. A crew carries at most one bundle and loads for two minutes at the base. Check, delivery, boarding and drop-off each take ten minutes. Whole households must fit an appropriate van and shelter reservation; the engine does not split large households. Stranded-team rescue is unsupported. Passengers, carried supplies and reservations remain accounted for when work is interrupted.

The automatic coordinator receives a public observation, never the hidden event tape. It can prioritize a known need or check an unreported home. Feasible assignments respect capabilities, accessible places, routes, current reservations and known facility state, with stable ties. The three policy choices are **First requests first**, **Most urgent first**, and **Urgent needs and home checks**. The last reserves 25% of eligible check capacity for coverage by default. More checks can trade off against known urgent work; no policy is presented as universally better.

Custom base placement and resource changes are stored as a validated setup overlay. A chosen point and its snapped, reachable street node must both lie within the actual tract union. Road overrides last through the run and change the event tape without altering the admitted source assets. Any road override disables use of the prepared behavior artifact for that run, with reporting rules used instead; the original artifact is not rebound.

The model-generated resident layer is prepared before playback. It can choose a report or wait only within a frozen local context. Reports can be blocked; context mismatch and completed-help suppression retain explicit records. Actual routing, resource reservations and assistance completion are engine outcomes. Persona biography, age and profession do not become priority rules.

## Save, import and evidence identity

Expanded saved runs embed the admitted assets once, validated user setup when present, the commands, public decision evidence, lineage and final state/trace/summary digests. The v2 parser bounds files at 32 MiB, commands at 20,000, trace events at 100,000 and ancestry at 32 hops. Source hashes and supported engine/recipe identity are checked. An imported run replays the recorded commands and verifies their outcomes and public observations without rerunning a newer automatic policy or calling a provider. A fresh local playback identity preserves the source lineage; imported runs open paused.

Same-time command transitions, fractional arrivals, resource accounting and stranded movement are covered by the replay regressions. The original v1 run format and separately authored H19 witnesses remain distinct. Riverdale's 8/16/24-minute path and Dallas v1's 6/12/21-minute path are engine-regression witnesses, not expanded response measurements.

## Evidence scope and remaining limits

The completed baseline experiment contains 90 background-rule runs across 30 paired seeds with the same source inputs within each policy comparison. It uses **no prepared AI artifact**. Its paired results describe simulation tradeoffs, including fewer people helped and fewer urgent needs helped on time under coverage than under urgency-first in this experiment; they do not establish improvement or real-world confidence. The separate prepared reference run must be identified by its actual admitted actor count. [Evaluation evidence](dallas-v2-evaluation.md) records the completed cases, retained failures and known metric caveats.

Serial performance and sensitivity measurements are separate release evidence. The recorded 1,000-household minute-processing p95 missed the proposed 100 ms target; a full performance pass is not claimed. The 10,000-household source-admission gate has **zero executed trials**, because only 3,061 distinct supported households are admitted. Unsupported scale is not filled by copying home locations.

Historical local unit/component, build and three-size fixture browser results are recorded in [interface evidence](expanded-interface.md); those results predate the current setup integration. This document itself was checked against code and fixtures; its author did not run a fresh live model test, rescan the full raw source corpus or recruit participants. Native live-map observation, hosted deployment, user visual acceptance, accessibility device testing and an uncoached four-of-five comprehension study remain separately reportable. Population matching does not validate hazards, resident behavior, triage, operational response or citywide deployment.
