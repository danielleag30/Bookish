# Data review — findings from Phase 1

What the schema and integrity checks caught in the hand-entered chart data, and what still needs a canon decision from a human.

Reproduce with `npm run validate`.

**Status: 0 errors, 0 warnings.** The six warnings found in the first pass were each researched against series canon and resolved — see the next section. `npm run validate` now fails on warnings too, as a ratchet against regressions.

---

## Applied during migration

These were mechanical, so the extractor performs them and records a note each run.

### 1. Status vocabulary was inconsistent between charts

Empyrean used **seven** values, DCC used **two**, for the same field:

| Empyrean | count | DCC | count |
|---|---|---|---|
| `alive` | 53 | `alive` | 27 |
| `killed` | 10 | `dead` | 6 |
| `deceased` | 3 | | |
| `missing` | 3 | | |
| `sacrificed` | 1 | | |
| `prisoner` | 1 | | |
| `executed` | 1 | | |

Normalised to `alive · dead · missing · prisoner · unknown`.

**Deliberately not flattened to `alive`/`dead`.** `missing` (Garrick, Bodhi, Aaric — the book-3 cliffhanger) and `prisoner` (Jack Barlowe) describe living characters. Collapsing them into `dead` would have quietly destroyed real plot state.

The original wording is preserved in a new `statusDetail` field, because *"sacrificed"* and *"executed"* say more than *"dead"*:

```json
{ "id": "lilith", "status": "dead", "statusDetail": "sacrificed" }
{ "id": "fen",    "status": "dead", "statusDetail": "executed" }
```

### 2. Two reversed duplicate relationships

Out of 115 edges, only two described the same fact twice:

| Dropped | Kept | Why |
|---|---|---|
| `liam → sloane` *"sibling"* | `sloane → liam` *"sister"* | "sister" is more specific |
| `xaden → violet` *"married Bk3"* | `violet → xaden` *"slow burn → married (Bk3)"* | labels differed; merged so neither fact is lost |

115 → 113 relationships.

### 3. The `killed` legend label read backwards

The legend said **"Killed by"**, but the data stores **killer → victim**:

```js
{from: "lilith", to: "fen", type: "killed", label: "executed him"}
```

Rendered with *"Killed by"*, that edge reads **"Lilith killed by Fen"** — the opposite of what happened. Relabelled to **"Killed"**.

### 4. Structural normalisation

- DCC's three parallel faction maps (`FC` colour, `FL` label, `FEMOJI` emoji) folded into one `affiliations` map.
- DCC's `faction` field and Empyrean's `affil` field unified as `affil`.
- `REL_TYPES`' `"all"` entry removed — it is a UI filter, not a relationship type.
- Series-specific extras (DCC's `f9`/`magic`, Empyrean's `den`/`signet`/`wing`/`homeland`) moved to `attrs` so the shared core schema stays clean.

---

## ✅ Resolved against canon

All six warnings are now closed. Each was checked against series canon rather than guessed, and the fixes live in the `CORRECTIONS` block of `scripts/extract-charts.mjs` so they survive re-extraction.

**Result: 0 errors, 0 warnings.**

The important lesson: **the fix direction was not the same in every case.** Two of them turned out to be the *character* being wrong and two the *relationship* — which is exactly why a single blanket rule would have introduced new errors.

| # | Finding | Verdict | Fix |
|---|---|---|---|
| 1 | Lilith `lastBook: 1` | She dies at the Battle of Basgiath in **Iron Flame (book 2)** — Sloane siphons her lifeforce into the wardstone at her request | `lastBook` → **2** |
| 2 | Aimsir `lastBook: 1` | *Found by inference, not by the validator.* Lilith's dragon dies in the same scene — "Lilith and Aimsir's lifeforce" go into the stone together | `lastBook` → **2** |
| 3 | `berwyn → xaden` book 2, Berwyn book 3 | Berwyn is the venin general who **turns Xaden venin at the end of Iron Flame** — so he appears in book 2. **The character was wrong, the edge was right.** | Berwyn `book` → **2** |
| 4 | `king_tauri → halden` book 1, Halden book 3 | Halden is *referenced* in book 1 (Violet's ex) but **first appears on-page in Onyx Storm**. **The edge was wrong, the character was right.** | edge `book` → **3** |
| 5 | `halden → aaric` book 2 | Same reasoning | edge `book` → **3** |
| 6 | `wyvern_rep → theophanie` book 1 | Theophanie first appears in **Onyx Storm (book 3)** | edge `book` → **3** |
| 7 | `wyvern_rep → berwyn` book 1 | Follows Berwyn moving to book 2 | edge `book` → **2** |
| 8 | `quinn → theophanie` *"venin blade"* | **Wrong in both directions.** Quinn is killed by an *unnamed* venin in a tower at Draithus, dying in Imogen's arms. And *Violet* — not Quinn — kills Theophanie with the marble dagger. | edge **dropped** |
| 9 | `trager → silaraine` *"both killed"* | Neither killed the other; rider and gryphon were **burned together on Zinhal**. A `bonded` edge between them already exists. | edge **dropped** |

Relationships: 115 source edges → **111** (2 merged duplicates, 2 factually wrong).

### The semantic question, now decided

Does `relationship.book` mean *"when this became true"* or *"when it becomes visible"*?

**Answer: visible from.** King Tauri has been Halden's father since birth, but the edge cannot be drawn before Halden is on the chart. This is now the documented rule, which prevents the next batch of these.

### Systematic follow-up

Since Lilith/Aimsir was a rider–dragon pair drifting apart, every bonded pair was scanned for mismatched `book`/`lastBook`. Only one other turned up — **Jack Barlowe (bk1–4) and Baide (bk1–3)** — and that one is speculative either way because book 4 is unreleased. Left alone deliberately.

### Sources

- [Lilith Sorrengail — The Empyrean Wiki](https://the-empyrean-series.fandom.com/wiki/Lilith_Sorrengail) · [Battle of Basgiath](https://the-empyrean-series.fandom.com/wiki/Battle_of_Basgiath) · [Iron Flame ending explained](https://theliterarylifestyle.com/iron-flame-ending/)
- [Battle of Draithus — The Empyrean Wiki](https://the-empyrean-series.fandom.com/wiki/Battle_of_Draithus) · [Every major death in Onyx Storm](https://screenrant.com/onyx-storm-major-deaths/) · [Quinn Hollis](https://thebookfeed.com/fourth-wing-guide/quinn-hollis/)
- [Theophanie explained](https://screenrant.com/onyx-storm-silver-haired-venin-theophanie-villain-explained/) · [Theophanie — The Empyrean Wiki](https://the-empyrean-series.fandom.com/wiki/Theophanie)
- [Halden Tauri — Empyrean Riders](https://www.empyreanriders.com/articles/halden-tauri/) · [King Tauri — The Empyrean Wiki](https://the-empyrean-series.fandom.com/wiki/King_Tauri)

### Not a contradiction after all

`violet → jack` *"'killed' (Bk1)"* with Jack's status `prisoner` was on the suspect list, but the two describe different moments and are consistent: Violet does kill him in book 1, he is mended and returns, and `prisoner` is his state at the end of book 3. The scare quotes were doing real work. **Left exactly as written.**

---

## Original findings — historical record

### A. Lilith's `lastBook` contradicts her own death event

```
event (book 2): "Battle of Basgiath: Lilith Sorrengail sacrifices herself to power the wards"
character lilith: book 1, lastBook 1
```

**The chart hides Lilith in book 2 — the very book in which she dies.** Her `statusDetail` is `"sacrificed"`, which only happens in that book-2 event.

Almost certainly `lastBook` should be **2**. Not applied because it changes what the chart *displays*, which is your call.

### B. Five relationships predate one of their participants

| Relationship | Marked | Participant first appears |
|---|---|---|
| `king_tauri → halden` (family) | book 1 | halden — book 3 |
| `halden → aaric` (family) | book 2 | halden — book 3 |
| `berwyn → xaden` (enemy) | book 2 | berwyn — book 3 |
| `wyvern_rep → theophanie` (ally) | book 1 | theophanie — book 3 |
| `wyvern_rep → berwyn` (ally) | book 1 | berwyn — book 3 |

These edges are marked visible in books where one endpoint is still hidden.

**There are two valid fixes and they look different on screen**, which is why nothing was applied:

1. **Raise the relationship's `book`** to when both characters are visible. King Tauri and Halden's father/son bond is true from birth, but only *drawable* from book 3.
2. **Lower the character's `book`** — if Halden really should be on the chart from book 1, that's the fix instead.

Worth noting the semantic question this exposes: does `relationship.book` mean *"when this became true"* or *"when it becomes visible"*? The chart filters on it, so it must mean **visible from**. Deciding that explicitly would prevent the next five of these.

### C. Three `killed` edges look inconsistent

| Edge | Concern |
|---|---|
| `quinn → theophanie` *"venin blade"* | Your event log says **Quinn dies** at Draithus, and **Violet** kills Theophanie with the marble dagger. So this looks **reversed** — Theophanie killed Quinn. |
| `trager → silaraine` *"both killed"* | Mutual death (rider and dragon), so direction is meaningless. Currently stored as if Trager killed Silaraine. |
| `violet → jack` *"'killed' (Bk1)"* | Your own scare quotes — Jack does not stay dead. His status is `prisoner`, so the edge and the status disagree. |

---

## Events: 20 of 36 linked automatically

Empyrean events now carry `involves: [characterIds]` and a derived `kind`. Seven have no character link, and most of those are legitimately character-free:

```
"Map of the Isles likely included"
"Untitled · Rebecca Yarros began writing in early 2026"
"Senarium peace talks · Navarre + Poromiel uneasy alliance"
```

One is a genuine limitation worth noting, because it is exactly what Phase 3's model should handle better than a regex:

```
"Manifests her signet — lightning wielder"     -> involves: []
```

**"her"** is Violet, but pronoun resolution is beyond keyword matching. A good test case for the extraction pipeline.

### Two matching bugs found and fixed while building this

1. **Possessives were dropped.** `"cure for Xaden's venin"` failed to link to Xaden because the word-boundary check excluded a trailing apostrophe. Same for `"Katia's celestial orchid"`.
2. **Surnames over-matched badly.** `"Violet Sorrengail forced from Scribes"` linked **all five Sorrengails**; `"Falls for Xaden Riorson"` dragged in Fen and Talia. Fixed with a rule that a bare name token is only usable when it identifies exactly one character. Titles (`Princess`, `Major`, …) are excluded outright, since "Princess" was linking Princess Donut to the unrelated "Princess Posse".
3. **One event was misclassified.** *"Falls for Xaden Riorson"* was tagged `death` because the keyword rule matched `falls`. Removed that keyword.

---

## CI behaviour

`npm run validate` now exits non-zero on **errors or warnings**. Both were at zero once the canon corrections landed, so the stricter gate locks that in and stops resolved contradictions from quietly reappearing when a new series is added.

The `error` / `warning` split is still meaningful in `checkIntegrity()` — errors are things that would render wrong, warnings are self-contradictions — it just no longer changes the exit code.
