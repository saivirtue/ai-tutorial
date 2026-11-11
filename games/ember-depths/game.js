// 餘燼地城 —— 3D 地城動作 RPG（three.js＋KayKit CC0 模型，無建置步驟）
// 遊戲邏輯在 2D 平面上以「像素」為單位計算（1 格 = 40px），繪圖時再換成 3D 世界座標（1 格 = 4 單位）。
// 結構：工具 → 地城生成 → 物品 → 玩家 → 敵人 → 戰鬥 → 3D 繪圖 → 介面 → 輸入 → 主迴圈
import * as THREE from './vendor/three.bundle.js';
const { GLTFLoader, cloneSkinned } = THREE;

const $ = id => document.getElementById(id);
const cv = $('cv'), ov = $('ov'), octx = ov.getContext('2d');
const mini = $('mini'), mctx = mini.getContext('2d');

const T = 40, MW = 56, MH = 40, U = 0.1; // U：像素 → 世界單位
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
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
  } catch (e) { /* 沒有音效也能玩 */ }
}
function noise(dur = 0.15, vol = 0.08, lp = 1200) {
  if (muted || !actx) return;
  try {
    const n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp; g.gain.value = vol; s.buffer = buf; s.connect(f).connect(g).connect(actx.destination); s.start();
  } catch (e) { /* 同上 */ }
}

// ---------- 狀態 ----------
let state = 'menu', paused = false, time = 0;
let map, explored, flow, rooms, stairs, pal;
let enemies = [], shots = [], drops = [], props = [], parts = [], texts = [], corpses = [];
let p = null, boss = null, shake = 0, miniT = 0, flowT = 0, itemId = 1, fullMsgT = 0, hitStop = 0;
let W = 0, H = 0, dpr = 1;

const keys = {}, mouse = { x: 0, y: 0, l: false, r: false, wx: 0, wy: 0 };
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let touchMode = false, atkHeld = false;

// ---------- 地城生成 ----------
const PALS = [
  { name: '灰燼迴廊', tint: 0xffffff, hemi: 0x8890b8, torch: 0xff9a4a },
  { name: '苔蘚水窖', tint: 0xb4e2c0, hemi: 0x5fa890, torch: 0xd8ff7a },
  { name: '熔岩礦坑', tint: 0xffc2a0, hemi: 0xb86a48, torch: 0xff6a2a },
  { name: '霜封墓穴', tint: 0xb4ccff, hemi: 0x6688dd, torch: 0x8ad0ff },
  { name: '虛空深淵', tint: 0xd4acf4, hemi: 0x8855bb, torch: 0xd07aff },
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
  clearEntities();
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
  stairs = { x: far.cx * T + T / 2, y: far.cy * T + T / 2, tx: far.cx, ty: far.cy, open: !isBossFloor(f) };
  p.x = start.cx * T + T / 2; p.y = start.cy * T + T / 2;

  const freeSpot = (r, rad) => {
    for (let i = 0; i < 30; i++) {
      const x = (r.x + rand(0.7, r.w - 0.7)) * T, y = (r.y + rand(0.7, r.h - 0.7)) * T;
      if (!circleHits(x, y, rad) && Math.hypot(x - stairs.x, y - stairs.y) > 70) return { x, y };
    }
    return { x: r.cx * T + T / 2, y: r.cy * T + T / 2 + 60 };
  };
  for (const r of rooms) {
    if (r === start) continue;
    if (r === far && isBossFloor(f)) { spawnEnemy('boss', far.cx * T + T / 2, far.cy * T + T / 2 - 50); continue; }
    const n = Math.round(2 + r.w * r.h / 20 + Math.min(4, f * 0.5));
    for (let i = 0; i < n; i++) {
      const s = freeSpot(r, 18), elite = Math.random() < (f >= 2 ? 0.07 : 0.03);
      spawnEnemy(rollType(f), s.x, s.y, elite);
    }
    if (Math.random() < 0.45) { const s = freeSpot(r, 16); props.push({ kind: 'chest', x: s.x, y: s.y, r: 15, open: false, gold: Math.random() < 0.15 }); }
    const nb = irand(1, 4);
    for (let i = 0; i < nb; i++) { const s = freeSpot(r, 12); props.push({ kind: 'barrel', x: s.x, y: s.y, r: 11, skin: Math.random() < 0.6 ? 'barrel_large' : 'box_large', rot: rand(0, 6.28) }); }
  }
  buildLevel3D();
  explore(); miniT = 0; flowT = 0;
  banner(`第 ${f} 層`, isBossFloor(f) ? '⚠️ 守關者就在這一層' : pal.name);
  save();
}

function explore() {
  const px = Math.floor(p.x / T), py = Math.floor(p.y / T);
  for (let y = py - 6; y <= py + 6; y++) for (let x = px - 8; x <= px + 8; x++)
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
  const q = r < 0.02 + bonus * 0.5 ? 3 : r < 0.12 + bonus ? 2 : r < 0.42 + bonus ? 1 : 0;
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
    skl: { fire: 1, whirl: 1, nova: 1 }, inv: [],
    equip: { weapon: { id: itemId++, slot: 'weapon', rarity: 0, lvl: 1, base: { dmg: 5 }, aff: [], name: '生鏽的短劍', val: 3 }, armor: null, ring: null },
  };
  resetRuntime(); refresh(); p.hp = p.st.hp; p.mp = p.st.mp;
}
function resetRuntime() {
  Object.assign(p, { aim: 0, atkCd: 0, slashT: 0, slashA: 0, whirlT: 0, whirlTick: 0, dashT: 0, dashX: 0, dashY: 0, inv_t: 0, potCd: 0, hurtT: 0, moving: false, moveA: 0, combo: 0, cd: { fire: 0, whirl: 0, nova: 0, dash: 0 } });
}
const xpNeed = l => Math.round(40 * Math.pow(l, 1.7));
function gainXp(v) {
  p.xp += v;
  while (p.xp >= xpNeed(p.lvl)) {
    p.xp -= xpNeed(p.lvl); p.lvl++; p.sp++; refresh(); p.hp = p.st.hp; p.mp = p.st.mp;
    floatText(p.x, p.y, '升級！', '#ffcf6b', 24);
    burst(p.x, p.y, '#ffcf6b', 40, 160, 1, 1, 6); fxRing(p.x, p.y, 90, 0xffcf6b, 0.6);
    sfx(520, 0.25, 'triangle', 0.08, 500);
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
  minion: { n: '骷髏兵', hp: 30, spd: 74, dmg: 8, r: 12, xp: 8 },
  imp: { n: '小骨魔', hp: 16, spd: 140, dmg: 5, r: 9, xp: 7 },
  archer: { n: '骸骨弩手', hp: 22, spd: 85, dmg: 9, r: 12, xp: 11, ranged: 1 },
  brute: { n: '骸骨戰將', hp: 95, spd: 60, dmg: 18, r: 16, xp: 22, charger: 1 },
  shaman: { n: '亡靈咒術師', hp: 40, spd: 62, dmg: 10, r: 12, xp: 18, ranged: 1 },
  boss: { n: '守關者', hp: 900, spd: 72, dmg: 20, r: 30, xp: 300, charger: 1 },
};
const BOSSN = ['灰燼守衛', '沼澤骨王', '熔核督軍', '霜冠亡王', '虛空之主'];
function rollType(f) {
  const w = [['minion', 5], ['imp', 3]];
  if (f >= 2) w.push(['archer', 3]); if (f >= 3) w.push(['brute', 2]); if (f >= 4) w.push(['shaman', 2]);
  let t = Math.random() * w.reduce((s, x) => s + x[1], 0);
  for (const x of w) { if ((t -= x[1]) < 0) return x[0]; }
  return 'minion';
}
function spawnEnemy(type, x, y, elite) {
  const d = ET[type], f = p.floor, hs = 1 + 0.28 * (f - 1), ds = 1 + 0.16 * (f - 1);
  const e = {
    type, x, y, r: d.r * (elite ? 1.25 : 1), hp: d.hp * hs * (elite ? 3.2 : 1), dmg: d.dmg * ds * (elite ? 1.4 : 1),
    spd: d.spd * rand(0.9, 1.1), xp: d.xp * (1 + 0.2 * (f - 1)) * (elite ? 4 : 1), elite: !!elite,
    awake: false, atkCd: rand(0, 0.6), atkT: 0, shotCd: rand(1, 2.5), flash: 0, slow: 0, freeze: 0, kx: 0, ky: 0, ph: rand(0, 6.28), ch: null, chCd: rand(2, 4),
    face: rand(0, 6.28), faceLock: 0, act: 2.5, volley: 0, volT: 0, v: null,
  };
  e.maxHp = e.hp;
  if (type === 'boss') { e.name = BOSSN[(Math.floor(f / 5) - 1) % BOSSN.length]; boss = e; }
  enemies.push(e); return e;
}
function enemyShot(e, ang, spd, dmg, col, r = 6, arrow = false) {
  shots.push({ x: e.x + Math.cos(ang) * e.r, y: e.y + Math.sin(ang) * e.r, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r, dmg, from: 'e', life: 4, col, arrow });
}
function updateEnemy(e, dt) {
  e.flash -= dt; e.atkCd -= dt; e.ph += dt * 6;
  if (e.kx || e.ky) { moveEnt(e, e.kx * dt, e.ky * dt); e.kx *= Math.pow(0.002, dt); e.ky *= Math.pow(0.002, dt); if (Math.abs(e.kx) + Math.abs(e.ky) < 5) e.kx = e.ky = 0; }
  if (e.freeze > 0) { e.freeze -= dt; return; }
  const sm = e.slow > 0 ? 0.45 : 1; e.slow -= dt;
  const d = dist(e, p);
  if (!e.awake) { if (d < 340 && los(e, p)) { e.awake = true; if (e === boss) { sfx(90, 0.6, 'sawtooth', 0.08, -40); charOnce(e, 'Taunt', 1.2); e.act = 1.6; } } else return; }
  // 近戰出手：先有揮擊的前搖，躲得開
  if (e.atkT > 0) {
    e.atkT -= dt; e.face = Math.atan2(p.y - e.y, p.x - e.x);
    if (e.atkT <= 0 && d < e.r + p.r + 20) hurtPlayer(e.dmg);
    return;
  }
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
  const def = ET[e.type]; let spd = e.spd * sm;

  // 衝撞（骸骨戰將、守關者）
  if (e.ch) {
    e.ch.t -= dt;
    if (e.ch.wind) { e.face = e.ch.a; if (e.ch.t <= 0) { e.ch.wind = false; e.ch.t = 0.55; sfx(140, 0.2, 'sawtooth', 0.06, -60); } return; }
    const hit = moveEnt(e, Math.cos(e.ch.a) * 430 * dt, Math.sin(e.ch.a) * 430 * dt);
    if (Math.random() < 0.5) parts.push(mkPart(e.x, e.y, 0.2, rand(-20, 20), rand(-20, 20), 1, '#998877', 0.4, 4));
    if (d < e.r + p.r + 4 && !e.ch.done) { e.ch.done = true; hurtPlayer(e.dmg * 1.6); }
    if (hit || e.ch.t <= 0) { e.ch = null; if (hit) { shake = Math.max(shake, 6); noise(0.2, 0.1, 500); } }
    return;
  }
  const startCharge = () => { e.ch = { wind: true, t: 0.7, a: Math.atan2(p.y - e.y, p.x - e.x) }; charOnce(e, 'Taunt', 1.6, 0.7); };

  if (e.type === 'boss') { if (bossAI(e, dt, d, see, startCharge)) return; }
  else if (def.charger) { e.chCd -= dt; if (see && d < 280 && d > 80 && e.chCd <= 0) { e.chCd = rand(3.5, 5); startCharge(); return; } }

  if (def.ranged) {
    e.shotCd -= dt;
    if (see) {
      if (d < 140) { ax = -ax; ay = -ay; } else if (d < 250) { const s = Math.sin(e.ph * 0.15) > 0 ? 1 : -1;[ax, ay] = [-ay * s, ax * s]; spd *= 0.6; }
      if (e.shotCd <= 0 && d < 360) {
        const a = Math.atan2(p.y - e.y, p.x - e.x); e.face = a; e.faceLock = 0.5;
        if (e.type === 'archer') { enemyShot(e, a, 300, e.dmg, '#ffe9b0', 5, true); e.shotCd = rand(1.6, 2.4); sfx(700, 0.05, 'triangle', 0.03, -300); charOnce(e, '2H_Ranged_Shoot', 1.6); }
        else { for (const o of [-0.3, 0, 0.3]) enemyShot(e, a + o, 150, e.dmg, '#c56cff', 7); e.shotCd = rand(2.6, 3.4); sfx(300, 0.15, 'sine', 0.04, 200); charOnce(e, 'Spellcast_Shoot', 1.5); }
      }
    }
  }
  if (e.type === 'imp') { const w = Math.sin(e.ph * 0.9) * 0.8;[ax, ay] = [ax * Math.cos(w) - ay * Math.sin(w), ax * Math.sin(w) + ay * Math.cos(w)]; }
  e.faceLock -= dt;
  if ((ax || ay) && e.faceLock <= 0) e.face = Math.atan2(ay, ax);
  if (d > e.r + p.r - 2 || def.ranged) moveEnt(e, ax * spd * dt, ay * spd * dt);
  if (d < e.r + p.r + 8 && e.atkCd <= 0) {
    e.atkCd = e.type === 'boss' ? 1.4 : 1.15; e.atkT = e.type === 'imp' ? 0.22 : 0.34;
    charOnce(e, e.type === 'minion' || e.type === 'imp' ? 'Unarmed_Melee_Attack_Punch_A' : '1H_Melee_Attack_Chop', e.type === 'imp' ? 2.2 : 1.7);
  }
}
function bossAI(e, dt, d, see, startCharge) {
  const rage = e.hp < e.maxHp * 0.5;
  if (rage && !e.raged) { e.raged = true; fxRing(e.x, e.y, 200, 0xff4020, 0.7); shake = 8; sfx(70, 0.7, 'sawtooth', 0.09, 60); floatText(e.x, e.y, '狂暴！', '#ff5a3a', 22); }
  if (e.volley > 0) {
    e.volT -= dt;
    if (e.volT <= 0) { e.volT = 0.22; e.volley--; const a = Math.atan2(p.y - e.y, p.x - e.x); e.face = a; e.faceLock = 0.3; for (const o of [-0.22, 0, 0.22]) enemyShot(e, a + o, 300, e.dmg * 0.7, '#ff9a3a', 7); sfx(420, 0.06, 'square', 0.04); }
  }
  e.act -= dt;
  if (e.act > 0 || !see) return false;
  e.act = rage ? 1.7 : 2.5;
  const r = Math.random();
  if (r < 0.3) { const n = rage ? 20 : 14, o = rand(0, 6.28); for (let i = 0; i < n; i++) enemyShot(e, o + i / n * 6.283, 175, e.dmg * 0.7, '#ff5a4a', 8); sfx(180, 0.3, 'sawtooth', 0.06, 200); shake = 6; charOnce(e, 'Spellcast_Summon', 1.6); fxRing(e.x, e.y, 80, 0xff5a4a, 0.4); }
  else if (r < 0.55) { e.volley = rage ? 5 : 3; e.volT = 0; charOnce(e, 'Spellcast_Shoot', 0.9); }
  else if (r < 0.75 && enemies.length < 10) {
    charOnce(e, 'Spellcast_Summon', 1.4);
    for (let i = 0; i < 3; i++) { const a = rand(0, 6.28), m = spawnEnemy(p.floor > 5 ? 'imp' : 'minion', e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 70); m.awake = true; m.xp = 0; m.summoned = true; m.atkCd = 1.2; burst(m.x, m.y, '#aa66ff', 14, 80, 0.6); }
    sfx(260, 0.3, 'sine', 0.05, -100);
  }
  else if (d > 90) { startCharge(); return true; }
  return false;
}

// ---------- 戰鬥 ----------
function floatText(x, y, s, c = '#fff', size = 15) { texts.push({ x: x + rand(-8, 8), y, s, c, size, t: 0.9 }); }
// 粒子：x,y 是邏輯像素；h 是離地高度（世界單位）
const mkPart = (x, y, h, vx, vy, vh, c, t, r, g = 0) => ({ x, y, h, vx, vy, vh, c, t, life: t, r, g });
function burst(x, y, c, n, spd, life = 0.5, h = 1.2, up = 3) {
  for (let i = 0; i < n; i++) { const a = rand(0, 6.283), v = rand(spd * 0.3, spd); parts.push(mkPart(x, y, h, Math.cos(a) * v, Math.sin(a) * v, rand(-1, up), c, rand(life * 0.5, life), rand(2, 5), 6)); }
}

function hitEnemy(e, mult, kb = 120, src) {
  if (e.dead) return;
  let dmg = p.st.dmg * mult * rand(0.88, 1.12); const crit = Math.random() * 100 < p.st.crit;
  if (crit) dmg *= 2;
  dmg = Math.max(1, Math.round(dmg));
  e.hp -= dmg; e.flash = 0.12; e.awake = true;
  const o = src || p, a = Math.atan2(e.y - o.y, e.x - o.x), k = e.type === 'boss' ? 0.1 : e.type === 'brute' ? 0.4 : 1;
  e.kx += Math.cos(a) * kb * k * 3; e.ky += Math.sin(a) * kb * k * 3;
  floatText(e.x, e.y, crit ? dmg + '!' : '' + dmg, crit ? '#ffd84a' : '#fff', crit ? 22 : 15);
  burst(e.x, e.y, crit ? '#ffd84a' : '#e8e2d0', crit ? 8 : 4, 90, 0.35, 1.4, 2);
  if (crit) hitStop = Math.max(hitStop, 0.05);
  if (p.st.ls > 0) p.hp = Math.min(p.st.hp, p.hp + dmg * p.st.ls / 100);
  if (e.hp <= 0) killEnemy(e);
  else if (e.type !== 'boss' && !e.ch && e.atkT <= 0 && e.v && e.v.lock <= 0) charOnce(e, 'Hit_A', 2, 0.2);
}
function killEnemy(e) {
  e.dead = true; gainXp(Math.round(e.xp)); sfx(160, 0.12, 'square', 0.05, -100); noise(0.12, 0.06, 900);
  burst(e.x, e.y, '#d8d2c0', e.elite ? 20 : 10, 130, 0.6, 1.2, 4);
  toCorpse(e);
  const f = p.floor;
  if (e.type === 'boss') {
    boss = null; stairs.open = true; shake = 16; hitStop = 0.25; burst(e.x, e.y, '#ffcf6b', 90, 260, 1.2, 2, 8); fxRing(e.x, e.y, 260, 0xffcf6b, 0.9); sfx(80, 0.8, 'sawtooth', 0.09, 300);
    for (let i = 0; i < 3; i++) dropItem(e.x + rand(-50, 50), e.y + rand(-50, 50), makeItem(f, rollRarity(i === 0 ? 3 : 2)));
    for (let i = 0; i < 10; i++) dropGold(e.x + rand(-30, 30), e.y + rand(-30, 30), irand(8, 16) * (1 + f * 0.25));
    drops.push(mk('hp', e.x - 20, e.y)); drops.push(mk('mp', e.x + 20, e.y));
    banner('守關者倒下', '樓梯出現了');
    for (const o of enemies) if (o !== e && !o.dead) { o.hp = 0; o.dead = true; toCorpse(o); }
    return;
  }
  if (e.summoned) return;
  if (Math.random() < 0.7) dropGold(e.x, e.y, irand(2, 6) * (1 + f * 0.25) * (e.elite ? 4 : 1));
  const r = Math.random();
  if (r < 0.07) drops.push(mk('hp', e.x, e.y)); else if (r < 0.11) drops.push(mk('mp', e.x, e.y));
  if (e.elite || Math.random() < 0.09) dropItem(e.x, e.y, makeItem(f, rollRarity(e.elite ? 1 : 0)));
}
const mk = (kind, x, y, extra) => Object.assign({ kind, x: x + rand(-14, 14), y: y + rand(-14, 14), t: 0, v: null }, extra);
function dropGold(x, y, v) { drops.push(mk('gold', x, y, { amt: Math.max(1, Math.round(v)) })); }
function dropItem(x, y, it) { drops.push(mk('item', x, y, { it })); if (it.rarity >= 2) sfx(880, 0.3, 'triangle', 0.06, 400); }

function hurtPlayer(d) {
  if (p.inv_t > 0 || p.dashT > 0 || state !== 'play') return;
  d = Math.max(1, Math.round(d * 100 / (100 + p.st.armor) * rand(0.9, 1.1)));
  p.hp -= d; p.hurtT = 0.25; p.inv_t = 0.25; shake = Math.max(shake, 5);
  floatText(p.x, p.y, '-' + d, '#ff6a6a', 17); sfx(110, 0.12, 'sawtooth', 0.07, -40);
  burst(p.x, p.y, '#ff4444', 6, 90, 0.4, 1.4, 2);
  $('hurt').style.opacity = 1; setTimeout(() => $('hurt').style.opacity = 0, 120);
  if (p.hp <= 0) die();
}
function die() {
  p.hp = 0; state = 'dead';
  const lost = Math.floor(p.gold * 0.3); p.gold -= lost;
  if (hero) hero.once('Death_A', 1, 99);
  $('deadTxt').innerHTML = `你倒在第 ${p.floor} 層（最深紀錄：第 ${p.best} 層）。<br>掉了 ${lost} 枚金幣，裝備和等級都還在。`;
  setTimeout(() => $('dead').classList.add('on'), 1300); sfx(200, 0.7, 'sawtooth', 0.08, -170);
  save();
}

function aimAngle() {
  if (!touchMode) return Math.atan2(mouse.wy - p.y, mouse.wx - p.x);
  let best = null, bd = 380;
  for (const e of enemies) { const d = dist(e, p); if (d < bd && e.awake && los(p, e)) { bd = d; best = e; } }
  if (best) return Math.atan2(best.y - p.y, best.x - p.x);
  for (const o of props) { if (o.kind === 'barrel' && dist(o, p) < 80) return Math.atan2(o.y - p.y, o.x - p.x); }
  return p.aim;
}
const SWINGS = ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'];
function attack() {
  if (p.atkCd > 0 || p.whirlT > 0 || p.dashT > 0) return;
  p.aim = aimAngle(); p.atkCd = 0.42 / (1 + p.st.aspd / 100); p.slashT = 0.18; p.slashA = p.aim;
  p.combo = (p.combo + 1) % 3;
  if (hero) hero.once(SWINGS[p.combo], 0.5 / p.atkCd, p.atkCd * 0.9);
  fxSlash(p.x, p.y, p.aim, p.combo);
  sfx(330, 0.06, 'triangle', 0.04, -150); noise(0.07, 0.04, 3000);
  const range = 68; let hit = false;
  for (const e of enemies) {
    const d = dist(e, p); if (d > range + e.r) continue;
    if (d < e.r + 14 || Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), p.aim)) < 1.05) { hitEnemy(e, p.combo === 2 ? 1.25 : 1, p.combo === 2 ? 170 : 110); hit = true; }
  }
  if (hit) { shake = Math.max(shake, 2.5); hitStop = Math.max(hitStop, 0.03); sfx(140, 0.07, 'square', 0.05, -60); }
  for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, p) < range + o.r && Math.abs(angDiff(Math.atan2(o.y - p.y, o.x - p.x), p.aim)) < 1.2) breakBarrel(o);
}
function breakBarrel(o) {
  o.dead = true; burst(o.x, o.y, '#b98552', 14, 120, 0.7, 1, 5); sfx(220, 0.08, 'square', 0.04, -100); noise(0.15, 0.08, 1500);
  const r = Math.random();
  if (r < 0.55) dropGold(o.x, o.y, irand(1, 5) * (1 + p.floor * 0.25)); else if (r < 0.63) drops.push(mk('hp', o.x, o.y)); else if (r < 0.68) drops.push(mk('mp', o.x, o.y));
}
function cast(k) {
  if (state !== 'play' || paused) return;
  if (k === 'atk') return attack();
  if (k === 'hp' || k === 'mpp') return potion(k);
  const s = SK[k]; if (p.cd[k] > 0) return;
  if (p.mp < s.mp) { floatText(p.x, p.y, '魔力不足', '#6bf', 13); return; }
  p.mp -= s.mp; p.cd[k] = s.cd;
  if (k === 'fire') {
    const a = p.aim = aimAngle();
    shots.push({ x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, r: 8, from: 'p', life: 1.4, col: '#ff8a2a', fire: true });
    sfx(240, 0.2, 'sawtooth', 0.05, 300); if (hero) hero.once('Spellcast_Shoot', 2.4, 0.3);
  } else if (k === 'whirl') { p.whirlT = 1.2; p.whirlTick = 0; }
  else if (k === 'nova') {
    const l = p.skl.nova, R = 175;
    for (const e of enemies) if (dist(e, p) < R + e.r) { e.freeze = Math.max(e.freeze, (1.5 + l * 0.3) * (e.type === 'boss' ? 0.35 : 1)); e.slow = e.freeze + 2; e.atkT = 0; hitEnemy(e, 1 + l * 0.25, 60); }
    for (let i = 0; i < 60; i++) { const a = i / 60 * 6.283; parts.push(mkPart(p.x, p.y, 0.5, Math.cos(a) * 330, Math.sin(a) * 330, 0.5, '#aaeeff', 0.5, 5)); }
    fxRing(p.x, p.y, R, 0x88ddff, 0.45); fxRing(p.x, p.y, R * 0.7, 0xffffff, 0.3);
    shots = shots.filter(s => { if (s.from === 'e' && dist(s, p) < R) { killVis(s); return false; } return true; });
    sfx(900, 0.35, 'sine', 0.07, -700); shake = 5; if (hero) hero.once('Spellcast_Raise', 2, 0.4);
  } else if (k === 'dash') {
    let dx = moveX, dy = moveY; if (!dx && !dy) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
    const m = Math.hypot(dx, dy); p.dashX = dx / m; p.dashY = dy / m; p.dashT = 0.2; sfx(500, 0.1, 'sine', 0.04, 400); noise(0.12, 0.04, 2500);
    if (hero) hero.once('Dodge_Forward', 2.2, 0.22);
  }
}
function potion(k) {
  if (p.potCd > 0) return;
  if (k === 'hp') { if (p.hpPot <= 0 || p.hp >= p.st.hp) return; p.hpPot--; const v = Math.round(p.st.hp * 0.45); p.hp = Math.min(p.st.hp, p.hp + v); floatText(p.x, p.y, '+' + v, '#6e6'); burst(p.x, p.y, '#55ee66', 16, 50, 0.8, 0.3, 5); }
  else { if (p.mpPot <= 0 || p.mp >= p.st.mp) return; p.mpPot--; const v = Math.round(p.st.mp * 0.6); p.mp = Math.min(p.st.mp, p.mp + v); floatText(p.x, p.y, '+' + v, '#6bf'); burst(p.x, p.y, '#55aaff', 16, 50, 0.8, 0.3, 5); }
  p.potCd = 0.8; sfx(600, 0.15, 'sine', 0.05, 300);
}
function explode(s) {
  const l = p.skl.fire, R = 62 + l * 3;
  for (const e of enemies) if (dist(e, s) < R + e.r) hitEnemy(e, 1.5 + l * 0.3, 160, s);
  for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, s) < R) breakBarrel(o);
  burst(s.x, s.y, '#ff8a2a', 26, 200, 0.6, 1.2, 6); burst(s.x, s.y, '#ffd84a', 12, 110, 0.5, 1.2, 4);
  fxRing(s.x, s.y, R, 0xff8a2a, 0.3); fxFlash(s.x, s.y, 0xff8030, 0.25);
  sfx(90, 0.25, 'sawtooth', 0.07, -40); noise(0.3, 0.12, 700); shake = Math.max(shake, 5);
}

// ---------- 更新 ----------
let moveX = 0, moveY = 0;
function update(dt) {
  time += dt;
  // 輸入方向是「螢幕方向」，要依鏡頭水平角轉成世界方向
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let iy = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  if (joy.id !== null) { ix = joy.x; iy = joy.y; }
  const cyaw = CAMS[camMode].yaw, cs = Math.cos(cyaw), sn = Math.sin(cyaw);
  moveX = ix * cs + iy * sn; moveY = -ix * sn + iy * cs;
  let m = Math.hypot(moveX, moveY); if (m > 1) { moveX /= m; moveY /= m; m = 1; }
  const st = p.st;
  for (const k in p.cd) p.cd[k] -= dt;
  p.atkCd -= dt; p.slashT -= dt; p.inv_t -= dt; p.potCd -= dt; p.hurtT -= dt;
  p.hp = Math.min(st.hp, p.hp + st.hpr * dt); p.mp = Math.min(st.mp, p.mp + st.mpr * dt);
  p.moving = false;
  if (p.dashT > 0) {
    p.dashT -= dt; moveEnt(p, p.dashX * 700 * dt, p.dashY * 700 * dt);
    parts.push(mkPart(p.x, p.y, 1.2, 0, 0, 0, '#88ccff', 0.25, 9));
  } else if (m > 0.05) {
    const sp = 190 * (1 + st.move / 100) * (p.whirlT > 0 ? 0.8 : p.atkCd > 0.12 ? 0.45 : 1);
    moveEnt(p, moveX * sp * dt, moveY * sp * dt); p.moving = true; p.moveA = Math.atan2(moveY, moveX);
    if (touchMode && p.slashT <= 0) p.aim = p.moveA;
  }
  if (!touchMode) p.aim = aimAngle();
  if (mouse.l || atkHeld || keys.KeyJ) attack();
  if (mouse.r) cast('fire');
  if (p.whirlT > 0) {
    p.whirlT -= dt; p.whirlTick -= dt;
    if (p.whirlTick <= 0) {
      p.whirlTick = 0.2; sfx(260, 0.06, 'triangle', 0.03, 100); noise(0.08, 0.03, 2500);
      for (const e of enemies) if (dist(e, p) < 88 + e.r) hitEnemy(e, 0.6 + p.skl.whirl * 0.12, 40);
      for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, p) < 88) breakBarrel(o);
    }
  }
  if ((flowT -= dt) <= 0) { flowT = 0.3; bfs(Math.floor(p.x / T), Math.floor(p.y / T), flow); }
  if ((miniT -= dt) <= 0) { miniT = 0.25; explore(); drawMini(); }

  for (const e of enemies) if (!e.dead) updateEnemy(e, dt);
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
      else parts.push(mkPart(s.x, s.y, 1.3, rand(-25, 25), rand(-25, 25), rand(0, 2), Math.random() < 0.5 ? '#ffaa44' : '#ff5522', 0.3, rand(3, 6)));
    } else {
      if (wall || s.life <= 0) { s.dead = true; if (wall) burst(s.x, s.y, s.col, 4, 60, 0.3, 1.2, 1); }
      else if (dist(s, p) < p.r + s.r) { s.dead = true; hurtPlayer(s.dmg); }
    }
  }
  shots = shots.filter(s => { if (s.dead) killVis(s); return !s.dead; });
  props = props.filter(o => { if (o.dead) killVis(o); return !o.dead; });

  for (const o of props) if (o.kind === 'chest' && !o.open && dist(o, p) < o.r + p.r + 10) {
    o.open = true; sfx(660, 0.2, 'triangle', 0.06, 300); burst(o.x, o.y, '#ffd84a', 24, 110, 0.9, 1, 6);
    for (let i = 0; i < irand(3, 6) * (o.gold ? 2 : 1); i++) dropGold(o.x + rand(-20, 20), o.y + 26, irand(4, 9) * (1 + p.floor * 0.25));
    dropItem(o.x, o.y + 30, makeItem(p.floor, rollRarity(o.gold ? 2 : Math.random() < 0.35 ? 1 : 0)));
    if (Math.random() < 0.5) drops.push(mk(Math.random() < 0.6 ? 'hp' : 'mp', o.x, o.y + 26));
  }
  fullMsgT -= dt;
  for (const d of drops) {
    d.t += dt; if (d.t < 0.3) continue;
    const ds = dist(d, p);
    if (d.kind === 'gold' && ds < 110) { d.x += (p.x - d.x) / ds * 420 * dt; d.y += (p.y - d.y) / ds * 420 * dt; }
    if (ds > p.r + 12) continue;
    if (d.kind === 'gold') { p.gold += d.amt; d.dead = true; sfx(1200, 0.04, 'square', 0.025); floatText(p.x, p.y, '+' + d.amt, '#ffd84a', 12); }
    else if (d.kind === 'hp') { if (p.hpPot < 9) { p.hpPot++; d.dead = true; sfx(800, 0.08, 'sine', 0.04); } }
    else if (d.kind === 'mp') { if (p.mpPot < 9) { p.mpPot++; d.dead = true; sfx(800, 0.08, 'sine', 0.04); } }
    else if (p.inv.length < 24) { p.inv.push(d.it); d.dead = true; floatText(p.x, p.y, d.it.name, RAR[d.it.rarity].c, 14); sfx(700, 0.1, 'triangle', 0.05, 200); }
    else if (fullMsgT <= 0) { fullMsgT = 1.5; floatText(p.x, p.y, '背包滿了', '#f77', 13); }
  }
  drops = drops.filter(d => { if (d.dead) killVis(d); return !d.dead; });

  for (const q of parts) { q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt; q.vh -= q.g * dt; if (q.h < 0.05) { q.h = 0.05; q.vh = 0; q.vx *= 0.8; q.vy *= 0.8; } q.vx *= 0.95; q.vy *= 0.95; }
  parts = parts.filter(q => q.t > 0);
  if (parts.length > 700) parts.splice(0, parts.length - 700);
  for (const t of texts) t.t -= dt;
  texts = texts.filter(t => t.t > 0);
  shake = Math.max(0, shake - dt * 30);
  $('act').style.display = stairs.open && dist(stairs, p) < 44 ? 'block' : 'none';
}
function descend() {
  if (state !== 'play' || !stairs.open || dist(stairs, p) > 44) return;
  p.floor++; p.best = Math.max(p.best, p.floor); sfx(300, 0.3, 'triangle', 0.06, -150);
  p.hp = Math.min(p.st.hp, p.hp + p.st.hp * 0.25); p.mp = p.st.mp;
  genFloor();
}

// ======================================================================
// 3D 繪圖
// ======================================================================
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const BG = 0x040308;
const scene = new THREE.Scene(); scene.background = new THREE.Color(BG); scene.fog = new THREE.Fog(BG, 30, 80);
const camera = new THREE.PerspectiveCamera(34, 1, 1, 220);
const hemi = new THREE.HemisphereLight(0x8890b8, 0x1a1410, 0.62); scene.add(hemi);
const moon = new THREE.DirectionalLight(0xa8b8ff, 0.9); scene.add(moon, moon.target);
moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048); moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.04;
Object.assign(moon.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 90 });
const torch = new THREE.PointLight(0xffb070, 70, 32, 1.6); scene.add(torch);
const wallLights = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xff9a4a, 0, 20, 1.6); scene.add(l); return l; });
const fxLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xff8030, 0, 18, 1.8); scene.add(l); l.userData.t = 0; return l; });

// 視角：yaw 是鏡頭繞垂直軸的角度（0 = 從南邊往北看），pitch 是俯角
const CAMS = [
  { name: '斜角', yaw: Math.PI / 4, pitch: 45, dist: 39 },
  { name: '正面', yaw: 0, pitch: 47, dist: 42 },
  { name: '貼近', yaw: Math.PI / 4, pitch: 38, dist: 30 },
  { name: '俯瞰', yaw: 0, pitch: 66, dist: 52 },
];
let camMode = 0, camReady = false;
const camTgt = new THREE.Vector3(), camOff = new THREE.Vector3(), camCur = { yaw: Math.PI / 4, pitch: 45, dist: 39 };

const A = {}; // 載入的模型
const loader = new GLTFLoader();
const ASSETS = ['knight', 'skel_warrior', 'skel_mage', 'skel_minion', 'skel_rogue', 'w_blade', 'w_axe', 'w_staff', 'w_crossbow', 'w_shield_large_a',
  'wall', 'wall_cracked', 'floor_tile_large', 'floor_tile_large_rocks', 'floor_dirt_large', 'floor_dirt_large_rocky', 'floor_tile_big_grate_open',
  'torch_mounted', 'barrel_large', 'box_large', 'banner_patternA_red', 'banner_patternB_blue', 'banner_shield_green', 'coin', 'bottle_A_labeled_green',
  'chest', 'chest_gold', 'pillar', 'coin_stack_small'];
const CLIPS = { knight: {}, skel: {} };
async function loadAssets() {
  let done = 0;
  await Promise.all(ASSETS.map(n => loader.loadAsync(`assets/${n}.glb`).then(g => {
    A[n] = g; done++;
    $('loadBar').firstElementChild.style.width = (done / ASSETS.length * 100) + '%';
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.metalness = Math.min(o.material.metalness, 0.3); } });
    g.scene.updateMatrixWorld(true);
  })));
  for (const c of A.knight.animations) CLIPS.knight[c.name] = c;
  for (const c of A.skel_warrior.animations) CLIPS.skel[c.name] = c;
}

// ----- 角色（骨架動畫） -----
class Char {
  constructor(model, clips, tint) {
    this.root = cloneSkinned(A[model].scene); this.clips = clips; this.acts = {}; this.cur = null; this.curA = null; this.lock = 0;
    this.mixer = new THREE.AnimationMixer(this.root); this.mats = [];
    const cache = new Map();
    this.root.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      if (!cache.has(o.material)) { const m = o.material.clone(); if (tint) m.color.multiply(new THREE.Color(tint)); cache.set(o.material, m); this.mats.push(m); }
      o.material = cache.get(o.material);
    });
  }
  hold(name, model, scale = 1) { // 把武器掛到手上
    const bone = this.root.getObjectByName(name); if (!bone) return;
    const w = A[model].scene.clone(); w.scale.setScalar(scale); bone.add(w);
  }
  play(name, loop = true, ts = 1, fade = 0.14) {
    const clip = this.clips[name]; if (!clip) return;
    if (loop && this.cur === name) { this.curA.timeScale = ts; return; }
    const a = this.acts[name] || (this.acts[name] = this.mixer.clipAction(clip));
    a.reset(); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true; a.timeScale = ts; a.fadeIn(fade).play();
    if (this.curA && this.curA !== a) this.curA.fadeOut(fade);
    this.curA = a; this.cur = name;
  }
  once(name, ts = 1, lock) { const clip = this.clips[name]; if (!clip) return; this.play(name, false, ts, 0.07); this.cur = null; this.lock = lock === undefined ? clip.duration / ts : lock; }
  emissive(hex, k) { for (const m of this.mats) { m.emissive.setHex(hex); m.emissiveIntensity = k; } }
  dispose() { this.mixer.stopAllAction(); for (const m of this.mats) m.dispose(); this.root.removeFromParent(); }
}
let hero = null;
const ents = new THREE.Group(); scene.add(ents);
let lvl = new THREE.Group(); scene.add(lvl);
let torchSpots = [], flames = null, stairFx = null;

const VIS = {
  minion: ['skel_minion', 1], imp: ['skel_minion', 0.68, 0x9fe08a], archer: ['skel_rogue', 1], brute: ['skel_warrior', 1.22],
  shaman: ['skel_mage', 1], boss: ['skel_warrior', 2.0, 0xff9a80],
};
function ensureVis(e) {
  if (e.v) return e.v;
  const [model, sc, tint] = VIS[e.type];
  const c = new Char(model, CLIPS.skel, tint); c.base = e.elite ? 0x553300 : e.type === 'boss' ? 0x330800 : 0x000000; c.baseK = e.elite || e.type === 'boss' ? 1 : 0;
  c.root.scale.setScalar(sc * (e.elite ? 1.22 : 1));
  if (e.type === 'archer') c.hold('handslotr', 'w_crossbow');
  if (e.type === 'shaman') c.hold('handslotr', 'w_staff');
  if (e.type === 'brute') { c.hold('handslotr', 'w_axe'); c.hold('handslotl', 'w_shield_large_a'); }
  if (e.type === 'boss') { c.hold('handslotr', 'w_blade', 1.2); c.hold('handslotl', 'w_shield_large_a', 1.1); }
  c.emissive(c.base, c.baseK);
  c.root.position.set(e.x * U, 0, e.y * U); c.root.rotation.y = Math.PI / 2 - e.face; c.px = e.x; c.py = e.y;
  if (e.summoned) c.once('Spawn_Ground_Skeletons', 2.2); else c.play('Idle');
  if (e.elite) { const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); ring.scale.setScalar(e.r * U * 1.2 / c.root.scale.x); ring.position.y = 0.08; c.root.add(ring); c.ring = ring; }
  ents.add(c.root); e.v = c; return c;
}
function charOnce(e, name, ts, lock) { if (e.v) e.v.once(name, ts, lock); }
function toCorpse(e) {
  if (e.tele) { e.tele.visible = false; e.tele = null; }
  if (!e.v) return;
  const c = e.v; e.v = null; c.emissive(0, 0); if (c.ring) c.ring.visible = false;
  c.once(e.type === 'boss' ? 'Death_A' : 'Death_C_Skeletons', e.type === 'boss' ? 0.8 : 1.4, 99);
  corpses.push({ c, t: e.type === 'boss' ? 4 : 2.6 });
}
function killVis(o) { if (o.v) { if (o.v.dispose) o.v.dispose(); else o.v.removeFromParent(); o.v = null; } if (o.light) { o.light.intensity = 0; o.light.userData.used = false; o.light = null; } }
function clearEntities() {
  for (const e of enemies) killVis(e); for (const s of shots) killVis(s); for (const d of drops) killVis(d); for (const o of props) killVis(o);
  for (const c of corpses) c.c.dispose(); corpses = [];
  for (const r of rings) r.visible = false; for (const s of slashes) s.visible = false; for (const t of teles) t.visible = false;
  for (const l of fxLights) { l.intensity = 0; l.userData.t = 0; l.userData.used = false; }
}

// ----- 關卡幾何 -----
function inst(name, list) { // list: [{m: Matrix4, c: Color}]
  if (!list.length) return;
  let src; A[name].scene.traverse(o => { if (o.isMesh && !src) src = o; });
  const chunks = {}, tmp = new THREE.Matrix4();
  for (const it of list) { const k = Math.floor(it.m.elements[12] / 48) + ',' + Math.floor(it.m.elements[14] / 40); (chunks[k] || (chunks[k] = [])).push(it); }
  for (const k in chunks) {
    const im = new THREE.InstancedMesh(src.geometry, src.material, chunks[k].length);
    chunks[k].forEach((it, i) => { tmp.multiplyMatrices(it.m, src.matrixWorld); im.setMatrixAt(i, tmp); im.setColorAt(i, it.c || WHITE); });
    im.castShadow = im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); lvl.add(im);
  }
}
const WHITE = new THREE.Color(0xffffff), YAXIS = new THREE.Vector3(0, 1, 0);
const mat4 = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(YAXIS, ry), new THREE.Vector3(sx, sy, sz));
const hash = (x, y) => { let n = x * 374761393 + y * 668265263; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967295; };

function buildLevel3D() {
  scene.remove(lvl); lvl.traverse(o => { if (o.isInstancedMesh) o.dispose(); else if (o.isMesh && o.userData.own) { o.geometry.dispose(); o.material.dispose(); } });
  lvl = new THREE.Group(); scene.add(lvl); torchSpots = [];
  const tint = new THREE.Color(pal.tint);
  hemi.color.setHex(pal.hemi); for (const l of wallLights) l.color.setHex(pal.torch);
  const inRoom = (x, y) => rooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const L = { floor_tile_large: [], floor_tile_large_rocks: [], floor_dirt_large: [], floor_dirt_large_rocky: [], wall: [], wall_cracked: [], torch_mounted: [], floor_tile_big_grate_open: [], pillar: [] };
  const BAN = ['banner_patternA_red', 'banner_patternB_blue', 'banner_shield_green']; for (const b of BAN) L[b] = [];
  const LOW = 1.5, HI = 4;
  const capPos = [], capNrm = [];
  const quad = (a, b, c, d, n) => { for (const v of [a, b, c, a, c, d]) { capPos.push(v[0], v[1], v[2]); capNrm.push(n[0], n[1], n[2]); } };
  const nearFloor = (x, y) => { for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (!solid(x + i, y + j)) return true; return false; };

  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const h = hash(x, y), X = x * 4, Z = y * 4;
    if (map[y * MW + x] === 0) {
      const c = tint.clone().multiplyScalar(0.82 + h * 0.3);
      if (x === stairs.tx && y === stairs.ty) L.floor_tile_big_grate_open.push({ m: mat4(X + 2, 0, Z + 2), c });
      else {
        const nm = inRoom(x, y) ? (h > 0.88 ? 'floor_tile_large_rocks' : 'floor_tile_large') : (h > 0.7 ? 'floor_dirt_large_rocky' : 'floor_dirt_large');
        L[nm].push({ m: mat4(X + 2, 0, Z + 2, Math.floor(h * 4) * Math.PI / 2), c });
      }
      const wc = k => tint.clone().multiplyScalar(0.85 + hash(x * 3 + k, y * 7) * 0.25);
      const wn = hash(x + 11, y + 5) > 0.9 ? 'wall_cracked' : 'wall';
      if (solid(x, y - 1)) L[wn].push({ m: mat4(X + 2, 0, Z), c: wc(1) });
      if (solid(x, y + 1)) L.wall.push({ m: mat4(X + 2, 0, Z + 4, 0, 1, LOW / HI, 1), c: wc(2) });
      if (solid(x - 1, y)) L.wall.push({ m: mat4(X, 0, Z + 2, Math.PI / 2), c: wc(3) });
      if (solid(x + 1, y)) L.wall.push({ m: mat4(X + 4, 0, Z + 2, Math.PI / 2, 1, LOW / HI, 1), c: wc(4) });
    } else if (nearFloor(x, y)) {
      // 牆頂：實心牆格蓋一塊暗色石頂。只有「房間北側、西側的背牆」是全高，
      // 其餘（鏡頭這一側的南牆、東牆）都做矮，才不會擋住畫面
      const back = !solid(x, y + 1) || !solid(x + 1, y) || !solid(x + 1, y + 1), front = !solid(x, y - 1) || !solid(x - 1, y);
      const h2 = (back && !front ? HI : LOW) - 0.02, x0 = X, x1 = X + 4, z0 = Z, z1 = Z + 4;
      quad([x0, h2, z1], [x1, h2, z1], [x1, h2, z0], [x0, h2, z0], [0, 1, 0]);
      quad([x0, 0, z1], [x1, 0, z1], [x1, h2, z1], [x0, h2, z1], [0, 0, 1]);
      quad([x1, 0, z0], [x0, 0, z0], [x0, h2, z0], [x1, h2, z0], [0, 0, -1]);
      quad([x0, 0, z0], [x0, 0, z1], [x0, h2, z1], [x0, h2, z0], [-1, 0, 0]);
      quad([x1, 0, z1], [x1, 0, z0], [x1, h2, z0], [x1, h2, z1], [1, 0, 0]);
    }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(capNrm, 3));
  const cap = new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ color: new THREE.Color(0x2a2630).multiply(tint) }));
  cap.userData.own = true; cap.receiveShadow = true; cap.castShadow = true; lvl.add(cap);
  // 地板下面墊一片黑，免得縫隙透光
  const under = new THREE.Mesh(new THREE.PlaneGeometry(MW * 4, MH * 4), new THREE.MeshBasicMaterial({ color: 0x020203 }));
  under.rotation.x = -Math.PI / 2; under.position.set(MW * 2, -0.12, MH * 2); under.userData.own = true; lvl.add(under);

  // 房間裝飾：北牆掛火把與旗幟，大房間角落放石柱
  for (const r of rooms) {
    let k = 0;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!solid(x, r.y - 1)) continue;
      const X = x * 4 + 2, Z = r.y * 4 + 0.5;
      if ((x - r.x) % 3 === 1) { L.torch_mounted.push({ m: mat4(X, 2.3, Z) }); torchSpots.push({ x: X, y: 3.1, z: Z + 0.45 }); }
      else if ((x - r.x) % 3 === 2 && hash(x, r.y) > 0.35) L[BAN[(k++ + r.x) % 3]].push({ m: mat4(X, 0.2, r.y * 4) });
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      if (!solid(r.x - 1, y) || (y - r.y) % 4 !== 2) continue;
      const X = r.x * 4 + 0.5, Z = y * 4 + 2;
      L.torch_mounted.push({ m: mat4(X, 2.3, Z, Math.PI / 2) }); torchSpots.push({ x: X + 0.45, y: 3.1, z: Z });
    }
    if (r.w >= 8 && r.h >= 7) for (const cx of [r.x * 4 + 1.1, (r.x + r.w) * 4 - 1.1]) L.pillar.push({ m: mat4(cx, 0, r.y * 4 + 1.1, 0, 0.8, 1, 0.8), c: tint });
  }
  for (const n in L) inst(n, L[n]);
  // 火焰
  flames = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.torch).lerp(WHITE, 0.35) }), Math.max(1, torchSpots.length));
  flames.frustumCulled = false; flames.userData.own = true; flames.count = torchSpots.length; lvl.add(flames);
  // 樓梯光柱
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 9, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffcf6b, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.set(stairs.x * U, 4.4, stairs.y * U); beam.userData.own = true; lvl.add(beam);
  const sl = new THREE.PointLight(0xffcf6b, 30, 16, 1.6); sl.position.set(stairs.x * U, 2, stairs.y * U); lvl.add(sl);
  stairFx = { beam, sl };
  camReady = false;
}

// ----- 特效 -----
const ringGeo = (() => { const g = new THREE.RingGeometry(0.93, 1, 64); g.rotateX(-Math.PI / 2); return g; })();
const rings = []; // 擴散光環
function fxRing(x, y, R, color, dur) {
  let r = rings.find(r => !r.visible);
  if (!r) { if (rings.length > 14) return; r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); rings.push(r); scene.add(r); }
  r.visible = true; r.material.color.setHex(color); r.position.set(x * U, 0.15, y * U); r.userData = { t: 0, dur, R: R * U }; r.scale.setScalar(0.01);
}
function arcGeo(ri, ro, half, n = 20) { // 水平面上的扇形弧（中心角 0 朝 +x）
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) { const a = -half + 2 * half * i / n; pos.push(Math.cos(a) * ri, 0, Math.sin(a) * ri, Math.cos(a) * ro, 0, Math.sin(a) * ro); uv.push(i / n, 0, i / n, 1); if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g;
}
// 揮砍弧：沿著弧線掃過去，外緣較亮
const slashMat = () => new THREE.ShaderMaterial({
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { k: { value: 1 }, col: { value: new THREE.Color(0xfff0c8) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform float k; uniform vec3 col; varying vec2 vUv; void main(){ float head=1.-k; float sweep=smoothstep(head-.75,head+.25,vUv.x)*smoothstep(0.,.1,1.-vUv.x)*smoothstep(0.,.1,vUv.x); float edge=pow(vUv.y,2.4); float a=sweep*edge*min(1.,k*2.2); gl_FragColor=vec4(col*a*1.7,a); }',
});
const slashGeo = arcGeo(2.2, 6.6, 1.15), whirlGeo = arcGeo(4.5, 8.8, 1.3);
const slashes = [];
function fxSlash(x, y, a, combo) {
  let s = slashes.find(s => !s.visible);
  if (!s) { if (slashes.length > 5) return; s = new THREE.Mesh(slashGeo, slashMat()); s.frustumCulled = false; slashes.push(s); scene.add(s); }
  s.visible = true; s.position.set(x * U, 1.3, y * U); s.rotation.set(0, -a, 0); s.scale.set(1, 1, combo === 1 ? -1 : 1); s.userData.t = 0;
}
const whirlFx = [0, 1].map(() => { const w = new THREE.Mesh(whirlGeo, slashMat()); w.visible = false; w.frustumCulled = false; w.material.uniforms.col.value.setHex(0xc8e4ff); scene.add(w); return w; });
const teles = []; // 衝撞預警
const teleGeo = (() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.translate(0.5, 0, 0); return g; })();
function fxFlash(x, y, color, dur) {
  const l = fxLights.find(l => l.userData.t <= 0 && !l.userData.used); if (!l) return;
  l.color.setHex(color); l.position.set(x * U, 2, y * U); l.userData.t = dur; l.userData.dur = dur; l.userData.peak = 160;
}
// 粒子系統（加色混合的光點）
const PMAX = 700;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 4), pSize = new Float32Array(PMAX);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('pcolor', new THREE.BufferAttribute(pCol, 4)); pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
const pMat = new THREE.ShaderMaterial({
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, uniforms: { scale: { value: 1 } },
  vertexShader: 'attribute float size; attribute vec4 pcolor; varying vec4 vC; uniform float scale; void main(){ vC=pcolor; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*scale/(-mv.z); gl_Position=projectionMatrix*mv; }',
  fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.05,d)*vC.a; gl_FragColor=vec4(vC.rgb*a,a); }',
});
const pPoints = new THREE.Points(pGeo, pMat); pPoints.frustumCulled = false; scene.add(pPoints);
const colCache = {}; const colOf = c => colCache[c] || (colCache[c] = new THREE.Color(c));

const shotGeo = new THREE.SphereGeometry(1, 12, 8);
const beamGeo = new THREE.CylinderGeometry(0.1, 0.1, 8, 8, 1, true);
const kitClone = (name, s = 1) => { const o = A[name].scene.clone(); o.scale.setScalar(s); return o; };
function tintClone(name, s, emissive, k) {
  const o = kitClone(name, s), mats = [];
  o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.emissive.setHex(emissive); m.material.emissiveIntensity = k; mats.push(m.material); } });
  o.dispose = () => { for (const m of mats) m.dispose(); o.traverse(m => { if (m.userData.ownMat) m.material.dispose(); }); o.removeFromParent(); };
  return o;
}

const v3 = new THREE.Vector3(), ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1), ndc = new THREE.Vector2(), tmpM = new THREE.Matrix4();
function project(x, h, y) { v3.set(x * U, h, y * U).project(camera); return [(v3.x * 0.5 + 0.5) * W, (-v3.y * 0.5 + 0.5) * H, v3.z < 1]; }

let quality = 2, autoQ = true, fpsAcc = 0, fpsN = 0, fpsT = 0;
function applyQuality() {
  const mobile = touchMode || Math.min(innerWidth, innerHeight) < 600;
  dpr = Math.min(window.devicePixelRatio || 1, quality === 2 ? 2 : quality === 1 ? 1.5 : 1);
  renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
  moon.castShadow = quality > 0; moon.shadow.mapSize.setScalar(quality === 2 && !mobile ? 2048 : 1024);
  if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; }
  pMat.uniforms.scale.value = H * dpr / (2 * Math.tan(camera.fov * Math.PI / 360)) * 0.1;
}
function resize() {
  W = innerWidth; H = innerHeight;
  const k = Math.min(window.devicePixelRatio || 1, 2); ov.width = W * k; ov.height = H * k;
  camera.aspect = W / H; camera.fov = W < H ? 50 : 34; camera.updateProjectionMatrix();
  applyQuality();
}

function render3d(dt) {
  // --- 鏡頭 ---
  const cm = CAMS[camMode], kk = camReady ? 1 - Math.pow(0.002, dt) : 1;
  camCur.yaw += (cm.yaw - camCur.yaw) * kk; camCur.pitch += (cm.pitch - camCur.pitch) * kk;
  let D = cm.dist; const halfW = Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
  if (camera.aspect < 1) D = Math.max(D * 0.8, 7.5 / halfW * (cm.dist / 39)); // 直式螢幕拉遠一點，左右才看得到
  camCur.dist += (D - camCur.dist) * kk;
  const pr = camCur.pitch * Math.PI / 180;
  camOff.set(Math.sin(camCur.yaw) * Math.cos(pr), Math.sin(pr), Math.cos(camCur.yaw) * Math.cos(pr)).multiplyScalar(camCur.dist);
  const lead = touchMode ? 0 : 1.6; // 稍微往瞄準方向偏，前方看得比較遠
  v3.set(p.x * U + Math.cos(p.aim) * lead, 1.2, p.y * U + Math.sin(p.aim) * lead);
  if (!camReady) { camTgt.copy(v3); camReady = true; } else camTgt.lerp(v3, 1 - Math.pow(0.0005, dt));
  camera.position.copy(camTgt).add(camOff);
  if (shake > 0) { camera.position.x += rand(-1, 1) * shake * 0.035; camera.position.y += rand(-1, 1) * shake * 0.035; }
  camera.lookAt(camTgt);
  scene.fog.near = camCur.dist + 6; scene.fog.far = camCur.dist + 52;

  // --- 燈光 ---
  const fl = 1 + Math.sin(time * 11) * 0.06 + Math.sin(time * 27) * 0.04;
  torch.position.set(p.x * U, 4.6, p.y * U); torch.intensity = 62 * fl;
  moon.position.set(p.x * U - 14, 34, p.y * U + 12); moon.target.position.set(p.x * U, 0, p.y * U);
  torchSpots.sort((a, b) => ((a.x - camTgt.x) ** 2 + (a.z - camTgt.z) ** 2) - ((b.x - camTgt.x) ** 2 + (b.z - camTgt.z) ** 2));
  wallLights.forEach((l, i) => { const s = torchSpots[i]; if (s) { l.position.set(s.x + 0.5, s.y, s.z + 0.5); l.intensity = 42 * (1 + Math.sin(time * 13 + s.x) * 0.1); } else l.intensity = 0; });
  torchSpots.forEach((s, i) => {
    const k = 1 + Math.sin(time * 17 + s.x * 3) * 0.2; tmpM.makeScale(k, k * 1.5, k).setPosition(s.x, s.y + 0.1, s.z); flames.setMatrixAt(i, tmpM);
    if (i < 8 && dt > 0 && Math.random() < 0.12) parts.push(mkPart(s.x / U, s.z / U, s.y + 0.2, rand(-4, 4), rand(-4, 4), rand(1, 2.5), '#ff9a40', 0.6, 3, -1));
  });
  flames.instanceMatrix.needsUpdate = true;
  for (const l of fxLights) if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = Math.max(0, l.userData.t / l.userData.dur) * l.userData.peak; }
  stairFx.beam.visible = stairFx.sl.visible = stairs.open; stairFx.beam.material.opacity = 0.14 + Math.sin(time * 3) * 0.05;

  // --- 主角 ---
  if (!hero) { hero = new Char('knight', CLIPS.knight); ents.add(hero.root); hero.face = 0; }
  hero.root.position.set(p.x * U, 0, p.y * U);
  hero.lock -= dt;
  if (state !== 'dead') {
    let face = p.aim;
    if (p.whirlT > 0) { hero.face += dt * 22; face = null; hero.play('2H_Melee_Attack_Spinning', true, 1.6); hero.lock = 0; }
    else if (p.dashT > 0) face = Math.atan2(p.dashY, p.dashX);
    else if (hero.lock <= 0) {
      if (p.moving) { hero.play('Running_A', true, 1.25 * (1 + p.st.move / 100)); face = p.moveA; }
      else hero.play('Idle');
    }
    if (face !== null) hero.face += angDiff(face, hero.face) * (1 - Math.pow(1e-7, dt));
  }
  hero.root.rotation.y = Math.PI / 2 - hero.face;
  hero.emissive(p.hurtT > 0 ? 0xff2020 : 0x000000, p.hurtT > 0 ? 0.8 : 0);
  hero.mixer.update(dt);
  whirlFx.forEach((w, i) => { w.visible = p.whirlT > 0; if (w.visible) { w.position.set(p.x * U, 1.2, p.y * U); w.rotation.y = -time * 20 + i * Math.PI; w.material.uniforms.k.value = 0.5; } });

  // --- 敵人 ---
  for (const e of enemies) {
    const d = Math.hypot(e.x - camTgt.x / U, e.y - camTgt.z / U);
    if (d > 420) { if (e.v) e.v.root.visible = false; continue; }
    const c = ensureVis(e); c.root.visible = true;
    const sp = Math.hypot(e.x - c.px, e.y - c.py) / Math.max(dt, 0.001); c.px = e.x; c.py = e.y;
    c.root.position.set(e.x * U, 0, e.y * U);
    c.root.rotation.y += angDiff(Math.PI / 2 - e.face, c.root.rotation.y) * (1 - Math.pow(1e-5, dt));
    c.lock -= dt;
    if (e.freeze > 0) c.emissive(0x2050c0, 0.55); else if (e.flash > 0) c.emissive(0xffffff, 0.9); else c.emissive(c.base, c.baseK);
    if (e.freeze <= 0) {
      if (c.lock <= 0) {
        if (e.ch && !e.ch.wind) c.play('Running_C', true, 2.2);
        else if (sp > 18 && e.awake) c.play('Running_A', true, clamp(sp / 75, 0.7, 1.9));
        else c.play(e.awake ? 'Idle_Combat' : 'Idle');
      }
      c.mixer.update(dt);
    }
    if (c.ring) c.ring.rotation.y += dt;
    if (e.ch && e.ch.wind) { // 衝撞預警
      if (!e.tele) { let t = teles.find(t => !t.visible); if (!t && teles.length < 4) { t = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })); teles.push(t); scene.add(t); } e.tele = t; }
      if (e.tele) { e.tele.visible = true; e.tele.position.set(e.x * U, 0.12, e.y * U); e.tele.rotation.y = -e.ch.a; e.tele.scale.set(23, 1, e.r * U * 2); e.tele.material.opacity = 0.2 + (1 - e.ch.t / 0.7) * 0.35; }
    } else if (e.tele) { e.tele.visible = false; e.tele = null; }
  }
  for (const c of corpses) {
    c.t -= dt; c.c.mixer.update(dt);
    if (c.t < 0.8) c.c.root.position.y -= dt * 1.6;
    if (c.t <= 0) c.c.dispose();
  }
  corpses = corpses.filter(c => c.t > 0);

  // --- 投射物 ---
  for (const s of shots) {
    if (!s.v) {
      s.v = new THREE.Mesh(shotGeo, new THREE.MeshBasicMaterial({ color: s.col })); s.v.dispose = function () { this.material.dispose(); this.removeFromParent(); }; scene.add(s.v);
      const r = s.r * U * (s.fire ? 0.6 : 0.55);
      if (s.arrow) s.v.scale.set(r * 3.4, r * 0.5, r * 0.5); else s.v.scale.setScalar(r);
      s.v.rotation.y = -Math.atan2(s.vy, s.vx);
      if (s.fire) { const l = fxLights.find(l => l.userData.t <= 0 && !l.userData.used); if (l) { l.userData.used = true; l.color.setHex(0xff8030); l.intensity = 60; s.light = l; } }
    }
    s.v.position.set(s.x * U, 1.3, s.y * U);
    if (s.light) s.light.position.set(s.x * U, 1.6, s.y * U);
    if (!s.fire && !s.arrow && dt > 0 && Math.random() < 0.5) parts.push(mkPart(s.x, s.y, 1.3, 0, 0, 0, s.col, 0.25, 4));
  }
  // --- 木桶、寶箱 ---
  for (const o of props) {
    if (!o.v) {
      if (o.kind === 'barrel') { o.v = kitClone(o.skin, o.skin === 'barrel_large' ? 0.72 : 0.8); o.v.rotation.y = o.rot; }
      else { o.v = kitClone(o.gold ? 'chest_gold' : 'chest', 1.05); o.v.traverse(c => { if (/lid/i.test(c.name) && !o.lid) o.lid = c; }); }
      o.v.position.set(o.x * U, 0, o.y * U); lvl.add(o.v);
    }
    if (o.kind === 'chest' && o.open && o.lid && o.lid.rotation.x > -1.9) o.lid.rotation.x -= dt * 6;
  }
  // --- 掉落物 ---
  for (const d of drops) {
    if (!d.v) {
      if (d.kind === 'gold') d.v = tintClone('coin', 2.2, 0xffb020, 0.5);
      else if (d.kind === 'hp' || d.kind === 'mp') d.v = tintClone('bottle_A_labeled_green', 1.5, d.kind === 'hp' ? 0xff1010 : 0x1060ff, 1.6);
      else {
        d.v = tintClone(d.it.slot === 'weapon' ? 'w_blade' : d.it.slot === 'armor' ? 'w_shield_large_a' : 'coin_stack_small', d.it.slot === 'ring' ? 1.6 : 1.1, colOf(RAR[d.it.rarity].c).getHex(), 0.35);
        if (d.it.slot !== 'ring') d.v.children.forEach(c => { c.rotation.x = Math.PI / 2 - 0.2; c.position.y = 0.35; });
        const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: RAR[d.it.rarity].c, transparent: true, opacity: 0.14 + d.it.rarity * 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        const sy = 0.35 + d.it.rarity * 0.15; b.scale.set(1 + d.it.rarity * 0.5, sy, 1 + d.it.rarity * 0.5); b.position.y = 4 * sy; b.userData.ownMat = true; d.v.add(b);
      }
      scene.add(d.v); d.sp = rand(0, 6);
    }
    const hop = d.t < 0.3 ? Math.sin(d.t / 0.3 * Math.PI) * 1.5 : 0;
    d.v.position.set(d.x * U, (d.kind === 'gold' ? 0.5 : 0.1) + hop + (d.kind === 'item' ? 0 : Math.sin(time * 4 + d.sp) * 0.12), d.y * U);
    if (d.kind === 'gold') { d.v.rotation.z = Math.PI / 2; d.v.rotation.y = time * 4 + d.sp; }
    else if (d.kind === 'item') d.v.rotation.y = time * 1.2 + d.sp;
  }
  // --- 光環、揮砍 ---
  for (const r of rings) if (r.visible) { const u = r.userData; u.t += dt; const k = u.t / u.dur; if (k >= 1) { r.visible = false; continue; } const s = u.R * (0.15 + 0.85 * (1 - (1 - k) ** 2)); r.scale.set(s, 1, s); r.material.opacity = (1 - k) * 0.75; }
  for (const s of slashes) if (s.visible) { s.userData.t += dt; const k = 1 - s.userData.t / 0.2; if (k <= 0) { s.visible = false; continue; } s.material.uniforms.k.value = k; s.position.set(p.x * U, 1.3, p.y * U); }
  // --- 粒子 ---
  const n = Math.min(parts.length, PMAX);
  for (let i = 0; i < n; i++) {
    const q = parts[i], c = colOf(q.c), a = clamp(q.t / q.life * 1.6, 0, 1);
    pPos[i * 3] = q.x * U; pPos[i * 3 + 1] = q.h; pPos[i * 3 + 2] = q.y * U;
    pCol[i * 4] = c.r; pCol[i * 4 + 1] = c.g; pCol[i * 4 + 2] = c.b; pCol[i * 4 + 3] = a; pSize[i] = q.r * (0.5 + a * 0.5);
  }
  pGeo.setDrawRange(0, n); pGeo.attributes.position.needsUpdate = pGeo.attributes.pcolor.needsUpdate = pGeo.attributes.size.needsUpdate = true;

  renderer.render(scene, camera);
  drawOverlay();
}

function drawOverlay() {
  const c = octx, k = ov.width / W;
  c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, W, H); c.textAlign = 'center';
  for (const e of enemies) {
    if (!e.v || !e.v.root.visible || e.type === 'boss' || (e.hp >= e.maxHp && !e.elite)) continue;
    const [x, y, ok] = project(e.x, (e.type === 'brute' ? 3.4 : e.type === 'imp' ? 2 : 2.9) * (e.elite ? 1.2 : 1), e.y); if (!ok) continue;
    const w = e.elite ? 46 : 34;
    c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
    c.fillStyle = e.elite ? '#ffd84a' : '#e44'; c.fillRect(x - w / 2, y, w * Math.max(0, e.hp / e.maxHp), 4);
    if (e.elite) { c.font = '12px sans-serif'; c.fillStyle = '#ffd84a'; c.strokeStyle = '#000'; c.lineWidth = 3; c.strokeText('菁英 ' + ET[e.type].n, x, y - 5); c.fillText('菁英 ' + ET[e.type].n, x, y - 5); }
  }
  c.font = '13px sans-serif';
  for (const d of drops) if (d.kind === 'item' && d.v) {
    const [x, y, ok] = project(d.x, 1.6, d.y); if (!ok || x < -50 || x > W + 50) continue;
    const w = c.measureText(d.it.name).width + 10; c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(x - w / 2, y - 14, w, 18);
    c.fillStyle = RAR[d.it.rarity].c; c.fillText(d.it.name, x, y);
  }
  for (const t of texts) {
    const [x, y, ok] = project(t.x, 2.9, t.y); if (!ok) continue;
    const age = 0.9 - t.t, yy = y - age * 46 - (age < 0.12 ? Math.sin(age / 0.12 * Math.PI) * 8 : 0);
    c.globalAlpha = clamp(t.t * 2.5, 0, 1); c.font = `bold ${t.size}px sans-serif`; c.lineWidth = 3.5; c.strokeStyle = '#000'; c.strokeText(t.s, x, yy); c.fillStyle = t.c; c.fillText(t.s, x, yy);
  }
  c.globalAlpha = 1;
  if (joy.id !== null) {
    c.strokeStyle = 'rgba(255,255,255,.3)'; c.lineWidth = 3; c.beginPath(); c.arc(joy.ox, joy.oy, 52, 0, 6.283); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.3)'; c.beginPath(); c.arc(joy.ox + joy.x * 52, joy.oy + joy.y * 52, 24, 0, 6.283); c.fill();
  }
}
function drawMini() {
  mctx.clearRect(0, 0, MW, MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (explored[y * MW + x] && map[y * MW + x] === 0) { mctx.fillStyle = 'rgba(200,190,220,.55)'; mctx.fillRect(x, y, 1, 1); }
  if (stairs.open && explored[stairs.ty * MW + stairs.tx]) { mctx.fillStyle = '#ffcf6b'; mctx.fillRect(stairs.tx - 1, stairs.ty - 1, 2, 2); }
  if (boss) { mctx.fillStyle = '#f44'; mctx.fillRect(Math.floor(boss.x / T) - 1, Math.floor(boss.y / T) - 1, 2, 2); }
  mctx.fillStyle = '#5f5'; mctx.fillRect(Math.floor(p.x / T) - 0.5, Math.floor(p.y / T) - 0.5, 2, 2);
}

// ---------- 介面 ----------
let bannerT = null;
function banner(a, b) { const el = $('banner'); el.innerHTML = `${a}<small>${b || ''}</small>`; el.style.opacity = 1; clearTimeout(bannerT); bannerT = setTimeout(() => el.style.opacity = 0, 2200); }
const setBar = (id, v, max, txt) => { const b = $(id); b.firstElementChild.style.width = clamp(v / max * 100, 0, 100) + '%'; if (txt) b.lastElementChild.textContent = `${Math.ceil(v)} / ${max}`; };
let hudT = 0;
function hud() {
  setBar('hpBar', p.hp, p.st.hp, 1); setBar('mpBar', p.mp, p.st.mp, 1);
  for (const k of ['fire', 'whirl', 'nova', 'dash']) {
    const el = $('sk-' + k); el.lastElementChild.style.height = clamp(p.cd[k] / SK[k].cd * 100, 0, 100) + '%';
    el.classList.toggle('nomp', p.mp < SK[k].mp);
  }
  const bb = $('boss');
  if (boss && boss.awake) { bb.style.display = 'block'; $('bossName').textContent = boss.name; bb.querySelector('i').style.width = clamp(boss.hp / boss.maxHp * 100, 0, 100) + '%'; }
  else bb.style.display = 'none';
  if (++hudT % 10) return; // 其餘不常變的，每 10 幀更新一次
  $('fl').textContent = p.floor; $('lv').textContent = p.lvl; $('gold').textContent = p.gold;
  setBar('xpBar', p.xp, xpNeed(p.lvl));
  $('sk-hp').children[1].textContent = p.hpPot; $('sk-mpp').children[1].textContent = p.mpPot;
  $('sk-hp').classList.toggle('nomp', !p.hpPot); $('sk-mpp').classList.toggle('nomp', !p.mpPot);
  $('bagBtn').classList.toggle('glow', p.sp > 0 || p.inv.some(it => upgradeOf(it) > 0.5));
}

let sel = null;
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
  if (paused) { drawPanel(); joy.id = null; atkHeld = false; mouse.l = mouse.r = false; } else save();
}
$('panel').addEventListener('click', ev => {
  if (ev.target === $('panel')) return togglePanel(false);
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
function nextCam() { camMode = (camMode + 1) % CAMS.length; try { localStorage.setItem('ember-depths-cam', camMode); } catch (e) { /* 沒差 */ } if (state === 'play') banner('', '視角：' + CAMS[camMode].name); }
$('camBtn').onclick = nextCam;
try { camMode = (+localStorage.getItem('ember-depths-cam') || 0) % CAMS.length; } catch (e) { /* 沒差 */ }
$('act').onclick = descend;

function startGame(fresh) {
  if (fresh || !load()) newPlayer();
  state = 'play'; paused = false; $('menu').classList.remove('on'); sfx(300, 0.01, 'sine', 0.001); genFloor();
}
$('newBtn').onclick = () => { if (!hasSave() || confirm('要放棄目前的進度，重新開始嗎？')) startGame(true); };
$('contBtn').onclick = () => startGame(false);
$('reviveBtn').onclick = () => { $('dead').classList.remove('on'); resetRuntime(); refresh(); p.hp = p.st.hp; p.mp = p.st.mp; state = 'play'; if (hero) hero.lock = 0; genFloor(); };

// ---------- 輸入 ----------
addEventListener('keydown', e => {
  if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return; keys[e.code] = true;
  if (e.code === 'KeyI' || e.code === 'Tab' || e.code === 'KeyC' || e.code === 'KeyB') togglePanel();
  else if (e.code === 'Escape') { if (paused) togglePanel(false); }
  else if (e.code === 'KeyQ') cast('fire'); else if (e.code === 'KeyE') cast('whirl'); else if (e.code === 'KeyR') cast('nova');
  else if (e.code === 'Space') cast('dash'); else if (e.code === 'Digit1') cast('hp'); else if (e.code === 'Digit2') cast('mpp');
  else if (e.code === 'KeyF') descend(); else if (e.code === 'KeyV') nextCam();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; atkHeld = false; joy.id = null; });
cv.addEventListener('contextmenu', e => e.preventDefault());
const setTouch = on => { if (touchMode !== on) { touchMode = on; document.body.classList.toggle('touch', on); applyQuality(); } };
function mouseWorld() {
  ray.setFromCamera(ndc.set(mouse.x / W * 2 - 1, -(mouse.y / H) * 2 + 1), camera);
  if (ray.ray.intersectPlane(ground, v3)) { mouse.wx = v3.x / U; mouse.wy = v3.z / U; }
}
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
    if (e.pointerId === joy.id) { const dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, m = Math.hypot(dx, dy), k = Math.min(1, m / 52) / (m || 1); joy.x = dx * k; joy.y = dy * k; }
    return;
  }
  mouse.x = e.clientX; mouse.y = e.clientY;
});
const up = e => { if (e.pointerId === joy.id) joy.id = null; if (e.pointerType !== 'touch') { if (e.button === 0) mouse.l = false; else if (e.button === 2) mouse.r = false; } };
addEventListener('pointerup', up); addEventListener('pointercancel', up);
for (const b of document.querySelectorAll('.sk')) {
  b.addEventListener('pointerdown', e => { e.preventDefault(); if (e.pointerType === 'touch') setTouch(true); if (b.dataset.k === 'atk') { atkHeld = true; try { b.setPointerCapture(e.pointerId); } catch (er) { /* 舊瀏覽器 */ } } cast(b.dataset.k); });
  b.addEventListener('contextmenu', e => e.preventDefault());
}
const atkUp = () => { atkHeld = false; };
$('sk-atk').addEventListener('pointerup', atkUp); $('sk-atk').addEventListener('pointercancel', atkUp); $('sk-atk').addEventListener('lostpointercapture', atkUp);
// iOS：擋掉雙指縮放、雙擊放大、整頁被拖動
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault());
document.addEventListener('touchmove', e => { if (!e.target.closest('.box')) e.preventDefault(); }, { passive: false });
let lastTap = 0; document.addEventListener('touchend', e => { const n = Date.now(); if (n - lastTap < 320 && !e.target.closest('.box') && !e.target.closest('button')) e.preventDefault(); lastTap = n; }, { passive: false });
if (matchMedia('(pointer: coarse)').matches) { touchMode = true; document.body.classList.add('touch'); }
addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 250)); resize();
addEventListener('visibilitychange', () => { if (document.hidden) save(); });
cv.addEventListener('webglcontextlost', e => { e.preventDefault(); save(); });
cv.addEventListener('webglcontextrestored', () => location.reload());

// ---------- 主迴圈 ----------
let last = performance.now();
function frame(now) {
  const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
  if (state !== 'menu') {
    if (!touchMode) mouseWorld();
    if (hitStop > 0) hitStop -= dt;
    else if (state === 'play' && !paused) update(dt);
    render3d(paused ? 0 : hitStop > 0 ? dt * 0.15 : dt); hud();
    // 太慢就自動降畫質
    if (autoQ && !paused && raw < 0.5) { fpsAcc += raw; fpsN++; fpsT += raw; if (fpsT > 3) { if (fpsAcc / fpsN > 0.03 && quality > 0 && time > 4) { quality--; applyQuality(); } fpsAcc = fpsN = fpsT = 0; } }
  }
  requestAnimationFrame(frame);
}

loadAssets().then(() => {
  $('loading').style.display = 'none'; $('startBtns').style.display = 'block';
  if (!hasSave()) $('contBtn').style.display = 'none';
  requestAnimationFrame(frame);
}).catch(err => { $('loadTxt').textContent = '載入失敗：' + err.message + '（請重新整理）'; console.error(err); });

// 測試用
window.__game = {
  get p() { return p; }, get enemies() { return enemies; }, get state() { return state; }, get stairs() { return stairs; }, get boss() { return boss; }, get rooms() { return rooms; }, get props() { return props; },
  get quality() { return quality; }, setQuality(v) { autoQ = false; quality = v; applyQuality(); },
  update, descend, cast, keys, mouse, spawnEnemy, hurtPlayer, dropItem, makeItem, genFloor, setCam(i) { camMode = i; camReady = false; }, info: () => renderer.info.render,
};
