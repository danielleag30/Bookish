# Eval results

Appended by `npm run eval`. Committed on purpose: a score moving over time is
the evidence that tuning worked, and it is not visible from a single number.

Scoring rules, entity resolution and the corpus are described in
[README.md](README.md). Cost is always $0 — the model runs locally.

| when | series | book | model | node F1 | in-corpus F1 | edge F1 | leaks | rev | wrong type | spurious | s | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-07-28T03-04 | empyrean | 1 | gemma4:latest | 30.5 | 94.7 | 16.9 | 0 | 0 | 1 | 1 | 83 | after resolver fix |
