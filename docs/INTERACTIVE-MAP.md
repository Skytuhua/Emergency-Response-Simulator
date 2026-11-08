# Interactive Dallas map

Dallas uses Leaflet 1.9.4 to display a detailed tiled basemap. Drag to pan, use the wheel or double click to zoom, or use the keyboard and labeled zoom buttons. **Fit simulation area** restores the supported area. The blue dashed rectangle and permanent label use `map.metadata.bounds`; the amber communications outage is a separate overlay. Looking outside the boundary does not add households, roads or simulation activity.

Map tiles supply visual context. The engine still routes on the frozen Dallas street graph, with its retained direction/access restrictions and synthetic travel policy. Homes, incidents, response units, shelters and the base remain exercise data. The view consumes only `ObservationView`; urgent flags require known facts, and undiscovered needs appear only in the finalized debrief.

The coordinate conversion in `src/ui/geographic.ts` inverts the importer's local equirectangular projection. It uses the map centre, origin latitude/longitude, earth radius and metres per unit. Import padding affects the original scale; it is not an extra x/y translation. Roads, routes and synthetic placements use the same inverse conversion before Leaflet's Web Mercator projection.

The Leaflet instance survives minute, selection, mission and cloned snapshot updates. A changed run ID, dataset/hash, bounds, projection or dimensions creates and fits a fresh map. ResizeObserver invalidates the map after layout changes without fitting or changing zoom. Layers, handlers, scheduled frames, tile timers and the map are removed during unmount and StrictMode remount. Dragging from a home pans without also selecting the home; keyboard activation remains available. Map keyboard events stay within the map instead of reaching the simulation's global Escape handler.

## Tile service and fallback

The default layer is `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, for modest human interactive demo use under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/). It uses normal browser image requests, Referer and caching. There is no cache bypass, prefetch, bulk download, offline tile download or automated live-service pan/zoom. Linked OpenStreetMap attribution stays visible below the map. The surrounding basemap may change independently of the frozen simulation dataset.

To use an appropriate alternative service, set `VITE_MAP_TILE_URL` to its HTTPS XYZ template before building and optionally `VITE_MAP_TILE_ATTRIBUTION` to the provider's required credit text. Attribution text is rendered as text, not HTML. Use a provider whose terms and zoom range support your deployment (the map currently uses zooms 10–19). These Vite settings are public client configuration; never put private credentials in them. No key is needed for the default service. For higher traffic or a controlled deployment, select a suitable tile provider.

If any tile fails, or a batch remains incomplete for eight seconds, a concise status explains that street tiles are unavailable or incomplete. The local retained-road vectors, household/facility/unit markers, routes, outage and simulation boundary remain interactive. The **Retry map tiles** action is explicit, with ordinary browser caching preserved. An actual completed tile-load batch restores the loaded status; a single successful tile cannot hide failed or hung siblings. Normal state ticks do not recreate or reload the tile layer.

## Verification

Run from this isolated checkout:

```text
npm ci
npm run typecheck
npm test
npm run build
npm run dev -- --port 4186 --strictPort
```

With the dev server running, in a second terminal:

```text
node tests/geographic-browser.mjs
```

`APP_URL` can select another local dev-server origin. The browser runner intercepts every OSM tile request with `tests/fixtures/map-tile.svg`, aborts requests for the offline case, and holds part of a later batch to verify the timeout/recovery case. Other external requests are denied and reported. **Do not remove interception to run automated tests against live OSM.**

The browser suite checks rendered DOM geometry against independently computed Web Mercator positions, including fit, dragging, zoom, resize, state persistence, home selection, keyboard isolation, mission movement and failure recovery. It also checks the real application's welcome and response maps at 1696×1020, 1366×768 and 1440×900, retaining control text size. Screenshots and a network receipt go to ignored `.private/map-browser/`.

The initial regression run on the parent canvas implementation failed three checks: missing tiled-map controls/lifecycle, and Escape reaching the global handler. Riverdale's legacy test remained green. The focused tests also compare every frozen node and road geometry vertex to its original latitude/longitude and distinguish the simulation bounds from the outage bounds.

Final local verification for this leaf: 109 tests across 19 files, typecheck, and production build passed. The build retains a large-chunk warning (about 765.5 kB uncompressed for the application JavaScript). The browser run intercepted 505 tile requests with zero live tile requests and no uncaught browser errors. Its six welcome/response layout receipts show no clipped map controls, no text below the checked 14px control size and no document overflow. Visual inspection also prompted a regression for fitting the simulation area at fractional zoom, avoiding an unnecessarily tiny supported area at shorter viewport heights. Tile retry re-adds the tile layer using the public API, avoiding Leaflet 1.9.4's fractional-zoom `redraw()` XYZ-level issue.

These tests establish local fixture behavior. They do not establish live-provider availability, live basemap cartographic appearance, hosted deployment behavior or user visual acceptance. A manual human live-map check remains useful before a public demo.

## Integration

This leaf is based on Dallas PR #5 (`feat/dallas-street-network`, prepared commit `8bfa4fa2bde8666c93c5ef0345e560fe6e4b5d60`). `TownMap` keeps its existing props and dispatches to the geographic view only for `osm-driving`; Riverdale keeps its schematic canvas. No engine, other frontend module, shared stylesheet or shared checkout is changed. The dependency manifests add only Leaflet and its types. Concurrent dependency edits may require regenerating `package-lock.json` after merging the manifest entries.
