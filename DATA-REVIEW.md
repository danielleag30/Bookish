# Data review — findings from Phase 1

What the schema and integrity checks caught in the hand-entered chart data, and what still needs a canon decision from a human.

Reproduce with `npm run validate`.

**Status: 0 errors, 6 warnings.** Nothing is broken enough to render wrong; all six are internal contradictions worth a human eye.

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

## ⚠️ Needs your decision — not changed

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

## Why the warnings stay in CI

`npm run validate` exits non-zero on **errors** only. These six are **warnings** — printed, visible, but non-blocking. They describe data that contradicts itself, and each needs a canon judgment rather than a mechanical fix. Once you decide A, B and C, they should go to zero and can be promoted to errors to keep them from coming back.
