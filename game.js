/* Mochi Maze — an original maze-chase game. MIT License. */
(() => {
'use strict';

/* ───────────── constants & maze ───────────── */
const COLS = 19, ROWS = 21;
const MAP = [
  '###################',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.### # ###.####',
  '####.#       #.####',
  '####.# ##-## #.####',
  '    .  #   #  .    ',
  '####.# ##### #.####',
  '####.#       #.####',
  '####.### # ###.####',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#..#...........#..#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################'
];
const UP = 0, LEFT = 1, DOWN = 2, RIGHT = 3;
const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
const OPP = d => (d + 2) & 3;
const wrapX = x => ((x % COLS) + COLS) % COLS;

const GH = [
  { name: 'Rusty', color: '#ff5a4d', corner: [17, 0],  start: [9, 7] },
  { name: 'Plum',  color: '#b57bff', corner: [1, 0],   start: [9, 9] },
  { name: 'Teal',  color: '#27d3c3', corner: [17, 20], start: [8, 9] },
  { name: 'Amber', color: '#ffb33b', corner: [1, 20],  start: [10, 9] }
];
const RELEASE = [0, 1.5, 4, 7];
const FRIGHT_TIME = [7, 6, 5, 4, 3, 2.5, 2, 2];
const FRUITS = ['🍒', '🍓', '🍊', '🍎', '🍇', '🍉', '🍍', '🍑'];
const FRUIT_PTS = [100, 300, 500, 700, 1000, 2000, 3000, 5000];

/* ───────────── i18n ───────────── */
const I18N = {
  en: {
    tag: 'Munch all the pearls and dodge the Grumps!',
    how: 'Swipe anywhere or use the arrows. Big pearls make the Grumps flee!',
    play: 'Play', again: 'Play again', resume: 'Resume', paused: 'Paused',
    over: 'Game over', score: 'Score', best: 'Best', level: 'Level',
    install: 'Install app', ios: 'To install: tap Share, then “Add to Home Screen”.',
    ready: 'READY!', go: 'Swipe to start', newbest: 'New best!', clear: 'Level clear!'
  },
  ro: {
    tag: 'Mănâncă toate perlele și fugi de Grumpi!',
    how: 'Glisează pe ecran sau folosește săgețile. Perlele mari îi sperie pe Grumpi!',
    play: 'Joacă', again: 'Joacă din nou', resume: 'Continuă', paused: 'Pauză',
    over: 'Joc terminat', score: 'Scor', best: 'Record', level: 'Nivel',
    install: 'Instalează aplicația', ios: 'Instalare: apasă Partajează, apoi „Adaugă pe ecranul principal”.',
    ready: 'GATA?', go: 'Glisează ca să începi', newbest: 'Record nou!', clear: 'Nivel complet!'
  }
};
let lang = 'en';
try {
  lang = localStorage.getItem('mochimaze.lang') || ((navigator.language || 'en').toLowerCase().startsWith('ro') ? 'ro' : 'en');
} catch (e) { lang = (navigator.language || 'en').toLowerCase().startsWith('ro') ? 'ro' : 'en'; }
const T = k => (I18N[lang] || I18N.en)[k];

/* ───────────── DOM ───────────── */
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const stage = $('stage');
let dpr = 1, mazeBlue = null, mazeWhite = null;

/* ───────────── maze parsing ───────────── */
let base = [], grid = [];
(function parseMap() {
  const g = MAP.map(r => r.split(''));
  // anything not reachable from the start becomes solid wall
  const seen = new Set(), st = [[9, 15]];
  while (st.length) {
    const [x, y] = st.pop(), k = x + y * COLS;
    if (seen.has(k)) continue; seen.add(k);
    for (let d = 0; d < 4; d++) {
      const nx = wrapX(x + DX[d]), ny = y + DY[d];
      if (ny < 0 || ny >= ROWS || g[ny][nx] === '#') continue;
      st.push([nx, ny]);
    }
  }
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!seen.has(x + y * COLS)) g[y][x] = '#';
  base = g;
  grid = g.map(r => r.slice());
})();

function tileAt(x, y) { if (y < 0 || y >= ROWS) return '#'; return grid[y][wrapX(x)]; }
function walkable(x, y, door) {
  const c = tileAt(x, y);
  if (c === '#') return false;
  if (c === '-') return !!door;
  return true;
}

/* ───────────── state ───────────── */
const S = {
  mode: 'title', paused: false, t: 0, time: 0, freeze: 0,
  score: 0, best: 0, lives: 3, level: 1,
  dotsLeft: 0, dotsEaten: 0, fruit: null, fright: 0, combo: 0,
  gmode: 'scatter', modeIdx: 0, modeT: 7, sched: [], started: false, extra: false, newBest: false
};
let P = null, G = [], popups = [], want = -1, wantT = 0;
try { S.best = parseInt(localStorage.getItem('mochimaze.best') || '0', 10) || 0; } catch (e) {}

/* ───────────── sound ───────────── */
const Snd = {
  ctx: null, muted: false, lastChomp: 0, flip: 0,
  init() { if (this.ctx) return; try { const A = window.AudioContext || window.webkitAudioContext; if (A) this.ctx = new A(); } catch (e) {} },
  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); },
  tone(f, d, type = 'square', v = 0.04, to = null, delay = 0) {
    if (this.muted || !this.ctx) return;
    try {
      const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + d + 0.02);
    } catch (e) {}
  },
  chomp() { const n = performance.now(); if (n - this.lastChomp < 70) return; this.lastChomp = n; this.flip ^= 1; this.tone(this.flip ? 420 : 300, 0.07, 'triangle', 0.06); },
  power() { this.tone(180, 0.35, 'sawtooth', 0.05, 900); },
  ghost() { this.tone(300, 0.25, 'square', 0.06, 1400); },
  fruit() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.1, 'square', 0.05, null, i * 0.07)); },
  death() { this.tone(700, 1.1, 'sawtooth', 0.06, 50); },
  clear() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'square', 0.05, null, i * 0.11)); },
  start() { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.07, null, i * 0.12)); },
  life() { [784, 988, 1175].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.07, null, i * 0.09)); }
};
try { Snd.muted = localStorage.getItem('mochimaze.muted') === '1'; } catch (e) {}

/* ───────────── level setup ───────────── */
function modeSchedule(level) {
  const sc = level >= 5 ? 3 : level >= 3 ? 5 : 7;
  return [['scatter', sc], ['chase', 20], ['scatter', sc], ['chase', 20], ['scatter', 5], ['chase', 20], ['scatter', 3], ['chase', 1e9]];
}
const frightTime = () => FRIGHT_TIME[Math.min(S.level - 1, FRIGHT_TIME.length - 1)];
const playerSpeed = () => Math.min(6.4, 5.7 + 0.06 * (S.level - 1));
const ghostBase = () => Math.min(6.4, 4.9 + 0.25 * (S.level - 1));

function resetPositions() {
  P = { tx: 9, ty: 15, dir: -1, p: 0, face: LEFT };
  const k = Math.max(0.4, 1 - 0.07 * (S.level - 1));
  G = GH.map((d, i) => ({
    id: i, tx: d.start[0], ty: d.start[1], dir: i === 0 ? LEFT : -1, p: 0,
    state: i === 0 ? 'normal' : 'house', fright: false, rev: false, release: RELEASE[i] * k, anim: Math.random() * 6
  }));
  S.fright = 0; S.freeze = 0; S.combo = 0; S.fruit = null;
  S.gmode = 'scatter'; S.modeIdx = 0; S.modeT = S.sched[0][1];
  want = -1; popups = [];
}

function newLevel() {
  grid = base.map(r => r.slice());
  grid[15][9] = ' ';
  S.dotsLeft = 0;
  for (const r of grid) for (const c of r) if (c === '.' || c === 'o') S.dotsLeft++;
  S.dotsEaten = 0;
  S.sched = modeSchedule(S.level);
  resetPositions();
  S.mode = 'ready'; S.t = 1.7; S.started = false;
  updateHud();
}

function startGame() {
  Snd.resume();
  S.score = 0; S.lives = 3; S.level = 1; S.extra = false; S.newBest = false; S.paused = false;
  newLevel();
  Snd.start();
  hideOverlay();
  requestWake();
}

/* ───────────── movement ───────────── */
function pos(e) { return [e.tx + (e.dir >= 0 ? DX[e.dir] * e.p : 0), e.ty + (e.dir >= 0 ? DY[e.dir] * e.p : 0)]; }

function advance(e, dist, arrive) {
  let guard = 0;
  while (dist > 1e-9 && guard++ < 24) {
    if (e.dir < 0) { const d = arrive(e); if (d < 0) return; e.dir = d; e.p = 0; continue; }
    const rem = 1 - e.p;
    if (dist < rem) { e.p += dist; return; }
    dist -= rem;
    e.tx = wrapX(e.tx + DX[e.dir]); e.ty += DY[e.dir]; e.p = 0;
    const d = arrive(e);
    if (d < 0) { e.dir = -1; return; }
    e.dir = d;
  }
}

function bfsDir(e, gx, gy) {
  const dist = new Int16Array(COLS * ROWS).fill(-1), q = [gx + gy * COLS];
  dist[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q[i], cx = c % COLS, cy = (c / COLS) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = wrapX(cx + DX[d]), ny = cy + DY[d];
      if (ny < 0 || ny >= ROWS || !walkable(nx, ny, true)) continue;
      const k = nx + ny * COLS;
      if (dist[k] < 0) { dist[k] = dist[c] + 1; q.push(k); }
    }
  }
  let best = -1, bd = 1e9;
  for (let d = 0; d < 4; d++) {
    const nx = wrapX(e.tx + DX[d]), ny = e.ty + DY[d];
    if (ny < 0 || ny >= ROWS || !walkable(nx, ny, true)) continue;
    const v = dist[nx + ny * COLS];
    if (v >= 0 && v < bd) { bd = v; best = d; }
  }
  return best;
}

/* ───────────── player ───────────── */
function addScore(n) {
  S.score += n;
  if (!S.extra && S.score >= 10000) { S.extra = true; S.lives++; Snd.life(); }
  if (S.score > S.best) { S.best = S.score; S.newBest = true; }
  updateHud();
}

function eatAt(x, y) {
  const c = grid[y][x];
  if (c === '.') { grid[y][x] = ' '; S.dotsLeft--; S.dotsEaten++; addScore(10); Snd.chomp(); }
  else if (c === 'o') {
    grid[y][x] = ' '; S.dotsLeft--; S.dotsEaten++; addScore(50); Snd.power();
    S.fright = frightTime(); S.combo = 0;
    for (const g of G) if (g.state === 'normal') { g.fright = true; g.rev = true; }
  }
  if (S.fruit && S.fruit.x === x && S.fruit.y === y) {
    const pts = FRUIT_PTS[Math.min(S.level - 1, FRUIT_PTS.length - 1)];
    addScore(pts); popups.push({ x: x + 0.5, y: y + 0.2, text: String(pts), t: 1, color: '#ffd166' });
    S.fruit = null; Snd.fruit();
  }
  if (S.dotsEaten === 70 || S.dotsEaten === 170) S.fruit = { x: 9, y: 11, t: 10 };
  if (S.dotsLeft <= 0 && S.mode === 'play') { S.mode = 'clear'; S.t = 2; Snd.clear(); }
}

function playerArrive(e) {
  eatAt(e.tx, e.ty);
  if (S.mode !== 'play') return -1;
  if (want >= 0 && walkable(e.tx + DX[want], e.ty + DY[want], false)) { e.face = want; return want; }
  if (e.dir >= 0 && walkable(e.tx + DX[e.dir], e.ty + DY[e.dir], false)) return e.dir;
  return -1;
}

/* ───────────── ghosts ───────────── */
function ghostTarget(g) {
  if (S.gmode === 'scatter') return GH[g.id].corner;
  switch (g.id) {
    case 0: return [P.tx, P.ty];
    case 1: return [P.tx + DX[P.face] * 4, P.ty + DY[P.face] * 4];
    case 2: { const ax = P.tx + DX[P.face] * 2, ay = P.ty + DY[P.face] * 2; return [ax * 2 - G[0].tx, ay * 2 - G[0].ty]; }
    default: return Math.hypot(g.tx - P.tx, g.ty - P.ty) > 6 ? [P.tx, P.ty] : GH[3].corner;
  }
}

function ghostArrive(g) {
  if (g.state === 'eyes') {
    if (g.tx === 9 && g.ty === 9) { g.state = 'house'; g.fright = false; g.release = 1.0; return -1; }
    return bfsDir(g, 9, 9);
  }
  if (g.state === 'exit') {
    if (g.tx === 9 && g.ty === 7) { g.state = 'normal'; g.fright = S.fright > 0; }
    else return bfsDir(g, 9, 7);
  }
  const dirs = [];
  for (let d = 0; d < 4; d++) if (walkable(g.tx + DX[d], g.ty + DY[d], false)) dirs.push(d);
  if (g.rev) { g.rev = false; if (g.dir >= 0 && dirs.includes(OPP(g.dir))) return OPP(g.dir); }
  let opts = g.dir >= 0 ? dirs.filter(d => d !== OPP(g.dir)) : dirs;
  if (!opts.length) opts = dirs;
  if (!opts.length) return -1;
  if (g.fright) return opts[(Math.random() * opts.length) | 0];
  const [tx, ty] = ghostTarget(g);
  let best = opts[0], bd = 1e9;
  for (const d of opts) {
    const dx = g.tx + DX[d] - tx, dy = g.ty + DY[d] - ty, v = dx * dx + dy * dy;
    if (v < bd) { bd = v; best = d; }
  }
  return best;
}

function ghostSpeed(g) {
  if (g.state === 'eyes') return 12;
  if (g.state === 'house') return 0;
  let s = g.state === 'exit' ? 3.6 : ghostBase();
  if (g.fright) s = ghostBase() * 0.55;
  if (g.ty === 9 && (g.tx < 4 || g.tx > 14)) s *= 0.55;
  return s;
}

function nextGMode() {
  S.modeIdx = Math.min(S.modeIdx + 1, S.sched.length - 1);
  S.gmode = S.sched[S.modeIdx][0]; S.modeT = S.sched[S.modeIdx][1];
  for (const g of G) if (g.state === 'normal') g.rev = true;
}

function collide() {
  const [px, py] = pos(P);
  for (const g of G) {
    if (g.state !== 'normal') continue;
    if (S.god && !g.fright) continue;
    const [gx, gy] = pos(g);
    let dx = Math.abs(gx - px); dx = Math.min(dx, COLS - dx);
    const dy = Math.abs(gy - py);
    if (dx * dx + dy * dy < 0.25) {
      if (g.fright) {
        const pts = 200 * Math.pow(2, Math.min(S.combo, 3)); S.combo++;
        g.state = 'eyes'; g.fright = false; g.dir = -1; g.p = 0;
        addScore(pts); Snd.ghost();
        popups.push({ x: gx + 0.5, y: gy + 0.3, text: String(pts), t: 1, color: '#7be7ff' });
        S.freeze = 0.4;
        return;
      }
      S.mode = 'dying'; S.t = 0; Snd.death();
      try { navigator.vibrate && navigator.vibrate(180); } catch (e) {}
      return;
    }
  }
}

/* ───────────── main update ───────────── */
function update(dt) {
  S.time += dt;
  for (const p of popups) p.t -= dt;
  popups = popups.filter(p => p.t > 0);

  if (S.mode === 'ready') { S.t -= dt; if (S.t <= 0) S.mode = 'play'; return; }
  if (S.mode === 'dying') {
    S.t += dt;
    if (S.t >= 1.5) {
      S.lives--; updateHud();
      if (S.lives <= 0) gameOver();
      else { resetPositions(); S.mode = 'ready'; S.t = 1.3; S.started = false; }
    }
    return;
  }
  if (S.mode === 'clear') { S.t -= dt; if (S.t <= 0) { S.level++; newLevel(); } return; }
  if (S.mode !== 'play') return;
  if (S.freeze > 0) { S.freeze -= dt; return; }
  if (!S.started) { if (want >= 0) S.started = true; else return; }

  if (want >= 0) { wantT += dt; if (wantT > 1.1) want = -1; }
  if (want >= 0 && P.dir >= 0 && want === OPP(P.dir)) {
    P.tx = wrapX(P.tx + DX[P.dir]); P.ty += DY[P.dir]; P.dir = want; P.p = 1 - P.p; P.face = want;
  }
  advance(P, playerSpeed() * dt, playerArrive);
  if (S.mode !== 'play') return;

  if (S.fruit) { S.fruit.t -= dt; if (S.fruit.t <= 0) S.fruit = null; }
  if (S.fright > 0) {
    S.fright -= dt;
    if (S.fright <= 0) { S.fright = 0; for (const g of G) g.fright = false; }
  } else { S.modeT -= dt; if (S.modeT <= 0) nextGMode(); }

  for (const g of G) {
    g.anim += dt;
    if (g.state === 'house') { g.release -= dt; if (g.release <= 0) { g.state = 'exit'; g.dir = -1; g.p = 0; } continue; }
    advance(g, ghostSpeed(g) * dt, ghostArrive);
  }
  collide();
}

function gameOver() {
  S.mode = 'over';
  try { localStorage.setItem('mochimaze.best', String(S.best)); } catch (e) {}
  showOverlay('over');
}

/* ───────────── drawing ───────────── */
function rrPath(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function buildMaze(line, fill) {
  const c = document.createElement('canvas');
  c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d'), sc = cv.width / COLS;
  x.setTransform(sc, 0, 0, sc, 0, 0);
  const isOpen = (gx, gy) => gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS && base[gy][gx] !== '#';
  x.fillStyle = fill;
  for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
    if (base[gy][gx] !== '#') continue;
    let near = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isOpen(gx + dx, gy + dy)) near = true;
    if (near) x.fillRect(gx - 0.02, gy - 0.02, 1.04, 1.04);
  }
  x.strokeStyle = line; x.lineWidth = 0.13; x.lineCap = 'round';
  x.shadowColor = line; x.shadowBlur = sc * 0.3;
  x.beginPath();
  for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
    if (base[gy][gx] !== '#') continue;
    if (isOpen(gx, gy - 1)) { x.moveTo(gx, gy); x.lineTo(gx + 1, gy); }
    if (isOpen(gx, gy + 1)) { x.moveTo(gx, gy + 1); x.lineTo(gx + 1, gy + 1); }
    if (isOpen(gx - 1, gy)) { x.moveTo(gx, gy); x.lineTo(gx, gy + 1); }
    if (isOpen(gx + 1, gy)) { x.moveTo(gx + 1, gy); x.lineTo(gx + 1, gy + 1); }
  }
  x.stroke();
  x.shadowBlur = 0; x.strokeStyle = '#ff9ec7'; x.lineWidth = 0.12;
  x.beginPath(); x.moveTo(9.05, 8.5); x.lineTo(9.95, 8.5); x.stroke();
  return c;
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const t = Math.min(w / COLS, h / ROWS);
  const cw = Math.floor(COLS * t), ch = Math.floor(ROWS * t);
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr * (ROWS / ROWS));
  // keep tiles square
  const sc = cv.width / COLS; cv.height = Math.round(sc * ROWS);
  mazeBlue = buildMaze('#5b7cff', '#120a3a');
  mazeWhite = buildMaze('#ffffff', '#2a2160');
}

function drawMochi(c, x, y, face, open, alpha, scale, rot) {
  c.save(); c.translate(x + 0.5, y + 0.52); c.rotate(rot || 0); c.scale(scale, scale); c.globalAlpha = alpha;
  // leaf
  c.fillStyle = '#6bd36b'; c.beginPath(); c.ellipse(0.1, -0.5, 0.17, 0.08, -0.6, 0, 6.283); c.fill();
  c.strokeStyle = '#3c9b4a'; c.lineWidth = 0.04; c.beginPath(); c.moveTo(0, -0.4); c.lineTo(0.05, -0.47); c.stroke();
  // body
  const gr = c.createRadialGradient(-0.12, -0.14, 0.05, 0, 0, 0.46);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#ffe2cf');
  c.fillStyle = gr; c.strokeStyle = '#e7b79b'; c.lineWidth = 0.04;
  c.beginPath(); c.ellipse(0, 0.02, 0.44, 0.4, 0, 0, 6.283); c.fill(); c.stroke();
  // cheeks
  c.fillStyle = 'rgba(255,120,150,.45)';
  c.beginPath(); c.ellipse(-0.27, 0.1, 0.07, 0.045, 0, 0, 6.283); c.fill();
  c.beginPath(); c.ellipse(0.27, 0.1, 0.07, 0.045, 0, 0, 6.283); c.fill();
  // eyes
  const ox = DX[face] * 0.06, oy = DY[face] * 0.05;
  c.fillStyle = '#2b1b3a';
  c.beginPath(); c.arc(-0.15 + ox, -0.08 + oy, 0.06, 0, 6.283); c.fill();
  c.beginPath(); c.arc(0.15 + ox, -0.08 + oy, 0.06, 0, 6.283); c.fill();
  c.fillStyle = '#fff';
  c.beginPath(); c.arc(-0.13 + ox, -0.1 + oy, 0.02, 0, 6.283); c.fill();
  c.beginPath(); c.arc(0.17 + ox, -0.1 + oy, 0.02, 0, 6.283); c.fill();
  // mouth
  c.fillStyle = '#8a2f4a';
  c.beginPath(); c.ellipse(DX[face] * 0.09, 0.16 + DY[face] * 0.06, 0.09 + 0.05 * open, 0.02 + 0.09 * open, 0, 0, 6.283); c.fill();
  c.restore();
}

function drawGrump(c, g, x, y, t) {
  c.save(); c.translate(x + 0.5, y + 0.52);
  const d = g.dir >= 0 ? g.dir : LEFT;
  const ox = DX[d] * 0.05, oy = DY[d] * 0.04;
  if (g.state === 'eyes') {
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(-0.14, -0.02, 0.12, 0.15, 0, 0, 6.283); c.fill();
    c.beginPath(); c.ellipse(0.14, -0.02, 0.12, 0.15, 0, 0, 6.283); c.fill();
    c.fillStyle = '#2b1b3a';
    c.beginPath(); c.arc(-0.14 + ox * 1.5, -0.02 + oy * 1.5, 0.06, 0, 6.283); c.fill();
    c.beginPath(); c.arc(0.14 + ox * 1.5, -0.02 + oy * 1.5, 0.06, 0, 6.283); c.fill();
    c.restore(); return;
  }
  const flash = g.fright && S.fright < 1.8 && Math.floor(t * 6) % 2 === 0;
  const body = g.fright ? (flash ? '#fff5f5' : '#3d5afe') : GH[g.id].color;
  const wob = Math.sin(t * 14 + g.anim * 3) * 0.03;
  c.fillStyle = body;
  // ears
  c.beginPath(); c.moveTo(-0.36, -0.2); c.lineTo(-0.3, -0.55); c.lineTo(-0.08, -0.38); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(0.36, -0.2); c.lineTo(0.3, -0.55); c.lineTo(0.08, -0.38); c.closePath(); c.fill();
  // body
  c.beginPath(); c.arc(0, -0.02, 0.42, Math.PI, 0); c.lineTo(0.42, 0.28);
  c.quadraticCurveTo(0.42, 0.4, 0.3, 0.4); c.lineTo(-0.3, 0.4); c.quadraticCurveTo(-0.42, 0.4, -0.42, 0.28); c.closePath(); c.fill();
  // feet
  c.fillStyle = 'rgba(0,0,0,.28)';
  c.beginPath(); c.ellipse(-0.2, 0.42 + wob, 0.11, 0.055, 0, 0, 6.283); c.fill();
  c.beginPath(); c.ellipse(0.2, 0.42 - wob, 0.11, 0.055, 0, 0, 6.283); c.fill();
  if (g.fright) {
    c.fillStyle = flash ? '#d33' : '#fff';
    c.beginPath(); c.arc(-0.14, -0.05, 0.05, 0, 6.283); c.fill();
    c.beginPath(); c.arc(0.14, -0.05, 0.05, 0, 6.283); c.fill();
    c.strokeStyle = flash ? '#d33' : '#fff'; c.lineWidth = 0.04; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(-0.24, 0.2);
    for (let i = 1; i <= 6; i++) c.lineTo(-0.24 + i * 0.08, i % 2 ? 0.14 : 0.22);
    c.stroke();
  } else {
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(-0.15, -0.04, 0.1, 0.12, 0, 0, 6.283); c.fill();
    c.beginPath(); c.ellipse(0.15, -0.04, 0.1, 0.12, 0, 0, 6.283); c.fill();
    c.fillStyle = '#2b1b3a';
    c.beginPath(); c.arc(-0.15 + ox * 1.6, -0.04 + oy * 1.6, 0.055, 0, 6.283); c.fill();
    c.beginPath(); c.arc(0.15 + ox * 1.6, -0.04 + oy * 1.6, 0.055, 0, 6.283); c.fill();
    c.strokeStyle = '#2b1b3a'; c.lineWidth = 0.05; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-0.27, -0.2); c.lineTo(-0.06, -0.12); c.moveTo(0.27, -0.2); c.lineTo(0.06, -0.12); c.stroke();
    c.lineWidth = 0.035; c.beginPath(); c.moveTo(-0.1, 0.19); c.lineTo(0.1, 0.19); c.stroke();
  }
  c.restore();
}

function wrapped(x, y, fn) {
  fn(x, y);
  if (x < 0.6) fn(x + COLS, y);
  if (x > COLS - 1.6) fn(x - COLS, y);
}

function render(ts) {
  const clock = ts / 1000;
  if (!mazeBlue) return;
  const sc = cv.width / COLS;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  const flashWhite = S.mode === 'clear' && Math.floor(S.t * 6) % 2 === 0;
  ctx.drawImage(flashWhite ? mazeWhite : mazeBlue, 0, 0);
  ctx.setTransform(sc, 0, 0, sc, 0, 0);

  // dots
  if (S.mode !== 'clear') {
    const pul = 0.5 + 0.5 * Math.sin(clock * 8);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const c = grid[y][x];
      if (c === '.') {
        ctx.fillStyle = '#ffd9e6'; ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.09, 0, 6.283); ctx.fill();
      } else if (c === 'o') {
        const r = 0.22 + 0.07 * pul;
        ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, r, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(x + 0.42, y + 0.42, r * 0.28, 0, 6.283); ctx.fill();
      }
    }
  }
  // fruit
  if (S.fruit) {
    ctx.font = '0.85px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(FRUITS[Math.min(S.level - 1, FRUITS.length - 1)], S.fruit.x + 0.5, S.fruit.y + 0.55 + Math.sin(clock * 6) * 0.05);
  }

  if (!P) return;
  // ghosts
  if (!(S.mode === 'dying' && S.t > 0.25)) {
    for (const g of G) {
      let [x, y] = pos(g);
      if (g.state === 'house') y += Math.sin(clock * 6 + g.id) * 0.08;
      wrapped(x, y, (a, b) => drawGrump(ctx, g, a, b, clock));
    }
  }
  // player
  const [px, py] = pos(P);
  if (S.mode === 'dying') {
    const k = Math.min(1, S.t / 1.4);
    wrapped(px, py, (a, b) => drawMochi(ctx, a, b, P.face, 0.3, 1 - k * 0.9, Math.max(0.05, 1 - k), k * 14));
  } else {
    const moving = S.mode === 'play' && P.dir >= 0;
    const open = moving ? 0.5 + 0.5 * Math.sin(clock * 22) : 0.1;
    wrapped(px, py, (a, b) => drawMochi(ctx, a, b, P.face, open, 1, 1, 0));
  }
  // popups
  ctx.font = 'bold 0.55px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const p of popups) {
    ctx.globalAlpha = Math.min(1, p.t * 2); ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y - (1 - p.t) * 0.8);
  }
  ctx.globalAlpha = 1;
  // banners
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const banner = (txt, y, size, color) => {
    ctx.font = 'bold ' + size + 'px system-ui, sans-serif';
    ctx.lineWidth = size * 0.18; ctx.strokeStyle = '#120a3a'; ctx.lineJoin = 'round';
    ctx.strokeText(txt, COLS / 2, y); ctx.fillStyle = color; ctx.fillText(txt, COLS / 2, y);
  };
  if (S.mode === 'ready') banner(T('ready'), 11.5, 1.0, '#ffd166');
  else if (S.mode === 'play' && !S.started) { ctx.globalAlpha = 0.6 + 0.4 * Math.sin(clock * 5); banner(T('go'), 13.5, 0.62, '#ffffff'); ctx.globalAlpha = 1; }
  else if (S.mode === 'clear') banner(T('clear'), 11.5, 0.9, '#7be7ff');
}

/* ───────────── HUD & overlay ───────────── */
function updateHud() {
  $('score').textContent = S.score;
  $('best').textContent = S.best;
  $('level').textContent = S.level;
  $('lives').textContent = '♥'.repeat(Math.max(0, Math.min(S.lives, 9)));
}

let deferredInstall = null;
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = T(el.dataset.i18n); });
  $('langBtn').textContent = lang === 'ro' ? 'EN' : 'RO';
}

function showOverlay(kind) {
  const ov = $('overlay');
  ov.classList.remove('hidden');
  $('title').dataset.i18n = kind === 'paused' ? 'paused' : kind === 'over' ? 'over' : '';
  $('title').textContent = kind === 'paused' ? T('paused') : kind === 'over' ? T('over') : 'Mochi Maze';
  const res = $('result');
  if (kind === 'over') {
    res.classList.remove('hidden');
    res.textContent = T('score') + ': ' + S.score + '  ·  ' + T('best') + ': ' + S.best + (S.newBest ? '  ★ ' + T('newbest') : '');
  } else res.classList.add('hidden');
  $('tag').classList.toggle('hidden', kind !== 'title');
  $('how').classList.toggle('hidden', kind === 'paused');
  const pb = $('playBtn');
  pb.dataset.i18n = kind === 'paused' ? 'resume' : kind === 'over' ? 'again' : 'play';
  pb.textContent = T(pb.dataset.i18n);
  $('installBtn').classList.toggle('hidden', !deferredInstall || kind === 'paused');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
  $('iosHint').classList.toggle('hidden', !(ios && kind === 'title'));
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

function setPaused(p) {
  if (S.mode === 'title' || S.mode === 'over') return;
  S.paused = p;
  if (p) showOverlay('paused'); else hideOverlay();
}

/* ───────────── input ───────────── */
function setWant(d) { want = d; wantT = 0; }

const KEYS = { ArrowUp: UP, KeyW: UP, ArrowLeft: LEFT, KeyA: LEFT, ArrowDown: DOWN, KeyS: DOWN, ArrowRight: RIGHT, KeyD: RIGHT };
window.addEventListener('keydown', e => {
  if (e.code in KEYS) { Snd.resume(); setWant(KEYS[e.code]); e.preventDefault(); return; }
  if (e.code === 'Space' || e.code === 'KeyP' || e.code === 'Escape') {
    e.preventDefault();
    if (S.mode === 'title' || S.mode === 'over') startGame(); else setPaused(!S.paused);
  } else if (e.code === 'Enter' && (S.mode === 'title' || S.mode === 'over')) startGame();
  else if (e.code === 'KeyM') toggleMute();
});

let sx = 0, sy = 0, swiping = false;
const app = $('app');
app.addEventListener('pointerdown', e => { Snd.resume(); sx = e.clientX; sy = e.clientY; swiping = true; });
app.addEventListener('pointermove', e => {
  if (!swiping) return;
  const dx = e.clientX - sx, dy = e.clientY - sy;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 14) {
    setWant(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP));
    sx = e.clientX; sy = e.clientY;
  }
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(n => app.addEventListener(n, () => { swiping = false; }));
document.querySelectorAll('#pad button').forEach(b => {
  b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); Snd.resume(); setWant(parseInt(b.dataset.dir, 10)); });
});
['gesturestart', 'contextmenu'].forEach(n => document.addEventListener(n, e => e.preventDefault()));

function toggleMute() {
  Snd.muted = !Snd.muted;
  try { localStorage.setItem('mochimaze.muted', Snd.muted ? '1' : '0'); } catch (e) {}
  $('muteBtn').textContent = Snd.muted ? '🔇' : '🔊';
}
$('muteBtn').textContent = Snd.muted ? '🔇' : '🔊';
$('muteBtn').addEventListener('click', toggleMute);
$('pauseBtn').addEventListener('click', () => { if (S.mode === 'play' || S.mode === 'ready') setPaused(!S.paused); });
$('langBtn').addEventListener('click', () => {
  lang = lang === 'ro' ? 'en' : 'ro';
  try { localStorage.setItem('mochimaze.lang', lang); } catch (e) {}
  applyLang();
  showOverlay(S.mode === 'over' ? 'over' : S.paused ? 'paused' : 'title');
});
$('playBtn').addEventListener('click', () => {
  if (S.paused) setPaused(false); else startGame();
});
$('installBtn').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch (e) {}
  deferredInstall = null; $('installBtn').classList.add('hidden');
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (S.mode === 'title') $('installBtn').classList.remove('hidden'); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (S.mode === 'play' || S.mode === 'ready') setPaused(true); }
  else requestWake();
});

let wake = null;
async function requestWake() {
  try { if ('wakeLock' in navigator && !document.hidden) wake = await navigator.wakeLock.request('screen'); } catch (e) {}
}

/* ───────────── loop & boot ───────────── */
let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  if (!S.paused) {
    let acc = dt;
    while (acc > 1e-6) { const st = Math.min(acc, 1 / 90); update(st); acc -= st; }
  }
  render(ts);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 150));
if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

grid = base.map(r => r.slice()); grid[15][9] = ' ';
S.sched = modeSchedule(1);
resetPositions();
applyLang();
updateHud();
showOverlay('title');
resize();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

window.__mm = { S, startGame, update, setWant, newLevel, walkable, bfsDir, pos, get P() { return P; }, get G() { return G; }, get grid() { return grid; }, base, COLS, ROWS, DX, DY };
})();
