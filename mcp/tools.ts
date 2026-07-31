/**
 * The tool layer, separated from transport so it can be tested without a server.
 *
 * THE GUARDRAIL IS HERE, NOT IN A PROMPT
 * Every tool goes through `gate()` from src/spoiler.ts — the same function the
 * website's ask box and the chart renderer use. A model talking to this server
 * cannot be argued past the reading position, because data beyond it is never
 * placed in the response to begin with. There is no instruction to ignore.
 *
 * READING POSITION IS SERVER STATE
 * It lives here rather than being a parameter on every call, which means a
 * client cannot forget to pass it and accidentally receive the whole series. It
 * defaults to book 1 — the most conservative position — rather than to the end.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, type Series } from '../src/schema.ts';
import {
  gate, present, findCharacters, connectionsOf, eventsOf, pathBetween,
} from '../src/spoiler.ts';

const dataDir = resolve(import.meta.dirname, '..', 'data');

export interface ServerState {
  /** Series id -> how far the reader has read. */
  positions: Map<string, number>;
}

export function loadSeries(): Map<string, Series> {
  const out = new Map<string, Series>();
  for (const f of readdirSync(dataDir).filter((x) => x.endsWith('.json'))) {
    const s = SeriesSchema.parse(JSON.parse(readFileSync(join(dataDir, f), 'utf8')));
    out.set(s.id, s);
  }
  return out;
}

export function newState(): ServerState {
  return { positions: new Map() };
}

/** Default to the first book. Never assume the reader has finished. */
export function positionFor(state: ServerState, series: Series): number {
  return state.positions.get(series.id) ?? Math.min(...series.books.map((b) => b.id));
}

export class ToolError extends Error {}

function requireSeries(all: Map<string, Series>, id: string): Series {
  const s = all.get(id);
  if (!s) {
    throw new ToolError(
      `unknown series "${id}". Available: ${[...all.keys()].join(', ')}`,
    );
  }
  return s;
}

// ── Tools ──────────────────────────────────────────────────────────────────

export function listSeries(all: Map<string, Series>, state: ServerState): string {
  return [...all.values()].map((s) => {
    const pos = positionFor(state, s);
    const book = s.books.find((b) => b.id === pos);
    return `${s.id} — ${s.title} by ${s.author} · ${s.books.length} books · ` +
           `you are at book ${pos}${book ? ` (${book.short})` : ''}`;
  }).join('\n');
}

export function setReadingPosition(
  all: Map<string, Series>, state: ServerState, seriesId: string, book: number,
): string {
  const s = requireSeries(all, seriesId);
  const ids = s.books.map((b) => b.id);
  if (!ids.includes(book)) {
    throw new ToolError(`${s.title} has books ${Math.min(...ids)}–${Math.max(...ids)}`);
  }
  state.positions.set(s.id, book);
  const b = s.books.find((x) => x.id === book)!;
  const g = gate(s, book);
  return `Reading position for ${s.title} is now book ${book} (${b.short}).\n` +
    `${g.characters.length} characters and ${g.relationships.length} relationships are ` +
    `visible. Anything later stays hidden.`;
}

export function searchCharacters(
  all: Map<string, Series>, state: ServerState, seriesId: string, query: string,
): string {
  const s = requireSeries(all, seriesId);
  const g = gate(s, positionFor(state, s));
  const hits = findCharacters(g, query);
  if (hits.length === 0) {
    // Two deliberate omissions. It does not say "that character appears later",
    // because confirming someone exists is itself a spoiler. And it does not
    // echo the query, because repeating caller input into the response is
    // needless surface for no benefit — the caller already knows what they
    // typed.
    return `No match in ${s.title} at your reading position.`;
  }
  return hits.slice(0, 12).map((c) => {
    const p = present(c, g);
    return `${p.label} (${c.id}) — ${p.role}${p.statusIsBelief ? ` · ${p.status}, as far as you know` : ` · ${p.status}`}`;
  }).join('\n');
}

export function getCharacter(
  all: Map<string, Series>, state: ServerState, seriesId: string, id: string,
): string {
  const s = requireSeries(all, seriesId);
  const g = gate(s, positionFor(state, s));
  const c = g.byId.get(id) ?? findCharacters(g, id)[0];
  if (!c) return `No such character in ${s.title} at your reading position.`;

  const p = present(c, g);
  const lines = [
    `${p.label} (${c.id})`,
    p.role,
    `Status: ${p.status}${p.statusIsBelief ? ' — as far as you know at this point' : ''}`,
    `Affiliation: ${s.affiliations[p.affil]?.label ?? p.affil}`,
    `First appears: book ${p.firstBook}`,
  ];
  if (c.magic) lines.push(`${s.terms?.magic ?? 'Power'}: ${c.magic}`);
  // Not `else if`. Bios are segmented now, so a reader can have part of one and
  // still be missing later parts — and with `else if` they were shown a
  // truncated biography with nothing to say it was truncated, which reads as
  // the whole thing.
  if (p.bio) lines.push('', p.bio);
  if (p.bioWithheld) {
    lines.push(
      '',
      p.bio
        ? '(More of this biography is withheld — it describes later books.)'
        : '(Biography withheld — it describes later books.)',
    );
  }
  return lines.filter(Boolean).join('\n');
}

export function getRelationships(
  all: Map<string, Series>, state: ServerState, seriesId: string, id: string, type?: string,
): string {
  const s = requireSeries(all, seriesId);
  const g = gate(s, positionFor(state, s));
  const c = g.byId.get(id) ?? findCharacters(g, id)[0];
  if (!c) return `No such character in ${s.title} at your reading position.`;

  const conns = connectionsOf(g, c.id, type);
  if (conns.length === 0) {
    return `${present(c, g).label} has no ${type ? `${type} ` : ''}relationships at your reading position.`;
  }
  return conns.map(
    (x) => `${x.type}: ${present(x.other, g).label}${x.label ? ` — ${x.label}` : ''}`,
  ).join('\n');
}

export function getEvents(
  all: Map<string, Series>, state: ServerState, seriesId: string, characterId?: string,
): string {
  const s = requireSeries(all, seriesId);
  const pos = positionFor(state, s);
  const g = gate(s, pos);

  if (characterId) {
    const c = g.byId.get(characterId) ?? findCharacters(g, characterId)[0];
    if (!c) return `No such character at your reading position.`;
    const evs = eventsOf(g, c.id);
    if (evs.length === 0) return `Nothing recorded for ${present(c, g).label} yet.`;
    return evs.map((e) => `Book ${e.book} · ${e.text}`).join('\n');
  }

  return g.events.map((e) => `Book ${e.book} · [${e.kind}] ${e.text}`).join('\n')
    || `No events at your reading position.`;
}

export function findConnection(
  all: Map<string, Series>, state: ServerState, seriesId: string, fromId: string, toId: string,
): string {
  const s = requireSeries(all, seriesId);
  const g = gate(s, positionFor(state, s));
  const a = g.byId.get(fromId) ?? findCharacters(g, fromId)[0];
  const b = g.byId.get(toId) ?? findCharacters(g, toId)[0];
  if (!a || !b) return `One of those characters is not on the chart at your reading position.`;

  const path = pathBetween(g, a.id, b.id);
  if (!path) return `No connection between ${a.label} and ${b.label} at your reading position.`;
  if (path.length === 0) return `${a.label} and ${b.label} are the same character.`;
  return path.map(
    (st) => `${present(st.from, g).label} —[${st.type}${st.label ? `: ${st.label}` : ''}]→ ${present(st.to, g).label}`,
  ).join('\n');
}
