/**
 * core.mjs — the Chordcast engine.
 *
 * Portable game logic shared by the host (the authority) and the page (the
 * display). No DOM and no Node APIs live here. Everything moves as messages:
 * seats send `press` orders into a Match, the Match advances in fixed ticks,
 * and it emits plain events and frames that the host relays to every player.
 *
 *    1  Kit     constants, rules and timing
 *    2  Dice    seeded random numbers
 *    3  Acts    effect builders used by spells
 *    4  Lore    plain text for spells and auras
 *    5  Codex   the spell catalog
 *    6  Book    the spells of one match and their chords
 *    7  Board   seats, rows and the target cursor
 *    8  Match   the simulation
 *    9  Brain   the deterministic bot mind
 *   10  Pilot   turns brain plans into key presses
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
export const KEYS = [...MOVES, ...RUNES, 'drop']
export const KINDS = ['offense', 'defense']
export const SCHOOLS = ['fire', 'frost', 'storm', 'nature', 'shadow', 'holy', 'arcane']
export const TEAMS = ['Dawn', 'Dusk']
export const AIMS = ['foe', 'ally', 'self', 'any', 'fallen']

/** Seconds from launch to landing, per flight style. */
export const FLIGHTS = { bolt: 0.55, volley: 0.65, beam: 0.15, arc: 0.1, fall: 0.7, rise: 0.35, nova: 0.3, aura: 0.15 }

export const TIMING = {
  ready: 6, // seconds to study the book before the fight
  idle: 2.5, // a chord clears after this long without a key
  stagger: 0.6, // keys are ignored this long after a fizzle
  recover: 0.4, // pause after a cast before the next one starts
  regen: 6, // mana per second
  mana: 100, // mana pool
  surge: 0.02, // share of max life lost per surge wave, growing each second
  dampen: 0.4, // healing power left when the surge begins (falls from 100%)
}

/** Healing power at a tick, shared by host and page so the HUD shows the truth. */
export function dampenAt(tick, fightAt, surgeAt) {
  const share = clamp((tick - fightAt) / Math.max(1, surgeAt - fightAt), 0, 1)
  return Math.round((1 - (1 - TIMING.dampen) * share) * 100) / 100
}

export const RULES = { teams: [1, 1], book: 12, life: 800, surge: 90, skill: 'normal' }
export const LIMITS = { team: [1, 8], book: [8, 20], life: [400, 3000], surge: [20, 600] }

/** Bot skill: think pause, key gap and reaction (seconds), and choice noise. */
export const SKILLS = {
  easy: { think: [1.2, 2.0], gap: [0.3, 0.42], react: [0.5, 0.9], noise: 0.45 },
  normal: { think: [0.6, 1.1], gap: [0.19, 0.27], react: [0.3, 0.6], noise: 0.18 },
  hard: { think: [0.25, 0.5], gap: [0.12, 0.17], react: [0.15, 0.3], noise: 0.05 },
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const wholeIn = (value, [low, high], fallback) =>
  Number.isFinite(Number(value)) ? clamp(Math.round(Number(value)), low, high) : fallback

/** Clamp any rules object into a valid one. */
export function tidyRules(input = {}) {
  const teams = Array.isArray(input.teams) ? input.teams : RULES.teams
  const book = wholeIn(input.book, LIMITS.book, RULES.book)
  return {
    teams: [0, 1].map((t) => wholeIn(teams[t], LIMITS.team, RULES.teams[t])),
    book: book - (book % 2),
    life: wholeIn(input.life, LIMITS.life, RULES.life),
    surge: wholeIn(input.surge, LIMITS.surge, RULES.surge),
    skill: SKILLS[input.skill] ? input.skill : RULES.skill,
  }
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
 *   taken dealt mended pace flow      multipliers on damage taken/dealt, healing
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
export const ward = (amount, time, name, more = {}) => mark(time, { name, kind: 'boon', guard: amount, look: 'ward', ...more })
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
  if (aura.flow) parts.push(`mana regen ×${aura.flow}`)
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
  { id: 'fire-bolt', name: 'Fire Bolt', kind: O, school: 'fire', tier: 1, cast: 0.8, cool: 2, cost: 6, flight: 'bolt', acts: [harm(70)] },
  { id: 'scorch', name: 'Scorch', kind: O, school: 'fire', tier: 1, cast: 0, cool: 4, cost: 8, flight: 'rise', acts: [harm(55)] },
  { id: 'immolate', name: 'Immolate', kind: O, school: 'fire', tier: 1, cast: 1, cool: 6, cost: 10, flight: 'rise', acts: [harm(40), dot(16, 8, 'Immolated')] },
  { id: 'fireball', name: 'Fireball', kind: O, school: 'fire', tier: 2, cast: 1.5, cool: 6, cost: 16, flight: 'bolt', acts: [harm(150), dot(10, 4, 'Burning')] },
  { id: 'scorching-ray', name: 'Scorching Ray', kind: O, school: 'fire', tier: 2, cast: 1, cool: 8, cost: 16, flight: 'volley', acts: [harm(50), harm(50), harm(50)] },
  { id: 'living-bomb', name: 'Living Bomb', kind: O, school: 'fire', tier: 2, cast: 0, cool: 12, cost: 18, flight: 'aura', acts: [mark(4, { kind: 'bane', look: 'bomb', pulse: [harm(15, { tick: true })], expire: [side(harm(110))] })] },
  { id: 'flame-strike', name: 'Flame Strike', kind: O, school: 'fire', tier: 2, reach: 'side', cast: 1.5, cool: 10, cost: 22, flight: 'fall', acts: [harm(100), dot(8, 4, 'Burning')] },
  { id: 'lava-burst', name: 'Lava Burst', kind: O, school: 'fire', tier: 2, cast: 1.5, cool: 8, cost: 18, flight: 'bolt', acts: [harm(140, { bonus: { when: 'burning', times: 1.5 } })] },
  { id: 'dragon-breath', name: 'Dragon Breath', kind: O, school: 'fire', tier: 2, cast: 0, cool: 16, cost: 18, flight: 'nova', acts: [harm(90), sleep(3, 'Disoriented', 'daze')] },
  { id: 'combustion', name: 'Combustion', kind: O, school: 'fire', tier: 2, aim: 'self', cast: 0, cool: 24, cost: 14, flight: 'aura', acts: [empower(0.3, 6, 'Combustion')] },
  { id: 'pyroblast', name: 'Pyroblast', kind: O, school: 'fire', tier: 3, cast: 2.5, cool: 18, cost: 32, flight: 'bolt', acts: [harm(300), dot(20, 6, 'Burning')] },
  { id: 'meteor', name: 'Meteor', kind: O, school: 'fire', tier: 3, cast: 2, cool: 24, cost: 36, flight: 'fall', acts: [harm(240), side(harm(90))] },
  { id: 'fire-wall', name: 'Fire Wall', kind: O, school: 'fire', tier: 3, reach: 'side', cast: 1.5, cool: 20, cost: 30, flight: 'rise', acts: [dot(25, 6, 'Fire Wall')] },
  { id: 'rebuke', name: 'Rebuke', kind: D, school: 'fire', tier: 1, aim: 'self', cast: 0, cool: 14, cost: 8, flight: 'aura', acts: [thorns(50, 8, 'Rebuke')] },
  { id: 'cauterize', name: 'Cauterize', kind: D, school: 'fire', tier: 2, aim: 'self', cast: 0, cool: 20, cost: 12, flight: 'rise', acts: [heal(220), dot(15, 4, 'Cauterized')] },

  // Frost ─────────────────────────────────────────────────────────────────
  { id: 'frost-ray', name: 'Frost Ray', kind: O, school: 'frost', tier: 1, cast: 1, cool: 3, cost: 8, flight: 'beam', acts: [harm(60), slow(0.3, 4, 'Chilled')] },
  { id: 'ice-lance', name: 'Ice Lance', kind: O, school: 'frost', tier: 1, cast: 0, cool: 3, cost: 8, flight: 'bolt', acts: [harm(45, { bonus: { when: 'locked', times: 3 } })] },
  { id: 'frostbolt', name: 'Frostbolt', kind: O, school: 'frost', tier: 2, cast: 1.5, cool: 5, cost: 16, flight: 'bolt', acts: [harm(140), slow(0.3, 5, 'Chilled')] },
  { id: 'cone-of-cold', name: 'Cone of Cold', kind: O, school: 'frost', tier: 2, reach: 'side', cast: 0, cool: 12, cost: 20, flight: 'nova', acts: [harm(80), slow(0.4, 4, 'Chilled')] },
  { id: 'frost-nova', name: 'Frost Nova', kind: O, school: 'frost', tier: 2, reach: 'side', cast: 0, cool: 20, cost: 18, flight: 'nova', acts: [harm(30), stun(2, 'Frozen', 'ice')] },
  { id: 'ice-storm', name: 'Ice Storm', kind: O, school: 'frost', tier: 2, reach: 'side', cast: 1.2, cool: 12, cost: 22, flight: 'fall', acts: [harm(100)] },
  { id: 'blizzard', name: 'Blizzard', kind: O, school: 'frost', tier: 3, reach: 'side', cast: 2, cool: 20, cost: 30, flight: 'fall', acts: [dot(22, 6, 'Blizzard'), slow(0.3, 6, 'Chilled')] },
  { id: 'glacial-spike', name: 'Glacial Spike', kind: O, school: 'frost', tier: 3, cast: 2.5, cool: 20, cost: 30, flight: 'bolt', acts: [harm(260), stun(2.5, 'Frozen', 'ice')] },
  { id: 'ice-block', name: 'Ice Block', kind: D, school: 'frost', tier: 3, aim: 'self', cast: 0, cool: 40, cost: 10, flight: 'aura', acts: [cleanse(9), mark(4, { name: 'Ice Block', kind: 'boon', immune: true, lock: 'stun', look: 'ice' })] },
  { id: 'ice-barrier', name: 'Ice Barrier', kind: D, school: 'frost', tier: 2, cast: 0, cool: 14, cost: 16, flight: 'aura', acts: [ward(180, 10, 'Ice Barrier')] },
  { id: 'frost-armor', name: 'Frost Armor', kind: D, school: 'frost', tier: 2, aim: 'self', cast: 0, cool: 16, cost: 14, flight: 'aura', acts: [ward(120, 12, 'Frost Armor', { thorns: 30 })] },
  { id: 'winter-veil', name: 'Winter Veil', kind: D, school: 'frost', tier: 1, cast: 0, cool: 10, cost: 8, flight: 'aura', acts: [armor(0.2, 6, 'Winter Veil')] },

  // Storm ─────────────────────────────────────────────────────────────────
  { id: 'shocking-grasp', name: 'Shocking Grasp', kind: O, school: 'storm', tier: 1, cast: 0, cool: 10, cost: 10, flight: 'arc', acts: [harm(50), interrupt(1.5)] },
  { id: 'thunderclap', name: 'Thunderclap', kind: O, school: 'storm', tier: 1, reach: 'side', cast: 0, cool: 10, cost: 12, flight: 'nova', acts: [harm(40), interrupt(1)] },
  { id: 'spark', name: 'Spark', kind: O, school: 'storm', tier: 1, cast: 0.6, cool: 2, cost: 6, flight: 'arc', acts: [harm(60)] },
  { id: 'lightning-bolt', name: 'Lightning Bolt', kind: O, school: 'storm', tier: 2, cast: 1.5, cool: 6, cost: 16, flight: 'arc', acts: [harm(160)] },
  { id: 'chain-lightning', name: 'Chain Lightning', kind: O, school: 'storm', tier: 2, cast: 1.5, cool: 10, cost: 22, flight: 'arc', acts: [chain(2, 0.7, harm(120))] },
  { id: 'witch-bolt', name: 'Witch Bolt', kind: O, school: 'storm', tier: 2, cast: 1, cool: 10, cost: 14, flight: 'beam', acts: [harm(70), dot(20, 5, 'Tethered')] },
  { id: 'call-lightning', name: 'Call Lightning', kind: O, school: 'storm', tier: 2, cast: 1, cool: 8, cost: 18, flight: 'fall', acts: [harm(130)] },
  { id: 'ball-lightning', name: 'Ball Lightning', kind: O, school: 'storm', tier: 2, cast: 1, cool: 12, cost: 20, flight: 'volley', acts: [scatter(4, harm(45))] },
  { id: 'storm-fury', name: 'Storm Fury', kind: O, school: 'storm', tier: 3, reach: 'side', cast: 2, cool: 22, cost: 34, flight: 'fall', acts: [harm(150), sleep(1.5, 'Dazed', 'daze')] },
  { id: 'tailwind', name: 'Tailwind', kind: D, school: 'storm', tier: 2, cast: 0, cool: 16, cost: 14, flight: 'aura', acts: [haste(0.4, 8, 'Tailwind')] },
  { id: 'lightning-shield', name: 'Lightning Shield', kind: D, school: 'storm', tier: 1, aim: 'self', cast: 0, cool: 12, cost: 10, flight: 'aura', acts: [thorns(40, 10, 'Lightning Shield')] },
  { id: 'grounding', name: 'Grounding', kind: D, school: 'storm', tier: 2, cast: 0, cool: 18, cost: 12, flight: 'aura', acts: [mark(8, { name: 'Grounded', kind: 'boon', evade: true, charges: 1, look: 'mirror' })] },

  // Shadow ────────────────────────────────────────────────────────────────
  { id: 'chill-touch', name: 'Chill Touch', kind: O, school: 'shadow', tier: 1, cast: 0, cool: 6, cost: 8, flight: 'bolt', acts: [harm(50), mark(4, { name: 'No Healing', kind: 'bane', mended: 0, look: 'blight' })] },
  { id: 'eldritch-blast', name: 'Eldritch Blast', kind: O, school: 'shadow', tier: 1, cast: 0, cool: 3, cost: 8, flight: 'beam', acts: [harm(35), harm(35)] },
  { id: 'corruption', name: 'Corruption', kind: O, school: 'shadow', tier: 1, cast: 0, cool: 5, cost: 8, flight: 'aura', acts: [dot(16, 10, 'Corruption')] },
  { id: 'agony', name: 'Agony', kind: O, school: 'shadow', tier: 1, cast: 0, cool: 6, cost: 8, flight: 'aura', acts: [dot(6, 12, 'Agony', { grow: 0.25 })] },
  { id: 'hex', name: 'Hex', kind: O, school: 'shadow', tier: 1, cast: 0, cool: 10, cost: 8, flight: 'aura', acts: [expose(0.15, 8, 'Hexed')] },
  { id: 'shadow-bolt', name: 'Shadow Bolt', kind: O, school: 'shadow', tier: 2, cast: 1.5, cool: 5, cost: 16, flight: 'bolt', acts: [harm(150)] },
  { id: 'drain-life', name: 'Drain Life', kind: O, school: 'shadow', tier: 2, cast: 1.5, cool: 8, cost: 16, flight: 'beam', acts: [drain(120)] },
  { id: 'vampiric-touch', name: 'Vampiric Touch', kind: O, school: 'shadow', tier: 2, cast: 1.2, cool: 8, cost: 16, flight: 'aura', acts: [mark(8, { name: 'Vampiric Touch', kind: 'bane', look: 'dot', pulse: [drain(20)] })] },
  { id: 'unstable-affliction', name: 'Unstable Affliction', kind: O, school: 'shadow', tier: 2, cast: 1.2, cool: 8, cost: 16, flight: 'aura', acts: [dot(30, 6, 'Unstable Affliction', { purged: [harm(150), hush(3)] })] },
  { id: 'death-coil', name: 'Death Coil', kind: O, school: 'shadow', tier: 2, cast: 0, cool: 16, cost: 16, flight: 'bolt', acts: [harm(110), sleep(2.5, 'Horrified', 'fear')] },
  { id: 'fear', name: 'Fear', kind: O, school: 'shadow', tier: 2, cast: 1.2, cool: 14, cost: 14, flight: 'bolt', acts: [sleep(5, 'Feared', 'fear')] },
  { id: 'blight', name: 'Blight', kind: O, school: 'shadow', tier: 2, cast: 1, cool: 8, cost: 18, flight: 'rise', acts: [harm(130), mark(4, { name: 'Blighted', kind: 'bane', mended: 0.5, look: 'blight' })] },
  { id: 'mind-blast', name: 'Mind Blast', kind: O, school: 'shadow', tier: 2, cast: 1.2, cool: 6, cost: 16, flight: 'bolt', acts: [harm(120), burn(10)] },
  { id: 'contagion', team: true, name: 'Contagion', kind: O, school: 'shadow', tier: 2, cast: 0, cool: 16, cost: 16, flight: 'nova', acts: [spread()] },
  { id: 'howl-of-terror', name: 'Howl of Terror', kind: O, school: 'shadow', tier: 3, reach: 'side', cast: 0, cool: 30, cost: 26, flight: 'nova', acts: [sleep(3, 'Feared', 'fear')] },
  { id: 'doom', name: 'Doom', kind: O, school: 'shadow', tier: 3, cast: 0, cool: 24, cost: 30, flight: 'aura', acts: [mark(6, { name: 'Doom', kind: 'bane', look: 'doom', expire: [harm(340)] })] },
  { id: 'void-hunger', name: 'Void Hunger', kind: O, school: 'shadow', tier: 3, reach: 'side', cast: 1.5, cool: 20, cost: 30, flight: 'nova', acts: [dot(20, 5, 'Void Hunger'), slow(0.3, 5)] },
  { id: 'finger-of-death', name: 'Finger of Death', kind: O, school: 'shadow', tier: 3, cast: 2, cool: 22, cost: 32, flight: 'beam', acts: [harm(300)] },
  { id: 'kill-word', name: 'Kill Word', kind: O, school: 'shadow', tier: 3, cast: 0, cool: 30, cost: 30, flight: 'arc', acts: [kill(0.2, harm(60))] },
  { id: 'soul-swap', name: 'Soul Swap', kind: O, school: 'shadow', tier: 3, cast: 1.5, cool: 40, cost: 30, flight: 'beam', acts: [swap()] },
  { id: 'life-tap', name: 'Life Tap', kind: D, school: 'shadow', tier: 1, aim: 'self', cast: 0, cool: 10, cost: 0, flight: 'aura', acts: [harm(100, { pierce: true }), mana(30)] },
  { id: 'resolve', name: 'Resolve', kind: D, school: 'shadow', tier: 2, aim: 'self', cast: 0, cool: 24, cost: 12, flight: 'aura', acts: [mark(6, { name: 'Resolve', kind: 'boon', taken: 0.6, steady: true, look: 'steady' })] },

  // Holy ──────────────────────────────────────────────────────────────────
  { id: 'smite', name: 'Smite', kind: O, school: 'holy', tier: 1, cast: 1, cool: 2, cost: 8, flight: 'fall', acts: [harm(70)] },
  { id: 'sacred-flame', name: 'Sacred Flame', kind: O, school: 'holy', tier: 1, cast: 0, cool: 4, cost: 8, flight: 'fall', acts: [harm(55, { pierce: true })] },
  { id: 'guiding-bolt', name: 'Guiding Bolt', kind: O, school: 'holy', tier: 2, cast: 1.2, cool: 8, cost: 16, flight: 'bolt', acts: [harm(120), expose(0.2, 4, 'Guided')] },
  { id: 'holy-fire', name: 'Holy Fire', kind: O, school: 'holy', tier: 2, cast: 1.5, cool: 10, cost: 18, flight: 'fall', acts: [harm(110), dot(12, 6, 'Holy Fire')] },
  { id: 'judgment', name: 'Judgment', kind: O, school: 'holy', tier: 2, cast: 0, cool: 14, cost: 14, flight: 'fall', acts: [harm(80), hush(2.5)] },
  { id: 'holy-shock', name: 'Holy Shock', kind: O, school: 'holy', tier: 2, aim: 'any', cast: 0, cool: 8, cost: 14, flight: 'beam', acts: { foe: [harm(110)], ally: [heal(140)] } },
  { id: 'sunbeam', name: 'Sunbeam', kind: O, school: 'holy', tier: 3, cast: 2, cool: 18, cost: 30, flight: 'beam', acts: [harm(220), sleep(2, 'Blinded', 'daze')] },
  { id: 'healing-word', name: 'Healing Word', kind: D, school: 'holy', tier: 1, cast: 0, cool: 4, cost: 8, flight: 'rise', acts: [heal(70)] },
  { id: 'flash-heal', name: 'Flash Heal', kind: D, school: 'holy', tier: 1, cast: 1, cool: 3, cost: 12, flight: 'rise', acts: [heal(110)] },
  { id: 'renew', name: 'Renew', kind: D, school: 'holy', tier: 1, cast: 0, cool: 4, cost: 8, flight: 'aura', acts: [hot(18, 8, 'Renew')] },
  { id: 'power-shield', name: 'Power Shield', kind: D, school: 'holy', tier: 1, cast: 0, cool: 8, cost: 12, flight: 'aura', acts: [ward(130, 10, 'Power Shield')] },
  { id: 'cleanse', name: 'Cleanse', kind: D, school: 'holy', tier: 1, cast: 0, cool: 6, cost: 8, flight: 'aura', acts: [cleanse(2)] },
  { id: 'cure-wounds', name: 'Cure Wounds', kind: D, school: 'holy', tier: 2, cast: 1.5, cool: 4, cost: 16, flight: 'rise', acts: [heal(170)] },
  { id: 'penance', name: 'Penance', kind: D, school: 'holy', tier: 2, aim: 'any', cast: 1, cool: 10, cost: 16, flight: 'volley', acts: { foe: [harm(45), harm(45), harm(45)], ally: [heal(55), heal(55), heal(55)] } },
  { id: 'pain-suppression', name: 'Pain Suppression', kind: D, school: 'holy', tier: 2, cast: 0, cool: 24, cost: 12, flight: 'aura', acts: [armor(0.4, 6, 'Pain Suppression')] },
  { id: 'death-ward', name: 'Death Ward', kind: D, school: 'holy', tier: 2, cast: 0, cool: 30, cost: 16, flight: 'aura', acts: [mark(20, { name: 'Death Ward', kind: 'boon', cheat: 0.1, look: 'cheat' })] },
  { id: 'prayer-of-mending', name: 'Prayer of Mending', kind: D, school: 'holy', tier: 2, cast: 0, cool: 10, cost: 14, flight: 'aura', acts: [mark(20, { name: 'Prayer of Mending', kind: 'boon', struck: [heal(80)], charges: 3, look: 'mend' })] },
  { id: 'bless', name: 'Bless', kind: D, school: 'holy', tier: 2, reach: 'side', cast: 0, cool: 18, cost: 18, flight: 'aura', acts: [mark(8, { name: 'Blessed', kind: 'boon', dealt: 1.15, taken: 0.9, look: 'power' })] },
  { id: 'freedom', team: true, name: 'Freedom', kind: D, school: 'holy', tier: 2, cast: 0, cool: 18, cost: 12, flight: 'aura', acts: [cleanse(9, 'lock'), mark(4, { name: 'Freedom', kind: 'boon', steady: true, look: 'steady' })] },
  { id: 'holy-nova', name: 'Holy Nova', kind: D, school: 'holy', tier: 2, reach: 'side', cast: 0, cool: 12, cost: 18, flight: 'nova', acts: [heal(70)] },
  { id: 'greater-heal', name: 'Greater Heal', kind: D, school: 'holy', tier: 3, cast: 2.5, cool: 10, cost: 30, flight: 'rise', acts: [heal(360)] },
  { id: 'prayer-of-healing', name: 'Prayer of Healing', kind: D, school: 'holy', tier: 3, reach: 'side', cast: 2, cool: 14, cost: 30, flight: 'rise', acts: [heal(140)] },
  { id: 'guardian-spirit', name: 'Guardian Spirit', kind: D, school: 'holy', tier: 3, cast: 0, cool: 40, cost: 20, flight: 'aura', acts: [mark(8, { name: 'Guardian Spirit', kind: 'boon', cheat: 0.4, mended: 1.4, look: 'cheat' })] },
  { id: 'divine-shield', name: 'Divine Shield', kind: D, school: 'holy', tier: 3, aim: 'self', cast: 0, cool: 45, cost: 16, flight: 'aura', acts: [mark(3, { name: 'Divine Shield', kind: 'boon', immune: true, look: 'immune' })] },
  { id: 'lay-on-hands', name: 'Lay on Hands', kind: D, school: 'holy', tier: 3, cast: 0, cool: 45, cost: 0, flight: 'rise', acts: [heal(500)] },
  { id: 'revive', team: true, name: 'Revive', kind: D, school: 'holy', tier: 3, aim: 'fallen', cast: 3, cool: 30, cost: 30, flight: 'rise', acts: [revive(0.35)] },

  // Nature ────────────────────────────────────────────────────────────────
  { id: 'wrath', name: 'Wrath', kind: O, school: 'nature', tier: 1, cast: 1, cool: 2, cost: 8, flight: 'bolt', acts: [harm(70)] },
  { id: 'poison-spray', name: 'Poison Spray', kind: O, school: 'nature', tier: 1, cast: 0, cool: 5, cost: 8, flight: 'nova', acts: [harm(35), dot(10, 6, 'Poisoned')] },
  { id: 'acid-splash', name: 'Acid Splash', kind: O, school: 'nature', tier: 1, cast: 0, cool: 6, cost: 8, flight: 'bolt', acts: [harm(45), expose(0.1, 4, 'Corroded')] },
  { id: 'thorn-whip', name: 'Thorn Whip', kind: O, school: 'nature', tier: 1, cast: 0, cool: 8, cost: 10, flight: 'beam', acts: [harm(40), slow(0.25, 4, 'Snared')] },
  { id: 'entangle', name: 'Entangle', kind: O, school: 'nature', tier: 2, cast: 1, cool: 16, cost: 14, flight: 'rise', acts: [stun(2.5, 'Rooted', 'root'), dot(10, 4, 'Thorned')] },
  { id: 'insect-swarm', name: 'Insect Swarm', kind: O, school: 'nature', tier: 2, cast: 1, cool: 10, cost: 14, flight: 'nova', acts: [dot(18, 8, 'Swarmed'), weaken(0.2, 8)] },
  { id: 'earthquake', name: 'Earthquake', kind: O, school: 'nature', tier: 3, reach: 'side', cast: 2, cool: 22, cost: 32, flight: 'rise', acts: [harm(120), stun(1, 'Knocked Down')] },
  { id: 'rejuvenate', name: 'Rejuvenate', kind: D, school: 'nature', tier: 1, cast: 0, cool: 4, cost: 8, flight: 'aura', acts: [hot(15, 10, 'Rejuvenate')] },
  { id: 'barkskin', name: 'Barkskin', kind: D, school: 'nature', tier: 1, aim: 'self', cast: 0, cool: 16, cost: 6, flight: 'aura', acts: [armor(0.25, 8, 'Barkskin')] },
  { id: 'thorns', name: 'Thorns', kind: D, school: 'nature', tier: 1, cast: 0, cool: 12, cost: 8, flight: 'aura', acts: [thorns(35, 12, 'Thorns')] },
  { id: 'lifebloom', name: 'Lifebloom', kind: D, school: 'nature', tier: 2, cast: 0, cool: 8, cost: 14, flight: 'aura', acts: [hot(12, 6, 'Lifebloom', { expire: [heal(150)] })] },
  { id: 'regrowth', name: 'Regrowth', kind: D, school: 'nature', tier: 2, cast: 1.2, cool: 6, cost: 16, flight: 'rise', acts: [heal(100), hot(10, 6, 'Regrowth')] },
  { id: 'ironbark', name: 'Ironbark', kind: D, school: 'nature', tier: 2, cast: 0, cool: 20, cost: 12, flight: 'aura', acts: [armor(0.3, 8, 'Ironbark')] },
  { id: 'earth-shield', name: 'Earth Shield', kind: D, school: 'nature', tier: 2, cast: 0, cool: 12, cost: 14, flight: 'aura', acts: [mark(20, { name: 'Earth Shield', kind: 'boon', struck: [heal(60)], charges: 4, look: 'mend' })] },
  { id: 'chain-heal', name: 'Chain Heal', kind: D, school: 'nature', tier: 2, cast: 1.5, cool: 8, cost: 20, flight: 'arc', acts: [chain(2, 0.7, heal(150))] },
  { id: 'stoneskin', name: 'Stoneskin', kind: D, school: 'nature', tier: 2, cast: 1, cool: 14, cost: 16, flight: 'aura', acts: [ward(160, 12, 'Stoneskin', { taken: 0.9, look: 'stone' })] },
  { id: 'innervate', name: 'Innervate', kind: D, school: 'nature', tier: 2, cast: 0, cool: 30, cost: 0, flight: 'aura', acts: [mark(8, { name: 'Innervate', kind: 'boon', flow: 3, look: 'mana' })] },
  { id: 'tranquility', name: 'Tranquility', kind: D, school: 'nature', tier: 3, reach: 'side', cast: 2, cool: 24, cost: 32, flight: 'rise', acts: [hot(30, 6, 'Tranquility')] },
  { id: 'healing-rain', name: 'Healing Rain', kind: D, school: 'nature', tier: 3, reach: 'side', cast: 1.5, cool: 20, cost: 28, flight: 'fall', acts: [hot(22, 8, 'Healing Rain')] },
  { id: 'rebirth', team: true, name: 'Rebirth', kind: D, school: 'nature', tier: 3, aim: 'fallen', cast: 1.5, cool: 40, cost: 30, flight: 'rise', acts: [revive(0.25)] },

  // Arcane ────────────────────────────────────────────────────────────────
  { id: 'magic-missile', name: 'Magic Missile', kind: O, school: 'arcane', tier: 1, cast: 1, cool: 3, cost: 8, flight: 'volley', acts: [harm(25, { sure: true }), harm(25, { sure: true }), harm(25, { sure: true })] },
  { id: 'moonfire', name: 'Moonfire', kind: O, school: 'arcane', tier: 1, cast: 0, cool: 5, cost: 8, flight: 'fall', acts: [harm(40), dot(12, 8, 'Moonfire')] },
  { id: 'purge', name: 'Purge', kind: O, school: 'arcane', tier: 1, cast: 0, cool: 8, cost: 8, flight: 'nova', acts: [purge(2)] },
  { id: 'mana-burn', name: 'Mana Burn', kind: O, school: 'arcane', tier: 1, cast: 1, cool: 8, cost: 10, flight: 'beam', acts: [burn(25, 2)] },
  { id: 'arcane-blast', name: 'Arcane Blast', kind: O, school: 'arcane', tier: 2, cast: 1.5, cool: 4, cost: 20, flight: 'bolt', acts: [harm(160)] },
  { id: 'arcane-missiles', name: 'Arcane Missiles', kind: O, school: 'arcane', tier: 2, cast: 1.5, cool: 8, cost: 16, flight: 'volley', acts: [harm(35), harm(35), harm(35), harm(35), harm(35)] },
  { id: 'starfire', name: 'Starfire', kind: O, school: 'arcane', tier: 2, cast: 2, cool: 6, cost: 18, flight: 'fall', acts: [harm(190)] },
  { id: 'counterspell', name: 'Counterspell', kind: O, school: 'arcane', tier: 2, cast: 0, cool: 16, cost: 12, flight: 'arc', acts: [interrupt(3)] },
  { id: 'polymorph', name: 'Polymorph', kind: O, school: 'arcane', tier: 2, cast: 1.5, cool: 18, cost: 14, flight: 'bolt', acts: [mark(6, { name: 'Sheep', kind: 'bane', lock: 'sleep', look: 'sheep', pulse: [heal(20)] })] },
  { id: 'spell-steal', name: 'Spell Steal', kind: O, school: 'arcane', tier: 2, cast: 1, cool: 10, cost: 14, flight: 'beam', acts: [steal(1)] },
  { id: 'slow', name: 'Slow', kind: O, school: 'arcane', tier: 2, cast: 1, cool: 14, cost: 12, flight: 'bolt', acts: [slow(0.5, 6)] },
  { id: 'mana-siphon', name: 'Mana Siphon', kind: O, school: 'arcane', tier: 2, cast: 1, cool: 12, cost: 0, flight: 'beam', acts: [siphon(25)] },
  { id: 'chaos-bolt', name: 'Chaos Bolt', kind: O, school: 'arcane', tier: 2, cast: 1.5, cool: 8, cost: 18, flight: 'bolt', acts: [pick(harm(160, { school: 'fire' }), harm(160, { school: 'frost' }), harm(160, { school: 'storm' }), harm(160, { school: 'shadow' }), harm(160))] },
  { id: 'disintegrate', name: 'Disintegrate', kind: O, school: 'arcane', tier: 3, cast: 2, cool: 20, cost: 32, flight: 'beam', acts: [harm(240, { bonus: { when: 'low', times: 2 } })] },
  { id: 'starfall', name: 'Starfall', kind: O, school: 'arcane', tier: 3, cast: 0, cool: 24, cost: 30, flight: 'fall', acts: [scatter(6, harm(55))] },
  { id: 'time-stop', name: 'Time Stop', kind: O, school: 'arcane', tier: 3, reach: 'side', cast: 1, cool: 40, cost: 30, flight: 'nova', acts: [stun(2.5, 'Time Stopped', 'time')] },
  { id: 'feeblemind', name: 'Feeblemind', kind: O, school: 'arcane', tier: 3, cast: 2, cool: 30, cost: 26, flight: 'beam', acts: [harm(100), hush(4, 'Feebleminded'), burn(30)] },
  { id: 'prismatic-spray', name: 'Prismatic Spray', kind: O, school: 'arcane', tier: 3, reach: 'side', cast: 1.5, cool: 20, cost: 30, flight: 'nova', acts: [pick(harm(140, { school: 'fire' }), harm(140, { school: 'frost' }), harm(140, { school: 'storm' }), harm(140, { school: 'nature' }), hush(3), stun(2, 'Petrified', 'stone'), slow(0.5, 5))] },
  { id: 'arcane-ward', name: 'Arcane Ward', kind: D, school: 'arcane', tier: 1, cast: 0, cool: 8, cost: 10, flight: 'aura', acts: [ward(100, 8, 'Arcane Ward')] },
  { id: 'mage-armor', name: 'Mage Armor', kind: D, school: 'arcane', tier: 1, aim: 'self', cast: 0, cool: 16, cost: 8, flight: 'aura', acts: [ward(100, 10, 'Mage Armor', { taken: 0.9 })] },
  { id: 'dispel-magic', name: 'Dispel Magic', kind: D, school: 'arcane', tier: 1, aim: 'any', cast: 0, cool: 6, cost: 8, flight: 'aura', acts: { foe: [purge(1)], ally: [cleanse(1)] } },
  { id: 'mirror-image', name: 'Mirror Image', kind: D, school: 'arcane', tier: 2, aim: 'self', cast: 0, cool: 20, cost: 14, flight: 'aura', acts: [mark(10, { name: 'Mirror Image', kind: 'boon', evade: true, charges: 2, look: 'mirror' })] },
  { id: 'haste', name: 'Haste', kind: D, school: 'arcane', tier: 2, cast: 0, cool: 18, cost: 14, flight: 'aura', acts: [haste(0.5, 8)] },
  { id: 'mana-shield', name: 'Mana Shield', kind: D, school: 'arcane', tier: 2, aim: 'self', cast: 0, cool: 16, cost: 8, flight: 'aura', acts: [mark(10, { name: 'Mana Shield', kind: 'boon', shift: 0.6, look: 'mana' })] },
  { id: 'spell-reflect', name: 'Spell Reflect', kind: D, school: 'arcane', tier: 2, cast: 0, cool: 16, cost: 12, flight: 'aura', acts: [mark(6, { name: 'Spell Reflect', kind: 'boon', mirror: true, charges: 1, look: 'mirror' })] },
  { id: 'rewind', name: 'Rewind', kind: D, school: 'arcane', tier: 2, aim: 'self', cast: 0, cool: 30, cost: 12, flight: 'aura', acts: [mark(6, { name: 'Rewind', kind: 'boon', rewind: true, look: 'rewind' })] },
  { id: 'evocation', name: 'Evocation', kind: D, school: 'arcane', tier: 2, aim: 'self', cast: 2, cool: 30, cost: 0, flight: 'aura', acts: [mana(50)] },
  { id: 'globe', name: 'Globe of Warding', kind: D, school: 'arcane', tier: 3, reach: 'side', cast: 1, cool: 40, cost: 28, flight: 'nova', acts: [armor(0.5, 4, 'Warded')] },
  { id: 'time-warp', name: 'Time Warp', kind: D, school: 'arcane', tier: 3, cast: 0, cool: 45, cost: 20, flight: 'aura', acts: [refresh()] },
  { id: 'banish', name: 'Banish', kind: D, school: 'arcane', tier: 3, aim: 'any', cast: 1, cool: 30, cost: 20, flight: 'bolt', acts: [mark(4, { name: 'Banished', kind: 'bane', immune: true, lock: 'stun', look: 'banish' })] },
]

/** Fill defaults and attach roles and text, so every spell has the same shape. */
function defineSpell(raw) {
  const spell = {
    aim: raw.kind === O ? 'foe' : 'ally',
    reach: 'one',
    cast: 0,
    ...raw,
  }
  spell.roles = rolesOf(spell)
  spell.sure = Array.isArray(spell.acts) && spell.acts.some((act) => act.sure)
  spell.text = describeSpell(spell)
  return Object.freeze(spell)
}

export const CODEX = SPELL_LIST.map(defineSpell)
export const SPELL = Object.fromEntries(CODEX.map((spell) => [spell.id, spell]))

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
    if (aura.flow) roles.add('mana')
    if (['refresh', 'swap', 'spread'].includes(act.op)) roles.add('tempo')
  })
  return [...roles]
}

// ─── 6 · Book ───────────────────────────────────────────────────────────────
//
// Each match draws a fresh book: half offense, half defense, a spread of
// tiers, and a random chord (a run of runes) per spell. Chord length is
// tier + 1. Chords are prefix-free, so a chord fires the moment it is whole.

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

function drawSigil(dice, length, taken) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const sigil = Array.from({ length }, () => dice.pick(RUNES))
    if (!clashes(sigil, taken)) return sigil
  }
  throw new Error(`No free chord of length ${length}`)
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
      const sigil = drawSigil(dice, spell.tier + 1, taken)
      taken.push(sigil)
      return { id: spell.id, sigil }
    })
  const order = (entry) => KINDS.indexOf(SPELL[entry.id].kind) * 10 + SPELL[entry.id].tier
  return book.sort((a, b) => order(a) - order(b) || SPELL[a.id].name.localeCompare(SPELL[b.id].name))
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
// their own team in the near row. The target cursor starts on yourself:
// up/down swap rows, left/right walk along a row, as seen from your side.

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

/** Where the cursor lands after one move. */
export function moveCursor(mages, viewer, cursorId, move) {
  const cursor = mages.find((m) => m.id === cursorId)
  if (!cursor) return cursorId
  if (move === 'up' || move === 'down') {
    const team = move === 'up' ? 1 - viewer : viewer
    if (team === cursor.team) return cursorId
    const from = rowOf(mages, cursor.team, viewer)
    const to = rowOf(mages, team, viewer)
    const share = (from.indexOf(cursor) + 0.5) / from.length
    return to[Math.min(to.length - 1, Math.floor(share * to.length))].id
  }
  const row = rowOf(mages, cursor.team, viewer)
  const index = clamp(row.indexOf(cursor) + (move === 'left' ? -1 : 1), 0, row.length - 1)
  return row[index].id
}

/** The moves that walk the cursor from one mage to another. */
export function pathTo(mages, viewer, fromId, toId) {
  const moves = []
  let cursor = fromId
  const target = mages.find((m) => m.id === toId)
  if (!target) return moves
  if (mages.find((m) => m.id === cursor).team !== target.team) {
    const move = target.team === viewer ? 'down' : 'up'
    moves.push(move)
    cursor = moveCursor(mages, viewer, cursor, move)
  }
  const row = rowOf(mages, target.team, viewer)
  const step = row.indexOf(target) - row.findIndex((m) => m.id === cursor)
  for (let i = 0; i < Math.abs(step); i++) moves.push(step < 0 ? 'left' : 'right')
  return moves
}

// ─── 8 · Match ──────────────────────────────────────────────────────────────

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

const factor = (mage, field) => mage.auras.reduce((value, aura) => (aura.def[field] != null ? value * aura.def[field] : value), 1)
const flagged = (mage, field) => mage.auras.some((aura) => aura.def[field])
const guardOf = (mage) => mage.auras.reduce((sum, aura) => sum + (aura.guard ?? 0), 0)

const auraRules = (aura) => aura.def ?? aura.rules ?? aura

function meets(when, mage) {
  if (when === 'locked') return mage.auras.some((a) => auraRules(a).lock === 'stun' || auraRules(a).lock === 'sleep')
  if (when === 'burning') return mage.auras.some((a) => a.kind === 'bane' && a.school === 'fire')
  if (when === 'low') return mage.life / mage.lifeMax <= 0.3
  return false
}

function makeMage(seat, rules) {
  return {
    id: seat.id,
    name: seat.name,
    team: seat.team,
    slot: seat.slot,
    bot: Boolean(seat.bot),
    life: rules.life,
    lifeMax: rules.life,
    mana: TIMING.mana,
    manaMax: TIMING.mana,
    down: false,
    auras: [],
    cast: null,
    queue: null,
    chord: { keys: [], runes: [], cursor: seat.id, last: 0 },
    cools: {},
    recover: 0,
    stagger: 0,
    seq: 0,
    stats: { dealt: 0, healed: 0, taken: 0, casts: 0, fizzles: 0, kills: 0 },
  }
}

/** Give every roster entry a team, slot and unique id. */
function seatRoster(roster) {
  const used = [0, 0]
  return roster.map((seat, i) => {
    const team = seat.team === 1 ? 1 : 0
    const slot = Number.isInteger(seat.slot) ? seat.slot : used[team]
    used[team] = Math.max(used[team], slot + 1)
    return { id: seat.id ?? `m${i}`, name: seat.name ?? `Mage ${i + 1}`, team, slot, bot: seat.bot }
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
    this.tick = 0
    this.phase = 'ready'
    this.fightAt = secs(TIMING.ready)
    this.surgeAt = this.fightAt + secs(this.rules.surge)
    this.winner = null
    this.mages = seatRoster(roster).map((seat) => makeMage(seat, this.rules))
    this.index = new Map(this.mages.map((m) => [m.id, m]))
    this.flights = []
    this.inbox = []
    this.events = []
  }

  // Messages in ──────────────────────────────────────────────────────────

  /** Queue an order: { type: 'press', mage, key, seq? }. Runs on the next tick. */
  receive(order) {
    this.inbox.push(order)
  }

  /** Take every event emitted since the last flush. */
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
    if (this.phase === 'ready' && this.tick >= this.fightAt) {
      this.phase = 'fight'
      this.emit('start')
    }
    if (this.phase !== 'fight') return
    this.surge()
    for (const mage of this.mages) if (!mage.down) this.tend(mage)
    for (const flight of this.flights.filter((f) => f.land <= this.tick)) {
      this.flights.splice(this.flights.indexOf(flight), 1)
      this.land(flight)
    }
    this.judgeEnd()
  }

  handle(order) {
    const mage = this.index.get(order.mage)
    if (!mage || order.type !== 'press' || !KEYS.includes(order.key)) return
    if (Number.isInteger(order.seq)) mage.seq = Math.max(mage.seq, order.seq)
    this.press(mage, order.key)
  }

  /** Regen, auras, chord timeout, cast progress and queued casts for one mage. */
  tend(mage) {
    mage.mana = Math.min(mage.manaMax, mage.mana + (TIMING.regen / TICK_RATE) * factor(mage, 'flow'))
    this.tendAuras(mage)
    if (mage.down) return
    const chord = mage.chord
    if (chord.keys.length && this.tick - chord.last > secs(TIMING.idle)) {
      this.clearChord(mage)
      this.emit('lapse', { mage: mage.id })
    }
    if (mage.cast) {
      if (lockOf(mage)) return this.stopCast(mage, 'break')
      mage.cast.done += factor(mage, 'pace')
      if (mage.cast.done >= mage.cast.total) this.fire(mage, SPELL[mage.cast.spell], this.index.get(mage.cast.target))
    } else if (mage.queue && this.tick >= mage.recover) {
      const queued = mage.queue
      mage.queue = null
      this.order(mage, queued.spell, queued.target)
    }
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

  auraContext(aura, mage, scale) {
    return { from: this.index.get(aura.from) ?? null, to: mage, spell: aura.spell, name: aura.name, school: aura.school, direct: false, scale }
  }

  surge() {
    if (this.tick < this.surgeAt || (this.tick - this.surgeAt) % TICK_RATE !== 0) return
    const wave = (this.tick - this.surgeAt) / TICK_RATE + 1
    this.emit('surge', { wave })
    for (const mage of this.mages) {
      if (!mage.down) this.hurt(null, mage, mage.lifeMax * TIMING.surge * wave, { school: 'arcane', pierce: true, exact: true })
    }
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

  press(mage, key) {
    if (this.phase !== 'fight' || mage.down) return
    const lock = lockOf(mage)
    if (lock === 'stun' || lock === 'sleep' || this.tick < mage.stagger) return
    const chord = mage.chord
    if (key === 'drop') return this.dropKey(mage)
    chord.keys.push(key)
    chord.last = this.tick
    if (MOVES.includes(key)) {
      chord.cursor = moveCursor(this.mages, mage.team, chord.cursor, key)
      return
    }
    chord.runes.push(key)
    const read = readRunes(this.book, chord.runes)
    if (read === 'open') return
    const target = chord.cursor
    this.clearChord(mage)
    if (!read) return this.fizzle(mage, 'Unknown chord')
    this.order(mage, read.id, target)
  }

  dropKey(mage) {
    if (mage.chord.keys.length) {
      this.clearChord(mage)
      this.emit('lapse', { mage: mage.id })
    } else if (mage.queue) mage.queue = null
    else if (mage.cast) this.stopCast(mage, 'drop')
  }

  clearChord(mage) {
    mage.chord = { keys: [], runes: [], cursor: mage.id, last: this.tick }
  }

  // Casting ──────────────────────────────────────────────────────────────

  /** Why a mage cannot cast a spell on a target right now, or null. */
  fault(mage, spell, target) {
    if (lockOf(mage) === 'hush') return 'Silenced'
    if ((mage.cools[spell.id] ?? 0) > this.tick) return 'Not ready'
    if (mage.mana < spell.cost) return 'Low mana'
    if (!target) return 'No target'
    const ally = target.team === mage.team
    if (spell.aim === 'foe' && ally) return 'Needs a foe'
    if ((spell.aim === 'ally' || spell.aim === 'fallen') && !ally) return 'Needs an ally'
    if (spell.aim === 'fallen') return target.down ? null : 'Needs a fallen ally'
    if (target.down) return 'Target is down'
    return null
  }

  order(mage, spellId, targetId) {
    const spell = SPELL[spellId]
    const target = spell.aim === 'self' ? mage : this.index.get(targetId)
    const fault = this.fault(mage, spell, target)
    if (fault) return this.fizzle(mage, fault, spell.id)
    if (mage.cast || this.tick < mage.recover) {
      mage.queue = { spell: spell.id, target: target.id }
      return this.emit('queue', { mage: mage.id, spell: spell.id, target: target.id })
    }
    this.startCast(mage, spell, target)
  }

  startCast(mage, spell, target) {
    const total = secs(spell.cast)
    if (total <= 0) return this.fire(mage, spell, target)
    mage.cast = { spell: spell.id, target: target.id, done: 0, total }
    this.emit('cast', { mage: mage.id, spell: spell.id, target: target.id, total })
  }

  stopCast(mage, why) {
    if (!mage.cast) return
    this.emit('stop', { mage: mage.id, spell: mage.cast.spell, why })
    mage.cast = null
  }

  fizzle(mage, why, spell = null) {
    mage.stats.fizzles++
    mage.stagger = this.tick + secs(TIMING.stagger)
    this.emit('fizzle', { mage: mage.id, why, spell })
  }

  fire(mage, spell, target) {
    mage.cast = null
    const fault = this.fault(mage, spell, target)
    if (fault) return this.fizzle(mage, fault, spell.id)
    mage.mana -= spell.cost
    mage.cools[spell.id] = this.tick + secs(spell.cool)
    mage.recover = this.tick + secs(TIMING.recover)
    mage.stats.casts++
    const targets = spell.reach === 'side' ? this.sideOf(target) : [target]
    const flight = { mage: mage.id, spell: spell.id, target: target.id, targets: targets.map((m) => m.id), land: this.tick + secs(FLIGHTS[spell.flight]) }
    this.emit('fire', flight)
    if (flight.land <= this.tick) this.land(flight)
    else this.flights.push(flight)
  }

  land(flight) {
    const caster = this.index.get(flight.mage)
    const spell = SPELL[flight.spell]
    this.emit('land', { mage: flight.mage, spell: flight.spell, target: flight.target, targets: flight.targets })
    for (const id of flight.targets) {
      const target = this.index.get(id)
      if (target.down !== (spell.aim === 'fallen')) continue
      const acts = actsFor(spell, caster, target)
      const context = { from: caster, to: target, spell: spell.id, name: spell.name, school: spell.school, direct: true, scale: 1 }
      const deflect = caster.team !== target.team && !spell.sure ? this.deflect(caster, target) : null
      if (deflect === 'evade') continue
      if (deflect === 'reflect') this.apply(acts, { ...context, from: target, to: caster, direct: false })
      else this.apply(acts, context)
    }
  }

  /** Spend a reflect or dodge charge against a hostile spell: 'reflect', 'evade' or null. */
  deflect(caster, target) {
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
      for (const aura of to.auras.filter((a) => a.def.thorns)) this.hurt(to, from, aura.def.thorns, { school: aura.school, echo: true })
      for (const aura of to.auras.filter((a) => a.def.struck && a.charges > 0)) {
        this.apply(aura.def.struck, this.auraContext(aura, to, 1))
        this.spendCharge(to, aura)
      }
    }
    return amount
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
    this.clearChord(mage)
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

  mark(from, to, def, { name, school, spell = null }) {
    if (!to || to.down) return
    const kind = def.kind ?? 'bane'
    if (kind === 'bane' && flagged(to, 'immune') && from !== to) {
      return this.emit('void', { from: from?.id ?? null, to: to.id, why: 'immune' })
    }
    if (kind === 'bane' && def.lock && flagged(to, 'steady')) {
      return this.emit('void', { from: from?.id ?? null, to: to.id, why: 'steady' })
    }
    const label = def.name ?? name ?? 'Effect'
    const time = secs(def.time)
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
      guard: def.guard ?? 0,
      charges: def.charges ?? 0,
      store: def.rewind ? to.life : 0,
    })
    if (def.lock === 'stun' || def.lock === 'sleep') {
      this.stopCast(to, 'break')
      this.clearChord(to)
      to.queue = null
    } else if (def.lock === 'hush') this.stopCast(to, 'break')
    this.emit('mark', { from: from?.id ?? null, to: to.id, name: label, kind, look: aura.look, school: aura.school, time })
  }

  unmark(mage, aura, why) {
    const at = mage.auras.indexOf(aura)
    if (at < 0) return
    mage.auras.splice(at, 1)
    this.emit('fade', { to: mage.id, name: aura.name, why })
  }

  spendCharge(mage, aura) {
    aura.charges--
    if (aura.charges <= 0) this.unmark(mage, aura, 'spent')
  }

  // Views out ────────────────────────────────────────────────────────────

  /** Static match facts every client needs once. */
  setup() {
    return {
      seed: this.seed,
      rules: this.rules,
      book: this.book,
      fightAt: this.fightAt,
      surgeAt: this.surgeAt,
      tickRate: TICK_RATE,
      roster: this.mages.map(({ id, name, team, slot, bot, lifeMax, manaMax }) => ({ id, name, team, slot, bot, lifeMax, manaMax })),
    }
  }

  /** The changing state, sent to clients every tick. */
  frame() {
    return {
      tick: this.tick,
      phase: this.phase,
      winner: this.winner,
      mages: this.mages.map((m) => ({
        id: m.id,
        life: m.life,
        mana: Math.round(m.mana * 10) / 10,
        guard: guardOf(m),
        down: m.down,
        lock: lockOf(m),
        auras: m.auras.map((a) => ({ name: a.name, kind: a.kind, look: a.look, school: a.school, left: a.left, total: a.total, charges: a.charges, lock: a.def.lock ?? null })),
        cast: m.cast && { ...m.cast },
        queue: m.queue?.spell ?? null,
        chord: { keys: [...m.chord.keys], cursor: m.chord.cursor },
        cools: { ...m.cools },
        stagger: m.stagger,
        seq: m.seq,
      })),
    }
  }

  /** Everything a brain may know when it is mage `id`. Plain data only. */
  view(id) {
    const frame = this.frame()
    const roster = this.setup().roster
    return {
      me: id,
      tick: this.tick,
      phase: this.phase,
      surgeAt: this.surgeAt,
      book: this.book,
      mages: frame.mages.map((m, i) => ({
        ...roster[i],
        ...m,
        auras: this.mages[i].auras.map((a) => ({ name: a.name, kind: a.kind, school: a.school, left: a.left, total: a.total, guard: a.guard, charges: a.charges, rules: a.def })),
      })),
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
    this.hurt(c.from, c.to, amount, { school: act.school ?? c.school, direct: c.direct, pierce: act.pierce })
  },
  heal(act, c) {
    this.mend(c.from, c.to, act.amount * c.scale)
  },
  drain(act, c) {
    const taken = this.hurt(c.from, c.to, act.amount * c.scale, { school: c.school, direct: c.direct })
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
        this.mark(c.from, c.from, { ...aura.def, kind: aura.kind, time: aura.left / TICK_RATE }, { name: aura.name, school: aura.school, spell: aura.spell })
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
        this.mark(this.index.get(aura.from) ?? c.from, other, { ...aura.def, kind: aura.kind, time: aura.left / TICK_RATE }, { name: aura.name, school: aura.school, spell: aura.spell })
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
  if (rules.flow) gain += (rules.flow - 1) * 60 * (1 - c.to.mana / c.to.manaMax)
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
    const rules = act.aura
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
    return left > secs(0.35) ? 140 + SPELL[c.to.cast.spell].tier * 70 : 0
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

/** Score one spell on one target from `me`'s point of view. */
export function rateSpell(spell, me, target, view) {
  const hits = spell.reach === 'side' ? view.mages.filter((m) => m.team === target.team && !m.down) : [target]
  let value = 0
  for (const to of hits) {
    const c = { me, to, view, foe: to.team !== me.team, scale: 1, name: spell.name }
    value += weighActs(actsFor(spell, me, to), c)
  }
  value -= spell.cost * (0.6 + (1 - me.mana / me.manaMax) * 1.5)
  return value / (1 + spell.cast * 0.12 + spell.tier * 0.04)
}

export class Brain {
  constructor({ skill = 'normal', seed = 1 } = {}) {
    this.skill = SKILLS[skill] ?? SKILLS.normal
    this.dice = new Dice(seed)
  }

  /** Pick the best { spell, target } for the mage `view.me`, or null to wait. */
  think(view) {
    const me = view.mages.find((m) => m.id === view.me)
    if (!me || me.down) return null
    const pending = me.cast ? SPELL[me.cast.spell] : null
    const budget = me.mana - (pending?.cost ?? 0)
    let best = null
    for (const entry of view.book) {
      const spell = SPELL[entry.id]
      if (spell === pending || (me.cools[spell.id] ?? 0) > view.tick || budget < spell.cost) continue
      if (viewLock(me) === 'hush') continue
      for (const target of targetsFor(spell, me, view.mages)) {
        const value = rateSpell(spell, me, target, view) * (1 + this.dice.float(-this.skill.noise, this.skill.noise))
        if (!best || value > best.value) best = { spell: spell.id, target: target.id, value }
      }
    }
    return best && best.value > 12 ? { spell: best.spell, target: best.target } : null
  }
}

// ─── 10 · Pilot ─────────────────────────────────────────────────────────────
//
// A pilot plays a seat like a person would: it asks its brain for a plan,
// waits a reaction time, then presses the target moves and runes one key at
// a time with human-like gaps. Bots use exactly the same `press` orders as
// players, so they follow exactly the same rules.

export class Pilot {
  constructor({ brain = null, skill = 'normal', seed = 1 } = {}) {
    this.skill = SKILLS[skill] ?? SKILLS.normal
    this.brain = brain ?? new Brain({ skill, seed })
    this.dice = new Dice(seed).fork('hands')
    this.plan = null
    this.wait = 0
    this.busy = false
  }

  /** Keys to press this tick for mage `id`. */
  drive(match, id) {
    const me = match.index.get(id)
    if (!me || match.phase !== 'fight' || me.down) {
      this.plan = null
      return []
    }
    const lock = lockOf(me)
    if (lock === 'stun' || lock === 'sleep' || match.tick < me.stagger) {
      this.plan = null
      this.wait = Math.max(this.wait, match.tick + secs(this.roll('react')))
      return []
    }
    if (this.plan) return this.type(match, me)
    if (this.busy || match.tick < this.wait) return []
    if (me.cast && me.cast.total - me.cast.done > secs(this.skill.think[1])) return []
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
      return []
    }
    this.accept(plan, match, me)
    return []
  }

  roll(field) {
    return this.dice.float(...this.skill[field])
  }

  accept(plan, match, me) {
    const entry = plan && match.book.find((e) => e.id === plan.spell)
    if (!entry || !match.index.has(plan.target)) {
      this.wait = match.tick + secs(this.roll('think'))
      return
    }
    const moves = SPELL[plan.spell].aim === 'self' ? [] : pathTo(match.mages, me.team, me.id, plan.target)
    const keys = [...(me.chord.keys.length ? ['drop'] : []), ...moves, ...entry.sigil]
    this.plan = { ...plan, keys, at: match.tick + secs(this.roll('react')) }
  }

  type(match, me) {
    const plan = this.plan
    const spell = SPELL[plan.spell]
    const target = match.index.get(plan.target)
    const usable = (me.cools[spell.id] ?? 0) <= match.tick + secs(1) && me.mana + 4 >= spell.cost && target && target.down === (spell.aim === 'fallen')
    if (!usable) {
      this.plan = null
      this.wait = match.tick + secs(0.2)
      return me.chord.keys.length ? ['drop'] : []
    }
    if (match.tick < plan.at) return []
    const key = plan.keys.shift()
    plan.at = match.tick + secs(this.roll('gap'))
    if (!plan.keys.length) {
      this.plan = null
      this.wait = match.tick + secs(this.roll('think'))
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
  any: (v) => (v === undefined ? null : v),
}

export const WIRE = {
  peer: {
    hello: { name: 'name' }, // set your display name
    open: { rules: 'rules' }, // host a new room
    join: { code: 'code' }, // join a room by code
    seat: { team: 'team', slot: 'slot' }, // move to an open seat
    bench: { team: 'team', slot: 'slot' }, // owner: toggle a bot in a seat
    tune: { rules: 'rules' }, // owner: change match rules
    start: {}, // owner: start the match
    press: { key: 'key', seq: 'count' }, // one key of a chord
    again: {}, // owner: rematch with a new book
    lobby: {}, // owner: return everyone to the lobby
    leave: {}, // leave the room
  },
  host: {
    welcome: { you: 'any' }, // your peer id
    room: { room: 'any' }, // lobby state
    begin: { setup: 'any', you: 'any' }, // a match starts; `you` is your mage id
    frame: { frame: 'any', events: 'any' }, // one tick of state and its events
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
    out[field] = value
  }
  return out
}
