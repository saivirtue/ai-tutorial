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
  bossIntro: () => { for (let i = 0; i < 3; i++) { sfx(55, 0.5, 'sine', 0.22, -20, i * 0.32); noise(0.3, 0.12, 400, 0, i * 0.32); } sfx(110, 1.6, 'sawtooth', 0.07, -40, 0.9); },
  hit: (w, n = 0) => { const k = !w ? 1 : w.heavy ? 0.6 : w.n === '匕首' ? 1.4 : 1; noise(0.07 / k, 0.13, 2400 * k); sfx(125 * k * semi(Math.min(n, 12)), 0.1, 'square', 0.06, -70); if (w && w.heavy) sfx(60, 0.25, 'sine', 0.16, -25); else sfx(rand(1800, 2600), 0.05, 'triangle', 0.018); },
  shoot: magic => { if (magic) { sfx(rand(600, 720), 0.16, 'sine', 0.05, 500); noise(0.08, 0.03, 6000, 3000); } else { sfx(rand(170, 200), 0.09, 'sawtooth', 0.05, -90); noise(0.05, 0.06, 4500, 1500); } },
  crit: () => { sfx(rand(2600, 3000), 0.08, 'square', 0.03); sfx(70, 0.2, 'sine', 0.14, -30); noise(0.1, 0.08, 6000, 2000); },
  legend: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => sfx(f, 0.5, 'triangle', 0.07, 0, i * 0.07)); sfx(130, 1.2, 'sawtooth', 0.08, 0); noise(0.6, 0.06, 7000, 3000); },
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
let blk = [], decos = [], fluff = [], traps = [], booms = [], shrine = null, hitBlk = null, braziers = [];
let merchant = null, stock = [], boxMsg = '', actMode = null, storeOpen = false;
let totems = [], pools = [], dangers = [], cards = null, lockRoom = null, holes = [];
let range = null, prisoner = null, campFire = null, board = null, extraChars = [], campBlds = [];
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
let gate = new Uint8Array(MW * MH); // 競技場封門時暫時變成牆的格子
const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= MW || ty >= MH || map[ty * MW + tx] === 1 || gate[ty * MW + tx] === 1;
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
// ---------- 遠征 ----------
// 每趟遠征 2～3 層；最後一層是目標（首領或救人）。區域等級決定敵人強度：等效樓層 = (等級-1)×3 + 第幾層
const RUNMOD = {
  none: ['', ''],
  elite: ['菁英大軍', '菁英怪變兩倍，獎勵箱多一件'],
  swift: ['狂奔', '敵人快 25%，經驗 +30%'],
  dark: ['長夜', '火把只有一半亮，金幣 +50%'],
};
const RESCUE = [
  { n: '鐵匠 葛倫', tint: 0xd09060, b: 'smith', ask: '幫我把鐵匠鋪蓋起來吧，要骨片和餘燼結晶。', line: '鐵砧熱了。拿裝備來，我幫你敲得更硬。' },
  { n: '祭司 薇拉', tint: 0xe0e0ff, b: 'altar', ask: '篝火旁那塊空地，可以立一座祭壇。', line: '餘燼裡有古老的力量……我會替你守著篝火。' },
  { n: '獵人 洛克', tint: 0x80c070, b: 'guild', ask: '給我一張桌子和一面旗，我就能開公會。', line: '那些骨頭會記仇。告示板上的活，我幫你挑好的。' },
  { n: '學者 米亞', tint: 0xc0a0ff, cls: 'mage', line: '每一層的牆都在講故事。帶我下去，我讓雷替你說話。' },
  { n: '遊俠 芙蕾', tint: 0xffb0a0, cls: 'ranger', line: '弩箭比劍快。換我上場試試？' },
  { n: '蠻族 布魯', tint: 0xffc890, cls: 'barb', line: '骨頭？我用斧頭跟它們講道理。' },
];
// 救人的順序：先救一個可玩角色，讓第二種玩法早點出現
const RESCUE_ORDER = ['鐵匠 葛倫', '遊俠 芙蕾', '祭司 薇拉', '獵人 洛克', '學者 米亞', '蠻族 布魯'];
// ---------- 可玩角色 ----------
// 等級、升級卡、身上裝備每個角色各自一份；金幣、材料、背包、建築、訓練全隊共用
const CLS = {
  knight: { n: '騎士', model: 'knight', w: '長劍', sk: 'fire', tags: ['fire', 'blade'], wts: ['sword', 'axe'], pool: ['fire', 'whirl', 'nova', 'leap'], d: '均衡型；擅長劍、斧；護甲 +20', st: s => { s.armor += 20; } },
  ranger: { n: '遊俠 芙蕾', model: 'h_rogue', w: '手弩', sk: 'volley', tags: ['blade', 'storm'], wts: ['xbow', 'dagger'], pool: ['volley', 'totem', 'bolt', 'fire'], d: '遠程型；擅長手弩、匕首；移速 +12%，閃避冷卻 -30%', st: s => { s.move += 12; } },
  mage: { n: '學者 米亞', model: 'h_mage', w: '法杖', sk: 'bolt', tags: ['storm', 'frost', 'fire'], wts: ['staff'], pool: ['bolt', 'nova', 'fire', 'totem'], d: '法術型；擅長法杖；魔力 +40%，每秒回魔 +1.5', st: s => { s.mp *= 1.4; s.mpr += 1.5; } },
  barb: { n: '蠻族 布魯', model: 'h_barb', w: '巨劍', sk: 'leap', tags: ['blade'], wts: ['great', 'axe'], pool: ['leap', 'whirl', 'nova', 'volley'], d: '近戰型；擅長巨劍、斧；生命 +25%，吸血 +3%', st: s => { s.hp *= 1.25; s.ls += 3; } },
};
const HERO_KEYS = ['lvl', 'xp', 'skl', 'slots', 'mods', 'pas', 'picks', 'equip', 'tal'];
// ---------- 天賦樹：每 5 級 1 點，每條分支要依序點，第 4 個是改變玩法的頂點 ----------
const TALENTS = {
  knight: [['🛡️ 守護', [['kA1', '堅甲', '護甲 +15%'], ['kA2', '強韌', '生命 +10%'], ['kA3', '盾擋', '受傷時 20% 機率格擋，傷害減半'], ['kA4', '不屈', '生命低於 30% 時，受到的傷害減半、攻擊 +30%']]],
    ['⚔️ 劍術', [['kB1', '磨刃', '攻擊 +8%'], ['kB2', '要害', '暴擊 +6%'], ['kB3', '重斬', '第三下重擊範圍 +30%、傷害 +30%'], ['kB4', '劍氣', '每第三下揮砍射出穿透的劍氣']]],
    ['🔥 烈焰', [['kC1', '火種', '火球傷害 +25%'], ['kC2', '連發', '火球冷卻 -25%'], ['kC3', '烈爆', '火球爆炸範圍 +30%'], ['kC4', '火雨', '火球爆炸後分裂，並留下火海']]]],
  ranger: [['🎯 狙擊', [['rA1', '穩手', '遠程普攻傷害 +15%'], ['rA2', '貫穿', '弩箭多穿透 1 個敵人'], ['rA3', '遠射', '打中 200 以外的敵人傷害 +30%'], ['rA4', '致命', '暴擊傷害從 2 倍變成 3 倍']]],
    ['💨 疾風', [['rB1', '輕盈', '移速 +10%'], ['rB2', '翻滾', '閃避冷卻 -20%'], ['rB3', '追風', '閃避後 2 秒攻速 +40%'], ['rB4', '影步', '閃避後的下一擊必定暴擊']]],
    ['⚙️ 機關', [['rC1', '耐久', '烈焰圖騰多持續 3 秒'], ['rC2', '連弩', '彈幕多射 3 發'], ['rC3', '引雷', '落雷多劈 2 個目標'], ['rC4', '雙塔', '烈焰圖騰一次放兩座']]]],
  mage: [['⚡ 雷霆', [['mA1', '導電', '落雷傷害 +25%'], ['mA2', '蓄電', '落雷冷卻 -30%'], ['mA3', '麻痺', '落雷讓敵人暈眩 0.8 秒'], ['mA4', '雷暴', '落雷多劈 3 個目標；暴擊時三成機率放出連鎖閃電']]],
    ['❄️ 寒冰', [['mB1', '霜寒', '冰霜新星範圍 +20%'], ['mB2', '凍結', '冰凍多 1 秒'], ['mB3', '碎骨', '冰凍中的敵人受到傷害 +30%'], ['mB4', '冰甲', '放出新星後 4 秒，受到的傷害減半']]],
    ['✨ 奧術', [['mC1', '深泉', '魔力 +20%'], ['mC2', '湧泉', '每秒回魔 +2'], ['mC3', '節流', '技能魔力消耗 -25%'], ['mC4', '魔湧', '魔力高於 80% 時，所有傷害 +30%']]]],
  barb: [['🩸 狂暴', [['bA1', '躁動', '攻速 +10%'], ['bA2', '背水', '生命低於 50% 時攻擊 +25%'], ['bA3', '飲血', '每次擊殺回復 2% 生命'], ['bA4', '嗜殺', '連殺 10 以上時攻速 +40%']]],
    ['🌋 震地', [['bB1', '重踏', '躍擊傷害 +25%'], ['bB2', '彈跳', '躍擊冷卻 -30%'], ['bB3', '震暈', '躍擊落地讓周圍敵人暈眩 1 秒'], ['bB4', '隕擊', '躍擊範圍 +60%，落地後再震一次']]],
    ['🗿 鋼鐵', [['bC1', '巨體', '生命 +15%'], ['bC2', '鐵皮', '護甲 +20%'], ['bC3', '反擊', '受傷時反打身邊的敵人'], ['bC4', '不倒', '每層一次：致命傷時不倒下，回復 40% 生命']]]],
};
const tl = id => !!(p && p.tal && p.tal[id]);
const talPts = () => Math.floor(p.lvl / 5) - Object.keys(p.tal || {}).length;
function talCan(id) { // 同一分支要依序點
  if (tl(id) || talPts() <= 0) return false;
  for (const [, nodes] of TALENTS[p.cls] || []) { const i = nodes.findIndex(n => n[0] === id); if (i >= 0) return i === 0 || tl(nodes[i - 1][0]); }
  return false;
}
const clsOf = () => CLS[(p && p.cls) || 'knight'];
const wtKey = it => (it && KIND2WT[it.kind]) || 'sword';
const inClass = it => !it || clsOf().wts.includes(wtKey(it)); // 非本職武器傷害 -30%
function switchHero(c) {
  if (c === p.cls || p.run) return;
  p.heroes[p.cls] = {}; for (const k of HERO_KEYS) p.heroes[p.cls][k] = p[k];
  let h = p.heroes[c];
  if (!h) { // 第一次上場：等級追上一點，多出來的等級變成升級卡
    const C = CLS[c], L = Math.max(1, Math.floor(p.lvl * 0.8));
    h = { lvl: L, xp: 0, skl: { [C.sk]: 1 }, slots: [C.sk, null, null], mods: {}, pas: {}, tal: {}, picks: L - 1, equip: { weapon: makeItem(Math.max(1, p.floor - 1), 1, 'weapon', C.w), armor: null, ring: null } };
  }
  Object.assign(p, h); p.cls = c; delete p.heroes[c];
  resetRuntime(); refresh(); p.hp = p.st.hp; p.mp = p.st.mp;
  if (hero) { hero.dispose(); hero = null; }
  genCamp(true); banner(CLS[c].n, CLS[c].d); SND.card();
}
// ---------- 營地建築 ----------
// 材料：🦴 骨片（擊殺常掉）、💎 餘燼結晶（菁英、鑰匙守衛、首領、寶庫）。cost[L] = 蓋到 L+1 級要的 [骨片, 結晶, 金幣]
const BLD = {
  train: { n: '訓練場', i: '🎯', need: null, cost: [[20, 0, 50], [150, 4, 1500], [400, 12, 5000]], d: L => `訓練上限 Lv ${[0, 5, 10, 20][L]}` },
  store: { n: '倉庫', i: '📦', need: null, cost: [[40, 1, 150], [180, 6, 2000], [450, 15, 6000]], d: L => `背包 ${24 + 6 * L} 格` },
  smith: { n: '鐵匠鋪', i: '⚒️', need: '鐵匠 葛倫', cost: [[50, 2, 300], [200, 8, 2500], [500, 18, 8000]], d: L => `熔鑄上限：熱度 ${HEAT[[0, 2, 4, 5][L]]}${L >= 3 ? '，熔鑄費用 -20%' : ''}` },
  altar: { n: '餘燼祭壇', i: '🕯️', need: '祭司 薇拉', cost: [[50, 3, 300], [200, 8, 2500], [500, 18, 8000]], d: L => ['', '可以重選升級卡', '可以重選升級卡；出發時餘燼 40', '重選半價；出發時餘燼 70'][L] },
  guild: { n: '獵人公會', i: '🏹', need: '獵人 洛克', cost: [[60, 3, 400], [220, 9, 3000], [550, 20, 9000]], d: L => ['', '告示板每次回營地可重抽 1 次', '重抽 2 次；完成獎勵金幣 +25%', '重抽 3 次；獎勵箱多一件'][L] },
};
const bl = k => (p.bld && p.bld[k]) || 0;
const canBuild = k => { const B = BLD[k], L = bl(k); if (L >= 3 || (B.need && !p.rescued.includes(B.need))) return false; const [cb, cc, cg] = B.cost[L]; return p.mats.bone >= cb && p.mats.cry >= cc && p.gold >= cg; };
const invCap = () => 24 + 6 * bl('store');
const trainCap = () => [0, 5, 10, 20][bl('train')];
// 建築外觀：沒蓋是一堆瓦礫，等級越高擺設越多。[模型, x 偏移, y 偏移, 縮放, 旋轉, 高度]
function bProps(k, L) {
  if (!L) return [['rubble_half', -8, 0, 0.4, 0]];
  const P = {
    train: [['column', -16, 0, 1], ['column', 16, 0, 1], ...(L >= 2 ? [['banner_patternA_red', 0, -14, 0.8]] : []), ...(L >= 3 ? [['sword_shield', 0, 12, 0.55, 0, 0.5]] : [])],
    smith: [['table_medium', 0, 0, 0.9], ['keg', 24, 6, 0.6], ...(L >= 2 ? [['crates_stacked', -24, 6, 0.6]] : []), ...(L >= 3 ? [['sword_shield', 0, -16, 0.6, 0, 0.6]] : [])],
    altar: [['pillar', 0, 0, 0.5], ...(L >= 2 ? [['shelf_small_candles', 0, 14, 1.2, 0, 0.4]] : []), ...(L >= 3 ? [['candle_triple', -16, 10, 1], ['candle_triple', 16, 10, 1]] : [])],
    store: [['crates_stacked', 0, 0, 0.8], ...(L >= 2 ? [['trunk_large_A', 22, 6, 0.9], ['barrel_small_stack', -22, 4, 0.7]] : []), ...(L >= 3 ? [['keg', 0, 20, 0.6], ['coin_stack_large', 20, -12, 0.8]] : [])],
    guild: [['table_medium', 0, 0, 0.9], ['h_crossbow', 0, 0, 1.3, 0.6, 1.05], ['banner_shield_green', 0, -16, 0.8], ...(L >= 2 ? [['trunk_large_A', 22, 4, 0.8]] : []), ...(L >= 3 ? [['coin_stack_large', -20, 8, 0.7]] : [])],
  };
  return P[k];
}
const runLen = t => t === 1 ? 2 : 3;
// 危險度：每一級讓敵人 +2 級，掉寶與材料變好
const effFloor = r => (r.tier - 1) * 4 + r.depth + (r.danger || 0) * 2;
const recLv = (tier, dg = 0) => 1 + (tier - 1) * 4 + dg * 2;
const mapName = t => PALS[(t - 1) % PALS.length].name;
// ---------- 回訪內容 ----------
// 以日期當種子，同一天每次打開都是同一組懸賞
function seeded(str) { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const thisWeek = () => { const d = new Date(), j = new Date(d.getFullYear(), 0, 1); return `${d.getFullYear()}-W${Math.ceil(((d - j) / 864e5 + j.getDay() + 1) / 7)}`; };
const BOUNTY = {
  kill: { d: b => `擊殺 ${b.need} 個敵人`, need: [120, 220], ev: 'kill' },
  elite: { d: b => `擊殺 ${b.need} 隻菁英`, need: [6, 12], ev: 'elite' },
  chest: { d: b => `打開 ${b.need} 個寶箱`, need: [4, 7], ev: 'chest' },
  brazier: { d: b => `點亮 ${b.need} 座火盆`, need: [6, 10], ev: 'brazier' },
  burn: { d: b => `引爆餘燼 ${b.need} 次`, need: [3, 6], ev: 'burn' },
  boss: { d: b => `打倒 ${b.need} 位首領`, need: [1, 2], ev: 'boss' },
  weap: { d: b => `用${WT[b.arg].n}完成 ${b.need} 趟遠征`, need: [1, 1], ev: 'clear', arg: r => ['xbow', 'staff', 'great', 'dagger', 'axe', 'sword'][Math.floor(r() * 6)] },
  nopot: { d: b => `不喝藥水完成 ${b.need} 趟遠征`, need: [1, 1], ev: 'clear' },
  mod: { d: b => `完成 ${b.need} 趟帶修飾詞（◆）的遠征`, need: [1, 2], ev: 'clear' },
};
function dailyCheck() {
  const day = today(); if (p.daily && p.daily.day === day) return;
  const r = seeded(day), keys = Object.keys(BOUNTY).sort(() => r() - 0.5), list = [];
  for (const k of keys.slice(0, 3 + (bl('guild') ? 1 : 0))) { const B = BOUNTY[k]; list.push({ k, n: 0, need: B.need[0] + Math.floor(r() * (B.need[1] - B.need[0] + 1)), arg: B.arg ? B.arg(r) : null, done: false, claimed: false }); }
  p.daily = { day, list };
}
function bounty(ev, amt = 1) {
  if (!p.daily) return;
  for (const b of p.daily.list) {
    if (b.done || BOUNTY[b.k].ev !== ev) continue;
    if (b.k === 'weap' && wtOf(p.equip.weapon) !== WT[b.arg]) continue;
    if (b.k === 'nopot' && (!p.run || p.run.pots)) continue;
    if (b.k === 'mod' && (!p.run || p.run.mod === 'none')) continue;
    b.n = Math.min(b.need, b.n + amt);
    if (b.n >= b.need) { b.done = true; banner('', `📜 懸賞完成：${BOUNTY[b.k].d(b)}，回告示板領獎`); SND.card(); }
  }
}
const bountyReward = () => ({ cry: 2 + Math.floor(p.tier / 3), bone: 15 + p.tier * 3, gold: 80 * p.tier });
// 每週挑戰：無盡往下，規則每週換
const WEEKRULE = [
  { n: '玻璃大砲', d: '你的傷害 ×2，但生命減半', glass: true, mod: 'none' },
  { n: '長夜', d: '火把只有一半亮', mod: 'dark' },
  { n: '菁英大軍', d: '菁英怪變兩倍', mod: 'elite' },
  { n: '狂奔', d: '敵人快 25%', mod: 'swift' },
];
const weekRule = () => WEEKRULE[Math.floor(seeded(thisWeek())() * WEEKRULE.length)];
function weekCheck() { const wk = thisWeek(); if (!p.weekly || p.weekly.wk !== wk) p.weekly = { wk, best: 0, paid: 0 }; }
// 外觀收藏：[名稱, 顏色]；由成就解鎖，在營地篝火旁自由切換
const LIGHTS = { orange: ['橙火', 0xffb070], blue: ['藍火', 0x80b4ff], green: ['翠火', 0x90ff9a], purple: ['紫火', 0xc896ff], white: ['白焰', 0xfff2e0] };
const TRAILS = { none: '不留腳印', ember: '餘燼腳印', frost: '霜火腳印' };
const COS_UNLOCK = { c10: 'light:blue', k1k: 'light:green', w10: 'light:purple', win: 'light:white', r3: 'trail:ember', bty: 'trail:frost' };
const COS_NAME = u => { const [t, k] = u.split(':'); return t === 'light' ? LIGHTS[k][0] : TRAILS[k]; };
// 成就：[編號, 說明, 條件, 獎勵結晶, 獎勵金幣]
const ACH = [
  ['c1', '完成第一趟遠征', q => q.clears >= 1, 1, 100], ['c10', '完成 10 趟遠征', q => q.clears >= 10, 3, 600], ['c40', '完成 40 趟遠征', q => q.clears >= 40, 8, 3000],
  ['k100', '擊殺 100 個敵人', q => q.kills >= 100, 1, 100], ['k1k', '擊殺 1000 個敵人', q => q.kills >= 1000, 3, 800], ['k5k', '擊殺 5000 個敵人', q => q.kills >= 5000, 8, 3000],
  ['t4', '解鎖等級 4 區', q => q.tier >= 4, 2, 400], ['win', '征服餘燼地城（打倒第 7 區首領）', q => q.won, 10, 5000],
  ['r3', '救回 3 個人', q => q.rescued.length >= 3, 2, 300], ['r6', '救回所有人', q => q.rescued.length >= 6, 6, 2000],
  ['h3', '用 3 個不同角色出征', q => Object.keys(q.heroes).length >= 2, 3, 800],
  ['b5', '五棟建築都蓋好', q => Object.keys(BLD).every(k => bl(k) >= 1), 3, 600], ['b15', '五棟建築都升到 Lv 3', q => Object.keys(BLD).every(k => bl(k) >= 3), 10, 5000],
  ['cx', '傳說圖鑑收集完成', q => Object.keys(LEGFX).every(k => q.codex[k]), 10, 5000], ['burn', '引爆餘燼 25 次', q => (q.stat.burn || 0) >= 25, 2, 500],
  ['bty', '完成 10 個懸賞', q => (q.stat.bounty || 0) >= 10, 4, 1000], ['w10', '每週挑戰完成 10 層', q => (q.weekly && q.weekly.best || 0) >= 10, 5, 1500],
];
function checkAch() {
  for (const [id, d, f, cry, g] of ACH) if (!p.ach[id] && f(p)) {
    p.ach[id] = 1; p.mats.cry += cry; p.gold += g; const cu = COS_UNLOCK[id]; if (cu && !p.cosU.includes(cu)) p.cosU.push(cu); banner('🏆 成就', `${d}（💎 +${cry}、💰 +${g}${cu ? '、解鎖' + COS_NAME(cu) : ''}）`); SND.legend(); break; // 一次跳一個，避免橫幅互蓋
  }
}
function addCodex(it) { if (!it || !it.fx || p.codex[it.fx]) return; p.codex[it.fx] = 1; p.mats.cry += 1; floatText(p.x, p.y, '📖 圖鑑新增：' + LEGFX[it.fx].n, '#ff8a3a', 15); }
function rollBoard() {
  const b = [], lo = Math.max(1, p.tier - 2), nn = RESCUE_ORDER.find(n => !p.rescued.includes(n)), next = nn && RESCUE.find(r => r.n === nn);
  for (let t = p.tier; t >= lo; t--) {
    b.push({ tier: t, goal: 'boss', mod: t === 1 && !p.clears ? 'none' : pick(Object.keys(RUNMOD)) });
    if (next && t === p.tier && p.clears) b.push({ tier: t, goal: 'rescue', who: next.n, mod: 'none' });
  }
  p.board = b;
}
function startRun(i) {
  const o = p.board[i]; if (!o) return;
  $('board').classList.remove('on'); paused = false;
  if (o.goal === 'endless') p.board.pop();
  p.run = { torch: 100, danger: p.danger || 0, glass: o.glass, pots: 0, tier: o.tier, goal: o.goal, who: o.who, mod: o.mod, len: o.goal === 'endless' ? 999 : runLen(o.tier), depth: 1, kills: 0, gold0: p.gold, items: 0, t0: Date.now(), first: o.goal === 'boss' && o.tier === p.tier };
  dailyCheck(); refresh(); p.hp = p.st.hp; p.mp = p.st.mp; p.ember = [0, 0, 40, 70][bl('altar')]; genFloor();
}
const rmod = k => p.run && p.run.mod === k;


function genFloor() {
  if (!p.run) return genCamp();
  const R = p.run, last = R.depth === R.len, bossF = last && R.goal === 'boss', rescueF = last && R.goal === 'rescue';
  const f = p.floor = effFloor(R); p.best = Math.max(p.best, f);
  clearEntities(); prisoner = null; campFire = null; range = null; campBlds = [];
  map = new Uint8Array(MW * MH).fill(1);
  explored = new Uint8Array(MW * MH);
  flow = new Int16Array(MW * MH);
  gate = new Uint8Array(MW * MH); lockRoom = null;
  rooms = []; enemies = []; shots = []; drops = []; props = []; parts = []; texts = []; boss = null; pools = []; dangers = []; holes = [];
  pal = PALS[(R.tier - 1 + (R.goal === 'endless' ? Math.floor((R.depth - 1) / 3) : 0)) % PALS.length];

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
  stairs = { x: far.cx * T + T / 2, y: far.cy * T + T / 2, tx: far.cx, ty: far.cy, open: !last };
  p.x = start.cx * T + T / 2; p.y = start.cy * T + T / 2;

  const freeSpot = (r, rad) => {
    for (let i = 0; i < 30; i++) {
      const x = (r.x + rand(0.7, r.w - 0.7)) * T, y = (r.y + rand(0.7, r.h - 0.7)) * T;
      if (!circleHits(x, y, rad) && Math.hypot(x - stairs.x, y - stairs.y) > 70) return { x, y };
    }
    return { x: r.cx * T + T / 2, y: r.cy * T + T / 2 + 60 };
  };
  // 房間擺設（會擋路）、特殊房間、陷阱
  blk = new Array(MW * MH).fill(null); decos = []; fluff = []; traps = []; shrine = null; booms = []; braziers = []; p.phoenixUsed = false; p.barbUsed = false;
  const inRoom = (x, y) => rooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const addDeco = (tx, ty, model, r, s = 1, rot = 0) => {
    if (map[ty * MW + tx] !== 0 || blk[ty * MW + tx] || (tx === stairs.tx && ty === stairs.ty)) return null;
    const d = { x: (tx + 0.5) * T, y: (ty + 0.5) * T, r, model, s, rot }; blk[ty * MW + tx] = d; decos.push(d); return d;
  };
  merchant = null;
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
  for (const r of others.filter(q => q !== vault && q !== shrineRoom).slice(0, irand(2, 3))) { const d = addDeco(r.cx - 1, r.cy + 1, 'column', 8, 0.75) || addDeco(r.cx + 1, r.cy + 1, 'column', 8, 0.75); if (d) braziers.push({ x: d.x, y: d.y, lit: false }); } /* 火盆：點亮可補回火光 */
  if (shrineRoom) { const d = addDeco(shrineRoom.cx + 1, shrineRoom.cy - 1, 'column', 8, 1.5); if (d) shrine = { x: d.x, y: d.y, used: false, kind: pick(['rage', 'haste', 'ward']) }; }
  // 尖刺陷阱：走道零星幾個，有些房間會有一整片
  const trapAt = (tx, ty) => { if (map[ty * MW + tx] === 0 && !blk[ty * MW + tx] && !(tx === stairs.tx && ty === stairs.ty) && !traps.some(t => t.tx === tx && t.ty === ty)) traps.push({ tx, ty, ph: ((tx * 3 + ty * 5) % 7) * 0.37, up: false }); };
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) if (map[y * MW + x] === 0 && !inRoom(x, y) && Math.random() < 0.045) trapAt(x, y);
  for (const r of others) if (r !== vault && r !== shrineRoom && Math.random() < 0.3) for (let i = irand(4, 7); i > 0; i--) trapAt(irand(r.x + 1, r.x + r.w - 2), irand(r.y + 1, r.y + r.h - 2));

  for (const r of rooms) {
    if (r === start) continue;
    if (r === far && bossF) { spawnEnemy('boss', far.cx * T + T / 2, far.cy * T + T / 2 - 50); continue; }
    if (r === far && rescueF) { prisoner = { x: far.cx * T + T / 2, y: far.cy * T + T / 2 - 30, who: RESCUE.find(q => q.n === R.who) || RESCUE[0], freed: false, room: far }; const s = freeSpot(r, 18); spawnEnemy(rollType(f), s.x, s.y, true); }
    if (r === vault) { // 寶庫：沒有守衛，但開箱會引來伏擊
      const vx = r.cx * T + T / 2, vy = r.cy * T + T / 2;
      props.push({ kind: 'chest', x: vx, y: vy, r: 15, open: false, gold: true, vault: true });
      for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283 + rand(-0.3, 0.3), rr = rand(38, 72); fluff.push({ model: pick(['coin_stack_large', 'coin_stack_medium', 'coin_stack_small']), x: vx + Math.cos(a) * rr, y: vy + Math.sin(a) * rr, s: 1.2, rot: rand(0, 6) }); }
      continue;
    }
    const n = Math.round((2.5 + r.w * r.h / 18 + Math.min(5, f * 0.6)) * diff().cnt);
    for (let i = 0; i < n; i++) {
      const s = freeSpot(r, 18), elite = Math.random() < (f >= 2 ? 0.12 : 0.05) * (rmod('elite') ? 2 : 1);
      spawnEnemy(rollType(f), s.x, s.y, elite);
    }
    if (Math.random() < 0.45) { const s = freeSpot(r, 16); props.push({ kind: 'chest', x: s.x, y: s.y, r: 15, open: false, gold: Math.random() < 0.15 }); }
    const nb = irand(1, 4);
    for (let i = 0; i < nb; i++) { const s = freeSpot(r, 12); props.push({ kind: 'barrel', x: s.x, y: s.y, r: 11, skin: Math.random() < 0.6 ? 'barrel_large' : 'box_large', rot: rand(0, 6.28) }); }
  }
  if (!p.clears && R.depth === 1) for (let i = 0; i < 3; i++) { const e = spawnEnemy('minion', (start.cx + 0.5) * T + Math.cos(i * 2.1 + 0.5) * 150, (start.cy + 0.5) * T + Math.sin(i * 2.1 + 0.5) * 110); e.hp = e.maxHp = e.hp * 0.6; if (circleHits(e.x, e.y, e.r)) { e.x = (start.cx + 0.5) * T + 70 * (i - 1); e.y = (start.cy + 0.5) * T - 60; } }
  // 樓梯封印：要先打倒這一層的鑰匙守衛
  const kr = others.filter(r => r !== vault);
  if (!last && kr.length) { const r = kr[kr.length - 1], s = freeSpot(r, 18), e = spawnEnemy(rollType(f), s.x, s.y, true); e.key = true; e.hp = e.maxHp = e.hp * 1.3; e.xp *= 1.5; stairs.open = false; }
  // 競技場：走進去門會封住，清光才開
  for (const r of rooms) {
    r.arena = r !== start && (r === vault || (r === far && last) || Math.random() < (f <= 2 ? 0.25 : 0.4)); r.gates = [];
    if (!r.arena) continue;
    for (let x = r.x - 1; x <= r.x + r.w; x++) for (let y = r.y - 1; y <= r.y + r.h; y++) { const edge = x === r.x - 1 || x === r.x + r.w || y === r.y - 1 || y === r.y + r.h; if (edge && x > 0 && y > 0 && x < MW - 1 && y < MH - 1 && map[y * MW + x] === 0 && !blk[y * MW + x]) r.gates.push(y * MW + x); }
  }
  actMode = null; $('act').style.display = 'none';
  buildLevel3D();
  musicRoot = [110, 98, 123.47, 92.5, 103.83][(R.tier - 1) % 5];
  if (drone) drone.forEach((o, i) => o.frequency.setTargetAtTime(musicRoot / 2 * (1 + i * 0.007), actx.currentTime, 1.5));
  explore(); miniT = 0; flowT = 0;
  if (R.goal === 'endless') { weekCheck(); if (R.depth - 1 > p.weekly.best) p.weekly.best = R.depth - 1; while (p.weekly.paid + 3 <= p.weekly.best) { p.weekly.paid += 3; p.mats.cry += 2; floatText(p.x, p.y, '每週挑戰 💎 +2', '#ff8a3a', 16); } }
  banner(R.goal === 'endless' ? `每週挑戰 第 ${R.depth} 層` : `${pal.name} ${R.depth}/${R.len}`, bossF ? '⚠️ 首領就在這一層' : rescueF ? `⛓️ 救出被囚禁的${prisoner.who.n}` : (RUNMOD[R.mod][0] ? '◆ ' + RUNMOD[R.mod][0] : '打倒 🔑 鑰匙守衛，打開往下的樓梯'));
  if (bossF) warmBoss();
  if (prisoner) addChar(prisoner.who.cls ? CLS[prisoner.who.cls].model : 'npc', prisoner.x, prisoner.y, prisoner.who.cls ? null : prisoner.who.tint, prisoner);
  save();
}

// ---------- 營地 ----------
function genCamp(keep) {
  const px0 = p.x, py0 = p.y;
  Object.assign(p, { whirlT: 0, burnT: 0, spentT: 0, dashT: 0, leap: null, slowT: 0, buff: null }); refresh();
  p.floor = (p.tier - 1) * 3 + 2; p.run = null;
  clearEntities(); prisoner = null;
  map = new Uint8Array(MW * MH).fill(1); explored = new Uint8Array(MW * MH); flow = new Int16Array(MW * MH); gate = new Uint8Array(MW * MH); lockRoom = null;
  enemies = []; shots = []; drops = []; props = []; parts = []; texts = []; boss = null; pools = []; dangers = []; holes = [];
  pal = { name: '營地', tint: 0xffe2c8, hemi: 0xa08868, torch: 0xffa050 };
  const r = { x: 18, y: 13, w: 21, h: 13, cx: 28, cy: 19 }; rooms = [r];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { map[y * MW + x] = 0; explored[y * MW + x] = 1; }
  stairs = { x: -1e5, y: -1e5, tx: -1, ty: -1, open: false };
  blk = new Array(MW * MH).fill(null); decos = []; fluff = []; traps = []; shrine = null; booms = []; braziers = []; p.phoenixUsed = false; p.barbUsed = false;
  const put = (tx, ty, model, rr, sc = 1, rot = 0) => { const d = { x: (tx + 0.5) * T, y: (ty + 0.5) * T, r: rr, model, s: sc, rot }; blk[ty * MW + tx] = d; decos.push(d); return d; };
  campFire = put(r.cx, r.cy, null, 22);
  merchant = put(r.x + 2, r.y + 2, null, 10);
  board = put(r.x + r.w - 3, r.y + 1, 'table_medium', 14, 1.1);
  range = put(r.cx, r.y + r.h - 1, 'stool', 10, 1.3); fluff.push({ model: 'h_crossbow', x: range.x, y: range.y, h: 0.7, s: 1.4, rot: 0.4 });
  fluff.push({ model: 'candle_triple', x: board.x - 8, y: board.y, h: 1.05, s: 1, rot: 0 });
  campBlds = [];
  for (const [k, tx, ty] of [['smith', r.x + 5, r.y + 1], ['altar', r.cx + 3, r.y + 1], ['guild', r.x + r.w - 2, r.cy + 2], ['train', r.x + 3, r.y + r.h - 2], ['store', r.x + r.w - 5, r.y + r.h - 2]]) {
    const d = put(tx, ty, null, 16); d.k = k; campBlds.push(d);
    for (const q of bProps(k, bl(k))) fluff.push({ model: q[0], x: d.x + q[1], y: d.y + q[2], s: q[3], rot: q[4] || 0, h: q[5] || 0 });
  }
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, 2], [-1, -2], [1, -2]]) fluff.push({ model: 'stool', x: (r.cx + 0.5 + dx * 0.9) * T, y: (r.cy + 0.5 + dy * 0.9) * T, s: 1.2, rot: rand(0, 6) });
  for (const [tx, ty, m] of [[r.x, r.y + r.h - 1, 'crates_stacked'], [r.x + 1, r.y + r.h - 1, 'keg'], [r.x + r.w - 1, r.y + r.h - 1, 'barrel_small_stack'], [r.x + r.w - 1, r.y + 4, 'crates_stacked']]) put(tx, ty, m, 13, 0.9, rand(0, 6));
  if (!keep) stock = [makeItem(p.floor, 1, 'weapon'), makeItem(p.floor, Math.max(1, rollRarity())), makeItem(p.floor + 1, Math.random() < 0.04 ? 3 : 2)]; boxMsg = '';
  if (!keep || !p.board || !p.board.length) rollBoard();
  if (!keep) p.rerolls = [0, 1, 2, 3][bl('guild')];
  if (keep) { p.x = px0; p.y = py0; } else { p.x = (r.cx + 0.5) * T; p.y = (r.cy + 3) * T; }
  buildLevel3D();
  // 篝火：一圈石頭、交叉的木柴、會閃的火光
  const fx = campFire.x * U, fz = campFire.y * U, g = new THREE.Group(); g.position.set(fx, 0, fz);
  const stone = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.9 }), wood = new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: 0.9 });
  for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 7, 5), stone), a = i / 9 * 6.283; m.position.set(Math.cos(a) * 1.5, 0.2, Math.sin(a) * 1.5); m.scale.y = 0.7; m.castShadow = true; g.add(m); }
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.2, 6), wood); m.rotation.z = Math.PI / 2 - 0.35; m.rotation.y = i * Math.PI / 4; m.position.y = 0.45; g.add(m); }
  g.traverse(o => { if (o.isMesh) o.userData.own = true; }); lvl.add(g);
  const fl = new THREE.PointLight(0xff9040, 110, 40, 1.4); fl.position.set(fx, 2.2, fz); lvl.add(fl); campFire.light = fl;
  for (const d of campBlds) if (bl(d.k) && (d.k === 'smith' || d.k === 'altar')) { // 鐵匠的爐火、祭壇的光球
    const col = d.k === 'smith' ? 0xff6a20 : 0xb0a0ff, orb = new THREE.Mesh(new THREE.SphereGeometry(d.k === 'smith' ? 0.35 : 0.45, 12, 8), new THREE.MeshBasicMaterial({ color: col }));
    orb.position.set((d.x + (d.k === 'smith' ? -24 : 0)) * U, d.k === 'smith' ? 0.5 : 2.5, d.y * U); orb.userData.own = true; lvl.add(orb);
    const l = new THREE.PointLight(col, 25 + 15 * bl(d.k), 16, 1.6); l.position.copy(orb.position); l.position.y += 0.6; lvl.add(l);
  }
  const KN = { n: '騎士', cls: 'knight', tint: 0xffffff, line: '換我上場也行。' };
  for (const q of [...RESCUE, KN]) if ((q === KN || p.rescued.includes(q.n)) && q.cls !== p.cls) { const i = q === KN ? 6 : RESCUE.indexOf(q), a = i / 7 * 6.283 + 0.6; addChar(q.cls ? CLS[q.cls].model : 'npc', campFire.x + Math.cos(a) * 100, campFire.y + Math.sin(a) * 74, q.cls ? null : q.tint, { who: q, camp: true }); }
  musicRoot = 110; if (drone) drone.forEach((o, i) => o.frequency.setTargetAtTime(musicRoot / 2 * (1 + i * 0.007), actx.currentTime, 1.5));
  actMode = null; $('act').style.display = 'none'; miniT = 0; flowT = 0;
  dailyCheck(); weekCheck(); if (!keep) setTimeout(checkAch, 2600);
  if (!keep) { banner('營地', p.clears ? '到告示板挑下一趟遠征' : ''); tip('camp', '這是營地：告示板挑遠征出發，左上的商人賣東西，倒下或完成遠征都會回到這裡'); setTimeout(() => tip('build', '營地很荒涼：遠征帶回 🦴 骨片和 💎 餘燼結晶，走到瓦礫旁就能蓋建築'), 7000); }
  save();
}
// 營地與遠征裡的 NPC（被囚禁的人、救回來的人）
function addChar(model, x, y, tint, ref) {
  const c = new Char(model, CLIPS.knight, tint); c.root.position.set(x * U, 0, y * U); c.play('Idle'); ents.add(c.root);
  c.ref = ref; c.x = x; c.y = y; c.talkT = 0; extraChars.push(c); return c;
}


function explore() {
  const px = Math.floor(p.x / T), py = Math.floor(p.y / T);
  for (let y = py - 6; y <= py + 6; y++) for (let x = px - 8; x <= px + 8; x++)
    if (x >= 0 && y >= 0 && x < MW && y < MH) explored[y * MW + x] = 1;
}

// ---------- 物品 ----------
const RAR = [{ n: '普通', c: '#d8d8d8' }, { n: '精良', c: '#6aa8ff' }, { n: '稀有', c: '#ffd84a' }, { n: '傳說', c: '#ff8a3a' }, { n: '餘燼', c: '#ff4a3a' }];
const SLOTS = { weapon: { n: '武器', i: '🗡️' }, helm: { n: '頭盔', i: '🪖' }, armor: { n: '護甲', i: '🛡️' }, boots: { n: '鞋子', i: '🥾' }, ring: { n: '飾品', i: '💍' } };
// 套裝：每位首領掉一套；湊滿 3 件是改變打法的效果
const SETS = {
  ash: { n: '灰燼行者', c: '#ff9a5a', boss: 0, slots: ['helm', 'armor', 'boots'], b2: '閃避冷卻 -25%', b3: '閃避會在身後留下燃燒的足跡；閃避後下一擊必定暴擊' },
  bog: { n: '腐骨王冠', c: '#7adf5a', boss: 1, slots: ['weapon', 'armor', 'ring'], b2: '吸血 +3%', b3: '敵人倒下會留下毒沼：毒傷並緩速敵人；你站在毒沼裡每秒回 3% 生命' },
  core: { n: '熔核之心', c: '#ff5a3a', boss: 2, slots: ['weapon', 'helm', 'ring'], b2: '攻擊 +10%', b3: '爆燃多燒 3 秒，期間每 0.6 秒自動向四周噴發火焰' },
  frost: { n: '霜冠之誓', c: '#8adcff', boss: 3, slots: ['helm', 'ring', 'boots'], b2: '移速 +8%', b3: '每第 4 次普攻放出冰環冰凍周圍；對冰凍的敵人傷害 +40%' },
  void: { n: '虛空行旅', c: '#c080ff', boss: 4, slots: ['weapon', 'armor', 'boots'], b2: '暴擊 +6%', b3: '暴擊時 15% 機率撕開黑洞，把附近敵人吸在一起 2 秒並持續傷害' },
};
const setCount = eq => { const c = {}; for (const k in eq) { const it = eq[k]; if (it && it.set) c[it.set] = (c[it.set] || 0) + 1; } return c; };
const setN = k => (p.sets && p.sets[k]) || 0;
const icol = it => it.set ? SETS[it.set].c : RAR[it.rarity].c;
function makeSetItem(k, lvl) {
  const S = SETS[k], have = sl => [p.equip[sl], ...p.inv].some(it => it && it.set === k && it.slot === sl), miss = S.slots.filter(sl => !have(sl));
  const it = makeItem(lvl, 3, miss.length && Math.random() < 0.7 ? pick(miss) : pick(S.slots));
  delete it.fx; delete it.fxq; it.set = k; it.name = `${S.n}・${it.kind}`; return it;
}
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
  sword: { n: '劍', cd: 0.42, range: 68, arc: 1.05, mult: 1, kb: 110, desc: '均衡的弧形揮砍；技能冷卻 -15%' },
  dagger: { n: '匕首', cd: 0.26, range: 56, arc: 0.85, mult: 0.62, kb: 60, crit: 15, desc: '出手極快，暴擊 +15%，暴擊傷害更高' },
  axe: { n: '斧', cd: 0.52, range: 72, arc: 1.25, mult: 1.3, kb: 170, desc: '較慢，範圍大、擊退強；刀鋒系技能 +30%' },
  great: { n: '巨劍', cd: 0.72, range: 90, arc: 1.5, mult: 1.9, kb: 240, heavy: 1, desc: '很慢，一刀掃一大片，會打斷敵人；刀鋒系技能 +30%' },
  xbow: { n: '手弩', cd: 0.5, ranged: 1, mult: 0.9, kb: 70, spd: 640, pierce: 1, desc: '遠程，弩箭穿透；第三發三連射；彈幕 +50%' },
  staff: { n: '法杖', cd: 0.55, ranged: 1, mult: 0.75, kb: 40, spd: 420, homing: 1, aoe: 42, desc: '遠程，追蹤魔彈會小範圍爆炸；所有技能 +30%' },
};
const KIND2WT = { '短劍': 'dagger', '長劍': 'sword', '彎刀': 'sword', '戰斧': 'axe', '釘錘': 'axe', '巨劍': 'great', '手弩': 'xbow', '法杖': 'staff' };
const wtOf = it => WT[(it && KIND2WT[it.kind]) || 'sword'];
const BASES = { weapon: ['短劍', '長劍', '戰斧', '巨劍', '彎刀', '手弩', '法杖'], armor: ['皮甲', '鎖甲', '鱗甲', '戰袍'], ring: ['指環', '護符', '徽記'], helm: ['皮帽', '鐵盔', '角盔', '兜帽'], boots: ['皮靴', '鐵靴', '旅靴'] };
// 傳說裝備各帶一個會改變打法的效果
const LEGFX = {
  chain: { slot: 'weapon', n: '雷鳴', r: [2, 6], d: v => `命中時三成機率放出連鎖閃電，跳 ${Math.round(v)} 個敵人` },
  wave: { slot: 'weapon', n: '餘燼', r: [0.9, 1.8], d: v => `每第三下射出穿透的火焰劍氣，${Math.round(v * 100)}% 攻擊` },
  frost: { slot: 'weapon', n: '霜牙', r: [0.08, 0.3], d: v => `命中讓敵人緩速，${Math.round(v * 100)}% 機率直接冰凍` },
  thorns: { slot: 'armor', n: '荊棘', r: [0.8, 2.4], d: v => `受傷時反震周圍敵人，${Math.round(v * 100)}% 攻擊` },
  phoenix: { slot: 'armor', n: '晨曦', r: [0.25, 0.7], d: v => `每層一次：致命傷時不倒下，回復 ${Math.round(v * 100)}% 生命並爆炸` },
  blink: { slot: 'armor', n: '暮星', r: [0.6, 2], d: v => `閃避冷卻減半，落地爆炸 ${Math.round(v * 100)}% 攻擊` },
  twin: { slot: 'ring', n: '三焰', r: [2, 5], d: v => `火球一次射出 ${Math.round(v)} 顆` },
  storm: { slot: 'ring', n: '風暴', r: [0.4, 1.6], d: v => `旋風斬多轉 ${v.toFixed(1)} 秒，並把敵人吸過來` },
  boom: { slot: 'ring', n: '深淵', r: [0.4, 1.2], d: v => `敵人倒下時爆炸，${Math.round(v * 100)}% 攻擊` },
};
const legVal = it => { const F = LEGFX[it.fx], q = it.fxq === undefined ? 0.5 : it.fxq; return F.r[0] + (F.r[1] - F.r[0]) * q; };
const fxText = it => { const F = LEGFX[it.fx], v = legVal(it), q = it.fxq === undefined ? 0.5 : it.fxq; return `${F.d(v)}<span class="dim">（${q > 0.85 ? '極品' : q > 0.6 ? '上等' : q > 0.3 ? '中等' : '下等'}・範圍 ${F.d(F.r[0]).match(/[\d.]+/)[0]}～${F.d(F.r[1]).match(/[\d.]+/)[0]}）</span>`; };
const BUFFS = { rage: ['⚔️', '狂怒', '攻擊 +50%', 0xff5030], haste: ['💨', '迅捷', '移動與攻擊速度 +35%', 0x50e0ff], ward: ['🛡️', '守護', '受到的傷害減半', 0xffe060] };
const fmt = (k, v) => `${STAT[k][0]} ${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)}${STAT[k][1] ? '%' : ''}`;

// 稀有度機率：傳說約 0.5～2%；危險度 5 起才有機會掉「餘燼」
function rollRarity(min = 0) {
  const dg = (p.run && p.run.danger) || 0, f = p.floor, r = Math.random();
  const leg = (0.004 + Math.min(0.006, f * 0.0003) + dg * 0.0015) * (1 + darkK() * 0.8);
  const ember = dg >= 5 ? leg * (0.15 + (dg - 5) * 0.05) : 0;
  const rare = Math.min(0.25, (0.05 + f * 0.002 + dg * 0.01) * (1 + darkK() * 0.5)), magic = 0.3;
  const q = r < ember ? 4 : r < ember + leg ? 3 : r < ember + leg + rare ? 2 : r < ember + leg + rare + magic ? 1 : 0;
  return Math.max(q, min);
}
function makeItem(lvl, rarity, slot, kind) {
  slot = slot || pick(['weapon', 'weapon', 'armor', 'ring', 'helm', 'boots']);
  const it = { id: itemId++, slot, rarity, lvl, base: {}, aff: [] };
  const q = (1 + rarity * 0.15) * rand(0.9, 1.1);
  if (slot === 'weapon') it.base.dmg = Math.round((4 + lvl * 2.2) * q);
  if (slot === 'armor') { it.base.armor = Math.round((5 + lvl * 3) * q); it.base.hp = Math.round((6 + lvl * 3) * q); }
  if (slot === 'helm') { it.base.armor = Math.round((3 + lvl * 1.6) * q); it.base.hp = Math.round((4 + lvl * 2) * q); }
  if (slot === 'boots') { it.base.armor = Math.round((2 + lvl * 1.2) * q); it.base.move = Math.round(4 * q); }
  const pool = Object.keys(AFF).filter(k => !(slot === 'weapon' && k === 'armor'));
  const n = rarity + (slot === 'ring' ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    let v = AFF[k](lvl) * rand(0.8, 1.2) * (rarity >= 4 ? 1.4 : rarity === 3 ? 1.25 : 1);
    v = (k === 'hpr' || k === 'mpr' || k === 'ls') ? Math.round(v * 10) / 10 : Math.round(v);
    it.aff.push({ k, v });
  }
  const WK = { sword: ['長劍', '彎刀'], dagger: ['短劍'], axe: ['戰斧', '釘錘'], great: ['巨劍'], xbow: ['手弩'], staff: ['法杖'] };
  const b = kind || (slot === 'weapon' && p && Math.random() < 0.65 ? pick(clsOf().wts.flatMap(w => WK[w])) : pick(BASES[slot]));
  it.kind = b;
  if (rarity >= 3) { it.fx = pick(Object.keys(LEGFX).filter(k => LEGFX[k].slot === ({ helm: 'armor', boots: 'ring' }[slot] || slot))); it.fxq = rarity >= 4 ? rand(0.55, 1) : Math.random(); }
  it.name = rarity >= 4 ? `燼・${LEGFX[it.fx].n}之${b}` : rarity === 3 ? `${LEGFX[it.fx].n}之${b}` : rarity === 0 ? b : `${RAR[rarity].n}的${b}`;
  it.val = Math.round((5 + lvl * 3) * Math.pow(1 + rarity, 1.5));
  if (rarity >= 1 && Math.random() < (rarity >= 4 ? 1 : rarity === 3 ? 0.5 : 0.22)) it.nc = rollNC(lvl);
  return it;
}
// 強化過的裝備（+N）每級讓所有數值多 12%
// ---------- 熱度：裝備穿著戰鬥會越燒越熱，每級所有數值 +12%，外觀跟著發光變色 ----------
const HEAT = ['冷鐵', '暗紅', '赤紅', '橙熱', '金焰', '白熾'];
const HEATC = [0x000000, 0x8a1a08, 0xd23010, 0xff6a10, 0xffb030, 0xfff0c8], HEATK = [0, 0.45, 0.8, 1.2, 1.6, 2.1];
const HEATN = [90, 210, 420, 770, 1260]; // 升到下一級要的「戰鬥值」（一般擊殺 1、菁英 3、首領 15）
const iv = (it, v) => Math.round(v * (1 + 0.12 * (it.heat || 0)) * 10) / 10;
const forgeCost = it => Math.ceil(((it.heat || 0) + 1) * 4 * (bl('smith') >= 3 ? 0.8 : 1)); // 熔鑄花 💎 結晶
const forgeCap = () => [0, 2, 4, 5][bl('smith')];
function heatUp(it, n) { // 回傳是否升級
  if (!it || (it.heat || 0) >= 5) return false;
  it.hx = (it.hx || 0) + n; let up = false;
  while ((it.heat || 0) < 5 && it.hx >= HEATN[it.heat || 0]) { it.hx -= HEATN[it.heat || 0]; it.heat = (it.heat || 0) + 1; up = true; if (it.heat === 5) emberAffix(it); }
  if (it.heat === 5) it.hx = 0;
  return up;
}
function emberAffix(it) { // 白熾：多一條強化過的詞綴，沒有非戰鬥詞綴的話也送一條
  const pool = Object.keys(AFF).filter(k => !it.aff.some(a => a.k === k) && !(it.slot === 'weapon' && k === 'armor'));
  if (pool.length) { const k = pick(pool); let v = AFF[k](it.lvl) * 1.5; v = (k === 'hpr' || k === 'mpr' || k === 'ls') ? Math.round(v * 10) / 10 : Math.round(v); it.aff.push({ k, v, ember: true }); }
  if (!it.nc) it.nc = rollNC(it.lvl);
}
// 非戰鬥詞綴：每件最多一條，改變的是玩法而不是數字
const NC = {
  light: { n: '火光', d: v => `火把照得更遠 +${v}%`, v: () => irand(15, 30) },
  seek: { n: '尋寶', d: () => '小地圖顯示寶箱與寶庫' },
  trap: { n: '警覺', d: () => '陷阱會發紅光，尖刺傷害減半' },
  magnet: { n: '磁吸', d: v => `撿拾範圍 +${v}%，藥水和裝備也會飛過來`, v: () => irand(40, 80) },
  haggle: { n: '殺價', d: v => `商店價格 -${v}%`, v: () => irand(10, 20) },
  luck: { n: '幸運', d: v => `${v}% 機率獎勵箱多一件`, v: () => irand(15, 30) },
  trail: { n: '火痕', d: () => '走過的地方留下火焰腳印' },
  ghost: { n: '殘影', d: () => '閃避時留下殘影' },
};
function rollNC() { const k = pick(Object.keys(NC)); return { k, v: NC[k].v ? NC[k].v() : 0 }; }
const ncv = k => (p.nc && p.nc[k]) || 0;
const TRAIN = { hp: ['體魄', '生命 +12'], dmg: ['力量', '攻擊 +2'], mp: ['心智', '魔力 +10、每秒回魔 +0.3'] };
const trainCost = k => Math.round(80 * Math.pow(1.3, p.train[k]));
const boxCost = () => Math.round((80 + p.floor * 40) * shopK());
const respecCost = () => Math.round(40 * p.lvl * (bl('altar') >= 3 ? 0.5 : 1));
const priceOf = it => Math.round(it.val * 5 * shopK());
const sellOf = it => Math.max(1, Math.round(it.val * 0.4)); // 賣價只有買價的一小部分
function calcStats(eq) {
  eq = eq || p.equip; const L = p.lvl;
  const tr = p.train || { hp: 0, dmg: 0, mp: 0 };
  const s = { dmg: 10 + 2 * (L - 1) + tr.dmg * 2, hp: 120 + 12 * (L - 1) + tr.hp * 12, mp: 50 + 5 * (L - 1) + tr.mp * 10, armor: 0, crit: 5, aspd: 0, move: 0, ls: 0, hpr: 1, mpr: 3 + tr.mp * 0.3 };
  for (const k in eq) { const it = eq[k]; if (!it) continue; for (const b in it.base) s[b] += iv(it, it.base[b]); for (const a of it.aff) s[a.k] += iv(it, a.v); }
  { const sc = setCount(eq); if (sc.bog >= 2) s.ls += 3; if (sc.core >= 2) s.dmg *= 1.1; if (sc.frost >= 2) s.move += 8; if (sc.void >= 2) s.crit += 6; }
  if (p && p.cls) { clsOf().st(s); if (!inClass(eq.weapon)) s.dmg *= 0.7; }
  const pa = p.pas || {};
  s.crit += (wtOf(eq.weapon).crit || 0) + (pa.critboom || 0) * 8; s.aspd += (pa.haste || 0) * 12; s.mpr += (pa.mana || 0);
  if (p.run && p.run.glass) { s.dmg *= 2; s.hp *= 0.5; }
  if (tl('kA1')) s.armor *= 1.15; if (tl('kA2')) s.hp *= 1.1; if (tl('kB1')) s.dmg *= 1.08; if (tl('kB2')) s.crit += 6; if (tl('rB1')) s.move += 10;
  if (tl('mC1')) s.mp *= 1.2; if (tl('mC2')) s.mpr += 2; if (tl('bA1')) s.aspd += 10; if (tl('bC1')) s.hp *= 1.15; if (tl('bC2')) s.armor *= 1.2;
  s.dmg *= 1 + (pa.power || 0) * 0.12; s.hp *= 1 + (pa.vigor || 0) * 0.15; s.mp *= 1 + (pa.mana || 0) * 0.25;
  for (const k of ['dmg', 'hp', 'mp', 'armor']) s[k] = Math.round(s[k]);
  for (const k of ['crit', 'aspd', 'move', 'ls', 'hpr', 'mpr']) s[k] = Math.round(s[k] * 10) / 10;
  s.crit = Math.min(s.crit, 75); s.aspd = Math.min(s.aspd, 100); s.move = Math.min(s.move, 50); s.ls = Math.min(s.ls, 15);
  if (p.buff && p.buff.k === 'rage') s.dmg = Math.round(s.dmg * 1.5);
  if (p.buff && p.buff.k === 'haste') { s.move += 35; s.aspd += 35; }
  return s;
}
const power = s => s.dmg * (1 + s.crit / 100) * (1 + s.aspd / 100) * 4 + s.hp * (1 + s.armor / 100) * 0.5 + s.mp * 0.2 + s.move + s.ls * 6 + s.hpr * 4 + s.mpr * 4;
function refresh() { p.mx = Object.assign({}, p.mods, tl('kC4') ? { 'fire.pool': 1, 'fire.split': 1 } : {}, tl('rC4') ? { 'totem.twin': 1 } : {}, tl('mA4') ? { 'bolt.fork': 1 } : {}, tl('bB4') ? { 'leap.quake': 1 } : {}); p.nc = {}; p.fxv = {}; for (const k in p.equip) { const it = p.equip[k]; if (it && it.nc) p.nc[it.nc.k] = (p.nc[it.nc.k] || 0) + (it.nc.v || 1); } p.fx = {}; for (const k in p.equip) { const it = p.equip[k]; if (it && it.fx) p.fx[it.fx] = Math.max(p.fx[it.fx] || 0, legVal(it)); } p.sets = setCount(p.equip); p.st = calcStats(); p.hp = Math.min(p.hp, p.st.hp); p.mp = Math.min(p.mp, p.st.mp); }

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
  s_fire: ['烈焰流', '火球、圖騰傷害 +35%；爆燃多燒 3 秒', 1, 'fire'], s_frost: ['寒冰流', '冰霜新星傷害 +35%，冰凍多 1 秒', 1, 'frost'],
  s_storm: ['雷電流', '落雷傷害 +35%，冷卻減半', 1, 'storm'], s_blade: ['刀鋒流', '旋風斬、躍擊、彈幕傷害 +35%', 1, 'blade'],
};
// 流派：技能分四系，武器各有親和
const SKTAG = { fire: 'fire', totem: 'fire', nova: 'frost', bolt: 'storm', whirl: 'blade', leap: 'blade', volley: 'blade' };
function sm(k) { // 技能傷害倍率
  const w = wtOf(p.equip.weapon), t = SKTAG[k]; let m = 1;
  if (w === WT.staff) m *= 1.3; if ((w.heavy || w === WT.axe) && t === 'blade') m *= 1.3; if (w === WT.xbow && k === 'volley') m *= 1.5;
  if (p.pas['s_' + t]) m *= 1.35;
  if ((k === 'fire' && tl('kC1')) || (k === 'bolt' && tl('mA1')) || (k === 'leap' && tl('bB1'))) m *= 1.25;
  return m;
}
// 升級時從三張卡裡選一張
function rollCards() {
  const pool = [];
  const fav = k => clsOf().tags.includes(SKTAG[k]) ? 1.8 : 0.7; // 角色擅長的系別比較常出現
  for (const k of SKILLS) { if (!p.skl[k]) { if (clsOf().pool.includes(k)) pool.push({ t: 'learn', k, w: 3 * fav(k) }); } /* 新技能只出現自己職業的 */ else if (p.skl[k] < 6) pool.push({ t: 'up', k, w: p.slots.includes(k) ? 2.2 : 0.5 }); }
  for (const m in MODS) { const sk = MODS[m][0]; if (!p.mods[m] && (sk === 'dash' || p.skl[sk])) pool.push({ t: 'mod', k: m, w: sk === 'dash' || p.slots.includes(sk) ? 3 : 0.7 }); }
  for (const k in PAS) if ((p.pas[k] || 0) < PAS[k][2] && (!PAS[k][3] || SKILLS.some(q => p.skl[q] && SKTAG[q] === PAS[k][3]))) pool.push({ t: 'pas', k, w: PAS[k][3] ? 2.6 : 1.8 });
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
    skl: { fire: 1 }, slots: ['fire', null, null], tier: 1, run: null, rescued: [], clears: 0, board: null, mats: { bone: 0, cry: 0 }, bld: {}, cls: 'knight', heroes: {}, tal: {}, codex: {}, ach: {}, stat: {}, cos: { light: 'orange', trail: 'none' }, cosU: [], daily: null, weekly: null, mods: {}, pas: {}, picks: 0, diff: 0, inv: [],
    equip: { weapon: { id: itemId++, slot: 'weapon', rarity: 0, lvl: 1, base: { dmg: 5 }, aff: [], name: '生鏽的長劍', kind: '長劍', val: 3 }, armor: null, ring: null },
  };
  resetRuntime(); refresh(); p.hp = p.st.hp; p.mp = p.st.mp;
}
function resetRuntime() {
  Object.assign(p, { aim: 0, atkCd: 0, slashT: 0, slashA: 0, whirlT: 0, whirlTick: 0, dashT: 0, dashX: 0, dashY: 0, inv_t: 0, potCd: 0, hurtT: 0, moving: false, moveA: 0, combo: 0, buff: null, streak: 0, streakT: 0, thornCd: 0, trapCd: 0, stepT: 0, ember: 0, burnT: 0, burnExt: 0, spentT: 0, emberT: 0, slowT: 0, leap: null, dash2: false, hitChain: 0, hitChainT: 0, cd: Object.fromEntries(Object.keys(SK).map(k => [k, 0])) });
}
const xpNeed = l => Math.round(40 * Math.pow(l, 1.7));
function gainXp(v) {
  p.xp += v;
  while (p.xp >= xpNeed(p.lvl)) {
    p.xp -= xpNeed(p.lvl); p.lvl++; p.picks++; refresh(); p.hp = p.st.hp; p.mp = p.st.mp; if (p.lvl % 5 === 0) { floatText(p.x, p.y - 20, '🌳 天賦點 +1', '#7dff8a', 18); tip('tal', '每 5 級得到 1 個天賦點：打開 🎒 背包按「🌳 天賦」來點'); }
    floatText(p.x, p.y, '升級！', '#ffcf6b', 24); 
    burst(p.x, p.y, '#ffcf6b', 40, 160, 1, 1, 6); fxRing(p.x, p.y, 90, 0xffcf6b, 0.6);
    SND.level();
  }
}
function save() {
  if (!p) return;
  const o = {}; for (const k of ['lvl', 'xp', 'gold', 'floor', 'best', 'hpPot', 'mpPot', 'sp', 'skl', 'equip', 'inv', 'kills', 'deaths', 'won', 'train', 'slots', 'mods', 'pas', 'picks', 'diff', 'tier', 'run', 'rescued', 'clears', 'board', 'mats', 'bld', 'cls', 'heroes', 'daily', 'weekly', 'codex', 'ach', 'stat', 'danger', 'cos', 'cosU', 'hist', 'pick', 'tal', 'setPity']) o[k] = p[k];
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(o)); } catch (e) { /* 無痕模式存不了就算了 */ }
}
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(SAVE_KEY)); if (!o || !o.lvl) return false;
    p = Object.assign({ x: 0, y: 0, r: 13, kills: 0, deaths: 0, won: false, train: { hp: 0, dmg: 0, mp: 0 }, mods: {}, pas: {}, picks: 0, diff: 0 }, o);
    if (!p.tier) { p.tier = Math.max(1, Math.ceil(p.floor / 3)); p.run = null; p.clears = p.floor > 1 ? 1 : 0; } // 舊存檔：樓層換成區域等級
    if (!p.rescued) p.rescued = [];
    if (!p.mats) p.mats = { bone: 0, cry: 0 }; if (!p.bld) p.bld = {}; if (!p.cls) p.cls = 'knight'; if (!p.heroes) p.heroes = {}; if (p.diff) { p.danger = Math.max(p.danger || 0, [0, 3, 6][p.diff] || 0); p.diff = 0; } /* 舊的困難／煉獄換成危險度 */
    if (!p.tal) p.tal = {}; for (const h of Object.values(p.heroes || {})) if (!h.tal) h.tal = {};
    if (!p.codex) p.codex = {}; if (!p.cos) p.cos = { light: 'orange', trail: 'none' }; if (!p.cosU) p.cosU = [];
    for (const it of [...p.inv, ...Object.values(p.equip), ...Object.values(p.heroes || {}).flatMap(h => Object.values(h.equip || {}))]) if (it && it.up) { it.heat = Math.min(5, Math.ceil(it.up * 0.6)); it.hx = 0; delete it.up; } /* 舊的 +N 強化換成熱度 */ if (!p.ach) p.ach = {}; if (!p.stat) p.stat = {};
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
  crystal: { n: '餘燼水晶', hp: 70, spd: 0, dmg: 9, r: 14, xp: 0 },
  imp: { n: '小骨魔', hp: 16, spd: 145, dmg: 7, r: 9, xp: 7 },
  archer: { n: '骸骨弩手', hp: 24, spd: 85, dmg: 12, r: 12, xp: 11, ranged: 1 },
  brute: { n: '骸骨戰將', hp: 110, spd: 62, dmg: 24, r: 16, xp: 22, charger: 1 },
  shaman: { n: '亡靈咒術師', hp: 44, spd: 62, dmg: 13, r: 12, xp: 18, ranged: 1 },
  boss: { n: '守關者', hp: 1500, spd: 76, dmg: 28, r: 30, xp: 300, charger: 1 },
};
const TRAITN = { split: '分裂', bomb: '自爆', haste: '疾走', ward: '護盾' };
const BOSSN = ['灰燼守衛', '沼澤骨王', '熔核督軍', '霜冠亡王', '虛空之主'];
const BOSSE = ['灰燼迴廊的看門人', '沼澤深處的腐骨之王', '熔岩礦坑的督軍', '霜封墓穴的亡王', '虛空的主宰'];
function rollType(f) {
  const w = [['minion', 5], ['imp', 3]];
  if (f >= 2) w.push(['archer', 3]); if (f >= 3) w.push(['brute', 2]); if (f >= 4) w.push(['shaman', 2]);
  let t = Math.random() * w.reduce((s, x) => s + x[1], 0);
  for (const x of w) { if ((t -= x[1]) < 0) return x[0]; }
  return 'minion';
}
function spawnEnemy(type, x, y, elite) {
  const d = ET[type], f = p.floor, hs = (1 + 0.42 * (f - 1)) * diff().hp, ds = (1.15 + 0.34 * (f - 1)) * diff().dmg * (1 + 0.08 * ((p.run && p.run.danger) || 0));
  const e = {
    type, x, y, r: d.r * (elite ? 1.25 : 1), hp: d.hp * hs * (elite ? 3.2 : 1), dmg: d.dmg * ds * (elite ? 1.4 : 1),
    spd: d.spd * rand(0.9, 1.1), xp: d.xp * (1 + 0.2 * (f - 1)) * (elite ? 4 : 1), elite: !!elite,
    awake: false, atkCd: rand(0, 0.6), atkT: 0, shotCd: rand(1, 2.5), flash: 0, slow: 0, freeze: 0, kx: 0, ky: 0, ph: rand(0, 6.28), ch: null, chCd: rand(2, 4),
    face: rand(0, 6.28), faceLock: 0, riseT: 0, stun: 0, trait: elite && type !== 'boss' ? pick(['split', 'bomb', 'haste', 'ward']) : null, wardT: 0, wardCd: rand(2, 4), act: 2.5, volley: 0, volT: 0, v: null,
  };
  e.maxHp = e.hp; if (e.trait === 'haste') e.spd *= 1.5;
  if (rmod('swift')) { e.spd *= 1.25; e.xp *= 1.3; }
  if (type === 'boss') { const tr = p.run ? p.run.tier : 1; e.hp = e.maxHp = e.hp * Math.min(1, 0.45 + 0.11 * tr); e.dmg *= Math.min(1, 0.5 + 0.1 * tr); /* 前幾區的首領比較溫和 */ e.bi = (tr - 1) % BOSSN.length; e.name = BOSSN[e.bi]; e.tint = [0xff9a80, 0x9fe08a, 0xff7040, 0x90c0ff, 0xc080ff][e.bi]; e.spiral = 0; e.spT = 0; e.spA = 0; boss = e; }
  enemies.push(e); return e;
}
function enemyShot(e, ang, spd, dmg, col, r = 6, arrow = false) {
  shots.push({ x: e.x + Math.cos(ang) * e.r, y: e.y + Math.sin(ang) * e.r, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r, dmg, from: 'e', life: 4, col, arrow });
}
function updateEnemy(e, dt) {
  e.flash -= dt; e.atkCd -= dt; e.ph += dt * 6;
  if (e.type === 'crystal') { // 餘燼水晶：不會動，定時放一圈彈幕，有光束連到首領
    if ((e.shotCd -= dt) <= 0) { e.shotCd = 2.6; const o = rand(0, 6.28); for (let i = 0; i < 8; i++) enemyShot(e, o + i / 8 * 6.283, 140, e.dmg, '#ff9a3a', 6); sfx(520, 0.12, 'triangle', 0.03, 200); }
    if (boss && Math.random() < 0.6) { const u = Math.random(); parts.push(mkPart(e.x + (boss.x - e.x) * u, e.y + (boss.y - e.y) * u, 1.6 + Math.sin(u * 3.14) * 1.5, 0, 0, 0, '#7fe8ff', 0.3, 4)); }
    return;
  }
  if (e.kx || e.ky) { moveEnt(e, e.kx * dt, e.ky * dt); e.kx *= Math.pow(0.002, dt); e.ky *= Math.pow(0.002, dt); if (Math.abs(e.kx) + Math.abs(e.ky) < 5) e.kx = e.ky = 0; }
  if (e.riseT > 0) { e.riseT -= dt; return; }
  if (e.freeze > 0) { e.freeze -= dt; return; }
  if (e.broken > 0) { e.broken -= dt; if (Math.random() < 0.3) parts.push(mkPart(e.x + rand(-20, 20), e.y + rand(-20, 20), 5 + rand(0, 1), rand(-20, 20), rand(-20, 20), 0, '#ffe080', 0.5, 4)); return; }
  if (e.trait === 'ward') { e.wardT -= dt; if ((e.wardCd -= dt) <= 0 && e.awake) { e.wardCd = 6; e.wardT = 2.4; } }
  if (e.stun > 0) { e.stun -= dt; return; } // 被打到會踉蹌一下
  const sm = e.slow > 0 ? 0.45 : 1; e.slow -= dt;
  const d = dist(e, p);
  if (!e.awake) { if (d < 340 && los(e, p)) { e.awake = true; tip('dash', touchMode ? '敵人舉手要打你時，按 💨 閃避，閃避中不會受傷' : '敵人舉手要打你時，按空白鍵閃避，閃避中不會受傷'); if (e === boss) { bossIntro(e); e.act = 1.2; } } else return; }
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
// ---------- 首領戰演出 ----------
let cine = null; // { t, e, kind: 'intro' | 'outro' }：演出中鏡頭對準首領
function startCine(e, kind, title, sub, t) {
  cine = { t, e, kind }; document.body.classList.add('cine'); $('cine').classList.add('on');
  $('cineTitle').innerHTML = `${title}<small>${sub}</small>`; $('cineTitle').style.animation = 'none'; void $('cineTitle').offsetWidth; $('cineTitle').style.animation = '';
}
function endCine() { cine = null; document.body.classList.remove('cine'); $('cine').classList.remove('on'); }
function bossIntro(e) {
  startCine(e, 'intro', e.name, BOSSE[e.bi] || '', 2.8); SND.bossIntro(); charOnce(e, 'Taunt', 1); shake = 4;
  fxRing(e.x, e.y, 160, 0xff5a3a, 1.2);
}
// 特殊階段：6 成血時張開屏障，要打碎房間裡的三顆餘燼水晶
function bossShield(e) {
  e.phased = true; e.shield = true; e.act = 2;
  banner('屏障', '打碎房間裡的餘燼水晶，才傷得到首領'); SND.bossIntro(); shake = 6;
  const easy = !p.run || p.run.tier <= 1, n = easy ? 2 : 3; // 第 1 區當教學：只有 2 顆、不放彈幕
  for (let i = 0; i < n; i++) {
    for (const R of [150, 120, 90, 60]) { const a = i * 6.283 / n + 0.5, x = stairs.x + Math.cos(a) * R, y = stairs.y + Math.sin(a) * R; if (!circleHits(x, y, 18)) { const c = spawnEnemy('crystal', x, y); c.awake = true; c.fixed = true; c.summoned = true; c.shotCd = easy ? 1e9 : 1 + i * 0.6; burst(x, y, '#ff9a3a', 24, 140, 0.8, 1.5, 6); break; } }
  }
  tip('crystal', '首領張開屏障時，先打碎發光的水晶；全部打碎後首領會破防，傷害加五成');
}
function bossBreak(e) {
  e.shield = false; e.broken = 4; hitStop = 0.15; shake = 12;
  banner('破防！', '時間停住了：用餘燼弩瞄準首領的頭'); setTimeout(() => { if (boss === e && !e.dead && state === 'play' && !paused && !cine) startSnipe(e); }, 300); SND.burn(); fxRing(e.x, e.y, 200, 0xffcf6b, 0.7); burst(e.x, e.y, '#7fe8ff', 60, 260, 0.9, 2, 8);
}
function bossAI(e, dt, d, see, startCharge) {
  if (!e.phased && e.hp < e.maxHp * 0.6) bossShield(e);
  if (e.shield && !enemies.some(c => c.type === 'crystal' && !c.dead)) bossBreak(e);
  const rage = e.hp < e.maxHp * 0.5;
  if (rage && !e.raged) { e.raged = true; fxRing(e.x, e.y, 200, 0xff4020, 0.7); shake = 8; sfx(70, 0.7, 'sawtooth', 0.09, 60); floatText(e.x, e.y, '狂暴！', '#ff5a3a', 22); }
  if (e.spiral > 0 && (e.spT -= dt) <= 0) { e.spT = 0.055; e.spiral--; e.spA += 0.42; for (const o of [0, Math.PI]) enemyShot(e, e.spA + o, 185, e.dmg * 0.55, '#ff7030', 7); if (e.spiral % 4 === 0) sfx(300, 0.05, 'square', 0.03); }
  if (e.volley > 0) {
    e.volT -= dt;
    if (e.volT <= 0) { e.volT = 0.22; e.volley--; const a = Math.atan2(p.y - e.y, p.x - e.x); e.face = a; e.faceLock = 0.3; for (const o of [-0.22, 0, 0.22]) enemyShot(e, a + o, 300, e.dmg * 0.7, '#ff9a3a', 7); sfx(420, 0.06, 'square', 0.04); }
  }
  e.act -= dt;
  if (e.act > 0 || !see) return false;
  e.act = (rage ? 1.7 : 2.5) * (e.shield ? 1.5 : 1);
  if (e.bi > 0 && Math.random() < 0.42) { // 各層守關者的招牌招式
    const blink = (x, y) => { if (circleHits(x, y, e.r)) return false; burst(e.x, e.y, '#c9a0ff', 24, 160, 0.5, 2, 5); e.x = x; e.y = y; burst(x, y, '#c9a0ff', 24, 160, 0.5, 2, 5); sfx(700, 0.2, 'sine', 0.06, -500); return true; };
    if (e.bi === 1) { // 沼澤骨王：腳下冒出毒爆
      for (let i = 0; i < (rage ? 7 : 5); i++) { const x = p.x + (i ? rand(-100, 100) : 0), y = p.y + (i ? rand(-100, 100) : 0); dangers.push({ x, y, t: 1, R: 58, dmg: e.dmg * 0.9 }); fxRing(x, y, 58, 0x80ff60, 1); }
      charOnce(e, 'Spellcast_Summon', 1.5); sfx(160, 0.5, 'sawtooth', 0.06, 120);
    } else if (e.bi === 2) { e.spiral = rage ? 40 : 26; e.spA = rand(0, 6.28); charOnce(e, 'Spellcast_Summon', 1); } // 熔核督軍：螺旋火雨
    else if (e.bi === 3) { // 霜冠亡王：瞬移到身後，放一圈會緩速的冰彈
      blink(p.x - Math.cos(p.aim) * 80, p.y - Math.sin(p.aim) * 80);
      for (let i = 0; i < 12; i++) { enemyShot(e, i / 12 * 6.283, 200, e.dmg * 0.6, '#9fd8ff', 8); shots[shots.length - 1].slow = true; }
      charOnce(e, 'Spellcast_Shoot', 1.2); fxRing(e.x, e.y, 90, 0x9fd8ff, 0.4);
    } else { // 虛空之主：瞬移後放出八方向的彈鏈
      const a0 = rand(0, 6.28); blink(p.x + Math.cos(a0) * 130, p.y + Math.sin(a0) * 130);
      for (let d2 = 0; d2 < 8; d2++) for (let k = 0; k < (rage ? 5 : 4); k++) enemyShot(e, d2 / 8 * 6.283 + 0.2, 110 + k * 55, e.dmg * 0.6, '#c080ff', 7);
      charOnce(e, 'Spellcast_Summon', 1.6); shake = 6;
    }
    return false;
  }
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
  if (e.shield) { if (Math.random() < 0.4) { floatText(e.x, e.y, '屏障', '#7fe8ff', 13); sfx(1600, 0.05, 'triangle', 0.03); } return; }
  let dmg = p.st.dmg * mult * rand(0.88, 1.12) * (p.burnT > 0 ? 1.3 : 1 + p.ember / 100 * 0.2); const crit = Math.random() * 100 < p.st.crit || (p.nextCrit && !o.noProc && !(p.nextCrit = false));
  { const hf = p.hp / p.st.hp; if (tl('kA4') && hf < 0.3) dmg *= 1.3; if (tl('bA2') && hf < 0.5) dmg *= 1.25; if (tl('mB3') && e.freeze > 0) dmg *= 1.3; if (setN('frost') >= 3 && e.freeze > 0) dmg *= 1.4; if (tl('mC4') && p.mp > p.st.mp * 0.8) dmg *= 1.3; } // 火越旺打得越痛
  if (crit && !o.noProc && setN('void') >= 3 && holes.length < 2 && Math.random() < 0.15) { holes.push({ x: e.x, y: e.y, t: 2, tick: 0.2 }); sfx(90, 0.8, 'sine', 0.08, -50); fxRing(e.x, e.y, 170, 0xa060ff, 0.5); }
  if (crit) dmg *= tl('rA4') ? 3 : wtOf(p.equip.weapon) === WT.dagger ? 2.6 : 2;
  dmg = Math.max(1, Math.round(dmg));
  e.hp -= dmg; e.flash = 0.12; e.awake = true;
  if (e.broken > 0) { dmg = Math.round(dmg * 1.5); e.hp -= Math.round(dmg / 3); }
  const s0 = src || p, a = Math.atan2(e.y - s0.y, e.x - s0.x), k = e.fixed ? 0 : e.type === 'boss' ? 0.1 : e.type === 'brute' ? 0.4 : 1;
  e.kx += Math.cos(a) * kb * k * 3; e.ky += Math.sin(a) * kb * k * 3;
  if (e.type !== 'boss' && !e.fixed && !e.ch && kb > 0 && (o.heavy || time > (e.stunAt || 0))) { e.stun = Math.max(e.stun, o.heavy ? 0.4 : 0.15); e.stunAt = time + 1.1; if (o.heavy) e.atkT = 0; } // 踉蹌後有一小段抗性，不會被連打鎖死
  floatText(e.x, e.y, crit ? dmg + '!' : '' + dmg, crit ? '#ffd84a' : '#fff', crit ? 24 : o.heavy ? 18 : 15);
  // 火花往被打的方向噴
  const chunk = Math.min(1, dmg / e.maxHp);
  for (let i = 0, n = Math.round((crit ? 10 : o.heavy ? 8 : 4) + chunk * 14); i < n; i++) { const b = a + rand(-0.6, 0.6), v = rand(80, 260) * (1 + chunk); parts.push(mkPart(e.x, e.y, 1.4, Math.cos(b) * v, Math.sin(b) * v, rand(0, 3), crit ? '#ffd84a' : '#f4eedc', rand(0.2, 0.4), rand(2.5, 5), 7)); }
  if (crit) { SND.crit(); punch = Math.max(punch, 0.07); if (tl('mA4') && !o.noProc && Math.random() < 0.3) setTimeout(() => chain(e), 0);
    hitStop = Math.max(hitStop, 0.07); if (p.pas.critboom && !o.noProc) blast(e.x, e.y, 52, 0.5 * p.pas.critboom, 0xffd84a, 0.2, true); }
  if (p.st.ls > 0) { p.hp = Math.min(p.st.hp, p.hp + dmg * p.st.ls / 100); if (Math.random() < 0.15 + p.st.ls * 0.04) for (let i = 0; i < 3; i++) parts.push(mkPart(e.x, e.y, 1.4, (p.x - e.x) / 0.35 + rand(-30, 30), (p.y - e.y) / 0.35 + rand(-30, 30), 0, '#ff3048', 0.35, 4)); }
  if (e.hp <= 0) killEnemy(e);
  else if (e.type !== 'boss' && !e.ch && e.atkT <= 0 && e.v && e.v.lock <= 0) charOnce(e, 'Hit_A', 2, 0.2);
}
function killEnemy(e) {
  e.dead = true; gainXp(Math.round(e.xp * (1 + Math.min(p.streak, 25) * 0.02)));
  if (!e.summoned) { let hu = null; for (const k in p.equip) if (heatUp(p.equip[k], e.type === 'boss' ? 15 : e.elite ? 3 : 1)) hu = p.equip[k]; if (hu) { refresh(); heroLook(); floatText(p.x, p.y, `🔥 ${hu.name} → ${HEAT[hu.heat]}`, '#' + HEATC[hu.heat].toString(16).padStart(6, '0'), 17); sfx(330, 0.4, 'sawtooth', 0.05, 330); burst(p.x, p.y, '#ffa040', 24, 120, 0.7, 1.2, 6); tip('heat', '裝備穿著戰鬥會越燒越熱：熱度越高數值越強、外觀越亮，燒到白熾會多一條詞綴'); } }
  if (setN('bog') >= 3 && e.type !== 'boss' && pools.length < 14) pools.push({ x: e.x, y: e.y, t: 3, tick: 0.2, R: 58, l: 2, bog: true });
  if (p.fx.boom && e.type !== 'boss') booms.push({ x: e.x, y: e.y, t: 0.16, mult: p.fx.boom }); SND.bones();
  if (e.freeze > 0 && p.mx['nova.shatter']) booms.push({ x: e.x, y: e.y, t: 0.05, R: 78, mult: 0.9, color: 0x88ddff });
  for (let i = 0, n = e.elite ? 26 : 14; i < n; i++) { const b = rand(0, 6.283), v = rand(60, 260); parts.push(mkPart(e.x, e.y, rand(0.8, 2), Math.cos(b) * v + e.kx * 0.15, Math.sin(b) * v + e.ky * 0.15, rand(2, 8), i % 3 ? '#e8e2d0' : '#b8b0a0', rand(0.5, 1), rand(3, 7), 14)); } // 骨頭碎片
  if (tl('bA3')) p.hp = Math.min(p.st.hp, p.hp + p.st.hp * 0.02);
  if (p.pas.blood) p.hp = Math.min(p.st.hp, p.hp + p.st.hp * 0.04 * p.pas.blood);
  p.emberT = 6;
  if (p.burnT > 0) { p.burnT = Math.min(12, p.burnT + p.burnExt); p.burnExt *= 0.86; } // 爆燃中每殺一隻就多燒一下，但越加越少
  else if (p.spentT <= 0) { const was = p.ember; tip('ember0', '擊殺會讓火把更旺（橘色條）：火越旺傷害越高、看得越遠；太久沒殺敵會慢慢變小'); p.ember = Math.min(100, p.ember + (e.type === 'boss' ? 100 : e.elite ? 22 : 7) * (1 + 0.4 * (p.pas.ember || 0))); if (was < 100 && p.ember >= 100) { tip('ember', touchMode ? '餘燼滿了！按 💥 引爆火把，8 秒內攻擊更快、每一擊都帶火焰' : '餘燼滿了！按 G 引爆火把，8 秒內攻擊更快、每一擊都帶火焰'); sfx(880, 0.3, 'triangle', 0.05, 440); } }
  if (e.trait === 'split') for (let i = 0; i < 3; i++) { const b = i * 2.1, m = spawnEnemy('imp', e.x + Math.cos(b) * 22, e.y + Math.sin(b) * 22); m.awake = true; m.xp *= 0.3; m.atkCd = 0.8; m.kx = Math.cos(b) * 300; m.ky = Math.sin(b) * 300; }
  if (e.trait === 'bomb') { dangers.push({ x: e.x, y: e.y, t: 1.1, R: 95, dmg: e.dmg * 1.6 }); fxRing(e.x, e.y, 95, 0xff3020, 1.1); }
  toCorpse(e);
  const f = p.floor;
  if (e.type === 'boss') {
    if (fps && fps.mode === 'boss') endRange(false);
    boss = null; stairs.open = true; shake = 16; hitStop = 0.12; startCine(e, 'outro', '擊敗', e.name, 2); SND.legend(); burst(e.x, e.y, '#ffcf6b', 90, 260, 1.2, 2, 8); fxRing(e.x, e.y, 260, 0xffcf6b, 0.9); sfx(80, 0.8, 'sawtooth', 0.09, 300);
    for (let i = 0; i < 2; i++) dropItem(e.x + rand(-50, 50), e.y + rand(-50, 50), makeItem(f, i === 0 && (p.run && p.run.danger || 0) >= 5 && Math.random() < 0.3 ? 4 : rollRarity(i === 0 ? 2 : 1)));
    for (let i = 0; i < 10; i++) dropGold(e.x + rand(-30, 30), e.y + rand(-30, 30), irand(8, 16) * (1 + f * 0.1));
    for (let i = 0; i < 2 + Math.floor((p.run ? p.run.tier : 1) / 2); i++) dropMat('cry', e.x, e.y); for (let i = 0; i < 6; i++) dropMat('bone', e.x, e.y);
    drops.push(mk('hp', e.x - 20, e.y)); drops.push(mk('mp', e.x + 20, e.y));
    { const sk = Object.keys(SETS).find(k => SETS[k].boss === e.bi); if (sk) { p.setPity = p.setPity || {}; const pv = (p.setPity[sk] || 0) + 1; if (Math.random() < 0.4 || pv >= 3) { p.setPity[sk] = 0; dropItem(e.x, e.y - 50, makeSetItem(sk, f)); } else p.setPity[sk] = pv; } }
    torchAdd(100, e.x, e.y); p.kills++; bounty('boss'); goalDone(`${e.name}倒下了`);
    for (const o of enemies) if (o !== e && !o.dead) { o.hp = 0; o.dead = true; toCorpse(o); }
    return;
  }
  if (e.key) { dropMat('cry', e.x, e.y); for (let i = 0; i < 3; i++) dropMat('bone', e.x, e.y); stairs.open = true; banner('封印解除', '樓梯打開了'); SND.shrine(); dropItem(e.x, e.y + 20, makeItem(f, rollRarity(2))); for (let i = 0; i < 5; i++) dropGold(e.x + rand(-25, 25), e.y + rand(-25, 25), irand(6, 12) * (1 + f * 0.1)); }
  if (e.summoned) return;
  torchAdd(e.elite ? 10 : 2, e.x, e.y);
  p.kills++; if (p.run) p.run.kills++; bounty('kill'); if (e.elite) bounty('elite'); p.streak++; p.streakT = 3.5;
  if ([5, 10, 25, 50, 100, 200].includes(p.streak)) { /* 連殺里程碑 */ floatText(p.x, p.y, `連殺 ×${p.streak}！`, '#ff9a3a', 20); dropGold(e.x, e.y, Math.min(p.streak, 50) * 1.5 * (1 + f * 0.1)); SND.level(); } // 連殺獎金有上限
  if (e.elite) { for (let i = 0; i < 3; i++) dropMat('bone', e.x, e.y); if (Math.random() < 0.35) dropMat('cry', e.x, e.y); } else if (Math.random() < 0.1 * (1 + ((p.run && p.run.danger) || 0) * 0.15)) dropMat('bone', e.x, e.y);
  if (Math.random() < 0.45) dropGold(e.x, e.y, irand(2, 6) * (1 + f * 0.1) * (e.elite ? 4 : 1));
  const r = Math.random();
  if (r < 0.07) drops.push(mk('hp', e.x, e.y)); else if (r < 0.11) drops.push(mk('mp', e.x, e.y));
  if (e.elite || Math.random() < 0.045) dropItem(e.x, e.y, makeItem(f, rollRarity(e.elite ? 1 : 0)));
}
const mk = (kind, x, y, extra) => Object.assign({ kind, x: x + rand(-14, 14), y: y + rand(-14, 14), t: 0, v: null }, extra);
function dropMat(kind, x, y) { drops.push(mk(kind, x, y, { amt: kind === 'bone' ? irand(1, 2) : 1 })); }
function dropGold(x, y, v) { drops.push(mk('gold', x, y, { amt: Math.max(1, Math.round(v * diff().gold * (rmod('dark') ? 1.5 : 1) * (1 + darkK() * 0.5))) })); }
function dropItem(x, y, it) {
  drops.push(mk('item', x, y, { it }));
  if (it.rarity >= 4) { floatText(x, y + 10, '🔥 餘燼裝備', '#ff4a3a', 22); fxRing(x, y, 170, 0xff3a20, 1); }
  if (it.rarity >= 3) { // 傳說掉落：畫面一頓、光柱、音樂
    hitStop = Math.max(hitStop, 0.3); SND.legend(); fxRing(x, y, 120, 0xff8a3a, 0.8); fxRing(x, y, 70, 0xffe080, 0.5); burst(x, y, '#ff9a3a', 40, 180, 1.2, 1, 10);
    floatText(x, y, it.set ? `◆ ${SETS[it.set].n} ◆` : '★ 傳說 ★', it.set ? SETS[it.set].c : '#ff8a3a', 26); shake = Math.max(shake, 6);
  } else if (it.rarity === 2) { sfx(880, 0.3, 'triangle', 0.06, 400); sfx(1320, 0.3, 'triangle', 0.04, 0, 0.1); fxRing(x, y, 60, 0xffd84a, 0.4); }
}

function hurtPlayer(d) {
  if (p.inv_t > 0 || p.dashT > 0 || state !== 'play') return;
  if (tl('kA3') && Math.random() < 0.2) { d *= 0.5; floatText(p.x, p.y, '格擋', '#cfe0ff', 13); sfx(1800, 0.1, 'triangle', 0.04); }
  if ((tl('kA4') && p.hp < p.st.hp * 0.3) || p.iceT > 0) d *= 0.5;
  d *= 1 + darkK() * 0.35;
  const raw0 = d; d = Math.max(1, Math.round(d * (60 + 12 * p.floor) / (60 + 12 * p.floor + p.st.armor) * rand(0.9, 1.1) * (p.buff && p.buff.k === 'ward' ? 0.5 : 1)));
  if (p.run) p.run.taken = (p.run.taken || 0) + d; const blocked = 1 - d / raw0; if (blocked > 0.12) { sfx(rand(1700, 2300), 0.12, 'triangle', 0.05 * blocked + 0.02); sfx(rand(900, 1100), 0.18, 'square', 0.02); for (let i = 0; i < 4 + blocked * 16; i++) { const b = rand(0, 6.28), v = rand(60, 200); parts.push(mkPart(p.x, p.y, 1.3, Math.cos(b) * v, Math.sin(b) * v, rand(1, 4), '#e8eef5', 0.3, 3, 8)); } }
  p.hp -= d; p.hurtT = 0.25; p.inv_t = 0.25; shake = Math.max(shake, 5);
  floatText(p.x, p.y, '-' + d, '#ff6a6a', 17); SND.hurt();
  burst(p.x, p.y, '#ff4444', 6, 90, 0.4, 1.4, 2);
  $('hurt').style.opacity = 1; setTimeout(() => $('hurt').style.opacity = 0, 120);
  if (p.fx.thorns && p.thornCd <= 0) { p.thornCd = 0.8; fxRing(p.x, p.y, 125, 0x66ff88, 0.35); for (const e of enemies) if (!e.dead && dist(e, p) < 125 + e.r) hitEnemy(e, p.fx.thorns || 1.5, 220); }
  if (tl('bC3')) { let ne = null, nd = 90; for (const e of enemies) { const dd = dist(e, p); if (!e.dead && dd < nd) { nd = dd; ne = e; } } if (ne) hitEnemy(ne, 0.6, 100, null, { noProc: true }); }
  if (p.hp <= 0 && tl('bC4') && !p.barbUsed) { p.barbUsed = true; p.hp = p.st.hp * 0.4; p.inv_t = 1.5; banner('', '不倒：撐住了！'); hitStop = 0.2; burst(p.x, p.y, '#ff6040', 40, 200, 1, 1, 7); }
  if (p.hp <= 0 && p.fx.phoenix && !p.phoenixUsed) {
    p.phoenixUsed = true; p.hp = p.st.hp * (p.fx.phoenix || 0.5); p.inv_t = 1.5; banner('', '晨曦庇護了你'); hitStop = 0.2;
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
  for (let i = 0; i < Math.round(p.fx.chain || 3); i++) {
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
const torchF = () => p.run && p.run.torch !== undefined ? p.run.torch / 100 : 1; // 1 = 全亮
const darkK = () => p.run ? 1 - torchF() : 0; // 越暗：掉寶越好、怪越兇
function torchAdd(n, x, y) { if (!p.run || p.run.torch === undefined) return; const was = p.run.torch; p.run.torch = clamp(was + n, 0, 100); if (n >= 10) { floatText(x || p.x, (y || p.y) - 20, `🔥 火光 +${Math.round(p.run.torch - was)}`, '#ffb060', 14); } }
function torchTick(dt) {
  if (p.run.torch === undefined) p.run.torch = 100;
  const was = p.run.torch; p.run.torch = Math.max(0, was - 0.55 * dt * (rmod('dark') ? 1.3 : 1));
  for (const [th, msg] of [[50, '火光變暗了：掉寶變好，怪也更兇'], [20, '快看不見了⋯點亮火盆或殺敵補火'], [0, '黑暗侵蝕：持續掉血！']]) if (was > th && p.run.torch <= th) { floatText(p.x, p.y - 30, msg, th ? '#ffb060' : '#ff5a5a', 15); sfx(th ? 300 : 160, 0.5, 'sawtooth', 0.05, -120); }
  if (p.run.torch <= 0 && p.hp > 1) { p.darkT = (p.darkT || 0) + dt; if (p.darkT >= 1) { p.darkT = 0; const d = Math.max(1, Math.round(p.st.hp * 0.04)); p.hp = Math.max(1, p.hp - d); floatText(p.x, p.y, '-' + d, '#a070ff', 14); } }
  for (const b of braziers) {
    if (b.lit) { if (Math.random() < dt * 8) parts.push(mkPart(b.x + rand(-5, 5), b.y + rand(-5, 5), rand(1.8, 2.4), rand(-8, 8), rand(-8, 8), rand(3, 6), Math.random() < 0.5 ? '#ffb040' : '#ff5a20', rand(0.4, 0.8), rand(4, 8), -3)); if (b.m) { const k = 1 + Math.sin(time * 14 + b.x) * 0.12; b.m.scale.set(k, 1 + Math.sin(time * 9 + b.y) * 0.18, k); } continue; }
    const dd = dist(b, p);
    if (dd < 200) tip('brazier', '火盆：走過去點亮，補回大量火光（左上火光條）');
    if (dd < 46) { b.lit = true; torchAdd(45, b.x, b.y); if (b.m) b.m.material.color.setHex(0xff8a30); burst(b.x, b.y, '#ffa040', 36, 150, 0.9, 2, 6); fxRing(b.x, b.y, 90, 0xff8a30, 0.5); SND.burn(); bounty('brazier'); }
  }
}
function useShrine() {
  const b = BUFFS[shrine.kind]; shrine.used = true; p.buff = { k: shrine.kind, t: 45 }; refresh();
  p.hp = Math.min(p.st.hp, p.hp + p.st.hp * 0.3); banner(b[1] + '祝福', b[2] + '（45 秒）');
  fxRing(p.x, p.y, 110, b[3], 0.6); burst(shrine.x, shrine.y, '#' + b[3].toString(16).padStart(6, '0'), 40, 150, 1, 3, 6); SND.shrine();
}
function die() {
  p.hp = 0; state = 'dead'; intensity = 0; logRun('倒下');
  const endless = p.run && p.run.goal === 'endless', lost = endless ? 0 : Math.floor(p.gold * 0.3); p.gold -= lost;
  if (endless) { weekCheck(); p.weekly.best = Math.max(p.weekly.best, p.run.depth - 1); }
  if (hero) hero.once('Death_A', 1, 99);
  p.deaths++; setTimeout(() => { if (state === 'dead') endScreen(false, lost); }, 1300); sfx(200, 0.7, 'sawtooth', 0.08, -170);
  save();
}

function goalDone(title) { // 遠征目標達成：開出回營地的傳送火焰
  const R = p.run; if (!R || R.done) return; R.done = true;
  stairs.open = true; stairs.portal = true; banner(title, '走進火焰回到營地'); SND.shrine();
  tip('portal', '目標完成！走到發光的火焰按「回到營地」結算，會開獎勵箱');
}
function freePrisoner() {
  const r = prisoner.room; let n = 0;
  for (const e of enemies) if (e.x >= r.x * T && e.x < (r.x + r.w) * T && e.y >= r.y * T && e.y < (r.y + r.h) * T) n++;
  if (n) { floatText(prisoner.x, prisoner.y, '先打倒周圍的敵人', '#f99', 14); return; }
  prisoner.freed = true; const c = extraChars.find(c => c.ref === prisoner); if (c) c.once('Cheer', 1.2, 99);
  burst(prisoner.x, prisoner.y, '#ffe080', 30, 120, 0.9, 1, 6); if (!p.rescued.includes(prisoner.who.n)) p.rescued.push(prisoner.who.n);
  floatText(prisoner.x, prisoner.y, prisoner.who.cls ? '我在營地等你，下次換我上場！' : '謝謝你！我在營地等你。', '#ffe9b0', 15); if (prisoner.who.cls) tip('hero', `${prisoner.who.n} 是可以操作的角色：回營地走到他旁邊就能換人出征`); goalDone(`救出了${prisoner.who.n}`);
}
// 結算：回營地前先開獎勵箱
let chestItems = null;
function logRun(res) { // 記下這一趟，匯出狀態時用
  const R = p.run; if (!R) return;
  p.hist = (p.hist || []).slice(-14);
  p.hist.push({ at: new Date().toISOString().slice(5, 16).replace('T', ' '), cls: p.cls, lvl: p.lvl, tier: R.tier, dg: R.danger || 0, goal: R.goal, mod: R.mod, depth: R.depth, res,
    sec: Math.round((Date.now() - R.t0) / 1000), kills: R.kills, taken: Math.round(R.taken || 0), hp: p.st.hp, pots: R.pots || 0, items: R.items, gold: p.gold - R.gold0 });
}
function finishRun() {
  const R = p.run; if (!R) return;
  paused = true; joy.id = null; atkHeld = false; mouse.l = mouse.r = false;
  const unlock = R.goal === 'boss' && R.tier === p.tier, sec = Math.round((Date.now() - R.t0) / 1000);
  if (unlock) p.tier++;
  logRun('完成'); const firstEver = !p.clears; p.clears = (p.clears || 0) + 1; bounty('clear');
  const n = 2 + (Math.random() * 100 < ncv('luck') ? 1 : 0) + (rmod('elite') ? 1 : 0) + (R.goal === 'rescue' ? 1 : 0) + (bl('guild') >= 3 ? 1 : 0);
  const dk = 1 + (R.danger || 0) * 0.15, mb = Math.round((8 + R.tier * 4) * dk), mc = Math.round((1 + Math.floor(R.tier / 2)) * dk); p.mats.bone += mb; p.mats.cry += mc;
  chestItems = [];
  for (let i = 0; i < n; i++) chestItems.push(makeItem(p.floor + 1, i === 0 && (firstEver || (unlock && Math.random() < 0.2)) ? 3 : Math.max(1, rollRarity(i === 0 ? 2 : 1))));
  const g = Math.round((40 + p.floor * 10) * diff().gold * (bl('guild') >= 2 ? 1.25 : 1)); p.gold += g;
  $('sumTitle').textContent = R.tier >= 7 && unlock && !p.won ? (p.won = true, '你征服了餘燼地城') : '遠征完成';
  $('sumTxt').innerHTML = `${mapName(R.tier)}・${R.goal === 'boss' ? '獵首領' : '救人：' + R.who}${RUNMOD[R.mod][0] ? '・◆' + RUNMOD[R.mod][0] : ''}<br>`
    + `用時 ${Math.floor(sec / 60)} 分 ${sec % 60} 秒・擊殺 ${R.kills}・撿到 ${R.items} 件裝備・賺了 ${p.gold - R.gold0 - g} 金<br>`
    + `帶回 🦴 ${(R.bone || 0) + mb}・💎 ${(R.cry || 0) + mc}（含完成獎勵 🦴 ${mb}・💎 ${mc}）<br>`
    + `<b style="color:#ffcf6b">完成獎勵 +${g} 金</b>` + (unlock ? `<br><b class="good">解鎖了新區域：${mapName(p.tier)}（等級 ${p.tier}）</b>` : '');
  $('chestBtn').style.display = 'inline-block'; $('chestOut').innerHTML = ''; $('sumBack').style.display = 'none';
  $('summary').classList.add('on'); SND.level();
}
$('chestBtn').onclick = () => {
  $('chestBtn').style.display = 'none'; let i = 0;
  const show = () => { // 一件一件翻開，稀有度越高越大聲
    const it = chestItems[i++]; if (!it) { $('sumBack').style.display = 'inline-block'; return; }
    if (p.inv.length < invCap()) p.inv.push(it); else p.gold += it.val; addCodex(it);
    $('chestOut').insertAdjacentHTML('beforeend', `<div class="loot r${it.rarity}">${SLOTS[it.slot].i} <b style="color:${RAR[it.rarity].c}">${it.name}</b>${upgradeOf(it) > 0.5 ? ' <span class="good">▲</span>' : ''}${it.fx ? `<br><small style="color:#ff8a3a">★ ${fxText(it)}</small>` : ''}</div>`);
    if (it.rarity >= 3) SND.legend(); else if (it.rarity === 2) SND.level(); else SND.coin();
    setTimeout(show, it.rarity >= 3 ? 900 : 450);
  };
  show();
};
$('sumBack').onclick = () => { $('summary').classList.remove('on'); paused = false; p.board = null; genCamp(); };
function endScreen(win, lost) {
  $('deadTitle').textContent = win ? '你征服了餘燼地城' : '火把熄了';
  $('deadTxt').innerHTML = win
    ? `第 20 層的虛空之主倒下了。<br>擊殺 ${p.kills}・倒下 ${p.deaths} 次・等級 ${p.lvl}<br>想挑戰極限的話，樓梯還會繼續往下。`
    : p.run && p.run.goal === 'endless' ? `每週挑戰結束：完成了 ${p.run.depth - 1} 層。<br>本週最佳：${p.weekly.best} 層<br>` : `遠征失敗：倒在${p.run ? `${mapName(p.run.tier)}第 ${p.run.depth} 層` : '地城裡'}。<br>掉了 ${lost} 枚金幣，撿到的裝備、等級都還在。<br><span class="dim">擊殺 ${p.kills}・倒下 ${p.deaths} 次</span>`;
  $('reviveBtn').textContent = win ? '繼續' : '回到營地';
  $('dead').classList.add('on'); if (win) { paused = true; SND.shrine(); }
}
function interact() { if (actMode === 'stairs') descend(); else if (actMode === 'shop') openStore(); else if (actMode === 'board') openBoard(); else if (actMode === 'fire') openBld('cos'); else if (actMode === 'range') startRange(); else if (actMode === 'portal') finishRun(); else if (actMode === 'free') freePrisoner(); else if (actMode === 'pick' && pickNear) { if (p.inv.length < invCap()) { const d = pickNear; p.inv.push(d.it); d.dead = true; if (p.run) p.run.items++; addCodex(d.it); sfx(700, 0.1, 'triangle', 0.05, 200); floatText(p.x, p.y, d.it.name, RAR[d.it.rarity].c, 14); pickNear = null; actMode = null; } else floatText(p.x, p.y, '背包滿了', '#f77', 13); } else if (BLD[actMode]) openBld(actMode); else if (actMode && actMode.startsWith('hero:')) switchHero(actMode.slice(5)); }
function aimAngle() {
  if (!touchMode) return Math.atan2(mouse.wy - p.y, mouse.wx - p.x);
  let best = null, bd = 380;
  for (const e of enemies) { const d = dist(e, p) * (e.type === 'crystal' ? 0.5 : 1); if (d < bd && e.awake && !e.shield && los(p, e)) { bd = d; best = e; } }
  if (best) return Math.atan2(best.y - p.y, best.x - p.x);
  for (const o of props) { if (o.kind === 'barrel' && dist(o, p) < 80) return Math.atan2(o.y - p.y, o.x - p.x); }
  return p.aim;
}
const SWINGS = ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'];
function pshot(x, y, a, spd, o) { shots.push(Object.assign({ x: x + Math.cos(a) * 16, y: y + Math.sin(a) * 16, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: 6, from: 'p', life: 0.9, ps: true, hit: new Set(), mult: 1, kb: 60, pierce: 0, col: '#ffe9b0' }, o)); }
function weaponFx(hits) { // 傳說武器與爆燃的命中效果
  if (!hits.length) return;
  if (p.fx.frost) for (const e of hits) if (!e.dead) { e.slow = 2.5; if (e.type !== 'boss' && Math.random() < p.fx.frost) e.freeze = Math.max(e.freeze, 1.1); }
  if (p.fx.chain && Math.random() < 0.3) chain(hits[0]);
  if (p.burnT > 0) for (const e of hits.slice(0, 3)) blast(e.x, e.y, 48, 0.4, 0xff7a2a, 0.15, true);
}
function attack() {
  if (p.atkCd > 0 || p.whirlT > 0 || p.dashT > 0 || p.leap) return;
  const w = wtOf(p.equip.weapon), mast = p.pas.mastery || 0;
  p.aim = aimAngle(); p.atkCd = w.cd / (1 + p.st.aspd / 100) / (p.burnT > 0 ? 1.4 : 1) / (tl('rB3') && p.hasteT > 0 ? 1.4 : 1) / (tl('bA4') && p.streak >= 10 ? 1.4 : 1); p.slashT = 0.18; p.slashA = p.aim;
  p.combo = (p.combo + 1) % 3; const fin = p.combo === 2;
  if (setN('frost') >= 3 && (p.frN = (p.frN || 0) + 1) % 4 === 0) { fxRing(p.x, p.y, 125, 0x88ddff, 0.4); burst(p.x, p.y, '#bfefff', 26, 170, 0.6, 1, 5); sfx(1500, 0.25, 'triangle', 0.05, -900); for (const e of enemies) if (!e.dead && dist(e, p) < 125 + e.r) { e.freeze = Math.max(e.freeze, e.type === 'boss' ? 0.4 : 1.2); e.slow = Math.max(e.slow || 0, e.freeze + 1.5); hitEnemy(e, 0.5, 60, null, { noProc: true }); } }
  if (w.ranged) {
    const n = 1 + mast + (fin && !w.homing ? 2 : 0);
    for (let i = 0; i < n; i++) pshot(p.x, p.y, p.aim + (i - (n - 1) / 2) * 0.13, w.spd, { mult: w.mult * (fin && w.homing ? 1.6 : 1) * (tl('rA1') ? 1.15 : 1), kb: w.kb, pierce: (w.pierce || 0) + (tl('rA2') ? 1 : 0), homing: w.homing, aoe: w.aoe ? w.aoe * (fin ? 1.5 : 1) : 0, col: w.homing ? '#b98cff' : '#ffe9b0', arrow: !w.homing, r: w.homing ? (fin ? 9 : 6) : 5, weapon: true });
    if (hero) hero.once(w.homing ? 'Spellcast_Shoot' : '1H_Ranged_Shoot', w.homing ? 2.6 : 2.4, p.atkCd * 0.8);
    if (p.fx.wave && fin) shots.push({ x: p.x + Math.cos(p.aim) * 24, y: p.y + Math.sin(p.aim) * 24, vx: Math.cos(p.aim) * 470, vy: Math.sin(p.aim) * 470, r: 22, from: 'p', life: 0.55, col: '#ff8a2a', wave: true, hit: new Set() });
    SND.shoot(w.homing); return;
  }
  if (hero) hero.once(w.heavy ? (fin ? '2H_Melee_Attack_Chop' : '2H_Melee_Attack_Slice') : w === WT.dagger && !fin ? '1H_Melee_Attack_Stab' : SWINGS[p.combo], (w.heavy ? 0.8 : 0.5) / p.atkCd, p.atkCd * 0.9);
  if (!p.moving) moveEnt(p, Math.cos(p.aim) * 9, Math.sin(p.aim) * 9); // 出手往前踏一步
  const range = w.range * (1 + mast * 0.25) * (fin ? 1.12 * (tl('kB3') ? 1.3 : 1) : 1), hits = [];
  fxSlash(p.x, p.y, p.aim, p.combo, range / 68, p.burnT > 0 ? 0xff8a3a : 0xfff0c8);
  SND.swing(w);
  for (const e of enemies) {
    const d = dist(e, p); if (d > range + e.r) continue;
    if (d < e.r + 14 || Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), p.aim)) < w.arc) { hitEnemy(e, w.mult * (fin ? 1.3 * (tl('kB3') ? 1.3 : 1) : 1), w.kb * (fin ? 1.5 : 1), null, { heavy: w.heavy || fin }); hits.push(e); }
  }
  if (hits.length) {
    shake = Math.max(shake, w.heavy ? 7 : fin ? 4.5 : 2.5); hitStop = Math.max(hitStop, w.heavy ? 0.09 : fin ? 0.06 : 0.04);
    p.hitChain++; p.hitChainT = 1.3; SND.hit(w, p.hitChain); p.mp = Math.min(p.st.mp, p.mp + 2); // 砍中會回一點魔力
  }
  if (fin && (w.heavy || w === WT.axe)) { const gx = p.x + Math.cos(p.aim) * range * 0.6, gy = p.y + Math.sin(p.aim) * range * 0.6; fxRing(gx, gy, range * 0.8, 0xffe0b0, 0.3); burst(gx, gy, '#b8a890', 12, 140, 0.5, 0.2, 4); noise(0.25, 0.12, 400); } // 重擊震地
  weaponFx(hits);
  if ((p.fx.wave || tl('kB4')) && fin) shots.push({ x: p.x + Math.cos(p.aim) * 24, y: p.y + Math.sin(p.aim) * 24, vx: Math.cos(p.aim) * 470, vy: Math.sin(p.aim) * 470, r: 22, from: 'p', life: 0.55, col: '#ff8a2a', wave: true, hit: new Set(hits) });
  for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, p) < range + o.r && Math.abs(angDiff(Math.atan2(o.y - p.y, o.x - p.x), p.aim)) < w.arc + 0.15) breakBarrel(o);
}
function breakBarrel(o) {
  o.dead = true; burst(o.x, o.y, '#b98552', 14, 120, 0.7, 1, 5); sfx(220, 0.08, 'square', 0.04, -100); noise(0.15, 0.08, 1500);
  const r = Math.random();
  if (r < 0.55) dropGold(o.x, o.y, irand(1, 5) * (1 + p.floor * 0.1)); else if (r < 0.63) drops.push(mk('hp', o.x, o.y)); else if (r < 0.68) drops.push(mk('mp', o.x, o.y));
}
function cast(k) {
  if (state !== 'play' || paused || !k) return;
  if (k === 'atk') return attack();
  if (k === 'hp' || k === 'mpp') return potion(k);
  if (k === 'ember') return ignite();
  const s = SK[k]; if (p.cd[k] > 0 || p.leap) return;
  const cost = s.mp * (tl('mC3') ? 0.75 : 1);
  if (p.mp < cost) { floatText(p.x, p.y, '魔力不足', '#6bf', 13); return; }
  const l = p.skl[k] || 1, M = p.mx || p.mods;
  if (k === 'bolt') { // 落雷要先確認有目標
    const ts = enemies.filter(e => !e.dead && dist(e, p) < 300 && los(p, e)).sort((a, b) => dist(a, p) - dist(b, p)).slice(0, (M['bolt.fork'] ? 7 : 4) + (tl('rC3') ? 2 : 0));
    if (!ts.length) { floatText(p.x, p.y, '附近沒有目標', '#aaa', 13); return; }
    for (const e of ts) { for (let i = 0; i < 12; i++) parts.push(mkPart(e.x + rand(-6, 6), e.y + rand(-6, 6), 0.5 + i * 0.75, 0, 0, 0, i % 2 ? '#ffffff' : '#9fd0ff', 0.25, 7)); fxFlash(e.x, e.y, 0x9fd0ff, 0.18); fxRing(e.x, e.y, 34, 0x9fd0ff, 0.25); hitEnemy(e, (1.3 + l * 0.3) * sm('bolt'), 40, e, { heavy: !!M['bolt.fork'] }); if ((M['bolt.fork'] || tl('mA3')) && !e.dead && e.type !== 'boss') e.stun = M['bolt.fork'] ? 1 : 0.8; }
    SND.zap(); sfx(90, 0.3, 'sawtooth', 0.1, -40); shake = 5; if (hero) hero.once('Spellcast_Raise', 2.4, 0.3);
  }
  p.mp -= cost; p.cd[k] = s.cd * ({ fire: tl('kC2') ? 0.75 : 1, dash: tl('rB2') ? 0.8 : 1, bolt: tl('mA2') ? 0.7 : 1, leap: tl('bB2') ? 0.7 : 1 }[k] || 1) * (k === 'dash' ? (p.fx.blink ? 0.5 : 1) * (setN('ash') >= 2 ? 0.75 : 1) * (p.cls === 'ranger' ? 0.7 : 1) : (wtOf(p.equip.weapon) === WT.sword ? 0.85 : 1) * (k === 'bolt' && p.pas.s_storm ? 0.5 : 1));
  if (k === 'fire') {
    const a = p.aim = aimAngle();
    for (const o of (p.fx.twin ? Array.from({ length: Math.round(p.fx.twin) }, (_, i) => (i - (Math.round(p.fx.twin) - 1) / 2) * 0.2) : [0])) shots.push({ x: p.x + Math.cos(a + o) * 18, y: p.y + Math.sin(a + o) * 18, vx: Math.cos(a + o) * 520, vy: Math.sin(a + o) * 520, r: 8, from: 'p', life: 1.4, col: '#ff8a2a', fire: true });
    sfx(240, 0.2, 'sawtooth', 0.05, 300); if (hero) hero.once('Spellcast_Shoot', 2.4, 0.3);
  } else if (k === 'whirl') { p.whirlT = 1.2 + (p.fx.storm || 0) + (M['whirl.long'] ? 0.8 : 0); p.whirlTick = 0; }
  else if (k === 'nova') {
    const R = 175 * (M['nova.big'] ? 1.4 : 1) * (tl('mB1') ? 1.2 : 1); if (tl('mB4')) { p.iceT = 4; fxRing(p.x, p.y, 40, 0xaaeeff, 4); } if (M['nova.big']) p.cd.nova = s.cd * 0.7;
    for (const e of enemies) if (dist(e, p) < R + e.r) { e.freeze = Math.max(e.freeze, (1.5 + l * 0.3 + (p.pas.s_frost ? 1 : 0) + (tl('mB2') ? 1 : 0)) * (e.type === 'boss' ? 0.35 : 1)); e.slow = e.freeze + 2; e.atkT = 0; hitEnemy(e, (1 + l * 0.25) * sm('nova'), 60); }
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
    const a = p.aim = aimAngle(), n = 7 + (M['volley.more'] ? 4 : 0) + (tl('rC2') ? 3 : 0);
    for (let i = 0; i < n; i++) pshot(p.x, p.y, a + (i / (n - 1) - 0.5) * 1.05, 560, { mult: (0.6 + l * 0.12) * sm('volley'), kb: 70, pierce: 2, arrow: true, r: 5, life: 0.7, col: '#ffd070' });
    SND.shoot(false); noise(0.2, 0.08, 6000, 2000); if (hero) hero.once('1H_Melee_Attack_Slice_Horizontal', 2.4, 0.25);
  } else if (k === 'totem') {
    const a = aimAngle(), put = b => { let x = p.x + Math.cos(b) * 44, y = p.y + Math.sin(b) * 44; if (circleHits(x, y, 8)) { x = p.x; y = p.y; } totems.push({ x, y, t: 8 + (tl('rC1') ? 3 : 0), cd: 0.3, l, v: null }); burst(x, y, '#ff9a3a', 16, 90, 0.6, 0.5, 5); };
    put(a); if (M['totem.twin']) put(a + Math.PI); sfx(200, 0.3, 'triangle', 0.07, 200); if (hero) hero.once('Spellcast_Raise', 2.4, 0.3);
  } else if (k === 'dash') {
    if (M['dash.double']) { if (!p.dash2) { p.dash2 = true; p.cd.dash = 0.28; } else p.dash2 = false; }
    let dx = moveX, dy = moveY; if (!dx && !dy) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
    if (ncv('ghost')) for (let i = 0; i < 18; i++) parts.push(mkPart(p.x + rand(-8, 8), p.y + rand(-8, 8), rand(0.3, 2.6), 0, 0, 0, '#9ad8ff', 0.6, rand(6, 9)));
    if (tl('rB3')) p.hasteT = 2; if (tl('rB4') || setN('ash') >= 3) p.nextCrit = true; p.ashT = 0;
    const m = Math.hypot(dx, dy); p.dashX = dx / m; p.dashY = dy / m; p.dashT = 0.2; sfx(500, 0.1, 'sine', 0.04, 400); noise(0.12, 0.04, 2500);
    if (hero) hero.once('Dodge_Forward', 2.2, 0.22);
  }
}
function ignite() { // 餘燼爆燃
  if (p.ember < 100 || p.burnT > 0) return;
  bounty('burn'); p.stat.burn = (p.stat.burn || 0) + 1;
  p.ember = 0; p.burnT = (p.pas.s_fire ? 11 : 8) + (setN('core') >= 3 ? 3 : 0); p.burnExt = 0.9; banner('爆燃', '繼續擊殺可以延長燃燒'); SND.burn(); hitStop = 0.12; shake = 10;
  blast(p.x, p.y, 160, 1.6, 0xff7a2a, 0.8, true); burst(p.x, p.y, '#ffb040', 60, 260, 1, 1, 9);
}
function potion(k) {
  if (p.potCd > 0) return;
  if (k === 'hp') { if (p.hpPot <= 0 || p.hp >= p.st.hp) return; p.hpPot--; const v = Math.round(p.st.hp * 0.45); p.hp = Math.min(p.st.hp, p.hp + v); floatText(p.x, p.y, '+' + v, '#6e6'); burst(p.x, p.y, '#55ee66', 16, 50, 0.8, 0.3, 5); }
  else { if (p.mpPot <= 0 || p.mp >= p.st.mp) return; p.mpPot--; const v = Math.round(p.st.mp * 0.6); p.mp = Math.min(p.st.mp, p.mp + v); floatText(p.x, p.y, '+' + v, '#6bf'); burst(p.x, p.y, '#55aaff', 16, 50, 0.8, 0.3, 5); }
  p.potCd = 0.8; if (p.run) p.run.pots++; sfx(600, 0.15, 'sine', 0.05, 300);
}
function explode(s) {
  const l = p.skl.fire || 1, k = s.mini ? 0.5 : 1, R = (62 + l * 3) * (s.mini ? 0.7 : 1) * (tl('kC3') ? 1.3 : 1);
  for (const e of enemies) if (dist(e, s) < R + e.r) hitEnemy(e, (1.5 + l * 0.3) * k * sm('fire'), 160, s);
  for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, s) < R) breakBarrel(o);
  burst(s.x, s.y, '#ff8a2a', 26 * k, 200, 0.6, 1.2, 6); burst(s.x, s.y, '#ffd84a', 12 * k, 110, 0.5, 1.2, 4);
  fxRing(s.x, s.y, R, 0xff8a2a, 0.3); fxFlash(s.x, s.y, 0xff8030, 0.25);
  SND.boom(k); shake = Math.max(shake, 5 * k);
  if (s.mini) return;
  if (p.mx['fire.split']) { const a0 = rand(0, 6.28); for (let i = 0; i < 3; i++) { const a = a0 + i * 2.094; shots.push({ x: s.x, y: s.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, r: 6, from: 'p', life: 0.32, col: '#ffb040', fire: true, mini: true, grace: 0.14 }); } }
  if (p.mx['fire.pool']) pools.push({ x: s.x, y: s.y, t: 3, tick: 0.3, R: 60, l });
}

// ---------- 更新 ----------
let moveX = 0, moveY = 0, pickNear = null;
const PICKN = ['全部', '精良以上', '稀有以上', '只撿傳說'];
const skipPick = d => d.kind === 'item' && d.it.rarity < (p.pick || 0); // 自動撿取設定以下的裝備留在地上
function update(dt) {
  time += dt; p.stat.play = (p.stat.play || 0) + dt;
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
    if (u >= 1) { p.leap = null; blast(p.x, p.y, 105 * (tl('bB4') ? 1.6 : 1), (1.8 + L.l * 0.3) * sm('leap'), 0xffc060, 0.9); if (tl('bB3')) for (const e of enemies) if (!e.dead && e.type !== 'boss' && dist(e, p) < 130) e.stun = Math.max(e.stun, 1); shake = 9; hitStop = 0.07; if (p.mx['leap.quake']) booms.push({ x: p.x, y: p.y, t: 0.32, R: 150, mult: 1 + L.l * 0.2, color: 0xffa040 }); if (hero) hero.once('1H_Melee_Attack_Chop', 2.2, 0.2); }
  } else if (p.dashT > 0) {
    p.dashT -= dt; moveEnt(p, p.dashX * 700 * dt, p.dashY * 700 * dt);
    if (p.dashT <= 0 && p.fx.blink) blast(p.x, p.y, 95, p.fx.blink || 1.2, 0xaa88ff);
    parts.push(mkPart(p.x, p.y, 1.2, 0, 0, 0, '#88ccff', 0.25, 9));
  } else if (m > 0.05) {
    const sp = 190 * (1 + st.move / 100) * (p.whirlT > 0 ? (p.mx['whirl.long'] ? 1 : 0.8) : p.atkCd > 0.12 ? 0.45 : 1) * (p.burnT > 0 ? 1.2 : 1) * (p.slowT > 0 ? 0.6 : 1);
    moveEnt(p, moveX * sp * dt, moveY * sp * dt); p.moving = true; p.moveA = Math.atan2(moveY, moveX);
    if ((p.stepT -= dt) <= 0) { p.stepT = 0.29; SND.step(); if (ncv('trail') || (p.cos && p.cos.trail !== 'none')) { const fc = p.cos && p.cos.trail === 'frost' ? '#80c8ff' : '#ff7a2a'; for (let i = 0; i < 3; i++) parts.push(mkPart(p.x + rand(-5, 5), p.y + rand(-5, 5), 0.06, 0, 0, 0, fc, 1.6, 6)); } }
    if (st.move > 0 && Math.random() < st.move / 25) parts.push(mkPart(p.x - moveX * 10 + rand(-6, 6), p.y - moveY * 10 + rand(-6, 6), 0.2, -moveX * 40 + rand(-20, 20), -moveY * 40 + rand(-20, 20), rand(0.5, 2), st.move > 20 ? '#ff9a40' : '#b8a080', 0.5, rand(2.5, 4.5), 3));
    if (touchMode && p.slashT <= 0) p.aim = p.moveA;
  }
  if (!touchMode) p.aim = aimAngle();
  if (mouse.l || atkHeld || keys.KeyJ) attack();
  if (mouse.r) cast(p.slots[0]);
  if (p.whirlT > 0 && p.mx['whirl.reflect']) for (const s of shots) if (s.from === 'e' && dist(s, p) < 100) { Object.assign(s, { from: 'p', ps: true, hit: new Set(), mult: 1.2, kb: 80, pierce: 0, vx: -s.vx * 1.3, vy: -s.vy * 1.3, life: 1.5 }); sfx(1400, 0.05, 'triangle', 0.04); }
  if (p.whirlT > 0) {
    p.whirlT -= dt; p.whirlTick -= dt;
    if (p.whirlTick <= 0) {
      p.whirlTick = 0.2; sfx(260, 0.06, 'triangle', 0.03, 100); noise(0.08, 0.03, 2500);
      if (p.fx.storm) for (const e of enemies) { const d = dist(e, p); if (d < 230 && d > 50 && e.type !== 'boss') { e.kx += (p.x - e.x) / d * 420; e.ky += (p.y - e.y) / d * 420; } }
      for (const e of enemies) if (dist(e, p) < 88 + e.r) hitEnemy(e, (0.6 + (p.skl.whirl || 1) * 0.12) * sm('whirl'), 40);
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
        for (const e of enemies) if (!s.hit.has(e) && dist(e, s) < e.r + s.r) { s.hit.add(e); hitEnemy(e, p.fx.wave || 1.3, 140, s); }
        for (const o of props) if (o.kind === 'barrel' && !o.dead && dist(o, s) < o.r + s.r) breakBarrel(o);
        parts.push(mkPart(s.x + rand(-14, 14), s.y + rand(-14, 14), 1.2, 0, 0, rand(0, 2), '#ff7a2a', 0.3, 5));
      }
    } else if (s.ps) {
      if (s.homing) { let best = null, bd = 190; for (const e of enemies) { const d = dist(e, s); if (d < bd && !s.hit.has(e)) { bd = d; best = e; } } if (best) { const ca = Math.atan2(s.vy, s.vx), na = ca + clamp(angDiff(Math.atan2(best.y - s.y, best.x - s.x), ca), -5 * dt, 5 * dt), sp = Math.hypot(s.vx, s.vy); s.vx = Math.cos(na) * sp; s.vy = Math.sin(na) * sp; } }
      if (wall || s.life <= 0) { s.dead = true; if (wall) burst(s.x, s.y, s.col, 4, 60, 0.3, 1.2, 1); }
      else {
        for (const e of enemies) if (!e.dead && !s.hit.has(e) && dist(e, s) < e.r + s.r + 3) {
          s.hit.add(e); hitEnemy(e, s.mult * (s.weapon && tl('rA3') && dist(e, p) > 200 ? 1.3 : 1), s.kb, s);
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
      else if (dist(s, p) < p.r + s.r) { s.dead = true; hurtPlayer(s.dmg); if (s.slow && p.dashT <= 0) { p.slowT = 2.2; floatText(p.x, p.y, '緩速', '#9fd8ff', 13); } }
    }
  }
  shots = shots.filter(s => { if (s.dead) killVis(s); return !s.dead; });
  props = props.filter(o => { if (o.dead) killVis(o); return !o.dead; });

  for (const o of props) if (o.kind === 'chest' && !o.open && dist(o, p) < o.r + p.r + 10) {
    o.open = true; bounty('chest'); if (o.vault) { ambush(o); dropMat('cry', o.x, o.y + 20); } else if (Math.random() < 0.5) dropMat('bone', o.x, o.y + 20); sfx(660, 0.2, 'triangle', 0.06, 300); burst(o.x, o.y, '#ffd84a', 24, 110, 0.9, 1, 6);
    for (let i = 0; i < irand(3, 6) * (o.gold ? 2 : 1); i++) dropGold(o.x + rand(-20, 20), o.y + 26, irand(4, 9) * (1 + p.floor * 0.1));
    dropItem(o.x, o.y + 30, makeItem(p.floor, rollRarity(o.gold ? 2 : Math.random() < 0.35 ? 1 : 0)));
    if (Math.random() < 0.5) drops.push(mk(Math.random() < 0.6 ? 'hp' : 'mp', o.x, o.y + 26));
  }
  fullMsgT -= dt; pickNear = null;
  for (const d of drops) {
    d.t += dt; if (d.t < 0.3) continue;
    const ds = dist(d, p);
    if (skipPick(d)) { if (ds < 46 && (!pickNear || ds < dist(pickNear, p))) pickNear = d; continue; }
    if ((d.kind === 'gold' || d.kind === 'bone' || d.kind === 'cry' || (ncv('magnet') && d.t > 0.8)) && ds < 110 * (1 + ncv('magnet') / 100)) { d.x += (p.x - d.x) / ds * 420 * dt; d.y += (p.y - d.y) / ds * 420 * dt; }
    if (ds > p.r + 12) continue;
    if (d.kind === 'gold') { p.gold += d.amt; d.dead = true; SND.coin(); if (p.gold >= 150 && p.run) tip('gold', '金幣先存著：完成遠征回到營地，可以找商人買東西、強化裝備'); floatText(p.x, p.y, '+' + d.amt, '#ffd84a', 12); }
    else if (d.kind === 'bone' || d.kind === 'cry') { p.mats[d.kind] += d.amt; if (p.run) p.run[d.kind] = (p.run[d.kind] || 0) + d.amt; d.dead = true; sfx(d.kind === 'cry' ? 1500 : 700, 0.06, 'triangle', 0.03); floatText(p.x, p.y, `+${d.amt} ${d.kind === 'cry' ? '💎' : '🦴'}`, d.kind === 'cry' ? '#ff9a5a' : '#e8e2d0', 13); if (d.kind === 'cry') tip('mats', '💎 餘燼結晶和 🦴 骨片是蓋營地建築的材料'); }
    else if (d.kind === 'hp') { if (p.hpPot < 9) { p.hpPot++; d.dead = true; sfx(800, 0.08, 'sine', 0.04); } }
    else if (d.kind === 'mp') { if (p.mpPot < 9) { p.mpPot++; d.dead = true; sfx(800, 0.08, 'sine', 0.04); } }
    else if (p.inv.length < invCap()) { p.inv.push(d.it); d.dead = true; if (p.run) p.run.items++; addCodex(d.it); if (d.it.rarity >= 3) { SND.shrine(); burst(p.x, p.y, '#ff9a3a', 30, 140, 0.8, 1, 6); } floatText(p.x, p.y, d.it.name, RAR[d.it.rarity].c, 14); tip('item', '撿到裝備了！點 🎒 打開背包，有 ▲ 的比身上的好'); sfx(700, 0.1, 'triangle', 0.05, 200); }
    else if (fullMsgT <= 0) { fullMsgT = 1.5; floatText(p.x, p.y, '背包滿了', '#f77', 13); tip('full', '背包滿了：遠征中不能賣，可以在背包把用不到的「丟掉」，或回營地賣掉；倉庫能擴充背包'); }
  }
  drops = drops.filter(d => { if (d.dead) killVis(d); return !d.dead; });

  for (const q of parts) { q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt; q.vh -= q.g * dt; if (q.h < 0.05) { q.h = 0.05; q.vh = 0; q.vx *= 0.8; q.vy *= 0.8; } q.vx *= 0.95; q.vy *= 0.95; }
  parts = parts.filter(q => q.t > 0);
  if (parts.length > 700) parts.splice(0, parts.length - 700);
  for (const t of texts) t.t -= dt;
  texts = texts.filter(t => t.t > 0);
  shake = Math.max(0, shake - dt * 30);
  const am = stairs.open && dist(stairs, p) < 44 ? (stairs.portal ? 'portal' : 'stairs') : merchant && dist(merchant, p) < 62 ? 'shop' : board && !p.run && dist(board, p) < 66 ? 'board' : campFire && !p.run && dist(campFire, p) < 70 ? 'fire' : range && !p.run && dist(range, p) < 60 ? 'range' : prisoner && !prisoner.freed && dist(prisoner, p) < 60 ? 'free' : pickNear ? 'pick' : (campBlds.find(d => dist(d, p) < 62) || {}).k || (!p.run && (extraChars.find(c => c.ref && c.ref.camp && c.ref.who.cls && Math.hypot(c.x - p.x, c.y - p.y) < 60) || {}).ref?.who.cls && 'hero:' + extraChars.find(c => c.ref && c.ref.camp && c.ref.who.cls && Math.hypot(c.x - p.x, c.y - p.y) < 60).ref.who.cls) || null;
  if (am !== actMode || (am === 'pick' && $('act').dataset.pid !== String(pickNear.it.id))) { actMode = am; if (am === 'pick') $('act').dataset.pid = pickNear.it.id; const el = $('act'); el.style.display = am ? 'block' : 'none'; if (am) el.textContent = { stairs: '⬇️ 往下一層', shop: '🛒 跟商人交易', board: '📜 挑選遠征', fire: '🔥 篝火：火光與腳印', range: '🎯 射擊靶場（第一人稱）', portal: '🔥 回到營地（結算）', free: '🔓 救出' + (prisoner ? prisoner.who.n : ''), pick: pickNear ? '🫳 撿起 ' + pickNear.it.name : '' }[am] || (am.startsWith('hero:') ? `🔁 換${CLS[am.slice(5)].n}出征` : `${BLD[am].i} ${BLD[am].n}${bl(am) ? ' Lv ' + bl(am) : '（建造）'}`); }
  for (const c of extraChars) if (c.ref && c.ref.camp && (c.talkT -= dt) <= 0 && Math.hypot(c.x - p.x, c.y - p.y) < 70) { c.talkT = 8; floatText(c.x, c.y, c.ref.who.b && !bl(c.ref.who.b) ? c.ref.who.ask : c.ref.who.line, '#ffe9b0', 13); }

  // 競技場封門與解鎖
  const inRect = (r, x, y, m) => x >= (r.x + m) * T && x < (r.x + r.w - m) * T && y >= (r.y + m) * T && y < (r.y + r.h - m) * T;
  if (!lockRoom) {
    for (const r of rooms) if (r.arena && !r.cleared && r.gates.length && inRect(r, p.x, p.y, 1.2)) {
      let n = 0, bossIn = false; for (const e of enemies) if (inRect(r, e.x, e.y, 0)) { n++; if (e.type === 'boss' || e.key) bossIn = true; }
      if (n >= 3 || bossIn) { lockRoom = r; for (const g of r.gates) gate[g] = 1; gateFx(r, true); banner('', '⚔️ 門被封住了，清光這個房間'); sfx(110, 0.5, 'sawtooth', 0.09, -50); noise(0.4, 0.1, 600); shake = 6; tip('arena', '有些房間會封門：打倒裡面所有敵人才會打開，清完有獎勵'); }
      else if (n === 0 && !props.some(o => o.vault && !o.open && inRect(r, o.x, o.y, 0))) r.cleared = true;
    }
  } else {
    let n = 0; for (const e of enemies) if (inRect(lockRoom, e.x, e.y, 0)) n++;
    if (n === 0 || !inRect(lockRoom, p.x, p.y, -0.5)) {
      const r = lockRoom; for (const g of r.gates) gate[g] = 0; gateFx(r, false); r.cleared = true; lockRoom = null;
      if (n === 0) { const cx = (r.x + r.w / 2) * T, cy = (r.y + r.h / 2) * T; banner('', '✅ 房間淨空'); SND.shrine(); fxRing(p.x, p.y, 130, 0xffe080, 0.6); drops.push(mk('hp', cx, cy)); for (let i = 0; i < 4; i++) dropGold(cx + rand(-30, 30), cy + rand(-30, 30), irand(5, 10) * (1 + p.floor * 0.1)); if (p.burnT <= 0) p.ember = Math.min(100, p.ember + 20); }
    }
  }
  if (p.run && !stairs.open && !boss && !prisoner && dist(stairs, p) < 120) tip('key', '樓梯被封印了：打倒 🔑 鑰匙守衛（小地圖上的紫點）才能往下');
  if (p.dashT > 0 && setN('ash') >= 3 && (p.ashT -= dt) <= 0) { p.ashT = 0.05; pools.push({ x: p.x, y: p.y, t: 3, tick: 0.15, R: 34, l: 2 }); }
  if (p.burnT > 0 && setN('core') >= 3 && (p.coreT = (p.coreT || 0) - dt) <= 0) { p.coreT = 0.6; blast(p.x, p.y, 115, 0.55, 0xff5a20, 0.25, true); }
  for (const hz of holes) { hz.t -= dt; const tk = (hz.tick -= dt) <= 0; if (tk) hz.tick = 0.35;
    for (let i = 0; i < 3; i++) { const b = rand(0, 6.283), r0 = rand(60, 150); parts.push(mkPart(hz.x + Math.cos(b) * r0, hz.y + Math.sin(b) * r0, rand(0.3, 2), -Math.cos(b) * r0 * 2.2, -Math.sin(b) * r0 * 2.2, 0, Math.random() < 0.5 ? '#c080ff' : '#5a2aa0', 0.45, rand(4, 8), 0)); }
    for (const e of enemies) { if (e.dead) continue; const dx = hz.x - e.x, dy = hz.y - e.y, dd = Math.hypot(dx, dy); if (dd > 170) continue; if (e.type !== 'boss' && !e.fixed && dd > 6) { const m = Math.min(dd, 240 * dt), nx = e.x + dx / dd * m, ny = e.y + dy / dd * m; if (!circleHits(nx, ny, e.r)) { e.x = nx; e.y = ny; } } if (tk) hitEnemy(e, 0.35, 0, hz, { noProc: true }); } }
  holes = holes.filter(hz => hz.t > 0);
  p.thornCd -= dt; p.trapCd -= dt; if (p.hasteT > 0) p.hasteT -= dt; if (p.iceT > 0) p.iceT -= dt;
  if (p.hitChainT > 0 && (p.hitChainT -= dt) <= 0) p.hitChain = 0;
  if (p.spentT > 0) p.spentT -= dt;
  if (p.burnT <= 0 && (p.emberT -= dt) <= 0) p.ember = Math.max(0, p.ember - 4 * dt);
  if (p.burnT > 0 && p.burnT - dt <= 0) { p.spentT = 4; floatText(p.x, p.y, '火把燒盡，暫時虛弱', '#a98', 14); sfx(200, 0.5, 'sawtooth', 0.06, -150); }
  if (p.slowT > 0) p.slowT -= dt;
  if (p.burnT > 0) { p.burnT -= dt; for (let i = 0; i < 2; i++) parts.push(mkPart(p.x + rand(-12, 12), p.y + rand(-12, 12), rand(0.2, 2), rand(-10, 10), rand(-10, 10), rand(3, 7), Math.random() < 0.5 ? '#ffb040' : '#ff5a20', rand(0.3, 0.6), rand(4, 8), -2)); }
  for (const t of totems) {
    t.t -= dt;
    if ((t.cd -= dt) <= 0) { let best = null, bd = 320; for (const e of enemies) { const d = dist(e, t); if (d < bd && los(t, e)) { bd = d; best = e; } } if (best) { t.cd = 0.55; pshot(t.x, t.y, Math.atan2(best.y - t.y, best.x - t.x), 480, { mult: (0.5 + t.l * 0.12) * sm('totem'), kb: 50, col: '#ff8a2a', r: 6, life: 0.8 }); sfx(520, 0.07, 'square', 0.025, 200); } else t.cd = 0.2; }
    if (t.t <= 0) { killVis(t); burst(t.x, t.y, '#ff9a3a', 14, 100, 0.5, 1, 4); }
  }
  totems = totems.filter(t => t.t > 0);
  for (const q of pools) {
    q.t -= dt; parts.push(mkPart(q.x + rand(-q.R, q.R) * 0.7, q.y + rand(-q.R, q.R) * 0.7, 0.2, 0, 0, rand(2, 5), q.bog ? (Math.random() < 0.5 ? '#6adf5a' : '#2f8a3a') : Math.random() < 0.5 ? '#ff8a2a' : '#ffd040', rand(0.3, 0.6), rand(4, 8), -1));
    if ((q.tick -= dt) <= 0) { q.tick = 0.4; for (const e of enemies) if (!e.dead && dist(e, q) < q.R + e.r) { if (q.bog) e.slow = Math.max(e.slow || 0, 0.8); hitEnemy(e, (0.3 + q.l * 0.06) * (q.bog ? 1 : sm('fire')), 0, q, { noProc: true }); } }
  }
  pools = pools.filter(q => q.t > 0);
  if (setN('bog') >= 3 && pools.some(q => q.bog && dist(q, p) < q.R)) p.hp = Math.min(p.st.hp, p.hp + p.st.hp * 0.03 * dt);
  for (const d of dangers) if ((d.t -= dt) <= 0) { burst(d.x, d.y, '#ff4020', 30, 220, 0.6, 1, 6); fxFlash(d.x, d.y, 0xff4020, 0.25); SND.boom(0.8); shake = Math.max(shake, 6); if (dist(d, p) < d.R) hurtPlayer(d.dmg); }
  dangers = dangers.filter(d => d.t > 0);
  if (p.streakT > 0 && (p.streakT -= dt) <= 0) p.streak = 0;
  if (p.buff && (p.buff.t -= dt) <= 0) { p.buff = null; refresh(); floatText(p.x, p.y, '祝福消失了', '#aaa', 13); }
  if (p.run && !fps && !cine) torchTick(dt);
  if (shrine && !shrine.used && dist(shrine, p) < 220) tip('shrine', '碰一下發光的祭壇，可以得到 45 秒祝福');
  if (shrine && !shrine.used && dist(shrine, p) < 48) useShrine();
  for (let i = booms.length - 1; i >= 0; i--) { const b = booms[i]; if ((b.t -= dt) <= 0) { booms.splice(i, 1); blast(b.x, b.y, b.R || 85, b.mult || 0.8, b.color || 0x9955ff, 0.35, true); } }
  const ptx = Math.floor(p.x / T), pty = Math.floor(p.y / T);
  for (const t of traps) {
    const up = (time + t.ph) % 2.6 > 1.75;
    if (Math.abs(t.tx - ptx) + Math.abs(t.ty - pty) < 4) tip('trap', '地上的鐵板是尖刺陷阱，等刺縮回去再走，或用閃避衝過去');
    if (up && !t.up && Math.abs(t.tx - ptx) + Math.abs(t.ty - pty) < 7) SND.spike();
    t.up = up;
    if (up && t.tx === ptx && t.ty === pty && p.trapCd <= 0 && p.dashT <= 0) { p.trapCd = 0.9; hurtPlayer(14 * (1 + 0.26 * (p.floor - 1)) * (ncv('trap') ? 0.5 : 1)); }
  }
  // 音樂強度跟著附近醒著的敵人數量走
  let near = 0; for (const e of enemies) if (e.awake && dist(e, p) < 450) near++;
  musicTarget = (boss && boss.awake) || p.burnT > 0 ? 1 : Math.min(0.8, near * 0.2);
  intensity += (musicTarget - intensity) * Math.min(1, dt * 0.9);
}
function descend() {
  if (state !== 'play' || !stairs.open || stairs.portal || !p.run || dist(stairs, p) > 44) return;
  p.run.depth++; sfx(300, 0.3, 'triangle', 0.06, -150);
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
// 注意：場景裡燈的數量一變，所有材質都要重新編譯，畫面會頓一下。所以戰鬥中用到的燈都在這裡先建好，平常亮度 0，要用時才點亮
const crystalLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xff8a3a, 0, 12, 1.6); scene.add(l); return l; });
scene.add(camera);
const camFlash = new THREE.PointLight(0xffc070, 0, 12, 2); camFlash.position.set(0.3, -0.2, -1.2); camera.add(camFlash);
const rangeLamp = new THREE.PointLight(0xffb070, 0, 70, 1.1); scene.add(rangeLamp);

// 視角：yaw 是鏡頭繞垂直軸的角度（0 = 從南邊往北看），pitch 是俯角
const CAMS = [
  { name: '斜角', yaw: Math.PI / 4, pitch: 45, dist: 39 },
  { name: '正面', yaw: 0, pitch: 47, dist: 42 },
  { name: '貼近', yaw: Math.PI / 4, pitch: 38, dist: 30 },
  { name: '俯瞰', yaw: 0, pitch: 66, dist: 52 },
];
let camMode = 0, camReady = false, punch = 0;
const camTgt = new THREE.Vector3(), camOff = new THREE.Vector3(), camCur = { yaw: Math.PI / 4, pitch: 45, dist: 39 };

const A = {}; // 載入的模型
const loader = new GLTFLoader();
const ASSETS = ['knight', 'skel_warrior', 'skel_mage', 'skel_minion', 'skel_rogue', 'w_blade', 'w_axe', 'w_staff', 'w_crossbow', 'w_shield_large_a',
  'wall', 'wall_cracked', 'floor_tile_large', 'floor_tile_large_rocks', 'floor_dirt_large', 'floor_dirt_large_rocky', 'floor_tile_big_grate_open',
  'torch_mounted', 'barrel_large', 'box_large', 'banner_patternA_red', 'banner_patternB_blue', 'banner_shield_green', 'coin', 'bottle_A_labeled_green',
  'npc', 'h_rogue', 'h_mage', 'h_barb', 'chest', 'chest_gold', 'pillar', 'sword_shield', 'rubble_half', 'trunk_large_A', 'shelf_small_candles', 'coin_stack_small', 'coin_stack_medium', 'coin_stack_large', 'h_sword_2handed', 'h_axe_1handed', 'h_dagger', 'h_crossbow', 'h_staff',
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
  minion: ['skel_minion', 1], imp: ['skel_minion', 0.68, 0x8fe07a], archer: ['skel_rogue', 1, 0xffa890], brute: ['skel_warrior', 1.22, 0x9fb4e0],
  shaman: ['skel_mage', 1, 0xc49cff], boss: ['skel_warrior', 2.0, 0xff9a80],
};
function ensureVis(e) {
  if (e.v) return e.v;
  if (e.type === 'crystal') {
    const g = new THREE.Group(), m = new THREE.Mesh(cryGeo, crystalMat), l = crystalLights.find(l => !l.userData.used);
    m.scale.set(0.9, 1.6, 0.9); m.position.y = 1.7; g.add(m); g.position.set(e.x * U, 0, e.y * U); ents.add(g);
    if (l) { l.userData.used = true; l.intensity = 22; l.position.set(e.x * U, 1.7, e.y * U); }
    const f = { root: g, gem: m, lock: 0, px: e.x, py: e.y, base: 0, baseK: 0, mixer: { update() {} }, once() {}, play() {}, emissive() {}, dispose() { g.removeFromParent(); if (l) { l.intensity = 0; l.userData.used = false; } } };
    e.v = f; return f;
  }
  const [model, sc, tint0] = VIS[e.type], tint = e.tint || tint0;
  const c = new Char(model, CLIPS.skel, tint); c.base = e.elite ? 0x553300 : e.type === 'boss' ? 0x330800 : 0x000000; c.baseK = e.elite || e.type === 'boss' ? 1 : 0;
  c.root.scale.setScalar(sc * (e.elite ? 1.22 : 1));
  if (e.type === 'archer') c.hold('handslotr', 'w_crossbow');
  if (e.type === 'shaman') c.hold('handslotr', 'w_staff');
  if (e.type === 'brute') { c.hold('handslotr', 'w_axe'); c.hold('handslotl', 'w_shield_large_a'); }
  if (e.type === 'boss') { c.hold('handslotr', 'w_blade', 1.2); c.hold('handslotl', 'w_shield_large_a', 1.1); }
  c.emissive(c.base, c.baseK);
  c.root.position.set(e.x * U, 0, e.y * U); c.root.rotation.y = Math.PI / 2 - e.face; c.px = e.x; c.py = e.y;
  if (e.summoned || e.rise) c.once('Spawn_Ground_Skeletons', e.rise ? 1.5 : 2.2); else c.play('Idle');
  const rc = e.key ? 0xff50e0 : e.elite ? 0xffc040 : e.type === 'archer' ? 0xff6a40 : e.type === 'shaman' ? 0xb070ff : 0; // 腳下的圈：遠程怪一眼認得出來
  if (rc) { const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: rc, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); ring.scale.setScalar(e.r * U * 1.2 / c.root.scale.x); ring.position.y = 0.08; c.root.add(ring); c.ring = ring; }
  ents.add(c.root); e.v = c; return c;
}
// 主角手上的武器與盾牌跟著裝備換
const WMODEL = { '手弩': 'h_crossbow', '法杖': 'h_staff', '短劍': 'h_dagger', '戰斧': 'h_axe_1handed', '巨劍': 'h_sword_2handed', '釘錘': 'h_axe_1handed', '彎刀': 'w_blade' };
const SHIELDS = ['h_shield_round', null, 'h_shield_square', 'h_shield_spikes', 'h_shield_spikes'];
function heroLook() {
  if (!hero) return;
  for (const o of hero.gear || []) o.dispose(); hero.gear = [];
  const sw = hero.root.getObjectByName('1H_Sword'), sh = hero.root.getObjectByName('Badge_Shield'), w = p.equip.weapon, a = p.equip.armor;
  const put = (model, slot, it) => { const bone = hero.root.getObjectByName(slot); if (!bone) return; const k = it.heat || 0, o = tintClone(model, 1, k ? HEATC[k] : colOf(RAR[it.rarity].c).getHex(), k ? HEATK[k] : it.rarity * 0.2); bone.add(o); hero.gear.push(o); };
  const wm = w && WMODEL[w.kind], sm = a && SHIELDS[a.rarity];
  if (sw) sw.visible = !!w && !wm; if (sh) sh.visible = !!a && !sm;
  if (wm) put(wm, 'handslotr', w); if (sm) put(sm, 'handslotl', a);
  const tintPart = (re, it, k0) => hero.root.traverse(m => { if (!m.isMesh || !(re.test(m.name) || re.test(m.parent && m.parent.name))) return; if (!m.userData.tm) { m.material = m.material.clone(); m.userData.tm = true; } const hk = it ? it.heat || 0 : 0; m.material.emissive.setHex(!it ? 0 : hk ? HEATC[hk] : colOf(icol(it)).getHex()); m.material.emissiveIntensity = !it ? 0 : (hk ? HEATK[hk] * 0.6 : 0.12 + it.rarity * 0.1) * k0; });
  hero.root.traverse(m => { if (/Helmet|_Hat/.test(m.name)) m.visible = !!p.equip.helm; }); /* 有戴頭盔才看得到帽子 */
  tintPart(/Helmet|_Hat|Rogue_Head/, p.equip.helm, 1); tintPart(/LegLeft|LegRight/, p.equip.boots, 1); tintPart(/_Body/, p.equip.armor, 0.7);
  hero.hand = hero.root.getObjectByName('handslotr'); hero.glow = w && (w.heat || 0) >= 3 ? '#' + HEATC[w.heat].toString(16).padStart(6, '0') : w && w.rarity >= 3 ? RAR[w.rarity].c : null; hero.glowN = w ? Math.max(1, (w.heat || 0) - 1) : 1;
}
const gateGeo = new THREE.BoxGeometry(4, 3.2, 4), gateMat = new THREE.MeshBasicMaterial({ color: 0xff3a20, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
function gateFx(r, on) {
  if (r.gfx) { for (const m of r.gfx) m.removeFromParent(); r.gfx = null; }
  if (on) r.gfx = r.gates.map(g => { const m = new THREE.Mesh(gateGeo, gateMat); m.position.set((g % MW) * 4 + 2, 1.6, Math.floor(g / MW) * 4 + 2); lvl.add(m); return m; });
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
  if (cine) endCine();
  for (const t of totems) killVis(t); totems = [];
  for (const e of enemies) killVis(e); for (const s of shots) killVis(s); for (const d of drops) killVis(d); for (const o of props) killVis(o);
  for (const c of corpses) c.c.dispose(); corpses = [];
  for (const c of extraChars) c.dispose(); extraChars = [];
  for (const r of rings) r.visible = false; for (const s of slashes) s.visible = false; for (const t of teles) t.visible = false; for (const w of whirlFx) w.visible = false;
  for (const o of [...ents.children]) if (o !== (hero && hero.root) && o !== (npc && npc.root)) o.removeFromParent();
  if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; } // 陰影貼圖重算，不留上一層的影子
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
  if (npc) { npc.dispose(); npc = null; }
  if (merchant) { npc = new Char('npc', CLIPS.knight); npc.root.position.set(merchant.x * U, 0, merchant.y * U); npc.play('Idle'); ents.add(npc.root); }
  for (const d of decos) { if (!d.model) continue; const o = kitClone(d.model, d.s); o.position.set(d.x * U, 0, d.y * U); o.rotation.y = d.rot; lvl.add(o); }
  for (const d of fluff) { const o = kitClone(d.model, d.s); o.position.set(d.x * U, d.h || 0, d.y * U); o.rotation.y = d.rot; lvl.add(o); }
  shrineFx = null;
  if (shrine) { // 祭壇：石柱上浮著一顆光球
    const col = BUFFS[shrine.kind][3], orb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: col }));
    orb.position.set(shrine.x * U, 3, shrine.y * U); orb.userData.own = true; lvl.add(orb);
    const l = new THREE.PointLight(col, 40, 18, 1.6); l.position.copy(orb.position); lvl.add(l); shrineFx = { orb, l };
  }
  for (const b of braziers) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 10), new THREE.MeshBasicMaterial({ color: 0x3a2014 })); m.position.set(b.x * U, 2.05, b.y * U); m.userData.own = true; lvl.add(m); b.m = m; if (b.lit) m.material.color.setHex(0xff8a30); }
  trapFx = null;
  if (traps.length) { // 尖刺陷阱：一塊鐵板加九根會升降的刺
    const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(3.5, 0.08, 3.5), new THREE.MeshStandardMaterial({ color: 0x6a5a58, metalness: 0.1, roughness: 0.8, emissive: ncv('trap') ? 0xc01808 : 0, emissiveIntensity: 0.9 }), traps.length);
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
  vertexShader: 'attribute float size; attribute vec4 pcolor; varying vec4 vC; uniform float scale; void main(){ vC=pcolor; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=min(size*scale/(-mv.z),90.); gl_Position=projectionMatrix*mv; }',
  fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.05,d)*vC.a; gl_FragColor=vec4(vC.rgb*a,a); }',
});
const pPoints = new THREE.Points(pGeo, pMat); pPoints.frustumCulled = false; scene.add(pPoints);
const colCache = {}; const colOf = c => colCache[c] || (colCache[c] = new THREE.Color(c));

const cryGeo = new THREE.OctahedronGeometry(1), cryMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a }), crystalMat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
const bubbleGeo = new THREE.SphereGeometry(1, 24, 16), bubbleMat = new THREE.MeshBasicMaterial({ color: 0x60d8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
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
const viewFov = () => { camera.fov = W < H ? 50 : 34; camera.far = 220; camera.updateProjectionMatrix(); renderer.shadowMap.autoUpdate = true; };
function resize() {
  W = innerWidth; H = innerHeight;
  const k = Math.min(window.devicePixelRatio || 1, 2); ov.width = W * k; ov.height = H * k;
  camera.aspect = W / H; camera.fov = W < H ? 50 : 34; camera.updateProjectionMatrix();
  applyQuality();
}

function render3d(dt) {
  // --- 鏡頭 ---
  const cm = CAMS[camMode], kk = camReady ? 1 - Math.pow(0.002, dt) : 1, bf = cine ? cine.e : boss && boss.awake && !boss.dead && dist(boss, p) < 600 ? boss : null;
  camCur.yaw += (cm.yaw - camCur.yaw) * kk; camCur.pitch += ((cine ? 24 : bf ? cm.pitch - 12 : cm.pitch) - camCur.pitch) * kk;
  let D = cine ? 17 : bf ? cm.dist * 0.75 + clamp(dist(bf, p) * U * 0.4, 0, 14) : cm.dist; const halfW = Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
  if (camera.aspect < 1) D = Math.max(D * 0.8, 7.5 / halfW * (cm.dist / 39)); // 直式螢幕拉遠一點，左右才看得到
  camCur.dist += (D - camCur.dist) * kk;
  const pr = camCur.pitch * Math.PI / 180;
  camOff.set(Math.sin(camCur.yaw) * Math.cos(pr), Math.sin(pr), Math.cos(camCur.yaw) * Math.cos(pr)).multiplyScalar(camCur.dist);
  const lead = touchMode ? 0 : 1.6; // 稍微往瞄準方向偏，前方看得比較遠
  v3.set(p.x * U + Math.cos(p.aim) * lead, 1.2, p.y * U + Math.sin(p.aim) * lead);
  if (cine) v3.set(cine.e.x * U, 2.6, cine.e.y * U); else if (bf) v3.lerp(new THREE.Vector3(bf.x * U, 1.6, bf.y * U), 0.35);
  if (!camReady) { camTgt.copy(v3); camReady = true; } else camTgt.lerp(v3, 1 - Math.pow(0.0005, dt));
  if (punch > 0) { punch -= dt; camOff.multiplyScalar(1 - Math.max(0, punch) * 0.9); }
  camera.position.copy(camTgt).add(camOff);
  if (shake > 0) { camera.position.x += rand(-1, 1) * shake * 0.035; camera.position.y += rand(-1, 1) * shake * 0.035; }
  camera.lookAt(camTgt);
  scene.fog.near = camCur.dist + 6; scene.fog.far = camCur.dist + 52;
  if (fps) fpsCam();

  // --- 燈光 ---
  const fl = 1 + Math.sin(time * 11) * 0.06 + Math.sin(time * 27) * 0.04;
  torch.position.set(p.x * U, 4.6, p.y * U); const ek = p.spentT > 0 ? 0 : p.ember / 100;
  torch.intensity = (44 + 34 * ek) * fl * (p.burnT > 0 ? 2.4 : p.spentT > 0 ? 0.55 : 1); torch.distance = (p.burnT > 0 ? 44 : 25 + 12 * ek) * (rmod('dark') ? 0.7 : 1) * (1 + ncv('light') / 100); if (rmod('dark')) torch.intensity *= 0.6; torch.intensity *= 1 + ncv('light') / 200; torch.color.setHex(p.burnT > 0 ? 0xff7030 : LIGHTS[(p.cos && p.cos.light) || 'orange'][1]);
  if (p.run && !fps) { const tf = torchF(); torch.intensity *= 0.3 + 0.7 * tf; torch.distance *= 0.55 + 0.45 * tf; if (tf <= 0) torch.intensity *= 0.75 + Math.sin(time * 5) * 0.25; } { const tf = p.run && !fps ? torchF() : 1; hemi.intensity = 0.62 * (0.4 + 0.6 * tf); moon.intensity = 0.9 * (0.35 + 0.65 * tf); }
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
  gateMat.opacity = 0.26 + Math.sin(time * 6) * 0.08;
  stairFx.beam.visible = stairs.open; stairFx.sl.intensity = stairs.open ? 30 : 0; /* 燈不切換顯示，只調亮度，避免重新編譯 */ stairFx.beam.material.opacity = 0.14 + Math.sin(time * 3) * 0.05;

  // --- 主角 ---
  if (!hero) { hero = new Char(clsOf().model, CLIPS.knight); ents.add(hero.root); hero.face = 0; heroLook(); }
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
  hero.root.rotation.y = Math.PI / 2 - hero.face; hero.root.visible = !fps;
  hero.emissive(p.hurtT > 0 ? 0xff2020 : p.burnT > 0 ? 0xff5a10 : 0x000000, p.hurtT > 0 ? 0.8 : p.burnT > 0 ? 0.45 + Math.sin(time * 12) * 0.15 : 0);
  hero.mixer.update(dt);
  if (hero.glow && hero.hand && dt > 0 && !fps) for (let i = 0; i < hero.glowN; i++) { v3.set(0, rand(0.3, 1.2), 0); hero.hand.localToWorld(v3); parts.push(mkPart(v3.x / U, v3.z / U, v3.y, rand(-10, 10), rand(-10, 10), rand(0.4, 1.5), hero.glow, 0.4, rand(3.5, 6), -0.5)); } // 高熱度的武器拖火尾
  if (dt > 0 && !fps && p.st.mpr > 3.5 && Math.random() < (p.st.mpr - 3) * 0.06) { const a = rand(0, 6.28); parts.push(mkPart(p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18, rand(0.5, 2), -Math.sin(a) * 40, Math.cos(a) * 40, 0.8, '#6ab8ff', 0.7, 3.5)); } // 回魔：藍色光點
  if (campFire && campFire.light) { campFire.light.intensity = 100 + Math.sin(time * 9) * 14 + Math.sin(time * 23) * 8; if (dt > 0) for (let i = 0; i < 2; i++) parts.push(mkPart(campFire.x + rand(-14, 14), campFire.y + rand(-14, 14), rand(0.3, 1), rand(-8, 8), rand(-8, 8), rand(3, 6), Math.random() < 0.5 ? '#ffb040' : '#ff5a20', rand(0.4, 0.8), rand(5, 10), -2)); }
  for (const c of extraChars) { c.mixer.update(dt); if (c.ref && !c.ref.freed) { const a = Math.atan2(p.y - c.y, p.x - c.x); c.root.rotation.y += angDiff(Math.PI / 2 - a, c.root.rotation.y) * Math.min(1, dt * 3); } }
  if (npc) { const a = Math.atan2(p.y - merchant.y, p.x - merchant.x); npc.root.rotation.y += angDiff(Math.PI / 2 - a, npc.root.rotation.y) * Math.min(1, dt * 4); npc.mixer.update(dt); }
  whirlFx.forEach((w, i) => { w.visible = p.whirlT > 0; if (w.visible) { w.position.set(p.x * U, 1.2, p.y * U); w.rotation.y = -time * 20 + i * Math.PI; w.material.uniforms.k.value = 0.5; } });

  // --- 敵人 ---
  for (const e of enemies) {
    const d = Math.hypot(e.x - camTgt.x / U, e.y - camTgt.z / U);
    if (d > 420) { if (e.v) e.v.root.visible = false; continue; }
    const c = ensureVis(e); c.root.visible = true;
    if (c.gem) { c.gem.rotation.y += dt * 2; c.gem.position.y = 1.7 + Math.sin(time * 3 + e.ph) * 0.25; continue; }
    if (e.type === 'boss') { if (!c.bubble) { c.bubble = new THREE.Mesh(bubbleGeo, bubbleMat); c.bubble.position.y = 1.4; c.bubble.scale.setScalar(1.6); c.root.add(c.bubble); } c.bubble.visible = !!e.shield; if (e.shield) c.bubble.scale.setScalar(1.6 + Math.sin(time * 6) * 0.05); }
    const sp = Math.hypot(e.x - c.px, e.y - c.py) / Math.max(dt, 0.001); c.px = e.x; c.py = e.y;
    c.root.position.set(e.x * U, 0, e.y * U);
    c.root.rotation.y += angDiff(Math.PI / 2 - e.face, c.root.rotation.y) * (1 - Math.pow(1e-5, dt));
    c.lock -= dt;
    if (e.freeze > 0) c.emissive(0x2050c0, 0.55); else if (e.wardT > 0 || e.shield) c.emissive(0x30e0ff, 1.1); else if (e.broken > 0) c.emissive(0xff8a20, 0.8 + Math.sin(time * 20) * 0.4); else if (e.flash > 0) c.emissive(0xffffff, 0.9); else c.emissive(c.base, c.baseK);
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
      else if (d.kind === 'bone') d.v = tintClone('coin', 1.7, 0xfff4e0, 0.7);
      else if (d.kind === 'cry') { d.v = new THREE.Mesh(cryGeo, cryMat); d.v.scale.setScalar(0.45); }
      else if (d.kind === 'hp' || d.kind === 'mp') d.v = tintClone('bottle_A_labeled_green', 1.5, d.kind === 'hp' ? 0xff1010 : 0x1060ff, 1.6);
      else {
        d.v = tintClone(d.it.slot === 'weapon' ? 'w_blade' : d.it.slot === 'ring' ? 'coin_stack_small' : 'w_shield_large_a', d.it.slot === 'ring' ? 1.6 : d.it.slot === 'armor' ? 1.1 : 0.8, colOf(icol(d.it)).getHex(), 0.35);
        if (d.it.slot !== 'ring') d.v.children.forEach(c => { c.rotation.x = Math.PI / 2 - 0.2; c.position.y = 0.35; });
        const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: icol(d.it), transparent: true, opacity: 0.14 + d.it.rarity * 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        const sy = 0.35 + d.it.rarity * 0.15; b.scale.set(1 + d.it.rarity * 0.5, sy, 1 + d.it.rarity * 0.5); b.position.y = 4 * sy; b.userData.ownMat = true; d.v.add(b);
      }
      scene.add(d.v); d.sp = rand(0, 6);
    }
    const hop = d.t < 0.3 ? Math.sin(d.t / 0.3 * Math.PI) * 1.5 : 0;
    d.v.position.set(d.x * U, (d.kind === 'gold' || d.kind === 'bone' ? 0.5 : d.kind === 'cry' ? 0.9 : 0.1) + hop + (d.kind === 'item' ? 0 : Math.sin(time * 4 + d.sp) * 0.12), d.y * U);
    if (d.kind === 'cry') d.v.rotation.y = time * 3 + d.sp;
    if (d.kind === 'gold' || d.kind === 'bone') { d.v.rotation.z = Math.PI / 2; d.v.rotation.y = time * 4 + d.sp; }
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
    if (e.elite) { c.font = '12px sans-serif'; c.fillStyle = '#ffd84a'; c.strokeStyle = '#000'; c.lineWidth = 3; const nm = `${e.key ? '🔑 鑰匙守衛' : '菁英 ' + ET[e.type].n}〔${TRAITN[e.trait] || ''}〕`; c.strokeText(nm, x, y - 5); c.fillText(nm, x, y - 5); }
  }
  const label = (x0, y0, h, txt, col) => { if (fps) return; const [x, y, ok] = project(x0, h, y0); if (ok && x > -60 && x < W + 60) { c.font = '13px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText(txt, x, y); c.fillStyle = col; c.fillText(txt, x, y); } };
  if (board && !p.run) { const gift = p.daily && p.daily.list.some(b => b.done && !b.claimed), wk = p.clears && (!p.weekly || !p.weekly.best); label(board.x, board.y, 2.6, `📜 告示板${gift ? ' 🎁 懸賞可領' : wk ? ' 🌀 每週挑戰' : ''}`, gift ? '#7dff8a' : '#ffe9b0'); }
  if (range && !p.run) label(range.x, range.y, 2.2, '🎯 靶場（實驗）', '#ffd890');
  if (campFire && !p.run) label(campFire.x, campFire.y, -0.6, '🔥 篝火', '#ffc890');
  for (const d of campBlds) { const B = BLD[d.k], L = bl(d.k), lock = B.need && !p.rescued.includes(B.need), can = canBuild(d.k); label(d.x, d.y, 2.4, `${can ? '❗' : ''}${lock ? '🔒' : B.i} ${B.n}${L ? ' Lv ' + L : lock ? '' : '（可建造）'}`, can ? '#7dff8a' : L ? '#ffd890' : '#aaa'); }
  for (const ch of extraChars) if (ch.ref) label(ch.x, ch.y, -0.4, ch.ref.camp ? ch.ref.who.n + (ch.ref.who.cls ? `（Lv ${(p.heroes[ch.ref.who.cls] || {}).lvl || '新'}）` : '') : ch.ref.freed ? '' : '⛓️ ' + ch.ref.who.n, '#ffd0a0');
  if (merchant && !fps) { const [x, y, ok] = project(merchant.x, 3.3, merchant.y); if (ok && x > -40 && x < W + 40) { c.font = '13px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText('💰 商人', x, y); c.fillStyle = '#ffe9b0'; c.fillText('💰 商人', x, y); } }
  c.font = '13px sans-serif';
  for (const d of drops) if (d.kind === 'item' && d.v) {
    const [x, y, ok] = project(d.x, 1.6, d.y); if (!ok || x < -50 || x > W + 50) continue;
    const w = c.measureText(d.it.name).width + 10; c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(x - w / 2, y - 14, w, 18);
    c.globalAlpha = skipPick(d) ? 0.45 : 1; c.fillStyle = RAR[d.it.rarity].c; c.fillText(d.it.name, x, y); c.globalAlpha = 1;
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
  if (ncv('seek')) for (const o of props) if (o.kind === 'chest' && !o.open) { mctx.fillStyle = o.vault ? '#fd4' : '#e9b040'; mctx.fillRect(Math.floor(o.x / T), Math.floor(o.y / T), 2, 2); }
  if (prisoner && !prisoner.freed) { mctx.fillStyle = '#ffe080'; mctx.fillRect(Math.floor(prisoner.x / T) - 1, Math.floor(prisoner.y / T) - 1, 3, 3); }
  if (stairs.open && explored[stairs.ty * MW + stairs.tx]) { mctx.fillStyle = '#ffcf6b'; mctx.fillRect(stairs.tx - 1, stairs.ty - 1, 2, 2); }
  for (const e of enemies) if (e.key) { mctx.fillStyle = '#f5e'; mctx.fillRect(Math.floor(e.x / T) - 1, Math.floor(e.y / T) - 1, 3, 3); }
  if (boss) { mctx.fillStyle = '#f44'; mctx.fillRect(Math.floor(boss.x / T) - 1, Math.floor(boss.y / T) - 1, 2, 2); }
  for (const b of braziers) if (explored[Math.floor(b.y / T) * MW + Math.floor(b.x / T)]) { mctx.fillStyle = b.lit ? '#a64' : '#fa3'; mctx.fillRect(Math.floor(b.x / T), Math.floor(b.y / T), 2, 2); }
  if (shrine && !shrine.used && explored[Math.floor(shrine.y / T) * MW + Math.floor(shrine.x / T)]) { mctx.fillStyle = '#5ef'; mctx.fillRect(Math.floor(shrine.x / T), Math.floor(shrine.y / T), 2, 2); }
  for (const o of props) if (o.vault && !o.open && explored[Math.floor(o.y / T) * MW + Math.floor(o.x / T)]) { mctx.fillStyle = '#fd4'; mctx.fillRect(Math.floor(o.x / T), Math.floor(o.y / T), 2, 2); }
  for (const d of campBlds) if (canBuild(d.k)) { mctx.fillStyle = '#7dff8a'; mctx.fillRect(Math.floor(d.x / T) - 1, Math.floor(d.y / T) - 1, 3, 3); } /* 可以蓋或升級的建築 */
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
  eb.lastElementChild.style.height = (p.burnT > 0 ? 100 - Math.min(100, p.burnT / 8 * 100) : 100 - p.ember) + '%'; eb.classList.toggle('ready', full); eb.classList.toggle('burning', p.burnT > 0);
  $('torchBar').style.display = p.run ? '' : 'none'; if (p.run) { const tf = torchF(); $('torchBar').firstElementChild.style.width = tf * 100 + '%'; $('torchBar').classList.toggle('low', tf < 0.2); }
  $('emberBar').firstElementChild.style.width = (p.burnT > 0 ? Math.min(100, p.burnT / 8 * 100) : p.ember) + '%'; $('emberBar').style.opacity = p.spentT > 0 ? 0.35 : 1;
  const bb = $('boss');
  if (boss && boss.awake) { bb.style.display = 'block'; $('bossName').textContent = boss.name; bb.querySelector('i').style.width = clamp(boss.hp / boss.maxHp * 100, 0, 100) + '%'; }
  else bb.style.display = 'none';
  if (++hudT % 10) return; // 其餘不常變的，每 10 幀更新一次
  let bt = ''; if (p.buff) { const b = BUFFS[p.buff.k]; bt = `${b[0]} ${b[1]} ${Math.ceil(p.buff.t)}s　`; } if (p.streak >= 3) bt += `🔥 連殺 ×${p.streak}`;
  $('buff').textContent = bt;
  $('fl').textContent = p.run ? (p.run.goal === 'endless' ? `每週挑戰 ${p.run.depth}` : `${mapName(p.run.tier)} ${p.run.depth}/${p.run.len}`) : '營地'; $('lv').textContent = p.lvl; $('gold').textContent = p.gold; $('bone').textContent = p.mats.bone; $('cry').textContent = p.mats.cry;
  setBar('xpBar', p.xp, xpNeed(p.lvl));
  $('sk-hp').children[1].textContent = p.hpPot; $('sk-mpp').children[1].textContent = p.mpPot;
  $('sk-hp').classList.toggle('nomp', !p.hpPot); $('sk-mpp').classList.toggle('nomp', !p.mpPot);
  $('bagBtn').classList.toggle('glow', talPts() > 0 || p.inv.some(it => upgradeOf(it) > 0.5));
}

let sel = null;
const shopK = () => 1 - Math.min(40, ncv('haggle')) / 100;
const potCost = () => Math.round((20 + p.floor * 5) * shopK());
const heatTag = it => { const k = it.heat || 0, col = '#' + (k ? HEATC[k] : 0x9a9aa8).toString(16).padStart(6, '0'); return `<span style="color:${col}">🔥${HEAT[k]} ${'▰'.repeat(k)}${'▱'.repeat(5 - k)}</span>`; };
function itemHtml(it) {
  let h = `<b style="color:${icol(it)}">${it.name}</b> <span class="dim">${it.set ? '套裝' : RAR[it.rarity].n}${SLOTS[it.slot].n}・Lv ${it.lvl}</span><br>`;
  h += heatTag(it) + ((it.heat || 0) < 5 ? `<span class="dim">　再戰鬥 ${HEATN[it.heat || 0] - (it.hx || 0)} 點升溫</span>` : '<span class="dim">　已達白熾</span>') + '<br>';
  if (it.slot === 'weapon') { const w = wtOf(it); h += `<span style="color:#e9c14a">${w.n}：${w.desc}</span><br>` + (inClass(it) ? `<span class="good">✓ ${clsOf().n}的本職武器</span><br>` : `<span class="bad">⚠ ${clsOf().n}不擅長${w.n}：傷害 -30%</span><br>`); }
  for (const k in it.base) h += fmt(k, iv(it, it.base[k])) + '<br>';
  for (const a of it.aff) h += `<span style="color:${a.ember ? '#ffb040' : '#9cf'}">${a.ember ? '🔥 ' : ''}${fmt(a.k, iv(it, a.v))}</span><br>`;
  if (it.nc && NC[it.nc.k]) h += `<span style="color:#7fe0c0">✦ ${NC[it.nc.k].n}：${NC[it.nc.k].d(it.nc.v)}</span><br>`;
  if (it.fx && LEGFX[it.fx]) h += `<span style="color:#ff8a3a">★ ${fxText(it)}</span><br>`;
  if (it.set) { const S = SETS[it.set], n = setN(it.set); h += `<span style="color:${S.c}">◆ ${S.n}（身上 ${n}/3）</span><br><span class="${n >= 2 ? 'good' : 'dim'}">　2 件：${S.b2}</span><br><span class="${n >= 3 ? 'good' : 'dim'}">　3 件：${S.b3}</span><br><span class="dim">　部位：${S.slots.map(q => SLOTS[q].n).join('、')}｜只有 ${BOSSN[S.boss]} 會掉</span><br>`; }
  return h;
}
function upgradeOf(it) { const eq = Object.assign({}, p.equip), cur = p.equip[it.slot]; eq[it.slot] = it; return power(calcStats(eq)) - power(p.st) + (it.fx || it.set ? 60 : 0) - (cur && (cur.fx || cur.set) ? 60 : 0); }
function drawPanel() {
  const st = p.st;
  $('eq').innerHTML = Object.keys(SLOTS).map(s => { const it = p.equip[s]; return `<div class="slot${sel && sel.it === it && it ? ' sel' : ''}" data-eq="${s}" style="border-color:${it ? icol(it) : '#443a55'}">${it ? SLOTS[s].i : ''}<small>${SLOTS[s].n}</small></div>`; }).join('');
  $('stats').innerHTML = Object.keys(STAT).map(k => `${STAT[k][0]}　<b>${Number.isInteger(st[k]) ? st[k] : st[k].toFixed(1)}${STAT[k][1] ? '%' : ''}</b>`).join('<br>') + Object.keys(p.sets || {}).map(k => `<br><span style="color:${SETS[k].c}">◆ ${SETS[k].n} ${p.sets[k]}/3</span>`).join('');
  const junk = p.inv.filter(it => upgradeOf(it) <= 0.5 && !it.fx && !it.set), sum = a => a.reduce((t, it) => t + sellOf(it), 0);
  $('sellJunk').textContent = p.run ? '回營地才能賣' : `賣掉用不到的（${junk.length} 件 +${sum(junk)} 金）`; $('sellJunk').disabled = !!p.run || !junk.length;
  $('sellAll').textContent = `全部賣掉（+${sum(p.inv)} 金）`; $('sellAll').disabled = !!p.run || !p.inv.length; $('sellAll').style.display = p.run ? 'none' : '';
  $('spTxt').textContent = '點 Q／E／R 把技能放上對應的按鈕';
  $('skl').innerHTML = SKILLS.filter(k => p.skl[k]).map(k => `<div class="row"><span>${SK[k].i} <b>${SK[k].n}</b> Lv ${p.skl[k]}　<span class="dim">${SK[k].d(p.skl[k])}</span></span>${['Q', 'E', 'R'].map((q, i2) => `<button class="btn mini${p.slots[i2] === k ? ' on' : ''}" data-slot="${k}:${i2}">${q}</button>`).join('')}</div>`).join('')
    + `<div class="dim" style="font-size:13px;line-height:1.7;margin-top:4px">${Object.keys(p.mods).map(m => `<span style="color:#ff8a3a">◆${MODS[m][1]}</span>`).concat(Object.keys(p.pas).map(k => `<span style="color:#ffd84a">✨${PAS[k][0]}${p.pas[k] > 1 ? '×' + p.pas[k] : ''}</span>`)).join('　') || '升級時可以選卡片：新技能、變體、被動'}</div>`;
  $('panelGold').textContent = `💰 ${p.gold}`;
  $('talBtn').textContent = `🌳 天賦${talPts() > 0 ? `（${talPts()} 點可用）` : ''}`;
  $('pickBtn').textContent = `🧲 自動撿：${PICKN[p.pick || 0]}`;
  $('quitRun').style.display = p.run ? '' : 'none'; $('recBtn').textContent = `📖 紀錄（${ACH.filter(a => p.ach[a[0]]).length}/${ACH.length}）`;
  $('invTxt').textContent = `${p.inv.length} / ${invCap()}`;
  let h = '';
  for (let i = 0; i < invCap(); i++) { const it = p.inv[i]; h += it ? `<div class="slot${sel && sel.it === it ? ' sel' : ''}${upgradeOf(it) > 0.5 ? ' up' : ''}" data-inv="${i}" style="border-color:${RAR[it.rarity].c}">${SLOTS[it.slot].i}</div>` : '<div class="slot"></div>'; }
  $('inv').innerHTML = h;
  const d = $('detail');
  if (!sel) { d.innerHTML = '<span class="dim">點選物品查看內容。右上角有 ▲ 的是比身上更好的裝備。</span>'; return; }
  const it = sel.it; h = itemHtml(it);
  if (sel.from === 'inv') {
    const eq = Object.assign({}, p.equip); eq[it.slot] = it; const ns = calcStats(eq), diff = [];
    for (const k in STAT) { const dv = Math.round((ns[k] - st[k]) * 10) / 10; if (dv) diff.push(`<span class="${dv > 0 ? 'good' : 'bad'}">${fmt(k, dv)}</span>`); }
    h += `<div style="margin-top:6px" class="dim">換上後：${diff.join('、') || '沒有差別'}</div>`;
    const wNew = wtOf(eq.weapon), wOld = wtOf(p.equip.weapon), hpE = ET.minion.hp * (1 + 0.42 * (p.floor - 1)) * DIFF[p.diff || 0].hp;
    const hits = (st, w) => Math.ceil(hpE / Math.max(1, st.dmg * w.mult)), dps = (st, w) => st.dmg * w.mult * (1 + st.crit / 100) * (1 + st.aspd / 100) / w.cd;
    const h0 = hits(st, wOld), h1 = hits(ns, wNew), r = dps(ns, wNew) / dps(st, wOld) - 1;
    if (h0 !== h1 || Math.abs(r) > 0.03) h += `<div style="margin-top:4px">${h0 !== h1 ? `<span class="${h1 < h0 ? 'good' : 'bad'}">骷髏兵：${h0} 下 → ${h1} 下</span>　` : ''}${Math.abs(r) > 0.03 ? `<span class="${r > 0 ? 'good' : 'bad'}">清怪速度 ${r > 0 ? '快' : '慢'} ${Math.round(Math.abs(r) * 100)}%</span>` : ''}</div>`;
    h += `<button class="btn" data-act="equip">裝備</button>` + (p.run ? '<button class="btn" data-act="drop">丟掉</button><span class="dim" style="font-size:13px">　回營地才能賣</span>' : `<button class="btn" data-act="sell">賣出（${sellOf(it)} 金）</button>`);
  } else h += `<div class="dim" style="margin-top:6px">裝備中</div>` + (p.inv.length < invCap() ? '<button class="btn" data-act="unequip">卸下</button>' : '');
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
    else if (ds.act === 'sell' && i >= 0 && !p.run) { p.inv.splice(i, 1); p.gold += sellOf(it); sfx(1200, 0.05, 'square', 0.03); }
    else if (ds.act === 'drop' && i >= 0) { p.inv.splice(i, 1); sfx(300, 0.08, 'triangle', 0.03, -100); }
    else if (ds.act === 'unequip' && p.inv.length < invCap()) { p.equip[it.slot] = null; p.inv.push(it); }
    sel = null; refresh(); heroLook();
  }
  drawPanel();
});
// 商人：藥水、當層商品、神秘寶箱、強化、永久訓練
function openBoard() {
  if (state !== 'play') return; paused = true; joy.id = null; atkHeld = false; mouse.l = mouse.r = false;
  if (!p.board || !p.board.length) rollBoard();
  dailyCheck(); weekCheck();
  const R0 = bountyReward(), wr = weekRule(), dg = p.danger || 0, easy = p.lvl >= recLv(p.tier, dg) + 4;
  const dh = `<div class="row" style="background:#2a1a12;border-radius:10px;padding:6px 10px"><span>⚠️ <b>危險度 ${dg}</b>　<span class="dim">${dg ? `敵人 +${dg * 2} 級、傷害 +${dg * 8}%；傳說機率 ×${(1 + dg * 0.25).toFixed(2)}、材料 +${dg * 15}%` : '想更刺激就往上調'}${dg >= 5 ? '；<b style="color:#ff4a3a">會掉 🔥餘燼裝備</b>' : '；危險度 5 起會掉 🔥餘燼裝備'}</span>${easy ? '<br><span class="good">你比建議等級高很多，試試提高危險度</span>' : ''}</span><button class="btn mini" data-dg="-1" ${dg > 0 ? '' : 'disabled'}>－</button><button class="btn mini" data-dg="1" ${dg < 10 ? '' : 'disabled'}>＋</button></div>`;
  const bh = `<h2 style="margin-top:4px">📜 今日懸賞 <span class="dim">每天換一批・獎勵 💎 ${R0.cry}、🦴 ${R0.bone}、💰 ${R0.gold}</span></h2>` + p.daily.list.map((b, i) => `<div class="row"><span>${b.claimed ? '✅' : b.done ? '🎁' : '▫️'} ${BOUNTY[b.k].d(b)}　<span class="dim">${b.n} / ${b.need}</span></span>${b.done && !b.claimed ? `<button class="btn" data-claim="${i}">領獎</button>` : ''}</div>`).join('')
    + (p.clears ? `<h2>🌀 每週挑戰：${wr.n} <span class="dim">${wr.d}</span></h2><div class="row"><span>無盡往下，能走多深就走多深；倒下不扣金幣。每 3 層 💎 +2<br><span class="dim">本週最佳：完成 ${p.weekly.best} 層</span></span><button class="btn" data-week="1">挑戰</button></div>` : '') + '<h2>遠征</h2>';
  $('boardList').innerHTML = dh + bh + p.board.map((o, i) => {
    const rec = recLv(o.tier, p.danger || 0), warn = p.lvl + 1 < rec ? ` <span class="bad">（建議 Lv ${rec}）</span>` : ` <span class="dim">建議 Lv ${rec}</span>`;
    return `<div class="row"><span><b style="color:#ffcf6b">${mapName(o.tier)}</b> 等級 ${o.tier}${warn}<br>${o.goal === 'boss' ? `💀 獵首領：${BOSSN[(o.tier - 1) % BOSSN.length]}${o.tier === p.tier ? '　<span class="good">擊敗可解鎖下一區</span>' : ''}` : `⛓️ 救人：${o.who}（救回後會住進營地）`}　<span class="dim">${runLen(o.tier)} 層</span>${RUNMOD[o.mod][0] ? `<br><span style="color:#ff8a3a">◆ ${RUNMOD[o.mod][0]}：${RUNMOD[o.mod][1]}</span>` : ''}</span><button class="btn" data-run="${i}">出發</button></div>`;
  }).join('') + (bl('guild') ? `<div class="row"><span class="dim">🏹 獵人公會：換一批遠征</span><button class="btn" data-reroll="1" ${p.rerolls > 0 ? '' : 'disabled'}>🔄 重抽（剩 ${p.rerolls || 0} 次）</button></div>` : '');
  $('board').classList.add('on');
}
$('board').addEventListener('click', ev => {
  const dgb = ev.target.closest('[data-dg]'); if (dgb) { if (!dgb.disabled) { p.danger = clamp((p.danger || 0) + +dgb.dataset.dg, 0, 10); SND.card(); save(); } return openBoard(); }
  const cl = ev.target.closest('[data-claim]'); if (cl) { const b = p.daily.list[+cl.dataset.claim], R0 = bountyReward(); if (b && b.done && !b.claimed) { b.claimed = true; p.mats.cry += R0.cry; p.mats.bone += R0.bone; p.gold += R0.gold; p.stat.bounty = (p.stat.bounty || 0) + 1; SND.legend(); checkAch(); save(); } return openBoard(); }
  if (ev.target.closest('[data-week]')) { const wr = weekRule(); p.board.push({ tier: p.tier, goal: 'endless', mod: wr.mod, glass: wr.glass }); return startRun(p.board.length - 1); }
  const t = ev.target.closest('[data-run]'), rr = ev.target.closest('[data-reroll]'); if (rr && !rr.disabled && p.rerolls > 0) { p.rerolls--; rollBoard(); SND.card(); openBoard(); } else if (t) startRun(+t.dataset.run); else if (ev.target === $('board') || ev.target.id === 'boardClose') { $('board').classList.remove('on'); paused = false; } });
let bldK = null;
function openBld(k) { if (k === 'cos') { bldK = 'cos'; paused = true; joy.id = null; atkHeld = false; mouse.l = mouse.r = false; $('bld').classList.add('on'); return drawBld(); } if (state !== 'play') return; bldK = k; paused = true; joy.id = null; atkHeld = false; mouse.l = mouse.r = false; $('bld').classList.add('on'); drawBld(); }
function closeBld() { $('bld').classList.remove('on'); paused = false; bldK = null; refresh(); heroLook(); save(); }
let sacPend = null; // 點兩下才燒，避免誤燒傳說
const sacCry = it => [0, 0, 2, 8, 25][it.rarity] + 3 * (it.heat || 0);
const sacHeat = it => Math.round((HEATN.slice(0, it.heat || 0).reduce((a, b) => a + b, 0) + (it.hx || 0)) * 0.7 + [0, 0, 30, 80, 200][it.rarity]);
function sacrifice(i, mode) {
  const it = p.inv[i]; if (!it || it.rarity < 2) return;
  const fx = campFire || p;
  if (mode === 'h') { const eq = p.equip[it.slot]; if (!eq || (eq.heat || 0) >= 5) return; const was = eq.heat || 0; heatUp(eq, sacHeat(it)); floatText(p.x, p.y - 20, eq.heat > was ? `${eq.name} 升溫：${HEAT[eq.heat]}！` : `${eq.name} 熱度 +${sacHeat(it)}`, '#ffb060', 16); refresh(); heroLook(); }
  else { const c = sacCry(it); p.mats.cry += c; floatText(p.x, p.y - 20, `💎 +${c}`, '#7ef', 16); }
  p.inv.splice(i, 1); p.stat.sac = (p.stat.sac || 0) + 1;
  SND.burn(); burst(fx.x, fx.y, RAR[it.rarity].c, 50, 180, 1, 2, 7); fxRing(fx.x, fx.y, 100, 0xff8a30, 0.6); shake = Math.max(shake, 4); save();
}
function drawCos() {
  $('bldTitle').textContent = '🔥 篝火'; $('bldMats').textContent = `💎 ${p.mats.cry}　把用不到的裝備獻給篝火：換結晶，或把它的熱度傳給身上同部位的裝備`;
  const has = u => u === 'light:orange' || u === 'trail:none' || p.cosU.includes(u);
  let h = '<h2>火光</h2>' + Object.keys(LIGHTS).map(k => { const u = 'light:' + k, on = p.cos.light === k; return `<div class="row"><span style="color:#${LIGHTS[k][1].toString(16)}">● ${LIGHTS[k][0]}</span>${has(u) ? `<button class="btn mini${on ? ' on' : ''}" data-cos="${u}">${on ? '使用中' : '換上'}</button>` : '<span class="dim">🔒 未解鎖</span>'}</div>`; }).join('');
  const sac = p.inv.map((it, i) => [it, i]).filter(([it]) => it.rarity >= 2).sort((a, b) => b[0].rarity - a[0].rarity);
  h = '<h2>獻祭 <span class="dim">稀有以上</span></h2>' + (sac.length ? sac.map(([it, i]) => { const eq = p.equip[it.slot], can = eq && (eq.heat || 0) < 5; return `<div class="row"><span><b style="color:${RAR[it.rarity].c}">${it.name}</b> ${heatTag(it)}<br><span class="dim">→ ${can ? `${eq.name} 得到 ${sacHeat(it)} 點熱度` : '同部位沒有可升溫的裝備'}</span></span><button class="btn mini" data-sac="${i}:c">${sacPend === i + ':c' ? '確定？' : '💎 ' + sacCry(it)}</button><button class="btn mini" data-sac="${i}:h" ${can ? '' : 'disabled'}>${sacPend === i + ':h' ? '確定？' : '傳火'}</button></div>`; }).join('') : '<div class="row dim"><span>背包裡沒有稀有以上的裝備</span></div>') + h;
  h += '<h2>腳印</h2>' + Object.keys(TRAILS).map(k => { const u = 'trail:' + k, on = p.cos.trail === k; return `<div class="row"><span>${TRAILS[k]}</span>${has(u) ? `<button class="btn mini${on ? ' on' : ''}" data-cos="${u}">${on ? '使用中' : '換上'}</button>` : '<span class="dim">🔒 未解鎖</span>'}</div>`; }).join('');
  $('bldBody').innerHTML = h;
}
function drawBld() {
  if (bldK === 'cos') return drawCos();
  const k = bldK, B = BLD[k], L = bl(k), g = p.gold, m = p.mats;
  const btn = (attr, cost, ok = true) => `<button class="btn" ${attr} ${g >= cost && ok ? '' : 'disabled'}>${cost} 金</button>`;
  $('bldTitle').textContent = `${B.i} ${B.n}${L ? ' Lv ' + L : ''}`;
  $('bldMats').textContent = `🦴 ${m.bone}　💎 ${m.cry}　💰 ${g}`;
  let h = '';
  if (B.need && !p.rescued.includes(B.need)) h += `<div class="row bad"><span>🔒 要先救回${B.need}（告示板上的救人任務）</span></div>`;
  else if (L < 3) {
    const [cb, cc, cg] = B.cost[L], ok = m.bone >= cb && m.cry >= cc && g >= cg;
    h += `<div class="row"><span>${L ? '升級到' : '建造'} Lv ${L + 1}：<b>${B.d(L + 1)}</b><br><span class="${ok ? 'dim' : 'bad'}">需要 🦴 ${cb}${cc ? '　💎 ' + cc : ''}　💰 ${cg}</span></span><button class="btn" data-bup="1" ${ok ? '' : 'disabled'}>${L ? '升級' : '建造'}</button></div>`;
  } else h += '<div class="row dim"><span>已經是最高等級</span></div>';
  if (L) h += `<div class="row"><span class="good">目前：${B.d(L)}</span></div>`;
  if (k === 'train' && L) { h += `<h2>訓練 <span class="dim">永久提升，上限 Lv ${trainCap()}</span></h2>`; for (const q in TRAIN) h += `<div class="row"><span><b>${TRAIN[q][0]}</b> Lv ${p.train[q]}　<span class="dim">${TRAIN[q][1]}</span></span>${p.train[q] >= trainCap() ? '<span class="dim">到上限</span>' : btn(`data-train="${q}"`, trainCost(q))}</div>`; }
  if (k === 'smith' && L) { h += `<h2>熔鑄 <span class="dim">花 💎 結晶直接提升一級熱度，上限 ${HEAT[forgeCap()]}；戰鬥本身也會讓裝備變熱</span></h2>`; for (const q in SLOTS) { const it = p.equip[q]; h += it ? `<div class="row"><span>${SLOTS[q].i} <b style="color:${RAR[it.rarity].c}">${it.name}</b>　${heatTag(it)}</span>${(it.heat || 0) >= forgeCap() ? '<span class="dim">到上限</span>' : `<button class="btn" data-upg="${q}" ${m.cry >= forgeCost(it) ? '' : 'disabled'}>💎 ${forgeCost(it)}</button>`}</div>` : `<div class="row dim"><span>${SLOTS[q].i} ${SLOTS[q].n}：沒有裝備</span></div>`; } }
  if (k === 'altar' && L) h += `<h2>重選升級卡與天賦</h2><div class="row"><span>🔄 退回所有技能、變體、被動與天賦點，重新選 ${p.lvl - 1} 張卡</span>${btn('data-respec="1"', respecCost(), p.lvl > 1)}</div>`;
  if (k === 'store') h += `<div class="row dim"><span>背包目前 ${p.inv.length} / ${invCap()} 格</span></div>`;
  if (k === 'guild' && L) h += `<div class="row dim"><span>這次回營地還能重抽告示板 ${p.rerolls || 0} 次</span></div>`;
  $('bldBody').innerHTML = h;
}
$('bld').addEventListener('click', ev => {
  if (ev.target === $('bld') || ev.target.id === 'bldClose') return closeBld();
  const sc = ev.target.closest('[data-sac]'); if (sc) { if (!sc.disabled) { if (sacPend === sc.dataset.sac) { const [i2, m2] = sc.dataset.sac.split(':'); sacPend = null; sacrifice(+i2, m2); } else sacPend = sc.dataset.sac; } return drawBld(); }
  const cs = ev.target.closest('[data-cos]'); if (cs) { const [t2, k2] = cs.dataset.cos.split(':'); p.cos[t2] = k2; SND.card(); save(); return drawBld(); }
  const t = ev.target.closest('[data-bup],[data-upg],[data-train],[data-respec]'); if (!t || t.disabled) return;
  const ds = t.dataset, pay = c => { if (p.gold < c) return false; p.gold -= c; SND.coin(); return true; };
  if (ds.bup) {
    const L = bl(bldK), [cb, cc, cg] = BLD[bldK].cost[L];
    if (L < 3 && p.mats.bone >= cb && p.mats.cry >= cc && p.gold >= cg) {
      p.mats.bone -= cb; p.mats.cry -= cc; p.gold -= cg; p.bld[bldK] = L + 1; if (bldK === 'guild' && !L) p.rerolls = 1;
      SND.shrine(); genCamp(true); burst(campBlds.find(d => d.k === bldK).x, campBlds.find(d => d.k === bldK).y, '#ffcf6b', 40, 140, 1, 1, 7); shake = 5;
      floatText(p.x, p.y, `${BLD[bldK].n} Lv ${L + 1}！`, '#ffcf6b', 20); paused = true;
    }
  }
  else if (ds.upg) { const it = p.equip[ds.upg]; if (it && (it.heat || 0) < forgeCap() && p.mats.cry >= forgeCost(it) && (p.mats.cry -= forgeCost(it), true)) { it.heat = (it.heat || 0) + 1; it.hx = 0; if (it.heat === 5) emberAffix(it); SND.burn(); refresh(); heroLook(); } }
  else if (ds.respec) { if (pay(respecCost())) { p.skl = { [clsOf().sk]: 1 }; p.slots = [clsOf().sk, null, null]; p.mods = {}; p.pas = {}; p.tal = {}; p.picks = p.lvl - 1; refresh(); closeBld(); return; } }
  else if (ds.train) { if (p.train[ds.train] < trainCap() && pay(trainCost(ds.train))) { p.train[ds.train]++; SND.level(); refresh(); } }
  drawBld();
});
function openStore() { if (state !== 'play' || paused) return; paused = storeOpen = true; joy.id = null; atkHeld = false; mouse.l = mouse.r = false; $('store').classList.add('on'); drawStore(); tip('store', '倒下會掉三成金幣，別存太多；強化與訓練在營地的建築裡'); }
function closeStore() { paused = storeOpen = false; $('store').classList.remove('on'); refresh(); heroLook(); save(); }
function drawStore() {
  const g = p.gold, btn = (attr, cost, ok = true, label) => `<button class="btn" ${attr} ${g >= cost && ok ? '' : 'disabled'}>${label || cost + ' 金'}</button>`;
  $('storeGold').textContent = `💰 ${g}`;
  const c = potCost();
  let h = `<h2>藥水</h2><div class="row"><span>🧪 生命藥水（持有 ${p.hpPot}/9）</span>${btn('data-buy="hp"', c, p.hpPot < 9)}</div>
    <div class="row"><span>💧 魔力藥水（持有 ${p.mpPot}/9）</span>${btn('data-buy="mp"', c, p.mpPot < 9)}</div><h2>這一層的貨</h2>`;
  const full = p.inv.length >= invCap();
  stock.forEach((it, i) => { h += it ? `<div class="row"><span>${SLOTS[it.slot].i} ${itemHtml(it)}${upgradeOf(it) > 0.5 ? '<span class="good">▲ 比身上的好</span>' : ''}</span>${btn(`data-item="${i}"`, priceOf(it), !full)}</div>` : ''; });
  if (!stock.some(x => x)) h += '<div class="row dim"><span>賣完了，下一層會進新貨</span></div>';
  h += `<h2>神秘寶箱</h2><div class="row"><span>🎁 開出一件隨機裝備，有機會是傳說${boxMsg ? '<br>' + boxMsg : ''}</span>${btn('data-box="1"', boxCost(), !full)}</div>`;
  if (full) h += '<div class="row bad"><span>背包滿了，先到 🎒 賣掉一些</span></div>';
  h += '<div class="row dim" style="margin-top:10px"><span>強化、訓練、重選卡都搬到營地的建築裡了</span></div>';
  $('storeBody').innerHTML = h;
}
$('store').addEventListener('click', ev => {
  if (ev.target === $('store')) return closeStore();
  const t = ev.target.closest('[data-buy],[data-item],[data-box],[data-upg],[data-train],[data-respec]'); if (!t || t.disabled) return;
  const ds = t.dataset, pay = c => { if (p.gold < c) return false; p.gold -= c; SND.coin(); return true; };
  if (ds.buy) { if ((ds.buy === 'hp' ? p.hpPot : p.mpPot) < 9 && pay(potCost())) { if (ds.buy === 'hp') p.hpPot++; else p.mpPot++; } }
  else if (ds.item !== undefined) { const it = stock[+ds.item]; if (it && p.inv.length < invCap() && pay(priceOf(it))) { p.inv.push(it); stock[+ds.item] = null; } }
  else if (ds.box) {
    if (p.inv.length < invCap() && pay(boxCost())) {
      const r = Math.random(), it = makeItem(p.floor, r < 0.03 ? 3 : r < 0.3 ? 2 : r < 0.75 ? 1 : 0); p.inv.push(it);
      boxMsg = `開出了：<b style="color:${RAR[it.rarity].c}">${it.name}</b>${upgradeOf(it) > 0.5 ? ' <span class="good">▲</span>' : ''}`; if (it.rarity >= 2) SND.level();
    }
  }
  else if (ds.respec) { if (pay(respecCost())) { p.skl = { [clsOf().sk]: 1 }; p.slots = [clsOf().sk, null, null]; p.mods = {}; p.pas = {}; p.tal = {}; p.picks = p.lvl - 1; refresh(); closeStore(); return; } }
  else if (ds.train) { if (pay(trainCost(ds.train))) { p.train[ds.train]++; SND.level(); refresh(); } }
  drawStore();
});
$('storeClose').onclick = closeStore;
const sellIf = f => { if (p.run) return; let g = 0; p.inv = p.inv.filter(it => !f(it) || (g += sellOf(it), false)); p.gold += g; sel = null; if (g) SND.coin(); drawPanel(); };
function openRec() {
  togglePanel(false); paused = true;
  const got = ACH.filter(a => p.ach[a[0]]).length, cx = Object.keys(LEGFX).filter(k => p.codex[k]).length;
  $('recBody').innerHTML = `<h2>🏆 成就 <span class="dim">${got} / ${ACH.length}</span></h2>` + ACH.map(([id, d, , cry, g]) => `<div class="row"><span>${p.ach[id] ? '✅' : '▫️'} ${d}</span><span class="dim" style="flex:none">💎${cry} 💰${g}${COS_UNLOCK[id] ? ' ✨' + COS_NAME(COS_UNLOCK[id]) : ''}</span></div>`).join('')
    + `<h2>📖 傳說圖鑑 <span class="dim">${cx} / ${Object.keys(LEGFX).length}・每收集一種 💎 +1</span></h2>` + Object.keys(LEGFX).map(k => `<div class="row"><span>${p.codex[k] ? `<b style="color:#ff8a3a">${LEGFX[k].n}</b>（${SLOTS[LEGFX[k].slot].n}）<span class="dim">${LEGFX[k].d((LEGFX[k].r[0] + LEGFX[k].r[1]) / 2) + '（數值有範圍）'}</span>` : `<span class="dim">？？？（${SLOTS[LEGFX[k].slot].n}）</span>`}</span></div>`).join('')
    + `<h2>📊 紀錄</h2><div class="row dim"><span>擊殺 ${p.kills}・遠征完成 ${p.clears || 0} 趟・倒下 ${p.deaths} 次・懸賞 ${p.stat.bounty || 0} 個・本週挑戰完成 ${(p.weekly && p.weekly.best) || 0} 層</span></div>`;
  $('rec').classList.add('on');
}
$('rec').addEventListener('click', ev => { if (ev.target === $('rec') || ev.target.id === 'recClose') { $('rec').classList.remove('on'); paused = false; } });
$('recBtn').onclick = openRec;
// ---------- 匯出狀態：整理成一段文字，貼給 Claude 判斷難易度 ----------
function exportText(full) {
  const st = p.st, n1 = v => Number.isInteger(v) ? v : (+v).toFixed(1), L = [];
  const itemLine = it => it ? `${it.name}［${RAR[it.rarity].n}${it.slot === 'weapon' ? '・' + wtOf(it).n : ''}・Lv${it.lvl}・${HEAT[it.heat || 0]}${it.heat < 5 ? `(${it.hx || 0}/${HEATN[it.heat || 0]})` : ''}］ `
    + [...Object.keys(it.base).map(k => fmt(k, iv(it, it.base[k]))), ...it.aff.map(a => (a.ember ? '🔥' : '') + fmt(a.k, iv(it, a.v)))].join('、')
    + (it.fx ? `　★${LEGFX[it.fx].n} ${Math.round((it.fxq === undefined ? 0.5 : it.fxq) * 100)}%` : '') + (it.nc ? `　✦${NC[it.nc.k].n}${it.nc.v ? ' ' + it.nc.v : ''}` : '') : '（空）';
  const rec = recLv(p.tier, p.danger || 0);
  L.push(`【餘燼地城 狀態匯出】${new Date().toLocaleString('zh-TW')}`);
  L.push(`裝置：${touchMode ? '觸控' : '滑鼠鍵盤'} ${W}×${H}・畫質 ${quality}・總遊玩 ${Math.round((p.stat.play || 0) / 60)} 分鐘`);
  L.push(`\n■ 進度`);
  L.push(`角色：${clsOf().n} Lv ${p.lvl}（經驗 ${p.xp}/${xpNeed(p.lvl)}）・其他角色：${Object.keys(p.heroes).map(c => `${CLS[c].n} Lv${p.heroes[c].lvl}`).join('、') || '無'}`);
  L.push(`區域：已解鎖等級 ${p.tier}（${mapName(p.tier)}）・危險度 ${p.danger || 0}・最高區建議 Lv ${rec}・${p.won ? '已通關' : '未通關'}`);
  L.push(`遠征完成 ${p.clears || 0} 趟・倒下 ${p.deaths} 次・擊殺 ${p.kills}・目前${p.run ? `在遠征中（${mapName(p.run.tier)} ${p.run.depth}/${p.run.len}）` : '在營地'}`);
  L.push(`💰 ${p.gold}・🦴 ${p.mats.bone}・💎 ${p.mats.cry}・生命藥水 ${p.hpPot}・魔力藥水 ${p.mpPot}`);
  L.push(`建築：${Object.keys(BLD).map(k => `${BLD[k].n} ${bl(k)}`).join('、')}・訓練：${Object.keys(TRAIN).map(k => `${TRAIN[k][0]} ${p.train[k]}`).join('、')}`);
  L.push(`救回：${p.rescued.join('、') || '無'}`);
  L.push(`\n■ 屬性`);
  L.push(Object.keys(STAT).map(k => `${STAT[k][0]} ${n1(st[k])}${STAT[k][1] ? '%' : ''}`).join('・'));
  L.push(`\n■ 身上裝備`);
  for (const k in SLOTS) L.push(`${SLOTS[k].n}：${itemLine(p.equip[k])}`);
  L.push(`套裝：${Object.keys(p.sets || {}).map(k => `${SETS[k].n} ${p.sets[k]}/3`).join('、') || '無'}　保底：${JSON.stringify(p.setPity || {})}`);
  L.push(`\n■ 技能與升級卡`);
  L.push(`技能欄：${p.slots.map(k => k ? `${SK[k].n} Lv${p.skl[k]}` : '空').join('／')}・已學：${SKILLS.filter(k => p.skl[k]).map(k => `${SK[k].n}${p.skl[k]}`).join('、')}`);
  L.push(`天賦：${Object.keys(p.tal || {}).map(id => { for (const [, ns] of TALENTS[p.cls] || []) for (const n of ns) if (n[0] === id) return n[1]; return id; }).join('、') || '無'}（未用 ${talPts()} 點）`);
  L.push(`變體：${Object.keys(p.mods).map(m => MODS[m][1]).join('、') || '無'}・被動：${Object.keys(p.pas).map(k => PAS[k][0] + '×' + p.pas[k]).join('、') || '無'}・未選的卡 ${p.picks}`);
  const rc = [0, 0, 0, 0, 0]; for (const it of p.inv) rc[it.rarity]++;
  L.push(`\n■ 背包 ${p.inv.length}/${invCap()}（普通 ${rc[0]}・精良 ${rc[1]}・稀有 ${rc[2]}・傳說 ${rc[3]}・餘燼 ${rc[4]}）`);
  for (const it of p.inv.filter(it => it.rarity >= 2)) L.push('　' + itemLine(it));
  L.push(`\n■ 收集`);
  L.push(`傳說圖鑑 ${Object.keys(p.codex).length}/${Object.keys(LEGFX).length}・成就 ${ACH.filter(a => p.ach[a[0]]).length}/${ACH.length}・引爆餘燼 ${p.stat.burn || 0} 次・懸賞完成 ${p.stat.bounty || 0}・本週挑戰 ${(p.weekly && p.weekly.best) || 0} 層・靶場最高 ${p.stat.range || 0}`);
  L.push(`\n■ 最近的遠征（${(p.hist || []).length} 趟，最新在最下面）`);
  if (!(p.hist || []).length) L.push('（這個功能剛加上，之後的遠征才會記錄）');
  for (const h of p.hist || []) L.push(`${h.at}｜${CLS[h.cls] ? CLS[h.cls].n : h.cls} Lv${h.lvl}｜區${h.tier} 危${h.dg}｜${h.goal === 'boss' ? '首領' : h.goal === 'rescue' ? '救人' : h.goal === 'endless' ? '每週' : h.goal}${h.mod !== 'none' ? '◆' + h.mod : ''}｜${h.res}（第 ${h.depth} 層）｜${Math.floor(h.sec / 60)}分${h.sec % 60}秒｜擊殺 ${h.kills}｜受傷 ${h.taken}（生命 ${h.hp}）｜藥 ${h.pots}｜撿 ${h.items}｜金 ${h.gold >= 0 ? '+' : ''}${h.gold}`);
  if (full) { const o = {}; for (const k in p) if (!['st', 'fx', 'nc', 'cd'].includes(k) && typeof p[k] !== 'function') o[k] = p[k]; L.push(`\n■ 完整存檔（JSON）\n${JSON.stringify(o)}`); }
  return L.join('\n');
}
function openExport() {
  togglePanel(false); paused = true;
  $('expFull').checked = false; $('expText').value = exportText(false); $('expMsg').textContent = '';
  $('exp').classList.add('on');
}
$('expBtn').onclick = openExport;
function openTal() { togglePanel(false); paused = true; drawTal(); $('tal').classList.add('on'); }
function drawTal() {
  const pts = talPts(), next = (Math.floor(p.lvl / 5) + 1) * 5;
  $('talTitle').textContent = `🌳 ${clsOf().n}的天賦`;
  $('talInfo').innerHTML = `剩 <b style="color:#7dff8a">${pts}</b> 點・下一點在 Lv ${next}　<span class="dim">同一條分支要依序點；第 4 個是改變玩法的頂點；在餘燼祭壇可以重置</span>`;
  $('talBody').innerHTML = (TALENTS[p.cls] || []).map(([bn, nodes]) => `<div class="tbr"><h2>${bn}</h2>` + nodes.map(([id, n, d], i) => {
    const on = tl(id), can = talCan(id);
    return `<button class="tnode${on ? ' on' : can ? ' can' : ''}${i === 3 ? ' cap' : ''}" data-tal="${id}" ${can ? '' : 'disabled'}><b>${i === 3 ? '★ ' : ''}${n}</b><span>${d}</span></button>`;
  }).join('') + '</div>').join('');
}
$('tal').addEventListener('click', ev => {
  if (ev.target === $('tal') || ev.target.id === 'talClose') { $('tal').classList.remove('on'); paused = false; save(); return; }
  const t = ev.target.closest('[data-tal]'); if (!t || !talCan(t.dataset.tal)) return;
  p.tal[t.dataset.tal] = 1; SND.legend(); refresh(); drawTal();
});
$('talBtn').onclick = openTal;
$('pickBtn').onclick = () => { p.pick = ((p.pick || 0) + 1) % 4; SND.card(); save(); drawPanel(); };
$('expFull').onchange = () => { $('expText').value = exportText($('expFull').checked); };
$('expCopy').onclick = async () => {
  const t = $('expText');
  try { await navigator.clipboard.writeText(t.value); $('expMsg').textContent = '✅ 已複製，貼到對話裡就可以了'; }
  catch (e) { t.focus(); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (er) { /* 舊瀏覽器 */ } $('expMsg').textContent = ok ? '✅ 已複製' : '請長按文字框，選「全選」再「拷貝」'; }
};
$('exp').addEventListener('click', ev => { if (ev.target === $('exp') || ev.target.id === 'expClose') { $('exp').classList.remove('on'); paused = false; } });
$('sellJunk').onclick = () => sellIf(it => upgradeOf(it) <= 0.5 && !it.fx && !it.set);
$('sellAll').onclick = () => { if (confirm('背包裡的裝備全部賣掉？（身上穿的不會賣）')) sellIf(() => true); };
$('cards').addEventListener('click', ev => {
  const t = ev.target.closest('[data-card]'); if (!t) return;
  takeCard(cards[+t.dataset.card]); p.picks--;
  if (p.picks > 0) { cards = rollCards(); if (cards.length) return drawCards(); p.picks = 0; }
  $('cards').classList.remove('on'); paused = false; cards = null; save();
});
$('closeBtn').onclick = () => togglePanel(false);
$('quitRun').onclick = () => { if (p.run && confirm('放棄這趟遠征、回到營地？撿到的東西都會留著，但沒有獎勵箱。')) { togglePanel(false); logRun('放棄'); p.run = null; genCamp(); } };
$('bagBtn').onclick = () => togglePanel();
$('sndBtn').onclick = () => { muted = !muted; $('sndBtn').textContent = muted ? '🔇' : '🔊'; audioInit(); if (master) master.gain.value = muted ? 0 : 1; };
function nextCam() { camMode = (camMode + 1) % CAMS.length; try { localStorage.setItem('ember-depths-cam', camMode); } catch (e) { /* 沒差 */ } if (state === 'play') banner('', '視角：' + CAMS[camMode].name); }
$('camBtn').onclick = nextCam;
try { camMode = (+localStorage.getItem('ember-depths-cam') || 0) % CAMS.length; } catch (e) { /* 沒差 */ }
$('act').onclick = interact;

function startGame(fresh, df = 0) {
  if (fresh || !load()) { newPlayer(); p.diff = df; }
  state = 'play'; paused = false; $('menu').classList.remove('on'); audioInit();
  if (fresh) { p.board = [{ tier: 1, goal: 'boss', mod: 'none' }]; startRun(0); } else genFloor(); // 新玩家直接進第一趟遠征，營地等回來再介紹
  heroLook();
  if (fresh) { dropItem(p.x - 55, p.y + 45, makeItem(1, 0, 'weapon', '手弩')); dropItem(p.x + 55, p.y + 45, makeItem(1, 0, 'weapon', '法杖')); setTimeout(() => tip('weap', '地上有手弩和法杖：撿起來到 🎒 換上，普攻的打法會跟著武器變'), 5000); }
  if (p.floor === 1 && p.lvl === 1) { tip('move', touchMode ? '左半邊螢幕拖曳移動，右下 ⚔️ 按住就會自動瞄準攻擊' : 'WASD 移動，按住滑鼠左鍵朝游標攻擊，Q／E／R 是技能'); }
}
for (const b of document.querySelectorAll('[data-diff]')) b.onclick = () => { if (!hasSave() || confirm('要放棄目前的進度，重新開始嗎？')) startGame(true, +b.dataset.diff); };
$('contBtn').onclick = () => startGame(false);
$('reviveBtn').onclick = () => { $('dead').classList.remove('on'); if (state !== 'dead') { paused = false; return; } resetRuntime(); refresh(); p.hp = p.st.hp; p.mp = p.st.mp; state = 'play'; if (hero) hero.lock = 0; p.run = null; genCamp(); };

// ---------- 第一人稱射擊靶場（營地小遊戲，實驗中） ----------
// 站在營地南邊，骷髏從北邊衝過來；60 秒、3 條命。電腦用滑鼠轉視角、左鍵射擊；手機拖曳轉視角、按射擊鈕
let fps = null, fpsDrag = null;
const FOES = { minion: { m: 'skel_minion', hp: 1, spd: [3.2, 4.5], s: 1, pts: 10 }, imp: { m: 'skel_minion', hp: 1, spd: [6, 7.5], s: 0.7, pts: 15, tint: 0x8fe07a }, brute: { m: 'skel_warrior', hp: 3, spd: [2.2, 2.8], s: 1.25, pts: 30, tint: 0x9fb4e0 } };
function startRange() {
  if (fps || p.run) return;
  const r = rooms[0];
  fps = { t: 60, score: 0, lives: 3, hits: 0, shots: 0, combo: 0, yaw: 0, pitch: -0.05, foes: [], spawnT: 1, cd: 0, kick: 0,
    x: (r.x + r.w / 2) * 4, z: (r.y + r.h - 1.6) * 4, zFar: (r.y + 1) * 4, xMin: (r.x + 1) * 4, xMax: (r.x + r.w - 1) * 4 };
  p.x = fps.x / U; p.y = fps.z / U;
  paused = true; joy.id = null; atkHeld = false; mouse.l = mouse.r = false;
  document.body.classList.add('fps'); $('fpsHud').classList.add('on'); $('fpsQuit').style.display = '';
  camera.fov = W < H ? 75 : 62; camera.far = 85; camera.updateProjectionMatrix(); renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; /* 第一人稱看得到整個房間，比較重：陰影只算一次、遠處不畫 */
  fps.gun = A.h_crossbow.scene.clone(); fps.gun.scale.setScalar(0.55); fps.gun.rotation.set(0.05, Math.PI + 0.08, 0); camera.add(fps.gun);
  fps.flash = camFlash; fps.lamp = rangeLamp; rangeLamp.intensity = 140; rangeLamp.position.set(fps.x, 7, fps.zFar + 8); // 靶場遠端照亮，衝過來的骷髏才看得清楚
  if (!touchMode && cv.requestPointerLock) try { cv.requestPointerLock(); } catch (e) { /* 不支援就用一般滑鼠移動 */ }
  tip('fps', touchMode ? '拖曳螢幕轉視角，按 🎯 射擊；打頭分數加倍' : '移動滑鼠瞄準，左鍵射擊；打頭分數加倍，Esc 離開');
  SND.bossIntro(); fpsHud();
}
function warmBoss() { // 趁載入時預先編譯首領戰會用到的材質
  const g = new THREE.Group(), gun = A.h_crossbow.scene.clone();
  gun.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive.setHex(0xff6a10); o.material.emissiveIntensity = 0.8; } });
  g.add(new THREE.Mesh(cryGeo, crystalMat), new THREE.Mesh(bubbleGeo, bubbleMat), gun); g.position.copy(camera.position); scene.add(g);
  try { renderer.compile(scene, camera); } catch (er) { /* 編譯失敗就照舊，第一次出現時再編譯 */ }
  gun.traverse(o => { if (o.isMesh) o.material.dispose(); }); g.removeFromParent();
}
function startSnipe(e) {
  if (fps || e.dead) return;
  const bx = e.x * U, bz = e.y * U, px = p.x * U, pz = p.y * U, dx = bx - px, dz = bz - pz, d = Math.hypot(dx, dz) || 1;
  fps = { mode: 'boss', boss: e, t: 4.5, score: 0, lives: 3, hits: 0, shots: 0, combo: 0, dmg: 0, foes: [], cd: 0, kick: 0, x: px, z: pz,
    yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(5 * 0.62 - 2.3, d) };
  joy.id = null; atkHeld = false; mouse.l = mouse.r = false;
  document.body.classList.add('fps'); $('fpsHud').classList.add('on'); $('fpsQuit').style.display = 'none';
  camera.fov = W < H ? 75 : 62; camera.far = 85; camera.updateProjectionMatrix(); renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; /* 第一人稱看得到整個房間，比較重：陰影只算一次、遠處不畫 */
  fps.gun = A.h_crossbow.scene.clone(); fps.gun.scale.setScalar(0.55); fps.gun.rotation.set(0.05, Math.PI + 0.08, 0); camera.add(fps.gun);
  fps.gun.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive.setHex(0xff6a10); o.material.emissiveIntensity = 0.8; } });
  fps.flash = camFlash;
  if (!touchMode && cv.requestPointerLock) try { cv.requestPointerLock(); } catch (er) { /* 不支援就用一般滑鼠移動 */ }
  tip('snipe', touchMode ? '破防時間停住了：拖曳瞄準首領的頭，按 🎯 連射' : '破防時間停住了：瞄準首領的頭，按住左鍵連射');
  SND.burn(); fpsHud();
}
function endRange(show) {
  if (!fps) return;
  if (fps.mode === 'boss') {
    const e = fps.boss, dmg = Math.round(fps.dmg), acc = fps.shots ? Math.round(fps.hits / fps.shots * 100) : 0;
    fps.gun.traverse(o => { if (o.isMesh) o.material.dispose(); }); fps.gun.removeFromParent(); camFlash.intensity = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    fps = null; fpsDrag = null; mouse.l = false; document.body.classList.remove('fps'); $('fpsHud').classList.remove('on'); viewFov(); camReady = false;
    if (!e.dead) { e.broken = 1.2; if (show) banner('', `🔥 餘燼弩造成 ${dmg} 傷害・命中率 ${acc}%`); }
    return;
  }
  for (const f of fps.foes) f.c.dispose();
  fps.gun.removeFromParent(); camFlash.intensity = 0; rangeLamp.intensity = 0;
  if (document.pointerLockElement) document.exitPointerLock();
  const sc = fps.score, best = Math.max(sc, p.stat.range || 0), newBest = sc > (p.stat.range || 0), acc = fps.shots ? Math.round(fps.hits / fps.shots * 100) : 0;
  p.stat.range = best; const bone = Math.floor(sc / 25), gold = sc * 2; p.mats.bone += bone; p.gold += gold;
  fps = null; fpsDrag = null; document.body.classList.remove('fps'); $('fpsHud').classList.remove('on');
  viewFov(); paused = false; camReady = false; save();
  if (show) { banner(newBest ? '新紀錄！' : '靶場結束', `${sc} 分・命中率 ${acc}%・最高 ${best} 分・獲得 🦴 ${bone}、💰 ${gold}`); SND.level(); }
}
function fpsHud() {
  if (!fps) return;
  if (fps.mode === 'boss') { $('fpsInfo').innerHTML = `⏱ ${Math.max(0, fps.t).toFixed(1)}　破防射擊：瞄準頭部　<b>${Math.round(fps.dmg)}</b> 傷害`; return; }
  $('fpsInfo').innerHTML = `⏱ ${Math.ceil(fps.t)}　${'❤️'.repeat(fps.lives)}${'🖤'.repeat(3 - fps.lives)}　<b>${fps.score}</b> 分${fps.combo >= 3 ? `　🔥×${fps.combo}` : ''}`;
}
function fpsDir(out) { const cp = Math.cos(fps.pitch); return out.set(-Math.sin(fps.yaw) * cp, Math.sin(fps.pitch), -Math.cos(fps.yaw) * cp); }
function fpsFire() {
  if (!fps || fps.cd > 0) return;
  if (fps.mode === 'boss') return snipeFire();
  fps.cd = 0.3; fps.shots++; fps.kick = 1; fps.flash.intensity = 40; SND.shoot(false); noise(0.08, 0.06, 5000, 1500);
  const O = new THREE.Vector3(fps.x, 2.3, fps.z), D = fpsDir(new THREE.Vector3()) /* 用主角的位置，不等畫面刷新 */, hd = Math.hypot(D.x, D.z) || 1;
  let best = null, bt = 1e9, by = 0;
  for (const f of fps.foes) {
    if (f.dead) continue;
    const t = ((f.x - O.x) * D.x + (f.z - O.z) * D.z) / (hd * hd); if (t <= 0) continue;
    const px = O.x + D.x * t, pz = O.z + D.z * t, py = O.y + D.y * t, H = 2.5 * f.s;
    if (Math.hypot(px - f.x, pz - f.z) < 0.95 * f.s && py > 0 && py < H * 1.05 && t < bt) { bt = t; best = f; by = py / H; }
  }
  const end = best ? bt : 60;
  for (let i = 1; i < 14; i++) { const u = i / 14 * end; parts.push(mkPart((O.x + D.x * u) / U, (O.z + D.z * u) / U, O.y + D.y * u, 0, 0, 0, '#ffe0a0', 0.12, 3)); }
  if (!best) { fps.combo = 0; fpsHud(); return; }
  const head = by > 0.74, hx = O.x + D.x * bt, hy = O.y + D.y * bt, hz = O.z + D.z * bt;
  fps.hits++; fps.combo++; best.hp -= head ? 2 : 1;
  burst(hx / U, hz / U, head ? '#ffd84a' : '#e8e2d0', head ? 16 : 8, 140, 0.4, hy, 3); SND.hit(null, fps.combo);
  if (head) { floatText(hx / U, hz / U, '爆頭！', '#ffd84a', 22); SND.crit(); }
  if (best.hp <= 0) {
    best.dead = true; best.c.once('Death_C_Skeletons', 1.6, 99); best.dieT = 1.2;
    const pts = Math.round(FOES[best.type].pts * (head ? 2 : 1) * (1 + Math.min(fps.combo, 10) * 0.1)); fps.score += pts;
    floatText(hx / U, hz / U, '+' + pts, '#ffcf6b', 16); SND.bones();
  } else best.c.once('Hit_A', 2, 0.25);
  fpsHud();
}
function snipeFire() {
  const F = fps, e = F.boss; F.cd = 0.2; F.shots++; F.kick = 1; F.flash.intensity = 50; SND.shoot(false); noise(0.08, 0.06, 5000, 1500);
  const O = new THREE.Vector3(fps.x, 2.3, fps.z), D = fpsDir(new THREE.Vector3()) /* 用主角的位置，不等畫面刷新 */, hd = Math.hypot(D.x, D.z) || 1, bx = e.x * U, bz = e.y * U, S = 2, H = 2.5 * S;
  const t = ((bx - O.x) * D.x + (bz - O.z) * D.z) / (hd * hd), px = O.x + D.x * t, pz = O.z + D.z * t, py = O.y + D.y * t;
  const hit = t > 0 && Math.hypot(px - bx, pz - bz) < 0.95 * S && py > 0 && py < H * 1.05, end = hit ? t : 60;
  for (let i = 1; i < 14; i++) { const u = i / 14 * end; parts.push(mkPart((O.x + D.x * u) / U, (O.z + D.z * u) / U, O.y + D.y * u, 0, 0, 0, '#ffb060', 0.12, 3.5)); }
  if (!hit) { F.combo = 0; return fpsHud(); }
  const head = py / H > 0.72, hp0 = e.hp; F.hits++; F.combo++;
  burst(px / U, pz / U, head ? '#ffd84a' : '#ff9a40', head ? 18 : 10, 160, 0.4, py, 3);
  if (head) { floatText(px / U, pz / U, '要害！', '#ffd84a', 22); SND.crit(); }
  hitEnemy(e, head ? 1 : 0.45, 0, null, { noProc: true });
  if (!fps) return; // 首領被打倒時已經結束射擊
  F.dmg += Math.max(0, hp0 - e.hp); SND.hit(null, F.combo); fpsHud();
}
function updateFps(dt) {
  if (fps.mode === 'boss') { // 破防射擊：世界停住，只有你在動
    const F = fps, e = F.boss; F.t -= dt; F.cd -= dt; F.kick = Math.max(0, F.kick - dt * 8); F.flash.intensity = Math.max(0, F.flash.intensity - dt * 400); time += dt;
    if (mouse.l) fpsFire();
    if (Math.random() < 0.4) parts.push(mkPart(e.x + rand(-20, 20), e.y + rand(-20, 20), 5.4, rand(-20, 20), rand(-20, 20), 0, '#ffe080', 0.5, 5));
    if (touchMode) { // 準心靠近首領時，往頭部靠一點
      const ty = Math.atan2(-(e.x * U - F.x), -(e.y * U - F.z)), d = Math.hypot(e.x * U - F.x, e.y * U - F.z), tp = Math.atan2(5 * 0.84 - 2.3, d);
      if (Math.abs(angDiff(ty, F.yaw)) < 0.12) { F.yaw += angDiff(ty, F.yaw) * Math.min(1, dt * 3); F.pitch += (tp - F.pitch) * Math.min(1, dt * 2); }
    }
    for (const q of parts) { q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt; q.vh -= q.g * dt; q.vx *= 0.95; q.vy *= 0.95; }
    parts = parts.filter(q => q.t > 0); for (const t of texts) t.t -= dt; texts = texts.filter(t => t.t > 0); shake = Math.max(0, shake - dt * 30);
    if ((F.hudT = (F.hudT || 0) - dt) <= 0) { F.hudT = 0.1; fpsHud(); }
    if (F.t <= 0 || e.dead) endRange(true);
    return;
  }
  const F = fps; F.t -= dt; F.cd -= dt; F.kick = Math.max(0, F.kick - dt * 8); F.flash.intensity = Math.max(0, F.flash.intensity - dt * 400); time += dt;
  if (mouse.l) fpsFire();
  // 出怪：越後面越快
  if ((F.spawnT -= dt) <= 0 && F.foes.filter(f => !f.dead).length < 10) {
    const k = clamp(1 - F.t / 60, 0, 1); F.spawnT = 1.5 - k * 0.9;
    const type = Math.random() < 0.15 + k * 0.2 ? 'brute' : Math.random() < 0.25 + k * 0.2 ? 'imp' : 'minion', D = FOES[type];
    const c = new Char(D.m, CLIPS.skel, D.tint); c.root.scale.setScalar(D.s); c.emissive(0x5a3018, 0.7); ents.add(c.root); c.once('Spawn_Ground_Skeletons', 2.4);
    const f = { c, type, hp: D.hp, s: D.s, x: rand(F.xMin, F.xMax), z: F.zFar, spd: rand(D.spd[0], D.spd[1]) * (1 + k * 0.4), wait: 0.6 };
    c.root.position.set(f.x, 0, f.z); F.foes.push(f);
  }
  for (const f of F.foes) {
    f.c.mixer.update(dt); f.c.lock -= dt;
    if (f.dead) { f.dieT -= dt; if (f.dieT < 0.5) f.c.root.position.y -= dt * 2; continue; }
    if ((f.wait -= dt) > 0) continue;
    const dx = F.x - f.x, dz = F.z - f.z, d = Math.hypot(dx, dz) || 1;
    f.x += dx / d * f.spd * dt; f.z += dz / d * f.spd * dt; f.c.root.position.set(f.x, 0, f.z); f.c.root.rotation.y = Math.atan2(dx, dz);
    if (f.c.lock <= 0) f.c.play('Running_A', true, f.spd / 3);
    if (d < 2.2) { // 衝到面前：扣一條命
      f.dead = true; f.dieT = 0.01; F.lives--; F.combo = 0; shake = 10; SND.hurt(); $('hurt').style.opacity = 1; setTimeout(() => $('hurt').style.opacity = 0, 200);
    }
  }
  F.foes = F.foes.filter(f => { if (f.dead && f.dieT <= 0) { f.c.dispose(); return false; } return true; });
  // 手機的輕微自動瞄準：準心附近有敵人時往它的胸口靠一點
  if (touchMode) {
    const D = fpsDir(new THREE.Vector3()); let bestA = 0.07, tgt = null;
    for (const f of F.foes) { if (f.dead) continue; v3.set(f.x - camera.position.x, 1.5 * f.s - camera.position.y, f.z - camera.position.z).normalize(); const a = Math.acos(clamp(v3.dot(D), -1, 1)); if (a < bestA) { bestA = a; tgt = f; } }
    if (tgt) { const ty = Math.atan2(-(tgt.x - F.x), -(tgt.z - F.z)); F.yaw += angDiff(ty, F.yaw) * Math.min(1, dt * 4); }
  }
  for (const q of parts) { q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt; q.vh -= q.g * dt; q.vx *= 0.95; q.vy *= 0.95; }
  parts = parts.filter(q => q.t > 0);
  for (const t of texts) t.t -= dt; texts = texts.filter(t => t.t > 0);
  shake = Math.max(0, shake - dt * 30);
  if ((F.hudT = (F.hudT || 0) - dt) <= 0) { F.hudT = 0.2; fpsHud(); }
  if (F.t <= 0 || F.lives <= 0) endRange(true);
}
function fpsCam() {
  camera.position.set(fps.x, 2.3, fps.z);
  if (shake > 0) { camera.position.x += rand(-1, 1) * shake * 0.01; camera.position.y += rand(-1, 1) * shake * 0.01; }
  camera.rotation.set(fps.pitch + fps.kick * 0.04, fps.yaw, 0, 'YXZ');
  fps.gun.position.set(0.32, -0.34 + Math.sin(time * 2) * 0.008, -0.75 + fps.kick * 0.12);
  scene.fog.near = 30; scene.fog.far = 110;
}
$('fpsFire').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fpsFire(); });
$('fpsQuit').addEventListener('click', () => endRange(true));
document.addEventListener('mousemove', e => { if (fps && !touchMode) { fps.yaw -= e.movementX * 0.0035; fps.pitch = clamp(fps.pitch - e.movementY * 0.0035, -0.7, 0.6); } });

// ---------- 輸入 ----------
addEventListener('keydown', e => {
  if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (fps) { if (e.code === 'Escape') endRange(true); else if (e.code === 'Space' || e.code === 'KeyJ') fpsFire(); e.preventDefault(); return; }
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
  if (fps) { if (e.pointerType === 'touch') { fpsDrag = { id: e.pointerId, x: e.clientX, y: e.clientY }; } else { if (!document.pointerLockElement && cv.requestPointerLock) try { cv.requestPointerLock(); } catch (er) { /* 沒差 */ } if (e.button === 0) mouse.l = true; } return; }
  if (e.pointerType === 'touch') {
    setTouch(true);
    if (joy.id === null && e.clientX < W * 0.55) { joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0; }
    return;
  }
  setTouch(false); mouse.x = e.clientX; mouse.y = e.clientY;
  if (e.button === 0) mouse.l = true; else if (e.button === 2) mouse.r = true;
});
addEventListener('pointermove', e => {
  if (fps && fpsDrag && e.pointerId === fpsDrag.id) { fps.yaw -= (e.clientX - fpsDrag.x) * 0.0105; fps.pitch = clamp(fps.pitch - (e.clientY - fpsDrag.y) * 0.0085, -0.7, 0.6); fpsDrag.x = e.clientX; fpsDrag.y = e.clientY; return; }
  if (e.pointerType === 'touch') {
    if (e.pointerId === joy.id) { const dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, m = Math.hypot(dx, dy), k = Math.min(1, m / 52) / (m || 1); joy.x = dx * k; joy.y = dy * k; }
    return;
  }
  mouse.x = e.clientX; mouse.y = e.clientY;
});
const up = e => { if (fpsDrag && e.pointerId === fpsDrag.id) fpsDrag = null; if (e.pointerId === joy.id) joy.id = null; if (e.pointerType !== 'touch') { if (e.button === 0) mouse.l = false; else if (e.button === 2) mouse.r = false; } };
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
  if (fps && state === 'play') { updateFps(dt); render3d(dt); }
  else if (state !== 'menu') {
    if (!touchMode) mouseWorld();
    if (cine) { cine.t -= Math.min(raw, 0.1); /* 演出用真實時間，低幀數時才不會拖很久 */ if (cine.kind === 'outro' && state === 'play' && !paused) update(dt * 0.25); if (cine.t <= 0) endCine(); }
    else if (hitStop > 0) hitStop -= dt;
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
  get p() { return p; }, get enemies() { return enemies; }, get state() { return state; }, get stairs() { return stairs; }, get boss() { return boss; }, get rooms() { return rooms; }, get props() { return props; }, get braziers() { return braziers; }, sacrifice, makeSetItem, SETS, get hero() { return hero; }, switchHero, get pools() { return pools; }, get holes() { return holes; }, refresh, heroLook, attack, cast, ignite, get merchant() { return merchant; }, talCan, talPts, openTal, tl, TALENTS, get pickNear() { return pickNear; }, clsOf, inClass, rollRarity, get renderer() { return renderer; }, exportText, openExport, startRange, endRange, fpsFire, updateFps, startSnipe, get fps() { return fps; }, get rangeObj() { return range; }, get cine() { return cine; }, bossShield, heatUp, NC, rollNC, drawPanel, get campFire() { return campFire; }, get scene() { return scene; }, get ents() { return ents; }, get corpses() { return corpses; }, dailyCheck, bounty, checkAch, openRec, weekRule, switchHero, get extraChars() { return extraChars; }, get campBlds() { return campBlds; }, openBld, closeBld, bl, get run() { return p.run; }, get prisoner() { return prisoner; }, get boardObj() { return board; }, startRun, finishRun, openBoard, freePrisoner, genCamp, get lockRoom() { return lockRoom; }, get cards() { return cards; }, takeCard, rollCards, SK, SKILLS, MODS, PAS, openStore, closeStore, get traps() { return traps; }, get shrine() { return shrine; }, heroLook, refresh,
  get quality() { return quality; }, setQuality(v) { autoQ = false; quality = v; applyQuality(); },
  update, descend, cast, keys, mouse, spawnEnemy, hurtPlayer, dropItem, makeItem, genFloor, setCam(i) { camMode = i; camReady = false; }, info: () => renderer.info.render,
};
