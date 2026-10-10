/**
 * sound.mjs — Chordcast sound.
 *
 * Every sound is made with the Web Audio API as it plays, so there is nothing
 * to download. Effects are short voices of oscillators and filtered noise,
 * voiced by school. Each rune has its own note, so every chord is a little
 * tune you can learn by ear. A spell flying at you rises in pitch until it
 * lands, so a ward can be timed by sound. Music is a small step sequencer:
 * a calm loop under the menus and a driving one in the fight that rises with
 * the surge. Gamepad rumble and phone vibration ride along with the big
 * moments.
 *
 *   1  Kit     notes, envelopes and the noise buffer
 *   2  Synth   tones and noise, routed, panned and counted
 *   3  Voices  every sound, built from tones and noise
 *   4  Music   the sequencer and its two loops
 *   5  Sound   the public object: unlock, mute, volume, play, music and rumble
 */

// ─── 1 · Kit ────────────────────────────────────────────────────────────────

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const midi = (note) => 440 * Math.pow(2, (note - 69) / 12)
const rand = (low, high) => low + Math.random() * (high - low)
const QUIET = 0.0001 // exponential ramps cannot reach zero

/** Runes sing from the top of the pad down: star highest, leaf lowest (D minor pentatonic). */
const RUNE_NOTES = { star: 81, wave: 77, flame: 74, leaf: 69 }

/**
 * Shape a gain over time: silent at `at`, up to `peak` after `attack`, then
 * down to silence by `at + dur`. With `hold`, it stays at the peak until the
 * last `release` seconds, like a held note.
 */
function envelope(param, at, { attack, dur, peak, hold = false, release = 0.3 }) {
  param.setValueAtTime(QUIET, at)
  if (hold) {
    param.linearRampToValueAtTime(peak, at + attack)
    param.setValueAtTime(peak, Math.max(at + attack, at + dur - release))
  } else {
    param.exponentialRampToValueAtTime(peak, at + attack)
  }
  param.exponentialRampToValueAtTime(QUIET, at + dur)
}

/** One second of white noise, shared by every noisy voice. */
function noiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

/** A short, dark room: decaying stereo noise for the reverb. */
function roomBuffer(ctx, seconds = 1.6) {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2)
  }
  return buffer
}

// ─── 2 · Synth ──────────────────────────────────────────────────────────────

/** Makes tones and noise bursts on a bus, and counts the voices still sounding. */
class Synth {
  constructor(ctx, out) {
    this.ctx = ctx
    this.out = out
    this.noise = noiseBuffer(ctx)
    this.live = 0
  }

  /** Send a voice's last node to its bus, panned when asked. */
  route(node, pan, out) {
    if (!pan || !this.ctx.createStereoPanner) return node.connect(out)
    const panner = this.ctx.createStereoPanner()
    panner.pan.value = clamp(pan, -1, 1)
    node.connect(panner).connect(out)
  }

  count(source) {
    this.live++
    source.onended = () => this.live--
  }

  /**
   * An oscillator: `freq` glides to `to` over `glide` seconds (all of it by
   * default), through an optional low-pass at `cutoff`, with optional vibrato.
   */
  tone({ at, type = 'sine', freq, to = 0, glide = 0, dur = 0.2, gain = 0.1, attack = 0.004, hold = false, release, pan = 0, cutoff = 0, q = 0.7, vibrato = 0, rate = 6, detune = 0, out = this.out }) {
    const { ctx } = this
    const osc = ctx.createOscillator()
    osc.type = type
    osc.detune.value = detune
    osc.frequency.setValueAtTime(freq, at)
    if (to) osc.frequency.exponentialRampToValueAtTime(to, at + (glide || dur))
    if (vibrato) {
      const lfo = ctx.createOscillator()
      const depth = ctx.createGain()
      lfo.frequency.value = rate
      depth.gain.value = vibrato
      lfo.connect(depth).connect(osc.frequency)
      lfo.start(at)
      lfo.stop(at + dur + 0.05)
    }
    let node = osc
    if (cutoff) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = cutoff
      filter.Q.value = q
      node = node.connect(filter)
    }
    const amp = ctx.createGain()
    envelope(amp.gain, at, { attack, dur, peak: gain, hold, release })
    node.connect(amp)
    this.route(amp, pan, out)
    this.count(osc)
    osc.start(at)
    osc.stop(at + dur + 0.05)
  }

  /** Filtered noise: the filter's `freq` sweeps to `to` when given. */
  hiss({ at, dur = 0.2, gain = 0.1, attack = 0.004, hold = false, release, type = 'bandpass', freq = 1000, to = 0, q = 1, pan = 0, out = this.out }) {
    const { ctx } = this
    const source = ctx.createBufferSource()
    source.buffer = this.noise
    source.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.setValueAtTime(freq, at)
    if (to) filter.frequency.exponentialRampToValueAtTime(to, at + dur)
    filter.Q.value = q
    const amp = ctx.createGain()
    envelope(amp.gain, at, { attack, dur, peak: gain, hold, release })
    source.connect(filter).connect(amp)
    this.route(amp, pan, out)
    this.count(source)
    source.start(at, Math.random() * 0.9)
    source.stop(at + dur + 0.05)
  }

  /** A struck bell: inharmonic partials that fade faster the higher they ring. */
  bell({ at, freq, gain = 0.1, dur = 1.2, pan = 0, out = this.out }) {
    ;[[1, 1, 1], [2.76, 0.5, 0.7], [5.4, 0.25, 0.45], [8.93, 0.12, 0.3]].forEach(([ratio, share, length]) =>
      this.tone({ at, freq: freq * ratio, dur: dur * length, gain: gain * share, attack: 0.002, pan, out }),
    )
  }

  /** A soft mallet note. */
  pluck({ at, note, gain = 0.1, dur = 0.35, pan = 0, out = this.out, type = 'triangle' }) {
    const freq = midi(note)
    this.tone({ at, type, freq, dur, gain, pan, out })
    this.tone({ at, freq: freq * 2, dur: dur * 0.35, gain: gain * 0.3, pan, out })
  }
}

// ─── 3 · Voices ─────────────────────────────────────────────────────────────
//
// A voice is (synth, at, options) → nothing: it schedules its parts at time
// `at`. Options: `gain` (loudness, 1 by default), `pan` (-1 left to 1 right)
// and voice-specific fields such as `school`.

/** Each school's three moments: the cast charging, the spell leaving, the spell landing. */
const SCHOOL_VOICES = {
  fire: {
    cast(s, at, { gain, pan }) {
      s.hiss({ at, dur: 0.55, gain: 0.08 * gain, attack: 0.3, freq: 300, to: 1800, q: 1.2, pan })
      s.tone({ at, type: 'sawtooth', freq: 70, to: 110, dur: 0.55, gain: 0.05 * gain, attack: 0.25, cutoff: 500, pan })
    },
    release(s, at, { gain, pan }) {
      s.hiss({ at, dur: 0.32, gain: 0.1 * gain, freq: 2400, to: 500, q: 0.9, pan })
      s.tone({ at, type: 'sawtooth', freq: 160, to: 70, dur: 0.25, gain: 0.04 * gain, cutoff: 700, pan })
    },
    impact(s, at, { gain, pan, size }) {
      s.tone({ at, freq: 110, to: 42, dur: 0.3, gain: 0.22 * gain * size, pan })
      s.hiss({ at, dur: 0.55 * size, gain: 0.14 * gain, type: 'lowpass', freq: 2600, to: 380, pan })
      for (let i = 0; i < 4; i++) s.hiss({ at: at + rand(0.05, 0.35), dur: 0.03, gain: 0.05 * gain, freq: rand(1500, 3500), q: 3, pan })
    },
  },
  frost: {
    cast(s, at, { gain, pan }) {
      for (const note of [86, 93, 98]) s.tone({ at, freq: midi(note), dur: 0.55, gain: 0.025 * gain, attack: 0.22, vibrato: 4, rate: 9, pan })
      s.hiss({ at, dur: 0.5, gain: 0.03 * gain, attack: 0.25, type: 'highpass', freq: 6000, pan })
    },
    release(s, at, { gain, pan }) {
      s.tone({ at, freq: 2600, to: 1200, dur: 0.18, gain: 0.05 * gain, pan })
      s.hiss({ at, dur: 0.22, gain: 0.06 * gain, type: 'highpass', freq: 5000, to: 2500, pan })
    },
    impact(s, at, { gain, pan, size }) {
      for (let i = 0; i < 5; i++) s.tone({ at: at + i * 0.022, freq: rand(2000, 5200), dur: 0.16, gain: 0.04 * gain, pan })
      s.hiss({ at, dur: 0.3 * size, gain: 0.1 * gain, type: 'highpass', freq: 4000, pan })
      s.tone({ at, freq: 140, to: 60, dur: 0.18, gain: 0.12 * gain * size, pan })
    },
  },
  storm: {
    cast(s, at, { gain, pan }) {
      s.tone({ at, type: 'square', freq: 110, dur: 0.5, gain: 0.03 * gain, attack: 0.15, cutoff: 1800, vibrato: 30, rate: 23, pan })
      for (let i = 0; i < 5; i++) s.hiss({ at: at + rand(0, 0.45), dur: 0.025, gain: 0.06 * gain, type: 'highpass', freq: 3000, pan })
    },
    release(s, at, { gain, pan }) {
      s.tone({ at, type: 'sawtooth', freq: 2400, to: 300, dur: 0.12, gain: 0.05 * gain, cutoff: 5000, pan })
      s.hiss({ at, dur: 0.06, gain: 0.08 * gain, type: 'highpass', freq: 2500, pan })
    },
    impact(s, at, { gain, pan, size }) {
      s.hiss({ at, dur: 0.09, gain: 0.22 * gain, type: 'highpass', freq: 2000, pan })
      s.tone({ at, type: 'sawtooth', freq: 1800, to: 120, dur: 0.22, gain: 0.06 * gain, cutoff: 4000, pan })
      s.tone({ at, freq: 120, to: 50, dur: 0.22, gain: 0.15 * gain * size, pan })
    },
  },
  nature: {
    cast(s, at, { gain, pan }) {
      ;[67, 70, 72, 74, 77].forEach((note, i) => s.pluck({ at: at + i * 0.08, note, gain: 0.045 * gain, dur: 0.3, pan }))
      s.hiss({ at, dur: 0.5, gain: 0.03 * gain, attack: 0.2, type: 'lowpass', freq: 1200, pan })
    },
    release(s, at, { gain, pan }) {
      s.hiss({ at, dur: 0.25, gain: 0.06 * gain, freq: 900, to: 1800, q: 1.4, pan })
      s.pluck({ at, note: 79, gain: 0.05 * gain, dur: 0.25, pan })
    },
    impact(s, at, { gain, pan, size }) {
      s.tone({ at, freq: 240, to: 150, dur: 0.14, gain: 0.16 * gain * size, pan })
      s.hiss({ at, dur: 0.1, gain: 0.1 * gain, freq: 900, q: 4, pan })
      s.hiss({ at: at + 0.03, dur: 0.35, gain: 0.04 * gain, type: 'highpass', freq: 3000, pan })
    },
  },
  shadow: {
    cast(s, at, { gain, pan }) {
      for (const detune of [-12, 12]) s.tone({ at, type: 'sawtooth', freq: 55, dur: 0.6, gain: 0.04 * gain, attack: 0.3, cutoff: 500, detune, pan })
      s.tone({ at, freq: 41, dur: 0.6, gain: 0.06 * gain, attack: 0.3, pan })
    },
    release(s, at, { gain, pan }) {
      s.hiss({ at, dur: 0.3, gain: 0.08 * gain, type: 'lowpass', freq: 900, to: 200, pan })
      s.tone({ at, freq: 180, to: 60, dur: 0.28, gain: 0.07 * gain, pan })
    },
    impact(s, at, { gain, pan, size }) {
      s.tone({ at, freq: 80, to: 30, dur: 0.55, gain: 0.26 * gain * size, pan })
      s.hiss({ at, dur: 0.5, gain: 0.1 * gain, type: 'lowpass', freq: 500, pan })
      s.tone({ at, type: 'sawtooth', freq: 62, dur: 0.4, gain: 0.04 * gain, cutoff: 300, pan })
    },
  },
  holy: {
    cast(s, at, { gain, pan }) {
      for (const note of [69, 76, 81]) s.tone({ at, freq: midi(note), dur: 0.6, gain: 0.03 * gain, attack: 0.25, vibrato: 3, rate: 5, pan })
    },
    release(s, at, { gain, pan }) {
      s.bell({ at, freq: midi(93), gain: 0.05 * gain, dur: 0.5, pan })
    },
    impact(s, at, { gain, pan, size }) {
      s.bell({ at, freq: midi(81), gain: 0.12 * gain, dur: 1.2 * size, pan })
      s.tone({ at, freq: 130, to: 70, dur: 0.2, gain: 0.1 * gain * size, pan })
    },
  },
  arcane: {
    cast(s, at, { gain, pan }) {
      s.tone({ at, freq: 440, dur: 0.5, gain: 0.04 * gain, attack: 0.2, vibrato: 40, rate: 7, pan })
      s.tone({ at, freq: 660, dur: 0.5, gain: 0.025 * gain, attack: 0.2, vibrato: 30, rate: 11, pan })
    },
    release(s, at, { gain, pan }) {
      s.tone({ at, freq: 900, to: 300, dur: 0.16, gain: 0.07 * gain, pan })
    },
    impact(s, at, { gain, pan, size }) {
      s.tone({ at, freq: 600, to: 150, dur: 0.25, gain: 0.12 * gain * size, pan })
      s.tone({ at, freq: 1320, dur: 0.18, gain: 0.04 * gain, vibrato: 200, rate: 40, pan })
      s.hiss({ at, dur: 0.2, gain: 0.05 * gain, freq: 1500, q: 2, pan })
    },
  },
}

const schoolVoice = (school) => SCHOOL_VOICES[school] ?? SCHOOL_VOICES.arcane

const VOICES = {
  // Keys and menus ────────────────────────────────────────────────────────
  rune(s, at, { rune, gain }) {
    s.pluck({ at, note: RUNE_NOTES[rune], gain: 0.15 * gain })
  },
  meta(s, at, { gain }) {
    ;[0, 7, 12].forEach((step, i) => s.tone({ at: at + i * 0.03, freq: midi(86 + step), dur: 0.18, gain: 0.04 * gain }))
  },
  move(s, at, { gain }) {
    s.hiss({ at, dur: 0.03, gain: 0.05 * gain, type: 'highpass', freq: 3500 })
  },
  drop(s, at, { gain }) {
    s.tone({ at, freq: 330, to: 160, dur: 0.12, gain: 0.07 * gain })
  },
  ward(s, at, { gain, pan }) {
    s.hiss({ at, dur: 0.28, gain: 0.1 * gain, freq: 600, to: 2400, q: 2, pan })
    s.tone({ at, freq: 520, to: 780, dur: 0.25, gain: 0.05 * gain, pan })
  },
  fizzle(s, at, { gain }) {
    s.tone({ at, type: 'sawtooth', freq: 220, to: 70, dur: 0.3, gain: 0.06 * gain, cutoff: 1200 })
    s.tone({ at, type: 'square', freq: 233, to: 74, dur: 0.3, gain: 0.035 * gain, cutoff: 900 })
  },
  pick(s, at, { gain, on }) {
    s.hiss({ at, dur: 0.16, gain: 0.05 * gain, freq: 1800, to: 900, q: 1.5 })
    s.tone({ at: at + 0.02, type: 'triangle', freq: midi(on ? 76 : 69), to: midi(on ? 81 : 64), glide: 0.08, dur: 0.22, gain: 0.07 * gain })
  },
  click(s, at, { gain }) {
    s.hiss({ at, dur: 0.025, gain: 0.035 * gain, freq: 2500, q: 3 })
  },
  call(s, at, { gain }) {
    s.tone({ at, type: 'square', freq: midi(88), dur: 0.1, gain: 0.03 * gain, cutoff: 2500 })
    s.tone({ at: at + 0.09, type: 'square', freq: midi(93), dur: 0.16, gain: 0.03 * gain, cutoff: 2500 })
  },
  warn(s, at, { gain }) {
    s.bell({ at, freq: midi(81), gain: 0.04 * gain, dur: 0.6 })
    s.bell({ at: at + 0.22, freq: midi(76), gain: 0.04 * gain, dur: 0.8 })
  },

  // Spells ────────────────────────────────────────────────────────────────
  cast(s, at, options) {
    schoolVoice(options.school).cast(s, at, options)
  },
  release(s, at, options) {
    schoolVoice(options.school).release(s, at, options)
  },
  impact(s, at, options) {
    schoolVoice(options.school).impact(s, at, { size: 1, ...options })
  },
  heal(s, at, { gain, pan }) {
    ;[0, 4, 7, 12].forEach((step, i) => s.tone({ at: at + i * 0.05, freq: midi(76 + step), dur: 0.5, gain: 0.06 * gain, pan }))
  },
  boon(s, at, { gain, pan }) {
    for (const note of [88, 91, 95]) s.tone({ at, freq: midi(note), dur: 0.6, gain: 0.03 * gain, attack: 0.12, vibrato: 5, rate: 6, pan })
  },
  bane(s, at, { gain, pan }) {
    s.tone({ at, type: 'square', freq: midi(55), to: midi(50), dur: 0.35, gain: 0.04 * gain, cutoff: 700, pan })
    s.tone({ at, type: 'square', freq: midi(56), to: midi(51), dur: 0.35, gain: 0.03 * gain, cutoff: 600, pan })
  },
  /** A hostile spell flying at you: it rises until it lands, then ticks. Ward on the tick. */
  incoming(s, at, { gain, pan, seconds }) {
    const flight = Math.max(0.08, seconds)
    s.tone({ at, freq: 320, to: 1250, dur: flight + 0.06, attack: flight, gain: 0.08 * gain, pan })
    s.tone({ at, type: 'triangle', freq: 640, to: 2500, dur: flight + 0.04, attack: flight, gain: 0.025 * gain, pan })
    s.hiss({ at: at + flight, dur: 0.05, gain: 0.08 * gain, type: 'highpass', freq: 5000, pan })
  },
  parry(s, at, { gain, pan }) {
    for (const ratio of [1, 2.76, 5.4]) s.tone({ at, type: 'square', freq: 660 * ratio, dur: 0.12, gain: 0.03 * gain, cutoff: 6000, pan })
    s.hiss({ at, dur: 0.15, gain: 0.1 * gain, type: 'highpass', freq: 3500, pan })
    s.bell({ at: at + 0.01, freq: midi(93), gain: 0.09 * gain, dur: 0.9, pan })
  },
  deflect(s, at, { gain, pan }) {
    s.tone({ at, freq: 1400, to: 1800, dur: 0.16, gain: 0.05 * gain, pan })
    s.hiss({ at, dur: 0.1, gain: 0.05 * gain, type: 'highpass', freq: 4500, pan })
  },
  snuff(s, at, { gain, pan }) {
    s.hiss({ at, dur: 0.22, gain: 0.07 * gain, type: 'lowpass', freq: 900, to: 200, pan })
    s.tone({ at, freq: 400, to: 150, dur: 0.18, gain: 0.04 * gain, pan })
  },
  react(s, at, { gain, pan, hit, on }) {
    schoolVoice(hit).impact(s, at, { gain, pan, size: 1.2 })
    schoolVoice(on).impact(s, at + 0.04, { gain: gain * 0.6, pan, size: 0.8 })
    s.bell({ at: at + 0.02, freq: midi(84), gain: 0.06 * gain, dur: 0.7, pan })
    s.bell({ at: at + 0.08, freq: midi(91), gain: 0.05 * gain, dur: 0.7, pan })
  },
  hurt(s, at, { gain, size }) {
    s.tone({ at, freq: 120, to: 45, dur: 0.25, gain: 0.22 * gain * size })
    s.hiss({ at, dur: 0.2, gain: 0.08 * gain * size, type: 'lowpass', freq: 400 })
  },
  flow(s, at, { gain }) {
    ;[74, 77, 79, 81, 84, 86].forEach((note, i) => s.pluck({ at: at + i * 0.04, note, gain: 0.05 * gain, dur: 0.3 }))
  },
  fall(s, at, { gain, pan }) {
    s.tone({ at, freq: 70, to: 28, dur: 1.1, gain: 0.3 * gain, pan })
    s.hiss({ at, dur: 1, gain: 0.12 * gain, type: 'lowpass', freq: 500, to: 80, pan })
    s.tone({ at, type: 'triangle', freq: 440, to: 110, dur: 0.8, gain: 0.05 * gain, pan })
  },
  rise(s, at, { gain, pan }) {
    ;[62, 66, 69, 74, 78].forEach((note, i) => s.pluck({ at: at + i * 0.07, note, gain: 0.06 * gain, dur: 0.6, pan }))
    for (const note of [86, 90]) s.tone({ at, freq: midi(note), dur: 0.9, gain: 0.02 * gain, attack: 0.3, vibrato: 4, pan })
  },
  save(s, at, { gain, pan }) {
    s.bell({ at, freq: midi(74), gain: 0.14 * gain, dur: 1.6, pan })
  },
  shift(s, at, { gain }) {
    for (let i = 0; i < 5; i++) {
      const up = Math.random() < 0.5
      s.tone({ at: at + i * 0.05, freq: rand(500, 900), to: up ? rand(1200, 2000) : rand(200, 350), dur: 0.8, gain: 0.025 * gain, attack: 0.1, vibrato: 6, rate: rand(4, 9) })
    }
    s.hiss({ at, dur: 0.8, gain: 0.05 * gain, attack: 0.3, freq: 400, to: 3000, q: 2 })
  },
  gong(s, at, { gain }) {
    for (const [ratio, share] of [[1, 1], [2.4, 0.5], [3.9, 0.3], [5.2, 0.15]]) s.tone({ at, freq: 98 * ratio, dur: 2.6, gain: 0.12 * share * gain, attack: 0.01, vibrato: 1.5, rate: 3 })
    s.hiss({ at, dur: 1.2, gain: 0.05 * gain, attack: 0.02, type: 'lowpass', freq: 1500, to: 300 })
  },
  surge(s, at, { gain }) {
    s.tone({ at, type: 'sawtooth', freq: 220, to: 40, dur: 1.6, gain: 0.08 * gain, cutoff: 500 })
    s.tone({ at, freq: 45, dur: 1.6, gain: 0.2 * gain, attack: 0.1 })
    s.hiss({ at, dur: 1.4, gain: 0.06 * gain, attack: 0.4, type: 'lowpass', freq: 1200, to: 150 })
  },
  pulse(s, at, { gain }) {
    s.tone({ at, freq: 62, to: 40, dur: 0.18, gain: 0.14 * gain })
    s.tone({ at: at + 0.18, freq: 58, to: 38, dur: 0.22, gain: 0.1 * gain })
  },
  victory(s, at, { gain }) {
    ;[62, 66, 69].forEach((note, i) => s.tone({ at: at + i * 0.15, type: 'square', freq: midi(note), dur: 0.2, gain: 0.04 * gain, cutoff: 2200 }))
    for (const note of [62, 66, 69, 74]) s.tone({ at: at + 0.45, type: 'sawtooth', freq: midi(note), dur: 1.6, gain: 0.03 * gain, attack: 0.02, hold: true, release: 0.8, cutoff: 2400 })
    s.bell({ at: at + 0.45, freq: midi(86), gain: 0.08 * gain, dur: 1.6 })
  },
  defeat(s, at, { gain }) {
    ;[62, 60, 58, 57].forEach((note, i) => s.tone({ at: at + i * 0.35, type: 'triangle', freq: midi(note), dur: 0.6, gain: 0.08 * gain, cutoff: 1400 }))
    s.tone({ at: at + 1.4, type: 'sawtooth', freq: midi(38), dur: 1.8, gain: 0.05 * gain, attack: 0.2, hold: true, release: 1, cutoff: 400 })
  },
  draw(s, at, { gain }) {
    for (const t of [0, 0.4]) for (const note of [62, 69]) s.tone({ at: at + t, type: 'triangle', freq: midi(note), dur: 0.5, gain: 0.06 * gain })
  },
}

/** Sounds that may be dropped when many are playing: the ones about other mages. */
const VOICE_LIMIT = 72

// ─── 4 · Music ──────────────────────────────────────────────────────────────
//
// Four bars in D minor (Dm, B♭, F, C) under both loops. The menu loop is
// slow pads and a sparse arpeggio. The fight loop adds bass, drums and,
// as `level` rises with the surge, faster hats and a sixteenth arpeggio.

const CHORDS = [[62, 65, 69], [58, 62, 65], [60, 65, 69], [60, 64, 67]]
const ROOTS = [38, 34, 41, 36]
const MENU_STEP = 60 / 72 / 4 // seconds per sixteenth
const FIGHT_STEP = 60 / 112 / 4
const MENU_ARP = [0, null, 1, 2, null, 1, 2, null] // chord tone per eighth, null rests
const BASS_LINE = [0, 0, 12, 0, 7, 0, 12, 10] // semitones over the root per eighth

class Music {
  constructor(synth, out) {
    this.s = synth
    this.out = out
    this.mode = null // 'menu', 'fight' or null
    this.level = 0 // fight intensity, 0–1
    this.step = 0
    this.next = 0
  }

  set(mode) {
    if (mode === this.mode) return
    this.mode = mode
    this.step = 0
    this.next = this.s.ctx.currentTime + 0.08
  }

  /** Schedule the steps due in the next moment. Called often by a timer. */
  pump() {
    if (!this.mode) return
    const now = this.s.ctx.currentTime
    if (this.next < now - 0.2) this.next = now + 0.02 // fell behind (a stall): skip, don't burst
    while (this.next < now + 0.15) {
      if (this.mode === 'menu') this.menu(this.step, this.next)
      else this.fight(this.step, this.next)
      this.next += this.mode === 'menu' ? MENU_STEP : FIGHT_STEP
      this.step++
    }
  }

  pad(at, chord, dur, gain) {
    for (const note of chord) {
      for (const detune of [-7, 7]) this.s.tone({ at, type: 'sawtooth', freq: midi(note), dur, gain, attack: 0.8, hold: true, release: 0.9, cutoff: 900, detune, out: this.out })
    }
  }

  menu(step, at) {
    const bar = Math.floor(step / 16) % 4
    const beat = step % 16
    const chord = CHORDS[bar]
    if (beat === 0) {
      this.pad(at, chord, MENU_STEP * 16 + 0.6, 0.018)
      this.s.tone({ at, freq: midi(ROOTS[bar] + 12), dur: MENU_STEP * 16, gain: 0.05, attack: 0.5, hold: true, release: 1, out: this.out })
    }
    const tone = beat % 2 === 0 ? MENU_ARP[beat / 2] : null
    if (tone !== null) this.s.pluck({ at, note: chord[tone] + 12, gain: 0.035, dur: 0.9, out: this.out })
  }

  fight(step, at) {
    const level = this.level
    const bar = Math.floor(step / 16) % 4
    const beat = step % 16
    const chord = CHORDS[bar]
    const out = this.out
    if (beat === 0) this.pad(at, chord, FIGHT_STEP * 16 + 0.4, 0.012)
    // Drums
    const kick = beat === 0 || beat === 8 || (level >= 0.5 && beat === 10) || (level >= 0.8 && (beat === 4 || beat === 12))
    if (kick && level >= 0.3) {
      this.s.tone({ at, freq: 150, to: 45, glide: 0.12, dur: 0.22, gain: 0.2, out })
    }
    if (level >= 0.35 && (beat === 4 || beat === 12)) {
      this.s.hiss({ at, dur: 0.14, gain: 0.07, freq: 1800, q: 0.8, out })
      this.s.tone({ at, freq: 190, to: 140, dur: 0.1, gain: 0.05, out })
    }
    const hat = level >= 0.75 ? true : level >= 0.15 && beat % 2 === 0
    if (hat) this.s.hiss({ at, dur: beat % 4 === 2 ? 0.06 : 0.03, gain: beat % 4 === 2 ? 0.03 : 0.018, type: 'highpass', freq: 7000, out })
    // Bass, an eighth at a time
    if (beat % 2 === 0) {
      const note = ROOTS[bar] + 12 + BASS_LINE[beat / 2]
      this.s.tone({ at, type: 'sawtooth', freq: midi(note), dur: FIGHT_STEP * 1.8, gain: 0.05 * (0.6 + level * 0.4), cutoff: 380 + level * 400, q: 4, out })
    }
    // The arpeggio comes in with the surge
    if (level >= 0.6) this.s.pluck({ at, note: chord[step % 3] + (step % 6 < 3 ? 12 : 24), gain: 0.022, dur: 0.18, out })
  }
}

// ─── 5 · Sound ──────────────────────────────────────────────────────────────

/**
 * The page's sound. Nothing plays until the first click, tap or key (as
 * browsers require); muted, the audio is suspended entirely. A hidden tab
 * goes quiet. `played` counts voices started, for tests.
 */
export class Sound {
  constructor({ muted = false, effects = 1, music = 1 } = {}) {
    this.muted = muted
    this.volume = { effects, music } // 0–1 each, set in the settings
    this.ctx = null
    this.wanted = null // the music mode asked for, applied once audio starts
    this.level = 0
    this.played = 0
    this.recent = new Map() // voice → when it last played, to thin out pile-ups
    const unlock = () => this.unlock()
    for (const type of ['pointerdown', 'keydown', 'touchend']) addEventListener(type, unlock, { capture: true, passive: true })
    document.addEventListener('visibilitychange', () => this.wake())
  }

  /** Build the audio graph on the first gesture, and resume it on later ones. */
  unlock() {
    if (!this.ctx) {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext
      if (!Context) return
      const ctx = new Context({ latencyHint: 'interactive' })
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = 0.8
      const squash = ctx.createDynamicsCompressor()
      squash.threshold.value = -14
      squash.knee.value = 10
      squash.ratio.value = 4
      squash.attack.value = 0.003
      squash.release.value = 0.25
      this.master.connect(squash).connect(ctx.destination)
      // Effects and music each have a bus; both send a little to a shared room.
      const room = ctx.createConvolver()
      room.buffer = roomBuffer(ctx)
      const wet = ctx.createGain()
      wet.gain.value = 0.22
      room.connect(wet).connect(this.master)
      this.sfx = ctx.createGain()
      this.sfx.gain.value = 0.9 * this.volume.effects
      this.score = ctx.createGain()
      this.score.gain.value = 0.32 * this.volume.music
      for (const bus of [this.sfx, this.score]) {
        bus.connect(this.master)
        bus.connect(room)
      }
      this.synth = new Synth(ctx, this.sfx)
      this.track = new Music(this.synth, this.score)
      this.track.level = this.level
      this.timer = setInterval(() => this.track.pump(), 25)
      this.track.set(this.wanted)
    }
    this.wake()
  }

  /** Run the audio only while it can be heard: unmuted, in a visible tab. */
  wake() {
    if (!this.ctx) return
    if (this.muted || document.hidden) this.ctx.suspend().catch(() => {})
    else this.ctx.resume().catch(() => {})
  }

  get running() {
    return this.ctx?.state === 'running' && !this.muted
  }

  setMuted(muted) {
    this.muted = muted
    this.wake()
  }

  /** Effects and music loudness, 0–1 each. */
  setVolume({ effects = this.volume.effects, music = this.volume.music } = {}) {
    this.volume = { effects, music }
    if (!this.ctx) return
    this.sfx.gain.setTargetAtTime(0.9 * effects, this.ctx.currentTime, 0.02)
    this.score.gain.setTargetAtTime(0.32 * music, this.ctx.currentTime, 0.02)
  }

  /** 'menu', 'fight' or null for silence. Asking for the current mode does nothing. */
  music(mode) {
    this.wanted = mode
    this.track?.set(mode)
  }

  /** Fight intensity, 0–1: drums come in, then the arpeggio. */
  intensity(level) {
    this.level = level
    if (this.track) this.track.level = level
  }

  /**
   * Play a voice. `gain` scales it; `important` voices (about you) always
   * play, others are dropped when too many sound at once or the same voice
   * just played.
   */
  play(name, { gain = 1, important = false, delay = 0, ...options } = {}) {
    if (!this.running || !VOICES[name]) return
    const now = this.ctx.currentTime
    if (!important) {
      const key = `${name}:${options.school ?? ''}`
      if (this.synth.live > VOICE_LIMIT || now - (this.recent.get(key) ?? -1) < 0.04) return
      this.recent.set(key, now)
    }
    VOICES[name](this.synth, now + 0.005 + delay, { gain, ...options })
    this.played++
  }

  /** A hostile spell will land on you in `seconds`: a rising cue that ticks on landing. */
  incoming(seconds, pan = 0) {
    this.play('incoming', { seconds, pan, important: true })
  }

  /** Shake gamepads, and the phone when playing by touch. `strength` 0–1. */
  rumble(strength, ms = 120, { touch = false } = {}) {
    const power = clamp(strength, 0, 1)
    for (const pad of navigator.getGamepads?.() ?? []) {
      pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: power, weakMagnitude: Math.min(1, power * 1.4) })?.catch?.(() => {})
    }
    if (touch) navigator.vibrate?.(Math.round(ms * (0.4 + power * 0.6)))
  }
}
