# Changelog

Drafted by the changelog agent from merged pull requests, then reviewed and
merged by a human. See `.github/workflows/changelog-agent.yml`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-07-28

### Added

- Two new agents are introduced to draft changelogs and propose new series, with a clear boundary that only humans can merge changes to the main branch. ([#20](https://github.com/danielleag30/Bookish/pull/20))
- The site now includes a new server that restricts AI access to character information based on the reading position, ensuring that users cannot inadvertently access details from later books. ([#17](https://github.com/danielleag30/Bookish/pull/17))
- The update introduces three specialized agents for data extraction, verification, and resolution, improving precision while highlighting limitations in the F1 metric used for evaluation. ([#16](https://github.com/danielleag30/Bookish/pull/16))
- The extraction pipeline now processes character data and evaluates it against hand-labelled ground truth, running entirely on local Ollama at no cost, with 220 tests passing. ([#15](https://github.com/danielleag30/Bookish/pull/15))
- The chart engine is now unified across all three series, improving performance and consistency while maintaining distinct visual identities for each page. ([#12](https://github.com/danielleag30/Bookish/pull/12))
- A new feature on the Empyrean and DCC charts provides a spoiler-bounded ask box that answers questions based on the reader's progress in the story. ([#10](https://github.com/danielleag30/Bookish/pull/10))
- Plan: add Phase 1.5 — spoiler-safe ask box ([#5](https://github.com/danielleag30/Bookish/pull/5))
- Phase 0: TypeScript/Vitest toolchain, CI, and licensing ([#3](https://github.com/danielleag30/Bookish/pull/3))

### Changed

- The changelog agent now continues to function and provides a draft even if it cannot create a pull request due to repository settings. ([#21](https://github.com/danielleag30/Bookish/pull/21))
- The how-it-works page is now easily accessible from a new navigation button on the landing page. ([#19](https://github.com/danielleag30/Bookish/pull/19))
- The filter hierarchy is defined to improve spoiler safety by categorizing content and enforcing rules for visibility based on user reading position. ([#9](https://github.com/danielleag30/Bookish/pull/9))
- Link DCC card to the in-repo chart ([#4](https://github.com/danielleag30/Bookish/pull/4))
- Landing page ([#1](https://github.com/danielleag30/Bookish/pull/1))

### Fixed

- All pending data questions are resolved, and the `VOCAB_PENDING_REVIEW` edges are now cleared, ensuring accurate information in the system. ([#14](https://github.com/danielleag30/Bookish/pull/14))
- The ask box now refreshes when its answer is no longer valid, ensuring users see accurate information based on their current selections. ([#13](https://github.com/danielleag30/Bookish/pull/13))
- All data warnings against the series canon are resolved, ensuring accurate character and relationship information with no errors or warnings. ([#7](https://github.com/danielleag30/Bookish/pull/7))

### Data

- The data model is now organized by book, improving accuracy and fixing a reporting error in the first book's chart. ([#11](https://github.com/danielleag30/Bookish/pull/11))
- Relationship vocabulary is now standardized to ensure consistency across the site as new books are added. ([#8](https://github.com/danielleag30/Bookish/pull/8))
- Phase 1: extract chart data to validated JSON behind a Zod schema ([#6](https://github.com/danielleag30/Bookish/pull/6))

### Docs

- A new "how it works" page is added to explain the data flow and clarify that the site operates without a language model, detailing the two systems that share one dataset. ([#18](https://github.com/danielleag30/Bookish/pull/18))

