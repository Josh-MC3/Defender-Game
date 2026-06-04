// ============================================================
//  grid.js  —  Weapon grid, bench, shop, drag-and-drop,
//               merge logic, sell zone, stat recalc triggers.
//
//  Reads / writes: GD.S  (shared state)
//  Calls into:     GD.calcStats(), GD.renderHUD(),
//                  GD.saveGame(),  GD.sfx,
//                  GD.rebuildActiveWeapons()   (combat.js)
// ============================================================

// ── Shared namespace guard ────────────────────────────────────
window.GD = window.GD || {};

// ── GRID CELL SIZE HELPER ─────────────────────────────────────
GD.getGridCellSize = function () {
  const gp = document.getElementById('grid-panel');
  if (!gp) return 30;
  const w      = gp.getBoundingClientRect().width;
  const pad    = 10;                          // 5 px each side inside #grid-panel
  const gaps   = (GD.GRID_COLS - 1) * 2;    // 2 px gap × (cols − 1)
  return Math.max(20, Math.floor((w - pad - gaps) / GD.GRID_COLS));
};

// ── RENDER GRID (9 × 4) ──────────────────────────────────────
GD.renderGrid = function () {
  const S  = GD.S;
  const gc = document.getElementById('grid-container');
  gc.style.gridTemplateColumns = `repeat(${GD.GRID_COLS},1fr)`;
  gc.innerHTML = '';

  // Build occupancy map so multi-cell weapons only render once
  const occ = {};
  S.grid.forEach((row, r) => row.forEach((cell, c) => {
    if (!cell) return;
    for (let dr = 0; dr < cell.h; dr++)
      for (let dc = 0; dc < cell.w; dc++)
        occ[`${r+dr},${c+dc}`] = cell;
  }));

  for (let r = 0; r < GD.GRID_ROWS; r++) {
    for (let c = 0; c < GD.GRID_COLS; c++) {
      const div  = document.createElement('div');
      div.className    = 'gc';
      div.dataset.r    = r;
      div.dataset.c    = c;
      const item = occ[`${r},${c}`];

      if (item && item.originR === r && item.originC === c) {
        const csz  = GD.getGridCellSize();
        const chipW = item.w * csz - 2;
        const chipH = item.h * csz - 2;
        const chip  = document.createElement('div');
        chip.className  = 'ichip';
        chip.style.cssText = [
          `background:${item.color}`,
          `width:${chipW}px`,
          `height:${chipH}px`,
          `left:0`,
          `top:0`,
          `border-radius:5px`,
          `box-shadow:0 2px 5px rgba(0,0,0,0.25)`,
          `font-size:${Math.max(5, Math.floor(csz * 0.22))}px`,
        ].join(';');
        chip.innerHTML = `
          <span style="font-size:8px;font-family:'Fredoka One',cursive;text-shadow:0 1px 2px rgba(0,0,0,0.5)">${item.name}</span>
          <span style="color:rgba(255,255,255,0.85);font-size:6px">T${item.tier}</span>`;
        chip.draggable = true;
        chip.addEventListener('dragstart', e => {
          S.dragItem   = { ...item };
          S.dragSource = { type: 'grid', r, c };
          e.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('touchstart', ev => GD._touchStart(ev, { ...item }, { type: 'grid', r, c }), { passive: false });
        div.appendChild(chip);
        div.classList.add('occupied');
      }

      div.addEventListener('dragover',  e  => { e.preventDefault(); div.classList.add('dov'); });
      div.addEventListener('dragleave', ()  => div.classList.remove('dov'));
      div.addEventListener('drop',      e  => { e.preventDefault(); div.classList.remove('dov'); GD.dropGrid(+div.dataset.r, +div.dataset.c); });
      gc.appendChild(div);
    }
  }
};

// ── RENDER BENCH (2 × 5 = 10 slots) ─────────────────────────
GD.renderBench = function () {
  const S  = GD.S;
  const br = document.getElementById('bench-container');
  br.innerHTML = '';

  for (let i = 0; i < GD.BENCH_SIZE; i++) {
    const slot  = document.createElement('div');
    slot.className  = 'bslot';
    slot.dataset.i  = i;
    const inner = document.createElement('div');
    inner.className = 'bslot-inner';
    const item  = S.bench[i];

    if (item) {
      slot.style.background = item.color;
      inner.style.cssText   = `color:#fff;cursor:grab;font-family:'Fredoka One',cursive;font-size:7px;`;
      inner.innerHTML = `<span>${item.name}</span><span style="color:rgba(255,255,255,0.75);font-size:5px">T${item.tier}</span>`;
      slot.draggable = true;
      slot.addEventListener('dragstart', e => {
        S.dragItem   = { ...item };
        S.dragSource = { type: 'bench', idx: i };
        e.dataTransfer.effectAllowed = 'move';
      });
      slot.addEventListener('touchstart', ev => GD._touchStart(ev, { ...item }, { type: 'bench', idx: i }), { passive: false });
    } else {
      inner.textContent = '·';
    }

    slot.addEventListener('dragover',  e  => { e.preventDefault(); slot.style.borderColor = '#5de038'; });
    slot.addEventListener('dragleave', ()  => { slot.style.borderColor = ''; });
    slot.addEventListener('drop',      e  => { e.preventDefault(); slot.style.borderColor = ''; GD.dropBench(i); });
    slot.appendChild(inner);
    br.appendChild(slot);
  }
};

// ── SHOP ─────────────────────────────────────────────────────
GD.buildShop = function () {
  const S       = GD.S;
  const tierIdx = Math.min(Math.floor((S.wave - 1) / 3), 3);
  const pool    = GD.TIER_UNLOCK[tierIdx];
  S.shopPool    = [];
  for (let i = 0; i < 3; i++) {
    const k = pool[Math.floor(Math.random() * pool.length)];
    S.shopPool.push({ id: k, ...GD.ITEM_DEFS[k], uid: GD.uid() });
  }
  GD.renderShop();
};

GD.renderShop = function () {
  const S   = GD.S;
  const sc  = document.getElementById('shop-items');
  sc.innerHTML = '';
  const ICON_MAP = {
    pistol:'🔫', smg:'⚡', rifle:'🎯', grenade:'💣', knife:'🔪',
    shotgun:'💥', laser:'⚡', mortar:'🪖', flamethrower:'🔥', sniper:'🎯',
  };
  S.shopPool.forEach(item => {
    const wrap = document.createElement('div');
    wrap.className = 'shop-item-wrap';
    const btn  = document.createElement('div');
    btn.className = 'shop-item';
    if (S.gold < item.cost) btn.classList.add('cant-afford');
    const icon = document.createElement('div');
    icon.className = 'shop-icon';
    icon.style.background = item.color;
    icon.textContent       = ICON_MAP[item.type] || '🔫';
    btn.appendChild(icon);
    btn.addEventListener('click', () => GD.buyItem(item));
    const cost = document.createElement('div');
    cost.className = 'shop-cost';
    cost.innerHTML = `<span class="money-icon">💵</span>${item.cost}`;
    wrap.appendChild(btn);
    wrap.appendChild(cost);
    sc.appendChild(wrap);
  });
};

GD.buyItem = function (item) {
  const S    = GD.S;
  if (S.gold < item.cost) return;
  const slot = S.bench.findIndex(s => s === null);
  if (slot === -1) return;
  S.gold -= item.cost;
  S.bench[slot] = { ...item, uid: GD.uid() };
  GD.sfx.buy();
  GD.renderBench();
  GD.renderShop();
  GD.renderHUD();
  GD.saveGame();
};

// ── SELL ZONE ─────────────────────────────────────────────────
GD.updateSellZone = function (show, item) {
  const sz = document.getElementById('sell-zone');
  const sr = document.getElementById('shop-row');
  if (show && item) {
    const price = Math.floor((item.cost || 10) * (item.tier || 1) * 0.4);
    const sv    = document.getElementById('sell-val');
    if (sv) sv.textContent = price;
    sz.style.display = 'flex';
    sr.style.display = 'none';
  } else {
    sz.style.display = 'none';
    sr.style.display = 'flex';
  }
};

// ── DROP HANDLERS ─────────────────────────────────────────────
GD.dropGrid = function (tr, tc) {
  const S    = GD.S;
  if (!S.dragItem) return;
  const item = S.dragItem;
  // Bounds check
  if (tr + item.h > GD.GRID_ROWS || tc + item.w > GD.GRID_COLS) { S.dragItem = null; return; }
  const target = S.grid[tr][tc];
  // Merge if same id + tier
  if (target && target.id === item.id && target.tier === item.tier && target.uid !== item.uid) {
    GD._mergeItems(item, target);
    GD.sfx.merge();
    S.dragItem = null;
    GD.renderGrid(); GD.renderBench(); GD.calcStats(); GD.saveGame();
    return;
  }
  // Collision check
  for (let dr = 0; dr < item.h; dr++) {
    for (let dc = 0; dc < item.w; dc++) {
      const occ = S.grid[tr + dr][tc + dc];
      if (occ && !(S.dragSource.type === 'grid' && occ.uid === item.uid)) {
        S.dragItem = null;
        return;
      }
    }
  }
  GD._removeFromSource(S.dragSource);
  const placed = { ...item, originR: tr, originC: tc, uid: GD.uid() };
  for (let dr = 0; dr < item.h; dr++)
    for (let dc = 0; dc < item.w; dc++)
      S.grid[tr + dr][tc + dc] = placed;
  S.dragItem = null;
  GD.renderGrid(); GD.renderBench(); GD.calcStats(); GD.saveGame();
  if (S.phase === 'combat') GD.rebuildActiveWeapons();  // combat.js
};

GD.dropBench = function (idx) {
  const S = GD.S;
  if (!S.dragItem) return;
  if (S.bench[idx] !== null) { S.dragItem = null; return; }
  GD._removeFromSource(S.dragSource);
  S.bench[idx] = { ...S.dragItem, uid: GD.uid() };
  S.dragItem   = null;
  GD.renderGrid(); GD.renderBench(); GD.calcStats(); GD.saveGame();
};

GD.dropSell = function () {
  const S = GD.S;
  if (!S.dragItem) return;
  const item  = S.dragItem;
  const price = Math.floor((item.cost || 10) * (item.tier || 1) * 0.4);
  GD._removeFromSource(S.dragSource);
  S.gold += price;
  GD.sfx.sell();
  GD.addFloater(GD.canvas.width * .5, GD.canvas.height * .4, `+${price}💵`, '#ffdd44');
  S.dragItem = null;
  GD.renderGrid(); GD.renderBench(); GD.calcStats(); GD.renderHUD(); GD.saveGame();
  if (S.phase === 'combat') GD.rebuildActiveWeapons();  // combat.js
  GD.updateSellZone(false);
};

// ── INTERNAL HELPERS ─────────────────────────────────────────
GD._removeFromSource = function (src) {
  if (!src) return;
  const S = GD.S;
  if (src.type === 'grid') {
    const cell = S.grid[src.r][src.c];
    if (cell)
      for (let dr = 0; dr < cell.h; dr++)
        for (let dc = 0; dc < cell.w; dc++)
          S.grid[src.r + dr][src.c + dc] = null;
  } else if (src.type === 'bench') {
    S.bench[src.idx] = null;
  }
};

GD._mergeItems = function (a, b) {
  const S    = GD.S;
  GD._removeFromSource(S.dragSource);
  const nt   = Math.min((a.tier || 1) + 1, 4);
  const def  = GD.ITEM_DEFS[a.id];
  const merged = { ...def, id: a.id, tier: nt, w: def.w, h: def.h, color: GD.TIER_COLORS[nt - 1], uid: GD.uid() };
  if (b.originR !== undefined) {
    // Clear old footprint
    for (let dr = 0; dr < b.h; dr++)
      for (let dc = 0; dc < b.w; dc++)
        S.grid[b.originR + dr][b.originC + dc] = null;
    // Place merged item at same origin
    const placed = { ...merged, originR: b.originR, originC: b.originC };
    for (let dr = 0; dr < placed.h && b.originR + dr < GD.GRID_ROWS; dr++)
      for (let dc = 0; dc < placed.w && b.originC + dc < GD.GRID_COLS; dc++)
        S.grid[b.originR + dr][b.originC + dc] = placed;
  }
};

// ── TOUCH DRAG ────────────────────────────────────────────────
let _tGhost = null;

GD._touchStart = function (e, item, src) {
  e.preventDefault();
  const S = GD.S;
  S.touchDragItem   = { ...item };
  S.touchDragSource = src;
  _tGhost = document.createElement('div');
  _tGhost.style.cssText = [
    'position:fixed', 'z-index:9999', 'pointer-events:none',
    `background:${item.color}`, 'color:#fff', 'font-size:12px',
    'padding:8px 14px', 'border-radius:14px',
    'border:2px solid rgba(255,255,255,0.65)', 'opacity:0.93',
    "font-family:'Fredoka One',cursive", 'white-space:nowrap',
    'box-shadow:0 6px 16px rgba(0,0,0,0.35)', 'transform:scale(1.1)',
  ].join(';');
  _tGhost.textContent = `${item.name} T${item.tier}`;
  document.body.appendChild(_tGhost);
  GD._moveTouchGhost(e.touches[0]);
  GD.updateSellZone(true, item);
};

GD._moveTouchGhost = function (touch) {
  if (!_tGhost) return;
  _tGhost.style.left = (touch.clientX + 14) + 'px';
  _tGhost.style.top  = (touch.clientY + 14) + 'px';
};

document.addEventListener('touchmove', e => {
  if (GD.S.touchDragItem) GD._moveTouchGhost(e.touches[0]);
}, { passive: true });

document.addEventListener('touchend', e => {
  const S = GD.S;
  if (!S.touchDragItem) return;
  if (_tGhost) { _tGhost.remove(); _tGhost = null; }
  GD.updateSellZone(false);
  const touch = e.changedTouches[0];
  const el    = document.elementFromPoint(touch.clientX, touch.clientY);
  if (el) {
    const gc  = el.closest('.gc');
    const bs  = el.closest('.bslot');
    const sv  = el.closest('#sell-zone');
    if (sv)      { S.dragItem = S.touchDragItem; S.dragSource = S.touchDragSource; GD.dropSell(); }
    else if (gc) { S.dragItem = S.touchDragItem; S.dragSource = S.touchDragSource; GD.dropGrid(+gc.dataset.r, +gc.dataset.c); }
    else if (bs) { S.dragItem = S.touchDragItem; S.dragSource = S.touchDragSource; GD.dropBench(+bs.dataset.i); }
  }
  S.touchDragItem   = null;
  S.touchDragSource = null;
}, { passive: true });

// Show sell zone on mouse drag start; hide on drag end
document.addEventListener('dragstart', () => {
  if (GD.S.dragItem) GD.updateSellZone(true, GD.S.dragItem);
});
document.addEventListener('dragend', () => {
  GD.updateSellZone(false);
  GD.S.dragItem   = null;
  GD.S.dragSource = null;
});
