'use strict';
// =====================================================================
//  СПРАЙТЫ (пиксельные картинки)
//
//  Картинка - это массив строк одинаковой длины. Каждый символ - один пиксель:
//  буква берёт цвет из палитры (*_PAL), точка '.' - прозрачный пиксель.
//  Чтобы перерисовать персонажа, просто меняйте буквы в строках.
// =====================================================================

// Рыбак со спины (смотрит на воду), 12x17
const FISHER = [
  '....HHHH....',
  '...HHHHHH...',
  '..hhhhhhhh..',
  'HHHHHHHHHHHH',
  '..KKKKKKKK..',
  '..KKKKKKKK..',
  '...KSSSSK...',
  '..RRRRRRRR..',
  '.RRRRRRRRRR.',
  'SRRRRrrRRRRS',
  'S.RRRrrRRR.S',
  '..RRRRRRRR..',
  '..BBBBBBBB..',
  '..BBBbbBBB..',
  '..BBB..BBB..',
  '..BBB..BBB..',
  '..DDD..DDD..',
];

// Стойка при поклёвке: ноги шире, руки подняты к удочке
const FISHER_STANCE = [
  '....HHHH....',
  '...HHHHHH...',
  '..hhhhhhhh..',
  'HHHHHHHHHHHH',
  '..KKKKKKKK..',
  '..KKKKKKKK..',
  'S..KSSSSK..S',
  'SRRRRRRRRRRS',
  '.RRRRRRRRRR.',
  '..RRRrrRRR..',
  '..RRRrrRRR..',
  '..RRRRRRRR..',
  '..BBBBBBBB..',
  '.BBBbbbbBBB.',
  '.BBB....BBB.',
  'BBB......BBB',
  'DDD......DDD',
];

// Сидит на стульчике (стик отложили), 12x15
const FISHER_SIT = [
  '....HHHH....',
  '...HHHHHH...',
  '..hhhhhhhh..',
  'HHHHHHHHHHHH',
  '..KKKKKKKK..',
  '..KKKKKKKK..',
  '...KSSSSK...',
  '..RRRRRRRR..',
  '.RRRRRRRRRR.',
  'SRRRRrrRRRRS',
  'S.RRRrrRRR.S',
  '.BBBBBBBBBB.',
  'DBBTTTTTTBBD',
  'D..T....T..D',
  '...T....T...',
];

// Анфас для фото с уловом, 12x17
const FISHER_FRONT = [
  '....HHHH....',
  '...HHHHHH...',
  '..hhhhhhhh..',
  'HHHHHHHHHHHH',
  '..KSSSSSSK..',
  '..SeSSSSeS..',
  '..SSSSSSSS..',
  '...SSmmSS...',
  '..RRRRRRRR..',
  '.RRRRRRRRRR.',
  'SRRRRrrRRRRS',
  'S.RRRrrRRR.S',
  '..BBBBBBBB..',
  '..BBBbbBBB..',
  '..BBB..BBB..',
  '..BBB..BBB..',
  '..DDD..DDD..',
];

// Цвета рыбака: H/h - шляпа, K - волосы, S - кожа, R/r - рубашка, B/b - штаны,
// D - ботинки, T - стульчик, e - глаза, m - рот
const FISHER_PAL = {
  H: '#f8d878', h: '#ac7c00', K: '#503000', S: '#fcb8a0',
  R: '#d82800', r: '#a81000', B: '#0058f8', b: '#0038a8', D: '#503000',
  T: '#7c5800', e: '#000000', m: '#a81000',
};

// Поплавок 5x9: сверху антенна (хвостик) с яркой верхушкой, ниже тело
const FLOAT = [
  '..y..',
  '..k..',
  '..k..',
  '..r..',
  '.rrr.',
  '.rrr.',
  'wwwww',
  '.www.',
  '..w..',
];
const FLOAT_PAL = { r: C.floatTop, w: C.floatBottom, k: '#303030', y: '#fce040' };

// Стрелка маркера прицела 7x4
const ARROW = [
  'yyyyyyy',
  '.yyyyy.',
  '..yyy..',
  '...y...',
];
const ARROW_PAL = { y: C.marker };

// Червячок (жизнь) 9x4 - в правом верхнем углу
// Червячок на крючке 7x10: h - крючок, p/P - червячок
const WORM = [
  '....hh.',
  '....h..',
  '..ppPpp',
  '.p..h..',
  'p..pPp.',
  '..p.h.p',
  'h...h.p',
  'hh..h..',
  '.h..h..',
  '..hh...',
];
const WORM_PAL      = { h: '#bcbcbc', p: '#fc9cb8', P: '#d84878' };   // живой червячок
const WORM_LOST_PAL = { h: '#000000', p: '#000000', P: '#000000' };   // потерянный - тёмный силуэт

// Пластиковый пакет 11x9, плывёт по воде. w - пакет, s - тень/складки, e - вода в пакете
const BAG = [
  '.ww.....ww.',
  'w..w...w..w',
  'w..w...w..w',
  'wwwwwwwwwww',
  'wwwwwwwwwws',
  'wwswwwwwwws',
  'wwwsswwwwss',
  '.eeeeeeeee.',
  '..eeeeeee..',
];
const BAG_PAL = { w: '#fcfcfc', s: '#bcbcbc', e: '#a4e4fc' };

// Кусочек хлеба (прикормка) 8x6: c - корочка, C - тёмная корочка, m - мякиш, d - поры
const BREAD = [
  '.cccccc.',
  'cCmmmmCc',
  'cmmdmmmc',
  'cmmmmdmc',
  'cmdmmmmc',
  '.CCCCCC.',
];
const BREAD_PAL = { c: '#c88c30', C: '#7c4800', m: '#fce0a8', d: '#e4b860' };

// Комар 18x12, летит влево (рисуется увеличенным x2). Два кадра - крылья вверх / назад.
// p - хоботок, h - голова, e - глаз, b - тело, s - полоски, l - лапки, w/W - крылья
const MOSQUITO_A = [
  '........w...w.....',
  '.......wWw.wWw....',
  '.......wWWwWWw....',
  '........wWWWw.....',
  '...hh.bbbw........',
  'pphehbbbbbsbsbsb..',
  '...hh.bbbbsbsbsbs.',
  '......l.l.l.......',
  '.....l..l..l......',
  '....l...l...l.....',
  '...l...l.....l....',
  '..l....l......l...',
];
const MOSQUITO_B = [
  '..................',
  '..................',
  '........wwwwww....',
  '.......wWWWWWWww..',
  '...hh.bbbwWWww....',
  ...MOSQUITO_A.slice(5),
];
// Прихлопнутый комар 10x5 (на ладони x2 и как прикормка x1), r - пятнышко
const MOSQUITO_DEAD = [
  'l..w..w..l',
  '.lwWwwWwl.',
  'phhbbsbsb.',
  '.l.rrr..l.',
  'l..l..l..l',
];
const MOSQUITO_PAL = {
  p: '#202020', h: '#202020', e: '#f83800', b: '#3c3c3c', s: '#bcbcbc',
  l: '#585858', w: '#a4e4fc', W: '#d8f8f8', r: '#d82800',
};

// Кот 16x10, смотрит вправо (рисуется увеличенным x2). Два кадра - лапы.
// o - рыжий, d - полоски, w - белая мордочка, k - глаз и нос
const CAT_A = [
  '...........o...o',
  '...........oo.oo',
  'o..........ooooo',
  'o..........okook',
  '.o...oooooooowwo',
  '..oodododododoo.',
  '....odododododo.',
  '....oooooooooo..',
  '....o.o....o.o..',
  '....o.o....o.o..',
];
const CAT_B = [
  ...CAT_A.slice(0, 8),
  '.....o.o..o.o...',
  '.....o.o..o.o...',
];
const CAT_PAL = { o: '#e47c30', d: '#a84c10', w: '#fcfcfc', k: '#202020' };

// Облако 16x5
const CLOUD = [
  '....wwww........',
  '..wwwwwwww..ww..',
  '.wwwwwwwwwwwwww.',
  'wwwwwwwwwwwwwwww',
  '.ssssssssssssss.',
];
const CLOUD_PAL = { w: C.cloud, s: C.cloudShade };

// Рыба 12x6. Цвета подставляются из FISH_TYPES (config.js):
// b - тело, s - полоски, f - плавники, k - глаз
const FISH_SPRITE = [
  '...ffff.....',
  '.bbbbbbbb.f.',
  'bkbsbsbsbbff',
  'bbbsbsbsbbff',
  '.bbbbbbbb.f.',
  '...ff.......',
];
