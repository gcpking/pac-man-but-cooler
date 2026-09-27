// Pac-Man But Cooler
// Vanilla JS, grid-based movement, canvas rendering, no build step required.

(() => {
  'use strict';

  // ---------- Config ----------
  const TILE = 24;
  const COLS = 21;
  const ROWS = 23;
  const TUNNEL_ROW = 11;
  const CENTER_C = COLS >> 1; // 10
  const CENTER_R = ROWS >> 1; // 11

  const PLAYER_SPEED = 155;       // px/sec
  const GHOST_SPEED = 132;
  const GHOST_FRIGHT_SPEED = 92;
  const GHOST_EATEN_SPEED = 230;

  const FRIGHT_TIME = 7;          // power pellet: all ghosts, seconds
  const TRAP_FRIGHT_TIME = 9;     // trap pellet: one ghost, seconds
  const TRAP_FLAT_SCORE = 200;
  const TURBO_TIME = 6;           // turbo pellet: seconds
  const TURBO_MULT = 1.5;

  const PORTAL_COOLDOWN = 8;      // seconds
  const READY_FREEZE = 1.3;       // seconds
  const COMBO_WINDOW = 1.0;       // seconds
  const COMBO_MAX = 4;

  const SCATTER_TIME = 7;
  const CHASE_TIME = 20;

  const DIRS = {
    NONE: { x: 0, y: 0 },
    UP: { x: 0, y: -1 },
    DOWN: { x: 0, y: 1 },
    LEFT: { x: -1, y: 0 },
    RIGHT: { x: 1, y: 0 },
  };

  function opposite(d) {
    if (d === DIRS.UP) return DIRS.DOWN;
    if (d === DIRS.DOWN) return DIRS.UP;
    if (d === DIRS.LEFT) return DIRS.RIGHT;
    if (d === DIRS.RIGHT) return DIRS.LEFT;
    return DIRS.NONE;
  }

  // ---------- Maze generation ----------
  // Classic Pac-Man silhouette: the field starts entirely open (dots), and
  // we carve sparse rectangular WALL islands into it - mirrored 4 ways
  // (left-right and top-bottom) so a single block placement always keeps
  // the layout symmetric. Because the field is floor-by-default and every
  // block is a small isolated island surrounded by corridor, the result is
  // guaranteed to be one fully-connected region (verified separately with
  // a BFS reachability check) - no hand-carved corridor can accidentally
  // wall off a pocket of dots.
  function makeGrid() {
    const grid = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const border = r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1;
        row.push({ type: border ? 'wall' : 'dot' });
      }
      grid.push(row);
    }

    const inBounds = (c, r) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
    const setWall = (c, r) => { if (inBounds(c, r)) grid[r][c] = { type: 'wall' }; };
    const mirrorWall = (c, r) => {
      setWall(c, r);
      setWall(COLS - 1 - c, r);
      setWall(c, ROWS - 1 - r);
      setWall(COLS - 1 - c, ROWS - 1 - r);
    };
    const block = (x, y, w, h) => {
      for (let c = x; c < x + w; c++) for (let r = y; r < y + h; r++) mirrorWall(c, r);
    };

    // Teeth hanging from the top perimeter (mirrors to the bottom too).
    block(2, 2, 1, 2);
    block(5, 2, 1, 2);
    block(8, 2, 1, 2);

    // A second row of shorter teeth, offset, for texture.
    block(3, 5, 1, 1);
    block(6, 5, 1, 1);

    // Quadrant clusters for density/visual interest.
    block(2, 7, 2, 3);
    block(5, 7, 3, 2);
    block(2, 12, 2, 1);
    block(2, 14, 1, 3);
    block(5, 13, 3, 1);

    // Ghost-house flanking bars (leave a 1-tile gap to the house itself).
    block(6, 10, 2, 3);

    // Gate pillars below the ghost house, flanking the spawn shaft.
    block(8, 15, 1, 4);

    const clearFloor = (c, r) => { grid[r][c] = { type: 'floor' }; };
    const carve = (c, r, type) => { grid[r][c] = { type }; };

    // Ghost house interior.
    for (let r = CENTER_R - 1; r <= CENTER_R + 1; r++) {
      for (let c = CENTER_C - 1; c <= CENTER_C + 1; c++) clearFloor(c, r);
    }

    // Tunnel row always fully open, overriding any stray block.
    for (let c = 1; c <= COLS - 2; c++) carve(c, TUNNEL_ROW, 'dot');
    carve(0, TUNNEL_ROW, 'dot');
    carve(COLS - 1, TUNNEL_ROW, 'dot');

    // Power pellets at the four outer corners.
    carve(1, 1, 'power');
    carve(COLS - 2, 1, 'power');
    carve(1, ROWS - 2, 'power');
    carve(COLS - 2, ROWS - 2, 'power');

    // Ghost trap pellets, left/right on the tunnel row.
    carve(4, TUNNEL_ROW, 'trap');
    carve(COLS - 5, TUNNEL_ROW, 'trap');

    // Turbo pellets, top/bottom on the center shaft.
    carve(CENTER_C, 2, 'turbo');
    carve(CENTER_C, ROWS - 3, 'turbo');

    // Player spawn, kept clear.
    clearFloor(CENTER_C, ROWS - 4);

    return grid;
  }

  // ---------- Game state ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const el = {
    score: document.getElementById('score'),
    highscore: document.getElementById('highscore'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    combo: document.getElementById('combo'),
    portalFill: document.getElementById('portal-bar-fill'),
    startOverlay: document.getElementById('start-overlay'),
    pauseOverlay: document.getElementById('pause-overlay'),
    gameoverOverlay: document.getElementById('gameover-overlay'),
    finalScore: document.getElementById('final-score'),
    newHigh: document.getElementById('new-high'),
    readyBanner: document.getElementById('ready-banner'),
    levelupBanner: document.getElementById('levelup-banner'),
    turboBanner: document.getElementById('turbo-banner'),
    startBtn: document.getElementById('start-btn'),
    restartBtn: document.getElementById('restart-btn'),
  };

  const PLAYER_START = { c: CENTER_C, r: ROWS - 4 };

  const GHOST_DEFS = [
    { name: 'blaze', color: '#ff3b3b', spawn: { c: CENTER_C - 1, r: CENTER_R - 1 }, corner: { c: COLS - 2, r: 1 } },
    { name: 'shy', color: '#ff9de2', spawn: { c: CENTER_C + 1, r: CENTER_R - 1 }, corner: { c: 1, r: 1 } },
    { name: 'zip', color: '#3ee6ff', spawn: { c: CENTER_C - 1, r: CENTER_R + 1 }, corner: { c: COLS - 2, r: ROWS - 2 } },
    { name: 'moss', color: '#ffb347', spawn: { c: CENTER_C + 1, r: CENTER_R + 1 }, corner: { c: 1, r: ROWS - 2 } },
  ];

  function tileCenter(c, r) {
    return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
  }

  const state = {
    grid: null,
    dotsRemaining: 0,
    score: 0,
    highScore: Number(localStorage.getItem('pmbc_highscore') || 0),
    level: 1,
    lives: 3,
    combo: 0,
    comboTimer: 0,
    ghostEatChain: 0,
    turboTimer: 0,
    portalCooldown: 0,
    modeTimer: SCATTER_TIME,
    modeIndex: 0, // even = scatter, odd = chase
    freezeTimer: READY_FREEZE,
    paused: false,
    muted: false,
    started: false,
    gameOver: false,
    shake: 0,
    particles: [],
    portalRings: [],
    popups: [],
  };

  el.highscore.textContent = state.highScore;

  function freshPlayer() {
    const p = tileCenter(PLAYER_START.c, PLAYER_START.r);
    return {
      x: p.x, y: p.y,
      dir: DIRS.NONE, queued: DIRS.NONE,
      mouth: 0, mouthDir: 1,
    };
  }

  function freshGhost(def) {
    const p = tileCenter(def.spawn.c, def.spawn.r);
    return {
      ...def,
      x: p.x, y: p.y,
      dir: DIRS.UP,
      mode: 'scatter',
      frightTimer: 0,
      trapped: false,
    };
  }

  let player = freshPlayer();
  let ghosts = GHOST_DEFS.map(freshGhost);
  let ghostSpeedScale = 1;

  function resetBoard() {
    state.grid = makeGrid();
    let dots = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = state.grid[r][c].type;
        if (t === 'dot' || t === 'power' || t === 'trap' || t === 'turbo') dots++;
      }
    }
    state.dotsRemaining = dots;
  }

  function resetPositions() {
    player = freshPlayer();
    ghosts = GHOST_DEFS.map(freshGhost);
    state.modeIndex = 0;
    state.modeTimer = SCATTER_TIME;
    state.turboTimer = 0;
    state.ghostEatChain = 0;
    state.freezeTimer = READY_FREEZE;
  }

  function fullReset() {
    resetBoard();
    resetPositions();
    state.score = 0;
    state.level = 1;
    state.lives = 3;
    state.combo = 0;
    state.comboTimer = 0;
    state.portalCooldown = 0;
    state.gameOver = false;
    ghostSpeedScale = 1;
    updateHud();
  }

  // ---------- Audio (WebAudio, no assets) ----------
  let actx = null;
  function ensureAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
  }

  function beep(freq, dur, type = 'square', gain = 0.05, glideTo = null) {
    if (state.muted || !actx) return;
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, actx.currentTime);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, actx.currentTime + dur);
    g.gain.setValueAtTime(gain, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    osc.connect(g).connect(actx.destination);
    osc.start();
    osc.stop(actx.currentTime + dur);
  }

  const sfx = {
    dot: () => beep(660 + Math.random() * 80, 0.05, 'square', 0.035),
    power: () => beep(220, 0.35, 'sawtooth', 0.05, 520),
    trap: () => beep(300, 0.3, 'triangle', 0.06, 700),
    turbo: () => beep(140, 0.4, 'sawtooth', 0.07, 900),
    portal: () => beep(180, 0.4, 'sine', 0.06, 900),
    ghostEat: () => { beep(500, 0.08, 'square', 0.06); setTimeout(() => beep(800, 0.1, 'square', 0.06), 70); },
    death: () => beep(300, 0.6, 'sawtooth', 0.06, 60),
    levelup: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'square', 0.05), i * 90)); },
  };

  // ---------- Maze helpers ----------
  function cellType(c, r) {
    if (r === TUNNEL_ROW && (c < 0 || c >= COLS)) return 'dot';
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return 'wall';
    return state.grid[r][c].type;
  }

  function isWallAt(c, r) { return cellType(c, r) === 'wall'; }

  function wrapCol(c) {
    if (c < 0) return COLS - 1;
    if (c >= COLS) return 0;
    return c;
  }

  function canEnter(c, r) {
    if (r === TUNNEL_ROW) return !isWallAt(wrapCol(c), r);
    return !isWallAt(c, r);
  }

  function currentTile(entity) {
    return { c: Math.floor(entity.x / TILE), r: Math.floor(entity.y / TILE) };
  }

  // eps must exceed half of this frame's travel distance, or an entity
  // sitting just outside tile center gets re-centered every frame and can
  // never leave the tile; it must also stay below the full travel distance,
  // or a fast mover could re-trigger the same tile's turn/eat logic twice.
  function isCentered(entity, eps) {
    const cx = Math.round((entity.x - TILE / 2) / TILE) * TILE + TILE / 2;
    const cy = Math.round((entity.y - TILE / 2) / TILE) * TILE + TILE / 2;
    return Math.abs(entity.x - cx) <= eps && Math.abs(entity.y - cy) <= eps;
  }

  function snapToTile(entity) {
    const t = currentTile(entity);
    const p = tileCenter(t.c, t.r);
    entity.x = p.x;
    entity.y = p.y;
    return t;
  }

  // ---------- Input ----------
  const keyToDir = {
    ArrowUp: DIRS.UP, KeyW: DIRS.UP,
    ArrowDown: DIRS.DOWN, KeyS: DIRS.DOWN,
    ArrowLeft: DIRS.LEFT, KeyA: DIRS.LEFT,
    ArrowRight: DIRS.RIGHT, KeyD: DIRS.RIGHT,
  };

  window.addEventListener('keydown', (e) => {
    if (!state.started) {
      startGame();
    }
    if (state.gameOver) {
      if (e.code === 'KeyR') { fullReset(); hideOverlay(el.gameoverOverlay); }
      return;
    }
    if (keyToDir[e.code]) {
      e.preventDefault();
      player.queued = keyToDir[e.code];
    } else if (e.code === 'Space') {
      e.preventDefault();
      tryPortal();
    } else if (e.code === 'KeyP') {
      togglePause();
    } else if (e.code === 'KeyM') {
      state.muted = !state.muted;
    }
  });

  el.startBtn.addEventListener('click', startGame);
  el.restartBtn.addEventListener('click', () => { fullReset(); hideOverlay(el.gameoverOverlay); });
  document.getElementById('stage').addEventListener('click', () => { if (!state.started) startGame(); });

  function startGame() {
    if (state.started) return;
    ensureAudio();
    state.started = true;
    hideOverlay(el.startOverlay);
  }

  function togglePause() {
    if (!state.started || state.gameOver) return;
    state.paused = !state.paused;
    el.pauseOverlay.classList.toggle('hidden', !state.paused);
  }

  function hideOverlay(node) { node.classList.add('hidden'); }
  function showOverlay(node) { node.classList.remove('hidden'); }

  // ---------- Portal ----------
  function tryPortal() {
    if (state.portalCooldown > 0 || state.freezeTimer > 0) return;
    const exit = { x: player.x, y: player.y };
    const entry = tileCenter(PLAYER_START.c, PLAYER_START.r);
    player.x = entry.x;
    player.y = entry.y;
    player.dir = DIRS.NONE;
    player.queued = DIRS.NONE;
    state.portalCooldown = PORTAL_COOLDOWN;
    state.shake = 8;
    state.portalRings.push({ x: exit.x, y: exit.y, r: 2, life: 0.5, color: '255,46,224' });
    state.portalRings.push({ x: entry.x, y: entry.y, r: 2, life: 0.5, color: '46,230,255' });
    sfx.portal();
  }

  // ---------- Update ----------
  function addScore(n) {
    state.score += n;
    if (state.score > state.highScore) {
      state.highScore = state.score;
      localStorage.setItem('pmbc_highscore', String(state.highScore));
    }
  }

  function popup(x, y, text, color) {
    state.popups.push({ x, y, text, color, life: 0.8 });
  }

  function burst(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = 40 + Math.random() * 60;
      state.particles.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: 0.5, maxLife: 0.5, color,
      });
    }
  }

  function currentGlobalMode() {
    return state.modeIndex % 2 === 0 ? 'scatter' : 'chase';
  }

  function speedMul() { return state.turboTimer > 0 ? TURBO_MULT : 1; }

  function updatePlayer(dt) {
    const speed = PLAYER_SPEED * speedMul();
    const eps = Math.max(0.5, speed * dt * 0.6);
    if (isCentered(player, eps)) {
      const t = snapToTile(player);
      if (player.queued !== player.dir && canEnter(t.c + player.queued.x, t.r + player.queued.y)) {
        player.dir = player.queued;
      }
      if (!canEnter(t.c + player.dir.x, t.r + player.dir.y)) {
        player.dir = DIRS.NONE;
      }
      eatAt(t.c, t.r);
    }
    player.x += player.dir.x * speed * dt;
    player.y += player.dir.y * speed * dt;
    if (currentTile(player).r === TUNNEL_ROW) {
      if (player.x < -TILE / 2) player.x = COLS * TILE + TILE / 2;
      if (player.x > COLS * TILE + TILE / 2) player.x = -TILE / 2;
    }
    player.mouth += player.mouthDir * dt * 10;
    if (player.mouth > 1) { player.mouth = 1; player.mouthDir = -1; }
    if (player.mouth < 0) { player.mouth = 0; player.mouthDir = 1; }
  }

  function nearestActiveGhost() {
    let best = null, bestDist = Infinity;
    for (const g of ghosts) {
      if (g.mode === 'eaten' || g.mode === 'frightened') continue;
      const d = Math.hypot(g.x - player.x, g.y - player.y);
      if (d < bestDist) { bestDist = d; best = g; }
    }
    return best;
  }

  function eatAt(c, r) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    const cell = state.grid[r][c];
    if (cell.type === 'dot') {
      cell.type = 'floor';
      state.dotsRemaining--;
      if (state.comboTimer > 0) state.combo = Math.min(COMBO_MAX, state.combo + 1);
      else state.combo = 1;
      state.comboTimer = COMBO_WINDOW;
      addScore(10 * state.combo);
      sfx.dot();
      if (state.combo > 1) pulseCombo();
      checkLevelClear();
    } else if (cell.type === 'power') {
      cell.type = 'floor';
      state.dotsRemaining--;
      addScore(50);
      state.ghostEatChain = 0;
      for (const g of ghosts) {
        if (g.mode !== 'eaten') { g.mode = 'frightened'; g.frightTimer = FRIGHT_TIME; g.trapped = false; }
      }
      burst(player.x, player.y, '255,255,255', 14);
      sfx.power();
      checkLevelClear();
    } else if (cell.type === 'trap') {
      cell.type = 'floor';
      state.dotsRemaining--;
      const target = nearestActiveGhost();
      if (target) {
        target.mode = 'frightened';
        target.frightTimer = TRAP_FRIGHT_TIME;
        target.trapped = true;
        popup(target.x, target.y - 10, 'TRAPPED!', '200,140,255');
      } else {
        addScore(20);
        popup(player.x, player.y - 14, '+20', '200,140,255');
      }
      burst(player.x, player.y, '190,100,255', 10);
      sfx.trap();
      checkLevelClear();
    } else if (cell.type === 'turbo') {
      cell.type = 'floor';
      state.dotsRemaining--;
      state.turboTimer = TURBO_TIME;
      addScore(30);
      burst(player.x, player.y, '255,70,70', 14);
      showOverlay(el.turboBanner);
      sfx.turbo();
      checkLevelClear();
    }
  }

  function pulseCombo() {
    el.combo.classList.remove('pulse');
    void el.combo.offsetWidth;
    el.combo.classList.add('pulse');
  }

  function checkLevelClear() {
    if (state.dotsRemaining <= 0) {
      state.level++;
      showOverlay(el.levelupBanner);
      setTimeout(() => hideOverlay(el.levelupBanner), 1400);
      sfx.levelup();
      resetBoard();
      resetPositions();
      ghostSpeedScale = Math.min(1.6, 1 + (state.level - 1) * 0.08);
    }
  }

  function ghostTarget(g) {
    if (g.mode === 'eaten') return g.spawn;
    if (g.mode === 'frightened') return null; // random
    if (g.mode === 'scatter') return g.corner;
    // chase - personality per ghost
    const pt = currentTile(player);
    if (g.name === 'blaze') return pt;
    if (g.name === 'shy') {
      return { c: pt.c + player.dir.x * 4, r: pt.r + player.dir.y * 4 };
    }
    if (g.name === 'zip') {
      const blaze = ghosts[0];
      const bt = currentTile(blaze);
      const aheadC = pt.c + player.dir.x * 2, aheadR = pt.r + player.dir.y * 2;
      return { c: aheadC + (aheadC - bt.c), r: aheadR + (aheadR - bt.r) };
    }
    // moss: chase unless close, then retreat to corner
    const dist = Math.hypot(g.x - player.x, g.y - player.y) / TILE;
    return dist > 8 ? pt : g.corner;
  }

  function updateGhost(g, dt) {
    if (g.mode === 'frightened') {
      g.frightTimer -= dt;
      if (g.frightTimer <= 0) { g.mode = currentGlobalMode(); g.trapped = false; }
    }

    const speed = (g.mode === 'frightened' ? GHOST_FRIGHT_SPEED
      : g.mode === 'eaten' ? GHOST_EATEN_SPEED
      : GHOST_SPEED * ghostSpeedScale) * speedMul();
    const eps = Math.max(0.5, speed * dt * 0.6);

    if (isCentered(g, eps)) {
      const t = snapToTile(g);

      if (g.mode === 'eaten' && t.c === g.spawn.c && t.r === g.spawn.r) {
        g.mode = currentGlobalMode();
      }

      const options = [DIRS.UP, DIRS.DOWN, DIRS.LEFT, DIRS.RIGHT].filter((d) => {
        if (d === opposite(g.dir)) return false;
        return canEnter(t.c + d.x, t.r + d.y);
      });
      if (options.length === 0) {
        g.dir = canEnter(t.c + opposite(g.dir).x, t.r + opposite(g.dir).y) ? opposite(g.dir) : DIRS.NONE;
      } else if (g.mode === 'frightened') {
        g.dir = options[Math.floor(Math.random() * options.length)];
      } else {
        const target = ghostTarget(g);
        let best = options[0], bestDist = Infinity;
        for (const d of options) {
          const nc = t.c + d.x, nr = t.r + d.y;
          const dist = (nc - target.c) ** 2 + (nr - target.r) ** 2;
          if (dist < bestDist) { bestDist = dist; best = d; }
        }
        g.dir = best;
      }
    }

    g.x += g.dir.x * speed * dt;
    g.y += g.dir.y * speed * dt;
    if (currentTile(g).r === TUNNEL_ROW) {
      if (g.x < -TILE / 2) g.x = COLS * TILE + TILE / 2;
      if (g.x > COLS * TILE + TILE / 2) g.x = -TILE / 2;
    }
  }

  function handleCollisions() {
    for (const g of ghosts) {
      const d = Math.hypot(g.x - player.x, g.y - player.y);
      if (d < TILE * 0.6) {
        if (g.mode === 'frightened') {
          let pts;
          if (g.trapped) {
            pts = TRAP_FLAT_SCORE;
          } else {
            state.ghostEatChain++;
            pts = 200 * Math.pow(2, Math.min(3, state.ghostEatChain - 1));
          }
          addScore(pts);
          popup(g.x, g.y, '+' + pts, '46,230,255');
          burst(g.x, g.y, '46,230,255', 10);
          g.mode = 'eaten';
          g.trapped = false;
          sfx.ghostEat();
        } else if (g.mode !== 'eaten') {
          loseLife();
          return;
        }
      }
    }
  }

  function loseLife() {
    state.lives--;
    state.shake = 14;
    burst(player.x, player.y, '255,120,60', 16);
    sfx.death();
    updateHud();
    if (state.lives <= 0) {
      endGame();
    } else {
      resetPositions();
    }
  }

  function endGame() {
    state.gameOver = true;
    el.finalScore.textContent = 'Score: ' + state.score;
    if (state.score >= state.highScore && state.score > 0) {
      showOverlay(el.newHigh);
    } else {
      hideOverlay(el.newHigh);
    }
    showOverlay(el.gameoverOverlay);
  }

  function updateHud() {
    el.score.textContent = state.score;
    el.highscore.textContent = state.highScore;
    el.level.textContent = state.level;
    el.lives.textContent = '●'.repeat(Math.max(0, state.lives)) || '—';
    el.combo.textContent = 'x' + Math.max(1, state.combo);
    const pct = 100 * (1 - state.portalCooldown / PORTAL_COOLDOWN);
    el.portalFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    el.portalFill.classList.toggle('ready', state.portalCooldown <= 0);
  }

  function update(dt) {
    if (!state.started || state.paused || state.gameOver) return;

    if (state.portalCooldown > 0) state.portalCooldown = Math.max(0, state.portalCooldown - dt);
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 0;
    }
    if (state.turboTimer > 0) {
      state.turboTimer = Math.max(0, state.turboTimer - dt);
      if (state.turboTimer <= 0) hideOverlay(el.turboBanner);
    }
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 40);

    if (state.freezeTimer > 0) {
      state.freezeTimer -= dt;
      if (state.freezeTimer <= 0) hideOverlay(el.readyBanner); else showOverlay(el.readyBanner);
      updateHud();
      return;
    }

    // Mode timer (scatter/chase cycle) - frightened/eaten ghosts ignore it.
    state.modeTimer -= dt;
    if (state.modeTimer <= 0) {
      state.modeIndex++;
      state.modeTimer = state.modeIndex % 2 === 0 ? SCATTER_TIME : CHASE_TIME;
      const newMode = currentGlobalMode();
      for (const g of ghosts) if (g.mode === 'scatter' || g.mode === 'chase') g.mode = newMode;
    }

    updatePlayer(dt);
    for (const g of ghosts) updateGhost(g, dt);
    handleCollisions();

    for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    state.particles = state.particles.filter((p) => p.life > 0);

    for (const r of state.portalRings) { r.r += dt * 220; r.life -= dt; }
    state.portalRings = state.portalRings.filter((r) => r.life > 0);

    for (const p of state.popups) { p.y -= dt * 20; p.life -= dt; }
    state.popups = state.popups.filter((p) => p.life > 0);

    updateHud();
  }

  // ---------- Render ----------
  function drawGlyph(x, y, r, color, glow = 10) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMaze() {
    // Pass 1: solid wall mass (no per-tile gaps, so contiguous walls merge).
    ctx.fillStyle = '#0b1230';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (state.grid[r][c].type === 'wall') ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }

    // Pass 2: glowing outline traced along the true corridor boundary.
    ctx.save();
    ctx.strokeStyle = '#2ee6ff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#2ee6ff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (state.grid[r][c].type === 'wall') continue;
        const x = c * TILE, y = r * TILE;
        if (isWallAt(c, r - 1)) { ctx.moveTo(x + 1, y + 1); ctx.lineTo(x + TILE - 1, y + 1); }
        if (isWallAt(c, r + 1)) { ctx.moveTo(x + 1, y + TILE - 1); ctx.lineTo(x + TILE - 1, y + TILE - 1); }
        if (c !== 0 && isWallAt(c - 1, r)) { ctx.moveTo(x + 1, y + 1); ctx.lineTo(x + 1, y + TILE - 1); }
        if (c !== COLS - 1 && isWallAt(c + 1, r)) { ctx.moveTo(x + TILE - 1, y + 1); ctx.lineTo(x + TILE - 1, y + TILE - 1); }
      }
    }
    ctx.stroke();
    ctx.restore();

    // Pass 3: pickups.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const type = state.grid[r][c].type;
        const x = c * TILE + TILE / 2, y = r * TILE + TILE / 2;
        if (type === 'dot') {
          drawGlyph(x, y, 2.4, '#ffe23e', 6);
        } else if (type === 'power') {
          const pulse = 4.2 + Math.sin(performance.now() / 150) * 1.3;
          drawGlyph(x, y, pulse, '#ffffff', 14);
        } else if (type === 'trap') {
          const pulse = 3.6 + Math.sin(performance.now() / 180) * 1;
          drawDiamond(x, y, pulse, '#c86eff');
        } else if (type === 'turbo') {
          const pulse = 4 + Math.sin(performance.now() / 120) * 1.2;
          drawGlyph(x, y, pulse, '#ff4d4d', 16);
        }
      }
    }
  }

  function drawDiamond(x, y, r, color) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    const { x, y, dir, mouth } = player;
    let angle = 0;
    if (dir === DIRS.LEFT) angle = Math.PI;
    else if (dir === DIRS.UP) angle = -Math.PI / 2;
    else if (dir === DIRS.DOWN) angle = Math.PI / 2;
    const open = 0.18 + mouth * 0.22;
    ctx.save();
    ctx.shadowColor = state.turboTimer > 0 ? '#ff4d4d' : '#ffe23e';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffe23e';
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.arc(0, 0, TILE / 2 - 1, open * Math.PI, (2 - open) * Math.PI);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawGhost(g) {
    const x = g.x, y = g.y;
    const r = TILE / 2 - 1;
    let color = g.color;
    if (g.mode === 'frightened') {
      const blinkSoon = g.frightTimer < 2 && Math.floor(g.frightTimer * 6) % 2 === 0;
      color = blinkSoon ? '#ffffff' : (g.trapped ? '#9a4dff' : '#2e5bff');
    }
    if (g.mode === 'eaten') {
      drawEyes(x, y, g.dir);
      return;
    }
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - 2, r, Math.PI, 0);
    ctx.lineTo(x + r, y + r);
    for (let i = 0; i < 3; i++) {
      const step = (2 * r) / 3;
      const bx = x + r - step * i;
      ctx.lineTo(bx - step / 2, y + r - 4);
      ctx.lineTo(bx - step, y + r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    drawEyes(x, y, g.dir);
  }

  function drawEyes(x, y, dir) {
    const off = 4;
    const ex = dir.x * 1.5, ey = dir.y * 1.5;
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x + s * off, y - 3, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a2440';
      ctx.beginPath();
      ctx.arc(x + s * off + ex, y - 3 + ey, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = `rgb(${p.color})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPortalRings() {
    for (const ring of state.portalRings) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ring.life / 0.5);
      ctx.strokeStyle = `rgb(${ring.color})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = `rgb(${ring.color})`;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPopups() {
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    for (const p of state.popups) {
      ctx.globalAlpha = Math.max(0, p.life / 0.8);
      ctx.fillStyle = `rgb(${p.color})`;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  function render() {
    ctx.save();
    ctx.fillStyle = '#000410';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (state.shake > 0) {
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    }

    drawMaze();
    drawPortalRings();
    for (const g of ghosts) drawGhost(g);
    drawPlayer();
    drawParticles();
    drawPopups();

    ctx.restore();
  }

  // ---------- Main loop ----------
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  fullReset();
  requestAnimationFrame(loop);
})();
