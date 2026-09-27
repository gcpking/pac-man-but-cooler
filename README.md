# pac-man-but-cooler

A browser-based Pac-Man remix with a few tricks the original never had. Pure
HTML5 canvas + vanilla JS, no build step, no dependencies.

## Play

Open `index.html` in a browser, or serve the folder locally:

```
python3 -m http.server 8080
```

then visit `http://localhost:8080`.

## Controls

- **Move**: Arrow keys or WASD
- **Portal**: Space
- **Pause**: P
- **Mute**: M

## What's cooler about it

- **Portal (Space)** — instantly teleports you back to the start tile.
  Cooldown-gated (shown as a bar in the corner), and unlike dying or clearing
  a level, it does **not** reset the board: every dot you've already eaten
  stays eaten, ghosts keep whatever state they're in. Pure emergency escape
  hatch.
- **Combo multiplier** — chain dots quickly (within a second of each other)
  to ramp a x1 → x4 score multiplier.
- **Classic power pellet** (white) — frightens *all* ghosts; eating them in
  one run chains 200 → 400 → 800 → 1600.
- **Ghost trap pellet** (purple diamond) — frightens just the *nearest*
  ghost for a flat 200, letting you thin the pack without the risk of
  chasing down all four.
- **Turbo pellet** (red) — speeds up everyone, you and the ghosts alike, for
  a short frantic burst.
- **Scatter/chase ghost AI** — four ghosts with distinct personalities
  (aggressive direct chaser, ambusher, pincer, and one that flees up close),
  cycling between scatter and chase like the arcade original.
- Juice: screen shake, particle bursts, floating score popups, a pulsing
  neon maze, and a persisted high score (localStorage).

## Maze

The maze is generated in code as three nested corridor loops connected by
vertical shafts and a horizontal tunnel row, with a ghost house at the
center — the same nested-loop structure that makes the original Pac-Man
maze readable, built from scratch as an original layout.
