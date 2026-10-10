/**
 * host.mjs — the Chordcast host.
 *
 * Serves the page and its modules over HTTP and runs every room over one
 * WebSocket endpoint (/wire). The host is the single source of truth: it
 * advances each match in fixed ticks and sends the same frames to everyone,
 * so all players always see the same game.
 *
 *   1  Files   static files for the page
 *   2  Peers   one socket per browser tab
 *   3  Rooms   seats, rules and the match loop
 *   4  Hall    every room, found by code
 *   5  Boot    openHost() and the command line entry
 */

import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { Arena, Match, Pilot, CODE_LETTERS, RULES, TICK_MS, hashText, pack, tidyRules, unpack } from './core.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

// ─── 1 · Files ──────────────────────────────────────────────────────────────

const PAGES = { '/': 'page.html', '/page.html': 'page.html', '/page.css': 'page.css', '/page.mjs': 'page.mjs', '/core.mjs': 'core.mjs' }
const LIBS = { '/lib/three/': path.join(ROOT, 'node_modules', 'three') }
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }

/** Map a URL path to a file on disk, or null. Never leaves the allowed folders. */
function findFile(urlPath) {
  if (PAGES[urlPath]) return path.join(ROOT, PAGES[urlPath])
  for (const [prefix, base] of Object.entries(LIBS)) {
    if (!urlPath.startsWith(prefix)) continue
    const file = path.normalize(path.join(base, urlPath.slice(prefix.length)))
    const inside = ['build', 'examples'].some((dir) => file.startsWith(path.join(base, dir) + path.sep))
    return inside ? file : null
  }
  return null
}

async function serveFile(request, response) {
  const urlPath = decodeURIComponent(new URL(request.url, 'http://host').pathname)
  if (urlPath === '/health') return response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
  const file = findFile(urlPath)
  try {
    if (!file) throw new Error('not found')
    const body = await fs.readFile(file)
    response.writeHead(200, { 'content-type': `${TYPES[path.extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-cache' })
    response.end(body)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
  }
}

// ─── 2 · Peers ──────────────────────────────────────────────────────────────

const RATE_LIMIT = 60 // messages per second per peer

class Peer {
  constructor(socket, id) {
    this.socket = socket
    this.id = id
    this.name = 'Mage'
    this.room = null
    this.mage = null
    this.window = { start: Date.now(), count: 0 }
  }
  send(type, body) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(pack(type, body))
  }
  sendRaw(text) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(text)
  }
  /** False when this peer is sending too fast. */
  allow() {
    const now = Date.now()
    if (now - this.window.start > 1000) this.window = { start: now, count: 0 }
    return ++this.window.count <= RATE_LIMIT
  }
}

// ─── 3 · Rooms ──────────────────────────────────────────────────────────────

const BOT_NAMES = ['Ash', 'Brin', 'Cael', 'Dara', 'Esk', 'Fen', 'Grim', 'Hale', 'Ivo', 'Juno', 'Kip', 'Lark', 'Mira', 'Nox', 'Orin', 'Pell', 'Quill', 'Rook', 'Sable', 'Tam', 'Una', 'Vex', 'Wren', 'Yara']

const OPEN = Object.freeze({ kind: 'open' })
const BOT = Object.freeze({ kind: 'bot' })

class Room {
  constructor(hall, code, rules) {
    this.hall = hall
    this.code = code
    this.rules = tidyRules(rules)
    this.seats = [[], []]
    this.peers = new Set()
    this.owner = null
    this.phase = 'lobby' // lobby | match | after
    this.match = null
    this.arena = null
    this.results = null
    this.timer = null
    this.round = 0
    this.fitSeats()
  }

  // Seats ────────────────────────────────────────────────────────────────

  /** Resize both teams to the rules. Humans beyond the new size become watchers. */
  fitSeats() {
    this.seats = this.seats.map((team, t) => {
      const size = this.rules.teams[t]
      for (const seat of team.slice(size)) if (seat.kind === 'human') seat.peer.mage = null
      return Array.from({ length: size }, (_, slot) => team[slot] ?? OPEN)
    })
    for (const peer of this.peers) if (!this.seatOf(peer)) this.sitAnywhere(peer)
  }

  seatOf(peer) {
    for (const [team, seats] of this.seats.entries()) {
      const slot = seats.findIndex((seat) => seat.kind === 'human' && seat.peer === peer)
      if (slot >= 0) return { team, slot }
    }
    return null
  }

  /** Sit in the first open seat, on the team with fewer people. */
  sitAnywhere(peer) {
    const filled = this.seats.map((team) => team.filter((seat) => seat.kind === 'human').length)
    const order = filled[1] < filled[0] ? [1, 0] : [0, 1]
    for (const team of order) {
      const slot = this.seats[team].findIndex((seat) => seat.kind === 'open')
      if (slot < 0) continue
      this.seats[team][slot] = { kind: 'human', peer }
      return
    }
  }

  vacate(peer) {
    const seat = this.seatOf(peer)
    if (seat) this.seats[seat.team][seat.slot] = OPEN
  }

  // People ───────────────────────────────────────────────────────────────

  enter(peer) {
    this.peers.add(peer)
    peer.room = this
    this.owner ??= peer
    if (this.phase === 'lobby') this.sitAnywhere(peer)
    this.share()
    if (this.phase !== 'lobby' && this.match) {
      peer.send('begin', { setup: this.match.setup(), you: null })
      if (this.phase === 'after') peer.send('end', { results: this.results })
    }
  }

  exit(peer) {
    if (!this.peers.delete(peer)) return
    if (peer.mage && this.arena) this.arena.seat(peer.mage, this.makePilot(peer.mage))
    this.vacate(peer)
    peer.room = null
    peer.mage = null
    if (this.owner === peer) this.owner = [...this.peers][0] ?? null
    if (!this.peers.size) return this.close()
    this.share()
  }

  close() {
    clearInterval(this.timer)
    this.timer = null
    this.hall.rooms.delete(this.code)
  }

  // Lobby actions ────────────────────────────────────────────────────────

  seat(peer, team, slot) {
    if (this.phase !== 'lobby' || this.seats[team]?.[slot]?.kind !== 'open') return
    this.vacate(peer)
    this.seats[team][slot] = { kind: 'human', peer }
    this.share()
  }

  bench(peer, team, slot) {
    const seat = this.seats[team]?.[slot]
    if (peer !== this.owner || this.phase !== 'lobby' || !seat || seat.kind === 'human') return
    this.seats[team][slot] = seat.kind === 'bot' ? OPEN : BOT
    this.share()
  }

  tune(peer, rules) {
    if (peer !== this.owner || this.phase !== 'lobby') return
    this.rules = tidyRules(rules)
    this.fitSeats()
    this.share()
  }

  /** Lobby state for every peer. */
  share() {
    const seats = this.seats.map((team, t) =>
      team.map((seat, slot) => {
        if (seat.kind === 'human') return { kind: 'human', id: seat.peer.id, name: seat.peer.name }
        return { kind: seat.kind, name: seat.kind === 'bot' ? this.botName(t, slot) : null }
      }),
    )
    const seated = new Set(seats.flat().map((seat) => seat.id))
    const watchers = [...this.peers].filter((peer) => !seated.has(peer.id)).map((peer) => ({ id: peer.id, name: peer.name }))
    const room = { code: this.code, owner: this.owner?.id ?? null, phase: this.phase, rules: this.rules, seats, watchers }
    for (const peer of this.peers) peer.send('room', { room })
  }

  botName(team, slot) {
    return BOT_NAMES[hashText(`${this.code}:${this.round}:${team}:${slot}`) % BOT_NAMES.length]
  }

  // The match ────────────────────────────────────────────────────────────

  makePilot(mageId) {
    return new Pilot({ skill: this.rules.skill, seed: hashText(`${this.match.seed}:${mageId}`) })
  }

  start(peer) {
    if (peer !== this.owner || this.phase === 'match') return
    clearInterval(this.timer)
    this.round++
    const roster = this.seats.flatMap((team, t) =>
      team.map((seat, slot) => {
        const human = seat.kind === 'human'
        return { id: `t${t}s${slot}`, team: t, slot, bot: !human, name: human ? seat.peer.name : this.botName(t, slot), peer: human ? seat.peer : null }
      }),
    )
    this.match = new Match({ seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0, rules: this.rules, roster })
    this.arena = new Arena(this.match)
    for (const peer of this.peers) peer.mage = null
    for (const entry of roster) {
      if (entry.peer) entry.peer.mage = entry.id
      else this.arena.seat(entry.id, this.makePilot(entry.id))
    }
    this.phase = 'match'
    this.results = null
    this.share()
    const setup = this.match.setup()
    for (const peer of this.peers) peer.send('begin', { setup, you: peer.mage })
    this.due = performance.now()
    this.timer = setInterval(() => this.loop(), TICK_MS / 2)
  }

  /**
   * Advance whole ticks that are due, then send one frame with all their
   * events. Each team gets its own copy: its kits, its draft chords and its
   * private events (picks, calls). Watchers see only what is public.
   */
  loop() {
    const now = performance.now()
    if (now - this.due > TICK_MS * 10) this.due = now - TICK_MS * 10
    const events = []
    while (this.due <= now && this.match.phase !== 'over') {
      events.push(...this.arena.step())
      this.due += TICK_MS
    }
    if (!events.length && this.lastTick === this.match.tick) return
    this.lastTick = this.match.tick
    const texts = new Map()
    for (const team of [0, 1, null]) {
      const seen = events.filter((event) => event.only === undefined || event.only === team)
      const kits = team === null ? {} : this.match.kits(team)
      texts.set(team, pack('frame', { frame: this.match.frame(team), events: seen, kits }))
    }
    for (const peer of this.peers) peer.sendRaw(texts.get(this.teamOf(peer)))
    if (this.match.phase === 'over') this.finish()
  }

  /** The team a peer plays on in the current match, or null when watching. */
  teamOf(peer) {
    return (peer.mage && this.match?.index.get(peer.mage)?.team) ?? null
  }

  finish() {
    clearInterval(this.timer)
    this.timer = null
    this.phase = 'after'
    this.results = this.match.results()
    for (const peer of this.peers) peer.send('end', { results: this.results })
    this.share()
  }

  press(peer, key, seq) {
    if (this.phase === 'match' && peer.mage) this.match.receive({ type: 'press', mage: peer.mage, key, seq })
  }

  backToLobby(peer) {
    if (peer !== this.owner || this.phase !== 'after') return
    this.phase = 'lobby'
    this.match = null
    this.arena = null
    for (const watcher of this.peers) if (!this.seatOf(watcher)) this.sitAnywhere(watcher)
    this.share()
  }
}

// ─── 4 · Hall ───────────────────────────────────────────────────────────────

const MAX_ROOMS = 500

class Hall {
  constructor() {
    this.rooms = new Map()
    this.count = 0
  }

  newCode() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('')
      if (!this.rooms.has(code)) return code
    }
    return null
  }

  open(rules) {
    const code = this.rooms.size < MAX_ROOMS ? this.newCode() : null
    if (!code) return null
    const room = new Room(this, code, rules ?? RULES)
    this.rooms.set(code, room)
    return room
  }

  welcome(socket) {
    const peer = new Peer(socket, `p${(++this.count).toString(36)}`)
    peer.send('welcome', { you: peer.id })
    socket.on('message', (data) => {
      if (!peer.allow()) return
      const message = unpack(String(data), 'peer')
      if (message) this.route(peer, message)
    })
    socket.on('close', () => peer.room?.exit(peer))
    socket.on('error', () => socket.terminate())
  }

  /** Route one checked message from a peer to its handler. */
  route(peer, message) {
    const room = peer.room
    switch (message.type) {
      case 'hello':
        peer.name = message.name
        return room?.share()
      case 'open': {
        room?.exit(peer)
        const fresh = this.open(message.rules)
        return fresh ? fresh.enter(peer) : peer.send('fault', { text: 'The host is full. Try again soon.' })
      }
      case 'join': {
        const target = this.rooms.get(message.code)
        if (!target) return peer.send('fault', { text: `No match with code ${message.code}.` })
        if (target === room) return room.share()
        room?.exit(peer)
        return target.enter(peer)
      }
      case 'leave':
        return room?.exit(peer)
      case 'seat':
        return room?.seat(peer, message.team, message.slot)
      case 'bench':
        return room?.bench(peer, message.team, message.slot)
      case 'tune':
        return room?.tune(peer, message.rules)
      case 'start':
      case 'again':
        return room?.start(peer)
      case 'lobby':
        return room?.backToLobby(peer)
      case 'press':
        return room?.press(peer, message.key, message.seq)
    }
  }
}

// ─── 5 · Boot ───────────────────────────────────────────────────────────────

/** Start the host. Resolves to { port, url, hall, close() }. */
export async function openHost({ port = Number(process.env.PORT) || 8080, quiet = false } = {}) {
  const hall = new Hall()
  const server = http.createServer(serveFile)
  const wire = new WebSocketServer({ server, path: '/wire', maxPayload: 4096 })
  wire.on('connection', (socket) => hall.welcome(socket))
  await new Promise((resolve) => server.listen(port, resolve))
  const actual = server.address().port
  const url = `http://localhost:${actual}`
  if (!quiet) console.log(`Chordcast is live at ${url}`)
  const close = () =>
    new Promise((resolve) => {
      for (const room of hall.rooms.values()) room.close()
      for (const socket of wire.clients) socket.terminate()
      wire.close()
      server.close(resolve)
    })
  return { port: actual, url, hall, close }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) openHost()
