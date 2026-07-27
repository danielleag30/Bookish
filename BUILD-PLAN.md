# Bookish — Build Plan

Companion to [UPGRADES.md](./UPGRADES.md) · Written 2026-07-24

**Thesis: Bookish becomes your GH-600 capstone lab.** Every phase ships a portfolio artifact *and* gives you hands-on practice for a specific, weighted exam domain. You stop choosing between studying and building.

---

## Part 1 — Your actual skill baseline

I checked `pokemon-tracker`, `post-op-recovery-pwa`, and `policy-navigator-app` rather than guessing. This changes the plan.

### Already proven — don't budget learning time for these

| Skill | Where you've shown it |
|---|---|
| TypeScript | `pokemon-tracker` frontend *and* backend, both with `tsconfig.json`; `build: "tsc && vite build"` |
| Vite | `pokemon-tracker/frontend` |
| React 18 | `pokemon-tracker` — `App.tsx`, 5+ components |
| ESLint | `lint: "eslint src --ext ts,tsx"` |
| GitHub Actions | **three** workflows, incl. cron schedules, `secrets`, and non-zero exit on failure |
| Supabase / edge functions | `pokemon-tracker`, `policy-navigator-app` |
| Express REST API | `pokemon-tracker/backend/src/routes/` |
| Retrieval + eval concepts | `policy-navigator-app` (private — branches show eval cases, temporal judges, scoring fixes) |

**Consequence: Upgrade 1 is mostly transfer work, not learning.** You've already built a TS + Vite + Actions project. Don't spend three weekends re-learning it on Bookish. Budget one to two.

### Genuinely new — this is where the learning time goes

| Skill | Status | Phase |
|---|---|---|
| **Automated testing** | **Zero tests in any repo.** No Vitest/Jest, no `test` script anywhere. Biggest hygiene gap you have. | 0–2 |
| **Zod / runtime schema validation** | Not present anywhere | 1 |
| **LLM structured output / tool use in your own code** | Not in any *public* repo | 3 |
| **Eval harness + metrics** | Concepts yes (Policy Navigator), public implementation no | 4 |
| **Multi-agent orchestration** | New | 5 |
| **MCP server *authoring*** | You're a heavy MCP *client* user; you've never written a server | 6 |
| **GitHub-native agent ops** (custom agents, CI-invoked agents, agent PRs) | New — and it's the largest exam surface | 7 |
| Graph algorithms / force layout | New (optional stretch) | 2 |

**The honest read:** you are further along on engineering than Bookish makes you look, and further behind on *testing* than any repo admits. Phases 0–2 are about closing that gap cheaply; Phases 3–7 are the actual new material.

---

## Part 2 — GH-600 alignment

Official domains, from the [Microsoft Learn study guide for GH-600](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-600) (updated 2026-07-09). Pass mark 700/1000, 40–60 scenario questions, 120 minutes.

| # | Domain | Weight | Covered by |
|---|---|---|---|
| 1 | Prepare agent architecture and SDLC processes | 15–20% | Phases 0, 3, 7 |
| 2 | Implement tool use and environment interaction | **20–25%** | Phases 6, 7 |
| 3 | Manage memory, state, and execution | 10–15% | Phases 5, 6 |
| 4 | Perform evaluation, error analysis, and tuning | 15–20% | Phase 4 |
| 5 | Orchestrate multi-agent coordination | 15–20% | Phase 5 |
| 6 | Implement guardrails and accountability | 10–15% | Phases 6, 7 |

**Two findings that reshape the original UPGRADES.md plan:**

**1. Domain 5 (multi-agent, 15–20%) wasn't covered at all.** Fix: Phase 5 splits the extraction pipeline into specialized agents — extractor, verifier, resolver — running in isolation with real conflict resolution. This isn't padding; cross-chunk entity resolution genuinely *is* a "contradictory outputs" conflict problem, which is the exam's own wording.

**2. GH-600 is GitHub-centric, not generic-AI-centric.** The audience profile says *"using GitHub as the system of record and control plane."* The domain bullets name specific mechanisms: MCP allow lists, MCP registries, agents invoked in CI workflows, branch-based scope, agents creating branches and PRs, inspectable artifacts in standard tooling, human-in-the-loop approval gates.

That means a plain Python script calling an LLM API teaches you almost nothing exam-relevant. Phase 7 exists to fix that, and it's also the most resume-differentiating piece: **an agent that opens pull requests to add new series charts, gated by human review, with eval scores as the merge criterion.**

---

## Part 3 — The phases

Sequential. Each has a **Ship** (the artifact) and a **Domain** (what it teaches for the exam).

### Phase 0 — Foundation
**Ship:** green CI badge on the repo · **Domain:** 1 · **Effort:** 1 evening

1. Resolve the repo location (see Open Decisions below).
2. `LICENSE` (MIT). `.gitignore` for `.DS_Store`, `*.zip`, `node_modules`, `.env`.
3. Delete the 1-line `Plated-Prisoner-Chart/README.md`. Fix the profile-README contradiction ("reading tracker" → visual reference tool).
4. `npm init` + Vite vanilla-TS + Vitest + Zod. Copy the shape of `pokemon-tracker/frontend/package.json` — you already know this.
5. `.github/workflows/ci.yml`: `tsc --noEmit`, `vitest run`, `npm run validate`.
6. **Write one trivial passing test.** Your first ever. Get the loop working before it matters.

**Exam bullets hit:** *Define inputs, outputs, and success criteria for agents* · *Configure agent to produce inspectable artifacts within standard development tooling*

---

### Phase 1 — Schema + data extraction
**Ship:** three validated `data/*.json` files, data separated from view · **Domain:** 1 · **Effort:** 1 weekend

1. `src/schema.ts` — Zod schemas for `Book`, `Band`, `Affiliation`, `RelType`, `Character`, `Relationship`, `Event`, `Series`. Derive TS types with `z.infer` so there's one source of truth.
2. Add **referential-integrity** checks beyond field types:
   - every relationship's `from`/`to` resolves to a real character id
   - every character's `band` and `affil` exist in the series' own lists
   - `book <= lastBook` for every character
   - no duplicate character ids
3. Move Empyrean's inline `NODES`/`BOOKS`/`REL_TYPES`/`EVENTS` out to `data/empyrean.json`. Then DCC, then Plated Prisoner.
4. `npm run validate` — parse every file in `data/`, exit non-zero on failure. Wire into CI.
5. Tests: assert the validator *rejects* each broken case above.

> **Expect this to fail on your real data the first time.** 72 characters and 115 relationships entered by hand across months — there will be a dangling relationship endpoint or a `lastBook` typo in there. Finding them is the schema earning its keep on day one, and "the validator caught N real integrity errors in my own hand-entered data" is a good line for the README.

---

### Phase 1.5 — Spoiler-safe ask box ← **first visible feature**
**Ship:** a sidebar panel you can actually use, on the live site · **Domain:** 6 (guardrails, in the data layer) · **Effort:** 1 weekend

Added after the original plan was written, because Phases 1–2 are invisible plumbing and there needs to be something clickable early.

**The key realization: the spoiler locker needs no LLM.** The data is already structured — every character carries `book` and `lastBook`. So "who is Xaden bonded to as of book 2?" is a *filter*, not a generation problem. That makes this feature free, instant, offline-capable, and permanently available to every public visitor.

1. Sidebar panel inside each chart page, beside the graph.
2. **Reading position is the chart's existing book selector** — the ask box and the graph never disagree.
3. Answers, all by filtering/traversal: who is X bonded to · who is alive as of book *k* · how are X and Y connected (path walk) · list characters by faction or type.
4. **The spoiler filter must be exactly one shared function.** Phase 6's MCP server reuses that same function. The guardrail gets implemented once, in the data layer — never in a prompt.
5. Tests: at reading position *k*, no answer may reference any entity whose `book > k`, via any question shape.

Phase 6 later layers optional natural-language handling on top, using local Ollama, for messy questions like *"who's the mean dragon lady again."* The deterministic path stays the default so the public feature never depends on a model being available.

---

### Phase 2 — Engine extraction
**Ship:** one engine, three data files, zero duplicated render logic · **Domain:** — (pure engineering) · **Effort:** 1–2 weekends

1. `src/engine/` — split Empyrean's canonical versions into `shapes.ts`, `edges.ts`, `layout.ts`, `state.ts`, `render.ts`, `interactions.ts`.
2. Single entry point: `mountChart(el, series, options)`.
3. Port DCC onto it and **delete its 12 duplicate functions** (`mk`, `getRC`, `getRD`, `curvePath`, `renderCtrl`, `bookBtn`, `renderRelBar`, `renderSVG`, `renderLegend`, `applySidebar`, `renderSidebar`, `render`).
4. Port Plated Prisoner off React + Babel-Standalone onto the same engine. Losing the "one chart is React" asterisk is worth more than the namedrop.
5. **Tests on the temporal logic** — this is the part worth protecting:
   - character with `book: 3` is hidden at book 2
   - character with `lastBook: 2` drops out at book 3
   - edge is visible only when both endpoints are visible *and* its type is enabled
   - "introduced this book" ring appears only when `book === currentBook`
6. Record the real duplication number: `git diff --stat`. Use it in the resume bullet.

**Stretch:** replace the ~50-line `Y_OFFSETS` pixel-nudge table with `d3-force`, seeded by band. Good algorithms practice, kills the most brittle code in the repo.

---

### Phase 3 — Extraction pipeline (single agent)
**Ship:** text in → schema-valid graph out · **Domain:** 1 · **Effort:** 1 weekend

1. **Input:** plot summaries, your own reading notes, or public synopses. **Not** copyrighted book text. Say so explicitly in the README.
2. `pipeline/extract.ts` — pass the Phase 1 Zod schema as the **tool input schema** so the model is constrained to valid graph shape.
3. Validation failure → feed the error back and retry, bounded (3 attempts, then escalate).
4. **Separate planning from execution.** The agent first emits a structured *plan* ("I will extract these 14 characters from this chapter"), the plan is validated against the schema, and only then does extraction run. This is a direct Domain 1 requirement, not extra credit.
5. Chunk by chapter/section — a book won't fit in one call. Each chunk yields a partial graph.
6. Log tokens and cost per run to a JSON artifact.

**Exam bullets hit:** *Configure agent planning to be distinct from agent execution* · *Configure an agent to output a structured plan* · *Validate agent plans* · *Prevent agent action until the agent checked and approved* · *Implement error handling / retries / escalation paths*

---

### Phase 4 — Eval harness ← **the resume centerpiece**
**Ship:** `evals/results.md` with a real score history · **Domain:** 4 · **Effort:** 1 weekend

Your unfair advantage: **72 characters and 115 typed relationships you hand-labeled yourself, with per-book temporal boundaries.** Almost nobody's portfolio project has ground truth. Hold Empyrean back as the eval set.

1. `evals/compare.ts` — given predicted graph vs. ground truth, compute:
   - node precision / recall / F1
   - edge precision / recall / F1 **broken out per relationship type**
   - **temporal leak count**: for a book-*k* extraction, how many entities have true `book > k`
2. Decide the entity-resolution rule and write it down. Is "Xaden Riorson" the same node as "Xaden"? Normalize case, strip titles, keep an alias list. This decision materially moves your scores — document it so the numbers mean something.
3. **Commit `evals/results.md` and append a row every run.** A visible history of F1 climbing over prompt iterations is far more persuasive than a single final number.
4. **Classify every failure** as reasoning error / tool misuse / context or environment issue — the exam's own taxonomy. Put the table in the README.
5. CI: run evals on PR, upload results as a workflow artifact, **fail the build if F1 regresses** below a committed threshold.
6. Then run the pipeline on a series you haven't charted, hand-correct the output, and time it. Compare to charting from scratch. That's your "does this actually save work" number.

**Exam bullets hit:** *Identify qualitative and quantitative evaluation signals* · *Identify failures by using logs, plans, traces, outputs, and workflow artifacts* · *Classify root causes, including reasoning errors, tool misuse, and context or environment issues* · *Tune agent behavior based on evaluation results*

> Write up the failure modes honestly. **The failures are more impressive than the successes** — they prove you actually looked.

---

### Phase 5 — Multi-agent pipeline
**Ship:** three specialized agents with audited handoffs · **Domain:** 5, 3 · **Effort:** 1–2 weekends

Split Phase 3's single agent into a coordinated set:

- **Extractor** — one instance per chunk, running in parallel, isolated from each other
- **Verifier** — checks each extracted relationship against the source text, flags unsupported claims
- **Resolver** — merges chunk graphs, resolves entity conflicts and contradictory outputs

1. Configure genuine isolation for the parallel extractors.
2. **Conflict detection:** same character extracted from two chunks with contradictory `status` or `affil` → the resolver decides *and logs why*. This is the exam's "contradictory outputs" case, arising naturally.
3. Log every handoff and decision to a workflow artifact suitable for audit.
4. Recovery: a stalled or partial chunk retries, then escalates to human-in-the-loop.
5. **Re-run the Phase 4 evals.** Does multi-agent actually beat single-agent? Put both rows in `results.md`. If it doesn't, that's a *more* interesting finding than if it does — say so.

**Exam bullets hit:** *Apply an orchestration pattern* · *Configure agent isolation for parallel execution* · *Detect and resolve agent conflicts, including duplicated effort and contradictory outputs* · *Document key decisions, handoffs, and outcomes across agents* · *Implement multi-agent recovery patterns, including rollback and human-in-the-loop* · *Capture task progress and decisions as durable artifacts*

---

### Phase 6 — Spoiler-bounded MCP server
**Ship:** a screen-recordable demo · **Domain:** 2 (largest), 6, 3 · **Effort:** 1–2 weekends

1. `mcp/server.ts` with `@modelcontextprotocol/sdk`. Loads the validated JSON from Phase 1 — no DB, no scraping.
2. Tools: `set_reading_position`, `search_characters`, `get_character`, `get_relationships`, `get_events_for_book`, `find_path`.
3. **Reading position is agent state** — short-term vs. persisted, with defined reset rules (Domain 3).
4. **The spoiler filter lives in ONE shared function that every handler calls.** The claim worth making: filtering happens in the *tool layer, not the prompt*, so no amount of clever prompting extracts book-3 data at reading position 2.
5. **Adversarial test suite** — set position to book 1, then attempt extraction via: exact ID lookup, fuzzy name search, relationship traversal from a book-1 character, the event log, and `find_path`. All five must return empty or refuse. **This test file is the artifact to point interviewers at.**
6. Configure tool permissions and an MCP allow list.
7. Record the demo GIF: ask about book 2 → correct answer; ask about book 4 → correct refusal.

**Exam bullets hit:** *Add an MCP server as a tool to an agent* · *Configure MCP allow lists* · *Configure agent tool permissions* · *Scope permissions and execution contexts to enforce least-privilege access* · *Block actions that violate defined policies* · *Choose between short-term, long-term, and external memory*

---

### Phase 7 — GitHub-native agent ops
**Ship:** an agent that opens reviewed PRs · **Domain:** 1, 2, 6 · **Effort:** 1 weekend

This is what makes the project *exam-shaped* instead of *generic-AI-shaped*, and it's the strongest single thing on the list for a resume.

1. `.github/copilot-instructions.md` + a **custom agent** definition for "add a new series chart."
2. **Agent invoked from a CI workflow**, scoped to this repo, on a branch.
3. Agent **opens a pull request** with the extracted graph — never commits to `main`.
4. **Human-in-the-loop gate:** a GitHub Environment with a required reviewer, so the merge needs explicit authorization.
5. Every run uploads its plan, trace, and eval scores as workflow artifacts.
6. **Autonomy-level table in the README:** classify each agent action by risk, and state which run unattended vs. which require approval.

**Exam bullets hit:** *Configure an agent to be invoked in a CI workflow* · *Configure an agent's scope to a specific repository* · *Configure an agent to use branch-based scope* · *Enable an agent to perform autonomous actions, including creating branches and pull requests* · *Define autonomy levels* · *Classify agent actions by operational, security, and compliance risk* · *Require explicit authorization for irreversible changes* · *Configure human intervention without slowing delivery*

---

## Part 4 — Timeline

Roughly 8–11 weekends, which maps onto an 8-week study plan if you pair each phase with that week's reading.

```
Phase 0  Foundation ............... 1 evening    │ Domain 1
Phase 1  Schema + data ............ 1 weekend    │ Domain 1
Phase 2  Engine extraction ........ 1–2 weekends │ —
Phase 3  Pipeline (single agent) ... 1 weekend    │ Domain 1
Phase 4  Eval harness ★ ........... 1 weekend    │ Domain 4
Phase 5  Multi-agent .............. 1–2 weekends │ Domain 5, 3
Phase 6  MCP server ............... 1–2 weekends │ Domain 2, 6, 3
Phase 7  GitHub agent ops ......... 1 weekend    │ Domain 1, 2, 6
```

**If time gets short:** Phases 0 → 1 → 4 → 6 → 7. That covers every exam domain except 5, keeps the eval centerpiece and the MCP demo, and skips the pure-refactor work in Phase 2 (do the DCC dedup only, leave Plated Prisoner in React). Phase 2 is the least exam-relevant phase — it's there for engineering credibility, not GH-600.

**Domain coverage check:** 1 ✅ (0,3,7) · 2 ✅ (6,7) · 3 ✅ (5,6) · 4 ✅ (4) · 5 ✅ (5) · 6 ✅ (6,7) — all six covered.

---

## Part 5 — Study-loop suggestion

Each week: read the domain's Microsoft Learn module and docs **first**, then build that week's phase, then write a short `notes/domain-N.md` in `dani-gh600-lab` linking to the Bookish commit that implements it.

That gives you a defensible answer to the strongest interview question about a certification — *"what did you actually build with it?"* — plus a public trail of learning-in-public, which your profile README already commits to.

---

## Decisions made — 2026-07-24

1. **Repo location:** `~/Documents/Claude/Projects/Bookish` — cloned fresh, verified as its own git root with `origin` → `danielleag30/Bookish`. The old `~/Documents/Claude/Bookish/` folder was **not** the repo (stray `index.html`, `files.zip`, duplicate PNG, nested inside a git repo rooted at `~` whose remote is `post-op-recovery-pwa`). Left untouched for you to inspect and delete.
2. **Scope:** all seven phases.
3. **LLM: local Ollama — total cost $0.**

### Why Ollama is the right call, not a compromise

Hardware checked: **Apple M5 MacBook Air, 24 GB RAM**, Ollama 0.32.1 already installed, `gemma4:latest` (9.6 GB) local. Node v26.5.0. Policy Navigator already has an `ollama-client` task branch — so this is transfer work, not new learning.

**Verified before committing.** A four-sentence Empyrean passage was run through `gemma4` via `/api/chat` with a JSON-schema `format` constraint:

- **Schema compliance was perfect** — valid JSON, every enum respected, all required fields present. Structured output works locally.
- **The content had seven real errors**, and every one is something a later phase is designed to catch:

| Error observed | Caught by |
|---|---|
| `Colonel Aetos` and `Basgiath War College` appear in relationships but **not** in the characters array — dangling endpoints | **Phase 1** referential integrity, mechanically |
| `Lilith → Basgiath War College` typed `romantic` — hallucinated edge to a *building* | **Phase 5** verifier agent |
| Violet↔Lilith typed `mentor` — she is Violet's **mother** | **Phase 4** reasoning-error classification |
| Dain→Violet typed `family` — source says "childhood friend" | **Phase 4** reasoning-error classification |
| `id` = `"Violet Sorrengail"`; real data uses slugs (`violet`) | **Phase 4** entity resolution |
| `label` filled with `"Dragon Companion"`, `"Protagonist/Character"` instead of names | Schema field descriptions — a *design* failure, not a model failure. Fix in Phase 3. |
| Duplicate bidirectional `mentor` edges | **Phase 5** duplicated-effort conflict detection |

**A weak local model is pedagogically superior here.** Domain 4 is *"Perform evaluation, error analysis, and tuning"* — you need errors to analyze. A frontier model would score ~0.9 F1 on this passage and leave you nothing to tune. `gemma4` gives a rich error surface and real headroom to move, which is the whole point of the phase.

**Measured baseline: 48 seconds for four sentences.** A full book serially would take hours. That is a self-discovered, honest motivation for Phase 5's parallel isolation rather than a contrived one — and a number worth quoting in the README.

**Cost boundaries:**
- Local models (`gemma4`) — $0, unlimited. Pipeline is pinned to these for Phases 3–5, where prompt iteration means hundreds of calls.
- The `:cloud`-tagged models already in your Ollama list (`glm-5.2:cloud`, `kimi-k2.7-code:cloud`, `deepseek-v4-pro:cloud`, …) run on **Ollama's servers, not your Mac** — free tier with limits. Not used by the pipeline.
- Phase 7 uses **GitHub Models free tier** — $0 at low call volume, and exam-aligned where it counts.

**One tradeoff to name honestly:** Ollama is not GitHub-centric, so Phases 3–5 teach you eval and orchestration design but not the GitHub agent surface the exam tests. Phase 7 is what closes that gap — do not skip it.

---

## Sources

- [Study guide for Exam GH-600: Developing in Agentic AI Systems — Microsoft Learn](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-600)
- [GitHub Certified: Agentic AI Developer — certification page](https://learn.microsoft.com/en-us/credentials/certifications/agentic-ai-developer)
- [jtur671/gh-600-study-guide — free flashcards, mock exam, labs](https://github.com/jtur671/gh-600-study-guide)
- [GitHub GH-600 career guide — dotcreds](https://dotcreds.com/github-agentic-ai-developer-gh-600-career-guide.html)
