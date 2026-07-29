/**
 * Building regexes out of names.
 *
 * Names reach these call sites from a language model and from source notes, so
 * they can contain anything. A character the model called "Wyvern (general)"
 * throws `Invalid regular expression` when dropped into a pattern — after the
 * multi-minute extraction has already run. Subtler, and worse: a name
 * containing `.` or `?` silently matches things it should not, so an event gets
 * linked to the wrong person and nothing anywhere reports a problem.
 *
 * There is one escape helper and one matcher, so a new call site cannot
 * reintroduce either failure by forgetting.
 */

/** Escape every character that means something to the regex engine. */
export function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match `term` as a whole word, case-insensitively by default.
 *
 * Uses lookaround rather than `\b` because names can end in an apostrophe or a
 * bracket, where `\b` sits in the wrong place.
 */
export function wordRe(term: string, flags = 'i'): RegExp {
  return new RegExp(`(?<!\\w)${escapeRe(term)}(?!\\w)`, flags);
}

/** True when `term` appears as a whole word in `haystack`. */
export function mentions(haystack: string, term: string): boolean {
  if (!term) return false;
  return wordRe(term).test(haystack);
}
