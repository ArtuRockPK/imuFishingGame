'use strict';
// =====================================================================
//  ЗВУКИ (8-битные бипы, генерируются браузером - файлы не нужны)
//
//  beep(частота_Гц, длительность_с, { type, vol, slide, delay })
//    type  - форма волны: 'square' (NES), 'triangle' (мягче), 'sawtooth' (резче)
//    vol   - громкость (0.05 - нормально)
//    slide - к какой частоте плавно съехать за время звука
//    delay - задержка перед звуком, с
//  Новый звук: добавьте строку в sfx и вызывайте sfx.имя() из states.js.
// =====================================================================

let audio = null;
function beep(freq, dur, { type = 'square', vol = 0.06, slide = 0, delay = 0 } = {}) {
  try {
    audio = audio || new AudioContext();
    const t0 = audio.currentTime + delay;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(audio.destination);
    o.start(t0);
    o.stop(t0 + dur);
  } catch (_) { /* без звука */ }
}

// Шум (ветер, огонь, хруст): 1 секунда белого шума, из него режутся звуки.
// noiseHit(длительность, { vol, type, freq, freq2, q, delay }) - короткий шум через фильтр:
//   type - 'lowpass' (глухо), 'highpass' (шипение), 'bandpass' (полоса около freq),
//   freq2 - к какой частоте фильтра съехать за время звука (свист "фух")
let noiseBuf = null;
function noiseBuffer() {
  if (!noiseBuf) {
    noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function noiseHit(dur, { vol = 0.1, type = 'bandpass', freq = 1000, freq2 = 0, q = 1, delay = 0, attack = 0.01 } = {}) {
  try {
    audio = audio || new AudioContext();
    const t0 = audio.currentTime + delay;
    const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    src.buffer = noiseBuffer();
    src.loop = true;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(audio.destination);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  } catch (_) { /* без звука */ }
}

// Писк комара (mosquito.js): непрерывный звук, пока комар летает.
// buzzSet(vol, pan): громкость 0..1 и откуда слышно (0 - слева, 1 - справа)
let buzz = null;
function buzzStart() {
  buzzStop();
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), lfo = audio.createOscillator();
    const lfoGain = audio.createGain(), g = audio.createGain();
    const pan = audio.createStereoPanner ? audio.createStereoPanner() : null;
    o.type = 'sawtooth';
    o.frequency.value = 620;
    lfo.frequency.value = 28;               // дрожание частоты - "жжжж"
    lfoGain.gain.value = 45;
    lfo.connect(lfoGain).connect(o.frequency);
    g.gain.value = 0.0001;
    o.connect(g);
    if (pan) g.connect(pan).connect(audio.destination); else g.connect(audio.destination);
    o.start();
    lfo.start();
    buzz = { o, lfo, g, pan };
  } catch (_) { buzz = null; }
}
function buzzSet(vol, pan = 0.5) {
  if (!buzz) return;
  const t = audio.currentTime;
  buzz.g.gain.setTargetAtTime(Math.max(0.0001, vol * 0.035), t, 0.05);
  if (buzz.pan) buzz.pan.pan.setTargetAtTime(pan * 2 - 1, t, 0.05);
}
function buzzStop() {
  if (!buzz) return;
  try {
    const t = audio.currentTime;
    buzz.g.gain.setTargetAtTime(0.0001, t, 0.03);
    buzz.o.stop(t + 0.2);
    buzz.lfo.stop(t + 0.2);
  } catch (_) { /* уже остановлен */ }
  buzz = null;
}

const sfx = {
  lock:   () => { beep(660, 0.08); beep(990, 0.1, { delay: 0.07 }); },     // точка выбрана
  ready:  () => beep(440, 0.12, { type: 'triangle', vol: 0.1 }),          // можно забрасывать
  cast:   () => beep(900, 0.35, { type: 'sawtooth', vol: 0.04, slide: 200 }),
  splash: () => beep(180, 0.25, { type: 'triangle', vol: 0.12, slide: 60 }),
  reel:   () => beep(300, 0.06, { vol: 0.03 }),                            // треск катушки
  bite:   () => { for (let i = 0; i < 3; i++) beep(1320, 0.09, { vol: 0.08, delay: i * 0.13 }); },
  hook:   () => beep(520, 0.15, { slide: 1040, vol: 0.07 }),               // подсечка
  crank:  () => beep(760, 0.05, { vol: 0.05 }),                            // поворот при вываживании
  tension: () => { beep(330, 0.12, { vol: 0.08 }); beep(247, 0.18, { vol: 0.08, delay: 0.13 }); },   // рыба тянет
  snap:   () => beep(1400, 0.12, { type: 'sawtooth', vol: 0.08, slide: 150 }),   // леска лопнула
  slap:   () => beep(140, 0.08, { vol: 0.1, slide: 60 }),                  // хлопок мимо комара / рыба шлёпнулась
  meow:   () => { beep(620, 0.12, { type: 'triangle', vol: 0.09, slide: 900 });          // кот: "мя-у"
                  beep(900, 0.3, { type: 'triangle', vol: 0.09, slide: 480, delay: 0.12 }); },
  laugh:  () => [1500, 1900, 1500, 2000, 1400].forEach((f, i) =>           // комар хихикает: "хи-хи-хи"
            beep(f, 0.08, { type: 'triangle', vol: 0.08, slide: f * 1.25, delay: 0.15 + i * 0.1 })),
  splat:  () => { beep(200, 0.1, { type: 'sawtooth', vol: 0.1, slide: 50 }); beep(90, 0.15, { vol: 0.1, delay: 0.05 }); },
  // Ночной костёр (campfire.js)
  blow:   () => noiseHit(0.5, { vol: 0.22, freq: 500, freq2: 1400, q: 0.8, attack: 0.08 }),     // "фух" - огонь раздувается
  ignite: () => { noiseHit(0.9, { vol: 0.3, type: 'lowpass', freq: 400, freq2: 1800, attack: 0.15 });
                  [392, 523, 659, 784].forEach((f, i) => beep(f, 0.14, { type: 'triangle', vol: 0.08, delay: 0.3 + i * 0.09 })); },
  crunch: () => { noiseHit(0.09, { vol: 0.25, type: 'highpass', freq: 1800 }); beep(170, 0.06, { vol: 0.06, slide: 90 }); },
  yum:    () => [523, 659, 784, 659, 1047].forEach((f, i) =>                // "м-м, вкусно!"
            beep(f, i < 4 ? 0.1 : 0.35, { type: 'triangle', vol: 0.09, delay: i * 0.1 })),
  caught: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.12, { vol: 0.07, delay: i * 0.1 })),
  lost:   () => [392, 330, 262].forEach((f, i) => beep(f, 0.18, { type: 'triangle', vol: 0.1, delay: i * 0.16 })),
  pickup: () => [523, 784, 1047, 1568].forEach((f, i) => beep(f, 0.1, { type: 'triangle', vol: 0.09, delay: i * 0.07 })),
  win:    () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => beep(f, i < 6 ? 0.12 : 0.5, { vol: 0.07, delay: i * 0.12 })),
  gameover: () => [392, 370, 349, 330, 196].forEach((f, i) => beep(f, i < 4 ? 0.22 : 0.6, { type: 'triangle', vol: 0.1, delay: i * 0.25 })),
};
