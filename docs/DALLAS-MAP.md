# Dallas map and routing

The default Dallas exercise uses a frozen OpenStreetMap street extract around Old East Dallas and Swiss Avenue: south 32.788, west −96.784, north 32.800, east −96.764. It is a bounded training area, not a citywide Dallas service. Twenty-four synthetic households, two demo shelters and a demo response base are placed on actual street nodes. Labels such as “Demo home H19 on Josephine Street” do not identify real residents or claim that an incident occurred there.

The same retained street edges drive the displayed geometry, shortest paths and vehicle movement. The database contains 235 routing nodes, 318 segments, 1,491 geometry points and 17 retained turn restrictions. Distances follow OSM polylines; the exercise assumes a constant 12 km/h storm travel speed. It sums integer milliseconds and rounds each route up once to whole exercise minutes. These are modeled exercise travel times, without live traffic or current road-condition verification.

Routing respects supported one-way directions, public motor-vehicle access and via-node turn restrictions. Private/service/motorway and unsupported conditional/restriction cases are excluded conservatively. The closure preset closes an actual retained segment and changes routes; disconnected destinations reject dispatch without reserving resources. Routes stay within the retained component, so a route outside the demo boundary is not considered.

## Free source and usage

The data was obtained with two small, one-time [Overpass API](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) queries; the second retained node tags for barrier/access filtering. The operator's guideline is approximately 10,000 requests and 1 GB daily, with load shedding and no guaranteed availability. The browser does not depend on a public Overpass backend: it uses the frozen local extract and local routing.

No map tiles are scraped or bundled. The [OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/) prohibits bulk/offline tile downloads and requires caching, identification and attribution for normal tile use. Rendering the licensed street database locally avoids tile-service quotas and keeps the exercise usable offline. A future live data service would need its own sustainable provider or hosting.

The derived database remains [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), with visible [OpenStreetMap contributor attribution](https://www.openstreetmap.org/copyright) on the map. The source manifest records the exact query, endpoint, source timestamp, raw SHA-256, exclusions, projection, geometry and modeled travel policy. See `fixtures/maps/LICENSE.md` and the [OSMF attribution guidance](https://osmfoundation.org/wiki/Attribution_Guidelines).

## Reproduction and replay

```powershell
python tools/import_dallas.py --source .private/dallas-osm-source-tagged.json
python -m unittest discover -s tests -p dallas_import_test.py
npx vitest run tests/dallas-data.test.ts tests/dallas-routes.test.ts tests/dallas-scenario.test.ts
```

Importing the retained raw response is deterministic and makes no network request. A new data refresh must receive a new dataset/template version; silently replacing the frozen graph would invalidate saved runs. The original `storm-v1` grid, saved files and H19 8/16/24 path remain supported. Dallas has its own scenario and preparation contract; Riverdale model output cannot be injected into it.

The existing 1 MiB run-file and 5,000-item array limits remain. A 500-command Dallas export with long valid identifiers measured 802,582 pretty-printed bytes before model evidence; the bundled artifact is also tested against the same limit. These checks concern this local prototype, not production dispatch legality or operational readiness.
