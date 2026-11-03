'use strict';
// =====================================================================
//  РИСОВАНИЕ: холсты и базовые функции (пиксель, линия, спрайт, текст)
//
//  Сцена рисуется на холсте 320x180 и растягивается без сглаживания -
//  отсюда пиксельный вид. Текст рисуется на втором холсте поверх,
//  в настоящем разрешении экрана, поэтому он резкий.
//  Координаты везде одинаковые: x от 0 до 320, y от 0 до 180.
// =====================================================================

const stage = document.getElementById('stage');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { willReadFrequently: true });   // холст сцены (daytime.js читает его пиксели)
const hud = document.getElementById('hud');
const hctx = hud.getContext('2d');        // холст текста
let scale = 1;

// Подгоняем размер под окно браузера (целое увеличение, чтобы пиксели были ровными)
function fitCanvas() {
  scale = Math.max(1, Math.floor(Math.min(innerWidth / W, innerHeight / H)));
  const dpr = window.devicePixelRatio || 1;
  stage.style.width = canvas.style.width = hud.style.width = W * scale + 'px';
  stage.style.height = canvas.style.height = hud.style.height = H * scale + 'px';
  hud.width = Math.round(W * scale * dpr);
  hud.height = Math.round(H * scale * dpr);
  hctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);   // координаты текста = координаты сцены
}
addEventListener('resize', fitCanvas);
fitCanvas();

// Прямоугольник w x h цвета color
function rect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

// Один пиксель
function px(x, y, color) { rect(x, y, 1, 1, color); }

// Пиксельная линия (алгоритм Брезенхема), чтобы леска и удочка не размывались
function line(x0, y0, x1, y1, color) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  ctx.fillStyle = color;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Изогнутая линия от точки a к точке b, ctrl - куда она "тянется" (леска, согнутая удочка)
function curve(a, ctrl, b, color, n = 16) {
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * ctrl.x + u * u * b.x;
    const y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * ctrl.y + u * u * b.y;
    line(prev.x, prev.y, x, y, color);
    prev = { x, y };
  }
}

// Спрайт - картинка из строк (см. sprites.js). Каждая буква - цвет из палитры pal,
// '.' - прозрачно. maxRows - сколько строк сверху рисовать, flip - отразить по горизонтали,
// s - увеличение (2 = каждый пиксель 2x2).
function sprite(rows, pal, x, y, maxRows = rows.length, flip = false, s = 1) {
  x = Math.round(x); y = Math.round(y);
  for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const col = pal[row[c]];
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x + (flip ? row.length - 1 - c : c) * s, y + r * s, s, s);
      }
    }
  }
}

// Текст. align: 'left' | 'center' | 'right' - относительно точки x. size - размер шрифта.
function text(str, x, y, color = C.text, align = 'center', size = 8, shadow = true) {
  hctx.font = `${size}px "Press Start 2P", "DotGothic16", monospace`;   // DotGothic16 - для иероглифов
  hctx.textAlign = align;
  hctx.textBaseline = 'top';
  if (shadow) {
    hctx.fillStyle = C.textShadow;
    hctx.fillText(str, x + 1, y + 1);
  }
  hctx.fillStyle = color;
  hctx.fillText(str, x, y);
}
