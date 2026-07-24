# Bookish

<p align="center">
  <img src="docs/hero-banner.png" alt="Bookish — a constellation-style map of connected character nodes" width="700">
</p>


**Hand-built, spoiler-aware character relationship charts for fantasy series — because I got tired of losing track of who bonded to which dragon, who's dead, and who betrayed whom by book four.**

> ⚠️ **Spoiler Warning** — Every chart plots relationships, status, and events across an entire series. Use the per-book timeline controls to stay within where you've actually read.

---

## Why I Built This

I read fast-moving series with huge, shifting casts — new characters every book, alliances that flip, people who die and stay dead (or don't). Wikis spoil you instantly and reading trackers just tell you *what page you're on*, not *who's still alive and who they're bonded to right now*. I wanted something you could step through book-by-book without getting ahead of your own reading.

So each chart here is a small, self-contained relationship map: nodes are characters, edges are relationships, and a book selector controls which of both are visible. No backend, no database, no build step — just an SVG I draw and redraw by hand in response to state changes.

This is not a reading tracker or a progress dashboard. It's a visual reference tool.

**Live:** [bookish-bay.vercel.app](https://bookish-bay.vercel.app)

---

## Series

### The Empyrean
`/Empyrean-Chart/`

Four-book series (book 4 unreleased, tracked as "TBA"). 72 characters and 115 relationships across dragons, riders, venin, gods, gryphons, and irids — typed by shape, colored by faction and dragon den.

### Dungeon Crawler Carl
Live separately at a companion deployment · source also mirrored in `/DCC-Chart/`

Eight books mapped to ten dungeon floors. Cast, deaths, and floor-by-floor events tracked as the party descends.

### The Plated Prisoner
`/Plated-Prisoner-Chart/`

Six-book gilded-court series. Alliances, betrayals, and arcs across the full run — the one chart built in React instead of vanilla JS (see below).

---

## What's Actually Interactive

Every chart is a genuinely hand-authored SVG scene graph, not a canvas snapshot or a charting library output. Concretely, per chart:

- **Pan, zoom, and drag** — click-drag the canvas to pan, scroll to zoom (clamped 0.18×–3×), grab any node and reposition it; positions persist for the session.
- **Book-by-book timeline** — a row of book buttons drives which nodes/edges are visible; characters introduced in the current book get a glowing dashed ring, characters who've exited the story fade or drop out.
- **Relationship filtering** — a filter bar toggles edge types on/off (family, bonded, romantic, rivals, allies, etc.) plus a "clear all" reset.
- **Draggable, collapsible, hideable legend** and a **draggable search overlay** (type a name, hit Enter, jump to and center that node).
- **Sidebar** that swaps between two views: click a node for its character card; click empty canvas for the current book's event log and a legend key.

Under the hood, state lives in one small object per chart. Every state change clears the SVG and rebuilds it from that state — there's no virtual DOM, no diffing, just `createElementNS` calls and a full redraw. It's a deliberately simple render loop, and at this scale (dozens of nodes, not thousands) it's fast enough that the simplicity is a feature, not a shortcut.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **JavaScript** | Vanilla JS (Empyrean & Dungeon Crawler Carl) — React 18 + Babel Standalone via CDN for Plated Prisoner only |
| **Rendering** | Hand-positioned SVG, built with `document.createElementNS`, fully re-rendered on state change |
| **Frontend** | HTML5, CSS3 |
| **Deployment** | Vercel (auto-deploy on push to `main`) |

**Build tooling:** none · **Package manager:** none · **Database:** none
**Data:** hardcoded node/edge/book arrays, inline in each chart's own HTML file

---

## Why Hand-Built SVG, No Framework

This isn't a "no time to learn React" excuse — I *did* use React for Plated Prisoner, so the choice elsewhere was deliberate. For the Empyrean and DCC charts, the actual problem is closer to a small, bespoke diagramming tool than a typical app UI: custom node shapes per character type, curved relationship edges, draggable free-form layout, and a redraw that has to stay in sync with a single source of truth (the current book). A charting library would fight the "step through book by book, characters fade/appear, positions persist" behavior at every turn, and a full framework buys nothing when the entire state surface is one object and the entire view is one `<svg>`. Hand-rolling it means every pixel is something I directly control and can debug by reading the function that draws it.

---

## Directory Structure

