/**
 * Human judgements, re-applied after every extraction.
 *
 * WHY THIS IS A FILE AND NOT A MEMORY
 * Curating a draft by hand means the next `add-series` run throws that work
 * away. The Carrion Swift merge was redone three times before this existed.
 * Same idea as the CORRECTIONS block in scripts/extract-charts.mjs.
 *
 * WHY IT IS A MODULE AND NOT PART OF add-series
 * Corrections used to live inside add-series, which meant the only way to apply
 * a new one was to re-run a multi-minute, non-deterministic extraction — and
 * risk the run producing different ids than the corrections name. Now they
 * apply to whatever data already exists, and `add-series` calls the same code
 * so a fresh extraction lands in the same place.
 *
 * Every entry carries a `why`, because every entry is a claim about canon.
 */
import type { Series } from '../src/schema.ts';

export interface Corrections {
  _why?: unknown;
  /** Not a person — a faction, a place, a group the extractor mistook for one. */
  dropCharacters?: { id: string; why: string }[];
  /** Two records, one person. */
  mergeCharacters?: { from: string; into: string; alias?: string; role?: string; why: string }[];
  /** Factions the notes name but the extractor did not emit. */
  addFactions?: { id: string; label: string; color: string; border?: string; why: string }[];
  /** Character kinds, which drive node shape. */
  addCharacterTypes?: { id: string; label: string; shape: string }[];
  /** Factions that turned out not to exist, once their members moved elsewhere. */
  dropFactions?: { id: string; why: string }[];
  /**
   * Anything about a character a human knows and the extractor could not.
   *
   * Started as placement only; grew as the research came in. A researcher
   * reading the books produces facts the notes never stated — that Merelle dies
   * at Ajun Gate, that Foley is only *believed* dead, that Saeris is a different
   * species by book two — and every one of those needs somewhere to land or it
   * gets applied by hand and lost on the next run.
   */
  placeCharacters?: {
    id: string;
    label?: string;
    aliases?: string[];
    region?: string;
    affil?: string;
    type?: string;
    role?: string;
    magic?: string;
    status?: 'alive' | 'dead' | 'missing' | 'prisoner' | 'unknown';
    statusDetail?: string;
    book?: number;
    lastBook?: number;
    /** What the reader believes, while they still believe it. */
    perceived?: Record<string, unknown>;
    /** Dated changes — the temporal model, for anyone who is not one fixed thing. */
    changes?: { book: number; set: Record<string, unknown>; why: string }[];
    why: string;
  }[];
  retypeRelationships?: { from: string; to: string; type: string; label?: string; why: string }[];
  addRelationships?: { from: string; to: string; type: string; label?: string; why: string }[];
}

export interface CorrectionResult {
  applied: number;
  /** Entries that named something not in the data — a correction that has gone stale. */
  skipped: string[];
}

/**
 * Apply corrections in place.
 *
 * Anything naming an id that no longer exists is reported rather than ignored:
 * a correction that silently does nothing is worse than none, because it looks
 * like the judgement is still being honoured when it is not.
 */
export function applyCorrections(series: Series, fix: Corrections): CorrectionResult {
  let applied = 0;
  const skipped: string[] = [];
  const has = (id: string) => series.characters.some((c) => c.id === id);

  for (const d of fix.dropCharacters ?? []) {
    // Absent means already dropped — these are idempotent, not stale. Reporting
    // an applied correction as a failure trains people to ignore the warning.
    if (!has(d.id)) continue;
    series.characters = series.characters.filter((c) => c.id !== d.id);
    series.relationships = series.relationships.filter((r) => r.from !== d.id && r.to !== d.id);
    for (const e of series.events) e.involves = e.involves.filter((id) => id !== d.id);
    applied++;
  }

  for (const m of fix.mergeCharacters ?? []) {
    const target = series.characters.find((c) => c.id === m.into);
    if (!has(m.from)) continue;                       // already merged
    if (!target) { skipped.push(`mergeCharacters: target ${m.into} not present`); continue; }
    if (m.alias) target.aliases = [...new Set([...(target.aliases ?? []), m.alias])];
    if (m.role) target.role = m.role;
    series.characters = series.characters.filter((c) => c.id !== m.from);
    series.relationships = series.relationships
      .map((r) => ({
        ...r,
        from: r.from === m.from ? m.into : r.from,
        to: r.to === m.from ? m.into : r.to,
      }))
      .filter((r) => r.from !== r.to);
    for (const e of series.events) {
      e.involves = [...new Set(e.involves.map((id) => (id === m.from ? m.into : id)))];
    }
    applied++;
  }

  for (const f of fix.addFactions ?? []) {
    if (series.affiliations[f.id]) continue;
    series.affiliations[f.id] = {
      label: f.label,
      color: f.color,
      ...(f.border ? { border: f.border } : {}),
    };
    applied++;
  }

  for (const t of fix.addCharacterTypes ?? []) {
    series.characterTypes ??= {};
    if (series.characterTypes[t.id]) continue;
    series.characterTypes[t.id] = { label: t.label, shape: t.shape };
    applied++;
  }

  for (const p of fix.placeCharacters ?? []) {
    const c = series.characters.find((x) => x.id === p.id);
    if (!c) { skipped.push(`placeCharacters: ${p.id} not present`); continue; }
    // Never point at a region or faction the series does not declare — that
    // fails integrity, and a correction should not be able to break the data.
    if (p.region && series.regions.some((r) => r.id === p.region)) c.region = p.region;
    else if (p.region) skipped.push(`placeCharacters: ${p.id} -> unknown region ${p.region}`);
    if (p.affil && series.affiliations[p.affil]) c.affil = p.affil;
    else if (p.affil) skipped.push(`placeCharacters: ${p.id} -> unknown faction ${p.affil}`);
    if (p.type) c.type = p.type;
    if (p.role) c.role = p.role;
    if (p.label) c.label = p.label;
    if (p.aliases) c.aliases = [...new Set([...(c.aliases ?? []), ...p.aliases])];
    if (p.magic) c.magic = p.magic;
    if (p.status) c.status = p.status;
    if (p.statusDetail) c.statusDetail = p.statusDetail;
    if (p.book !== undefined) c.book = p.book;
    if (p.lastBook !== undefined) c.lastBook = p.lastBook;
    if (p.perceived) c.perceived = p.perceived as typeof c.perceived;
    if (p.changes) c.changes = p.changes as typeof c.changes;
    applied++;
  }

  // After placeCharacters, deliberately: a faction can only be dropped once
  // its members have somewhere else to be, and the corrections that move them
  // are directly above. Running this first reported every drop as blocked.
  for (const f of fix.dropFactions ?? []) {
    if (!series.affiliations[f.id]) continue;
    const stillUsed = series.characters.filter((c) => c.affil === f.id);
    if (stillUsed.length) {
      skipped.push(
        `dropFactions: ${f.id} still has ${stillUsed.length} member(s) — ` +
        `move them first (${stillUsed.map((c) => c.id).join(', ')})`,
      );
      continue;
    }
    delete series.affiliations[f.id];
    applied++;
  }

  for (const t of fix.retypeRelationships ?? []) {
    const edge = series.relationships.find((r) => r.from === t.from && r.to === t.to);
    if (!edge) { skipped.push(`retypeRelationships: ${t.from} -> ${t.to}`); continue; }
    edge.type = t.type;
    if (t.label) edge.label = t.label;
    applied++;
  }

  const edgeExists = (a: string, b: string, type: string) =>
    series.relationships.some(
      (r) => r.type === type && ((r.from === a && r.to === b) || (r.from === b && r.to === a)),
    );
  const firstBook = new Map(series.characters.map((c) => [c.id, c.book]));
  for (const a of fix.addRelationships ?? []) {
    if (!has(a.from) || !has(a.to)) { skipped.push(`addRelationships: ${a.from} -> ${a.to}`); continue; }
    if (edgeExists(a.from, a.to, a.type)) continue;   // already added
    series.relationships.push({
      from: a.from,
      to: a.to,
      type: a.type,
      book: Math.max(firstBook.get(a.from) ?? 1, firstBook.get(a.to) ?? 1),
      label: a.label ?? '',
    });
    applied++;
  }

  return { applied, skipped };
}
