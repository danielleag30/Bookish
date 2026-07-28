# Eval harness

Scores the extraction pipeline against hand-labelled ground truth.

```bash
npm run eval                                    # empyrean, all books
npm run eval -- --series dcc --book 3
npm run eval -- --note "shorter prompt"         # the note lands in results.md
```

Requires a local Ollama (`ollama serve`). **Cost is always $0** — nothing leaves the machine.

---

## Why this exists

Anyone can call a model and eyeball the output. The reason this repo has an eval harness is that it has something most portfolio projects don't: **72 characters and 110 typed relationships, hand-curated, with per-book temporal boundaries.** That is ground truth, so the pipeline can be measured instead of admired.

Score history lives in [results.md](results.md), committed on purpose. A single number says nothing; a number moving over successive changes is the evidence.

---

## The corpus, and what it is not

**It is each series' own one-line event log.** For Empyrean at book 1 that is eight lines, one chunk per book.

**It is not book text.** The novels are copyrighted and not ours to process. Nothing in this repo ingests them.

That choice has a consequence worth being explicit about: an eight-line event log cannot mention 49 characters, so **overall recall is capped by the corpus, not by the model.** The harness therefore reports two node scores:

| Metric | What it measures |
|---|---|
| `nodes` | Against every truth character visible at that reading position. Dominated by the corpus ceiling. |
| `nodes in corpus` | Against only the truth characters the corpus actually names. **This is the model's score** — the one that moves when the prompt changes. |

The gap between them is reported as `outOfCorpus` and classified as `context: not in corpus` — a corpus limit, explicitly not a model error.

It is also not circular. The event log contains plot beats, not the answer key: it never states a relationship type, an affiliation, a status, or the character list. The model has to infer `bonded` from *"bonds TWO dragons (Tairn & Andarna)"*.

---

## Scoring rules

Every judgement call is written down in [compare.ts](compare.ts), because these move the numbers more than the model does.

### Entity resolution

Predicted ids are matched to truth by normalising — lowercase, strip punctuation and titles, try the given name and the surname alone. So `violet`, `Violet Sorrengail` and `violet_sorrengail` all resolve to the same character, and declared `aliases` are included, so `Slade Ravinger` resolves to `rip`.

Two guards:

- **An ambiguous name resolves to nobody.** `Sorrengail` could mean any of five characters, so it is dropped rather than credited to whichever was seen first. A wrong hit is worse than a miss.
- **An exact id always wins.** `king_tauri` normalises to `tauri`, which collides with `Aaric / Cam Tauri` — so ids are registered separately and survive the ambiguity sweep. *Missing this was a real bug: it cost 16 points of in-corpus F1 before it was found.*

### Edges

Scored **directed for directed types, undirected for symmetric ones.** `romantic` reads the same both ways, so scoring it directed would punish a coin flip. `killed` does not — getting it backwards is a real error, and was a real error in the source data.

Three failure modes are separated rather than lumped into "wrong":

| Class | Meaning |
|---|---|
| **reversed** | Right pair, right type, backwards on a directed type |
| **wrong type** | Right pair, wrong relationship type |
| **spurious** | No such relationship in truth at all |

All three count as a false positive *and* leave a truth edge unfound, so they are penalised twice. That is intended: a confident wrong answer is worse than silence.

### Temporal leaks

Counts predicted entities whose true first book is later than the reading position. **This is the failure the project exists to prevent** — the whole point of the chart is that it does not get ahead of you.

---

## Failure taxonomy

[taxonomy.ts](taxonomy.ts) sorts failures into GH-600 Domain 4's own buckets — reasoning errors, tool misuse, context and environment issues — plus a guardrail class for leaks.

The label is not the value. The value is that a run tells you **which bucket grew**, so the next change has a target instead of being a guess.

---

## Plan, then act

Each chunk costs two calls. The first asks only for a plan — which characters the model intends to extract, and a one-line summary. That plan is validated (does it name people who actually appear? is the summary non-empty?) **before** the extraction call is paid for.

A plan naming characters absent from the passage is a cheap early signal, and a plan naming nobody skips the chunk entirely. Structural errors in the extraction — a relationship pointing at an id missing from its own character list — are fed back and retried, bounded at three attempts, after which the usable part is salvaged rather than the whole chunk discarded.

---

## What CI does and does not run

CI runs the **scorer** — [`tests/evals.test.ts`](../tests/evals.test.ts) covers entity resolution, the reversed/wrong-type/spurious split, the corpus-ceiling separation, plan and output validation, and chunk merging.

CI does **not** run the pipeline. It has no local model, and pretending otherwise would mean either shipping credentials or letting a network model quietly replace the local one. Running the pipeline is a local step; its results are committed as evidence.

---

## Reading a run

```
nodes            P 90.0  R 18.4  F1 30.5
nodes in corpus  P 90.0  R 100.0  F1 94.7   <- the model's actual score
                 36 truth characters the corpus never names
edges            P 75.0  R 9.5  F1 16.9
```

Per-type breakdown is where the diagnosis lives. From the baseline run:

- `romantic` 100 — one edge, stated plainly in the text
- `squad` 42.9 — finds squadmates when the text names them together
- `bonded` 22.2 — gets Violet's two dragons, misses the other fourteen bonds the log never mentions
- `family`, `enemy`, `mentor`, `killed`, `ally` all 0 — the event log states almost no kinship or antagonism directly

That last line is the useful one. It says the next improvement is corpus coverage, not prompt wording — and that is a conclusion, not a hunch.

---

## Single agent vs three: the honest comparison

Empyrean, books 1–3, `gemma4` local, identical corpus.

| | single | multi | |
|---|---|---|---|
| node precision | 75.9 | **84.6** | ↑ |
| node F1 (in corpus) | 83.0 | **85.7** | ↑ |
| **edge precision** | 52.4 | **69.2** | ↑↑ |
| edge recall | 10.0 | 8.2 | ↓ |
| **edge F1** | **16.8** | 14.6 | ↓ |
| spurious edges | 4 | **0** | ↓↓ |
| wrong type | 6 | **4** | ↓ |
| temporal leaks | 0 | 0 | — |
| wall clock | 356s | 524s | ↑ |
| calls | 6 | 9 | ↑ |

**The verifier did exactly what it was built to do, and edge F1 still went down.**

Spurious edges went to zero and edge precision rose by 17 points. But recall fell, because rejecting a claim costs a true positive when the verifier is wrong — and F1 punishes that more than it rewards the precision gain.

Both rejections are worth reading:

> ✗ `Cordella — friend — Trager` — *"The passage states that Cordella 'forms relationship' with Trager. This does not explicitly state they are friends."*

Correct. The truth type is `romantic`, so the verifier caught a wrong-type error the extractor made.

> ✗ `Imogen — betrayer — Violet` — *"The passage only states that Imogen erased Violet's memory. It does not state or imply that this action constitutes betrayal."*

Also defensible on the text alone, though the series does treat it as a betrayal.

### Which number to believe

For a chart people read to avoid being misled, **precision is worth more than recall.** A missing edge is a gap; a wrong edge is a false statement presented as fact. The verifier buys the first kind of error to avoid the second, at 1.5× the wall clock and 50% more calls.

F1 weights them equally, which is the wrong weighting for this product. That is a limitation of the metric, not of the pipeline — worth saying out loud rather than quietly reporting whichever number looks better.

### What the audit log captured

Every run writes `pipeline/runs/<series>-multiagent-<stamp>.json`: each agent's status and cost, every handoff, every verifier verdict with its reason, every conflict the resolver settled and why, and every recovery. On this run: 7 agents, 0 failed, 0 partial, 1 conflict settled, 0 recoveries needed.
