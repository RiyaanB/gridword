# Gridword

**90 seconds. A 4×4 (or 5×5) grid of letters. Swipe through touching tiles to make words — longer words score big.**
Play the **Daily** board (same for everyone, share your result), a **Solo** timed round, or race **3–5 labelled computer bots** on the same board with a live scoreboard. When time's up you see every word on the board, who found what, and a reveal of the longest words you missed.

- Fully static, no build step, no external requests, works offline.
- Mobile-first (touch swipe + tap-to-build), desktop mouse drag **and typing** (type letters, Enter to submit, Space to rotate, Esc to clear/pause).
- Sound effects synthesised with WebAudio (mute toggle), stats in `localStorage`.
- ~720 KB dictionary (≈270 KB gzipped, which GitHub Pages serves automatically); everything else is tiny.

## Run locally

```sh
python3 -m http.server 8851 -d docs
# open http://localhost:8851/
```

## Tests

```sh
npm test            # unit tests: pure game logic + stats store (node --test, no deps)
npm run e2e         # headless Chrome plays every mode at 1280x800 and 390x844 (needs Playwright, see below)
node tests/extra-shots.mjs   # extra visual QA: phone landscape, small phone, tablet
```

The e2e script imports Playwright from a sibling checkout (`../triangulate/node_modules/playwright`) and uses `/usr/bin/google-chrome`; it is a dev-only tool and not a dependency of the game. Screenshots go to `/workspace/arcade-shots/gridword/` (override with `SHOTS=dir`).

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → *Deploy from a branch* → branch `main`, folder **`/docs`**.
3. The site appears at `https://<user>.github.io/<repo>/`. All paths are relative, so any sub-path works. The "More games" link points to `../arcade/` (a sibling hub).

## Project layout

```
docs/                  ← the deployable site
  index.html           ← all screens/modals (static markup)
  css/style.css
  js/app.js            ← UI controller (screens, game loop, results)
  js/ui/boardview.js   ← tile rendering + swipe/tap input
  js/ui/audio.js       ← WebAudio synth
  js/ui/store.js       ← localStorage stats/settings
  js/core/             ← PURE, deterministic, DOM-free game logic (browser + Node)
    rng.js             ← seeded PRNG
    dict.js            ← packed dictionary decoder + binary-search lookups
    board.js           ← seeded board generation (rejects weak boards), solver, path finding
    scoring.js         ← points per word length
    bots.js            ← deterministic bot find-schedules by skill
    game.js            ← match state: createMatch / submitWord / advanceBots / finishMatch
    daily.js           ← daily number/seed from local date, share text
  data/words.txt       ← front-coded word list (built by tools/build-dict.mjs)
  CREDITS.txt, og-image.png, favicon.svg
tests/                 ← unit + e2e tests
tools/                 ← dictionary builder, blocklist, OG image + tuning scripts
```

## Rules & scoring

- Words must be 3+ letters, built from tiles that touch (including diagonals); each tile once per word. `Qu` is one tile.
- Points: 3 letters = 1, 4 = 2, 5 = 4, 6 = 6, 7 = 10, 8 = 15, then +6 per extra letter.
- vs Bots: everyone scores every word they find (no cancelling). Pick **Easy / Normal / Hard** and 3–5 bots. The difficulty sets the strongest bot tier (Casual / Sharp / Pro). Bots are always shown with 🤖, a **BOT** tag and their fixed skill tier (Rookie → Pro).
- Solo & Daily results show **bot par**: what one bot of each tier scores on the same board, and how many you beat.
- Daily: one try per local calendar day; share text looks like
  `Gridword #12 🔤 31 words · 148 pts · best: STRANGE`.

## Rebuilding the dictionary

```sh
curl -LO https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt
curl -LO https://raw.githubusercontent.com/en-wl/wordlist/master/alt12dicts/2of12id.txt
node tools/build-dict.mjs enable1.txt 2of12id.txt
```

Changing the dictionary changes which boards are generated for a given seed (including past dailies).

## Credits & license

Code: MIT (see `LICENSE`). Word lists: ENABLE and 12dicts, both public domain — see `docs/CREDITS.txt`.
