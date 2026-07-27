# Filter hierarchy

Every dimension a chart can be toggled by, in six tiers.

**Source of truth: [`src/filters.ts`](src/filters.ts).** This is the readable companion.

---

## The tiers

```
Tier 0  READING POSITION  ── single-select; gates everything below
   │
Tier 1  WHO IS ON THE CHART ─ band · faction · kind · status · prominence
Tier 2  CONDITIONAL FACETS ── dragon den · Floor 9 faction
Tier 3  EDGES ────────────── relationship type (the canonical 14)
Tier 4  EVENTS ───────────── event kind
Tier 5  PRESENTATION ─────── regions · names · edge labels · glyphs · rings · legend
```

**Tiers 0–4 filter data and are spoiler-gated. Tier 5 only changes appearance and is not** — hiding the legend conceals no fact.

---

## Tier 0 · Reading position

| | |
|---|---|
| Select | **single** — exactly one book |
| Source | `series.books[].id` |

This is not a toggle, it is the gate. **Nothing first appearing after this book may be shown by any route** — not by node, edge, event, search, or path traversal. Every tier below inherits the bound.

---

## Tier 1 · Who is on the chart

Multi-select; all on by default. Values verified against the real data.

| Dimension | Empyrean | DCC | Effect |
|---|---|---|---|
| **`band`** Region | 7 | 6 | Shows/hides a horizontal region and everyone in it |
| **`affil`** Faction | 12 | 5 | Filters by allegiance — riders, scribes, venin, gods, Royal Court |
| **`charType`** Kind | 7 | — | Species/kind; also controls node shape. *DCC defines none* |
| **`status`** Status | 4 | 2 | alive · dead · missing · prisoner · unknown |
| **`size`** Prominence | 2 | 2 | Main characters only, or include side characters |

---

## Tier 2 · Conditional facets

Real facets, but only meaningful within a subset — so they carry an `appliesTo`.

| Dimension | Coverage | Values | Applies to |
|---|---|---|---|
| **`den`** Dragon den | 20 of 72 characters — but **20 of 20 dragons** | 8 | `type` is dragon or irid |
| **`f9`** Floor 9 faction | 19 of 33 | 2 | DCC characters who fought on Floor 9 |

---

## Tier 3 · Edges

**`relType`** — multi-select over the [canonical 14](RELATIONSHIPS.md). Empyrean uses 11, DCC 6.

An edge draws only when **its type is on AND both endpoints are visible.** That conjunction is what keeps a hidden character from being inferred from a dangling line.

---

## Tier 4 · Events

**`eventKind`** — `death` · `betrayal` · `battle` · `reveal` · `bond` · `other`. Filters the event log.

---

## Tier 5 · Presentation

Not spoiler-gated — none of these reveal or conceal a fact.

`showBands` · `showLabels` · `showEdgeLabels` · `showGlyphs` · `showNewRing` · `legend`

---

## What earns a toggle

A dimension is only worth a toggle if its values behave like **categories**. Three tests, in `FACET_RULES`:

| Test | Threshold |
|---|---|
| Cardinality | 2–20 distinct values |
| Coverage | ≥ 25% of entities carry a value, **or** it fully covers a named subset |
| Uniqueness | ratio of distinct-to-present below 0.7 — above that, values are per-entity free text |

`classifyCandidate()` applies them, so a new series gets checked instead of someone eyeballing the numbers.

### Rejected, with reasons

Recorded in `REJECTED_DIMENSIONS` so the decision is reviewable rather than looking like an oversight.

| Candidate | Why not |
|---|---|
| `magic` | **33 distinct values across 33 DCC characters** — one each. Free text, not a category. |
| `trait` | 14 values across 14 characters, each a full paragraph of characterisation. |
| `signet` | Only 4 of 72, every value unique. It is a badge — see `showGlyphs`. |
| `wing` | Only 4 of 72, and values are `"Fourth Wing"` vs `"Fourth Wing (Wingleader)"` — a rank, not a partition. |
| `homeland` | Only 4 of 72, with overlapping values (`"Navarre"` and `"Navarre (Basgiath)"`). Would need normalising first. |

The general lesson: **one value per entity means it is a description, not a facet.** Show it on the character card.

---

## ⚠️ The bio leak — a Tier 0 hole

Reading position gates *characters, edges and events*. It does **not** gate the text inside a character's bio, and the bios are written as whole-series prose.

`npm run spoiler-audit` measures it. Currently **25 bios across the two series name a character who has not appeared yet.**

Brennan's bio is the clearest case:

> *"Violet's older brother — presumed DEAD before the series. **Actually alive** and leading the Aretian revolution under an alias... **Reveals himself in Iron Flame**. **In Onyx Storm** he heroically mends Mira after Theophanie cuts her throat."*

One field, three books. Serving that at reading position 1 spoils the entire series.

### The rule until it is fixed

**Never serve `bio` below the final book.** Prefer `bioByBook` where present. This binds the character card, the Phase 1.5 ask box, and the Phase 6 MCP server.

### The fix

`bioByBook` — bio split into per-book segments, so a reader at book *k* sees only segments where `book <= k`. Validation already enforces that segments stay inside a character's own `book`–`lastBook` window. Segmenting the existing 105 bios is a natural first job for the Phase 3 extraction pipeline.

---

## `perceived` — what the reader believed

`status` records only the **end** state, which is not the story as read. Brennan is presumed dead until the final paragraph of *Fourth Wing*; Aaric serves under an alias; Panchek is not revealed as a venin spy until book 3.

So characters may carry a `perceived` block:

```json
{
  "id": "brennan",
  "status": "alive",
  "perceived": {
    "status": "dead",
    "untilBook": 1,
    "note": "Presumed dead before the series. Revealed alive in the final paragraph of Fourth Wing, and reveals himself properly in Iron Flame."
  }
}
```

A spoiler-aware view at or below `untilBook` should present the **perceived** state, not the true one. That is the difference between a chart that lists facts and one that tells you the story you have actually read.

Three recorded so far, all Empyrean. DCC has candidates not yet filled in — Zev is secretly a Borant Emancipation Front member.

Validation rejects a `perceived` block that sets neither `status` nor `identity`, and warns when `perceived.status` equals the real status, since that records nothing.

---

## Adding a dimension

1. Run the candidate through `classifyCandidate()`. If it comes back `reject`, add it to `REJECTED_DIMENSIONS` with the reason rather than forcing it.
2. If `conditional-facet`, set `appliesTo` naming the subset.
3. Decide `spoilerGated`. Default is **true** — only presentation toggles are exempt.
4. Add it to `FILTER_DIMENSIONS` with a tier and a one-line `effect`.
