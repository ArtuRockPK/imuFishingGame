'use strict';
// =====================================================================
//  ФОТО УЛОВА (поларойд по центру экрана)
//  Цвет рамки - по редкости рыбы (RARITIES в config.js): серый, синий, фиолетовый, золотой.
// =====================================================================

const PHOTO = { w: 96, h: 120, inset: 6, captionH: 30 };   // размеры рамки и полей

// t - сколько секунд показывается фото. Возвращает, где писать подпись.
function drawPhoto(t) {
  const slide = Math.min(1, t / 0.35);                     // выезжает сверху за 0.35 с
  const x0 = Math.round((W - PHOTO.w) / 2);
  const y0 = Math.round((H - PHOTO.h) / 2 - (1 - slide) * 150);

  // Затемнение сцены
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, W, H);

  // Рамка цвета редкости, с тенью снизу-справа
  const frame = game.rarity ? game.rarity.frame : '#fcfcfc';
  rect(x0 + 3, y0 + 3, PHOTO.w, PHOTO.h, '#000000');
  rect(x0, y0, PHOTO.w, PHOTO.h, frame);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(x0, y0 + PHOTO.h - 1, PHOTO.w, 1);
  ctx.fillRect(x0 + PHOTO.w - 1, y0, 1, PHOTO.h);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillRect(x0, y0, PHOTO.w, 1);
  ctx.fillRect(x0, y0, 1, PHOTO.h);

  // Снимок: всё, что дальше, рисуется только внутри окошка
  const px0 = x0 + PHOTO.inset, py0 = y0 + PHOTO.inset;
  const pw = PHOTO.w - PHOTO.inset * 2, ph = PHOTO.h - PHOTO.inset - PHOTO.captionH;
  ctx.save();
  ctx.beginPath();
  ctx.rect(px0, py0, pw, ph);
  ctx.clip();

  const horizon = py0 + 30;
  rect(px0, py0, pw, 12, C.sky1);
  rect(px0, py0 + 12, pw, horizon - py0 - 12, C.sky3);
  sprite(CLOUD, CLOUD_PAL, px0 + 48, py0 + 5);
  for (let x = 0; x < pw; x++) {
    const h = Math.round(hillHeight(x * 3 + 40) * 0.8);
    rect(px0 + x, horizon - h, 1, h, C.hill);
  }
  rect(px0, horizon, pw, ph, C.water2);
  rect(px0, horizon + 14, pw, ph, C.water1);
  for (let i = 0; i < 9; i++) rect(px0 + (i * 23) % pw, horizon + 4 + (i * 7) % 26, 3, 1, C.water3);
  // Берег под ногами
  rect(px0, py0 + ph - 12, pw, 12, C.grass);
  rect(px0, py0 + ph - 5, pw, 5, C.grassDark);

  // Рыбак анфас (x2) с рыбой в руке
  const fx = px0 + 14, fy = py0 + ph - 36;
  sprite(FISHER_FRONT, FISHER_PAL, fx, fy, FISHER_FRONT.length, false, 2);
  const wiggle = Math.floor(t * 3) % 2;
  drawFish(game.fish, fx + 35, fy + 21 + wiggle, true, 2);

  // Вспышка фотоаппарата
  if (t < 0.5) {
    ctx.fillStyle = `rgba(255, 255, 255, ${1 - t / 0.5})`;
    ctx.fillRect(px0, py0, pw, ph);
  }
  ctx.restore();

  // Искорки вокруг рамки
  const sparks = [[-6, 10], [PHOTO.w + 4, 24], [-4, PHOTO.h - 20], [PHOTO.w + 2, PHOTO.h - 8], [PHOTO.w / 2, -6]];
  sparks.forEach(([sx, sy], i) => {
    if (Math.floor(t * 4 + i) % 2) return;
    const cx = x0 + sx, cy = y0 + sy;
    px(cx, cy, C.accent); px(cx - 1, cy, C.accent); px(cx + 1, cy, C.accent);
    px(cx, cy - 1, C.accent); px(cx, cy + 1, C.accent);
  });

  return { x0, y0, captionY: y0 + PHOTO.h - PHOTO.captionH + 3 };
}
