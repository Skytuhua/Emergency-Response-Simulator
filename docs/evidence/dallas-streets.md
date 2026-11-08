# Dallas street integration evidence

New immutable `storm-dallas-v1` uses real OpenStreetMap geometry, node topology, distances, one-way/access rules and supported via-node restrictions for routing and vehicle motion. Its homes, needs, shelters and outcomes are synthetic. Source and license details: `docs/DALLAS-MAP.md`.

- Frozen tagged source normalized deterministically to 235 nodes, 318 street segments, 1,491 geometry points and 17 turn restrictions. Raw and derived hashes are retained in the public source manifest; raw responses remain private.
- Independent review verified every retained geometry point against the source. A reproduced distinct-way U-turn defect was fixed in runtime and importer with RED/GREEN regressions and focused independent re-review; the prohibited 2-minute path now takes the required 4-minute detour.
- Closed actual street segments alter routes. Unreachable dispatch rejects without reserving resources. Engine and map use the same polyline position helper; idle Dallas vehicles retain their actual arrival positions.
- Legacy `storm-v1` serialization was identical across 48 tested combinations; old saved files and H19 8/16/24 remain supported. Dallas has distinct 6/12/21 authored witness timing.
- Separate genuine Dallas Terra-low artifact: three verified personas and three autonomous requests. Exact template/context/manifest identity prevents relabeling Riverdale evidence. Preparation total estimate $0.0472764 / $10; private credentials and raw provider envelopes excluded.
- Dallas replay/geometry/artifact tests pass; authored saved witness resolves six needs, with three urgent needs timely, three kits and nine shelter places. It is separate from the automatic policy's measured behavior.

Initial native map inspection found no horizontal overflow at 1696×1020, 1357×816 or 1131×680, but did not reproduce the user's cropped screenshot. The primary UI is being replaced by the user-requested automatic observation layout; final desktop acceptance belongs to that follow-up, not these earlier manual-flow captures. Further phone integration is deferred. No real traffic, emergency legality, population calibration, citywide scale or first-time human usability is established by these checks.
