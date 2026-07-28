# What the agents may do without asking

Two agents run in this repository. Neither can merge anything.

This document exists because "the agent opens a pull request" is doing real work
in that sentence — it is the difference between a tool that proposes and a tool
that decides. Writing the boundary down is what makes it reviewable.

---

## The rule

**An agent may write to a branch. Only a human may write to `main`.**

Everything below follows from that. There is no agent path to production, no
auto-merge, and no `contents: write` on any job that has not been through an
environment gate.

---

## Autonomy levels

| Level | Meaning | What runs here |
|---|---|---|
| **0 — read** | May inspect. Cannot change anything. | CI: typecheck, tests, `validate`, `spoiler-audit` |
| **1 — propose** | May write to its own branch and open a pull request. | Changelog agent |
| **2 — gated** | Same, but a named reviewer must approve the run before it can push. | Add-series agent |
| **3 — merge** | **Nothing. No agent has this.** | — |

---

## By action

| Action | Who | Why |
|---|---|---|
| Read the repo, run tests | agent, unattended | No side effects. |
| Draft `CHANGELOG.md` | agent, unattended | Output is a file on a branch. Wrong output costs a closed PR. |
| Open a pull request | agent, unattended | A PR is a proposal. It changes nothing until merged. |
| Add a new series' data | agent, **after approval** | Touches `data/`, which every chart and the MCP server read. The `agent-writes` environment holds the job until a reviewer approves. |
| Merge to `main` | **human only** | Merging deploys. |
| Change the schema or the relationship vocabulary | **human only** | These are decisions with reasoning behind them — see `RELATIONSHIPS.md` and `DATA-MODEL.md`. An agent editing them would erase the reasoning without noticing. |
| Resolve a canon question | **human only** | Requires knowing the books. The pending-review register exists precisely so these surface rather than get guessed. |
| Change `vercel.json`, CI, or these permissions | **human only** | Self-modification of the guardrails. |

---

## Why the changelog agent is unattended and the series agent is not

The changelog agent's worst case is an inaccurate sentence in a draft that a
human reads before merging. Cheap to catch, cheap to fix.

The add-series agent writes into `data/`, which the charts, the ask box and the
MCP server all read, and where a wrong `book` number is a **spoiler**, not a
typo. The blast radius is different, so the gate is different.

That asymmetry is the whole point of having levels rather than a single
on/off switch.

---

## What stops each failure

| Failure | What catches it |
|---|---|
| Agent proposes malformed data | `npm run validate` — schema plus referential integrity, fails the build |
| Agent invents a relationship type | The canonical vocabulary is an **error**, not a warning |
| Agent introduces a spoiler leak | `gate()` and the adversarial suites in `tests/mcp.test.ts` and `tests/spoiler.test.ts` |
| Agent writes a confident but wrong changelog line | A human reads the PR. The workflow says so in the PR body. |
| Agent loops on its own pull requests | The changelog workflow skips branches starting with `agent/` |
| Model unreachable in CI | Both agents degrade to deterministic behaviour instead of failing |

---

## Verified in CI, 2026-07-28

The changelog agent ran on the merge of its own pull request. It:

- read 19 merged pull requests
- summarised them with **GitHub Models** — the model calls work from a runner,
  using only the workflow's own token
- wrote `CHANGELOG.md`, committed, and pushed `agent/changelog-20260728-122820`
- was **blocked from opening the pull request**, by
  *Settings → Actions → General → Allow GitHub Actions to create and approve
  pull requests*

That block is a legitimate way to run this, so the workflow no longer treats it
as a failure. The draft is pushed either way; the job summary reports the branch
and a one-click compare link, and explains the setting for anyone who wants the
agent to open the pull request itself.

It is worth noticing which part failed. The agent reached a model, produced a
reviewable artifact, and pushed it. What it could not do was the one step that
puts something in front of a human for a decision — and the platform stopped it
by default. That is the boundary working, not breaking.

## Where this is enforced

- Job-level `permissions:` — the default is `contents: read`, raised only where
  a job genuinely needs to push
- `environment: agent-writes` on the series agent's push job, which blocks until
  a reviewer approves
- Branch protection on `main` — the human gate that makes all of the above real

Branch protection is the load-bearing one. Without it, everything here is a
convention rather than a control.
