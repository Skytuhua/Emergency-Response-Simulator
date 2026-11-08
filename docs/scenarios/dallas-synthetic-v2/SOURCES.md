# Sources, acquisition and claims register

Research date: 2026-11-08. These links and findings define acquisition work. This documentation package does not contain the source datasets or claim their successful ingestion. Preserve raw downloads, retrieval timestamps, hashes and source-specific reuse notices when implementing.

## Population and geography

| ID | Official source | Proposed use / boundary |
| --- | --- | --- |
| C1 | [2024 ACS five-year data](https://www.census.gov/data/developers/data-sets/acs-5year.html) | Freeze the 2020-2024 period and geography; no exact admitted counts yet |
| C2 | [TIGERweb ACS2024 service](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer?f=pjson) | Layer 8 tract polygons, January 1 2024 geography; choose full tracts, not a road-query rectangle |
| C3 | [ACS table-based Summary File](https://www.census.gov/programs-surveys/acs/data/summary-file.Getting_Started.html) | Official bulk-file alternative to credential-dependent API; select two tracts and retain estimates/MOEs/annotations |
| C4 | [ACS PUMS documentation](https://www.census.gov/programs-surveys/acs/microdata.html) | Whole-household/person donor records; PUMA support is coarser than tract support |
| C5 | [PUMS estimates and published estimates differ](https://www.census.gov/help/topics/faq.why-dont-the-acs-pums-file-estimates-match-data-census-gov.html) | Do not assume microdata weights reproduce each local control exactly |
| C6 | [ACS API examples and requirements](https://api.census.gov/data/2024/acs/acs5/examples.html) | Research found a key is required; missing-key HTTP 200 HTML must fail content validation |
| C7 | [ACS reliability and comparison guidance](https://www.census.gov/programs-surveys/acs/guidance/comparing-acs-data.html) | Retain MOEs; do not treat multi-year values as a single-year observation |

Reproducible candidate-geometry query used by the population research agent:

```text
https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/8/query?f=json&where=GEOID%20IN%20%28%2748113001502%27%2C%2748113002200%27%29&outFields=GEOID%2CNAME&returnGeometry=true&outSR=4326
```

The agent found a shared boundary and the combined bounds recorded in the design. Admission still requires retained geometry bytes, polygon validity, declared reference system, and an adjacency/coverage receipt. The existing frozen road snapshot remains separate evidence with its own hash and 2026 acquisition date.

Selected table groups; fetch metadata before selecting fields and universes:

| Table | Purpose | Limit |
| --- | --- | --- |
| [B11001](https://api.census.gov/data/2024/acs/acs5/groups/B11001.html) | Occupied-household target | Does not count group-quarter residents |
| [B11016](https://api.census.gov/data/2024/acs/acs5/groups/B11016.html) | Household type and size | Preserve 7+ tail with complete donor households |
| [B08201](https://api.census.gov/data/2024/acs/acs5/groups/B08201.html) | Household size and vehicles | Does not measure road access during a disaster |
| [B25008](https://api.census.gov/data/2024/acs/acs5/groups/B25008.html) | Population in occupied housing units | Reconcile person target separately from group quarters |
| [B01001](https://api.census.gov/data/2024/acs/acs5/groups/B01001.html) | Age and sex | Reconcile household-person universe before fitting |
| [B18101](https://api.census.gov/data/2024/acs/acs5/groups/B18101.html) | Disability by age/sex | Not a wheelchair, diagnosis, urgency, or consent classifier |
| [B16004](https://api.census.gov/data/2024/acs/acs5/groups/B16004.html) | Age and language/English ability | Population age five and older; no assignment to under-fives |
| [B25024](https://api.census.gov/data/2024/acs/acs5/groups/B25024.html) | Building-unit distribution | Does not identify actual occupied apartments or capacity at a map point |

The no-key request returned a missing-key HTML page, not a usable demographic snapshot. No Census secret was requested or accessed. During implementation, prefer bulk files or an authorized secret channel; never include credentials in manifests, URLs retained publicly, or PR bodies.

## Hazard, roads and response

| ID | Primary source | What it supports / does not support |
| --- | --- | --- |
| H1 | [NOAA Southern Plains update, Aug 29 2022](https://www.drought.gov/drought-status-updates/southern-plains-drought-status-update-8-29-22) | Context for Aug 21-22 flooding and location-specific rainfall; not uniform rainfall across the map |
| H2 | [Dallas 2024-2029 Hazard Mitigation Plan](https://dallas.gov/departments/officeemergencymanagement/DCH%20Documents/2024-2029%20City%20of%20Dallas%20HMP%20-%20For%20Public%20Release.pdf) | Local historical hazard context, including East Dallas flooding; no acquired property-by-property impact tape |
| H3 | [Dallas Aug 22 2022 high-water notice](https://www.dallascitynews.net/residents-are-encouraged-to-be-aware-of-high-water-conditions) | City report of flooding, crews and reporting channels; not a complete time-stamped mission dataset |
| H4 | [NCEI event 1053520](https://www.ncei.noaa.gov/stormevents/eventdetails.jsp?id=1053520) | Balch Springs event, not this Old East Dallas tract pair; episode/county totals cannot calibrate local household impacts |
| H5 | [USGS station 08057200](https://waterdata.usgs.gov/tx/nwis/uv/?site_no=08057200) | Gauge record inventory; stage/discharge can contextualize an event, not infer water depth at each house |
| H6 | [NOAA MRMS](https://mrms.nssl.noaa.gov/) | Candidate historical precipitation archive; specific frames and coverage not acquired here |
| H7 | [NWS flood safety](https://www.weather.gov/safety/flood-turn-around-dont-drown) | Ordinary road travel must not be modeled as freely crossing a declared flooded segment |
| R1 | [OpenStreetMap attribution and license](https://www.openstreetmap.org/copyright) | Street-source attribution/ODbL obligations; OSM does not establish live incident closures or travel times |

NCEI event timestamps may explicitly be `CST-6` even in August. Parse the stated UTC offset; do not silently reinterpret it as daylight time. For the synthetic analogue clock, use the declared America/Chicago offset for the chosen date.

No verified public dataset containing the complete local chain of household needs, reports, dispatch times, fleets, closures and shelter intake was obtained. Such data are a gate for response calibration. Rainfall alone cannot validate need incidence or response quality.

## Methods and authoring evidence

| ID | Source | Use |
| --- | --- | --- |
| M1 | [A National Synthetic Populations Dataset for the United States](https://pmc.ncbi.nlm.nih.gov/articles/PMC11762717/) | Primary research example of ACS/microdata population synthesis; design uses the general fit/sample approach, not bundled third-party synthetic records |
| M2 | [ODD protocol update](https://www.jasss.org/23/2/7.html) | Document entities, state, timing, initialization, submodels and purpose for reproducible simulation |

Inspect this repository's `UPSTREAM.md`, existing source manifests, and provider receipts before paid preparation. This design makes no new model availability, pricing or spending claim. The $10 cumulative limit is user-provided; actual remaining allowance must come from the live locked ledger.

## Required source receipt

Each input needs: source ID; exact public URL without secret; source release/reference period; geographic/temporal support; retrieval time; raw SHA-256 and byte count; parser version; included variables/units; missing-value rules; license/attribution; processing steps; output hash; and status (`research-only`, `downloaded`, `admitted`, `rejected`). A source may be suitable for context while rejected for local numerical calibration.

Record model-generated or authored assumptions separately from public observations. Local names, vivid biographies, a high household count, and stable playback do not upgrade a source's evidence status.
