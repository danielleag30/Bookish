# Eval results

Appended by `npm run eval`. Committed on purpose: a score moving over time is
the evidence that tuning worked, and it is not visible from a single number.

Scoring rules, entity resolution and the corpus are described in
[README.md](README.md). Cost is always $0 — the model runs locally.

| when | series | book | model | node F1 | in-corpus F1 | edge F1 | leaks | rev | wrong type | spurious | s | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-07-28T03-04 | empyrean | 1 | gemma4:latest | 30.5 | 94.7 | 16.9 | 0 | 0 | 1 | 1 | 83 | after resolver fix |
| 2026-07-28T03-12 | empyrean | 3 | gemma4:latest | 43.6 | 83.0 | 16.8 | 0 | 0 | 6 | 4 | 356 | single · 3 books |
| 2026-07-28T03-18 | empyrean | 3 | gemma4:latest | 44.9 | 85.7 | 14.6 | 0 | 0 | 4 | 0 | 524 | multi · 3 books |
| 2026-07-28T13-40 | empyrean | 3 | gemma4:latest | 44.9 | 85.7 | 14.6 | 0 | 0 | 4 | 0 | 357 | multi · gemma4 baseline |
| 2026-07-28T13-46 | empyrean | 3 | qwen3:8b | 0.0 | 0.0 | 0.0 | 0 | 0 | 0 | 0 | 854 | multi · qwen3:8b |
| 2026-07-28T14-04 | empyrean | 1 | qwen3:8b | 0.0 | 0.0 | 0.0 | 0 | 0 | 0 | 0 | 390 | multi · qwen3:8b clean |
| 2026-07-28T14-17 | empyrean | 1 | qwen3:8b | 30.5 | 94.7 | 16.7 | 0 | 0 | 2 | 1 | 80 | multi · qwen3:8b think=false |
| 2026-07-28T14-19 | empyrean | 1 | gemma4:latest | 30.5 | 94.7 | 16.9 | 0 | 0 | 2 | 0 | 53 | multi · gemma4 think=false |
