# Raingutter Regatta Bracket

https://mstratman.github.io/raingutter

Offline-first, mobile-friendly bracket tracker for Cub Scout raingutter regattas. No build, no dependencies.

- Two formats, chosen on the Setup tab with a live heat-count estimate:
  - **Single elimination**: each match = **two heats with lanes swapped** (so every scout races both lanes), 1–1 split → tiebreaker heat. Uncheck "Swap lanes" for one heat per match.
  - **Pool play, then bracket**: every scout races k heats against k different opponents (lanes balanced, no repeat opponents), then the top 2/4/8/… by heat wins go to a single-elimination bracket. Ties: head-to-head among the tied scouts, then a random draw.
- Byes when the scout count isn't a power of 2; bye scouts still race both lanes in round 2.
- Every change is saved instantly (localStorage + IndexedDB mirror); reload resumes where you left off. Nothing is deleted; corrections are logged.
- Works offline after first load (service worker). Add to Home Screen for an app-like experience.
- More tab: export/import JSON, copy results, archive/reopen events.

`node test.js` runs the bracket-logic tests. When shipping changes, bump `VERSION` in `sw.js`.
