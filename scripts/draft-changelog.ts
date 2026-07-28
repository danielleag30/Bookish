/**
 * Drafts CHANGELOG.md from merged pull requests.
 *
 *   npm run changelog -- --dry-run          # print, change nothing
 *   npm run changelog                       # write the file
 *   npm run changelog -- --no-model         # skip the model entirely
 *
 * WHY AN AGENT WRITES THIS AND NOT ME
 * The decision (2026-07-27) was to have Phase 7's CI agent draft the changelog
 * rather than hand-writing one, which turns a chore into practice at the thing
 * the exam actually tests: an agent producing an inspectable artifact inside
 * standard tooling, gated by human review.
 *
 * HOW IT DEGRADES
 * The structure — versions, dates, grouping, PR links — is derived
 * deterministically from `gh pr list`. The model is used only to write the
 * one-line human summary for each entry. If no model is reachable, the PR title
 * is used verbatim and the output is still complete and correct, just blunter.
 * An agent that cannot reach a model should still produce something reviewable.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { callCiModel, tokenAvailable, ModelUnavailable } from '../pipeline/github-models.ts';

const root = resolve(import.meta.dirname, '..');
const OUT = join(root, 'CHANGELOG.md');

const has = (flag: string) => process.argv.includes(`--${flag}`);
const dryRun = has('dry-run');
const noModel = has('no-model');

export interface MergedPr {
  number: number;
  title: string;
  body: string;
  mergedAt: string;
  labels: string[];
}

/** Read merged PRs from the GitHub CLI. */
export function fetchMergedPrs(limit = 60): MergedPr[] {
  const raw = execFileSync('gh', [
    'pr', 'list', '--state', 'merged', '--limit', String(limit),
    '--json', 'number,title,body,mergedAt,labels',
  ], { encoding: 'utf8', cwd: root });
  return (JSON.parse(raw) as {
    number: number; title: string; body: string; mergedAt: string;
    labels: { name: string }[];
  }[]).map((p) => ({
    number: p.number, title: p.title, body: p.body ?? '',
    mergedAt: p.mergedAt, labels: p.labels.map((l) => l.name),
  }));
}

export type Section = 'Added' | 'Changed' | 'Fixed' | 'Data' | 'Docs';

/**
 * Bucket a PR by what it did.
 *
 * Deliberately keyword-based rather than a model call: the section a change
 * belongs in is a fact about the change, and getting it from a model would
 * introduce variance into something that should be stable across runs.
 */
export function sectionFor(pr: MergedPr): Section {
  const t = pr.title.toLowerCase();
  if (/\bfix|bug|leak|refresh|resolve\b/.test(t)) return 'Fixed';
  if (/\bdata model|schema|vocabulary|canon|migrat\b/.test(t)) return 'Data';
  if (/\bdoc|readme|page explaining|how it works\b/.test(t)) return 'Docs';
  if (/\badd|new |introduce|phase \d/.test(t)) return 'Added';
  return 'Changed';
}

/** Strip PR-body boilerplate so only prose reaches the model. */
export function cleanBody(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\|.*\|/g, '')
    .replace(/🤖 Generated with[\s\S]*$/, '')
    .replace(/^#+ /gm, '')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .slice(0, 14).join(' ')
    .slice(0, 1200);
}

async function summarise(pr: MergedPr): Promise<string> {
  if (noModel || !tokenAvailable()) return pr.title;
  try {
    const r = await callCiModel(
      `Summarise this merged pull request in ONE sentence for a changelog aimed at ` +
      `someone using the site, not the person who wrote the code. Plain language, ` +
      `present tense, no marketing. Return only the sentence.\n\n` +
      `Title: ${pr.title}\n\n${cleanBody(pr.body)}`,
      { maxTokens: 90 },
    );
    const line = r.text.trim().split('\n')[0]?.replace(/^[-*]\s*/, '') ?? '';
    return line.length > 8 ? line : pr.title;
  } catch (err) {
    if (err instanceof ModelUnavailable) return pr.title;
    throw err;
  }
}

// ── Build ──────────────────────────────────────────────────────────────────
// Guarded so the module can be imported by tests without shelling out to `gh`.
const isEntry = process.argv[1]?.includes('draft-changelog');
if (!isEntry) {
  // imported for its helpers only
} else {

const prs = fetchMergedPrs();
if (prs.length === 0) {
  console.error('No merged pull requests found.');
  process.exit(1);
}

const modelUsed = !noModel && tokenAvailable();
console.error(
  `${prs.length} merged PR(s) · ${modelUsed ? 'summarising with GitHub Models' : 'titles verbatim (no model)'}`,
);

const grouped = new Map<Section, { pr: MergedPr; line: string }[]>();
for (const pr of prs) {
  const line = await summarise(pr);
  const s = sectionFor(pr);
  grouped.set(s, [...(grouped.get(s) ?? []), { pr, line }]);
}

const order: Section[] = ['Added', 'Changed', 'Fixed', 'Data', 'Docs'];
const latest = prs.map((p) => p.mergedAt).sort().at(-1)!.slice(0, 10);

let out = `# Changelog

Drafted by the changelog agent from merged pull requests, then reviewed and
merged by a human. See \`.github/workflows/changelog-agent.yml\`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — ${latest}

`;

for (const section of order) {
  const entries = grouped.get(section);
  if (!entries?.length) continue;
  out += `### ${section}\n\n`;
  for (const { pr, line } of entries.sort((a, b) => b.pr.number - a.pr.number)) {
    out += `- ${line} ([#${pr.number}](https://github.com/danielleag30/Bookish/pull/${pr.number}))\n`;
  }
  out += '\n';
}

if (dryRun) {
  console.log(out);
} else {
  const changed = !existsSync(OUT) || readFileSync(OUT, 'utf8') !== out;
  writeFileSync(OUT, out);
  console.error(changed ? `wrote CHANGELOG.md` : `CHANGELOG.md already current`);
  // The workflow reads this to decide whether to open a pull request at all.
  console.log(changed ? 'changed' : 'unchanged');
}

}
