# Relationship vocabulary

The controlled vocabulary for every chart. Enforced in CI by `npm run validate`.

**Source of truth is [`src/relationships.ts`](src/relationships.ts).** This document is the readable companion — if the two ever disagree, the code wins and this file is stale.

---

## Why this exists

The three charts had grown three unrelated vocabularies for the same ideas:

| Chart | Type count | Style |
|---|---|---|
| The Empyrean | 11 | lowercase slugs — `bonded`, `squad`, `killed` |
| Dungeon Crawler Carl | 6 | lowercase slugs — `party`, `ally`, `family` |
| The Plated Prisoner | 21 | English phrases as ids — `"Captor/Captive"`, `"Fated Mates (Päyur)"` |

**38 distinct type strings for roughly 14 concepts**, with real collisions:

- Empyrean's `squad`, DCC's `party`, and Plated Prisoner's `"Wrath (squad)"` all mean the same thing.
- DCC's `family` label read *"Family/Bond"* — folding magical bonds into kinship.
- Plated Prisoner split romance three ways (`"Slow-burn romance"`, `"Love Interest"`, `"Married"`) while Empyrean had one `romantic`.

Without a fixed vocabulary, each new book adds more drift, and the extraction pipeline in Phase 3 has no stable target to aim at.

---

## The two rules that decide everything

### 1. A type is something you would filter by. Everything else is a label.

The charts have a filter bar. A relationship earns its own **type** only if a reader would want to toggle it on and off. Anything more specific goes in the `label`.

That is why Plated Prisoner's three romance types collapse into one:

```
"Slow-burn romance"  →  romantic  + label "slow burn"
"Love Interest"      →  romantic  + label "love interest"
"Married"            →  romantic  + label "married"
```

A reader wants one *"show me the romance"* toggle, not three. Nothing is lost — the nuance moves to the label.

### 2. Direction is part of the definition.

For every directed type, **who goes in the `from` slot is fixed**. Getting this wrong silently inverts meaning: the legend once read *"Killed by"* while the data stored killer → victim, so **every death edge rendered backwards**.

Storage is always directed. **Queries search both directions**, so asking *"who is Violet's family?"* finds edges pointing in and out. One rule, no per-type configuration.

---

## The 14 types

### Kinship and pacts

#### `family` — directed
> A blood, legal, or adoptive kinship tie between two characters.

**`to` IS `from`'s label.** `violet → lilith "mother"` means *Lilith is Violet's mother.*

**Use when** the tie is kinship (parent, child, sibling, cousin, aunt, uncle, grandparent, ancestor), including legal and adoptive; it would still be true if they never spoke again.

**Do not use when**
- They were raised together but are not related → **`friend`**
- One died protecting the other → that is an **event**; the tie is `ally`
- They are married → **`romantic`** with label `"married"`. Marriage is chosen; kinship is not.
- The bond is magical → **`bonded`** or **`mated`**

**Label must be a kinship term** — enforced against `KINSHIP_TERMS`.

---

#### `bonded` — directed · `from` = the person, `to` = the creature
> A binding supernatural pact between a person and a creature, created by the series' magic system and not dissolvable at will.

**Use when** the series treats it as a formal magical pact with mechanical consequences, and breaking it is a named event rather than a change of heart.

**Do not use when**
- Two creatures are fated to each other → **`mated`**
- It is ordinary loyalty → **`ally`** or **`friend`**

**Endpoint rule:** `from` must be `human`; `to` must be `dragon`, `irid`, or `gryphon`.

---

#### `mated` — symmetric
> A permanent, fated pair-bond between two creatures of the same kind, which neither party chose.

**Use when** the series presents the pairing as destined rather than elected.

**Do not use when** the attachment was chosen → **`romantic`**, even when intense or fated-feeling.

**Endpoint rule:** both endpoints must be the same character type.

---

### Romance

#### `romantic` — symmetric
> A mutual romantic or sexual attachment that the characters chose, at any stage from attraction to marriage.

**Use when** both are involved, or one is openly courting the other. Ended relationships still count — label them `"ex"`.

**Do not use when**
- The attraction is one-sided and unwelcome → **`enemy`** or **`complicated`**
- The bond is fated between creatures → **`mated`**
- It is close but explicitly not romantic → **`friend`**

**Labels carry the stage:** `"slow burn"` · `"love interest"` · `"betrothed"` · `"married"` · `"ex"`

---

### Affiliation

#### `squad` — symmetric
> Shared membership of a named formal unit — squad, party, wing, or crew — assigned or joined rather than merely social.

**Use when** both belong to the same named group at the same time, and someone could list its roster.

**Do not use when**
- They are close but not in a shared unit → **`friend`**
- They cooperate across groups → **`ally`**

*DCC's `party` is an alias of this type.*

---

#### `friend` — symmetric
> Personal, non-romantic affection between characters who are not in the same formal unit.

**Do not use when** they share a named unit → **`squad`** already implies closeness.

---

#### `ally` — symmetric
> Cooperation toward a shared goal, without requiring personal closeness. May be transactional or temporary.

**Use when** they work together for a cause, faction, or bargain that would end if the shared interest ended.

**Do not use when**
- One holds formal authority → **`commands`**
- One coerces or uses the other → **`enemy`** or **`captor`**
- The tie is personal → **`friend`**
- The label describes a single incident rather than an ongoing stance → record an **event**

---

#### `commands` — directed · `from` = the superior
> Formal authority of one character over another within an acknowledged hierarchy.

**Do not use when** the control is coercive or magical rather than structural → **`enemy`** or **`captor`**. If the senior party teaches rather than directs → **`mentor`**.

---

#### `mentor` — directed · `from` = the mentor
> One character deliberately teaches, trains, or guides another.

**Do not use when** the authority is positional rather than instructional → **`commands`**. If the guidance is a cover for manipulation → **`betrayer`**.

---

### Antagonism

#### `enemy` — directed · `from` = the aggressor when one-sided
> Active hostility or opposition, from mutual dislike through attempted murder.

**Use when** one acts against the other — **including when the target survived the attempt.**

**Do not use when**
- The target died by their hand → **`killed`**
- They hold the other captive → **`captor`**
- The hostility followed broken trust → **`betrayer`**
- The relationship flipped over the series → **`complicated`**

---

#### `betrayer` — directed · `from` = the betrayer
> One character violated trust the other had deliberately placed in them.

**Use when** there was real trust first, and it was broken.

**Do not use when** they were always hostile — no trust existed to break → **`enemy`**.

---

#### `captor` — directed · `from` = the captor
> One character holds another against their will.

**Use when** confinement is ongoing, not a single scene.

**Do not use when** it is open combat → **`enemy`**; or authority is legitimate and the subordinate may leave → **`commands`**.

---

#### `killed` — directed · `from` = the killer, `to` = the victim
> One character directly caused another's death.

**This is the type that drifts most, so the boundary is strict.**

**Use when** the victim died and this specific, named character is the direct cause.

**Do not use when**
- **The victim survived the attempt → `enemy`. "Struck down" is not "killed".**
- The killer is unnamed or a faceless force → record the death as an **event**
- The character sacrificed themselves → that is an **event**, not a relationship
- Two died together with neither causing it → **`bonded`**, and let both statuses carry the death

**Enforced:** a `killed` edge whose victim has status `alive` is flagged.

---

### Change over time

#### `complicated` — symmetric
> The relationship changed category across the series, or genuinely resists a single label.

**Use when** the pairing moved between categories (enemy → ally, lover → rival), or two categories apply at once and neither dominates.

**Do not use when** one category clearly fits. **`complicated` is not a shortcut for "not sure".**

**Label should show the arc:** `"enemy → ally"` · `"ex-boyfriend"`

---

## Where the old vocabularies map

Full map in `TYPE_ALIASES`. The 21 Plated Prisoner phrase-ids collapse to 11 canonical types:

| Legacy | Canonical | Label |
|---|---|---|
| `party` (DCC) | `squad` | `party` |
| `"Wrath (squad)"` | `squad` | `Wrath squad` |
| `"Slow-burn romance"` | `romantic` | `slow burn` |
| `"Love Interest"` | `romantic` | `love interest` |
| `"Married"` | `romantic` | `married` |
| `"Fated Mates (Päyur)"` | `mated` | `fated mates (Päyur)` |
| `"Sibling"` · `"Parent/Child"` · `"Ancestor"` | `family` | the legacy name |
| `"Captor/Captive"` | `captor` | `captor/captive` |
| `"Commander"` | `commands` | `commander` |
| `"Hostile"` | `enemy` | `hostile` |
| `"Ally"` · `"Political Deal"` · `"Rebellion"` · `"Trusted Guard"` | `ally` | the legacy name |
| `"Mentor / Loyalist"` | `mentor` | `loyalist` |
| `"Sacrifices for"` | `ally` | `sacrificed for them` |
| `"Friend"` | `friend` | — |
| `"Killed"` | `killed` | — |

---

## What CI enforces

| Rule | Severity |
|---|---|
| Every type id is in the canonical vocabulary | **error** |
| A series' `symmetric` flag matches the vocabulary | **error** |
| `family` labels are kinship terms | warning |
| `killed` victims are not `alive` | warning |
| `bonded` joins a person to a creature; `mated` joins matching types | warning |
| Symmetric types have no reversed duplicates | warning |

`npm run validate` exits non-zero on **either**, so both are effectively blocking. Current state: **0 errors, 0 warnings.**

---

## Fixed by this vocabulary

**`fen → brennan` was typed `killed` — but Brennan is `alive`.** His bio reads *"presumed DEAD before the series. Actually alive."* Fen struck him down; he survived. Retyped to `enemy` with label `"struck him down (survived)"`.

This is exactly the drift a definition prevents: `killed` had quietly come to mean "struck down".

**DCC's `party` → `squad`**, so the same concept has one name across all series.

---

## Resolved — all eleven pending edges

Closed 2026-07-27. Each was researched rather than guessed, and applied in the `CORRECTIONS` block of `scripts/extract-charts.mjs` with its reasoning. `VOCAB_PENDING_REVIEW` is now empty; the mechanism stays for the next series.

| Edge | Was | Now | Why |
|---|---|---|---|
| `xaden → liam` | `family` "raised together" | **`friend`** | Both Marked Ones raised together in Tyrrendor after their fathers were executed. Not related. |
| `naolin → brennan` | `family` "died saving him" | **`ally`** | Naolin spent his own life siphoning Brennan back. A sacrifice, not kinship. |
| `leothan → andarna` | `family` "calls her home" | **`mentor`** | He draws her to the Irids to be taught; she severs her bond and leaves with him. |
| `varrish → jack` | `ally` "wields him" | **`commands`** | Vice Commandant over a cadet — direction through the hierarchy, not cooperation. |
| `varrish → nolon` | `ally` "controls him" | **`commands`** | He orders Nolon, a healer under his authority, to mend Jack. |
| `imogen → violet` | `ally` "erased her memory" | **dropped** | `violet → imogen` already carries the pair as `enemy` becoming `ally`; `ally` is symmetric so the reverse adds nothing. The erasure is a book-3 event. |
| `wyvern_rep → theophanie` | `ally` "venin steeds" | **`theophanie → wyvern_rep` `commands`** | Venin *create and ride* wyverns, so the venin is the actor. `bonded` fails twice: its endpoint rule wants a human bonded to a dragon/irid/gryphon, and an Empyrean bond is mutual and unbreakable — a manufactured steed is neither. |
| `wyvern_rep → berwyn` | `ally` "venin steeds" | **`berwyn → wyvern_rep` `commands`** | Same. |
| `donut → kiwi` (DCC) | `family` "family" | **`squad`** "Royal Court" | A Royal Court pet bird, not a relative. |
| `donut → rend` (DCC) | `family` "family" | **`squad`** "Royal Court" | Rend was gifted to **Carl**, who already has his own edge. What remains is shared Royal Court membership. |
| `cull → elore` (PP) | `family` "" | **`family`** "co-parents of Slade" | Slade's father and mother. States what the data supports without asserting a marriage the chart never claims. |

`KINSHIP_TERMS` gained `spouse`, `husband`, `wife`, `co-parent`, `grandson`, `granddaughter` and the great-grand forms, which it had been missing.

Empyrean: 115 source edges → **110** (2 merged duplicates, 2 factually wrong, 1 redundant).

## Adding a new book or series

1. Use only the 14 canonical ids. If something genuinely does not fit, add it to `RELATIONSHIP_TYPES` with a full definition — including its `notWhen` list — rather than reusing a near-miss.
2. Put nuance in the `label`, not in a new type.
3. For directed types, check the `from` slot against the definition above.
4. Run `npm run validate`. Non-canonical types fail the build.
5. If a rule fires but the data is right, add it to `VOCAB_EXCEPTIONS` **with a reason**. Never loosen a rule to silence one edge.
