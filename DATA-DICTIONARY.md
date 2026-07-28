# Data dictionary

How a series is stored, field by field, in plain language — and where each design decision came from.

One shape for every series. [`src/schema.ts`](src/schema.ts) enforces it; this document explains it.

---

## The three-way adjudication

The three charts were built independently and each got some things right. Rather than making Plated Prisoner conform to the other two, every field was judged on its merits. **Plated Prisoner wins four of them**, and one of those wins deletes the worst code in the repo.

| Field | Empyrean / DCC | Plated Prisoner | Winner | Why |
|---|---|---|---|---|
| **Region shape** | full-width horizontal bands (`y`, `h`) | **2D boxes** (`x`, `y`, `w`, `h`) | **PP** | A kingdom is a *place*. Annwyn is a large box spanning the bottom; the Red Raids are a small box in the middle. Bands can only stack. |
| **Node position** | `x` only, plus a **50-line `Y_OFFSETS`** table of hand-tuned pixel nudges | **explicit `x` and `y`** | **PP** | The offset table is the most brittle code in the repo. Explicit coordinates delete it outright. |
| **Magic / power** | `signet` on 4 of 72 (Empyrean), `magic` in `attrs` (DCC) | **first-class `magic` + `MAGIC_ICONS` palette** | **PP** | A systematic field with an icon map beats a sparse afterthought. |
| **Region description** | none | **`power`** on each kingdom | **PP** | "Rot magic (Slade)", "Word-stealing (Kaila)" — genuinely useful for a legend. |
| **Per-book world state** | `BOOK_TRANSITIONS.changes[]` (Empyrean) | **`dominant`** kingdom per book | **both** | Keep both: a list of what changed, and who is ascendant. |
| **Books** | objects — `{id, title, short, year, era}` | bare strings | **E/DCC** | PP cannot label a timeline button or record a year. |
| **Book numbering** | 1-indexed | **0-indexed** | **E/DCC** | Off-by-one against every human reference to "book 1". |
| **Relationship types** | lowercase slugs | English phrases as ids (`"Captor/Captive"`) | **E/DCC** | Ids should be stable; display text should be separate. |
| **Character kind** | `type` + `characterTypes`, drives node shape | none | **E/DCC** | Dragons must not look like humans. |
| **Faction vs place** | **separate** `affil` and `band` | conflated into `kingdom` | **E/DCC** | Xaden is a Marked One *located in* the Riders Quadrant. Auren belongs to the Sixth Kingdom while *held prisoner in* the Fourth — so PP needs the split too and cannot express it. |
| **Status** | 7 values (Empyrean), 2 (DCC) | 3, incl. `sacrifices` | **neither** | All three drifted. Normalised to 5 + `statusDetail`. |
| **Allegiance to a person** | as relationships | `king` field on the node | **E/DCC** | "Loyal to Midas" is a relationship, not an attribute. |

---

## Every field, explained

### The series

| Field | What it is |
|---|---|
| `id` | Short slug — the filename. `empyrean`, `dcc`, `plated-prisoner`. |
| `title` | Display name of the series. |
| `author` | Who wrote it. |

### `books[]` — the timeline

One entry per book, and **book numbers start at 1**. These drive the timeline buttons and every spoiler boundary.

| Field | What it is |
|---|---|
| `id` | Book number. 1, 2, 3… |
| `title` | Full published title — *Iron Flame*. |
| `short` | Label for the timeline button — *Iron Flame*, *Doomsday*. |
| `year` | Publication year. Optional. |
| `era` | One line on where the story stands — *"Second-year · Revolution begins"*. Optional. |
| `dominant` | Who is ascendant in this book — *"Third Kingdom (Kaila)"*. Optional. Adopted from Plated Prisoner. |
| `future` | `true` for announced-but-unreleased books, so they render greyed out. |

### `regions[]` — places on the chart

Rectangular areas the chart is divided into. Formerly "bands"; now 2D boxes so a region can be any size anywhere.

| Field | What it is |
|---|---|
| `id` | Stable slug — `riders`, `annwyn`. |
| `label` | Name shown on the region — *"Riders Quadrant — Basgiath War College"*. |
| `x`, `y` | Top-left corner in chart units. `x` defaults to 0 so existing full-width bands keep working. |
| `w`, `h` | Width and height. `w` defaults to full width. |
| `power` | What defines this place — *"Rot magic (Slade)"*. Optional. |
| `color`, `border` | Fill and outline. |

### `affiliations{}` — who someone sides with

Deliberately separate from `regions`. **A character's allegiance and their location are different facts**, and both series need the distinction: Xaden is a Marked One standing in the Riders Quadrant; Auren belongs to the Sixth Kingdom while held prisoner in the Fourth.

| Field | What it is |
|---|---|
| `label` | Display name — *"Marked Ones / Aretia"*, *"Royal Court"*. |
| `color`, `border` | Node colours. |
| `emoji` | Optional badge. |

### `characterTypes{}` — what kind of being

Controls node **shape**, so a dragon is not drawn as a human. Optional — DCC defines none.

| Field | What it is |
|---|---|
| `label` | *"Gryphon"*, *"Venin"*. |
| `shape` | `circle`, `diamond`, `star8`, `chevron`, `triangle`, `hexagon`, `star6`. |

### `relationshipTypes[]` — the edge vocabulary

The canonical 14, defined in [RELATIONSHIPS.md](RELATIONSHIPS.md).

| Field | What it is |
|---|---|
| `id` | Stable lowercase slug — `bonded`, `killed`. Never display text. |
| `label` | What the legend shows — *"Killed"*. |
| `color`, `dash` | Line colour and dash pattern; `dash: null` is solid. |
| `symmetric` | `true` when it reads the same both ways. Direction rules are per-type and documented. |

### `characters[]`

The base record describes a character **as they are at their first appearance**. Anything that changes later goes in `changes` — see below.

| Field | What it is |
|---|---|
| `id` | Stable lowercase slug — `violet`, `king_tauri`. Never a display name; renaming a character must not break every edge. |
| `label` | The name readers know — *"Violet Sorrengail"*. |
| `role` | Short title — *"Goddess of War"*. **Spoiler-bearing**, so it can change per book. |
| `type` | Character-type id. Optional. |
| `affil` | Affiliation id. Must exist. |
| `region` | Region id. Must exist. |
| `book` | First book they appear **on the page**. Referenced-in-backstory does not count — that is why Halden is book 3. |
| `lastBook` | Last book they appear in. Must be ≥ `book`. |
| `status` | `alive` · `dead` · `missing` · `prisoner` · `unknown`. |
| `statusDetail` | The original, more specific wording where it adds something — *"sacrificed"*, *"executed"*. |
| `size` | `main` or `side`. Controls node size. |
| `x`, `y` | Position in chart units. `y` optional; without it the character is centred in their region. |
| `magic` | Their power — *"Lightning Wielder"*, *"Rot magic"*. Optional. Adopted from Plated Prisoner. |
| `bio` | Full biography. **Whole-series spoiler** — never served below the final book. |
| `bioByBook[]` | Biography split per book, so a reader at book *k* sees only `book <= k`. |
| `perceived` | What the reader *wrongly believed*. See below. |
| `changes[]` | What actually changed, and when. See below. |
| `attrs{}` | Series-specific extras that are not worth a top-level field — dragon den, Floor 9 faction. |

### `relationships[]`

| Field | What it is |
|---|---|
| `from`, `to` | Character ids. **Direction carries meaning** for most types: for `killed`, `from` is the killer; for `family`, `to` *is* `from`'s label. |
| `type` | Relationship-type id. |
| `book` | The book from which this edge is **visible**. Not "when it became true" — King Tauri has been Halden's father since birth, but the edge cannot draw before Halden is on the chart. |
| `untilBook` | Last book it applies. Optional; omitted means it never ends. |
| `label` | Human gloss — *"mother"*, *"executed him"*. |
| `changes[]` | Type or label changes over time. See below. |

### `events[]`

| Field | What it is |
|---|---|
| `book` | When it happens. |
| `text` | One line describing it. |
| `involves[]` | Character ids it concerns — this is what answers *"what happened to Liam?"*. |
| `kind` | `death` · `betrayal` · `battle` · `reveal` · `bond` · `other`. |

---

## The two time mechanisms, and why they are different

This is the part that matters most, and the reason they are kept apart.

### `changes[]` — the world actually changed

Jack Barlowe is a first-year rider who is "killed" in book 1, mended and **returns as venin** in book 2, then is **captured and held prisoner** in book 3. Three states.

```json
{
  "id": "jack",
  "role": "First-year · First Wing",
  "affil": "riders_other",
  "status": "alive",
  "book": 1, "lastBook": 4,
  "changes": [
    { "book": 2, "set": { "affil": "venin", "role": "Venin" },
      "why": "Mended by Nolon under Varrish's orders; returns as venin" },
    { "book": 3, "set": { "status": "prisoner" },
      "why": "Caught and held; Imogen erases his memory" }
  ]
}
```

**How to read it:** state at book *k* = the base record, plus every `changes` entry whose `book <= k`, applied in order.

So at book 1 Jack is an `alive` `rider`. At book 2 he is an `alive` `venin`. At book 3 he is a `prisoner` `venin`. The reader is never told a thing before the book that reveals it.

Relationships work the same way, which retires the `complicated` escape hatch:

```json
{ "from": "violet", "to": "imogen", "type": "enemy", "book": 1,
  "label": "tormentor",
  "changes": [
    { "book": 2, "set": { "type": "ally", "label": "protects her" },
      "why": "Imogen shifts from tormentor to ally after Resson" } ]}
```

Previously that was a single `complicated` edge labelled `"enemy → ally"` — an arrow inside a string, unfilterable and ungated. Now it is two real facts, each visible at the right time.

**Rules, enforced:**
- entries must fall inside `[book, lastBook]`
- each must actually change something
- no two entries for the same book
- `why` is required — same discipline as the canon corrections

### `perceived` — the reader was wrong

Brennan is presumed dead until the final paragraph of *Fourth Wing*. Nothing about him changes; **the reader's understanding** does.

```json
{
  "id": "brennan",
  "status": "alive",
  "perceived": {
    "status": "dead",
    "role": "Violet's brother (presumed dead)",
    "untilBook": 1,
    "note": "Presumed dead before the series. Revealed alive in the final paragraph of Fourth Wing."
  }
}
```

Through `untilBook`, the chart shows the belief and marks it **as far as you know**. After it, the truth.

### Why not merge them

They answer different questions, and one character can need both.

|  | `changes` | `perceived` |
|---|---|---|
| What moved | the world | the reader's knowledge |
| Was the earlier value ever true? | **yes** | **no** |
| Example | Jack really does become venin | Brennan was alive the whole time |

Jack needs both: he genuinely changes faction (`changes`), and separately the reader thinks he died in book 1 (`perceived`).

Merging them would lose the distinction between *"this was true and then stopped being true"* and *"this was never true and you were misled"* — which, for a series companion, is the whole point.

---

## Adding a book to an existing series

1. Add the book to `books[]` with the next `id`.
2. For characters already present whose situation changed, add a `changes` entry with a `why`. **Do not edit the base record** — that would rewrite history for readers earlier in the series.
3. For new characters, add a full record with `book` set to the new number.
4. For relationships that ended, set `untilBook`. For ones that changed character, add a `changes` entry rather than a new `complicated` edge.
5. Add `events[]` with `involves` ids.
6. Run `npm run validate`, then `npm run spoiler-audit`.

## Adding a new series

Same shape, no exceptions. Optional fields may be omitted — `characterTypes`, `magic`, `power`, `dominant`, `attrs` are all optional — but **book numbering starts at 1** and relationship types must come from the canonical 14.
