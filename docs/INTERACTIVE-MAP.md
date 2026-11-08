# Interactive Dallas map

Last updated: 2026-11-08.

The expanded observer uses Leaflet 1.9.4 for a real OpenStreetMap basemap. Drag to pan; use the wheel, double click, labeled buttons or keyboard to zoom. **Fit simulation area** fits the actual tract boundary. High-contrast tract outlines identify the expanded simulation's resident area. The surrounding 500 m routing buffer adds street context, not households. The earlier Dallas v1 view uses its rectangular supported boundary; Riverdale retains the schematic canvas.

The engine routes on the separately frozen Dallas street graph. Tiles supply visual context. The expanded database retains 1,313 nodes, 1,828 edges and 68 turn restrictions, with its source profile and a synthetic 12 km/h travel assumption. Simulated closures change routes or interrupt travel. The basemap can change independently of the frozen dataset. Home locations, residents, incidents, facilities and response resources are simulated. [Expanded runtime evidence](evidence/dallas-expanded-runtime.md) explains their source support and limits.

## Homes and map space

Counted groups use house-shaped markers with the household count inside. Zooming closer allows finer groups and reveals individual homes as their markers become readable. Screen-space aggregation merges overlapping neighboring groups to keep counts readable; off-screen markers are not rendered. The full population remains fixed when zooming or panning. Selecting a group opens a named, keyboard-accessible member list. The selected home retains its exact simulated position and original ID. Coincident placements remain available through the group or **Find a home** list.

Clustering consumes public observations only. Unknown homes retain unknown needs; a count is not a count of people known to need help. Color and labels use received information and completed assistance. The selected-home outline, accessible labels and group member list support inspection without relying on color alone.

The loaded-map status row, long supported-area strip and dashboard footer have been removed to give the map more room. The legend has its own row and keeps linked **© OpenStreetMap contributors** visible. Technical source details remain under **Sources**. A failure message appears only when tiles are unavailable or incomplete.

Setup also allows choosing a base inside the tract boundary and editing road segments. The selected base is snapped to a reachable street node and its actual location is shown. User-selected road overrides last for the run and affect engine routes; they do not alter the frozen source database.

## Coordinates and view state

The coordinate conversion in `src/ui/geographic.ts` inverts the importer's local equirectangular projection using its origin latitude/longitude, earth radius and metres per unit. Import padding affects the original scale; it is not an added x/y translation. Roads, route positions and simulated homes use this same inverse conversion before Leaflet's Web Mercator projection.

The Leaflet instance survives ordinary time, selection, mission and cloned-observation updates. Geographic identity or boundary changes recreate it. V2 uses a stable map identity across state updates, while viewport callbacks report actual zoom and bounds for aggregation. ResizeObserver invalidates map size without fitting or changing the user's view. Unmount removes layers, handlers, scheduled frames and tile timers. Dragging from a home pans without selecting it; keyboard activation remains available. Map keyboard handling prevents a map Escape event from clearing a household selection behind the map.

## Tile service and fallback

The default tile template is `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. It needs no API key and is intended here for modest human interactive demo use under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/). It uses ordinary browser image requests, Referer and caching. The application does not bypass caches, prefetch, bulk-download or archive tiles offline. Automated tests intercept tile requests instead of using the live service. Higher-traffic deployment needs an appropriate provider and its terms reviewed.

An alternative provider can be configured with an HTTPS XYZ `VITE_MAP_TILE_URL` before building and optional `VITE_MAP_TILE_ATTRIBUTION`. Attribution is rendered as text. The current map zoom range is 10 through 19. These Vite settings are public client configuration; private credentials do not belong in them. Retain the provider's required credit and the OSM data notice where applicable.

If a tile fails or a batch remains incomplete for eight seconds, a compact status offers **Reload map**. Local retained roads, homes, facilities, team positions, routes and the boundary remain interactive. The earlier v1 outage overlay also remains available. Recovery requires a completed tile-load batch; one successful tile cannot hide failed or hung siblings. Ordinary simulation ticks do not recreate or reload the tile layer. Reload uses the public Leaflet API and preserves normal browser caching.

## Verification

With dependencies installed and a local dev preview running:

```powershell
npm run typecheck
npm test -- --maxWorkers=1
npm run build
$env:APP_URL = 'http://127.0.0.1:43183'
node tests/geographic-browser.mjs
npm run test:browser
```

`tests/geographic-browser.mjs` covers the geographic renderer. The expanded browser check is the default `npm run test:browser` flow. Both use the existing local preview selected by `APP_URL`; neither starts an external map service. Legacy scripts remain for historical testing, not as an alternate main application entry point.

Every OSM tile request is intercepted with `tests/fixtures/map-tile.svg`, aborted for offline cases, or held for timeout/recovery cases. Other external requests are denied and reported. Keep this interception in automated runs.

Historical expanded-map fixture checks at 1696?1020, 1366?768 and 1440?900 covered house-shaped counts, zoom detail, home membership, group activation, focus return, viewport preservation and document overflow before the current setup integration. [Interface evidence](evidence/expanded-interface.md) records the evidence scope.

The original PR #7 map leaf separately passed 109 local tests, typecheck and build, with 505 intercepted tile requests and zero live tile requests. Those counts describe that historical leaf, not the current expanded integration. Its regression for fitting at fractional zoom and its explicit tile-layer reload remain preserved.

Fixture tests establish local geometry, interaction and failure behavior. They do not establish live-provider availability, hosted behavior, current street access or user visual acceptance. The parent has separately observed a native live OSM render; a real user review remains distinct. No mobile-integration completion is claimed.

## Integration and licenses

`TownMap` keeps schematic mode and dispatches `osm-driving` maps to the geographic renderer. Optional viewport, boundary-ring, household-count, label and summary props support v2 without widening the legacy engine's observation API. `MapV2` adapts its explicit public coordinator view to those display props; hidden incident truth does not enter clustering.

The approved map leaf was based on Dallas PR #5 at `8bfa4fa2bde8666c93c5ef0345e560fe6e4b5d60` and integrated into the current release work. Leaflet and its types are additive dependencies. See the [Leaflet license](LEAFLET-LICENSE.txt), [earlier OSM data notice](../fixtures/maps/LICENSE.md), [expanded data notice](../fixtures/v2/sources/LICENSE.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).
