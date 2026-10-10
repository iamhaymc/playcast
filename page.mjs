/**
 * page.mjs — the Chordcast page.
 *
 * Renders what the host says is true and turns input into `press` messages.
 * Game rules live in core.mjs; this file only draws, listens and sends.
 *
 *    1  Kit      DOM helpers, glyphs, palettes and textures
 *    2  Link     the message link to the host
 *    3  Pads     keyboard, gamepad and touch become keys
 *    4  Sparks   the GPU particle system
 *    5  Rings    glowing rings on the floor and ribbon bolts in the air
 *    6  Looks    particle recipes for schools and statuses
 *    7  Figure   one mage: model, motion and status visuals
 *    8  Flight   one spell in the air
 *    9  Stage    scene, camera, world and the render loop
 *   10  Plates   nameplates and floating numbers
 *   11  Hud      clock, banner, book, chord tray, ward and flow
 *   12  Views    home, lobby and results screens
 *   13  Game     client state: messages in, effects out
 *   14  Boot
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  AIM_TEXT, CODEX, DIMINISH, LAYOUT, METAS, META_OF_RUNE, MOVES, REACTIONS, RULES, RUNES, SPELL, TEAMS, TICK_MS, TICK_RATE, TIMING,
  costOf, dampenAt, moveCursor, pack, place, reactionOn, readChord, readRunes, walkActs,
} from '/core.mjs'

// ─── 1 · Kit ────────────────────────────────────────────────────────────────

const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]
const rand = (low, high) => low + Math.random() * (high - low)
const pickOne = (list) => list[Math.floor(Math.random() * list.length)]
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const ease = (t) => 1 - Math.pow(1 - t, 3)

/** Write text or markup only when it changed, so steady frames leave the DOM alone. */
const written = new WeakMap()
function setText(el, text) {
  text = String(text)
  if (written.get(el) !== text) el.textContent = text
  written.set(el, text)
}
function setHtml(el, html) {
  if (written.get(el) !== html) el.innerHTML = html
  written.set(el, html)
}

function make(tag, className = '', html = '') {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (html) el.innerHTML = html
  return el
}

/** localStorage that never throws. */
const memory = {
  get(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* storage blocked: fine */
    }
  },
}

const stroke = (d, width = 2.4) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`

const GLYPHS = {
  star: '<path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6-2.6 7.9-2.6-7.9L1.5 12l7.9-2.6z" fill="currentColor"/>',
  wave: stroke('M2.5 9c3-3.6 6.2-3.6 9.5 0s6.5 3.6 9.5 0M2.5 16c3-3.6 6.2-3.6 9.5 0s6.5 3.6 9.5 0', 2.6),
  flame: '<path d="M12 1.6c1.3 4.3 7 6.4 7 12.4a7 7 0 0 1-14 0c0-3 1.5-5.1 3.4-6.7.2 2.3 1.1 3.7 2.7 4.2-.6-3.7.2-6.9.9-9.9z" fill="currentColor"/>',
  leaf: '<path d="M4 20.5C4 10.5 10 3.6 21 3c-.4 11.2-7.1 17.5-17 17.5z" fill="currentColor"/><path d="M4.5 20L14 10.5" stroke="#0b0820" stroke-width="1.7" stroke-linecap="round"/>',
  up: stroke('M5 15.5l7-7 7 7', 3),
  down: stroke('M5 8.5l7 7 7-7', 3),
  left: stroke('M15.5 5l-7 7 7 7', 3),
  right: stroke('M8.5 5l7 7-7 7', 3),
  close: stroke('M6.5 6.5l11 11M17.5 6.5l-11 11', 2.4),
  meta: '<path d="M12 2.5l1.6 5.2 5.2-2.3-2.3 5.2 5.2 1.6-5.2 1.6 2.3 5.2-5.2-2.3L12 21.5l-1.6-5.2-5.2 2.3 2.3-5.2L2.3 12l5.2-1.6-2.3-5.2 5.2 2.3z" fill="currentColor"/>',
  ward: '<path d="M12 2.2l8 3v6.1c0 5-3.4 8.9-8 10.5-4.6-1.6-8-5.5-8-10.5V5.2z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 6.5v10M8 10.5h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  call: stroke('M5 21V3.5M5 4h11.5l-2.4 4 2.4 4H5', 2.2),
  book: stroke('M3 5.5c3-1.5 6-1.5 9 .5 3-2 6-2 9-.5v13c-3-1.5-6-1.5-9 .5-3-2-6-2-9-.5zM12 6v13.5', 1.9),
  help: stroke('M9.2 9.2a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1.2-1.4 2.2M12 17.6v.1', 2.2) + '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  keys: stroke('M3 7h18v11H3zM7 11h.01M11 11h.01M15 11h.01M8 14.5h8', 1.8),
  pad: stroke('M7 8h10a4 4 0 0 1 4 4.5l-.6 3.6a2.5 2.5 0 0 1-4.4 1.1L14.5 15h-5L8 17.2a2.5 2.5 0 0 1-4.4-1.1L3 12.5A4 4 0 0 1 7 8zM8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01', 1.7),
  touch: stroke('M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.9-2.6L4.6 15a1.5 1.5 0 0 1 2.4-1.8L9 15', 1.7),
}

const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name] ?? ''}</svg>`

/** Fill every empty [data-glyph] element with its SVG. */
function paintGlyphs(root = document) {
  for (const el of root.querySelectorAll('[data-glyph]')) if (!el.firstElementChild) el.innerHTML = svg(el.dataset.glyph)
}

/** Key labels for each input mode. */
const LABELS = {
  keys: { up: 'W', left: 'A', right: 'D', down: 'S', star: 'I', wave: 'J', flame: 'L', leaf: 'K', meta: 'U', ward: '␣', call: 'E', drop: 'Q' },
  pad: { up: '↑', left: '←', right: '→', down: '↓', star: 'Y', wave: 'X', flame: 'B', leaf: 'A', meta: 'RB', ward: 'RT', call: 'LT', drop: 'LB' },
  touch: {},
}

let inputMode = 'keys'

/** A key chip: a rune, a move or the meta glyph, labeled for the current input mode. */
function keyChip(key, extra = '') {
  const kind = RUNES.includes(key) ? `rune ${key}` : key === 'meta' ? 'meta' : 'move'
  const label = LABELS[inputMode][key]
  return `<span class="key ${kind} ${extra}" data-glyph="${key}"${label ? ` data-label="${label}"` : ''}>${svg(key)}</span>`
}

/** A metamagic chip: its name in its rune's color. */
function metaChip(id, extra = '') {
  return `<span class="meta-chip ${METAS[id].rune} ${extra}" title="${METAS[id].text}">${svg('meta')}${METAS[id].name}</span>`
}

/** Rune glyphs for a chord, as the book and plates show them. */
const sigilHtml = (sigil) => sigil.map((rune) => `<i data-glyph="${rune}" class="${rune}">${svg(rune)}</i>`).join('')

const TEAM_GLOW = ['#3ee6ff', '#ff4fb8']
const TEAM_ROBE = ['#16607e', '#7c1d5c']

/**
 * Spell schools. Each owns a hue around the color wheel (hot core, main and
 * deep shade, never plain white), the shapes its particles take and which
 * way they drift (lift: fire rises, frost falls), so a spell's school reads
 * from color, shape and motion alike. HEADS, FLOURISH and SIGILS add its
 * head in flight, its mark on a hit and its casting circle. `smoke` and
 * `mist` are drawn with normal blending, so they stay dark or pale instead
 * of adding up to white.
 */
const SCHOOL_LOOK = {
  fire: { hot: '#ffd25e', main: '#ff6414', deep: '#d81c04', smoke: '#2b0c04', body: 'flame', bit: 'spark', lift: 2.6 },
  frost: { hot: '#d8f6ff', main: '#5cc8ff', deep: '#1f5cff', mist: '#7cc8ff', body: 'shard', bit: 'flake', lift: -4 },
  storm: { hot: '#e4ecff', main: '#4f7bff', deep: '#3a22ff', arc: '#8ff4ff', body: 'spark', bit: 'spark', lift: -1 },
  nature: { hot: '#e9ff7a', main: '#36dd52', deep: '#0b8a3e', body: 'leaf', bit: 'glow', lift: -2.4 },
  shadow: { hot: '#dd9cff', main: '#9330ff', deep: '#43088f', smoke: '#0b0214', body: 'smoke', bit: 'glow', lift: 0.8 },
  holy: { hot: '#fff1a6', main: '#ffc21f', deep: '#ff8400', body: 'star', bit: 'ring', lift: 1.4 },
  arcane: { hot: '#ffc4f3', main: '#ff3ccf', deep: '#8a2bff', body: 'rune', bit: 'star', lift: 0 },
}

for (const look of Object.values(SCHOOL_LOOK)) {
  for (const key of ['hot', 'main', 'deep', 'smoke', 'mist', 'arc']) if (look[key]) look[key] = new THREE.Color(look[key])
}

const schoolLook = (school) => SCHOOL_LOOK[school] ?? SCHOOL_LOOK.arcane

/** A canvas texture drawn once by `paint(context, size)`. */
function canvasTexture(size, paint) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  paint(canvas.getContext('2d'), size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const TEXTURES = {}

function textures() {
  if (TEXTURES.glow) return TEXTURES
  TEXTURES.glow = canvasTexture(128, (g, s) => {
    const gradient = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gradient
    g.fillRect(0, 0, s, s)
  })
  TEXTURES.sigils = {}
  TEXTURES.cursor = canvasTexture(256, (g, s) => {
    const c = s / 2
    g.strokeStyle = '#fff'
    g.fillStyle = '#fff'
    g.shadowColor = '#fff'
    g.shadowBlur = 8
    g.lineWidth = 6
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      g.beginPath()
      g.arc(c, c, c * 0.82, a - 0.5, a + 0.5)
      g.stroke()
      const x = c + Math.cos(a) * c * 0.62
      const y = c + Math.sin(a) * c * 0.62
      g.save()
      g.translate(x, y)
      g.rotate(a + Math.PI / 2)
      g.beginPath()
      g.moveTo(-14, -8)
      g.lineTo(0, 8)
      g.lineTo(14, -8)
      g.stroke()
      g.restore()
    }
  })
  return TEXTURES
}

/** A closed path through `count` points on a circle of radius r, from angle `start`. */
function polygon(g, c, r, count, start = -Math.PI / 2, step = 1) {
  g.beginPath()
  for (let k = 0; k <= count; k++) {
    const a = start + ((k * step) / count) * Math.PI * 2
    k ? g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r) : g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r)
  }
  g.stroke()
}

function spokes(g, c, count, r0, r1, start = -Math.PI / 2) {
  for (let i = 0; i < count; i++) {
    const a = start + (i / count) * Math.PI * 2
    g.beginPath()
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0)
    g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1)
    g.stroke()
  }
}

/** The inner figure of each school's casting circle, in a 512 canvas centered at c. */
const SIGILS = {
  fire(g, c) {
    polygon(g, c, c * 0.8, 3)
    polygon(g, c, c * 0.4, 3, Math.PI / 2)
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i / 3) * Math.PI * 2
      g.beginPath()
      g.arc(c + Math.cos(a) * c * 0.8, c + Math.sin(a) * c * 0.8, 12, 0, Math.PI * 2)
      g.fill()
    }
  },
  frost(g, c) {
    polygon(g, c, c * 0.62, 6)
    spokes(g, c, 6, c * 0.12, c * 0.8)
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * Math.PI * 2
      const [x, y] = [c + Math.cos(a) * c * 0.42, c + Math.sin(a) * c * 0.42]
      for (const side of [-1, 1]) {
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x + Math.cos(a + side * 0.7) * c * 0.16, y + Math.sin(a + side * 0.7) * c * 0.16)
        g.stroke()
      }
    }
  },
  storm(g, c) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      g.beginPath()
      g.arc(c, c, c * 0.62, a, a + 0.5)
      g.stroke()
    }
    g.lineWidth = 7
    g.beginPath()
    for (const [x, y] of [[0.1, -0.78], [-0.22, 0.02], [0.18, -0.06], [-0.1, 0.78]]) g.lineTo(c + x * c, c + y * c)
    g.stroke()
  },
  nature(g, c) {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2
      g.save()
      g.translate(c, c)
      g.rotate(a)
      g.beginPath()
      g.moveTo(c * 0.16, 0)
      g.quadraticCurveTo(c * 0.48, -c * 0.24, c * 0.8, 0)
      g.quadraticCurveTo(c * 0.48, c * 0.24, c * 0.16, 0)
      g.stroke()
      g.restore()
    }
    g.beginPath()
    g.arc(c, c, c * 0.14, 0, Math.PI * 2)
    g.stroke()
  },
  shadow(g, c) {
    g.beginPath()
    g.arc(c, c, c * 0.46, Math.PI * 0.2, Math.PI * 1.8)
    g.arc(c + c * 0.2, c, c * 0.36, Math.PI * 1.7, Math.PI * 0.3, true)
    g.closePath()
    g.fill()
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      g.beginPath()
      g.arc(c, c, c * 0.68, a, a + 0.22)
      g.stroke()
    }
  },
  holy(g, c) {
    g.beginPath()
    g.arc(c, c, c * 0.28, 0, Math.PI * 2)
    g.stroke()
    g.lineWidth = 6
    spokes(g, c, 8, c * 0.36, c * 0.8)
    g.lineWidth = 3
    spokes(g, c, 8, c * 0.38, c * 0.6, -Math.PI / 2 + Math.PI / 8)
  },
  arcane(g, c) {
    polygon(g, c, c * 0.8, 5, -Math.PI / 2, 2)
    g.beginPath()
    g.arc(c, c, c * 0.32, 0, Math.PI * 2)
    g.stroke()
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + (i / 5) * Math.PI * 2
      g.beginPath()
      g.arc(c + Math.cos(a) * c * 0.32, c + Math.sin(a) * c * 0.32, 8, 0, Math.PI * 2)
      g.fill()
    }
  },
}

/** A school's casting circle: a shared ticked rim around the school's own figure, drawn once. */
function sigilTexture(school) {
  const cache = textures().sigils
  if (cache[school]) return cache[school]
  cache[school] = canvasTexture(512, (g, s) => {
    const c = s / 2
    g.strokeStyle = '#fff'
    g.fillStyle = '#fff'
    g.shadowColor = '#fff'
    g.shadowBlur = 8
    g.lineCap = g.lineJoin = 'round'
    const ring = (r, w) => {
      g.lineWidth = w
      g.beginPath()
      g.arc(c, c, r, 0, Math.PI * 2)
      g.stroke()
    }
    ring(c * 0.94, 5)
    ring(c * 0.86, 2)
    for (let i = 0; i < 24; i++) {
      g.lineWidth = i % 3 ? 2 : 4
      spokes(g, c, 1, c * 0.865, c * (i % 3 ? 0.92 : 0.94), (i / 24) * Math.PI * 2)
    }
    g.lineWidth = 4
    ;(SIGILS[school] ?? SIGILS.arcane)(g, c)
  })
  cache[school].anisotropy = textures().glow.anisotropy
  return cache[school]
}

// ─── 2 · Link ───────────────────────────────────────────────────────────────

/** A WebSocket that speaks the core wire protocol and reconnects on loss. */
class Link {
  constructor() {
    this.handlers = {}
    this.queue = []
    this.connect()
  }
  connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    this.socket = new WebSocket(`${scheme}://${location.host}/wire`)
    this.socket.onopen = () => {
      for (const text of this.queue.splice(0)) this.socket.send(text)
      this.handlers.open?.()
    }
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      this.handlers[message.type]?.(message)
    }
    this.socket.onclose = () => {
      this.handlers.close?.()
      setTimeout(() => this.connect(), 1500)
    }
  }
  on(type, handler) {
    this.handlers[type] = handler
    return this
  }
  send(type, body = {}) {
    const text = pack(type, body)
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(text)
    else this.queue.push(text)
  }
}

// ─── 3 · Pads ───────────────────────────────────────────────────────────────

const KEY_CODES = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyI: 'star', KeyJ: 'wave', KeyL: 'flame', KeyK: 'leaf', KeyU: 'meta', Space: 'ward', KeyE: 'call', KeyQ: 'drop', Backspace: 'drop',
}
const PAD_BUTTONS = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 3: 'star', 2: 'wave', 1: 'flame', 0: 'leaf', 4: 'drop', 5: 'meta', 6: 'call', 7: 'ward' }
const PAD_COMMANDS = { 9: 'book', 8: 'guide' }

/**
 * Turns keyboard, gamepad and touch input into the same small set of keys:
 * four moves, four runes, meta, ward, call and drop. On a keyboard, Shift
 * with a rune is meta then that rune. `onKey(key)` gets game keys,
 * `onCommand(name)` gets UI commands, `onMode(mode)` gets input changes.
 */
class Pads {
  constructor({ onKey, onCommand, onMode }) {
    this.onKey = onKey
    this.onCommand = onCommand
    this.onMode = onMode
    this.held = new Map()
    this.stick = new Map()
    window.addEventListener('keydown', (event) => this.keyDown(event))
    window.addEventListener('pointerdown', (event) => event.pointerType === 'touch' && this.setMode('touch'), { capture: true })
    for (const button of $$('#pads [data-key]')) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        button.classList.add('held')
        this.setMode('touch')
        this.onKey(button.dataset.key)
        navigator.vibrate?.(8)
      })
      for (const end of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(end, () => button.classList.remove('held'))
    }
    if (matchMedia('(pointer: coarse)').matches) this.setMode('touch')
  }

  setMode(mode) {
    if (mode === inputMode) return
    inputMode = mode
    document.body.dataset.input = mode
    this.onMode(mode)
  }

  keyDown(event) {
    const typing = event.target instanceof HTMLInputElement
    if (typing || $('#guide').open) return
    if (event.code === 'Tab') {
      event.preventDefault()
      return this.onCommand('book')
    }
    const key = KEY_CODES[event.code]
    if (!key) return
    event.preventDefault()
    if (event.repeat) return
    this.setMode('keys')
    if (event.shiftKey && RUNES.includes(key)) this.onKey('meta')
    this.onKey(key)
  }

  /** Poll gamepads once per frame; fire on new presses and stick flicks. */
  poll() {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue
      const held = this.held.get(pad.index) ?? new Set()
      const now = new Set()
      pad.buttons.forEach((button, i) => {
        if (!button.pressed) return
        now.add(i)
        if (held.has(i)) return
        this.setMode('pad')
        if (PAD_BUTTONS[i]) this.onKey(PAD_BUTTONS[i])
        else if (PAD_COMMANDS[i]) this.onCommand(PAD_COMMANDS[i])
      })
      this.held.set(pad.index, now)
      const [x = 0, y = 0] = pad.axes
      const flick = Math.hypot(x, y) > 0.65 ? (Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : y < 0 ? 'up' : 'down') : null
      const last = this.stick.get(pad.index)
      if (flick && flick !== last) {
        this.setMode('pad')
        this.onKey(flick)
      }
      if (flick || Math.hypot(x, y) < 0.3) this.stick.set(pad.index, flick)
    }
  }
}

// ─── 4 · Sparks ─────────────────────────────────────────────────────────────
//
// One ring buffer of particles per blend mode. The CPU only writes a particle
// once, at birth; the vertex shader moves, grows and fades it from its start
// state and age. Each frame uploads just the slots written that frame.

const SHAPES = { glow: 0, star: 1, ring: 2, shard: 3, smoke: 4, leaf: 5, rune: 6, flake: 7, spark: 8, bubble: 9, flame: 10, cross: 11, chevron: 12, zed: 13, nosign: 14, target: 15 }

/** Shapes that point along their motion on screen, and shapes that stay upright to read as symbols. */
const SHAPE_ROLES = /* glsl */ `
  bool alongMotion(float shape) { return shape == 8.0 || shape == 10.0 || shape == 12.0; }
  bool upright(float shape) { return shape == 11.0 || shape >= 13.0; }
`

/** Screen angle of a world direction at a view point, for shapes that follow motion. */
const SCREEN_ANGLE = /* glsl */ `
  float screenAngle(vec3 from, vec3 to, float aspect, float fallback) {
    vec4 a = projectionMatrix * modelViewMatrix * vec4(from, 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(to, 1.0);
    vec2 dir = (b.xy / b.w - a.xy / a.w) * vec2(aspect, 1.0);
    return length(dir) > 1e-5 ? atan(dir.y, dir.x) : fallback;
  }
`

const SPARK_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uAspect;
  uniform float uMaxPoint;
  attribute vec3 aOffset;
  attribute vec3 aVelocity;
  attribute vec4 aColor;
  attribute vec4 aLife;   // birth, life, size, shape
  attribute vec4 aForce;  // gravity, drag, swirl, grow
  varying vec4 vColor;
  varying float vShape;
  varying float vAngle;
  varying float vHeat;
  varying float vShrink;
  ${SHAPE_ROLES}
  ${SCREEN_ANGLE}

  vec3 travel(float t) {
    float k = aForce.y;
    vec3 local = aOffset + (k > 0.0 ? aVelocity * (1.0 - exp(-k * t)) / k : aVelocity * t);
    float a = aForce.z * t;
    local.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * local.xz;
    vec3 p = position + local;
    p.y += 0.5 * aForce.x * t * t;
    return p;
  }

  void main() {
    float age = uTime - aLife.x;
    if (age < 0.0 || age > aLife.y) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float u = age / aLife.y;
    vec3 at = travel(age);
    vec4 view = modelViewMatrix * vec4(at, 1.0);
    gl_Position = projectionMatrix * view;
    float seed = fract(sin(aLife.x * 91.7 + aOffset.x * 47.3 + aVelocity.z * 13.1) * 43758.5);
    float spin = seed * 6.2832 + age * (seed - 0.5) * 4.0;
    // Still flames and arrows point up; upright symbols only rock a little.
    vAngle = alongMotion(aLife.w) ? screenAngle(at, travel(age + 0.03), uAspect, 1.5708) : upright(aLife.w) ? (seed - 0.5) * 0.5 : spin;
    float size = aLife.z * max(0.0, 1.0 + aForce.w * u);
    // Points under two pixels shimmer as they cross pixel centers: keep them
    // two pixels wide and fade them by the area they lost instead.
    float pixels = size * uScale / -view.z;
    float cover = clamp(pixels * 0.5, 0.0, 1.0);
    gl_PointSize = clamp(pixels, 2.0, uMaxPoint);
    float fade = smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.55, 1.0, u));
    vColor = vec4(aColor.rgb, aColor.a * fade * cover);
    vShrink = cover;
    vShape = aLife.w;
    vHeat = 1.0 - u;
  }
`

/** Every particle shape, drawn from the point's local coordinates (p fixed, q turned by vAngle). */
const SPARK_FRAGMENT = /* glsl */ `
  varying vec4 vColor;
  varying float vShape;
  varying float vAngle;
  varying float vHeat;
  varying float vShrink;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
  }
  float stroke(float d, float w) { return smoothstep(w, w * 0.55, d); }

  void main() {
    vec2 p = (gl_PointCoord * 2.0 - 1.0) * vShrink;
    p.y = -p.y;
    float c = cos(vAngle);
    float s = sin(vAngle);
    vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
    float r = length(p);
    int shape = int(vShape + 0.5);
    float alpha = 0.0;
    float core = 0.0;
    if (shape == 0) {
      alpha = exp(-r * r * 4.5) * smoothstep(1.0, 0.6, r);
      core = exp(-r * r * 18.0);
    } else if (shape == 1) {
      float rays = exp(-abs(q.x) * 14.0) * (1.0 - abs(q.y)) + exp(-abs(q.y) * 14.0) * (1.0 - abs(q.x));
      core = exp(-r * r * 20.0);
      alpha = clamp(rays * 0.9 + core, 0.0, 1.0);
    } else if (shape == 2) {
      alpha = exp(-pow((r - 0.72) * 9.0, 2.0));
    } else if (shape == 3) {
      float d = abs(q.x) * 2.4 + abs(q.y);
      alpha = smoothstep(1.0, 0.82, d);
      core = smoothstep(0.5, 0.0, d);
    } else if (shape == 4) {
      alpha = smoothstep(1.0, 0.1, r) * (0.45 + 0.55 * noise(p * 2.3 + vAngle * 3.0));
    } else if (shape == 5) {
      float d = length(vec2(q.x * 2.3, q.y));
      alpha = smoothstep(1.0, 0.86, d) * (1.0 - 0.45 * exp(-abs(q.x) * 30.0));
    } else if (shape == 6) {
      // A sigil: a ring around a triangle (iq's equilateral triangle distance) and a dot.
      float ring = exp(-pow((r - 0.74) * 12.0, 2.0));
      const float k = 1.7320508;
      vec2 t = vec2(abs(q.x) - 0.55, q.y + 0.55 / k);
      if (t.x + k * t.y > 0.0) t = vec2(t.x - k * t.y, -k * t.x - t.y) / 2.0;
      t.x -= clamp(t.x, -1.1, 0.0);
      float tri = exp(-pow(length(t) * 13.0, 2.0));
      alpha = max(max(ring, tri * 0.9), exp(-r * r * 60.0));
    } else if (shape == 7) {
      float arms = exp(-abs(sin(3.0 * atan(q.y, q.x))) * r * 14.0) * smoothstep(1.0, 0.5, r);
      core = exp(-r * r * 25.0);
      alpha = clamp(arms + core, 0.0, 1.0);
    } else if (shape == 8) {
      alpha = exp(-abs(q.y) * 9.0) * smoothstep(1.0, 0.0, abs(q.x));
      core = exp(-abs(q.y) * 22.0) * smoothstep(0.6, 0.0, abs(q.x));
    } else if (shape == 9) {
      alpha = smoothstep(1.0, 0.85, r) * (0.25 + 0.75 * smoothstep(0.55, 0.95, r));
    } else if (shape == 10) {
      // A flame tongue: a round belly behind, a tip pointing along the motion.
      float t = clamp((q.x + 0.85) / 1.8, 0.0, 1.0);
      float w = 0.95 * sqrt(t) * pow(1.0 - t, 0.75);
      alpha = smoothstep(w, w * 0.45, abs(q.y)) * step(-0.85, q.x);
      core = smoothstep(w * 0.55, 0.0, abs(q.y)) * smoothstep(0.05, 0.3, t) * smoothstep(0.75, 0.3, t);
    } else if (shape == 11) {
      // A healing cross with soft glow around it.
      float d = max(abs(q.x), abs(q.y));
      float n = min(abs(q.x), abs(q.y));
      alpha = max(stroke(max(n - 0.1, d - 0.62), 0.16), exp(-r * r * 3.0) * 0.3);
      core = stroke(max(n, d - 0.45), 0.1);
    } else if (shape == 12) {
      float d = min(segment(q, vec2(0.5, 0.0), vec2(-0.3, 0.62)), segment(q, vec2(0.5, 0.0), vec2(-0.3, -0.62)));
      alpha = max(stroke(d, 0.2), exp(-r * r * 4.0) * 0.18);
      core = stroke(d, 0.08);
    } else if (shape == 13) {
      float d = min(min(segment(q, vec2(-0.5, 0.55), vec2(0.5, 0.55)), segment(q, vec2(0.5, 0.55), vec2(-0.5, -0.55))), segment(q, vec2(-0.5, -0.55), vec2(0.5, -0.55)));
      alpha = stroke(d, 0.16);
      core = stroke(d, 0.06);
    } else if (shape == 14) {
      // No casting: a ring with a slash.
      float d = min(abs(r - 0.66), segment(q, vec2(-0.46, 0.46), vec2(0.46, -0.46)));
      alpha = max(stroke(d, 0.15), exp(-r * r * 3.0) * 0.2);
      core = stroke(d, 0.05);
    } else {
      // A target reticle: a ring, four ticks and a dot.
      float ticks = stroke(min(abs(q.x), abs(q.y)), 0.07) * step(0.5, r) * smoothstep(1.0, 0.9, r) * step(min(abs(q.x), abs(q.y)), 0.2);
      alpha = max(max(stroke(abs(r - 0.6), 0.09), ticks), exp(-r * r * 45.0));
      core = stroke(abs(r - 0.6), 0.03);
    }
    alpha *= vColor.a;
    if (alpha < 0.004) discard;
    // Cores run lighter but keep their hue, so stacked sparks do not wash out to white.
    vec3 hot = vColor.rgb * 0.55 + vec3(0.45);
    gl_FragColor = vec4(mix(vColor.rgb, hot, core * 0.8 * vHeat), alpha);
  }
`

class SparkLayer {
  constructor(capacity, blending, uniforms) {
    this.capacity = capacity
    this.head = 0
    this.dirty = []
    const geometry = new THREE.BufferGeometry()
    this.attributes = {}
    for (const [name, size] of Object.entries({ position: 3, aOffset: 3, aVelocity: 3, aColor: 4, aLife: 4, aForce: 4 })) {
      const attribute = new THREE.BufferAttribute(new Float32Array(capacity * size), size)
      attribute.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute(name, attribute)
      this.attributes[name] = attribute
    }
    for (let i = 0; i < capacity; i++) this.attributes.aLife.array[i * 4] = -1e6
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader: SPARK_VERTEX, fragmentShader: SPARK_FRAGMENT, transparent: true, depthWrite: false, blending })
    this.points = new THREE.Points(geometry, material)
    this.points.frustumCulled = false
  }

  write(p, time) {
    const i = this.head
    this.head = (i + 1) % this.capacity
    const { position, aOffset, aVelocity, aColor, aLife, aForce } = this.attributes
    const color = p.color
    position.array.set(p.at, i * 3)
    aOffset.array.set(p.offset ?? ZERO3, i * 3)
    aVelocity.array.set(p.velocity ?? ZERO3, i * 3)
    aColor.array.set([color.r, color.g, color.b, p.alpha ?? 1], i * 4)
    aLife.array.set([time + (p.delay ?? 0), p.life ?? 0.6, p.size ?? 0.3, SHAPES[p.shape ?? 'glow']], i * 4)
    aForce.array.set([p.gravity ?? 0, p.drag ?? 0, p.swirl ?? 0, p.grow ?? 0], i * 4)
    const last = this.dirty[this.dirty.length - 1]
    if (last && last[0] + last[1] === i) last[1]++
    else this.dirty.push([i, 1])
  }

  flush() {
    if (!this.dirty.length) return
    for (const attribute of Object.values(this.attributes)) {
      attribute.clearUpdateRanges()
      for (const [start, count] of this.dirty) attribute.addUpdateRange(start * attribute.itemSize, count * attribute.itemSize)
      attribute.needsUpdate = true
    }
    this.dirty = []
  }
}

const ZERO3 = [0, 0, 0]
const ZERO = new THREE.Vector3()

/** Shapes drawn with normal blending by default: they keep their own color where they overlap. */
const SOLID_SHAPES = new Set(['smoke', 'leaf'])

/**
 * Glowing (additive) and solid (alpha) particles. emit() takes one particle
 * spec. Smoke and leaves go to the solid layer unless `haze` says otherwise,
 * so clouds of them stay dark or green instead of adding up to white.
 */
class Sparks {
  constructor(scene, capacity = 24000) {
    this.time = 0
    this.density = 1
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 800 }, uAspect: { value: 1 }, uMaxPoint: { value: 600 } }
    this.glow = new SparkLayer(capacity, THREE.AdditiveBlending, this.uniforms)
    this.haze = new SparkLayer(Math.floor(capacity / 2), THREE.NormalBlending, this.uniforms)
    this.haze.points.renderOrder = 1
    this.glow.points.renderOrder = 2
    scene.add(this.haze.points, this.glow.points)
  }
  /** p: { at, offset?, velocity?, color, alpha?, life?, size?, shape?, gravity?, drag?, swirl?, grow?, delay?, haze? } */
  emit(p) {
    // Lower quality tiers thin out small bits; big flashes always draw.
    if (this.density < 1 && (p.size ?? 0.3) < 0.5 && Math.random() > this.density) return
    ;((p.haze ?? SOLID_SHAPES.has(p.shape)) ? this.haze : this.glow).write(p, this.time)
  }
  update(time, scale, aspect) {
    this.time = time
    this.uniforms.uTime.value = time
    this.uniforms.uScale.value = scale
    this.uniforms.uAspect.value = aspect
    this.glow.flush()
    this.haze.flush()
  }
}

const MARK_VERTEX = /* glsl */ `
  uniform float uScale;
  uniform float uAspect;
  uniform float uMaxPoint;
  attribute vec4 aColor;
  attribute vec3 aDir;
  attribute vec3 aMark; // size, shape, angle
  varying vec4 vColor;
  varying float vShape;
  varying float vAngle;
  varying float vHeat;
  varying float vShrink;
  ${SCREEN_ANGLE}
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(aMark.x * uScale / -view.z, 2.0, uMaxPoint);
    vAngle = aMark.z + (dot(aDir, aDir) > 0.0 ? screenAngle(position, position + aDir, uAspect, 0.0) : 0.0);
    vColor = aColor;
    vShape = aMark.y;
    vHeat = 1.0;
    vShrink = 1.0;
  }
`

/**
 * Points drawn fresh every frame and never kept: the heads of spells in
 * flight and the symbols that sit on a mage while a status lasts. Unlike a
 * trail of short-lived sparks they look the same at any frame rate. Solid
 * marks draw after glowing ones, so a dark core sits on top of its halo.
 */
class Marks {
  constructor(scene, uniforms, capacity = 800) {
    this.capacity = capacity
    this.layers = [THREE.AdditiveBlending, THREE.NormalBlending].map((blending, i) => {
      const geometry = new THREE.BufferGeometry()
      const attributes = {}
      for (const [name, size] of Object.entries({ position: 3, aColor: 4, aDir: 3, aMark: 3 })) {
        attributes[name] = new THREE.BufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage)
        geometry.setAttribute(name, attributes[name])
      }
      const material = new THREE.ShaderMaterial({ uniforms, vertexShader: MARK_VERTEX, fragmentShader: SPARK_FRAGMENT, transparent: true, depthWrite: false, blending })
      const points = new THREE.Points(geometry, material)
      points.frustumCulled = false
      points.renderOrder = 2.5 + i * 0.1
      scene.add(points)
      return { points, attributes, count: 0 }
    })
  }

  /** m: { at: Vector3, color, alpha?, size?, shape?, angle?, dir?: Vector3 (turns the shape to follow it), solid? } */
  draw(m) {
    const layer = this.layers[m.solid ? 1 : 0]
    const i = layer.count
    if (i >= this.capacity) return
    layer.count++
    const { position, aColor, aDir, aMark } = layer.attributes
    const dir = m.dir ?? ZERO
    position.setXYZ(i, m.at.x, m.at.y, m.at.z)
    aColor.setXYZW(i, m.color.r, m.color.g, m.color.b, m.alpha ?? 1)
    aDir.setXYZ(i, dir.x, dir.y, dir.z)
    aMark.setXYZ(i, m.size ?? 0.4, SHAPES[m.shape ?? 'glow'], m.angle ?? 0)
  }

  /** Upload this frame's marks and start the next frame empty. */
  flush() {
    for (const layer of this.layers) {
      layer.points.geometry.setDrawRange(0, layer.count)
      if (layer.count) {
        for (const attribute of Object.values(layer.attributes)) {
          attribute.clearUpdateRanges()
          attribute.addUpdateRange(0, layer.count * attribute.itemSize)
          attribute.needsUpdate = true
        }
      }
      layer.count = 0
    }
  }
}

// ─── 5 · Rings ──────────────────────────────────────────────────────────────

const RING_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const RING_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFade;
  uniform float uThick;
  varying vec2 vUv;
  void main() {
    float r = length(vUv * 2.0 - 1.0);
    float ring = exp(-pow((r - 0.9) / uThick, 2.0));
    float fill = smoothstep(0.95, 0.0, r) * 0.12;
    float a = (ring + fill) * uFade * smoothstep(1.0, 0.97, r);
    gl_FragColor = vec4(uColor * a, a);
  }
`

/** A pool of flat expanding rings for ground shockwaves. */
class Rings {
  constructor(scene, count = 48) {
    const geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
    this.pool = Array.from({ length: count }, () => {
      const material = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uFade: { value: 0 }, uThick: { value: 0.06 } },
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.visible = false
      mesh.renderOrder = 3
      scene.add(mesh)
      return { mesh, start: -Infinity, life: 1, radius: 1 }
    })
    this.next = 0
  }
  spawn({ at, radius = 2, color, life = 0.7, thick = 0.06, delay = 0, time }) {
    const ring = this.pool[this.next]
    this.next = (this.next + 1) % this.pool.length
    ring.mesh.position.set(at.x, (at.y ?? 0) + 0.04, at.z)
    ring.mesh.material.uniforms.uColor.value.copy(color)
    ring.mesh.material.uniforms.uThick.value = thick
    Object.assign(ring, { start: time + delay, life, radius })
  }
  update(time) {
    for (const ring of this.pool) {
      const u = (time - ring.start) / ring.life
      ring.mesh.visible = u >= 0 && u < 1
      if (!ring.mesh.visible) continue
      ring.mesh.scale.setScalar(ring.radius * (0.12 + 0.88 * ease(u)))
      ring.mesh.material.uniforms.uFade.value = (1 - u) * 1.15
    }
  }
}

const BOLT_VERTEX = /* glsl */ `
  uniform float uWidth;
  uniform float uAspect;
  attribute vec3 aPrev;
  attribute vec3 aNext;
  attribute float aSide;
  attribute float aAlong;
  varying float vSide;
  varying float vAlong;
  vec2 screen(vec3 p) {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    return clip.xy / clip.w * vec2(uAspect, 1.0);
  }
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec2 dir = screen(aNext) - screen(aPrev);
    dir = length(dir) > 1e-6 ? normalize(dir) : vec2(1.0, 0.0);
    vec2 normal = vec2(-dir.y, dir.x) / vec2(uAspect, 1.0);
    float taper = 1.0 - 0.7 * pow(abs(aAlong * 2.0 - 1.0), 6.0);
    clip.xy += normal * aSide * uWidth * taper * projectionMatrix[1][1];
    vSide = aSide;
    vAlong = aAlong;
    gl_Position = clip;
  }
`
const BOLT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform float uFade;
  varying float vSide;
  varying float vAlong;
  void main() {
    float d = vSide * vSide;
    float glow = exp(-d * 4.0) - 0.018;
    float core = exp(-d * 36.0);
    float ends = smoothstep(0.0, 0.03, vAlong) * smoothstep(1.0, 0.97, vAlong);
    gl_FragColor = vec4((uColor * max(glow, 0.0) * 1.2 + uHot * core * 1.1) * ends, uFade);
  }
`

/**
 * A pool of glowing ribbons that always face the camera: lightning, beams and
 * tethers. Each holds a polyline drawn as a strip with a hot core and soft edges.
 */
class Bolts {
  constructor(scene, count = 48, capacity = 48) {
    this.aspect = { value: 1 }
    this.capacity = capacity
    const index = []
    for (let i = 0; i < capacity - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    this.pool = Array.from({ length: count }, () => {
      const geometry = new THREE.BufferGeometry()
      for (const [name, size] of Object.entries({ position: 3, aPrev: 3, aNext: 3, aSide: 1, aAlong: 1 })) {
        geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(capacity * 2 * size), size).setUsage(THREE.DynamicDrawUsage))
      }
      geometry.setIndex(index)
      const material = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uFade: { value: 0 }, uWidth: { value: 0.1 }, uAspect: this.aspect },
        vertexShader: BOLT_VERTEX,
        fragmentShader: BOLT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, // the strip's winding flips with its direction on screen
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false
      mesh.visible = false
      mesh.renderOrder = 3
      scene.add(mesh)
      return { mesh, start: -Infinity, life: 1, flicker: 0 }
    })
    this.next = 0
  }

  /** Draw a polyline (THREE.Vector3[]) for `life` seconds, in a fresh slot or in `bolt` again. */
  spawn(points, { color, hot = color, width = 0.12, life = 0.15, flicker = 0, time }, bolt = null) {
    const count = Math.min(points.length, this.capacity)
    if (count < 2) return bolt
    if (!bolt) {
      bolt = this.pool[this.next]
      this.next = (this.next + 1) % this.pool.length
    }
    const { position, aPrev, aNext, aSide, aAlong } = bolt.mesh.geometry.attributes
    for (let i = 0; i < count; i++) {
      const at = points[i]
      const prev = points[Math.max(0, i - 1)]
      const next = points[Math.min(count - 1, i + 1)]
      for (let side = 0; side < 2; side++) {
        const k = i * 2 + side
        position.setXYZ(k, at.x, at.y, at.z)
        aPrev.setXYZ(k, prev.x, prev.y, prev.z)
        aNext.setXYZ(k, next.x, next.y, next.z)
        aSide.setX(k, side ? 1 : -1)
        aAlong.setX(k, i / (count - 1))
      }
    }
    for (const attribute of [position, aPrev, aNext, aSide, aAlong]) {
      attribute.clearUpdateRanges()
      attribute.addUpdateRange(0, count * 2 * attribute.itemSize)
      attribute.needsUpdate = true
    }
    bolt.mesh.geometry.setDrawRange(0, (count - 1) * 6)
    const uniforms = bolt.mesh.material.uniforms
    uniforms.uColor.value.copy(color)
    uniforms.uHot.value.copy(hot)
    uniforms.uWidth.value = width
    Object.assign(bolt, { start: time, life, flicker })
    return bolt
  }

  update(time, aspect) {
    this.aspect.value = aspect
    for (const bolt of this.pool) {
      const u = (time - bolt.start) / bolt.life
      bolt.mesh.visible = u >= 0 && u < 1
      if (!bolt.mesh.visible) continue
      const flicker = 1 - bolt.flicker * (0.5 + 0.5 * Math.sin(time * 90 + bolt.start * 50))
      bolt.mesh.material.uniforms.uFade.value = (1 - u * u) * flicker
    }
  }
}

/** A jagged path between two points, by midpoint displacement. */
function jagged(from, to, depth = 4, roughness = 0.26) {
  let points = [from.clone(), to.clone()]
  for (let level = 0; level < depth; level++) {
    const next = [points[0]]
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      next.push(a.clone().lerp(b, 0.5).add(randomDirection().multiplyScalar(a.distanceTo(b) * roughness)), b)
    }
    points = next
  }
  return points
}

// ─── 6 · Looks ──────────────────────────────────────────────────────────────
//
// Recipes compose particles into effects. Every recipe takes a world point
// (THREE.Vector3) and a school, so any spell can borrow any shape.

function randomDirection(out = new THREE.Vector3()) {
  const u = Math.random() * 2 - 1
  const a = Math.random() * Math.PI * 2
  const s = Math.sqrt(1 - u * u)
  return out.set(s * Math.cos(a), u, s * Math.sin(a))
}

const mixColor = (a, b, t) => a.clone().lerp(b, t)
const tint = (look) => mixColor(look.main, pickOne([look.hot, look.deep, look.main]), Math.random() * 0.8)
const point = (v) => [v.x, v.y, v.z]

const MEND_LIGHT = { holy: [new THREE.Color('#fff3b8'), new THREE.Color('#ffc21f')], life: [new THREE.Color('#d2ffe0'), new THREE.Color('#33e676')] }

class Looks {
  constructor(stage) {
    this.stage = stage
    this.sparks = stage.sparks
    this.marks = stage.marks
    this.rings = stage.rings
    this.bolts = stage.bolts
  }

  flash(at, color, size = 1.6, life = 0.22, alpha = 1) {
    this.sparks.emit({ at: point(at), color, size, life, alpha, shape: 'glow', grow: 0.6 })
  }

  /** A burst of the school's shapes from a point: a tinted flash, a ring of light, bodies and bits. */
  burst(at, school, power = 1) {
    const look = schoolLook(school)
    this.flash(at, look.main, 1.2 * Math.sqrt(power), 0.22, 0.45)
    this.flash(at, look.hot, 0.5 * Math.sqrt(power), 0.12, 0.55)
    this.sparks.emit({ at: point(at), color: look.main, alpha: 0.6, size: 0.55 * power, life: 0.4, shape: 'ring', grow: 4 })
    const count = Math.round(22 * power)
    for (let i = 0; i < count; i++) {
      const dir = randomDirection()
      this.sparks.emit({
        at: point(at),
        velocity: point(dir.multiplyScalar(rand(2, 6.5) * power)),
        color: tint(look),
        alpha: 0.85,
        size: rand(0.18, 0.42) * Math.sqrt(power),
        life: rand(0.45, 1),
        shape: look.body,
        gravity: look.lift,
        drag: 2.6,
      })
    }
    for (let i = 0; i < count / 2; i++) {
      this.sparks.emit({
        at: point(at),
        velocity: point(randomDirection().multiplyScalar(rand(5, 10) * power)),
        color: mixColor(look.hot, look.main, 0.35),
        size: rand(0.08, 0.18),
        life: rand(0.25, 0.55),
        shape: look.bit === 'ring' ? 'spark' : look.bit,
        drag: 4,
        gravity: look.lift,
      })
    }
    if (look.smoke) this.smoke(at, look.smoke, Math.round(5 * power))
  }

  /** The school's own signature on a damaging hit, on top of the burst. */
  flourish(at, feet, school, power = 1) {
    FLOURISH[school]?.(this, at, feet, schoolLook(school), power)
  }

  smoke(at, color, count = 6) {
    for (let i = 0; i < count; i++) {
      this.sparks.emit({
        at: point(at),
        velocity: [rand(-0.8, 0.8), rand(0.3, 1.2), rand(-0.8, 0.8)],
        color,
        alpha: 0.6,
        size: rand(0.8, 1.4),
        life: rand(0.9, 1.6),
        shape: 'smoke',
        grow: 1.4,
        drag: 1.2,
        haze: true,
      })
    }
  }

  /** Pale cold haze that sinks: frost's smoke. */
  mist(at, color, count = 4) {
    for (let i = 0; i < count; i++) {
      this.sparks.emit({ at: point(at), velocity: [rand(-0.9, 0.9), rand(-0.6, 0.1), rand(-0.9, 0.9)], color, alpha: 0.22, size: rand(0.6, 1), life: rand(0.8, 1.3), shape: 'smoke', grow: 1.5, drag: 1.4, haze: true })
    }
  }

  ground(at, school, radius = 2.2, life = 0.7) {
    const look = schoolLook(school)
    this.rings.spawn({ at, radius, color: look.main, life, time: this.sparks.time })
    this.rings.spawn({ at, radius: radius * 0.6, color: look.hot, life: life * 0.8, thick: 0.1, delay: 0.06, time: this.sparks.time })
  }

  pillar(feet, school, power = 1) {
    const look = schoolLook(school)
    this.ground(feet, school, 1.6 * power)
    for (let i = 0; i < 42 * power; i++) {
      const a = Math.random() * Math.PI * 2
      const r = rand(0.15, 0.85)
      this.sparks.emit({
        at: [feet.x, feet.y + 0.1, feet.z],
        offset: [Math.cos(a) * r, rand(0, 0.4), Math.sin(a) * r],
        velocity: [0, rand(1.8, 4.2), 0],
        color: tint(look),
        size: rand(0.12, 0.3),
        life: rand(0.7, 1.3),
        shape: pickOne([look.body, look.bit, 'glow']),
        swirl: rand(1.5, 3),
        drag: 0.6,
      })
    }
    this.sparks.emit({ at: [feet.x, feet.y + 1.2, feet.z], color: look.main, size: 1.6, life: 0.4, shape: 'glow', alpha: 0.3 })
  }

  /** Chevrons that rise (a boon lands) or sink (a bane lands) around a point. */
  arrows(center, color, up = true, count = 4) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(0, 0.6)
      this.sparks.emit({
        at: [center.x + Math.cos(a) * 0.6, center.y + (up ? -0.6 : 0.9), center.z + Math.sin(a) * 0.6],
        velocity: [0, up ? rand(1.4, 2.2) : -rand(1.1, 1.6), 0],
        color,
        size: rand(0.34, 0.46),
        life: rand(0.7, 0.9),
        shape: 'chevron',
        drag: 0.8,
        delay: i * 0.07,
      })
    }
  }

  spiral(center, school, rising = true) {
    const look = schoolLook(school)
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 4
      this.sparks.emit({
        at: [center.x, center.y - 1, center.z],
        offset: [Math.cos(a) * 0.85, (i / 34) * (rising ? 0.6 : 2), Math.sin(a) * 0.85],
        velocity: [0, rising ? rand(1.2, 2) : rand(-1, -0.4), 0],
        color: tint(look),
        size: rand(0.12, 0.26),
        life: rand(0.7, 1.1),
        shape: pickOne([look.bit, 'glow']),
        swirl: rising ? 4 : -4,
        delay: i * 0.008,
      })
    }
    this.arrows(center, look.main, rising)
  }

  implode(center, school, count = 16, radius = 1.4) {
    const look = schoolLook(school)
    for (let i = 0; i < count; i++) {
      const dir = randomDirection().multiplyScalar(radius)
      this.sparks.emit({
        at: point(center),
        offset: point(dir),
        velocity: point(dir.clone().multiplyScalar(-1.9)),
        color: tint(look),
        size: rand(0.08, 0.2),
        life: 0.5,
        shape: look.bit === 'ring' ? 'glow' : look.bit,
      })
    }
  }

  /** What a spell sheds as it flies: the school's bodies and bits, plus smoke or mist. */
  trail(at, school, scale = 1) {
    const look = schoolLook(school)
    for (let i = 0; i < 2; i++) {
      this.sparks.emit({
        at: point(at),
        velocity: [rand(-0.6, 0.6), rand(-0.3, 0.8), rand(-0.6, 0.6)],
        color: tint(look),
        alpha: 0.85,
        size: rand(0.14, 0.3) * scale,
        life: rand(0.25, 0.5),
        shape: look.body,
        gravity: look.lift * 0.5,
        drag: 1.5,
      })
    }
    this.sparks.emit({ at: point(at), velocity: point(randomDirection().multiplyScalar(0.8)), color: mixColor(look.hot, look.main, 0.4), size: rand(0.08, 0.16) * scale, life: rand(0.2, 0.4), shape: look.bit === 'ring' ? 'star' : look.bit, drag: 2 })
    if (look.smoke && Math.random() < 0.3) this.smoke(at, look.smoke, 1)
    if (look.mist && Math.random() < 0.2) this.mist(at, look.mist, 1)
  }

  /** The head of a spell in flight, drawn this frame: a halo in the school color around the school's own core. */
  head(at, school, scale = 1, dir = ZERO) {
    const look = schoolLook(school)
    const marks = this.marks
    const t = this.sparks.time
    marks.draw({ at, color: look.main, size: 1.3 * scale, alpha: 0.42 })
    ;(HEADS[school] ?? HEADS.arcane)(marks, at, scale, look, t, dir)
  }

  /** Motes scattered along a line; `share` scales how many (rounded at random). */
  stream(from, to, school, width = 0.12, share = 1) {
    const look = schoolLook(school)
    const span = to.clone().sub(from)
    const count = Math.floor(span.length() * 5 * share + Math.random())
    for (let i = 0; i < count; i++) {
      const at = from.clone().addScaledVector(span, Math.random())
      this.sparks.emit({
        at: point(at),
        velocity: point(randomDirection().multiplyScalar(width * 4)),
        color: tint(look),
        size: rand(0.12, 0.28),
        life: rand(0.12, 0.3),
        shape: pickOne(['glow', look.bit, look.body]),
      })
    }
  }

  /** A rippling ribbon from one point to another. Pass back the returned bolt to redraw it. */
  beam(from, to, school, width = 0.2, bolt = null) {
    const look = schoolLook(school)
    const span = to.clone().sub(from)
    const side = new THREE.Vector3(-span.z, 0, span.x).normalize()
    const t = this.sparks.time
    const points = Array.from({ length: 24 }, (_, i) => {
      const u = i / 23
      const wave = Math.sin(u * 14 - t * 30) * 0.05 * Math.sin(u * Math.PI)
      const at = from.clone().addScaledVector(span, u).addScaledVector(side, wave)
      at.y += wave * 0.6
      return at
    })
    return this.bolts.spawn(points, { color: look.main, hot: look.hot, width, life: 0.1, time: t }, bolt)
  }

  lightning(from, to, school) {
    const look = schoolLook(school)
    const time = this.sparks.time
    const points = jagged(from, to, 5, 0.24)
    this.bolts.spawn(points, { color: look.main, hot: look.hot, width: 0.16, life: rand(0.12, 0.2), flicker: 0.5, time })
    for (let i = 0; i < 2; i++) {
      const at = points[Math.floor(rand(0.2, 0.75) * points.length)]
      const reach = randomDirection().multiplyScalar(rand(0.5, 1.2)).add(to.clone().sub(at).multiplyScalar(0.25))
      this.bolts.spawn(jagged(at, at.clone().add(reach), 3, 0.3), { color: look.deep, hot: look.arc ?? look.main, width: 0.07, life: 0.1, time })
    }
    for (let i = 0; i < 3; i++) {
      this.sparks.emit({ at: point(pickOne(points)), velocity: point(randomDirection().multiplyScalar(rand(1, 3))), color: look.arc ?? look.hot, size: rand(0.06, 0.12), life: rand(0.15, 0.3), shape: 'spark', drag: 3 })
    }
  }

  /** Healing lands: rising crosses, gold for holy and green for the rest. */
  mend(center, school) {
    const [light, color] = school === 'holy' ? MEND_LIGHT.holy : MEND_LIGHT.life
    for (let i = 0; i < 11; i++) {
      this.sparks.emit({
        at: [center.x, center.y - 0.5, center.z],
        offset: [rand(-0.65, 0.65), rand(-0.3, 0.7), rand(-0.65, 0.65)],
        velocity: [0, rand(0.9, 1.7), 0],
        color: mixColor(color, light, rand(0, 0.45)),
        size: rand(0.26, 0.4),
        life: rand(0.8, 1.2),
        shape: 'cross',
        drag: 0.5,
        delay: i * 0.03,
      })
    }
    for (let i = 0; i < 14; i++) {
      this.sparks.emit({
        at: [center.x, center.y - 0.6, center.z],
        offset: [rand(-0.6, 0.6), rand(-0.3, 0.9), rand(-0.6, 0.6)],
        velocity: [0, rand(0.8, 2), 0],
        color: light,
        size: rand(0.08, 0.18),
        life: rand(0.6, 1.1),
        shape: school === 'nature' ? pickOne(['glow', 'leaf']) : pickOne(['glow', 'star']),
        drag: 0.4,
      })
    }
    this.flash(center, color, 1.1, 0.3, 0.4)
  }

  shatter(center, color, count = 22) {
    for (let i = 0; i < count; i++) {
      const dir = randomDirection()
      this.sparks.emit({
        at: point(center.clone().addScaledVector(dir, 1)),
        velocity: point(dir.multiplyScalar(rand(2, 5))),
        color,
        size: rand(0.12, 0.26),
        life: rand(0.4, 0.8),
        shape: 'shard',
        gravity: -6,
        drag: 1,
      })
    }
  }

  puff(at, color = new THREE.Color('#9a98b8')) {
    for (let i = 0; i < 10; i++) {
      this.sparks.emit({ at: point(at), velocity: point(randomDirection().multiplyScalar(rand(0.4, 1.4))), color, alpha: 0.7, size: rand(0.3, 0.6), life: rand(0.5, 0.9), shape: 'smoke', grow: 1.2, drag: 1.5, haze: true })
    }
  }

  confetti(center, color) {
    for (let i = 0; i < 70; i++) {
      this.sparks.emit({
        at: point(center),
        velocity: [rand(-3, 3), rand(4, 9), rand(-3, 3)],
        color: Math.random() < 0.5 ? color : new THREE.Color('#ffd166'),
        size: rand(0.15, 0.35),
        life: rand(1.2, 2.2),
        shape: pickOne(['star', 'shard', 'glow']),
        gravity: -7,
        drag: 0.8,
      })
    }
  }
}

/**
 * Each school's core for a spell in flight, inside the shared halo. `dir` is
 * the way it flies, so a fireball trails its flame and an ice lance points ahead.
 */
const HEADS = {
  fire(marks, at, s, look, t, dir) {
    marks.draw({ at, color: look.main, size: 1.35 * s, shape: 'flame', dir: dir.clone().negate(), alpha: 0.95 })
    marks.draw({ at, color: look.hot, size: 0.5 * s })
  },
  frost(marks, at, s, look, t, dir) {
    marks.draw({ at, color: mixColor(look.hot, look.main, 0.35), size: 1.4 * s, shape: 'spark', dir })
    marks.draw({ at, color: look.main, size: 0.7 * s, shape: 'flake', angle: t * 3 })
  },
  storm(marks, at, s, look, t) {
    marks.draw({ at, color: look.hot, size: 0.55 * s })
    for (let i = 0; i < 3; i++) marks.draw({ at, color: look.arc, size: rand(0.6, 1.1) * s, shape: 'spark', angle: Math.random() * Math.PI })
  },
  nature(marks, at, s, look, t) {
    marks.draw({ at, color: look.hot, size: 0.45 * s })
    for (let k = 0; k < 3; k++) {
      const a = t * 9 + k * 2.1
      const leaf = at.clone().add(new THREE.Vector3(Math.cos(a) * 0.3 * s, Math.sin(a * 1.3) * 0.15 * s, Math.sin(a) * 0.3 * s))
      marks.draw({ at: leaf, color: k ? look.main : look.deep, size: 0.5 * s, shape: 'leaf', angle: a, solid: true })
    }
  },
  shadow(marks, at, s, look) {
    marks.draw({ at, color: look.main, size: 1.05 * s, shape: 'ring', alpha: 0.7 })
    marks.draw({ at, color: look.smoke, size: 0.72 * s, alpha: 0.95, solid: true })
  },
  holy(marks, at, s, look, t) {
    marks.draw({ at, color: look.hot, size: 1.35 * s, shape: 'star', angle: t * 1.5 })
    marks.draw({ at, color: look.hot, size: 0.45 * s })
  },
  arcane(marks, at, s, look, t) {
    marks.draw({ at, color: look.main, size: 1.05 * s, shape: 'rune', angle: t * 4 })
    marks.draw({ at, color: look.hot, size: 0.5 * s, shape: 'star', angle: -t * 3 })
  },
}

/** Each school's signature when it lands a damaging spell. */
const FLOURISH = {
  fire(looks, at, feet, look, power) {
    for (let i = 0; i < 14 * power; i++) {
      const a = Math.random() * Math.PI * 2
      const r = rand(0.2, 0.75)
      looks.sparks.emit({
        at: [feet.x + Math.cos(a) * r, feet.y + 0.15, feet.z + Math.sin(a) * r],
        velocity: [rand(-0.3, 0.3), rand(2, 4), rand(-0.3, 0.3)],
        color: pickOne([look.main, look.deep, look.hot]),
        size: rand(0.3, 0.55),
        life: rand(0.45, 0.8),
        shape: 'flame',
        drag: 1.2,
        delay: rand(0, 0.12),
      })
    }
    looks.smoke(at.clone().setY(at.y + 0.6), look.smoke, Math.round(4 * power))
  },
  frost(looks, at, feet, look, power) {
    looks.shatter(at, look.hot, Math.round(14 * power))
    looks.mist(feet.clone().setY(feet.y + 0.4), look.mist, Math.round(6 * power))
    looks.rings.spawn({ at: feet, radius: 1.8 * power, color: look.main, life: 0.9, thick: 0.14, time: looks.sparks.time })
  },
  storm(looks, at, feet, look, power) {
    for (let i = 0; i < 2 + Math.round(power); i++) looks.lightning(at, at.clone().add(randomDirection().multiplyScalar(rand(1.2, 2)).setY(rand(-1.2, 0.4))), 'storm')
  },
  nature(looks, at, feet, look, power) {
    for (let i = 0; i < 14 * power; i++) {
      looks.sparks.emit({ at: point(at), velocity: point(randomDirection().multiplyScalar(rand(2, 4.5))), color: pickOne([look.main, look.deep, look.hot]), size: rand(0.22, 0.38), life: rand(0.7, 1.2), shape: 'leaf', gravity: -2.5, drag: 1.6, swirl: rand(-2, 2) })
    }
  },
  shadow(looks, at, feet, look, power) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      looks.sparks.emit({ at: point(at), velocity: [Math.cos(a) * 2.6, rand(-0.3, 0.3), Math.sin(a) * 2.6], color: look.smoke, alpha: 0.75, size: rand(0.8, 1.2) * power, life: rand(0.7, 1), shape: 'smoke', grow: 1, drag: 2, haze: true })
    }
    looks.implode(at, 'shadow', Math.round(16 * power), 1.5)
  },
  holy(looks, at, feet, look, power) {
    const sky = feet.clone().setY(9)
    const shaft = Array.from({ length: 8 }, (_, i) => sky.clone().lerp(feet, i / 7))
    looks.bolts.spawn(shaft, { color: look.main, hot: look.hot, width: 0.32 * power, life: 0.4, time: looks.sparks.time })
    looks.ground(feet, 'holy', 1.6 * power)
  },
  arcane(looks, at, feet, look, power) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      looks.sparks.emit({ at: point(at), velocity: [Math.cos(a) * 3.2, rand(-0.2, 0.4), Math.sin(a) * 3.2], color: i % 2 ? look.main : look.deep, size: 0.34, life: 0.65, shape: 'rune', drag: 2.2 })
    }
  },
}

/**
 * Continuous status visuals, one row per aura look. Particles: `rate` a
 * second of `shape` in `color` at the `where` anchor, moving by `motion`
 * ('school' as color means the aura's school). `tint` colors the mage's rim
 * light while it lasts, so a burning or frozen mage reads at a glance.
 * `mark` is a symbol drawn every frame for as long as the status lasts:
 * `count` copies (or one per charge left) circling `radius` around the
 * anchor at `spin` turns, `front` pulls it toward the camera, `pulse` beats
 * it, and a 'fuse' pulse quickens as the aura runs out.
 */
const STATUS_LOOK = {
  dot: { rate: 12, shape: 'body', color: 'school', where: 'body', motion: 'rise', tint: 'school' },
  hot: { rate: 4, shape: 'cross', color: '#4dff8e', where: 'body', motion: 'rise', tint: '#4dff8e' },
  stun: { rate: 3, shape: 'star', color: '#ffe14d', where: 'crown', motion: 'orbit', tint: '#ffd23d', mark: { shape: 'star', color: '#ffe14d', size: 0.46, count: 3, radius: 0.6, spin: 3.5 } },
  sleep: { rate: 1.6, shape: 'zed', color: '#b9a8ff', where: 'crown', motion: 'doze', tint: '#8f7dff' },
  daze: { rate: 3, shape: 'star', color: '#ffae4d', where: 'crown', motion: 'orbit', tint: '#ffae4d', mark: { shape: 'star', color: '#ffae4d', size: 0.4, count: 2, radius: 0.55, spin: -2.6 } },
  fear: { rate: 8, shape: 'smoke', color: '#3a0f66', where: 'crown', motion: 'drift', haze: true, tint: '#a04dff', shiver: true },
  hush: { rate: 2, shape: 'rune', color: '#ff6ad5', where: 'crown', motion: 'orbit', mark: { shape: 'nosign', color: '#ff4fa8', size: 0.6, radius: 0.62, spin: 1.2 } },
  slow: { rate: 8, shape: 'flake', color: '#9fe6ff', where: 'feet', motion: 'drift', tint: '#5cc8ff' },
  haste: { rate: 7, shape: 'chevron', color: '#fff06a', where: 'body', motion: 'dash', tint: '#ffe94d' },
  expose: { rate: 3, shape: 'shard', color: '#ff4d6a', where: 'chest', motion: 'orbit', mark: { shape: 'target', color: '#ff3355', size: 0.95, front: 0.8, turn: 0.8 } },
  weak: { rate: 3, shape: 'chevron', color: '#8f86b8', where: 'crown', motion: 'sink', tint: '#6f6a90' },
  power: { rate: 4, shape: 'chevron', color: '#ff7a2e', where: 'feet', motion: 'climb', tint: '#ff6a2a' },
  armor: { rate: 2, shape: 'ring', color: '#9ec9ff', where: 'chest', motion: 'still', tint: '#7fb2ff' },
  shield: { rate: 3, shape: 'star', color: '#e2f0ff', where: 'chest', motion: 'orbit' },
  stone: { rate: 6, shape: 'smoke', color: '#8a8478', where: 'feet', motion: 'drift', haze: true },
  thorns: { rate: 8, shape: 'shard', color: '#7dff3a', where: 'chest', motion: 'burst', tint: '#5ee03a' },
  mirror: { rate: 3, shape: 'spark', color: '#e0e8ff', where: 'chest', motion: 'orbit', mark: { shape: 'shard', color: '#dfe8ff', size: 0.42, count: 2, radius: 0.85, spin: 2.2 } },
  immune: { rate: 8, shape: 'star', color: '#fff2a8', where: 'body', motion: 'orbit', tint: '#ffd23d' },
  cheat: { rate: 3, shape: 'glow', color: '#fff3b8', where: 'crown', motion: 'rise' },
  mend: { rate: 2, shape: 'glow', color: '#7dffb0', where: 'chest', motion: 'rise', mark: { shape: 'cross', color: '#4dff8e', size: 0.4, charges: true, radius: 0.85, spin: 1.6 } },
  mana: { rate: 8, shape: 'glow', color: '#4d9dff', where: 'body', motion: 'rise', tint: '#4d8dff' },
  doom: { rate: 8, shape: 'smoke', color: '#2a0612', where: 'crown', motion: 'rise', haze: true, tint: '#ff2a55', mark: { shape: 'rune', color: '#ff2a55', size: 0.62, radius: 0.6, spin: 0.9, pulse: 'fuse' } },
  bomb: { rate: 6, shape: 'spark', color: '#ffb02e', where: 'chest', motion: 'burst', tint: '#ff5a1a', mark: { shape: 'glow', color: '#ff5a1a', size: 1.1, front: 0.75, pulse: 'fuse' } },
  steady: { rate: 3, shape: 'ring', color: '#fff3c8', where: 'feet', motion: 'rise' },
  rewind: { rate: 3, shape: 'glow', color: '#ff7ae0', where: 'body', motion: 'rise', mark: { shape: 'rune', color: '#ff5ad6', size: 0.38, count: 2, radius: 0.8, spin: -2.4 } },
  blight: { rate: 8, shape: 'smoke', color: '#1c3a0a', where: 'body', motion: 'drift', haze: true, tint: '#8cff2a' },
  sheep: { rate: 3, shape: 'glow', color: '#ffffff', where: 'chest', motion: 'drift' },
  root: { rate: 10, shape: 'leaf', color: '#3ee05a', where: 'feet', motion: 'rise', tint: '#36dd52' },
  ice: { rate: 6, shape: 'flake', color: '#d8fbff', where: 'body', motion: 'drift' },
  time: { rate: 6, shape: 'rune', color: '#ffd166', where: 'body', motion: 'still' },
  banish: { rate: 8, shape: 'rune', color: '#c77dff', where: 'body', motion: 'orbit', tint: '#b45cff' },
  boon: { rate: 4, shape: 'glow', color: '#7dffa8', where: 'body', motion: 'rise' },
  bane: { rate: 4, shape: 'glow', color: '#ff7a8a', where: 'body', motion: 'rise' },
}

for (const look of Object.values(STATUS_LOOK)) {
  for (const row of [look, look.mark]) {
    if (!row) continue
    for (const key of ['color', 'tint']) if (row[key] && row[key] !== 'school') row[key] = new THREE.Color(row[key])
  }
}

const STATUS_MOTION = {
  rise: () => ({ offset: [rand(-0.45, 0.45), rand(-0.6, 0.6), rand(-0.45, 0.45)], velocity: [0, rand(0.6, 1.4), 0], life: rand(0.7, 1.1) }),
  fall: () => ({ offset: [rand(-0.45, 0.45), rand(0, 0.8), rand(-0.45, 0.45)], velocity: [0, -rand(0.3, 0.7), 0], life: rand(0.8, 1.2) }),
  drift: () => ({ offset: [rand(-0.5, 0.5), rand(-0.2, 0.4), rand(-0.5, 0.5)], velocity: [rand(-0.2, 0.2), rand(0.2, 0.5), rand(-0.2, 0.2)], life: rand(1, 1.5) }),
  orbit: () => {
    const a = Math.random() * Math.PI * 2
    return { offset: [Math.cos(a) * 0.55, rand(-0.1, 0.1), Math.sin(a) * 0.55], velocity: [0, 0, 0], swirl: 3.2, life: rand(0.8, 1.1) }
  },
  doze: () => ({ offset: [rand(0.1, 0.4), 0.2, rand(-0.2, 0.2)], velocity: [rand(0.2, 0.4), rand(0.5, 0.7), 0], life: rand(1.4, 1.8), grow: 0.8 }),
  dash: () => ({ offset: [rand(-0.55, 0.55), rand(-0.8, 0.2), rand(-0.55, 0.55)], velocity: [0, rand(2.4, 3.4), 0], life: rand(0.35, 0.5) }),
  climb: () => ({ offset: [rand(-0.5, 0.5), 0.1, rand(-0.5, 0.5)], velocity: [0, rand(1.3, 1.8), 0], life: rand(0.9, 1.2) }),
  sink: () => ({ offset: [rand(-0.45, 0.45), rand(0, 0.3), rand(-0.45, 0.45)], velocity: [0, -rand(0.9, 1.3), 0], life: rand(0.9, 1.2) }),
  burst: () => ({ velocity: point(randomDirection().multiplyScalar(rand(0.8, 1.8))), life: rand(0.3, 0.6), drag: 2 }),
  still: () => ({ offset: [rand(-0.5, 0.5), rand(-0.6, 0.6), rand(-0.5, 0.5)], life: rand(0.6, 1) }),
}

// ─── 7 · Figure ─────────────────────────────────────────────────────────────

const GEOMETRY = {}

/** A centripetal Catmull-Rom curve through [radius, height] points, as lathe profile points. */
function profile(points, samples) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal')
  return curve.getSpacedPoints(samples).map((v) => new THREE.Vector2(Math.max(0.001, v.x), v.y))
}

/** Weld a geometry's seams and give it smooth normals. */
function smooth(geometry) {
  for (const name of ['normal', 'uv']) geometry.deleteAttribute(name)
  const welded = mergeVertices(geometry, 1e-4)
  welded.computeVertexNormals()
  return welded
}

/** A lathe, welded and smoothed, with an optional bend applied to each vertex. */
function lathe(points, segments, bend) {
  const geometry = new THREE.LatheGeometry(points, segments)
  if (bend) {
    const position = geometry.attributes.position
    const v = new THREE.Vector3()
    for (let i = 0; i < position.count; i++) position.setXYZ(i, ...bend(v.fromBufferAttribute(position, i)).toArray())
  }
  return smooth(geometry)
}

/** A hexagonal prism with chamfered edges, flat on the floor and `height` tall. */
function hexPrism(radius, height, chamfer) {
  const hex = new THREE.Shape()
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i / 6) * Math.PI * 2
    i ? hex.lineTo(Math.cos(a) * radius, Math.sin(a) * radius) : hex.moveTo(Math.cos(a) * radius, Math.sin(a) * radius)
  }
  const options = { depth: height - chamfer * 2, bevelEnabled: true, bevelThickness: chamfer, bevelSize: chamfer, bevelSegments: 2, curveSegments: 1 }
  return new THREE.ExtrudeGeometry(hex, options).rotateX(-Math.PI / 2).translate(0, chamfer, 0)
}

function shapes() {
  if (GEOMETRY.robe) return GEOMETRY
  const robe = lathe(
    profile(
      [
        [0.001, 0],
        [0.62, 0],
        [0.68, 0.05],
        [0.6, 0.32],
        [0.47, 0.82],
        [0.37, 1.22],
        [0.45, 1.38],
        [0.33, 1.55],
        [0.14, 1.64],
        [0.001, 1.66],
      ],
      32,
    ),
    32,
  )
  const heights = robe.attributes.position
  const shade = new Float32Array(heights.count * 3)
  for (let i = 0; i < heights.count; i++) {
    const t = 0.45 + 0.55 * (heights.getY(i) / 1.66)
    shade.set([t, t, t], i * 3)
  }
  robe.setAttribute('color', new THREE.BufferAttribute(shade, 3))

  // One hat: a tilted brim and a tall cone whose tip droops to the side.
  const brim = new THREE.CylinderGeometry(0.62, 0.66, 0.05, 40).rotateX(0.08).rotateZ(0.05).translate(0, SEAT_Y + 2.0, 0)
  const cone = Array.from({ length: 20 }, (_, i) => {
    const t = i / 19
    return new THREE.Vector2(Math.max(0.001, 0.38 * Math.pow(1 - t, 1.3)), t * 1.02)
  })
  const crown = lathe(cone, 28, (v) => {
    const t = v.y / 1.02
    return v.set(v.x + 0.34 * Math.pow(t, 2.6), v.y - 0.12 * Math.pow(t, 4), v.z - 0.04 * Math.pow(t, 2))
  }).translate(0, SEAT_Y + 1.99, 0)
  brim.deleteAttribute('uv')

  const eye = (x) => new THREE.SphereGeometry(0.038, 10, 6).translate(x, SEAT_Y + 1.85, 0.17)

  Object.assign(GEOMETRY, {
    robe,
    head: new THREE.SphereGeometry(0.21, 24, 16),
    hat: mergeGeometries([brim, crown]),
    band: new THREE.TorusGeometry(0.355, 0.035, 8, 40),
    eyes: mergeGeometries([eye(-0.075), eye(0.075)]),
    staff: new THREE.CylinderGeometry(0.035, 0.05, 2.5, 12),
    knob: new THREE.TorusGeometry(0.06, 0.03, 6, 12),
    gem: new THREE.OctahedronGeometry(0.18, 0).scale(1, 1.25, 1),
    orbit: new THREE.TorusGeometry(0.3, 0.018, 6, 40),
    mote: new THREE.IcosahedronGeometry(0.06, 1),
    collar: new THREE.TorusGeometry(0.3, 0.05, 8, 32),
    belt: new THREE.TorusGeometry(0.44, 0.035, 6, 40),
    arm: new THREE.CylinderGeometry(0.07, 0.14, 0.75, 16),
    base: hexPrism(1.0, 0.24, 0.045),
    rim: new THREE.TorusGeometry(1.0, 0.03, 8, 6),
    disc: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    bubble: new THREE.SphereGeometry(1.2, 48, 32),
    ice: new THREE.IcosahedronGeometry(1, 1),
    wool: new THREE.IcosahedronGeometry(0.3, 3),
    arrow: new THREE.ConeGeometry(0.16, 0.34, 4).rotateX(Math.PI),
    nimbus: new THREE.TorusGeometry(0.3, 0.032, 8, 40),
  })
  return GEOMETRY
}

const BUBBLE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 world = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-world.xyz);
    gl_Position = projectionMatrix * world;
  }
`
const BUBBLE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uPower;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(vNormal, vView)), 2.4);
    float bands = 0.5 + 0.5 * sin(vNormal.y * 18.0 - uTime * 3.0);
    float a = (rim * 0.9 + bands * 0.06) * uPower;
    gl_FragColor = vec4(uColor * a, a);
  }
`

/**
 * Give a standard material a soft rim of `color` where the surface turns away
 * from the camera, so robes read against the dark arena without flat shading.
 * The uniform is kept in userData.rim so statuses can recolor it.
 */
function addRim(material, color, strength = 0.4) {
  const rim = { value: color.clone().multiplyScalar(strength) }
  material.userData.rim = rim
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = rim
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uRim;\nvoid main() {')
      .replace('#include <opaque_fragment>', 'outgoingLight += uRim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);\n#include <opaque_fragment>')
  }
  material.customProgramCacheKey = () => 'rim'
  return material
}

const SEAT_Y = 0.24
/** Symbol particles are drawn big enough to read; other shapes pick their own size. */
const SYMBOL_SIZE = { cross: 0.3, chevron: 0.32, zed: 0.36 }
const RIM_GOAL = new THREE.Color()
const MARK_AT = new THREE.Vector3()
const MARK_SPOT = new THREE.Vector3()
const TOWARD = new THREE.Vector3()
const BASE_TEXT = new THREE.Color('#1b1e3a')
const TINTS = { flash: new THREE.Color('#ffffff'), stone: new THREE.Color('#8a8478'), time: new THREE.Color('#ffd166') }
const FLOW_COLOR = new THREE.Color('#ffc94a')
const CALL_COLOR = new THREE.Color('#ff5a3c')
const WISP_CORE = new THREE.Color('#f2f6ff')

/** One mage on the field: model, idle motion, casting, hits and statuses. */
class Figure {
  constructor(stage, mage, size) {
    const geo = shapes()
    const tex = textures()
    this.stage = stage
    this.id = mage.id
    this.team = mage.team
    this.phase = Math.random() * 10
    this.state = null
    this.cast = null
    this.kick = 0
    this.flash = 0
    this.fallen = 0
    this.lift = 0
    this.emit = {}
    this.wardUntil = 0
    this.calledUntil = 0
    this.wisp = new THREE.Vector3()

    const glow = new THREE.Color(TEAM_GLOW[mage.team]).offsetHSL(((mage.slot % 3) - 1) * 0.03, 0, 0)
    const robe = new THREE.Color(TEAM_ROBE[mage.team]).offsetHSL(((mage.slot % 3) - 1) * 0.04, 0, 0)
    this.glow = glow

    const { x, z } = place(mage.team, mage.slot, size)
    this.root = new THREE.Group()
    this.root.position.set(x, 0, z)
    this.root.rotation.y = mage.team === 0 ? Math.PI : 0
    this.body = new THREE.Group()
    this.root.add(this.body)

    this.robeMaterial = addRim(new THREE.MeshStandardMaterial({ color: robe, vertexColors: true, roughness: 0.62, metalness: 0.08, emissive: glow, emissiveIntensity: 0.05, transparent: true }), glow)
    this.trimMaterial = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 0.8, roughness: 0.3 })
    const gold = new THREE.MeshStandardMaterial({ color: '#c79a52', roughness: 0.3, metalness: 0.9 })
    this.hatMaterial = addRim(new THREE.MeshStandardMaterial({ color: robe.clone().multiplyScalar(0.75), roughness: 0.66, metalness: 0.05, transparent: true }), glow, 0.3)
    this.gemMaterial = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.2, flatShading: true })
    const face = new THREE.MeshStandardMaterial({ color: '#0b0a18', roughness: 0.85 })
    const eyes = new THREE.MeshBasicMaterial({ color: glow.clone().lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(1.8) })
    const wood = new THREE.MeshStandardMaterial({ color: '#4a3024', roughness: 0.75 })

    const add = (geometry, material, position, rotation = [0, 0, 0], parent = this.body) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(...position)
      mesh.rotation.set(...rotation)
      parent.add(mesh)
      return mesh
    }

    add(geo.robe, this.robeMaterial, [0, SEAT_Y, 0])
    add(geo.belt, gold, [0, SEAT_Y + 0.9, 0], [Math.PI / 2, 0, 0])
    add(geo.collar, this.trimMaterial, [0, SEAT_Y + 1.5, 0], [Math.PI / 2, 0, 0])
    add(geo.head, face, [0, SEAT_Y + 1.82, 0])
    add(geo.eyes, eyes, [0, 0, 0])
    add(geo.hat, this.hatMaterial, [0, 0, 0])
    add(geo.band, this.trimMaterial, [0, SEAT_Y + 2.07, 0], [Math.PI / 2, 0, 0])
    this.arm = add(geo.arm, this.robeMaterial, [0.4, SEAT_Y + 1.2, 0.12], [0.3, 0, 0.8])
    add(geo.arm, this.robeMaterial, [-0.38, SEAT_Y + 1.12, 0.06], [0.15, 0, -0.45])
    this.staff = new THREE.Group()
    this.staff.position.set(0.62, SEAT_Y + 1.2, 0.24)
    this.body.add(this.staff)
    add(geo.staff, wood, [0, 0, 0], [0, 0, 0], this.staff)
    add(geo.knob, gold, [0, 1.22, 0], [Math.PI / 2, 0, 0], this.staff)
    this.gem = add(geo.gem, this.gemMaterial, [0, 1.42, 0], [0, 0, 0], this.staff)
    this.orbit = add(geo.orbit, gold, [0, 1.42, 0], [Math.PI / 2.4, 0, 0], this.staff)
    this.motes = [0, 1].map(() => add(geo.mote, this.trimMaterial, [0, SEAT_Y + 1.1, 0]))
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.32 }))
    this.halo.scale.setScalar(0.7)
    this.gem.add(this.halo)

    add(geo.base, new THREE.MeshStandardMaterial({ color: BASE_TEXT, roughness: 0.4, metalness: 0.45, flatShading: true }), [0, 0, 0], [0, 0, 0], this.root)
    add(geo.rim, this.trimMaterial, [0, SEAT_Y + 0.005, 0], [Math.PI / 2, 0, Math.PI / 6], this.root)
    const pool = add(geo.disc, new THREE.MeshBasicMaterial({ map: tex.glow, color: glow, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }), [0, 0.02, 0], [0, 0, 0], this.root)
    pool.scale.setScalar(4.2)

    // The casting circle takes the sigil and color of the spell's school.
    this.circle = add(geo.disc, new THREE.MeshBasicMaterial({ map: sigilTexture('arcane'), color: glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), [0, SEAT_Y + 0.03, 0], [0, 0, 0], this.root)
    this.circle.scale.setScalar(2.6)

    // A golden ring over the hat while death is held off (Death Ward, Guardian Spirit).
    this.nimbus = add(geo.nimbus, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc93d').multiplyScalar(1.6) }), [0, SEAT_Y + 3.05, 0], [Math.PI / 2 - 0.2, 0, 0], this.body)
    this.nimbus.visible = false

    this.bubble = add(
      geo.bubble,
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#bfe0ff') }, uTime: { value: 0 }, uPower: { value: 0 } },
        vertexShader: BUBBLE_VERTEX,
        fragmentShader: BUBBLE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      [0, SEAT_Y + 1.15, 0],
      [0, 0, 0],
      this.root,
    )
    this.bubble.scale.set(1, 1.25, 1)
    this.bubble.visible = false

    this.ice = add(geo.ice, new THREE.MeshStandardMaterial({ color: '#bff4ff', emissive: '#2a7fff', emissiveIntensity: 0.35, transparent: true, opacity: 0.42, roughness: 0.1, flatShading: true, depthWrite: false }), [0, SEAT_Y + 1.1, 0], [0, 0.4, 0], this.root)
    this.ice.scale.set(0.95, 1.45, 0.95)
    this.ice.visible = false

    this.sheep = this.makeSheep()
    this.root.add(this.sheep)
    this.sheep.visible = false

    stage.scene.add(this.root)
  }

  makeSheep() {
    const geo = shapes()
    const sheep = new THREE.Group()
    const wool = new THREE.MeshStandardMaterial({ color: '#f4f1ff', roughness: 0.95 })
    const skin = new THREE.MeshStandardMaterial({ color: '#2a2438', roughness: 0.8 })
    for (const [x, y, z, s] of [
      [0, 0.6, 0, 1.3],
      [0.25, 0.65, 0.1, 1],
      [-0.25, 0.65, -0.05, 1],
      [0, 0.82, -0.15, 1],
      [0.05, 0.75, 0.2, 0.9],
    ]) {
      const puff = new THREE.Mesh(geo.wool, wool)
      puff.position.set(x, SEAT_Y + y, z)
      puff.scale.setScalar(s)
      sheep.add(puff)
    }
    const head = new THREE.Mesh(geo.head, skin)
    head.position.set(0, SEAT_Y + 0.82, 0.45)
    head.scale.set(0.9, 0.8, 1.1)
    sheep.add(head)
    return sheep
  }

  // Anchors ──────────────────────────────────────────────────────────────

  /** World points on the mage. `crown` circles the hat; `top` clears the halo, for the far row's plate. */
  anchor(name, out = new THREE.Vector3()) {
    // A fallen mage casts from its wisp, which floats over the body.
    if (name === 'gem' && this.state?.down) return out.copy(this.wisp)
    if (name === 'gem') return this.gem.getWorldPosition(out)
    const heights = { top: 3.5, head: 3.05, crown: 2.62, chest: 1.3, feet: SEAT_Y, body: 1.1 }
    out.copy(this.root.position)
    out.y = (heights[name] ?? 1.2) - this.lift
    return out
  }

  // Events ───────────────────────────────────────────────────────────────

  beginCast(spell) {
    const look = schoolLook(spell.school)
    this.cast = { school: spell.school, start: this.stage.time }
    this.circle.material.map = sigilTexture(spell.school)
    this.circle.material.color.copy(look.main)
    this.gemMaterial.emissive.copy(look.main)
    this.halo.material.color.copy(look.main)
  }

  endCast(broken) {
    if (broken && this.cast) this.stage.looks.shatter(this.anchor('feet').setY(0.5), schoolLook(this.cast.school).main, 12)
    this.cast = null
  }

  release(spell) {
    const look = schoolLook(spell.school)
    this.gemMaterial.emissive.copy(look.main)
    this.halo.material.color.copy(look.main)
    this.stage.looks.flash(this.anchor('gem'), look.main, 1.3, 0.22, 0.6)
    this.flare = 1
  }

  /** A ward goes up: a bright shell for its short window. */
  raiseWard() {
    this.wardUntil = this.stage.time + TIMING.ward
    this.stage.looks.flash(this.anchor('chest'), new THREE.Color('#fff2c4'), 1.4, 0.25, 0.7)
  }

  /** A parry: the shell flares and throws off golden shards. */
  parry() {
    this.wardUntil = this.stage.time + 0.25
    const chest = this.anchor('chest')
    this.stage.looks.shatter(chest, new THREE.Color('#ffe9a8'), 22)
    this.stage.looks.flash(chest, new THREE.Color('#fff6d8'), 2.6, 0.35, 0.9)
    this.stage.rings.spawn({ at: this.anchor('feet'), radius: 3.2, color: new THREE.Color('#ffd166'), life: 0.5, thick: 0.1, time: this.stage.sparks.time })
  }

  /** Flinch from a hit. Damage over time ticks flinch less and barely flash. */
  hit(share, direct = true) {
    this.kick = Math.min(1, this.kick + (direct ? 0.4 : 0.1) + share * 3)
    this.flash = Math.max(this.flash, direct ? 1 : 0.35)
  }

  // Frame ────────────────────────────────────────────────────────────────

  update(dt, time) {
    const state = this.state
    const looks = new Set(state?.auras.map((a) => a.look) ?? [])
    const locked = state?.lock === 'stun' || state?.lock === 'sleep'
    const down = Boolean(state?.down)

    this.kick = Math.max(0, this.kick - dt * 3)
    this.flash = Math.max(0, this.flash - dt * 7)
    this.flare = Math.max(0, (this.flare ?? 0) - dt * 2.5)
    this.fallen = clamp(this.fallen + (down ? dt * 1.6 : -dt * 2), 0, 1)

    const bob = locked || down ? 0 : Math.sin(time * 1.7 + this.phase) * 0.05
    const shiver = looks.has('fear') && !down ? Math.sin(time * 47) * 0.035 : 0
    const castShare = state?.cast ? state.cast.done / state.cast.total : 0
    const fall = ease(this.fallen)
    this.body.position.set(shiver, bob - fall * 0.35, -this.kick * 0.25)
    this.body.rotation.set(-this.kick * 0.25 - fall * 1.35 + castShare * 0.06, Math.sin(time * 0.6 + this.phase) * 0.06, Math.sin(time * 1.1 + this.phase) * 0.02)
    this.staff.rotation.set(state?.cast ? -0.35 : 0.05 * Math.sin(time + this.phase), 0, state?.cast ? -0.15 : 0)
    this.arm.rotation.z = state?.cast ? 1.05 : 0.8
    this.orbit.rotation.z += dt * (state?.cast ? 6 : 1.5)
    this.motes.forEach((mote, i) => {
      const a = time * 1.3 + this.phase + i * Math.PI
      mote.position.set(Math.cos(a) * 0.85, SEAT_Y + 1.2 + Math.sin(a * 1.7) * 0.25, Math.sin(a) * 0.85)
      mote.visible = !down
    })
    this.lift = fall * 1.2

    const sheep = looks.has('sheep')
    const ghost = looks.has('banish') || down
    this.body.visible = !sheep
    this.sheep.visible = sheep && !down
    if (sheep) this.sheep.rotation.y = Math.sin(time * 2) * 0.2
    this.ice.visible = looks.has('ice') && !down
    this.ice.rotation.y += dt * 0.2
    this.nimbus.visible = looks.has('cheat') && !down
    if (this.nimbus.visible) this.nimbus.position.y = SEAT_Y + 3.05 + Math.sin(time * 2.2) * 0.04

    const opacity = ghost ? (down ? 0.35 : 0.45) : 1
    this.robeMaterial.opacity = this.hatMaterial.opacity = opacity
    const stone = looks.has('stone') || looks.has('time')
    const status = this.tintRim(dt, time, state, down)
    this.robeMaterial.emissive.copy(this.flash > 0 ? TINTS.flash : stone ? (looks.has('time') ? TINTS.time : TINTS.stone) : (status ?? this.glow))
    this.robeMaterial.emissiveIntensity = 0.05 + this.flash * this.flash * 0.22 + (stone ? 0.35 : status ? 0.1 + 0.05 * Math.sin(time * 5 + this.phase) : 0)

    const casting = Boolean(state?.cast)
    const target = casting ? 0.9 : 0
    this.circle.material.opacity += (target - this.circle.material.opacity) * Math.min(1, dt * 10)
    this.circle.rotation.y += dt * (casting ? 1.6 : 0.4)
    this.circle.scale.setScalar(1.9 + castShare * 1.3)
    this.gemMaterial.emissiveIntensity = 1.4 + (casting ? 0.8 + castShare * 1.4 : 0) + this.flare * 2
    this.halo.scale.setScalar(0.7 + (casting ? 0.25 + castShare * 0.35 : 0) + this.flare * 0.4)
    if (!casting) {
      this.gemMaterial.emissive.lerp(this.glow, Math.min(1, dt * 2))
      this.halo.material.color.lerp(this.glow, Math.min(1, dt * 2))
    }

    const guard = (state?.guard ?? 0) > 0
    const immune = looks.has('immune') || looks.has('banish')
    const warded = Boolean(state?.ward) || this.stage.time < this.wardUntil
    this.bubble.visible = (guard || immune || warded) && !down
    if (this.bubble.visible) {
      const uniforms = this.bubble.material.uniforms
      uniforms.uColor.value.set(warded ? '#fff0b8' : looks.has('banish') ? '#b45cff' : immune ? '#ffc93d' : looks.has('stone') ? '#c9b98f' : '#7cc4ff')
      uniforms.uTime.value = time
      uniforms.uPower.value = warded ? 1.6 : 0.6 + this.kick * 0.6
    }

    if (casting && !down) this.emitCast(dt, castShare)
    if (state && !down) {
      this.emitStatus(dt, state)
      this.drawMarks(time, state)
    }
    if (down && this.stage.mode === 'match') this.drift(dt, time)
    if (this.stage.time < this.calledUntil) {
      const left = (this.calledUntil - this.stage.time) / TIMING.call
      this.stage.marks.draw({ at: this.anchor('top', MARK_AT), color: CALL_COLOR, size: 1.05 + Math.sin(time * 6) * 0.08, shape: 'target', angle: time * 0.8, alpha: 0.5 + 0.5 * Math.min(1, left * 4) })
    }
  }

  /** A fallen mage floats over its body as a wisp in its team's color. */
  drift(dt, time) {
    const feet = this.anchor('feet')
    this.wisp.set(feet.x + Math.sin(time * 0.9 + this.phase) * 0.25, 2.3 + Math.sin(time * 1.7 + this.phase) * 0.18, feet.z)
    const marks = this.stage.marks
    marks.draw({ at: this.wisp, color: this.glow, size: 1.1 + Math.sin(time * 3) * 0.08, shape: 'glow', alpha: 0.7 })
    marks.draw({ at: this.wisp, color: WISP_CORE, size: 0.42, shape: 'glow', alpha: 0.95 })
    if (Math.random() < dt * 14) {
      this.stage.sparks.emit({ at: point(this.wisp), offset: [rand(-0.2, 0.2), rand(-0.2, 0.2), rand(-0.2, 0.2)], velocity: [rand(-0.15, 0.15), rand(0.3, 0.7), rand(-0.15, 0.15)], color: this.glow, size: rand(0.06, 0.14), life: rand(0.6, 1), shape: 'glow' })
    }
  }

  /**
   * Recolor the rim light by the most telling status: banes before boons,
   * pulsing, so a burning, frozen or empowered mage reads from its outline.
   * Returns that status color (or null) for the robe's faint glow.
   */
  tintRim(dt, time, state, down) {
    let tinted = null
    for (const aura of state?.auras ?? []) {
      const look = STATUS_LOOK[aura.look]
      if (!look?.tint || down) continue
      if (!tinted || (aura.kind === 'bane' && tinted.kind !== 'bane')) tinted = { kind: aura.kind, color: look.tint === 'school' ? schoolLook(aura.school).main : look.tint }
    }
    const goal = RIM_GOAL.copy(tinted ? tinted.color : this.glow).multiplyScalar(tinted ? 0.85 + 0.35 * Math.sin(time * 5 + this.phase) : 0.4)
    const k = Math.min(1, dt * 8)
    this.robeMaterial.userData.rim.value.lerp(goal, k)
    this.hatMaterial.userData.rim.value.lerp(goal.multiplyScalar(0.8), k)
    return tinted?.color ?? null
  }

  emitCast(dt, share) {
    if (!this.cast || Math.random() > dt * 40) return
    const look = schoolLook(this.cast.school)
    const gem = this.anchor('gem')
    const dir = randomDirection().multiplyScalar(1.1 - share * 0.4)
    this.stage.sparks.emit({ at: point(gem), offset: point(dir), velocity: point(dir.clone().multiplyScalar(-2.2)), color: tint(look), size: rand(0.08, 0.18), life: 0.45, shape: look.bit === 'ring' ? 'glow' : look.bit })
    // The school's bodies rise from the casting circle as the cast fills.
    if (Math.random() < 0.35 + share * 0.4) {
      const a = Math.random() * Math.PI * 2
      const feet = this.anchor('feet')
      const r = 0.9 + share * 0.6
      this.stage.sparks.emit({ at: [feet.x + Math.cos(a) * r, feet.y + 0.08, feet.z + Math.sin(a) * r], velocity: [0, rand(0.8, 1.6), 0], color: tint(look), alpha: 0.85, size: rand(0.14, 0.26), life: rand(0.5, 0.8), shape: look.body, drag: 0.6 })
    }
  }

  emitStatus(dt, state) {
    for (const aura of state.auras) {
      const look = STATUS_LOOK[aura.look] ?? STATUS_LOOK[aura.kind]
      if (!look) continue
      this.emit[aura.look] = (this.emit[aura.look] ?? Math.random()) + look.rate * dt
      while (this.emit[aura.look] >= 1) {
        this.emit[aura.look]--
        const school = schoolLook(aura.school)
        const color = look.color === 'school' ? tint(school) : look.color
        const shape = look.shape === 'body' ? school.body : look.shape
        const motion = STATUS_MOTION[look.motion]()
        const at = this.anchor(look.where)
        const size = SYMBOL_SIZE[shape] ?? rand(0.1, 0.24) * (look.haze ? 3 : 1)
        this.stage.sparks.emit({ at: point(at), color, shape, size, alpha: look.haze ? 0.6 : 0.85, haze: look.haze, grow: look.haze ? 1 : 0, ...motion })
      }
    }
  }

  /** Status symbols for this frame: they last exactly as long as the status. Flow stacks circle the feet. */
  drawMarks(time, state) {
    const marks = this.stage.marks
    const flow = state.flow ?? 0
    if (flow) {
      const feet = this.anchor('feet', MARK_AT)
      const full = flow >= TIMING.flow
      for (let k = 0; k < flow; k++) {
        const a = time * (full ? 2.6 : 1.4) + (k / flow) * Math.PI * 2 + this.phase
        MARK_SPOT.set(feet.x + Math.cos(a) * 1.05, feet.y + 0.35, feet.z + Math.sin(a) * 1.05)
        marks.draw({ at: MARK_SPOT, color: FLOW_COLOR, size: full ? 0.34 : 0.24, shape: 'star', angle: time * 2, alpha: full ? 1 : 0.8 })
      }
    }
    for (const aura of state.auras) {
      const mark = STATUS_LOOK[aura.look]?.mark
      if (!mark) continue
      const left = aura.total ? clamp(aura.left / aura.total, 0, 1) : 1
      const beat = mark.pulse === 'fuse' ? Math.sin(time * (4 + 16 * (1 - left))) : mark.pulse ? Math.sin(time * 4) : 0
      const size = mark.size * (1 + beat * 0.18)
      const count = mark.charges ? clamp(aura.charges ?? 1, 1, 5) : (mark.count ?? 1)
      const base = this.anchor(STATUS_LOOK[aura.look].where === 'crown' ? 'crown' : 'chest', MARK_AT)
      if (mark.front) base.add(TOWARD.copy(this.stage.camera.position).sub(base).setY(0).normalize().multiplyScalar(mark.front))
      for (let k = 0; k < count; k++) {
        const a = time * (mark.spin ?? 0) + (k / count) * Math.PI * 2 + this.phase
        const r = mark.radius ?? 0
        MARK_SPOT.set(base.x + Math.cos(a) * r, base.y + Math.sin(a * 2) * 0.06 * Math.sign(r), base.z + Math.sin(a) * r)
        marks.draw({ at: MARK_SPOT, color: mark.color, size, shape: mark.shape, angle: (mark.turn ?? 0) * time, alpha: 0.75 + beat * 0.25 })
      }
    }
  }

  /** Remove from the scene and free per-figure materials (geometries are shared). */
  dispose() {
    this.stage.scene.remove(this.root)
    this.root.traverse((part) => part.material?.dispose())
  }
}

// ─── 8 · Flight ─────────────────────────────────────────────────────────────

/** How many heads a volley throws: one per top-level hit, or the scatter count. */
function volleyCount(spell) {
  let count = 0
  walkActs(Array.isArray(spell.acts) ? spell.acts : spell.acts.foe, (act) => {
    if (act.op === 'harm' || act.op === 'heal') count++
    if (act.op === 'scatter') count = Math.max(count, act.count)
  })
  return clamp(count, 2, 6)
}

/** One spell traveling from a caster to a target, drawn by its flight style. */
class Flight {
  constructor(stage, spell, from, to, duration, delay = 0) {
    this.stage = stage
    this.spell = spell
    this.school = spell.school
    this.from = from
    this.to = to
    this.start = stage.time + delay
    this.duration = Math.max(0.12, duration - delay)
    this.done = false
    this.power = 0.7 + spell.tier * 0.3
    this.heads = spell.flight === 'volley' ? volleyCount(spell) : 1
    this.bends = Array.from({ length: this.heads }, () => new THREE.Vector3(rand(-1.8, 1.8), rand(1, 2.6), rand(-0.6, 0.6)))
    this.sky = new THREE.Vector3(rand(-2, 2), 11, rand(-2, 2))
    this.lastArc = 0
  }

  /** Point along the flight at share t for head i. */
  path(t, i = 0, out = new THREE.Vector3()) {
    const a = this.from.anchor('gem')
    const b = this.to.anchor('chest')
    if (this.spell.flight === 'fall') {
      const top = b.clone().add(this.sky)
      return out.copy(top).lerp(b, t * t)
    }
    const mid = a.clone().lerp(b, 0.5).add(this.bends[i])
    const u = 1 - t
    return out.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(mid, 2 * u * t).addScaledVector(b, t * t)
  }

  /** Draw head i at share t, turned the way it flies. */
  head(t, i, scale) {
    const at = this.path(t, i)
    const dir = this.path(Math.min(1, t + 0.02), i).sub(this.path(Math.max(0, t - 0.02), i))
    this.stage.looks.head(at, this.school, scale, dir)
  }

  /**
   * Draw one frame. Trails are laid at 60 puffs a second along the stretch
   * flown since the last frame, so they look the same at any frame rate.
   */
  update(time, dt) {
    const t = (time - this.start) / this.duration
    if (t < 0) return true
    const looks = this.stage.looks
    const style = this.spell.flight
    const share = Math.min(1, t)
    const before = this.share ?? 0
    this.share = share
    this.carry = (this.carry ?? 0) + dt * 60
    const puffs = Math.floor(this.carry)
    this.carry -= puffs
    const along = (from, to, draw) => {
      for (let k = 1; k <= puffs; k++) draw(from + ((to - from) * k) / puffs)
    }
    if (style === 'bolt' || style === 'fall') {
      const scale = this.power * (style === 'fall' ? 1.3 : 1)
      along(before, share, (s) => looks.trail(this.path(s), this.school, scale))
      this.head(share, 0, scale * 0.62)
    } else if (style === 'volley') {
      const head = (at, i) => clamp((at - i * 0.08) / (1 - (this.heads - 1) * 0.08), 0, 1)
      for (let i = 0; i < this.heads; i++) {
        along(head(before, i), head(share, i), (s) => s > 0 && s < 1 && looks.trail(this.path(s, i), this.school, 0.55))
        if (head(share, i) > 0 && head(share, i) < 1) this.head(head(share, i), i, 0.42)
      }
    } else if (style === 'beam') {
      this.ribbon = looks.beam(this.from.anchor('gem'), this.to.anchor('chest'), this.school, 0.16 + this.power * 0.05, this.ribbon)
      looks.stream(this.from.anchor('gem'), this.to.anchor('chest'), this.school, 0.12, dt * 20)
    } else if (style === 'arc') {
      if (time - this.lastArc > 0.05) {
        this.lastArc = time
        looks.lightning(this.from.anchor('gem'), this.to.anchor('chest'), this.school)
      }
    } else if (style === 'rise') {
      looks.stream(this.to.anchor('feet').setY(0.3), this.to.anchor('chest'), this.school, 0.3, dt * 30)
    } else if (style === 'aura' || style === 'nova') {
      along(before, share, (s) => Math.random() < 0.6 && looks.trail(this.path(s), this.school, 0.45))
      if (share < 1) this.head(share, 0, 0.4)
    }
    return t < 1 + (style === 'beam' ? 0.25 : 0)
  }
}

// ─── 9 · Stage ──────────────────────────────────────────────────────────────

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const SKY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSurge;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(vec3(0.07, 0.025, 0.12), vec3(0.03, 0.018, 0.09), smoothstep(-0.05, 0.3, h));
    col = mix(col, vec3(0.008, 0.008, 0.03), smoothstep(0.3, 0.95, h));
    float drift = uTime * 0.012;
    float teal = pow(fbm(d * 2.6 + vec3(drift, 0.0, 0.0)), 3.0);
    float rose = pow(fbm(d * 3.1 + vec3(5.0, drift, 2.0)), 3.0);
    float lift = smoothstep(-0.1, 0.55, h);
    col += vec3(0.05, 0.5, 0.65) * teal * lift * 1.0;
    col += vec3(0.6, 0.1, 0.5) * rose * lift * 0.8;
    col += vec3(0.8, 0.3, 0.6) * exp(-abs(h - 0.02) * 18.0) * 0.12;
    col += vec3(1.0, 0.1, 0.25) * uSurge * 0.25 * exp(-abs(h) * 4.0);
    gl_FragColor = vec4(col, 1.0);
  }
`

const FLOOR_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`
const FLOOR_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSurge;
  uniform vec3 uDawn;
  uniform vec3 uDusk;
  varying vec3 vWorld;

  // A line of half-width w around v = 0. Lines thinner than a pixel draw a
  // pixel wide but fainter, so far lines fade out instead of shimmering.
  float line(float v, float w) {
    float aa = max(fwidth(v), 1e-5);
    float drawn = max(w, aa);
    return (1.0 - smoothstep(drawn - aa, drawn + aa, abs(v))) * clamp(w / drawn, 0.0, 1.0);
  }

  // Grid lines filtered by their on-screen size (after Ben Golus' pristine grid).
  float grid(vec2 uv, float width) {
    vec2 d = max(fwidth(uv), vec2(1e-5));
    vec2 drawn = max(vec2(width), d);
    vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
    vec2 lines = smoothstep(drawn + d * 1.5, drawn - d * 1.5, g) * clamp(width / drawn, 0.0, 1.0);
    lines = mix(lines, vec2(width), clamp(d * 2.0 - 1.0, 0.0, 1.0));
    return mix(lines.x, 1.0, lines.y);
  }

  void main() {
    vec2 p = vWorld.xz;
    float r = length(p);
    float ang = atan(p.y, p.x);
    vec3 base = vec3(0.035, 0.03, 0.085) * (1.25 - smoothstep(0.0, 22.0, r) * 0.6);
    vec3 side = p.y > 0.0 ? uDawn : uDusk;
    float sideFade = smoothstep(0.0, 2.0, abs(p.y)) * (1.0 - smoothstep(6.0, 14.0, abs(p.y)));
    float cells = grid(p * 0.5, 0.06) * (1.0 - smoothstep(8.0, 18.0, r));
    vec3 col = base + side * (cells * 0.07 + sideFade * 0.025);
    float spin = ang + uTime * 0.05;
    float ringA = line(r - 10.2, 0.05) + line(r - 10.7, 0.03);
    // Tick marks: distance to the nearest tick in turns, filtered by how many turns a pixel spans.
    float turns = spin * 24.0 / 6.2832;
    float turnWidth = length(fwidth(p)) / max(r, 1e-3) * 24.0 / 6.2832;
    float tick = abs(fract(turns + 0.54) - 0.5);
    float ticks = line(r - 10.45, 0.22) * (1.0 - smoothstep(0.04 - turnWidth, 0.04 + turnWidth, tick));
    float ringB = line(r - 15.5, 0.06) * (0.6 + 0.4 * sin(spin * 6.0 + uTime));
    col += mix(vec3(0.45, 0.35, 1.0), vec3(1.0, 0.75, 0.35), 0.5 + 0.5 * sin(ang * 2.0 + uTime * 0.3)) * (ringA + ticks) * 0.55;
    col += vec3(0.6, 0.4, 1.0) * ringB * 0.35;
    float rift = exp(-abs(p.y) * 2.6) * (1.0 - smoothstep(9.0, 16.0, abs(p.x)));
    float flow = 0.6 + 0.4 * sin(p.x * 1.7 - uTime * 2.0);
    col += mix(uDawn, uDusk, 0.5 + 0.5 * sin(p.x * 0.6 + uTime * 0.4)) * rift * flow * (0.3 + uSurge * 1.2);
    col += vec3(1.0, 0.95, 1.0) * exp(-abs(p.y) * 14.0) * (1.0 - smoothstep(8.0, 15.0, abs(p.x))) * 0.18;
    float edge = 1.0 - smoothstep(19.0, 24.0, r);
    gl_FragColor = vec4(col * edge, 1.0);
  }
`
const RIFT_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSurge;
  uniform vec3 uDawn;
  uniform vec3 uDusk;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    float n = noise(vec2(vUv.x * 22.0, vUv.y * 3.0 - uTime * 1.3));
    float streak = pow(noise(vec2(vUv.x * 70.0, uTime * 0.6)), 5.0);
    float fadeY = pow(1.0 - vUv.y, 2.2);
    float fadeX = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
    vec3 col = mix(uDawn, uDusk, 0.5 + 0.5 * sin(vUv.x * 14.0 + uTime * 0.8));
    col = mix(col, vec3(1.0), streak * 0.6);
    float a = (0.05 + 0.3 * n * n + 0.6 * streak) * fadeY * fadeX * (0.6 + uSurge * 1.5);
    gl_FragColor = vec4(col * a, a);
  }
`

/**
 * Bloom's bright pass, rewritten: brightness is the brightest channel, not
 * luminance, so a saturated red or blue glows as readily as white, and only
 * the part above the threshold (with a soft knee) blooms, so a bright patch
 * gets a halo of its own color instead of a white haze.
 */
const BRIGHT_PASS = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  varying vec2 vUv;
  void main() {
    vec3 color = texture2D(tDiffuse, vUv).rgb;
    float bright = max(color.r, max(color.g, color.b));
    float knee = clamp(bright - luminosityThreshold + smoothWidth, 0.0, 2.0 * smoothWidth);
    knee = knee * knee / (4.0 * smoothWidth + 1e-5);
    gl_FragColor = vec4(color * max(knee, bright - luminosityThreshold) / max(bright, 1e-4), 1.0);
  }
`

/** The final pass: tone mapping and sRGB, plus a little noise so dark gradients do not band. */
function ditheredOutput() {
  const pass = new OutputPass()
  const dither = 'gl_FragColor.rgb += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;'
  pass.material.fragmentShader = pass.material.fragmentShader.replace(/}\s*$/, `  ${dither}\n}`)
  return pass
}

/**
 * Render quality tiers. Each caps the pixel ratio, sets the MSAA samples of
 * the scene buffer and thins small particles. The stage starts from a guess
 * about the device and the governor moves between tiers as frames allow.
 */
const QUALITY = [
  { name: 'low', ratio: 0.85, samples: 0, density: 0.5 },
  { name: 'medium', ratio: 1, samples: 2, density: 0.75 },
  { name: 'high', ratio: 1.5, samples: 4, density: 1 },
  { name: 'ultra', ratio: 2, samples: 4, density: 1 },
]

/** The tier to start on: `?quality=` pins one, else a guess from the GPU and device. */
function startQuality(renderer) {
  const asked = QUALITY.findIndex((tier) => tier.name === new URLSearchParams(location.search).get('quality'))
  if (asked >= 0) return { tier: asked, pinned: true }
  const gl = renderer.getContext()
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  const gpu = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)) return { tier: 0, pinned: false }
  const small = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3
  const touch = matchMedia('(pointer: coarse)').matches
  return { tier: small ? 1 : touch ? 2 : 3, pinned: false }
}

/** The 3D world: arena, mages, particles, flights, camera and post effects. */
class Stage {
  constructor(canvas) {
    this.canvas = canvas
    this.time = 0
    this.figures = new Map()
    this.flights = []
    this.shakeLevel = 0
    this.surge = 0
    this.mode = 'attract'
    this.viewer = 0
    this.span = 1
    this.cursor = null
    this.motes = 0
    this.band = [0, 1, 0, 1]

    // Antialiasing comes from the multisampled scene buffer below, so the
    // canvas itself needs none.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    // Neutral tone mapping keeps hues and saturation where ACES bleaches bright colors toward white.
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1
    this.renderer = renderer

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2('#090520', 0.012)
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500)
    this.camera.position.set(0, 7, 15)

    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }))
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // Bloom only what is truly bright: spell cores, gems, crystals. Trims, floor lines and robes stay crisp.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.32, 0.9)
    this.bloom.highPassUniforms.smoothWidth.value = 0.3
    this.bloom.materialHighPassFilter.fragmentShader = BRIGHT_PASS
    this.bloom.materialHighPassFilter.needsUpdate = true
    // Bloom works at CSS-pixel size, so the glow spreads the same on every screen
    // and costs no more on high-density ones.
    const sizeBloom = this.bloom.setSize.bind(this.bloom)
    this.bloom.setSize = (width, height) => sizeBloom(Math.max(2, Math.round(this.width || width)), Math.max(2, Math.round(this.height || height)))
    this.composer.addPass(this.bloom)
    this.composer.addPass(ditheredOutput())

    const gl = renderer.getContext()
    this.sparks = new Sparks(this.scene)
    this.sparks.uniforms.uMaxPoint.value = Math.min(1024, gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1])
    this.marks = new Marks(this.scene, this.sparks.uniforms)
    this.rings = new Rings(this.scene)
    this.bolts = new Bolts(this.scene)
    this.looks = new Looks(this)
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    for (const texture of Object.values(textures())) if (texture.isTexture) texture.anisotropy = anisotropy
    this.buildWorld()
    this.buildCursor()
    this.tiers = QUALITY.map((tier) => tier.name)
    const start = startQuality(renderer)
    this.governor = { cost: 1 / 60, slow: 0, slowFrames: 0, fast: 0, trial: null, floor: 0, ceiling: QUALITY.length - 1, raised: -Infinity, pinned: start.pinned }
    this.setQuality(start.tier)
    window.addEventListener('resize', () => this.resize())
  }

  // World ────────────────────────────────────────────────────────────────

  buildWorld() {
    const shared = { uTime: { value: 0 }, uSurge: { value: 0 }, uDawn: { value: new THREE.Color(TEAM_GLOW[0]) }, uDusk: { value: new THREE.Color(TEAM_GLOW[1]) } }
    this.shared = shared
    this.bakeSky()

    // Stars: many faint ones and a few bright ones, drawn as soft round points.
    for (const [count, size, opacity] of [
      [1500, 2.2, 0.75],
      [140, 4.2, 0.95],
    ]) {
      const stars = new Float32Array(count * 3)
      const colors = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        const dir = randomDirection()
        dir.y = Math.abs(dir.y) * 0.9 + 0.05
        dir.normalize().multiplyScalar(260)
        stars.set(point(dir), i * 3)
        const c = new THREE.Color().setHSL(rand(0.5, 0.95), 0.6, rand(0.7, 1))
        colors.set([c.r, c.g, c.b], i * 3)
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(stars, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      const material = new THREE.PointsMaterial({ size, map: textures().glow, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })
      this.scene.add(new THREE.Points(geometry, material))
    }

    const floor = new THREE.Mesh(new THREE.CircleGeometry(24, 160).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: shared, vertexShader: FLOOR_VERTEX, fragmentShader: FLOOR_FRAGMENT }))
    this.scene.add(floor)

    // The underside of the floating arena: a craggy cone, its top ring kept true to the floor edge.
    const crag = new THREE.ConeGeometry(24, 14, 72, 6, true).rotateX(Math.PI)
    const corner = crag.attributes.position
    for (let i = 0; i < corner.count; i++) {
      const [x, y, z] = [corner.getX(i), corner.getY(i), corner.getZ(i)]
      const depth = (7 - y) / 14
      if (depth < 0.01 || depth > 0.99) continue
      // Hash the position, not the index, so seam vertices move together.
      const seed = Math.sin(x * 1.7 + y * 3.1 + z * 2.3) * 43758.5
      const swell = 1 + (seed - Math.floor(seed) - 0.5) * 0.12 * depth
      corner.setXYZ(i, x * swell, y + Math.sin(seed) * 0.35, z * swell)
    }
    const rock = new THREE.Mesh(crag, new THREE.MeshStandardMaterial({ color: '#15112b', roughness: 0.9, flatShading: true }))
    rock.position.y = -7.02
    this.scene.add(rock)

    const rift = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 3.2),
      new THREE.ShaderMaterial({ uniforms: shared, vertexShader: RING_VERTEX, fragmentShader: RIFT_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    )
    rift.position.y = 1.6
    this.scene.add(rift)

    // Pillars: a turned column with a plinth and capital, a glowing band and a floating crystal.
    const stone = new THREE.MeshStandardMaterial({ color: '#1a1733', roughness: 0.5, metalness: 0.3 })
    const column = lathe(
      profile(
        [
          [0.001, 0],
          [0.92, 0],
          [0.95, 0.2],
          [0.8, 0.34],
          [0.62, 0.5],
          [0.5, 3.55],
          [0.66, 3.78],
          [0.74, 3.98],
          [0.56, 4.14],
          [0.001, 4.2],
        ],
        40,
      ),
      24,
    )
    const ringGeometry = new THREE.TorusGeometry(0.58, 0.035, 8, 48).rotateX(Math.PI / 2)
    const crystalGeometry = new THREE.OctahedronGeometry(0.6, 0)
    const glows = TEAM_GLOW.map((hex) => {
      const color = new THREE.Color(hex)
      return {
        band: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1, roughness: 0.3 }),
        crystal: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.1, flatShading: true }),
      }
    })
    this.crystals = []
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8
      const glow = glows[Math.sin(a) > 0 ? 0 : 1]
      const pillar = new THREE.Mesh(column, stone)
      pillar.position.set(Math.cos(a) * 17, 0, Math.sin(a) * 17)
      const band = new THREE.Mesh(ringGeometry, glow.band)
      band.position.set(pillar.position.x, 3.62, pillar.position.z)
      this.scene.add(pillar, band)
      const crystal = new THREE.Mesh(crystalGeometry, glow.crystal)
      crystal.position.set(pillar.position.x, 5.3, pillar.position.z)
      crystal.scale.y = 1.7
      this.scene.add(crystal)
      this.crystals.push({ mesh: crystal, phase: i })
    }

    // Drifting rocks far out: a few craggy shapes shared by all of them.
    const rocks = Array.from({ length: 5 }, (_, k) => {
      const shape = new THREE.IcosahedronGeometry(1, 1)
      const corners = shape.attributes.position
      for (let i = 0; i < corners.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(corners, i)
        const bump = 0.78 + 0.32 * (0.5 + 0.5 * Math.sin(v.x * 3.1 + k * 1.7) * Math.cos(v.y * 2.3 - k) * Math.sin(v.z * 2.7 + k * 0.6))
        corners.setXYZ(i, v.x * bump, v.y * bump * 0.8, v.z * bump)
      }
      shape.computeVertexNormals()
      return shape
    })
    const rockMaterial = new THREE.MeshStandardMaterial({ color: '#1d1838', roughness: 0.8, flatShading: true })
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2
      const r = rand(26, 46)
      const shard = new THREE.Mesh(pickOne(rocks), rockMaterial)
      shard.scale.setScalar(rand(0.6, 2.2))
      shard.position.set(Math.cos(a) * r, rand(-6, 8), Math.sin(a) * r)
      shard.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3))
      this.scene.add(shard)
      this.crystals.push({ mesh: shard, phase: i * 1.7, drift: true })
    }

    this.scene.add(new THREE.HemisphereLight('#8c7dff', '#0b2a3a', 0.9))
    const key = new THREE.DirectionalLight('#ffe2c4', 2.2)
    key.position.set(6, 14, 9)
    this.scene.add(key)
    const dawn = new THREE.PointLight(TEAM_GLOW[0], 14, 30, 1.6)
    dawn.position.set(0, 3.5, 9)
    const dusk = new THREE.PointLight(TEAM_GLOW[1], 14, 30, 1.6)
    dusk.position.set(0, 3.5, -9)
    this.scene.add(dawn, dusk)
  }

  /** Render the procedural sky once into a cube map and use it as the background. */
  bakeSky() {
    const sky = new THREE.Scene()
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 40 }, uSurge: { value: 0 } }, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false })
    sky.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), material))
    const target = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType })
    new THREE.CubeCamera(1, 200, target).update(this.renderer, sky)
    this.scene.background = target.texture
    material.dispose()
  }

  /** Switch to a quality tier: pixel ratio, MSAA samples and particle density. */
  setQuality(tier) {
    const quality = QUALITY[tier]
    this.tier = tier
    this.quality = quality.name
    this.sparks.density = quality.density
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (target.samples === quality.samples) continue
      target.samples = quality.samples
      target.dispose()
    }
    this.resize()
  }

  /** The nearest tier below (-1) or above (+1) that draws differently on this screen. */
  nextTier(step) {
    const looks = (tier) => {
      const quality = QUALITY[tier]
      return `${Math.min(devicePixelRatio, quality.ratio)}:${quality.samples}:${quality.density}`
    }
    for (let tier = this.tier + step; tier >= 0 && tier < QUALITY.length; tier += step) if (looks(tier) !== looks(this.tier)) return tier
    return this.tier
  }

  /**
   * Keep frames smooth, timed by the wall clock. A run of slow frames drops a
   * tier on trial: if the mean frame time does not improve (a capped display,
   * a busy CPU), the drop is undone and not tried again. Long runs of fast
   * frames climb back, but never above a tier that just failed.
   */
  govern() {
    const g = this.governor
    if (g.pinned) return
    const now = performance.now()
    const dt = Math.min(1, (now - (g.at ?? now)) / 1000)
    g.at = now
    g.cost += (dt - g.cost) * 0.08
    if (g.trial) {
      const trial = g.trial
      // Let the switch settle (buffers, driver warm-up) before timing frames.
      if (now - trial.at > 1000) {
        trial.time += dt
        trial.frames++
      }
      if (trial.time < 3 || trial.frames < 10) return
      if (trial.time / trial.frames > trial.before * 0.85) {
        g.floor = trial.from
        this.setQuality(trial.from)
      }
      g.trial = null
      g.slow = g.slowFrames = g.fast = 0
      return
    }
    if (g.cost > 1 / 40) {
      g.slow += dt
      g.slowFrames++
    } else g.slow = g.slowFrames = 0
    g.fast = g.cost < 1 / 54 ? g.fast + dt : 0
    if (g.slow > 1.5) {
      const lower = this.nextTier(-1)
      if (lower >= this.tier || lower < g.floor) return
      if (now - g.raised < 12000) g.ceiling = lower
      g.trial = { from: this.tier, before: g.slow / g.slowFrames, at: now, time: 0, frames: 0 }
      this.setQuality(lower)
    } else if (g.fast > 10) {
      const higher = this.nextTier(1)
      if (higher <= this.tier || higher > g.ceiling) return
      g.raised = now
      g.fast = 0
      this.setQuality(higher)
    }
  }

  buildCursor() {
    const tex = textures()
    this.cursor = new THREE.Group()
    const ring = new THREE.Mesh(shapes().disc, new THREE.MeshBasicMaterial({ map: tex.cursor, color: '#ffd166', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    ring.scale.setScalar(2.9)
    ring.position.y = SEAT_Y + 0.05
    const arrow = new THREE.Mesh(shapes().arrow, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd166').multiplyScalar(2.5) }))
    this.cursor.add(ring, arrow)
    this.cursor.userData = { ring, arrow }
    this.cursor.visible = false
    this.scene.add(this.cursor)
  }

  // Figures ──────────────────────────────────────────────────────────────

  /** Replace all figures with a roster. viewer: the team seen from the near side. */
  setRoster(roster, viewer, mode) {
    for (const figure of this.figures.values()) figure.dispose()
    this.figures.clear()
    const sizes = [0, 1].map((team) => roster.filter((m) => m.team === team).length)
    for (const mage of roster) this.figures.set(mage.id, new Figure(this, mage, sizes[mage.team]))
    this.viewer = viewer
    this.span = Math.max(...sizes, 1)
    this.mode = mode
    this.flights = []
    this.surge = 0
    this.reach = 0
  }

  figure(id) {
    return this.figures.get(id)
  }

  /** Point the gold target cursor at a mage, or hide it. It burns brighter while a chord is being typed. */
  aim(id, bright = true) {
    const figure = id && this.figures.get(id)
    this.cursor.visible = Boolean(figure)
    if (!figure) return
    this.cursor.position.copy(figure.root.position)
    const { ring, arrow } = this.cursor.userData
    ring.material.opacity = bright ? 1 : 0.4
    arrow.visible = bright
  }

  // Spell visuals ────────────────────────────────────────────────────────

  launch(spell, casterId, targetIds, seconds) {
    const from = this.figures.get(casterId)
    if (!from) return
    from.release(spell)
    targetIds.forEach((id, i) => {
      const to = this.figures.get(id)
      if (to) this.flights.push(new Flight(this, spell, from, to, seconds, Math.min(0.12, i * 0.04)))
    })
  }

  /**
   * A spell lands. The role sets the shape (damage bursts, heals raise
   * crosses, boons climb, banes sink) and the school sets the color and the
   * signature, so what landed reads at a glance.
   */
  impact(spell, casterId, targetIds) {
    const roles = spell.roles
    const look = schoolLook(spell.school)
    for (const id of targetIds) {
      const to = this.figures.get(id)
      if (!to) continue
      const chest = to.anchor('chest')
      const feet = to.anchor('feet')
      const caster = this.figures.get(casterId)
      const friendly = caster && caster.team === to.team
      const power = 0.6 + spell.tier * 0.25
      if (spell.flight === 'nova') this.looks.ground(feet, spell.school, 2.6 * power)
      if (roles.includes('revive')) this.looks.pillar(feet, 'holy', 1.6)
      else if (friendly && roles.includes('heal')) {
        this.looks.mend(chest, spell.school)
        this.looks.pillar(feet, spell.school, 0.6)
      } else if (!friendly && roles.includes('damage')) {
        this.looks.burst(chest, spell.school, power)
        this.looks.flourish(chest, feet, spell.school, power)
        if (spell.flight === 'fall' || spell.tier === 3) this.looks.ground(feet, spell.school, 2.2 * power)
        if (spell.tier === 3) this.shake(0.35)
      } else if (friendly) {
        this.looks.spiral(chest, spell.school, true)
        this.looks.ground(feet, spell.school, 1.4)
      } else {
        this.looks.implode(chest, spell.school, 24, 1.6)
        this.looks.arrows(chest, look.main, false)
        this.looks.flash(chest, look.main, 1.6, 0.35, 0.6)
      }
    }
    for (const flight of this.flights) if (flight.spell === spell && flight.from.id === casterId) flight.done = true
  }

  shake(amount) {
    this.shakeLevel = Math.min(1, this.shakeLevel + amount)
  }

  // Camera and frame ─────────────────────────────────────────────────────

  resize() {
    const width = this.canvas.clientWidth || innerWidth
    const height = this.canvas.clientHeight || innerHeight
    this.width = width
    this.height = height
    // Read the device ratio every time: zoom and moving to another screen change it.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[this.tier].ratio))
    this.renderer.setSize(width, height, false)
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.composer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.band = [0, height, 0, width]
    this.shift = null
  }

  /**
   * Attract mode watches the duel side-on, the two teams to the left and
   * right of the centered menu card, swaying gently. Match mode sits behind
   * the viewer's row, pitched so the near row sits low and the far row high,
   * backs off until the widest row fits between the book's pages, and
   * centers the picture in the free band between the top bar and the tray.
   */
  placeCamera(dt) {
    const camera = this.camera
    const [top, bottom, left = 0, right = this.width] = this.band
    const match = this.mode === 'match'
    const shiftX = match ? Math.round(this.width / 2 - (left + right) / 2) : 0
    const shiftY = match ? Math.round(this.height / 2 - (top + bottom) / 2) : 0
    if (shiftX !== this.shift?.[0] || shiftY !== this.shift?.[1]) {
      this.shift = [shiftX, shiftY]
      if (shiftX || shiftY) camera.setViewOffset(this.width, this.height, shiftX, shiftY, this.width, this.height)
      else camera.clearViewOffset()
    }
    if (this.mode === 'attract') {
      const a = Math.PI / 2 + Math.sin(this.time * 0.07) * 0.3
      const far = camera.aspect > 1.2 ? 11.5 : 15
      camera.position.set(Math.sin(a) * far, 4.2 + Math.sin(this.time * 0.2) * 0.3, Math.cos(a) * far)
      camera.lookAt(0, 1.6, 0)
    } else {
      const tall = (bottom - top) / this.height
      const wide = (right - left) / this.width
      const halfWide = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect)
      const width = (this.span - 1) * LAYOUT.gap + 4.4
      const goal = Math.max(10, (width / 2 / (Math.tan(halfWide) * Math.max(0.4, wide))) * 1.05) / Math.max(0.75, tall)
      // Ease toward the new distance when the book opens or closes.
      this.reach = this.reach ? this.reach + (goal - this.reach) * Math.min(1, dt * 3) : goal
      const reach = this.reach
      const height = reach * 0.7
      const side = this.viewer === 0 ? 1 : -1
      const pitch = Math.atan((height - 1.3) / reach) - THREE.MathUtils.degToRad(7)
      const sway = Math.sin(this.time * 0.25) * 0.2
      camera.position.set(sway, height, side * (LAYOUT.row + reach))
      camera.lookAt(sway, height - Math.sin(pitch) * 10, side * (LAYOUT.row + reach - Math.cos(pitch) * 10))
    }
    if (this.shakeLevel > 0) {
      const s = this.shakeLevel * 0.25
      camera.position.add(new THREE.Vector3(rand(-s, s), rand(-s, s), rand(-s, s)))
      this.shakeLevel = Math.max(0, this.shakeLevel - dt * 2.2)
    }
  }

  /** World point → CSS pixels. */
  toScreen(world) {
    const v = world.clone().project(this.camera)
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, visible: v.z < 1 }
  }

  ambient(dt) {
    this.motes += dt * (30 + this.surge * 80)
    while (this.motes >= 1) {
      this.motes--
      const color = new THREE.Color(pickOne([TEAM_GLOW[0], TEAM_GLOW[1], '#ffffff', '#b59bff']))
      this.sparks.emit({ at: [rand(-11, 11), 0.1, rand(-0.25, 0.25)], velocity: [rand(-0.2, 0.2), rand(0.8, 2.2), rand(-0.1, 0.1)], color, size: rand(0.06, 0.16), life: rand(1.2, 2.4), shape: 'glow', drag: 0.2 })
    }
    if (Math.random() < dt * 6) {
      const a = Math.random() * Math.PI * 2
      const r = rand(4, 18)
      this.sparks.emit({ at: [Math.cos(a) * r, rand(0.5, 6), Math.sin(a) * r], velocity: [rand(-0.3, 0.3), rand(-0.1, 0.3), rand(-0.3, 0.3)], color: new THREE.Color(pickOne(['#ffe680', '#8fe8ff', '#ff9ae8'])), size: rand(0.06, 0.12), life: rand(3, 5), shape: 'star' })
    }
  }

  render(dt) {
    this.govern()
    this.time += dt
    this.shared.uTime.value = this.time
    this.shared.uSurge.value += (this.surge - this.shared.uSurge.value) * Math.min(1, dt * 2)
    for (const { mesh, phase, drift } of this.crystals) {
      mesh.rotation.y += dt * (drift ? 0.05 : 0.6)
      mesh.position.y += Math.sin(this.time * 0.8 + phase) * dt * (drift ? 0.2 : 0.3)
    }
    for (const figure of this.figures.values()) figure.update(dt, this.time)
    this.flights = this.flights.filter((flight) => !flight.done && flight.update(this.time, dt))
    if (this.cursor.visible) {
      const { ring, arrow } = this.cursor.userData
      ring.rotation.y += dt * 1.4
      arrow.position.y = 3.55 + Math.sin(this.time * 4) * 0.12
      arrow.rotation.y += dt * 2
    }
    this.ambient(dt)
    this.placeCamera(dt)
    const scale = (this.height * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)))
    this.sparks.update(this.time, scale, this.camera.aspect)
    this.marks.flush()
    this.rings.update(this.time)
    this.bolts.update(this.time, this.camera.aspect)
    this.composer.render()
  }
}

// ─── 10 · Plates ────────────────────────────────────────────────────────────

const initials = (name) =>
  name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

const SHARE_TEXT = { 1: '', 0.5: '½', 0.25: '¼', 0: '✕' }

/**
 * Diminishing returns at a glance: how much of the next stun or sleep (gold)
 * and the next silence (pink) would land. ✕ means none would.
 */
function drBadges(state) {
  const [lock = 0, hush = 0] = state.dr ?? []
  const badge = (group, share, what) => `<b class="dr ${group}" title="Next ${what}: ${share ? `${share * 100}%` : 'resisted'}">${SHARE_TEXT[share]}</b>`
  const out = []
  const lockShare = state.grace ? 0 : (DIMINISH[lock] ?? 0)
  if (lockShare < 1) out.push(badge('lock', lockShare, 'stun or sleep'))
  const hushShare = DIMINISH[hush] ?? 0
  if (hushShare < 1) out.push(badge('hush', hushShare, 'silence'))
  return out.join('')
}

/** Nameplates above every mage, and floating combat text. */
class Plates {
  constructor(layer, floats) {
    this.layer = layer
    this.floats = floats
    this.plates = new Map()
    this.pool = Array.from({ length: 48 }, () => floats.appendChild(make('div', 'float')))
    this.next = 0
    this.width = 0
    window.addEventListener('resize', () => (this.width = 0))
  }

  build(roster, me) {
    this.layer.replaceChildren()
    this.plates.clear()
    for (const mage of roster) {
      const el = make(
        'div',
        `plate team-${mage.team}${mage.id === me ? ' me' : ''}`,
        `<div class="plate-head"><span class="plate-name"></span><span class="plate-dr"></span><span class="plate-tag"></span></div>
         <div class="bar life"><i class="ghost"></i><i class="fill"></i><i class="guard"></i><b></b></div>
         <div class="bar mana"><i class="fill"></i></div>
         <div class="plate-flow">${'<i></i>'.repeat(TIMING.flow)}</div>
         <div class="plate-cast"><i class="fill"></i><span></span></div>
         <div class="plate-chord"></div>
         <div class="plate-auras"></div>`,
      )
      $('.plate-name', el).textContent = mage.name
      $('.plate-tag', el).textContent = mage.id === me ? 'YOU' : mage.bot ? 'BOT' : ''
      this.layer.appendChild(el)
      this.plates.set(mage.id, {
        el,
        mage,
        life: $('.life .fill', el),
        ghost: $('.life .ghost', el),
        guard: $('.life .guard', el),
        lifeBar: $('.bar.life', el),
        number: $('.life b', el),
        mana: $('.mana .fill', el),
        flow: $('.plate-flow', el),
        dr: $('.plate-dr', el),
        castFill: $('.plate-cast .fill', el),
        castText: $('.plate-cast span', el),
        chord: $('.plate-chord', el),
        auras: $('.plate-auras', el),
        sign: { auras: '', chord: '', cast: '', dr: '' },
      })
    }
  }

  /** Content from a frame (20 Hz). */
  fill(frame, roster) {
    for (const state of frame.mages) {
      const plate = this.plates.get(state.id)
      if (!plate) continue
      const { mage } = plate
      const share = state.life / mage.lifeMax
      plate.life.style.width = `${share * 100}%`
      plate.ghost.style.width = `${share * 100}%`
      plate.guard.style.width = `${Math.min(1, state.guard / mage.lifeMax) * 100}%`
      plate.lifeBar.classList.toggle('low', share < 0.3)
      setText(plate.number, state.down ? 'WISP' : state.life)
      plate.mana.style.width = `${(state.mana / mage.manaMax) * 100}%`
      plate.el.classList.toggle('down', state.down)
      plate.el.classList.toggle('casting', Boolean(state.cast))
      plate.el.classList.toggle('warded', Boolean(state.ward))
      const flow = state.flow ?? 0
      if (plate.flow.dataset.flow !== String(flow)) {
        plate.flow.dataset.flow = flow
        ;[...plate.flow.children].forEach((pip, i) => pip.classList.toggle('on', i < flow))
        plate.flow.classList.toggle('full', flow >= TIMING.flow)
      }
      const drSign = state.down ? '' : `${state.dr?.join()}|${state.grace}`
      if (drSign !== plate.sign.dr) {
        plate.sign.dr = drSign
        plate.dr.innerHTML = state.down ? '' : drBadges(state)
      }
      const castSign = state.cast ? `${state.cast.spell}>${state.cast.target}` : ''
      if (castSign !== plate.sign.cast) {
        plate.sign.cast = castSign
        if (state.cast) {
          const spell = SPELL[state.cast.spell]
          const target = roster.find((m) => m.id === state.cast.target)
          const shaped = (state.cast.metas ?? []).map((id) => METAS[id].name).join(' ')
          plate.castText.textContent = `${shaped ? `${shaped} ` : ''}${spell.name}${target && target.id !== state.id ? ` → ${target.name}` : ''}`
          // The cast bar and the plate's edge take the school's color, like the circle under the caster.
          plate.el.style.setProperty('--cast', `var(--${spell.school})`)
        }
      }
      if (state.cast) plate.castFill.style.width = `${(state.cast.done / state.cast.total) * 100}%`
      const chord = readChord(state.chord.keys)
      const chordSign = `${chord.metas.join()}|${chord.runes.join()}|${chord.arming}`
      if (chordSign !== plate.sign.chord) {
        plate.sign.chord = chordSign
        const metas = chord.metas.map((id) => `<i data-glyph="meta" class="${METAS[id].rune} meta" title="${METAS[id].name}">${svg('meta')}</i>`)
        plate.chord.innerHTML = metas.join('') + (chord.arming ? `<i data-glyph="meta" class="meta arming">${svg('meta')}</i>` : '') + sigilHtml(chord.runes)
      }
      const auraSign = state.auras.map((a) => a.name).join('|')
      if (auraSign !== plate.sign.auras) {
        plate.sign.auras = auraSign
        plate.auras.innerHTML = state.auras.map((a) => `<span class="aura ${a.kind}" title="${a.name}" style="color:var(--${a.school ?? 'arcane'})">${initials(a.name)}</span>`).join('')
      }
      const chips = plate.auras.children
      state.auras.forEach((aura, i) => chips[i]?.style.setProperty('--left', (aura.left / aura.total).toFixed(3)))
    }
  }

  /**
   * Positions every animation frame: the near row below the feet, the far
   * row above the hats, shrunk when neighbours would overlap.
   */
  place(stage, aimed) {
    const anchor = new THREE.Vector3()
    const spots = new Map()
    for (const [id] of this.plates) {
      const figure = stage.figure(id)
      if (!figure) continue
      const near = figure.team === stage.viewer
      spots.set(id, { near, team: figure.team, ...stage.toScreen(figure.anchor(near ? 'feet' : 'top', anchor)) })
    }
    // Measured once per layout, not every frame: reading it forces a reflow.
    this.width ||= this.plates.values().next().value?.el.offsetWidth || 0
    const width = this.width || 150
    const room = [0, 1].map((team) => {
      const xs = [...spots.values()].filter((s) => s.team === team).map((s) => s.x).sort((a, b) => a - b)
      const gaps = xs.slice(1).map((x, i) => x - xs[i])
      return gaps.length ? clamp((Math.min(...gaps) - 6) / width, 0.62, 1) : 1
    })
    for (const [id, plate] of this.plates) {
      const spot = spots.get(id)
      if (!spot) continue
      const scale = Math.min(room[spot.team], spot.near ? 1 : 0.9)
      const lift = spot.near ? 'translateY(12px)' : 'translateY(-100%)'
      plate.el.style.transformOrigin = spot.near ? '50% 0' : '50% 100%'
      plate.el.style.transform = `translate3d(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px, 0) ${lift} scale(${scale.toFixed(3)})`
      plate.el.style.visibility = spot.visible ? 'visible' : 'hidden'
      plate.el.classList.toggle('aimed', id === aimed)
    }
  }

  float(stage, world, text, className) {
    const el = this.pool[this.next]
    this.next = (this.next + 1) % this.pool.length
    const spot = stage.toScreen(world)
    if (!spot.visible) return
    el.className = `float ${className}`
    el.textContent = text
    el.style.left = `${(spot.x + rand(-26, 26)).toFixed(0)}px`
    el.style.top = `${(spot.y + rand(-16, 10)).toFixed(0)}px`
    // Rewind the running animation instead of forcing a reflow to restart it.
    const [animation] = el.getAnimations()
    if (animation) {
      animation.currentTime = 0
      animation.play()
    } else {
      el.style.animation = 'none'
      void el.offsetWidth
      el.style.animation = ''
    }
  }
}

// ─── 11 · Hud ───────────────────────────────────────────────────────────────

const clockText = (seconds) => {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Clock, banner, the book panel, the chord tray and its status row. */
class Hud {
  constructor() {
    this.rows = new Map()
    this.banner = $('#banner')
    this.bannerTimer = 0
    this.onPick = null // (spellId) when a row is tapped
  }

  /** Every spell in the book with its chord. During the draft, tapping a row takes it. */
  buildBook(book) {
    this.rows.clear()
    for (const kind of ['offense', 'defense']) $(`#book-${kind}`).replaceChildren()
    for (const entry of book) {
      const spell = SPELL[entry.id]
      const reach = spell.reach === 'side' ? ' side' : ''
      const cast = spell.cast ? `${spell.cast}s` : 'instant'
      const row = make(
        'li',
        'spell',
        `<span class="school" style="background:var(--${spell.school})"></span>
         <span class="sigil">${sigilHtml(entry.sigil)}</span>
         <span class="name"><b>${spell.name}</b><small>${AIM_TEXT[spell.aim]}${reach} · ${cast} · ${spell.cool}s</small></span>
         <span class="cost">${spell.cost}</span>
         <span class="react"></span>
         <span class="cool"></span>`,
      )
      const reactions = REACTIONS.filter((r) => r.hit === spell.school && spell.roles.includes('damage')).map((r) => `<br><small>${r.name}: ${r.text}</small>`)
      const detail = `<b>${spell.name}</b> · ${spell.cost} mana · ${cast} · ${spell.cool}s cooldown<br>${spell.text}${reactions.join('')}`
      const list = $(`#book-${spell.kind}`)
      const note = $('.detail', list.closest('.page'))
      row.addEventListener('pointerenter', () => (note.innerHTML = detail))
      row.addEventListener('click', () => {
        note.innerHTML = detail
        for (const other of this.rows.values()) other.row.classList.remove('picked')
        row.classList.add('picked')
        this.onPick?.(entry.id)
      })
      list.appendChild(row)
      this.rows.set(entry.id, { row, entry, spell, cool: $('.cool', row), cost: $('.cost', row), react: $('.react', row), sigil: $('.sigil', row), glyphs: $$('.sigil i', row), shiftedAt: -Infinity })
    }
    this.legend()
  }

  /** The rift rewrote some chords: redraw those rows and let them glow for a while. */
  reshuffle(changes, now) {
    for (const { id, sigil } of changes) {
      const item = this.rows.get(id)
      if (!item) continue
      item.sigil.innerHTML = sigilHtml(sigil)
      item.glyphs = $$('.sigil i', item.row)
      item.shiftedAt = now
    }
  }

  /** Under the tray: which key types each rune, and the other keys. */
  legend() {
    const labels = LABELS[inputMode]
    const runes = RUNES.map((rune) => `<span class="legend-key"><span class="key rune ${rune}">${svg(rune)}</span><kbd>${labels[rune] ?? ''}</kbd></span>`)
    const more = [
      ['meta', 'meta'],
      ['ward', 'ward'],
      ['call', 'call'],
      ['drop', 'clear'],
    ].map(([key, word]) => `<span class="legend-key ${key}"><kbd>${labels[key] ?? ''}</kbd>${word}</span>`)
    $('#legend').innerHTML = `${runes.join('')}<span class="legend-more">${more.join('')}</span>`
    setText($('#ward-key'), labels.ward ?? '')
  }

  /**
   * Book rows: your kit (chosen while drafting; only the kit shows in the
   * fight), cooldown sweep, cost after flow, the runes typed so far, which
   * spells set off a reaction on the aimed foe, and chords the rift just changed.
   */
  updateBook({ me, tick, runes, kit, size, drafting, target, now }) {
    const full = Boolean(kit) && kit.length >= size
    for (const item of this.rows.values()) {
      const { row, entry, spell, cool, glyphs } = item
      const inKit = !kit || kit.includes(spell.id)
      row.classList.toggle('chosen', drafting && Boolean(kit) && inKit)
      row.classList.toggle('spare', drafting && full && !inKit)
      row.classList.toggle('out', !drafting && !inKit)
      const ready = me?.cools[spell.id] ?? 0
      const left = Math.max(0, ready - tick)
      cool.style.transform = `scaleX(${spell.cool ? Math.min(1, left / (spell.cool * TICK_RATE)) : 0})`
      const cost = costOf(spell, [], me?.flow ?? 0)
      setText(item.cost, cost)
      row.classList.toggle('poor', Boolean(me) && !drafting && me.mana < cost)
      const matches = runes.length > 0 && runes.length <= entry.sigil.length && runes.every((rune, i) => entry.sigil[i] === rune)
      row.classList.toggle('dim', runes.length > 0 && !matches)
      glyphs.forEach((glyph, i) => glyph.classList.toggle('hit', matches && i < runes.length))
      const react = target && !drafting && spell.roles.includes('damage') ? reactionOn(target, spell.school) : null
      row.classList.toggle('combo', Boolean(react))
      setText(item.react, react ? react.reaction.name : '')
      row.classList.toggle('shifted', now - item.shiftedAt < 6)
    }
  }

  /** The draft header: how much of the kit is chosen. */
  draft(kit, size) {
    const count = $('#kit-count')
    setText(count, kit ? `${kit.length} / ${size}` : `${size} each`)
    count.classList.toggle('full', Boolean(kit) && kit.length >= size)
  }

  clock(frame, tick) {
    const { fightAt, surgeAt, shiftAt, phase } = frame
    const fighting = tick >= fightAt
    const surging = tick >= surgeAt
    const label = phase === 'over' ? 'Over' : !fighting ? 'Draft' : surging ? 'Surge' : 'Fight'
    setText($('#phase-label'), label)
    setText($('#clock'), fighting ? clockText((tick - fightAt) / TICK_RATE) : clockText(Math.ceil((fightAt - tick) / TICK_RATE)))
    const heal = Math.round(dampenAt(tick, fightAt, surgeAt) * 100)
    setText($('#heal-label'), `Heal ${heal}%`)
    const state = phase === 'over' ? 'over' : !fighting ? 'ready' : surging ? 'surge' : 'fight'
    if (document.body.dataset.phase !== state) document.body.dataset.phase = state
    // Warn a few seconds before the rift rewrites chords.
    const next = Math.min(shiftAt, surgeAt > tick ? surgeAt : Infinity)
    const soon = (next - tick) / TICK_RATE
    const chip = $('#shift-chip')
    chip.hidden = !(phase === 'fight' && soon <= 8 && soon > 0)
    if (!chip.hidden) setText(chip, `Rift shift ${Math.ceil(soon)}s`)
  }

  alive(frame, roster) {
    for (const team of [0, 1]) {
      setText($(`#alive-${team}`), frame.mages.filter((m, i) => roster[i].team === team && !m.down).length)
    }
  }

  say(title, sub = '', hold = false) {
    this.banner.querySelector('strong').textContent = title
    this.banner.querySelector('span').textContent = sub
    this.banner.className = 'banner'
    void this.banner.offsetWidth
    this.banner.classList.add(hold ? 'hold' : 'show')
  }

  hush() {
    this.banner.className = 'banner'
  }

  /** The chord tray: target, keys typed (metamagic as named chips), and spells that still match. */
  tray({ roster, me, cursor, keys, pending, book, drafting, mine }) {
    const target = roster.find((m) => m.id === cursor)
    const chip = $('#tray-target')
    setText(chip, drafting ? 'Draft' : !target ? '—' : target.id === me ? 'You' : target.name)
    const chipClass = `target-chip team-${drafting ? 'draft' : (target?.team ?? 0)}`
    if (chip.className !== chipClass) chip.className = chipClass
    const all = [...keys.map((key) => ({ key, pending: false })), ...pending.map((key) => ({ key, pending: true }))]
    const sign = all.map((k) => k.key + k.pending).join()
    if (sign !== this.traySign) {
      this.traySign = sign
      const chips = []
      for (let i = 0; i < all.length; i++) {
        const { key, pending: wait } = all[i]
        const next = all[i + 1]
        if (key === 'meta' && next && RUNES.includes(next.key)) {
          chips.push(metaChip(META_OF_RUNE[next.key], wait || next.pending ? 'pending' : ''))
          i++
        } else chips.push(keyChip(key, `${wait ? 'pending' : ''} ${key === 'meta' ? 'arming' : ''}`))
      }
      $('#tray-keys').innerHTML = chips.join('')
    }
    const read = readChord(all.map((k) => k.key))
    const hint = $('#tray-hint')
    if (!read.runes.length) {
      setHtml(hint, drafting ? 'Type a chord to take it' : mine?.down ? 'Wisp: aim, then a wisp chord' : all.length ? 'Now the runes' : 'Aim, then runes')
      return read.runes
    }
    const options = book.filter((entry) => read.runes.every((rune, i) => entry.sigil[i] === rune) && entry.sigil.length > read.runes.length).slice(0, 3)
    const cost = options.length === 1 && read.metas.length && mine ? ` <small>${costOf(SPELL[options[0].id], read.metas, mine.flow)} mana</small>` : ''
    setHtml(hint, options.length ? options.map((entry) => `<b>${SPELL[entry.id].name}</b>`).join(' · ') + cost : 'No match')
    return read.runes
  }

  /** The status row over the tray: the ward and its rest, flow pips. */
  status(mine, tick) {
    const ward = $('#ward-chip')
    const left = Math.max(0, mine.wardReady - tick)
    ward.classList.toggle('up', Boolean(mine.ward))
    ward.classList.toggle('ready', left <= 0 && !mine.down)
    ward.style.setProperty('--rest', left > 0 ? (left / (TIMING.wardCool * TICK_RATE)).toFixed(3) : '0')
    const meter = $('#flow-meter')
    if (meter.dataset.flow !== String(mine.flow)) {
      meter.dataset.flow = mine.flow
      $$('i', meter).forEach((pip, i) => pip.classList.toggle('on', i < mine.flow))
      meter.classList.toggle('full', mine.flow >= TIMING.flow)
    }
  }

  /** While you are a wisp, the wisp book sits over the tray. */
  wisps(entries, show) {
    const panel = $('#wisp-book')
    if (panel.hidden !== !show) panel.hidden = !show
    if (!show) return
    const sign = entries.map((entry) => entry.id + entry.sigil.join()).join('|')
    if (sign === this.wispSign) return
    this.wispSign = sign
    $('#wisp-spells').innerHTML = entries
      .map((entry) => `<span class="wisp-spell" title="${SPELL[entry.id].text}"><span class="sigil">${sigilHtml(entry.sigil)}</span><b>${SPELL[entry.id].name}</b></span>`)
      .join('')
  }

  pulse(className) {
    const chord = $('.chord')
    chord.classList.remove('fizzled', 'cast')
    void chord.offsetWidth
    chord.classList.add(className)
    clearTimeout(this.pulseTimer)
    this.pulseTimer = setTimeout(() => chord.classList.remove(className), 500)
  }
}

// ─── 12 · Views ─────────────────────────────────────────────────────────────

function setView(name) {
  document.body.dataset.view = name
  if (name !== 'match' && name !== 'result') document.body.dataset.phase = 'none'
}

function toast(text) {
  const el = $('#toast')
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600)
}

/** Lobby: seats for both teams and the owner's rule controls. */
function renderLobby(room, you, link) {
  const owner = room.owner === you
  $('#room-code').textContent = room.code
  $('#match-code').textContent = room.code
  for (const team of [0, 1]) {
    const list = $(`#seats-${team}`)
    list.replaceChildren()
    room.seats[team].forEach((seat, slot) => {
      const me = seat.id === you
      const item = make('li', `seat ${seat.kind}${me ? ' me' : ''}`)
      const label = seat.kind === 'human' ? seat.name : seat.kind === 'bot' ? seat.name : 'Open seat'
      const note = seat.kind === 'human' ? [me && 'You', seat.id === room.owner && 'Host'].filter(Boolean).join(' · ') || 'Player' : seat.kind === 'bot' ? `Bot · ${room.rules.skill}` : 'Bot if empty'
      item.innerHTML = `<span class="avatar">${seat.kind === 'open' ? '+' : seat.kind === 'bot' ? '⚙' : label[0].toUpperCase()}</span><span class="who"><b></b><small></small></span>`
      $('b', item).textContent = label
      $('small', item).textContent = note
      if (seat.kind === 'open') item.addEventListener('click', () => link.send('seat', { team, slot }))
      if (owner && seat.kind !== 'human') {
        const toggle = make('button', 'btn small ghost', seat.kind === 'bot' ? 'Remove' : '+ Bot')
        toggle.addEventListener('click', (event) => {
          event.stopPropagation()
          link.send('bench', { team, slot })
        })
        item.appendChild(toggle)
      }
      list.appendChild(item)
    })
  }
  const rules = room.rules
  $('#rules').classList.toggle('locked', !owner)
  $('[data-rule="team0"] b').textContent = rules.teams[0]
  $('[data-rule="team1"] b').textContent = rules.teams[1]
  for (const field of ['book', 'kit', 'life', 'surge', 'skill']) {
    for (const button of $$(`[data-rule="${field}"] button`)) button.classList.toggle('on', String(rules[field]) === button.dataset.value)
  }
  $('#start-button').hidden = !owner
  $('#lobby-wait').hidden = owner
  const watchers = room.watchers.length ? ` Watching: ${room.watchers.map((w) => w.name).join(', ')}.` : ''
  $('#lobby-note').textContent = `Share the code. Open seats are filled by bots.${watchers}`
}

/** Results: title, per-mage numbers and the owner's next step. */
function renderResult(results, roster, myTeam, owner) {
  const card = $('.result')
  const winner = results.winner
  let title = winner === -1 ? 'Draw' : `${TEAMS[winner]} wins`
  if (myTeam !== null && winner !== -1) title = winner === myTeam ? 'Victory' : 'Defeat'
  card.classList.toggle('win', myTeam === winner || (myTeam === null && winner !== -1))
  card.classList.toggle('lose', myTeam !== null && winner !== myTeam)
  $('#result-title').textContent = title
  $('#result-sub').textContent = `Match over · ${clockText(results.ticks / TICK_RATE)}`
  const best = {}
  for (const field of ['dealt', 'healed', 'taken', 'casts', 'parries', 'combos']) best[field] = Math.max(...results.mages.map((m) => m[field] ?? 0))
  const rows = [...results.mages].sort((a, b) => a.team - b.team || b.dealt - a.dealt)
  $('#result-rows').innerHTML = rows
    .map((m) => {
      const cell = (field) => `<td class="${m[field] === best[field] && m[field] > 0 ? 'best' : ''}">${m[field] ?? 0}</td>`
      const name = `${m.name}${m.bot ? ' <small>bot</small>' : ''}`
      return `<tr class="team-${m.team}"><td>${name}</td>${cell('dealt')}${cell('healed')}${cell('taken')}${cell('casts')}${cell('parries')}${cell('combos')}<td>${m.fizzles}</td></tr>`
    })
    .join('')
  $('#again-button').hidden = !owner
  $('#lobby-button').hidden = !owner
  $('#result-wait').hidden = owner
}

// ─── 13 · Game ──────────────────────────────────────────────────────────────

/** Client state. Messages from the host come in; visuals and HUD go out. */
class Game {
  constructor() {
    this.link = new Link()
    this.stage = new Stage($('#stage'))
    this.plates = new Plates($('#plates'), $('#floats'))
    this.hud = new Hud()
    this.pads = new Pads({ onKey: (key) => this.press(key), onCommand: (name) => this.command(name), onMode: () => this.refreshLabels() })
    this.you = null
    this.room = null
    this.setup = null
    this.me = null
    this.frame = null
    this.frameAt = 0
    this.pending = []
    this.seq = 0
    this.kits = {}
    this.quick = false
    this.demoAt = 0
    this.last = performance.now()
    this.hud.onPick = (id) => this.tapPick(id)

    this.link
      .on('welcome', (m) => this.onWelcome(m))
      .on('room', (m) => this.onRoom(m))
      .on('begin', (m) => this.onBegin(m))
      .on('frame', (m) => this.onFrame(m))
      .on('end', (m) => this.onEnd(m))
      .on('fault', (m) => toast(m.text))
      .on('close', () => this.onClose())

    this.bindViews()
    this.showDemo(RULES.teams)
    requestAnimationFrame((now) => this.loop(now))
  }

  // Wiring ───────────────────────────────────────────────────────────────

  bindViews() {
    paintGlyphs()
    const nameInput = $('#name-input')
    nameInput.value = memory.get('chordcast.name') ?? ''
    nameInput.addEventListener('change', () => this.sendName())
    $('#code-input').addEventListener('input', (event) => (event.target.value = event.target.value.toUpperCase().replace(/[^A-Z]/g, '')))
    $('#code-input').value = new URLSearchParams(location.search).get('code')?.toUpperCase() ?? ''

    for (const button of $$('#quick-skill button')) {
      button.addEventListener('click', () => {
        for (const other of $$('#quick-skill button')) other.classList.toggle('on', other === button)
      })
    }
    $('#quick-button').addEventListener('click', () => {
      const skill = $('#quick-skill .on')?.dataset.value ?? 'normal'
      this.sendName()
      this.quick = true
      this.link.send('open', { rules: { ...RULES, skill } })
    })
    $('#host-button').addEventListener('click', () => {
      this.sendName()
      this.link.send('open', { rules: RULES })
    })
    $('#join-form').addEventListener('submit', (event) => {
      event.preventDefault()
      const code = $('#code-input').value.trim()
      if (code.length !== 4) return toast('Codes have four letters.')
      this.sendName()
      this.link.send('join', { code })
    })
    $('#copy-button').addEventListener('click', async () => {
      const url = `${location.origin}/?code=${this.room?.code ?? ''}`
      try {
        await navigator.clipboard.writeText(url)
        toast('Link copied.')
      } catch {
        toast(url)
      }
    })
    $('#start-button').addEventListener('click', () => this.link.send('start'))
    $('#again-button').addEventListener('click', () => this.link.send('again'))
    $('#lobby-button').addEventListener('click', () => this.link.send('lobby'))
    for (const button of $$('[data-action="leave"]')) button.addEventListener('click', () => this.leave())
    for (const button of $$('[data-action="book"]')) button.addEventListener('click', () => this.command('book'))
    for (const button of $$('[data-open="guide"]')) button.addEventListener('click', () => $('#guide').showModal())
    $('#guide [data-close]').addEventListener('click', () => $('#guide').close())
    $('#guide').addEventListener('click', (event) => event.target === $('#guide') && $('#guide').close())

    for (const stepper of $$('.stepper')) {
      for (const button of $$('button', stepper)) {
        button.addEventListener('click', () => {
          if (!this.room) return
          const teams = [...this.room.rules.teams]
          const team = stepper.dataset.rule === 'team0' ? 0 : 1
          teams[team] += Number(button.dataset.step)
          this.link.send('tune', { rules: { ...this.room.rules, teams } })
        })
      }
    }
    for (const group of $$('#rules .segmented')) {
      for (const button of $$('button', group)) {
        button.addEventListener('click', () => {
          if (!this.room) return
          const value = group.dataset.rule === 'skill' ? button.dataset.value : Number(button.dataset.value)
          this.link.send('tune', { rules: { ...this.room.rules, [group.dataset.rule]: value } })
        })
      }
    }
    if (innerWidth < 860 || inputMode === 'touch') document.body.classList.add('book-closed')
  }

  sendName() {
    const raw = $('#name-input').value.trim()
    const name = raw || memory.get('chordcast.fallback') || `Mage ${Math.floor(rand(10, 99))}`
    if (!raw) memory.set('chordcast.fallback', name)
    else memory.set('chordcast.name', raw)
    this.link.send('hello', { name })
  }

  refreshLabels() {
    this.hud.legend()
    this.hud.traySign = null
  }

  command(name) {
    if (name === 'book') document.body.classList.toggle('book-closed')
    if (name === 'guide') $('#guide').open ? $('#guide').close() : $('#guide').showModal()
  }

  leave() {
    this.link.send('leave')
    this.room = null
    this.setup = null
    this.frame = null
    this.results = null
    this.me = null
    document.body.classList.remove('watching')
    this.hud.hush()
    this.showDemo(RULES.teams)
    setView('home')
  }

  // Messages in ──────────────────────────────────────────────────────────

  onWelcome({ you }) {
    this.you = you
    this.sendName()
    const code = $('#code-input').value
    if (code.length === 4) this.link.send('join', { code })
  }

  onClose() {
    if (this.room) toast('Connection lost. Reconnecting…')
    this.room = null
    this.setup = null
    this.frame = null
    this.showDemo(RULES.teams)
    setView('home')
  }

  onRoom({ room }) {
    $('#match-code').textContent = room.code
    const fresh = room.code !== this.room?.code
    const teamsChanged = String(room.rules.teams) !== String(this.room?.rules.teams)
    this.room = room
    if (room.phase === 'lobby') {
      this.setup = null
      this.frame = null
      this.results = null
      document.body.classList.remove('watching')
      renderLobby(room, this.you, this.link)
      if (fresh || teamsChanged || document.body.dataset.view !== 'lobby') this.showDemo(room.rules.teams)
      setView('lobby')
      if (this.quick && room.owner === this.you) {
        this.quick = false
        this.link.send('start')
      }
    } else if (this.results && room.phase === 'after') {
      renderResult(this.results, this.setup.roster, this.myTeam(), room.owner === this.you)
    }
  }

  onBegin({ setup, you }) {
    this.setup = setup
    this.me = you
    this.results = null
    this.frame = null
    this.pending = []
    this.kits = {}
    const roster = setup.roster
    const viewer = this.myTeam() ?? 0
    this.stage.setRoster(roster, viewer, 'match')
    this.plates.build(roster, you)
    this.hud.buildBook(setup.book)
    this.hud.traySign = null
    const { book, kit } = setup.rules
    setText($('#kit-note'), you ? `New chords this match. Type a spell's chord, or tap it, to take it. Pick ${kit} of ${book}.` : `The players are drafting ${kit} of ${book} spells each.`)
    document.body.classList.toggle('watching', !you)
    document.activeElement?.blur?.()
    setView('match')
    this.hud.hush()
  }

  onFrame({ frame, events, kits }) {
    if (!this.setup) return
    this.frame = frame
    this.frameAt = performance.now()
    if (kits) this.kits = kits
    const mine = this.mine()
    if (mine) this.pending = this.pending.filter((p) => p.seq > mine.seq)
    const roster = this.setup.roster
    frame.mages.forEach((state, i) => {
      const figure = this.stage.figure(roster[i].id)
      if (figure) figure.state = state
    })
    for (const event of events) this.onEvent(event)
    this.plates.fill(frame, roster)
    this.hud.alive(frame, roster)
  }

  onEnd({ results }) {
    this.results = results
    if (!this.setup) return
    const winner = results.winner
    if (winner !== -1) {
      for (const figure of this.stage.figures.values()) {
        if (figure.team === winner && !figure.state?.down) this.stage.looks.confetti(figure.anchor('head'), figure.glow)
      }
    }
    const show = () => {
      if (this.results !== results || !this.setup) return
      renderResult(results, this.setup.roster, this.myTeam(), this.room?.owner === this.you)
      setView('result')
    }
    // Let the last blows land first, unless we joined after the match ended.
    if (this.frame) setTimeout(show, 1600)
    else show()
  }

  // Events → visuals ─────────────────────────────────────────────────────

  onEvent(event) {
    // A hidden tab draws nothing, so effects would pile up and all burst out
    // on return. Only events that change lasting state are applied.
    if (document.hidden && !LASTING_EVENTS.has(event.type)) return
    const handler = EVENT_VISUALS[event.type]
    if (handler) handler.call(this, event)
  }

  figure(id) {
    return this.stage.figure(id)
  }

  floatAt(id, text, className, where = 'chest') {
    const figure = this.figure(id)
    if (figure) this.plates.float(this.stage, figure.anchor(where), text, className)
  }

  // Input ────────────────────────────────────────────────────────────────

  press(key) {
    if (!this.me || !this.frame || document.body.dataset.view !== 'match') return
    const seq = ++this.seq
    this.pending.push({ seq, key })
    this.link.send('press', { key, seq })
  }

  /** Tapping a spell while drafting types its chord for you. */
  tapPick(id) {
    const entry = this.setup?.book.find((e) => e.id === id)
    if (!entry || this.frame?.phase !== 'ready' || !this.me) return
    const view = this.chordView()
    if (view.keys.length + view.pending.length) this.press('drop')
    for (const rune of entry.sigil) this.press(rune)
  }

  // State helpers ────────────────────────────────────────────────────────

  myTeam() {
    const mage = this.setup?.roster.find((m) => m.id === this.me)
    return mage ? mage.team : null
  }

  mine() {
    if (!this.frame || !this.me) return null
    return this.frame.mages[this.setup.roster.findIndex((m) => m.id === this.me)]
  }

  /** The server tick, extrapolated a little between frames. */
  serverTick() {
    if (!this.frame) return 0
    return this.frame.tick + Math.min(3, (performance.now() - this.frameAt) / TICK_MS)
  }

  /**
   * Server chord plus keys still in flight, replayed with core rules: the aim
   * sticks, down on your own row snaps home, meta takes the next rune, and
   * a whole or dead chord clears. Ward and call never join a chord.
   */
  chordView() {
    const mine = this.mine()
    if (!mine) return { keys: [], pending: [], cursor: null }
    const drafting = this.frame.phase === 'ready'
    const book = drafting || !mine.down ? this.setup.book : this.setup.wisps
    let cursor = mine.chord.cursor
    let keys = mine.chord.keys
    let { runes, arming } = readChord(keys)
    const pending = []
    const clear = () => {
      keys = []
      pending.length = 0
      runes = []
      arming = false
    }
    for (const { key } of this.pending) {
      if (key === 'drop') clear()
      if (key === 'drop' || key === 'ward' || key === 'call' || (drafting && !RUNES.includes(key))) continue
      pending.push(key)
      if (MOVES.includes(key)) cursor = moveCursor(this.setup.roster, this.myTeam(), cursor, key, this.me)
      else if (key === 'meta') arming = true
      else if (arming) arming = false
      else {
        runes.push(key)
        if (readRunes(book, runes) !== 'open') clear()
      }
    }
    return { keys, pending, cursor }
  }

  // Attract mode ─────────────────────────────────────────────────────────

  /** A silent demo duel behind the menus. */
  showDemo(teams) {
    const roster = [0, 1].flatMap((team) => Array.from({ length: teams[team] }, (_, slot) => ({ id: `d${team}${slot}`, name: '', team, slot })))
    this.stage.setRoster(roster, 0, 'attract')
    for (const figure of this.stage.figures.values()) figure.state = { auras: [], lock: null, down: false, guard: 0, cast: null }
    this.stage.aim(null)
    this.demoAt = this.stage.time + 0.6
  }

  demo() {
    if (this.stage.mode !== 'attract' || this.stage.time < this.demoAt) return
    this.demoAt = this.stage.time + rand(0.8, 1.5)
    const figures = [...this.stage.figures.values()]
    const from = pickOne(figures)
    const spell = pickOne(CODEX.filter((s) => s.aim !== 'fallen'))
    const foes = figures.filter((f) => f.team !== from.team)
    const allies = figures.filter((f) => f.team === from.team)
    const to = spell.aim === 'foe' || (spell.aim === 'any' && Math.random() < 0.6) ? pickOne(foes) : spell.aim === 'self' ? from : pickOne(allies)
    const targets = spell.reach === 'side' ? figures.filter((f) => f.team === to.team) : [to]
    from.state.cast = { spell: spell.id, target: to.id, done: 0, total: 12 }
    from.beginCast(spell)
    const castMs = 500
    setTimeout(() => {
      from.state.cast = null
      from.endCast(false)
      const seconds = 0.35 + Math.random() * 0.3
      this.stage.launch(spell, from.id, targets.map((f) => f.id), seconds)
      setTimeout(() => this.stage.mode === 'attract' && this.stage.impact(spell, from.id, targets.map((f) => f.id)), seconds * 1000)
    }, castMs)
    const tick = () => {
      if (from.state.cast) {
        from.state.cast.done = Math.min(12, from.state.cast.done + 1)
        setTimeout(tick, castMs / 12)
      }
    }
    tick()
  }

  // Frame loop ───────────────────────────────────────────────────────────

  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.pads.poll()
    this.demo()
    if (this.setup && this.frame) this.drawMatch()
    this.stage.band = this.freeBand()
    this.stage.render(dt)
    if (this.setup) this.plates.place(this.stage, this.aimed)
    requestAnimationFrame((next) => this.loop(next))
  }

  /**
   * The screen area not covered by the HUD, as [top, bottom, left, right]:
   * below the top bar, above the tray or pads, and between the book's pages
   * when they sit at the sides (measured twice a second).
   */
  freeBand() {
    const { width, height } = this.stage
    if (document.body.dataset.view !== 'match') return [0, height, 0, width]
    const now = performance.now()
    if (this.band && now - this.bandAt < 500) return this.band
    // Leave room under the near row's feet for its plates (cast bar, chord and auras).
    // The tray (with its status row) sits above the touch pads, so it bounds the band either way.
    const bottom = !this.me ? height - 8 : $('#tray').getBoundingClientRect().top - 56
    let [left, right] = [0, width]
    if (document.body.dataset.phase !== 'ready') {
      const offense = $('.page.offense').getBoundingClientRect()
      const defense = $('.page.defense').getBoundingClientRect()
      if (offense.right < width / 2) left = Math.max(0, offense.right + 12)
      if (defense.left > width / 2) right = Math.min(width, defense.left - 12)
    }
    this.band = [64, Math.max(height * 0.5, bottom), left, right]
    this.bandAt = now
    return this.band
  }

  drawMatch() {
    const tick = this.serverTick()
    const { frame, setup } = this
    const drafting = frame.phase === 'ready'
    const now = this.stage.time
    this.hud.clock(frame, tick)
    const mine = this.mine()
    const kit = this.me ? (this.kits[this.me] ?? []) : null
    if (drafting) this.hud.draft(kit, setup.rules.kit)
    if (mine) {
      const view = this.chordView()
      const usable = drafting ? setup.book : mine.down ? setup.wisps : setup.book.filter((entry) => kit.includes(entry.id))
      const runes = this.hud.tray({ roster: setup.roster, me: this.me, cursor: view.cursor, keys: view.keys, pending: view.pending, book: usable, drafting, mine })
      const aimed = frame.mages[setup.roster.findIndex((m) => m.id === view.cursor)]
      const foe = aimed && setup.roster.find((m) => m.id === view.cursor).team !== this.myTeam() ? aimed : null
      this.hud.updateBook({ me: mine, tick, runes: mine.down && !drafting ? [] : runes, kit, size: setup.rules.kit, drafting, target: foe, now })
      this.hud.status(mine, tick)
      this.hud.wisps(setup.wisps, mine.down && frame.phase === 'fight')
      const fighting = frame.phase === 'fight'
      const typing = view.keys.length + view.pending.length > 0
      // The aim sticks between chords: a faint ring always, bright while typing.
      this.aimed = fighting && typing ? view.cursor : null
      this.stage.aim(fighting ? view.cursor : null, typing)
    } else {
      this.hud.updateBook({ me: null, tick, runes: [], kit: null, size: setup.rules.kit, drafting, target: null, now })
      this.aimed = null
      this.stage.aim(null)
    }
  }
}

/** Events that still matter while the tab is hidden: they set lasting state, not effects. */
const LASTING_EVENTS = new Set(['fizzle', 'surge', 'shift', 'over'])

/** Metamagic as words over a caster: "Quicken Twin". */
const shapedText = (metas) => (metas ?? []).map((id) => METAS[id].name).join(' ')

/** Event type → visual reaction. `this` is the Game. */
const EVENT_VISUALS = {
  start() {
    this.hud.say('Fight!', 'Your kit is set. Chords fire on the last rune')
  },
  cast(e) {
    this.figure(e.mage)?.beginCast(SPELL[e.spell])
    if (e.metas?.length) this.floatAt(e.mage, shapedText(e.metas), 'meta small', 'head')
    else if (e.mage === this.me && e.swift <= 0.75) this.floatAt(e.mage, 'Swift', 'swift small', 'head')
  },
  stop(e) {
    this.figure(e.mage)?.endCast(e.why === 'break')
    if (e.why === 'break') this.floatAt(e.mage, 'Interrupted', 'note', 'head')
  },
  queue(e) {
    if (e.mage === this.me) this.hud.pulse('cast')
  },
  fire(e) {
    const spell = SPELL[e.spell]
    this.figure(e.mage)?.endCast(false)
    const seconds = Math.max(0.1, ((e.land - this.serverTick()) * TICK_MS) / 1000)
    this.stage.launch(spell, e.mage, e.targets, seconds)
    // Spells with no cast bar show their metamagic as they leave; the others showed it when the cast began.
    if (e.metas?.length && (!spell.cast || e.metas.includes('quicken'))) this.floatAt(e.mage, shapedText(e.metas), 'meta small', 'head')
    if (e.mage === this.me) this.hud.pulse('cast')
  },
  land(e) {
    this.stage.impact(SPELL[e.spell], e.mage, e.targets)
  },
  jump(e) {
    const from = this.figure(e.from)
    const to = this.figure(e.to)
    if (from && to) this.stage.looks.lightning(from.anchor('chest'), to.anchor('chest'), SPELL[e.spell]?.school ?? 'storm')
  },
  strike(e) {
    const to = this.figure(e.to)
    const spell = SPELL[e.spell]
    if (to && spell) {
      this.stage.looks.burst(to.anchor('chest'), spell.school, 0.6)
      this.stage.looks.ground(to.anchor('feet'), spell.school, 1.4)
    }
  },
  hit(e) {
    const figure = this.figure(e.to)
    if (!figure) return
    const lifeMax = this.setup.roster.find((m) => m.id === e.to).lifeMax
    if (e.amount > 0 || e.soak > 0) figure.hit(e.amount / lifeMax, e.direct)
    if (e.direct && e.amount > 0) this.stage.looks.burst(figure.anchor('chest'), e.school, 0.35)
    if (e.soak > 0 && !e.amount) this.floatAt(e.to, `${e.soak} absorbed`, 'small note')
    else if (e.amount > 0) this.floatAt(e.to, `${e.amount}${e.soak ? ` (${e.soak})` : ''}`, `${e.school} ${e.amount >= lifeMax * 0.2 ? 'big' : e.direct ? '' : 'small'}`)
    if (e.to === this.me && e.amount > lifeMax * 0.06) {
      document.body.classList.add('hurt')
      setTimeout(() => document.body.classList.remove('hurt'), 140)
    }
  },
  mend(e) {
    if (e.amount > 0) this.floatAt(e.to, `+${e.amount}`, `mend ${e.amount > 150 ? 'big' : e.amount < 30 ? 'small' : ''}`)
  },
  void(e) {
    const words = { immune: 'Immune', evade: 'Dodged', reflect: 'Reflected', steady: 'Resisted', resist: 'Resisted', parry: 'Parried!' }
    this.floatAt(e.to, words[e.why] ?? e.why, e.why === 'parry' ? 'parry big' : 'note', 'head')
    const figure = this.figure(e.to)
    if (figure && e.why === 'reflect') this.stage.looks.shatter(figure.anchor('chest'), new THREE.Color('#e0e8ff'), 14)
    if (figure && e.why === 'parry') {
      figure.parry()
      this.stage.shake(e.to === this.me ? 0.3 : 0.12)
    }
  },
  ward(e) {
    this.figure(e.mage)?.raiseWard()
  },
  react(e) {
    const figure = this.figure(e.to)
    if (!figure) return
    const chest = figure.anchor('chest')
    this.stage.looks.burst(chest, e.hit, 1.3)
    this.stage.looks.burst(chest, e.on, 0.8)
    this.stage.looks.ground(figure.anchor('feet'), e.hit, 2.4)
    this.stage.shake(0.12)
    this.floatAt(e.to, `${e.name}!`, `react ${e.hit} big`, 'head')
  },
  flow(e) {
    if (e.flow < TIMING.flow) return
    const figure = this.figure(e.mage)
    if (figure) this.stage.looks.spiral(figure.anchor('chest'), 'holy', true)
    if (e.mage === this.me) this.floatAt(e.mage, 'In flow', 'swift', 'head')
  },
  shift(e) {
    for (const { id, sigil } of e.changes) {
      const entry = this.setup.book.find((x) => x.id === id)
      if (entry) entry.sigil = sigil
    }
    this.hud.reshuffle(e.changes, this.stage.time)
    this.hud.traySign = null
    this.stage.shake(0.2)
    const mine = this.me && (this.kits[this.me] ?? [])
    const hits = mine ? e.changes.filter((c) => mine.includes(c.id)).length : e.changes.length
    this.hud.say('Rift shift', mine ? `${hits} of your chords changed` : `${e.changes.length} chords changed`)
  },
  call(e) {
    const figure = this.figure(e.target)
    if (!figure) return
    figure.calledUntil = this.stage.time + TIMING.call
    const by = this.setup.roster.find((m) => m.id === e.mage)
    this.floatAt(e.target, e.mage === this.me ? 'Called' : `${by?.name ?? 'Ally'}: here!`, 'call small', 'top')
  },
  pick(e) {
    if (e.mage === this.me) this.hud.pulse('cast')
  },
  mark(e) {
    const figure = this.figure(e.to)
    if (!figure) return
    this.stage.looks.flash(figure.anchor('chest'), e.kind === 'boon' ? new THREE.Color('#7dffb0') : new THREE.Color('#ff6a80'), 1.1, 0.3, 0.6)
    if (e.look === 'stun' || e.look === 'ice' || e.look === 'sheep' || e.look === 'time') this.floatAt(e.to, e.name, 'note', 'head')
  },
  fade(e) {
    const figure = this.figure(e.to)
    if (!figure) return
    if (e.why === 'break') this.stage.looks.shatter(figure.anchor('chest'), new THREE.Color('#bfe0ff'))
    if (e.why === 'purge' || e.why === 'steal') this.stage.looks.implode(figure.anchor('chest'), 'arcane', 12, 0.6)
  },
  purge(e) {
    if (e.count > 0) this.floatAt(e.to, e.kind === 'boon' ? `Purged ${e.count}` : `Cleansed ${e.count}`, 'note small', 'head')
  },
  mana(e) {
    if (e.amount < -4) {
      this.floatAt(e.to, `${e.amount} mana`, 'small arcane')
      const figure = this.figure(e.to)
      if (figure) this.stage.looks.shatter(figure.anchor('chest'), new THREE.Color('#5aa8ff'), 10)
    } else if (e.amount > 10) this.floatAt(e.to, `+${e.amount} mana`, 'small frost')
  },
  fizzle(e) {
    if (this.frame?.phase === 'ready') {
      // While drafting, the book covers the arena: say it in a toast instead.
      if (e.mage === this.me) {
        toast(e.why)
        this.hud.pulse('fizzled')
        this.pending = []
      }
      return
    }
    const figure = this.figure(e.mage)
    if (figure) this.stage.looks.puff(figure.anchor('gem'))
    this.floatAt(e.mage, e.mage === this.me ? e.why : 'Fizzle', 'fizzle', 'head')
    if (e.mage === this.me) {
      this.hud.pulse('fizzled')
      this.pending = []
    }
  },
  fall(e) {
    const figure = this.figure(e.to)
    if (!figure) return
    this.stage.looks.burst(figure.anchor('chest'), 'shadow', 1.4)
    this.stage.looks.ground(figure.anchor('feet'), 'shadow', 3)
    this.stage.shake(0.5)
    this.floatAt(e.to, 'Down', 'note big', 'head')
    if (e.to === this.me) this.hud.say('You fell', 'Fight on as a wisp')
  },
  rise(e) {
    const figure = this.figure(e.to)
    if (figure) this.stage.looks.pillar(figure.anchor('feet'), 'holy', 1.8)
    this.floatAt(e.to, 'Revived', 'mend big', 'head')
  },
  save(e) {
    const figure = this.figure(e.to)
    if (figure) this.stage.looks.burst(figure.anchor('chest'), 'holy', 1.4)
    this.floatAt(e.to, 'Saved', 'note big', 'head')
  },
  swap(e) {
    const a = this.figure(e.from)
    const b = this.figure(e.to)
    if (a && b) {
      this.stage.looks.lightning(a.anchor('chest'), b.anchor('chest'), 'shadow')
      this.stage.looks.burst(a.anchor('chest'), 'shadow', 0.8)
      this.stage.looks.burst(b.anchor('chest'), 'shadow', 0.8)
    }
  },
  refresh(e) {
    const figure = this.figure(e.to)
    if (figure) this.stage.looks.spiral(figure.anchor('chest'), 'arcane', true)
    this.floatAt(e.to, 'Cooldowns reset', 'note small', 'head')
  },
  surge(e) {
    this.stage.surge = Math.min(1, 0.4 + e.wave * 0.06)
    this.stage.shake(0.15)
    if (e.wave === 1) this.hud.say('Surge!', 'Everyone takes rising damage')
  },
  over(e) {
    const mine = this.myTeam()
    const title = e.winner === -1 ? 'Draw' : mine === null ? `${TEAMS[e.winner]} wins` : e.winner === mine ? 'Victory' : 'Defeat'
    this.hud.say(title, '', true)
    this.stage.aim(null)
  },
}

// ─── 14 · Boot ──────────────────────────────────────────────────────────────

const game = new Game()
window.chordcast = game
