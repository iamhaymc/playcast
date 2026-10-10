/**
 * core.mjs — the Chordcast engine.
 *
 * Portable game logic shared by the host (the authority) and the page (the
 * display). No DOM and no Node APIs live here. Everything moves as messages:
 * seats send `press` orders into a Match, the Match advances in fixed ticks,
 * and it emits plain events and frames that the host relays to every player.
 *
 *    1  Kit     constants, rules, timing, metamagic, reactions and garb
 *    2  Dice    seeded random numbers
 *    3  Acts    effect builders used by spells
 *    4  Lore    plain text for spells and auras
 *    5  Codex   the spell catalog, wisp spells, costs and cast times
 *    6  Book    the spells of one match, their chords, kits and reshuffles
 *    7  Board   seats, rows and the target cursor
 *    8  Match   the simulation: draft, chords, casts, wards, flow, reactions
 *    9  Brain   the deterministic bot mind
 *   10  Pilot   drafts, turns brain plans into key presses, raises wards
 *   11  Arena   runs a match with pilots
 *   12  Wire    the message protocol
 */

// ─── 1 · Kit ────────────────────────────────────────────────────────────────

export const TICK_RATE = 20
export const TICK_MS = 1000 / TICK_RATE

/** Seconds to whole ticks. */
export const secs = (seconds) => Math.round(seconds * TICK_RATE)

export const MOVES = ['up', 'left', 'right', 'down']
export const RUNES = ['star', 'wave', 'flame', 'leaf'] // top, left, right, bottom
export const KEYS = [...MOVES, ...RUNES, 'meta', 'ward', 'call', 'drop']
export const KINDS = ['offense', 'defense']
export const SCHOOLS = ['fire', 'frost', 'storm', 'nature', 'shadow', 'holy', 'arcane']
export const TEAMS = ['Dawn', 'Dusk']
export const AIMS = ['foe', 'ally', 'self', 'any', 'fallen']

/** Seconds from launch to landing, per flight style. */
export const FLIGHTS = { bolt: 0.55, volley: 0.65, beam: 0.15, arc: 0.1, fall: 0.7, rise: 0.35, nova: 0.3, aura: 0.15 }

export const TIMING = {
  ready: 15, // seconds to draft a kit from the book before the fight
  early: 3, // the fight starts this soon once every kit is full
  idle: 2.5, // a chord clears after this long without a key
  stagger: 0.6, // keys are ignored this long after a fizzle
  recover: 0.4, // pause after a cast before the next one starts
  regen: 6, // mana per second
  mana: 100, // mana pool
  surge: 0.02, // share of max life lost per surge wave, growing each second
  dampen: 0.4, // healing power left when the surge begins (falls from 100%)
  swift: [0.1, 0.35], // seconds between chord keys for the fastest and the slowest cast
  quick: 0.6, // share of the cast time left after the fastest chord
  ward: 0.3, // seconds a ward stays up
  wardCool: 5, // seconds between wards
  wardRefund: 1, // seconds left on the ward cooldown after a parry
  grace: 1, // seconds immune to stuns and sleeps after one ends
  fade: 15, // seconds before a lock group's diminishing returns reset
  flow: 5, // most flow stacks
  flowPace: 0.08, // cast speed per flow stack
  flowCost: 0.05, // mana discount per flow stack
  flowFade: 4, // seconds without a cast before flow starts to fall, one stack per 1.5s
  shift: 45, // seconds between chord reshuffles (and one when the surge begins)
  call: 6, // seconds a call marks its target
}

/** Chord length per spell tier: bigger spells take more runes. */
export const CHORD_LENGTH = { 1: 2, 2: 3, 3: 5 }

/** Lock durations from foes shrink with each repeat in the fade window, then stop landing. */
export const DIMINISH = [1, 0.5, 0.25]

/**
 * Metamagic: `meta` then a rune, before the chord's last rune. Each changes
 * the spell; costs multiply when they stack.
 */
export const METAS = {
  quicken: { rune: 'star', name: 'Quicken', cost: 1.5, text: 'Cast instantly' },
  twin: { rune: 'wave', name: 'Twin', cost: 2, text: 'Also hits the mage beside the target' },
  empower: { rune: 'flame', name: 'Empower', cost: 1.5, power: 1.4, slow: 1.5, text: '40% stronger, 50% longer cast' },
  extend: { rune: 'leaf', name: 'Extend', cost: 1.5, stretch: 1.5, text: 'Effects last 50% longer' },
}
export const META_OF_RUNE = Object.fromEntries(Object.entries(METAS).map(([id, meta]) => [meta.rune, id]))

/**
 * Reactions: a direct hostile hit of school `hit` on a target with a bane of
 * school `on` hits harder, uses up that bane and adds a rider.
 */
export const REACTIONS = [
  { name: 'Melt', hit: 'fire', on: 'frost', times: 1.5, text: 'Fire on frost: ×1.5' },
  { name: 'Shatter', hit: 'storm', on: 'frost', times: 1.4, pierce: true, text: 'Storm on frost: ×1.4 through shields' },
  { name: 'Steam', hit: 'frost', on: 'fire', times: 1.3, stall: 0.8, text: 'Frost on fire: ×1.3, breaks the chord and stalls keys' },
  { name: 'Wildfire', hit: 'nature', on: 'fire', times: 1.2, spread: true, text: 'Nature on fire: ×1.2, the fire spreads beside it' },
  { name: 'Overload', hit: 'arcane', on: 'storm', times: 1.4, burn: 20, text: 'Arcane on storm: ×1.4, burns 20 mana' },
  { name: 'Purify', hit: 'holy', on: 'shadow', times: 1.5, leech: 0.5, text: 'Holy on shadow: ×1.5, heals you for half' },
  { name: 'Eclipse', hit: 'shadow', on: 'holy', times: 1.4, hush: 1.5, text: 'Shadow on holy: ×1.4, silences 1.5s' },
]

/** Healing power at a tick, shared by host and page so the HUD shows the truth. */
export function dampenAt(tick, fightAt, surgeAt) {
  const share = clamp((tick - fightAt) / Math.max(1, surgeAt - fightAt), 0, 1)
  return Math.round((1 - (1 - TIMING.dampen) * share) * 100) / 100
}

export const RULES = { teams: [1, 1], book: 16, kit: 8, life: 800, surge: 90, skill: 'normal' }
export const LIMITS = { team: [1, 8], book: [12, 24], kit: [4, 12], life: [400, 3000], surge: [20, 600] }

/**
 * Bot skill: think pause, key gap and reaction (seconds), choice noise, the
 * most metamagic per spell, and the chance to parry a spell it sees coming.
 */
export const SKILLS = {
  easy: { think: [1.2, 2.0], gap: [0.3, 0.42], react: [0.5, 0.9], noise: 0.45, metas: 0, parry: 0.1 },
  normal: { think: [0.6, 1.1], gap: [0.19, 0.27], react: [0.3, 0.6], noise: 0.18, metas: 1, parry: 0.35 },
  hard: { think: [0.25, 0.5], gap: [0.12, 0.17], react: [0.15, 0.3], noise: 0.05, metas: 2, parry: 0.7 },
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const wholeIn = (value, [low, high], fallback) =>
  Number.isFinite(Number(value)) ? clamp(Math.round(Number(value)), low, high) : fallback

/** Clamp any rules object into a valid one. */
export function tidyRules(input = {}) {
  const teams = Array.isArray(input.teams) ? input.teams : RULES.teams
  const book = wholeIn(input.book, LIMITS.book, RULES.book) & ~1
  return {
    teams: [0, 1].map((t) => wholeIn(teams[t], LIMITS.team, RULES.teams[t])),
    book,
    kit: Math.min(wholeIn(input.kit, LIMITS.kit, RULES.kit), book - 4),
    life: wholeIn(input.life, LIMITS.life, RULES.life),
    surge: wholeIn(input.surge, LIMITS.surge, RULES.surge),
    skill: SKILLS[input.skill] ? input.skill : RULES.skill,
  }
}

/**
 * What a mage wears, picked in the lobby: a hat, a robe and a staff. Garb
 * is looks only and never changes play; the team still sets the colors.
 */
export const GARB = {
  hat: ['pointed', 'wide', 'hood', 'circlet'],
  robe: ['plain', 'mantle', 'banded', 'split'],
  staff: ['gem', 'orb', 'crook', 'branch'],
}

/** Any garb input made valid: unknown or missing parts become the first style. */
export function tidyGarb(input) {
  const garb = input && typeof input === 'object' ? input : {}
  return Object.fromEntries(Object.entries(GARB).map(([part, styles]) => [part, styles.includes(garb[part]) ? garb[part] : styles[0]]))
}

/** A garb chosen by a whole number, so a seed gives every bot its own look. */
export function pickGarb(seed) {
  // Mix the bits first (murmur3's finalizer), so neighboring seeds dress differently.
  let rest = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b)
  rest = Math.imul(rest ^ (rest >>> 13), 0xc2b2ae35)
  rest = (rest ^ (rest >>> 16)) >>> 0
  return Object.fromEntries(
    Object.entries(GARB).map(([part, styles]) => {
      const style = styles[rest % styles.length]
      rest = Math.floor(rest / styles.length)
      return [part, style]
    }),
  )
}

// ─── 2 · Dice ───────────────────────────────────────────────────────────────

/** FNV-1a hash of a string into an unsigned 32-bit seed. */
export function hashText(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Small, fast, seeded random numbers (mulberry32). Same seed, same rolls. */
export class Dice {
  constructor(seed = 1) {
    this.state = (typeof seed === 'number' ? seed : hashText(String(seed))) >>> 0 || 1
  }
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  float(low, high) {
    return low + (high - low) * this.next()
  }
  int(count) {
    return Math.floor(this.next() * count)
  }
  pick(list) {
    return list[this.int(list.length)]
  }
  shuffle(list) {
    const out = [...list]
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  fork(salt) {
    return new Dice(hashText(`${this.state}:${salt}`))
  }
}

// ─── 3 · Acts ───────────────────────────────────────────────────────────────
//
// An act is plain data: { op, ...params }. Spells list acts; the Match runs
// them through its OPS table and the Brain weighs them through WEIGH. To add
// an effect: add a builder here, a handler in OPS, a weight in WEIGH and a
// line in LORE.

export const harm = (amount, more = {}) => ({ op: 'harm', amount, ...more })
export const heal = (amount) => ({ op: 'heal', amount })
export const drain = (amount) => ({ op: 'drain', amount })
export const mana = (amount) => ({ op: 'mana', amount })
export const burn = (amount, ratio = 0) => ({ op: 'burn', amount, ratio })
export const siphon = (amount) => ({ op: 'siphon', amount })
export const purge = (count) => ({ op: 'purge', kind: 'boon', count })
export const cleanse = (count, kind = 'bane') => ({ op: 'purge', kind, count })
export const steal = (count) => ({ op: 'steal', count })
export const interrupt = (time) => ({ op: 'interrupt', time })
export const chain = (jumps, falloff, ...acts) => ({ op: 'chain', jumps, falloff, acts })
export const side = (...acts) => ({ op: 'side', acts })
export const scatter = (count, ...acts) => ({ op: 'scatter', count, acts })
export const self = (...acts) => ({ op: 'self', acts })
export const pick = (...acts) => ({ op: 'pick', acts })
export const revive = (share) => ({ op: 'revive', share })
export const refresh = () => ({ op: 'refresh' })
export const swap = () => ({ op: 'swap' })
export const spread = () => ({ op: 'spread' })
export const kill = (below, ...acts) => ({ op: 'kill', below, acts })

/**
 * Aura (status) rules, all optional:
 *   name kind look school time        identity and display
 *   pulse grow                        acts each second; grow raises them per pulse
 *   taken dealt mended pace regen     multipliers on damage taken/dealt, healing
 *                                     received, cast speed and mana regen
 *   lock                              'stun' | 'sleep' (breaks on damage) | 'hush'
 *   guard                             absorbs this much damage
 *   immune steady                     ignore harm / ignore locks
 *   mirror evade charges              reflect / dodge the next spells
 *   thorns leech cheat shift          return damage, life steal, survive death,
 *                                     share of damage paid with mana
 *   struck expire purged              acts when hit / at the end / when removed
 *   rewind                            restore life to its value at the start
 */
export const mark = (time, rules) => ({ op: 'mark', aura: { time, ...rules } })
export const dot = (perSecond, time, name, more = {}) =>
  mark(time, { name, kind: 'bane', look: 'dot', pulse: [harm(perSecond, { tick: true })], ...more })
export const hot = (perSecond, time, name, more = {}) =>
  mark(time, { name, kind: 'boon', look: 'hot', pulse: [heal(perSecond)], ...more })
export const stun = (time, name = 'Stunned', look = 'stun') => mark(time, { name, kind: 'bane', lock: 'stun', look })
export const sleep = (time, name = 'Asleep', look = 'sleep') => mark(time, { name, kind: 'bane', lock: 'sleep', look })
export const hush = (time, name = 'Silenced') => mark(time, { name, kind: 'bane', lock: 'hush', look: 'hush' })
export const slow = (share, time, name = 'Slowed') => mark(time, { name, kind: 'bane', pace: 1 - share, look: 'slow' })
export const haste = (share, time, name = 'Hasted') => mark(time, { name, kind: 'boon', pace: 1 + share, look: 'haste' })
export const expose = (share, time, name = 'Exposed') => mark(time, { name, kind: 'bane', taken: 1 + share, look: 'expose' })
export const armor = (share, time, name) => mark(time, { name, kind: 'boon', taken: 1 - share, look: 'armor' })
export const weaken = (share, time, name = 'Weakened') => mark(time, { name, kind: 'bane', dealt: 1 - share, look: 'weak' })
export const empower = (share, time, name) => mark(time, { name, kind: 'boon', dealt: 1 + share, look: 'power' })
export const shield = (amount, time, name, more = {}) => mark(time, { name, kind: 'boon', guard: amount, look: 'shield', ...more })
export const thorns = (amount, time, name) => mark(time, { name, kind: 'boon', thorns: amount, look: 'thorns' })

// ─── 4 · Lore ───────────────────────────────────────────────────────────────
//
// Spell text is built from acts, so the words always match the rules.

const percent = (share) => `${Math.round(share * 100)}%`
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const nextSpells = (count) => (count === 1 ? 'next spell' : `next ${count} spells`)

export const AIM_TEXT = { foe: 'Foe', ally: 'Ally', self: 'Self', any: 'Anyone', fallen: 'Fallen ally' }
const BONUS_TEXT = { locked: 'on stunned or sleeping foes', burning: 'on burning foes', low: 'below 30% life' }
const LOCK_TEXT = { stun: 'stunned', sleep: 'can’t act (breaks on damage)', hush: 'silenced' }

const LORE = {
  harm: (act, school) => {
    let text = `deal ${act.amount} ${act.school ?? school}`
    if (act.pierce) text += ' through shields'
    if (act.sure && !act.pierce) text += ' that never misses'
    if (act.bonus) text += ` (×${act.bonus.times} ${BONUS_TEXT[act.bonus.when]})`
    return text
  },
  heal: (act) => `heal ${act.amount}`,
  drain: (act) => `drain ${act.amount} life`,
  mana: (act) => (act.amount >= 0 ? `restore ${act.amount} mana` : `burn ${-act.amount} mana`),
  burn: (act, school) => `burn ${act.amount} mana` + (act.ratio ? ` and deal ${act.ratio}× that as ${school}` : ''),
  siphon: (act) => `steal ${act.amount} mana`,
  purge: (act) => {
    if (act.kind === 'boon') return `remove ${plural(act.count, 'boon')}`
    if (act.kind === 'lock') return 'remove stuns, sleeps and silences'
    return act.count > 4 ? 'remove all banes' : `remove ${plural(act.count, 'bane')}`
  },
  steal: (act) => `steal ${plural(act.count, 'boon')}`,
  interrupt: (act) => `interrupt a cast and silence ${act.time}s`,
  chain: (act, school) => `${describeActs(act.acts, school)}, then jump to ${act.jumps} more at ${percent(act.falloff)} each`,
  side: (act, school) => `${describeActs(act.acts, school)} to everyone on that side`,
  scatter: (act, school) => `${act.count} strikes on random foes: ${describeActs(act.acts, school)} each`,
  self: (act, school) => `you ${describeActs(act.acts, school)}`,
  pick: (act, school) => `one at random: ${act.acts.map((a) => describeAct(a, school)).join(' / ')}`,
  revive: (act) => `revive with ${percent(act.share)} life`,
  refresh: () => 'reset all cooldowns',
  swap: () => 'swap life shares with the target',
  spread: () => 'copy its banes to its allies',
  kill: (act, school) => `slay if below ${percent(act.below)} life, else ${describeActs(act.acts, school)}`,
  mark: (act, school, name) => describeAura(act.aura, school, name),
}

export function describeAct(act, school, name) {
  return LORE[act.op](act, school, name)
}

/** Acts joined with commas; runs of the same act read "…, 3 times". */
export function describeActs(acts, school, name) {
  const parts = []
  for (const act of acts) {
    const text = describeAct(act, school, name)
    const last = parts[parts.length - 1]
    if (last && last.text === text) last.count++
    else parts.push({ text, count: 1 })
  }
  return parts.map(({ text, count }) => (count > 1 ? `${text}, ${count} times` : text)).join(', ')
}

/** Plain text for an aura, e.g. "Burning: 10 fire per second for 4s". */
export function describeAura(aura, school, fallback) {
  const auraSchool = aura.school ?? school
  const name = aura.name ?? fallback
  const plain = aura.lock && name?.toLowerCase() === LOCK_TEXT[aura.lock]
  const label = name && !plain ? `${name}: ` : ''
  const parts = []
  for (const act of aura.pulse ?? []) {
    if (act.op === 'harm') parts.push(`${act.amount} ${auraSchool} per second${aura.grow ? ', rising' : ''}`)
    else if (act.op === 'heal') parts.push(`heal ${act.amount} per second`)
    else parts.push(`${describeAct(act, auraSchool)} each second`)
  }
  if (aura.lock) parts.push(LOCK_TEXT[aura.lock])
  if (aura.immune) parts.push('immune to harm')
  if (aura.guard) parts.push(`shield ${aura.guard}`)
  if (aura.taken) parts.push(`take ${percent(Math.abs(1 - aura.taken))} ${aura.taken < 1 ? 'less' : 'more'} damage`)
  if (aura.dealt) parts.push(`deal ${percent(Math.abs(1 - aura.dealt))} ${aura.dealt > 1 ? 'more' : 'less'} damage`)
  if (aura.pace) parts.push(`cast ${percent(Math.abs(1 - aura.pace))} ${aura.pace > 1 ? 'faster' : 'slower'}`)
  if (aura.mended === 0) parts.push('no healing')
  else if (aura.mended) parts.push(`${percent(Math.abs(1 - aura.mended))} ${aura.mended > 1 ? 'more' : 'less'} healing`)
  if (aura.regen) parts.push(`mana regen ×${aura.regen}`)
  if (aura.mirror) parts.push(`reflect the ${nextSpells(aura.charges)}`)
  if (aura.evade) parts.push(`dodge the ${nextSpells(aura.charges)}`)
  if (aura.thorns) parts.push(`return ${aura.thorns} ${auraSchool} to attackers`)
  if (aura.leech) parts.push(`heal for ${percent(aura.leech)} of damage dealt`)
  if (aura.cheat) parts.push(`survive a killing blow at ${percent(aura.cheat)} life`)
  if (aura.shift) parts.push(`${percent(aura.shift)} of damage drains mana instead`)
  if (aura.steady) parts.push('immune to stun and silence')
  if (aura.struck) parts.push(`when hit, ${describeActs(aura.struck, auraSchool)} (up to ${aura.charges}×)`)
  let text = parts.length ? `${label}${parts.join(', ')} for ${aura.time}s` : `${label}after ${aura.time}s`
  if (aura.rewind) text += ', return to your life at the start if it was higher'
  if (aura.expire) text += `${parts.length ? ', then' : ','} ${describeActs(aura.expire, auraSchool)}`
  if (aura.purged) text += `. If removed, the remover suffers: ${describeActs(aura.purged.map(bareAct), auraSchool)}`
  return text
}

/** A nested lock reads "silence 3s" instead of a full named aura. */
function bareAct(act) {
  if (act.op !== 'mark' || !act.aura.lock || act.aura.pulse) return act
  return { op: 'interrupt', time: act.aura.time, bare: true }
}
LORE.interrupt = (act) => (act.bare ? `silence ${act.time}s` : `interrupt a cast and silence ${act.time}s`)

/** Plain text for a spell. */
export function describeSpell(spell) {
  if (!Array.isArray(spell.acts)) {
    return `On a foe: ${describeActs(spell.acts.foe, spell.school, spell.name)}. On an ally: ${describeActs(spell.acts.ally, spell.school, spell.name)}.`
  }
  const sentences = []
  for (const act of spell.acts) {
    const text = capital(describeAct(act, spell.school, spell.name))
    const last = sentences[sentences.length - 1]
    if (last && last.text === text) last.count++
    else sentences.push({ text, count: 1 })
  }
  const body = sentences.map(({ text, count }) => (count > 1 ? `${text}, ${count} times` : text)).join('. ')
  return spell.reach === 'side' ? `${body}. Hits the whole side.` : `${body}.`
}

// ─── 5 · Codex ──────────────────────────────────────────────────────────────
//
// Every spell: id, name, kind (offense | defense), school, tier (1–3, sets
// chord length), aim (foe | ally | self | any | fallen), reach (one | side),
// cast/cool seconds, mana cost, flight style and acts. For aim 'any', acts is
// { foe: [...], ally: [...] }. `team: true` marks spells that need teammates.
// Inspired by tabletop and MMO spellbooks.

const O = 'offense'
const D = 'defense'

const SPELL_LIST = [
  // Fire ──────────────────────────────────────────────────────────────────
  { id: 'fire-bolt', name: 'Fire Bolt', kind: O, school: 'fire', tier: 1, cast: 0.6, cool: 2, cost: 6, flight: 'bolt', acts: [harm(70)] },
  { id: 'scorch', name: 'Scorch', kind: O, school: 'fire', tier: 1, cast: 0, cool: 4, cost: 8, flight: 'rise', acts: [harm(55)] },
  { id: 'immolate', name: 'Immolate', kind: O, school: 'fire', tier: 1, cast: 0.7, cool: 6, cost: 10, flight: 'rise', acts: [harm(40), dot(16, 8, 'Immolated')] },
  { id: 'fireball', name: 'Fireball', kind: O, school: 'fire', tier: 2, cast: 1, cool: 6, cost: 16, flight: 'bolt', acts: [harm(150), dot(10, 4, 'Burning')] },
  { id: 'scorching-ray', name: 'Scorching Ray', kind: O, school: 'fire', tier: 2, cast: 0.7, cool: 8, cost: 16, flight: 'volley', acts: [harm(50), harm(50), harm(50)] },
  { id: 'living-bomb', name: 'Living Bomb', kind: O, school: 'fire', tier: 2, cast: 0, cool: 12, cost: 18, flight: 'aura', acts: [mark(4, { kind: 'bane', look: 'bomb', pulse: [harm(15, { tick: true })], expire: [side(harm(110))] })] },
  { id: 'flame-strike', name: 'Flame Strike', kind: O, school: 'fire', tier: 2, reach: 'side', cast: 1, cool: 10, cost: 22, flight: 'fall', acts: [harm(100), dot(8, 4, 'Burning')] },
  { id: 'lava-burst', name: 'Lava Burst', kind: O, school: 'fire', tier: 2, cast: 1, cool: 8, cost: 18, flight: 'bolt', acts: [harm(140, { bonus: { when: 'burning', times: 1.5 } })] },
  { id: 'dragon-breath', name: 'Dragon Breath', kind: O, school: 'fire', tier: 2, cast: 0, cool: 16, cost: 18, flight: 'nova', acts: [harm(90), sleep(3, 'Disoriented', 'daze')] },
  { id: 'combustion', name: 'Combustion', kind: O, school: 'fire', tier: 2, aim: 'self', cast: 0, cool: 24, cost: 14, flight: 'aura', acts: [empower(0.3, 6, 'Combustion')] },
  { id: 'pyroblast', name: 'Pyroblast', kind: O, school: 'fire', tier: 3, cast: 1.8, cool: 18, cost: 32, flight: 'bolt', acts: [harm(300), dot(20, 6, 'Burning')] },
  { id: 'meteor', name: 'Meteor', kind: O, school: 'fire', tier: 3, cast: 1.4, cool: 24, cost: 36, flight: 'fall', acts: [harm(240), side(harm(90))] },
  { id: 'fire-wall', name: 'Fire Wall', kind: O, school: 'fire', tier: 3, reach: 'side', cast: 1, cool: 20, cost: 30, flight: 'rise', acts: [dot(25, 6, 'Fire Wall')] },
  { id: 'rebuke', name: 'Rebuke', kind: D, school: 'fire', tier: 1, aim: 'self', cast: 0, cool: 14, cost: 8, flight: 'aura', acts: [thorns(50, 8, 'Rebuke')] },
  { id: 'cauterize', name: 'Cauterize', kind: D, school: 'fire', tier: 2, aim: 'self', cast: 0, cool: 20, cost: 12, flight: 'rise', acts: [heal(220), dot(15, 4, 'Cauterized')] },

  // Frost ─────────────────────────────────────────────────────────────────
  { id: 'frost-ray', name: 'Frost Ray', kind: O, school: 'frost', tier: 1, cast: 0.7, cool: 3, cost: 8, flight: 'beam', acts: [harm(60), slow(0.3, 4, 'Chilled')] },
  { id: 'ice-lance', name: 'Ice Lance', kind: O, school: 'frost', tier: 1, cast: 0, cool: 3, cost: 8, flight: 'bolt', acts: [harm(45, { bonus: { when: 'locked', times: 3 } })] },
  { id: 'frostbolt', name: 'Frostbolt', kind: O, school: 'frost', tier: 2, cast: 1, cool: 5, cost: 16, flight: 'bolt', acts: [harm(140), slow(0.3, 5, 'Chilled')] },
  { id: 'cone-of-cold', name: 'Cone of Cold', kind: O, school: 'frost', tier: 2, reach: 'side', cast: 0, cool: 12, cost: 20, flight: 'nova', acts: [harm(80), slow(0.4, 4, 'Chilled')] },
  { id: 'frost-nova', name: 'Frost Nova', kind: O, school: 'frost', tier: 2, reach: 'side', cast: 0, cool: 20, cost: 18, flight: 'nova', acts: [harm(30), stun(2, 'Frozen', 'ice')] },
  { id: 'ice-storm', name: 'Ice Storm', kind: O, school: 'frost', tier: 2, reach: 'side', cast: 0.8, cool: 12, cost: 22, flight: 'fall', acts: [harm(100)] },
  { id: 'blizzard', name: 'Blizzard', kind: O, school: 'frost', tier: 3, reach: 'side', cast: 1.4, cool: 20, cost: 30, flight: 'fall', acts: [dot(22, 6, 'Blizzard'), slow(0.3, 6, 'Chilled')] },
  { id: 'glacial-spike', name: 'Glacial Spike', kind: O, school: 'frost', tier: 3, cast: 1.8, cool: 20, cost: 30, flight: 'bolt', acts: [harm(260), stun(2.5, 'Frozen', 'ice')] },
  { id: 'ice-block', name: 'Ice Block', kind: D, school: 'frost', tier: 3, aim: 'self', cast: 0, cool: 40, cost: 10, flight: 'aura', acts: [cleanse(9), mark(4, { name: 'Ice Block', kind: 'boon', immune: true, lock: 'stun', look: 'ice' })] },
  { id: 'ice-barrier', name: 'Ice Barrier', kind: D, school: 'frost', tier: 2, cast: 0, cool: 14, cost: 16, flight: 'aura', acts: [shield(180, 10, 'Ice Barrier')] },
  { id: 'frost-armor', name: 'Frost Armor', kind: D, school: 'frost', tier: 2, aim: 'self', cast: 0, cool: 16, cost: 14, flight: 'aura', acts: [shield(120, 12, 'Frost Armor', { thorns: 30 })] },
  { id: 'winter-veil', name: 'Winter Veil', kind: D, school: 'frost', tier: 1, cast: 0, cool: 10, cost: 8, flight: 'aura', acts: [armor(0.2, 6, 'Winter Veil')] },

  // Storm ─────────────────────────────────────────────────────────────────
  { id: 'shocking-grasp', name: 'Shocking Grasp', kind: O, school: 'storm', tier: 1, cast: 0, cool: 10, cost: 10, flight: 'arc', acts: [harm(50), interrupt(1.5)] },
  { id: 'thunderclap', name: 'Thunderclap', kind: O, school: 'storm', tier: 1, reach: 'side', cast: 0, cool: 10, cost: 12, flight: 'nova', acts: [harm(40), interrupt(1)] },
  { id: 'spark', name: 'Spark', kind: O, school: 'storm', tier: 1, cast: 0.4, cool: 2, cost: 6, flight: 'arc', acts: [harm(60)] },
  { id: 'lightning-bolt', name: 'Lightning Bolt', kind: O, school: 'storm', tier: 2, cast: 1, cool: 6, cost: 16, flight: 'arc', acts: [harm(160)] },
  { id: 'chain-lightning', name: 'Chain Lightning', kind: O, school: 'storm', tier: 2, cast: 1, cool: 10, cost: 22, flight: 'arc', acts: [chain(2, 0.7, harm(120))] },
  { id: 'witch-bolt', name: 'Witch Bolt', kind: O, school: 'storm', tier: 2, cast: 0.7, cool: 10, cost: 14, flight: 'beam', acts: [harm(70), dot(20, 5, 'Tethered')] },
  { id: 'call-lightning', name: 'Call Lightning', kind: O, school: 'storm', tier: 2, cast: 0.7, cool: 8, cost: 18, flight: 'fall', acts: [harm(130)] },
  { id: 'ball-lightning', name: 'Ball Lightning', kind: O, school: 'storm', tier: 2, cast: 0.7, cool: 12, cost: 20, flight: 'volley', acts: [scatter(4, harm(45))] },
  { id: 'storm-fury', name: 'Storm Fury', kind: O, school: 'storm', tier: 3, reach: 'side', cast: 1.4, cool: 22, cost: 34, flight: 'fall', acts: [harm(150), sleep(1.5, 'Dazed', 'daze')] },
  { id: 'tailwind', name: 'Tailwind', kind: D, school: 'storm', tier: 2, cast: 0, cool: 16, cost: 14, flight: 'aura', acts: [haste(0.4, 8, 'Tailwind')] },
  { id: 'lightning-shield', name: 'Lightning Shield', kind: D, school: 'storm', tier: 1, aim: 'self', cast: 0, cool: 12, cost: 10, flight: 'aura', acts: [thorns(40, 10, 'Lightning Shield')] },
  { id: 'grounding', name: 'Grounding', kind: D, school: 'storm', tier: 2, cast: 0, cool: 18, cost: 12, flight: 'aura', acts: [mark(8, { name: 'Grounded', kind: 'boon', evade: true, charges: 1, look: 'mirror' })] },

  // Shadow ────────────────────────────────────────────────────────────────
  { id: 'chill-touch', name: 'Chill Touch', kind: O, school: 'shadow', tier: 1, cast: 0, cool: 6, cost: 8, flight: 'bolt', acts: [harm(50), mark(4, { name: 'No Healing', kind: 'bane', mended: 0, look: 'blight' })] },
  { id: 'eldritch-blast', name: 'Eldritch Blast', kind: O, school: 'shadow', tier: 1, cast: 0, cool: 3, cost: 8, flight: 'beam', acts: [harm(35), harm(35)] },
  { id: 'corruption', name: 'Corruption', kind: O, school: 'shadow', tier: 1, cast: 0, cool: 5, cost: 8, flight: 'aura', acts: [dot(16, 10, 'Corruption')] },
  { id: 'agony', name: 'Agony', kind: O, school: 'shadow', tier: 1, cast: 0, cool: 6, cost: 8, flight: 'aura', acts: [dot(6, 12, 'Agony', { grow: 0.25 })] },
  { id: 'hex', name: 'Hex', kind: O, school: 'shadow', tier: 1, cast: 0, cool: 10, cost: 8, flight: 'aura', acts: [expose(0.15, 8, 'Hexed')] },
  { id: 'shadow-bolt', name: 'Shadow Bolt', kind: O, school: 'shadow', tier: 2, cast: 1, cool: 5, cost: 16, flight: 'bolt', acts: [harm(150)] },
  { id: 'drain-life', name: 'Drain Life', kind: O, school: 'shadow', tier: 2, cast: 1, cool: 8, cost: 16, flight: 'beam', acts: [drain(120)] },
  { id: 'vampiric-touch', name: 'Vampiric Touch', kind: O, school: 'shadow', tier: 2, cast: 0.8, cool: 8, cost: 16, flight: 'aura', acts: [mark(8, { name: 'Vampiric Touch', kind: 'bane', look: 'dot', pulse: [drain(20)] })] },
  { id: 'unstable-affliction', name: 'Unstable Affliction', kind: O, school: 'shadow', tier: 2, cast: 0.8, cool: 8, cost: 16, flight: 'aura', acts: [dot(30, 6, 'Unstable Affliction', { purged: [harm(150), hush(3)] })] },
  { id: 'death-coil', name: 'Death Coil', kind: O, school: 'shadow', tier: 2, cast: 0, cool: 16, cost: 16, flight: 'bolt', acts: [harm(110), sleep(2.5, 'Horrified', 'fear')] },
  { id: 'fear', name: 'Fear', kind: O, school: 'shadow', tier: 2, cast: 0.8, cool: 14, cost: 14, flight: 'bolt', acts: [sleep(5, 'Feared', 'fear')] },
  { id: 'blight', name: 'Blight', kind: O, school: 'shadow', tier: 2, cast: 0.7, cool: 8, cost: 18, flight: 'rise', acts: [harm(130), mark(4, { name: 'Blighted', kind: 'bane', mended: 0.5, look: 'blight' })] },
  { id: 'mind-blast', name: 'Mind Blast', kind: O, school: 'shadow', tier: 2, cast: 0.8, cool: 6, cost: 16, flight: 'bolt', acts: [harm(120), burn(10)] },
  { id: 'contagion', team: true, name: 'Contagion', kind: O, school: 'shadow', tier: 2, cast: 0, cool: 16, cost: 16, flight: 'nova', acts: [spread()] },
  { id: 'howl-of-terror', name: 'Howl of Terror', kind: O, school: 'shadow', tier: 3, reach: 'side', cast: 0, cool: 30, cost: 26, flight: 'nova', acts: [sleep(3, 'Feared', 'fear')] },
  { id: 'doom', name: 'Doom', kind: O, school: 'shadow', tier: 3, cast: 0, cool: 24, cost: 30, flight: 'aura', acts: [mark(6, { name: 'Doom', kind: 'bane', look: 'doom', expire: [harm(340)] })] },
  { id: 'void-hunger', name: 'Void Hunger', kind: O, school: 'shadow', tier: 3, reach: 'side', cast: 1, cool: 20, cost: 30, flight: 'nova', acts: [dot(20, 5, 'Void Hunger'), slow(0.3, 5)] },
  { id: 'finger-of-death', name: 'Finger of Death', kind: O, school: 'shadow', tier: 3, cast: 1.4, cool: 22, cost: 32, flight: 'beam', acts: [harm(300)] },
  { id: 'kill-word', name: 'Kill Word', kind: O, school: 'shadow', tier: 3, cast: 0, cool: 30, cost: 30, flight: 'arc', acts: [kill(0.2, harm(60))] },
  { id: 'soul-swap', name: 'Soul Swap', kind: O, school: 'shadow', tier: 3, cast: 1, cool: 40, cost: 30, flight: 'beam', acts: [swap()] },
  { id: 'life-tap', name: 'Life Tap', kind: D, school: 'shadow', tier: 1, aim: 'self', cast: 0, cool: 10, cost: 0, flight: 'aura', acts: [harm(100, { pierce: true }), mana(30)] },
  { id: 'resolve', name: 'Resolve', kind: D, school: 'shadow', tier: 2, aim: 'self', cast: 0, cool: 24, cost: 12, flight: 'aura', acts: [mark(6, { name: 'Resolve', kind: 'boon', taken: 0.6, steady: true, look: 'steady' })] },

  // Holy ──────────────────────────────────────────────────────────────────
  { id: 'smite', name: 'Smite', kind: O, school: 'holy', tier: 1, cast: 0.7, cool: 2, cost: 8, flight: 'fall', acts: [harm(70)] },
  { id: 'sacred-flame', name: 'Sacred Flame', kind: O, school: 'holy', tier: 1, cast: 0, cool: 4, cost: 8, flight: 'fall', acts: [harm(55, { pierce: true })] },
  { id: 'guiding-bolt', name: 'Guiding Bolt', kind: O, school: 'holy', tier: 2, cast: 0.8, cool: 8, cost: 16, flight: 'bolt', acts: [harm(120), expose(0.2, 4, 'Guided')] },
  { id: 'holy-fire', name: 'Holy Fire', kind: O, school: 'holy', tier: 2, cast: 1, cool: 10, cost: 18, flight: 'fall', acts: [harm(110), dot(12, 6, 'Holy Fire')] },
  { id: 'judgment', name: 'Judgment', kind: O, school: 'holy', tier: 2, cast: 0, cool: 14, cost: 14, flight: 'fall', acts: [harm(80), hush(2.5)] },
  { id: 'holy-shock', name: 'Holy Shock', kind: O, school: 'holy', tier: 2, aim: 'any', cast: 0, cool: 8, cost: 14, flight: 'beam', acts: { foe: [harm(110)], ally: [heal(140)] } },
  { id: 'sunbeam', name: 'Sunbeam', kind: O, school: 'holy', tier: 3, cast: 1.4, cool: 18, cost: 30, flight: 'beam', acts: [harm(220), sleep(2, 'Blinded', 'daze')] },
  { id: 'healing-word', name: 'Healing Word', kind: D, school: 'holy', tier: 1, cast: 0, cool: 4, cost: 8, flight: 'rise', acts: [heal(70)] },
  { id: 'flash-heal', name: 'Flash Heal', kind: D, school: 'holy', tier: 1, cast: 0.7, cool: 3, cost: 12, flight: 'rise', acts: [heal(110)] },
  { id: 'renew', name: 'Renew', kind: D, school: 'holy', tier: 1, cast: 0, cool: 4, cost: 8, flight: 'aura', acts: [hot(18, 8, 'Renew')] },
  { id: 'power-shield', name: 'Power Shield', kind: D, school: 'holy', tier: 1, cast: 0, cool: 8, cost: 12, flight: 'aura', acts: [shield(130, 10, 'Power Shield')] },
  { id: 'cleanse', name: 'Cleanse', kind: D, school: 'holy', tier: 1, cast: 0, cool: 6, cost: 8, flight: 'aura', acts: [cleanse(2)] },
  { id: 'cure-wounds', name: 'Cure Wounds', kind: D, school: 'holy', tier: 2, cast: 1, cool: 4, cost: 16, flight: 'rise', acts: [heal(170)] },
  { id: 'penance', name: 'Penance', kind: D, school: 'holy', tier: 2, aim: 'any', cast: 0.7, cool: 10, cost: 16, flight: 'volley', acts: { foe: [harm(45), harm(45), harm(45)], ally: [heal(55), heal(55), heal(55)] } },
  { id: 'pain-suppression', name: 'Pain Suppression', kind: D, school: 'holy', tier: 2, cast: 0, cool: 24, cost: 12, flight: 'aura', acts: [armor(0.4, 6, 'Pain Suppression')] },
  { id: 'death-ward', name: 'Death Ward', kind: D, school: 'holy', tier: 2, cast: 0, cool: 30, cost: 16, flight: 'aura', acts: [mark(20, { name: 'Death Ward', kind: 'boon', cheat: 0.1, look: 'cheat' })] },
  { id: 'prayer-of-mending', name: 'Prayer of Mending', kind: D, school: 'holy', tier: 2, cast: 0, cool: 10, cost: 14, flight: 'aura', acts: [mark(20, { name: 'Prayer of Mending', kind: 'boon', struck: [heal(80)], charges: 3, look: 'mend' })] },
  { id: 'bless', name: 'Bless', kind: D, school: 'holy', tier: 2, reach: 'side', cast: 0, cool: 18, cost: 18, flight: 'aura', acts: [mark(8, { name: 'Blessed', kind: 'boon', dealt: 1.15, taken: 0.9, look: 'power' })] },
  { id: 'freedom', team: true, name: 'Freedom', kind: D, school: 'holy', tier: 2, cast: 0, cool: 18, cost: 12, flight: 'aura', acts: [cleanse(9, 'lock'), mark(4, { name: 'Freedom', kind: 'boon', steady: true, look: 'steady' })] },
  { id: 'holy-nova', name: 'Holy Nova', kind: D, school: 'holy', tier: 2, reach: 'side', cast: 0, cool: 12, cost: 18, flight: 'nova', acts: [heal(70)] },
  { id: 'greater-heal', name: 'Greater Heal', kind: D, school: 'holy', tier: 3, cast: 1.8, cool: 10, cost: 30, flight: 'rise', acts: [heal(360)] },
  { id: 'prayer-of-healing', name: 'Prayer of Healing', kind: D, school: 'holy', tier: 3, reach: 'side', cast: 1.4, cool: 14, cost: 30, flight: 'rise', acts: [heal(140)] },
  { id: 'guardian-spirit', name: 'Guardian Spirit', kind: D, school: 'holy', tier: 3, cast: 0, cool: 40, cost: 20, flight: 'aura', acts: [mark(8, { name: 'Guardian Spirit', kind: 'boon', cheat: 0.4, mended: 1.4, look: 'cheat' })] },
  { id: 'divine-shield', name: 'Divine Shield', kind: D, school: 'holy', tier: 3, aim: 'self', cast: 0, cool: 45, cost: 16, flight: 'aura', acts: [mark(3, { name: 'Divine Shield', kind: 'boon', immune: true, look: 'immune' })] },
  { id: 'lay-on-hands', name: 'Lay on Hands', kind: D, school: 'holy', tier: 3, cast: 0, cool: 45, cost: 0, flight: 'rise', acts: [heal(500)] },
  { id: 'revive', team: true, name: 'Revive', kind: D, school: 'holy', tier: 3, aim: 'fallen', cast: 2, cool: 30, cost: 30, flight: 'rise', acts: [revive(0.35)] },

  // Nature ────────────────────────────────────────────────────────────────
  { id: 'wrath', name: 'Wrath', kind: O, school: 'nature', tier: 1, cast: 0.7, cool: 2, cost: 8, flight: 'bolt', acts: [harm(70)] },
  { id: 'poison-spray', name: 'Poison Spray', kind: O, school: 'nature', tier: 1, cast: 0, cool: 5, cost: 8, flight: 'nova', acts: [harm(35), dot(10, 6, 'Poisoned')] },
  { id: 'acid-splash', name: 'Acid Splash', kind: O, school: 'nature', tier: 1, cast: 0, cool: 6, cost: 8, flight: 'bolt', acts: [harm(45), expose(0.1, 4, 'Corroded')] },
  { id: 'thorn-whip', name: 'Thorn Whip', kind: O, school: 'nature', tier: 1, cast: 0, cool: 8, cost: 10, flight: 'beam', acts: [harm(40), slow(0.25, 4, 'Snared')] },
  { id: 'entangle', name: 'Entangle', kind: O, school: 'nature', tier: 2, cast: 0.7, cool: 16, cost: 14, flight: 'rise', acts: [stun(2.5, 'Rooted', 'root'), dot(10, 4, 'Thorned')] },
  { id: 'insect-swarm', name: 'Insect Swarm', kind: O, school: 'nature', tier: 2, cast: 0.7, cool: 10, cost: 14, flight: 'nova', acts: [dot(18, 8, 'Swarmed'), weaken(0.2, 8)] },
  { id: 'earthquake', name: 'Earthquake', kind: O, school: 'nature', tier: 3, reach: 'side', cast: 1.4, cool: 22, cost: 32, flight: 'rise', acts: [harm(120), stun(1, 'Knocked Down')] },
  { id: 'rejuvenate', name: 'Rejuvenate', kind: D, school: 'nature', tier: 1, cast: 0, cool: 4, cost: 8, flight: 'aura', acts: [hot(15, 10, 'Rejuvenate')] },
  { id: 'barkskin', name: 'Barkskin', kind: D, school: 'nature', tier: 1, aim: 'self', cast: 0, cool: 16, cost: 6, flight: 'aura', acts: [armor(0.25, 8, 'Barkskin')] },
  { id: 'thorns', name: 'Thorns', kind: D, school: 'nature', tier: 1, cast: 0, cool: 12, cost: 8, flight: 'aura', acts: [thorns(35, 12, 'Thorns')] },
  { id: 'lifebloom', name: 'Lifebloom', kind: D, school: 'nature', tier: 2, cast: 0, cool: 8, cost: 14, flight: 'aura', acts: [hot(12, 6, 'Lifebloom', { expire: [heal(150)] })] },
  { id: 'regrowth', name: 'Regrowth', kind: D, school: 'nature', tier: 2, cast: 0.8, cool: 6, cost: 16, flight: 'rise', acts: [heal(100), hot(10, 6, 'Regrowth')] },
  { id: 'ironbark', name: 'Ironbark', kind: D, school: 'nature', tier: 2, cast: 0, cool: 20, cost: 12, flight: 'aura', acts: [armor(0.3, 8, 'Ironbark')] },
  { id: 'earth-shield', name: 'Earth Shield', kind: D, school: 'nature', tier: 2, cast: 0, cool: 12, cost: 14, flight: 'aura', acts: [mark(20, { name: 'Earth Shield', kind: 'boon', struck: [heal(60)], charges: 4, look: 'mend' })] },
  { id: 'chain-heal', name: 'Chain Heal', kind: D, school: 'nature', tier: 2, cast: 1, cool: 8, cost: 20, flight: 'arc', acts: [chain(2, 0.7, heal(150))] },
  { id: 'stoneskin', name: 'Stoneskin', kind: D, school: 'nature', tier: 2, cast: 0.7, cool: 14, cost: 16, flight: 'aura', acts: [shield(160, 12, 'Stoneskin', { taken: 0.9, look: 'stone' })] },
  { id: 'innervate', name: 'Innervate', kind: D, school: 'nature', tier: 2, cast: 0, cool: 30, cost: 0, flight: 'aura', acts: [mark(8, { name: 'Innervate', kind: 'boon', regen: 3, look: 'mana' })] },
  { id: 'tranquility', name: 'Tranquility', kind: D, school: 'nature', tier: 3, reach: 'side', cast: 1.4, cool: 24, cost: 32, flight: 'rise', acts: [hot(30, 6, 'Tranquility')] },
  { id: 'healing-rain', name: 'Healing Rain', kind: D, school: 'nature', tier: 3, reach: 'side', cast: 1, cool: 20, cost: 28, flight: 'fall', acts: [hot(22, 8, 'Healing Rain')] },
  { id: 'rebirth', team: true, name: 'Rebirth', kind: D, school: 'nature', tier: 3, aim: 'fallen', cast: 1, cool: 40, cost: 30, flight: 'rise', acts: [revive(0.25)] },

  // Arcane ────────────────────────────────────────────────────────────────
  { id: 'magic-missile', name: 'Magic Missile', kind: O, school: 'arcane', tier: 1, cast: 0.7, cool: 3, cost: 8, flight: 'volley', acts: [harm(25, { sure: true }), harm(25, { sure: true }), harm(25, { sure: true })] },
  { id: 'moonfire', name: 'Moonfire', kind: O, school: 'arcane', tier: 1, cast: 0, cool: 5, cost: 8, flight: 'fall', acts: [harm(40), dot(12, 8, 'Moonfire')] },
  { id: 'purge', name: 'Purge', kind: O, school: 'arcane', tier: 1, cast: 0, cool: 8, cost: 8, flight: 'nova', acts: [purge(2)] },
  { id: 'mana-burn', name: 'Mana Burn', kind: O, school: 'arcane', tier: 1, cast: 0.7, cool: 8, cost: 10, flight: 'beam', acts: [burn(25, 2)] },
  { id: 'arcane-blast', name: 'Arcane Blast', kind: O, school: 'arcane', tier: 2, cast: 1, cool: 4, cost: 20, flight: 'bolt', acts: [harm(160)] },
  { id: 'arcane-missiles', name: 'Arcane Missiles', kind: O, school: 'arcane', tier: 2, cast: 1, cool: 8, cost: 16, flight: 'volley', acts: [harm(35), harm(35), harm(35), harm(35), harm(35)] },
  { id: 'starfire', name: 'Starfire', kind: O, school: 'arcane', tier: 2, cast: 1.4, cool: 6, cost: 18, flight: 'fall', acts: [harm(190)] },
  { id: 'counterspell', name: 'Counterspell', kind: O, school: 'arcane', tier: 2, cast: 0, cool: 16, cost: 12, flight: 'arc', acts: [interrupt(3)] },
  { id: 'polymorph', name: 'Polymorph', kind: O, school: 'arcane', tier: 2, cast: 1, cool: 18, cost: 14, flight: 'bolt', acts: [mark(6, { name: 'Sheep', kind: 'bane', lock: 'sleep', look: 'sheep', pulse: [heal(20)] })] },
  { id: 'spell-steal', name: 'Spell Steal', kind: O, school: 'arcane', tier: 2, cast: 0.7, cool: 10, cost: 14, flight: 'beam', acts: [steal(1)] },
  { id: 'slow', name: 'Slow', kind: O, school: 'arcane', tier: 2, cast: 0.7, cool: 14, cost: 12, flight: 'bolt', acts: [slow(0.5, 6)] },
  { id: 'mana-siphon', name: 'Mana Siphon', kind: O, school: 'arcane', tier: 2, cast: 0.7, cool: 12, cost: 0, flight: 'beam', acts: [siphon(25)] },
  { id: 'chaos-bolt', name: 'Chaos Bolt', kind: O, school: 'arcane', tier: 2, cast: 1, cool: 8, cost: 18, flight: 'bolt', acts: [pick(harm(160, { school: 'fire' }), harm(160, { school: 'frost' }), harm(160, { school: 'storm' }), harm(160, { school: 'shadow' }), harm(160))] },
  { id: 'disintegrate', name: 'Disintegrate', kind: O, school: 'arcane', tier: 3, cast: 1.4, cool: 20, cost: 32, flight: 'beam', acts: [harm(240, { bonus: { when: 'low', times: 2 } })] },
  { id: 'starfall', name: 'Starfall', kind: O, school: 'arcane', tier: 3, cast: 0, cool: 24, cost: 30, flight: 'fall', acts: [scatter(6, harm(55))] },
  { id: 'time-stop', name: 'Time Stop', kind: O, school: 'arcane', tier: 3, reach: 'side', cast: 0.7, cool: 40, cost: 30, flight: 'nova', acts: [stun(2.5, 'Time Stopped', 'time')] },
  { id: 'feeblemind', name: 'Feeblemind', kind: O, school: 'arcane', tier: 3, cast: 1.4, cool: 30, cost: 26, flight: 'beam', acts: [harm(100), hush(4, 'Feebleminded'), burn(30)] },
  { id: 'prismatic-spray', name: 'Prismatic Spray', kind: O, school: 'arcane', tier: 3, reach: 'side', cast: 1, cool: 20, cost: 30, flight: 'nova', acts: [pick(harm(140, { school: 'fire' }), harm(140, { school: 'frost' }), harm(140, { school: 'storm' }), harm(140, { school: 'nature' }), hush(3), stun(2, 'Petrified', 'stone'), slow(0.5, 5))] },
  { id: 'arcane-ward', name: 'Arcane Ward', kind: D, school: 'arcane', tier: 1, cast: 0, cool: 8, cost: 10, flight: 'aura', acts: [shield(100, 8, 'Arcane Ward')] },
  { id: 'mage-armor', name: 'Mage Armor', kind: D, school: 'arcane', tier: 1, aim: 'self', cast: 0, cool: 16, cost: 8, flight: 'aura', acts: [shield(100, 10, 'Mage Armor', { taken: 0.9 })] },
  { id: 'dispel-magic', name: 'Dispel Magic', kind: D, school: 'arcane', tier: 1, aim: 'any', cast: 0, cool: 6, cost: 8, flight: 'aura', acts: { foe: [purge(1)], ally: [cleanse(1)] } },
  { id: 'mirror-image', name: 'Mirror Image', kind: D, school: 'arcane', tier: 2, aim: 'self', cast: 0, cool: 20, cost: 14, flight: 'aura', acts: [mark(10, { name: 'Mirror Image', kind: 'boon', evade: true, charges: 2, look: 'mirror' })] },
  { id: 'haste', name: 'Haste', kind: D, school: 'arcane', tier: 2, cast: 0, cool: 18, cost: 14, flight: 'aura', acts: [haste(0.5, 8)] },
  { id: 'mana-shield', name: 'Mana Shield', kind: D, school: 'arcane', tier: 2, aim: 'self', cast: 0, cool: 16, cost: 8, flight: 'aura', acts: [mark(10, { name: 'Mana Shield', kind: 'boon', shift: 0.6, look: 'mana' })] },
  { id: 'spell-reflect', name: 'Spell Reflect', kind: D, school: 'arcane', tier: 2, cast: 0, cool: 16, cost: 12, flight: 'aura', acts: [mark(6, { name: 'Spell Reflect', kind: 'boon', mirror: true, charges: 1, look: 'mirror' })] },
  { id: 'rewind', name: 'Rewind', kind: D, school: 'arcane', tier: 2, aim: 'self', cast: 0, cool: 30, cost: 12, flight: 'aura', acts: [mark(6, { name: 'Rewind', kind: 'boon', rewind: true, look: 'rewind' })] },
  { id: 'evocation', name: 'Evocation', kind: D, school: 'arcane', tier: 2, aim: 'self', cast: 1.4, cool: 30, cost: 0, flight: 'aura', acts: [mana(50)] },
  { id: 'globe', name: 'Globe of Warding', kind: D, school: 'arcane', tier: 3, reach: 'side', cast: 0.7, cool: 40, cost: 28, flight: 'nova', acts: [armor(0.5, 4, 'Warded')] },
  { id: 'time-warp', name: 'Time Warp', kind: D, school: 'arcane', tier: 3, cast: 0, cool: 45, cost: 20, flight: 'aura', acts: [refresh()] },
  { id: 'banish', name: 'Banish', kind: D, school: 'arcane', tier: 3, aim: 'any', cast: 0.7, cool: 30, cost: 20, flight: 'bolt', acts: [mark(4, { name: 'Banished', kind: 'bane', immune: true, lock: 'stun', look: 'banish' })] },
]

/** Fill defaults and attach roles and text, so every spell has the same shape. */
function defineSpell(raw) {
  const spell = {
    aim: raw.kind === D ? 'ally' : 'foe',
    reach: 'one',
    cast: 0,
    ...raw,
  }
  spell.roles = rolesOf(spell)
  spell.sure = Array.isArray(spell.acts) && spell.acts.some((act) => act.sure)
  spell.text = describeSpell(spell)
  return Object.freeze(spell)
}

/**
 * Wisp spells: a fallen mage drifts as a wisp and keeps a tiny book of its
 * own, with no mana and short chords, until revived or the match ends.
 */
const WISP_LIST = [
  { id: 'glimmer', name: 'Glimmer', kind: 'wisp', school: 'holy', tier: 1, aim: 'ally', cast: 0, cool: 5, cost: 0, flight: 'aura', acts: [heal(40)] },
  { id: 'hinder', name: 'Hinder', kind: 'wisp', school: 'arcane', tier: 1, aim: 'foe', cast: 0, cool: 6, cost: 0, flight: 'aura', acts: [slow(0.2, 3, 'Hindered')] },
  { id: 'kindle', name: 'Kindle', kind: 'wisp', school: 'arcane', tier: 1, aim: 'ally', cast: 0, cool: 8, cost: 0, flight: 'aura', acts: [mana(12)] },
]

export const CODEX = SPELL_LIST.map(defineSpell)
export const WISPS = WISP_LIST.map(defineSpell)
export const SPELL = Object.fromEntries([...CODEX, ...WISPS].map((spell) => [spell.id, spell]))

/** True when a spell applies an aura somewhere, so Extend has something to stretch. */
export function lasts(spell) {
  let found = false
  walkActs(spell.acts, (act) => (found ||= act.op === 'mark'))
  return found
}

/** Why a set of metamagic cannot shape a spell, or null. */
export function metaFault(spell, metas) {
  if (!metas.length) return null
  if (spell.kind === 'wisp') return 'Wisps can’t shape spells'
  if (metas.includes('twin') && (spell.reach !== 'one' || spell.aim === 'self' || spell.aim === 'fallen')) return 'Can’t twin'
  if (metas.includes('extend') && !lasts(spell)) return 'Nothing to extend'
  return null
}

/** Mana for a spell with its metamagic and the caster's flow. */
export function costOf(spell, metas = [], flow = 0) {
  let cost = spell.cost
  if (metas.length) cost = Math.max(cost, 6) * metas.reduce((product, id) => product * METAS[id].cost, 1)
  return Math.ceil(cost * (1 - TIMING.flowCost * flow))
}

/** Share of the cast time a chord leaves, from the seconds between its keys. */
export function swiftOf(gap) {
  const [fast, slow] = TIMING.swift
  return TIMING.quick + (1 - TIMING.quick) * clamp((gap - fast) / (slow - fast), 0, 1)
}

/** Cast seconds for a spell with its metamagic and the chord's swiftness. */
export function castOf(spell, metas = [], swift = 1) {
  if (metas.includes('quicken')) return 0
  return spell.cast * swift * (metas.includes('empower') ? METAS.empower.slow : 1)
}

/** The reaction a hit of `school` sets off on a mage, and the bane it uses: { reaction, aura } or null. */
export function reactionOn(mage, school) {
  for (const reaction of REACTIONS) {
    if (reaction.hit !== school) continue
    const aura = mage.auras.findLast((a) => a.kind === 'bane' && a.school === reaction.on)
    if (aura) return { reaction, aura }
  }
  return null
}

/** The acts a spell runs on one target (aim 'any' splits by side). */
export function actsFor(spell, caster, target) {
  if (Array.isArray(spell.acts)) return spell.acts
  return caster.team === target.team ? spell.acts.ally : spell.acts.foe
}

/** Every act in a tree, depth first (used for roles and checks). */
export function walkActs(acts, visit) {
  const list = Array.isArray(acts) ? acts : [...(acts.foe ?? []), ...(acts.ally ?? [])]
  for (const act of list) {
    visit(act)
    if (act.acts) walkActs(act.acts, visit)
    const aura = act.aura
    if (aura) for (const key of ['pulse', 'expire', 'struck', 'purged']) if (aura[key]) walkActs(aura[key], visit)
  }
}

/** Broad roles a spell plays (damage, heal, guard, control, ...). */
export function rolesOf(spell) {
  const roles = new Set()
  walkActs(spell.acts, (act) => {
    const aura = act.aura ?? {}
    if (['harm', 'drain', 'kill'].includes(act.op)) roles.add('damage')
    if (act.op === 'heal' || act.op === 'drain') roles.add('heal')
    if (act.op === 'revive') roles.add('revive')
    if (act.op === 'interrupt' || aura.lock) roles.add('control')
    if (act.op === 'purge' || act.op === 'steal') roles.add('dispel')
    if (['mana', 'burn', 'siphon'].includes(act.op)) roles.add('mana')
    if (aura.guard || aura.immune || aura.cheat || aura.mirror || aura.evade || aura.thorns || aura.steady || aura.rewind || aura.shift || (aura.taken && aura.taken < 1)) roles.add('guard')
    if (aura.dealt || aura.pace || (aura.taken && aura.taken > 1) || aura.mended !== undefined) roles.add('tempo')
    if (aura.regen) roles.add('mana')
    if (['refresh', 'swap', 'spread'].includes(act.op)) roles.add('tempo')
  })
  return [...roles]
}

// ─── 6 · Book ───────────────────────────────────────────────────────────────
//
// Each match draws a fresh book: half offense, half defense, a spread of
// tiers, and a random chord (a run of runes) per spell. Chord length grows
// with tier (CHORD_LENGTH). Chords are prefix-free, so a chord fires the
// moment it is whole. Each player drafts a kit from the book before the
// fight, and the rift rewrites a few chords as the fight goes on.

/** How many spells of each tier for a half-book of `count`. */
export function splitTiers(count) {
  const top = Math.max(1, Math.floor(count / 6))
  const low = Math.ceil(count / 3)
  return { 1: low, 2: count - low - top, 3: top }
}

function drawKind(dice, kind, count, solo) {
  const tiers = splitTiers(count)
  const fits = (spell, tier) => spell.kind === kind && spell.tier === tier && !(solo && spell.team)
  let chosen = []
  for (let attempt = 0; attempt < 80; attempt++) {
    chosen = [1, 2, 3].flatMap((tier) => dice.shuffle(CODEX.filter((s) => fits(s, tier))).slice(0, tiers[tier]))
    if (fitsKind(kind, chosen, count)) break
  }
  return chosen
}

/** A book must be playable: enough damage, enough healing, not too much revive. */
function fitsKind(kind, chosen, count) {
  const has = (role) => chosen.filter((spell) => spell.roles.includes(role)).length
  if (kind === 'offense') return has('damage') >= Math.ceil(count * 0.6)
  return has('heal') >= Math.min(2, count) && has('revive') <= 1 && has('guard') >= 1
}

function clashes(sigil, taken) {
  return taken.some((other) => {
    const size = Math.min(sigil.length, other.length)
    for (let i = 0; i < size; i++) if (sigil[i] !== other[i]) return false
    return true
  })
}

function drawSigil(dice, length, taken, old = null) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const sigil = Array.from({ length }, () => dice.pick(RUNES))
    if (!clashes(sigil, taken) && sigil.join() !== old?.join()) return sigil
  }
  throw new Error(`No free chord of length ${length}`)
}

/**
 * Rewrite the chords of `count` spells in a book, keeping it prefix-free.
 * Returns the changes as [{ id, sigil }]; the book is changed in place.
 */
export function shiftBook(dice, book, count) {
  const moved = dice.shuffle(book).slice(0, Math.min(count, book.length))
  const taken = book.filter((entry) => !moved.includes(entry)).map((entry) => entry.sigil)
  return moved
    .sort((a, b) => a.sigil.length - b.sigil.length)
    .map((entry) => {
      entry.sigil = drawSigil(dice, entry.sigil.length, taken, entry.sigil)
      taken.push(entry.sigil)
      return { id: entry.id, sigil: entry.sigil }
    })
}

/** The wisp book: every wisp spell with its own short, prefix-free chord. */
export function writeWisps(dice) {
  const taken = []
  return WISPS.map((spell) => {
    const sigil = drawSigil(dice, CHORD_LENGTH[spell.tier], taken)
    taken.push(sigil)
    return { id: spell.id, sigil }
  })
}

/**
 * Draw a book of `size` spells with prefix-free chords. Team spells (revive
 * and the like) are left out when either team has a single mage.
 */
export function writeBook(dice, size = RULES.book, teams = RULES.teams) {
  const half = Math.max(1, Math.floor(size / 2))
  const solo = Math.min(...teams) < 2
  const spells = KINDS.flatMap((kind) => drawKind(dice, kind, half, solo))
  const taken = []
  const book = [...spells]
    .sort((a, b) => a.tier - b.tier)
    .map((spell) => {
      const sigil = drawSigil(dice, CHORD_LENGTH[spell.tier], taken)
      taken.push(sigil)
      return { id: spell.id, sigil }
    })
  const order = (entry) => KINDS.indexOf(SPELL[entry.id].kind) * 10 + SPELL[entry.id].tier
  return book.sort((a, b) => order(a) - order(b) || SPELL[a.id].name.localeCompare(SPELL[b.id].name))
}

/**
 * A balanced kit of `size` spells drafted from a book: half offense (rounded
 * up) and half defense, leaning to damage, healing and guards. `noise` shakes
 * the choices; spells in `shared` (a teammate's picks) are worth a little
 * less; `start` holds picks already made, which are kept.
 */
export function pickKit(dice, book, size, { noise = 0.3, shared = [], start = [] } = {}) {
  const worth = (spell) => {
    let score = 1 + spell.tier * 0.15
    if (spell.kind === 'offense') score += spell.roles.includes('damage') ? 1 : 0.3
    else score += spell.roles.includes('heal') ? 1 : spell.roles.includes('guard') ? 0.7 : 0.3
    if (spell.roles.includes('control')) score += 0.4
    if (shared.includes(spell.id)) score -= 0.35
    return score * (1 + dice.float(-noise, noise))
  }
  const ranked = book
    .map((entry) => SPELL[entry.id])
    .map((spell) => ({ spell, score: worth(spell) }))
    .sort((a, b) => b.score - a.score)
  const kit = start.filter((id) => book.some((entry) => entry.id === id)).slice(0, size)
  const room = { offense: Math.ceil(size / 2), defense: Math.floor(size / 2) }
  for (const id of kit) room[SPELL[id].kind]--
  for (const { spell } of ranked) if (kit.length < size && !kit.includes(spell.id) && room[spell.kind]-- > 0) kit.push(spell.id)
  for (const { spell } of ranked) if (kit.length < size && !kit.includes(spell.id)) kit.push(spell.id)
  return kit
}

/**
 * Read a chord's keys: the spell runes, the metamagic picked (meta then a
 * rune), and whether a meta is waiting for its rune. Moves are skipped.
 */
export function readChord(keys) {
  const out = { runes: [], metas: [], arming: false }
  for (const key of keys) {
    if (key === 'meta') out.arming = true
    else if (!RUNES.includes(key)) continue
    else if (!out.arming) out.runes.push(key)
    else {
      out.arming = false
      const id = META_OF_RUNE[key]
      if (!out.metas.includes(id)) out.metas.push(id)
    }
  }
  return out
}

/** Match runes against the book: an entry when whole, 'open' when partial, null when dead. */
export function readRunes(book, runes) {
  let open = false
  for (const entry of book) {
    if (runes.length > entry.sigil.length) continue
    if (!runes.every((rune, i) => entry.sigil[i] === rune)) continue
    if (runes.length === entry.sigil.length) return entry
    open = true
  }
  return open ? 'open' : null
}

// ─── 7 · Board ──────────────────────────────────────────────────────────────
//
// Teams stand in two rows facing each other across the rift. Each player sees
// their own team in the near row. The target cursor starts on yourself and
// stays where it was left between chords: up/down swap rows, down on your own
// row snaps back to you, left/right walk along a row, as seen from your side.

export const LAYOUT = { gap: 3.2, row: 3.8 }

/** World position of a seat. Team 0 stands at +z, team 1 at -z. */
export function place(team, slot, size) {
  return { x: (slot - (size - 1) / 2) * LAYOUT.gap, z: team === 0 ? LAYOUT.row : -LAYOUT.row }
}

/** One team's row, ordered left to right as the viewer's team sees it. */
export function rowOf(mages, team, viewer) {
  const row = mages.filter((m) => m.team === team).sort((a, b) => a.slot - b.slot)
  return viewer === 0 ? row : row.reverse()
}

/** Where the cursor lands after one move. `selfId` is the mover, for down's snap home. */
export function moveCursor(mages, viewer, cursorId, move, selfId = null) {
  const cursor = mages.find((m) => m.id === cursorId)
  if (!cursor) return selfId ?? cursorId
  if (move === 'up' || move === 'down') {
    const team = move === 'up' ? 1 - viewer : viewer
    if (team === cursor.team) return move === 'down' && selfId ? selfId : cursorId
    const from = rowOf(mages, cursor.team, viewer)
    const to = rowOf(mages, team, viewer)
    const share = (from.indexOf(cursor) + 0.5) / from.length
    return to[Math.min(to.length - 1, Math.floor(share * to.length))].id
  }
  const row = rowOf(mages, cursor.team, viewer)
  const index = clamp(row.indexOf(cursor) + (move === 'left' ? -1 : 1), 0, row.length - 1)
  return row[index].id
}

/** The fewest moves that walk the cursor from one mage to another. `selfId` allows the snap home. */
export function pathTo(mages, viewer, fromId, toId, selfId = null) {
  const moves = []
  let cursor = fromId
  const target = mages.find((m) => m.id === toId)
  const from = mages.find((m) => m.id === cursor)
  if (!target || !from) return moves
  if (from.team !== target.team) {
    const move = target.team === viewer ? 'down' : 'up'
    moves.push(move)
    cursor = moveCursor(mages, viewer, cursor, move, selfId)
  }
  const row = rowOf(mages, target.team, viewer)
  const step = row.indexOf(target) - row.findIndex((m) => m.id === cursor)
  if (toId === selfId && Math.abs(step) > 1) return [...moves, 'down']
  for (let i = 0; i < Math.abs(step); i++) moves.push(step < 0 ? 'left' : 'right')
  return moves
}

// ─── 8 · Match ──────────────────────────────────────────────────────────────
//
// Phases: 'ready' (the draft: whole chords add spells to your kit), 'fight'
// and 'over'. Each mage keeps a sticky aim, a chord in progress, a ward, a
// flow streak and diminishing returns per lock group. A fallen mage drifts
// as a wisp and casts from the wisp book until revived.

const LOCK_ORDER = ['stun', 'sleep', 'hush']

/** The strongest lock on a mage: 'stun' | 'sleep' | 'hush' | null. */
export function lockOf(mage) {
  let best = null
  for (const aura of mage.auras) {
    const lock = aura.def?.lock ?? aura.lock
    if (lock && (!best || LOCK_ORDER.indexOf(lock) < LOCK_ORDER.indexOf(best))) best = lock
  }
  return best
}

/** Diminishing returns group of a lock: stuns and sleeps share one, silences have their own. */
export const lockGroup = (lock) => (lock === 'hush' ? 'hush' : 'lock')

/** Cast speed from flow stacks. */
export const flowPace = (flow) => 1 + TIMING.flowPace * flow

const factor = (mage, field) => mage.auras.reduce((value, aura) => (aura.def[field] != null ? value * aura.def[field] : value), 1)
const flagged = (mage, field) => mage.auras.some((aura) => aura.def[field])
const guardOf = (mage) => mage.auras.reduce((sum, aura) => sum + (aura.guard ?? 0), 0)
const knocks = (lock) => lock === 'stun' || lock === 'sleep'

const auraRules = (aura) => aura.def ?? aura.rules ?? aura

function meets(when, mage) {
  if (when === 'locked') return mage.auras.some((a) => knocks(auraRules(a).lock))
  if (when === 'burning') return mage.auras.some((a) => a.kind === 'bane' && a.school === 'fire')
  if (when === 'low') return mage.life / mage.lifeMax <= 0.3
  return false
}

/** A chord in progress: keys, spell runes, metamagic, and when its timed keys began. */
const freshChord = (tick) => ({ keys: [], runes: [], metas: [], arming: false, start: -1, count: 0, last: tick })

function makeMage(seat, rules) {
  return {
    id: seat.id,
    name: seat.name,
    team: seat.team,
    slot: seat.slot,
    bot: Boolean(seat.bot),
    garb: seat.garb,
    life: rules.life,
    lifeMax: rules.life,
    mana: TIMING.mana,
    manaMax: TIMING.mana,
    down: false,
    auras: [],
    cast: null,
    queue: null,
    aim: seat.id,
    chord: freshChord(0),
    kit: [],
    cools: {},
    recover: 0,
    stagger: 0,
    ward: { until: -1, ready: 0 },
    flow: 0,
    flowAt: 0,
    dr: { lock: { level: 0, until: 0 }, hush: { level: 0, until: 0 } },
    grace: 0,
    callReady: 0,
    seq: 0,
    stats: { dealt: 0, healed: 0, taken: 0, casts: 0, fizzles: 0, kills: 0, parries: 0, combos: 0, flow: 0 },
  }
}

/** Give every roster entry a team, slot and unique id. */
function seatRoster(roster) {
  const used = [0, 0]
  return roster.map((seat, i) => {
    const team = seat.team === 1 ? 1 : 0
    const slot = Number.isInteger(seat.slot) ? seat.slot : used[team]
    used[team] = Math.max(used[team], slot + 1)
    return { id: seat.id ?? `m${i}`, name: seat.name ?? `Mage ${i + 1}`, team, slot, bot: seat.bot, garb: tidyGarb(seat.garb) }
  })
}

/**
 * The authoritative simulation. Feed it orders with receive(), call
 * advance() once per tick, read flush() for events and frame() for state.
 * Same seed, rules, roster and orders always give the same match.
 */
export class Match {
  constructor({ seed = 1, rules = {}, roster = [] } = {}) {
    this.seed = typeof seed === 'number' ? seed >>> 0 : hashText(String(seed))
    this.rules = tidyRules(rules)
    this.dice = new Dice(this.seed)
    this.book = writeBook(this.dice.fork('book'), this.rules.book, this.rules.teams)
    this.wisps = writeWisps(this.dice.fork('wisps'))
    this.tick = 0
    this.phase = 'ready'
    this.time(secs(TIMING.ready))
    this.winner = null
    this.mages = seatRoster(roster).map((seat) => makeMage(seat, this.rules))
    this.index = new Map(this.mages.map((m) => [m.id, m]))
    this.flights = []
    this.calls = [null, null]
    this.inbox = []
    this.events = []
  }

  /** Set the tick the fight begins; the surge and the first reshuffle follow from it. */
  time(fightAt) {
    this.fightAt = fightAt
    this.surgeAt = fightAt + secs(this.rules.surge)
    this.shiftAt = fightAt + secs(TIMING.shift)
  }

  // Messages in ──────────────────────────────────────────────────────────

  /** Queue an order: { type: 'press', mage, key, seq? }. Runs on the next tick. */
  receive(order) {
    this.inbox.push(order)
  }

  /** Take every event emitted since the last flush. Events with `only` are for that team alone. */
  flush() {
    const out = this.events
    this.events = []
    return out
  }

  emit(type, body = {}) {
    this.events.push({ type, tick: this.tick, ...body })
  }

  // The tick ─────────────────────────────────────────────────────────────

  advance() {
    if (this.phase === 'over') return
    this.tick++
    for (const order of this.inbox.splice(0)) this.handle(order)
    if (this.phase === 'ready') {
      for (const mage of this.mages) this.lapse(mage)
      const full = this.mages.every((m) => m.kit.length >= this.rules.kit)
      if (full && this.fightAt > this.tick + secs(TIMING.early)) this.time(this.tick + secs(TIMING.early))
      if (this.tick < this.fightAt) return
      this.begin()
    }
    if (this.phase !== 'fight') return
    this.surge()
    this.reshuffle()
    for (const mage of this.mages) mage.down ? this.lapse(mage) : this.tend(mage)
    for (const flight of this.flights.filter((f) => f.land <= this.tick)) {
      this.flights.splice(this.flights.indexOf(flight), 1)
      this.land(flight)
    }
    this.judgeEnd()
  }

  /** The fight begins: kits left short are filled for their owners, chords start clean. */
  begin() {
    for (const mage of this.mages) {
      if (mage.kit.length < this.rules.kit) mage.kit = pickKit(this.dice.fork(`kit:${mage.id}`), this.book, this.rules.kit, { start: mage.kit })
      mage.chord = freshChord(this.tick)
    }
    this.phase = 'fight'
    this.emit('start')
  }

  handle(order) {
    const mage = this.index.get(order.mage)
    if (!mage || order.type !== 'press' || !KEYS.includes(order.key)) return
    if (Number.isInteger(order.seq)) mage.seq = Math.max(mage.seq, order.seq)
    this.press(mage, order.key)
  }

  /** Regen, auras, chord timeout, flow, cast progress and queued casts for one standing mage. */
  tend(mage) {
    mage.mana = Math.min(mage.manaMax, mage.mana + (TIMING.regen / TICK_RATE) * factor(mage, 'regen'))
    this.tendAuras(mage)
    if (mage.down) return
    this.lapse(mage)
    this.ebb(mage)
    if (mage.cast) {
      if (lockOf(mage)) return this.stopCast(mage, 'break')
      mage.cast.done += factor(mage, 'pace') * flowPace(mage.flow)
      if (mage.cast.done >= mage.cast.total) {
        const cast = mage.cast
        mage.cast = null
        this.fire(mage, SPELL[cast.spell], this.index.get(cast.target), cast)
      }
    } else if (mage.queue && this.tick >= mage.recover) {
      const queued = mage.queue
      mage.queue = null
      this.order(mage, queued.spell, queued.target, queued)
    }
  }

  /** Clear a chord left idle too long. */
  lapse(mage) {
    if (!mage.chord.keys.length || this.tick - mage.chord.last <= secs(TIMING.idle)) return
    this.clearChord(mage)
    this.emit('lapse', { mage: mage.id })
  }

  tendAuras(mage) {
    for (const aura of [...mage.auras]) {
      if (mage.down) return
      if (!mage.auras.includes(aura)) continue
      aura.left--
      if (aura.def.pulse && --aura.next <= 0) {
        aura.next = TICK_RATE
        aura.pulses++
        const scale = 1 + (aura.def.grow ?? 0) * (aura.pulses - 1)
        this.apply(aura.def.pulse, this.auraContext(aura, mage, scale))
      }
      if (aura.left <= 0 && mage.auras.includes(aura)) {
        this.unmark(mage, aura, 'end')
        if (aura.def.rewind && aura.store > mage.life && !mage.down) {
          this.emit('mend', { from: mage.id, to: mage.id, amount: aura.store - mage.life })
          mage.life = aura.store
        }
        if (aura.def.expire) this.apply(aura.def.expire, this.auraContext(aura, mage, 1))
      }
    }
  }

  /** Context for an aura's own acts; Empower's power rides along with the aura. */
  auraContext(aura, mage, scale) {
    return { from: this.index.get(aura.from) ?? null, to: mage, spell: aura.spell, name: aura.name, school: aura.school, direct: false, scale: scale * (aura.power ?? 1) }
  }

  surge() {
    if (this.tick < this.surgeAt || (this.tick - this.surgeAt) % TICK_RATE !== 0) return
    const wave = (this.tick - this.surgeAt) / TICK_RATE + 1
    this.emit('surge', { wave })
    for (const mage of this.mages) {
      if (!mage.down) this.hurt(null, mage, mage.lifeMax * TIMING.surge * wave, { school: 'arcane', pierce: true, exact: true })
    }
  }

  /** Every so often, and when the surge begins, the rift rewrites a quarter of the book's chords. */
  reshuffle() {
    const due = this.tick === this.shiftAt || this.tick === this.surgeAt
    if (this.tick === this.shiftAt) this.shiftAt += secs(TIMING.shift)
    if (!due) return
    const changes = shiftBook(this.dice.fork(`shift:${this.tick}`), this.book, Math.max(2, Math.round(this.book.length / 4)))
    for (const mage of this.mages) {
      if (!mage.chord.runes.length || mage.down) continue
      this.clearChord(mage)
      this.emit('lapse', { mage: mage.id })
    }
    this.emit('shift', { changes })
  }

  get surging() {
    return this.tick >= this.surgeAt
  }

  /** Healing power: 100% at the start, falling to the floor when the surge begins. */
  get dampen() {
    return dampenAt(this.tick, this.fightAt, this.surgeAt)
  }

  judgeEnd() {
    const alive = [0, 1].map((team) => this.mages.some((m) => m.team === team && !m.down))
    if (alive[0] && alive[1]) return
    this.phase = 'over'
    this.winner = alive[0] ? 0 : alive[1] ? 1 : this.tiebreak()
    this.emit('over', { winner: this.winner })
  }

  /** Both teams fell at once: more damage dealt wins, else a draw. */
  tiebreak() {
    const dealt = [0, 1].map((team) => this.mages.filter((m) => m.team === team).reduce((sum, m) => sum + m.stats.dealt, 0))
    return dealt[0] === dealt[1] ? -1 : dealt[0] > dealt[1] ? 0 : 1
  }

  // Chords ───────────────────────────────────────────────────────────────

  /** The book a mage reads chords from right now: the match book, or the wisp book when down. */
  bookOf(mage) {
    return mage.down ? this.wisps : this.book
  }

  /** The entries a mage can cast right now: its kit, or the wisp book when down. */
  usable(mage) {
    return mage.down ? this.wisps : this.book.filter((entry) => mage.kit.includes(entry.id))
  }

  press(mage, key) {
    if (this.phase === 'ready') return this.draftKey(mage, key)
    if (this.phase !== 'fight') return
    const lock = mage.down ? null : lockOf(mage)
    if (knocks(lock) || this.tick < mage.stagger) return
    if (key === 'drop') return this.dropKey(mage)
    if (key === 'ward') return this.raiseWard(mage)
    if (key === 'call') return this.callTarget(mage)
    const chord = mage.chord
    chord.keys.push(key)
    chord.last = this.tick
    if (MOVES.includes(key)) {
      mage.aim = moveCursor(this.mages, mage.team, mage.aim, key, mage.id)
      return
    }
    if (chord.start < 0) chord.start = this.tick
    chord.count++
    if (key === 'meta') {
      chord.arming = true
      return
    }
    if (chord.arming) {
      chord.arming = false
      const meta = META_OF_RUNE[key]
      if (!chord.metas.includes(meta)) chord.metas.push(meta)
      return
    }
    chord.runes.push(key)
    const read = readRunes(this.bookOf(mage), chord.runes)
    if (read === 'open') return
    const { metas, start, count } = chord
    const swift = swiftOf((this.tick - start) / TICK_RATE / Math.max(1, count - 1))
    this.clearChord(mage)
    if (!read) return this.fizzle(mage, 'Unknown chord')
    this.order(mage, read.id, mage.aim, { metas, swift })
  }

  /** Before the fight a whole chord adds its spell to the kit, or takes it out. */
  draftKey(mage, key) {
    if (key === 'drop') return this.clearChord(mage)
    if (!RUNES.includes(key)) return
    const chord = mage.chord
    chord.keys.push(key)
    chord.runes.push(key)
    chord.last = this.tick
    const read = readRunes(this.book, chord.runes)
    if (read === 'open') return
    this.clearChord(mage)
    if (!read) return this.emit('fizzle', { mage: mage.id, why: 'Unknown chord', spell: null, only: mage.team })
    this.pick(mage, read.id)
  }

  /** Add a spell from the book to a mage's kit, or take it out again. */
  pick(mage, id) {
    if (this.phase !== 'ready' || !this.book.some((entry) => entry.id === id)) return
    const at = mage.kit.indexOf(id)
    if (at >= 0) mage.kit.splice(at, 1)
    else if (mage.kit.length >= this.rules.kit) return this.emit('fizzle', { mage: mage.id, why: 'Kit is full', spell: id, only: mage.team })
    else mage.kit.push(id)
    this.emit('pick', { mage: mage.id, spell: id, on: at < 0, only: mage.team })
  }

  dropKey(mage) {
    if (mage.chord.keys.length) {
      this.clearChord(mage)
      this.emit('lapse', { mage: mage.id })
    } else if (mage.queue) mage.queue = null
    else if (mage.cast) this.stopCast(mage, 'drop')
  }

  /** A new, empty chord. The aim stays where it was. */
  clearChord(mage) {
    mage.chord = freshChord(this.tick)
  }

  /** Raise a ward: hostile spells that land in the next moment are turned back on their casters. */
  raiseWard(mage) {
    if (mage.down || this.tick < mage.ward.ready) return
    mage.ward = { until: this.tick + secs(TIMING.ward) - 1, ready: this.tick + secs(TIMING.wardCool) }
    this.emit('ward', { mage: mage.id })
  }

  /** Call the aimed mage for the team: teammates see a marker and bots focus it. */
  callTarget(mage) {
    if (this.tick < mage.callReady) return
    mage.callReady = this.tick + secs(1)
    this.calls[mage.team] = { by: mage.id, target: mage.aim, until: this.tick + secs(TIMING.call) }
    this.emit('call', { mage: mage.id, target: mage.aim, only: mage.team })
  }

  // Flow ─────────────────────────────────────────────────────────────────

  setFlow(mage, flow) {
    flow = clamp(flow, 0, TIMING.flow)
    if (flow === mage.flow) return
    mage.flow = flow
    mage.stats.flow = Math.max(mage.stats.flow, flow)
    this.emit('flow', { mage: mage.id, flow })
  }

  /** One more stack for a cast, a parry or a reaction; the streak's clock restarts. */
  riseFlow(mage) {
    mage.flowAt = this.tick
    this.setFlow(mage, mage.flow + 1)
  }

  /** After a while without a cast, flow falls one stack at a time. */
  ebb(mage) {
    if (!mage.flow || this.tick - mage.flowAt < secs(TIMING.flowFade)) return
    mage.flowAt = this.tick - secs(TIMING.flowFade) + secs(1.5)
    this.setFlow(mage, mage.flow - 1)
  }

  // Casting ──────────────────────────────────────────────────────────────

  /** Why a mage cannot cast a spell (with metamagic) on a target right now, or null. */
  fault(mage, spell, target, metas = []) {
    if (mage.down !== (spell.kind === 'wisp') || (!mage.down && !mage.kit.includes(spell.id))) return 'Not in kit'
    if (!mage.down && lockOf(mage) === 'hush') return 'Silenced'
    if ((mage.cools[spell.id] ?? 0) > this.tick) return 'Not ready'
    const shape = metaFault(spell, metas)
    if (shape) return shape
    if (mage.mana < costOf(spell, metas, mage.flow)) return 'Low mana'
    if (!target) return 'No target'
    const ally = target.team === mage.team
    if (spell.aim === 'foe' && ally) return 'Needs a foe'
    if ((spell.aim === 'ally' || spell.aim === 'fallen') && !ally) return 'Needs an ally'
    if (spell.aim === 'fallen') return target.down ? null : 'Needs a fallen ally'
    if (target.down) return 'Target is down'
    return null
  }

  /** Who a spell lands on: self spells on the caster, and ally spells aimed at a foe too. */
  aimAt(mage, spell, targetId) {
    const target = this.index.get(targetId)
    if (spell.aim === 'self' || (spell.aim === 'ally' && target && target.team !== mage.team)) return mage
    return target
  }

  order(mage, spellId, targetId, { metas = [], swift = 1 } = {}) {
    const spell = SPELL[spellId]
    const target = this.aimAt(mage, spell, targetId)
    const fault = this.fault(mage, spell, target, metas)
    if (fault) return this.fizzle(mage, fault, spell.id)
    if (mage.cast || this.tick < mage.recover) {
      mage.queue = { spell: spell.id, target: target.id, metas, swift }
      return this.emit('queue', { mage: mage.id, spell: spell.id, target: target.id, metas })
    }
    this.startCast(mage, spell, target, metas, swift)
  }

  startCast(mage, spell, target, metas = [], swift = 1) {
    const total = secs(castOf(spell, metas, swift))
    const shape = { metas, swift: Math.round(swift * 100) / 100 }
    if (total <= 0) return this.fire(mage, spell, target, shape)
    mage.cast = { spell: spell.id, target: target.id, done: 0, total, ...shape }
    this.emit('cast', { mage: mage.id, spell: spell.id, target: target.id, total, ...shape })
  }

  /** End a cast early: 'drop' (a free feint) or 'break' (interrupted, which ends the flow). */
  stopCast(mage, why) {
    if (!mage.cast) return
    this.emit('stop', { mage: mage.id, spell: mage.cast.spell, why })
    mage.cast = null
    if (why === 'break') this.setFlow(mage, 0)
  }

  fizzle(mage, why, spell = null) {
    mage.stats.fizzles++
    mage.stagger = this.tick + secs(TIMING.stagger)
    this.setFlow(mage, 0)
    this.emit('fizzle', { mage: mage.id, why, spell })
  }

  fire(mage, spell, target, { metas = [], swift = 1 } = {}) {
    mage.cast = null
    const fault = this.fault(mage, spell, target, metas)
    if (fault) return this.fizzle(mage, fault, spell.id)
    mage.mana -= costOf(spell, metas, mage.flow)
    mage.cools[spell.id] = this.tick + secs(spell.cool)
    mage.recover = this.tick + secs(TIMING.recover)
    mage.stats.casts++
    if (spell.kind !== 'wisp') this.riseFlow(mage)
    const targets = spell.reach === 'side' ? this.sideOf(target) : [target]
    const twin = metas.includes('twin') ? this.besideOf(target) : null
    if (twin) targets.push(twin)
    const flight = { mage: mage.id, spell: spell.id, target: target.id, targets: targets.map((m) => m.id), metas, swift, at: this.tick, land: this.tick + secs(FLIGHTS[spell.flight]) }
    this.emit('fire', flight)
    if (flight.land <= this.tick) this.land(flight)
    else this.flights.push(flight)
  }

  land(flight) {
    const caster = this.index.get(flight.mage)
    const spell = SPELL[flight.spell]
    const metas = flight.metas ?? []
    this.emit('land', { mage: flight.mage, spell: flight.spell, target: flight.target, targets: flight.targets })
    for (const id of flight.targets) {
      const target = this.index.get(id)
      if (target.down !== (spell.aim === 'fallen')) continue
      const acts = actsFor(spell, caster, target)
      const context = {
        from: caster,
        to: target,
        spell: spell.id,
        name: spell.name,
        school: spell.school,
        direct: true,
        scale: metas.includes('empower') ? METAS.empower.power : 1,
        stretch: metas.includes('extend') ? METAS.extend.stretch : 1,
      }
      const deflect = caster.team !== target.team && !spell.sure ? this.deflect(caster, target) : null
      if (deflect === 'evade') continue
      if (deflect) this.apply(acts, { ...context, from: target, to: caster, direct: false })
      else this.apply(acts, context)
    }
  }

  /** Turn a hostile spell aside: a raised ward parries it, then reflect and dodge charges. */
  deflect(caster, target) {
    if (this.tick <= target.ward.until) {
      target.stats.parries++
      target.ward.ready = Math.min(target.ward.ready, this.tick + secs(TIMING.wardRefund))
      this.riseFlow(target)
      this.emit('void', { from: caster.id, to: target.id, why: 'parry' })
      return 'parry'
    }
    for (const why of ['reflect', 'evade']) {
      const aura = target.auras.find((a) => a.def[why === 'reflect' ? 'mirror' : 'evade'] && a.charges > 0)
      if (!aura) continue
      this.spendCharge(target, aura)
      this.emit('void', { from: caster.id, to: target.id, why })
      return why
    }
    return null
  }

  /** Living mages on a mage's team, in slot order. */
  sideOf(mage) {
    return this.mages.filter((m) => m.team === mage.team && !m.down)
  }

  /** The standing mages right beside a mage in its row. */
  besides(mage) {
    const row = this.sideOf(mage).sort((a, b) => a.slot - b.slot)
    const at = row.indexOf(mage)
    return at < 0 ? [] : [row[at - 1], row[at + 1]].filter(Boolean)
  }

  /** The standing mage nearest a target in its row (Twin's second target), or null. */
  besideOf(target) {
    const near = (m) => Math.abs(m.slot - target.slot)
    return this.sideOf(target)
      .filter((m) => m !== target)
      .sort((a, b) => near(a) - near(b) || a.slot - b.slot)[0] ?? null
  }

  apply(acts, context) {
    for (const act of acts) OPS[act.op].call(this, act, context)
  }

  // Damage, healing and auras ────────────────────────────────────────────

  /** Deal damage. Returns life actually lost. */
  hurt(from, to, raw, { school = 'arcane', direct = false, pierce = false, echo = false, exact = false } = {}) {
    if (!to || to.down) return 0
    if (flagged(to, 'immune')) {
      this.emit('void', { from: from?.id ?? null, to: to.id, why: 'immune' })
      return 0
    }
    const hostile = Boolean(from) && from.team !== to.team
    let amount = exact ? raw : raw * (from && !echo ? factor(from, 'dealt') : 1) * factor(to, 'taken')
    amount = Math.max(0, Math.round(amount))
    let soak = 0
    const shift = to.auras.find((a) => a.def.shift)
    if (shift && amount > 0 && !exact) {
      const paid = Math.min(to.mana, (amount * shift.def.shift) / 2)
      to.mana -= paid
      soak += Math.round(paid * 2)
      amount -= Math.round(paid * 2)
    }
    if (!pierce) {
      for (const aura of to.auras.filter((a) => a.guard > 0)) {
        const take = Math.min(aura.guard, amount)
        aura.guard -= take
        amount -= take
        soak += take
        if (aura.guard <= 0) this.unmark(to, aura, 'break')
        if (amount <= 0) break
      }
    }
    to.life -= amount
    to.stats.taken += amount
    if (from && from !== to) from.stats.dealt += amount
    this.emit('hit', { from: from?.id ?? null, to: to.id, amount, soak, school, direct, echo })
    if (from && !echo && amount > 0) {
      const leech = to === from ? 0 : from.auras.reduce((sum, a) => sum + (a.def.leech ?? 0), 0)
      if (leech) this.mend(from, from, amount * leech)
    }
    if (amount + soak > 0) for (const aura of to.auras.filter((a) => a.def.lock === 'sleep')) this.unmark(to, aura, 'woke')
    if (to.life <= 0) this.downCheck(to, from)
    if (direct && hostile && !echo && !to.down) {
      for (const aura of to.auras.filter((a) => a.def.thorns)) this.hurt(to, from, aura.def.thorns * (aura.power ?? 1), { school: aura.school, echo: true })
      for (const aura of to.auras.filter((a) => a.def.struck && a.charges > 0)) {
        this.apply(aura.def.struck, this.auraContext(aura, to, 1))
        this.spendCharge(to, aura)
      }
    }
    return amount
  }

  /** A direct hostile hit of `school` sets off a reaction: the bane is used up. Returns it, or null. */
  react(c, school) {
    if (!c.direct || !c.from || c.from.team === c.to.team || c.to.down || flagged(c.to, 'immune')) return null
    const found = reactionOn(c.to, school)
    if (!found) return null
    const { reaction, aura } = found
    if (!reaction.spread) this.unmark(c.to, aura, 'react')
    c.from.stats.combos++
    this.riseFlow(c.from)
    this.emit('react', { from: c.from.id, to: c.to.id, name: reaction.name, hit: reaction.hit, on: reaction.on })
    return { ...reaction, aura }
  }

  /** A reaction's rider, once its hit has landed. */
  ride(react, c, taken) {
    const { from, to } = c
    if (react.stall && !to.down) {
      if (to.chord.keys.length) {
        this.clearChord(to)
        this.emit('lapse', { mage: to.id })
      }
      to.stagger = Math.max(to.stagger, this.tick + secs(react.stall))
    }
    if (react.spread) {
      const { aura } = react
      for (const other of this.besides(to)) {
        this.mark(this.index.get(aura.from) ?? from, other, { ...aura.def, kind: 'bane', time: aura.left / TICK_RATE }, { name: aura.name, school: aura.school, spell: aura.spell, scale: aura.power })
      }
    }
    if (react.burn) this.shiftMana(to, -react.burn)
    if (react.leech && taken > 0 && !from.down) this.mend(from, from, taken * react.leech)
    if (react.hush) this.mark(from, to, hush(react.hush, react.name).aura, { school: react.hit })
  }

  downCheck(mage, by) {
    const cheat = mage.auras.find((a) => a.def.cheat)
    if (cheat) {
      mage.life = Math.round(mage.lifeMax * cheat.def.cheat)
      this.unmark(mage, cheat, 'used')
      return this.emit('save', { to: mage.id })
    }
    mage.life = 0
    mage.down = true
    mage.cast = null
    mage.queue = null
    mage.auras = []
    mage.ward = { until: -1, ready: 0 }
    this.setFlow(mage, 0)
    this.clearChord(mage)
    // Foes aiming at the fallen move on to the nearest mage still standing in its row.
    const near = (m) => Math.abs(m.slot - mage.slot)
    const next = this.sideOf(mage).sort((a, b) => near(a) - near(b))[0]
    for (const other of this.mages) if (other.aim === mage.id && other.team !== mage.team) other.aim = next?.id ?? other.id
    if (by && by.team !== mage.team) by.stats.kills++
    this.emit('fall', { to: mage.id, by: by?.id ?? null })
  }

  /** Heal. Returns life actually gained. */
  mend(from, to, raw) {
    if (!to || to.down) return 0
    const amount = Math.round(raw * factor(to, 'mended') * this.dampen)
    const gain = Math.max(0, Math.min(amount, to.lifeMax - to.life))
    to.life += gain
    if (from) from.stats.healed += gain
    this.emit('mend', { from: from?.id ?? null, to: to.id, amount: gain })
    return gain
  }

  shiftMana(mage, amount) {
    if (mage.down) return 0
    const before = mage.mana
    mage.mana = clamp(mage.mana + amount, 0, mage.manaMax)
    const change = mage.mana - before
    if (change) this.emit('mana', { to: mage.id, amount: Math.round(change) })
    return change
  }

  /**
   * Apply an aura. `scale` (Empower) strengthens its shield and its own acts;
   * `stretch` (Extend) lengthens it. Locks from foes diminish.
   */
  mark(from, to, def, { name, school, spell = null, scale = 1, stretch = 1 } = {}) {
    if (!to || to.down) return
    const kind = def.kind ?? 'bane'
    if (kind === 'bane' && flagged(to, 'immune') && from !== to) {
      return this.emit('void', { from: from?.id ?? null, to: to.id, why: 'immune' })
    }
    if (kind === 'bane' && def.lock && flagged(to, 'steady')) {
      return this.emit('void', { from: from?.id ?? null, to: to.id, why: 'steady' })
    }
    let time = secs(def.time * stretch)
    if (kind === 'bane' && def.lock && from && from.team !== to.team) {
      time = this.diminish(to, def.lock, time)
      if (!time) return this.emit('void', { from: from.id, to: to.id, why: 'resist' })
    }
    const label = def.name ?? name ?? 'Effect'
    let aura = to.auras.find((a) => a.name === label)
    if (!aura) {
      aura = { name: label, kind, look: def.look ?? kind, school: def.school ?? school, spell, def, pulses: 0 }
      to.auras.push(aura)
    }
    Object.assign(aura, {
      from: from?.id ?? null,
      left: time,
      total: time,
      next: TICK_RATE,
      guard: Math.round((def.guard ?? 0) * scale),
      charges: def.charges ?? 0,
      store: def.rewind ? to.life : 0,
      power: scale,
    })
    if (knocks(def.lock)) {
      this.stopCast(to, 'break')
      this.clearChord(to)
      to.queue = null
    } else if (def.lock === 'hush') this.stopCast(to, 'break')
    this.emit('mark', { from: from?.id ?? null, to: to.id, name: label, kind, look: aura.look, school: aura.school, time })
  }

  /**
   * Diminishing returns: within the fade window each lock from a foe in the
   * same group lasts half as long, then none land. Just after a stun or sleep
   * ends, a short grace keeps the next one off. Returns the ticks left, or 0.
   */
  diminish(mage, lock, time) {
    const group = lockGroup(lock)
    if (group === 'lock' && this.tick < mage.grace) return 0
    const dr = mage.dr[group]
    if (this.tick >= dr.until) dr.level = 0
    if (dr.level >= DIMINISH.length) return 0
    const left = Math.max(1, Math.round(time * DIMINISH[dr.level]))
    dr.level++
    dr.until = this.tick + left + secs(TIMING.fade)
    return left
  }

  unmark(mage, aura, why) {
    const at = mage.auras.indexOf(aura)
    if (at < 0) return
    mage.auras.splice(at, 1)
    if (knocks(aura.def.lock) && !mage.auras.some((a) => knocks(a.def.lock))) mage.grace = this.tick + secs(TIMING.grace)
    this.emit('fade', { to: mage.id, name: aura.name, why })
  }

  spendCharge(mage, aura) {
    aura.charges--
    if (aura.charges <= 0) this.unmark(mage, aura, 'spent')
  }

  // Views out ────────────────────────────────────────────────────────────

  /** Static match facts every client needs once. The book's chords change later through `shift` events. */
  setup() {
    return {
      seed: this.seed,
      rules: this.rules,
      book: this.book.map(({ id, sigil }) => ({ id, sigil: [...sigil] })),
      wisps: this.wisps,
      fightAt: this.fightAt,
      surgeAt: this.surgeAt,
      tickRate: TICK_RATE,
      roster: this.mages.map(({ id, name, team, slot, bot, garb, lifeMax, manaMax }) => ({ id, name, team, slot, bot, garb: { ...garb }, lifeMax, manaMax })),
    }
  }

  /** Diminishing returns level of a lock group right now (0 when fresh). */
  drOf(mage, group) {
    return this.tick < mage.dr[group].until ? mage.dr[group].level : 0
  }

  /**
   * The changing state, sent to clients every tick. `team` is who it is for
   * (0, 1, or null for watchers): during the draft, other teams' chords stay hidden.
   */
  frame(team = null) {
    const drafting = this.phase === 'ready'
    return {
      tick: this.tick,
      phase: this.phase,
      winner: this.winner,
      fightAt: this.fightAt,
      surgeAt: this.surgeAt,
      shiftAt: this.shiftAt,
      mages: this.mages.map((m) => {
        const open = !drafting || m.team === team
        return {
          id: m.id,
          life: m.life,
          mana: Math.round(m.mana * 10) / 10,
          guard: guardOf(m),
          down: m.down,
          lock: lockOf(m),
          auras: m.auras.map((a) => ({ name: a.name, kind: a.kind, look: a.look, school: a.school, spell: a.spell, left: a.left, total: a.total, charges: a.charges, lock: a.def.lock ?? null })),
          cast: m.cast && { ...m.cast, metas: [...m.cast.metas] },
          queue: m.queue?.spell ?? null,
          chord: { keys: open ? [...m.chord.keys] : [], metas: open ? [...m.chord.metas] : [], cursor: m.aim },
          cools: { ...m.cools },
          stagger: m.stagger,
          ward: this.tick <= m.ward.until,
          wardReady: m.ward.ready,
          flow: m.flow,
          dr: [this.drOf(m, 'lock'), this.drOf(m, 'hush')],
          grace: this.tick < m.grace,
          seq: m.seq,
        }
      }),
    }
  }

  /** The kits of one team, for that team's players only. */
  kits(team) {
    return Object.fromEntries(this.mages.filter((m) => m.team === team).map((m) => [m.id, [...m.kit]]))
  }

  /** The team's live call, or null. */
  callOf(team) {
    const call = this.calls[team]
    return call && call.until > this.tick ? { by: call.by, target: call.target } : null
  }

  /** Everything a brain may know when it is mage `id`. Plain data only; foes' kits stay hidden. */
  view(id) {
    const me = this.index.get(id)
    const team = me?.team ?? null
    const frame = this.frame(team)
    return {
      me: id,
      tick: this.tick,
      phase: this.phase,
      fightAt: this.fightAt,
      surgeAt: this.surgeAt,
      book: me ? this.usable(me) : [],
      pool: this.book,
      kitSize: this.rules.kit,
      kits: team === null ? {} : this.kits(team),
      call: team === null ? null : this.callOf(team),
      mages: frame.mages.map((m, i) => {
        const { name, team: side, slot, bot, lifeMax, manaMax } = this.mages[i]
        return {
          ...m,
          name,
          team: side,
          slot,
          bot,
          lifeMax,
          manaMax,
          auras: this.mages[i].auras.map((a) => ({ name: a.name, kind: a.kind, school: a.school, left: a.left, total: a.total, guard: a.guard, charges: a.charges, rules: a.def })),
        }
      }),
    }
  }

  /** Final numbers for the results screen. */
  results() {
    return {
      winner: this.winner,
      ticks: this.tick - this.fightAt,
      mages: this.mages.map(({ id, name, team, bot, down, stats }) => ({ id, name, team, bot, down, ...stats })),
    }
  }
}

/** Act handlers. `this` is the Match. */
const OPS = {
  harm(act, c) {
    let amount = act.amount * c.scale
    if (act.bonus && meets(act.bonus.when, c.to)) amount *= act.bonus.times
    const school = act.school ?? c.school
    const react = this.react(c, school)
    const taken = this.hurt(c.from, c.to, amount * (react?.times ?? 1), { school, direct: c.direct, pierce: act.pierce || react?.pierce })
    if (react) this.ride(react, c, taken)
  },
  heal(act, c) {
    this.mend(c.from, c.to, act.amount * c.scale)
  },
  drain(act, c) {
    const react = this.react(c, c.school)
    const taken = this.hurt(c.from, c.to, act.amount * c.scale * (react?.times ?? 1), { school: c.school, direct: c.direct, pierce: react?.pierce })
    if (react) this.ride(react, c, taken)
    if (taken > 0 && c.from && !c.from.down) this.mend(c.from, c.from, taken)
  },
  mana(act, c) {
    this.shiftMana(c.to, act.amount)
  },
  burn(act, c) {
    const taken = -this.shiftMana(c.to, -act.amount)
    if (act.ratio && taken > 0) this.hurt(c.from, c.to, taken * act.ratio, { school: c.school, direct: false })
  },
  siphon(act, c) {
    const taken = -this.shiftMana(c.to, -act.amount)
    if (c.from) this.shiftMana(c.from, taken)
  },
  mark(act, c) {
    this.mark(c.from, c.to, act.aura, c)
  },
  purge(act, c) {
    const fits = (a) => (act.kind === 'lock' ? a.kind === 'bane' && a.def.lock : a.kind === act.kind)
    const gone = c.to.auras.filter(fits).reverse().slice(0, act.count)
    for (const aura of gone) {
      this.unmark(c.to, aura, 'purge')
      if (aura.def.purged && c.from) this.apply(aura.def.purged, { ...this.auraContext(aura, c.from, 1) })
    }
    this.emit('purge', { from: c.from?.id ?? null, to: c.to.id, count: gone.length, kind: act.kind })
  },
  steal(act, c) {
    const gone = c.to.auras.filter((a) => a.kind === 'boon').reverse().slice(0, act.count)
    for (const aura of gone) {
      this.unmark(c.to, aura, 'steal')
      if (c.from && !c.from.down) {
        this.mark(c.from, c.from, { ...aura.def, kind: aura.kind, time: aura.left / TICK_RATE }, { name: aura.name, school: aura.school, spell: aura.spell, scale: aura.power })
      }
    }
    this.emit('purge', { from: c.from?.id ?? null, to: c.to.id, count: gone.length, kind: 'boon' })
  },
  interrupt(act, c) {
    if (!c.to.cast) return
    this.stopCast(c.to, 'break')
    this.mark(c.from, c.to, hush(act.time, 'Interrupted').aura, c)
  },
  chain(act, c) {
    const hit = new Set()
    let to = c.to
    let scale = c.scale
    for (let jump = 0; jump <= act.jumps && to; jump++) {
      hit.add(to.id)
      this.apply(act.acts, { ...c, to, scale, direct: jump === 0 && c.direct })
      const near = (m) => Math.abs(m.slot - to.slot)
      const next = this.sideOf(to)
        .filter((m) => !hit.has(m.id))
        .sort((a, b) => near(a) - near(b))[0]
      if (next) this.emit('jump', { spell: c.spell, from: to.id, to: next.id })
      to = next
      scale *= act.falloff
    }
  },
  side(act, c) {
    for (const mage of this.sideOf(c.to)) this.apply(act.acts, { ...c, to: mage, direct: false })
  },
  scatter(act, c) {
    for (let i = 0; i < act.count; i++) {
      const pool = this.sideOf(c.to)
      if (!pool.length) return
      const to = this.dice.pick(pool)
      this.emit('strike', { spell: c.spell, from: c.from?.id ?? null, to: to.id })
      this.apply(act.acts, { ...c, to })
    }
  },
  self(act, c) {
    if (c.from) this.apply(act.acts, { ...c, to: c.from, direct: false })
  },
  pick(act, c) {
    this.apply([this.dice.pick(act.acts)], c)
  },
  revive(act, c) {
    if (!c.to.down) return
    c.to.down = false
    c.to.life = Math.round(c.to.lifeMax * act.share)
    c.to.mana = Math.max(c.to.mana, c.to.manaMax * 0.3)
    this.clearChord(c.to)
    this.emit('rise', { from: c.from?.id ?? null, to: c.to.id })
  },
  refresh(act, c) {
    c.to.cools = {}
    this.emit('refresh', { from: c.from?.id ?? null, to: c.to.id })
  },
  swap(act, c) {
    const a = c.from
    const b = c.to
    if (!a || a.down || b.down) return
    if (flagged(b, 'immune')) return this.emit('void', { from: a.id, to: b.id, why: 'immune' })
    const shareA = a.life / a.lifeMax
    const shareB = b.life / b.lifeMax
    a.life = Math.max(1, Math.round(shareB * a.lifeMax))
    b.life = Math.max(1, Math.round(shareA * b.lifeMax))
    this.emit('swap', { from: a.id, to: b.id })
  },
  spread(act, c) {
    const banes = c.to.auras.filter((a) => a.kind === 'bane')
    for (const other of this.sideOf(c.to)) {
      if (other === c.to) continue
      for (const aura of banes) {
        this.mark(this.index.get(aura.from) ?? c.from, other, { ...aura.def, kind: aura.kind, time: aura.left / TICK_RATE }, { name: aura.name, school: aura.school, spell: aura.spell, scale: aura.power })
      }
    }
  },
  kill(act, c) {
    if (c.to.life / c.to.lifeMax <= act.below && !flagged(c.to, 'immune')) {
      this.hurt(c.from, c.to, c.to.life, { school: c.school, pierce: true, exact: true })
    } else this.apply(act.acts, c)
  },
}

// ─── 9 · Brain ──────────────────────────────────────────────────────────────
//
// A brain turns a view into a plan: { spell, target } or null to wait.
// This one scores every ready spell on every valid target by weighing its
// acts, then adds a little skill-based noise. Any object with the same
// think(view) method can replace it, including one that returns a Promise
// (for example an LLM-backed brain).

const shareOf = (mage) => mage.life / mage.lifeMax

/** How much danger a mage is in: missing life plus foes casting at it. */
function dangerOf(mage, view) {
  const aimed = view.mages.filter((m) => m.team !== mage.team && m.cast?.target === mage.id).length
  return 1 - shareOf(mage) + 0.4 * aimed
}

/** Who a spell may target, per its aim. */
export function targetsFor(spell, me, mages) {
  if (spell.aim === 'self') return [me]
  if (spell.aim === 'fallen') return mages.filter((m) => m.team === me.team && m.down)
  return mages.filter((m) => !m.down && (spell.aim === 'any' || (spell.aim === 'foe') === (m.team !== me.team)))
}

const viewFlag = (mage, field) => mage.auras.some((a) => auraRules(a)[field])

/** The share of a foe's lock that would land on a mage now (diminishing returns), 0 for none. */
function dimShare(mage, lock) {
  const group = lockGroup(lock)
  if (group === 'lock' && mage.grace) return 0
  return DIMINISH[mage.dr?.[group === 'lock' ? 0 : 1] ?? 0] ?? 0
}
const viewLock = (mage) => mage.lock ?? lockOf({ auras: mage.auras.map((a) => ({ lock: auraRules(a).lock })) })

function weighActs(acts, c) {
  return acts.reduce((sum, act) => sum + (WEIGH[act.op]?.(act, c) ?? 0), 0)
}

/** How good an aura is for whoever holds it (positive = helps them). */
function auraGain(rules, c) {
  const t = rules.time / 8
  const danger = dangerOf(c.to, c.view)
  let gain = 0
  if (rules.taken) gain += (1 - rules.taken) * 450 * t * (0.4 + danger)
  if (rules.dealt) gain += (rules.dealt - 1) * 400 * t
  if (rules.pace) gain += (rules.pace - 1) * 300 * t
  if (rules.mended !== undefined) gain += (rules.mended - 1) * 160 * t
  if (rules.regen) gain += (rules.regen - 1) * 60 * (1 - c.to.mana / c.to.manaMax)
  if (rules.guard) gain += Math.min(rules.guard, c.to.lifeMax - c.to.life + 120) * (0.35 + danger) * (c.to.guard > 0 ? 0.2 : 1)
  if (rules.immune) gain += danger > 0.6 ? 320 : 10
  if (rules.lock) gain -= viewLock(c.to) ? 0 : 55 * rules.time + (c.to.cast ? 140 : 0)
  if (rules.mirror || rules.evade) gain += 55 * (rules.charges ?? 1) * (0.5 + danger)
  if (rules.thorns) gain += rules.thorns * 2 * (0.5 + danger)
  if (rules.leech) gain += rules.leech * 300
  if (rules.cheat) gain += danger > 0.6 ? 240 : 30
  if (rules.shift) gain += 90 * danger
  if (rules.steady) gain += viewLock(c.to) ? 150 : 30
  if (rules.rewind) gain += shareOf(c.to) > 0.6 ? 110 : 5
  return gain
}

/** Weights per act op. Context c: { me, to, view, foe, scale }. */
const WEIGH = {
  harm(act, c) {
    if (!c.foe) return -act.amount * (c.to.id === c.me.id ? Math.max(0.2, 1.3 - shareOf(c.to)) : 1)
    if (viewFlag(c.to, 'immune')) return 0
    let amount = act.amount * c.scale
    if (act.bonus && meets(act.bonus.when, c.to)) amount *= act.bonus.times
    const react = act.tick ? null : reactionOn(c.to, act.school ?? c.school)
    if (react) amount *= react.reaction.times * 1.15
    if (!act.sure && viewFlag(c.to, 'mirror')) return -amount
    if (!act.sure && viewFlag(c.to, 'evade')) amount *= 0.2
    const finish = amount >= c.to.life + c.to.guard ? 2 : 1
    return amount * (1.6 - shareOf(c.to)) * finish
  },
  heal(act, c) {
    if (c.foe) return -act.amount * 0.5
    const missing = c.to.lifeMax - c.to.life
    return Math.min(act.amount * c.scale, missing) * (1 + (1 - shareOf(c.to)) * 1.5)
  },
  drain(act, c) {
    return WEIGH.harm(act, c) + 0.5 * WEIGH.heal(act, { ...c, to: c.me, foe: false })
  },
  mana(act, c) {
    if (c.foe) return 0
    return Math.min(act.amount, c.to.manaMax - c.to.mana) * 2.5
  },
  burn(act, c) {
    return c.foe ? Math.min(c.to.mana, act.amount) * (1.2 + act.ratio) : -60
  },
  siphon(act, c) {
    return c.foe ? Math.min(c.to.mana, act.amount, c.me.manaMax - c.me.mana) * 2.2 : -60
  },
  mark(act, c) {
    let rules = act.aura
    const share = rules.lock && c.foe ? dimShare(c.to, rules.lock) : 1
    if (!share) return 0
    if (share !== 1 || c.stretch || c.scale !== 1) {
      rules = { ...rules, time: rules.time * share * (c.stretch ?? 1), guard: rules.guard && rules.guard * c.scale }
    }
    const held = c.to.auras.find((a) => a.name === (rules.name ?? c.name))
    const fresh = held ? (held.left / held.total < 0.3 ? 0.7 : 0.12) : 1
    const holder = c.foe ? -auraGain(rules, c) : auraGain(rules, c)
    if (rules.lock && c.foe && (viewFlag(c.to, 'steady') || viewFlag(c.to, 'immune'))) return 0
    const pulses = rules.pulse ? weighActs(rules.pulse, c) * rules.time * (1 + ((rules.grow ?? 0) * rules.time) / 2) * 0.75 : 0
    const struck = rules.struck ? weighActs(rules.struck, { ...c, scale: 1 }) * (rules.charges ?? 1) * 0.6 : 0
    const expire = rules.expire ? weighActs(rules.expire, c) * 0.9 : 0
    const sleepy = rules.lock === 'sleep' && c.to.auras.some((a) => auraRules(a).pulse && a.kind === 'bane') ? 0.25 : 1
    return (holder * sleepy + pulses + struck + expire) * fresh
  },
  purge(act, c) {
    const list = c.to.auras.filter((a) => (act.kind === 'lock' ? a.kind === 'bane' && auraRules(a).lock : a.kind === act.kind)).slice(-act.count)
    if (act.kind === 'boon') return (c.foe ? 1 : -1) * list.length * 70
    return (c.foe ? -1 : 1) * list.reduce((sum, a) => sum + (auraRules(a).lock ? 180 : auraRules(a).purged ? -120 : 60), 0)
  },
  steal(act, c) {
    return c.foe ? Math.min(act.count, c.to.auras.filter((a) => a.kind === 'boon').length) * 110 : 0
  },
  interrupt(act, c) {
    if (!c.foe || !c.to.cast) return 0
    const left = c.to.cast.total - c.to.cast.done
    return left > secs(0.35) ? 140 + SPELL[c.to.cast.spell].tier * 70 + (c.to.flow ?? 0) * 20 : 0
  },
  chain(act, c) {
    const others = c.view.mages.filter((m) => m.team === c.to.team && !m.down && m.id !== c.to.id).length
    let total = 0
    let scale = c.scale
    for (let jump = 0; jump <= Math.min(act.jumps, others); jump++, scale *= act.falloff) total += weighActs(act.acts, { ...c, scale })
    return total
  },
  side(act, c) {
    return c.view.mages.filter((m) => m.team === c.to.team && !m.down).reduce((sum, m) => sum + weighActs(act.acts, { ...c, to: m }), 0)
  },
  scatter(act, c) {
    const pool = c.view.mages.filter((m) => m.team === c.to.team && !m.down)
    const each = pool.reduce((sum, m) => sum + weighActs(act.acts, { ...c, to: m }), 0) / Math.max(1, pool.length)
    return each * act.count
  },
  self(act, c) {
    return weighActs(act.acts, { ...c, to: c.me, foe: false })
  },
  pick(act, c) {
    return act.acts.reduce((sum, a) => sum + weighActs([a], c), 0) / act.acts.length
  },
  revive(act, c) {
    return c.to.down && !c.foe ? 650 : 0
  },
  refresh(act, c) {
    const cooling = Object.values(c.to.cools).filter((tick) => tick > c.view.tick + secs(4)).length
    return c.foe ? 0 : cooling * 45
  },
  swap(act, c) {
    const gain = shareOf(c.to) - shareOf(c.me)
    return c.foe && gain > 0.25 && !viewFlag(c.to, 'immune') ? gain * 1000 : -200
  },
  spread(act, c) {
    const banes = c.to.auras.filter((a) => a.kind === 'bane').length
    const others = c.view.mages.filter((m) => m.team === c.to.team && !m.down && m.id !== c.to.id).length
    return c.foe ? banes * others * 45 : -100
  },
  kill(act, c) {
    if (c.foe && shareOf(c.to) <= act.below && !viewFlag(c.to, 'immune')) return 1600
    return weighActs(act.acts, c)
  },
}

/** The standing mage nearest a target in its row (Twin's second target), from a view. */
function besideIn(view, target) {
  const near = (m) => Math.abs(m.slot - target.slot)
  return view.mages.filter((m) => m.team === target.team && !m.down && m.id !== target.id).sort((a, b) => near(a) - near(b) || a.slot - b.slot)[0] ?? null
}

/** Score one spell, shaped by `metas`, on one target from `me`'s point of view. */
export function rateSpell(spell, me, target, view, metas = []) {
  const power = metas.includes('empower') ? METAS.empower.power : 1
  const stretch = metas.includes('extend') ? METAS.extend.stretch : 1
  const hits = spell.reach === 'side' ? view.mages.filter((m) => m.team === target.team && !m.down) : [target]
  const twin = metas.includes('twin') ? besideIn(view, target) : null
  if (twin) hits.push(twin)
  let value = 0
  for (const to of hits) {
    const c = { me, to, view, foe: to.team !== me.team, scale: power, stretch, name: spell.name }
    value += weighActs(actsFor(spell, me, to), c)
  }
  if (value > 0 && view.call?.target === target.id && target.team !== me.team) value *= 1.3
  const drain = 1 - me.mana / me.manaMax
  const cost = costOf(spell, metas, me.flow ?? 0)
  const plain = costOf(spell, [], me.flow ?? 0)
  // Mana spent on metamagic is mana not spent on the next spell, and each one takes keys to type.
  value -= plain * (0.6 + drain * 1.5) + (cost - plain) * (3 + drain * 6) + metas.length * 40
  return value / (1 + castOf(spell, metas) * 0.2 + spell.tier * 0.04)
}

/** The metamagic a brain weighs for each spell, by how many it may stack. */
const SHAPES = [[], ['quicken'], ['empower'], ['twin'], ['extend'], ['quicken', 'empower'], ['twin', 'empower'], ['empower', 'extend']]

export class Brain {
  constructor({ skill = 'normal', seed = 1 } = {}) {
    this.skill = SKILLS[skill] ?? SKILLS.normal
    this.dice = new Dice(seed)
  }

  /** Draft a kit before the fight: spell ids from `view.pool`, best first. */
  draft(view) {
    const shared = Object.entries(view.kits)
      .filter(([id]) => id !== view.me)
      .flatMap(([, kit]) => kit)
    return pickKit(this.dice, view.pool, view.kitSize, { noise: 0.15 + this.skill.noise, shared })
  }

  /** Pick the best { spell, target, metas } for the mage `view.me`, or null to wait. */
  think(view) {
    const me = view.mages.find((m) => m.id === view.me)
    if (!me || (!me.down && viewLock(me) === 'hush')) return null
    const pending = me.cast ? SPELL[me.cast.spell] : null
    const budget = me.mana - (pending ? costOf(pending, me.cast.metas ?? [], me.flow) : 0)
    const shapes = SHAPES.filter((set) => set.length <= this.skill.metas)
    let best = null
    for (const entry of view.book) {
      const spell = SPELL[entry.id]
      if (spell === pending || (me.cools[spell.id] ?? 0) > view.tick) continue
      for (const target of targetsFor(spell, me, view.mages)) {
        // One roll per spell and target, so having more shapes to try does not win by luck.
        const luck = 1 + this.dice.float(-this.skill.noise, this.skill.noise)
        for (const metas of spell.kind === 'wisp' ? [[]] : shapes) {
          if (metaFault(spell, metas) || budget < costOf(spell, metas, me.flow)) continue
          const value = rateSpell(spell, me, target, view, metas) * luck
          if (!best || value > best.value) best = { spell: spell.id, target: target.id, metas, value }
        }
      }
    }
    return best && best.value > 12 ? { spell: best.spell, target: best.target, metas: best.metas } : null
  }
}

// ─── 10 · Pilot ─────────────────────────────────────────────────────────────
//
// A pilot plays a seat like a person would: it drafts by typing chords, asks
// its brain for a plan, waits a reaction time, then presses the moves,
// metamagic and runes one key at a time with human-like gaps. It raises a
// ward against spells it sees coming, as often and as sharply as its skill
// allows. Bots use exactly the same `press` orders as players, so they follow
// exactly the same rules.

export class Pilot {
  constructor({ brain = null, skill = 'normal', seed = 1 } = {}) {
    this.skill = SKILLS[skill] ?? SKILLS.normal
    this.brain = brain ?? new Brain({ skill, seed })
    this.dice = new Dice(seed).fork('hands')
    this.plan = null
    this.wait = 0
    this.busy = false
    this.picks = null
    this.seen = new WeakSet()
    this.guardAt = -1
    this.callAt = 0
    this.down = false
  }

  /** Keys to press this tick for mage `id`. */
  drive(match, id) {
    const me = match.index.get(id)
    if (!me || match.phase === 'over') return []
    if (match.phase === 'ready') return this.draft(match, me)
    if (this.plan?.draft || me.down !== this.down) {
      this.down = me.down
      this.plan = null
      this.wait = Math.max(this.wait, match.tick + secs(this.roll('react')))
    }
    const lock = me.down ? null : lockOf(me)
    if (knocks(lock) || match.tick < me.stagger) {
      this.plan = null
      this.wait = Math.max(this.wait, match.tick + secs(this.roll('react')))
      return []
    }
    const keys = this.parry(match, me) ? ['ward'] : []
    if (this.plan) return [...keys, ...this.type(match, me)]
    if (this.busy || match.tick < this.wait) return keys
    if (me.cast && me.cast.total - me.cast.done > secs(this.skill.think[1])) return keys
    const plan = this.brain.think(match.view(id))
    if (plan && typeof plan.then === 'function') {
      this.busy = true
      plan.then(
        (result) => {
          this.busy = false
          this.accept(result, match, me)
        },
        () => {
          this.busy = false
          this.wait = match.tick + secs(1)
        },
      )
      return keys
    }
    this.accept(plan, match, me)
    return keys
  }

  roll(field) {
    return this.dice.float(...this.skill[field])
  }

  /** The draft: ask the brain for picks once, then type each pick's chord until the kit is full. */
  draft(match, me) {
    if (this.busy) return []
    if (!this.picks) {
      const picks = this.brain.draft?.(match.view(me.id)) ?? []
      if (typeof picks.then === 'function') {
        this.busy = true
        const done = (list) => {
          this.busy = false
          this.picks = Array.isArray(list) ? [...list] : []
        }
        picks.then(done, () => done([]))
        return []
      }
      this.picks = [...picks]
      this.wait = match.tick + secs(this.roll('think'))
    }
    if (this.plan) return this.next(match)
    if (match.tick < this.wait || me.kit.length >= match.rules.kit) return []
    const id = this.picks.find((pick) => !me.kit.includes(pick) && match.book.some((entry) => entry.id === pick))
    if (!id) return []
    this.picks.splice(this.picks.indexOf(id), 1)
    this.plan = { draft: true, keys: [...match.book.find((entry) => entry.id === id).sigil], at: match.tick + secs(this.roll('react')) }
    return []
  }

  /** True on the tick to raise a ward against a hostile spell this pilot saw coming. */
  parry(match, me) {
    if (me.down) return false
    for (const flight of match.flights) {
      if (this.seen.has(flight)) continue
      this.seen.add(flight)
      const caster = match.index.get(flight.mage)
      if (!flight.targets.includes(me.id) || caster.team === me.team || SPELL[flight.spell].sure) continue
      if (flight.land - flight.at < secs(this.skill.react[0]) || this.dice.next() > this.skill.parry) continue
      // Timing is not perfect: some wards go up a little early or late and miss.
      const at = flight.land - (this.dice.int(secs(TIMING.ward) + 2) - 1)
      if (this.guardAt < 0 || at < this.guardAt) this.guardAt = at
    }
    if (this.guardAt < 0 || match.tick < this.guardAt) return false
    this.guardAt = -1
    return match.tick >= me.ward.ready
  }

  accept(plan, match, me) {
    const entry = plan && match.usable(me).find((e) => e.id === plan.spell)
    if (!entry || !match.index.has(plan.target)) {
      this.wait = match.tick + secs(this.roll('think'))
      return
    }
    const metas = (plan.metas ?? []).filter((id) => METAS[id])
    this.plan = { spell: plan.spell, target: plan.target, metas, sigil: entry.sigil, keys: null, at: match.tick + secs(this.roll('react')) }
  }

  /** The keys for a plan from where the cursor is now: moves, maybe a call, metamagic, then the runes. */
  keysFor(match, me, plan) {
    const spell = SPELL[plan.spell]
    const aimed = match.index.get(me.aim)
    const home = spell.aim === 'self' || (spell.aim === 'ally' && plan.target === me.id && aimed?.team !== me.team)
    const moves = home ? [] : pathTo(match.mages, me.team, me.aim, plan.target, me.id)
    const call = this.callFor(match, me, plan) ? ['call'] : []
    return [...(me.chord.keys.length ? ['drop'] : []), ...moves, ...call, ...plan.metas.flatMap((id) => ['meta', METAS[id].rune]), ...plan.sigil]
  }

  /** Bots that know metamagic also call low foes for their team. */
  callFor(match, me, plan) {
    if (!this.skill.metas || me.down || match.tick < this.callAt) return false
    const target = match.index.get(plan.target)
    if (target.team === me.team || target.life / target.lifeMax > 0.5 || match.callOf(me.team)?.target === target.id) return false
    this.callAt = match.tick + secs(8)
    return true
  }

  type(match, me) {
    const plan = this.plan
    const spell = SPELL[plan.spell]
    const target = match.index.get(plan.target)
    // A reshuffle gives the entry a new chord, so a plan typed from the old one is dropped.
    const entry = match.usable(me).find((e) => e.id === plan.spell)
    const usable =
      entry?.sigil === plan.sigil &&
      (me.cools[spell.id] ?? 0) <= match.tick + secs(1) &&
      me.mana + 4 >= costOf(spell, plan.metas, me.flow) &&
      target &&
      target.down === (spell.aim === 'fallen')
    if (!usable) {
      this.plan = null
      this.wait = match.tick + secs(0.2)
      return me.chord.keys.length ? ['drop'] : []
    }
    if (match.tick < plan.at) return []
    plan.keys ??= this.keysFor(match, me, plan)
    return this.next(match)
  }

  /** Press the plan's next key once its gap has passed. */
  next(match) {
    const plan = this.plan
    if (match.tick < plan.at) return []
    const key = plan.keys.shift()
    plan.at = match.tick + secs(this.roll('gap'))
    if (!plan.keys.length) {
      this.plan = null
      this.wait = match.tick + secs(this.roll(plan.draft ? 'gap' : 'think'))
    }
    return [key]
  }
}

// ─── 11 · Arena ─────────────────────────────────────────────────────────────

/** Runs a match together with the pilots that drive its bot seats. */
export class Arena {
  constructor(match) {
    this.match = match
    this.pilots = new Map()
  }
  seat(id, pilot) {
    this.pilots.set(id, pilot)
  }
  free(id) {
    this.pilots.delete(id)
  }
  /** One tick: pilots press keys, the match advances. Returns new events. */
  step() {
    for (const [id, pilot] of this.pilots) {
      for (const key of pilot.drive(this.match, id)) this.match.receive({ type: 'press', mage: id, key })
    }
    this.match.advance()
    return this.match.flush()
  }
}

/** Build a bots-only roster for the given rules. */
export function botRoster(rules) {
  const { teams } = tidyRules(rules)
  return [0, 1].flatMap((team) =>
    Array.from({ length: teams[team] }, (_, slot) => ({ id: `t${team}s${slot}`, name: `${TEAMS[team]} ${slot + 1}`, team, slot, bot: true })),
  )
}

/** Play a whole bots-only match headless. Handy for tests and tuning. */
export function simulate({ seed = 1, rules = {}, skills = null, limit = 20 * 60 * 10 } = {}) {
  const tidy = tidyRules(rules)
  const match = new Match({ seed, rules: tidy, roster: botRoster(tidy) })
  const arena = new Arena(match)
  for (const mage of match.mages) {
    const skill = skills?.[mage.team] ?? tidy.skill
    arena.seat(mage.id, new Pilot({ skill, seed: hashText(`${seed}:${mage.id}`) }))
  }
  while (match.phase !== 'over' && match.tick < limit) arena.step()
  return { match, results: match.results() }
}

// ─── 12 · Wire ──────────────────────────────────────────────────────────────
//
// Every message is JSON: { type, ...body }. Peers (browsers) send the `peer`
// set; the host answers with the `host` set. unpack() checks each field and
// returns null for anything malformed, so the host never trusts raw input.

export const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'

const CHECKS = {
  name: (v) => {
    if (typeof v !== 'string') return null
    const name = v.replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 16)
    return name || null
  },
  code: (v) => (typeof v === 'string' && new RegExp(`^[${CODE_LETTERS}]{4}$`).test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null),
  team: (v) => (v === 0 || v === 1 ? v : null),
  slot: (v) => (Number.isInteger(v) && v >= 0 && v < LIMITS.team[1] ? v : null),
  key: (v) => (KEYS.includes(v) ? v : null),
  count: (v) => (Number.isInteger(v) && v >= 0 ? v : null),
  rules: (v) => (v && typeof v === 'object' ? tidyRules(v) : null),
  skill: (v) => (SKILLS[v] ? v : null),
  token: (v) => (typeof v === 'string' && /^[\w-]{16,64}$/.test(v) ? v : null),
  garb: (v) => (v === undefined ? undefined : tidyGarb(v)), // optional; anything else is tidied, never refused
  any: (v) => (v === undefined ? null : v),
  maybe: (v) => v ?? undefined, // optional: may be left out
}

export const WIRE = {
  peer: {
    hello: { name: 'name', garb: 'garb' }, // set your display name and, if given, your garb
    open: { rules: 'rules' }, // host a new room
    join: { code: 'code' }, // join a room by code
    seat: { team: 'team', slot: 'slot' }, // move to an open seat
    bench: { team: 'team', slot: 'slot' }, // owner: toggle a bot in a seat
    tune: { rules: 'rules' }, // owner: change match rules
    start: {}, // owner: start the match
    press: { key: 'key', seq: 'count' }, // one key: a move, a rune, meta, ward, call or drop
    again: {}, // owner: rematch with a new book
    lobby: {}, // owner: return everyone to the lobby
    leave: {}, // leave the room
    resume: { token: 'token' }, // after a reconnect: take back the seat held for this token
  },
  host: {
    welcome: { you: 'any', token: 'any' }, // your peer id, and the token that takes your seat back after a drop
    back: { you: 'any' }, // answer to resume: your old peer id, or null if nothing was held
    moved: {}, // your seat was taken back on another connection (another tab): don't resume it
    room: { room: 'any' }, // lobby state
    begin: { setup: 'any', you: 'any' }, // a match starts; `you` is your mage id
    frame: { frame: 'maybe', delta: 'maybe', events: 'any', kits: 'maybe' }, // one tick: a whole frame or a delta, its events, and your team's kits when they changed
    end: { results: 'any' }, // the match is over
    fault: { text: 'any' }, // something went wrong
  },
}

export function pack(type, body = {}) {
  return JSON.stringify({ type, ...body })
}

/** Parse and check a message from `side` ('peer' or 'host'). Null if invalid. */
export function unpack(text, side = 'peer') {
  let message
  try {
    message = JSON.parse(text)
  } catch {
    return null
  }
  const shape = message && typeof message === 'object' ? WIRE[side][message.type] : null
  if (!shape) return null
  const out = { type: message.type }
  for (const [field, check] of Object.entries(shape)) {
    const value = CHECKS[check](message[field])
    if (value === null) return null
    if (value !== undefined) out[field] = value
  }
  return out
}

// Frames ─────────────────────────────────────────────────────────────────
//
// The host sends a whole frame once, then only what changed: diff() against
// the last frame sent, patch() on the page. packFrame() first swaps each
// aura's countdown (`left`, falling every tick) for the tick it ends, which
// holds still, so a quiet tick costs a few bytes. Keys starting with `$` are
// reserved for deltas.

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The wire form of a frame: aura countdowns become end ticks. */
export function packFrame(frame) {
  return {
    ...frame,
    mages: frame.mages.map((m) => ({ ...m, auras: m.auras.map(({ left, ...aura }) => ({ ...aura, end: frame.tick + left })) })),
  }
}

/** A frame back from its wire form. */
export function unpackFrame(wire) {
  return {
    ...wire,
    mages: wire.mages.map((m) => ({ ...m, auras: m.auras.map(({ end, ...aura }) => ({ ...aura, left: end - wire.tick })) })),
  }
}

/**
 * What changed from `prev` to `next`, or undefined if nothing did. Objects
 * list their changed keys (and `$gone` for removed ones), arrays of the same
 * length their changed indexes; anything else is replaced whole.
 */
export function diff(prev, next) {
  if (prev === next) return undefined
  if (Array.isArray(prev) && Array.isArray(next) && prev.length === next.length) {
    const out = {}
    next.forEach((value, i) => {
      const change = diff(prev[i], value)
      if (change !== undefined) out[i] = change
    })
    return Object.keys(out).length ? out : undefined
  }
  if (isPlain(prev) && isPlain(next)) {
    const out = {}
    const gone = Object.keys(prev).filter((key) => prev[key] !== undefined && next[key] === undefined)
    for (const key of Object.keys(next)) {
      if (next[key] === undefined) continue
      const change = diff(prev[key], next[key])
      if (change !== undefined) out[key] = change
    }
    if (gone.length) out.$gone = gone
    return Object.keys(out).length ? out : undefined
  }
  if (isPlain(next) && Array.isArray(prev)) return { $set: next }
  if (next === undefined) return null
  return next
}

/** Apply a delta from diff() to `prev`. Returns a new value; `prev` is left as it was. */
export function patch(prev, change) {
  if (change === undefined) return prev
  if (!isPlain(change)) return change
  if ('$set' in change) return change.$set
  if (Array.isArray(prev)) {
    const out = [...prev]
    for (const [key, value] of Object.entries(change)) out[key] = patch(prev[key], value)
    return out
  }
  if (!isPlain(prev)) return change
  const out = { ...prev }
  for (const [key, value] of Object.entries(change)) if (key !== '$gone') out[key] = patch(prev[key], value)
  for (const key of change.$gone ?? []) delete out[key]
  return out
}
