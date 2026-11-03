'use strict';
// =====================================================================
//  ФОН: дальний берег, вода с волнами, островок (небо и облака - в daytime.js)
// =====================================================================

// Волны: случайные штрихи, которые мерцают. Генерируются один раз при загрузке.
const waves = [];
(function makeWaves() {
  let seed = 7;   // фиксированное "зерно" - волны одинаковые при каждом запуске
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 150; i++) {
    const y = HORIZON + 3 + Math.floor(Math.pow(rnd(), 0.8) * (H - HORIZON - 6));
    const depth = (y - HORIZON) / (H - HORIZON);   // 0 вдали, 1 у берега
    waves.push({
      x: rnd() * W, y,
      len: 2 + Math.floor(depth * 6 * rnd() + depth * 2),
      phase: rnd() * Math.PI * 2,
      speed: 0.6 + rnd() * 1.2,
    });
  }
})();

// Облака: начальная позиция и скорость (пикселей в секунду)
const clouds = [
  { x: 30, y: 8, speed: 3 },
  { x: 190, y: 18, speed: 2 },
  { x: 270, y: 5, speed: 4 },
];

// Высота холмов дальнего берега в точке x
function hillHeight(x) {
  return 4 + 2 * Math.sin(x * 0.045) + 1.5 * Math.sin(x * 0.13 + 1) + Math.sin(x * 0.31);
}
const TREES = [22, 38, 61, 104, 117, 150, 208, 231, 246, 289, 301];   // x ёлок

// Островок с рыбаком: центр и радиусы эллипса
const ISLAND = { cx: 160, cy: 170, rx: 36, ry: 15 };

function drawFarShore() {
  for (let x = 0; x < W; x++) {
    const h = Math.round(hillHeight(x));
    rect(x, HORIZON - h, 1, h, C.hill);
    px(x, HORIZON - 1, C.hillDark);
  }
  for (const tx of TREES) {
    const base = HORIZON - Math.round(hillHeight(tx));
    for (let i = 0; i < 5; i++) rect(tx - i, base - 7 + i * 1.5, 1 + i * 2, 2, C.tree);
  }
}

function drawWater(t) {
  rect(0, HORIZON, W, 6, C.waterFar);
  rect(0, HORIZON + 6, W, 30, C.water2);
  rect(0, HORIZON + 36, W, H - HORIZON - 36, C.water1);
  for (const w of waves) {
    const s = Math.sin(t * w.speed + w.phase);
    if (s < 0.1) continue;
    const dx = Math.round(Math.sin(t * 0.7 + w.phase) * 2);
    const color = s > 0.75 ? C.foam : C.water3;
    rect((w.x + dx) % W, w.y, w.len, 1, color);
  }
}

function drawIsland(t) {
  const { cx, cy, rx, ry } = ISLAND;
  // Пена вокруг острова
  for (let a = 0; a < Math.PI; a += 0.06) {
    if (Math.sin(t * 3 + a * 9) < 0.2) continue;
    px(cx + Math.cos(a + Math.PI) * (rx + 5), cy - Math.sin(a) * (ry + 4), C.foam);
  }
  // Песок и трава построчно (эллипс)
  for (let y = -ry - 2; y <= ry + 2; y++) {
    const yy = cy + y;
    if (yy >= H) break;
    const k = 1 - (y / (ry + 2)) ** 2;
    if (k <= 0) continue;
    const half = Math.round((rx + 3) * Math.sqrt(k));
    rect(cx - half, yy, half * 2, 1, y > 0 ? C.sandDark : C.sand);
  }
  for (let y = -ry; y <= ry; y++) {
    const k = 1 - (y / ry) ** 2;
    if (k <= 0) continue;
    const half = Math.round(rx * Math.sqrt(k));
    rect(cx - half, cy + y, half * 2, 1, y < -ry * 0.4 ? C.grass : C.grassDark);
  }
  // Пучки травы и камыш
  const tufts = [-26, -15, 14, 25, -5];
  for (const tx of tufts) {
    const bx = cx + tx, by = cy - 6 + Math.abs(tx) / 6;
    px(bx, by, C.grassTuft); px(bx - 1, by + 1, C.grassTuft); px(bx + 1, by + 1, C.grassTuft);
  }
  const sway = Math.round(Math.sin(t * 1.5));
  line(cx - 30, cy - 2, cx - 31 + sway, cy - 13, C.grassTuft);
  line(cx - 27, cy - 3, cx - 27 + sway, cy - 11, C.grassTuft);
  rect(cx - 32 + sway, cy - 16, 2, 4, '#7c5800');
}
