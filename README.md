# Chordcast

Real-time arena magic duels where every action is a chord of keys. A few moves pick the target, a run of runes picks the spell, and it fires on the last rune. Each match deals a fresh book with fresh chords, so you learn the spells while you fight.

![A 2 vs 2 fight](shots/08-battle.png)

- **137 spells** drawn from tabletop and MMO classics: Fireball, Polymorph, Counterspell, Lifebloom, Living Bomb, Death Ward and more.
- **Teams of any size**, 1 vs 1 by default. Bots fill open seats.
- **Host and join with a code.** Share a four-letter code or a link.
- **Keyboard, gamepad and touch** all use the same nine keys.
- **One authority.** The host runs every match and sends the same frames to everyone.
- **Swappable bots.** A deterministic brain today; any `think(view)` object, sync or async, can replace it.

## Quickstart

Needs Node 20 or newer.

```sh
npm install
npm start        # http://localhost:8080 (set PORT to change)
npm test         # engine, host and browser tests; refreshes shots/
```

The browser test uses Playwright's Chromium. If it is not installed yet, run `npx playwright install chromium` once.

## How to play

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Moves (aim) | W A S D or arrows | D-pad or left stick | Left pad |
| Runes: star, wave, flame, leaf | I J L K | Y X B A | Right pad |
| Cancel | Space or Backspace | LB or RB | Center button |
| Book | Tab | Start | Book button |

1. The target starts on you. Up jumps to the foe row, down comes back, left and right walk along a row.
2. Type the spell's runes from the book. Offense needs a foe, defense needs an ally or you.
3. Wrong chord, target, mana or cooldown: the spell fizzles and you stall briefly.
4. Healing fades over time. When the rift surges, everyone takes rising damage until a team falls.

## Files

| File | Role |
|---|---|
| `core.mjs` | Portable engine: rules, spells, match, bots, messages |
| `host.mjs` | Web server: pages, rooms, codes, the tick loop |
| `page.html` `page.css` `page.mjs` | The client: 3D stage, particles, HUD, input |
| `test.mjs` | Tests |

See [DESIGN.md](DESIGN.md) for the full design and reference.
