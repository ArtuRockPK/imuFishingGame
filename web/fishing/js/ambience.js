'use strict';
// =====================================================================
//  ЗВУКИ ПРИРОДЫ: ветер, плеск озера, шелест камыша, птицы днём,
//  сверчки, лягушки и сова ночью, петух вдалеке на рассвете, треск костра
//
//  Всё делает браузер из шума и простых волн - файлов нет. Что и как громко
//  звучит, зависит от времени суток (daytime.js): updateAmbience() вызывается
//  каждый кадр и сам решает, когда запеть птице или квакнуть лягушке.
//  Громкость всего - DAYTIME.ambienceVol (config.js), клавиша V - вкл/выкл.
// =====================================================================

let amb = null;            // всё про звуки природы, пока они играют
let ambienceOn = true;

function startAmbience() {
  try {
    audio = audio || new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    if (amb) return;
    const master = audio.createGain();
    master.gain.value = 0;
    master.connect(audio.destination);

    // 2 секунды белого шума по кругу: из него сделаны ветер, шелест и плеск
    const buf = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const noise = (type, freq, q, panPos) => {
      const src = audio.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = audio.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = audio.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(panner(panPos)).connect(master);
      src.start(0, Math.random() * 2);
      return { f, g };
    };

    amb = {
      master,
      wind: noise('bandpass', 500, 0.6, -0.2),       // ветер: гул, который накатывает порывами
      wind2: noise('bandpass', 900, 1.2, 0.4),       // свист повыше, с другой стороны
      rustle: noise('highpass', 2800, 0.5, 0.1),     // шелест камыша в порывы
      lap: noise('lowpass', 380, 0.9, 0),            // волны плещут о берег острова
      fire: noise('lowpass', 220, 0.7, -0.3),        // гул костра (campfire.js)
      gust: 0.3, gustTarget: 0.5, gustAt: 0,
      lapAt: 0, crackleAt: 0, birdAt: 1, cuckooAt: 20, frogAt: 3, owlAt: 30,
      crickets: [{ at: 0, f: 4300, pan: -0.6 }, { at: 0.3, f: 4700, pan: 0.5 }],
    };
  } catch (_) { amb = null; }
}

function panner(p) {
  if (!audio.createStereoPanner) return audio.createGain();
  const n = audio.createStereoPanner();
  n.pan.value = p;
  return n;
}

// Короткий тон с огибающей: freq -> freq2 за dur секунд, начиная с момента t
function ambTone(type, freq, freq2, t, dur, vol, pan, filterHz = 0) {
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freq2 !== freq) o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (filterHz) {
    const f = audio.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterHz;
    node = node.connect(f);
  }
  node.connect(g).connect(panner(pan)).connect(amb.master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// Насколько сейчас ночь, день и утренний птичий хор (0..1)
function natureLevels() {
  const L = lightAt(clock.hour), h = clock.hour;
  const night = L.stars;
  const chorus = h > 4.5 && h < 8 ? Math.sin(Math.PI * (h - 4.5) / 3.5) : 0;   // пик - к восходу
  return { night, day: 1 - night, chorus };
}

// ---------- Голоса ----------
// Птица: одна из трёх песен - "чик-чирик", трель или посвист "фиу-фиу"
function birdSong(t, vol) {
  const pan = rand(-0.9, 0.9);
  const kind = randInt(0, 2);
  if (kind === 0) {
    const n = randInt(3, 6), f = rand(3000, 4500);
    for (let i = 0; i < n; i++) ambTone('sine', f, f * rand(1.15, 1.4), t + i * rand(0.09, 0.13), 0.07, vol, pan);
  } else if (kind === 1) {
    const n = randInt(8, 14), f = rand(4500, 5800);
    for (let i = 0; i < n; i++) ambTone('sine', f * (1 - i * 0.012), f * 0.9, t + i * 0.045, 0.03, vol * 0.7, pan);
  } else {
    const f = rand(1900, 2500);
    ambTone('sine', f, f * 1.3, t, 0.22, vol, pan);
    ambTone('sine', f * 1.35, f * 0.95, t + 0.3, 0.28, vol, pan);
  }
}

// Кукушка вдалеке: "ку-ку" несколько раз
function cuckoo(t, vol) {
  const pan = rand(-0.8, 0.8), n = randInt(2, 4);
  for (let i = 0; i < n; i++) {
    ambTone('triangle', 680, 670, t + i * 0.75, 0.2, vol, pan, 1500);
    ambTone('triangle', 560, 550, t + i * 0.75 + 0.27, 0.3, vol, pan, 1500);
  }
}

// Сверчок: серия из 3-4 коротких цвирков
function cricket(c, t, vol) {
  const n = randInt(3, 4);
  for (let i = 0; i < n; i++) ambTone('sine', c.f, c.f, t + i * 0.038, 0.022, vol, c.pan);
}

// Лягушка: "ква" - низкий хриплый тон, нарезанный на частые импульсы
function frog(t, vol) {
  const pan = rand(-0.9, 0.9), f = rand(95, 140), n = randInt(1, 3);
  for (let k = 0; k < n; k++) {
    const t0 = t + k * rand(0.45, 0.6);
    const o = audio.createOscillator(), flt = audio.createBiquadFilter(), g = audio.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t0);
    o.frequency.exponentialRampToValueAtTime(f * 0.8, t0 + 0.32);
    flt.type = 'lowpass'; flt.frequency.value = 700; flt.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t0);
    for (let i = 0; i < 7; i++) {
      g.gain.setTargetAtTime(vol, t0 + i * 0.045, 0.005);
      g.gain.setTargetAtTime(0.0001, t0 + i * 0.045 + 0.022, 0.008);
    }
    o.connect(flt).connect(g).connect(panner(pan)).connect(amb.master);
    o.start(t0);
    o.stop(t0 + 0.4);
  }
}

// Сова: "у-ху... ху-у-у"
function owl(t, vol) {
  const pan = rand(-0.7, 0.7);
  ambTone('sine', 420, 390, t, 0.3, vol, pan);
  ambTone('sine', 400, 360, t + 0.45, 0.75, vol, pan);
}

// Петух в деревне за озером: "ку-ка-ре-ку-у-у"
function rooster() {
  if (!amb || !ambienceOn) return;
  const t = audio.currentTime + 0.1, vol = 0.05, pan = -0.7;
  ambTone('sawtooth', 520, 700, t, 0.14, vol, pan, 1800);
  ambTone('sawtooth', 700, 680, t + 0.17, 0.12, vol, pan, 1800);
  ambTone('sawtooth', 680, 820, t + 0.32, 0.16, vol, pan, 1800);
  ambTone('sawtooth', 820, 480, t + 0.52, 0.75, vol, pan, 1800);
}
atHour(DAYTIME.sunrise - 0.4, rooster);

// Рыба плеснула (daytime.js). pan: -1 слева, 1 справа
function ambiencePlop(pan) {
  if (!amb || !ambienceOn || paused) return;
  const t = audio.currentTime;
  ambTone('sine', 700, 160, t, 0.12, 0.07, pan);
  ambTone('sine', 1300, 500, t + 0.08, 0.06, 0.03, pan);
}

// Каждый кадр (main.js)
function updateAmbience(dt) {
  if (!amb) return;
  const t = audio.currentTime;
  const playing = ambienceOn && !paused && game.state !== 'wait';
  amb.master.gain.setTargetAtTime(playing ? DAYTIME.ambienceVol : 0, t, 0.6);
  if (!playing) return;
  const lv = natureLevels();

  // Ветер: каждые несколько секунд новый порыв, сила плавно догоняет цель. Ночью тише
  if (t >= amb.gustAt) {
    amb.gustTarget = Math.random() < 0.25 ? rand(0.7, 1) : rand(0.1, 0.5);
    amb.gustAt = t + rand(2.5, 7);
  }
  amb.gust += (amb.gustTarget - amb.gust) * Math.min(1, dt * 0.6);
  const calm = 1 - 0.45 * lv.night, g = amb.gust;
  amb.wind.g.gain.setTargetAtTime((0.05 + 0.13 * g) * calm, t, 0.2);
  amb.wind.f.frequency.setTargetAtTime(300 + 450 * g, t, 0.3);
  amb.wind2.g.gain.setTargetAtTime(0.03 * g * g * calm, t, 0.3);
  amb.wind2.f.frequency.setTargetAtTime(700 + 500 * g, t, 0.3);
  amb.rustle.g.gain.setTargetAtTime(0.022 * g * g * calm, t, 0.15);

  // Плеск волн о берег: в ветер чаще и громче
  if (t >= amb.lapAt) {
    const vol = rand(0.08, 0.16) * (0.6 + 0.6 * g);
    amb.lap.g.gain.setTargetAtTime(vol, t, 0.07);
    amb.lap.g.gain.setTargetAtTime(0, t + rand(0.15, 0.3), 0.25);
    amb.lap.f.frequency.setValueAtTime(rand(280, 480), t);
    amb.lapAt = t + rand(0.8, 2.4) / (0.7 + 0.6 * g);
  }

  // Костёр: гудит и потрескивает. В сцене костра - по силе огня, у рыбака на острове - тише
  const fireVol = game.state === 'campfire' ? Math.min(1, fire.level + fire.flare * 0.5)
                : game.campfireLit ? 0.3 : 0;
  amb.fire.g.gain.setTargetAtTime(0.12 * fireVol, t, 0.2);
  if (fireVol > 0.05 && t >= amb.crackleAt) {
    noiseHit(rand(0.015, 0.04), { vol: rand(0.04, 0.14) * fireVol * DAYTIME.ambienceVol * 2, type: 'highpass', freq: rand(1500, 5000) });
    amb.crackleAt = t + rand(0.04, 0.35) / (0.4 + fireVol);
  }

  // Птицы: днём время от времени, на рассвете - целый хор
  if (t >= amb.birdAt) {
    if (lv.day > 0.3) birdSong(t, 0.025 * (lv.day + lv.chorus * 0.6));
    amb.birdAt = t + rand(1.5, 7) / (1 + lv.chorus * 4);
  }
  if (t >= amb.cuckooAt) {
    if (clock.hour > 5.5 && clock.hour < 11) cuckoo(t, 0.035);
    amb.cuckooAt = t + rand(25, 60);
  }

  // Ночь: сверчки без остановки, лягушки, изредка сова
  for (const c of amb.crickets) {
    if (t < c.at) continue;
    if (lv.night > 0.25) cricket(c, t, 0.012 * lv.night);
    c.at = t + rand(0.45, 0.85);
  }
  if (t >= amb.frogAt) {
    if (lv.night > 0.35) frog(t, 0.05 * lv.night);
    amb.frogAt = t + rand(2.5, 9);
  }
  if (t >= amb.owlAt) {
    if (lv.night > 0.8) owl(t, 0.05);
    amb.owlAt = t + rand(25, 55);
  }
}
