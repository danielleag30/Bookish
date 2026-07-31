# Changelog

Drafted by the changelog agent from merged pull requests, then reviewed and
merged by a human. See `.github/workflows/changelog-agent.yml`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-07-31

### Added

- Add the theme agent: read a cover, propose a palette, prove it is legible ([#33](https://github.com/danielleag30/Bookish/pull/33))
- Add series: Fae & Alchemy (source notes) ([#29](https://github.com/danielleag30/Bookish/pull/29))
- Phase 7: two agents that propose, and a written boundary on what they may do ([#20](https://github.com/danielleag30/Bookish/pull/20))
- Phase 6: spoiler-bounded MCP server ([#17](https://github.com/danielleag30/Bookish/pull/17))
- Phase 5: extractor, verifier and resolver ([#16](https://github.com/danielleag30/Bookish/pull/16))
- Phase 3 + 4: extraction pipeline and eval harness ([#15](https://github.com/danielleag30/Bookish/pull/15))
- Phase 2: one chart engine for all three series ([#12](https://github.com/danielleag30/Bookish/pull/12))
- Phase 1.5: spoiler-bounded ask box on the Empyrean and DCC charts ([#10](https://github.com/danielleag30/Bookish/pull/10))
- Plan: add Phase 1.5 — spoiler-safe ask box ([#5](https://github.com/danielleag30/Bookish/pull/5))
- Phase 0: TypeScript/Vitest toolchain, CI, and licensing ([#3](https://github.com/danielleag30/Bookish/pull/3))

### Changed

- Each series names its own abilities ([#44](https://github.com/danielleag30/Bookish/pull/44))
- Fae & Alchemy book 3, announced and undated ([#43](https://github.com/danielleag30/Bookish/pull/43))
- Monthly release watch, and per-series display defaults ([#42](https://github.com/danielleag30/Bookish/pull/42))
- The gate dialog, and the last three tier-1 filters ([#41](https://github.com/danielleag30/Bookish/pull/41))
- Fae & Alchemy from the researched table: 16 relationships to 49 ([#40](https://github.com/danielleag30/Bookish/pull/40))
- Fae & Alchemy out of draft: real regions, factions and character kinds ([#38](https://github.com/danielleag30/Bookish/pull/38))
- Rip's reveal at the end of Glint, and a mermaid flow on how-it-works ([#37](https://github.com/danielleag30/Bookish/pull/37))
- Close five spoiler and security holes, with a test for each ([#36](https://github.com/danielleag30/Bookish/pull/36))
- Extract locally on Ollama, and turn reasoning off by default ([#32](https://github.com/danielleag30/Bookish/pull/32))
- Give the changelog agent one branch instead of one per run ([#30](https://github.com/danielleag30/Bookish/pull/30))
- Put the coming-soon card back, and close an unbalanced div ([#25](https://github.com/danielleag30/Bookish/pull/25))
- Close the model-cost surface, and make a series' look a data decision ([#24](https://github.com/danielleag30/Bookish/pull/24))
- Changelog draft (from the changelog agent) ([#22](https://github.com/danielleag30/Bookish/pull/22))
- Let the changelog agent degrade when it cannot open a pull request ([#21](https://github.com/danielleag30/Bookish/pull/21))
- Surface the how-it-works page on the landing page ([#19](https://github.com/danielleag30/Bookish/pull/19))
- Define the filter hierarchy, and model perceived state for spoiler safety ([#9](https://github.com/danielleag30/Bookish/pull/9))
- Link DCC card to the in-repo chart ([#4](https://github.com/danielleag30/Bookish/pull/4))
- Landing page ([#1](https://github.com/danielleag30/Bookish/pull/1))

### Fixed

- Pipeline robustness: 8 of 9 fixed, 1 scoped out with reasons ([#39](https://github.com/danielleag30/Bookish/pull/39))
- Fix zoom, answer death questions, make the theme mean something ([#35](https://github.com/danielleag30/Bookish/pull/35))
- Add Fae & Alchemy (agent-drafted) + fix 3 pipeline bugs and 2 name leaks ([#34](https://github.com/danielleag30/Bookish/pull/34))
- Fix the slug the add-series agent derives, and let it degrade like the other one ([#27](https://github.com/danielleag30/Bookish/pull/27))
- Resolve every pending data question against canon ([#14](https://github.com/danielleag30/Bookish/pull/14))
- Refresh the ask box when its answer stops being true ([#13](https://github.com/danielleag30/Bookish/pull/13))
- Resolve all 6 data warnings against series canon ([#7](https://github.com/danielleag30/Bookish/pull/7))

### Data

- Gap reports for every series, in each world's own vocabulary ([#45](https://github.com/danielleag30/Bookish/pull/45))
- Per-book data model, and Plated Prisoner migrated into it ([#11](https://github.com/danielleag30/Bookish/pull/11))
- Define a controlled relationship vocabulary and enforce it in CI ([#8](https://github.com/danielleag30/Bookish/pull/8))
- Phase 1: extract chart data to validated JSON behind a Zod schema ([#6](https://github.com/danielleag30/Bookish/pull/6))

### Docs

- Add a "how it works" page explaining the data flow ([#18](https://github.com/danielleag30/Bookish/pull/18))

