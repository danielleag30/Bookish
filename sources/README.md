# Original charts — migration inputs

The three hand-built charts as they stood before the engine extraction, kept
verbatim.

`scripts/extract-charts.mjs` parses these to produce `data/*.json`. The live
pages under `Empyrean-Chart/`, `DCC-Chart/` and `Plated-Prisoner-Chart/` are now
37-line shells that load the engine and their series data, so the inline
`NODES` / `BANDS` / `ALL_NODES` arrays the migration reads no longer exist there.

**`data/*.json` is the source of truth going forward.** These files are not
edited, and are no longer served — which they had been. `vercel.json` used to
set `outputDirectory: "."`, publishing every path in the repository, and these
charts carry the full cast and every reveal with no spoiler gate at all. Anyone
who found `/sources/Empyrean-Chart.html` could read the ending of a series the
live chart is built to withhold. The claim was a statement of intent that
nothing enforced.

The site now builds into `dist/` via `scripts/build-site.ts`, which copies an
allowlist. `sources/` is not on it, and a new directory is not published until
someone puts it there.

They exist so the migration stays re-runnable and
every transformation applied to the data — the canon corrections, the status
normalisation, the temporal backfill, the relationship-vocabulary mapping — can
be re-derived and reviewed rather than taken on trust.

| File | Lines | Implementation |
|---|---|---|
| `Empyrean-Chart.html` | 2,162 | Vanilla JS, hand-built SVG — the most complete of the three |
| `DCC-Chart.html` | 791 | Vanilla JS; shared 12 identically-named functions with Empyrean by copy-paste |
| `Plated-Prisoner-Chart.html` | 426 | React 18 + Babel Standalone via CDN |
