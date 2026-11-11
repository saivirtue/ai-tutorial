// 餘燼地城 —— 俯視角地城動作 RPG（純 Canvas，無外部資源）
// 結構：工具 → 地城生成 → 物品 → 玩家 → 敵人 → 戰鬥 → 繪圖 → 介面 → 主迴圈
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const dark = document.createElement('canvas'), dctx = dark.getContext('2d');
  const mini = $('mini'), mctx = mini.getContext('2d');

  const T = 40, MW = 56, MH = 40;
  const SAVE_KEY = 'ember-depths-save-v1';
  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => Math.floor(rand(a, b + 1));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

  // ---------- 音效 ----------
  let actx = null, muted = false;
  function sfx(freq, dur = 0.08, type = 'square', vol = 0.05, slide = 0) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
    } catch (e) { /* 沒有音效也能玩 */ }
  }

  // ---------- 狀態 ----------
  let state = 'menu', paused = false, time = 0;
  let map, explored, flow, rooms, stairs, floorCanvas, pal;
  let enemies = [], shots = [], drops = [], props = [], parts = [], texts = [], lights = [];
  let p = null, boss = null, shake = 0, miniT = 0, flowT = 0, itemId = 1, fullMsgT = 0;
  let W = 0, H = 0, S = 1, dpr = 1, camX = 0, camY = 0;

  const keys = {}, mouse = { x: 0, y: 0, l: false, r: false };
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  let touchMode = false, atkHeld = false;

  // ---------- 地城生成 ----------
  const PALS = [
    { f: [58, 52, 66], w: [92, 80, 104], name: '灰燼迴廊' },
    { f: [44, 62, 58], w: [70, 104, 92], name: '苔蘚水窖' },
    { f: [70, 50, 44], w: [120, 78, 60], name: '熔岩礦坑' },
    { f: [46, 52, 78], w: [76, 88, 132], name: '霜封墓穴' },
    { f: [62, 44, 70], w: [104, 66, 120], name: '虛空深淵' },
  ];
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= MW || ty >= MH || map[ty * MW + tx] === 1;
  function circleHits(x, y, r) {
    const x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T), y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r) / T);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!solid(tx, ty)) continue;
      const cx = clamp(x, tx * T, tx * T + T), cy = clamp(y, ty * T, ty * T + T);
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
    return false;
  }
  function moveEnt(e, dx, dy) {
    let hit = false;
    if (!circleHits(e.x + dx, e.y, e.r)) e.x += dx; else hit = true;
    if (!circleHits(e.x, e.y + dy, e.r)) e.y += dy; else hit = true;
    return hit;
  }
  function los(a, b) {
    const d = dist(a, b), n = Math.ceil(d / 12);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (solid(Math.floor((a.x + (b.x - a.x) * t) / T), Math.floor((a.y + (b.y - a.y) * t) / T))) return false;
    }
    return true;
  }
  function bfs(sx, sy, out) {
    out.fill(-1);
    const q = new Int32Array(MW * MH); let h = 0, t = 0;
    out[sy * MW + sx] = 0; q[t++] = sy * MW + sx;
    while (h < t) {
      const c = q[h++], cx = c % MW, cy = (c / MW) | 0, d = out[c] + 1;
      if (cx > 0 && map[c - 1] === 0 && out[c - 1] < 0) { out[c - 1] = d; q[t++] = c - 1; }
      if (cx < MW - 1 && map[c + 1] === 0 && out[c + 1] < 0) { out[c + 1] = d; q[t++] = c + 1; }
      if (cy > 0 && map[c - MW] === 0 && out[c - MW] < 0) { out[c - MW] = d; q[t++] = c - MW; }
      if (cy < MH - 1 && map[c + MW] === 0 && out[c + MW] < 0) { out[c + MW] = d; q[t++] = c + MW; }
    }
  }
  const isBossFloor = f => f % 5 === 0;

  function genFloor() {
    const f = p.floor;
    map = new Uint8Array(MW * MH).fill(1);
    explored = new Uint8Array(MW * MH);
    flow = new Int16Array(MW * MH);
    rooms = []; enemies = []; shots = []; drops = []; props = []; parts = []; texts = []; boss = null;
    pal = PALS[Math.floor((f - 1) / 5) % PALS.length];

    for (let i = 0; i < 200 && rooms.length < 11; i++) {
      const w = irand(6, 11), h = irand(5, 9), x = irand(2, MW - w - 3), y = irand(2, MH - h - 3);
      if (rooms.some(r => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
      rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
    }
    for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map[y * MW + x] = 0;
    const carve = (x, y) => { for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const a = x + i, b = y + j; if (a > 0 && b > 0 && a < MW - 1 && b < MH - 1) map[b * MW + a] = 0; } };
    const link = (a, b) => {
      let x = a.cx, y = a.cy; const hf = Math.random() < 0.5;
      const hx = () => { while (x !== b.cx) { carve(x, y); x += Math.sign(b.cx - x); } };
      const vy = () => { while (y !== b.cy) { carve(x, y); y += Math.sign(b.cy - y); } };
      if (hf) { hx(); vy(); } else { vy(); hx(); } carve(x, y);
    };
    for (let i = 1; i < rooms.length; i++) {
      let best = 0, bd = 1e9;
      for (let j = 0; j < i; j++) { const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy); if (d < bd) { bd = d; best = j; } }
      link(rooms[i], rooms[best]);
    }
    for (let i = 0; i < 2; i++) { const a = pick(rooms), b = pick(rooms); if (a !== b) link(a, b); }

    const start = rooms[0];
    bfs(start.cx, start.cy, flow);
    let far = rooms[1] || start, fd = -1;
    for (const r of rooms) { const d = flow[r.cy * MW + r.cx]; if (d > fd) { fd = d; far = r; } }
    stairs = { x: far.cx * T + T / 2, y: far.cy * T + T / 2, open: !isBossFloor(f) };
    p.x = start.cx * T + T / 2; p.y = start.cy * T + T / 2;

    const freeSpot = (r, rad) => {
      for (let i = 0; i < 30; i++) {
        const x = (r.x + rand(0.6, r.w - 0.6)) * T, y = (r.y + rand(0.6, r.h - 0.6)) * T;
        if (!circleHits(x, y, rad)) return { x, y };
      }
      return { x: r.cx * T + T / 2, y: r.cy * T + T / 2 };
    };
    for (const r of rooms) {
      // 四角火盆（光源）
      r.lights = [[r.x + 0.5, r.y + 0.5], [r.x + r.w - 0.5, r.y + r.h - 0.5]].map(c => ({ x: c[0] * T, y: c[1] * T }));
      if (r === start) continue;
      if (r === far && isBossFloor(f)) { spawnEnemy('boss', far.cx * T + T / 2, far.cy * T + T / 2 - 60); continue; }
      const n = Math.round(2 + r.w * r.h / 18 + Math.min(4, f * 0.5));
      for (let i = 0; i < n; i++) {
        const s = freeSpot(r, 18), elite = Math.random() < (f >= 2 ? 0.07 : 0.03);
        spawnEnemy(rollType(f), s.x, s.y, elite);
      }
      if (Math.random() < 0.4) { const s = freeSpot(r, 16); props.push({ kind: 'chest', x: s.x, y: s.y, r: 15, open: false }); }
      const nb = irand(0, 3);
      for (let i = 0; i < nb; i++) { const s = freeSpot(r, 12); props.push({ kind: 'barrel', x: s.x, y: s.y, r: 12 }); }
    }
    prerender();
    explore(); miniT = 0; flowT = 0;
    banner(isBossFloor(f) ? `第 ${f} 層` : `第 ${f} 層`, isBossFloor(f) ? '⚠️ 守關者就在這一層' : pal.name);
    save();
  }

  function prerender() {
    floorCanvas = document.createElement('canvas');
    floorCanvas.width = MW * T; floorCanvas.height = MH * T;
    const c = floorCanvas.getContext('2d');
    c.fillStyle = '#05040a'; c.fillRect(0, 0, MW * T, MH * T);
    const hash = (x, y) => { let n = x * 374761393 + y * 668265263; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967295; };
    const col = (a, k) => `rgb(${a[0] * k | 0},${a[1] * k | 0},${a[2] * k | 0})`;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const X = x * T, Y = y * T, h = hash(x, y);
      if (map[y * MW + x] === 0) {
        c.fillStyle = col(pal.f, 0.85 + h * 0.3); c.fillRect(X, Y, T, T);
        c.strokeStyle = 'rgba(0,0,0,.25)'; c.strokeRect(X + 0.5, Y + 0.5, T - 1, T - 1);
        if (h > 0.86) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(X + h * 20, Y + 10 + h * 10, 9, 3); }
      } else {
        let near = false;
        for (let j = -1; j <= 1 && !near; j++) for (let i = -1; i <= 1; i++) if (!solid(x + i, y + j)) { near = true; break; }
        if (!near) continue;
        c.fillStyle = col(pal.w, 0.55 + h * 0.15); c.fillRect(X, Y, T, T);
        c.fillStyle = col(pal.w, 0.4);
        c.fillRect(X, Y + 12, T, 2); c.fillRect(X, Y + 26, T, 2);
        c.fillRect(X + 12 + h * 10, Y, 2, 12); c.fillRect(X + 4 + h * 20, Y + 14, 2, 12); c.fillRect(X + 18 + h * 8, Y + 28, 2, 12);
        if (!solid(x, y + 1)) { c.fillStyle = col(pal.w, 1.05); c.fillRect(X, Y + T - 7, T, 7); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(X, Y + T, T, 6); }
      }
    }
  }

  function explore() {
    const px = Math.floor(p.x / T), py = Math.floor(p.y / T);
    for (let y = py - 7; y <= py + 7; y++) for (let x = px - 9; x <= px + 9; x++)
      if (x >= 0 && y >= 0 && x < MW && y < MH) explored[y * MW + x] = 1;
  }

  // ---------- 物品 ----------
  const RAR = [{ n: '普通', c: '#d8d8d8' }, { n: '精良', c: '#6aa8ff' }, { n: '稀有', c: '#ffd84a' }, { n: '傳說', c: '#ff8a3a' }];
  const SLOTS = { weapon: { n: '武器', i: '🗡️' }, armor: { n: '護甲', i: '🛡️' }, ring: { n: '飾品', i: '💍' } };
  const STAT = {
    dmg: ['攻擊', 0], hp: ['生命', 0], mp: ['魔力', 0], armor: ['護甲', 0], crit: ['暴擊', 1], aspd: ['攻速', 1],
    move: ['移速', 1], ls: ['吸血', 1], hpr: ['生命回復/秒', 0], mpr: ['魔力回復/秒', 0],
  };
  const AFF = {
    hp: l => 8 + l * 4, mp: l => 5 + l * 2, dmg: l => 1 + l * 0.8, armor: l => 3 + l * 1.5,
    crit: l => 3 + Math.min(l, 10) * 0.4, aspd: l => 5 + Math.min(l, 10) * 0.6, move: l => 4 + Math.min(l, 8) * 0.4,
    ls: l => 1 + Math.min(l, 8) * 0.25, hpr: l => 0.5 + l * 0.25, mpr: l => 0.5 + l * 0.15,
  };
  const BASES = { weapon: ['短劍', '長劍', '戰斧', '釘錘', '彎刀'], armor: ['皮甲', '鎖甲', '鱗甲', '戰袍'], ring: ['指環', '護符', '徽記'] };
  const LEG = ['餘燼', '霜牙', '暮星', '雷鳴', '深淵', '晨曦'];
  const fmt = (k, v) => `${STAT[k][0]} ${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)}${STAT[k][1] ? '%' : ''}`;

  function rollRarity(min = 0) {
    const r = Math.random(), bonus = Math.min(0.1, p.floor * 0.004);
    let q = r < 0.02 + bonus * 0.5 ? 3 : r < 0.12 + bonus ? 2 : r < 0.42 + bonus ? 1 : 0;
    return Math.max(q, min);
  }
  function makeItem(lvl, rarity, slot) {
    slot = slot || pick(['weapon', 'armor', 'ring']);
    const it = { id: itemId++, slot, rarity, lvl, base: {}, aff: [] };
    const q = (1 + rarity * 0.15) * rand(0.9, 1.1);
    if (slot === 'weapon') it.base.dmg = Math.round((4 + lvl * 2.2) * q);
    if (slot === 'armor') { it.base.armor = Math.round((5 + lvl * 3) * q); it.base.hp = Math.round((6 + lvl * 3) * q); }
    const pool = Object.keys(AFF).filter(k => !(slot === 'weapon' && k === 'armor'));
    const n = rarity + (slot === 'ring' ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      let v = AFF[k](lvl) * rand(0.8, 1.2) * (rarity === 3 ? 1.25 : 1);
      v = (k === 'hpr' || k === 'mpr' || k === 'ls') ? Math.round(v * 10) / 10 : Math.round(v);
      it.aff.push({ k, v });
    }
    const b = pick(BASES[slot]);
    it.name = rarity === 3 ? `${pick(LEG)}之${b}` : rarity === 0 ? b : `${RAR[rarity].n}的${b}`;
    it.val = Math.round((5 + lvl * 3) * Math.pow(1 + rarity, 1.5));
    return it;
  }
  function calcStats(eq) {
    eq = eq || p.equip; const L = p.lvl;
    const s = { dmg: 10 + 2 * (L - 1), hp: 120 + 12 * (L - 1), mp: 50 + 5 * (L - 1), armor: 0, crit: 5, aspd: 0, move: 0, ls: 0, hpr: 1, mpr: 2 };
    for (const k in eq) { const it = eq[k]; if (!it) continue; for (const b in it.base) s[b] += it.base[b]; for (const a of it.aff) s[a.k] += a.v; }
    s.crit = Math.min(s.crit, 75); s.aspd = Math.min(s.aspd, 100); s.move = Math.min(s.move, 50); s.ls = Math.min(s.ls, 15);
    return s;
  }
  const power = s => s.dmg * (1 + s.crit / 100) * (1 + s.aspd / 100) * 4 + s.hp * (1 + s.armor / 100) * 0.5 + s.mp * 0.2 + s.move + s.ls * 6 + s.hpr * 4 + s.mpr * 4;
  function refresh() { p.st = calcStats(); p.hp = Math.min(p.hp, p.st.hp); p.mp = Math.min(p.mp, p.st.mp); }

  // ---------- 玩家 ----------
  const SK = {
    fire: { n: '火球', mp: 12, cd: 0.7, d: l => `爆炸造成 ${150 + l * 30}% 攻擊的範圍傷害` },
    whirl: { n: '旋風斬', mp: 15, cd: 5, d: l => `旋轉 1.2 秒，每次命中 ${60 + l * 12}% 攻擊` },
    nova: { n: '冰霜新星', mp: 20, cd: 8, d: l => `${100 + l * 25}% 攻擊，並冰凍 ${(1.5 + l * 0.3).toFixed(1)} 秒` },
    dash: { n: '閃避', mp: 0, cd: 2.2 },
  };
  function newPlayer() {
    p = {
      x: 0, y: 0, r: 13, lvl: 1, xp: 0, gold: 0, floor: 1, best: 1, hpPot: 3, mpPot: 2, sp: 0,
      skl: { fire: 1, whirl: 1, nova: 1 }, equip: { weapon: makeItemRaw('weapon'), armor: null, ring: null }, inv: [],
    };
    resetRuntime(); refresh(); p.hp = p.st.hp; p.mp = p.st.mp;
  }
  function makeItemRaw(slot) { const it = { id: itemId++, slot, rarity: 0, lvl: 1, base: { dmg: 5 }, aff: [], name: '生鏽的短劍', val: 3 }; return it; }
  function resetRuntime() {
    Object.assign(p, { aim: 0, atkCd: 0, slashT: 0, slashA: 0, whirlT: 0, whirlTick: 0, dashT: 0, dashX: 0, dashY: 0, inv_t: 0, potCd: 0, hurtT: 0, walk: 0, cd: { fire: 0, whirl: 0, nova: 0, dash: 0 } });
  }
  const xpNeed = l => Math.round(40 * Math.pow(l, 1.7));
  function gainXp(v) {
    p.xp += v;
    while (p.xp >= xpNeed(p.lvl)) {
      p.xp -= xpNeed(p.lvl); p.lvl++; p.sp++; refresh(); p.hp = p.st.hp; p.mp = p.st.mp;
      floatText(p.x, p.y - 30, '升級！', '#ffcf6b', 22);
      burst(p.x, p.y, '#ffcf6b', 30, 220); sfx(520, 0.25, 'triangle', 0.08, 500);
    }
  }
  function save() {
    if (!p) return;
    const o = {}; for (const k of ['lvl', 'xp', 'gold', 'floor', 'best', 'hpPot', 'mpPot', 'sp', 'skl', 'equip', 'inv']) o[k] = p[k];
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(o)); } catch (e) { /* 無痕模式存不了就算了 */ }
  }
  function load() {
    try {
      const o = JSON.parse(localStorage.getItem(SAVE_KEY)); if (!o || !o.lvl) return false;
      p = Object.assign({ x: 0, y: 0, r: 13 }, o); resetRuntime();
      for (const it of [...p.inv, ...Object.values(p.equip)]) if (it) itemId = Math.max(itemId, it.id + 1);
      refresh(); p.hp = p.st.hp; p.mp = p.st.mp; return true;
    } catch (e) { return false; }
  }
  const hasSave = () => { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } };

  // ---------- 敵人 ----------
  const ET = {
    slime: { n: '史萊姆', hp: 30, spd: 72, dmg: 8, r: 13, xp: 8 },
    bat: { n: '洞穴蝠', hp: 16, spd: 150, dmg: 5, r: 10, xp: 7 },
    archer: { n: '骸骨射手', hp: 22, spd: 85, dmg: 9, r: 12, xp: 11, ranged: 1 },
    brute: { n: '巨角獸', hp: 95, spd: 58, dmg: 18, r: 18, xp: 22, charger: 1 },
    shaman: { n: '咒術師', hp: 40, spd: 62, dmg: 10, r: 13, xp: 18, ranged: 1 },
    boss: { n: '守關者', hp: 900, spd: 72, dmg: 20, r: 34, xp: 300, charger: 1 },
  };
  const BOSSN = ['灰燼守衛', '沼澤之母', '熔核巨像', '霜冠亡王', '虛空之眼'];
  function rollType(f) {
    const w = [['slime', 5], ['bat', 3]];
    if (f >= 2) w.push(['archer', 3]); if (f >= 3) w.push(['brute', 2]); if (f >= 4) w.push(['shaman', 2]);
    let t = Math.random() * w.reduce((s, x) => s + x[1], 0);
    for (const x of w) { if ((t -= x[1]) < 0) return x[0]; }
    return 'slime';
  }
  function spawnEnemy(type, x, y, elite) {
    const d = ET[type], f = p.floor, hs = 1 + 0.28 * (f - 1), ds = 1 + 0.16 * (f - 1);
    const e = {
      type, x, y, r: d.r * (elite ? 1.3 : 1), hp: d.hp * hs * (elite ? 3.2 : 1), dmg: d.dmg * ds * (elite ? 1.4 : 1),
      spd: d.spd * rand(0.9, 1.1), xp: d.xp * (1 + 0.2 * (f - 1)) * (elite ? 4 : 1), elite: !!elite,
      awake: false, atkCd: rand(0, 1), shotCd: rand(1, 2.5), flash: 0, slow: 0, freeze: 0, kx: 0, ky: 0, ph: rand(0, 6.28), ch: null, chCd: rand(2, 4),
      face: 0, act: 2.5, volley: 0, volT: 0,
    };
    e.maxHp = e.hp;
    if (type === 'boss') { e.name = BOSSN[(Math.floor(f / 5) - 1) % BOSSN.length]; boss = e; }
    enemies.push(e); return e;
  }
  function enemyShot(e, ang, spd, dmg, col, r = 6) {
    shots.push({ x: e.x + Math.cos(ang) * e.r, y: e.y + Math.sin(ang) * e.r, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r, dmg, from: 'e', life: 4, col });
  }
  function updateEnemy(e, dt) {
    e.flash -= dt; e.atkCd -= dt; e.ph += dt * 6;
    if (e.kx || e.ky) { moveEnt(e, e.kx * dt, e.ky * dt); e.kx *= Math.pow(0.002, dt); e.ky *= Math.pow(0.002, dt); if (Math.abs(e.kx) + Math.abs(e.ky) < 5) e.kx = e.ky = 0; }
    if (e.freeze > 0) { e.freeze -= dt; return; }
    const sm = e.slow > 0 ? 0.45 : 1; e.slow -= dt;
    const d = dist(e, p);
    if (!e.awake) { if (d < 440 && los(e, p)) { e.awake = true; if (e === boss) sfx(90, 0.6, 'sawtooth', 0.08, -40); } else return; }
    const see = d < 700 && los(e, p);
    let ax = 0, ay = 0;
    if (see) { ax = (p.x - e.x) / (d || 1); ay = (p.y - e.y) / (d || 1); }
    else {
      const tx = Math.floor(e.x / T), ty = Math.floor(e.y / T); let bd = flow[ty * MW + tx], bx = 0, by = 0;
      if (bd < 0) bd = 1e9;
      for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const v = solid(tx + i, ty + j) ? -1 : flow[(ty + j) * MW + tx + i];
        if (v >= 0 && v < bd) { bd = v; bx = i; by = j; }
      }
      if (bx || by) { const gx = (tx + bx + 0.5) * T - e.x, gy = (ty + by + 0.5) * T - e.y, g = Math.hypot(gx, gy) || 1; ax = gx / g; ay = gy / g; }
    }
    if (ax || ay) e.face = Math.atan2(ay, ax);
    const def = ET[e.type]; let spd = e.spd * sm;

    // 衝撞（巨角獸、守關者）
    if (e.ch) {
      e.ch.t -= dt;
      if (e.ch.wind) { if (e.ch.t <= 0) { e.ch.wind = false; e.ch.t = 0.55; sfx(140, 0.2, 'sawtooth', 0.06, -60); } return; }
      const hit = moveEnt(e, Math.cos(e.ch.a) * 430 * dt, Math.sin(e.ch.a) * 430 * dt);
      if (d < e.r + p.r + 4 && !e.ch.done) { e.ch.done = true; hurtPlayer(e.dmg * 1.6); }
      if (hit || e.ch.t <= 0) { e.ch = null; if (hit) shake = Math.max(shake, 5); }
      return;
    }
    const startCharge = () => { e.ch = { wind: true, t: 0.65, a: Math.atan2(p.y - e.y, p.x - e.x) }; };

    if (e.type === 'boss') { bossAI(e, dt, d, see, startCharge); }
    else if (def.charger) { e.chCd -= dt; if (see && d < 280 && d > 70 && e.chCd <= 0) { e.chCd = rand(3.5, 5); startCharge(); return; } }

    if (def.ranged) {
      e.shotCd -= dt;
      if (see) {
        if (d < 170) { ax = -ax; ay = -ay; } else if (d < 300) { const s = Math.sin(e.ph * 0.15) > 0 ? 1 : -1; [ax, ay] = [-ay * s, ax * s]; spd *= 0.6; }
        if (e.shotCd <= 0 && d < 460) {
          const a = Math.atan2(p.y - e.y, p.x - e.x);
          if (e.type === 'archer') { enemyShot(e, a, 290, e.dmg, '#e8e2c8', 5); e.shotCd = rand(1.6, 2.4); sfx(700, 0.05, 'triangle', 0.03, -300); }
          else { for (const o of [-0.3, 0, 0.3]) enemyShot(e, a + o, 150, e.dmg, '#c56cff', 7); e.shotCd = rand(2.6, 3.4); sfx(300, 0.15, 'sine', 0.04, 200); }
        }
      }
    }
    if (e.type === 'bat') { const w = Math.sin(e.ph * 0.9) * 0.9;[ax, ay] = [ax * Math.cos(w) - ay * Math.sin(w), ax * Math.sin(w) + ay * Math.cos(w)]; }
    if (d > e.r + p.r - 2 || def.ranged) moveEnt(e, ax * spd * dt, ay * spd * dt);
    if (d < e.r + p.r + 6 && e.atkCd <= 0) { e.atkCd = 1; hurtPlayer(e.dmg); }
  }
  function bossAI(e, dt, d, see, startCharge) {
    const rage = e.hp < e.maxHp * 0.5;
    if (e.volley > 0) {
      e.volT -= dt;
      if (e.volT <= 0) { e.volT = 0.22; e.volley--; const a = Math.atan2(p.y - e.y, p.x - e.x); for (const o of [-0.22, 0, 0.22]) enemyShot(e, a + o, 300, e.dmg * 0.7, '#ff9a3a', 7); sfx(420, 0.06, 'square', 0.04); }
    }
    e.act -= dt;
    if (e.act > 0 || !see) return;
    e.act = rage ? 1.7 : 2.5;
    const r = Math.random();
    if (r < 0.3) { const n = rage ? 20 : 14, o = rand(0, 6.28); for (let i = 0; i < n; i++) enemyShot(e, o + i / n * 6.283, 175, e.dmg * 0.7, '#ff5a4a', 8); sfx(180, 0.3, 'sawtooth', 0.06, 200); shake = 6; }
    else if (r < 0.55) { e.volley = rage ? 5 : 3; e.volT = 0; }
    else if (r < 0.75 && enemies.length < 10) { for (let i = 0; i < 3; i++) { const a = rand(0, 6.28); const m = spawnEnemy(p.floor > 5 ? 'bat' : 'slime', e.x + Math.cos(a) * 60, e.y + Math.sin(a) * 60); m.awake = true; m.xp = 0; burst(m.x, m.y, '#a6f', 8, 100); } sfx(260, 0.3, 'sine', 0.05, -100); }
    else if (d > 90) startCharge();
  }

  // ---------- 戰鬥 ----------
  function floatText(x, y, s, c = '#fff', size = 15) { texts.push({ x: x + rand(-8, 8), y, s, c, size, t: 0.9 }); }
  function burst(x, y, c, n, spd, life = 0.5) { for (let i = 0; i < n; i++) { const a = rand(0, 6.283), v = rand(spd * 0.3, spd); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c, t: rand(life * 0.5, life), r: rand(1.5, 3.5) }); } }

  function hitEnemy(e, mult, kb = 120, src) {
    if (e.dead) return;
    let dmg = p.st.dmg * mult * rand(0.88, 1.12); const crit = Math.random() * 100 < p.st.crit;
    if (crit) dmg *= 2;
    dmg = Math.max(1, Math.round(dmg));
    e.hp -= dmg; e.flash = 0.1; e.awake = true;
    const o = src || p, a = Math.atan2(e.y - o.y, e.x - o.x), k = e.type === 'boss' ? 0.1 : e.type === 'brute' ? 0.4 : 1;
    e.kx += Math.cos(a) * kb * k * 3; e.ky += Math.sin(a) * kb * k * 3;
    floatText(e.x, e.y - e.r - 6, crit ? dmg + '!' : '' + dmg, crit ? '#ffd84a' : '#fff', crit ? 20 : 14);
    if (p.st.ls > 0) p.hp = Math.min(p.st.hp, p.hp + dmg * p.st.ls / 100);
    if (e.hp <= 0) killEnemy(e);
  }
  function killEnemy(e) {
    e.dead = true; gainXp(Math.round(e.xp)); sfx(160, 0.12, 'square', 0.05, -100);
    burst(e.x, e.y, e.type === 'slime' ? '#7d6' : e.type === 'bat' ? '#a7c' : '#ccc', e.elite ? 24 : 12, 180);
    const f = p.floor;
    if (e.type === 'boss') {
      boss = null; stairs.open = true; shake = 14; burst(e.x, e.y, '#ffcf6b', 80, 320, 1); sfx(80, 0.8, 'sawtooth', 0.09, 300);
      for (let i = 0; i < 3; i++) dropItem(e.x + rand(-50, 50), e.y + rand(-50, 50), makeItem(f, rollRarity(i === 0 ? 3 : 2)));
      for (let i = 0; i < 10; i++) dropGold(e.x, e.y, irand(8, 16) * (1 + f * 0.25));
      drops.push(mk('hp', e.x - 20, e.y)); drops.push(mk('mp', e.x + 20, e.y));
      banner('守關者倒下', '樓梯出現了');
      for (const o of enemies) if (o !== e && !o.dead) { o.hp = 0; o.dead = true; burst(o.x, o.y, '#a6f', 10, 150); }
      return;
    }
    if (e.xp === 0) return;
    if (Math.random() < 0.7) dropGold(e.x, e.y, irand(2, 6) * (1 + f * 0.25) * (e.elite ? 4 : 1));
    const r = Math.random();
    if (r < 0.07) drops.push(mk('hp', e.x, e.y)); else if (r < 0.11) drops.push(mk('mp', e.x, e.y));
    if (e.elite || Math.random() < 0.09) dropItem(e.x, e.y, makeItem(f, rollRarity(e.elite ? 1 : 0)));
  }
  const mk = (kind, x, y, extra) => Object.assign({ kind, x: x + rand(-14, 14), y: y + rand(-14, 14), t: 0 }, extra);
  function dropGold(x, y, v) { drops.push(mk('gold', x, y, { v: Math.max(1, Math.round(v)) })); }
  function dropItem(x, y, it) { drops.push(mk('item', x, y, { it })); if (it.rarity >= 2) sfx(880, 0.3, 'triangle', 0.06, 400); }

  function hurtPlayer(d) {
    if (p.inv_t > 0 || p.dashT > 0 || state !== 'play') return;
    d = Math.max(1, Math.round(d * 100 / (100 + p.st.armor) * rand(0.9, 1.1)));
    p.hp -= d; p.hurtT = 0.25; p.inv_t = 0.2; shake = Math.max(shake, 5);
    floatText(p.x, p.y - 26, '-' + d, '#ff6a6a', 16); sfx(110, 0.12, 'sawtooth', 0.07, -40);
    if (p.hp <= 0) die();
  }
  function die() {
    p.hp = 0; state = 'dead';
    const lost = Math.floor(p.gold * 0.3); p.gold -= lost;
    $('deadTxt').innerHTML = `你倒在第 ${p.floor} 層（最深紀錄：第 ${p.best} 層）。<br>掉了 ${lost} 枚金幣，裝備和等級都還在。`;
    $('dead').classList.add('on'); sfx(200, 0.7, 'sawtooth', 0.08, -170);
    save();
  }

  function aimAngle() {
    if (!touchMode) return Math.atan2(mouse.y / S + camY - p.y, mouse.x / S + camX - p.x);
    let best = null, bd = 380;
    for (const e of enemies) { const d = dist(e, p); if (d < bd && e.awake && los(p, e)) { bd = d; best = e; } }
    if (best) return Math.atan2(best.y - p.y, best.x - p.x);
    if (bd === 380) for (const o of props) { if (o.kind === 'barrel' && dist(o, p) < 80) return Math.atan2(o.y - p.y, o.x - p.x); }
    return p.aim;
  }
  function attack() {
    if (p.atkCd > 0 || p.whirlT > 0) return;
    p.aim = aimAngle(); p.atkCd = 0.42 / (1 + p.st.aspd / 100); p.slashT = 0.16; p.slashA = p.aim;
    sfx(330, 0.06, 'triangle', 0.04, -150);
    const range = 66;
    for (const e of enemies) {
      const d = dist(e, p); if (d > range + e.r) continue;
      if (d < e.r + 14 || Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), p.aim)) < 1.05) hitEnemy(e, 1, 110);
    }
    for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, p) < range + o.r && Math.abs(angDiff(Math.atan2(o.y - p.y, o.x - p.x), p.aim)) < 1.2) breakBarrel(o);
  }
  function breakBarrel(o) {
    o.dead = true; burst(o.x, o.y, '#a87242', 10, 150); sfx(220, 0.08, 'square', 0.04, -100);
    const r = Math.random();
    if (r < 0.55) dropGold(o.x, o.y, irand(1, 5) * (1 + p.floor * 0.25)); else if (r < 0.63) drops.push(mk('hp', o.x, o.y)); else if (r < 0.68) drops.push(mk('mp', o.x, o.y));
  }
  function cast(k) {
    if (state !== 'play' || paused) return;
    if (k === 'atk') return attack();
    if (k === 'hp' || k === 'mpp') return potion(k);
    const s = SK[k]; if (p.cd[k] > 0) return;
    if (p.mp < s.mp) { floatText(p.x, p.y - 30, '魔力不足', '#6bf', 13); return; }
    p.mp -= s.mp; p.cd[k] = s.cd;
    if (k === 'fire') {
      const a = p.aim = aimAngle();
      shots.push({ x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, r: 8, from: 'p', life: 1.4, col: '#ff8a2a', fire: true });
      sfx(240, 0.2, 'sawtooth', 0.05, 300);
    } else if (k === 'whirl') { p.whirlT = 1.2; p.whirlTick = 0; }
    else if (k === 'nova') {
      const l = p.skl.nova, R = 175;
      for (const e of enemies) if (dist(e, p) < R + e.r) { e.freeze = Math.max(e.freeze, (1.5 + l * 0.3) * (e.type === 'boss' ? 0.35 : 1)); e.slow = e.freeze + 2; hitEnemy(e, 1 + l * 0.25, 60); }
      for (let i = 0; i < 50; i++) { const a = i / 50 * 6.283; parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, c: '#aef', t: 0.45, r: 3 }); }
      shots = shots.filter(s => !(s.from === 'e' && dist(s, p) < R));
      sfx(900, 0.35, 'sine', 0.07, -700); shake = 4;
    } else if (k === 'dash') {
      let dx = moveX, dy = moveY; if (!dx && !dy) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
      const m = Math.hypot(dx, dy); p.dashX = dx / m; p.dashY = dy / m; p.dashT = 0.17; sfx(500, 0.1, 'sine', 0.04, 400);
    }
  }
  function potion(k) {
    if (p.potCd > 0) return;
    if (k === 'hp') { if (p.hpPot <= 0 || p.hp >= p.st.hp) return; p.hpPot--; const v = Math.round(p.st.hp * 0.45); p.hp = Math.min(p.st.hp, p.hp + v); floatText(p.x, p.y - 26, '+' + v, '#6e6'); }
    else { if (p.mpPot <= 0 || p.mp >= p.st.mp) return; p.mpPot--; const v = Math.round(p.st.mp * 0.6); p.mp = Math.min(p.st.mp, p.mp + v); floatText(p.x, p.y - 26, '+' + v, '#6bf'); }
    p.potCd = 0.8; sfx(600, 0.15, 'sine', 0.05, 300);
  }
  function explode(s) {
    const l = p.skl.fire, R = 62 + l * 3;
    for (const e of enemies) if (dist(e, s) < R + e.r) hitEnemy(e, 1.5 + l * 0.3, 160, s);
    for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, s) < R) breakBarrel(o);
    burst(s.x, s.y, '#ff8a2a', 22, 260); burst(s.x, s.y, '#ffd84a', 10, 140);
    parts.push({ x: s.x, y: s.y, vx: 0, vy: 0, c: '#ff8a2a', t: 0.22, r: R, ring: true });
    sfx(90, 0.25, 'sawtooth', 0.07, -40); shake = Math.max(shake, 4);
  }

  // ---------- 更新 ----------
  let moveX = 0, moveY = 0;
  function update(dt) {
    time += dt;
    // 移動輸入
    moveX = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    moveY = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (joy.id !== null) { moveX = joy.x; moveY = joy.y; }
    let m = Math.hypot(moveX, moveY); if (m > 1) { moveX /= m; moveY /= m; m = 1; }
    const st = p.st;
    for (const k in p.cd) p.cd[k] -= dt;
    p.atkCd -= dt; p.slashT -= dt; p.inv_t -= dt; p.potCd -= dt; p.hurtT -= dt;
    p.hp = Math.min(st.hp, p.hp + st.hpr * dt); p.mp = Math.min(st.mp, p.mp + st.mpr * dt);
    if (p.dashT > 0) {
      p.dashT -= dt; moveEnt(p, p.dashX * 780 * dt, p.dashY * 780 * dt);
      parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, c: '#8cf', t: 0.2, r: 9 });
    } else if (m > 0.05) {
      const sp = 190 * (1 + st.move / 100) * (p.whirlT > 0 ? 0.8 : 1);
      moveEnt(p, moveX * sp * dt, moveY * sp * dt); p.walk += dt * 10;
      if (touchMode && p.slashT <= 0) p.aim = Math.atan2(moveY, moveX);
    }
    if (!touchMode) p.aim = aimAngle();
    if (mouse.l || atkHeld || keys.KeyJ) attack();
    if (mouse.r) cast('fire');
    if (p.whirlT > 0) {
      p.whirlT -= dt; p.whirlTick -= dt;
      if (p.whirlTick <= 0) {
        p.whirlTick = 0.2; sfx(260, 0.06, 'triangle', 0.03, 100);
        for (const e of enemies) if (dist(e, p) < 88 + e.r) hitEnemy(e, 0.6 + p.skl.whirl * 0.12, 40);
        for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, p) < 88) breakBarrel(o);
      }
    }
    // 路徑場、探索
    if ((flowT -= dt) <= 0) { flowT = 0.3; bfs(Math.floor(p.x / T), Math.floor(p.y / T), flow); }
    if ((miniT -= dt) <= 0) { miniT = 0.25; explore(); drawMini(); }

    for (const e of enemies) if (!e.dead) updateEnemy(e, dt);
    // 互相推開
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i]; if (!a.awake || a.ch) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j]; if (!b.awake) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
        if (d < min && d > 0.01) { const o = (min - d) / 2, ux = dx / d, uy = dy / d; moveEnt(a, -ux * o, -uy * o); if (b.type !== 'boss') moveEnt(b, ux * o, uy * o); }
      }
    }
    enemies = enemies.filter(e => !e.dead);

    for (const s of shots) {
      s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt;
      const wall = solid(Math.floor(s.x / T), Math.floor(s.y / T));
      if (s.from === 'p') {
        let hit = wall || s.life <= 0;
        if (!hit) for (const e of enemies) if (dist(e, s) < e.r + s.r) { hit = true; break; }
        if (!hit) for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, s) < o.r + s.r) { hit = true; break; }
        if (hit) { s.dead = true; explode(s); }
        else if (Math.random() < 0.6) parts.push({ x: s.x, y: s.y, vx: rand(-30, 30), vy: rand(-30, 30), c: '#fa4', t: 0.25, r: rand(2, 4) });
      } else {
        if (wall || s.life <= 0) s.dead = true;
        else if (dist(s, p) < p.r + s.r) { s.dead = true; hurtPlayer(s.dmg); }
      }
    }
    shots = shots.filter(s => !s.dead);
    props = props.filter(o => !o.dead);

    // 寶箱
    for (const o of props) if (o.kind === 'chest' && !o.open && dist(o, p) < o.r + p.r + 8) {
      o.open = true; sfx(660, 0.2, 'triangle', 0.06, 300); burst(o.x, o.y, '#ffd84a', 16, 160);
      for (let i = 0; i < irand(3, 6); i++) dropGold(o.x, o.y + 20, irand(4, 9) * (1 + p.floor * 0.25));
      dropItem(o.x, o.y + 26, makeItem(p.floor, rollRarity(Math.random() < 0.35 ? 1 : 0)));
      if (Math.random() < 0.5) drops.push(mk(Math.random() < 0.6 ? 'hp' : 'mp', o.x, o.y + 22));
    }
    // 掉落物
    fullMsgT -= dt;
    for (const d of drops) {
      d.t += dt; if (d.t < 0.25) continue;
      const ds = dist(d, p);
      if (d.kind === 'gold' && ds < 110) { d.x += (p.x - d.x) / ds * 420 * dt; d.y += (p.y - d.y) / ds * 420 * dt; }
      if (ds > p.r + 12) continue;
      if (d.kind === 'gold') { p.gold += d.v; d.dead = true; sfx(1200, 0.04, 'square', 0.025); floatText(p.x, p.y - 22, '+' + d.v, '#ffd84a', 12); }
      else if (d.kind === 'hp') { if (p.hpPot < 9) { p.hpPot++; d.dead = true; sfx(800, 0.08, 'sine', 0.04); } }
      else if (d.kind === 'mp') { if (p.mpPot < 9) { p.mpPot++; d.dead = true; sfx(800, 0.08, 'sine', 0.04); } }
      else if (p.inv.length < 24) { p.inv.push(d.it); d.dead = true; floatText(p.x, p.y - 34, d.it.name, RAR[d.it.rarity].c, 13); sfx(700, 0.1, 'triangle', 0.05, 200); }
      else if (fullMsgT <= 0) { fullMsgT = 1.5; floatText(p.x, p.y - 34, '背包滿了', '#f77', 13); }
    }
    drops = drops.filter(d => !d.dead);

    for (const q of parts) { q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.94; q.vy *= 0.94; }
    parts = parts.filter(q => q.t > 0);
    for (const t of texts) { t.t -= dt; t.y -= 34 * dt; }
    texts = texts.filter(t => t.t > 0);
    shake = Math.max(0, shake - dt * 30);
    $('act').style.display = stairs.open && dist(stairs, p) < 34 ? 'block' : 'none';
  }
  function descend() {
    if (state !== 'play' || !stairs.open || dist(stairs, p) > 34) return;
    p.floor++; p.best = Math.max(p.best, p.floor); sfx(300, 0.3, 'triangle', 0.06, -150);
    p.hp = Math.min(p.st.hp, p.hp + p.st.hp * 0.25); p.mp = p.st.mp;
    genFloor();
  }

  // ---------- 繪圖 ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; dark.width = Math.ceil(W / 2); dark.height = Math.ceil(H / 2);
    S = clamp(Math.min(H / 600, W / 760), 0.5, 1.7);
  }
  function drawEnemy(e) {
    const c = ctx, x = e.x, y = e.y, r = e.r, fl = e.flash > 0, wob = Math.sin(e.ph);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(x, y + r * 0.8, r, r * 0.4, 0, 0, 6.283); c.fill();
    if (e.elite) { c.strokeStyle = '#ffd84a'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r + 4 + wob, 0, 6.283); c.stroke(); }
    if (e.ch && e.ch.wind) { c.strokeStyle = 'rgba(255,60,60,.7)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(e.ch.a) * 200, y + Math.sin(e.ch.a) * 200); c.stroke(); }
    const eyes = (ex, ey, s, col = '#111') => { c.fillStyle = '#fff'; c.beginPath(); c.arc(x - ex, y + ey, s, 0, 6.283); c.arc(x + ex, y + ey, s, 0, 6.283); c.fill(); c.fillStyle = col; const ox = Math.cos(e.face) * s * 0.4, oy = Math.sin(e.face) * s * 0.4; c.beginPath(); c.arc(x - ex + ox, y + ey + oy, s * 0.5, 0, 6.283); c.arc(x + ex + ox, y + ey + oy, s * 0.5, 0, 6.283); c.fill(); };
    const body = col => fl ? '#fff' : e.freeze > 0 ? '#9df' : col;
    if (e.type === 'slime') {
      const sq = 1 + wob * 0.08; c.fillStyle = body('#5fc45a');
      c.beginPath(); c.ellipse(x, y + r * 0.2, r * 1.1 * sq, r * 0.9 / sq, 0, Math.PI, 0); c.lineTo(x + r * 1.1 * sq, y + r * 0.6); c.quadraticCurveTo(x, y + r, x - r * 1.1 * sq, y + r * 0.6); c.fill();
      eyes(r * 0.4, -r * 0.1, r * 0.25);
    } else if (e.type === 'bat') {
      c.fillStyle = body('#8a5fb0'); const w = wob * r * 0.8;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - r * 2, y - w); c.lineTo(x - r, y + r * 0.6); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + r * 2, y - w); c.lineTo(x + r, y + r * 0.6); c.closePath(); c.fill();
      c.beginPath(); c.arc(x, y, r * 0.8, 0, 6.283); c.fill(); eyes(r * 0.3, -1, r * 0.22, '#c00');
    } else if (e.type === 'archer') {
      c.fillStyle = body('#d9d2bb'); c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
      c.fillStyle = '#222'; c.beginPath(); c.arc(x - r * 0.35, y - 1, r * 0.25, 0, 6.283); c.arc(x + r * 0.35, y - 1, r * 0.25, 0, 6.283); c.fill(); c.fillRect(x - r * 0.4, y + r * 0.45, r * 0.8, 2);
      c.strokeStyle = '#a87242'; c.lineWidth = 2.5; c.beginPath(); c.arc(x + Math.cos(e.face) * r * 0.8, y + Math.sin(e.face) * r * 0.8, r * 0.9, e.face - 1.2, e.face + 1.2); c.stroke();
    } else if (e.type === 'brute') {
      c.fillStyle = body('#a4553c'); c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
      c.fillStyle = '#eee'; c.beginPath(); c.moveTo(x - r * 0.8, y - r * 0.5); c.lineTo(x - r * 1.3, y - r * 1.3); c.lineTo(x - r * 0.3, y - r * 0.85); c.fill();
      c.beginPath(); c.moveTo(x + r * 0.8, y - r * 0.5); c.lineTo(x + r * 1.3, y - r * 1.3); c.lineTo(x + r * 0.3, y - r * 0.85); c.fill();
      eyes(r * 0.38, -r * 0.1, r * 0.2, '#c00');
    } else if (e.type === 'shaman') {
      c.fillStyle = body('#5b3a86'); c.beginPath(); c.moveTo(x, y - r * 1.5); c.lineTo(x + r, y + r * 0.8); c.lineTo(x - r, y + r * 0.8); c.closePath(); c.fill();
      c.fillStyle = '#111'; c.beginPath(); c.arc(x, y - r * 0.1, r * 0.55, 0, 6.283); c.fill(); eyes(r * 0.25, -r * 0.1, r * 0.16, '#c6f');
      c.fillStyle = '#c56cff'; c.beginPath(); c.arc(x + r * 1.1, y - r * 0.6 + wob * 2, 4, 0, 6.283); c.fill();
    } else {
      const rage = e.hp < e.maxHp * 0.5;
      c.fillStyle = body(rage ? '#6a2222' : '#3a2f4a'); c.beginPath(); c.arc(x, y, r + wob, 0, 6.283); c.fill();
      c.strokeStyle = rage ? '#f53' : '#b98b3e'; c.lineWidth = 4; c.beginPath(); c.arc(x, y, r - 5, 0, 6.283); c.stroke();
      c.fillStyle = '#e9c14a'; c.beginPath(); for (let i = -2; i <= 2; i++) { c.moveTo(x + i * 10 - 5, y - r + 4); c.lineTo(x + i * 10, y - r - 14); c.lineTo(x + i * 10 + 5, y - r + 4); } c.fill();
      eyes(r * 0.35, -r * 0.1, r * 0.2, rage ? '#f00' : '#f80');
    }
    if (e.freeze > 0) { c.strokeStyle = '#cff'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r + 2, 0, 6.283); c.stroke(); }
    if (e.hp < e.maxHp && e.type !== 'boss') { c.fillStyle = '#000a'; c.fillRect(x - r, y - r - 10, r * 2, 4); c.fillStyle = e.elite ? '#ffd84a' : '#e44'; c.fillRect(x - r, y - r - 10, r * 2 * Math.max(0, e.hp / e.maxHp), 4); }
  }
  function drawPlayer() {
    const c = ctx, x = p.x, y = p.y, bob = Math.sin(p.walk) * 1.5;
    c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(x, y + 11, 13, 5, 0, 0, 6.283); c.fill();
    if (p.whirlT > 0) { c.strokeStyle = 'rgba(220,235,255,.8)'; c.lineWidth = 5; const a = time * 22; c.beginPath(); c.arc(x, y, 80, a, a + 2.2); c.stroke(); c.beginPath(); c.arc(x, y, 80, a + 3.14, a + 5.3); c.stroke(); }
    if (p.slashT > 0) { const k = p.slashT / 0.16; c.strokeStyle = `rgba(255,245,210,${k})`; c.lineWidth = 7 * k + 2; c.beginPath(); c.arc(x, y, 50, p.slashA - 1.05 + (1 - k) * 0.6, p.slashA + 1.05 - k * 0.6); c.stroke(); }
    c.globalAlpha = p.inv_t > 0 && Math.sin(time * 60) > 0 ? 0.5 : 1;
    c.fillStyle = p.hurtT > 0 ? '#fff' : '#3d6fb8'; c.beginPath(); c.arc(x, y + bob, 13, 0, 6.283); c.fill();
    c.fillStyle = '#a23'; c.beginPath(); c.arc(x - Math.cos(p.aim) * 5, y + bob - Math.sin(p.aim) * 5, 9, p.aim + 1.57, p.aim + 4.71); c.fill();
    c.fillStyle = '#f1c9a0'; c.beginPath(); c.arc(x + Math.cos(p.aim) * 3, y - 3 + bob + Math.sin(p.aim) * 3, 7.5, 0, 6.283); c.fill();
    // 劍
    const sa = p.slashT > 0 ? p.slashA - 1 + (1 - p.slashT / 0.16) * 2 : p.aim + 0.6;
    c.strokeStyle = '#e8eef5'; c.lineWidth = 3.5; c.beginPath(); c.moveTo(x + Math.cos(sa) * 12, y + Math.sin(sa) * 12); c.lineTo(x + Math.cos(sa) * 34, y + Math.sin(sa) * 34); c.stroke();
    // 火把
    const ta = p.aim - 1.3, tx = x + Math.cos(ta) * 14, ty = y + Math.sin(ta) * 14 - 4;
    c.strokeStyle = '#7a4a22'; c.lineWidth = 3; c.beginPath(); c.moveTo(tx, ty + 8); c.lineTo(tx, ty); c.stroke();
    c.fillStyle = '#ffb02a'; c.beginPath(); c.arc(tx, ty - 3, 4 + Math.sin(time * 20) * 1, 0, 6.283); c.fill();
    c.globalAlpha = 1;
  }
  function render() {
    const vw = W / S, vh = H / S;
    camX = p.x - vw / 2 + rand(-shake, shake); camY = p.y - vh / 2 + rand(-shake, shake);
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#05040a'; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(dpr * S, 0, 0, dpr * S, -camX * dpr * S, -camY * dpr * S);
    const sx = Math.max(0, camX), sy = Math.max(0, camY), sw = Math.min(MW * T - sx, vw + camX - sx), sh = Math.min(MH * T - sy, vh + camY - sy);
    if (sw > 0 && sh > 0) c.drawImage(floorCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
    lights = [{ x: p.x, y: p.y, r: 270 + Math.sin(time * 9) * 8 + Math.sin(time * 23) * 4 }];
    const vis = (o, m = 60) => o.x > camX - m && o.x < camX + vw + m && o.y > camY - m && o.y < camY + vh + m;

    for (const r of rooms) for (const l of r.lights) if (vis(l, 200)) {
      c.fillStyle = '#4a3a30'; c.fillRect(l.x - 7, l.y - 2, 14, 10);
      c.fillStyle = '#ff9a2a'; c.beginPath(); c.arc(l.x, l.y - 4, 6 + Math.sin(time * 14 + l.x) * 1.5, 0, 6.283); c.fill();
      c.fillStyle = '#ffe07a'; c.beginPath(); c.arc(l.x, l.y - 3, 3, 0, 6.283); c.fill();
      lights.push({ x: l.x, y: l.y, r: 150 + Math.sin(time * 11 + l.y) * 6 });
    }
    // 樓梯
    if (stairs.open && vis(stairs)) {
      const x = stairs.x, y = stairs.y;
      c.fillStyle = '#000'; c.fillRect(x - 18, y - 18, 36, 36);
      for (let i = 0; i < 4; i++) { c.fillStyle = `rgb(${90 - i * 20},${80 - i * 18},${70 - i * 15})`; c.fillRect(x - 18, y - 18 + i * 9, 36 - i * 6, 8); }
      c.strokeStyle = `rgba(255,207,107,${0.5 + Math.sin(time * 4) * 0.3})`; c.lineWidth = 2; c.strokeRect(x - 19, y - 19, 38, 38);
      lights.push({ x, y, r: 90 });
    }
    for (const o of props) if (vis(o)) {
      if (o.kind === 'barrel') { c.fillStyle = '#8a5a30'; c.beginPath(); c.arc(o.x, o.y, o.r, 0, 6.283); c.fill(); c.strokeStyle = '#4a2f18'; c.lineWidth = 2; c.stroke(); c.beginPath(); c.arc(o.x, o.y, o.r * 0.55, 0, 6.283); c.stroke(); }
      else { c.fillStyle = o.open ? '#4a3520' : '#9a6a2a'; c.fillRect(o.x - 15, o.y - 10, 30, 20); c.fillStyle = o.open ? '#222' : '#e9c14a'; c.fillRect(o.x - 15, o.y - 3, 30, 3); c.fillRect(o.x - 3, o.y - 6, 6, 8); if (!o.open) lights.push({ x: o.x, y: o.y, r: 60 }); }
    }
    for (const d of drops) if (vis(d)) {
      const b = Math.sin(time * 5 + d.x) * 2;
      if (d.kind === 'gold') { c.fillStyle = '#ffd84a'; c.beginPath(); c.arc(d.x, d.y + b, 5, 0, 6.283); c.fill(); c.fillStyle = '#b8860b'; c.fillRect(d.x - 1, d.y + b - 2, 2, 4); }
      else if (d.kind === 'item') {
        const col = RAR[d.it.rarity].c;
        if (d.it.rarity >= 2) { c.fillStyle = col; c.globalAlpha = 0.25; c.fillRect(d.x - 2, d.y - 70, 4, 70); c.globalAlpha = 1; lights.push({ x: d.x, y: d.y, r: 70 }); }
        c.font = '18px sans-serif'; c.textAlign = 'center'; c.fillText(SLOTS[d.it.slot].i, d.x, d.y + 6 + b);
        c.font = '12px sans-serif'; c.fillStyle = '#000a'; const w = c.measureText(d.it.name).width + 8; c.fillRect(d.x - w / 2, d.y - 28, w, 16); c.fillStyle = col; c.fillText(d.it.name, d.x, d.y - 16);
      } else { c.fillStyle = d.kind === 'hp' ? '#e33' : '#39f'; c.beginPath(); c.arc(d.x, d.y + b, 7, 0, 6.283); c.fill(); c.fillStyle = '#ddd'; c.fillRect(d.x - 3, d.y + b - 12, 6, 6); }
    }
    for (const e of enemies) if (vis(e, 90)) drawEnemy(e);
    drawPlayer();
    for (const s of shots) {
      c.fillStyle = s.col; c.beginPath(); c.arc(s.x, s.y, s.r, 0, 6.283); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(s.x, s.y, s.r * 0.45, 0, 6.283); c.fill();
      lights.push({ x: s.x, y: s.y, r: s.fire ? 120 : 45 });
    }
    for (const q of parts) {
      c.globalAlpha = clamp(q.t * 3, 0, 1);
      if (q.ring) { c.strokeStyle = q.c; c.lineWidth = 4; c.beginPath(); c.arc(q.x, q.y, q.r * (1 - q.t * 2), 0, 6.283); c.stroke(); }
      else { c.fillStyle = q.c; c.beginPath(); c.arc(q.x, q.y, q.r, 0, 6.283); c.fill(); }
    }
    c.globalAlpha = 1;

    // 黑暗：整片蓋黑，再把光源挖洞
    const d = dctx, k = S / 2;
    d.globalCompositeOperation = 'source-over'; d.fillStyle = 'rgba(4,3,9,0.94)'; d.clearRect(0, 0, dark.width, dark.height); d.fillRect(0, 0, dark.width, dark.height);
    d.globalCompositeOperation = 'destination-out';
    for (const l of lights) {
      const x = (l.x - camX) * k, y = (l.y - camY) * k, r = l.r * k, g = d.createRadialGradient(x, y, r * 0.15, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g; d.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(dark, 0, 0, cv.width, cv.height);
    // 暖色火光
    c.setTransform(dpr * S, 0, 0, dpr * S, -camX * dpr * S, -camY * dpr * S);
    const g = c.createRadialGradient(p.x, p.y, 20, p.x, p.y, 260); g.addColorStop(0, 'rgba(255,170,70,.10)'); g.addColorStop(1, 'rgba(255,170,70,0)');
    c.fillStyle = g; c.fillRect(p.x - 260, p.y - 260, 520, 520);
    c.textAlign = 'center';
    for (const t of texts) { c.globalAlpha = clamp(t.t * 2.5, 0, 1); c.font = `bold ${t.size}px sans-serif`; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText(t.s, t.x, t.y); c.fillStyle = t.c; c.fillText(t.s, t.x, t.y); }
    c.globalAlpha = 1;
    // 搖桿
    if (joy.id !== null) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.strokeStyle = 'rgba(255,255,255,.3)'; c.lineWidth = 3;
      c.beginPath(); c.arc(joy.ox, joy.oy, 50, 0, 6.283); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.3)'; c.beginPath(); c.arc(joy.ox + joy.x * 50, joy.oy + joy.y * 50, 22, 0, 6.283); c.fill();
    }
  }
  function drawMini() {
    mctx.clearRect(0, 0, MW, MH);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (explored[y * MW + x] && map[y * MW + x] === 0) { mctx.fillStyle = 'rgba(200,190,220,.55)'; mctx.fillRect(x, y, 1, 1); }
    const sx = Math.floor(stairs.x / T), sy = Math.floor(stairs.y / T);
    if (stairs.open && explored[sy * MW + sx]) { mctx.fillStyle = '#ffcf6b'; mctx.fillRect(sx - 1, sy - 1, 2, 2); }
    if (boss) { mctx.fillStyle = '#f44'; mctx.fillRect(Math.floor(boss.x / T) - 1, Math.floor(boss.y / T) - 1, 2, 2); }
    mctx.fillStyle = '#5f5'; mctx.fillRect(Math.floor(p.x / T) - 0.5, Math.floor(p.y / T) - 0.5, 2, 2);
  }

  // ---------- 介面 ----------
  let bannerT = null;
  function banner(a, b) { const el = $('banner'); el.innerHTML = `${a}<small>${b || ''}</small>`; el.style.opacity = 1; clearTimeout(bannerT); bannerT = setTimeout(() => el.style.opacity = 0, 2200); }
  const setBar = (id, v, max, txt) => { const b = $(id); b.firstElementChild.style.width = clamp(v / max * 100, 0, 100) + '%'; if (txt) b.lastElementChild.textContent = `${Math.ceil(v)} / ${max}`; };
  function hud() {
    $('fl').textContent = p.floor; $('lv').textContent = p.lvl; $('gold').textContent = p.gold;
    setBar('hpBar', p.hp, p.st.hp, 1); setBar('mpBar', p.mp, p.st.mp, 1); setBar('xpBar', p.xp, xpNeed(p.lvl));
    for (const k of ['fire', 'whirl', 'nova', 'dash']) {
      const el = $('sk-' + k); el.lastElementChild.style.height = clamp(p.cd[k] / SK[k].cd * 100, 0, 100) + '%';
      el.classList.toggle('nomp', p.mp < SK[k].mp);
    }
    $('sk-hp').children[1].textContent = p.hpPot; $('sk-mpp').children[1].textContent = p.mpPot;
    $('sk-hp').classList.toggle('nomp', !p.hpPot); $('sk-mpp').classList.toggle('nomp', !p.mpPot);
    $('bagBtn').classList.toggle('glow', p.sp > 0);
    const bb = $('boss');
    if (boss && boss.awake) { bb.style.display = 'block'; $('bossName').textContent = boss.name; bb.querySelector('i').style.width = clamp(boss.hp / boss.maxHp * 100, 0, 100) + '%'; }
    else bb.style.display = 'none';
  }

  let sel = null; // {from:'inv'|'eq', it}
  const potCost = () => 20 + p.floor * 5;
  function itemHtml(it) {
    let h = `<b style="color:${RAR[it.rarity].c}">${it.name}</b> <span class="dim">${RAR[it.rarity].n}${SLOTS[it.slot].n}・Lv ${it.lvl}</span><br>`;
    for (const k in it.base) h += fmt(k, it.base[k]) + '<br>';
    for (const a of it.aff) h += `<span style="color:#9cf">${fmt(a.k, a.v)}</span><br>`;
    return h;
  }
  function upgradeOf(it) { const eq = Object.assign({}, p.equip); eq[it.slot] = it; return power(calcStats(eq)) - power(p.st); }
  function drawPanel() {
    const st = p.st;
    $('eq').innerHTML = Object.keys(SLOTS).map(s => { const it = p.equip[s]; return `<div class="slot${sel && sel.it === it && it ? ' sel' : ''}" data-eq="${s}" style="border-color:${it ? RAR[it.rarity].c : '#443a55'}">${it ? SLOTS[s].i : ''}<small>${SLOTS[s].n}</small></div>`; }).join('');
    $('stats').innerHTML = Object.keys(STAT).map(k => `${STAT[k][0]}　<b>${Number.isInteger(st[k]) ? st[k] : st[k].toFixed(1)}${STAT[k][1] ? '%' : ''}</b>`).join('<br>');
    $('spTxt').textContent = p.sp > 0 ? `（可用點數 ${p.sp}）` : '';
    $('skl').innerHTML = ['fire', 'whirl', 'nova'].map(k => `<div class="row"><span><b>${SK[k].n}</b> Lv ${p.skl[k]}　<span class="dim">${SK[k].d(p.skl[k])}</span></span><button class="btn" data-up="${k}" ${p.sp > 0 && p.skl[k] < 10 ? '' : 'disabled'}>＋</button></div>`).join('');
    const c = potCost();
    $('shop').innerHTML = `<div class="row"><span>🧪 生命藥水（持有 ${p.hpPot}/9）</span><button class="btn" data-buy="hp" ${p.gold >= c && p.hpPot < 9 ? '' : 'disabled'}>${c} 金</button></div>
      <div class="row"><span>💧 魔力藥水（持有 ${p.mpPot}/9）</span><button class="btn" data-buy="mp" ${p.gold >= c && p.mpPot < 9 ? '' : 'disabled'}>${c} 金</button></div>
      <div class="row dim"><span>金幣：${p.gold}</span></div>`;
    $('invTxt').textContent = `${p.inv.length} / 24`;
    let h = '';
    for (let i = 0; i < 24; i++) { const it = p.inv[i]; h += it ? `<div class="slot${sel && sel.it === it ? ' sel' : ''}${upgradeOf(it) > 0.5 ? ' up' : ''}" data-inv="${i}" style="border-color:${RAR[it.rarity].c}">${SLOTS[it.slot].i}</div>` : '<div class="slot"></div>'; }
    $('inv').innerHTML = h;
    const d = $('detail');
    if (!sel) { d.innerHTML = '<span class="dim">點選物品查看內容。右上角有 ▲ 的是比身上更好的裝備。</span>'; return; }
    const it = sel.it; h = itemHtml(it);
    if (sel.from === 'inv') {
      const eq = Object.assign({}, p.equip); eq[it.slot] = it; const ns = calcStats(eq), diff = [];
      for (const k in STAT) { const dv = Math.round((ns[k] - st[k]) * 10) / 10; if (dv) diff.push(`<span class="${dv > 0 ? 'good' : 'bad'}">${fmt(k, dv)}</span>`); }
      h += `<div style="margin-top:6px" class="dim">換上後：${diff.join('、') || '沒有差別'}</div>`;
      h += `<button class="btn" data-act="equip">裝備</button><button class="btn" data-act="sell">賣出（${it.val} 金）</button>`;
    } else h += `<div class="dim" style="margin-top:6px">裝備中</div>` + (p.inv.length < 24 ? '<button class="btn" data-act="unequip">卸下</button>' : '');
    d.innerHTML = h;
  }
  function togglePanel(on) {
    if (state !== 'play') return;
    paused = on === undefined ? !paused : on; sel = null;
    $('panel').classList.toggle('on', paused);
    if (paused) drawPanel(); else save();
  }
  $('panel').addEventListener('click', ev => {
    const t = ev.target.closest('[data-inv],[data-eq],[data-up],[data-buy],[data-act]'); if (!t) return;
    const ds = t.dataset;
    if (ds.inv !== undefined) sel = { from: 'inv', it: p.inv[+ds.inv] };
    else if (ds.eq) sel = p.equip[ds.eq] ? { from: 'eq', it: p.equip[ds.eq] } : null;
    else if (ds.up) { if (p.sp > 0) { p.sp--; p.skl[ds.up]++; sfx(700, 0.1, 'triangle', 0.05, 300); } }
    else if (ds.buy) { const c = potCost(); if (p.gold >= c) { p.gold -= c; if (ds.buy === 'hp') p.hpPot++; else p.mpPot++; sfx(900, 0.06, 'square', 0.03); } }
    else if (ds.act && sel) {
      const it = sel.it, i = p.inv.indexOf(it);
      if (ds.act === 'equip' && i >= 0) { const old = p.equip[it.slot]; p.equip[it.slot] = it; if (old) p.inv[i] = old; else p.inv.splice(i, 1); sfx(500, 0.1, 'triangle', 0.05, 200); }
      else if (ds.act === 'sell' && i >= 0) { p.inv.splice(i, 1); p.gold += it.val; sfx(1200, 0.05, 'square', 0.03); }
      else if (ds.act === 'unequip' && p.inv.length < 24) { p.equip[it.slot] = null; p.inv.push(it); }
      sel = null; refresh();
    }
    drawPanel();
  });
  $('sellJunk').onclick = () => { let g = 0; p.inv = p.inv.filter(it => it.rarity > 0 || (g += it.val, false)); p.gold += g; sel = null; if (g) sfx(1200, 0.05, 'square', 0.03); drawPanel(); };
  $('closeBtn').onclick = () => togglePanel(false);
  $('bagBtn').onclick = () => togglePanel();
  $('sndBtn').onclick = () => { muted = !muted; $('sndBtn').textContent = muted ? '🔇' : '🔊'; };
  $('act').onclick = descend;

  function startGame(fresh) {
    if (fresh || !load()) newPlayer();
    state = 'play'; paused = false; $('menu').classList.remove('on'); genFloor();
  }
  $('newBtn').onclick = () => { if (!hasSave() || confirm('要放棄目前的進度，重新開始嗎？')) startGame(true); };
  $('contBtn').onclick = () => startGame(false);
  if (!hasSave()) $('contBtn').style.display = 'none';
  $('reviveBtn').onclick = () => { $('dead').classList.remove('on'); resetRuntime(); refresh(); p.hp = p.st.hp; p.mp = p.st.mp; state = 'play'; genFloor(); };

  // ---------- 輸入 ----------
  addEventListener('keydown', e => {
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return; keys[e.code] = true;
    if (e.code === 'KeyI' || e.code === 'Tab' || e.code === 'KeyC' || e.code === 'KeyB') togglePanel();
    else if (e.code === 'Escape') { if (paused) togglePanel(false); }
    else if (e.code === 'KeyQ') cast('fire'); else if (e.code === 'KeyE') cast('whirl'); else if (e.code === 'KeyR') cast('nova');
    else if (e.code === 'Space') cast('dash'); else if (e.code === 'Digit1') cast('hp'); else if (e.code === 'Digit2') cast('mpp');
    else if (e.code === 'KeyF') descend();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; atkHeld = false; joy.id = null; });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  const setTouch = on => { if (touchMode !== on) { touchMode = on; document.body.classList.toggle('touch', on); } };
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      setTouch(true);
      if (joy.id === null && e.clientX < W * 0.55) { joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0; }
      return;
    }
    setTouch(false); mouse.x = e.clientX; mouse.y = e.clientY;
    if (e.button === 0) mouse.l = true; else if (e.button === 2) mouse.r = true;
  });
  addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') {
      if (e.pointerId === joy.id) { const dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, m = Math.hypot(dx, dy), k = Math.min(1, m / 50) / (m || 1); joy.x = dx * k; joy.y = dy * k; }
      return;
    }
    mouse.x = e.clientX; mouse.y = e.clientY;
  });
  const up = e => { if (e.pointerId === joy.id) joy.id = null; if (e.pointerType !== 'touch') { if (e.button === 0) mouse.l = false; else if (e.button === 2) mouse.r = false; } };
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
  for (const b of document.querySelectorAll('.sk')) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); if (e.pointerType === 'touch') setTouch(true); if (b.dataset.k === 'atk') atkHeld = true; cast(b.dataset.k); });
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  const atkUp = () => { atkHeld = false; };
  $('sk-atk').addEventListener('pointerup', atkUp); $('sk-atk').addEventListener('pointercancel', atkUp); $('sk-atk').addEventListener('pointerleave', atkUp);
  if (matchMedia('(pointer: coarse)').matches) setTouch(true);
  addEventListener('resize', resize); resize();
  addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  // ---------- 主迴圈 ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state !== 'menu') {
      if (state === 'play' && !paused) update(dt);
      render(); hud();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 測試用
  window.__game = { get p() { return p; }, get enemies() { return enemies; }, get state() { return state; }, get stairs() { return stairs; }, get boss() { return boss; }, update, descend, cast, keys, mouse };
})();
