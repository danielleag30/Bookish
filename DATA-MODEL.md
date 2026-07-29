# Should the data be modelled per book?

A design question raised before migrating The Plated Prisoner. Answered from the real data.

**Short answer: yes, and Plated Prisoner should not be migrated until it is done.** Recommendation is Option B below — sparse per-book changes.

---

## The diagnosis

The current model gives each character **one row plus a lifespan**: a single `affil`, `band`, `status`, `role`, with `book` (first appearance) and `lastBook` (last).

`lastBook` is **not** a visibility filter. The chart is cumulative — once a reader has met someone, that character stays on it, with their fate shown. Hiding the dead would answer *"who died?"* with an empty chart, and measuring it showed a filter would remove 36 characters across the four series at their final book, King Midas and Liam among them. `lastBook` marks where a story ends; it is used to place bio segments and to flag events that reference someone after they have gone. Relationships get a single `book` meaning "visible from".

That models *when someone is on the chart*. It does not model *the story changing around them*. Four independent pieces of evidence say the gap is real and already causing bugs.

### 1. A live spoiler leak the test suite missed

At reading position **book 1**, the ask box currently reports Jack Barlowe as:

| Field | Reports | Canon at book 1 |
|---|---|---|
| `role` | `Antagonist · Pain · → Venin` | first-year rider, First Wing |
| `affil` | `venin` | rider — **venin is a book 2 reveal** |
| `status` | `prisoner` | alive — **prisoner is book 3** |

His actual arc is: rider → "killed" by Violet (bk1) → mended, returns as venin (bk2) → captured, held prisoner, memory erased (bk3). Three states, one row.

The adversarial tests didn't catch this because they check that no *later-book character* is named. They never check that a *visible* character's **attributes** are book-appropriate. That is a whole class of leak the current schema cannot express a fix for.

`perceived` handles exactly one override per character. Jack needs two.

### 2. Transitions are being encoded as text inside labels

Nine relationship labels, across both series, spell out a change the schema has no field for:

```
complicated  violet → imogen    "enemy → ally"
complicated  maraya → tecarus   "queen → he crowns himself"
complicated  katia  → eva       "friend→enemy"          (DCC)
complicated  florin → lucia     "enemy→complicated"     (DCC)
romantic     violet → xaden     "slow burn → married (Bk3)"
```

And in a `role` field:

```
jack   "Antagonist · Pain · → Venin"
rissa  "Royal Saddle → free woman"        (Plated Prisoner)
```

An arrow in a string is the data asking for a time axis.

### 3. `complicated` is a missing feature, not a category

Thirteen Empyrean edges are typed `complicated`. Its own definition in [RELATIONSHIPS.md](RELATIONSHIPS.md) is *"the relationship changed category across the series"*.

So the most-used escape hatch in the vocabulary exists **because** relationships cannot change type over time. Given the axis, `violet → imogen "enemy → ally"` becomes `enemy` at book 1 and `ally` at book 2 — two real, filterable, spoiler-gated facts instead of one unfilterable string.

### 4. Faction and status changes are unrepresentable

From the Empyrean bios alone:

| Character | Change the single-valued field cannot hold |
|---|---|
| Xaden | Wingleader → Marked One → **turns venin** at the end of book 2 |
| Panchek | Commandant → revealed **venin spy** (book 3) |
| Devera | faculty → **defects with the rebels** |
| Jack | rider → venin → prisoner |
| half the quadrant | **defects to Aretia** in book 2 — a band change |

---

## Plated Prisoner is the worst case, which makes it the right test

Its 39 characters break the current model in five ways at once:

1. **Zero-indexed books.** `book: 0`, which the schema rejects outright.
2. **`lastBook` contradictions, same class as Lilith.** `midas` is `lastBook: 2` but his bio says Auren kills him *in book 3*. `mist` is `lastBook: 2`, killed by Kaila *in book 3*.
3. **Non-standard statuses.** `killed`, `sacrifices` — the Empyrean vocabulary problem again.
4. **Perceived state and identity reveals.** `digby` is *"thought dead after Gleam but survives"* — a Brennan case. `rip` is *revealed to be King Slade Ravinger* — an Aaric case.
5. **The protagonist changes realm.** Auren is `kingdom: "sixth"` for all six books, but she falls into Annwyn in book 4 and is revealed as the Turley heir. Her entire arc is captive → free → rightful ruler, and her role field would need an arrow to say so.

Migrating it into today's shape would mean immediately hand-writing `perceived` blocks for Digby and Rip, fixing two `lastBook` values, normalising statuses — and then *still* having no way to say Auren changed realms or Rissa stopped being a saddle.

**The migration would bake in the bug.**

---

## Three options

### A. Squeeze Plated Prisoner into the current shape
Re-index books, normalise statuses, patch the two `lastBook` errors, add two `perceived` blocks.

- **Cost:** ~half a day.
- **Gets:** a third chart with an ask box.
- **Costs:** locks in the Jack-class leak across three series instead of two. Every future book makes it worse, and the LLM pipeline in Phase 3 gets trained against a shape we intend to abandon.

### B. Sparse per-book changes ⭐ recommended

Keep the base record as "state at first appearance", and add only what changes:

```json
{
  "id": "jack",
  "label": "Jack Barlowe",
  "role": "First-year · First Wing",
  "affil": "riders_other",
  "status": "alive",
  "book": 1, "lastBook": 4,
  "changes": [
    { "book": 2, "set": { "affil": "venin", "role": "Venin" },
      "why": "Mended by Nolon under Varrish's orders, returns as venin" },
    { "book": 3, "set": { "status": "prisoner" },
      "why": "Caught and held; Imogen erases his memory" }
  ]
}
```

State at book *k* = base record, plus every `changes` entry with `book <= k`, applied in order. Relationships get the same treatment plus an optional `untilBook`.

- **Backwards compatible.** A character with no `changes` behaves exactly as today, so nothing has to be rewritten at once.
- **Sparse.** Only real changes are recorded — roughly 25–30 entries for Empyrean, not 288 rows.
- **Dissolves `complicated`** into real, filterable transitions.
- **Fits the pipeline.** A per-chapter extractor naturally produces *"what changed in this chapter"*, which is precisely this shape. Phase 3 gets easier, not harder.
- **`why` on every entry** keeps it reviewable, the same discipline as the canon `CORRECTIONS`.
- **The gate handles it in one place** — `gate()` already exists; it gains a "resolve state at position" step that everything inherits.

`perceived` stays a sibling rather than merging in: a change is *the world altering*, a perception is *the reader being wrong*. Jack needs both — he really does become venin (change) and Brennan is really alive all along (perception).

### C. Full per-book snapshots
One row per character per book.

- Empyrean 72×4 = **288**, DCC 33×8 = **264**, Plated Prisoner 39×6 = **234**. Nearly 800 rows, the vast majority identical to their neighbour.
- Painful to hand-edit, and every new book multiplies the diff.
- The pipeline would have to emit and the eval harness compare four times the data for no extra information.

Explicit, but the cost is not repaid.

---

## Recommended order

1. **Add `changes` to the schema** with validation: entries inside `[book, lastBook]`, must actually change something, no duplicate books, `why` required.
2. **Teach `gate()` to resolve state at a position.** Every consumer — ask box, MCP server, chart — inherits it for free.
3. **Backfill Empyrean and DCC.** Start with the nine arrow-labels and the handful of faction changes; that is most of the value. Retire the `complicated` edges that are really transitions.
4. **Then migrate Plated Prisoner into the finished shape** — re-index books, normalise statuses, fix the two `lastBook` errors, and express Auren's and Rissa's arcs properly.
5. **Add the missing adversarial test:** at position *k*, no visible character may report an attribute whose introducing change is later than *k*. That is the test that would have caught Jack.

Step 5 matters most. The Jack leak existed because the test suite checked *who* was visible but never *what they claimed to be*.
