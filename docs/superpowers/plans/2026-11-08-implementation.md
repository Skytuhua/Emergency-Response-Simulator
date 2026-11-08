# Catastrophe Response Simulator Implementation Plan

> **For agentic workers:** Execute the supplied master plan in parallel with exclusive ownership and retain focused verification evidence.

**Goal:** A working local creator, response simulator, and reproducible debrief using shadcn/ui and supplied visual references.
**Architecture:** One Vite React application, pure deterministic TypeScript engine, Canvas rendering, separate pinned Python MiroFish preparation.
**Tech Stack:** React 19, TypeScript, Vite, shadcn/ui, Tailwind, Vitest, Python.
**Spec:** catastrophe-response-simulator-master-plan.md

## Global constraints

24 households; 60-minute horizon; three fixed representatives; no hidden-truth UI; atomic resources; deterministic replay; no fabricated MiroFish output; no provider calls without configured authorization and budget.

## Review focus

Unknown-household actions cannot reveal need type. Concurrent assignments cannot overbook. Final-minute events count. Invalid/stale imports preserve the current run. MiroFish provenance must distinguish actual autonomous actions from fallback and fixtures.

## Ownership and checks

- [x] Engine worker: shared model, scenario/content, routes, engine, observation, baseline/results; tests first for scenario bounds, golden H19 timeline, conservation, ordering and computed comparisons. Publish model contract first.
- [x] UI worker: App, main, ui/, map, styles. Customize supplied shadcn primitives. Implement all controls, pause semantics and keyboard selection; use only ObservationView live.
- [x] Integration worker: pinned vendor source, fixtures, Python tools/tests, artifact validation and UPSTREAM. No paid calls absent explicit budget and account authorization. Report honest integration level.
- [x] Coordinator: package/lock/config, run-file validation/replay tests then implementation, docs, saved demonstration, integration and final checks.
- [x] Independent reviewer: completed code security/correctness review after a worker slot frees. Fix findings and rerun affected checks.

Verify with npm run typecheck, npm test, npm run build and Python unittest. Package a documented local demo and executed golden response witness. Do not claim visual/offline/manual acceptance without execution.
