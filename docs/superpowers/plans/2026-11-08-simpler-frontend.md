# Simpler setup and dashboard

Approved user plan, 8 November 2026. Implement on `feat/simpler-frontend`, based on initial app commit `543bb626c614f65327160d286e255e002d758e95`. PR #1 remains open; the follow-up PR targets `feat/initial-simulator`. No changes to main.

## Experience

- Three setup steps: Conditions (outage, roads, additional needs, Advanced seed), Resources (vans, kits, shelters), Review. Defaults prefilled; Back preserves choices; Continue validates fields inline; Start exercise opens paused.
- White/charcoal/red shadcn identity. One 56px header; compact toolbar and resources; map +352px contextual inspector. Desktop essentials fit1366x768 and1440x900 without page scroll. Minimum14px essential text/controls,12px map labels. No clipped or shrunken controls. Small/zoomed screens reflow and may scroll.
- One contextual action: Check home & run / Deliver kit & run / Send transport & run. Suggested fastest feasible assignment from public ObservationView, stable unit/shelter tie-breaks; editable choices preserve valid manual selection.
- Success resumes one clock; rejection stays paused. Selection, urgency, hidden tabs, and opening panels pause. Closing panels never resumes. Dispatch does not count as completed help.
- Delete repetitive instructional/mission prose. Keep short statuses, deadlines, accessibility, resident count, available/reserved resources and actionable blockers.
- Secondary native dialog drawers: Homes, Teams, Activity, Details, Exercise actions. Visible close, focus restore; Escape closes topmost layer before clearing home selection. Optional panel content can scroll.
- Results tabs Overview / Compare / Homes / Details. Overview has people helped, urgent help on time, undiscovered needs, final map. Compare preserves existing baseline table/chart. Homes has timeline; Details has accounting/settings/provenance.
- Preserve engine/APIs/artifact/run-file/replay/secrecy/accounting. Reuse prepared artifact, no model calls.

## Ownership and contracts

- Coordinator: src/App.tsx, src/styles.css, src/ui/Response.tsx, src/ui/SecondaryPanel.tsx, src/ui/TownMap.tsx, integrated tests/browser scripts/docs.
- Worker A: src/ui/Creator.tsx and src/ui/Results.tsx plus tests/wizard-results.test.tsx. Existing Creator and Results prop signatures stay unchanged. Internal wizard/tab state belongs in these components. Return class names and geometry needs; do not edit shared styles/App.
- Worker B: src/ui/HouseholdInspector.tsx and src/ui/suggestions.ts plus tests/suggestions.test.ts and tests/inspector.test.tsx. HouseholdInspector props: view:ObservationView, selected:string|null, unitId:string, shelterId:string, onUnit(id), onShelter(id), onDispatch(intent:CommandIntent), onDetails(), onClose(). Helpers exported: getPrimaryAction(home):Action|null; getSuggestedAssignment(view,householdId,action?,preferredUnitId?):CommandIntent|null; isAssignmentFeasible(view,intent):boolean; getBlockedReason(view,householdId,action,unitId,shelterId?):string|null. No engine truth accepted.
- Workers are not alone; preserve other edits. No Git operations by workers. No nested agents. Tests first for behavior; reviewer in freed slot.

## Verification

- Wizard field validation and retained Back choices, paused start, contextual unknown/known/busy/completed/shortage states.
- Suggestions respect resources/accessibility/routes/public knowledge and deterministic ties.
- One auto-run timer; selection/panels/urgency/tab-hidden pause. Focus restoration and Escape precedence.
- Golden H19 timeline8/16/24 and unchanged engine/replay fixtures.
- Desktop bounding boxes and document height at1366x768 and1440x900, all wizard steps and results tabs. Narrow/200% viewport reflow, minimum font sizes, map scene/legend alignment.
- Typecheck, full Vitest/Python, production build, browser workflow, bounded screenshot inspection/fix/confirmation, independent review, source/secret scan before PR push.

## Execution ledger

- Started with clean worktree on the verified initial-app commit. PR #1 remains open.
- Existing Impeccable context and design skills loaded in this session; read craft floor before UI edits. UI/UX Pro Max search applied as general guidance; existing React web platform and visual identity retained.

- Implemented all UI tasks; 66 Vitest tests, 8 Python tests and production build passed. Browser checks cover 26 desktop states, compact reflow, golden path and replay. Independent review findings fixed with regressions.
- Existing artifact remains accurately labelled gpt-4.1-mini; the later Terra request is handled in a separate change. No new preparation call in this UI PR.
