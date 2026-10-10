/**
 * test.mjs — Chordcast tests. Run with `npm test`.
 *
 *   1  Core    rules, book, chords, every spell, determinism and bots
 *   2  Host    rooms, codes, matches over the wire, deltas, drops and faults
 *   3  Views   a Playwright run through every essential screen; the
 *              screenshots are written to shots/ and committed
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import WebSocket from 'ws'
import { chromium } from 'playwright'
import {
  Arena, Brain, CHORD_LENGTH, CODEX, Dice, GARB, KINDS, METAS, Match, Pilot, RULES, SCHOOLS, SPELL, TICK_RATE, TIMING, WISPS,
  botRoster, costOf, diff, hashText, moveCursor, pack, packFrame, patch, pathTo, pickGarb, readChord, readRunes, simulate, splitTiers, tidyGarb,
  tidyRules, unpack, unpackFrame, writeBook,
} from './core.mjs'
import { openHost } from './host.mjs'

const SHOTS = new URL('./shots/', import.meta.url)
const RUNE_ROW = ['star', 'wave', 'flame', 'leaf']

// ─── Helpers ────────────────────────────────────────────────────────────────

/** A fresh match already in the fight phase. */
function fightingMatch({ teams = [1, 1], seed = 7, life = 800 } = {}) {
  const rules = tidyRules({ teams, life })
  const match = new Match({ seed, rules, roster: botRoster(rules) })
  while (match.phase !== 'fight') match.advance()
  match.flush()
  return match
}

/** Give a match a hand-made book, and every mage all of it as a kit. */
function useBook(match, book) {
  match.book = book
  for (const mage of match.mages) mage.kit = book.map((entry) => entry.id)
}

/** Advance some ticks and return every event seen. */
function wait(match, ticks) {
  const events = []
  for (let i = 0; i < ticks; i++) {
    match.advance()
    events.push(...match.flush())
  }
  return events
}

/** Press keys for a mage, one per tick, and return every event seen. */
function play(match, mage, keys, extraTicks = 0) {
  const events = []
  for (const key of keys) {
    match.receive({ type: 'press', mage, key })
    match.advance()
    events.push(...match.flush())
  }
  for (let i = 0; i < extraTicks; i++) {
    match.advance()
    events.push(...match.flush())
  }
  return events
}

/** The keys that cast `spellId` from `caster` on `target`. */
function chordFor(match, caster, target, spellId) {
  const entry = match.book.find((e) => e.id === spellId)
  const team = match.index.get(caster).team
  const moves = SPELL[spellId].aim === 'self' ? [] : pathTo(match.mages, team, match.index.get(caster).aim, target, caster)
  return [...moves, ...entry.sigil]
}

// ─── 1 · Core ───────────────────────────────────────────────────────────────

test('codex has a very large, well-formed spell list', () => {
  assert.ok(CODEX.length >= 100, `only ${CODEX.length} spells`)
  assert.equal(new Set(CODEX.map((s) => s.id)).size, CODEX.length, 'ids are unique')
  assert.equal(new Set(CODEX.map((s) => s.name)).size, CODEX.length, 'names are unique')
  for (const spell of CODEX) {
    assert.ok(KINDS.includes(spell.kind), spell.id)
    assert.ok(SCHOOLS.includes(spell.school), spell.id)
    assert.ok([1, 2, 3].includes(spell.tier), spell.id)
    assert.ok(['foe', 'ally', 'self', 'any', 'fallen'].includes(spell.aim), spell.id)
    assert.ok(spell.cost >= 0 && spell.cool > 0 && spell.cast >= 0, spell.id)
    assert.ok(spell.text.length > 5 && !spell.text.includes('undefined'), `${spell.id}: ${spell.text}`)
    assert.ok(spell.roles.length > 0, `${spell.id} has a role`)
  }
  for (const kind of KINDS) {
    for (const tier of [1, 2, 3]) {
      const count = CODEX.filter((s) => s.kind === kind && s.tier === tier && !s.team).length
      assert.ok(count >= 8, `${kind} tier ${tier} has ${count} spells`)
    }
  }
})

test('rules are clamped into range', () => {
  const rules = tidyRules({ teams: [0, 99], book: 7, life: 'lots', surge: 5, skill: 'godlike' })
  assert.deepEqual(rules.teams, [1, 8])
  assert.equal(rules.book, 12)
  assert.equal(rules.kit, 8, 'a kit leaves at least four spells of the book behind')
  assert.equal(rules.life, RULES.life)
  assert.equal(rules.surge, 20)
  assert.equal(rules.skill, RULES.skill)
  assert.equal(tidyRules({ book: 23, kit: 2 }).book, 22)
  assert.equal(tidyRules({ book: 24, kit: 2 }).kit, 4)
})

test('books are balanced, prefix-free and seeded', () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const size of [12, 16, 20, 24]) {
      const book = writeBook(new Dice(seed), size, [2, 2])
      assert.equal(book.length, size)
      for (const kind of KINDS) assert.equal(book.filter((e) => SPELL[e.id].kind === kind).length, size / 2)
      const tiers = splitTiers(size / 2)
      for (const tier of [1, 2, 3]) assert.equal(book.filter((e) => SPELL[e.id].tier === tier).length, tiers[tier] * 2)
      for (const entry of book) {
        assert.equal(entry.sigil.length, CHORD_LENGTH[SPELL[entry.id].tier])
        for (const other of book) {
          if (other === entry) continue
          const prefix = other.sigil.slice(0, entry.sigil.length).join() === entry.sigil.join()
          assert.ok(!prefix, `${entry.id} is a prefix of ${other.id}`)
        }
      }
    }
  }
  assert.deepEqual(writeBook(new Dice(5), 12), writeBook(new Dice(5), 12))
  assert.notDeepEqual(writeBook(new Dice(5), 12), writeBook(new Dice(6), 12))
  for (let seed = 1; seed <= 40; seed++) assert.ok(writeBook(new Dice(seed), 20, [1, 3]).every((e) => !SPELL[e.id].team), 'no team spells in solo play')
})

test('runes read as whole, open or dead; meta takes the next rune', () => {
  const book = [{ id: 'fire-bolt', sigil: ['star', 'wave'] }, { id: 'fireball', sigil: ['flame', 'leaf', 'star'] }]
  assert.equal(readRunes(book, ['star', 'wave']).id, 'fire-bolt')
  assert.equal(readRunes(book, ['flame', 'leaf']), 'open')
  assert.equal(readRunes(book, ['leaf']), null)
  assert.deepEqual(readChord(['up', 'meta', 'flame', 'star', 'meta', 'star', 'meta', 'flame', 'wave']), { runes: ['star', 'wave'], metas: ['empower', 'quicken'], arming: false })
  assert.equal(readChord(['star', 'meta']).arming, true)
})

test('the target cursor walks rows as each side sees them', () => {
  const match = fightingMatch({ teams: [3, 2] })
  for (const viewer of [0, 1]) {
    for (const from of match.mages.filter((m) => m.team === viewer)) {
      for (const to of match.mages) {
        let cursor = from.id
        for (const move of pathTo(match.mages, viewer, from.id, to.id)) cursor = moveCursor(match.mages, viewer, cursor, move)
        assert.equal(cursor, to.id, `${from.id} → ${to.id} for team ${viewer}`)
      }
    }
  }
  const [left, middle] = [match.index.get('t0s0'), match.index.get('t0s1')]
  assert.equal(moveCursor(match.mages, 0, left.id, 'right'), middle.id)
  assert.equal(moveCursor(match.mages, 1, 't1s1', 'right'), 't1s0', 'team 1 sees its row mirrored')
  assert.equal(moveCursor(match.mages, 0, 't0s2', 'down', 't0s0'), 't0s0', 'down on your own row snaps home')
  assert.deepEqual(pathTo(match.mages, 0, 't0s2', 't0s0', 't0s0'), ['down'], 'the snap is the shortest way home')
  assert.deepEqual(pathTo(match.mages, 0, 't1s1', 't0s0', 't0s0'), ['down', 'down'])
  for (const from of match.mages) {
    for (const viewer of [0, 1]) {
      const self = match.mages.find((m) => m.team === viewer).id
      let cursor = from.id
      for (const move of pathTo(match.mages, viewer, from.id, self, self)) cursor = moveCursor(match.mages, viewer, cursor, move, self)
      assert.equal(cursor, self, `${from.id} → home for team ${viewer}`)
    }
  }
})

test('a chord aims, casts, flies and lands', () => {
  const match = fightingMatch()
  useBook(match, [{ id: 'fireball', sigil: ['star', 'wave', 'flame'] }])
  const events = play(match, 't0s0', ['up', 'star', 'wave', 'flame'], TICK_RATE * 3)
  const types = events.map((e) => e.type)
  for (const type of ['cast', 'fire', 'land', 'hit', 'mark']) assert.ok(types.includes(type), `missing ${type}`)
  const foe = match.index.get('t1s0')
  assert.ok(foe.life < foe.lifeMax)
  assert.ok(match.index.get('t0s0').mana < 100)
})

test('wrong chords, targets, kits, cooldowns and silences fizzle', () => {
  const match = fightingMatch()
  useBook(match, [
    { id: 'scorch', sigil: ['star', 'wave'] },
    { id: 'healing-word', sigil: ['flame', 'leaf'] },
    { id: 'fire-bolt', sigil: ['wave', 'wave'] },
    { id: 'barkskin', sigil: ['star', 'star'] },
  ])
  match.index.get('t0s0').kit = ['scorch', 'healing-word', 'barkskin']
  const why = (keys) => play(match, 't0s0', keys, TICK_RATE).find((e) => e.type === 'fizzle')?.why
  assert.equal(why(['leaf']), 'Unknown chord')
  assert.equal(why(['star', 'wave']), 'Needs a foe', 'offense on yourself')
  assert.equal(why(['wave', 'wave']), 'Not in kit', 'a book spell left out of the draft')
  assert.equal(why(['up', 'star', 'wave']), undefined, 'scorch lands')
  assert.equal(why(['star', 'wave']), 'Not ready', 'the aim stayed on the foe')
  assert.equal(why(['meta', 'wave', 'star', 'star']), 'Can’t twin', 'Twin needs a single target')
  assert.equal(why(['meta', 'leaf', 'flame', 'leaf']), 'Nothing to extend')
  match.mark(null, match.index.get('t0s0'), { time: 3, kind: 'bane', lock: 'hush', name: 'Silenced' }, {})
  assert.equal(why(['flame', 'leaf']), 'Silenced')
})

test('stuns block keys and break casts; drop cancels', () => {
  const match = fightingMatch()
  useBook(match, [{ id: 'greater-heal', sigil: ['star', 'star', 'star', 'star'] }])
  const me = match.index.get('t0s0')
  play(match, me.id, ['star', 'star', 'star', 'star'])
  assert.ok(me.cast, 'casting')
  const dropped = play(match, me.id, ['drop'])
  assert.ok(dropped.some((e) => e.type === 'stop' && e.why === 'drop'))
  play(match, me.id, ['star', 'star'])
  match.mark(null, me, { time: 2, kind: 'bane', lock: 'stun', name: 'Stunned' }, {})
  assert.equal(me.chord.keys.length, 0, 'a stun clears the chord')
  play(match, me.id, ['star'])
  assert.equal(me.chord.keys.length, 0, 'keys are ignored while stunned')
})

test('reflect sends a whole spell back; dodge cancels it; sure spells ignore both', () => {
  const cast = (spell, guard) => {
    const match = fightingMatch()
    useBook(match, [{ id: spell, sigil: ['star', 'wave', 'flame'] }])
    match.mark(null, match.index.get('t1s0'), { time: 9, kind: 'boon', charges: 1, ...guard }, { name: 'Guard' })
    play(match, 't0s0', ['up', 'star', 'wave', 'flame'], TICK_RATE * 3)
    return match
  }
  const reflected = cast('polymorph', { mirror: true })
  assert.equal(reflected.index.get('t0s0').auras.find((a) => a.name === 'Sheep')?.look, 'sheep', 'the caster turns into a sheep')
  assert.ok(!reflected.index.get('t1s0').auras.some((a) => a.name === 'Sheep'))
  const dodged = cast('frostbolt', { evade: true })
  assert.equal(dodged.index.get('t1s0').life, dodged.index.get('t1s0').lifeMax, 'a dodged spell does nothing')
  const sure = cast('magic-missile', { evade: true })
  assert.ok(sure.index.get('t1s0').life < sure.index.get('t1s0').lifeMax, 'magic missile never misses')
})

test('every spell in the codex can be cast', () => {
  for (const spell of CODEX) {
    const match = fightingMatch({ teams: [2, 2], seed: 11 })
    useBook(match, [{ id: spell.id, sigil: Array.from({ length: CHORD_LENGTH[spell.tier] }, (_, i) => RUNE_ROW[i % 4]) }])
    const ally = match.index.get('t0s1')
    if (spell.aim === 'fallen') match.hurt(null, ally, 5000, { exact: true, pierce: true })
    match.index.get('t1s0').auras.push({ name: 'Test Boon', kind: 'boon', look: 'boon', school: 'holy', def: { time: 9 }, left: 99, total: 99, next: 20, pulses: 0, charges: 0, guard: 0 })
    const target = spell.aim === 'foe' || spell.aim === 'any' ? 't1s0' : spell.aim === 'self' ? 't0s0' : 't0s1'
    const events = play(match, 't0s0', chordFor(match, 't0s0', target, spell.id), TICK_RATE * 8)
    const fizzle = events.find((e) => e.type === 'fizzle')
    assert.ok(!fizzle, `${spell.id} fizzled: ${fizzle?.why}`)
    assert.ok(events.some((e) => e.type === 'land' && e.spell === spell.id), `${spell.id} never landed`)
  }
})

test('matches are deterministic for the same seed and orders', () => {
  const run = () => {
    const rules = tidyRules({ teams: [2, 2] })
    const match = new Match({ seed: 99, rules, roster: botRoster(rules) })
    const arena = new Arena(match)
    for (const mage of match.mages) arena.seat(mage.id, new Pilot({ seed: mage.slot * 7 + mage.team }))
    for (let i = 0; i < TICK_RATE * 40; i++) arena.step()
    return JSON.stringify(match.frame())
  }
  assert.equal(run(), run())
  assert.deepEqual(simulate({ seed: 3 }).results, simulate({ seed: 3 }).results)
})

test('bots finish matches of every shape', () => {
  for (const [teams, skill] of [[[1, 1], 'easy'], [[1, 1], 'hard'], [[2, 2], 'normal'], [[3, 2], 'normal'], [[4, 4], 'hard'], [[8, 8], 'normal']]) {
    const { match, results } = simulate({ seed: 21, rules: { teams, skill } })
    assert.equal(match.phase, 'over', `${teams} ${skill} did not finish`)
    assert.ok([0, 1, -1].includes(results.winner))
    assert.ok(results.mages.every((m) => m.casts > 3), `${teams} ${skill}: every bot casts`)
  }
})

test('a stronger bot beats a weaker one most of the time', () => {
  let wins = 0
  for (let seed = 1; seed <= 12; seed++) wins += simulate({ seed, rules: { teams: [1, 1] }, skills: ['hard', 'easy'] }).results.winner === 0 ? 1 : 0
  assert.ok(wins >= 8, `hard won ${wins} of 12`)
})

test('brains can be swapped, including async ones', async () => {
  const match = fightingMatch()
  useBook(match, [{ id: 'fire-bolt', sigil: ['star', 'wave'] }])
  const asked = []
  const slowBrain = {
    think(view) {
      asked.push(view.me)
      return Promise.resolve({ spell: 'fire-bolt', target: view.mages.find((m) => m.team !== 0).id })
    },
  }
  const arena = new Arena(match)
  arena.seat('t0s0', new Pilot({ brain: slowBrain, skill: 'hard' }))
  let landed = false
  for (let i = 0; i < TICK_RATE * 4 && !landed; i++) {
    landed = arena.step().some((e) => e.type === 'land' && e.mage === 't0s0')
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.ok(asked.length > 0 && landed, 'the async plan was typed and cast')
  const plan = new Brain({ skill: 'hard' }).think(match.view('t1s0'))
  assert.ok(plan === null || SPELL[plan.spell], 'the built-in brain returns a plan or waits')
})

test('a chord typed quickly casts faster', () => {
  const total = (gap) => {
    const match = fightingMatch()
    useBook(match, [{ id: 'fireball', sigil: ['star', 'wave', 'flame'] }])
    const events = []
    for (const key of ['up', 'star', 'wave', 'flame']) {
      match.receive({ type: 'press', mage: 't0s0', key })
      events.push(...wait(match, key === 'up' ? 1 : gap))
    }
    return events.find((e) => e.type === 'cast').total
  }
  const full = Math.round(SPELL.fireball.cast * TICK_RATE)
  assert.equal(total(8), full, 'keys 0.4s apart: the whole cast bar')
  assert.equal(total(1), Math.round(SPELL.fireball.cast * TIMING.quick * TICK_RATE), 'keys a tick apart: the shortest cast')
  assert.ok(total(4) < full && total(4) > total(1), 'in between, in between')
})

test('metamagic quickens, empowers, twins and extends, and costs more mana', () => {
  const cast = (keys, book) => {
    const match = fightingMatch({ teams: [2, 2] })
    useBook(match, book)
    return { match, events: play(match, 't0s0', keys, TICK_RATE * 3) }
  }
  const scorch = [{ id: 'scorch', sigil: ['star', 'wave'] }]
  const quick = cast(['up', 'meta', 'star', 'star', 'wave', 'flame'], [{ id: 'fireball', sigil: ['star', 'wave', 'flame'] }])
  assert.ok(!quick.events.some((e) => e.type === 'cast'), 'Quicken: no cast bar')
  assert.deepEqual(quick.events.find((e) => e.type === 'fire').metas, ['quicken'])
  const hitOn = (run, id) => run.events.filter((e) => e.type === 'hit' && e.from === 't0s0' && e.to === id).map((e) => e.amount)
  const plain = cast(['up', 'star', 'wave'], scorch)
  const strong = cast(['up', 'meta', 'flame', 'star', 'wave'], scorch)
  assert.deepEqual(hitOn(strong, 't1s0'), [Math.round(hitOn(plain, 't1s0')[0] * METAS.empower.power)], 'Empower: 40% more')
  const twin = cast(['up', 'meta', 'wave', 'star', 'wave'], scorch)
  assert.equal(hitOn(twin, 't1s1').length, 1, 'Twin: the mage beside the target is hit too')
  const long = cast(['up', 'meta', 'leaf', 'star', 'wave'], [{ id: 'corruption', sigil: ['star', 'wave'] }])
  assert.equal(long.events.find((e) => e.type === 'mark' && e.name === 'Corruption').time, 10 * 1.5 * TICK_RATE, 'Extend: half again as long')
  assert.equal(costOf(SPELL.fireball, ['quicken']), Math.ceil(SPELL.fireball.cost * 1.5))
  assert.equal(costOf(SPELL.fireball, ['quicken', 'twin']), Math.ceil(SPELL.fireball.cost * 1.5 * 2), 'stacked costs multiply')
  assert.ok(costOf(SPELL['life-tap'], ['empower']) > 0, 'shaping a free spell is not free')
  const spent = (keys) => {
    const match = fightingMatch({ teams: [2, 2] })
    useBook(match, scorch)
    play(match, 't0s0', keys)
    return Math.round(match.index.get('t0s0').manaMax - match.index.get('t0s0').mana)
  }
  assert.equal(spent(['up', 'meta', 'flame', 'star', 'wave']), costOf(SPELL.scorch, ['empower']), 'and the caster paid for it')
})

test('a ward turns a landing spell back on its caster; a missed ward rests; sure spells go through', () => {
  const match = fightingMatch()
  useBook(match, [{ id: 'scorch', sigil: ['star', 'wave'] }, { id: 'magic-missile', sigil: ['flame', 'leaf'] }])
  const me = match.index.get('t0s0')
  const foe = match.index.get('t1s0')
  /** The foe casts a chord at me; I raise my ward two ticks before it lands. */
  const incoming = (keys) => {
    const events = []
    for (const key of keys) events.push(...play(match, foe.id, [key]))
    while (!events.some((e) => e.type === 'fire')) events.push(...wait(match, 1))
    const fire = events.find((e) => e.type === 'fire')
    events.push(...wait(match, fire.land - match.tick - 2))
    return [...events, ...play(match, me.id, ['ward'], 6)]
  }
  const parried = incoming(['up', 'star', 'wave'])
  assert.ok(parried.some((e) => e.type === 'void' && e.why === 'parry'))
  assert.equal(me.life, me.lifeMax, 'the ward took it')
  assert.ok(foe.life < foe.lifeMax, 'and turned it on the caster')
  assert.equal(me.stats.parries, 1)
  assert.ok(me.ward.ready - match.tick <= TIMING.wardRefund * TICK_RATE, 'a parry readies the ward quickly')
  wait(match, TICK_RATE * 2)
  assert.ok(play(match, me.id, ['ward']).some((e) => e.type === 'ward'))
  assert.equal(me.ward.ready - match.tick, TIMING.wardCool * TICK_RATE, 'a ward with nothing to stop rests')
  assert.ok(!play(match, me.id, ['ward']).some((e) => e.type === 'ward'), 'and cannot go up again yet')
  wait(match, TIMING.wardCool * TICK_RATE)
  const missiles = incoming(['flame', 'leaf'])
  assert.ok(!missiles.some((e) => e.why === 'parry') && me.life < me.lifeMax, 'Magic Missile never misses, ward or not')
})

test('repeat stuns from foes diminish, then stop landing; a grace follows each stun', () => {
  const match = fightingMatch({ teams: [2, 2] })
  const [me, ally, foe] = ['t0s0', 't0s1', 't1s0'].map((id) => match.index.get(id))
  const stun = { time: 2, kind: 'bane', lock: 'stun', name: 'Stunned' }
  const land = (from = foe, def = stun) => {
    match.mark(from, me, def, {})
    return match.flush()
  }
  const total = (name = 'Stunned') => me.auras.find((a) => a.name === name)?.total ?? 0
  const grace = TIMING.grace * TICK_RATE
  land()
  assert.equal(total(), 40)
  wait(match, 40)
  assert.ok(land().some((e) => e.type === 'void' && e.why === 'resist'), 'a moment of grace after a stun ends')
  wait(match, grace)
  land()
  assert.equal(total(), 20, 'the second lands at half')
  wait(match, 20 + grace)
  land()
  assert.equal(total(), 10, 'the third at a quarter')
  wait(match, 10 + grace)
  assert.ok(land().some((e) => e.why === 'resist'), 'the fourth not at all')
  land(ally, { ...stun, name: 'Held' })
  assert.equal(total('Held'), 40, 'locks from your own side never diminish')
  land(foe, { time: 2, kind: 'bane', lock: 'hush', name: 'Silenced' })
  assert.equal(total('Silenced'), 40, 'silences keep their own count')
  wait(match, TIMING.fade * TICK_RATE + 40)
  land()
  assert.equal(total(), 40, 'after the fade window a stun lands in full again')
})

test('reactions: the right school on a foe’s bane hits harder, uses the bane up and adds a rider', () => {
  const match = fightingMatch({ teams: [2, 2] })
  useBook(match, [
    { id: 'scorch', sigil: ['star', 'wave'] },
    { id: 'thorn-whip', sigil: ['flame', 'leaf'] },
    { id: 'eldritch-blast', sigil: ['leaf', 'leaf'] },
  ])
  const [me, ally, foe, beside] = ['t0s0', 't0s1', 't1s0', 't1s1'].map((id) => match.index.get(id))
  match.mark(ally, foe, SPELL.frostbolt.acts[1].aura, { school: 'frost' })
  const melt = play(match, me.id, ['up', 'star', 'wave'], TICK_RATE)
  assert.equal(melt.find((e) => e.type === 'react')?.name, 'Melt')
  assert.equal(melt.find((e) => e.type === 'hit' && e.to === foe.id).amount, Math.round(SPELL.scorch.acts[0].amount * 1.5))
  assert.ok(!foe.auras.some((a) => a.school === 'frost'), 'the chill melted away')
  assert.equal(me.stats.combos, 1)
  match.mark(ally, foe, SPELL.fireball.acts[1].aura, { school: 'fire' })
  const wildfire = play(match, me.id, ['flame', 'leaf'], TICK_RATE)
  assert.equal(wildfire.find((e) => e.type === 'react')?.name, 'Wildfire')
  assert.ok(foe.auras.some((a) => a.name === 'Burning') && beside.auras.some((a) => a.name === 'Burning'), 'the fire spread beside it')
  match.mark(ally, foe, SPELL['guiding-bolt'].acts[1].aura, { school: 'holy' })
  const eclipse = play(match, me.id, ['leaf', 'leaf'], 4)
  assert.equal(eclipse.find((e) => e.type === 'react')?.name, 'Eclipse')
  assert.ok(foe.auras.some((a) => a.def.lock === 'hush'), 'Eclipse silences')
})

test('flow builds with clean casts, speeds and cheapens them, and breaks on a fizzle', () => {
  const match = fightingMatch()
  useBook(match, [
    { id: 'scorch', sigil: ['star', 'wave'] },
    { id: 'ice-lance', sigil: ['flame', 'leaf'] },
    { id: 'sacred-flame', sigil: ['leaf', 'leaf'] },
    { id: 'fireball', sigil: ['star', 'star', 'star'] },
  ])
  const me = match.index.get('t0s0')
  play(match, me.id, ['up', 'star', 'wave'], 10)
  play(match, me.id, ['flame', 'leaf'], 10)
  play(match, me.id, ['leaf', 'leaf'], 10)
  assert.equal(me.flow, 3)
  assert.ok(costOf(SPELL.fireball, [], 3) < SPELL.fireball.cost, 'flow makes spells cheaper')
  const cast = play(match, me.id, ['star', 'star', 'star'], TICK_RATE * 2)
  const begun = cast.find((e) => e.type === 'cast')
  const fired = cast.find((e) => e.type === 'fire')
  assert.ok(fired.tick - begun.tick < begun.total, 'and casts faster')
  assert.equal(me.flow, 4)
  play(match, me.id, ['wave', 'star'], TICK_RATE)
  assert.equal(me.flow, 0, 'a fizzle breaks the flow')
  me.flow = 3
  me.flowAt = match.tick
  wait(match, TIMING.flowFade * TICK_RATE)
  assert.equal(me.flow, 2, 'flow ebbs without casts')
  wait(match, 1.5 * TICK_RATE)
  assert.equal(me.flow, 1)
})

test('the aim sticks; ally spells aimed at a foe land on you; aim moves off a fallen foe', () => {
  const match = fightingMatch({ teams: [2, 2] })
  useBook(match, [{ id: 'scorch', sigil: ['star', 'wave'] }, { id: 'healing-word', sigil: ['flame', 'leaf'] }])
  const me = match.index.get('t0s0')
  me.life -= 200
  play(match, me.id, ['up', 'right', 'star', 'wave'], 10)
  assert.equal(me.aim, 't1s1')
  const healed = play(match, me.id, ['flame', 'leaf'], 10)
  assert.ok(healed.some((e) => e.type === 'mend' && e.to === me.id && e.amount > 0), 'a heal aimed at a foe lands on you')
  assert.equal(me.aim, 't1s1', 'and the aim stays put')
  match.hurt(null, match.index.get('t1s1'), 5000, { exact: true, pierce: true })
  assert.equal(me.aim, 't1s0', 'the aim moves off a fallen foe')
  play(match, me.id, ['down', 'right', 'down'])
  assert.equal(me.aim, me.id, 'down on your own row snaps home')
})

test('a call marks the aimed mage for the team only', () => {
  const match = fightingMatch({ teams: [2, 2] })
  const call = play(match, 't0s0', ['up', 'call']).find((e) => e.type === 'call')
  assert.deepEqual([call.target, call.only], ['t1s0', 0])
  assert.deepEqual(match.view('t0s1').call, { by: 't0s0', target: 't1s0' })
  assert.equal(match.view('t1s0').call, null, 'foes do not hear it')
})

test('the draft: whole chords pick and unpick; kits stay private; the fight starts when every kit is full', () => {
  const rules = tidyRules({ teams: [1, 1] })
  const match = new Match({ seed: 4, rules, roster: botRoster(rules) })
  const [me, foe] = match.mages
  const press = (mage, keys) => {
    for (const key of keys) match.receive({ type: 'press', mage: mage.id, key })
    match.advance()
    return match.flush()
  }
  const [first] = match.book
  assert.equal(press(me, first.sigil).find((e) => e.type === 'pick').only, 0, 'picks are told to the team only')
  assert.deepEqual(me.kit, [first.id])
  press(me, first.sigil)
  assert.deepEqual(me.kit, [], 'the same chord takes it out again')
  for (const entry of match.book.slice(0, rules.kit)) press(me, entry.sigil)
  assert.equal(me.kit.length, rules.kit)
  assert.equal(press(me, match.book[rules.kit].sigil).find((e) => e.type === 'fizzle')?.why, 'Kit is full')
  press(foe, [match.book[0].sigil[0]])
  assert.equal(match.frame(0).mages[1].chord.keys.length, 0, 'a foe’s draft chord is hidden')
  assert.equal(match.frame(1).mages[1].chord.keys.length, 1, 'but not from its own team')
  assert.deepEqual(Object.keys(match.kits(0)), [me.id])
  assert.equal(match.view(me.id).book.length, rules.kit, 'a brain sees its own kit')
  press(foe, ['drop'])
  for (const entry of match.book.slice(-rules.kit)) press(foe, entry.sigil)
  const full = match.tick
  wait(match, TIMING.early * TICK_RATE)
  assert.equal(match.phase, 'fight', 'full kits start the fight early')
  assert.ok(match.fightAt <= full + TIMING.early * TICK_RATE)
  assert.equal(match.surgeAt, match.fightAt + rules.surge * TICK_RATE)
  const idle = fightingMatch()
  for (const mage of idle.mages) {
    assert.equal(mage.kit.length, idle.rules.kit, 'an empty kit is filled when the fight begins')
    assert.ok(mage.kit.every((id) => idle.book.some((e) => e.id === id)))
    assert.equal(mage.kit.filter((id) => SPELL[id].kind === 'offense').length, idle.rules.kit / 2)
  }
})

test('the rift rewrites a quarter of the chords, keeping the book prefix-free', () => {
  const match = fightingMatch({ teams: [2, 2] })
  const me = match.index.get('t0s0')
  const before = match.book.map((e) => e.sigil.join())
  wait(match, match.shiftAt - match.tick - 1)
  match.receive({ type: 'press', mage: me.id, key: match.book.at(-1).sigil[0] })
  const shift = wait(match, 1).find((e) => e.type === 'shift')
  assert.equal(shift.changes.length, Math.round(match.book.length / 4))
  assert.equal(match.book.filter((e, i) => e.sigil.join() !== before[i]).length, shift.changes.length)
  assert.deepEqual(match.book.map((e) => e.sigil.length), before.map((s) => s.split(',').length))
  for (const entry of match.book) {
    for (const other of match.book) {
      if (other !== entry) assert.notEqual(other.sigil.slice(0, entry.sigil.length).join(), entry.sigil.join())
    }
  }
  assert.equal(me.chord.keys.length, 0, 'chords in progress are cleared')
  assert.ok(wait(match, match.surgeAt - match.tick).some((e) => e.type === 'shift'), 'and again when the surge begins')
})

test('a fallen mage casts wisp spells until revived', () => {
  const match = fightingMatch({ teams: [2, 2] })
  const [me, ally] = ['t0s0', 't0s1'].map((id) => match.index.get(id))
  ally.life = 300
  match.hurt(null, me, 5000, { exact: true, pierce: true })
  assert.ok(me.down)
  assert.deepEqual(match.usable(me).map((e) => e.id), WISPS.map((s) => s.id))
  const glimmer = match.wisps.find((e) => e.id === 'glimmer')
  const healed = play(match, me.id, ['right', ...glimmer.sigil], 4)
  assert.ok(healed.some((e) => e.type === 'mend' && e.from === me.id && e.to === ally.id && e.amount > 0), 'a wisp mends an ally')
  assert.ok(!play(match, me.id, ['ward']).some((e) => e.type === 'ward'), 'wisps cannot ward')
  match.apply([{ op: 'revive', share: 0.5 }], { from: ally, to: me })
  assert.ok(!me.down)
  assert.deepEqual(match.usable(me).map((e) => e.id), match.book.filter((e) => me.kit.includes(e.id)).map((e) => e.id))
})

test('bots draft, shape spells, parry, react and drift as wisps', () => {
  const rules = tidyRules({ teams: [4, 4], skill: 'hard' })
  const match = new Match({ seed: 5, rules, roster: botRoster(rules) })
  const arena = new Arena(match)
  for (const mage of match.mages) arena.seat(mage.id, new Pilot({ skill: 'hard', seed: mage.slot * 31 + mage.team }))
  const seen = { pick: 0, shaped: 0, parry: 0, react: 0, wisp: 0 }
  while (match.phase !== 'over' && match.tick < TICK_RATE * 400) {
    for (const e of arena.step()) {
      if (e.type === 'pick') seen.pick++
      if (e.type === 'fire' && e.metas.length) seen.shaped++
      if (e.type === 'void' && e.why === 'parry') seen.parry++
      if (e.type === 'react') seen.react++
      if (e.type === 'fire' && SPELL[e.spell].kind === 'wisp') seen.wisp++
    }
  }
  assert.equal(match.phase, 'over')
  for (const [what, count] of Object.entries(seen)) assert.ok(count > 0, `bots never did ${what}`)
  assert.ok(match.fightAt < TIMING.ready * TICK_RATE, 'bots fill their kits early')
})

test('the design document lists every spell', async () => {
  const design = await fs.readFile(new URL('./DESIGN.md', import.meta.url), 'utf8')
  for (const spell of CODEX) assert.ok(design.includes(`| ${spell.name} | ${spell.school} | ${spell.tier} |`), `DESIGN.md is missing ${spell.name}`)
  assert.ok(design.includes(`${CODEX.length} spells`), 'DESIGN.md states the spell count')
})

test('wire messages are checked field by field', () => {
  assert.deepEqual(unpack(pack('press', { key: 'star', seq: 3 })), { type: 'press', key: 'star', seq: 3 })
  for (const key of ['meta', 'ward', 'call', 'drop']) assert.equal(unpack(pack('press', { key, seq: 1 }))?.key, key)
  assert.equal(unpack(pack('press', { key: 'jump', seq: 3 })), null)
  assert.equal(unpack('not json'), null)
  assert.equal(unpack(pack('join', { code: 'AEIO' })), null, 'codes use consonants only')
  assert.deepEqual(unpack(pack('join', { code: 'bczd' })), { type: 'join', code: 'BCZD' })
  assert.equal(unpack(pack('hello', { name: '<script>' })).name, 'script')
  assert.equal(unpack(pack('hello', { name: 'Ana' })).garb, undefined, 'garb is optional')
  assert.deepEqual(unpack(pack('hello', { name: 'Ana', garb: { hat: 'hood', robe: 'gown' } })).garb, { hat: 'hood', robe: 'plain', staff: 'gem' }, 'and tidied, never refused')
  assert.equal(unpack(pack('frame', {})), null, 'peers cannot send host messages')
  assert.deepEqual(unpack(pack('tune', { rules: { teams: [3, 9] } })).rules.teams, [3, 8])
  assert.equal(unpack(pack('resume', { token: 'short' })), null)
  assert.equal(unpack(pack('resume', { token: 'abcdefghijklmnopqrstuv' })).token, 'abcdefghijklmnopqrstuv')
  assert.deepEqual(unpack(pack('frame', { delta: { tick: 3 }, events: [] }), 'host'), { type: 'frame', delta: { tick: 3 }, events: [] }, 'kits and the whole frame are optional')
})

test('garb is tidied, seeded and worn into the match; auras name the spell that put them there', () => {
  assert.deepEqual(tidyGarb(), { hat: GARB.hat[0], robe: GARB.robe[0], staff: GARB.staff[0] })
  assert.deepEqual(tidyGarb({ hat: 'hood', robe: 'gown', staff: 7 }), { hat: 'hood', robe: GARB.robe[0], staff: GARB.staff[0] })
  const seeded = Array.from({ length: 64 }, (_, i) => pickGarb(hashText(`bot:${i}`)))
  for (const garb of seeded) assert.deepEqual(tidyGarb(garb), garb, 'seeded garb is always valid')
  assert.ok(new Set(seeded.map((garb) => Object.values(garb).join('.'))).size > 32, 'and varied')
  assert.deepEqual(pickGarb(12345), pickGarb(12345), 'and repeatable')

  const roster = [{ name: 'Ana', team: 0, garb: { hat: 'wide', robe: 'split', staff: 'orb' } }, { name: 'Ben', team: 1, garb: 'cape' }]
  assert.deepEqual(new Match({ seed: 3, roster }).setup().roster.map((m) => m.garb), [{ hat: 'wide', robe: 'split', staff: 'orb' }, tidyGarb()])

  const match = fightingMatch()
  useBook(match, [{ id: 'fireball', sigil: ['star', 'wave', 'flame'] }])
  play(match, 't0s0', chordFor(match, 't0s0', 't1s0', 'fireball'), TICK_RATE * 3)
  const burning = match.frame().mages.find((m) => m.id === 't1s0').auras.find((a) => a.name === 'Burning')
  assert.equal(burning?.spell, 'fireball', 'the page reads an aura’s rules from its spell')
})

test('deltas rebuild every frame exactly and cost a fraction of whole frames', () => {
  // Objects, arrays, removed keys, type changes and null all survive a round trip through JSON.
  const cases = [
    [{ a: 1, b: [1, 2], c: { d: 1 } }, { a: 2, b: [1, 3], c: { e: 2 } }],
    [{ a: [1, 2] }, { a: [1, 2, 3] }],
    [{ a: [1] }, { a: { 0: 1 } }],
    [{ a: null }, { a: { b: 1 } }],
    [{ a: { b: 1 } }, { a: null }],
    [{ a: 1, b: undefined }, { b: 2 }],
    [null, { a: 1 }],
  ]
  for (const [prev, next] of cases) {
    const change = JSON.parse(JSON.stringify(diff(prev, next) ?? {}))
    assert.deepEqual(patch(prev, change), JSON.parse(JSON.stringify(next)))
  }
  assert.equal(diff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), undefined, 'nothing changed, nothing sent')
  const prev = { a: { b: 1 } }
  patch(prev, { a: { b: 2 } })
  assert.equal(prev.a.b, 1, 'patch leaves the old frame alone')

  for (const teams of [[1, 1], [4, 4]]) {
    const rules = tidyRules({ teams, life: 400, surge: 30 })
    const match = new Match({ seed: 11, rules, roster: botRoster(rules) })
    const arena = new Arena(match)
    for (const mage of match.mages) arena.seat(mage.id, new Pilot({ skill: 'hard', seed: hashText(`11:${mage.id}`) }))
    let last = null
    let client = null
    let [whole, sent] = [0, 0]
    while (match.phase !== 'over' && match.tick < TICK_RATE * 120) {
      arena.step()
      for (const team of [0, 1, null]) {
        const frame = match.frame(team)
        if (team !== 0) continue
        const wire = packFrame(frame)
        const text = JSON.stringify(diff(last, wire) ?? {})
        client = patch(client, JSON.parse(text))
        last = wire
        assert.deepEqual(unpackFrame(client), JSON.parse(JSON.stringify(frame)), `tick ${match.tick}`)
        whole += JSON.stringify(frame).length
        sent += text.length
      }
    }
    assert.ok(sent < whole * 0.15, `${teams.join('v')}: deltas are ${Math.round((sent / whole) * 100)}% of whole frames`)
  }
})

// ─── 2 · Host ───────────────────────────────────────────────────────────────

/**
 * A scripted WebSocket peer that records every message. Frames are rebuilt
 * from deltas the way the page does it, so each recorded frame is whole;
 * `raw` keeps them as they came.
 */
function connect(url) {
  const socket = new WebSocket(url.replace('http', 'ws') + '/wire')
  const inbox = []
  const raw = []
  const waiters = new Set()
  let wire = null
  let kits = {}
  socket.on('message', (data) => {
    let message = JSON.parse(data)
    if (message.type === 'frame') {
      raw.push(message)
      wire = message.frame ?? patch(wire, message.delta)
      kits = message.kits ?? kits
      message = { type: 'frame', frame: unpackFrame(wire), events: message.events, kits }
    }
    inbox.push(message)
    for (const waiter of waiters) {
      if (!waiter.match(message)) continue
      waiters.delete(waiter)
      waiter.resolve(message)
    }
  })
  const peer = {
    inbox,
    raw,
    socket,
    send: (type, body) => socket.send(pack(type, body)),
    next: (match, timeout = 8000) =>
      new Promise((resolve, reject) => {
        const found = inbox.find(match)
        if (found) return resolve(found)
        const waiter = { match, resolve }
        waiters.add(waiter)
        setTimeout(() => waiters.delete(waiter) && reject(new Error('timed out waiting for a message')), timeout).unref()
      }),
    close: () => socket.close(),
  }
  return new Promise((resolve) => socket.on('open', () => resolve(peer)))
}

test('rooms are hosted, joined by code and played over the wire', async () => {
  const host = await openHost({ port: 0, quiet: true })
  try {
    const ana = await connect(host.url)
    const ben = await connect(host.url)
    const garb = { hat: 'circlet', robe: 'mantle', staff: 'crook' }
    ana.send('hello', { name: 'Ana', garb })
    ben.send('hello', { name: 'Ben' })
    ana.send('open', { rules: { teams: [1, 1] } })
    const { room } = await ana.next((m) => m.type === 'room')
    assert.match(room.code, /^[A-Z]{4}$/)
    assert.deepEqual(room.seats[0][0].garb, garb, 'the lobby shows what each player wears')
    ben.send('join', { code: 'ZZZZ' })
    assert.match((await ben.next((m) => m.type === 'fault')).text, /No match/)
    ben.send('join', { code: room.code })
    const joined = await ben.next((m) => m.type === 'room' && m.room.seats[1][0].kind === 'human')
    assert.equal(joined.room.seats[1][0].name, 'Ben')
    ben.send('start')
    ana.send('tune', { rules: { teams: [2, 1], life: 500 } })
    await ana.next((m) => m.type === 'room' && m.room.rules.teams[0] === 2)
    ana.send('bench', { team: 0, slot: 1 })
    const bot = (await ana.next((m) => m.type === 'room' && m.room.seats[0][1]?.kind === 'bot')).room.seats[0][1]
    assert.deepEqual(tidyGarb(bot.garb), bot.garb, 'bots dress too')
    ana.send('start')
    const [beginA, beginB] = await Promise.all([ana.next((m) => m.type === 'begin'), ben.next((m) => m.type === 'begin')])
    assert.equal(beginA.setup.roster.length, 3, 'the bot took its seat')
    assert.deepEqual(beginA.setup.roster.map((m) => [m.name, m.garb]), [['Ana', garb], [bot.name, bot.garb], ['Ben', tidyGarb()]], 'everyone plays in the name and garb the lobby showed')
    assert.notEqual(beginA.you, beginB.you)
    assert.deepEqual(beginA.setup.book, beginB.setup.book, 'everyone reads the same book')
    // While drafting, a pick reaches your own team's frames and never a foe's.
    const entry = beginB.setup.book[0]
    entry.sigil.forEach((key, i) => ben.send('press', { key, seq: i + 1 }))
    await ben.next((m) => m.type === 'frame' && m.kits[beginB.you]?.includes(entry.id))
    const seen = await ana.next((m) => m.type === 'frame' && m.frame.mages.find((x) => x.id === beginB.you).seq === entry.sigil.length)
    assert.ok(!(beginB.you in seen.kits), 'a foe’s kit never reaches you')
    assert.ok(Object.keys(seen.kits).length > 0 && Object.keys(seen.kits).every((id) => id.startsWith(beginA.you.slice(0, 2))))
    assert.ok(!ana.inbox.some((m) => m.type === 'frame' && m.events.some((e) => e.type === 'pick' && e.mage === beginB.you)), 'nor its picks')
    await ben.next((m) => m.type === 'frame' && m.frame.phase === 'fight', 25000)
    ben.send('press', { key: 'up', seq: 10 })
    const pressed = await ben.next((m) => m.type === 'frame' && m.frame.mages.find((x) => x.id === beginB.you).seq === 10)
    assert.ok(pressed)
    ana.close()
    const end = await ben.next((m) => m.type === 'end', 60000)
    assert.ok([0, 1, -1].includes(end.results.winner))
    assert.ok(ben.raw[0].frame && ben.raw.slice(1).every((m) => m.delta && !m.frame), 'one whole frame, then deltas')
    assert.match(ben.socket.extensions, /permessage-deflate/, 'frames are compressed')
    ben.close()
  } finally {
    await host.close()
  }
})

/** Open a room for `peer` with `rules`, start it, and wait for the match to begin. */
async function startMatch(peer, rules) {
  peer.send('open', { rules })
  const { room } = await peer.next((m) => m.type === 'room')
  peer.send('start')
  const begin = await peer.next((m) => m.type === 'begin')
  await peer.next((m) => m.type === 'frame')
  return { code: room.code, begin }
}

test('the host survives malformed requests and a match that throws', async () => {
  const host = await openHost({ port: 0, quiet: true })
  try {
    for (const bad of ['/%E0%A4%A', '/%']) assert.equal((await fetch(host.url + bad)).status, 400)
    assert.equal((await fetch(host.url + '/health')).status, 200, 'still up')
    const ana = await connect(host.url)
    const ben = await connect(host.url)
    const broken = await startMatch(ana, { teams: [1, 1] })
    const steady = await startMatch(ben, { teams: [1, 1] })
    host.hall.rooms.get(broken.code).match.advance = () => {
      throw new Error('a bug in a spell')
    }
    assert.match((await ana.next((m) => m.type === 'fault')).text, /error/)
    await ana.next((m) => m.type === 'room' && m.room.phase === 'lobby')
    const tick = host.hall.rooms.get(steady.code).match.tick
    await ben.next((m) => m.type === 'frame' && m.frame.tick > tick + 5)
    ana.send('start')
    await ana.next((m) => m.type === 'begin' && m.setup.seed !== broken.begin.setup.seed)
    ana.close()
    ben.close()
  } finally {
    await host.close()
  }
})

test('a dropped player takes their seat back; a seat held too long goes to the bot', async () => {
  const host = await openHost({ port: 0, quiet: true, hold: 1500 })
  try {
    const ana = await connect(host.url)
    const { token, you } = await ana.next((m) => m.type === 'welcome')
    const { code, begin } = await startMatch(ana, { teams: [1, 1] })
    const room = host.hall.rooms.get(code)
    ana.socket.terminate()
    await until(() => room.arena.pilots.has(begin.you))
    assert.ok(room.peers.size === 1 && [...room.peers][0].away, 'the seat is held, with a bot standing in')

    // Back on a new socket: the same peer, the same mage, a whole frame to catch up, and keys work again.
    const again = await connect(host.url)
    again.send('resume', { token })
    assert.equal((await again.next((m) => m.type === 'back')).you, you)
    assert.equal((await again.next((m) => m.type === 'begin')).you, begin.you)
    await again.next((m) => m.type === 'frame')
    assert.ok(again.raw[0].frame, 'the first frame after a resume is whole')
    assert.ok(!room.arena.pilots.has(begin.you), 'the bot steps aside')
    again.send('press', { key: 'up', seq: 1 })
    await again.next((m) => m.type === 'frame' && m.frame.mages.find((x) => x.id === begin.you).seq >= 1)

    // A resume while the host still thinks the old socket is up takes the seat over and closes the old one.
    const third = await connect(host.url)
    const closed = new Promise((resolve) => again.socket.on('close', resolve))
    third.send('resume', { token })
    assert.equal((await third.next((m) => m.type === 'back')).you, you)
    await again.next((m) => m.type === 'moved')
    await closed

    // Unknown tokens get nothing; a seat held past its time is given up and the empty room closes.
    const stranger = await connect(host.url)
    stranger.send('resume', { token: 'abcdefghijklmnopqrstuv' })
    assert.equal((await stranger.next((m) => m.type === 'back')).you, null)
    third.socket.terminate()
    await until(() => !host.hall.rooms.has(code), 5000)
    const late = await connect(host.url)
    late.send('resume', { token })
    assert.equal((await late.next((m) => m.type === 'back')).you, null)
    for (const peer of [stranger, late]) peer.close()
  } finally {
    await host.close()
  }
})

test('a connection that stops answering pings is closed, and its seat held', async () => {
  const host = await openHost({ port: 0, quiet: true, beat: 60 })
  try {
    const ana = await connect(host.url)
    const { code } = await startMatch(ana, { teams: [1, 1] })
    // A socket that never answers pings, like a vanished phone.
    const ghost = new WebSocket(host.url.replace('http', 'ws') + '/wire', { autoPong: false })
    await new Promise((resolve) => ghost.on('open', resolve))
    ghost.send(pack('join', { code }))
    const room = host.hall.rooms.get(code)
    await until(() => room.peers.size === 2)
    await until(() => [...room.peers].some((peer) => peer.away))
    assert.equal(ghost.readyState, WebSocket.CLOSED)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal([...room.peers].filter((peer) => peer.away).length, 1)
    assert.equal(ana.socket.readyState, WebSocket.OPEN, 'a peer that answers stays')
    ana.close()
  } finally {
    await host.close()
  }
})

/** Wait until `check()` is true. */
async function until(check, timeout = 3000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for a condition')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

// ─── 3 · Views ──────────────────────────────────────────────────────────────

const KEYBOARD = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', star: 'KeyI', wave: 'KeyJ', flame: 'KeyL', leaf: 'KeyK', meta: 'KeyU', ward: 'Space', call: 'KeyE', drop: 'KeyQ' }
const GL_FLAGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

/** Pick a single-target offense spell with a cast bar from the page player's kit. */
async function offenseChord(page) {
  const { book, kit } = await page.evaluate(() => ({ book: window.chordcast.setup.book, kit: window.chordcast.kits[window.chordcast.me] ?? [] }))
  const mine = book.filter((e) => kit.includes(e.id))
  const pick = mine.find((e) => SPELL[e.id].kind === 'offense' && SPELL[e.id].aim === 'foe' && SPELL[e.id].cast > 0) ?? mine.find((e) => SPELL[e.id].aim === 'foe')
  return ['up', ...pick.sigil]
}

/**
 * Save a screenshot. Software WebGL plays at the lowest render tier, but the
 * picture is drawn at the top tier, as a desktop GPU would show it. Top-tier
 * frames are slow here, so `prepare` (if given) runs after the switch, right
 * before the picture: state that times out, like a chord, is still fresh.
 */
async function shoot(page, name, prepare = null, ready = null) {
  await page.waitForTimeout(250)
  const was = await page.evaluate(() => {
    const stage = window.chordcast.stage
    const was = { tier: stage.tier, pinned: stage.governor.pinned }
    stage.governor.pinned = true
    stage.setQuality(stage.tiers.length - 1)
    return was
  })
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  // Bots can stun or polymorph the player mid-chord, which clears it: try again a few times.
  for (let attempt = 0; prepare && attempt < 4; attempt++) {
    await prepare()
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    if (!ready || (await page.evaluate(ready))) break
  }
  await page.screenshot({ path: new URL(`${name}.png`, SHOTS).pathname })
  await page.evaluate(({ tier, pinned }) => {
    const stage = window.chordcast.stage
    stage.setQuality(tier)
    stage.governor.pinned = pinned
  }, was)
}

/**
 * Software WebGL is slow, so only the page being driven runs: the others
 * are frozen through the DevTools protocol and thawed when their turn comes.
 */
function makeStage(browser, errors) {
  const pages = []
  const sessions = new Map()
  return {
    async open(name, options) {
      const page = await (await browser.newContext(options)).newPage()
      page.setDefaultTimeout(60000)
      page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`))
      page.on('console', (message) => message.type() === 'error' && errors.push(`${name}: ${message.text()}`))
      sessions.set(page, await page.context().newCDPSession(page))
      pages.push(page)
      await this.focus(page)
      return page
    },
    async focus(page) {
      for (const other of pages) await sessions.get(other).send('Page.setWebLifecycleState', { state: other === page ? 'active' : 'frozen' })
    },
    async close(page) {
      pages.splice(pages.indexOf(page), 1)
      await page.context().close()
    },
  }
}

test('views: every essential screen renders and responds', { timeout: 900000 }, async () => {
  await fs.mkdir(SHOTS, { recursive: true })
  // Frozen pages stop reading their sockets, so they cannot answer pings: don't ping during this test.
  const host = await openHost({ port: 0, quiet: true, beat: 3600000 })
  const browser = await chromium.launch({ args: GL_FLAGS })
  const errors = []
  const stage = makeStage(browser, errors)
  const desk = { viewport: { width: 1280, height: 720 } }
  try {
    // Home and guide
    const ana = await stage.open('ana', desk)
    await ana.goto(host.url)
    await ana.fill('#name-input', 'Ana')
    await ana.waitForTimeout(2500)
    await shoot(ana, '01-home')
    await ana.click('.hero [data-open="guide"]')
    await shoot(ana, '02-guide')
    await ana.click('#guide [data-close]')

    // Lobby: host a match, then a friend joins by code
    await ana.click('#host-button')
    await ana.waitForSelector('body[data-view="lobby"]')
    const code = await ana.textContent('#room-code')
    assert.match(code, /^[A-Z]{4}$/)
    // Garb: a pick reaches the lobby at once, and the duel behind the card wears it under your marker
    await ana.click('[data-garb="hat"] [data-value="wide"]')
    await ana.click('[data-garb="staff"] [data-value="orb"]')
    await ana.waitForFunction(() => {
      const game = window.chordcast
      const garb = game.room.seats.flat().find((seat) => seat.id === game.you)?.garb
      const figure = game.stage.figure('d00')
      return garb?.hat === 'wide' && garb.staff === 'orb' && figure?.garb.hat === 'wide' && figure.garb.staff === 'orb' && game.stage.cursor.visible
    })
    await shoot(ana, '03-lobby')
    const ben = await stage.open('ben', desk)
    await ben.addInitScript(() => localStorage.setItem('chordcast.name', 'Ben'))
    await ben.goto(`${host.url}/?code=${code}`)
    await ben.waitForSelector('body[data-view="lobby"]')
    await stage.focus(ana)
    await ana.click('[data-rule="team0"] [data-step="1"]')
    await ana.waitForFunction(() => window.chordcast.room.rules.teams[0] === 2)
    await ana.click('[data-rule="team1"] [data-step="1"]')
    await ana.click('[data-rule="life"] [data-value="2000"]')
    await ana.waitForFunction(() => window.chordcast.room.rules.teams.join() === '2,2' && window.chordcast.room.rules.life === 2000)
    await ana.click('#seats-0 .seat.open .btn')
    await ana.waitForSelector('#seats-0 .seat.bot')
    await stage.focus(ben)
    await ben.waitForFunction(() => document.querySelectorAll('.seat.human').length === 2 && document.querySelectorAll('.seat.bot').length === 1)
    await shoot(ben, '04-lobby-joined')

    // Draft: the book opens wide before the fight; typing a chord or tapping a spell takes it
    await stage.focus(ana)
    await ana.click('#start-button')
    await ana.waitForSelector('body[data-view="match"][data-phase="ready"]')
    const book = await ana.evaluate(() => window.chordcast.setup.book)
    for (const key of book[0].sigil) await ana.keyboard.press(KEYBOARD[key])
    await ana.click('#book-defense .spell:nth-child(2)')
    await ana.click('#book-offense .spell:nth-child(3)')
    await ana.waitForFunction(() => (window.chordcast.kits[window.chordcast.me] ?? []).length === 3)
    const worn = await ana.evaluate(() => {
      const { stage, me } = window.chordcast
      return { garb: stage.figure(me).garb, focus: [stage.focus.me === me, stage.focus.fade] }
    })
    assert.deepEqual([worn.garb.hat, worn.garb.staff], ['wide', 'orb'], 'the garb is worn into the match')
    assert.deepEqual(worn.focus, [true, 0.9], 'in 2 vs 2, effects that do not touch you draw at 90%')
    await ana.waitForTimeout(300)
    await shoot(ana, '05-study')

    // Fight: type a chord on the keyboard, shaped with metamagic
    await ana.waitForSelector('body[data-phase="fight"]')
    await ana.waitForTimeout(600)
    const keys = await offenseChord(ana)
    const typed = () => window.chordcast.chordView().keys.length > 3
    await shoot(
      ana,
      '06-chord',
      async () => {
        await ana.waitForFunction(() => !window.chordcast.mine().lock && window.chordcast.serverTick() >= window.chordcast.mine().stagger)
        await ana.keyboard.press(KEYBOARD.drop)
        for (const key of [keys[0], 'meta', 'flame', ...keys.slice(1, -1)]) await ana.keyboard.press(KEYBOARD[key])
        await ana.waitForFunction(typed, null, { timeout: 5000 }).catch(() => {})
      },
      typed,
    )
    // Slow software rendering can outlast the chord timeout, so clear and type it whole. A stun
    // from a bot clears it too, so try again once it wears off.
    const cast = () => {
      const mine = window.chordcast.mine()
      return Boolean(mine.cast) || Object.keys(mine.cools).length > 0
    }
    for (let attempt = 0; attempt < 4 && !(await ana.evaluate(cast)); attempt++) {
      await ana.waitForFunction(() => !window.chordcast.mine().lock && window.chordcast.serverTick() >= window.chordcast.mine().stagger)
      await ana.keyboard.press(KEYBOARD.drop)
      for (const key of keys) await ana.keyboard.press(KEYBOARD[key])
      await ana.waitForFunction(cast, null, { timeout: 15000 }).catch(() => {})
    }
    await ana.waitForFunction(cast)
    await shoot(ana, '07-cast')
    await ana.waitForTimeout(4000)
    await shoot(ana, '08-battle')

    await ana.hover('#book-offense .spell:not(.out)')
    await shoot(ana, '09-book')

    // Sound: the audio starts with the first key, keys and spells play, the fight has music, and the speaker mutes it all.
    const heard = await ana.evaluate(() => ({ state: window.chordcast.sound.ctx?.state, played: window.chordcast.sound.played, music: window.chordcast.sound.track?.mode }))
    assert.deepEqual([heard.state, heard.music], ['running', 'fight'])
    assert.ok(heard.played > 5, `${heard.played} sounds played`)
    await ana.click('.topbar [data-action="sound"]')
    await ana.waitForFunction(() => document.body.classList.contains('muted') && window.chordcast.sound.ctx.state === 'suspended')
    await ana.click('.topbar [data-action="sound"]')
    await ana.waitForFunction(() => !document.body.classList.contains('muted') && window.chordcast.sound.ctx.state === 'running')

    // Gamepad: a stubbed pad drives the same chord keys
    await stage.focus(ben)
    await ben.evaluate(() => {
      const pad = { index: 0, id: 'Test pad', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }
      window.testPad = pad
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true })
    })
    const tap = async (button) => {
      await ben.evaluate((b) => (window.testPad.buttons[b].pressed = true), button)
      await ben.waitForFunction((b) => window.chordcast.pads.held.get(0)?.has(b), button)
      await ben.evaluate((b) => (window.testPad.buttons[b].pressed = false), button)
      await ben.waitForFunction((b) => !window.chordcast.pads.held.get(0)?.has(b), button)
    }
    await tap(12)
    await tap(3)
    await ben.waitForFunction(() => document.body.dataset.input === 'pad' && window.chordcast.seq >= 2)
    await shoot(ben, '10-gamepad')
    await stage.close(ben)

    // A reload mid-match takes the same seat back from the bot that held it.
    await stage.focus(ana)
    const seat = await ana.evaluate(() => window.chordcast.me)
    await ana.reload()
    // (A slow reload can outlast the match: then the results come back instead of frames.)
    await ana.waitForFunction((id) => window.chordcast.me === id && Boolean(window.chordcast.frame || window.chordcast.results), seat)

    // Results: a short, lopsided match ends quickly
    await stage.focus(ana)
    // Any leave button will do. (A match ending right now would cover the top bar's with the results.)
    await ana.locator('.topbar [data-action="leave"]').dispatchEvent('click')
    await ana.waitForSelector('body[data-view="home"]')
    await ana.click('#host-button')
    await ana.waitForSelector('body[data-view="lobby"]')
    await ana.evaluate(() => window.chordcast.link.send('tune', { rules: { ...window.chordcast.room.rules, life: 400, skill: 'hard', teams: [1, 2] } }))
    await ana.waitForFunction(() => window.chordcast.room.rules.life === 400)
    await ana.click('#start-button')
    await ana.waitForSelector('body[data-view="result"]', { timeout: 120000 })
    await ana.waitForTimeout(800)
    await shoot(ana, '11-result')
    await stage.close(ana)

    // A spectator waits on the home page while a phone plays
    const cat = await stage.open('cat', desk)
    await cat.goto(host.url)
    await cat.fill('#name-input', 'Cat')
    await cat.waitForTimeout(1500)

    // Touch: a phone plays a quick duel against an easy bot with the on-screen pads
    const phone = await stage.open('phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await phone.goto(host.url)
    await phone.fill('#name-input', 'Pip')
    await phone.waitForTimeout(1500)
    await shoot(phone, '12-phone-home')
    await phone.tap('#quick-skill [data-value="easy"]')
    await phone.tap('#quick-button')
    await phone.waitForSelector('body[data-phase="ready"]')
    await phone.waitForTimeout(1000)
    await shoot(phone, '13-phone-study')

    // Watching: the spectator joins by code while the phone studies. An idle
    // player can fall to the bot within 20 seconds, and slow software
    // rendering could let that pass before a later join.
    const duel = await phone.evaluate(() => window.chordcast.room.code)
    await stage.focus(cat)
    await cat.fill('#code-input', duel)
    await cat.click('#join-form button')
    await cat.waitForSelector('body.watching[data-view="match"]')

    await stage.focus(phone)
    await phone.waitForSelector('body[data-phase="fight"]')
    for (const key of await offenseChord(phone)) await phone.tap(`#pads [data-key="${key}"]`)
    await phone.waitForFunction(() => window.chordcast.seq >= 3)
    await phone.waitForTimeout(2500)
    await shoot(phone, '14-phone-fight')

    await stage.focus(cat)
    await cat.waitForSelector('body.watching[data-view="match"][data-phase="fight"]')
    await cat.waitForTimeout(2000)
    await shoot(cat, '15-watching')

    // A big fight: 8 vs 8, where effects that do not touch you fade to 40% and every mage's particles are capped
    await cat.locator('.topbar [data-action="leave"]').dispatchEvent('click')
    await cat.click('#host-button')
    await cat.waitForSelector('body[data-view="lobby"]')
    await cat.evaluate(() => window.chordcast.link.send('tune', { rules: { ...window.chordcast.room.rules, teams: [8, 8], life: 3000 } }))
    await cat.waitForFunction(() => window.chordcast.room.rules.teams.join() === '8,8')
    await cat.click('#start-button')
    await cat.waitForSelector('body[data-phase="fight"]', { timeout: 60000 })
    await cat.keyboard.press('Tab')
    const fought = await cat.evaluate(() => window.chordcast.stage.time)
    await cat.waitForFunction((at) => window.chordcast.stage.time > at + 3, fought, { timeout: 120000 })
    const focus = await cat.evaluate(() => ({ ...window.chordcast.stage.focus, budgets: null }))
    assert.deepEqual([focus.fade, focus.rate], [0.4, 337.5], 'sixteen mages: others fade to 40%, 337 particles a second each')
    assert.ok(focus.spent > 0, 'particles are charged to budgets')
    await shoot(cat, '16-big-fight')

    // Aura details: hovering a chip on a nameplate shows what the aura does and how long it has left
    await cat.waitForSelector('.plate-auras .aura', { timeout: 60000 })
    assert.ok(await cat.locator('.plate-auras .aura svg').count(), 'aura chips are icons')
    const hoverChip = async () => {
      // Plates can overlap in a big fight: hover a chip that is on top.
      const at = await cat.evaluate(() => {
        for (const chip of document.querySelectorAll('.plate-auras .aura')) {
          const box = chip.getBoundingClientRect()
          const [x, y] = [box.left + box.width / 2, box.top + box.height / 2]
          if (document.elementFromPoint(x, y)?.closest('.aura') === chip) return { x, y }
        }
        return null
      })
      if (at) await cat.mouse.move(at.x, at.y)
    }
    const tipOpen = () => !document.querySelector('#aura-tip').hidden && /s left/.test(document.querySelector('#aura-tip').textContent)
    await hoverChip()
    await cat.waitForFunction(tipOpen)
    await shoot(cat, '17-aura', hoverChip, tipOpen)

    assert.deepEqual(errors, [], 'no page errors')
  } finally {
    await browser.close()
    await host.close()
  }
})
