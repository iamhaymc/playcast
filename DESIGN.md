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
home ──► lobby ──► draft (≤15s) ──► fight ──► surge ──► results ──► rematch or lobby
  │
  ├──► find players ──► quick match or a public room ──► lobby
  └──► tutorial or practice (in the page, no host)
```

- **Home.** Pick a name. Start a quick duel against a bot, take the tutorial, practice, find players, host a match, or join one with a four-letter code.
- **Lobby.** The host sets the rules and can make the room public. Players pick open seats. The host can put bots in seats. Open seats become bots when the match starts. A quick match's lobby counts down instead and starts itself.
- **Draft.** The book for this match opens wide. Each mage drafts a kit from it by typing whole chords (or tapping spells). The draft lasts 15 seconds, or ends 3 seconds after every kit is full. Kits left short are filled for their owners.
- **Fight.** Cast chords from your kit until one team has no mage standing. Every 45 seconds the rift rewrites a quarter of the chords.
- **Surge.** After the surge time (90s by default) every mage takes rising damage each second until a team falls. The chords shift once more as it begins.
- **Results.** Damage, healing, damage taken, casts, parries, combos and fizzles per mage. The host can rematch (new book) or return to the lobby.

### Teams and mages

Two teams, **Dawn** (cyan) and **Dusk** (magenta), stand in two rows on either side of the rift. Each team has 1–8 mages; the default is 1 vs 1. Sizes can differ (for example 2 vs 3). Every player sees their own team in the near row.

Each mage has:

| Stat | Value |
|---|---|
| Life | Set by the rules (800 by default) |
| Mana | 100, regains 6 per second |
| Shield | Sum of active shields; absorbs damage before life |
| Auras | Timed effects: boons (good) and banes (bad) |
| Cast | The spell being cast, its metamagic, its target and progress |
| Cooldowns | Per spell, starting when the spell fires |
| Kit | The spells drafted from the book; only these can be cast |
| Aim | The target cursor; it stays put between chords |
| Ward | Up for 0.3s when raised; rests 5s after a miss, 1s after a parry |
| Flow | 0–5 stacks from clean play: faster casts, cheaper spells |
| Diminishing returns | How much of the next stun or sleep, and of the next silence, from a foe would land |

All of this but the kit is visible to everyone, so you can heal, shield and cleanse teammates as easily as you hurt foes, and read who is on a streak or about to resist a stun.

Each mage also wears a **garb** picked in the lobby: a hat (pointed, wide, hood or crown), a robe (plain, mantle, bands or split) and a staff (gem, orb, crook or branch). Garb is looks only and never changes play; the team still sets the colors. It lets players tell mages apart in a big fight. A first visit is dressed at random and the choice is remembered; bots dress by a seed, so each looks different.

### Keys

The whole game uses twelve keys. Every input mode maps onto them.

| Key | Meaning | Keyboard | Gamepad | Touch |
|---|---|---|---|---|
| `up` `down` `left` `right` | Moves: aim the target | W A S D or arrows | D-pad or left stick | Left pad |
| `star` `wave` `flame` `leaf` | Runes: spell the spell | I J L K | Y X B A | Right pad |
| `meta` | The next rune shapes the spell instead of spelling it | U, or Shift with a rune | RB | Corner of the right pad |
| `ward` | Raise a ward | Space | RT | Shield button |
| `call` | Call your aim for the team | E | LT | Corner of the left pad |
| `drop` | Clear the chord, then the queue, then the cast | Q or Backspace | LB | Center button |

The rune pad is a diamond in the same layout everywhere: star on top, wave left, flame right, leaf bottom. Tab (keyboard) or Start (gamepad) toggles the book; Back (gamepad) opens the guide; M (keyboard) turns sound on or off.

### Chords

A chord is any number of moves and metamagic followed by a run of runes. The spell fires on the last rune.

```
 up   meta flame   star wave flame
 aim  └─ shape ─┘  └─── spell ───┘
```

- Each spell in the book has a chord of runes. Bigger spells take more: 2 runes for tier 1, 3 for tier 2, 5 for tier 3.
- Chords in a book are prefix-free, so a chord is complete the moment it matches.
- A run of runes that can no longer match any spell fizzles at once.
- Moves and metamagic can come before or between runes, as long as they come before the last rune.
- A chord clears after 2.5 seconds without a key.
- The chords are drawn at random for every match, and the rift rewrites some as the fight goes on. Learning them fast is the skill.

**Speed is power.** The chord is timed from its first rune or meta key to its last rune. The faster the keys come, the shorter the cast: 0.1 seconds or less between keys leaves 60% of the cast time; 0.35 seconds or more leaves all of it; in between it scales. Instant spells fire at once either way.

### Metamagic

`meta` then a rune shapes the spell. Each metamagic can be used once per chord, and they stack; their mana costs multiply. A free spell is shaped as if it cost 6.

| Rune | Metamagic | Effect | Mana |
|---|---|---|---|
| star | Quicken | Cast instantly | ×1.5 |
| wave | Twin | Also hits the standing mage nearest the target in its row | ×2 |
| flame | Empower | 40% stronger (damage, healing, shields, effects over time); 50% longer cast | ×1.5 |
| leaf | Extend | Effects last 50% longer | ×1.5 |

Twin needs a single-target spell that is not self-only or a revive ("Can’t twin"); Extend needs a spell that applies an effect ("Nothing to extend"). Wisp spells cannot be shaped.

### Targeting

The target cursor starts on you and stays where you leave it between chords.

- `up` jumps to the foe row, to the mage most nearly across from the cursor.
- `down` jumps back to your row the same way. On your own row, `down` snaps back to you.
- `left` and `right` walk along the cursor's row, as seen from your side. The cursor stops at the ends.
- An ally spell cast while the cursor is on a foe lands on you, so you can heal yourself without leaving your target.
- When a foe you are aiming at falls, your aim moves to the nearest foe still standing in that row.

A gold ring marks your aim in the arena: faint between chords, bright with an arrow while you type. The aimed foe's nameplate lights up while you type.

### Calls

`call` marks your aim for your team for 6 seconds: a red reticle over the mage and a note for each teammate. Only your team sees it. Bots focus called foes. A call can be made once a second.

### Casting

When a chord completes, the spell is checked. A failed check is a **fizzle**: keys are ignored for 0.6 seconds and your flow breaks.

| Check | Fizzle text |
|---|---|
| The runes match a spell | Unknown chord |
| The spell is in your kit (or the wisp book while fallen) | Not in kit |
| You are not silenced | Silenced |
| The spell is off cooldown | Not ready |
| The metamagic fits the spell | Can’t twin / Nothing to extend |
| You have the mana, after metamagic and flow | Low mana |
| Offense needs a foe, defense needs an ally or you | Needs a foe / Needs an ally |
| Revives need a fallen ally | Needs a fallen ally |
| The target is standing | Target is down |

- Spells with a cast time show a cast bar. Everyone can see what you are casting, how it is shaped and at whom.
- A chord finished while you cast (or during the 0.4s after a cast) is **queued** and starts next.
- Mana is spent and the cooldown starts when the spell fires, not when the cast begins. Dropping a cast is free, so feints are fair play.
- Each spell then flies to its target (bolt, beam, meteor and so on) and takes effect when it lands.
- **Stun** and **sleep** stop keys and break casts. Sleep ends on any damage. **Silence** breaks casts and makes chords fizzle.
- **Interrupts** stop a cast in progress and silence the caster.

Spell aims:

| Aim | Target |
|---|---|
| Foe | One foe, or the whole foe side for side spells |
| Ally | You or a teammate, or your whole side; aimed at a foe, it lands on you |
| Self | Always you; moves are ignored |
| Anyone | Different effects on foes and allies |
| Fallen ally | A teammate who is down |

### Wards

`ward` raises a ward for 0.3 seconds. A hostile spell that lands on you while it is up is **parried**: it turns back on its caster, whole, as a reflect would. A parry readies the ward again in 1 second and adds a flow stack; a ward that stops nothing rests for 5 seconds. Spells that never miss (Magic Missile) go through. Wards cannot be raised while stunned, asleep, stalled or fallen.

Most spells fly for 0.1–0.7 seconds, and every cast bar is visible, so a parry is part reading the field and part reflex.

### Landing

When a hostile spell lands, a raised ward parries it; otherwise a **reflect** charge sends the whole spell back to its caster and a **dodge** charge cancels it. Spells that never miss skip all three.

### Reactions

A direct hostile hit (not damage over time) of one school on a foe holding a bane of another sets off a **reaction**: the hit is stronger, the bane is used up (except Wildfire), and a rider follows. Reactions add a flow stack for the caster, and the book marks the spells that would react with your aimed foe.

| Reaction | Hit | On a bane of | Damage | Rider |
|---|---|---|---|---|
| Melt | fire | frost | ×1.5 | — |
| Shatter | storm | frost | ×1.4 | Goes through shields |
| Steam | frost | fire | ×1.3 | Breaks the target's chord and stalls its keys 0.8s |
| Wildfire | nature | fire | ×1.2 | The fire bane spreads to the mages beside the target |
| Overload | arcane | storm | ×1.4 | Burns 20 mana |
| Purify | holy | shadow | ×1.5 | Heals the caster for half the damage |
| Eclipse | shadow | holy | ×1.4 | Silences 1.5s |

A team that mixes schools sets up and pays off reactions for each other.

### Flow

Each spell that fires (not wisp spells), each parry and each reaction adds a flow stack, up to 5. Each stack casts 8% faster and makes spells 5% cheaper. A fizzle or a broken cast (stun, silence, interrupt) drops flow to 0. After 4 seconds without a cast it falls by one stack every 1.5 seconds. Flow shows as pips on every nameplate and as stars circling the mage's feet.

### Diminishing returns

Stuns and sleeps from foes share one count; silences have another. Within 15 seconds of the last one, each repeat in a group lasts half as long as the one before (100%, 50%, 25%), and a fourth does not land at all ("Resisted"). For 1 second after a stun or sleep ends, the next one cannot land. Locks from yourself or your allies never diminish. Nameplates show what the next lock would do: ½, ¼ or ✕.

### Damage, in order

1. Immune targets take nothing.
2. The amount is multiplied by metamagic (Empower), any bonus or reaction, the attacker's damage dealt and the target's damage taken.
3. **Mana shield** pays a share of the damage with mana (2 damage per mana).
4. **Shields** absorb the rest, oldest first, unless the attack goes through shields. A broken shield ends its aura.
5. Life drops. The attacker heals if it has life steal. Sleep ends.
6. At zero life a **death ward** saves the mage at a share of life; otherwise the mage falls, loses all auras and becomes a wisp.
7. A direct hostile hit triggers the target's **thorns** (damage back) and **when hit** effects.

### Wisps

A fallen mage drifts over its body as a wisp until revived or the match ends. Its book becomes the wisp book: three spells with their own 2-rune chords, no mana and no metamagic. Glimmer heals an ally 40, Hinder slows a foe, Kindle gives an ally 12 mana. Wisps aim and call as usual, but cannot ward and are never targeted. Wisps do not keep a team in the match.

### Healing, the surge and winning

- Healing is multiplied by the target's healing taken and by **heal power**. Heal power starts at 100% and falls to 40% when the surge begins. The clock shows it.
- From the surge time on, every mage loses 2% of max life per wave, plus 2% more each second (2%, 4%, 6% …).
- A team wins when the other team has no mage standing. If both fall on the same tick, the team that dealt more damage wins; equal damage is a draw.

### The book and the draft

Each match draws a new book (16 spells by default, 12–24 allowed):

- Half offense, half defense.
- Per half: a third are tier 1 (rounded up), one in six are tier 3 (at least one), the rest tier 2.
- Offense: at least 60% of spells deal damage. Defense: at least two heal, at least one guards, at most one revive.
- Team spells (revives, Freedom, Contagion) are left out when either team has a single mage.
- Everyone in the match shares the same book and chords.

Each mage drafts a **kit** of 8 spells by default (4–12 allowed, and always at least four short of the book). While drafting, a whole chord adds its spell to your kit, the same chord takes it out, and a chord past a full kit fizzles ("Kit is full"). Your picks are seen by your team only, and foes never learn your kit except by watching you cast. A kit left short at the start is filled with a balanced choice: about half offense and half defense, leaning to damage, healing and guards.

### Rift shifts

Every 45 seconds of fight, and when the surge begins, the rift rewrites the chords of a quarter of the book (at least two). New chords keep their length and the book stays prefix-free. Chords being typed are cleared. A warning shows 8 seconds before, the banner says how many of your chords changed, and the changed rows glow in the book.

### Tutorial and practice

Both run in the page, with no host, so they start at once and work offline. Neither has a clock: no surge, no rift shifts.

**The tutorial** is a short match against a Trainer, one step at a time. A coach card under the top bar says what to do, shows the keys for the current input mode and the spells' chords, and the book rows, legend keys and touch buttons it is about glow. The clock shows the step. Each step can be skipped but the duel.

| Step | You | Done when |
|---|---|---|
| Draft your kit | Take Fire Bolt, Frost Ray, Healing Word and Power Shield from an 8-spell book. The draft waits for you | The fight starts |
| Aim | `up` to the foe row | Your aim is on the Trainer |
| Cast | Fire Bolt | An offense spell fires |
| Heal without looking away | The Trainer hits you; cast Healing Word with your aim still on it | A heal fires |
| Ward | The Trainer casts Frostbolt at you, waiting for your ward to be ready each time | A parry. After two misses a tip explains the timing |
| Shape a spell | `meta` `flame`, then Fire Bolt | A shaped spell fires |
| Set off a reaction | Frost Ray, then Fire Bolt (Melt). The Trainer's banes are cleared first | A reaction of yours |
| Duel | The Trainer, at 45% life, plays as an easy bot | The match ends |

Until the duel, nobody can fall. A finished tutorial is remembered; until then the home page points new players at it. The results card offers it again, or practice.

**Practice** is a room with target dummies that never fall. You pick up to 12 spells from the whole codex (filtered by school; team spells are left out), or none for a random 16-spell book, and they are your whole kit: there is no draft. Options: 1–3 dummies; a ward drill, where a dummy casts a bolt at you every few seconds (Frostbolt, Shadow Bolt, Fireball or Lightning Bolt) once your ward is ready; and free mana (no mana costs, no cooldowns). A bar under the top bar counts casts, fizzles and parries (of wards raised) and shows your chord speed: how much of the cast time your last ten chords saved, as a share of the most a chord can save. **New chords** rewrites every chord in the book, to learn them again. The picks and options are remembered.

### Playing with strangers

**Find players** lists every public room, with its host, size, people and open seats, and joins one (or watches one that is playing). A room is public when its host makes it so in the lobby ("Who can join: Code only / Public").

**Quick match** asks for a team size (1 vs 1, 2 vs 2 or 3 vs 3). It seats you in the public quick room of that size that has the most people and an open seat, or opens a new one. A quick room waits 15 seconds for people, then starts itself and bots take the seats still open; it starts 1.5 seconds after its last seat is filled by a person. Its lobby counts down, its rules are fixed until it starts, and its first player may start it early. After its first match it is an ordinary public room.

### Settings

The gear (on the home card and in the top bar) opens the settings. They are kept in the browser.

| Setting | Values | Effect |
|---|---|---|
| Effects, Music | 0–100% | The volume of each sound bus |
| Haptics | On, Off | Gamepad rumble and phone vibration, including the tap on touch pads |
| Quality | Auto, Low, Medium, High, Ultra | Auto lets the governor choose; a tier holds it. `?quality=` still wins |
| Screen shake | On, Off | Camera shake |
| Flashes | On, Soft | Soft dims the bright pops, the white flash on hit and spell light, and drops the red edge when you are hurt |
| Motion | Full, Reduced | Reduced halves small particles, thins the rift's dust and stills the page's animations |
| Colors | Standard, Colorblind | Colorblind swaps the teams' cyan and magenta for blue and amber, boons and heals to bluish green, harm to vermilion, nature to bluish green and holy to yellow, in the arena and the HUD |
| Keyboard | Any key | Rebind each of the twelve keys. A key bound twice swaps places; Tab, Escape, M and modifiers stay with the page. The arrows and Backspace keep working unless bound elsewhere. Key chips, the legend and the guide follow |

A first visit from a system that asks for less motion starts with screen shake off and reduced motion.

### Rules

| Rule | Default | Range |
|---|---|---|
| Team sizes | 1 and 1 | 1–8 each |
| Book size | 16 | 12–24, even |
| Kit size | 8 | 4–12, at most book − 4 |
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
| `sound.mjs` | Sound: synthesized effects, music and haptics. No files to load. |
| `test.mjs` | Unit, host and browser tests. |

The game is built around messages. Nothing reaches the simulation except `press` orders, and nothing leaves it except events and frames.

```
 browser ── press {key, seq} ──► host ── order ──► Match.receive()
                                  │                    │
                                  │      Arena.step(): pilots press keys,
                                  │      Match.advance() runs one tick
                                  │                    │
 browser ◄── frame {delta, events, kits?} ◄── host ◄── flush() + frame(team) + kits(team)
```

- **One authority.** The host runs every match with people in it. Clients only send keys and draw what they receive, so every player sees the same game. The tutorial and practice, with one player, run the same core match in the page instead (see [Solo rooms](#solo-rooms)).
- **Fixed ticks.** 20 ticks per second. Orders are applied at the start of the next tick, in arrival order.
- **Determinism.** A match uses one seeded random generator. The same seed, rules, roster and orders always replay the same match.
- **Bots are players.** Bots press the same keys through the same `press` orders, so they obey the same rules, timeouts and fizzles.
- **Shared code.** The page imports `core.mjs` too, for spell data, text, layout, cursor and chord rules, so the HUD always matches the host.
- **Private by team.** Kits, draft chords, picks and calls belong to one team. The match marks private events with `only: team`, and the host sends each team its own copy of every frame.
- **Deltas.** Each peer gets one whole frame, then only what changed since the last one (see [Frames](#frames)).

---

## 3. Core reference

`core.mjs` sections:

| # | Section | Contents |
|---|---|---|
| 1 | Kit | Constants (`TICK_RATE`, `KEYS`, `TIMING`, `CHORD_LENGTH`, `DIMINISH`, `METAS`, `REACTIONS`, `RULES`, `LIMITS`, `SKILLS`, `FLIGHTS`), `tidyRules`, `dampenAt` |
| 2 | Dice | `hashText`, `Dice` (seeded mulberry32 with `float`, `int`, `pick`, `shuffle`, `fork`) |
| 3 | Acts | Act and aura builders used by spells |
| 4 | Lore | Plain text built from acts: `describeSpell`, `describeAura`, `AIM_TEXT` |
| 5 | Codex | `CODEX` (all spells), `WISPS`, `SPELL` (by id), `actsFor`, `walkActs`, `rolesOf`, `costOf`, `castOf`, `swiftOf`, `metaFault`, `reactionOn` |
| 6 | Book | `writeBook`, `writeWisps`, `shiftBook`, `pickKit`, `readChord`, `readRunes`, `splitTiers` |
| 7 | Board | `LAYOUT`, `place`, `rowOf`, `moveCursor`, `pathTo` |
| 8 | Match | `Match`, `lockOf`, `lockGroup`, `flowPace`, and the `OPS` act handlers |
| 9 | Brain | `Brain`, `rateSpell`, `targetsFor`, and the `WEIGH` act weights |
| 10 | Pilot | `Pilot`: drafts, turns plans into timed key presses, raises wards |
| 11 | Arena | `Arena`, `botRoster`, `simulate` |
| 12 | Wire | `WIRE`, `pack`, `unpack`, `CODE_LETTERS`, and frame deltas: `packFrame`, `unpackFrame`, `diff`, `patch` |
| 13 | Solo | `Lesson` and `LESSON` (the tutorial), `Drill` and `DRILL_BOLTS` (practice) |

The Kit also holds `QUICK` (quick match sizes and wait), `NEVER` (the tick a calm match's surge and shifts never reach) and `BOOK_MOST` (the most spells a chosen book holds, so its chords always fit). The Book's `chordBook(dice, spells)` gives any list of spells prefix-free chords; `writeBook` draws spells, then calls it.

### Match API

```js
const match = new Match({ seed, rules, roster }) // roster: [{ id, name, team, slot, bot, stand? }]
new Match({ seed, rules, roster, book, calm })   // book: chosen spell ids; calm: no surge and no rift shifts
match.receive({ type: 'press', mage, key, seq }) // queue an order
match.advance()                                  // run one tick
match.flush()                                    // events since the last flush (`only: team` marks private ones)
match.frame(team)                                // changing state, sent every tick; foes' draft chords hidden
match.kits(team)                                 // one team's kits
match.setup()                                    // fixed facts, sent once (the book's chords change by `shift` events)
match.view(id)                                   // what a brain may know
match.usable(mage)                               // what a mage can cast now: its kit, or the wisp book when down
match.results()                                  // final numbers
match.rewrite(count)                             // the rift rewrites `count` chords now (practice's New chords)
```

A roster entry marked `stand` never falls: at zero life it is saved at full (a `save` event). Solo rooms use it for dummies, and for everyone until the tutorial's duel.

### Solo rooms

`Lesson` and `Drill` wrap a calm match in an Arena with the player in seat `t0s0`, and give it the same surface the page needs: `step()` (one tick: the room acts, pilots press, the match advances; returns the events), `press(key, seq)`, `match` and `me`. The room acts through `cast(mage, spell, target)`, which orders a spell for a mage it drives, with full mana and no cooldown, so its cast bar shows like anyone's.

```js
const lesson = new Lesson({ seed, name, garb })
lesson.goal  // { id, title, text, keys, spells, tip, index, count }, or null when over
lesson.skip()
const drill = new Drill({ seed, spells, dummies, ward, free, name, garb })
drill.rewrite() // new chords for the whole book
```

Lesson text marks keys as `{key}` and spells as `[spell-id]`; the page draws them as key chips for the current input mode and as the spell's name with its chord.

Tick order: orders → draft (chord timeouts, early start when every kit is full) → phase change (kits filled) → surge wave → rift shift → each standing mage (mana, auras, chord timeout, flow ebb, cast progress, queue) and each wisp (chord timeout) → landing flights (wards, reflects and dodges first) → end check.

### Events

Every event is `{ type, tick, ...body }`.

| Type | Body | Meaning |
|---|---|---|
| `pick` | `mage, spell, on` | Drafting: a spell joined (`on`) or left a kit. Private to the team |
| `start` | | The fight begins |
| `lapse` | `mage` | A chord cleared (timeout, drop, stall or rift shift) |
| `fizzle` | `mage, why, spell` | A chord failed its check (private to the team while drafting) |
| `queue` | `mage, spell, target, metas` | A chord waits for the current cast |
| `cast` | `mage, spell, target, total, metas, swift` | A cast bar starts; `swift` is the share of the cast time the chord's speed left |
| `stop` | `mage, spell, why` | A cast ends early: `break` or `drop` |
| `fire` | `mage, spell, target, targets, metas, swift, at, land` | A spell leaves the caster at tick `at`; lands at tick `land` |
| `ward` | `mage` | A ward goes up |
| `call` | `mage, target` | A call for the team. Private to the team |
| `flow` | `mage, flow` | Flow stacks changed |
| `react` | `from, to, name, hit, on` | A reaction went off |
| `shift` | `changes` | The rift rewrote chords: `[{ id, sigil }]` |
| `land` | `mage, spell, target, targets` | A spell arrives |
| `jump` | `spell, from, to` | A chain bounces |
| `strike` | `spell, from, to` | A scatter strike falls |
| `hit` | `from, to, amount, soak, school, direct, echo` | Damage; `soak` was absorbed |
| `mend` | `from, to, amount` | Healing actually gained |
| `void` | `from, to, why` | Nothing happened: `immune`, `evade`, `reflect`, `parry`, `steady`, `resist` (diminished away) |
| `mark` | `from, to, name, kind, look, school, time` | An aura is applied or refreshed |
| `fade` | `to, name, why` | An aura ends: `end`, `purge`, `steal`, `break`, `spent`, `used`, `woke`, `react` |
| `purge` | `from, to, count, kind` | Auras removed by a dispel |
| `mana` | `to, amount` | Mana gained or lost |
| `fall` | `to, by` | A mage is down and becomes a wisp |
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
  aim: 'foe', reach: 'one', cast: 1, cool: 6, cost: 16, flight: 'bolt',
  acts: [harm(150), dot(10, 4, 'Burning')] }
```

| Field | Values |
|---|---|
| `kind` | `offense`, `defense` or `wisp` |
| `school` | `fire` `frost` `storm` `nature` `shadow` `holy` `arcane` (sets colors and particles) |
| `tier` | 1–3; chord length is `CHORD_LENGTH[tier]`: 2, 3 or 5 runes |
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

Aura shortcuts: `dot`, `hot`, `stun`, `sleep`, `hush`, `slow`, `haste`, `expose`, `armor`, `weaken`, `empower`, `shield`, `thorns`.

Aura rules (all optional):

| Rule | Meaning |
|---|---|
| `name` `kind` `look` `school` | Identity (`kind` is `boon` or `bane`); `look` picks the visual |
| `pulse` `grow` | Acts every second; `grow` raises their size each pulse |
| `taken` `dealt` `mended` `pace` `regen` | Multipliers: damage taken, damage dealt, healing taken, cast speed, mana regen |
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
brain.think(view) // → { spell, target, metas? } | null | Promise<…>
brain.draft(view) // optional → [spellId, …] | Promise<[spellId, …]>
```

- `view` is plain data from `match.view(id)`: `me`, `tick`, `phase`, `fightAt`, `surgeAt`, `book` (what the mage can cast now: its kit, or the wisp book when down), `pool` (the whole book), `kitSize`, `kits` (its own team's), `call` (its team's live call), and every mage with life, mana, shield, lock, cast, chord, aim, cooldowns, ward, flow, diminishing returns and auras (with their rules). Foes' kits are never in it.
- The plan names a spell from `book`, a target id and optional metamagic (`['quicken', 'empower']`). `null` means wait.
- `draft` returns the spells to draft, best first. Without it, the kit is filled when the fight begins.
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
- Damage that would set off a reaction counts the reaction. Locks count only what diminishing returns would let land.
- Called foes are worth 30% more.
- Mana cost is subtracted, more when mana is low; long casts are discounted.
- Metamagic is weighed by scoring the shaped spell (stronger, longer, two targets, no cast bar) against the extra mana, priced higher the lower mana runs, and the keys it takes.
- Skill adds noise to the scores (45% easy, 18% normal, 5% hard), rolled once per spell and target so more shapes do not win by luck.
- The draft takes a balanced kit (`pickKit`), with noise by skill, and leans away from spells a teammate already took.

### The pilot

The pilot drafts by typing each pick's chord. In the fight it asks the brain when it is free, waits a reaction time, then types the moves from wherever its aim is (`pathTo`, skipping them when an ally spell will land on it anyway), a call for low foes, the metamagic and the runes, with human-like gaps. Its key gaps set its chord speed like anyone's. It drops a plan if its target falls, the spell stops being usable, or the rift rewrites the chord. It watches spells flying at it and, when it sees one in time and its skill rolls for it, raises a ward with imperfect timing. A fallen bot plays its wisp.

| Skill | Think pause | Key gap | Reaction | Noise | Metamagic | Parry chance |
|---|---|---|---|---|---|---|
| easy | 1.2–2.0s | 0.30–0.42s | 0.5–0.9s | 45% | none | 10% |
| normal | 0.6–1.1s | 0.19–0.27s | 0.3–0.6s | 18% | one | 35% |
| hard | 0.25–0.5s | 0.12–0.17s | 0.15–0.3s | 5% | two | 70% |

`simulate({ seed, rules, skills })` plays a whole bots-only match headless, which is useful for tuning numbers.

---

## 5. Wire protocol

One WebSocket per tab at `/wire`. Every message is JSON `{ type, ...body }`. `unpack(text, 'peer')` checks each field and drops anything malformed.

Peer → host:

| Type | Body | Who | Effect |
|---|---|---|---|
| `hello` | `name, garb?` | anyone | Set your name (1–16 letters, digits, spaces) and, if given, your garb (`{ hat, robe, staff }`; unknown styles become the first one, never an error) |
| `open` | `rules` | anyone | Host a new room and join it |
| `join` | `code` | anyone | Join a room by code |
| `seat` | `team, slot` | anyone | Move to an open seat (lobby) |
| `bench` | `team, slot` | host | Toggle a bot in a seat (lobby) |
| `tune` | `rules` | host | Change the rules (lobby) |
| `start` | | host | Start the match |
| `press` | `key, seq` | seated players | One key (a move, a rune, `meta`, `ward`, `call` or `drop`); `seq` counts presses for local echo |
| `again` | | host | Rematch with a new book |
| `lobby` | | host | Return everyone to the lobby |
| `leave` | | anyone | Leave the room |
| `resume` | `token` | anyone | After a reconnect or a reload: take back the seat held for this token |
| `browse` | `on` | anyone | Follow the list of public rooms (`rooms` now and on every change), or stop |
| `list` | `on` | host | Show the room in the public list, or hide it |
| `seek` | `size` | anyone | Quick match: join the public quick room of this team size (1–3) that is filling up, or open one |

Host → peer:

| Type | Body | When |
|---|---|---|
| `welcome` | `you, token` | On connect: your peer id, and the token that takes your seat back after a drop |
| `back` | `you` | Answer to `resume`: your old peer id, or `null` if nothing was held |
| `moved` | | Your seat was taken back on another connection (a copied tab); stop resuming it |
| `room` | `room` | Lobby state changed: code, owner, phase, rules, seats (with `garb`, and `away` for dropped players), watchers, `listed`, `quick`, and `wait` (ms until a quick room starts itself, or `null`). Bots play under the names and garb the lobby showed |
| `rooms` | `rooms` | For browsing peers: the public rooms, each `{ code, host, phase, quick, teams, skill, people, open, wait }`, quick rooms filling up first, at most 40 |
| `begin` | `setup, you` | A match starts (or you are back in one); `you` is your mage id or `null` when watching |
| `frame` | `frame` or `delta`, `events`, `kits?` | Every tick: your team's copy, with its private events (watchers get the public copy). `kits` only when they changed |
| `end` | `results` | The match is over |
| `fault` | `text` | A request failed |

### Frames

A frame is the whole changing state, so sending it every tick costs about 2 KB in 1 vs 1 and 9 KB in 8 vs 8. Instead, a peer gets one whole `frame` when it starts watching (a match begins, it joins mid-match, it comes back from a drop), then a `delta` each tick:

- `packFrame` swaps each aura's countdown (`left`, which falls every tick) for the tick it ends (`end`), which holds still. `unpackFrame` turns it back. Each aura also names the `spell` that put it there (or `null`), so the page can show its rules without sending them every tick.
- `diff(prev, next)` lists only what changed: objects by key (removed keys in `$gone`), same-length arrays by index, anything else replaced whole. `patch(prev, delta)` applies it without touching `prev`. Keys starting with `$` are reserved.
- The WebSocket compresses messages (`permessage-deflate`, 4 KB window).

`patch(prev, diff(prev, next))` rebuilds `next` exactly; a test checks this on every tick of whole matches. Measured on bot matches, per client:

| Teams | Whole frames | Deltas, compressed |
|---|---|---|
| 1 vs 1 | 38 KB/s | 0.7 KB/s |
| 4 vs 4 | 102 KB/s | 1.8 KB/s |
| 8 vs 8 | 181 KB/s | 2.9 KB/s |

---

## 6. Host

- **Routes.** `/` and the six page files, `/lib/three/...` (from `node_modules/three/build` and `examples` only), `/health`, and the WebSocket at `/wire`.
- **Codes.** Four letters from 20 consonants, so codes never spell words.
- **Rooms.** A room has rules, two rows of seats (`open`, `human` or `bot`), peers and a phase: `lobby`, `match` or `after`. The first peer is the host; if they leave, the next peer takes over.
- **Seats.** New peers sit on the team with fewer people. Peers without a seat watch. Shrinking a team turns extra players into watchers.
- **The loop.** Every 25ms the room runs every tick that is due (catching up at most 10 ticks) and sends one frame with all their events: one copy per team (its kits, draft chords and private events) and a public copy for watchers. Peers that have the last frame get a delta; the rest get the whole frame.
- **Public rooms.** A room's host can list it. Peers that `browse` get the list at once, then again a quarter second after any listed room changes (gathering changes in between). Entering a room stops browsing.
- **Quick match.** `seek` seats the peer in the public quick room of that size with the most people and an open seat, or opens one: public, the size asked for, the default rules. It starts itself when its wait runs out (15 seconds, the `wait` option of `openHost`) or 1.5 seconds after a person fills its last seat; open seats become bots. Until then its rules and bots are fixed. Its owner can still start it early, and after its first match it is run by its owner like any room.
- **Leaving mid-match.** A bot pilot takes over the mage, so the match is never broken.
- **Dropping and coming back.** Every peer gets a token in `welcome`. When a socket closes while its peer is in a room, the seat and mage are held for 60 seconds with a bot playing for it; the room says the player is `away`, and if they owned it, ownership passes to someone present. A `resume` with the token on a new socket (the page sends it after a reconnect, and after a reload, since the token lives in `sessionStorage`) takes the seat back: the bot steps aside and a whole frame catches the page up. If the host had not noticed the old socket die, the new one takes over and the old one is told `moved`. After the hold, the player leaves as if they had pressed Leave.
- **Dead connections.** The host pings every socket every 15 seconds; one that misses two pings in a row (30–45 seconds of silence) is closed, which starts its hold. Two, because a page whose main thread is busy stops reading its socket, and its browser stops answering pings until it catches up.
- **Faults stay small.** A malformed request path is a 400. A message that throws gets a `fault` back. A match that throws is stopped, its players get a `fault` and return to the lobby, and every other room plays on.
- **Limits.** 60 messages per second per peer, 4KB per message, 500 rooms.

Start it with `npm start`, or import it: `const host = await openHost({ port: 0 })` returns `{ port, url, hall, close }`. Options: `quiet` (no logs), `hold` (ms a dropped seat is held), `beat` (ms between pings) and `wait` (ms a quick room waits for people).

---

## 7. Page

`page.mjs` sections:

| # | Section | Role |
|---|---|---|
| 1 | Kit | DOM helpers, SVG glyphs, key labels, palettes, canvas textures |
| 2 | Link | WebSocket wrapper with handlers and reconnect |
| 3 | Pads | Keyboard, gamepad and touch → the twelve keys |
| 4 | Sparks | The GPU particle system and per-frame marks |
| 5 | Rings | Pooled floor shockwave rings and camera-facing ribbon bolts |
| 6 | Looks | Particle recipes and status looks |
| 7 | Figure | One mage: model, motion and status visuals |
| 8 | Flight | One spell in the air |
| 9 | Stage | Scene, world, camera, effects and the render loop |
| 10 | Plates | Nameplates and floating numbers |
| 11 | Hud | Clock, banner, book (draft and kit), chord tray, ward and flow status, wisp book |
| 12 | Views | Lobby, public list and result rendering, toasts |
| 13 | Solo | `Runner` (steps a core Lesson or Drill on the host's clock and speaks to the Game as a host would), lesson text, the practice `Tally` |
| 14 | Game | Client state: messages in, visuals and sounds out; music by view; resume after a drop; settings, the tutorial's coach and the practice room |
| 15 | Boot | Starts the game; `window.chordcast` is the game object |

The Kit also holds the settings (`loadSettings`, the key binding in `BOUND_KEYS` and `bindKeys`, the palettes in `TEAM_TONES`, `SCHOOL_TONES` and `paintPalette`).

### Solo rooms in the page

A `Runner` steps a core `Lesson` or `Drill` on a 25 ms timer, the way the host steps a room (at most ten ticks to catch up, so a hidden tab pauses it), and hands the Game `begin`, `frame` (always whole) and `end` messages, passed through JSON like the wire. Presses go to the runner instead of the link, and messages from a host are ignored while it runs. The clock shows the tutorial's step or the practice time; the coach card and the practice bar sit under the top bar, and the camera fits the arena below them, shrinking it if it must, so the far row's plates stay in view.

### Rendering

- Three.js with Neutral tone mapping, which keeps hues and saturation where ACES bleaches bright colors toward white. The scene renders into a multisampled half-float buffer (MSAA). The output pass adds a fine film grain that shifts every frame, strongest in the mid tones, which also keeps dark gradients from banding.
- The look is a value hierarchy: the background is dark and quiet, the mages are lit, and spells are the brightest and most saturated things on screen. Nothing outside the field glows.
- Bloom is selective. Its bright pass measures the brightest channel instead of luminance, so a saturated red or blue glows as readily as white, and only the part above a high threshold (0.9, with a soft knee) blooms. Spell cores and gems glow; trims, the floor, robes and the HUD stay crisp. Bloom runs at CSS-pixel size so it spreads the same on every screen.
- The sky is a procedural night: a near-black dome with banks of cloud lit from a veiled moon and a faint warm glow of far fires on the horizon, baked once into a cube map. A small stand-in of the night (the sky, a moon, the far fires, the dark ground) is baked into a prefiltered environment map, so brass has something to reflect. Only brass ornaments take it: cloth and stone are too rough to show it, and the floor's wet patches catch the moon and spell light instead.
- Light: a moonbeam (a spotlight with soft shadows) lights both rows fully and falls off before the ruins, so the edges sink into the dark. A hemisphere fill, a dim sky light and a warm low fill from the far fires light the rest. Two pooled lights flash in a spell's color as it leaves the staff and as it lands, lighting the stone and the mages around it.
- The floor is a standard material whose color, roughness, metal, relief and glow come from a shader (`GROUND_GLSL`): worn flagstones laid in rings, with rounded edges, joints, a few cracks, old scorch marks and pooled rain; brass rings inlaid around the field over dark polished stone; the rift as a jagged fissure glowing from below; and the stone under each row faintly lit in its team's color. Lines are filtered by their size on screen (`fwidth`) and fine relief fades with distance, so nothing shimmers. A translucent curtain marks the rift itself.
- Weathered ruins ring the field: a curb of fitted blocks, some sunk or missing, and a colonnade of fluted columns, most of them broken, with fallen drums outside the curb. The columns straight behind each row are the lowest, so the far row's skyline stays clear. Craggy rocks drift far out in the fog.
- Stone, wood and cloth take a `weathered` patch: noise that mottles color and roughness and adds a fine relief, in world space for things that stand still and in the model's own space for things that move.
- Each mage is built from smooth shapes: a lathed robe that hangs in folds from the belt (its vertex colors darken the folds and dirty the hem), a hat, glowing eyes, flared sleeves hung from shoulder pivots, a gnarled staff and a worn stone pedestal with a rune ring inlaid in the team's color. Robes and hats are wool and felt with a soft sheen, worn and streaked, and a rim light washed between the team's color and moonlight; trims are embroidered in the team's color, metal is aged brass. Solid parts cast shadows (not while the mage is a ghost), and a soft contact shadow sits under each pedestal. The garb picks the parts (`garbShapes`): a drooping pointed hat, a wide brim, a hood drawn into a peak, or a crown; a plain robe, one with a shoulder mantle, hem bands that follow its folds, or split in two shades with a seam; a staff topped by a gem in an orbiting ring, an orb in a claw, a crook holding a small gem, or a forked branch with glowing buds. Felt crowns are crumpled and brims droop with a soft wave. Every style is a list of parts (geometry, paint, place), so adding one is data.
- Casting gestures (`Figure.gesture`): while a cast fills, the staff arm lifts the staff up and out and the free arm reaches forward, its hand glowing brighter in the school's color as the cast fills. When the spell leaves, staff and hand thrust toward the target and the body rocks back. The staff always follows the hand that holds it.
- Static parts that share a material are merged (brim and crown, both eyes), the curb is one instanced mesh, and the world shares geometry and materials, so a mage costs about twenty draw calls.

### Quality

| Tier | Pixel ratio cap | MSAA | Shadow map | Small particles |
|---|---|---|---|---|
| low | 0.85 | off | 1024 | half |
| medium | 1 | 2× | 1024 | three quarters |
| high | 1.5 | 4× | 2048 | all |
| ultra | 2 | 4× | 2048 | all |

- The low tier also draws a plainer, diffuse-only floor (`GROUND_LITE`: no grain, cracks, grime, scorch marks or rain), turns off weathering through a shared uniform, and lets only still things (ruins and pedestals) cast shadows, so the shadow map is drawn once per roster instead of every frame. Changing tiers recompiles nothing; the plain floor's shader is compiled once, the first time it is used.

- The start tier is a guess: software renderers start low, small devices (≤ 4 cores or ≤ 3 GB) medium, touch devices high, others ultra. The Quality setting holds a tier, or Auto goes back to the guess and the governor. `?quality=low|medium|high|ultra` pins a tier over both.
- Reduced motion halves the small particles of every tier.
- The governor drops a tier when frames stay slower than 40 per second for 1.5 seconds. If the drop does not speed frames up (a capped display or a busy CPU), it is undone and that tier becomes the floor. After 10 seconds of fast frames it climbs back, never above a tier that just failed.
- Points under two pixels are drawn two pixels wide and fainter, so tiny sparks do not flicker.

### Sparks

One ring buffer of particles per blend mode: **glow** (additive, 24,000) and **solid** (alpha, 12,000). Smoke and leaves go to the solid layer, so clouds of them stay dark or green instead of adding up to white. The CPU writes a particle once, at birth. The vertex shader computes its position from its age:

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

Shapes are drawn in the fragment shader: glow, star, ring, shard, smoke, leaf, rune, flake, spark, bubble, flame, cross (healing), chevron (boons rise, banes sink), Z (sleep), no-sign (silence) and target (exposed). Sparks, flames and chevrons turn to follow their motion on screen; the symbols stay upright. Cores run lighter but keep their hue. Each frame uploads only the slots written that frame.

**Marks** are points drawn fresh every frame and never kept, with the same shapes: the heads of spells in flight and the symbols that sit on a mage while a status lasts. Unlike a trail of short-lived sparks they look the same at any frame rate.

**Focus** keeps big fights readable. Every effect is drawn *about* a mage (`focus.about(owner, ids, draw)`): a flight about its caster and target, an impact about the caster and that target, a status about its wearer, an event about the mages it names.

- Effects that touch your own mage (your spells, spells aimed at you, your statuses) draw at full strength. The rest fade with the size of the field: `clamp(1.1 − 0.05 · mages, 0.4, 1)`, so 1 vs 1 is untouched, 4 vs 4 draws others at 70% and 8 vs 8 at 40%. Fading thins small particles, dims and shrinks them, and dims marks, floor rings, bolts and camera shake alike. Status symbols fade less (never below 75%) since they say what a mage can do. Watchers see everything at full strength.
- Each mage has a particle budget that refills every second: 5,400 a second shared by the field, between 300 and 1,200 per mage, holding up to half a second's worth. When a mage's budget runs dry its small particles are dropped; big flashes always draw. Effects that touch you share one budget three times as large. The arena's own motes are free.

### Looks

Every school owns a hue around the color wheel, and its spells carry it from the cast to the landing:

| School | Colors | Shapes | Casting sigil | In flight | On a hit |
|---|---|---|---|---|---|
| fire | orange, gold, red | flames, embers, smoke | triangles | a comet trailing its flame | flames lick up from the feet, smoke rolls |
| frost | ice blue, deep blue | shards, flakes, mist | snowflake | an ice lance pointing ahead | shards fly, mist sinks, a frost ring |
| storm | electric blue, cyan | sparks | lightning zigzag | a crackling ball | lightning forks out |
| nature | green, lime | leaves, spores | five petals | a ball with circling leaves | leaves burst outward |
| shadow | violet, black | dark smoke | crescent | a black orb with a violet ring | dark smoke rings out and falls in |
| holy | gold | stars, rings | sun rays | a turning star | a shaft of light from the sky |
| arcane | magenta, violet | runes, stars | pentagram | a spinning rune | runes ring outward |

Recipes (`burst`, `flourish`, `smoke`, `mist`, `ground`, `pillar`, `arrows`, `spiral`, `implode`, `trail`, `head`, `stream`, `beam`, `lightning`, `mend`, `shatter`, `puff`, `confetti`) take a point and a school. `HEADS`, `FLOURISH` and `SIGILS` hold each school's head, hit signature and casting circle. `lightning` and `beam` draw **bolts**: polylines expanded into camera-facing strips in the vertex shader, with a hot core and soft edges. Lightning forks and flickers; beams ripple. Flights lay trails at a fixed rate along the stretch flown since the last frame, so they look the same at any frame rate.

Landings read by role first: damage bursts with the school's signature, healing raises crosses (gold for holy, green for the rest), boons spiral up with rising chevrons, banes fall in with sinking ones.

Status looks (`STATUS_LOOK`) are rows of data: emission rate, shape, color, anchor (crown, chest, body, feet) and motion (rise, fall, drift, orbit, burst, still, doze, dash, climb, sink). Two more fields make a status readable at a glance:

- `tint` recolors the mage's rim light and gives the robe a faint pulsing glow: orange while burning, blue while slowed, green while blighted, red under doom. Banes win over boons.
- `mark` draws a symbol for exactly as long as the status lasts: stars circling the hat when stunned, a no-sign when silenced, a red reticle when exposed, a doom rune and a living bomb that beat faster as they run out, one cross per charge of Prayer of Mending, mirror shards circling the chest.

Some looks also switch meshes on the figure: shield bubble (blue, gold when immune, stone for Stoneskin, warm white while a ward is up), ice block, sheep, a golden halo over the hat for Death Ward, stone or gold tint, a shiver when feared, and a ghostly body when banished.

The new mechanics draw on the figure too: flow stacks as gold stars circling the feet (spinning faster at five), a called mage as a red reticle over its head, and a fallen mage as a wisp, a glowing orb in its team color that floats over the body and casts from where it floats.

### Events → visuals

| Event | Visual |
|---|---|
| `cast` | The school's sigil circle under the caster, growing with the cast; the staff rises and the free hand reaches out, glowing; gem, gem glow, hand and the plate's cast bar in the school color; school shapes rise from the circle and are drawn into the gem |
| `fire` | Gem flash and a brief flash of light, a thrust of staff and hand with a recoil, and a `Flight` timed to land on the `land` tick |
| `land` | Impact by role: burst, school signature and shockwave (damage), rising crosses and pillar (heal), spiral and rising chevrons (boon), implosion and sinking chevrons (bane); a flash of light in the school's color on the stone and nearby mages |
| `hit` | Flinch and a brief white flash (faint for damage over time), small burst, damage number in the school color; red vignette when you are hit hard |
| `jump` | A forked lightning bolt between the two mages |
| `mend` | Green number |
| `void` | "Immune", "Dodged", "Reflected", "Resisted"; a parry is "Parried!" with golden shards, a flash and a floor ring |
| `ward` | The warm white shell goes up for the ward's window |
| `react` | Bursts of both schools, a ground ring, a small shake and the reaction's name in the hit's color |
| `flow` | At five stacks: a golden spiral, and "In flow" over you |
| `shift` | The changed book rows glow, a banner says how many of your chords changed, a small shake |
| `call` | A red reticle over the called mage for 6 seconds and who called it |
| `fade` (break) | Shield shatters into shards |
| `fall` | Shadow burst, camera shake, the mage tips over and fades, and its wisp rises |
| `rise` | Golden pillar |
| `surge` | The rift and the thread in the brass ring glow brighter, more dust lifts off the rift, small shake |
| `over` | Confetti over the winners, then the results card |

A hidden tab draws nothing, so it skips effects and applies only events that leave lasting state (`fizzle`, `surge`, `shift`, `over`); otherwise every effect from the time away would burst out at once on return.

### Camera and HUD

The HUD is laid out symmetrically around the arena:

- Top bar: three columns with equal sides, so the clock is always dead center (code and score on the left, book, help and leave on the right).
- Book: offense pinned to the left edge and defense to the right, both centered in the band between the top bar and the tray. While you draft they meet side by side in the middle under a title and a kit counter; tapping a row types its chord for you. When the fight starts they part to their edges and show only your kit. Each page has its own detail line, with the reactions a spell's school sets off. On narrow screens the two pages stack in one centered sheet above the tray.
- Chord tray: centered at the bottom. The target sits on the left, the keys typed dead center (metamagic as named chips; pending keys are dimmed until the host confirms them) and the spells that still match on the right, with the shaped cost when one is left. Over it, a status row shows the ward (warm when ready, a sweep while it rests, lit while up), the flow pips and a rift shift warning; while you are a wisp the wisp book sits above that. Under it, a legend shows which key types each rune and the meta, ward, call and clear keys.
- Match camera: behind your row, pitched so your row sits low and the foe row high. It backs off until the widest row fits between the book's pages and centers the picture in the free band between the top bar and the tray or touch pads, easing when the book opens or closes.
- Menus: one centered card (home, find players, practice, lobby, results) over a silent demo duel seen side-on, one team to each side of the card. In the lobby the duel wears every seat's garb and the gold arrow marks yours, so a pick in the garb row under the seats shows at once.
- Nameplates: under the feet for your row, above the halo line for the foe row; shrunk when neighbours would overlap. They show name, diminishing returns badges (½, ¼, ✕; gold for stuns, pink for silences), life with shield stripes, mana, flow pips, a cast bar in the spell's school color with its metamagic, the metamagic and runes being typed, and aura chips. A raised ward lights the plate; a fallen mage's plate reads WISP.
- Aura chips: banes first, then boons. Each is an icon for its look (a flame for a burn, a flake for a chill, a shield, stars for a stun, a skull for doom…; damage over time takes its school's icon), tinted by the aura's school, inside a ring that empties as the aura runs out: green for boons, red for banes. Charges show as a count. Hovering a chip, or a long press on touch, opens its details: name, boon or bane, what it does (`describeAura` on the rules of the spell that put it there, with its real length), its school, time left and charges.
- Book rows: chords in a fixed column (room for five runes) so names line up, cost after flow, target and a cooldown sweep. Rows that no longer match the typed runes dim; rows that would set off a reaction on your aimed foe show its name; rows the rift just rewrote glow.

### Local echo

Each press carries a `seq`. Frames report the last `seq` the host processed. The page replays unconfirmed presses on top of the host's chord with the same core rules (`moveCursor` with the snap home, `readChord`, `readRunes` against the book or the wisp book), so the tray and cursor respond at once and never disagree with the host for long. After a reload the page's count restarts, so it carries on from the host's last `seq`.

### Connection

The page keeps the token from `welcome` in `sessionStorage`. When the socket drops mid-room, the last frame stays on screen, greyed, under a "Reconnecting…" note, and keys are ignored. On reconnect (and on a reload) the page sends `resume` before anything else; `back` with an id means it is home again, and `begin` and a whole frame follow. `back` with `null` means the seat is gone: the page shows the home view. Other players see a toast when someone drops ("a bot stands in") or comes back, and the lobby marks them Away.

### Sound

`sound.mjs` synthesizes everything with the Web Audio API, so there are no files to load. Nothing plays until the first click, tap or key, as browsers require. Muted (the speaker in the top bar, the link on the home card, or M), the audio is suspended entirely, and the choice is remembered. A hidden tab goes quiet.

- **Keys.** Each rune has its own note (star highest, leaf lowest, from D minor pentatonic), so every chord is a short tune you can learn by ear. Moves tick, meta sparkles, clear drops. Keys sound at once, before the host answers.
- **Spells.** Each school has a cast, a release and an impact voice: fire whooshes and crackles, frost rings like glass, storm buzzes and cracks, nature plucks and thocks, shadow growls and booms, holy rings bells, arcane wobbles. Friendly spells land as a rising chime (healing) or a shimmer (boons); harmful ones that do no damage land as a dark dissonance. Sounds are panned by where the mage stands on screen and are louder for you than for your team, and louder for your team than for foes.
- **Incoming.** A wardable spell flying at you rises in pitch over its flight and ticks as it lands, panned toward its caster: ward on the tick.
- **Moments.** Parry clang, reaction chord, flow arpeggio, fizzle buzz, the shift warning chime and the rift's swirl, falls, revives, death ward bells, the gong at the start, the surge, and a fanfare or lament at the end.
- **Music.** A four-bar loop in D minor from a small step sequencer: slow pads and a sparse arpeggio under the menus; in the fight, bass, drums and pads that grow with intensity (draft 0.15, fight 0.5, surge 0.8 rising to 1), adding faster hats and a sixteenth arpeggio. The end sting plays alone before the menu music returns.
- **Mixing.** Effects and music have their own buses into a compressor, with a little synthesized room reverb. Their volumes are settings (`setVolume`). Sounds about other mages are dropped when more than 72 voices sound or the same sound just played; sounds about you always play.
- **Haptics.** Gamepads rumble and phones (when playing by touch) vibrate on big hits to you, your parries and reactions, and your fall, unless haptics are off in the settings.

---

## 8. Tests

`npm test` runs `test.mjs` with Node's test runner.

| Group | Covers |
|---|---|
| Core | Frame deltas rebuilding every tick of whole matches exactly, at a fraction of the size; spell list shape and size; rule clamping; book balance, chord lengths, prefix-free chords and seeding; rune and chord reading; cursor paths for both sides and the snap home; a full cast; every fizzle reason; stuns and drop; reflect, dodge and never-miss; every spell in the codex cast and landed; chord speed; each metamagic and its cost; wards, rests and never-miss; diminishing returns and grace; reactions; flow; sticky aim; calls; the draft, private kits and the early start; rift shifts; wisps; determinism; bots finishing 1v1 to 8v8; bots using every mechanic; hard beating easy; async brains; wire validation; garb tidied, seeded and worn into the match; auras naming the spell that put them there; this document listing every spell; the tutorial step by step (the draft waits, each step's check, skipping) and to the end of its duel; practice (chosen kits, dummies that never fall, no clock, free mana, the ward drill, new chords, the cap on chosen books) |
| Host | Hosting, bad codes, joining by code, tuning, garb in the lobby and the match (bots keep the name and garb the lobby showed), bots filling seats, shared books, kits and picks kept from foes, presses echoed by `seq`, leaving mid-match, match end; one whole frame then deltas, compressed; malformed paths and a match that throws; dropping, resuming, taking over a live seat and a hold running out; a connection that stops answering pings; public rooms listed and hidden, and quick matches seating people together, starting when full, and filling with bots when the wait runs out |
| Views | A Playwright run through every screen, saved to `shots/`; picking garb in the lobby and wearing it into the match; aura details on hover; focus and particle budgets in 2 vs 2 and 8 vs 8; sound starting, muting and unmuting; a reload mid-match taking the seat back; settings reaching the sound, quality, palette and keys (a key bound twice swaps) and resetting; the tutorial's coach from the draft to its duel and its results; a practice room with a chosen kit counting casts; a quick match counting down and joined from the public list |

Screenshots in `shots/`:

| File | View |
|---|---|
| `01-home.png` | Home over the demo duel |
| `02-guide.png` | How to play |
| `03-lobby.png` | A new lobby with its code and a garb picked |
| `04-lobby-joined.png` | A friend joined from a share link; 2 vs 2 with a bot |
| `05-study.png` | The draft: three spells taken |
| `06-chord.png` | Typing an empowered chord: target ring, tray and matching spells |
| `07-cast.png` | Casting |
| `08-battle.png` | A 2 vs 2 fight in full swing |
| `09-book.png` | Reading a spell in the book |
| `10-gamepad.png` | Gamepad input with Y X B A labels |
| `11-result.png` | Results |
| `12-phone-home.png` | Home on a phone |
| `13-phone-study.png` | The draft on a phone |
| `14-phone-fight.png` | Touch pads in a fight |
| `15-watching.png` | Watching the phone's duel |
| `16-big-fight.png` | 8 vs 8: your effects at full strength, the rest faded |
| `17-aura.png` | An aura's details, hovered on a nameplate |
| `18-settings.png` | Settings, with the colorblind palette on the duel behind |
| `19-lesson.png` | The tutorial's coach at the Cast step, the spell to cast glowing |
| `20-practice.png` | The practice room: two dummies, the bar counting a cast |
| `21-quick-lobby.png` | A quick match's lobby counting down |
| `22-find-players.png` | The public list with that quick match in it |

The browser test uses software WebGL, so it keeps at most two pages open and freezes the one it is not driving. Pages play at the low tier; each screenshot is drawn at the top tier.

---

## 9. Extending

**Add a spell.** Add one object to `SPELL_LIST` in `core.mjs`. Text, roles, book drawing, brain scoring and visuals follow from its data. Add a row to the spell reference below (a test checks every spell is listed).

**Add an act.** Add a builder in Acts, a handler in `OPS`, a weight in `WEIGH`, a line in `LORE`, and roles in `rolesOf` if it has a new purpose.

**Add an aura rule.** Read it in `Match.hurt`, `mend`, `tendAuras` or `factor`; describe it in `describeAura`; weigh it in `auraGain`.

**Add a status look.** Add a row to `STATUS_LOOK` in `page.mjs`, with a `tint` and a `mark` if it should read at a glance, and an icon and word in `AURA_LOOKS` (drawing the icon in `AURA_ICONS` if none fits). For a mesh, toggle it in `Figure.update`.

**Add a school.** Add it to `SCHOOLS` (core); `SCHOOL_LOOK`, `HEADS`, `FLOURISH`, `SIGILS` and `DOT_LOOKS` (page); `SCHOOL_VOICES` (sound); and a `--school` color (CSS).

**Add a sound.** Add a voice to `VOICES` in `sound.mjs` (built from `tone`, `hiss`, `bell` and `pluck`) and play it from a row in `EVENT_SOUNDS` in `page.mjs`.

**Add a flight.** Add its seconds to `FLIGHTS` (core) and a branch in `Flight.draw` (page).

**Add a garb style.** Add its name to `GARB` (core), its parts to `garbShapes` and its label to `GARB_TEXT` (page). A staff needs one part painted `gem`, where spells leave from; a hat needs a `crest` for the nimbus.

**Add an input mode.** Turn its events into the twelve keys in `Pads` and add labels in `LABELS`.

**Add a metamagic.** Add it to `METAS` with a free rune slot (all four are taken today, so this means a new key), read it in `castOf`, `costOf`, `metaFault` or `Match.land`, weigh it in `rateSpell`, and add it to the brain's `SHAPES`.

**Add a reaction.** Add a row to `REACTIONS` (`hit`, `on`, `times` and a rider) and, for a new kind of rider, a branch in `Match.ride`.

**Add a brain.** Implement `think(view)` (and `draft(view)` if it should pick its own kit) and seat it with `new Pilot({ brain })`.

**Add a tutorial step.** Add a row to `LESSON.steps` (`id`, `title`, `text` with `{key}` and `[spell-id]` marks, the `keys` and `spells` to light up, and an optional `tip`), its check to the `met` table in `Lesson.watch`, and any setup to `Lesson.enter`. Its spells must be in `LESSON.book`.

**Add a setting.** Add it to `loadSettings` (with a check for its saved value), a row to the settings dialog (`data-set` on a range input or a segmented control of `on`/`off` or named values) and its effect to `Game.applySettings`.

---

## 10. Naming

- **Short plain words.** Modules and classes are single nouns: `Dice`, `Codex`, `Book`, `Board`, `Match`, `Brain`, `Pilot`, `Arena`, `Wire`, `Link`, `Pads`, `Sparks`, `Rings`, `Looks`, `Figure`, `Flight`, `Stage`, `Plates`, `Hud`.
- **One word per idea.** The Kit's `flow` is the cast streak; the aura rule for mana regen is `regen`. A `ward` is the parry key; a shield aura is built by `shield` and its amount is `guard`.
- **Balanced pairs.** Opposites share a shape: `boon`/`bane`, `Dawn`/`Dusk`, `harm`/`heal`, `mark`/`unmark`, `pack`/`unpack`, `offense`/`defense`, `glow`/`haze`, `beginCast`/`endCast`.
- **Verb first for actions.** `writeBook`, `readRunes`, `moveCursor`, `tidyRules`, `rateSpell`, `paintGlyphs`, `renderLobby`.
- **One syllable where it fits.** Keys (`up`, `star`, `wave`, `flame`, `leaf`, `meta`, `ward`, `call`, `drop`), acts (`harm`, `heal`, `burn`, `mark`, `swap`), aura rules (`guard`, `lock`, `pace`, `cheat`, `shift`), mechanics (`kit`, `aim`, `flow`).
- **The same word everywhere.** A rule is called the same thing in code, wire, UI and this document.

---

## 11. Spell reference

151 spells: 92 offense and 59 defense, plus 3 wisp spells. ¹ marks team spells, left out when a team has a single mage. Text is generated from each spell's acts.

### Offense (92)

| Spell | School | Tier | Target | Cast | Cool | Mana | Effect |
|---|---|---|---|---|---|---|---|
| Fire Bolt | fire | 1 | Foe | 0.6s | 2s | 6 | Deal 70 fire. |
| Scorch | fire | 1 | Foe | — | 4s | 8 | Deal 55 fire. |
| Immolate | fire | 1 | Foe | 0.7s | 6s | 10 | Deal 40 fire. Immolated: 16 fire per second for 8s. |
| Fireball | fire | 2 | Foe | 1s | 6s | 16 | Deal 150 fire. Burning: 10 fire per second for 4s. |
| Scorching Ray | fire | 2 | Foe | 0.7s | 8s | 16 | Deal 50 fire, 3 times. |
| Living Bomb | fire | 2 | Foe | — | 12s | 18 | Living Bomb: 15 fire per second for 4s, then deal 110 fire to everyone on that side. |
| Flame Strike | fire | 2 | Foe side | 1s | 10s | 22 | Deal 100 fire. Burning: 8 fire per second for 4s. Hits the whole side. |
| Lava Burst | fire | 2 | Foe | 1s | 8s | 18 | Deal 140 fire (×1.5 on burning foes). |
| Dragon Breath | fire | 2 | Foe | — | 16s | 18 | Deal 90 fire. Disoriented: can’t act (breaks on damage) for 3s. |
| Combustion | fire | 2 | Self | — | 24s | 14 | Combustion: deal 30% more damage for 6s. |
| Pyroblast | fire | 3 | Foe | 1.8s | 18s | 32 | Deal 300 fire. Burning: 20 fire per second for 6s. |
| Meteor | fire | 3 | Foe | 1.4s | 24s | 36 | Deal 240 fire. Deal 90 fire to everyone on that side. |
| Fire Wall | fire | 3 | Foe side | 1s | 20s | 30 | Fire Wall: 25 fire per second for 6s. Hits the whole side. |
| Burning Hands | fire | 1 | Foe side | — | 12s | 12 | Deal 30 fire. Hits the whole side. |
| Frost Ray | frost | 1 | Foe | 0.7s | 3s | 8 | Deal 60 frost. Chilled: cast 30% slower for 4s. |
| Ice Lance | frost | 1 | Foe | — | 3s | 8 | Deal 45 frost (×3 on stunned or sleeping foes). |
| Frostbolt | frost | 2 | Foe | 1s | 5s | 16 | Deal 140 frost. Chilled: cast 30% slower for 5s. |
| Cone of Cold | frost | 2 | Foe side | — | 12s | 20 | Deal 80 frost. Chilled: cast 40% slower for 4s. Hits the whole side. |
| Frost Nova | frost | 2 | Foe side | — | 20s | 18 | Deal 30 frost. Frozen: stunned for 2s. Hits the whole side. |
| Ice Storm | frost | 2 | Foe side | 0.8s | 12s | 22 | Deal 100 frost. Hits the whole side. |
| Blizzard | frost | 3 | Foe side | 1.4s | 20s | 30 | Blizzard: 22 frost per second for 6s. Chilled: cast 30% slower for 6s. Hits the whole side. |
| Glacial Spike | frost | 3 | Foe | 1.8s | 20s | 30 | Deal 260 frost. Frozen: stunned for 2.5s. |
| Frozen Orb | frost | 2 | Foe | 0.7s | 14s | 20 | 5 strikes on random foes: deal 30 frost, Chilled: cast 20% slower for 3s each. |
| Shocking Grasp | storm | 1 | Foe | — | 10s | 10 | Deal 50 storm. Interrupt a cast and silence 1.5s. |
| Thunderclap | storm | 1 | Foe side | — | 10s | 12 | Deal 40 storm. Interrupt a cast and silence 1s. Hits the whole side. |
| Spark | storm | 1 | Foe | 0.4s | 2s | 6 | Deal 60 storm. |
| Lightning Bolt | storm | 2 | Foe | 1s | 6s | 16 | Deal 160 storm. |
| Chain Lightning | storm | 2 | Foe | 1s | 10s | 22 | Deal 120 storm, then jump to 2 more at 70% each. |
| Witch Bolt | storm | 2 | Foe | 0.7s | 10s | 14 | Deal 70 storm. Tethered: 20 storm per second for 5s. |
| Call Lightning | storm | 2 | Foe | 0.7s | 8s | 18 | Deal 130 storm. |
| Ball Lightning | storm | 2 | Foe | 0.7s | 12s | 20 | 4 strikes on random foes: deal 45 storm each. |
| Storm Fury | storm | 3 | Foe side | 1.4s | 22s | 34 | Deal 150 storm. Dazed: can’t act (breaks on damage) for 1.5s. Hits the whole side. |
| Chill Touch | shadow | 1 | Foe | — | 6s | 8 | Deal 50 shadow. No Healing: no healing for 4s. |
| Eldritch Blast | shadow | 1 | Foe | — | 3s | 8 | Deal 35 shadow, 2 times. |
| Corruption | shadow | 1 | Foe | — | 5s | 8 | Corruption: 16 shadow per second for 10s. |
| Agony | shadow | 1 | Foe | — | 6s | 8 | Agony: 6 shadow per second, rising for 12s. |
| Hex | shadow | 1 | Foe | — | 10s | 8 | Hexed: take 15% more damage for 8s. |
| Shadow Bolt | shadow | 2 | Foe | 1s | 5s | 16 | Deal 150 shadow. |
| Drain Life | shadow | 2 | Foe | 1s | 8s | 16 | Drain 120 life. |
| Vampiric Touch | shadow | 2 | Foe | 0.8s | 8s | 16 | Vampiric Touch: drain 20 life each second for 8s. |
| Unstable Affliction | shadow | 2 | Foe | 0.8s | 8s | 16 | Unstable Affliction: 30 shadow per second for 6s. If removed, the remover suffers: deal 150 shadow, silence 3s. |
| Death Coil | shadow | 2 | Foe | — | 16s | 16 | Deal 110 shadow. Horrified: can’t act (breaks on damage) for 2.5s. |
| Fear | shadow | 2 | Foe | 0.8s | 14s | 14 | Feared: can’t act (breaks on damage) for 5s. |
| Blight | shadow | 2 | Foe | 0.7s | 8s | 18 | Deal 130 shadow. Blighted: 50% less healing for 4s. |
| Mind Blast | shadow | 2 | Foe | 0.8s | 6s | 16 | Deal 120 shadow. Burn 10 mana. |
| Ray of Enfeeblement | shadow | 2 | Foe | 0.7s | 14s | 12 | Enfeebled: deal 35% less damage for 6s. |
| Contagion | shadow | 2 | Foe ¹ | — | 16s | 16 | Copy its banes to its allies. |
| Howl of Terror | shadow | 3 | Foe side | — | 30s | 26 | Feared: can’t act (breaks on damage) for 3s. Hits the whole side. |
| Doom | shadow | 3 | Foe | — | 24s | 30 | Doom: after 6s, deal 340 shadow. |
| Void Hunger | shadow | 3 | Foe side | 1s | 20s | 30 | Void Hunger: 20 shadow per second for 5s. Slowed: cast 30% slower for 5s. Hits the whole side. |
| Finger of Death | shadow | 3 | Foe | 1.4s | 22s | 32 | Deal 300 shadow. |
| Kill Word | shadow | 3 | Foe | — | 30s | 30 | Slay if below 20% life, else deal 60 shadow. |
| Soul Swap | shadow | 3 | Foe | 1s | 40s | 30 | Swap life shares with the target. |
| Smite | holy | 1 | Foe | 0.7s | 2s | 8 | Deal 70 holy. |
| Sacred Flame | holy | 1 | Foe | — | 4s | 8 | Deal 55 holy through shields. |
| Hammer of Wrath | holy | 1 | Foe | — | 8s | 10 | Deal 60 holy (×2 below 30% life). |
| Guiding Bolt | holy | 2 | Foe | 0.8s | 8s | 16 | Deal 120 holy. Guided: take 20% more damage for 4s. |
| Holy Fire | holy | 2 | Foe | 1s | 10s | 18 | Deal 110 holy. Holy Fire: 12 holy per second for 6s. |
| Judgment | holy | 2 | Foe | — | 14s | 14 | Deal 80 holy. Silenced for 2.5s. |
| Holy Shock | holy | 2 | Anyone | — | 8s | 14 | On a foe: deal 110 holy. On an ally: heal 140. |
| Hammer of Justice | holy | 2 | Foe | — | 20s | 14 | Deal 40 holy. Stunned for 2.5s. |
| Consecration | holy | 2 | Foe side | 0.7s | 14s | 22 | Consecration: 11 holy per second for 6s. Hits the whole side. |
| Sunbeam | holy | 3 | Foe | 1.4s | 18s | 30 | Deal 220 holy. Blinded: can’t act (breaks on damage) for 2s. |
| Mass Dispel | holy | 3 | Foe side | 1s | 30s | 24 | Remove 2 boons. Hits the whole side. |
| Wrath | nature | 1 | Foe | 0.7s | 2s | 8 | Deal 70 nature. |
| Poison Spray | nature | 1 | Foe | — | 5s | 8 | Deal 35 nature. Poisoned: 10 nature per second for 6s. |
| Acid Splash | nature | 1 | Foe | — | 6s | 8 | Deal 45 nature. Corroded: take 10% more damage for 4s. |
| Thorn Whip | nature | 1 | Foe | — | 8s | 10 | Deal 40 nature. Snared: cast 25% slower for 4s. |
| Earth Shock | nature | 2 | Foe | — | 8s | 16 | Deal 110 nature. |
| Entangle | nature | 2 | Foe | 0.7s | 16s | 14 | Rooted: stunned for 2.5s. Thorned: 10 nature per second for 4s. |
| Insect Swarm | nature | 2 | Foe | 0.7s | 10s | 14 | Swarmed: 18 nature per second for 8s. Weakened: deal 20% less damage for 8s. |
| Earthquake | nature | 3 | Foe side | 1.4s | 22s | 32 | Deal 120 nature. Knocked Down: stunned for 1s. Hits the whole side. |
| Hurricane | nature | 3 | Foe side | 1.4s | 22s | 30 | Hurricane: 14 nature per second for 6s. Buffeted: cast 25% slower for 6s. Hits the whole side. |
| Magic Missile | arcane | 1 | Foe | 0.7s | 3s | 8 | Deal 25 arcane that never misses, 3 times. |
| Moonfire | arcane | 1 | Foe | — | 5s | 8 | Deal 40 arcane. Moonfire: 12 arcane per second for 8s. |
| Purge | arcane | 1 | Foe | — | 8s | 8 | Remove 2 boons. |
| Mana Burn | arcane | 1 | Foe | 0.7s | 8s | 10 | Burn 25 mana and deal 2× that as arcane. |
| Sleep | arcane | 1 | Foe | 1s | 18s | 10 | Asleep: can’t act (breaks on damage) for 4s. |
| Arcane Blast | arcane | 2 | Foe | 1s | 4s | 20 | Deal 160 arcane. |
| Arcane Missiles | arcane | 2 | Foe | 1s | 8s | 16 | Deal 35 arcane, 5 times. |
| Starfire | arcane | 2 | Foe | 1.4s | 6s | 18 | Deal 190 arcane. |
| Counterspell | arcane | 2 | Foe | — | 16s | 12 | Interrupt a cast and silence 3s. |
| Polymorph | arcane | 2 | Foe | 1s | 18s | 14 | Sheep: heal 20 per second, can’t act (breaks on damage) for 6s. |
| Spell Steal | arcane | 2 | Foe | 0.7s | 10s | 14 | Steal 1 boon. |
| Slow | arcane | 2 | Foe | 0.7s | 14s | 12 | Slowed: cast 50% slower for 6s. |
| Mana Siphon | arcane | 2 | Foe | 0.7s | 12s | 0 | Steal 25 mana. |
| Chaos Bolt | arcane | 2 | Foe | 1s | 8s | 18 | One at random: deal 160 fire / deal 160 frost / deal 160 storm / deal 160 shadow / deal 160 arcane. |
| Disintegrate | arcane | 3 | Foe | 1.4s | 20s | 32 | Deal 240 arcane (×2 below 30% life). |
| Starfall | arcane | 3 | Foe | — | 24s | 30 | 6 strikes on random foes: deal 55 arcane each. |
| Time Stop | arcane | 3 | Foe side | 0.7s | 40s | 30 | Time Stopped: stunned for 2.5s. Hits the whole side. |
| Feeblemind | arcane | 3 | Foe | 1.4s | 30s | 26 | Deal 100 arcane. Feebleminded: silenced for 4s. Burn 30 mana. |
| Prismatic Spray | arcane | 3 | Foe side | 1s | 20s | 30 | One at random: deal 140 fire / deal 140 frost / deal 140 storm / deal 140 nature / silenced for 3s / Petrified: stunned for 2s / Slowed: cast 50% slower for 5s. Hits the whole side. |

### Defense (59)

| Spell | School | Tier | Target | Cast | Cool | Mana | Effect |
|---|---|---|---|---|---|---|---|
| Rebuke | fire | 1 | Self | — | 14s | 8 | Rebuke: return 50 fire to attackers for 8s. |
| Cauterize | fire | 2 | Self | — | 20s | 12 | Heal 220. Cauterized: 15 fire per second for 4s. |
| Blazing Barrier | fire | 2 | Ally | — | 16s | 14 | Blazing Barrier: shield 130, return 20 fire to attackers for 8s. |
| Ice Block | frost | 3 | Self | — | 40s | 10 | Remove all banes. Ice Block: stunned, immune to harm for 4s. |
| Ice Barrier | frost | 2 | Ally | — | 14s | 16 | Ice Barrier: shield 180 for 10s. |
| Frost Armor | frost | 2 | Self | — | 16s | 14 | Frost Armor: shield 120, return 30 frost to attackers for 12s. |
| Winter Veil | frost | 1 | Ally | — | 10s | 8 | Winter Veil: take 20% less damage for 6s. |
| Tailwind | storm | 2 | Ally | — | 16s | 14 | Tailwind: cast 40% faster for 8s. |
| Lightning Shield | storm | 1 | Self | — | 12s | 10 | Lightning Shield: return 40 storm to attackers for 10s. |
| Grounding | storm | 2 | Ally | — | 18s | 12 | Grounded: dodge the next spell for 8s. |
| Wind Wall | storm | 2 | Ally side | 0.7s | 30s | 20 | Wind Wall: dodge the next spell for 4s. Hits the whole side. |
| Heroism | storm | 3 | Ally side | — | 45s | 26 | Heroism: cast 30% faster for 8s. Hits the whole side. |
| Life Tap | shadow | 1 | Self | — | 10s | 0 | Deal 100 shadow through shields. Restore 30 mana. |
| Resolve | shadow | 2 | Self | — | 24s | 12 | Resolve: take 40% less damage, immune to stun and silence for 6s. |
| Vampiric Embrace | shadow | 2 | Self | — | 24s | 12 | Vampiric Embrace: heal for 40% of damage dealt for 10s. |
| Healing Word | holy | 1 | Ally | — | 4s | 8 | Heal 70. |
| Flash Heal | holy | 1 | Ally | 0.7s | 3s | 12 | Heal 110. |
| Renew | holy | 1 | Ally | — | 4s | 8 | Renew: heal 18 per second for 8s. |
| Power Shield | holy | 1 | Ally | — | 8s | 12 | Power Shield: shield 130 for 10s. |
| Cleanse | holy | 1 | Ally | — | 6s | 8 | Remove 2 banes. |
| Cure Wounds | holy | 2 | Ally | 1s | 4s | 16 | Heal 170. |
| Penance | holy | 2 | Anyone | 0.7s | 10s | 16 | On a foe: deal 45 holy, 3 times. On an ally: heal 55, 3 times. |
| Pain Suppression | holy | 2 | Ally | — | 24s | 12 | Pain Suppression: take 40% less damage for 6s. |
| Death Ward | holy | 2 | Ally | — | 30s | 16 | Death Ward: survive a killing blow at 10% life for 20s. |
| Prayer of Mending | holy | 2 | Ally | — | 10s | 14 | Prayer of Mending: when hit, heal 80 (up to 3×) for 20s. |
| Bless | holy | 2 | Ally side | — | 18s | 18 | Blessed: take 10% less damage, deal 15% more damage for 8s. Hits the whole side. |
| Freedom | holy | 2 | Ally ¹ | — | 18s | 12 | Remove stuns, sleeps and silences. Freedom: immune to stun and silence for 4s. |
| Holy Nova | holy | 2 | Ally side | — | 12s | 18 | Heal 70. Hits the whole side. |
| Greater Heal | holy | 3 | Ally | 1.8s | 10s | 30 | Heal 360. |
| Prayer of Healing | holy | 3 | Ally side | 1.4s | 14s | 30 | Heal 140. Hits the whole side. |
| Guardian Spirit | holy | 3 | Ally | — | 40s | 20 | Guardian Spirit: 40% more healing, survive a killing blow at 40% life for 8s. |
| Divine Shield | holy | 3 | Self | — | 45s | 16 | Divine Shield: immune to harm for 3s. |
| Lay on Hands | holy | 3 | Ally | — | 45s | 0 | Heal 500. |
| Revive | holy | 3 | Fallen ally ¹ | 2s | 30s | 30 | Revive with 35% life. |
| Rejuvenate | nature | 1 | Ally | — | 4s | 8 | Rejuvenate: heal 15 per second for 10s. |
| Barkskin | nature | 1 | Self | — | 16s | 6 | Barkskin: take 25% less damage for 8s. |
| Thorns | nature | 1 | Ally | — | 12s | 8 | Thorns: return 35 nature to attackers for 12s. |
| Lifebloom | nature | 2 | Ally | — | 8s | 14 | Lifebloom: heal 12 per second for 6s, then heal 150. |
| Regrowth | nature | 2 | Ally | 0.8s | 6s | 16 | Heal 100. Regrowth: heal 10 per second for 6s. |
| Ironbark | nature | 2 | Ally | — | 20s | 12 | Ironbark: take 30% less damage for 8s. |
| Earth Shield | nature | 2 | Ally | — | 12s | 14 | Earth Shield: when hit, heal 60 (up to 4×) for 20s. |
| Chain Heal | nature | 2 | Ally | 1s | 8s | 20 | Heal 150, then jump to 2 more at 70% each. |
| Stoneskin | nature | 2 | Ally | 0.7s | 14s | 16 | Stoneskin: shield 160, take 10% less damage for 12s. |
| Innervate | nature | 2 | Ally | — | 30s | 0 | Innervate: mana regen ×3 for 8s. |
| Tranquility | nature | 3 | Ally side | 1.4s | 24s | 32 | Tranquility: heal 30 per second for 6s. Hits the whole side. |
| Healing Rain | nature | 3 | Ally side | 1s | 20s | 28 | Healing Rain: heal 22 per second for 8s. Hits the whole side. |
| Rebirth | nature | 3 | Fallen ally ¹ | 1s | 40s | 30 | Revive with 25% life. |
| Arcane Ward | arcane | 1 | Ally | — | 8s | 10 | Arcane Ward: shield 100 for 8s. |
| Mage Armor | arcane | 1 | Self | — | 16s | 8 | Mage Armor: shield 100, take 10% less damage for 10s. |
| Dispel Magic | arcane | 1 | Anyone | — | 6s | 8 | On a foe: remove 1 boon. On an ally: remove 1 bane. |
| Mirror Image | arcane | 2 | Self | — | 20s | 14 | Mirror Image: dodge the next 2 spells for 10s. |
| Haste | arcane | 2 | Ally | — | 18s | 14 | Hasted: cast 50% faster for 8s. |
| Mana Shield | arcane | 2 | Self | — | 16s | 8 | Mana Shield: 60% of damage drains mana instead for 10s. |
| Spell Reflect | arcane | 2 | Ally | — | 16s | 12 | Spell Reflect: reflect the next spell for 6s. |
| Rewind | arcane | 2 | Self | — | 30s | 12 | Rewind: after 6s, return to your life at the start if it was higher. |
| Evocation | arcane | 2 | Self | 1.4s | 30s | 0 | Restore 50 mana. |
| Globe of Warding | arcane | 3 | Ally side | 0.7s | 40s | 28 | Warded: take 50% less damage for 4s. Hits the whole side. |
| Time Warp | arcane | 3 | Ally | — | 45s | 20 | Reset all cooldowns. |
| Banish | arcane | 3 | Anyone | 0.7s | 30s | 20 | Banished: stunned, immune to harm for 4s. |

### Wisp (3)

Cast only while fallen, from the wisp book: no mana, short chords, no metamagic.

| Spell | School | Tier | Target | Cast | Cool | Mana | Effect |
|---|---|---|---|---|---|---|---|
| Glimmer | holy | 1 | Ally | — | 5s | 0 | Heal 40. |
| Hinder | arcane | 1 | Foe | — | 6s | 0 | Hindered: cast 20% slower for 3s. |
| Kindle | arcane | 1 | Ally | — | 8s | 0 | Restore 12 mana. |
