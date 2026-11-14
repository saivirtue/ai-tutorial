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

// ---------- 音效與音樂（全部用 WebAudio 即時合成，沒有音檔） ----------
let actx = null, master = null, musicBus = null, muted = false, drone = null;
let musicT = 0, beat = 0, intensity = 0, musicTarget = 0, musicRoot = 110;
function audioInit() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = actx.createDynamicsCompressor(); comp.connect(actx.destination);
    master = actx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(comp);
    // 音樂走一條帶回音的支線，聽起來像在石室裡
    musicBus = actx.createGain(); musicBus.gain.value = 0.6;
    const dl = actx.createDelay(1), fb = actx.createGain(), lp = actx.createBiquadFilter();
    dl.delayTime.value = 0.37; fb.gain.value = 0.42; lp.type = 'lowpass'; lp.frequency.value = 1700;
    musicBus.connect(master); musicBus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(master);
    // 低沉的長音
    const f = actx.createBiquadFilter(), g = actx.createGain(), lfo = actx.createOscillator(), lg = actx.createGain();
    f.type = 'lowpass'; f.frequency.value = 170; g.gain.value = 0.11; lfo.frequency.value = 0.07; lg.gain.value = 70;
    lfo.connect(lg).connect(f.frequency); lfo.start();
    drone = [0, 1].map(i => { const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = musicRoot / 2 * (1 + i * 0.007); o.connect(f); o.start(); return o; });
    f.connect(g).connect(musicBus);
    musicT = actx.currentTime + 0.1; setInterval(tickMusic, 100);
  } catch (e) { actx = null; /* 沒有聲音也能玩 */ }
}
function sfx(freq, dur = 0.08, type = 'square', vol = 0.05, slide = 0, when = 0, bus) {
  if (!actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + when;
    if (!bus) freq *= 1 + (Math.random() - 0.5) * 0.07; // 每次音高略有不同，才不會像機關槍
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || master); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* 忽略 */ }
}
let noiseBuf = null;
function noise(dur = 0.15, vol = 0.08, lp = 1200, hp = 0, when = 0) {
  if (!actx) return;
  try {
    if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter(), t = actx.currentTime + when;
    s.buffer = noiseBuf; s.loop = true; f.type = 'lowpass'; f.frequency.setValueAtTime(lp, t); f.frequency.exponentialRampToValueAtTime(Math.max(80, lp * 0.3), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n = s.connect(f); if (hp) { const h = actx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; n = n.connect(h); }
    n.connect(g).connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  } catch (e) { /* 忽略 */ }
}
const SND = {
  // 揮擊與命中的音色跟著武器走；連續命中時音調一路往上爬
  swing: w => { const k = !w ? 1 : w.heavy ? 0.55 : w.n === '匕首' ? 1.5 : w.n === '斧' ? 0.8 : 1; noise(0.13 / Math.sqrt(k), 0.07, 5200 * k, 1400 * k); sfx(260 * k, 0.09 / k, 'triangle', 0.03, -120 * k); },
  hit: (w, n = 0) => { const k = !w ? 1 : w.heavy ? 0.6 : w.n === '匕首' ? 1.4 : 1; noise(0.07 / k, 0.13, 2400 * k); sfx(125 * k * semi(Math.min(n, 12)), 0.1, 'square', 0.06, -70); if (w && w.heavy) sfx(60, 0.25, 'sine', 0.16, -25); else sfx(rand(1800, 2600), 0.05, 'triangle', 0.018); },
  shoot: magic => { if (magic) { sfx(rand(600, 720), 0.16, 'sine', 0.05, 500); noise(0.08, 0.03, 6000, 3000); } else { sfx(rand(170, 200), 0.09, 'sawtooth', 0.05, -90); noise(0.05, 0.06, 4500, 1500); } },
  card: () => [659, 784, 988].forEach((f, i) => sfx(f, 0.18, 'triangle', 0.05, 0, i * 0.06)),
  burn: () => { noise(0.9, 0.2, 2500); sfx(110, 0.8, 'sawtooth', 0.12, 330); sfx(220, 0.8, 'sawtooth', 0.06, 660); },
  boom: (v = 1) => { noise(0.5, 0.2 * v, 1000); sfx(75, 0.4, 'sine', 0.16 * v, -42); },
  coin: () => { sfx(1320, 0.05, 'square', 0.018); sfx(1760, 0.1, 'square', 0.018, 0, 0.05); },
  step: () => noise(0.045, 0.028, rand(360, 640)),
  bones: () => { for (let i = 0; i < 4; i++) sfx(rand(500, 1100), 0.03, 'square', 0.022, 0, i * 0.035); noise(0.16, 0.06, 1500); },
  level: () => [523, 659, 784, 1047].forEach((f, i) => sfx(f, 0.25, 'triangle', 0.06, 0, i * 0.09)),
  zap: () => { noise(0.13, 0.08, 7000, 2500); sfx(1500, 0.11, 'sawtooth', 0.03, -1100); },
  hurt: () => { sfx(150, 0.16, 'sawtooth', 0.09, -80); noise(0.1, 0.08, 800); },
  spike: () => { noise(0.07, 0.05, 5000, 2000); sfx(880, 0.05, 'square', 0.015, -400); },
  shrine: () => [392, 523, 659, 784, 1047].forEach((f, i) => sfx(f, 0.6, 'sine', 0.05, 0, i * 0.08)),
};
const SCALE = [0, 3, 5, 7, 10, 12, 15];
const semi = n => Math.pow(2, n / 12);
function tickMusic() {
  if (!actx || actx.state !== 'running') return;
  if (musicT < actx.currentTime) musicT = actx.currentTime + 0.05;
  const step = 60 / (78 + intensity * 44) / 2; // 八分音符
  const prog = semi([0, -4, 3, -2][(beat >> 5) % 4]); // 每四小節換一個和弦
  while (musicT < actx.currentTime + 0.25) {
    const t = musicT - actx.currentTime, b = beat % 16, calm = state !== 'play' ? 1 : 1 - intensity;
    // 平靜層：稀疏的鐘聲
    if (b % 2 === 0 && Math.random() < 0.18 + calm * 0.3) { const n = musicRoot * 2 * prog * semi(pick(SCALE)); sfx(n, 1.4, 'sine', 0.035, 0, t, musicBus); sfx(n * 2, 0.5, 'sine', 0.01, 0, t, musicBus); }
    if (b === 0) { sfx(musicRoot * prog, step * 15, 'triangle', 0.03, 0, t, musicBus); sfx(musicRoot * prog * semi(beat % 32 ? 7 : 3), step * 15, 'triangle', 0.022, 0, t, musicBus); }
    // 戰鬥層：鼓與低音，依附近敵人多寡淡入
    if (intensity > 0.06 && state === 'play') {
      const v = intensity;
      if (b % 4 === 0) sfx(120, 0.2, 'sine', 0.3 * v, -85, t);
      if (b % 4 === 2) noise(0.07, 0.045 * v, 8000, 4000, t);
      if (b % 8 === 4) noise(0.16, 0.1 * v, 3200, 700, t);
      if (v > 0.7 && b % 2 === 1) noise(0.04, 0.03 * v, 9000, 5000, t);
      sfx(musicRoot / 2 * prog * semi([0, 0, 3, 0, 5, 0, 3, 7][b % 8]), step * 0.85, 'triangle', 0.1 * v, 0, t, musicBus);
      if (v > 0.9 && b % 4 === 0) sfx(musicRoot * 2 * prog * semi([0, 3, 7, 10][(beat >> 2) % 4]), step * 1.8, 'sawtooth', 0.025, 0, t, musicBus);
    }
    musicT += step; beat++;
  }
}

// ---------- 狀態 ----------
let state = 'menu', paused = false, time = 0;
let map, explored, flow, rooms, stairs, pal;
let enemies = [], shots = [], drops = [], props = [], parts = [], texts = [], corpses = [];
let blk = [], decos = [], fluff = [], traps = [], booms = [], shrine = null, hitBlk = null;
let merchant = null, stock = [], boxMsg = '', actMode = null, storeOpen = false;
let totems = [], pools = [], dangers = [], cards = null;
let p = null, boss = null, shake = 0, miniT = 0, flowT = 0, itemId = 1, fullMsgT = 0, hitStop = 0;
let W = 0, H = 0, dpr = 1;

const keys = {}, mouse = { x: 0, y: 0, l: false, r: false, wx: 0, wy: 0 };
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let touchMode = false, atkHeld = false;

// ---------- 新手提示：每則只出現一次 ----------
let tipSeen = {}, tipTimer = null;
try { tipSeen = JSON.parse(localStorage.getItem('ember-depths-tips')) || {}; } catch (e) { /* 沒差 */ }
const tipQ = [];
function tip(key, text) { // 同時觸發好幾則時排隊，一則一則出
  if (tipSeen[key]) return; tipSeen[key] = 1;
  try { localStorage.setItem('ember-depths-tips', JSON.stringify(tipSeen)); } catch (e) { /* 沒差 */ }
  tipQ.push(text); if (!tipTimer) nextTip();
}
function nextTip() {
  const el = $('tip'), text = tipQ.shift();
  if (!text) { el.style.opacity = 0; tipTimer = null; return; }
  el.textContent = '💡 ' + text; el.style.opacity = 1; tipTimer = setTimeout(nextTip, 5500);
}

// ---------- 難度 ----------
const DIFF = [
  { n: '普通', hp: 1, dmg: 1, cnt: 1, loot: 0, gold: 1 },
  { n: '困難', hp: 1.45, dmg: 1.35, cnt: 1.25, loot: 0.05, gold: 1.25 },
  { n: '煉獄', hp: 2, dmg: 1.75, cnt: 1.5, loot: 0.1, gold: 1.5 },
];
const diff = () => DIFF[(p && p.diff) || 0];

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
  hitBlk = null;
  const x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T), y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r) / T);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!solid(tx, ty)) continue;
    const cx = clamp(x, tx * T, tx * T + T), cy = clamp(y, ty * T, ty * T + T);
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  // 擺設（石柱、木箱…）：每格最多一個圓形障礙
  const R = r + 14, bx0 = Math.max(0, Math.floor((x - R) / T)), bx1 = Math.min(MW - 1, Math.floor((x + R) / T)), by0 = Math.max(0, Math.floor((y - R) / T)), by1 = Math.min(MH - 1, Math.floor((y + R) / T));
  for (let ty = by0; ty <= by1; ty++) for (let tx = bx0; tx <= bx1; tx++) {
    const b = blk[ty * MW + tx];
    if (b && (x - b.x) ** 2 + (y - b.y) ** 2 < (r + b.r) ** 2) { hitBlk = b; return true; }
  }
  return false;
}
function moveEnt(e, dx, dy) {
  let hit = false;
  if (!circleHits(e.x + dx, e.y, e.r)) e.x += dx;
  else { hit = true; if (hitBlk) { const m = (Math.sign(e.y - hitBlk.y) || 1) * Math.abs(dx) * 0.8; if (!circleHits(e.x, e.y + m, e.r)) e.y += m; } } // 沿著圓形障礙滑過去
  if (!circleHits(e.x, e.y + dy, e.r)) e.y += dy;
  else { hit = true; if (hitBlk) { const m = (Math.sign(e.x - hitBlk.x) || 1) * Math.abs(dy) * 0.8; if (!circleHits(e.x + m, e.y, e.r)) e.x += m; } }
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
  rooms = []; enemies = []; shots = []; drops = []; props = []; parts = []; texts = []; boss = null; pools = []; dangers = [];
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
  // 房間擺設（會擋路）、特殊房間、陷阱
  blk = new Array(MW * MH).fill(null); decos = []; fluff = []; traps = []; shrine = null; booms = []; p.phoenixUsed = false;
  const inRoom = (x, y) => rooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const addDeco = (tx, ty, model, r, s = 1, rot = 0) => {
    if (map[ty * MW + tx] !== 0 || blk[ty * MW + tx] || (tx === stairs.tx && ty === stairs.ty)) return null;
    const d = { x: (tx + 0.5) * T, y: (ty + 0.5) * T, r, model, s, rot }; blk[ty * MW + tx] = d; decos.push(d); return d;
  };
  // 每層起點站著一位商人
  merchant = addDeco(start.cx + 2, start.cy - 2, null, 10) || { x: (start.cx + 2.5) * T, y: (start.cy - 1.5) * T };
  stock = [makeItem(f, 1, 'weapon', f === 1 ? pick(['手弩', '法杖', '巨劍', '短劍']) : undefined), makeItem(f, Math.max(1, rollRarity())), makeItem(f + 1, Math.random() < 0.12 ? 3 : 2)]; boxMsg = '';
  const others = rooms.filter(r => r !== start && r !== far).sort(() => Math.random() - 0.5);
  const vault = others.length >= 3 && Math.random() < 0.6 ? others[0] : null;
  const shrineRoom = others.length >= 4 && Math.random() < 0.55 ? others[1] : null;
  for (const r of rooms) {
    if (r.w >= 8 && r.h >= 7) for (const [tx, ty] of [[r.x + 2, r.y + 2], [r.x + r.w - 3, r.y + 2], [r.x + 2, r.y + r.h - 3], [r.x + r.w - 3, r.y + r.h - 3]]) addDeco(tx, ty, 'pillar', 9, 0.85);
    if (r === start) continue;
    for (let i = irand(0, 3); i > 0; i--) { // 靠牆的雜物
      const top = Math.random() < 0.5, tx = irand(r.x, r.x + r.w - 1), ty = top ? r.y : r.y + r.h - 1;
      if (!solid(tx, top ? ty - 1 : ty + 1)) continue;
      const [m, rr, sc] = pick([['crates_stacked', 13, 0.85], ['keg', 11, 0.8], ['barrel_small_stack', 12, 0.9], ['table_medium', 13, 0.95]]);
      const d = addDeco(tx, ty, m, rr, sc, m === 'table_medium' ? 0 : irand(0, 3) * Math.PI / 2);
      if (d && m === 'table_medium') { fluff.push({ model: 'stool', x: d.x + rand(-6, 6), y: d.y + (top ? 21 : -21), s: 1, rot: rand(0, 6) }); fluff.push({ model: 'candle_triple', x: d.x, y: d.y, h: 0.95, s: 1, rot: rand(0, 6) }); }
    }
  }
  if (shrineRoom) { const d = addDeco(shrineRoom.cx + 1, shrineRoom.cy - 1, 'column', 8, 1.5); if (d) shrine = { x: d.x, y: d.y, used: false, kind: pick(['rage', 'haste', 'ward']) }; }
  // 尖刺陷阱：走道零星幾個，有些房間會有一整片
  const trapAt = (tx, ty) => { if (map[ty * MW + tx] === 0 && !blk[ty * MW + tx] && !(tx === stairs.tx && ty === stairs.ty) && !traps.some(t => t.tx === tx && t.ty === ty)) traps.push({ tx, ty, ph: ((tx * 3 + ty * 5) % 7) * 0.37, up: false }); };
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) if (map[y * MW + x] === 0 && !inRoom(x, y) && Math.random() < 0.045) trapAt(x, y);
  for (const r of others) if (r !== vault && r !== shrineRoom && Math.random() < 0.3) for (let i = irand(4, 7); i > 0; i--) trapAt(irand(r.x + 1, r.x + r.w - 2), irand(r.y + 1, r.y + r.h - 2));

  for (const r of rooms) {
    if (r === start) continue;
    if (r === far && isBossFloor(f)) { spawnEnemy('boss', far.cx * T + T / 2, far.cy * T + T / 2 - 50); continue; }
    if (r === vault) { // 寶庫：沒有守衛，但開箱會引來伏擊
      const vx = r.cx * T + T / 2, vy = r.cy * T + T / 2;
      props.push({ kind: 'chest', x: vx, y: vy, r: 15, open: false, gold: true, vault: true });
      for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283 + rand(-0.3, 0.3), rr = rand(38, 72); fluff.push({ model: pick(['coin_stack_large', 'coin_stack_medium', 'coin_stack_small']), x: vx + Math.cos(a) * rr, y: vy + Math.sin(a) * rr, s: 1.2, rot: rand(0, 6) }); }
      continue;
    }
    const n = Math.round((2.5 + r.w * r.h / 18 + Math.min(5, f * 0.6)) * diff().cnt);
    for (let i = 0; i < n; i++) {
      const s = freeSpot(r, 18), elite = Math.random() < (f >= 2 ? 0.12 : 0.05);
      spawnEnemy(rollType(f), s.x, s.y, elite);
    }
    if (Math.random() < 0.45) { const s = freeSpot(r, 16); props.push({ kind: 'chest', x: s.x, y: s.y, r: 15, open: false, gold: Math.random() < 0.15 }); }
    const nb = irand(1, 4);
    for (let i = 0; i < nb; i++) { const s = freeSpot(r, 12); props.push({ kind: 'barrel', x: s.x, y: s.y, r: 11, skin: Math.random() < 0.6 ? 'barrel_large' : 'box_large', rot: rand(0, 6.28) }); }
  }
  actMode = null; $('act').style.display = 'none';
  buildLevel3D();
  musicRoot = [110, 98, 123.47, 92.5, 103.83][Math.floor((f - 1) / 5) % 5];
  if (drone) drone.forEach((o, i) => o.frequency.setTargetAtTime(musicRoot / 2 * (1 + i * 0.007), actx.currentTime, 1.5));
  explore(); miniT = 0; flowT = 0;
  banner(`第 ${f} 層`, isBossFloor(f) ? '⚠️ 守關者就在這一層' : pal.name + (p.diff ? '・' + diff().n : ''));
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
// 武器類型決定普攻的打法
const WT = {
  sword: { n: '劍', cd: 0.42, range: 68, arc: 1.05, mult: 1, kb: 110, desc: '均衡的弧形揮砍' },
  dagger: { n: '匕首', cd: 0.26, range: 56, arc: 0.85, mult: 0.62, kb: 60, crit: 15, desc: '出手極快，暴擊 +15%' },
  axe: { n: '斧', cd: 0.52, range: 72, arc: 1.25, mult: 1.3, kb: 170, desc: '較慢，範圍大、擊退強' },
  great: { n: '巨劍', cd: 0.72, range: 90, arc: 1.5, mult: 1.9, kb: 240, heavy: 1, desc: '很慢，一刀掃一大片，會打斷敵人出手' },
  xbow: { n: '手弩', cd: 0.5, ranged: 1, mult: 0.9, kb: 70, spd: 640, pierce: 1, desc: '遠程，弩箭穿透一個敵人；第三發改成三連射' },
  staff: { n: '法杖', cd: 0.55, ranged: 1, mult: 0.75, kb: 40, spd: 420, homing: 1, aoe: 42, desc: '遠程，魔彈會追蹤並小範圍爆炸' },
};
const KIND2WT = { '短劍': 'dagger', '長劍': 'sword', '彎刀': 'sword', '戰斧': 'axe', '釘錘': 'axe', '巨劍': 'great', '手弩': 'xbow', '法杖': 'staff' };
const wtOf = it => WT[(it && KIND2WT[it.kind]) || 'sword'];
const BASES = { weapon: ['短劍', '長劍', '戰斧', '巨劍', '彎刀', '手弩', '法杖'], armor: ['皮甲', '鎖甲', '鱗甲', '戰袍'], ring: ['指環', '護符', '徽記'] };
// 傳說裝備各帶一個會改變打法的效果
const LEGFX = {
  chain: { slot: 'weapon', n: '雷鳴', d: '揮砍命中時，三成機率放出連鎖閃電，跳向附近 3 個敵人' },
  wave: { slot: 'weapon', n: '餘燼', d: '每第三下揮砍會射出一道穿透敵人的火焰劍氣' },
  frost: { slot: 'weapon', n: '霜牙', d: '揮砍讓敵人緩速，並有機會直接冰凍' },
  thorns: { slot: 'armor', n: '荊棘', d: '受到傷害時，反震周圍所有敵人' },
  phoenix: { slot: 'armor', n: '晨曦', d: '每層一次：受到致命傷時不會倒下，回復一半生命並引發爆炸' },
  blink: { slot: 'armor', n: '暮星', d: '閃避的冷卻時間減半，落地時引發爆炸' },
  twin: { slot: 'ring', n: '三焰', d: '火球變成一次射出三顆' },
  storm: { slot: 'ring', n: '風暴', d: '旋風斬持續更久，並把周圍的敵人吸過來' },
  boom: { slot: 'ring', n: '深淵', d: '敵人倒下時會爆炸，傷害附近的敵人' },
};
const BUFFS = { rage: ['⚔️', '狂怒', '攻擊 +50%', 0xff5030], haste: ['💨', '迅捷', '移動與攻擊速度 +35%', 0x50e0ff], ward: ['🛡️', '守護', '受到的傷害減半', 0xffe060] };
const fmt = (k, v) => `${STAT[k][0]} ${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)}${STAT[k][1] ? '%' : ''}`;

function rollRarity(min = 0) {
  const r = Math.random(), bonus = Math.min(0.1, p.floor * 0.004) + diff().loot;
  const q = r < 0.02 + bonus * 0.5 ? 3 : r < 0.12 + bonus ? 2 : r < 0.42 + bonus ? 1 : 0;
  return Math.max(q, min);
}
function makeItem(lvl, rarity, slot, kind) {
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
  const b = kind || pick(BASES[slot]);
  it.kind = b;
  if (rarity === 3) it.fx = pick(Object.keys(LEGFX).filter(k => LEGFX[k].slot === slot));
  it.name = rarity === 3 ? `${LEGFX[it.fx].n}之${b}` : rarity === 0 ? b : `${RAR[rarity].n}的${b}`;
  it.val = Math.round((5 + lvl * 3) * Math.pow(1 + rarity, 1.5));
  return it;
}
// 強化過的裝備（+N）每級讓所有數值多 12%
const iv = (it, v) => Math.round(v * (1 + 0.12 * (it.up || 0)) * 10) / 10;
const upCost = it => Math.round(30 * (it.lvl + 2) * Math.pow((it.up || 0) + 1, 1.4));
const TRAIN = { hp: ['體魄', '生命 +12'], dmg: ['力量', '攻擊 +2'], mp: ['心智', '魔力 +10、每秒回魔 +0.3'] };
const trainCost = k => Math.round(80 * Math.pow(1.3, p.train[k]));
const boxCost = () => 80 + p.floor * 40;
const priceOf = it => it.val * 5;
function calcStats(eq) {
  eq = eq || p.equip; const L = p.lvl;
  const tr = p.train || { hp: 0, dmg: 0, mp: 0 };
  const s = { dmg: 10 + 2 * (L - 1) + tr.dmg * 2, hp: 120 + 12 * (L - 1) + tr.hp * 12, mp: 50 + 5 * (L - 1) + tr.mp * 10, armor: 0, crit: 5, aspd: 0, move: 0, ls: 0, hpr: 1, mpr: 3 + tr.mp * 0.3 };
  for (const k in eq) { const it = eq[k]; if (!it) continue; for (const b in it.base) s[b] += iv(it, it.base[b]); for (const a of it.aff) s[a.k] += iv(it, a.v); }
  const pa = p.pas || {};
  s.crit += (wtOf(eq.weapon).crit || 0) + (pa.critboom || 0) * 8; s.aspd += (pa.haste || 0) * 12; s.mpr += (pa.mana || 0);
  s.dmg *= 1 + (pa.power || 0) * 0.12; s.hp *= 1 + (pa.vigor || 0) * 0.15; s.mp *= 1 + (pa.mana || 0) * 0.25;
  for (const k of ['dmg', 'hp', 'mp', 'armor']) s[k] = Math.round(s[k]);
  for (const k of ['crit', 'aspd', 'move', 'ls', 'hpr', 'mpr']) s[k] = Math.round(s[k] * 10) / 10;
  s.crit = Math.min(s.crit, 75); s.aspd = Math.min(s.aspd, 100); s.move = Math.min(s.move, 50); s.ls = Math.min(s.ls, 15);
  if (p.buff && p.buff.k === 'rage') s.dmg = Math.round(s.dmg * 1.5);
  if (p.buff && p.buff.k === 'haste') { s.move += 35; s.aspd += 35; }
  return s;
}
const power = s => s.dmg * (1 + s.crit / 100) * (1 + s.aspd / 100) * 4 + s.hp * (1 + s.armor / 100) * 0.5 + s.mp * 0.2 + s.move + s.ls * 6 + s.hpr * 4 + s.mpr * 4;
function refresh() { p.fx = {}; for (const k in p.equip) if (p.equip[k] && p.equip[k].fx) p.fx[p.equip[k].fx] = true; p.st = calcStats(); p.hp = Math.min(p.hp, p.st.hp); p.mp = Math.min(p.mp, p.st.mp); }

// ---------- 玩家 ----------
const SK = {
  fire: { n: '火球', i: '🔥', mp: 12, cd: 0.7, d: l => `爆炸造成 ${150 + l * 30}% 攻擊的範圍傷害` },
  whirl: { n: '旋風斬', i: '🌀', mp: 15, cd: 5, d: l => `原地旋轉，每次命中 ${60 + l * 12}% 攻擊` },
  nova: { n: '冰霜新星', i: '❄️', mp: 20, cd: 8, d: l => `${100 + l * 25}% 攻擊，並冰凍 ${(1.5 + l * 0.3).toFixed(1)} 秒` },
  leap: { n: '躍擊', i: '💢', mp: 14, cd: 6, d: l => `跳向目標砸地，${180 + l * 30}% 攻擊；跳躍中無敵` },
  volley: { n: '彈幕', i: '🎯', mp: 14, cd: 5, d: l => `扇形射出一排穿透飛刃，每發 ${60 + l * 12}%` },
  totem: { n: '烈焰圖騰', i: '🗿', mp: 20, cd: 12, d: l => `放一座圖騰 8 秒，自動射擊附近敵人，每發 ${50 + l * 12}%` },
  bolt: { n: '落雷', i: '⚡', mp: 14, cd: 4, d: l => `雷電劈向最近的幾個敵人，各 ${130 + l * 30}%` },
  dash: { n: '閃避', i: '💨', mp: 0, cd: 2.2 },
};
const SKILLS = ['fire', 'whirl', 'nova', 'leap', 'volley', 'totem', 'bolt'];
// 變體：改變技能的行為，各只能拿一次
const MODS = {
  'fire.split': ['fire', '分裂火球', '火球爆炸後再分裂出 3 顆小火球'],
  'fire.pool': ['fire', '燃燒之地', '火球爆炸處留下 3 秒火海'],
  'whirl.reflect': ['whirl', '刃牆', '旋風斬期間把飛來的投射物彈回去'],
  'whirl.long': ['whirl', '不息旋風', '旋風斬多轉 0.8 秒，而且不會減速'],
  'nova.shatter': ['nova', '碎冰', '冰凍中的敵人倒下時會碎裂爆炸'],
  'nova.big': ['nova', '極寒', '新星範圍 +40%，冷卻 -30%'],
  'leap.quake': ['leap', '餘震', '落地後再震一次，範圍更大'],
  'volley.more': ['volley', '彈幕增幅', '多射 4 發'],
  'totem.twin': ['totem', '雙生圖騰', '一次放兩座'],
  'bolt.fork': ['bolt', '雷暴', '多劈 3 個目標，並暈眩 1 秒'],
  'dash.double': ['dash', '二段閃避', '可以連續閃避兩次'],
};
// 被動：[名稱, 說明, 最多幾層]
const PAS = {
  power: ['蠻力', '所有傷害 +12%', 5], haste: ['迅擊', '攻擊速度 +12%', 5], vigor: ['強健', '最大生命 +15%', 5], mana: ['泉湧', '最大魔力 +25%，每秒回魔 +1', 4],
  blood: ['嗜血', '每次擊殺回復 4% 生命', 3], critboom: ['爆裂暴擊', '暴擊 +8%，暴擊會引發小爆炸', 3], mastery: ['武器精通', '近戰範圍 +25%；遠程多射一發', 2], ember: ['薪火', '餘燼累積速度 +40%', 3],
};
// 升級時從三張卡裡選一張
function rollCards() {
  const pool = [];
  for (const k of SKILLS) { if (!p.skl[k]) pool.push({ t: 'learn', k, w: 3 }); else if (p.skl[k] < 6) pool.push({ t: 'up', k, w: p.slots.includes(k) ? 2.2 : 0.5 }); }
  for (const m in MODS) { const sk = MODS[m][0]; if (!p.mods[m] && (sk === 'dash' || p.skl[sk])) pool.push({ t: 'mod', k: m, w: sk === 'dash' || p.slots.includes(sk) ? 3 : 0.7 }); }
  for (const k in PAS) if ((p.pas[k] || 0) < PAS[k][2]) pool.push({ t: 'pas', k, w: 1.8 });
  const out = [];
  while (out.length < 3 && pool.length) { let t = Math.random() * pool.reduce((a, c) => a + c.w, 0), i = 0; while ((t -= pool[i].w) > 0) i++; out.push(pool.splice(i, 1)[0]); }
  return out;
}
function cardInfo(c) {
  if (c.t === 'learn') return ['新技能', SK[c.k].i, SK[c.k].n, SK[c.k].d(1), '#6aa8ff'];
  if (c.t === 'up') return ['強化', SK[c.k].i, `${SK[c.k].n} Lv ${p.skl[c.k] + 1}`, SK[c.k].d(p.skl[c.k] + 1), '#d8d8d8'];
  if (c.t === 'mod') return ['變體', SK[MODS[c.k][0]].i, MODS[c.k][1], MODS[c.k][2], '#ff8a3a'];
  return ['被動', '✨', PAS[c.k][0] + (p.pas[c.k] ? ` ×${p.pas[c.k] + 1}` : ''), PAS[c.k][1], '#ffd84a'];
}
function takeCard(c) {
  if (c.t === 'learn') { p.skl[c.k] = 1; const i = p.slots.indexOf(null); if (i >= 0) p.slots[i] = c.k; else tip('swap', '技能欄滿了：到 🎒 可以把學會的技能換上 Q／E／R'); }
  else if (c.t === 'up') p.skl[c.k]++;
  else if (c.t === 'mod') p.mods[c.k] = true;
  else p.pas[c.k] = (p.pas[c.k] || 0) + 1;
  const hp = p.st.hp; refresh(); p.hp += p.st.hp - hp; SND.card();
}
function openCards() { cards = rollCards(); if (!cards.length) { p.picks = 0; return; } paused = true; joy.id = null; atkHeld = false; mouse.l = mouse.r = false; drawCards(); $('cards').classList.add('on'); }
function drawCards() {
  $('cardsTitle').textContent = `升級！選一項${p.picks > 1 ? `（還有 ${p.picks} 次）` : ''}`;
  $('cardRow').innerHTML = cards.map((c, i) => { const [tag, ic, n, d, col] = cardInfo(c); return `<button class="card" data-card="${i}" style="border-color:${col}"><small style="color:${col}">${tag}</small><i>${ic}</i><b>${n}</b><span>${d}</span></button>`; }).join('');
}
function newPlayer() {
  p = {
    x: 0, y: 0, r: 13, lvl: 1, xp: 0, gold: 0, floor: 1, best: 1, hpPot: 3, mpPot: 2, sp: 0, kills: 0, deaths: 0, won: false, train: { hp: 0, dmg: 0, mp: 0 },
    skl: { fire: 1 }, slots: ['fire', null, null], mods: {}, pas: {}, picks: 0, diff: 0, inv: [],
    equip: { weapon: { id: itemId++, slot: 'weapon', rarity: 0, lvl: 1, base: { dmg: 5 }, aff: [], name: '生鏽的長劍', kind: '長劍', val: 3 }, armor: null, ring: null },
  };
  resetRuntime(); refresh(); p.hp = p.st.hp; p.mp = p.st.mp;
}
function resetRuntime() {
  Object.assign(p, { aim: 0, atkCd: 0, slashT: 0, slashA: 0, whirlT: 0, whirlTick: 0, dashT: 0, dashX: 0, dashY: 0, inv_t: 0, potCd: 0, hurtT: 0, moving: false, moveA: 0, combo: 0, buff: null, streak: 0, streakT: 0, thornCd: 0, trapCd: 0, stepT: 0, ember: 0, burnT: 0, leap: null, dash2: false, hitChain: 0, hitChainT: 0, cd: Object.fromEntries(Object.keys(SK).map(k => [k, 0])) });
}
const xpNeed = l => Math.round(40 * Math.pow(l, 1.7));
function gainXp(v) {
  p.xp += v;
  while (p.xp >= xpNeed(p.lvl)) {
    p.xp -= xpNeed(p.lvl); p.lvl++; p.picks++; refresh(); p.hp = p.st.hp; p.mp = p.st.mp;
    floatText(p.x, p.y, '升級！', '#ffcf6b', 24); 
    burst(p.x, p.y, '#ffcf6b', 40, 160, 1, 1, 6); fxRing(p.x, p.y, 90, 0xffcf6b, 0.6);
    SND.level();
  }
}
function save() {
  if (!p) return;
  const o = {}; for (const k of ['lvl', 'xp', 'gold', 'floor', 'best', 'hpPot', 'mpPot', 'sp', 'skl', 'equip', 'inv', 'kills', 'deaths', 'won', 'train', 'slots', 'mods', 'pas', 'picks', 'diff']) o[k] = p[k];
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(o)); } catch (e) { /* 無痕模式存不了就算了 */ }
}
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(SAVE_KEY)); if (!o || !o.lvl) return false;
    p = Object.assign({ x: 0, y: 0, r: 13, kills: 0, deaths: 0, won: false, train: { hp: 0, dmg: 0, mp: 0 }, mods: {}, pas: {}, picks: 0, diff: 0 }, o);
    if (!p.slots) { p.slots = SKILLS.filter(k => p.skl[k]).slice(0, 3); while (p.slots.length < 3) p.slots.push(null); p.picks += p.sp || 0; p.sp = 0; } // 舊存檔：技能點換成升級卡
    resetRuntime();
    for (const it of [...p.inv, ...Object.values(p.equip)]) if (it) itemId = Math.max(itemId, it.id + 1);
    refresh(); p.hp = p.st.hp; p.mp = p.st.mp; return true;
  } catch (e) { return false; }
}
const hasSave = () => { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } };

// ---------- 敵人 ----------
const ET = {
  minion: { n: '骷髏兵', hp: 32, spd: 78, dmg: 11, r: 12, xp: 8 },
  imp: { n: '小骨魔', hp: 16, spd: 145, dmg: 7, r: 9, xp: 7 },
  archer: { n: '骸骨弩手', hp: 24, spd: 85, dmg: 12, r: 12, xp: 11, ranged: 1 },
  brute: { n: '骸骨戰將', hp: 110, spd: 62, dmg: 24, r: 16, xp: 22, charger: 1 },
  shaman: { n: '亡靈咒術師', hp: 44, spd: 62, dmg: 13, r: 12, xp: 18, ranged: 1 },
  boss: { n: '守關者', hp: 1500, spd: 76, dmg: 28, r: 30, xp: 300, charger: 1 },
};
const TRAITN = { split: '分裂', bomb: '自爆', haste: '疾走', ward: '護盾' };
const BOSSN = ['灰燼守衛', '沼澤骨王', '熔核督軍', '霜冠亡王', '虛空之主'];
function rollType(f) {
  const w = [['minion', 5], ['imp', 3]];
  if (f >= 2) w.push(['archer', 3]); if (f >= 3) w.push(['brute', 2]); if (f >= 4) w.push(['shaman', 2]);
  let t = Math.random() * w.reduce((s, x) => s + x[1], 0);
  for (const x of w) { if ((t -= x[1]) < 0) return x[0]; }
  return 'minion';
}
function spawnEnemy(type, x, y, elite) {
  const d = ET[type], f = p.floor, hs = (1 + 0.42 * (f - 1)) * diff().hp, ds = (1.15 + 0.34 * (f - 1)) * diff().dmg;
  const e = {
    type, x, y, r: d.r * (elite ? 1.25 : 1), hp: d.hp * hs * (elite ? 3.2 : 1), dmg: d.dmg * ds * (elite ? 1.4 : 1),
    spd: d.spd * rand(0.9, 1.1), xp: d.xp * (1 + 0.2 * (f - 1)) * (elite ? 4 : 1), elite: !!elite,
    awake: false, atkCd: rand(0, 0.6), atkT: 0, shotCd: rand(1, 2.5), flash: 0, slow: 0, freeze: 0, kx: 0, ky: 0, ph: rand(0, 6.28), ch: null, chCd: rand(2, 4),
    face: rand(0, 6.28), faceLock: 0, riseT: 0, stun: 0, trait: elite && type !== 'boss' ? pick(['split', 'bomb', 'haste', 'ward']) : null, wardT: 0, wardCd: rand(2, 4), act: 2.5, volley: 0, volT: 0, v: null,
  };
  e.maxHp = e.hp; if (e.trait === 'haste') e.spd *= 1.5;
  if (type === 'boss') { e.name = BOSSN[(Math.floor(f / 5) - 1) % BOSSN.length]; boss = e; }
  enemies.push(e); return e;
}
function enemyShot(e, ang, spd, dmg, col, r = 6, arrow = false) {
  shots.push({ x: e.x + Math.cos(ang) * e.r, y: e.y + Math.sin(ang) * e.r, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r, dmg, from: 'e', life: 4, col, arrow });
}
function updateEnemy(e, dt) {
  e.flash -= dt; e.atkCd -= dt; e.ph += dt * 6;
  if (e.kx || e.ky) { moveEnt(e, e.kx * dt, e.ky * dt); e.kx *= Math.pow(0.002, dt); e.ky *= Math.pow(0.002, dt); if (Math.abs(e.kx) + Math.abs(e.ky) < 5) e.kx = e.ky = 0; }
  if (e.riseT > 0) { e.riseT -= dt; return; }
  if (e.freeze > 0) { e.freeze -= dt; return; }
  if (e.trait === 'ward') { e.wardT -= dt; if ((e.wardCd -= dt) <= 0 && e.awake) { e.wardCd = 6; e.wardT = 2.4; } }
  if (e.stun > 0) { e.stun -= dt; return; } // 被打到會踉蹌一下
  const sm = e.slow > 0 ? 0.45 : 1; e.slow -= dt;
  const d = dist(e, p);
  if (!e.awake) { if (d < 340 && los(e, p)) { e.awake = true; tip('dash', touchMode ? '敵人舉手要打你時，按 💨 閃避，閃避中不會受傷' : '敵人舉手要打你時，按空白鍵閃避，閃避中不會受傷'); if (e === boss) { sfx(90, 0.6, 'sawtooth', 0.08, -40); charOnce(e, 'Taunt', 1.2); e.act = 1.6; } } else return; }
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
    e.atkCd = e.type === 'boss' ? 1.4 : e.trait === 'haste' ? 0.7 : 1.15; e.atkT = e.type === 'imp' ? 0.2 : 0.3;
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

function hitEnemy(e, mult, kb = 120, src, o = {}) {
  if (e.dead) return;
  if (e.wardT > 0) { floatText(e.x, e.y, '格擋', '#7fe8ff', 13); e.awake = true; return; }
  let dmg = p.st.dmg * mult * rand(0.88, 1.12) * (p.burnT > 0 ? 1.15 : 1); const crit = Math.random() * 100 < p.st.crit;
  if (crit) dmg *= 2;
  dmg = Math.max(1, Math.round(dmg));
  e.hp -= dmg; e.flash = 0.12; e.awake = true;
  const s0 = src || p, a = Math.atan2(e.y - s0.y, e.x - s0.x), k = e.type === 'boss' ? 0.1 : e.type === 'brute' ? 0.4 : 1;
  e.kx += Math.cos(a) * kb * k * 3; e.ky += Math.sin(a) * kb * k * 3;
  if (e.type !== 'boss' && !e.ch && kb > 0 && (o.heavy || time > (e.stunAt || 0))) { e.stun = Math.max(e.stun, o.heavy ? 0.4 : 0.15); e.stunAt = time + 1.1; if (o.heavy) e.atkT = 0; } // 踉蹌後有一小段抗性，不會被連打鎖死
  floatText(e.x, e.y, crit ? dmg + '!' : '' + dmg, crit ? '#ffd84a' : '#fff', crit ? 24 : o.heavy ? 18 : 15);
  // 火花往被打的方向噴
  for (let i = 0, n = crit ? 10 : o.heavy ? 8 : 4; i < n; i++) { const b = a + rand(-0.6, 0.6), v = rand(80, 260); parts.push(mkPart(e.x, e.y, 1.4, Math.cos(b) * v, Math.sin(b) * v, rand(0, 3), crit ? '#ffd84a' : '#f4eedc', rand(0.2, 0.4), rand(2.5, 5), 7)); }
  if (crit) { hitStop = Math.max(hitStop, 0.07); if (p.pas.critboom && !o.noProc) blast(e.x, e.y, 52, 0.5 * p.pas.critboom, 0xffd84a, 0.2, true); }
  if (p.st.ls > 0) p.hp = Math.min(p.st.hp, p.hp + dmg * p.st.ls / 100);
  if (e.hp <= 0) killEnemy(e);
  else if (e.type !== 'boss' && !e.ch && e.atkT <= 0 && e.v && e.v.lock <= 0) charOnce(e, 'Hit_A', 2, 0.2);
}
function killEnemy(e) {
  e.dead = true; gainXp(Math.round(e.xp * (1 + Math.min(p.streak, 25) * 0.02)));
  if (p.fx.boom && e.type !== 'boss') booms.push({ x: e.x, y: e.y, t: 0.16 }); SND.bones();
  if (e.freeze > 0 && p.mods['nova.shatter']) booms.push({ x: e.x, y: e.y, t: 0.05, R: 78, mult: 0.9, color: 0x88ddff });
  for (let i = 0, n = e.elite ? 26 : 14; i < n; i++) { const b = rand(0, 6.283), v = rand(60, 260); parts.push(mkPart(e.x, e.y, rand(0.8, 2), Math.cos(b) * v + e.kx * 0.15, Math.sin(b) * v + e.ky * 0.15, rand(2, 8), i % 3 ? '#e8e2d0' : '#b8b0a0', rand(0.5, 1), rand(3, 7), 14)); } // 骨頭碎片
  if (p.pas.blood) p.hp = Math.min(p.st.hp, p.hp + p.st.hp * 0.04 * p.pas.blood);
  if (p.burnT <= 0) { const was = p.ember; p.ember = Math.min(100, p.ember + (e.type === 'boss' ? 100 : e.elite ? 22 : 7) * (1 + 0.4 * (p.pas.ember || 0))); if (was < 100 && p.ember >= 100) { tip('ember', touchMode ? '餘燼滿了！按 💥 引爆火把，8 秒內攻擊更快、每一擊都帶火焰' : '餘燼滿了！按 G 引爆火把，8 秒內攻擊更快、每一擊都帶火焰'); sfx(880, 0.3, 'triangle', 0.05, 440); } }
  if (e.trait === 'split') for (let i = 0; i < 3; i++) { const b = i * 2.1, m = spawnEnemy('imp', e.x + Math.cos(b) * 22, e.y + Math.sin(b) * 22); m.awake = true; m.xp *= 0.3; m.atkCd = 0.8; m.kx = Math.cos(b) * 300; m.ky = Math.sin(b) * 300; }
  if (e.trait === 'bomb') { dangers.push({ x: e.x, y: e.y, t: 1.1, R: 95, dmg: e.dmg * 1.6 }); fxRing(e.x, e.y, 95, 0xff3020, 1.1); }
  toCorpse(e);
  const f = p.floor;
  if (e.type === 'boss') {
    boss = null; stairs.open = true; shake = 16; hitStop = 0.25; burst(e.x, e.y, '#ffcf6b', 90, 260, 1.2, 2, 8); fxRing(e.x, e.y, 260, 0xffcf6b, 0.9); sfx(80, 0.8, 'sawtooth', 0.09, 300);
    for (let i = 0; i < 3; i++) dropItem(e.x + rand(-50, 50), e.y + rand(-50, 50), makeItem(f, rollRarity(i === 0 ? 3 : 2)));
    for (let i = 0; i < 10; i++) dropGold(e.x + rand(-30, 30), e.y + rand(-30, 30), irand(8, 16) * (1 + f * 0.25));
    drops.push(mk('hp', e.x - 20, e.y)); drops.push(mk('mp', e.x + 20, e.y));
    banner('守關者倒下', '樓梯出現了'); p.kills++;
    if (f >= 20 && !p.won) { p.won = true; setTimeout(() => endScreen(true), 2600); }
    for (const o of enemies) if (o !== e && !o.dead) { o.hp = 0; o.dead = true; toCorpse(o); }
    return;
  }
  if (e.summoned) return;
  p.kills++; p.streak++; p.streakT = 3.5;
  if (p.streak === 5 || p.streak === 10 || p.streak % 20 === 0) { floatText(p.x, p.y, `連殺 ×${p.streak}！`, '#ff9a3a', 20); for (let i = 0; i < 3; i++) dropGold(e.x, e.y, p.streak * (1 + f * 0.25)); SND.level(); }
  if (Math.random() < 0.7) dropGold(e.x, e.y, irand(2, 6) * (1 + f * 0.25) * (e.elite ? 4 : 1));
  const r = Math.random();
  if (r < 0.07) drops.push(mk('hp', e.x, e.y)); else if (r < 0.11) drops.push(mk('mp', e.x, e.y));
  if (e.elite || Math.random() < 0.09) dropItem(e.x, e.y, makeItem(f, rollRarity(e.elite ? 1 : 0)));
}
const mk = (kind, x, y, extra) => Object.assign({ kind, x: x + rand(-14, 14), y: y + rand(-14, 14), t: 0, v: null }, extra);
function dropGold(x, y, v) { drops.push(mk('gold', x, y, { amt: Math.max(1, Math.round(v * diff().gold)) })); }
function dropItem(x, y, it) { drops.push(mk('item', x, y, { it })); if (it.rarity >= 2) sfx(880, 0.3, 'triangle', 0.06, 400); }

function hurtPlayer(d) {
  if (p.inv_t > 0 || p.dashT > 0 || state !== 'play') return;
  d = Math.max(1, Math.round(d * 100 / (100 + p.st.armor) * rand(0.9, 1.1) * (p.buff && p.buff.k === 'ward' ? 0.5 : 1)));
  p.hp -= d; p.hurtT = 0.25; p.inv_t = 0.25; shake = Math.max(shake, 5);
  floatText(p.x, p.y, '-' + d, '#ff6a6a', 17); SND.hurt();
  burst(p.x, p.y, '#ff4444', 6, 90, 0.4, 1.4, 2);
  $('hurt').style.opacity = 1; setTimeout(() => $('hurt').style.opacity = 0, 120);
  if (p.fx.thorns && p.thornCd <= 0) { p.thornCd = 0.8; fxRing(p.x, p.y, 125, 0x66ff88, 0.35); for (const e of enemies) if (!e.dead && dist(e, p) < 125 + e.r) hitEnemy(e, 1.5, 220); }
  if (p.hp <= 0 && p.fx.phoenix && !p.phoenixUsed) {
    p.phoenixUsed = true; p.hp = p.st.hp * 0.5; p.inv_t = 1.5; banner('', '晨曦庇護了你'); hitStop = 0.2;
    blast(p.x, p.y, 210, 3, 0xffaa30); burst(p.x, p.y, '#ffcf6b', 50, 240, 1, 1, 8);
  }
  if (p.hp <= 0) die();
}
function blast(x, y, R, mult, color, vol = 0.6, noProc = false) {
  const src = { x, y };
  fxRing(x, y, R, color, 0.35); burst(x, y, '#' + color.toString(16).padStart(6, '0'), 18, 150, 0.5, 1, 5); fxFlash(x, y, color, 0.2);
  for (const e of enemies) if (!e.dead && dist(e, src) < R + e.r) hitEnemy(e, mult, 150, src, { noProc });
  for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, src) < R) breakBarrel(o);
  SND.boom(vol); shake = Math.max(shake, 4);
}
function chain(from) { // 連鎖閃電
  let cur = from; const seen = new Set([from]);
  for (let i = 0; i < 3; i++) {
    let best = null, bd = 180;
    for (const e of enemies) if (!e.dead && !seen.has(e)) { const d = dist(e, cur); if (d < bd) { bd = d; best = e; } }
    if (!best) break;
    for (let k = 0; k <= 10; k++) { const u = k / 10; parts.push(mkPart(cur.x + (best.x - cur.x) * u + rand(-7, 7), cur.y + (best.y - cur.y) * u + rand(-7, 7), 1.5 + rand(-0.3, 0.3), 0, 0, 0, k % 2 ? '#ffffff' : '#88ccff', 0.22, 6)); }
    fxFlash(best.x, best.y, 0x88ccff, 0.15); hitEnemy(best, 0.7, 30, cur); seen.add(best); cur = best;
  }
  if (seen.size > 1) SND.zap();
}
function ambush(o) {
  banner('伏擊！', '寶庫的守衛從地底爬出來了'); shake = 8; sfx(70, 0.6, 'sawtooth', 0.1, 40);
  dropItem(o.x + 30, o.y + 10, makeItem(p.floor, rollRarity(1)));
  const n = Math.min(9, 5 + Math.floor(p.floor / 2));
  for (let i = 0; i < n; i++) {
    const a = i / n * 6.283, x = o.x + Math.cos(a) * 120, y = o.y + Math.sin(a) * 120;
    if (circleHits(x, y, 16)) continue;
    const e = spawnEnemy(rollType(p.floor), x, y, i === 0 && p.floor >= 2); e.awake = true; e.rise = true; e.riseT = 1.3; e.atkCd = 0.5; e.shotCd = 1; e.face = Math.atan2(o.y - y, o.x - x);
    burst(x, y, '#aa66ff', 12, 70, 0.7, 0.3, 4);
  }
}
function useShrine() {
  const b = BUFFS[shrine.kind]; shrine.used = true; p.buff = { k: shrine.kind, t: 45 }; refresh();
  p.hp = Math.min(p.st.hp, p.hp + p.st.hp * 0.3); banner(b[1] + '祝福', b[2] + '（45 秒）');
  fxRing(p.x, p.y, 110, b[3], 0.6); burst(shrine.x, shrine.y, '#' + b[3].toString(16).padStart(6, '0'), 40, 150, 1, 3, 6); SND.shrine();
}
function die() {
  p.hp = 0; state = 'dead'; intensity = 0;
  const lost = Math.floor(p.gold * 0.3); p.gold -= lost;
  if (hero) hero.once('Death_A', 1, 99);
  p.deaths++; setTimeout(() => endScreen(false, lost), 1300); sfx(200, 0.7, 'sawtooth', 0.08, -170);
  save();
}

function endScreen(win, lost) {
  $('deadTitle').textContent = win ? '你征服了餘燼地城' : '火把熄了';
  $('deadTxt').innerHTML = win
    ? `第 20 層的虛空之主倒下了。<br>擊殺 ${p.kills}・倒下 ${p.deaths} 次・等級 ${p.lvl}<br>想挑戰極限的話，樓梯還會繼續往下。`
    : `你倒在第 ${p.floor} 層（最深紀錄：第 ${p.best} 層）。<br>掉了 ${lost} 枚金幣，裝備和等級都還在。<br><span class="dim">擊殺 ${p.kills}・倒下 ${p.deaths} 次</span>`;
  $('reviveBtn').textContent = win ? '繼續深入' : '重新點燃';
  $('dead').classList.add('on'); if (win) { paused = true; SND.shrine(); }
}
function interact() { if (actMode === 'stairs') descend(); else if (actMode === 'shop') openStore(); }
function aimAngle() {
  if (!touchMode) return Math.atan2(mouse.wy - p.y, mouse.wx - p.x);
  let best = null, bd = 380;
  for (const e of enemies) { const d = dist(e, p); if (d < bd && e.awake && los(p, e)) { bd = d; best = e; } }
  if (best) return Math.atan2(best.y - p.y, best.x - p.x);
  for (const o of props) { if (o.kind === 'barrel' && dist(o, p) < 80) return Math.atan2(o.y - p.y, o.x - p.x); }
  return p.aim;
}
const SWINGS = ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'];
function pshot(x, y, a, spd, o) { shots.push(Object.assign({ x: x + Math.cos(a) * 16, y: y + Math.sin(a) * 16, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: 6, from: 'p', life: 0.9, ps: true, hit: new Set(), mult: 1, kb: 60, pierce: 0, col: '#ffe9b0' }, o)); }
function weaponFx(hits) { // 傳說武器與爆燃的命中效果
  if (!hits.length) return;
  if (p.fx.frost) for (const e of hits) if (!e.dead) { e.slow = 2.5; if (e.type !== 'boss' && Math.random() < 0.18) e.freeze = Math.max(e.freeze, 1.1); }
  if (p.fx.chain && Math.random() < 0.3) chain(hits[0]);
  if (p.burnT > 0) for (const e of hits.slice(0, 3)) blast(e.x, e.y, 48, 0.4, 0xff7a2a, 0.15, true);
}
function attack() {
  if (p.atkCd > 0 || p.whirlT > 0 || p.dashT > 0 || p.leap) return;
  const w = wtOf(p.equip.weapon), mast = p.pas.mastery || 0;
  p.aim = aimAngle(); p.atkCd = w.cd / (1 + p.st.aspd / 100) / (p.burnT > 0 ? 1.4 : 1); p.slashT = 0.18; p.slashA = p.aim;
  p.combo = (p.combo + 1) % 3; const fin = p.combo === 2;
  if (w.ranged) {
    const n = 1 + mast + (fin && !w.homing ? 2 : 0);
    for (let i = 0; i < n; i++) pshot(p.x, p.y, p.aim + (i - (n - 1) / 2) * 0.13, w.spd, { mult: w.mult * (fin && w.homing ? 1.6 : 1), kb: w.kb, pierce: w.pierce || 0, homing: w.homing, aoe: w.aoe ? w.aoe * (fin ? 1.5 : 1) : 0, col: w.homing ? '#b98cff' : '#ffe9b0', arrow: !w.homing, r: w.homing ? (fin ? 9 : 6) : 5, weapon: true });
    if (hero) hero.once(w.homing ? 'Spellcast_Shoot' : '1H_Ranged_Shoot', w.homing ? 2.6 : 2.4, p.atkCd * 0.8);
    if (p.fx.wave && fin) shots.push({ x: p.x + Math.cos(p.aim) * 24, y: p.y + Math.sin(p.aim) * 24, vx: Math.cos(p.aim) * 470, vy: Math.sin(p.aim) * 470, r: 22, from: 'p', life: 0.55, col: '#ff8a2a', wave: true, hit: new Set() });
    SND.shoot(w.homing); return;
  }
  if (hero) hero.once(w.heavy ? (fin ? '2H_Melee_Attack_Chop' : '2H_Melee_Attack_Slice') : w === WT.dagger && !fin ? '1H_Melee_Attack_Stab' : SWINGS[p.combo], (w.heavy ? 0.8 : 0.5) / p.atkCd, p.atkCd * 0.9);
  if (!p.moving) moveEnt(p, Math.cos(p.aim) * 9, Math.sin(p.aim) * 9); // 出手往前踏一步
  const range = w.range * (1 + mast * 0.25) * (fin ? 1.12 : 1), hits = [];
  fxSlash(p.x, p.y, p.aim, p.combo, range / 68, p.burnT > 0 ? 0xff8a3a : 0xfff0c8);
  SND.swing(w);
  for (const e of enemies) {
    const d = dist(e, p); if (d > range + e.r) continue;
    if (d < e.r + 14 || Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), p.aim)) < w.arc) { hitEnemy(e, w.mult * (fin ? 1.3 : 1), w.kb * (fin ? 1.5 : 1), null, { heavy: w.heavy || fin }); hits.push(e); }
  }
  if (hits.length) {
    shake = Math.max(shake, w.heavy ? 7 : fin ? 4.5 : 2.5); hitStop = Math.max(hitStop, w.heavy ? 0.09 : fin ? 0.06 : 0.04);
    p.hitChain++; p.hitChainT = 1.3; SND.hit(w, p.hitChain); p.mp = Math.min(p.st.mp, p.mp + 2); // 砍中會回一點魔力
  }
  if (fin && (w.heavy || w === WT.axe)) { const gx = p.x + Math.cos(p.aim) * range * 0.6, gy = p.y + Math.sin(p.aim) * range * 0.6; fxRing(gx, gy, range * 0.8, 0xffe0b0, 0.3); burst(gx, gy, '#b8a890', 12, 140, 0.5, 0.2, 4); noise(0.25, 0.12, 400); } // 重擊震地
  weaponFx(hits);
  if (p.fx.wave && fin) shots.push({ x: p.x + Math.cos(p.aim) * 24, y: p.y + Math.sin(p.aim) * 24, vx: Math.cos(p.aim) * 470, vy: Math.sin(p.aim) * 470, r: 22, from: 'p', life: 0.55, col: '#ff8a2a', wave: true, hit: new Set(hits) });
  for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, p) < range + o.r && Math.abs(angDiff(Math.atan2(o.y - p.y, o.x - p.x), p.aim)) < w.arc + 0.15) breakBarrel(o);
}
function breakBarrel(o) {
  o.dead = true; burst(o.x, o.y, '#b98552', 14, 120, 0.7, 1, 5); sfx(220, 0.08, 'square', 0.04, -100); noise(0.15, 0.08, 1500);
  const r = Math.random();
  if (r < 0.55) dropGold(o.x, o.y, irand(1, 5) * (1 + p.floor * 0.25)); else if (r < 0.63) drops.push(mk('hp', o.x, o.y)); else if (r < 0.68) drops.push(mk('mp', o.x, o.y));
}
function cast(k) {
  if (state !== 'play' || paused || !k) return;
  if (k === 'atk') return attack();
  if (k === 'hp' || k === 'mpp') return potion(k);
  if (k === 'ember') return ignite();
  const s = SK[k]; if (p.cd[k] > 0 || p.leap) return;
  if (p.mp < s.mp) { floatText(p.x, p.y, '魔力不足', '#6bf', 13); return; }
  const l = p.skl[k] || 1, M = p.mods;
  if (k === 'bolt') { // 落雷要先確認有目標
    const ts = enemies.filter(e => !e.dead && dist(e, p) < 300 && los(p, e)).sort((a, b) => dist(a, p) - dist(b, p)).slice(0, M['bolt.fork'] ? 7 : 4);
    if (!ts.length) { floatText(p.x, p.y, '附近沒有目標', '#aaa', 13); return; }
    for (const e of ts) { for (let i = 0; i < 12; i++) parts.push(mkPart(e.x + rand(-6, 6), e.y + rand(-6, 6), 0.5 + i * 0.75, 0, 0, 0, i % 2 ? '#ffffff' : '#9fd0ff', 0.25, 7)); fxFlash(e.x, e.y, 0x9fd0ff, 0.18); fxRing(e.x, e.y, 34, 0x9fd0ff, 0.25); hitEnemy(e, 1.3 + l * 0.3, 40, e, { heavy: !!M['bolt.fork'] }); if (M['bolt.fork'] && !e.dead && e.type !== 'boss') e.stun = 1; }
    SND.zap(); sfx(90, 0.3, 'sawtooth', 0.1, -40); shake = 5; if (hero) hero.once('Spellcast_Raise', 2.4, 0.3);
  }
  p.mp -= s.mp; p.cd[k] = s.cd * (k === 'dash' && p.fx.blink ? 0.5 : 1);
  if (k === 'fire') {
    const a = p.aim = aimAngle();
    for (const o of (p.fx.twin ? [-0.22, 0, 0.22] : [0])) shots.push({ x: p.x + Math.cos(a + o) * 18, y: p.y + Math.sin(a + o) * 18, vx: Math.cos(a + o) * 520, vy: Math.sin(a + o) * 520, r: 8, from: 'p', life: 1.4, col: '#ff8a2a', fire: true });
    sfx(240, 0.2, 'sawtooth', 0.05, 300); if (hero) hero.once('Spellcast_Shoot', 2.4, 0.3);
  } else if (k === 'whirl') { p.whirlT = (p.fx.storm ? 2 : 1.2) + (M['whirl.long'] ? 0.8 : 0); p.whirlTick = 0; }
  else if (k === 'nova') {
    const R = 175 * (M['nova.big'] ? 1.4 : 1); if (M['nova.big']) p.cd.nova = s.cd * 0.7;
    for (const e of enemies) if (dist(e, p) < R + e.r) { e.freeze = Math.max(e.freeze, (1.5 + l * 0.3) * (e.type === 'boss' ? 0.35 : 1)); e.slow = e.freeze + 2; e.atkT = 0; hitEnemy(e, 1 + l * 0.25, 60); }
    for (let i = 0; i < 60; i++) { const a = i / 60 * 6.283; parts.push(mkPart(p.x, p.y, 0.5, Math.cos(a) * R * 1.9, Math.sin(a) * R * 1.9, 0.5, '#aaeeff', 0.5, 5)); }
    fxRing(p.x, p.y, R, 0x88ddff, 0.45); fxRing(p.x, p.y, R * 0.7, 0xffffff, 0.3);
    shots = shots.filter(s2 => { if (s2.from === 'e' && dist(s2, p) < R) { killVis(s2); return false; } return true; });
    sfx(900, 0.35, 'sine', 0.07, -700); shake = 5; if (hero) hero.once('Spellcast_Raise', 2, 0.4);
  } else if (k === 'leap') {
    const a = p.aim = aimAngle(); let d = 230;
    if (touchMode) { let bd = 300; for (const e of enemies) { const dd = dist(e, p); if (dd < bd && e.awake) bd = dd; } d = Math.min(230, Math.max(70, bd)); } else d = clamp(Math.hypot(mouse.wx - p.x, mouse.wy - p.y), 60, 240);
    let tx = p.x, ty = p.y; for (let q = 8; q <= d; q += 8) { const nx = p.x + Math.cos(a) * q, ny = p.y + Math.sin(a) * q; if (circleHits(nx, ny, p.r)) break; tx = nx; ty = ny; }
    p.leap = { sx: p.x, sy: p.y, tx, ty, t: 0, T: 0.34, l }; p.inv_t = 0.5; sfx(300, 0.3, 'sine', 0.05, 500); noise(0.2, 0.05, 2500); if (hero) hero.once('Jump_Full_Short', 2.2, 0.36);
  } else if (k === 'volley') {
    const a = p.aim = aimAngle(), n = 7 + (M['volley.more'] ? 4 : 0);
    for (let i = 0; i < n; i++) pshot(p.x, p.y, a + (i / (n - 1) - 0.5) * 1.05, 560, { mult: 0.6 + l * 0.12, kb: 70, pierce: 2, arrow: true, r: 5, life: 0.7, col: '#ffd070' });
    SND.shoot(false); noise(0.2, 0.08, 6000, 2000); if (hero) hero.once('1H_Melee_Attack_Slice_Horizontal', 2.4, 0.25);
  } else if (k === 'totem') {
    const a = aimAngle(), put = b => { let x = p.x + Math.cos(b) * 44, y = p.y + Math.sin(b) * 44; if (circleHits(x, y, 8)) { x = p.x; y = p.y; } totems.push({ x, y, t: 8, cd: 0.3, l, v: null }); burst(x, y, '#ff9a3a', 16, 90, 0.6, 0.5, 5); };
    put(a); if (M['totem.twin']) put(a + Math.PI); sfx(200, 0.3, 'triangle', 0.07, 200); if (hero) hero.once('Spellcast_Raise', 2.4, 0.3);
  } else if (k === 'dash') {
    if (M['dash.double']) { if (!p.dash2) { p.dash2 = true; p.cd.dash = 0.28; } else p.dash2 = false; }
    let dx = moveX, dy = moveY; if (!dx && !dy) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
    const m = Math.hypot(dx, dy); p.dashX = dx / m; p.dashY = dy / m; p.dashT = 0.2; sfx(500, 0.1, 'sine', 0.04, 400); noise(0.12, 0.04, 2500);
    if (hero) hero.once('Dodge_Forward', 2.2, 0.22);
  }
}
function ignite() { // 餘燼爆燃
  if (p.ember < 100 || p.burnT > 0) return;
  p.ember = 0; p.burnT = 8; banner('爆燃', '火把燒到最旺的 8 秒'); SND.burn(); hitStop = 0.12; shake = 10;
  blast(p.x, p.y, 160, 1.6, 0xff7a2a, 0.8, true); burst(p.x, p.y, '#ffb040', 60, 260, 1, 1, 9);
}
function potion(k) {
  if (p.potCd > 0) return;
  if (k === 'hp') { if (p.hpPot <= 0 || p.hp >= p.st.hp) return; p.hpPot--; const v = Math.round(p.st.hp * 0.45); p.hp = Math.min(p.st.hp, p.hp + v); floatText(p.x, p.y, '+' + v, '#6e6'); burst(p.x, p.y, '#55ee66', 16, 50, 0.8, 0.3, 5); }
  else { if (p.mpPot <= 0 || p.mp >= p.st.mp) return; p.mpPot--; const v = Math.round(p.st.mp * 0.6); p.mp = Math.min(p.st.mp, p.mp + v); floatText(p.x, p.y, '+' + v, '#6bf'); burst(p.x, p.y, '#55aaff', 16, 50, 0.8, 0.3, 5); }
  p.potCd = 0.8; sfx(600, 0.15, 'sine', 0.05, 300);
}
function explode(s) {
  const l = p.skl.fire || 1, k = s.mini ? 0.5 : 1, R = (62 + l * 3) * (s.mini ? 0.7 : 1);
  for (const e of enemies) if (dist(e, s) < R + e.r) hitEnemy(e, (1.5 + l * 0.3) * k, 160, s);
  for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, s) < R) breakBarrel(o);
  burst(s.x, s.y, '#ff8a2a', 26 * k, 200, 0.6, 1.2, 6); burst(s.x, s.y, '#ffd84a', 12 * k, 110, 0.5, 1.2, 4);
  fxRing(s.x, s.y, R, 0xff8a2a, 0.3); fxFlash(s.x, s.y, 0xff8030, 0.25);
  SND.boom(k); shake = Math.max(shake, 5 * k);
  if (s.mini) return;
  if (p.mods['fire.split']) { const a0 = rand(0, 6.28); for (let i = 0; i < 3; i++) { const a = a0 + i * 2.094; shots.push({ x: s.x, y: s.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, r: 6, from: 'p', life: 0.32, col: '#ffb040', fire: true, mini: true, grace: 0.14 }); } }
  if (p.mods['fire.pool']) pools.push({ x: s.x, y: s.y, t: 3, tick: 0.3, R: 60, l });
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
  if (p.leap) { // 躍擊：拋物線跳到落點再砸地
    const L = p.leap; L.t += dt; const u = Math.min(1, L.t / L.T);
    p.x = L.sx + (L.tx - L.sx) * u; p.y = L.sy + (L.ty - L.sy) * u; p.moving = false;
    if (u >= 1) { p.leap = null; blast(p.x, p.y, 105, 1.8 + L.l * 0.3, 0xffc060, 0.9); shake = 9; hitStop = 0.07; if (p.mods['leap.quake']) booms.push({ x: p.x, y: p.y, t: 0.32, R: 150, mult: 1 + L.l * 0.2, color: 0xffa040 }); if (hero) hero.once('1H_Melee_Attack_Chop', 2.2, 0.2); }
  } else if (p.dashT > 0) {
    p.dashT -= dt; moveEnt(p, p.dashX * 700 * dt, p.dashY * 700 * dt);
    if (p.dashT <= 0 && p.fx.blink) blast(p.x, p.y, 95, 1.2, 0xaa88ff);
    parts.push(mkPart(p.x, p.y, 1.2, 0, 0, 0, '#88ccff', 0.25, 9));
  } else if (m > 0.05) {
    const sp = 190 * (1 + st.move / 100) * (p.whirlT > 0 ? (p.mods['whirl.long'] ? 1 : 0.8) : p.atkCd > 0.12 ? 0.45 : 1) * (p.burnT > 0 ? 1.2 : 1);
    moveEnt(p, moveX * sp * dt, moveY * sp * dt); p.moving = true; p.moveA = Math.atan2(moveY, moveX);
    if ((p.stepT -= dt) <= 0) { p.stepT = 0.29; SND.step(); }
    if (touchMode && p.slashT <= 0) p.aim = p.moveA;
  }
  if (!touchMode) p.aim = aimAngle();
  if (mouse.l || atkHeld || keys.KeyJ) attack();
  if (mouse.r) cast(p.slots[0]);
  if (p.whirlT > 0 && p.mods['whirl.reflect']) for (const s of shots) if (s.from === 'e' && dist(s, p) < 100) { Object.assign(s, { from: 'p', ps: true, hit: new Set(), mult: 1.2, kb: 80, pierce: 0, vx: -s.vx * 1.3, vy: -s.vy * 1.3, life: 1.5 }); sfx(1400, 0.05, 'triangle', 0.04); }
  if (p.whirlT > 0) {
    p.whirlT -= dt; p.whirlTick -= dt;
    if (p.whirlTick <= 0) {
      p.whirlTick = 0.2; sfx(260, 0.06, 'triangle', 0.03, 100); noise(0.08, 0.03, 2500);
      if (p.fx.storm) for (const e of enemies) { const d = dist(e, p); if (d < 230 && d > 50 && e.type !== 'boss') { e.kx += (p.x - e.x) / d * 420; e.ky += (p.y - e.y) / d * 420; } }
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
    if (s.wave) { // 火焰劍氣：穿透，每個敵人只打一次
      if (wall || s.life <= 0) s.dead = true;
      else {
        for (const e of enemies) if (!s.hit.has(e) && dist(e, s) < e.r + s.r) { s.hit.add(e); hitEnemy(e, 1.3, 140, s); }
        for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, s) < o.r + s.r) breakBarrel(o);
        parts.push(mkPart(s.x + rand(-14, 14), s.y + rand(-14, 14), 1.2, 0, 0, rand(0, 2), '#ff7a2a', 0.3, 5));
      }
    } else if (s.ps) {
      if (s.homing) { let best = null, bd = 190; for (const e of enemies) { const d = dist(e, s); if (d < bd && !s.hit.has(e)) { bd = d; best = e; } } if (best) { const ca = Math.atan2(s.vy, s.vx), na = ca + clamp(angDiff(Math.atan2(best.y - s.y, best.x - s.x), ca), -5 * dt, 5 * dt), sp = Math.hypot(s.vx, s.vy); s.vx = Math.cos(na) * sp; s.vy = Math.sin(na) * sp; } }
      if (wall || s.life <= 0) { s.dead = true; if (wall) burst(s.x, s.y, s.col, 4, 60, 0.3, 1.2, 1); }
      else {
        for (const e of enemies) if (!e.dead && !s.hit.has(e) && dist(e, s) < e.r + s.r + 3) {
          s.hit.add(e); hitEnemy(e, s.mult, s.kb, s);
          if (s.weapon) { weaponFx([e]); p.mp = Math.min(p.st.mp, p.mp + 1.5); p.hitChain++; p.hitChainT = 1.3; SND.hit(null, p.hitChain); }
          if (s.aoe) blast(s.x, s.y, s.aoe, s.mult * 0.6, 0xb98cff, 0.15, true);
          if (s.pierce-- <= 0) { s.dead = true; break; }
        }
        if (!s.dead) for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, s) < o.r + s.r) { breakBarrel(o); s.dead = true; break; }
      }
    } else if (s.from === 'p') {
      let hit = wall || s.life <= 0;
      if (!hit && !((s.grace -= dt) > 0)) for (const e of enemies) if (dist(e, s) < e.r + s.r) { hit = true; break; }
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
    o.open = true; if (o.vault) ambush(o); sfx(660, 0.2, 'triangle', 0.06, 300); burst(o.x, o.y, '#ffd84a', 24, 110, 0.9, 1, 6);
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
    if (d.kind === 'gold') { p.gold += d.amt; d.dead = true; SND.coin(); if (p.gold >= 150) tip('gold', '金幣夠了：回這一層的起點找商人（小地圖上的白點）'); floatText(p.x, p.y, '+' + d.amt, '#ffd84a', 12); }
    else if (d.kind === 'hp') { if (p.hpPot < 9) { p.hpPot++; d.dead = true; sfx(800, 0.08, 'sine', 0.04); } }
    else if (d.kind === 'mp') { if (p.mpPot < 9) { p.mpPot++; d.dead = true; sfx(800, 0.08, 'sine', 0.04); } }
    else if (p.inv.length < 24) { p.inv.push(d.it); d.dead = true; floatText(p.x, p.y, d.it.name, RAR[d.it.rarity].c, 14); tip('item', '撿到裝備了！點 🎒 打開背包，有 ▲ 的比身上的好'); sfx(700, 0.1, 'triangle', 0.05, 200); }
    else if (fullMsgT <= 0) { fullMsgT = 1.5; floatText(p.x, p.y, '背包滿了', '#f77', 13); }
  }
  drops = drops.filter(d => { if (d.dead) killVis(d); return !d.dead; });

  for (const q of parts) { q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt; q.vh -= q.g * dt; if (q.h < 0.05) { q.h = 0.05; q.vh = 0; q.vx *= 0.8; q.vy *= 0.8; } q.vx *= 0.95; q.vy *= 0.95; }
  parts = parts.filter(q => q.t > 0);
  if (parts.length > 700) parts.splice(0, parts.length - 700);
  for (const t of texts) t.t -= dt;
  texts = texts.filter(t => t.t > 0);
  shake = Math.max(0, shake - dt * 30);
  const am = stairs.open && dist(stairs, p) < 44 ? 'stairs' : merchant && dist(merchant, p) < 62 ? 'shop' : null;
  if (am !== actMode) { actMode = am; const el = $('act'); el.style.display = am ? 'block' : 'none'; if (am) el.textContent = am === 'stairs' ? '⬇️ 往下一層' : '🛒 跟商人交易'; }

  p.thornCd -= dt; p.trapCd -= dt;
  if (p.hitChainT > 0 && (p.hitChainT -= dt) <= 0) p.hitChain = 0;
  if (p.burnT > 0) { p.burnT -= dt; for (let i = 0; i < 2; i++) parts.push(mkPart(p.x + rand(-12, 12), p.y + rand(-12, 12), rand(0.2, 2), rand(-10, 10), rand(-10, 10), rand(3, 7), Math.random() < 0.5 ? '#ffb040' : '#ff5a20', rand(0.3, 0.6), rand(4, 8), -2)); }
  for (const t of totems) {
    t.t -= dt;
    if ((t.cd -= dt) <= 0) { let best = null, bd = 320; for (const e of enemies) { const d = dist(e, t); if (d < bd && los(t, e)) { bd = d; best = e; } } if (best) { t.cd = 0.55; pshot(t.x, t.y, Math.atan2(best.y - t.y, best.x - t.x), 480, { mult: 0.5 + t.l * 0.12, kb: 50, col: '#ff8a2a', r: 6, life: 0.8 }); sfx(520, 0.07, 'square', 0.025, 200); } else t.cd = 0.2; }
    if (t.t <= 0) { killVis(t); burst(t.x, t.y, '#ff9a3a', 14, 100, 0.5, 1, 4); }
  }
  totems = totems.filter(t => t.t > 0);
  for (const q of pools) {
    q.t -= dt; parts.push(mkPart(q.x + rand(-q.R, q.R) * 0.7, q.y + rand(-q.R, q.R) * 0.7, 0.2, 0, 0, rand(2, 5), Math.random() < 0.5 ? '#ff8a2a' : '#ffd040', rand(0.3, 0.6), rand(4, 8), -1));
    if ((q.tick -= dt) <= 0) { q.tick = 0.4; for (const e of enemies) if (!e.dead && dist(e, q) < q.R + e.r) hitEnemy(e, 0.3 + q.l * 0.06, 0, q, { noProc: true }); }
  }
  pools = pools.filter(q => q.t > 0);
  for (const d of dangers) if ((d.t -= dt) <= 0) { burst(d.x, d.y, '#ff4020', 30, 220, 0.6, 1, 6); fxFlash(d.x, d.y, 0xff4020, 0.25); SND.boom(0.8); shake = Math.max(shake, 6); if (dist(d, p) < d.R) hurtPlayer(d.dmg); }
  dangers = dangers.filter(d => d.t > 0);
  if (p.streakT > 0 && (p.streakT -= dt) <= 0) p.streak = 0;
  if (p.buff && (p.buff.t -= dt) <= 0) { p.buff = null; refresh(); floatText(p.x, p.y, '祝福消失了', '#aaa', 13); }
  if (shrine && !shrine.used && dist(shrine, p) < 220) tip('shrine', '碰一下發光的祭壇，可以得到 45 秒祝福');
  if (shrine && !shrine.used && dist(shrine, p) < 48) useShrine();
  for (let i = booms.length - 1; i >= 0; i--) { const b = booms[i]; if ((b.t -= dt) <= 0) { booms.splice(i, 1); blast(b.x, b.y, b.R || 85, b.mult || 0.8, b.color || 0x9955ff, 0.35, true); } }
  const ptx = Math.floor(p.x / T), pty = Math.floor(p.y / T);
  for (const t of traps) {
    const up = (time + t.ph) % 2.6 > 1.75;
    if (Math.abs(t.tx - ptx) + Math.abs(t.ty - pty) < 4) tip('trap', '地上的鐵板是尖刺陷阱，等刺縮回去再走，或用閃避衝過去');
    if (up && !t.up && Math.abs(t.tx - ptx) + Math.abs(t.ty - pty) < 7) SND.spike();
    t.up = up;
    if (up && t.tx === ptx && t.ty === pty && p.trapCd <= 0 && p.dashT <= 0) { p.trapCd = 0.9; hurtPlayer(14 * (1 + 0.26 * (p.floor - 1))); }
  }
  // 音樂強度跟著附近醒著的敵人數量走
  let near = 0; for (const e of enemies) if (e.awake && dist(e, p) < 450) near++;
  musicTarget = (boss && boss.awake) || p.burnT > 0 ? 1 : Math.min(0.8, near * 0.2);
  intensity += (musicTarget - intensity) * Math.min(1, dt * 0.9);
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
  'npc', 'chest', 'chest_gold', 'pillar', 'coin_stack_small', 'coin_stack_medium', 'coin_stack_large', 'h_sword_2handed', 'h_axe_1handed', 'h_dagger', 'h_crossbow', 'h_staff',
  'h_shield_round', 'h_shield_square', 'h_shield_spikes', 'table_medium', 'stool', 'keg', 'crates_stacked', 'barrel_small_stack', 'column', 'candle_triple'];
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
let hero = null, npc = null;
const ents = new THREE.Group(); scene.add(ents);
let lvl = new THREE.Group(); scene.add(lvl);
let torchSpots = [], flames = null, stairFx = null, shrineFx = null, trapFx = null;

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
  if (e.summoned || e.rise) c.once('Spawn_Ground_Skeletons', e.rise ? 1.5 : 2.2); else c.play('Idle');
  if (e.elite) { const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); ring.scale.setScalar(e.r * U * 1.2 / c.root.scale.x); ring.position.y = 0.08; c.root.add(ring); c.ring = ring; }
  ents.add(c.root); e.v = c; return c;
}
// 主角手上的武器與盾牌跟著裝備換
const WMODEL = { '手弩': 'h_crossbow', '法杖': 'h_staff', '短劍': 'h_dagger', '戰斧': 'h_axe_1handed', '巨劍': 'h_sword_2handed', '釘錘': 'h_axe_1handed', '彎刀': 'w_blade' };
const SHIELDS = ['h_shield_round', null, 'h_shield_square', 'h_shield_spikes'];
function heroLook() {
  if (!hero) return;
  for (const o of hero.gear || []) o.dispose(); hero.gear = [];
  const sw = hero.root.getObjectByName('1H_Sword'), sh = hero.root.getObjectByName('Badge_Shield'), w = p.equip.weapon, a = p.equip.armor;
  const put = (model, slot, it) => { const bone = hero.root.getObjectByName(slot); if (!bone) return; const o = tintClone(model, 1, colOf(RAR[it.rarity].c).getHex(), it.rarity * 0.2); bone.add(o); hero.gear.push(o); };
  const wm = w && WMODEL[w.kind], sm = a && SHIELDS[a.rarity];
  if (sw) sw.visible = !!w && !wm; if (sh) sh.visible = !!a && !sm;
  if (wm) put(wm, 'handslotr', w); if (sm) put(sm, 'handslotl', a);
  hero.hand = hero.root.getObjectByName('handslotr'); hero.glow = w && w.rarity === 3 ? RAR[3].c : null;
}
function charOnce(e, name, ts, lock) { if (e.v) e.v.once(name, ts, lock); }
function toCorpse(e) {
  if (e.tele) { e.tele.visible = false; e.tele = null; }
  if (!e.v) return;
  const c = e.v; e.v = null; c.emissive(0, 0); if (c.ring) c.ring.visible = false;
  c.once(e.type === 'boss' ? 'Death_A' : 'Death_C_Skeletons', e.type === 'boss' ? 0.8 : 1.4, 99);
  corpses.push({ c, t: e.type === 'boss' ? 4 : 2.6, vx: e.type === 'boss' ? 0 : e.kx * 0.5, vy: e.type === 'boss' ? 0 : e.ky * 0.5 });
}
function killVis(o) { if (o.v) { if (o.v.dispose) o.v.dispose(); else o.v.removeFromParent(); o.v = null; } if (o.light) { o.light.intensity = 0; o.light.userData.used = false; o.light = null; } }
function clearEntities() {
  for (const t of totems) killVis(t); totems = [];
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
  scene.remove(lvl); lvl.traverse(o => { if (o.isInstancedMesh) o.dispose(); if (o.isMesh && o.userData.own) { o.geometry.dispose(); o.material.dispose(); } });
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
  }
  for (const n in L) inst(n, L[n]);
  if (npc) npc.dispose();
  npc = new Char('npc', CLIPS.knight); npc.root.position.set(merchant.x * U, 0, merchant.y * U); npc.play('Idle'); ents.add(npc.root);
  for (const d of decos) { if (!d.model) continue; const o = kitClone(d.model, d.s); o.position.set(d.x * U, 0, d.y * U); o.rotation.y = d.rot; lvl.add(o); }
  for (const d of fluff) { const o = kitClone(d.model, d.s); o.position.set(d.x * U, d.h || 0, d.y * U); o.rotation.y = d.rot; lvl.add(o); }
  shrineFx = null;
  if (shrine) { // 祭壇：石柱上浮著一顆光球
    const col = BUFFS[shrine.kind][3], orb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: col }));
    orb.position.set(shrine.x * U, 3, shrine.y * U); orb.userData.own = true; lvl.add(orb);
    const l = new THREE.PointLight(col, 40, 18, 1.6); l.position.copy(orb.position); lvl.add(l); shrineFx = { orb, l };
  }
  trapFx = null;
  if (traps.length) { // 尖刺陷阱：一塊鐵板加九根會升降的刺
    const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(3.5, 0.08, 3.5), new THREE.MeshStandardMaterial({ color: 0x6a5a58, metalness: 0.1, roughness: 0.8 }), traps.length);
    traps.forEach((t, i) => { tmpM.makeTranslation(t.tx * 4 + 2, 0.08, t.ty * 4 + 2); plates.setMatrixAt(i, tmpM); });
    const spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 1.5, 6), new THREE.MeshStandardMaterial({ color: 0xd8d8e4, metalness: 0.2, roughness: 0.4, emissive: 0x301008 }), traps.length * 9);
    for (const m of [plates, spikes]) { m.userData.own = true; m.frustumCulled = false; m.receiveShadow = true; lvl.add(m); }
    trapFx = spikes;
  }
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
function fxSlash(x, y, a, combo, sc = 1, color = 0xfff0c8) {
  let s = slashes.find(s => !s.visible);
  if (!s) { if (slashes.length > 5) return; s = new THREE.Mesh(slashGeo, slashMat()); s.frustumCulled = false; slashes.push(s); scene.add(s); }
  s.visible = true; s.position.set(x * U, 1.3, y * U); s.rotation.set(0, -a, 0); s.scale.set(sc, 1, combo === 1 ? -sc : sc); s.material.uniforms.col.value.setHex(color); s.userData.t = 0;
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

const shotGeo = new THREE.SphereGeometry(1, 12, 8), totemMat = new THREE.MeshBasicMaterial({ color: 0xff9a3a });
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
  torch.position.set(p.x * U, 4.6, p.y * U); torch.intensity = 62 * fl * (p.burnT > 0 ? 2.1 : 1); torch.color.setHex(p.burnT > 0 ? 0xff7030 : 0xffb070);
  moon.position.set(p.x * U - 14, 34, p.y * U + 12); moon.target.position.set(p.x * U, 0, p.y * U);
  torchSpots.sort((a, b) => ((a.x - camTgt.x) ** 2 + (a.z - camTgt.z) ** 2) - ((b.x - camTgt.x) ** 2 + (b.z - camTgt.z) ** 2));
  wallLights.forEach((l, i) => { const s = torchSpots[i]; if (s) { l.position.set(s.x + 0.5, s.y, s.z + 0.5); l.intensity = 42 * (1 + Math.sin(time * 13 + s.x) * 0.1); } else l.intensity = 0; });
  torchSpots.forEach((s, i) => {
    const k = 1 + Math.sin(time * 17 + s.x * 3) * 0.2; tmpM.makeScale(k, k * 1.5, k).setPosition(s.x, s.y + 0.1, s.z); flames.setMatrixAt(i, tmpM);
    if (i < 8 && dt > 0 && Math.random() < 0.12) parts.push(mkPart(s.x / U, s.z / U, s.y + 0.2, rand(-4, 4), rand(-4, 4), rand(1, 2.5), '#ff9a40', 0.6, 3, -1));
  });
  flames.instanceMatrix.needsUpdate = true;
  for (const l of fxLights) if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = Math.max(0, l.userData.t / l.userData.dur) * l.userData.peak; }
  if (shrineFx) { shrineFx.orb.visible = !shrine.used; shrineFx.orb.position.y = 3 + Math.sin(time * 2) * 0.2; shrineFx.l.intensity = shrine.used ? 0 : 40 + Math.sin(time * 5) * 8; }
  if (trapFx) {
    traps.forEach((t, i) => {
      const ph = (time + t.ph) % 2.6, h = ph < 1.3 ? 0.15 : ph < 1.75 ? 0.2 : ph < 1.83 ? 0.2 + (ph - 1.75) / 0.08 * 0.8 : ph < 2.45 ? 1 : 1 - (ph - 2.45) / 0.15;
      for (let k = 0; k < 9; k++) { tmpM.makeTranslation(t.tx * 4 + 2 + ((k % 3) - 1) * 1.05, -0.8 + h * 1.5, t.ty * 4 + 2 + (Math.floor(k / 3) - 1) * 1.05); trapFx.setMatrixAt(i * 9 + k, tmpM); }
    });
    trapFx.instanceMatrix.needsUpdate = true;
  }
  stairFx.beam.visible = stairFx.sl.visible = stairs.open; stairFx.beam.material.opacity = 0.14 + Math.sin(time * 3) * 0.05;

  // --- 主角 ---
  if (!hero) { hero = new Char('knight', CLIPS.knight); ents.add(hero.root); hero.face = 0; heroLook(); }
  hero.root.position.set(p.x * U, p.leap ? Math.sin(Math.PI * Math.min(1, p.leap.t / p.leap.T)) * 3.2 : 0, p.y * U);
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
  hero.emissive(p.hurtT > 0 ? 0xff2020 : p.burnT > 0 ? 0xff5a10 : 0x000000, p.hurtT > 0 ? 0.8 : p.burnT > 0 ? 0.45 + Math.sin(time * 12) * 0.15 : 0);
  hero.mixer.update(dt);
  if (hero.glow && hero.hand && dt > 0) { v3.set(0, 1.1, 0); hero.hand.localToWorld(v3); parts.push(mkPart(v3.x / U, v3.z / U, v3.y, 0, 0, 0.6, hero.glow, 0.35, 4.5)); }
  if (npc) { const a = Math.atan2(p.y - merchant.y, p.x - merchant.x); npc.root.rotation.y += angDiff(Math.PI / 2 - a, npc.root.rotation.y) * Math.min(1, dt * 4); npc.mixer.update(dt); }
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
    if (e.freeze > 0) c.emissive(0x2050c0, 0.55); else if (e.wardT > 0) c.emissive(0x30e0ff, 1.1); else if (e.flash > 0) c.emissive(0xffffff, 0.9); else c.emissive(c.base, c.baseK);
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
    if (c.vx || c.vy) { const nx = c.c.root.position.x + c.vx * U * dt, nz = c.c.root.position.z + c.vy * U * dt; if (!solid(Math.floor(nx / 4), Math.floor(nz / 4))) { c.c.root.position.x = nx; c.c.root.position.z = nz; } c.vx *= Math.pow(0.01, dt); c.vy *= Math.pow(0.01, dt); }
    if (c.t < 0.8) c.c.root.position.y -= dt * 1.6;
    if (c.t <= 0) c.c.dispose();
  }
  corpses = corpses.filter(c => c.t > 0);

  // --- 投射物 ---
  for (const s of shots) {
    if (!s.v) {
      s.v = new THREE.Mesh(shotGeo, new THREE.MeshBasicMaterial({ color: s.col })); s.v.dispose = function () { this.material.dispose(); this.removeFromParent(); }; scene.add(s.v);
      const r = s.r * U * (s.fire ? 0.6 : 0.55);
      if (s.wave) s.v.scale.set(0.45, 0.9, 2.5); else if (s.arrow && s.ps) s.v.scale.set(r * 4.5, r * 0.6, r * 0.6); else if (s.arrow) s.v.scale.set(r * 3.4, r * 0.5, r * 0.5); else s.v.scale.setScalar(r);
      s.v.rotation.y = -Math.atan2(s.vy, s.vx);
      if (s.fire) { const l = fxLights.find(l => l.userData.t <= 0 && !l.userData.used); if (l) { l.userData.used = true; l.color.setHex(0xff8030); l.intensity = 60; s.light = l; } }
    }
    s.v.position.set(s.x * U, 1.3, s.y * U);
    if (s.light) s.light.position.set(s.x * U, 1.6, s.y * U);
    if (!s.fire && !s.arrow && dt > 0 && Math.random() < 0.5) parts.push(mkPart(s.x, s.y, 1.3, 0, 0, 0, s.col, 0.25, 4));
  }
  for (const t of totems) {
    if (!t.v) { t.v = kitClone('column', 1.15); const orb = new THREE.Mesh(shotGeo, totemMat); orb.scale.setScalar(0.4); orb.position.y = 1.75; t.v.add(orb); t.orb = orb; t.v.position.set(t.x * U, 0, t.y * U); scene.add(t.v); }
    t.orb.scale.setScalar(0.4 + Math.sin(time * 9) * 0.06); if (t.t < 1) t.v.scale.setScalar(1.15 * Math.max(0.05, t.t));
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
    if (e.elite) { c.font = '12px sans-serif'; c.fillStyle = '#ffd84a'; c.strokeStyle = '#000'; c.lineWidth = 3; const nm = `菁英 ${ET[e.type].n}〔${TRAITN[e.trait] || ''}〕`; c.strokeText(nm, x, y - 5); c.fillText(nm, x, y - 5); }
  }
  if (merchant) { const [x, y, ok] = project(merchant.x, 3.3, merchant.y); if (ok && x > -40 && x < W + 40) { c.font = '13px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText('💰 商人', x, y); c.fillStyle = '#ffe9b0'; c.fillText('💰 商人', x, y); } }
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
  if (shrine && !shrine.used && explored[Math.floor(shrine.y / T) * MW + Math.floor(shrine.x / T)]) { mctx.fillStyle = '#5ef'; mctx.fillRect(Math.floor(shrine.x / T), Math.floor(shrine.y / T), 2, 2); }
  for (const o of props) if (o.vault && !o.open && explored[Math.floor(o.y / T) * MW + Math.floor(o.x / T)]) { mctx.fillStyle = '#fd4'; mctx.fillRect(Math.floor(o.x / T), Math.floor(o.y / T), 2, 2); }
  if (merchant) { mctx.fillStyle = '#fff'; mctx.fillRect(Math.floor(merchant.x / T), Math.floor(merchant.y / T), 2, 2); }
  mctx.fillStyle = '#5f5'; mctx.fillRect(Math.floor(p.x / T) - 0.5, Math.floor(p.y / T) - 0.5, 2, 2);
}

// ---------- 介面 ----------
let bannerT = null;
function banner(a, b) { const el = $('banner'); el.innerHTML = `${a}<small>${b || ''}</small>`; el.style.opacity = 1; clearTimeout(bannerT); bannerT = setTimeout(() => el.style.opacity = 0, 2200); }
const setBar = (id, v, max, txt) => { const b = $(id); b.firstElementChild.style.width = clamp(v / max * 100, 0, 100) + '%'; if (txt) b.lastElementChild.textContent = `${Math.ceil(v)} / ${max}`; };
let hudT = 0;
function hud() {
  setBar('hpBar', p.hp, p.st.hp, 1); setBar('mpBar', p.mp, p.st.mp, 1);
  for (let i = 0; i < 4; i++) {
    const k = i < 3 ? p.slots[i] : 'dash', el = $(i < 3 ? 'sk-s' + i : 'sk-dash');
    if (i < 3) { const ic = k ? SK[k].i : '＋'; if (el.children[1].textContent !== ic) el.children[1].textContent = ic; }
    el.lastElementChild.style.height = k ? clamp(p.cd[k] / SK[k].cd * 100, 0, 100) + '%' : '0';
    el.classList.toggle('nomp', !k || p.mp < SK[k].mp);
  }
  const eb = $('sk-ember'), full = p.ember >= 100 && p.burnT <= 0;
  eb.lastElementChild.style.height = (p.burnT > 0 ? p.burnT / 8 * 100 : 100 - p.ember) + '%'; eb.classList.toggle('ready', full); eb.classList.toggle('burning', p.burnT > 0);
  $('emberBar').firstElementChild.style.width = (p.burnT > 0 ? p.burnT / 8 * 100 : p.ember) + '%';
  const bb = $('boss');
  if (boss && boss.awake) { bb.style.display = 'block'; $('bossName').textContent = boss.name; bb.querySelector('i').style.width = clamp(boss.hp / boss.maxHp * 100, 0, 100) + '%'; }
  else bb.style.display = 'none';
  if (++hudT % 10) return; // 其餘不常變的，每 10 幀更新一次
  let bt = ''; if (p.buff) { const b = BUFFS[p.buff.k]; bt = `${b[0]} ${b[1]} ${Math.ceil(p.buff.t)}s　`; } if (p.streak >= 3) bt += `🔥 連殺 ×${p.streak}`;
  $('buff').textContent = bt;
  $('fl').textContent = p.floor; $('lv').textContent = p.lvl; $('gold').textContent = p.gold;
  setBar('xpBar', p.xp, xpNeed(p.lvl));
  $('sk-hp').children[1].textContent = p.hpPot; $('sk-mpp').children[1].textContent = p.mpPot;
  $('sk-hp').classList.toggle('nomp', !p.hpPot); $('sk-mpp').classList.toggle('nomp', !p.mpPot);
  $('bagBtn').classList.toggle('glow', p.inv.some(it => upgradeOf(it) > 0.5));
}

let sel = null;
const potCost = () => 20 + p.floor * 5;
function itemHtml(it) {
  let h = `<b style="color:${RAR[it.rarity].c}">${it.name}${it.up ? ' +' + it.up : ''}</b> <span class="dim">${RAR[it.rarity].n}${SLOTS[it.slot].n}・Lv ${it.lvl}</span><br>`;
  if (it.slot === 'weapon') { const w = wtOf(it); h += `<span style="color:#e9c14a">${w.n}：${w.desc}</span><br>`; }
  for (const k in it.base) h += fmt(k, iv(it, it.base[k])) + '<br>';
  for (const a of it.aff) h += `<span style="color:#9cf">${fmt(a.k, iv(it, a.v))}</span><br>`;
  if (it.fx && LEGFX[it.fx]) h += `<span style="color:#ff8a3a">★ ${LEGFX[it.fx].d}</span><br>`;
  return h;
}
function upgradeOf(it) { const eq = Object.assign({}, p.equip), cur = p.equip[it.slot]; eq[it.slot] = it; return power(calcStats(eq)) - power(p.st) + (it.fx ? 60 : 0) - (cur && cur.fx ? 60 : 0); }
function drawPanel() {
  const st = p.st;
  $('eq').innerHTML = Object.keys(SLOTS).map(s => { const it = p.equip[s]; return `<div class="slot${sel && sel.it === it && it ? ' sel' : ''}" data-eq="${s}" style="border-color:${it ? RAR[it.rarity].c : '#443a55'}">${it ? SLOTS[s].i : ''}<small>${SLOTS[s].n}</small></div>`; }).join('');
  $('stats').innerHTML = Object.keys(STAT).map(k => `${STAT[k][0]}　<b>${Number.isInteger(st[k]) ? st[k] : st[k].toFixed(1)}${STAT[k][1] ? '%' : ''}</b>`).join('<br>');
  const junk = p.inv.filter(it => upgradeOf(it) <= 0.5 && !it.fx), sum = a => a.reduce((t, it) => t + it.val, 0);
  $('sellJunk').textContent = `賣掉用不到的（${junk.length} 件 +${sum(junk)} 金）`; $('sellJunk').disabled = !junk.length;
  $('sellAll').textContent = `全部賣掉（+${sum(p.inv)} 金）`; $('sellAll').disabled = !p.inv.length;
  $('spTxt').textContent = '點 Q／E／R 把技能放上對應的按鈕';
  $('skl').innerHTML = SKILLS.filter(k => p.skl[k]).map(k => `<div class="row"><span>${SK[k].i} <b>${SK[k].n}</b> Lv ${p.skl[k]}　<span class="dim">${SK[k].d(p.skl[k])}</span></span>${['Q', 'E', 'R'].map((q, i2) => `<button class="btn mini${p.slots[i2] === k ? ' on' : ''}" data-slot="${k}:${i2}">${q}</button>`).join('')}</div>`).join('')
    + `<div class="dim" style="font-size:13px;line-height:1.7;margin-top:4px">${Object.keys(p.mods).map(m => `<span style="color:#ff8a3a">◆${MODS[m][1]}</span>`).concat(Object.keys(p.pas).map(k => `<span style="color:#ffd84a">✨${PAS[k][0]}${p.pas[k] > 1 ? '×' + p.pas[k] : ''}</span>`)).join('　') || '升級時可以選卡片：新技能、變體、被動'}</div>`;
  $('panelGold').textContent = `💰 ${p.gold}`;
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
  if (state !== 'play' || storeOpen) return;
  paused = on === undefined ? !paused : on; sel = null;
  $('panel').classList.toggle('on', paused);
  if (paused) { drawPanel(); joy.id = null; atkHeld = false; mouse.l = mouse.r = false; } else save();
}
$('panel').addEventListener('click', ev => {
  if (ev.target === $('panel')) return togglePanel(false);
  const t = ev.target.closest('[data-inv],[data-eq],[data-slot],[data-buy],[data-act]'); if (!t) return;
  const ds = t.dataset;
  if (ds.inv !== undefined) sel = { from: 'inv', it: p.inv[+ds.inv] };
  else if (ds.eq) sel = p.equip[ds.eq] ? { from: 'eq', it: p.equip[ds.eq] } : null;
  else if (ds.slot) { const [k, i2] = ds.slot.split(':'), old = p.slots.indexOf(k); if (old >= 0) p.slots[old] = p.slots[+i2]; p.slots[+i2] = k; SND.card(); } // 已在別格就對調
  else if (ds.buy) { const c = potCost(); if (p.gold >= c) { p.gold -= c; if (ds.buy === 'hp') p.hpPot++; else p.mpPot++; sfx(900, 0.06, 'square', 0.03); } }
  else if (ds.act && sel) {
    const it = sel.it, i = p.inv.indexOf(it);
    if (ds.act === 'equip' && i >= 0) { const old = p.equip[it.slot]; p.equip[it.slot] = it; if (old) p.inv[i] = old; else p.inv.splice(i, 1); sfx(500, 0.1, 'triangle', 0.05, 200); }
    else if (ds.act === 'sell' && i >= 0) { p.inv.splice(i, 1); p.gold += it.val; sfx(1200, 0.05, 'square', 0.03); }
    else if (ds.act === 'unequip' && p.inv.length < 24) { p.equip[it.slot] = null; p.inv.push(it); }
    sel = null; refresh(); heroLook();
  }
  drawPanel();
});
// 商人：藥水、當層商品、神秘寶箱、強化、永久訓練
function openStore() { if (state !== 'play' || paused) return; paused = storeOpen = true; joy.id = null; atkHeld = false; mouse.l = mouse.r = false; $('store').classList.add('on'); drawStore(); tip('store', '強化和訓練是永久的；倒下會掉三成金幣，別存太多'); }
function closeStore() { paused = storeOpen = false; $('store').classList.remove('on'); refresh(); heroLook(); save(); }
function drawStore() {
  const g = p.gold, btn = (attr, cost, ok = true, label) => `<button class="btn" ${attr} ${g >= cost && ok ? '' : 'disabled'}>${label || cost + ' 金'}</button>`;
  $('storeGold').textContent = `💰 ${g}`;
  const c = potCost();
  let h = `<h2>藥水</h2><div class="row"><span>🧪 生命藥水（持有 ${p.hpPot}/9）</span>${btn('data-buy="hp"', c, p.hpPot < 9)}</div>
    <div class="row"><span>💧 魔力藥水（持有 ${p.mpPot}/9）</span>${btn('data-buy="mp"', c, p.mpPot < 9)}</div><h2>這一層的貨</h2>`;
  const full = p.inv.length >= 24;
  stock.forEach((it, i) => { h += it ? `<div class="row"><span>${SLOTS[it.slot].i} ${itemHtml(it)}${upgradeOf(it) > 0.5 ? '<span class="good">▲ 比身上的好</span>' : ''}</span>${btn(`data-item="${i}"`, priceOf(it), !full)}</div>` : ''; });
  if (!stock.some(x => x)) h += '<div class="row dim"><span>賣完了，下一層會進新貨</span></div>';
  h += `<h2>神秘寶箱</h2><div class="row"><span>🎁 開出一件隨機裝備，有機會是傳說${boxMsg ? '<br>' + boxMsg : ''}</span>${btn('data-box="1"', boxCost(), !full)}</div>`;
  if (full) h += '<div class="row bad"><span>背包滿了，先到 🎒 賣掉一些</span></div>';
  h += '<h2>強化身上的裝備 <span class="dim">每級所有數值 +12%</span></h2>';
  for (const k in SLOTS) { const it = p.equip[k]; h += it ? `<div class="row"><span>${SLOTS[k].i} <b style="color:${RAR[it.rarity].c}">${it.name}${it.up ? ' +' + it.up : ''}</b></span>${(it.up || 0) >= 8 ? '<span class="dim">已到頂</span>' : btn(`data-upg="${k}"`, upCost(it))}</div>` : `<div class="row dim"><span>${SLOTS[k].i} ${SLOTS[k].n}：沒有裝備</span></div>`; }
  h += '<h2>訓練 <span class="dim">永久提升，倒下也不會消失</span></h2>';
  for (const k in TRAIN) h += `<div class="row"><span><b>${TRAIN[k][0]}</b> Lv ${p.train[k]}　<span class="dim">${TRAIN[k][1]}</span></span>${btn(`data-train="${k}"`, trainCost(k))}</div>`;
  $('storeBody').innerHTML = h;
}
$('store').addEventListener('click', ev => {
  if (ev.target === $('store')) return closeStore();
  const t = ev.target.closest('[data-buy],[data-item],[data-box],[data-upg],[data-train]'); if (!t || t.disabled) return;
  const ds = t.dataset, pay = c => { if (p.gold < c) return false; p.gold -= c; SND.coin(); return true; };
  if (ds.buy) { if ((ds.buy === 'hp' ? p.hpPot : p.mpPot) < 9 && pay(potCost())) { if (ds.buy === 'hp') p.hpPot++; else p.mpPot++; } }
  else if (ds.item !== undefined) { const it = stock[+ds.item]; if (it && p.inv.length < 24 && pay(priceOf(it))) { p.inv.push(it); stock[+ds.item] = null; } }
  else if (ds.box) {
    if (p.inv.length < 24 && pay(boxCost())) {
      const r = Math.random(), it = makeItem(p.floor, r < 0.07 ? 3 : r < 0.3 ? 2 : r < 0.75 ? 1 : 0); p.inv.push(it);
      boxMsg = `開出了：<b style="color:${RAR[it.rarity].c}">${it.name}</b>${upgradeOf(it) > 0.5 ? ' <span class="good">▲</span>' : ''}`; if (it.rarity >= 2) SND.level();
    }
  }
  else if (ds.upg) { const it = p.equip[ds.upg]; if (it && (it.up || 0) < 8 && pay(upCost(it))) { it.up = (it.up || 0) + 1; SND.level(); refresh(); } }
  else if (ds.train) { if (pay(trainCost(ds.train))) { p.train[ds.train]++; SND.level(); refresh(); } }
  drawStore();
});
$('storeClose').onclick = closeStore;
const sellIf = f => { let g = 0; p.inv = p.inv.filter(it => !f(it) || (g += it.val, false)); p.gold += g; sel = null; if (g) SND.coin(); drawPanel(); };
$('sellJunk').onclick = () => sellIf(it => upgradeOf(it) <= 0.5 && !it.fx);
$('sellAll').onclick = () => { if (confirm('背包裡的裝備全部賣掉？（身上穿的不會賣）')) sellIf(() => true); };
$('cards').addEventListener('click', ev => {
  const t = ev.target.closest('[data-card]'); if (!t) return;
  takeCard(cards[+t.dataset.card]); p.picks--;
  if (p.picks > 0) { cards = rollCards(); if (cards.length) return drawCards(); p.picks = 0; }
  $('cards').classList.remove('on'); paused = false; cards = null; save();
});
$('closeBtn').onclick = () => togglePanel(false);
$('bagBtn').onclick = () => togglePanel();
$('sndBtn').onclick = () => { muted = !muted; $('sndBtn').textContent = muted ? '🔇' : '🔊'; audioInit(); if (master) master.gain.value = muted ? 0 : 1; };
function nextCam() { camMode = (camMode + 1) % CAMS.length; try { localStorage.setItem('ember-depths-cam', camMode); } catch (e) { /* 沒差 */ } if (state === 'play') banner('', '視角：' + CAMS[camMode].name); }
$('camBtn').onclick = nextCam;
try { camMode = (+localStorage.getItem('ember-depths-cam') || 0) % CAMS.length; } catch (e) { /* 沒差 */ }
$('act').onclick = interact;

function startGame(fresh, df = 0) {
  if (fresh || !load()) { newPlayer(); p.diff = df; }
  state = 'play'; paused = false; $('menu').classList.remove('on'); audioInit(); genFloor(); heroLook();
  if (fresh) { dropItem(p.x - 55, p.y + 45, makeItem(1, 0, 'weapon', '手弩')); dropItem(p.x + 55, p.y + 45, makeItem(1, 0, 'weapon', '法杖')); setTimeout(() => tip('weap', '地上有手弩和法杖：撿起來到 🎒 換上，普攻的打法會跟著武器變'), 5000); }
  if (p.floor === 1 && p.lvl === 1) { tip('move', touchMode ? '左半邊螢幕拖曳移動，右下 ⚔️ 按住就會自動瞄準攻擊' : 'WASD 移動，按住滑鼠左鍵朝游標攻擊，Q／E／R 是技能'); setTimeout(() => tip('shop', '旁邊的商人賣藥水和裝備，也能強化裝備；每層起點都有一位'), 9000); }
}
for (const b of document.querySelectorAll('[data-diff]')) b.onclick = () => { if (!hasSave() || confirm('要放棄目前的進度，重新開始嗎？')) startGame(true, +b.dataset.diff); };
$('contBtn').onclick = () => startGame(false);
$('reviveBtn').onclick = () => { $('dead').classList.remove('on'); if (state !== 'dead') { paused = false; return; } resetRuntime(); refresh(); p.hp = p.st.hp; p.mp = p.st.mp; state = 'play'; if (hero) hero.lock = 0; genFloor(); };

// ---------- 輸入 ----------
addEventListener('keydown', e => {
  if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return; keys[e.code] = true;
  if (e.code === 'KeyI' || e.code === 'Tab' || e.code === 'KeyC' || e.code === 'KeyB') togglePanel();
  else if (e.code === 'Escape') { if (storeOpen) closeStore(); else if (paused) togglePanel(false); }
  else if (e.code === 'KeyQ') cast(p && p.slots[0]); else if (e.code === 'KeyE') cast(p && p.slots[1]); else if (e.code === 'KeyR') cast(p && p.slots[2]); else if (e.code === 'KeyG') cast('ember');
  else if (e.code === 'Space') cast('dash'); else if (e.code === 'Digit1') cast('hp'); else if (e.code === 'Digit2') cast('mpp');
  else if (e.code === 'KeyF') interact(); else if (e.code === 'KeyV') nextCam();
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
  b.addEventListener('pointerdown', e => { e.preventDefault(); if (e.pointerType === 'touch') setTouch(true); if (b.dataset.k === 'atk') { atkHeld = true; try { b.setPointerCapture(e.pointerId); } catch (er) { /* 舊瀏覽器 */ } } cast(b.dataset.slot !== undefined ? p && p.slots[+b.dataset.slot] : b.dataset.k); });
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
    else if (state === 'play' && !paused) { if (p.picks > 0) openCards(); else update(dt); }
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
  get p() { return p; }, get enemies() { return enemies; }, get state() { return state; }, get stairs() { return stairs; }, get boss() { return boss; }, get rooms() { return rooms; }, get props() { return props; }, get merchant() { return merchant; }, get cards() { return cards; }, takeCard, rollCards, SK, SKILLS, MODS, PAS, openStore, closeStore, get traps() { return traps; }, get shrine() { return shrine; }, heroLook, refresh,
  get quality() { return quality; }, setQuality(v) { autoQ = false; quality = v; applyQuality(); },
  update, descend, cast, keys, mouse, spawnEnemy, hurtPlayer, dropItem, makeItem, genFloor, setCam(i) { camMode = i; camReady = false; }, info: () => renderer.info.render,
};
