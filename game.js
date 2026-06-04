// ============================================================
//  game.js  —  Core state, constants, audio, save/load,
//               HUD rendering, layout, and the main loop.
//
//  GLOBAL SURFACE:  window.GD  (the shared state object)
//  All other files read/write GD.S (game state) and call
//  functions registered on the GD namespace.
// ============================================================

// ── Shared namespace ─────────────────────────────────────────
window.GD = window.GD || {};

// ── Tuneable constants ────────────────────────────────────────
GD.WEAPON_DAMAGE        = {pistol:35,smg:18,rifle:55,grenade:80,knife:90,shotgun:38,laser:22,mortar:100,flamethrower:10,sniper:140};
GD.WEAPON_FIRE_INTERVAL = {pistol:1400,smg:500,rifle:1800,grenade:3000,knife:800,shotgun:1300,laser:300,mortar:4000,flamethrower:120,sniper:3500};
GD.TOTAL_WAVES          = 15;
GD.CRIT_CHANCE_BASE     = 0.05;   // 5 %
GD.LIFESTEAL_BASE       = 0;      // 0 %
GD.GRID_COLS            = 9;
GD.GRID_ROWS            = 4;
GD.BENCH_SIZE           = 10;     // 2 rows × 5

GD.ITEM_DEFS = {
  pistol:      {name:'Pistol',   tier:1,w:2,h:1,color:'#5599ee',type:'pistol',      cost:10, atkBonus:35,  spdBonus:0},
  smg:         {name:'SMG',      tier:1,w:3,h:1,color:'#44aa66',type:'smg',          cost:14, atkBonus:18,  spdBonus:8},
  rifle:       {name:'Rifle',    tier:2,w:4,h:1,color:'#88aa22',type:'rifle',        cost:24, atkBonus:55,  spdBonus:2},
  grenade:     {name:'Grenade',  tier:2,w:2,h:2,color:'#cc7722',type:'grenade',      cost:20, atkBonus:80,  spdBonus:0},
  knife:       {name:'Knife',    tier:1,w:1,h:2,color:'#cc3355',type:'knife',        cost:11, atkBonus:90,  spdBonus:5},
  shotgun:     {name:'Shotgun',  tier:2,w:3,h:2,color:'#8844cc',type:'shotgun',      cost:22, atkBonus:38,  spdBonus:3},
  laser:       {name:'Laser',    tier:3,w:4,h:1,color:'#00aaaa',type:'laser',        cost:35, atkBonus:22,  spdBonus:12},
  mortar:      {name:'Mortar',   tier:3,w:2,h:3,color:'#aa8800',type:'mortar',       cost:32, atkBonus:100, spdBonus:0},
  flamethrower:{name:'Flamer',   tier:2,w:3,h:2,color:'#ee4400',type:'flamethrower', cost:28, atkBonus:10,  spdBonus:15},
  sniper:      {name:'Sniper',   tier:3,w:5,h:1,color:'#0077aa',type:'sniper',       cost:38, atkBonus:140, spdBonus:0},
};
GD.TIER_COLORS  = ['#5599ee','#44bb55','#ee8822','#cc33aa'];
GD.TIER_UNLOCK  = [
  ['pistol','smg','knife'],
  ['pistol','smg','knife','rifle','grenade','shotgun','flamethrower'],
  ['rifle','grenade','shotgun','flamethrower','laser','mortar','sniper'],
  ['laser','mortar','sniper','grenade','rifle'],
];

// ── Canvas references (set once DOM ready) ────────────────────
GD.canvas = null;
GD.ctx    = null;

// ── UID counter ───────────────────────────────────────────────
GD._uid = 0;
GD.uid  = () => ++GD._uid;

// ── Fresh game state factory ──────────────────────────────────
GD.freshState = function () {
  return {
    phase: 'menu',   // 'menu' | 'prep' | 'combat' | 'gameover'
    hp: 1200, maxHp: 1200,
    gold: 60,
    wave: 1,
    kills: 0,
    highScore: 0,
    // 9 × 4 inventory grid (null = empty)
    grid: Array(GD.GRID_ROWS).fill(null).map(() => Array(GD.GRID_COLS).fill(null)),
    // 2 × 5 bench slots
    bench: Array(GD.BENCH_SIZE).fill(null),
    shopPool: [],
    rerollCost: 5,
    // Combat entities
    enemies: [],
    projectiles: [],
    floaters: [],
    particles: [],
    activeWeapons: [],
    spawnQueue: [],
    spawnTimer: 0,
    spawnInterval: 1200,
    waveComplete: false,
    // Loop bookkeeping
    time: 0,
    lastTime: 0,
    animId: null,
    // Drag state
    dragItem: null,
    dragSource: null,
    touchDragItem: null,
    touchDragSource: null,
    // Computed stat cache (recalculated by calcStats)
    statAtk: 0,
    statSpd: 100,
    statCrit: GD.CRIT_CHANCE_BASE * 100,
    statCritDmg: 162,
    statVamp: GD.LIFESTEAL_BASE,
  };
};
GD.S = GD.freshState();

// ── AUDIO ─────────────────────────────────────────────────────
let _audioCtx = null;
let _muted    = false;

GD.toggleMute = function () {
  _muted = !_muted;
  document.getElementById('mute-btn').textContent = _muted ? '🔇' : '🔊';
};

function _ac() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
GD.tone = function (freq, type, dur, vol, delay = 0) {
  if (_muted) return;
  try {
    const ac = _ac(), o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination); o.type = type;
    o.frequency.setValueAtTime(freq, ac.currentTime + delay);
    g.gain.setValueAtTime(vol, ac.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + dur);
    o.start(ac.currentTime + delay); o.stop(ac.currentTime + delay + dur);
  } catch (e) {}
};

// Convenience sound effects (called by grid.js and combat.js)
GD.sfx = {
  shoot(type) {
    const t = GD.tone;
    if (type === 'laser')          t(880,'sawtooth',.04,.03);
    else if (type === 'sniper')   { t(100,'sawtooth',.25,.1); t(350,'sawtooth',.08,.05); }
    else if (type === 'shotgun')  { for (let i=0;i<3;i++) t(70+Math.random()*40,'sawtooth',.12,.05,i*.02); }
    else if (type === 'mortar' || type === 'grenade') { t(55,'sawtooth',.06,.07); t(35,'sine',.35,.08,.05); }
    else if (type === 'flamethrower') t(75+Math.random()*15,'sawtooth',.04,.025);
    else if (type === 'knife')    t(280,'square',.07,.04);
    else                          t(420+Math.random()*80,'square',.05,.035);
  },
  hit()     { GD.tone(160,'sawtooth',.07,.04); },
  crit()    { GD.tone(660,'sine',.1,.08); GD.tone(880,'sine',.08,.06,.05); },
  buy()     { GD.tone(600,'sine',.08,.05); GD.tone(800,'sine',.06,.04,.09); },
  merge()   { [440,660,880].forEach((f,i) => GD.tone(f,'sine',.12,.08,i*.1)); },
  explode(big) {
    if (big) { GD.tone(38,'sawtooth',.5,.13); GD.tone(55,'sine',.35,.09,.08); }
    else       GD.tone(75,'sawtooth',.18,.07);
  },
  wave()    { [523,659,784,1047].forEach((f,i) => GD.tone(f,'sine',.2,.07,i*.1)); },
  gameOver(){ [440,330,220,110].forEach((f,i) => GD.tone(f,'sawtooth',.28,.09,i*.18)); },
  sell()    { GD.tone(350,'sine',.1,.05); GD.tone(250,'sine',.08,.04,.08); },
};

// ── SAVE / LOAD ───────────────────────────────────────────────
const SAVE_KEY = 'gd_v4';

GD.saveGame = function () {
  try {
    const S = GD.S;
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      hp: S.hp, maxHp: S.maxHp, gold: S.gold, wave: S.wave,
      kills: S.kills, highScore: Math.max(S.highScore || 0, S.kills),
      grid: S.grid, bench: S.bench, shopPool: S.shopPool,
    }));
    const el = document.getElementById('save-ind');
    el.style.opacity = '1';
    setTimeout(() => el.style.opacity = '0', 1400);
  } catch (e) {}
};

GD.loadGame = function () {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const sv = JSON.parse(raw);
    GD.S = GD.freshState();
    Object.assign(GD.S, sv);
    GD.S.phase = 'prep';
    // Clear all runtime-only arrays
    GD.S.enemies = []; GD.S.projectiles = []; GD.S.floaters = [];
    GD.S.particles = []; GD.S.activeWeapons = []; GD.S.spawnQueue = [];
    return true;
  } catch (e) { return false; }
};

GD.clearSave = function () {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
};

// ── STAT CALCULATOR ───────────────────────────────────────────
GD.calcStats = function () {
  const S = GD.S;
  let atk = 0, spd = 100,
      crit    = GD.CRIT_CHANCE_BASE * 100,
      critDmg = 162,
      vamp    = GD.LIFESTEAL_BASE;
  const seen = new Set();
  S.grid.forEach(row => row.forEach(cell => {
    if (!cell || seen.has(cell.uid)) return;
    seen.add(cell.uid);
    const mult = Math.pow(1.5, (cell.tier || 1) - 1);
    atk += Math.round((cell.atkBonus || GD.WEAPON_DAMAGE[cell.type] || 0) * mult);
    spd += cell.spdBonus || 0;
  }));
  S.statAtk = atk;
  S.statSpd = Math.min(spd, 200);
  S.statCrit = crit;
  S.statCritDmg = critDmg;
  S.statVamp = vamp;
  GD.renderStatBar();
};

GD.renderStatBar = function () {
  const S = GD.S;
  document.getElementById('stat-atk').textContent    = S.statAtk || 0;
  document.getElementById('stat-spd').textContent    = Math.round(S.statSpd) + '%';
  document.getElementById('stat-crit').textContent   = S.statCrit.toFixed(0) + '%';
  document.getElementById('stat-critdmg').textContent= S.statCritDmg + '%';
  document.getElementById('stat-vamp').textContent   = S.statVamp + '%';
};

// ── HUD ───────────────────────────────────────────────────────
GD.renderHUD = function () {
  const S = GD.S;
  document.getElementById('hp-txt').textContent = Math.max(0, Math.floor(S.hp));
  const hf = S.hp / S.maxHp;
  const bar = document.getElementById('hp-bar');
  bar.style.width = Math.max(0, hf * 100) + '%';
  bar.style.background = hf > .5
    ? 'linear-gradient(90deg,#44ee44,#88ee44)'
    : hf > .25
    ? 'linear-gradient(90deg,#ffaa00,#ffcc00)'
    : 'linear-gradient(90deg,#ff2222,#ff6622)';
  document.getElementById('gold-txt').textContent = S.gold;
  const waveTxt = document.getElementById('wave-txt');
  waveTxt.textContent   = `Wave ${S.wave}/${GD.TOTAL_WAVES}`;
  waveTxt.style.color   = S.phase === 'combat' ? '#fff' : '#ddeeff';
};

// ── LAYOUT (portrait split) ───────────────────────────────────
GD.setLayout = function () {
  const W = window.innerWidth, H = window.innerHeight;
  // Taller phones → give more room to management panel
  const ratio = H / W > 1.8 ? 0.44 : H / W > 1.4 ? 0.46 : 0.50;
  const ch    = Math.floor(H * ratio);
  document.getElementById('app').style.setProperty('--arena-h', ch + 'px');
  const cv = GD.canvas;
  if (cv) { cv.width = W; cv.height = ch; }
};

// ── MAIN LOOP ─────────────────────────────────────────────────
GD.loop = function (ts) {
  const S  = GD.S;
  const dt = Math.min(ts - S.lastTime, 80);
  S.lastTime = ts;
  S.time    = (S.time || 0) + dt;

  GD.update(dt, ts);   // combat.js
  GD.draw();           // combat.js
  GD.renderHUD();

  S.animId = requestAnimationFrame(GD.loop);
};

// ── OVERLAY: GAME OVER ────────────────────────────────────────
GD.showGameOver = function (wave, kills, hs) {
  const ov = document.getElementById('game-overlay');
  ov.innerHTML = `
    <div style="font-family:'Fredoka One',cursive;font-size:36px;color:#ff6666;text-shadow:0 4px 0 rgba(0,0,0,.3)">GAME OVER 😿</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:240px">
      <div style="background:rgba(255,255,255,.12);border-radius:12px;padding:8px;text-align:center">
        <div style="font-family:'Fredoka One',cursive;font-size:20px;color:#ffd700">${wave}</div>
        <div style="font-size:8px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:1px">Wave</div>
      </div>
      <div style="background:rgba(255,255,255,.12);border-radius:12px;padding:8px;text-align:center">
        <div style="font-family:'Fredoka One',cursive;font-size:20px;color:#ffd700">${kills}</div>
        <div style="font-size:8px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:1px">Kills</div>
      </div>
      <div style="background:rgba(255,255,255,.12);border-radius:12px;padding:8px;text-align:center;grid-column:1/-1">
        <div style="font-family:'Fredoka One',cursive;font-size:20px;color:#ffd700">🏆 ${hs}</div>
        <div style="font-size:8px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:1px">Best Kills</div>
      </div>
    </div>
    <button onclick="GD.restartGame()" style="border:none;background:#ff4d4d;color:#fff;padding:12px 28px;font-family:'Fredoka One',cursive;font-size:14px;border-radius:24px;cursor:pointer;box-shadow:0 4px 0 #cc2222">↺ TRY AGAIN</button>`;
  ov.style.display = 'flex';
};

GD.restartGame = function () {
  const hs = GD.S.highScore || 0;
  GD.S = GD.freshState();
  GD.S.phase = 'prep';
  GD.S.highScore = hs;
  document.getElementById('game-overlay').style.display = 'none';
  document.getElementById('play-btn').style.display  = 'flex';
  document.getElementById('pause-btn').style.display = 'none';
  GD.buildShop();        // grid.js
  GD.renderGrid();       // grid.js
  GD.renderBench();      // grid.js
  GD.renderHUD();
  GD.calcStats();
  if (GD.S.animId) cancelAnimationFrame(GD.S.animId);
  GD.S.lastTime = performance.now();
  GD.S.animId   = requestAnimationFrame(GD.loop);
};

// ── BOOT (called from index.html once DOM is ready) ───────────
GD.boot = function () {
  // Canvas setup
  GD.canvas = document.getElementById('gameCanvas');
  GD.ctx    = GD.canvas.getContext('2d');
  GD.setLayout();

  // Layout resize handler
  window.addEventListener('resize', () => {
    GD.setLayout();
    GD.renderGrid();
    GD.renderBench();
  });

  // Mute button
  document.getElementById('mute-btn').addEventListener('click', GD.toggleMute);

  // Play / Pause buttons
  document.getElementById('play-btn').addEventListener('click',  GD.startCombat);  // combat.js
  document.getElementById('pause-btn').addEventListener('click', GD.pauseCombat); // combat.js

  // Reroll button
  document.getElementById('reroll-btn').addEventListener('click', () => {
    const S = GD.S;
    if (S.gold < S.rerollCost) return;
    S.gold -= S.rerollCost;
    GD.buildShop();
    GD.renderHUD();
    GD.saveGame();
  });

  // Start-screen overlay buttons
  document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('game-overlay').style.display = 'none';
    GD.S = GD.freshState();
    GD.S.phase = 'prep';
    GD.buildShop();
    GD.renderGrid();
    GD.renderBench();
    GD.renderHUD();
    GD.calcStats();
    GD.S.lastTime = performance.now();
    GD.S.animId   = requestAnimationFrame(GD.loop);
  });

  document.getElementById('continue-btn').addEventListener('click', () => {
    document.getElementById('game-overlay').style.display = 'none';
    GD.renderGrid();
    GD.renderBench();
    GD.renderHUD();
    GD.calcStats();
    GD.S.lastTime = performance.now();
    GD.S.animId   = requestAnimationFrame(GD.loop);
  });

  // Sell zone (drag-and-drop events registered in grid.js)
  document.getElementById('sell-zone').addEventListener('dragover', e => e.preventDefault());
  document.getElementById('sell-zone').addEventListener('drop',     e => { e.preventDefault(); GD.dropSell(); });

  // Try to restore a saved run
  const hasSave = GD.loadGame();
  if (hasSave) {
    document.getElementById('continue-btn').style.display = '';
    GD.renderShop();   // grid.js
  }

  // Kick off the render loop (draws title screen background while overlay is visible)
  GD.S.lastTime = performance.now();
  GD.S.animId   = requestAnimationFrame(GD.loop);
};
