# Bookish — Repo Review & Top 3 Resume Upgrades

Reviewed: 2026-07-24 · Repo: [danielleag30/Bookish](https://github.com/danielleag30/Bookish) · Live: bookish-bay.vercel.app

---

## Where the repo actually stands

**12 tracked files. 3,664 lines. Three charts.**

| File | Lines | Implementation |
|---|---|---|
| `Empyrean-Chart/index.html` | 2,152 | Vanilla JS + hand-built SVG |
| `DCC-Chart/index.html` | 783 | Vanilla JS + hand-built SVG |
| `Plated-Prisoner-Chart/index.html` | 426 | React 18 via CDN + Babel Standalone |
| `index.html` (landing) | 185 | Static gallery |

### What's genuinely good (don't lose this)

- **The Empyrean data is a real asset.** 72 characters, 115 relationships, each node carrying `type`, `affil`, `band`, `book`, `lastBook`, `status`, and a written `bio`. Relationships are typed. Events are tracked per book. This is *hand-labeled structured data*, and it's the most valuable thing in the repo — see Upgrade 2.
- The rendering is real work, not a library call: `makeShape` dispatches per character type, `curvePath` computes bezier edges, pan/zoom/drag is hand-wired with `mousedown`/`mousemove`/`wheel` listeners.
- The README already explains *why* vanilla JS was chosen and defends it credibly.
- Temporal modeling is the interesting idea here — `book` / `lastBook` per node driving visibility is a spoiler boundary, which is a more sophisticated concept than most portfolio projects contain.

### What a hiring manager will notice as gaps

1. **The engine is copy-pasted, not shared.** Empyrean and DCC share these 12 functions by *identical name*: `mk`, `getRC`, `getRD`, `curvePath`, `renderCtrl`, `bookBtn`, `renderRelBar`, `renderSVG`, `renderLegend`, `applySidebar`, `renderSidebar`, `render`. Fixing a pan bug means fixing it twice. Plated Prisoner is a *third* implementation of the same concept in a different paradigm. This is the single most visible engineering smell.
2. **Zero tests, zero CI, zero types.** No `package.json`, no test runner, no GitHub Actions, no linter, no `LICENSE`. Nothing proves the code works except opening it.
3. **Data and view are fused.** `NODES`, `BOOKS`, `REL_TYPES`, `Y_OFFSETS` are inline `const`s inside a `<script>` tag in the same file as the CSS and render loop. There is no schema, so nothing can validate the data or consume it.
4. **Layout is manually tuned and brittle.** `Y_OFFSETS` is a hardcoded table of ~50 pixel nudges with comments like `// increased 50%`. Adding a character to the riders band means hand-adjusting neighbors.
5. **Nothing here signals AI engineering** — which is the field you're targeting. This repo is currently a frontend/dataviz project.
6. **Positioning is inconsistent.** Your profile README calls Bookish a "personal reading tracker." The repo README explicitly says "This is *not* a reading tracker." Pick one — the repo's version is the better story.
7. **`Plated-Prisoner-Chart/README.md` is 1 line.** And `DCC-Chart/` is in the repo but deploys elsewhere, which the README has to apologize for.

---

## The Top 3 Upgrades

These are ordered deliberately. **#1 unlocks #2 and #3** — without a schema there is nothing for an AI pipeline to target and nothing for a tool to query. Do them in order.

---

## Upgrade 1 — Extract a typed, data-driven chart engine

**Turn three copy-pasted HTML files into one tested engine + three data files.**

### Why this boosts the resume

This is the upgrade that makes the repo *look like it was written by an engineer* rather than assembled. Right now the story is "I built three charts." After this it's "I built a graph-rendering engine and drove it from validated data." It also converts your defensible-but-defensive README section ("Why Hand-Built SVG, No Framework") into an unambiguous strength: you kept the hand-rolled renderer *and* gave it a real architecture.

Concretely it lets you claim TypeScript, schema validation, unit testing, and CI — four things currently absent from every public repo you have.

### What you'll learn

- **TypeScript** — this is the highest-value single skill on the list, and a graph engine is an ideal place to learn it. `Node`, `Edge`, `RelType`, `Band` are natural interfaces; discriminated unions fall out of `type: "human" | "dragon" | "god"`.
- **Vite** — build tooling without the webpack pain. `npm create vite@latest`.
- **Zod** — runtime schema validation. Define the series schema once, parse the data, get types for free via `z.infer`.
- **Vitest** — unit testing. Pure functions like `curvePath`, `getRC`, and visibility filtering are the easiest possible first tests.
- **GitHub Actions** — typecheck + test on every PR. Also directly relevant to GH-600.

### How to approach it

1. `npm create vite@latest` with the vanilla-TS template. Keep Vercel deployment — Vite output deploys the same way.
2. Define the schema first, in `src/schema.ts`. Model it on what Empyrean already has:
   ```ts
   const Character = z.object({
     id: z.string(),
     label: z.string(),
     role: z.string(),
     type: z.enum(["human","dragon","wyvern","gryphon","venin","irid","god"]),
     affil: z.string(),
     band: z.string(),
     book: z.number().int(),        // first appearance
     lastBook: z.number().int(),    // last appearance
     status: z.enum(["alive","dead","unknown"]),
     bio: z.string(),
   });
   ```
   The schema should describe a **series**, not a chart: books, bands, affiliations, relationship types, characters, relationships, events.
3. Move Empyrean's data out to `data/empyrean.json` and validate it with the schema. Expect the validator to find real inconsistencies in the hand-entered data — that's the schema earning its keep on day one.
4. Extract the shared functions into `src/engine/`. Take Empyrean's versions (they're the most complete) and make DCC use them. Delete DCC's copies.
5. **Port Plated Prisoner off React onto the same engine.** Losing the "one chart is React" asterisk is worth more than keeping the React namedrop — you have React elsewhere on your profile.
6. Write tests for the pure logic: does a character introduced in book 3 stay hidden at book 2? Does `lastBook` correctly drop them? Does edge filtering respect the type toggles? These tests are *about the spoiler boundary*, which is the feature worth protecting.
7. Add `.github/workflows/ci.yml` running `tsc --noEmit`, `vitest run`, and a schema-validation step over every file in `data/`.
8. Add a `LICENSE` (MIT).

**Optional stretch:** replace `Y_OFFSETS` with a force-directed layout (`d3-force`) or a simple constraint solver, seeded by band. This kills the 50-line pixel-nudge table and is a genuinely interesting algorithms problem.

### Resume bullet it earns you

> Refactored three duplicated ~2k-line HTML prototypes into a single typed SVG graph-rendering engine driven by Zod-validated series data; eliminated [N] lines of duplicated render logic, added unit tests around temporal visibility rules, and gated changes with a GitHub Actions typecheck/test/schema-validation pipeline.

*(Measure N yourself with `git diff --stat` when you're done — use the real number.)*

**Effort:** 2–3 weekends. This is the long one, and it's the prerequisite.

---

## Upgrade 2 — An LLM extraction pipeline, evaluated against your hand-labeled graph

**Build a pipeline that reads source material and emits schema-valid character graphs — then prove how well it works using Empyrean as ground truth.**

### Why this boosts the resume

**This is the one to prioritize if you only do one.** Here's why it's unusually strong for you specifically:

You already have something almost nobody building an AI portfolio project has: **a hand-labeled ground-truth dataset.** 72 characters and 115 typed relationships that *you* curated, with per-book temporal boundaries. That means you can do the thing that actually separates AI engineers from people who write prompts — **measure whether the model is right.**

Precision and recall per relationship type. Where does extraction fail? Does it hallucinate relationships that don't exist? Does it get `bonded` right but confuse `allies` with `rivals`? Does it leak book-4 information into a book-2 extraction? Those are real findings, and being able to talk about them in an interview is the whole game.

This also visibly connects to your Policy Navigator work (retrieval + eval + structured output) but in a **public** repo someone can actually click on.

### What you'll learn

- **Structured output / schema-constrained generation** — using the Zod schema from Upgrade 1 as a tool-input schema so the model *must* return valid graph data. This is the single most practical LLM engineering technique.
- **Eval harness design** — the real skill. Building the graph-comparison logic, choosing metrics, deciding what counts as a match (is "Xaden Riorson" the same node as "Xaden"? entity resolution is a genuine problem here).
- **Prompt iteration measured against a baseline** rather than vibes. Keep a results table, commit it, watch it move.
- **Chunking and long-context tradeoffs** — a book's worth of text doesn't fit in one call. Do you chunk by chapter and merge graphs? How do you dedupe nodes across chunks? This is the interesting part.
- **Cost and token accounting** — track spend per run. Interviewers notice when you can talk about this.
- Load the `claude-api` skill before you start for current model IDs, pricing, and tool-use patterns.

### How to approach it

1. **Don't start with book text.** Start with something you can legally and cheaply feed in — plot summaries, your own notes, or public synopses. The pipeline is the point, not the corpus. Be explicit in the README about what the input is.
2. Build `pipeline/extract.ts`: input text + the series schema → tool-use call → schema-valid JSON. Reuse the Upgrade 1 schema directly. Validation failure = retry with the error fed back.
3. Build `evals/compare.ts`: given a predicted graph and the ground-truth graph, compute
   - node precision / recall / F1
   - edge precision / recall / F1, **broken out per relationship type**
   - a temporal-leak check: for a book-*k* extraction, count entities whose true `book > k`
4. Hold Empyrean back as your eval set. Iterate prompts against it. **Commit `evals/results.md` and update it each run** — a visible history of scores improving is extremely persuasive.
5. Then run the pipeline on a series you *haven't* hand-charted and see what it produces cold. Hand-correct it. Note how long the correction took versus charting from scratch — that's your "does this actually save work" number.
6. Write up the failure modes in the README. **The failures are more impressive than the successes** — they prove you looked.

### Resume bullet it earns you

> Built an LLM extraction pipeline producing schema-validated character-relationship graphs from narrative text, with an eval harness scoring node/edge precision and recall per relationship type against a hand-labeled 72-node / 115-edge ground-truth graph; raised edge F1 from [X] to [Y] over [N] prompt iterations and documented residual failure modes including cross-chunk entity resolution and temporal information leakage.

*(Fill in real numbers from your own results table.)*

**Effort:** 2–4 weekends. Highest resume return per hour of the three.

---

## Upgrade 3 — A spoiler-bounded MCP server over the graph

**Expose the graph as tools an AI agent can call — with the reading position enforced as a hard boundary the model cannot cross.**

### Why this boosts the resume

Three things at once:

- **MCP is on your stack list and it's GH-600 material.** Building a real server is worth more than listing the acronym.
- **It's a demo you can screen-record.** Open Claude Desktop, ask "who is Xaden bonded to as of book 2?", get a correct spoiler-free answer, then ask about book 4 and watch it correctly refuse. That video is worth more than any README paragraph.
- **The spoiler boundary is a genuine guardrail problem.** The interesting engineering claim is that the filtering happens **in the tool layer, not the prompt** — the server never returns book-3 data when the reading position is book 2, so no amount of clever prompting can extract it. That is exactly how you're supposed to reason about capability boundaries, and it's a real, concrete, demonstrable version of an idea most people only talk about abstractly.

### What you'll learn

- **MCP server authoring** — tool definitions, input schemas, transports. Use the official TypeScript SDK.
- **Tool design for agents** — the hard part isn't the code, it's deciding what the tools *are*. Probably: `search_characters`, `get_character`, `get_relationships`, `get_events_for_book`, `set_reading_position`. Each needs a description good enough that a model picks correctly without hand-holding.
- **Enforcing constraints at the boundary** rather than trusting the model — filter inside the tool handler, always.
- **Graph traversal** — "who is connected to X within 2 hops, as of book k" is a nice constrained BFS.
- **Testing an agentic surface** — write cases that *try* to extract spoilers and assert the tool refuses. This is your first adversarial test suite.

### How to approach it

1. `mcp/server.ts` using `@modelcontextprotocol/sdk`. Load the validated JSON data from Upgrade 1 — no scraping, no DB, just the files.
2. Implement `set_reading_position(series, book)` as server state, then make **every** other tool filter against it. The filter must live in one shared function that every handler calls.
3. Write the adversarial tests: set position to book 1, then ask for a book-4 character by exact ID, by partial name, via relationship traversal from a book-1 character, and via the event log. All four must come back empty or refused. **This test file is the artifact worth pointing at.**
4. Add setup instructions and a recorded demo GIF to the README.
5. Stretch: a small web chat UI on the site itself, so it's usable without Claude Desktop.

### Resume bullet it earns you

> Authored an MCP server exposing a character-relationship graph as typed agent tools, enforcing a per-user reading-position boundary in the tool layer so spoiler data is unreachable regardless of prompting; validated with an adversarial test suite covering direct lookup, fuzzy search, relationship traversal, and event-log extraction paths.

**Effort:** 1–2 weekends after Upgrade 1. Best effort-to-impressiveness ratio of the three.

---

## Quick wins — do these first, they take an evening total

- [ ] Add a `LICENSE` (MIT).
- [ ] Fix the positioning contradiction: your profile README says "personal reading tracker," the repo README says it isn't one. The repo is right — update the profile.
- [ ] Add `.DS_Store` and `*.zip` to `.gitignore`. The local folder has a stray `files.zip` and a duplicate `Plated_Prisoner.png`.
- [ ] Delete or fill in the 1-line `Plated-Prisoner-Chart/README.md`.
- [ ] Resolve the DCC split-deployment situation — it's the first roadmap item and it's currently a caveat the README has to explain away.
- [ ] Add a screenshot or GIF of the *interaction* (pan/zoom/book-stepping) to the README. The hero banner shows the idea; a GIF shows it works.

---

## What I'd skip

- **Adding auth / accounts / a database.** You already demonstrate Supabase on pokemon-tracker. Marginal learning value here is low, and it would compromise the genuinely appealing "no backend, no build step" property.
- **Migrating everything to Next.js.** Nothing in this project needs SSR or routing. It would be resume padding, and worse, it undercuts the strongest paragraph in your README.
- **More series charts.** Fifth chart, same skills. Depth beats breadth for a portfolio — one chart with a schema, tests, an eval harness, and an agent interface outranks six hand-built charts.

---

## Suggested order

```
Quick wins (1 evening)
        ↓
Upgrade 1 — typed engine + schema + tests + CI      ← unlocks the other two
        ↓
Upgrade 2 — extraction pipeline + eval harness      ← the resume centerpiece
        ↓
Upgrade 3 — spoiler-bounded MCP server              ← the demo
```

If you have limited time and want maximum resume movement: do the quick wins, then a **minimal** version of Upgrade 1 (schema + data extraction + CI, skip the Plated Prisoner port and the force layout), then go straight to Upgrade 2. Upgrade 2 is what makes this an AI engineering project instead of a dataviz project.
