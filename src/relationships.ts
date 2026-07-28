/**
 * The canonical relationship vocabulary.
 *
 * This file is the single source of truth. RELATIONSHIPS.md is the readable
 * companion; if the two disagree, this file wins and the doc is stale.
 *
 * WHY THIS EXISTS
 * The three charts had grown three unrelated vocabularies for the same ideas:
 *   Empyrean          11 lowercase slugs
 *   DCC                6 lowercase slugs
 *   Plated Prisoner   21 English phrases used as ids ("Captor/Captive")
 * That is 38 distinct strings for roughly 14 concepts, with real collisions:
 * Empyrean's `squad`, DCC's `party` and Plated Prisoner's `"Wrath (squad)"`
 * all mean the same thing, and DCC folded magical bonds into `family`.
 *
 * THE CORE RULE
 * A relationship TYPE is a category you would want to filter the chart by.
 * Everything more specific belongs in the `label`. That is why Plated
 * Prisoner's "Slow-burn romance", "Love Interest" and "Married" collapse into
 * one `romantic` type carrying three different labels — a reader wants one
 * "show me the romance" toggle, not three.
 *
 * DIRECTION IS PART OF THE DEFINITION
 * For every directed type, `from` is stated explicitly below. Getting this
 * wrong silently inverts meaning: the legend once read "Killed by" while the
 * data stored killer -> victim, so every death edge rendered backwards.
 */

/** Who occupies the `from` slot, for types where it matters. */
export interface RelationshipDefinition {
  id: string;
  label: string;
  /** One sentence a reader could apply without further context. */
  definition: string;
  /** True when the relationship reads identically in both directions. */
  symmetric: boolean;
  /** For directed types: what `from` is. Empty for symmetric types. */
  fromIs: string;
  /** For directed types: what `to` is. Empty for symmetric types. */
  toIs: string;
  /** Use this type when… */
  useWhen: string[];
  /** Do NOT use this type when… — each points at the type to use instead. */
  notWhen: string[];
  /** Representative labels seen in the real data. */
  exampleLabels: string[];
  /**
   * Optional constraint on the `type` field of each endpoint character.
   * `null` means unconstrained. Used to catch e.g. a `bonded` edge between
   * two humans, which the Empyrean magic system does not permit.
   */
  endpoints?: {
    fromTypes?: string[] | null;
    toTypes?: string[] | null;
    /** True when both endpoints must share the same character type. */
    sameType?: boolean;
  };
}

export const RELATIONSHIP_TYPES: RelationshipDefinition[] = [
  // ── Kinship and pacts ───────────────────────────────────────────────────
  {
    id: 'family',
    label: 'Family',
    definition:
      'A blood, legal, or adoptive kinship tie between two characters.',
    symmetric: false,
    fromIs: 'the reference person',
    toIs: "the relative — `to` IS `from`'s <label>",
    useWhen: [
      'The tie is kinship: parent, child, sibling, cousin, aunt, uncle, grandparent, ancestor.',
      'The tie is legal or adoptive kinship, including in-laws and adopted family.',
      'It would still be true if the two characters never spoke again.',
    ],
    notWhen: [
      'They were raised together but are not related — use `friend`.',
      'One died protecting the other — that is an event, and `ally` for the tie.',
      'They are married — use `romantic` with the label "married". Marriage is a chosen bond, kinship is not.',
      'The bond is magical rather than biological — use `bonded` or `mated`.',
    ],
    exampleLabels: ['mother', 'father', 'sister', 'brother', 'cousin', 'uncle'],
  },
  {
    id: 'bonded',
    label: 'Bonded',
    definition:
      "A binding supernatural pact between a person and a creature, created by the series' magic system and not dissolvable at will.",
    symmetric: false,
    fromIs: 'the person',
    toIs: 'the creature',
    useWhen: [
      'The series treats the link as a formal magical pact with mechanical consequences.',
      'Breaking it is a significant, named event rather than a change of heart.',
    ],
    notWhen: [
      'Two creatures are fated to each other — use `mated`.',
      'It is ordinary loyalty or affection — use `ally` or `friend`.',
      'A creature merely carries or serves someone without a pact — use `ally`.',
    ],
    exampleLabels: ['bonded', 'bonded (2nd)', 'bonded (yr 2)'],
    endpoints: { fromTypes: ['human'], toTypes: ['dragon', 'irid', 'gryphon'] },
  },
  {
    id: 'mated',
    label: 'Mated',
    definition:
      'A permanent, fated pair-bond between two creatures of the same kind, which neither party chose.',
    symmetric: true,
    fromIs: '',
    toIs: '',
    useWhen: [
      'The series presents the pairing as destined or biological rather than elected.',
      'Both endpoints are the same kind of creature.',
    ],
    notWhen: [
      'The attachment was chosen — use `romantic`, even when it is intense or fated-feeling.',
      'One side is a person — use `bonded`.',
    ],
    exampleLabels: ['mated pair', 'fated mates'],
    endpoints: { sameType: true },
  },

  // ── Romance ─────────────────────────────────────────────────────────────
  {
    id: 'romantic',
    label: 'Romantic',
    definition:
      'A mutual romantic or sexual attachment that the characters chose, at any stage from attraction to marriage.',
    symmetric: true,
    fromIs: '',
    toIs: '',
    useWhen: [
      'Both parties are romantically involved, or one is openly courting the other.',
      'The relationship has ended but was romantic — label it "ex".',
    ],
    notWhen: [
      'The attraction is one-sided and unwelcome — use `enemy` or `complicated`.',
      'The bond is fated and unchosen between creatures — use `mated`.',
      'It is close but explicitly not romantic — use `friend`.',
    ],
    exampleLabels: ['slow burn → married (Bk3)', 'married', 'love interest', 'betrothed', 'ex'],
  },

  // ── Affiliation ─────────────────────────────────────────────────────────
  {
    id: 'squad',
    label: 'Squad',
    definition:
      'Shared membership of a named formal unit — a squad, party, wing, or crew — assigned or joined rather than merely social.',
    symmetric: true,
    fromIs: '',
    toIs: '',
    useWhen: [
      'Both belong to the same named group at the same time.',
      'The grouping is institutional: someone could list its roster.',
    ],
    notWhen: [
      'They are close but not in a shared unit — use `friend`.',
      'They cooperate across groups — use `ally`.',
    ],
    exampleLabels: ['squadmates', 'squad', 'party'],
  },
  {
    id: 'friend',
    label: 'Friend',
    definition:
      'Personal, non-romantic affection between characters who are not in the same formal unit.',
    symmetric: true,
    fromIs: '',
    toIs: '',
    useWhen: [
      'The warmth is personal rather than institutional or strategic.',
      'They were raised together, or are close outside any shared assignment.',
    ],
    notWhen: [
      'They share a named unit — use `squad`, which already implies closeness.',
      'The bond is strategic rather than personal — use `ally`.',
    ],
    exampleLabels: ['best friend', 'raised together', 'childhood friend'],
  },
  {
    id: 'ally',
    label: 'Ally',
    definition:
      'Cooperation toward a shared goal, without requiring personal closeness. May be transactional or temporary.',
    symmetric: true,
    fromIs: '',
    toIs: '',
    useWhen: [
      'They work together for a cause, faction, or bargain.',
      'The cooperation would end if the shared interest ended.',
    ],
    notWhen: [
      'One holds formal authority over the other — use `commands`.',
      'One coerces or uses the other against their will — use `enemy` or `captor`.',
      'The tie is personal rather than strategic — use `friend`.',
      'The label describes a single incident rather than an ongoing stance — record it as an event instead.',
    ],
    exampleLabels: ['revolution', 'political deal', 'co-leader', 'venin bond'],
  },
  {
    id: 'commands',
    label: 'Commands',
    definition:
      'Formal authority of one character over another within an acknowledged hierarchy.',
    symmetric: false,
    fromIs: 'the superior',
    toIs: 'the subordinate',
    useWhen: [
      'The chain of authority is official and others would recognise it.',
      'Orders would be expected to be obeyed as a matter of structure.',
    ],
    notWhen: [
      'The control is coercive or magical rather than structural — use `enemy` or `captor`.',
      'The senior party teaches rather than directs — use `mentor`.',
    ],
    exampleLabels: ['command structure', 'commander'],
  },
  {
    id: 'mentor',
    label: 'Mentor',
    definition: 'One character deliberately teaches, trains, or guides another.',
    symmetric: false,
    fromIs: 'the mentor',
    toIs: 'the student',
    useWhen: [
      'There is instruction, training, or sustained guidance.',
      'The relationship is developmental rather than merely hierarchical.',
    ],
    notWhen: [
      'The authority is positional, not instructional — use `commands`.',
      'The guidance is a cover for manipulation — use `betrayer`.',
    ],
    exampleLabels: ['signet training', 'dragon professor', 'trustworthy prof'],
  },

  // ── Antagonism ──────────────────────────────────────────────────────────
  {
    id: 'enemy',
    label: 'Enemy',
    definition:
      'Active hostility or opposition, from mutual dislike through attempted murder.',
    symmetric: false,
    fromIs: 'the aggressor, when one-sided',
    toIs: 'the target',
    useWhen: [
      'One acts against the other, or both openly oppose each other.',
      'One attacked the other and the target survived.',
    ],
    notWhen: [
      'The target died by their hand — use `killed`.',
      'They hold the other captive — use `captor`.',
      'The hostility followed broken trust — use `betrayer`.',
      'The relationship flipped over the series — use `complicated`.',
    ],
    exampleLabels: ['hunts her', 'tortures her', 'struck him down (survived)'],
  },
  {
    id: 'betrayer',
    label: 'Betrayer',
    definition:
      'One character violated trust the other had deliberately placed in them.',
    symmetric: false,
    fromIs: 'the betrayer',
    toIs: 'the betrayed',
    useWhen: [
      'There was real trust first, and it was broken.',
      'The betrayal is a defining fact of the pairing.',
    ],
    notWhen: [
      'They were always hostile — no trust existed to break, so use `enemy`.',
      'They changed sides toward the protagonists — use `complicated`.',
    ],
    exampleLabels: ['groomed her', 'drugs her', 'venin spy'],
  },
  {
    id: 'captor',
    label: 'Captor',
    definition: 'One character holds another against their will.',
    symmetric: false,
    fromIs: 'the captor',
    toIs: 'the captive',
    useWhen: [
      'Confinement or control of movement is ongoing, not a single scene.',
      'The captive cannot leave freely.',
    ],
    notWhen: [
      'The hostility is open combat rather than confinement — use `enemy`.',
      'Authority is legitimate and the subordinate may leave — use `commands`.',
    ],
    exampleLabels: ['captor/captive', 'holds prisoner'],
  },
  {
    id: 'killed',
    label: 'Killed',
    definition:
      "One character directly caused another's death.",
    symmetric: false,
    fromIs: 'the killer',
    toIs: 'the victim',
    useWhen: [
      'The victim died, and this character is the direct cause.',
      'The killer is a specific, identified character.',
    ],
    notWhen: [
      'The victim survived the attempt — use `enemy`. "Struck down" is not "killed".',
      'The killer is unnamed or a faceless force — record the death as an event instead.',
      'The character sacrificed themselves — that is an event, not a relationship.',
      'The two died together with neither causing it — use `bonded` and let both statuses carry the death.',
    ],
    exampleLabels: ['executed him', 'kills him', 'stabs him'],
  },

  // ── Change over time ────────────────────────────────────────────────────
  {
    id: 'complicated',
    label: 'Complicated',
    definition:
      'The relationship changed category across the series, or genuinely resists a single label.',
    symmetric: true,
    fromIs: '',
    toIs: '',
    useWhen: [
      'The pairing moved between categories — enemy to ally, lover to rival.',
      'Two categories apply at once and neither dominates.',
    ],
    notWhen: [
      'One category clearly fits — use it. `complicated` is not a shortcut for "not sure".',
      'The label would describe a single incident — record an event instead.',
    ],
    exampleLabels: ['enemy → ally', 'ex-boyfriend', 'childhood crush'],
  },
];

export const RELATIONSHIP_IDS = new Set(RELATIONSHIP_TYPES.map((r) => r.id));
export const RELATIONSHIP_BY_ID = new Map(RELATIONSHIP_TYPES.map((r) => [r.id, r]));

/**
 * Legacy type strings mapped onto the canonical vocabulary.
 *
 * Keys are lowercased. Plated Prisoner's phrase-ids dominate this list; its
 * migration in Phase 2 depends on it. Where a legacy type collapses into a
 * canonical one, `label` supplies the nuance that would otherwise be lost.
 */
export const TYPE_ALIASES: Record<string, { type: string; label?: string }> = {
  // Empyrean — already canonical
  bonded: { type: 'bonded' },
  mated: { type: 'mated' },
  romantic: { type: 'romantic' },
  family: { type: 'family' },
  squad: { type: 'squad' },
  ally: { type: 'ally' },
  enemy: { type: 'enemy' },
  mentor: { type: 'mentor' },
  betrayer: { type: 'betrayer' },
  killed: { type: 'killed' },
  complicated: { type: 'complicated' },

  // DCC — `party` is the same concept as Empyrean's `squad`
  party: { type: 'squad', label: 'party' },

  // Plated Prisoner — 21 phrase-ids collapse to 11 canonical types
  'captor/captive': { type: 'captor', label: 'captor/captive' },
  'slow-burn romance': { type: 'romantic', label: 'slow burn' },
  'love interest': { type: 'romantic', label: 'love interest' },
  'fated mates (päyur)': { type: 'mated', label: 'fated mates (Päyur)' },
  married: { type: 'romantic', label: 'married' },
  friend: { type: 'friend' },
  'trusted guard': { type: 'ally', label: 'trusted guard' },
  commander: { type: 'commands', label: 'commander' },
  'wrath (squad)': { type: 'squad', label: 'Wrath squad' },
  hostile: { type: 'enemy', label: 'hostile' },
  'political deal': { type: 'ally', label: 'political deal' },
  sibling: { type: 'family', label: 'sibling' },
  'parent/child': { type: 'family', label: 'parent/child' },
  ancestor: { type: 'family', label: 'ancestor' },
  'sacrifices for': { type: 'ally', label: 'sacrificed for them' },
  rebellion: { type: 'ally', label: 'rebellion' },
  'mentor / loyalist': { type: 'mentor', label: 'loyalist' },
};

/**
 * Kinship terms permitted in a `family` label.
 *
 * Enforced because `family` was collecting non-kinship ties: "raised together"
 * (two unrelated boys), "died saving him" (an event), "calls her home".
 */
export const KINSHIP_TERMS = [
  'mother', 'father', 'parent', 'sister', 'brother', 'sibling', 'son', 'daughter',
  'child', 'cousin', 'uncle', 'aunt', 'niece', 'nephew', 'grandmother',
  'grandfather', 'grandparent', 'grandchild', 'grandson', 'granddaughter',
  'ancestor', 'descendant', 'great-grandmother', 'great-grandfather',
  'in-law', 'stepmother', 'stepfather', 'stepsister', 'stepbrother',
  'adopted', 'guardian', 'ward', 'heir', 'twin', 'parent/child',
];

const KINSHIP_RE = new RegExp(`\\b(${KINSHIP_TERMS.join('|')})`, 'i');

export function isKinshipLabel(label: string): boolean {
  return KINSHIP_RE.test(label);
}

/**
 * Edges that break a vocabulary rule but are correct as written, with the
 * reason. Same pattern as the canon CORRECTIONS: exceptions are recorded, not
 * hidden by loosening the rule.
 */
export const VOCAB_EXCEPTIONS: Record<string, string> = {
  'empyrean:violet>jack:killed':
    "Violet does kill Jack in book 1; he is mended by Nolon and returns, so his " +
    "final status is `prisoner` rather than `dead`. The death was real but not permanent.",
};

/**
 * Edges whose type looks wrong but where the correct replacement is a judgment
 * call for the author. Listed so they are visible without failing the build.
 */
export const VOCAB_PENDING_REVIEW: Record<string, { recommend: string; why: string }> = {
  'empyrean:xaden>liam:family': {
    recommend: 'friend',
    why: '"raised together" is not kinship — Xaden and Liam are not related.',
  },
  'empyrean:naolin>brennan:family': {
    recommend: 'ally',
    why: '"died saving him" describes an event, not a kinship tie.',
  },
  'empyrean:leothan>andarna:family': {
    recommend: 'mentor or ally',
    why: '"calls her home" is not kinship; Leothan draws Andarna to the Irids.',
  },
  'empyrean:varrish>jack:ally': {
    recommend: 'enemy or captor',
    why: '"wields him" is coercive use, not cooperation between equals.',
  },
  'empyrean:varrish>nolon:ally': {
    recommend: 'enemy or captor',
    why: '"controls him" is coercion, not alliance.',
  },
  'empyrean:imogen>violet:ally': {
    recommend: 'keep ally, relabel',
    why: '"erased her memory" names a single incident; the ongoing tie is alliance. ' +
      'The incident is already recorded as a book-3 event.',
  },
  'empyrean:wyvern_rep>theophanie:ally': {
    recommend: 'bonded or keep ally',
    why: '"venin steeds" describes wyverns as mounts, which is closer to a pact than an alliance.',
  },
  'empyrean:wyvern_rep>berwyn:ally': {
    recommend: 'bonded or keep ally',
    why: '"venin steeds" again describes wyverns as mounts rather than as partners ' +
      'cooperating toward a shared goal.',
  },
  'plated-prisoner:cull>elore:family': {
    recommend: 'romantic "married", or family "co-parents"',
    why: 'Lord Cull is Slade\'s father and Elore is his mother, so they are ' +
      'co-parents rather than blood kin. Whether they were married — and whether ' +
      'they still are, given Cull turns out to be the villain — is a canon call.',
  },
  'dcc:donut>kiwi:family': {
    recommend: 'squad',
    why: 'Kiwi is a Royal Court pet bird who joined on Floor 7, not a relative. ' +
      'The Royal Court is a named unit, so `squad` fits.',
  },
  'dcc:donut>rend:family': {
    recommend: 'squad, and possibly re-point to carl',
    why: 'Rend was gifted to Carl by Tserendelgor, not to Donut. Both the type ' +
      'and the endpoint look wrong.',
  },
};
