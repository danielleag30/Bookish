# Bookish

**Interactive character relationship charts for book series — built for readers, designed like a map.**

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://bookish-bay.vercel.app)
[![Live Site](https://img.shields.io/badge/Live-bookish--bay.vercel.app-5b21b6)](https://bookish-bay.vercel.app)

> ⚠️ **Spoiler Warning** — Each chart displays character relationships, status, and key events across an entire series. If you haven't finished a series, use the per-book timeline controls to progress safely.

---

## What This Is

Bookish is a collection of SVG-based, interactive character relationship charts for fantasy and genre fiction series. Each chart lets you explore who's connected to whom, filter by relationship type, and track character arcs book-by-book.

This is not a reading tracker or progress dashboard. It's a visual reference tool.

**Live:** [bookish-bay.vercel.app](https://bookish-bay.vercel.app)

---

## Screenshots

<img src="https://github.com/user-attachments/assets/9e5bbe71-8310-4f28-a606-6e1aec80abc8" alt="Empyrean Chart" width="650" />

<img src="https://github.com/user-attachments/assets/80292b6a-d5e4-4e64-ada6-50f31e00a35b" alt="Dungeon Crawler Carl Chart" width="650" />

<img src="https://github.com/user-attachments/assets/047436ec-12b5-4ca7-8ce9-b037d15f4c07" alt="Plated Prisoner Chart" width="650" />

---

## Series

### The Empyrean — *Rebecca Yarros*
`/index.html`

Four-book series. Chart covers 50+ characters across dragons, riders, venin, gods, gryphons, and irids. Nodes are typed by shape and colored by faction and dragon den. Faction bands divide the canvas by story region.

Books: *Fourth Wing · Iron Flame · Onyx Storm · [Book 4 — TBA]*

---

### Dungeon Crawler Carl — *Matt Dinniman*
`/DCC-Chart/`

Eight-book progressively expanding cast across a brutal, satirical dungeon-crawl series. Chart tracks character introductions, deaths, and relationships floor by floor.

---

### The Plated Prisoner — *Raven Kennedy*
`/Plated-Prisoner-Chart/`

Six-book series with a gilded court aesthetic. Chart maps alliances, betrayals, and character arcs across the full run.

---

## Features

### Chart Core
- **Interactive SVG graph** — pan, zoom, and drag individual nodes to rearrange the layout
- **Book-by-book timeline** — step forward through the series; characters fade out when they exit the story and highlight when they're introduced
- **Relationship filtering** — filter visible edges by type (romantic, allies, rivals, bonded, family, etc.)
- **Draggable, minimizable legend** — stays out of the way when you don't need it

### Character Nodes
- **Shape = character type** (humans → circles, dragons → diamonds, gryphons → triangles, venin → hexagons, gods → 6-point stars, irids → 8-point stars, wyverns → chevrons)
- **Border color = faction/affiliation**
- **Fill color = dragon den** (for dragon nodes — black, blue, green, brown, red, orange, gold, iridescent)
- **Glowing dashed ring** marks characters newly introduced in the current book

### Character Cards (Sidebar)
Click any node to open a detailed card:
- Bio, status, and character type
- Introduced in / current status tags
- Signet, Wing, Homeland, Dragon Bond fields (where applicable)
- Full connection list filtered to the current book

### Book Panel (Sidebar)
Click off any node to see:
- Key events for the selected book
- Legend guide for shapes, colors, and relationship types

### Research Methodology
Character data is sourced across multiple reference sites — not limited to Amazon or Goodreads. Sources include fan wikis, StoryGraph, LibraryThing, author sites, Fandom wikis, and community discussions.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **JavaScript** | Vanilla JS (+ React 18.2 via CDN for Plated Prisoner only) |
| **Rendering** | SVG (hand-positioned, DOM-driven) |
| **Frontend** | HTML5, CSS3 |
| **Fonts** | Google Fonts (Cinzel, Cormorant Garamond, DM Sans, Special Elite) |
| **Deployment** | Vercel (auto-deploy on push to `main`) |

**Build tooling:** None  
**Package manager:** None  
**Database:** None  
**Dependencies:** Hardcoded JS objects (nodes, edges, book metadata)

### Framework Breakdown

- **Plated Prisoner Chart** — React 18.2.0 (from CDN) + Babel Standalone (browser JSX transformation)
- **Dungeon Crawler Carl & Empyrean Charts** — 100% vanilla JavaScript, no dependencies
- **Landing Page** — Vanilla HTML/CSS/JavaScript

---

## Directory Structure

```
Bookish/
├── index.html                  # Empyrean series chart (root entry point)
├── DCC-Chart/
│   └── index.html              # Dungeon Crawler Carl chart
├── Plated-Prisoner-Chart/
│   └── index.html              # Plated Prisoner chart (React-based)
├── images/                     # Shared UI icons and series assets
└── README.md
```

Each series lives in its own directory with self-contained logic and data. Adding a new series means adding a new directory — nothing in the root changes.

---

## How It Works

**Data model** — Each chart defines two flat arrays: `NODES` (characters) and `EDGES` (relationships). Every node and edge carries a `book` field (integer) marking when it enters the story. The UI filters both arrays by the currently selected book.

**Rendering** — On each state change, the SVG is cleared and redrawn from scratch. Node positions are stored in a `pos` map (keyed by node ID) and persist across re-renders within a session. No layout algorithm — all positions are hardcoded or draggable.

**Sidebar** — A single sidebar panel is reused for both character cards and the book event panel, swapping content based on selection state.

**Theming** — Each series chart has its own CSS variables and atmospheric effects (the Empyrean chart uses a lightning flicker animation and a starfield; others follow their own aesthetic themes).

---

## Local Development

No build tooling required.

```bash
# Clone
git clone https://github.com/danielleag30/Bookish.git
cd Bookish

# Open directly in browser
open index.html

# Or serve locally (recommended to avoid any path issues)
npx serve .
```

---

## Deployment

Continuous deployment via Vercel. Every push to `main` triggers a redeploy.

Live URL: **[bookish-bay.vercel.app](https://bookish-bay.vercel.app)**

---

## Roadmap

- [ ] Additional series charts
- [ ] Series index / landing page with chart navigation
- [ ] Mobile layout improvements
- [ ] Search / filter nodes by name
- [ ] Exportable chart snapshots
- [ ] Character bio export (PDF or markdown)

---

*Updated: May 2026*