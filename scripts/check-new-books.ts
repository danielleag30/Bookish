/**
 * Has any series gained a book since we last looked?
 *
 *   npx tsx scripts/check-new-books.ts
 *   npx tsx scripts/check-new-books.ts --json      # for the workflow
 *
 * WHY THIS USES NO MODEL
 * "Check whether an author published something" is a lookup, not a judgement.
 * Open Library answers it for free, with no key and no rate limit worth
 * worrying about, and the comparison is string matching against the books we
 * already have. Putting a language model in the middle would add cost, a
 * dependency that is being retired, and a way for the answer to be wrong in a
 * confident-sounding way. The agent here is the schedule, not the reasoning.
 *
 * WHAT IT DOES NOT DO
 * It does not edit data. It reports candidates. Open Library is
 * community-maintained: it carries box sets, translations, re-issues and
 * occasional junk, so a title we do not recognise is a thing to look at, not a
 * new book. Saying "found a new book" when it has found a Polish paperback of
 * book one would be worse than saying nothing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, type Series } from '../src/schema.ts';

const root = resolve(import.meta.dirname, '..');
const dataDir = join(root, 'data');
const asJson = process.argv.includes('--json');

interface Candidate {
  title: string;
  firstPublished?: number;
  /** Why we think it might belong to this series. */
  signal?: string;
}
export interface SeriesReport {
  slug: string;
  title: string;
  author: string;
  known: { id: number; title: string; future?: boolean }[];
  /** Titles that look like they belong to THIS series. */
  candidates: Candidate[];
  /** Everything else by the same author — context, not a finding. */
  otherWork: Candidate[];
  error?: string;
}

/** Strip everything that varies between editions, so titles compare fairly. */
export function normaliseTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\([^)]*\)/g, ' ')          // "(Fae & Alchemy #2)"
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(a\s+)?novel\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Editions and repackagings we never want to report as a new book.
 *
 * Deliberately conservative — a false negative here means a real book is missed
 * for a month, a false positive means the watcher cries wolf and stops being
 * read. The second failure is worse, because it is the one that makes the whole
 * thing useless.
 */
const NOT_A_NEW_BOOK = [
  /\bbox(ed)? set\b/i, /\bcollection\b/i, /\bomnibus\b/i, /\bbundle\b/i,
  /\bdeluxe\b/i, /\bspecial edition\b/i, /\billustrated\b/i, /\bcollector/i,
  /\bsampler\b/i, /\bexcerpt\b/i, /\bcompanion\b/i, /\bguide\b/i,
  /\bcoloring\b/i, /\bcolouring\b/i, /\bjournal\b/i, /\bplanner\b/i,
  /\bsummary\b/i, /\banalysis\b/i, /\bunofficial\b/i, /\bstudy\b/i,
];

async function worksByAuthor(author: string): Promise<Candidate[]> {
  const url =
    'https://openlibrary.org/search.json' +
    `?author=${encodeURIComponent(author)}` +
    '&fields=title,first_publish_year,language&limit=200';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Bookish/1.0 (github.com/danielleag30/Bookish)' },
  });
  if (!res.ok) throw new Error(`Open Library returned HTTP ${res.status}`);
  const body = (await res.json()) as {
    docs?: { title?: string; first_publish_year?: number; language?: string[] }[];
  };
  return (body.docs ?? [])
    .filter((d): d is { title: string; first_publish_year?: number; language?: string[] } =>
      Boolean(d.title))
    // Translations are the loudest noise in the results — the Spanish editions
    // of all three Empyrean books arrive as unfamiliar titles and read as three
    // new releases. Keep English and anything with no language recorded.
    .filter((d) => !d.language?.length || d.language.includes('eng'))
    .map((d) => ({ title: d.title, firstPublished: d.first_publish_year }));
}

export async function checkSeries(series: Series, slug: string): Promise<SeriesReport> {
  const known = series.books.map((b) => ({ id: b.id, title: b.title, future: b.future }));
  const report: SeriesReport = {
    slug,
    title: series.title,
    author: series.author,
    known,
    candidates: [],
    otherWork: [],
  };

  let works: Candidate[];
  try {
    works = await worksByAuthor(series.author);
  } catch (err) {
    // A lookup failure is not a finding. Reporting it as "no new books" would
    // be a lie, and reporting it as a new book would be worse.
    report.error = err instanceof Error ? err.message : String(err);
    return report;
  }

  // Known titles, plus the series title itself — a series is often catalogued
  // as a work in its own right, and "Fae & Alchemy" is not book three.
  const seen = new Set([
    ...known.map((b) => normaliseTitle(b.title)),
    normaliseTitle(series.title),
  ]);

  const found = new Map<string, Candidate>();
  for (const w of works) {
    if (NOT_A_NEW_BOOK.some((re) => re.test(w.title))) continue;
    const key = normaliseTitle(w.title);
    if (!key || seen.has(key)) continue;
    // Substring either way: "Quicksilver" vs "Quicksilver: Fae & Alchemy".
    if ([...seen].some((k) => k.includes(key) || key.includes(k))) continue;
    if (!found.has(key)) found.set(key, w);
  }

  // Split the unfamiliar titles into "probably this series" and "other work by
  // this author". A prolific author's back catalogue is not a finding, and
  // burying one real result under twenty-seven irrelevant ones is the same as
  // not reporting it.
  const seriesWords = normaliseTitle(series.title).split(' ').filter((w) => w.length > 2);
  const nextNumbers = new Set([series.books.length + 1, series.books.length + 2].map(String));

  const byRecency = (a: Candidate, b: Candidate) =>
    (b.firstPublished ?? 0) - (a.firstPublished ?? 0);

  for (const c of found.values()) {
    const t = normaliseTitle(c.title);
    const words = t.split(' ');
    const namesSeries = seriesWords.length > 0 && seriesWords.every((w) => t.includes(w));
    const nextInLine = namesSeries && words.some((w) => nextNumbers.has(w));

    if (nextInLine) c.signal = `names the series and the next number`;
    else if (namesSeries) c.signal = 'names the series';

    if (namesSeries) report.candidates.push(c);
    else report.otherWork.push(c);
  }
  report.candidates.sort(byRecency);
  report.otherWork.sort(byRecency);
  return report;
}

const reports: SeriesReport[] = [];
for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.json'))) {
  const series = SeriesSchema.parse(JSON.parse(readFileSync(join(dataDir, file), 'utf8')));
  reports.push(await checkSeries(series, file.replace(/\.json$/, '')));
}

if (asJson) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const r of reports) {
    console.log(`\n${r.title} — ${r.author}`);
    console.log(`  charted: ${r.known.map((b) => `${b.id}. ${b.title}${b.future ? ' (announced)' : ''}`).join(' · ')}`);
    if (r.error) {
      console.log(`  ! lookup failed: ${r.error}`);
    } else if (r.candidates.length === 0) {
      console.log(`  nothing new for this series  (${r.otherWork.length} other work(s) by this author, ignored)`);
    } else {
      console.log(`  ${r.candidates.length} possible new book(s):`);
      for (const c of r.candidates.slice(0, 8)) {
        console.log(
          `    ${c.title}${c.firstPublished ? `  (${c.firstPublished})` : ''}` +
          `${c.signal ? `  — ${c.signal}` : ''}`,
        );
      }
    }
  }
  const anything = reports.some((r) => r.candidates.length > 0 || r.error);
  console.log(anything ? '\nSomething to review.' : '\nNothing to do.');
}
