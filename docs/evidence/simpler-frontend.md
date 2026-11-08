# Simpler frontend verification

Approved three-step setup and viewport dashboard implemented on a follow-up branch from initial app 543bb626. Simulation APIs, engine, prepared artifact and run-file formats are unchanged.

- Vitest:66 tests passed across 11files. Python: 8tests passed. TypeScript and production build passed.
- Production Chromium:26 desktop states passed at 1366×768 and 1440×900. Document height stays within viewport, essential controls are at least 14px, map IDs at least 12px, and legend does not cover labels.
- Wizard Conditions/Resources/Review, unknown/urgent/assigned/helped homes, shortages and every Results tab fit without page scrolling.
- Golden H19 assessment/pickup/drop-off 8/16/24 preserved; successful dispatch starts playback, selection/drawers/urgency/tab-hide/Escape pause, and closing drawers does not resume.
- Minute 17 export/replay, invalid-import preservation, native dialog Escape/focus return, editable suggestions, and zero external runtime requests passed. No browser runtime errors.
- Compact reflow checked at 683×384 and 390×844; one accessible inspector is mounted. Toolbar hit-testing verifies wrapped controls are not covered by the next section. These CSS viewport checks are distinct from physical display/browser-zoom acceptance.
- Independent code and visual reviews identified and prompted fixes for compact duplicate inspector IDs, unintended normalization pauses, Escape not pausing, and wrapped toolbar overlap. Focused regressions and browser assertions passed after fixes.
- A 182.4-second recording from the production app completes all 6 needs and demonstrates automatic playback; local path `.private/demo-recording/simpler-response-demo.webm`.
- Mechanical design detector warnings about 3px tab/header underlines are false positives for rounded-card border accents; the underlines indicate active navigation, not decoration on cards.

Private screenshots, browser receipts, recordings and credentials remain excluded. User visual acceptance and physical presentation-laptop / 200% browser zoom rehearsal are not claimed.

The bundled MiroFish artifact in this UI revision remains actual `gpt-4.1-mini` output. A later request for `gpt-6.1-terra` with low reasoning was verified against official documentation and account model-list/retrieve endpoints; that migration is separate and must not relabel this existing artifact.
