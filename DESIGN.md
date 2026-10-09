# Chordcast design

A complete overview and reference. For setup, see [README.md](README.md).

1. [The game](#1-the-game)
2. [Architecture](#2-architecture)
3. [Core reference](#3-core-reference)
4. [Bots](#4-bots)
5. [Wire protocol](#5-wire-protocol)
6. [Host](#6-host)
7. [Page](#7-page)
8. [Tests](#8-tests)
9. [Extending](#9-extending)
10. [Naming](#10-naming)
11. [Spell reference](#11-spell-reference)

---

## 1. The game

### Match flow

```
home ──► lobby ──► study (6s) ──► fight ──► surge ──► results ──► rematch or lobby
```

- **Home.** Pick a name. Start a quick duel against a bot, host a match, or join one with a four-letter code.
- **Lobby.** The host sets the rules. Players pick open seats. The host can put bots in seats. Open seats become bots when the match starts.
- **Study.** The book for this match opens wide for six seconds. Keys do nothing yet.
- **Fight.** Cast chords until one team has no mage standing.
- **Surge.** After the surge time (90s by default) every mage takes rising damage each second until a team falls.
- **Results.** Damage, healing, damage taken, casts and fizzles per mage. The host can rematch (new book) or return to the lobby.

### Teams and mages

Two teams, **Dawn** (cyan) and **Dusk** (magenta), stand in two rows on either side of the rift. Each team has 1–8 mages; the default is 1 vs 1. Sizes can differ (for example 2 vs 3). Every player sees their own team in the near row.

Each mage has:

| Stat | Value |
|---|---|
| Life | Set by the rules (800 by default) |
| Mana | 100, regains 6 per second |
| Shield | Sum of active shields; absorbs damage before life |
| Auras | Timed effects: boons (good) and banes (bad) |
| Cast | The spell being cast, its target and progress |
| Cooldowns | Per spell, starting when the spell fires |

All of this is visible to everyone, so you can heal, shield and cleanse teammates as easily as you hurt foes.

### Keys

The whole game uses nine keys. Every input mode maps onto them.

| Key | Meaning | Keyboard | Gamepad | Touch |
|---|---|---|---|---|
| `up` `down` `left` `right` | Moves: aim the target | W A S D or arrows | D-pad or left stick | Left pad |
| `star` `wave` `flame` `leaf` | Runes: spell the spell | I J L K | Y X B A | Right pad |
| `drop` | Clear the chord, then the queue, then the cast | Space or Backspace | LB or RB | Center button |

The rune pad is a diamond in the same layout everywhere: star on top, wave left, flame right, leaf bottom. Tab (keyboard) or Start (gamepad) toggles the book; Back (gamepad) opens the guide.

### Chords

A chord is any number of moves followed by a run of runes. The spell fires on the last rune.

```
 up  right   star wave flame
 └─ target ─┘ └─── spell ───┘
```

- Each spell in the book has a chord of runes. Its length is the spell tier plus one: 2, 3 or 4 runes.
- Chords in a book are prefix-free, so a chord is complete the moment it matches.
- A run of runes that can no longer match any spell fizzles at once.
- Moves can come before or between runes, as long as they come before the last rune.
- A chord clears after 2.5 seconds without a key.
- The chords are drawn at random for every match. Learning them fast is the skill.

### Targeting

The target cursor starts on you for every chord.

- `up` jumps to the foe row, to the mage most nearly across from the cursor.
- `down` jumps back to your row the same way.
- `left` and `right` walk along the cursor's row, as seen from your side. The cursor stops at the ends.

While you type, a gold ring marks the target in the arena and its nameplate lights up.

### Casting

When a chord completes, the spell is checked. A failed check is a **fizzle**: keys are ignored for 0.6 seconds.

| Check | Fizzle text |
|---|---|
| The runes match a spell | Unknown chord |
| You are not silenced | Silenced |
| The spell is off cooldown | Not ready |
| You have the mana | Low mana |
| Offense needs a foe, defense needs an ally or you | Needs a foe / Needs an ally |
| Revives need a fallen ally | Needs a fallen ally |
| The target is standing | Target is down |

- Spells with a cast time show a cast bar. Everyone can see what you are casting and at whom.
- A chord finished while you cast (or during the 0.4s after a cast) is **queued** and starts next.
- Mana is spent and the cooldown starts when the spell fires, not when the cast begins.
- Each spell then flies to its target (bolt, beam, meteor and so on) and takes effect when it lands.
- **Stun** and **sleep** stop keys and break casts. Sleep ends on any damage. **Silence** breaks casts and makes chords fizzle.
- **Interrupts** stop a cast in progress and silence the caster.

Spell aims:

| Aim | Target |
|---|---|
| Foe | One foe, or the whole foe side for side spells |
| Ally | You or a teammate, or your whole side |
| Self | Always you; moves are ignored |
| Anyone | Different effects on foes and allies |
| Fallen ally | A teammate who is down |

### Landing

When a hostile spell lands, a **reflect** charge sends the whole spell back to its caster and a **dodge** charge cancels it. Spells that never miss (Magic Missile) skip both.

### Damage, in order

1. Immune targets take nothing.
2. The amount is multiplied by the attacker's damage dealt and the target's damage taken.
3. **Mana shield** pays a share of the damage with mana (2 damage per mana).
4. **Shields** absorb the rest, oldest first, unless the attack goes through shields. A broken shield ends its aura.
5. Life drops. The attacker heals if it has life steal. Sleep ends.
6. At zero life a **death ward** saves the mage at a share of life; otherwise the mage falls and loses all auras.
7. A direct hostile hit triggers the target's **thorns** (damage back) and **when hit** effects.

### Healing, the surge and winning

- Healing is multiplied by the target's healing taken and by **heal power**. Heal power starts at 100% and falls to 40% when the surge begins. The clock shows it.
- From the surge time on, every mage loses 2% of max life per wave, plus 2% more each second (2%, 4%, 6% …).
- A team wins when the other team has no mage standing. If both fall on the same tick, the team that dealt more damage wins; equal damage is a draw.

### The book

Each match draws a new book (12 spells by default, 8–20 allowed):

- Half offense, half defense.
- Per half: a third are tier 1 (rounded up), one in six are tier 3 (at least one), the rest tier 2.
- Offense: at least 60% of spells deal damage. Defense: at least two heal, at least one guards, at most one revive.
- Team spells (revives, Freedom, Contagion) are left out when either team has a single mage.
- Everyone in the match shares the same book and chords.

### Rules

| Rule | Default | Range |
|---|---|---|
| Team sizes | 1 and 1 | 1–8 each |
| Book size | 12 | 8–20, even |
| Life | 800 | 400–3000 |
| Surge at | 90s | 20–600s |
| Bot skill | normal | easy, normal, hard |

---

## 2. Architecture

| File | Role |
|---|---|
| `core.mjs` | The portable engine: rules, spells, books, the match simulation, bots and the wire protocol. No DOM, no Node APIs. |
| `host.mjs` | The web server: static files, WebSocket rooms, codes, seats and the authoritative tick loop. |
| `page.html` | The page structure: views, HUD, pads and the guide. |
| `page.css` | All styles. |
| `page.mjs` | The client: 3D stage, particles, HUD, input and the link to the host. |
| `test.mjs` | Unit, host and browser tests. |

The game is built around messages. Nothing reaches the simulation except `press` orders, and nothing leaves it except events and frames.

```
 browser ── press {key, seq} ──► host ── order ──► Match.receive()
                                  │                    │
                                  │      Arena.step(): pilots press keys,
                                  │      Match.advance() runs one tick
                                  │                    │
 browser ◄── frame {frame, events} ◄── host ◄── flush() + frame()
```

- **One authority.** The host runs every match. Clients only send keys and draw what they receive, so every player sees the same game.
- **Fixed ticks.** 20 ticks per second. Orders are applied at the start of the next tick, in arrival order.
- **Determinism.** A match uses one seeded random generator. The same seed, rules, roster and orders always replay the same match.
- **Bots are players.** Bots press the same keys through the same `press` orders, so they obey the same rules, timeouts and fizzles.
- **Shared code.** The page imports `core.mjs` too, for spell data, text, layout and cursor rules, so the HUD always matches the host.

---

## 3. Core reference

`core.mjs` sections:

| # | Section | Contents |
|---|---|---|
| 1 | Kit | Constants (`TICK_RATE`, `KEYS`, `TIMING`, `RULES`, `LIMITS`, `SKILLS`, `FLIGHTS`), `tidyRules`, `dampenAt` |
| 2 | Dice | `hashText`, `Dice` (seeded mulberry32 with `float`, `int`, `pick`, `shuffle`, `fork`) |
| 3 | Acts | Act and aura builders used by spells |
| 4 | Lore | Plain text built from acts: `describeSpell`, `describeAura`, `AIM_TEXT` |
| 5 | Codex | `CODEX` (all spells), `SPELL` (by id), `actsFor`, `walkActs`, `rolesOf` |
| 6 | Book | `writeBook`, `readRunes`, `splitTiers` |
| 7 | Board | `LAYOUT`, `place`, `rowOf`, `moveCursor`, `pathTo` |
| 8 | Match | `Match`, `lockOf`, and the `OPS` act handlers |
| 9 | Brain | `Brain`, `rateSpell`, `targetsFor`, and the `WEIGH` act weights |
| 10 | Pilot | `Pilot`: turns plans into timed key presses |
| 11 | Arena | `Arena`, `botRoster`, `simulate` |
| 12 | Wire | `WIRE`, `pack`, `unpack`, `CODE_LETTERS` |

### Match API

```js
const match = new Match({ seed, rules, roster }) // roster: [{ id, name, team, slot, bot }]
match.receive({ type: 'press', mage, key, seq }) // queue an order
match.advance()                                  // run one tick
match.flush()                                    // events since the last flush
match.frame()                                    // changing state, sent every tick
match.setup()                                    // fixed facts, sent once
match.view(id)                                   // what a brain may know
match.results()                                  // final numbers
```

Tick order: orders → phase change → surge wave → each standing mage (mana, auras, chord timeout, cast progress, queue) → landing flights → end check.

### Events

Every event is `{ type, tick, ...body }`.

| Type | Body | Meaning |
|---|---|---|
| `start` | | The fight begins |
| `lapse` | `mage` | A chord cleared (timeout or drop) |
| `fizzle` | `mage, why, spell` | A chord failed its check |
| `queue` | `mage, spell, target` | A chord waits for the current cast |
| `cast` | `mage, spell, target, total` | A cast bar starts |
| `stop` | `mage, spell, why` | A cast ends early: `break` or `drop` |
| `fire` | `mage, spell, target, targets, land` | A spell leaves the caster; lands at tick `land` |
| `land` | `mage, spell, target, targets` | A spell arrives |
| `jump` | `spell, from, to` | A chain bounces |
| `strike` | `spell, from, to` | A scatter strike falls |
| `hit` | `from, to, amount, soak, school, direct, echo` | Damage; `soak` was absorbed |
| `mend` | `from, to, amount` | Healing actually gained |
| `void` | `from, to, why` | Nothing happened: `immune`, `evade`, `reflect`, `steady` |
| `mark` | `from, to, name, kind, look, school, time` | An aura is applied or refreshed |
| `fade` | `to, name, why` | An aura ends: `end`, `purge`, `steal`, `break`, `spent`, `used`, `woke` |
| `purge` | `from, to, count, kind` | Auras removed by a dispel |
| `mana` | `to, amount` | Mana gained or lost |
| `fall` | `to, by` | A mage is down |
| `rise` | `from, to` | A mage is revived |
| `save` | `to` | A death ward triggered |
| `swap` | `from, to` | Life shares swapped |
| `refresh` | `from, to` | Cooldowns reset |
| `surge` | `wave` | A surge wave hits everyone |
| `over` | `winner` | The match ends: 0, 1 or -1 (draw) |

### Spells

A spell is plain data:

```js
{ id: 'fireball', name: 'Fireball', kind: 'offense', school: 'fire', tier: 2,
  aim: 'foe', reach: 'one', cast: 1.5, cool: 6, cost: 16, flight: 'bolt',
  acts: [harm(150), dot(10, 4, 'Burning')] }
```

| Field | Values |
|---|---|
| `kind` | `offense` or `defense` |
| `school` | `fire` `frost` `storm` `nature` `shadow` `holy` `arcane` (sets colors and particles) |
| `tier` | 1–3; chord length is tier + 1 |
| `aim` | `foe` `ally` `self` `any` `fallen` (default: foe for offense, ally for defense) |
| `reach` | `one` (default) or `side`: every standing mage on the target's side |
| `cast` `cool` | Seconds |
| `cost` | Mana |
| `flight` | How it travels (see below) |
| `acts` | A list of acts, or `{ foe: [...], ally: [...] }` for aim `any` |
| `team` | `true` if the spell needs teammates |

`defineSpell` fills defaults and adds `roles` (damage, heal, guard, control, dispel, mana, tempo, revive) and `text`.

Flights:

| Flight | Seconds | Look |
|---|---|---|
| `bolt` | 0.55 | A glowing orb on an arc with a trail |
| `volley` | 0.65 | Several small orbs on different arcs |
| `beam` | 0.15 | A stream of particles between caster and target |
| `arc` | 0.10 | Flickering lightning |
| `fall` | 0.70 | A meteor or light falling from the sky |
| `rise` | 0.35 | Energy rising from the ground |
| `nova` | 0.30 | A ring bursting outward on the floor |
| `aura` | 0.15 | Motes drifting to the target |

### Acts

Builders live in the Acts section. Handlers are `OPS` (Match) and weights are `WEIGH` (Brain).

| Act | Builder | Effect |
|---|---|---|
| `harm` | `harm(amount, { school, pierce, sure, bonus })` | Damage. `pierce` ignores shields, `sure` makes the whole spell ignore reflect and dodge, `bonus: { when: 'locked' / 'burning' / 'low', times }` |
| `heal` | `heal(amount)` | Healing |
| `drain` | `drain(amount)` | Damage that heals the caster for the life taken |
| `mana` | `mana(amount)` | Gain (or lose) mana |
| `burn` | `burn(amount, ratio)` | Remove mana; deal `ratio` × removed as damage |
| `siphon` | `siphon(amount)` | Move mana from target to caster |
| `purge` | `purge(count)` / `cleanse(count, kind)` | Remove newest boons / banes / locks (`kind: 'lock'`) |
| `steal` | `steal(count)` | Move boons from target to caster |
| `interrupt` | `interrupt(seconds)` | Stop a cast and silence |
| `chain` | `chain(jumps, falloff, ...acts)` | Apply, then jump to the nearest other mages at a falloff |
| `side` | `side(...acts)` | Apply to every standing mage on the target's side |
| `scatter` | `scatter(count, ...acts)` | Apply to random standing mages on the target's side |
| `self` | `self(...acts)` | Apply to the caster |
| `pick` | `pick(...acts)` | Apply one at random |
| `revive` | `revive(share)` | Raise a fallen mage with a share of life |
| `refresh` | `refresh()` | Clear all cooldowns |
| `swap` | `swap()` | Swap life shares between caster and target |
| `spread` | `spread()` | Copy the target's banes to its allies |
| `kill` | `kill(below, ...acts)` | Slay below a life share, else apply the acts |
| `mark` | `mark(time, rules)` | Apply an aura |

Aura shortcuts: `dot`, `hot`, `stun`, `sleep`, `hush`, `slow`, `haste`, `expose`, `armor`, `weaken`, `empower`, `ward`, `thorns`.

Aura rules (all optional):

| Rule | Meaning |
|---|---|
| `name` `kind` `look` `school` | Identity (`kind` is `boon` or `bane`); `look` picks the visual |
| `pulse` `grow` | Acts every second; `grow` raises their size each pulse |
| `taken` `dealt` `mended` `pace` `flow` | Multipliers: damage taken, damage dealt, healing taken, cast speed, mana regen |
| `lock` | `stun`, `sleep` (ends on damage) or `hush` (silence) |
| `guard` | Shield amount |
| `immune` | Ignore all harm and banes |
| `steady` | Ignore locks |
| `mirror` / `evade` + `charges` | Reflect / dodge the next hostile spells that land |
| `thorns` | Damage returned to attackers |
| `leech` | Heal for a share of damage dealt |
| `cheat` | Survive a killing blow at this share of life |
| `shift` | Share of damage paid with mana |
| `struck` + `charges` | Acts when hit |
| `expire` | Acts when the aura runs out |
| `purged` | Acts on whoever removes it |
| `rewind` | When it ends, restore life to its value at the start if higher |

An aura with the same name on the same mage refreshes instead of stacking.

---

## 4. Bots

A bot is a **Pilot** (hands) driven by a **Brain** (mind).

### The brain contract

```js
brain.think(view) // → { spell, target } | null | Promise<{ spell, target } | null>
```

- `view` is plain data from `match.view(id)`: `me`, `tick`, `phase`, `surgeAt`, `book` (ids and chords), and every mage with life, mana, shield, lock, cast, chord, cooldowns and auras (with their rules).
- The plan names a spell from the book and a target id. `null` means wait.
- A brain may return a Promise. The pilot waits for it without blocking the match. This is the slot for a future LLM brain:

```js
const llmBrain = {
  async think(view) {
    const reply = await askModel(JSON.stringify(view)) // your model call
    return { spell: reply.spell, target: reply.target }
  },
}
arena.seat(mageId, new Pilot({ brain: llmBrain, skill: 'normal' }))
```

### The built-in brain

`Brain` scores every ready, affordable spell on every valid target and picks the best. Scores come from the acts themselves (`WEIGH`), so new spells need no brain changes:

- Damage is worth more on low-life foes and doubles when it would finish them. Reflect and immune targets are avoided.
- Healing counts only missing life, more when the target is low.
- Shields, armor and death wards are worth more on allies in danger (low life, or foes casting at them).
- Stuns and interrupts are worth a lot on foes who are casting.
- Refreshing an aura that still has time left is worth little.
- Mana cost is subtracted, more when mana is low; long casts are discounted.
- Skill adds noise to the scores (45% easy, 18% normal, 5% hard).

### The pilot

The pilot asks the brain when it is free, waits a reaction time, then types the moves (`pathTo`) and runes with human-like gaps. It drops a plan if its target falls or the spell stops being usable.

| Skill | Think pause | Key gap | Reaction | Noise |
|---|---|---|---|---|
| easy | 1.2–2.0s | 0.30–0.42s | 0.5–0.9s | 45% |
| normal | 0.6–1.1s | 0.19–0.27s | 0.3–0.6s | 18% |
| hard | 0.25–0.5s | 0.12–0.17s | 0.15–0.3s | 5% |

`simulate({ seed, rules, skills })` plays a whole bots-only match headless, which is useful for tuning numbers.

---

## 5. Wire protocol

One WebSocket per tab at `/wire`. Every message is JSON `{ type, ...body }`. `unpack(text, 'peer')` checks each field and drops anything malformed.

Peer → host:

| Type | Body | Who | Effect |
|---|---|---|---|
| `hello` | `name` | anyone | Set your name (1–16 letters, digits, spaces) |
| `open` | `rules` | anyone | Host a new room and join it |
| `join` | `code` | anyone | Join a room by code |
| `seat` | `team, slot` | anyone | Move to an open seat (lobby) |
| `bench` | `team, slot` | host | Toggle a bot in a seat (lobby) |
| `tune` | `rules` | host | Change the rules (lobby) |
| `start` | | host | Start the match |
| `press` | `key, seq` | seated players | One key; `seq` counts presses for local echo |
| `again` | | host | Rematch with a new book |
| `lobby` | | host | Return everyone to the lobby |
| `leave` | | anyone | Leave the room |

Host → peer:

| Type | Body | When |
|---|---|---|
| `welcome` | `you` | On connect: your peer id |
| `room` | `room` | Lobby state changed: code, owner, phase, rules, seats, watchers |
| `begin` | `setup, you` | A match starts; `you` is your mage id or `null` when watching |
| `frame` | `frame, events` | Every tick |
| `end` | `results` | The match is over |
| `fault` | `text` | A request failed |

---

## 6. Host

- **Routes.** `/` and the five page files, `/lib/three/...` (from `node_modules/three/build` and `examples` only), `/health`, and the WebSocket at `/wire`.
- **Codes.** Four letters from 20 consonants, so codes never spell words.
- **Rooms.** A room has rules, two rows of seats (`open`, `human` or `bot`), peers and a phase: `lobby`, `match` or `after`. The first peer is the host; if they leave, the next peer takes over.
- **Seats.** New peers sit on the team with fewer people. Peers without a seat watch. Shrinking a team turns extra players into watchers.
- **The loop.** Every 25ms the room runs every tick that is due (catching up at most 10 ticks) and sends one frame with all their events.
- **Leaving mid-match.** A bot pilot takes over the mage, so the match is never broken.
- **Limits.** 60 messages per second per peer, 4KB per message, 500 rooms.

Start it with `npm start`, or import it: `const host = await openHost({ port: 0 })` returns `{ port, url, hall, close }`.

---

## 7. Page

`page.mjs` sections:

| # | Section | Role |
|---|---|---|
| 1 | Kit | DOM helpers, SVG glyphs, key labels, palettes, canvas textures |
| 2 | Link | WebSocket wrapper with handlers and reconnect |
| 3 | Pads | Keyboard, gamepad and touch → the nine keys |
| 4 | Sparks | The GPU particle system |
| 5 | Rings | Pooled floor shockwave rings and camera-facing ribbon bolts |
| 6 | Looks | Particle recipes and status looks |
| 7 | Figure | One mage: model, motion and status visuals |
| 8 | Flight | One spell in the air |
| 9 | Stage | Scene, world, camera, effects and the render loop |
| 10 | Plates | Nameplates and floating numbers |
| 11 | Hud | Clock, banner, book and chord tray |
| 12 | Views | Lobby and result rendering, toasts |
| 13 | Game | Client state: messages in, visuals out |
| 14 | Boot | Starts the game; `window.chordcast` is the game object |

### Rendering

- Three.js with ACES tone mapping and an Unreal bloom pass. The scene renders into a multisampled half-float buffer (MSAA), bloom runs at CSS-pixel size so it spreads the same on every screen, and the output pass adds a faint dither so dark gradients do not band.
- The sky is a procedural nebula shader, baked once into a cube map.
- The floor shader draws team-tinted grids, rotating rune rings and the glowing rift line. Its lines are filtered by their size on screen (`fwidth`), so distant grid lines fade instead of shimmering. A translucent curtain marks the rift itself.
- Turned pillars with glowing bands and floating crystals ring the arena; craggy rocks drift in the distance.
- Each mage is built from smooth shapes: a lathed robe and a hat whose tip droops (both welded for smooth normals), glowing eyes, a staff with a gem and an orbiting ring, and a chamfered hexagonal pedestal in team colors. Robes and hats get a soft rim light in the team color.
- Static parts that share a material are merged (brim and crown, both eyes), and the world shares geometry and materials, so a mage costs about twenty draw calls.

### Quality

| Tier | Pixel ratio cap | MSAA | Small particles |
|---|---|---|---|
| low | 0.85 | off | half |
| medium | 1 | 2× | three quarters |
| high | 1.5 | 4× | all |
| ultra | 2 | 4× | all |

- The start tier is a guess: software renderers start low, small devices (≤ 4 cores or ≤ 3 GB) medium, touch devices high, others ultra. `?quality=low|medium|high|ultra` pins a tier.
- The governor drops a tier when frames stay slower than 40 per second for 1.5 seconds. If the drop does not speed frames up (a capped display or a busy CPU), it is undone and that tier becomes the floor. After 10 seconds of fast frames it climbs back, never above a tier that just failed.
- Points under two pixels are drawn two pixels wide and fainter, so tiny sparks do not flicker.

### Sparks

One ring buffer of particles per blend mode: **glow** (additive, 24,000) and **haze** (alpha, 6,000). The CPU writes a particle once, at birth. The vertex shader computes its position from its age:

```
position = pivot + rotateY(offset + drift(velocity, drag, t), swirl · t) + ½ · gravity · t²
```

| Attribute | Data |
|---|---|
| `position` | Pivot point |
| `aOffset` | Start offset from the pivot (for orbits and spirals) |
| `aVelocity` | Start velocity |
| `aColor` | RGB and alpha |
| `aLife` | Birth time, life, size, shape |
| `aForce` | Gravity, drag, swirl, growth |

Shapes are drawn in the fragment shader: glow, star, ring, shard, smoke, leaf, rune, flake, spark (stretched along its motion) and bubble. Each frame uploads only the slots written that frame.

### Looks

Recipes (`burst`, `smoke`, `ground`, `pillar`, `spiral`, `implode`, `trail`, `stream`, `beam`, `lightning`, `mend`, `shatter`, `puff`, `confetti`) take a point and a school. `lightning` and `beam` draw **bolts**: polylines expanded into camera-facing strips in the vertex shader, with a hot core and soft edges. Lightning forks and flickers; beams ripple. Flights lay trails at a fixed rate along the stretch flown since the last frame, so they look the same at any frame rate. Schools set three colors, a body shape, a bit shape and a lift (fire rises, frost falls).

Status looks (`STATUS_LOOK`) are rows of data: emission rate, shape, color, anchor (head, chest, body, feet) and motion (rise, fall, drift, orbit, burst, still). Some looks also switch meshes on the figure: shield bubble, ice block, sheep, stone or gold tint, and a ghostly body when banished.

### Events → visuals

| Event | Visual |
|---|---|
| `cast` | Magic circle under the caster in the school color, gem glow, particles drawn into the gem |
| `fire` | Gem flash and a `Flight` timed to land on the `land` tick |
| `land` | Impact by role: burst and shockwave (damage), rising motes and pillar (heal), spiral (boon), implosion (bane) |
| `hit` | Flinch and a brief white flash (faint for damage over time), small burst, damage number in the school color; red vignette when you are hit hard |
| `jump` | A forked lightning bolt between the two mages |
| `mend` | Green number |
| `void` | "Immune", "Dodged", "Reflected", "Resisted" |
| `fade` (break) | Shield shatters into shards |
| `fall` | Shadow burst, camera shake, the mage tips over and fades |
| `rise` | Golden pillar |
| `surge` | Rift and floor glow brighter, small shake |
| `over` | Confetti over the winners, then the results card |

A hidden tab draws nothing, so it skips effects and applies only events that leave lasting state (`fizzle`, `surge`, `over`); otherwise every effect from the time away would burst out at once on return.

### Camera and HUD

- Match camera: behind your row, pitched so your row sits low and the foe row high. It backs off to fit the widest row and shifts into the free band between the top bar and the tray or touch pads.
- Menus: a slow orbit around a silent demo duel, shifted right on wide screens so the cards don't cover it.
- Nameplates: under the feet for your row, above the hats for the foe row; shrunk when neighbours would overlap. They show name, life with shield stripes, mana, cast bar, the runes being typed and aura chips with a time bar.
- Chord tray: target name, the keys typed (pending keys are dimmed until the host confirms them) and the spells that still match.
- Book: offense and defense lists with chords, cost, target and a cooldown sweep. Rows that no longer match the typed runes dim.

### Local echo

Each press carries a `seq`. Frames report the last `seq` the host processed. The page replays unconfirmed presses on top of the host's chord with the same core rules (`moveCursor`, `readRunes`), so the tray and cursor respond at once and never disagree with the host for long.

---

## 8. Tests

`npm test` runs `test.mjs` with Node's test runner.

| Group | Covers |
|---|---|
| Core | Spell list shape and size; rule clamping; book balance, chord lengths, prefix-free chords and seeding; rune reading; cursor paths for both sides; a full cast; every fizzle reason; stuns and drop; reflect, dodge and never-miss; every spell in the codex cast and landed; determinism; bots finishing 1v1 to 4v4; hard beating easy; async brains; wire validation; this document listing every spell |
| Host | Hosting, bad codes, joining by code, tuning, bots filling seats, shared books, presses echoed by `seq`, leaving mid-match, match end |
| Views | A Playwright run through every screen, saved to `shots/` |

Screenshots in `shots/`:

| File | View |
|---|---|
| `01-home.png` | Home over the demo duel |
| `02-guide.png` | How to play |
| `03-lobby.png` | A new lobby with its code |
| `04-lobby-joined.png` | A friend joined from a share link; 2 vs 2 with a bot |
| `05-study.png` | The book before the fight |
| `06-chord.png` | Typing a chord: target ring, tray and matching spells |
| `07-cast.png` | Casting |
| `08-battle.png` | A 2 vs 2 fight in full swing |
| `09-book.png` | Reading a spell in the book |
| `10-gamepad.png` | Gamepad input with Y X B A labels |
| `11-result.png` | Results |
| `12-phone-home.png` | Home on a phone |
| `13-phone-study.png` | The book on a phone |
| `14-phone-fight.png` | Touch pads in a fight |
| `15-watching.png` | Watching the phone's duel |

The browser test uses software WebGL, so it keeps at most two pages open and freezes the one it is not driving. Pages play at the low tier; each screenshot is drawn at the top tier.

---

## 9. Extending

**Add a spell.** Add one object to `SPELL_LIST` in `core.mjs`. Text, roles, book drawing, brain scoring and visuals follow from its data. Add a row to the spell reference below (a test checks every spell is listed).

**Add an act.** Add a builder in Acts, a handler in `OPS`, a weight in `WEIGH`, a line in `LORE`, and roles in `rolesOf` if it has a new purpose.

**Add an aura rule.** Read it in `Match.hurt`, `mend`, `tendAuras` or `factor`; describe it in `describeAura`; weigh it in `auraGain`.

**Add a status look.** Add a row to `STATUS_LOOK` in `page.mjs`. For a mesh, toggle it in `Figure.update`.

**Add a school.** Add it to `SCHOOLS` (core), `SCHOOL_LOOK` (page) and a `--school` color (CSS).

**Add a flight.** Add its seconds to `FLIGHTS` (core) and a branch in `Flight.update` (page).

**Add an input mode.** Turn its events into the nine keys in `Pads` and add labels in `LABELS`.

**Add a brain.** Implement `think(view)` and seat it with `new Pilot({ brain })`.

---

## 10. Naming

- **Short plain words.** Modules and classes are single nouns: `Dice`, `Codex`, `Book`, `Board`, `Match`, `Brain`, `Pilot`, `Arena`, `Wire`, `Link`, `Pads`, `Sparks`, `Rings`, `Looks`, `Figure`, `Flight`, `Stage`, `Plates`, `Hud`.
- **Balanced pairs.** Opposites share a shape: `boon`/`bane`, `Dawn`/`Dusk`, `harm`/`heal`, `mark`/`unmark`, `pack`/`unpack`, `offense`/`defense`, `glow`/`haze`, `beginCast`/`endCast`.
- **Verb first for actions.** `writeBook`, `readRunes`, `moveCursor`, `tidyRules`, `rateSpell`, `paintGlyphs`, `renderLobby`.
- **One syllable where it fits.** Keys (`up`, `star`, `wave`, `flame`, `leaf`, `drop`), acts (`harm`, `heal`, `burn`, `mark`, `swap`), aura rules (`guard`, `lock`, `pace`, `flow`, `cheat`, `shift`).
- **The same word everywhere.** A rule is called the same thing in code, wire, UI and this document.

---

## 11. Spell reference

137 spells: 82 offense and 55 defense. ¹ marks team spells, left out when a team has a single mage. Text is generated from each spell's acts.

### Offense (82)

| Spell | School | Tier | Target | Cast | Cool | Mana | Effect |
|---|---|---|---|---|---|---|---|
| Fire Bolt | fire | 1 | Foe | 0.8s | 2s | 6 | Deal 70 fire. |
| Scorch | fire | 1 | Foe | — | 4s | 8 | Deal 55 fire. |
| Immolate | fire | 1 | Foe | 1s | 6s | 10 | Deal 40 fire. Immolated: 16 fire per second for 8s. |
| Fireball | fire | 2 | Foe | 1.5s | 6s | 16 | Deal 150 fire. Burning: 10 fire per second for 4s. |
| Scorching Ray | fire | 2 | Foe | 1s | 8s | 16 | Deal 50 fire, 3 times. |
| Living Bomb | fire | 2 | Foe | — | 12s | 18 | Living Bomb: 15 fire per second for 4s, then deal 110 fire to everyone on that side. |
| Flame Strike | fire | 2 | Foe side | 1.5s | 10s | 22 | Deal 100 fire. Burning: 8 fire per second for 4s. Hits the whole side. |
| Lava Burst | fire | 2 | Foe | 1.5s | 8s | 18 | Deal 140 fire (×1.5 on burning foes). |
| Dragon Breath | fire | 2 | Foe | — | 16s | 18 | Deal 90 fire. Disoriented: can’t act (breaks on damage) for 3s. |
| Combustion | fire | 2 | Self | — | 24s | 14 | Combustion: deal 30% more damage for 6s. |
| Pyroblast | fire | 3 | Foe | 2.5s | 18s | 32 | Deal 300 fire. Burning: 20 fire per second for 6s. |
| Meteor | fire | 3 | Foe | 2s | 24s | 36 | Deal 240 fire. Deal 90 fire to everyone on that side. |
| Fire Wall | fire | 3 | Foe side | 1.5s | 20s | 30 | Fire Wall: 25 fire per second for 6s. Hits the whole side. |
| Frost Ray | frost | 1 | Foe | 1s | 3s | 8 | Deal 60 frost. Chilled: cast 30% slower for 4s. |
| Ice Lance | frost | 1 | Foe | — | 3s | 8 | Deal 45 frost (×3 on stunned or sleeping foes). |
| Frostbolt | frost | 2 | Foe | 1.5s | 5s | 16 | Deal 140 frost. Chilled: cast 30% slower for 5s. |
| Cone of Cold | frost | 2 | Foe side | — | 12s | 20 | Deal 80 frost. Chilled: cast 40% slower for 4s. Hits the whole side. |
| Frost Nova | frost | 2 | Foe side | — | 20s | 18 | Deal 30 frost. Frozen: stunned for 2s. Hits the whole side. |
| Ice Storm | frost | 2 | Foe side | 1.2s | 12s | 22 | Deal 100 frost. Hits the whole side. |
| Blizzard | frost | 3 | Foe side | 2s | 20s | 30 | Blizzard: 22 frost per second for 6s. Chilled: cast 30% slower for 6s. Hits the whole side. |
| Glacial Spike | frost | 3 | Foe | 2.5s | 20s | 30 | Deal 260 frost. Frozen: stunned for 2.5s. |
| Shocking Grasp | storm | 1 | Foe | — | 10s | 10 | Deal 50 storm. Interrupt a cast and silence 1.5s. |
| Thunderclap | storm | 1 | Foe side | — | 10s | 12 | Deal 40 storm. Interrupt a cast and silence 1s. Hits the whole side. |
| Spark | storm | 1 | Foe | 0.6s | 2s | 6 | Deal 60 storm. |
| Lightning Bolt | storm | 2 | Foe | 1.5s | 6s | 16 | Deal 160 storm. |
| Chain Lightning | storm | 2 | Foe | 1.5s | 10s | 22 | Deal 120 storm, then jump to 2 more at 70% each. |
| Witch Bolt | storm | 2 | Foe | 1s | 10s | 14 | Deal 70 storm. Tethered: 20 storm per second for 5s. |
| Call Lightning | storm | 2 | Foe | 1s | 8s | 18 | Deal 130 storm. |
| Ball Lightning | storm | 2 | Foe | 1s | 12s | 20 | 4 strikes on random foes: deal 45 storm each. |
| Storm Fury | storm | 3 | Foe side | 2s | 22s | 34 | Deal 150 storm. Dazed: can’t act (breaks on damage) for 1.5s. Hits the whole side. |
| Chill Touch | shadow | 1 | Foe | — | 6s | 8 | Deal 50 shadow. No Healing: no healing for 4s. |
| Eldritch Blast | shadow | 1 | Foe | — | 3s | 8 | Deal 35 shadow, 2 times. |
| Corruption | shadow | 1 | Foe | — | 5s | 8 | Corruption: 16 shadow per second for 10s. |
| Agony | shadow | 1 | Foe | — | 6s | 8 | Agony: 6 shadow per second, rising for 12s. |
| Hex | shadow | 1 | Foe | — | 10s | 8 | Hexed: take 15% more damage for 8s. |
| Shadow Bolt | shadow | 2 | Foe | 1.5s | 5s | 16 | Deal 150 shadow. |
| Drain Life | shadow | 2 | Foe | 1.5s | 8s | 16 | Drain 120 life. |
| Vampiric Touch | shadow | 2 | Foe | 1.2s | 8s | 16 | Vampiric Touch: drain 20 life each second for 8s. |
| Unstable Affliction | shadow | 2 | Foe | 1.2s | 8s | 16 | Unstable Affliction: 30 shadow per second for 6s. If removed, the remover suffers: deal 150 shadow, silence 3s. |
| Death Coil | shadow | 2 | Foe | — | 16s | 16 | Deal 110 shadow. Horrified: can’t act (breaks on damage) for 2.5s. |
| Fear | shadow | 2 | Foe | 1.2s | 14s | 14 | Feared: can’t act (breaks on damage) for 5s. |
| Blight | shadow | 2 | Foe | 1s | 8s | 18 | Deal 130 shadow. Blighted: 50% less healing for 4s. |
| Mind Blast | shadow | 2 | Foe | 1.2s | 6s | 16 | Deal 120 shadow. Burn 10 mana. |
| Contagion | shadow | 2 | Foe ¹ | — | 16s | 16 | Copy its banes to its allies. |
| Howl of Terror | shadow | 3 | Foe side | — | 30s | 26 | Feared: can’t act (breaks on damage) for 3s. Hits the whole side. |
| Doom | shadow | 3 | Foe | — | 24s | 30 | Doom: after 6s, deal 340 shadow. |
| Void Hunger | shadow | 3 | Foe side | 1.5s | 20s | 30 | Void Hunger: 20 shadow per second for 5s. Slowed: cast 30% slower for 5s. Hits the whole side. |
| Finger of Death | shadow | 3 | Foe | 2s | 22s | 32 | Deal 300 shadow. |
| Kill Word | shadow | 3 | Foe | — | 30s | 30 | Slay if below 20% life, else deal 60 shadow. |
| Soul Swap | shadow | 3 | Foe | 1.5s | 40s | 30 | Swap life shares with the target. |
| Smite | holy | 1 | Foe | 1s | 2s | 8 | Deal 70 holy. |
| Sacred Flame | holy | 1 | Foe | — | 4s | 8 | Deal 55 holy through shields. |
| Guiding Bolt | holy | 2 | Foe | 1.2s | 8s | 16 | Deal 120 holy. Guided: take 20% more damage for 4s. |
| Holy Fire | holy | 2 | Foe | 1.5s | 10s | 18 | Deal 110 holy. Holy Fire: 12 holy per second for 6s. |
| Judgment | holy | 2 | Foe | — | 14s | 14 | Deal 80 holy. Silenced for 2.5s. |
| Holy Shock | holy | 2 | Anyone | — | 8s | 14 | On a foe: deal 110 holy. On an ally: heal 140. |
| Sunbeam | holy | 3 | Foe | 2s | 18s | 30 | Deal 220 holy. Blinded: can’t act (breaks on damage) for 2s. |
| Wrath | nature | 1 | Foe | 1s | 2s | 8 | Deal 70 nature. |
| Poison Spray | nature | 1 | Foe | — | 5s | 8 | Deal 35 nature. Poisoned: 10 nature per second for 6s. |
| Acid Splash | nature | 1 | Foe | — | 6s | 8 | Deal 45 nature. Corroded: take 10% more damage for 4s. |
| Thorn Whip | nature | 1 | Foe | — | 8s | 10 | Deal 40 nature. Snared: cast 25% slower for 4s. |
| Entangle | nature | 2 | Foe | 1s | 16s | 14 | Rooted: stunned for 2.5s. Thorned: 10 nature per second for 4s. |
| Insect Swarm | nature | 2 | Foe | 1s | 10s | 14 | Swarmed: 18 nature per second for 8s. Weakened: deal 20% less damage for 8s. |
| Earthquake | nature | 3 | Foe side | 2s | 22s | 32 | Deal 120 nature. Knocked Down: stunned for 1s. Hits the whole side. |
| Magic Missile | arcane | 1 | Foe | 1s | 3s | 8 | Deal 25 arcane that never misses, 3 times. |
| Moonfire | arcane | 1 | Foe | — | 5s | 8 | Deal 40 arcane. Moonfire: 12 arcane per second for 8s. |
| Purge | arcane | 1 | Foe | — | 8s | 8 | Remove 2 boons. |
| Mana Burn | arcane | 1 | Foe | 1s | 8s | 10 | Burn 25 mana and deal 2× that as arcane. |
| Arcane Blast | arcane | 2 | Foe | 1.5s | 4s | 20 | Deal 160 arcane. |
| Arcane Missiles | arcane | 2 | Foe | 1.5s | 8s | 16 | Deal 35 arcane, 5 times. |
| Starfire | arcane | 2 | Foe | 2s | 6s | 18 | Deal 190 arcane. |
| Counterspell | arcane | 2 | Foe | — | 16s | 12 | Interrupt a cast and silence 3s. |
| Polymorph | arcane | 2 | Foe | 1.5s | 18s | 14 | Sheep: heal 20 per second, can’t act (breaks on damage) for 6s. |
| Spell Steal | arcane | 2 | Foe | 1s | 10s | 14 | Steal 1 boon. |
| Slow | arcane | 2 | Foe | 1s | 14s | 12 | Slowed: cast 50% slower for 6s. |
| Mana Siphon | arcane | 2 | Foe | 1s | 12s | 0 | Steal 25 mana. |
| Chaos Bolt | arcane | 2 | Foe | 1.5s | 8s | 18 | One at random: deal 160 fire / deal 160 frost / deal 160 storm / deal 160 shadow / deal 160 arcane. |
| Disintegrate | arcane | 3 | Foe | 2s | 20s | 32 | Deal 240 arcane (×2 below 30% life). |
| Starfall | arcane | 3 | Foe | — | 24s | 30 | 6 strikes on random foes: deal 55 arcane each. |
| Time Stop | arcane | 3 | Foe side | 1s | 40s | 30 | Time Stopped: stunned for 2.5s. Hits the whole side. |
| Feeblemind | arcane | 3 | Foe | 2s | 30s | 26 | Deal 100 arcane. Feebleminded: silenced for 4s. Burn 30 mana. |
| Prismatic Spray | arcane | 3 | Foe side | 1.5s | 20s | 30 | One at random: deal 140 fire / deal 140 frost / deal 140 storm / deal 140 nature / silenced for 3s / Petrified: stunned for 2s / Slowed: cast 50% slower for 5s. Hits the whole side. |

### Defense (55)

| Spell | School | Tier | Target | Cast | Cool | Mana | Effect |
|---|---|---|---|---|---|---|---|
| Rebuke | fire | 1 | Self | — | 14s | 8 | Rebuke: return 50 fire to attackers for 8s. |
| Cauterize | fire | 2 | Self | — | 20s | 12 | Heal 220. Cauterized: 15 fire per second for 4s. |
| Ice Block | frost | 3 | Self | — | 40s | 10 | Remove all banes. Ice Block: stunned, immune to harm for 4s. |
| Ice Barrier | frost | 2 | Ally | — | 14s | 16 | Ice Barrier: shield 180 for 10s. |
| Frost Armor | frost | 2 | Self | — | 16s | 14 | Frost Armor: shield 120, return 30 frost to attackers for 12s. |
| Winter Veil | frost | 1 | Ally | — | 10s | 8 | Winter Veil: take 20% less damage for 6s. |
| Tailwind | storm | 2 | Ally | — | 16s | 14 | Tailwind: cast 40% faster for 8s. |
| Lightning Shield | storm | 1 | Self | — | 12s | 10 | Lightning Shield: return 40 storm to attackers for 10s. |
| Grounding | storm | 2 | Ally | — | 18s | 12 | Grounded: dodge the next spell for 8s. |
| Life Tap | shadow | 1 | Self | — | 10s | 0 | Deal 100 shadow through shields. Restore 30 mana. |
| Resolve | shadow | 2 | Self | — | 24s | 12 | Resolve: take 40% less damage, immune to stun and silence for 6s. |
| Healing Word | holy | 1 | Ally | — | 4s | 8 | Heal 70. |
| Flash Heal | holy | 1 | Ally | 1s | 3s | 12 | Heal 110. |
| Renew | holy | 1 | Ally | — | 4s | 8 | Renew: heal 18 per second for 8s. |
| Power Shield | holy | 1 | Ally | — | 8s | 12 | Power Shield: shield 130 for 10s. |
| Cleanse | holy | 1 | Ally | — | 6s | 8 | Remove 2 banes. |
| Cure Wounds | holy | 2 | Ally | 1.5s | 4s | 16 | Heal 170. |
| Penance | holy | 2 | Anyone | 1s | 10s | 16 | On a foe: deal 45 holy, 3 times. On an ally: heal 55, 3 times. |
| Pain Suppression | holy | 2 | Ally | — | 24s | 12 | Pain Suppression: take 40% less damage for 6s. |
| Death Ward | holy | 2 | Ally | — | 30s | 16 | Death Ward: survive a killing blow at 10% life for 20s. |
| Prayer of Mending | holy | 2 | Ally | — | 10s | 14 | Prayer of Mending: when hit, heal 80 (up to 3×) for 20s. |
| Bless | holy | 2 | Ally side | — | 18s | 18 | Blessed: take 10% less damage, deal 15% more damage for 8s. Hits the whole side. |
| Freedom | holy | 2 | Ally ¹ | — | 18s | 12 | Remove stuns, sleeps and silences. Freedom: immune to stun and silence for 4s. |
| Holy Nova | holy | 2 | Ally side | — | 12s | 18 | Heal 70. Hits the whole side. |
| Greater Heal | holy | 3 | Ally | 2.5s | 10s | 30 | Heal 360. |
| Prayer of Healing | holy | 3 | Ally side | 2s | 14s | 30 | Heal 140. Hits the whole side. |
| Guardian Spirit | holy | 3 | Ally | — | 40s | 20 | Guardian Spirit: 40% more healing, survive a killing blow at 40% life for 8s. |
| Divine Shield | holy | 3 | Self | — | 45s | 16 | Divine Shield: immune to harm for 3s. |
| Lay on Hands | holy | 3 | Ally | — | 45s | 0 | Heal 500. |
| Revive | holy | 3 | Fallen ally ¹ | 3s | 30s | 30 | Revive with 35% life. |
| Rejuvenate | nature | 1 | Ally | — | 4s | 8 | Rejuvenate: heal 15 per second for 10s. |
| Barkskin | nature | 1 | Self | — | 16s | 6 | Barkskin: take 25% less damage for 8s. |
| Thorns | nature | 1 | Ally | — | 12s | 8 | Thorns: return 35 nature to attackers for 12s. |
| Lifebloom | nature | 2 | Ally | — | 8s | 14 | Lifebloom: heal 12 per second for 6s, then heal 150. |
| Regrowth | nature | 2 | Ally | 1.2s | 6s | 16 | Heal 100. Regrowth: heal 10 per second for 6s. |
| Ironbark | nature | 2 | Ally | — | 20s | 12 | Ironbark: take 30% less damage for 8s. |
| Earth Shield | nature | 2 | Ally | — | 12s | 14 | Earth Shield: when hit, heal 60 (up to 4×) for 20s. |
| Chain Heal | nature | 2 | Ally | 1.5s | 8s | 20 | Heal 150, then jump to 2 more at 70% each. |
| Stoneskin | nature | 2 | Ally | 1s | 14s | 16 | Stoneskin: shield 160, take 10% less damage for 12s. |
| Innervate | nature | 2 | Ally | — | 30s | 0 | Innervate: mana regen ×3 for 8s. |
| Tranquility | nature | 3 | Ally side | 2s | 24s | 32 | Tranquility: heal 30 per second for 6s. Hits the whole side. |
| Healing Rain | nature | 3 | Ally side | 1.5s | 20s | 28 | Healing Rain: heal 22 per second for 8s. Hits the whole side. |
| Rebirth | nature | 3 | Fallen ally ¹ | 1.5s | 40s | 30 | Revive with 25% life. |
| Arcane Ward | arcane | 1 | Ally | — | 8s | 10 | Arcane Ward: shield 100 for 8s. |
| Mage Armor | arcane | 1 | Self | — | 16s | 8 | Mage Armor: shield 100, take 10% less damage for 10s. |
| Dispel Magic | arcane | 1 | Anyone | — | 6s | 8 | On a foe: remove 1 boon. On an ally: remove 1 bane. |
| Mirror Image | arcane | 2 | Self | — | 20s | 14 | Mirror Image: dodge the next 2 spells for 10s. |
| Haste | arcane | 2 | Ally | — | 18s | 14 | Hasted: cast 50% faster for 8s. |
| Mana Shield | arcane | 2 | Self | — | 16s | 8 | Mana Shield: 60% of damage drains mana instead for 10s. |
| Spell Reflect | arcane | 2 | Ally | — | 16s | 12 | Spell Reflect: reflect the next spell for 6s. |
| Rewind | arcane | 2 | Self | — | 30s | 12 | Rewind: after 6s, return to your life at the start if it was higher. |
| Evocation | arcane | 2 | Self | 2s | 30s | 0 | Restore 50 mana. |
| Globe of Warding | arcane | 3 | Ally side | 1s | 40s | 28 | Warded: take 50% less damage for 4s. Hits the whole side. |
| Time Warp | arcane | 3 | Ally | — | 45s | 20 | Reset all cooldowns. |
| Banish | arcane | 3 | Anyone | 1s | 30s | 20 | Banished: stunned, immune to harm for 4s. |
