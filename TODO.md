# TODO

High-impact work for Chordcast, most impactful first.

1. **[Infra] CI on every PR.** There is no `.github/`. Run the engine and host tests on each push, with the Playwright browser run as its own job, and block merges on red.
2. **[Efficiency] Production build and caching.** The page loads about 2.5 MB of unminified JS (`three.core.js` 1.46 MB, `three.module.js` 663 KB, plus `page.mjs`, `core.mjs` and `sound.mjs`). It is served without compression and with `cache-control: no-cache`. Bundle and tree-shake with esbuild, minify, serve brotli or gzip, and use hashed file names with immutable caching. Shared links should open fast.
3. **[Gameplay] Data-driven balance.** `simulate()` already exists. Build a harness that runs thousands of bot matches and reports how much each spell, school, metamagic and reaction adds to win rate, and flags outliers. Use it to tune the 151 spells and post its report from CI. Start with big fights: a book that deals several side spells can end an 8 vs 8 in under 10 seconds.
4. **[Organization] Split the big files into modules.** `page.mjs` is 5,964 lines and `core.mjs` is 2,751. Split them along their numbered sections (Sparks, Figure, Stage, Hud… and Codex, Match, Brain, Pilot…), with the spell list in its own data file. The import map already serves modules, so no build step is needed.
5. **[Organization] Static checks.** Add `checkJs` type checking with JSDoc types, plus ESLint and Prettier, and run them in CI. That is 12k lines of untyped JS, and the client is covered only by screenshots.
6. **[UI] Results that teach.** The results screen is a table of totals. Add damage and healing over time, a per-spell breakdown, fizzle reasons, parry rate and average chord speed, so players can see what to practice.
7. **[Gameplay] Replays.** The same seed, rules, roster and orders always replay a match, so a whole match fits in a few KB of orders. Record it for a replay viewer, shareable replay links and bug reports.
8. **[Testing] Visual regression in place of overwriting `shots/`.** Each `npm test` rewrites `shots/`, which dirties the tree and catches nothing. Compare screenshots against baselines with a pixel tolerance. Split the tests into a fast `test:unit` and a slower `test:browser`.
9. **[Infra] Deploy and observe.** Add a Dockerfile and graceful shutdown on SIGTERM (finish or notify rooms). Add structured logs and a `/metrics` endpoint (rooms, peers, held seats, tick lag, bytes sent). Cap connections per IP and check the WebSocket `Origin`.
10. **[Gameplay] Reasons to come back.** Keep a local profile: match history, mastery per spell (chord speed, fizzle rate) and win/loss by mode. Add a bot ladder that climbs from easy to hard to a new top tier.
