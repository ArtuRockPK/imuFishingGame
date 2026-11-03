'use strict';
// =====================================================================
//  ЭФФЕКТЫ НА ВОДЕ: круги, брызги, пузырьки над рыбной зоной
//  Добавить эффект: addRipple(x, y, размер) или addSplash(x, y, сколько капель).
// =====================================================================

// ---------- Круги на воде ----------
const ripples = [];
function addRipple(x, y, size = 1) {
  ripples.push({ x, y, age: 0, life: 0.8 + size * 0.4, max: 4 + size * 8 });
}
function drawRipples(dt) {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.age += dt;
    if (r.age >= r.life) { ripples.splice(i, 1); continue; }
    const k = r.age / r.life;
    const rx = 2 + k * r.max, ry = rx * 0.4;
    const color = k < 0.5 ? C.foam : C.water3;
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      px(r.x + Math.cos(a) * rx, r.y + Math.sin(a) * ry, color);
    }
  }
}

// ---------- Брызги ----------
const splashes = [];
function addSplash(x, y, n = 10) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * (0.15 + 0.7 * Math.random());
    const v = 25 + Math.random() * 35;
    splashes.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0 });
  }
}
function drawSplashes(dt) {
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i];
    s.age += dt;
    s.vy += 160 * dt;         // гравитация
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.age > 0.6) { splashes.splice(i, 1); continue; }
    px(s.x, s.y, C.foam);
  }
}

// ---------- Пузырьки над рыбной зоной ----------
const bubbles = [];
function drawBubbles(dt) {
  if (fishZone && Math.random() < dt * 4) {   // ~4 пузырька в секунду
    const r = zoneRect();
    bubbles.push({ x: rand(r.x + 2, r.x + r.w - 2), y: rand(r.y + 2, r.y + r.h - 2), age: 0, life: rand(0.6, 1.2) });
  }
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.age += dt;
    if (b.age >= b.life) { bubbles.splice(i, 1); continue; }
    const k = b.age / b.life;
    const y = b.y - k * 3;
    if (k < 0.85) {
      px(b.x, y, C.bubble);
      if (k > 0.3) { px(b.x + 1, y, C.bubble); px(b.x, y - 1, C.bubble); px(b.x + 1, y - 1, C.bubble); }
    } else {
      // лопнул
      px(b.x - 1, y, C.foam); px(b.x + 2, y, C.foam);
    }
  }
}
