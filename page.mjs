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
 *   11  Hud      clock, banner, book and chord tray
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
import { AIM_TEXT, CODEX, LAYOUT, MOVES, RULES, RUNES, SPELL, TEAMS, TICK_MS, TICK_RATE, dampenAt, moveCursor, pack, place, readRunes, walkActs } from '/core.mjs'

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
  keys: { up: 'W', left: 'A', right: 'D', down: 'S', star: 'I', wave: 'J', flame: 'L', leaf: 'K', drop: '␣' },
  pad: { up: '↑', left: '←', right: '→', down: '↓', star: 'Y', wave: 'X', flame: 'B', leaf: 'A', drop: 'LB' },
  touch: {},
}

let inputMode = 'keys'

/** A key chip: a rune or a move glyph, labeled for the current input mode. */
function keyChip(key, extra = '') {
  const kind = RUNES.includes(key) ? `rune ${key}` : 'move'
  const label = LABELS[inputMode][key]
  return `<span class="key ${kind} ${extra}" data-glyph="${key}"${label ? ` data-label="${label}"` : ''}>${svg(key)}</span>`
}

const TEAM_GLOW = ['#3ee6ff', '#ff4fb8']
const TEAM_ROBE = ['#16607e', '#7c1d5c']

/** Particle palettes per school: hot core, main, deep, plus body and bit shapes. */
const SCHOOL_LOOK = {
  fire: { hot: '#fff1b8', main: '#ff8a2a', deep: '#ff2a0e', smoke: '#1e0b06', body: 'glow', bit: 'star', lift: 2.6 },
  frost: { hot: '#ffffff', main: '#a4f1ff', deep: '#3a9dff', body: 'shard', bit: 'flake', lift: -4 },
  storm: { hot: '#ffffff', main: '#d6c8ff', deep: '#6f7bff', body: 'spark', bit: 'star', lift: -1 },
  nature: { hot: '#f2ffc8', main: '#8cff5e', deep: '#16c46a', body: 'leaf', bit: 'glow', lift: -2.4 },
  shadow: { hot: '#f3d4ff', main: '#b45cff', deep: '#5112a1', smoke: '#13041f', body: 'smoke', bit: 'glow', lift: 0.8 },
  holy: { hot: '#ffffff', main: '#ffe680', deep: '#ffad2e', body: 'star', bit: 'ring', lift: 1.4 },
  arcane: { hot: '#ffffff', main: '#ff7ae0', deep: '#7d5cff', body: 'rune', bit: 'star', lift: 0 },
}

for (const look of Object.values(SCHOOL_LOOK)) {
  for (const key of ['hot', 'main', 'deep', 'smoke']) if (look[key]) look[key] = new THREE.Color(look[key])
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
  TEXTURES.circle = canvasTexture(512, (g, s) => {
    const c = s / 2
    g.strokeStyle = '#fff'
    g.fillStyle = '#fff'
    g.shadowColor = '#fff'
    g.shadowBlur = 10
    const ring = (r, w) => {
      g.lineWidth = w
      g.beginPath()
      g.arc(c, c, r, 0, Math.PI * 2)
      g.stroke()
    }
    ring(c * 0.94, 5)
    ring(c * 0.86, 2)
    ring(c * 0.5, 3)
    for (let i = 0; i < 2; i++) {
      g.beginPath()
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + (i * Math.PI) / 3 - Math.PI / 2
        const x = c + Math.cos(a) * c * 0.84
        const y = c + Math.sin(a) * c * 0.84
        k ? g.lineTo(x, y) : g.moveTo(x, y)
      }
      g.closePath()
      g.lineWidth = 3
      g.stroke()
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      const r0 = c * 0.865
      const r1 = c * (i % 3 ? 0.92 : 0.94)
      g.lineWidth = i % 3 ? 2 : 4
      g.beginPath()
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0)
      g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1)
      g.stroke()
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      g.beginPath()
      g.arc(c + Math.cos(a) * c * 0.5, c + Math.sin(a) * c * 0.5, 9, 0, Math.PI * 2)
      g.fill()
    }
  })
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
  KeyI: 'star', KeyJ: 'wave', KeyL: 'flame', KeyK: 'leaf', Space: 'drop', Backspace: 'drop',
}
const PAD_BUTTONS = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 3: 'star', 2: 'wave', 1: 'flame', 0: 'leaf', 4: 'drop', 5: 'drop' }
const PAD_COMMANDS = { 9: 'book', 8: 'guide' }

/**
 * Turns keyboard, gamepad and touch input into the same small set of keys:
 * four moves, four runes and drop. `onKey(key)` gets game keys,
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

const SHAPES = { glow: 0, star: 1, ring: 2, shard: 3, smoke: 4, leaf: 5, rune: 6, flake: 7, spark: 8, bubble: 9 }

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
    vec4 view = modelViewMatrix * vec4(travel(age), 1.0);
    gl_Position = projectionMatrix * view;
    vec4 ahead = projectionMatrix * modelViewMatrix * vec4(travel(age + 0.03), 1.0);
    vec2 dir = (ahead.xy / ahead.w - gl_Position.xy / gl_Position.w) * vec2(uAspect, 1.0);
    float seed = fract(sin(aLife.x * 91.7 + aOffset.x * 47.3 + aVelocity.z * 13.1) * 43758.5);
    vAngle = aLife.w > 7.5 && aLife.w < 8.5 && length(dir) > 1e-5 ? atan(dir.y, dir.x) : seed * 6.2832 + age * (seed - 0.5) * 4.0;
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
    } else {
      alpha = smoothstep(1.0, 0.85, r) * (0.25 + 0.75 * smoothstep(0.55, 0.95, r));
    }
    alpha *= vColor.a;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(mix(vColor.rgb, vec3(1.0), core * 0.7 * vHeat), alpha);
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

/** Glowing (additive) and hazy (alpha) particles. emit() takes one particle spec. */
class Sparks {
  constructor(scene, capacity = 24000) {
    this.time = 0
    this.density = 1
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 800 }, uAspect: { value: 1 }, uMaxPoint: { value: 600 } }
    this.glow = new SparkLayer(capacity, THREE.AdditiveBlending, this.uniforms)
    this.haze = new SparkLayer(Math.floor(capacity / 4), THREE.NormalBlending, this.uniforms)
    this.haze.points.renderOrder = 1
    this.glow.points.renderOrder = 2
    scene.add(this.haze.points, this.glow.points)
  }
  /** p: { at, offset?, velocity?, color, alpha?, life?, size?, shape?, gravity?, drag?, swirl?, grow?, delay?, haze? } */
  emit(p) {
    // Lower quality tiers thin out small bits; big flashes always draw.
    if (this.density < 1 && (p.size ?? 0.3) < 0.5 && Math.random() > this.density) return
    ;(p.haze ? this.haze : this.glow).write(p, this.time)
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
      ring.mesh.material.uniforms.uFade.value = (1 - u) * 1.6
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
    gl_FragColor = vec4((uColor * max(glow, 0.0) + uHot * core * 1.6) * ends, uFade);
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

class Looks {
  constructor(stage) {
    this.stage = stage
    this.sparks = stage.sparks
    this.rings = stage.rings
    this.bolts = stage.bolts
  }

  flash(at, color, size = 1.6, life = 0.22, alpha = 1) {
    this.sparks.emit({ at: point(at), color, size, life, alpha, shape: 'glow', grow: 0.6 })
  }

  burst(at, school, power = 1) {
    const look = schoolLook(school)
    this.flash(at, mixColor(look.hot, look.main, 0.45), 1.1 * Math.sqrt(power), 0.2, 0.6)
    this.sparks.emit({ at: point(at), color: look.main, alpha: 0.7, size: 0.55 * power, life: 0.4, shape: 'ring', grow: 4 })
    const count = Math.round(26 * power)
    for (let i = 0; i < count; i++) {
      const dir = randomDirection()
      this.sparks.emit({
        at: point(at),
        velocity: point(dir.multiplyScalar(rand(2, 6.5) * power)),
        color: tint(look),
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
        color: look.hot,
        size: rand(0.08, 0.18),
        life: rand(0.25, 0.55),
        shape: look.bit === 'ring' ? 'spark' : look.bit,
        drag: 4,
        gravity: look.lift,
      })
    }
    if (look.smoke) this.smoke(at, look.smoke, Math.round(6 * power))
  }

  smoke(at, color, count = 6) {
    for (let i = 0; i < count; i++) {
      this.sparks.emit({
        at: point(at),
        velocity: [rand(-0.8, 0.8), rand(0.3, 1.2), rand(-0.8, 0.8)],
        color,
        alpha: 0.55,
        size: rand(0.8, 1.4),
        life: rand(0.9, 1.6),
        shape: 'smoke',
        grow: 1.4,
        drag: 1.2,
        haze: true,
      })
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
    this.sparks.emit({ at: [feet.x, feet.y + 1.2, feet.z], color: look.main, size: 1.6, life: 0.4, shape: 'glow', alpha: 0.35 })
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

  trail(at, school, scale = 1) {
    const look = schoolLook(school)
    for (let i = 0; i < 3; i++) {
      this.sparks.emit({
        at: point(at),
        velocity: [rand(-0.6, 0.6), rand(-0.3, 0.8), rand(-0.6, 0.6)],
        color: tint(look),
        size: rand(0.14, 0.32) * scale,
        life: rand(0.25, 0.55),
        shape: i ? look.body : look.bit,
        gravity: look.lift * 0.5,
        drag: 1.5,
      })
    }
    this.sparks.emit({ at: point(at), color: look.main, size: 0.85 * scale, life: 0.09, shape: 'glow' })
    if (look.smoke && Math.random() < 0.35) this.smoke(at, look.smoke, 1)
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
        shape: Math.random() < 0.6 ? 'glow' : look.bit,
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
      this.bolts.spawn(jagged(at, at.clone().add(reach), 3, 0.3), { color: look.deep, hot: look.main, width: 0.07, life: 0.1, time })
    }
    for (let i = 0; i < 3; i++) {
      this.sparks.emit({ at: point(pickOne(points)), velocity: point(randomDirection().multiplyScalar(rand(1, 3))), color: look.hot, size: rand(0.06, 0.12), life: rand(0.15, 0.3), shape: 'spark', drag: 3 })
    }
  }

  mend(center, school) {
    const look = schoolLook(school === 'holy' || school === 'nature' ? school : 'nature')
    for (let i = 0; i < 22; i++) {
      this.sparks.emit({
        at: [center.x, center.y - 0.6, center.z],
        offset: [rand(-0.6, 0.6), rand(-0.3, 0.9), rand(-0.6, 0.6)],
        velocity: [0, rand(0.8, 2), 0],
        color: tint(look),
        size: rand(0.12, 0.3),
        life: rand(0.6, 1.1),
        shape: pickOne(['glow', 'star', look.body]),
        drag: 0.4,
      })
    }
    this.flash(center, look.main, 1.1, 0.3, 0.7)
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
 * Continuous status visuals, one row per aura look. `where` picks the anchor,
 * `motion` the path; 'school' as color means "use the aura's school".
 */
const STATUS_LOOK = {
  dot: { rate: 14, shape: 'body', color: 'school', where: 'body', motion: 'rise' },
  hot: { rate: 10, shape: 'glow', color: '#7dffa8', where: 'body', motion: 'rise' },
  stun: { rate: 7, shape: 'star', color: '#ffe066', where: 'head', motion: 'orbit' },
  sleep: { rate: 5, shape: 'glow', color: '#9d8cff', where: 'head', motion: 'drift' },
  daze: { rate: 8, shape: 'star', color: '#ffd28c', where: 'head', motion: 'orbit' },
  fear: { rate: 9, shape: 'smoke', color: '#4a1a7a', where: 'head', motion: 'drift', haze: true },
  hush: { rate: 5, shape: 'rune', color: '#c77dff', where: 'head', motion: 'orbit' },
  slow: { rate: 8, shape: 'flake', color: '#8fe8ff', where: 'feet', motion: 'drift' },
  haste: { rate: 14, shape: 'spark', color: '#ffe680', where: 'body', motion: 'rise' },
  expose: { rate: 6, shape: 'shard', color: '#ff5d73', where: 'chest', motion: 'orbit' },
  weak: { rate: 6, shape: 'smoke', color: '#3a3550', where: 'body', motion: 'fall', haze: true },
  power: { rate: 14, shape: 'glow', color: '#ffb347', where: 'body', motion: 'rise' },
  armor: { rate: 3, shape: 'ring', color: '#bfe3ff', where: 'chest', motion: 'still' },
  ward: { rate: 4, shape: 'star', color: '#e9f3ff', where: 'chest', motion: 'orbit' },
  stone: { rate: 6, shape: 'smoke', color: '#8a8478', where: 'feet', motion: 'drift', haze: true },
  thorns: { rate: 8, shape: 'spark', color: '#9cff5a', where: 'chest', motion: 'burst' },
  mirror: { rate: 6, shape: 'shard', color: '#e0e8ff', where: 'chest', motion: 'orbit' },
  immune: { rate: 10, shape: 'star', color: '#fff2a8', where: 'body', motion: 'orbit' },
  cheat: { rate: 8, shape: 'glow', color: '#fffbe0', where: 'head', motion: 'rise' },
  mend: { rate: 5, shape: 'rune', color: '#7dffb0', where: 'chest', motion: 'orbit' },
  mana: { rate: 10, shape: 'glow', color: '#5aa8ff', where: 'body', motion: 'rise' },
  doom: { rate: 12, shape: 'smoke', color: '#2a0a1a', where: 'head', motion: 'rise', haze: true },
  bomb: { rate: 16, shape: 'glow', color: '#ff7a1a', where: 'chest', motion: 'burst' },
  steady: { rate: 3, shape: 'ring', color: '#ffffff', where: 'feet', motion: 'rise' },
  rewind: { rate: 6, shape: 'rune', color: '#ff7ae0', where: 'body', motion: 'orbit' },
  blight: { rate: 8, shape: 'smoke', color: '#1f3a12', where: 'body', motion: 'drift', haze: true },
  sheep: { rate: 3, shape: 'glow', color: '#ffffff', where: 'chest', motion: 'drift' },
  root: { rate: 10, shape: 'leaf', color: '#5aff6a', where: 'feet', motion: 'rise' },
  ice: { rate: 8, shape: 'flake', color: '#d8fbff', where: 'body', motion: 'drift' },
  time: { rate: 6, shape: 'rune', color: '#ffd166', where: 'body', motion: 'still' },
  banish: { rate: 10, shape: 'rune', color: '#c77dff', where: 'body', motion: 'orbit' },
  boon: { rate: 4, shape: 'glow', color: '#7dffa8', where: 'body', motion: 'rise' },
  bane: { rate: 4, shape: 'glow', color: '#ff7a8a', where: 'body', motion: 'rise' },
}

for (const look of Object.values(STATUS_LOOK)) if (look.color !== 'school') look.color = new THREE.Color(look.color)

const STATUS_MOTION = {
  rise: () => ({ offset: [rand(-0.45, 0.45), rand(-0.6, 0.6), rand(-0.45, 0.45)], velocity: [0, rand(0.6, 1.4), 0], life: rand(0.7, 1.1) }),
  fall: () => ({ offset: [rand(-0.45, 0.45), rand(0, 0.8), rand(-0.45, 0.45)], velocity: [0, -rand(0.3, 0.7), 0], life: rand(0.8, 1.2) }),
  drift: () => ({ offset: [rand(-0.5, 0.5), rand(-0.2, 0.4), rand(-0.5, 0.5)], velocity: [rand(-0.2, 0.2), rand(0.2, 0.5), rand(-0.2, 0.2)], life: rand(1, 1.5) }),
  orbit: () => {
    const a = Math.random() * Math.PI * 2
    return { offset: [Math.cos(a) * 0.55, rand(-0.1, 0.1), Math.sin(a) * 0.55], velocity: [0, 0, 0], swirl: 3.2, life: rand(0.8, 1.1) }
  },
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
 */
function addRim(material, color, strength = 0.4) {
  const rim = { value: color.clone().multiplyScalar(strength) }
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
const BASE_TEXT = new THREE.Color('#1b1e3a')
const TINTS = { flash: new THREE.Color('#ffffff'), stone: new THREE.Color('#8a8478'), time: new THREE.Color('#ffd166') }

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
    this.trimMaterial = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 1.1, roughness: 0.3 })
    const gold = new THREE.MeshStandardMaterial({ color: '#c79a52', roughness: 0.3, metalness: 0.9 })
    this.hatMaterial = addRim(new THREE.MeshStandardMaterial({ color: robe.clone().multiplyScalar(0.75), roughness: 0.66, metalness: 0.05, transparent: true }), glow, 0.3)
    this.gemMaterial = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.2, flatShading: true })
    const face = new THREE.MeshStandardMaterial({ color: '#0b0a18', roughness: 0.85 })
    const eyes = new THREE.MeshBasicMaterial({ color: glow.clone().lerp(new THREE.Color('#ffffff'), 0.5).multiplyScalar(3) })
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
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }))
    this.halo.scale.setScalar(0.7)
    this.gem.add(this.halo)

    add(geo.base, new THREE.MeshStandardMaterial({ color: BASE_TEXT, roughness: 0.4, metalness: 0.45, flatShading: true }), [0, 0, 0], [0, 0, 0], this.root)
    add(geo.rim, this.trimMaterial, [0, SEAT_Y + 0.005, 0], [Math.PI / 2, 0, Math.PI / 6], this.root)
    const pool = add(geo.disc, new THREE.MeshBasicMaterial({ map: tex.glow, color: glow, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), [0, 0.02, 0], [0, 0, 0], this.root)
    pool.scale.setScalar(4.2)

    this.circle = add(geo.disc, new THREE.MeshBasicMaterial({ map: tex.circle, color: glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), [0, SEAT_Y + 0.03, 0], [0, 0, 0], this.root)
    this.circle.scale.setScalar(2.6)

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

  anchor(name, out = new THREE.Vector3()) {
    if (name === 'gem') return this.gem.getWorldPosition(out)
    const heights = { head: 3.05, chest: 1.3, feet: SEAT_Y, body: 1.1 }
    out.copy(this.root.position)
    out.y = (heights[name] ?? 1.2) - this.lift
    return out
  }

  // Events ───────────────────────────────────────────────────────────────

  beginCast(spell) {
    this.cast = { school: spell.school, start: this.stage.time }
    this.circle.material.color.copy(schoolLook(spell.school).main).multiplyScalar(0.7)
    this.gemMaterial.emissive.copy(schoolLook(spell.school).main)
  }

  endCast(broken) {
    if (broken && this.cast) this.stage.looks.shatter(this.anchor('feet').setY(0.5), schoolLook(this.cast.school).main, 12)
    this.cast = null
  }

  release(spell) {
    const look = schoolLook(spell.school)
    this.gemMaterial.emissive.copy(look.main)
    this.stage.looks.flash(this.anchor('gem'), look.main, 1.3, 0.22, 0.8)
    this.flare = 1
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
    const castShare = state?.cast ? state.cast.done / state.cast.total : 0
    const fall = ease(this.fallen)
    this.body.position.set(0, bob - fall * 0.35, -this.kick * 0.25)
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

    const opacity = ghost ? (down ? 0.35 : 0.45) : 1
    this.robeMaterial.opacity = this.hatMaterial.opacity = opacity
    const stone = looks.has('stone') || looks.has('time')
    this.robeMaterial.emissive.copy(this.flash > 0 ? TINTS.flash : stone ? (looks.has('time') ? TINTS.time : TINTS.stone) : this.glow)
    this.robeMaterial.emissiveIntensity = 0.05 + this.flash * this.flash * 0.22 + (stone ? 0.35 : 0)

    const casting = Boolean(state?.cast)
    const target = casting ? 0.5 : 0
    this.circle.material.opacity += (target - this.circle.material.opacity) * Math.min(1, dt * 10)
    this.circle.rotation.y += dt * (casting ? 1.6 : 0.4)
    this.circle.scale.setScalar(1.5 + castShare * 1.2)
    this.gemMaterial.emissiveIntensity = 2.2 + (casting ? 1.5 + castShare * 2.5 : 0) + this.flare * 3
    this.halo.scale.setScalar(0.7 + (casting ? 0.4 + castShare * 0.6 : 0) + this.flare * 0.6)
    if (!casting) this.gemMaterial.emissive.lerp(this.glow, Math.min(1, dt * 2))

    const guard = (state?.guard ?? 0) > 0
    const immune = looks.has('immune') || looks.has('banish')
    this.bubble.visible = (guard || immune) && !down
    if (this.bubble.visible) {
      const uniforms = this.bubble.material.uniforms
      uniforms.uColor.value.set(looks.has('banish') ? '#c77dff' : immune ? '#ffe680' : '#a8d8ff')
      uniforms.uTime.value = time
      uniforms.uPower.value = 0.6 + this.kick * 0.6
    }

    if (casting && !down) this.emitCast(dt, castShare)
    if (state && !down) this.emitStatus(dt, state)
  }

  emitCast(dt, share) {
    if (!this.cast || Math.random() > dt * 40) return
    const look = schoolLook(this.cast.school)
    const gem = this.anchor('gem')
    const dir = randomDirection().multiplyScalar(1.1 - share * 0.4)
    this.stage.sparks.emit({ at: point(gem), offset: point(dir), velocity: point(dir.clone().multiplyScalar(-2.2)), color: tint(look), size: rand(0.08, 0.18), life: 0.45, shape: look.bit === 'ring' ? 'glow' : look.bit })
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
        this.stage.sparks.emit({ at: point(at), color, shape, size: rand(0.1, 0.24) * (look.haze ? 3 : 1), alpha: look.haze ? 0.6 : 0.8, haze: look.haze, grow: look.haze ? 1 : 0, ...motion })
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
      along(before, share, (s) => looks.trail(this.path(s), this.school, this.power * (style === 'fall' ? 1.3 : 1)))
    } else if (style === 'volley') {
      const head = (at, i) => clamp((at - i * 0.08) / (1 - (this.heads - 1) * 0.08), 0, 1)
      for (let i = 0; i < this.heads; i++) {
        along(head(before, i), head(share, i), (s) => s > 0 && s < 1 && looks.trail(this.path(s, i), this.school, 0.55))
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
    this.band = [0, 1]

    // Antialiasing comes from the multisampled scene buffer below, so the
    // canvas itself needs none.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.95
    this.renderer = renderer

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2('#090520', 0.012)
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500)
    this.camera.position.set(0, 7, 15)

    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }))
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.42, 0.62)
    // Bloom works at CSS-pixel size, so the glow spreads the same on every screen
    // and costs no more on high-density ones.
    const sizeBloom = this.bloom.setSize.bind(this.bloom)
    this.bloom.setSize = (width, height) => sizeBloom(Math.max(2, Math.round(this.width || width)), Math.max(2, Math.round(this.height || height)))
    this.composer.addPass(this.bloom)
    this.composer.addPass(ditheredOutput())

    const gl = renderer.getContext()
    this.sparks = new Sparks(this.scene)
    this.sparks.uniforms.uMaxPoint.value = Math.min(1024, gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1])
    this.rings = new Rings(this.scene)
    this.bolts = new Bolts(this.scene)
    this.looks = new Looks(this)
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    for (const texture of Object.values(textures())) texture.anisotropy = anisotropy
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
        band: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.3 }),
        crystal: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4, roughness: 0.15, metalness: 0.1, flatShading: true }),
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
  }

  figure(id) {
    return this.figures.get(id)
  }

  /** Point the gold target cursor at a mage, or hide it. */
  aim(id) {
    const figure = id && this.figures.get(id)
    this.cursor.visible = Boolean(figure)
    if (figure) this.cursor.position.copy(figure.root.position)
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

  impact(spell, casterId, targetIds) {
    const roles = spell.roles
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
        if (spell.flight === 'fall' || spell.tier === 3) this.looks.ground(feet, spell.school, 2.2 * power)
        if (spell.tier === 3) this.shake(0.35)
      } else if (friendly) {
        this.looks.spiral(chest, spell.school, true)
        this.looks.ground(feet, spell.school, 1.4)
      } else {
        this.looks.implode(chest, spell.school, 24, 1.6)
        this.looks.flash(chest, schoolLook(spell.school).main, 1.8, 0.35)
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
    this.band = [0, height]
    this.shift = null
  }

  /**
   * Attract mode orbits the arena. Match mode sits behind the viewer's row,
   * pitched so the near row sits low and the far row high, then shifts the
   * picture into the free band between the top bar and the tray.
   */
  placeCamera(dt) {
    const camera = this.camera
    const shiftX = this.mode === 'attract' && this.width > 860 ? -this.width * 0.17 : 0
    const shiftY = this.mode === 'match' ? Math.round(this.height / 2 - (this.band[0] + this.band[1]) / 2) : 0
    if (shiftX !== this.shift?.[0] || shiftY !== this.shift?.[1]) {
      this.shift = [shiftX, shiftY]
      if (shiftX || shiftY) camera.setViewOffset(this.width, this.height, shiftX, shiftY, this.width, this.height)
      else camera.clearViewOffset()
    }
    if (this.mode === 'attract') {
      const a = this.time * 0.04 + 0.5
      camera.position.set(Math.sin(a) * 13.5, 4.4 + Math.sin(this.time * 0.2) * 0.4, Math.cos(a) * 13.5)
      camera.lookAt(0, 1.5, 0)
    } else {
      const tall = (this.band[1] - this.band[0]) / this.height
      const halfWide = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect)
      const width = (this.span - 1) * LAYOUT.gap + 4.4
      const reach = Math.max(10, (width / 2 / Math.tan(halfWide)) * 1.05) / Math.max(0.75, tall)
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
        `<div class="plate-head"><span class="plate-name"></span><span class="plate-tag"></span></div>
         <div class="bar life"><i class="ghost"></i><i class="fill"></i><i class="ward"></i><b></b></div>
         <div class="bar mana"><i class="fill"></i></div>
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
        ward: $('.life .ward', el),
        lifeBar: $('.bar.life', el),
        number: $('.life b', el),
        mana: $('.mana .fill', el),
        castFill: $('.plate-cast .fill', el),
        castText: $('.plate-cast span', el),
        chord: $('.plate-chord', el),
        auras: $('.plate-auras', el),
        sign: { auras: '', chord: '', cast: '' },
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
      plate.ward.style.width = `${Math.min(1, state.guard / mage.lifeMax) * 100}%`
      plate.lifeBar.classList.toggle('low', share < 0.3)
      setText(plate.number, state.down ? 'DOWN' : state.life)
      plate.mana.style.width = `${(state.mana / mage.manaMax) * 100}%`
      plate.el.classList.toggle('down', state.down)
      plate.el.classList.toggle('casting', Boolean(state.cast))
      const castSign = state.cast ? `${state.cast.spell}>${state.cast.target}` : ''
      if (castSign !== plate.sign.cast) {
        plate.sign.cast = castSign
        if (state.cast) {
          const target = roster.find((m) => m.id === state.cast.target)
          plate.castText.textContent = `${SPELL[state.cast.spell].name}${target && target.id !== state.id ? ` → ${target.name}` : ''}`
        }
      }
      if (state.cast) plate.castFill.style.width = `${(state.cast.done / state.cast.total) * 100}%`
      const runes = state.chord.keys.filter((key) => RUNES.includes(key))
      const chordSign = runes.join(',')
      if (chordSign !== plate.sign.chord) {
        plate.sign.chord = chordSign
        plate.chord.innerHTML = runes.map((rune) => `<i data-glyph="${rune}" class="${rune}">${svg(rune)}</i>`).join('')
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
      spots.set(id, { near, team: figure.team, ...stage.toScreen(figure.anchor(near ? 'feet' : 'head', anchor)) })
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

/** Clock, banner, the book panel and the chord tray. */
class Hud {
  constructor() {
    this.rows = new Map()
    this.banner = $('#banner')
    this.bannerTimer = 0
  }

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
         <span class="sigil">${entry.sigil.map((rune) => `<i data-glyph="${rune}" class="${rune}">${svg(rune)}</i>`).join('')}</span>
         <span class="name"><b>${spell.name}</b><small>${AIM_TEXT[spell.aim]}${reach} · ${cast} · ${spell.cool}s</small></span>
         <span class="cost">${spell.cost}</span>
         <span class="cool"></span>`,
      )
      const detail = `<b>${spell.name}</b> · ${spell.cost} mana · ${cast} · ${spell.cool}s cooldown<br>${spell.text}`
      row.addEventListener('pointerenter', () => ($('#book-detail').innerHTML = detail))
      row.addEventListener('click', () => {
        $('#book-detail').innerHTML = detail
        for (const other of this.rows.values()) other.row.classList.remove('picked')
        row.classList.add('picked')
      })
      $(`#book-${spell.kind}`).appendChild(row)
      this.rows.set(entry.id, { row, entry, spell, cool: $('.cool', row), glyphs: $$('.sigil i', row) })
    }
    this.legend()
  }

  legend() {
    $('#legend').innerHTML = RUNES.map((rune) => keyChip(rune)).join('')
  }

  /** Book rows: cooldown sweep, mana, and the runes typed so far. */
  updateBook(me, tick, runes) {
    for (const { row, entry, spell, cool, glyphs } of this.rows.values()) {
      const ready = me?.cools[spell.id] ?? 0
      const left = Math.max(0, ready - tick)
      cool.style.transform = `scaleX(${spell.cool ? Math.min(1, left / (spell.cool * TICK_RATE)) : 0})`
      row.classList.toggle('poor', Boolean(me) && me.mana < spell.cost)
      const matches = runes.length > 0 && runes.length <= entry.sigil.length && runes.every((rune, i) => entry.sigil[i] === rune)
      row.classList.toggle('dim', runes.length > 0 && !matches)
      glyphs.forEach((glyph, i) => glyph.classList.toggle('hit', matches && i < runes.length))
    }
  }

  clock(setup, tick, phase) {
    const fighting = tick >= setup.fightAt
    const surging = tick >= setup.surgeAt
    const label = phase === 'over' ? 'Over' : !fighting ? 'Study' : surging ? 'Surge' : 'Fight'
    setText($('#phase-label'), label)
    setText($('#clock'), fighting ? clockText((tick - setup.fightAt) / TICK_RATE) : clockText(Math.ceil((setup.fightAt - tick) / TICK_RATE)))
    const heal = Math.round(dampenAt(tick, setup.fightAt, setup.surgeAt) * 100)
    setText($('#heal-label'), `Heal ${heal}%`)
    const state = phase === 'over' ? 'over' : !fighting ? 'ready' : surging ? 'surge' : 'fight'
    if (document.body.dataset.phase !== state) document.body.dataset.phase = state
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

  /** The chord tray: target, keys typed, and spells that still match. */
  tray({ roster, me, cursor, keys, pending, book }) {
    const target = roster.find((m) => m.id === cursor)
    const chip = $('#tray-target')
    setText(chip, !target ? '—' : target.id === me ? 'You' : target.name)
    const chipClass = `target-chip team-${target?.team ?? 0}`
    if (chip.className !== chipClass) chip.className = chipClass
    const all = [...keys.map((key) => ({ key, pending: false })), ...pending.map((key) => ({ key, pending: true }))]
    const sign = all.map((k) => k.key + k.pending).join()
    if (sign !== this.traySign) {
      this.traySign = sign
      $('#tray-keys').innerHTML = all.map(({ key, pending: wait }) => keyChip(key, wait ? 'pending' : '')).join('')
    }
    const runes = all.map((k) => k.key).filter((key) => RUNES.includes(key))
    const hint = $('#tray-hint')
    if (!runes.length) {
      setHtml(hint, all.length ? 'Now the runes' : 'Move to aim, then runes')
      return runes
    }
    const options = book.filter((entry) => runes.every((rune, i) => entry.sigil[i] === rune) && entry.sigil.length > runes.length).slice(0, 3)
    setHtml(hint, options.length ? options.map((entry) => `<b>${SPELL[entry.id].name}</b>`).join(' · ') : 'No match')
    return runes
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
  for (const field of ['book', 'life', 'surge', 'skill']) {
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
  for (const field of ['dealt', 'healed', 'taken', 'casts']) best[field] = Math.max(...results.mages.map((m) => m[field]))
  const rows = [...results.mages].sort((a, b) => a.team - b.team || b.dealt - a.dealt)
  $('#result-rows').innerHTML = rows
    .map((m) => {
      const cell = (field) => `<td class="${m[field] === best[field] && m[field] > 0 ? 'best' : ''}">${m[field]}</td>`
      const name = `${m.name}${m.bot ? ' <small>bot</small>' : ''}`
      return `<tr class="team-${m.team}"><td>${name}</td>${cell('dealt')}${cell('healed')}${cell('taken')}${cell('casts')}<td>${m.fizzles}</td></tr>`
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
    this.quick = false
    this.demoAt = 0
    this.last = performance.now()

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
    const roster = setup.roster
    const viewer = this.myTeam() ?? 0
    this.stage.setRoster(roster, viewer, 'match')
    this.plates.build(roster, you)
    this.hud.buildBook(setup.book)
    this.hud.traySign = null
    document.body.classList.toggle('watching', !you)
    document.activeElement?.blur?.()
    setView('match')
    this.hud.hush()
  }

  onFrame({ frame, events }) {
    if (!this.setup) return
    this.frame = frame
    this.frameAt = performance.now()
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

  /** Server chord plus keys still in flight, replayed with core rules. */
  chordView() {
    const mine = this.mine()
    if (!mine) return { keys: [], pending: [], cursor: null }
    let cursor = mine.chord.cursor
    let runes = mine.chord.keys.filter((key) => RUNES.includes(key))
    const pending = []
    for (const { key } of this.pending) {
      if (key === 'drop') {
        pending.length = 0
        cursor = this.me
        runes = []
        continue
      }
      pending.push(key)
      if (MOVES.includes(key)) cursor = moveCursor(this.setup.roster, this.myTeam(), cursor, key)
      else {
        runes.push(key)
        if (readRunes(this.setup.book, runes) !== 'open') return { keys: [], pending: [], cursor: this.me }
      }
    }
    return { keys: mine.chord.keys, pending, cursor }
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

  /** The screen rows not covered by the top bar and the tray or pads (measured twice a second). */
  freeBand() {
    const height = this.stage.height
    if (document.body.dataset.view !== 'match') return [0, height]
    const now = performance.now()
    if (this.band && now - this.bandAt < 500) return this.band
    const touch = inputMode === 'touch' && this.me
    const bottom = !this.me ? height - 8 : touch ? $('#pads .pad').getBoundingClientRect().top - 70 : $('#tray').getBoundingClientRect().top - 8
    this.band = [64, Math.max(height * 0.5, bottom)]
    this.bandAt = now
    return this.band
  }

  drawMatch() {
    const tick = this.serverTick()
    this.hud.clock(this.setup, tick, this.frame.phase)
    const mine = this.mine()
    if (mine) {
      const view = this.chordView()
      const runes = this.hud.tray({ roster: this.setup.roster, me: this.me, cursor: view.cursor, keys: view.keys, pending: view.pending, book: this.setup.book })
      this.hud.updateBook(mine, tick, runes)
      const typing = view.keys.length + view.pending.length > 0 && !mine.down && this.frame.phase === 'fight'
      this.aimed = typing ? view.cursor : null
      this.stage.aim(this.aimed)
    } else {
      this.hud.updateBook(null, tick, [])
      this.aimed = null
      this.stage.aim(null)
    }
  }
}

/** Events that still matter while the tab is hidden: they set lasting state, not effects. */
const LASTING_EVENTS = new Set(['fizzle', 'surge', 'over'])

/** Event type → visual reaction. `this` is the Game. */
const EVENT_VISUALS = {
  start() {
    this.hud.say('Fight!', 'Chords fire on the last rune')
  },
  cast(e) {
    this.figure(e.mage)?.beginCast(SPELL[e.spell])
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
    const words = { immune: 'Immune', evade: 'Dodged', reflect: 'Reflected', steady: 'Resisted' }
    this.floatAt(e.to, words[e.why] ?? e.why, 'note', 'head')
    const figure = this.figure(e.to)
    if (figure && e.why === 'reflect') this.stage.looks.shatter(figure.anchor('chest'), new THREE.Color('#e0e8ff'), 14)
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
    if (e.to === this.me) this.hud.say('You fell', 'Your team fights on')
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
