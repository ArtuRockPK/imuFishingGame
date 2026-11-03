'use strict';
// Мелкие помощники, которые нужны в разных файлах

// Случайное дробное число от a до b
const rand = (a, b) => a + Math.random() * (b - a);

// Случайное целое число от a до b включительно
const randInt = (a, b) => Math.floor(rand(a, b + 1));

// Значение 0..1..0..1 "туда-обратно" - так ездит маркер прицела.
// t - время, period - сколько секунд длится один проезд.
function pingPong(t, period) {
  const u = (t / period) % 2;
  return u < 1 ? u : 2 - u;
}
