/**
 * test.mjs — Chordcast tests. Run with `npm test`.
 *
 *   1  Core    rules, book, chords, every spell, determinism and bots
 *   2  Host    rooms, codes and matches over the wire
 *   3  Views   a Playwright run through every essential screen; the
 *              screenshots are written to shots/ and committed
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import WebSocket from 'ws'
import { chromium } from 'playwright'
import {
  Arena, Brain, CODEX, Dice, KINDS, Match, Pilot, RULES, SCHOOLS, SPELL, TICK_RATE,
  botRoster, moveCursor, pack, pathTo, readRunes, simulate, splitTiers, tidyRules, unpack, writeBook,
} from './core.mjs'
import { openHost } from './host.mjs'

const SHOTS = new URL('./shots/', import.meta.url)

// ─── Helpers ────────────────────────────────────────────────────────────────

/** A fresh match already in the fight phase. */
function fightingMatch({ teams = [1, 1], seed = 7, life = 800 } = {}) {
  const rules = tidyRules({ teams, life })
  const match = new Match({ seed, rules, roster: botRoster(rules) })
  while (match.phase !== 'fight') match.advance()
  match.flush()
  return match
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
  const moves = SPELL[spellId].aim === 'self' ? [] : pathTo(match.mages, team, caster, target)
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
  assert.equal(rules.book, 8)
  assert.equal(rules.life, RULES.life)
  assert.equal(rules.surge, 20)
  assert.equal(rules.skill, RULES.skill)
})

test('books are balanced, prefix-free and seeded', () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const size of [8, 12, 16, 20]) {
      const book = writeBook(new Dice(seed), size, [2, 2])
      assert.equal(book.length, size)
      for (const kind of KINDS) assert.equal(book.filter((e) => SPELL[e.id].kind === kind).length, size / 2)
      const tiers = splitTiers(size / 2)
      for (const tier of [1, 2, 3]) assert.equal(book.filter((e) => SPELL[e.id].tier === tier).length, tiers[tier] * 2)
      for (const entry of book) {
        assert.equal(entry.sigil.length, SPELL[entry.id].tier + 1)
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

test('runes read as whole, open or dead', () => {
  const book = [{ id: 'fire-bolt', sigil: ['star', 'wave'] }, { id: 'fireball', sigil: ['flame', 'leaf', 'star'] }]
  assert.equal(readRunes(book, ['star', 'wave']).id, 'fire-bolt')
  assert.equal(readRunes(book, ['flame', 'leaf']), 'open')
  assert.equal(readRunes(book, ['leaf']), null)
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
})

test('a chord aims, casts, flies and lands', () => {
  const match = fightingMatch()
  match.book = [{ id: 'fireball', sigil: ['star', 'wave', 'flame'] }]
  const events = play(match, 't0s0', ['up', 'star', 'wave', 'flame'], TICK_RATE * 3)
  const types = events.map((e) => e.type)
  for (const type of ['cast', 'fire', 'land', 'hit', 'mark']) assert.ok(types.includes(type), `missing ${type}`)
  const foe = match.index.get('t1s0')
  assert.ok(foe.life < foe.lifeMax)
  assert.ok(match.index.get('t0s0').mana < 100)
})

test('wrong chords, targets, cooldowns and silences fizzle', () => {
  const match = fightingMatch()
  match.book = [
    { id: 'scorch', sigil: ['star', 'wave'] },
    { id: 'healing-word', sigil: ['flame', 'leaf'] },
  ]
  const why = (keys) => play(match, 't0s0', keys, TICK_RATE).find((e) => e.type === 'fizzle')?.why
  assert.equal(why(['leaf']), 'Unknown chord')
  assert.equal(why(['star', 'wave']), 'Needs a foe', 'offense on yourself')
  assert.equal(why(['up', 'flame', 'leaf']), 'Needs an ally', 'defense on a foe')
  assert.equal(why(['up', 'star', 'wave']), undefined, 'scorch lands')
  assert.equal(why(['up', 'star', 'wave']), 'Not ready')
  match.mark(null, match.index.get('t0s0'), { time: 3, kind: 'bane', lock: 'hush', name: 'Silenced' }, {})
  assert.equal(why(['flame', 'leaf']), 'Silenced')
})

test('stuns block keys and break casts; drop cancels', () => {
  const match = fightingMatch()
  match.book = [{ id: 'greater-heal', sigil: ['star', 'star', 'star', 'star'] }]
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
    match.book = [{ id: spell, sigil: ['star', 'wave', 'flame'] }]
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
    match.book = [{ id: spell.id, sigil: ['star', 'wave', 'flame', 'leaf'].slice(0, spell.tier + 1) }]
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
  for (const [teams, skill] of [[[1, 1], 'easy'], [[1, 1], 'hard'], [[2, 2], 'normal'], [[3, 2], 'normal'], [[4, 4], 'hard']]) {
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
  match.book = [{ id: 'fire-bolt', sigil: ['star', 'wave'] }]
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

test('the design document lists every spell', async () => {
  const design = await fs.readFile(new URL('./DESIGN.md', import.meta.url), 'utf8')
  for (const spell of CODEX) assert.ok(design.includes(`| ${spell.name} | ${spell.school} | ${spell.tier} |`), `DESIGN.md is missing ${spell.name}`)
  assert.ok(design.includes(`${CODEX.length} spells`), 'DESIGN.md states the spell count')
})

test('wire messages are checked field by field', () => {
  assert.deepEqual(unpack(pack('press', { key: 'star', seq: 3 })), { type: 'press', key: 'star', seq: 3 })
  assert.equal(unpack(pack('press', { key: 'jump', seq: 3 })), null)
  assert.equal(unpack('not json'), null)
  assert.equal(unpack(pack('join', { code: 'AEIO' })), null, 'codes use consonants only')
  assert.deepEqual(unpack(pack('join', { code: 'bczd' })), { type: 'join', code: 'BCZD' })
  assert.equal(unpack(pack('hello', { name: '<script>' })).name, 'script')
  assert.equal(unpack(pack('frame', {})), null, 'peers cannot send host messages')
  assert.deepEqual(unpack(pack('tune', { rules: { teams: [3, 9] } })).rules.teams, [3, 8])
})

// ─── 2 · Host ───────────────────────────────────────────────────────────────

/** A scripted WebSocket peer that records every message. */
function connect(url) {
  const socket = new WebSocket(url.replace('http', 'ws') + '/wire')
  const inbox = []
  const waiters = new Set()
  socket.on('message', (data) => {
    const message = JSON.parse(data)
    inbox.push(message)
    for (const waiter of waiters) {
      if (!waiter.match(message)) continue
      waiters.delete(waiter)
      waiter.resolve(message)
    }
  })
  const peer = {
    inbox,
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
    ana.send('hello', { name: 'Ana' })
    ben.send('hello', { name: 'Ben' })
    ana.send('open', { rules: { teams: [1, 1] } })
    const { room } = await ana.next((m) => m.type === 'room')
    assert.match(room.code, /^[A-Z]{4}$/)
    ben.send('join', { code: 'ZZZZ' })
    assert.match((await ben.next((m) => m.type === 'fault')).text, /No match/)
    ben.send('join', { code: room.code })
    const joined = await ben.next((m) => m.type === 'room' && m.room.seats[1][0].kind === 'human')
    assert.equal(joined.room.seats[1][0].name, 'Ben')
    ben.send('start')
    ana.send('tune', { rules: { teams: [2, 1], life: 500 } })
    await ana.next((m) => m.type === 'room' && m.room.rules.teams[0] === 2)
    ana.send('start')
    const [beginA, beginB] = await Promise.all([ana.next((m) => m.type === 'begin'), ben.next((m) => m.type === 'begin')])
    assert.equal(beginA.setup.roster.length, 3, 'the open seat was filled by a bot')
    assert.notEqual(beginA.you, beginB.you)
    assert.deepEqual(beginA.setup.book, beginB.setup.book, 'everyone reads the same book')
    await ben.next((m) => m.type === 'frame' && m.frame.phase === 'fight', 12000)
    ben.send('press', { key: 'up', seq: 1 })
    const pressed = await ben.next((m) => m.type === 'frame' && m.frame.mages.find((x) => x.id === beginB.you).seq === 1)
    assert.ok(pressed)
    ana.close()
    const end = await ben.next((m) => m.type === 'end', 60000)
    assert.ok([0, 1, -1].includes(end.results.winner))
    ben.close()
  } finally {
    await host.close()
  }
})

// ─── 3 · Views ──────────────────────────────────────────────────────────────

const KEYBOARD = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', star: 'KeyI', wave: 'KeyJ', flame: 'KeyL', leaf: 'KeyK', drop: 'Space' }
const GL_FLAGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

/** Pick a single-target offense spell with a cast bar from the page's book. */
async function offenseChord(page) {
  const book = await page.evaluate(() => window.chordcast.setup.book)
  const pick = book.find((e) => SPELL[e.id].kind === 'offense' && SPELL[e.id].aim === 'foe' && SPELL[e.id].cast > 0) ?? book.find((e) => SPELL[e.id].aim === 'foe')
  return ['up', ...pick.sigil]
}

/**
 * Save a screenshot. Software WebGL plays at the lowest render tier, but the
 * picture is drawn at the top tier, as a desktop GPU would show it.
 */
async function shoot(page, name) {
  await page.waitForTimeout(250)
  const was = await page.evaluate(() => {
    const stage = window.chordcast.stage
    const was = { tier: stage.tier, pinned: stage.governor.pinned }
    stage.governor.pinned = true
    stage.setQuality(stage.tiers.length - 1)
    return was
  })
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
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

test('views: every essential screen renders and responds', { timeout: 600000 }, async () => {
  await fs.mkdir(SHOTS, { recursive: true })
  const host = await openHost({ port: 0, quiet: true })
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

    // Study: the book opens wide before the fight
    await stage.focus(ana)
    await ana.click('#start-button')
    await ana.waitForSelector('body[data-view="match"][data-phase="ready"]')
    await ana.waitForTimeout(1200)
    await shoot(ana, '05-study')

    // Fight: type a chord on the keyboard
    await ana.waitForSelector('body[data-phase="fight"]')
    await ana.waitForTimeout(600)
    const keys = await offenseChord(ana)
    for (const key of keys.slice(0, -1)) await ana.keyboard.press(KEYBOARD[key])
    await ana.waitForFunction(() => window.chordcast.chordView().keys.length + window.chordcast.chordView().pending.length > 1)
    await ana.waitForTimeout(1000)
    await shoot(ana, '06-chord')
    // Slow software rendering can outlast the chord timeout, so clear and type it whole.
    await ana.keyboard.press(KEYBOARD.drop)
    for (const key of keys) await ana.keyboard.press(KEYBOARD[key])
    await ana.waitForFunction(() => {
      const mine = window.chordcast.mine()
      return Boolean(mine.cast) || Object.keys(mine.cools).length > 0
    })
    await shoot(ana, '07-cast')
    await ana.waitForTimeout(4000)
    await shoot(ana, '08-battle')
    await ana.hover('#book-offense .spell')
    await shoot(ana, '09-book')

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

    // Results: a short, lopsided match ends quickly
    await stage.focus(ana)
    await ana.locator('[data-action="leave"]:visible').first().click()
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

    assert.deepEqual(errors, [], 'no page errors')
  } finally {
    await browser.close()
    await host.close()
  }
})
