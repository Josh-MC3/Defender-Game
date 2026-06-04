// ============================================================
//  combat.js  —  Enemy definitions, wave spawning, real-time
//                update loop, projectiles, particles, floaters,
//                and all canvas drawing (background + entities).
//
//  Reads / writes: GD.S  (shared state)
//  Calls into:     GD.sfx, GD.renderHUD(), GD.saveGame(),
//                  GD.calcStats(), GD.buildShop(),
//                  GD.renderGrid(), GD.renderBench(),
//                  GD.showGameOver(), GD.clearSave()
// ============================================================

window.GD = window.GD || {};

// ── ENEMY DEFINITIONS ────────────────────────────────────────
GD.ENEMY_DEFS = {
  goat:    {name:'Goat',   hp:80,  atk:12,reward:4,  color:'#eeeecc',outline:'#998866',type:'goat',    speed:42, size:22,ranged:false},
  cactus:  {name:'Cactus', hp:160, atk:18,reward:8,  color:'#55cc44',outline:'#228833',type:'cactus',  speed:28, size:20,ranged:false},
  plant:   {name:'Plant',  hp:40,  atk:8, reward:3,  color:'#88ee44',outline:'#448822',type:'plant',   speed:52, size:14,ranged:false},
  mushroom:{name:'Shroom', hp:280, atk:22,reward:14, color:'#ee6644',outline:'#aa3322',type:'mushroom', speed:22, size:26,ranged:false,shield:80},
  speeder: {name:'Speeder',hp:50,  atk:10,reward:5,  color:'#ffee44',outline:'#cc8800',type:'speeder',  speed:90, size:16,ranged:false},
  ghost:   {name:'Ghost',  hp:130, atk:15,reward:10, color:'#aabbff',outline:'#7788ee',type:'ghost',   speed:32, size:20,ranged:true, shootDmg:14,shootCd:2200,shootRange:340},
  rock:    {name:'Rock',   hp:500, atk:30,reward:18, color:'#999988',outline:'#666655',type:'rock',    speed:18, size:32,ranged:false},
  sniper:  {name:'Sniper', hp:100, atk:0, reward:12, color:'#dd8866',outline:'#aa4422',type:'sniper',  speed:20, size:20,ranged:true, shootDmg:30,shootCd:3000,shootRange:9999},
  boss:    {name:'BOSS',   hp:2500,atk:50,reward:80, color:'#ff4466',outline:'#cc1133',type:'boss',    speed:15, size:44,ranged:true, shootDmg:25,shootCd:1800,shootRange:9999,isBoss:true},
  miniboss:{name:'MINI',   hp:900, atk:35,reward:35, color:'#ff8833',outline:'#cc4400',type:'miniboss',speed:22, size:34,ranged:true, shootDmg:18,shootCd:2200,shootRange:9999,isBoss:true},
};

// ── WAVE BUILDER ─────────────────────────────────────────────
GD.buildWaveEnemies = function (wave) {
  const isBoss = wave % 5 === 0;
  const isMini = wave % 5 === 3;
  const hpSc   = 1 + wave * .22;
  const atkSc  = 1 + wave * .13;
  const W      = GD.canvas.width;
  const H      = GD.canvas.height;
  const groundY = H * .72;
  const list   = [];

  function mk(key, xOff) {
    const d = GD.ENEMY_DEFS[key];
    return {
      ...d,
      id:        GD.uid(),
      hp:        d.hp  * hpSc,
      maxHp:     d.hp  * hpSc,
      atk:       d.atk * atkSc,
      shootDmg:  d.shootDmg ? d.shootDmg * atkSc : 0,
      shield:    d.shield   ? d.shield   * hpSc  : 0,
      maxShield: d.shield   ? d.shield   * hpSc  : 0,
      x:         W + xOff,
      y:         groundY - d.size,
      lastShot:  0,
      attackTimer: 0,
      flashTimer:  0,
      bobOffset: Math.random() * Math.PI * 2,
      dead:      false,
    };
  }

  if (isBoss) {
    list.push(mk('boss',60), mk('rock',180), mk('rock',300), mk('cactus',420), mk('cactus',520));
    return list;
  }
  if (isMini) {
    list.push(mk('miniboss',60), mk('ghost',200), mk('ghost',320));
    if (wave > 3) list.push(mk('speeder',120), mk('speeder',240));
    return list;
  }
  const pool = [];
  if (wave >= 1) pool.push('goat','goat','plant');
  if (wave >= 2) pool.push('cactus');
  if (wave >= 3) pool.push('speeder','ghost');
  if (wave >= 4) pool.push('mushroom');
  if (wave >= 5) pool.push('rock','sniper');
  const count = Math.min(4 + wave * 2, 20);
  for (let i = 0; i < count; i++) {
    list.push(mk(pool[Math.floor(Math.random() * pool.length)], 60 + i * 80 + Math.random() * 40));
  }
  return list;
};

// ── COMBAT START / PAUSE / RESUME ────────────────────────────
GD.startCombat = function () {
  const S = GD.S;
  if (S.phase === 'combat') return;
  S.phase = 'combat';
  const all    = GD.buildWaveEnemies(S.wave);
  S.spawnQueue = [...all];
  S.enemies    = [];
  S.projectiles = []; S.floaters = []; S.particles = [];
  S.activeWeapons  = GD._buildActiveWeapons();
  S.waveComplete   = false;
  S.spawnTimer     = 0;
  GD.renderHUD();
  document.getElementById('play-btn').style.display  = 'none';
  document.getElementById('pause-btn').style.display = 'flex';
  if (S.animId) cancelAnimationFrame(S.animId);
  S.lastTime = performance.now();
  requestAnimationFrame(GD.loop);
};

GD.pauseCombat = function () {
  const S = GD.S;
  if (S.animId) { cancelAnimationFrame(S.animId); S.animId = null; }
  const btn = document.getElementById('pause-btn');
  btn.textContent = '▶ RESUME';
  btn.onclick     = GD.resumeCombat;
};

GD.resumeCombat = function () {
  const S = GD.S;
  S.lastTime = performance.now();
  S.animId   = requestAnimationFrame(GD.loop);
  const btn  = document.getElementById('pause-btn');
  btn.textContent = '⏸ PAUSE';
  btn.onclick     = GD.pauseCombat;
};

// ── ACTIVE WEAPONS ────────────────────────────────────────────
GD._buildActiveWeapons = function () {
  const S     = GD.S;
  const seen  = new Set();
  const ws    = [];
  const spdMult = S.statSpd / 100;
  for (let r = 0; r < GD.GRID_ROWS; r++) {
    for (let c = 0; c < GD.GRID_COLS; c++) {
      const cell = S.grid[r][c];
      if (!cell || seen.has(cell.uid)) continue;
      seen.add(cell.uid);
      const tier = cell.tier || 1;
      ws.push({
        ...cell,
        damage:      GD.WEAPON_DAMAGE[cell.type] * Math.pow(1.5, tier - 1),
        fireInterval:Math.max(200, GD.WEAPON_FIRE_INTERVAL[cell.type] / spdMult),
        nextFireAt:  performance.now() + Math.random() * 500,
      });
    }
  }
  return ws;
};

// Preserve existing timers for weapons that are still on the grid
GD.rebuildActiveWeapons = function () {
  const S    = GD.S;
  const seen = new Set();
  const ws   = [];
  const spdMult = S.statSpd / 100;
  for (let r = 0; r < GD.GRID_ROWS; r++) {
    for (let c = 0; c < GD.GRID_COLS; c++) {
      const cell = S.grid[r][c];
      if (!cell || seen.has(cell.uid)) continue;
      seen.add(cell.uid);
      const existing = S.activeWeapons.find(w => w.uid === cell.uid);
      const tier = cell.tier || 1;
      ws.push({
        ...cell,
        damage:      GD.WEAPON_DAMAGE[cell.type] * Math.pow(1.5, tier - 1),
        fireInterval:Math.max(200, GD.WEAPON_FIRE_INTERVAL[cell.type] / spdMult),
        nextFireAt:  existing ? existing.nextFireAt : performance.now() + 300,
      });
    }
  }
  S.activeWeapons = ws;
};

// ── MAIN UPDATE (called each frame by GD.loop in game.js) ────
GD.update = function (dt, ts) {
  const S = GD.S;
  if (S.phase !== 'combat') return;
  const W       = GD.canvas.width;
  const H       = GD.canvas.height;
  const groundY = H * .72;
  const sec     = dt / 1000;
  const playerX = GD._playerX();

  // ── Spawn queue ──
  S.spawnTimer += dt;
  while (S.spawnTimer >= S.spawnInterval && S.spawnQueue.length > 0) {
    const e = S.spawnQueue.shift();
    e.y = groundY - e.size;
    S.enemies.push(e);
    S.spawnTimer -= S.spawnInterval;
  }

  // ── Move enemies & handle attacks ──
  S.enemies.forEach(e => {
    if (e.dead) return;
    const dist = e.x - playerX;
    if (dist > e.size + 30) {
      e.x -= e.speed * sec;
    } else {
      // Melee attack
      e.attackTimer = (e.attackTimer || 0) + dt;
      if (e.attackTimer > 1000) {
        S.hp = Math.max(0, S.hp - e.atk);
        e.attackTimer = 0;
        GD.sfx.hit();
        GD.addFloater(playerX - 20, groundY - 80, `-${Math.floor(e.atk)}`, '#ff4444');
      }
    }
    // Ranged attack
    if (e.ranged && dist < e.shootRange) {
      if (ts - (e.lastShot || 0) > e.shootCd) {
        e.lastShot = ts;
        GD._spawnEnemyBullet(e, playerX, groundY - 60);
      }
    }
    if (e.flashTimer > 0) e.flashTimer -= dt;
  });

  // ── Weapon firing (each weapon fires independently) ──
  S.activeWeapons.forEach(w => {
    if (ts < w.nextFireAt) return;
    const alive = S.enemies.filter(e => !e.dead && e.hp > 0);
    if (alive.length > 0) {
      GD._pickTargets(w, alive).forEach(e => {
        const isCrit = Math.random() < S.statCrit / 100;
        const dmg    = w.damage * (isCrit ? S.statCritDmg / 100 : 1);
        GD._dealDmg(e, dmg);
        if (S.statVamp > 0) S.hp = Math.min(S.maxHp, S.hp + dmg * S.statVamp / 100);
        GD.addFloater(e.x, e.y - e.size - 10, Math.floor(dmg).toString(), isCrit ? '#ff6600' : '#ffffff', isCrit);
        if (isCrit) GD.sfx.crit();
        GD._spawnProjectile(w, e, playerX, groundY - 60);
      });
      GD.sfx.shoot(w.type);
    }
    const spdMult = S.statSpd / 100;
    w.nextFireAt  = ts + Math.max(200, w.fireInterval / spdMult);
  });

  // ── Remove dead enemies ──
  S.enemies = S.enemies.filter(e => {
    if (e.hp <= 0 && !e.dead) {
      e.dead = true;
      S.gold += e.reward; S.kills++;
      GD.sfx.explode(e.isBoss);
      GD.addFloater(e.x, e.y - 20, `+${e.reward}`, '#44ee44');
      GD._spawnDeathParticles(e);
      return false;
    }
    return !e.dead;
  });

  // ── Player death ──
  if (S.hp <= 0) {
    S.phase = 'gameover';
    cancelAnimationFrame(S.animId);
    GD.sfx.gameOver();
    const hs = Math.max(S.highScore || 0, S.kills);
    GD.clearSave();
    GD.showGameOver(S.wave, S.kills, hs);
    return;
  }

  // ── Wave complete ──
  if (!S.waveComplete && S.spawnQueue.length === 0 && S.enemies.length === 0) {
    S.waveComplete = true;
    GD._onWaveComplete();
  }

  // ── Projectiles ──
  S.projectiles = S.projectiles.filter(p => {
    p.t    += dt; p.life -= dt;
    const frac = Math.min(p.t / p.maxT, 1);
    p.x = GD._lerp(p.sx, p.tx, frac);
    p.y = GD._lerp(p.sy, p.ty, frac) - (p.arc ? Math.sin(frac * Math.PI) * 55 : 0);
    return p.life > 0 && frac < 1;
  });

  // ── Floaters ──
  S.floaters = S.floaters.filter(f => { f.t += dt; f.y -= 30 * sec; return f.t < f.maxT; });

  // ── Particles ──
  S.particles = S.particles.filter(p => {
    p.life -= dt; p.x += p.vx * sec; p.y += p.vy * sec; p.vy += 60 * sec;
    return p.life > 0;
  });
};

GD._onWaveComplete = function () {
  const S      = GD.S;
  const isBoss = S.wave % 5 === 0;
  S.gold += 20 + S.wave * 8 + (isBoss ? 60 : 0);
  if (isBoss || S.wave % 3 === 1) S.hp = Math.min(S.maxHp, S.hp + S.maxHp * .3);
  GD.sfx.wave();
  S.wave++;
  S.phase = 'prep';
  cancelAnimationFrame(S.animId);
  GD.buildShop(); GD.renderGrid(); GD.renderBench(); GD.renderHUD(); GD.calcStats(); GD.saveGame();
  document.getElementById('play-btn').style.display  = 'flex';
  document.getElementById('pause-btn').style.display = 'none';
  const msg = document.getElementById('wave-msg');
  msg.textContent   = isBoss ? '⭐ Boss Defeated! ⭐' : `Wave ${S.wave - 1} Clear! 🎉`;
  msg.style.opacity = '1';
  setTimeout(() => msg.style.opacity = '0', 2500);
  if (S.animId) cancelAnimationFrame(S.animId);
  S.lastTime = performance.now();
  S.animId   = requestAnimationFrame(GD.loop);
};

// ── COMBAT HELPERS ────────────────────────────────────────────
GD._playerX = () => 70;

GD._dealDmg = function (e, dmg) {
  if (e.shield > 0) { const abs = Math.min(e.shield, dmg); e.shield -= abs; dmg -= abs; }
  e.hp = Math.max(0, e.hp - dmg);
  e.flashTimer = 180;
};

GD._pickTargets = function (w, alive) {
  switch (w.type) {
    case 'pistol': case 'rifle': case 'smg': case 'sniper': {
      const t = alive.reduce((b, e) => !b || e.x < b.x ? e : b, null);
      return t ? [t] : [];
    }
    case 'shotgun':
      return alive.sort((a, b) => a.x - b.x).slice(0, 3);
    case 'laser':
      return alive.slice(0, Math.min(alive.length, 6));
    case 'grenade': case 'mortar': {
      const t = alive.reduce((b, e) => !b || e.x < b.x ? e : b, null);
      if (!t) return [];
      return alive.filter(e => Math.abs(e.x - t.x) < 90);
    }
    case 'knife': case 'flamethrower': {
      const px = GD._playerX();
      return alive.filter(e => e.x - px < 120);
    }
    default: {
      const t = alive.reduce((b, e) => !b || e.x < b.x ? e : b, null);
      return t ? [t] : [];
    }
  }
};

GD._spawnProjectile = function (w, e, px, py) {
  const isArc = w.type === 'grenade' || w.type === 'mortar';
  GD.S.projectiles.push({
    sx: px + 30, sy: py, tx: e.x, ty: e.y,
    x: px + 30,  y: py, type: w.type,
    t: 0, maxT: isArc ? 700 : Math.max(150, (e.x - px) / 600 * 1000),
    life: 800, arc: isArc,
  });
};

GD._spawnEnemyBullet = function (e, tx, ty) {
  GD.S.projectiles.push({
    sx: e.x, sy: e.y, tx, ty, x: e.x, y: e.y,
    type: 'enemy_bullet', t: 0, maxT: 400, life: 500, arc: false,
  });
};

GD._spawnDeathParticles = function (e) {
  for (let i = 0; i < 6; i++) {
    GD.S.particles.push({
      x: e.x, y: e.y,
      vx: (Math.random() - .5) * 120, vy: -60 - Math.random() * 80,
      life: 500, maxLife: 500, color: e.color, r: 4 + Math.random() * 4,
    });
  }
};

GD._lerp = (a, b, t) => a + (b - a) * Math.min(Math.max(t, 0), 1);

GD.addFloater = function (x, y, text, color, isCrit = false) {
  GD.S.floaters.push({ x, y, text, color, t: 0, maxT: isCrit ? 1100 : 850, isCrit });
};

// ── MAIN DRAW ─────────────────────────────────────────────────
GD.draw = function () {
  const S   = GD.S;
  const cv  = GD.canvas;
  const ctx = GD.ctx;
  const W   = cv.width, H = cv.height, t = S.time || 0;

  // ── Sky (colour shifts between prep / combat) ──
  const sg = ctx.createLinearGradient(0, 0, 0, H * .55);
  sg.addColorStop(0, S.phase === 'prep' ? '#2a8aaa' : '#7de8ff');
  sg.addColorStop(1, S.phase === 'prep' ? '#3aabcc' : '#4dcde8');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H * .55);

  // ── Clouds ──
  _drawCloud(ctx, ((t*.012) % (W+200)) - 100,        H*.09, 65, .85);
  _drawCloud(ctx, ((t*.007 + W*.38) % (W+200)) - 100, H*.15, 48, .65);
  _drawCloud(ctx, ((t*.01  + W*.68) % (W+200)) - 100, H*.07, 78, .75);

  // ── Sand dunes ──
  ctx.fillStyle = '#e8c87a';
  ctx.beginPath(); ctx.moveTo(0, H*.52);
  for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H*.47 + Math.sin(x*.018 + t*.0005) * 11);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

  // ── Ground ──
  const gy = H * .72;
  ctx.fillStyle = '#d4a055';
  ctx.beginPath(); ctx.moveTo(0, gy);
  for (let x = 0; x <= W; x += 50) ctx.lineTo(x, gy + Math.sin(x*.022 + t*.0004) * 6);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.09)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, gy);
  for (let x = 0; x <= W; x += 50) ctx.lineTo(x, gy + Math.sin(x*.022 + t*.0004) * 6); ctx.stroke();
  ctx.fillStyle = '#c47a3a'; ctx.fillRect(0, H*.9, W, H*.1);

  // ── Decorations ──
  _drawCactus(ctx, W*.3,  gy - 24, 24);
  _drawCactus(ctx, W*.62, gy - 18, 18);
  _drawBone(ctx, W*.47, gy + 4);
  _drawBone(ctx, W*.72, gy + 8);

  // ── Player (corgi) + weapons ──
  const px = GD._playerX();
  _drawCorgi(ctx, px, gy - 22);
  {
    const seen = new Set(); let wi = 0;
    for (let r = 0; r < GD.GRID_ROWS; r++) {
      for (let c = 0; c < GD.GRID_COLS; c++) {
        const cell = S.grid[r][c];
        if (!cell || seen.has(cell.uid)) continue;
        seen.add(cell.uid);
        _drawWeapon(ctx, cell, px + 20, gy - 22 - (wi % 3) * 8);
        wi++;
      }
    }
  }

  // ── Projectiles ──
  S.projectiles.forEach(p => {
    const frac = p.t / p.maxT;
    if (p.type === 'enemy_bullet') {
      ctx.fillStyle = '#ff6644'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 8, 4, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffaa66'; ctx.beginPath(); ctx.ellipse(p.x+7, p.y, 5, 2.5, 0, 0, Math.PI*2); ctx.fill();
    } else if (p.type === 'grenade' || p.type === 'mortar') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(frac * Math.PI * 4);
      ctx.fillStyle = p.type === 'mortar' ? '#667733' : '#445522';
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, 0, 7, 9, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke(); ctx.restore();
    } else if (p.type === 'laser') {
      ctx.strokeStyle = 'rgba(0,255,200,0.9)';  ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,255,200,0.25)'; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.x, p.y); ctx.stroke();
    } else if (p.type === 'sniper') {
      ctx.strokeStyle = 'rgba(255,240,0,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.x, p.y); ctx.stroke();
    } else if (p.type === 'flamethrower') {
      const a = 1 - p.t / p.maxT;
      ctx.fillStyle = `rgba(255,${Math.floor(70 + a*110)},0,${a*.8})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 12 + a*9, 7 + a*5, 0, 0, Math.PI*2); ctx.fill();
    } else if (p.type === 'shotgun') {
      ctx.fillStyle = '#cc88ff'; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.fillStyle = '#ffffd0'; ctx.fillRect(p.x-1, p.y-1.5, 13, 3);
      ctx.fillStyle = 'rgba(255,255,200,0.35)'; ctx.fillRect(p.x-2, p.y-3, 16, 6);
    }
  });

  // ── Particles ──
  S.particles.forEach(p => {
    const a = p.life / p.maxLife;
    ctx.fillStyle = p.color + Math.floor(a * 220).toString(16).padStart(2, '0');
    ctx.beginPath(); ctx.arc(p.x, p.y, (p.r || 4) * (.5 + a*.5), 0, Math.PI*2); ctx.fill();
  });

  // ── Enemies ──
  S.enemies.forEach(e => {
    if (e.dead) return;
    const bob   = Math.sin(S.time * .005 + e.bobOffset) * 3;
    const flash = e.flashTimer > 0;
    ctx.save();
    if (flash) ctx.globalAlpha = .5 + Math.sin(e.flashTimer * .1) * .5;
    _drawEnemy(ctx, e, e.x, e.y + bob);
    ctx.restore();
    // HP bar
    const bw = Math.max(e.size * 2 + 8, 44), tf = Math.max(0, e.hp / e.maxHp);
    const bx = e.x - bw/2, by = e.y - e.size - 12;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; _roundRect(ctx, bx, by, bw, 8, 4); ctx.fill();
    ctx.fillStyle = tf > .6 ? '#44ee44' : tf > .3 ? '#ffcc00' : '#ff3333';
    if (tf > 0) { _roundRect(ctx, bx, by, bw * tf, 8, 4); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    _roundRect(ctx, bx, by, bw, 8, 4); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px "Fredoka One",cursive'; ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(e.hp), e.x, by - 2); ctx.textAlign = 'left';
  });

  // ── Floaters ──
  S.floaters.forEach(f => {
    const a  = 1 - f.t / f.maxT;
    const sz = f.isCrit ? 16 : 12;
    ctx.font = `bold ${sz}px "Fredoka One",cursive`; ctx.textAlign = 'center';
    if (f.isCrit) {
      ctx.fillStyle = `rgba(255,80,0,${a})`; ctx.fillText(f.text, f.x+1, f.y+1);
      ctx.fillStyle = `rgba(255,200,0,${a})`;
    } else {
      ctx.fillStyle = `rgba(0,0,0,${a*.3})`; ctx.fillText(f.text, f.x+1, f.y+1);
      const r = parseInt(f.color.slice(1,3)||'ff',16);
      const g = parseInt(f.color.slice(3,5)||'ff',16);
      const b = parseInt(f.color.slice(5,7)||'ff',16);
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    }
    ctx.fillText(f.text, f.x, f.y); ctx.textAlign = 'left';
  });

  // ── Prep hint banner ──
  if (S.phase === 'prep') {
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; _roundRect(ctx, W*.08, H*.78, W*.84, 22, 11); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = 'bold 10px "Fredoka One",cursive'; ctx.textAlign = 'center';
    ctx.fillText(`Wave ${S.wave}/${GD.TOTAL_WAVES} — Place weapons & press PLAY`, W*.5, H*.78 + 15);
    ctx.textAlign = 'left';
  }
};

// ── DRAWING PRIMITIVES ────────────────────────────────────────
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h);   ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r);     ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
}

function _drawCloud(ctx, x, y, size, alpha) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#fff';
  [{dx:0,dy:0,r:size*.5},{dx:size*.44,dy:size*.1,r:size*.37},
   {dx:-size*.4,dy:size*.1,r:size*.34},{dx:size*.2,dy:-size*.2,r:size*.29},
   {dx:-size*.1,dy:-size*.15,r:size*.27}].forEach(b => {
    ctx.beginPath(); ctx.arc(x+b.dx, y+b.dy, b.r, 0, Math.PI*2); ctx.fill();
  });
  ctx.restore();
}

function _drawCactus(ctx, x, y, size) {
  ctx.fillStyle = '#55aa33'; ctx.strokeStyle = '#228811'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(x, y, size*.25, size, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x-size*.5, y+size*.1, size*.5,  size*.18, -.3, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x+size*.5, y+size*.25, size*.45, size*.16,  .3, 0, Math.PI*2); ctx.fill(); ctx.stroke();
}

function _drawBone(ctx, x, y) {
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.strokeStyle = 'rgba(180,160,120,0.4)'; ctx.lineWidth = 1;
  ctx.fillRect(x, y, 14, 4);
  [x-2, x+14].forEach(bx => { ctx.beginPath(); ctx.arc(bx+2, y+2, 4, 0, Math.PI*2); ctx.fill(); ctx.stroke(); });
}

function _drawCorgi(ctx, x, y) {
  const s = 28;
  ctx.save(); ctx.translate(x, y);
  // Body
  ctx.fillStyle = '#e8a832'; ctx.strokeStyle = '#c4821a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, s*.42, s*.52, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  // Belly
  ctx.fillStyle = '#fff8ee'; ctx.beginPath(); ctx.ellipse(0, s*.1, s*.22, s*.32, 0, 0, Math.PI*2); ctx.fill();
  // Ears
  ctx.fillStyle = '#c4741a'; ctx.strokeStyle = '#9a5210'; ctx.lineWidth = 1.5;
  [[-1],[1]].forEach(([sx]) => {
    ctx.beginPath(); ctx.moveTo(sx*s*.18, s*-.38);
    ctx.bezierCurveTo(sx*s*.42, s*-.55, sx*s*.55, s*-.1, sx*s*.38, s*.08);
    ctx.bezierCurveTo(sx*s*.3,  s*.05,  sx*s*.22, s*-.15, sx*s*.18, s*-.38);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f4a8a0';
    ctx.beginPath(); ctx.moveTo(sx*s*.2, s*-.35);
    ctx.bezierCurveTo(sx*s*.38, s*-.48, sx*s*.44, s*-.08, sx*s*.3, s*.04);
    ctx.bezierCurveTo(sx*s*.24, s*.0,   sx*s*.2,  s*-.18, sx*s*.2, s*-.35);
    ctx.closePath(); ctx.fill(); ctx.fillStyle = '#c4741a';
  });
  // Head
  ctx.fillStyle = '#e8a832'; ctx.strokeStyle = '#c4821a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, s*-.18, s*.32, s*.3, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  // Muzzle
  ctx.fillStyle = '#fff8ee'; ctx.beginPath(); ctx.ellipse(0, s*-.05, s*.2, s*.18, 0, 0, Math.PI*2); ctx.fill();
  // Eyes
  ctx.fillStyle = '#2a1a08';
  ctx.beginPath(); ctx.arc(-s*.12, s*-.22, s*.065, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( s*.12, s*-.22, s*.065, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-s*.09, s*-.25, s*.03, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( s*.15, s*-.25, s*.03, 0, Math.PI*2); ctx.fill();
  // Nose & smile
  ctx.fillStyle = '#2a1a08'; ctx.beginPath(); ctx.ellipse(0, s*-.06, s*.07, s*.05, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#2a1a08'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s*.06, s*-.01); ctx.quadraticCurveTo(0, s*.04, s*.06, s*-.01); ctx.stroke();
  // Blush
  ctx.fillStyle = 'rgba(255,160,140,0.4)';
  ctx.beginPath(); ctx.ellipse(-s*.22, s*-.12, s*.09, s*.055, -.3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( s*.22, s*-.12, s*.09, s*.055,  .3, 0, Math.PI*2); ctx.fill();
  // Paws
  ctx.fillStyle = '#e8a832'; ctx.strokeStyle = '#c4821a'; ctx.lineWidth = 1.5;
  [-s*.22, s*.22].forEach(lx => {
    ctx.beginPath(); ctx.ellipse(lx, s*.5, s*.1, s*.13, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff8ee'; ctx.strokeStyle = '#c4821a'; ctx.lineWidth = 1;
    [-s*.05, 0, s*.05].forEach(tx => { ctx.beginPath(); ctx.arc(lx+tx, s*.58, s*.038, 0, Math.PI*2); ctx.fill(); ctx.stroke(); });
    ctx.fillStyle = '#e8a832'; ctx.strokeStyle = '#c4821a'; ctx.lineWidth = 1.5;
  });
  // Tail
  ctx.fillStyle = '#fff8ee'; ctx.strokeStyle = '#c4821a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(-s*.38, s*-.08, s*.15, s*.19, -.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function _drawWeapon(ctx, cell, wx, wy) {
  const s = 22;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.fillStyle = cell.color;
  switch (cell.type) {
    case 'pistol':       _rr(ctx,wx,wy-s*.2,s*.9,s*.4,3); ctx.fill(); ctx.stroke(); ctx.fillStyle='#888'; ctx.fillRect(wx+s*.9,wy-s*.06,s*.3,s*.12); break;
    case 'smg':          _rr(ctx,wx,wy-s*.25,s*1.2,s*.5,3); ctx.fill(); ctx.stroke(); ctx.fillStyle='#888'; ctx.fillRect(wx+s*1.2,wy-s*.06,s*.26,s*.12); break;
    case 'rifle':        _rr(ctx,wx,wy-s*.18,s*1.6,s*.36,3); ctx.fill(); ctx.stroke(); ctx.fillStyle='#888'; ctx.fillRect(wx+s*1.6,wy-s*.05,s*.5,s*.1); break;
    case 'grenade':      ctx.beginPath(); ctx.ellipse(wx+s*.4,wy,s*.4,s*.5,0,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.fillStyle='#888'; ctx.fillRect(wx+s*.28,wy-s*.55,s*.2,s*.16); break;
    case 'knife':
      ctx.save(); ctx.translate(wx+s*.36, wy); ctx.fillStyle='#ccc';
      ctx.beginPath(); ctx.moveTo(s*.7,0); ctx.lineTo(-s*.28,s*.2); ctx.lineTo(-s*.4,s*.12); ctx.lineTo(-s*.28,0); ctx.lineTo(-s*.4,-s*.12); ctx.lineTo(-s*.28,-s*.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#7a3a10'; ctx.fillRect(-s*.4,-s*.16,s*.28,s*.32); ctx.strokeRect(-s*.4,-s*.16,s*.28,s*.32); ctx.restore(); break;
    case 'shotgun':      _rr(ctx,wx,wy-s*.24,s*1.1,s*.48,3); ctx.fill(); ctx.stroke(); ctx.fillStyle='#888'; ctx.fillRect(wx+s*1.1,wy-s*.1,s*.44,s*.1); ctx.fillRect(wx+s*1.1,wy+s*.02,s*.44,s*.1); break;
    case 'laser':        _rr(ctx,wx,wy-s*.18,s*1.4,s*.36,3); ctx.fill(); ctx.stroke(); ctx.fillStyle='rgba(0,255,200,.65)'; ctx.fillRect(wx+s*1.4,wy-s*.07,s*.6,s*.14); ctx.fillStyle='#00ffaa'; ctx.beginPath(); ctx.arc(wx+s*1.4,wy,s*.14,0,Math.PI*2); ctx.fill(); break;
    case 'mortar':
      ctx.save(); ctx.translate(wx+s*.4,wy); ctx.rotate(-.4);
      _rr(ctx,-s*.28,-s*.24,s*.56,s*1.1,4); ctx.fill(); ctx.stroke(); ctx.restore(); break;
    case 'flamethrower': _rr(ctx,wx,wy-s*.28,s*1.0,s*.56,4); ctx.fill(); ctx.stroke(); ctx.fillStyle='rgba(255,100,0,.55)'; ctx.beginPath(); ctx.ellipse(wx+s*1.2,wy,s*.55,s*.24,0,0,Math.PI*2); ctx.fill(); break;
    case 'sniper':       _rr(ctx,wx,wy-s*.14,s*1.8,s*.28,3); ctx.fill(); ctx.stroke(); ctx.fillStyle='#888'; ctx.fillRect(wx+s*1.8,wy-s*.04,s*.7,s*.08); break;
  }
  if ((cell.tier || 1) > 1) {
    const tc = ['','#ffdd00','#ff8800','#ff44aa'][cell.tier] || '#fff';
    ctx.font = 'bold 9px "Fredoka One",cursive';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText('T' + cell.tier, wx, wy - 14);
    ctx.fillStyle = tc; ctx.fillText('T' + cell.tier, wx, wy - 14);
  }
}

// Alias so _drawWeapon and _drawEnemy can share roundRect
function _rr(ctx, x, y, w, h, r) { _roundRect(ctx, x, y, w, h, r); }

function _drawEnemy(ctx, e, ex, ey) {
  const cs = e.size;
  ctx.save(); ctx.translate(ex, ey); ctx.strokeStyle = e.outline || '#333'; ctx.lineWidth = 2;
  switch (e.type) {
    case 'goat':
      ctx.fillStyle=e.color; ctx.beginPath(); ctx.ellipse(0,0,cs*.42,cs*.37,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cs*.34,-cs*.1,cs*.24,cs*.22,-.3,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle='#aa8844'; ctx.lineWidth=2.5; ctx.beginPath(); ctx.moveTo(cs*.3,-cs*.28); ctx.quadraticCurveTo(cs*.2,-cs*.48,cs*.44,-cs*.42); ctx.stroke();
      ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(cs*.4,-cs*.1,cs*.06,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff';  ctx.beginPath(); ctx.arc(cs*.38,-cs*.12,cs*.025,0,Math.PI*2); ctx.fill(); break;
    case 'cactus':
      ctx.fillStyle=e.color;
      ctx.beginPath(); ctx.ellipse(0,0,cs*.2,cs*.45,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-cs*.32,cs*.05,cs*.28,cs*.11,-.2,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cs*.32,cs*.1,cs*.26,cs*.1,.2,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(-cs*.04,-cs*.15,cs*.07,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(cs*.1,-cs*.15,cs*.07,0,Math.PI*2); ctx.fill(); break;
    case 'plant':
      ctx.fillStyle='#66aa22'; ctx.strokeStyle='#335511';
      ctx.beginPath(); ctx.arc(0,-cs*.1,cs*.32,Math.PI,0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle='#335511'; ctx.lineWidth=2.5; ctx.beginPath(); ctx.moveTo(0,cs*.35); ctx.lineTo(0,-cs*.1); ctx.stroke();
      ctx.fillStyle='#eeeecc'; ctx.strokeStyle=e.outline; ctx.lineWidth=2;
      [-.13,.13].forEach(ox=>{ctx.beginPath();ctx.ellipse(cs*ox,-cs*.22,cs*.11,cs*.11,0,0,Math.PI*2);ctx.fill();ctx.stroke();});
      ctx.fillStyle='#222'; [-.1,.14].forEach(ox=>{ctx.beginPath();ctx.arc(cs*ox,-cs*.23,cs*.045,0,Math.PI*2);ctx.fill();}); break;
    case 'mushroom':
      ctx.fillStyle='#ffeecc'; ctx.beginPath(); ctx.ellipse(0,cs*.1,cs*.2,cs*.28,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle=e.color;   ctx.beginPath(); ctx.ellipse(0,-cs*.16,cs*.44,cs*.32,0,Math.PI,0); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#fff'; [[0,-cs*.38],[cs*.24,-cs*.1],[-cs*.24,-cs*.1]].forEach(([sx,sy])=>{ctx.beginPath();ctx.arc(sx,sy,cs*.08,0,Math.PI*2);ctx.fill();});
      ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(-cs*.08,cs*.04,cs*.055,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(cs*.08,cs*.04,cs*.055,0,Math.PI*2); ctx.fill(); break;
    case 'speeder':
      ctx.fillStyle=e.color; ctx.save(); ctx.rotate(-.15);
      ctx.beginPath(); ctx.moveTo(cs*.48,0); ctx.lineTo(-cs*.28,cs*.3); ctx.lineTo(-cs*.12,0); ctx.lineTo(-cs*.28,-cs*.3); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      ctx.fillStyle='#333'; ctx.beginPath(); ctx.arc(0,0,cs*.13,0,Math.PI*2); ctx.fill(); break;
    case 'ghost':
      ctx.fillStyle='rgba(170,187,255,0.88)';
      ctx.beginPath(); ctx.arc(0,-cs*.06,cs*.34,Math.PI,0); ctx.lineTo(cs*.34,cs*.26);
      for(let i=0;i<3;i++){const gx=cs*.34-i*cs*.24;ctx.quadraticCurveTo(gx+cs*.07,cs*.36,gx-cs*.1,cs*.26);}
      ctx.lineTo(-cs*.34,cs*.26); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#334'; ctx.beginPath(); ctx.arc(-cs*.11,-cs*.06,cs*.08,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(cs*.11,-cs*.06,cs*.08,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#555'; _rr(ctx,cs*.1,cs*.06,cs*.32,cs*.12,3); ctx.fill(); ctx.stroke(); break;
    case 'sniper':
      ctx.fillStyle=e.color; ctx.beginPath(); ctx.ellipse(0,-cs*.05,cs*.28,cs*.34,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(-cs*.09,-cs*.1,cs*.07,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(cs*.09,-cs*.1,cs*.07,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#333'; _rr(ctx,-cs*.38,cs*.08,cs*.58,cs*.12,3); ctx.fill(); ctx.stroke(); break;
    case 'rock':
      ctx.fillStyle=e.color; ctx.beginPath(); ctx.arc(0,0,cs*.42,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(-cs*.1,-cs*.15,cs*.19,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(-cs*.13,-cs*.06,cs*.08,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(cs*.11,-cs*.06,cs*.08,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#555'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(-cs*.1,cs*.09); ctx.lineTo(cs*.1,cs*.09); ctx.stroke(); break;
    case 'boss': case 'miniboss': {
      const bg = ctx.createRadialGradient(0,0,cs*.3,0,0,cs*.85);
      bg.addColorStop(0,'rgba(255,50,80,.35)'); bg.addColorStop(1,'rgba(255,0,0,0)');
      ctx.fillStyle=bg; ctx.beginPath(); ctx.arc(0,0,cs*.85,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=e.color; const sides=e.type==='boss'?8:6;
      ctx.beginPath(); for(let i=0;i<sides;i++){const a=i/sides*Math.PI*2-Math.PI/sides;ctx.lineTo(Math.cos(a)*cs*.48,Math.sin(a)*cs*.48);} ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle='rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(0,0,cs*.3,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(-cs*.12,-cs*.06,cs*.1,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(cs*.12,-cs*.06,cs*.1,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#f00'; ctx.beginPath(); ctx.arc(-cs*.12,-cs*.06,cs*.055,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(cs*.12,-cs*.06,cs*.055,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(-cs*.1,cs*.1); ctx.lineTo(-cs*.04,cs*.17); ctx.lineTo(cs*.04,cs*.17); ctx.lineTo(cs*.1,cs*.1); ctx.stroke();
      for(let i=0;i<8;i++){const a=i/8*Math.PI*2+(GD.S.time||0)*.001;ctx.strokeStyle='rgba(255,100,100,.45)';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(Math.cos(a)*cs*.48,Math.sin(a)*cs*.48);ctx.lineTo(Math.cos(a)*cs*.7,Math.sin(a)*cs*.7);ctx.stroke();}
      break; }
  }
  ctx.restore();
}
