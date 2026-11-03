'use strict';
// =====================================================================
//  СОСТОЯНИЯ ИГРЫ - главный файл для новых механик
//
//  Каждое состояние описывается так (все части необязательные):
//
//    имяСостояния: {
//      hint: () => T('ключ'),       // подсказка вверху экрана (текст берётся из i18n.js)
//      alert: true,                 // подсказка мигает жёлтым (важный момент)
//      enter() { ... },             // один раз при входе в состояние
//      onEvent(id, code) { ... },   // пришло событие от стика: id - EV.TAP2, EV.HIGH_G, ...
//      update(dt, t) { ... },       // каждый кадр: dt - секунд с прошлого кадра,
//                                   //              t  - секунд с начала состояния
//    },
//
//  Перейти в другое состояние: setState('имя').
//  Как рисуется каждое состояние - в draw.js.
// =====================================================================

// Клюёт: поплавок скрылся под водой, нужна подсечка (состояние bite)
function startBite() {
  game.hookType = Math.random() < FISH.hookJerkChance ? 'jerk' : 'turn';
  sfx.bite();
  addSplash(game.floatX, game.floatY, 6);
  if (game.hookType === 'jerk') say(T('msg_jerk'), C.accent, 16);
  setState('bite');
}

// Плавно повернуть удочку к углу target (speed - насколько быстро)
function turnRodTo(target, dt, speed) {
  rodAngle += (target - rodAngle) * Math.min(1, dt * speed);
}

const STATES = {

  // ---------- Ждём подключения контроллера ----------
  wait: {},

  // ---------- Шаг 1: маркер ездит слева направо, выбираем столбец ----------
  aimX: {
    hint: () => T('hint_aim_x'),
    onEvent(id) {
      if (id === EV.TAP2) {
        game.targetX = game.markerX;
        sfx.lock();
        setState('aimY');
      }
    },
    update(dt, t) {
      game.markerX = AIM.xMin + pingPong(t, AIM.sweepSec) * (AIM.xMax - AIM.xMin);
      game.markerY = AIM.rowY;
    },
  },

  // ---------- Шаг 2: маркер ездит от берега вдаль, выбираем дальность ----------
  aimY: {
    hint: () => T('hint_aim_y'),
    onEvent(id) {
      if (id === EV.TAP2) {
        game.targetY = game.markerY;
        sfx.ready();
        setState('ready');
      }
    },
    update(dt, t) {
      game.markerX = game.targetX;
      game.markerY = AIM.yNear - pingPong(t, AIM.sweepSec) * (AIM.yNear - AIM.yFar);
    },
  },

  // ---------- Точка выбрана, ждём взмах (HIGH-G) ----------
  ready: {
    hint: () => T('hint_ready'),
    alert: true,
    onEvent(id) {
      if (id === EV.HIGH_G) {
        game.castFrom = rodTip();
        const d = Math.hypot(game.targetX - game.castFrom.x, game.targetY - game.castFrom.y);
        game.castDur = 0.55 + d / 260;      // дальше - дольше летит
        sfx.cast();
        setState('casting');
      }
    },
    update(dt) {
      turnRodTo(ROD_ANGLE.back, dt, 6);     // замах: удочка плавно отводится назад
    },
  },

  // ---------- Прикормка: выбор сектора (как прицел), потом HIGH-G ----------
  baitAimX: {
    hint: () => T('hint_bait_x'),
    alert: true,
    onEvent(id) {
      if (id === EV.TAP2) {
        game.targetX = game.markerX;
        sfx.lock();
        setState('baitAimY');
      }
    },
    update(dt, t) { STATES.aimX.update(dt, t); },   // маркер ездит так же, как при забросе
  },

  baitAimY: {
    hint: () => T('hint_bait_y'),
    onEvent(id) {
      if (id === EV.TAP2) {
        game.targetY = game.markerY;
        sfx.ready();
        setState('baitReady');
      }
    },
    update(dt, t) { STATES.aimY.update(dt, t); },
  },

  // Сектор выбран: ждём HIGH-G (рывок, как при забросе)
  baitReady: {
    hint: () => T('hint_bait_throw'),
    alert: true,
    onEvent(id) {
      if (id === EV.HIGH_G) {
        game.baitFromX = FISHER_X + 6;
        game.baitFromY = FISHER_Y + 6;
        sfx.cast();
        setState('baitThrow');
      }
    },
  },

  // Кусочек хлеба летит по дуге (рисуется в draw.js)
  baitThrow: {
    update(dt, t) {
      if (t >= BAIT.throwTime) {
        addSplash(game.targetX, game.targetY, 14);
        addRipple(game.targetX, game.targetY, 2);
        sfx.splash();
        newBaitSpot(game.targetX, game.targetY);
        say(T('msg_bait_ready'), C.good, 12);
        setState('aimX');
      }
    },
  },

  // ---------- Поплавок летит ----------
  casting: {
    update(dt, t) {
      // Резкий взмах вперёд
      const swing = Math.min(1, t / 0.15);
      rodAngle = ROD_ANGLE.back + (ROD_ANGLE.forward - ROD_ANGLE.back) * swing;
      if (t > 0.15) turnRodTo(ROD_ANGLE.hold, dt, 5);

      // Поплавок по дуге
      const u = Math.min(1, t / game.castDur);
      const from = game.castFrom;
      const dist = Math.hypot(game.targetX - from.x, game.targetY - from.y);
      const arc = 20 + dist * 0.35;
      game.floatX = from.x + (game.targetX - from.x) * u;
      game.floatY = from.y + (game.targetY - from.y) * u - arc * 4 * u * (1 - u);

      if (u >= 1) {
        // Приводнение
        addSplash(game.targetX, game.targetY);
        addRipple(game.targetX, game.targetY, 1.5);
        sfx.splash();

        // Попали в плавающий предмет - он на крючке, сматываем его
        game.hooked = hitFloater(game.targetX, game.targetY);
        if (game.hooked) {
          game.castInZone = false;
          setState('reeling');
          return;
        }

        game.castInZone = inZone(game.targetX, game.targetY);
        game.castInBait = inBait(game.targetX, game.targetY);
        if (game.castInZone) takeFishFromZone();    // каждый заброс в зону забирает рыбу
        if (game.castInZone || game.castInBait) {
          game.biteAt = rand(FISH.biteZoneMin, FISH.biteZoneMax);
        } else {
          game.biteAt = rand(FISH.biteOtherMin, FISH.biteOtherMax);
        }
        game.waited = 0;
        setState('waiting');
      }
    },
  },

  // ---------- Ждём поклёвку ----------
  waiting: {
    hint: () => T(sitting ? 'hint_resting' : 'hint_waiting'),
    enter() { game.diving = false; },
    onEvent(id, code) {
      // Поплавок уже ныряет - значит, клюёт: подсечка в этот момент засчитывается
      if (game.diving && id === EV.HIGH_G) {
        startBite();
        STATES.bite.onEvent(id, code);
        return;
      }
      if (id === EV.TAP2) setState('reeling');   // спокойно вытащить: червячок остаётся
      // Подсечка (HIGH-G). Первые полсекунды не считаем: это может быть хвост рывка от заброса.
      if (id === EV.HIGH_G && game.stateTime > 0.5) {
        // Предмет (пакет) проплывает через поплавок - цепляем его (floaters.js)
        game.hooked = hitFloater(game.floatX, game.floatY);
        if (game.hooked) {
          sfx.hook();
          addSplash(game.floatX, game.floatY, 8);
          setState('reeling');
        } else {
          loseWorm(T('msg_early'));             // подсёк, когда не клевало, - червячок сорвался
        }
      }
    },
    update(dt, t) {
      // Стик отложили (NO MOT): рыбак садится, рыба клюёт быстрее; ANY MOT - встаёт
      sitting = stickResting();
      game.waited += dt * (sitting ? FISH.restingSpeedup : 1);
      turnRodTo(ROD_ANGLE.hold, dt, 5);
      game.floatX = game.targetX;
      game.floatY = game.targetY + Math.round(Math.sin(t * 2.5) * 0.6);
      if (Math.random() < dt * 0.5) addRipple(game.floatX, game.floatY + 1, 0);

      // Перед поклёвкой поплавок ныряет под воду
      if (!game.diving && floatDive() > 0) {
        game.diving = true;
        addRipple(game.floatX, game.floatY + 1, 1);
      }
      if (game.waited >= game.biteAt) startBite();
    },
  },

  // ---------- Поклёвка: нужна подсечка за game.difficulty.hookWindow секунд ----------
  bite: {
    hint: () => T(game.hookType === 'jerk' ? 'hint_bite_jerk' : 'hint_bite_turn'),
    alert: true,
    onEvent(id) {
      // Подсечка поворотом (первый ORIENT уже идёт в зачёт) или резким рывком
      if (game.hookType === 'turn' && id === EV.ORIENT) {
        sfx.hook();
        game.turns = 1;
        game.lastTurn = 0;
        setState('fight');
      } else if (game.hookType === 'jerk' && id === EV.HIGH_G) {
        sfx.hook();
        addSplash(game.floatX, game.floatY, 8);
        say(T('msg_hooked'), C.good);
        game.turns = 0;
        game.lastTurn = 0;
        setState('fight');
      }
    },
    update(dt, t) {
      // Поплавок под водой (его не видно), сильные круги, писк раз в секунду
      turnRodTo(ROD_ANGLE.fight, dt, 8);
      rodBend = 0.4 + 0.3 * Math.abs(Math.sin(t * 9));
      game.floatX = game.targetX + Math.round(Math.sin(t * 23) * 1);
      game.floatY = game.targetY;
      if (Math.floor(t * 4) !== Math.floor((t - dt) * 4)) addRipple(game.floatX, game.floatY + 1, 1.5);
      if (Math.floor(t) !== Math.floor(t - dt) && t < game.difficulty.hookWindow) sfx.bite();
      if (t >= game.difficulty.hookWindow) loseFish(T('msg_missed'));
    },
  },

  // ---------- Вываживание: крутим стик кистью, как ручку катушки (REEL) ----------
  // Стик присылает скорость вращения (об/с), обороты копятся в game.turns.
  // Со старой прошивкой без катушки каждый ORIENT засчитывается за один оборот.
  fight: {
    hint: () => T(game.tension ? 'hint_tension' : 'hint_fight'),
    enter() {
      game.reelSpeed = 0;
      game.reelAt = 0;
      game.tension = false;       // сразу после подсечки натяжения нет, чтобы игрок успел освоиться
      game.tensionPhase = 'calm';
      game.tensionLevel = 0;
      game.tensionNext = rand(TENSION.firstMin, TENSION.firstMax);
      game.tensionShortGap = false;
      rollFish();                 // game.js: какая рыба на крючке и сколько её крутить
      setReel(true);              // controller.js: стик включает гироскоп
    },
    exit() {
      game.reelSpeed = 0;
      setReel(false);
    },
    onEvent(id, code) {
      if (id === EV.REEL) {
        game.reelSpeed = code / 10;
        game.reelAt = game.stateTime;
      } else if (id === EV.ORIENT && !reelSupported()) {
        addTurns(1);
      }
    },
    update(dt, t) {
      // Скорость не приходила полсекунды (пакеты потерялись) - считаем, что не крутят
      if (inputMode === 'ble' && t - game.reelAt > 0.5) game.reelSpeed = 0;
      // Натяжение по таймеру (настройки - TENSION в config.js):
      // зелёный (calm) -> плавно краснеет (warn) -> красный (tension) -> плавно зеленеет (relax) -> ...
      if (t >= game.tensionNext) {
        if (game.tensionPhase === 'calm') {
          game.tensionPhase = 'warn';
          game.tensionNext = t + TENSION.warnTime;
        } else if (game.tensionPhase === 'warn') {
          game.tensionPhase = 'tension';
          game.tension = true;
          game.tensionStart = t;
          game.tensionNext = t + rand(TENSION.durMin, TENSION.durMax);
          sfx.tension();
        } else if (game.tensionPhase === 'tension') {
          game.tensionPhase = 'relax';     // натяжение уже отпустило - крутить можно
          game.tension = false;
          game.tensionNext = t + TENSION.relaxTime;
        } else {
          game.tensionPhase = 'calm';
          // После короткой паузы - обязательно длинная, иначе как повезёт
          const short = !game.tensionShortGap && Math.random() < TENSION.shortChance;
          game.tensionShortGap = short;
          game.tensionNext = t + (short ? rand(TENSION.shortMin, TENSION.shortMax)
                                        : rand(TENSION.longMin, TENSION.longMax));
        }
      }
      // Уровень для индикатора: 0 - зелёный и прямая удочка, 1 - красный и согнутая
      const left = game.tensionNext - t;
      game.tensionLevel = game.tensionPhase === 'calm' ? 0
                        : game.tensionPhase === 'tension' ? 1
                        : game.tensionPhase === 'warn' ? 1 - left / TENSION.warnTime
                        : left / TENSION.relaxTime;
      // При натяжении крутить быстро нельзя - леска рвётся (после короткой форы на реакцию)
      if (game.tension && t - game.tensionStart > TENSION.grace && game.reelSpeed > TENSION.maxSpeed) {
        sfx.snap();
        loseFish(T('msg_snapped'));
        return;
      }
      // Переждать натяжение можно и не крутя: рыба в это время не сходит
      if (game.tension) game.lastTurn = t;

      // Слишком медленное вращение не засчитывается: игрок должен именно крутить
      if (game.reelSpeed >= FISH.reelMinSpeed) addTurns(game.reelSpeed * dt);

      // Рыба водит поплавок, обороты катушки подтягивают её к берегу.
      // При натяжении удочка гнётся сильнее, поплавок мечется
      turnRodTo(ROD_ANGLE.fight, dt, 8);
      rodBend = game.tension ? 1.1 + 0.15 * Math.sin(t * 25)
                             : 0.7 + 0.3 * Math.sin(t * (game.reelSpeed > 0 ? 12 : 6));
      const progress = Math.min(1, game.turns / game.fightTurns);
      const pullY = game.targetY + (AIM.yNear - game.targetY) * progress * 0.5;
      game.floatX = game.targetX + Math.sin(t * 2.3) * 8 + Math.sin(t * 7) * (game.tension ? 5 : 2);
      game.floatY = pullY + Math.sin(t * 3.1) * 2;
      if (Math.random() < dt * 6) addRipple(game.floatX, game.floatY + 1, 0.5);

      if (game.turns >= game.fightTurns) {
        // Вытащили! Какая рыба - выбрано при подсечке в rollFish() (game.js).
        // В улов она пойдёт, только если попадёт в ведро (bucket.js)
        addSplash(game.floatX, game.floatY, 14);
        sfx.caught();
        setState('caught');
      } else if (t - game.lastTurn > FISH.fightMaxGap) {   // перестал крутить - рыба сошла
        loseFish(T('msg_escaped'));
      }
    },
  },

  // ---------- Рыба вылетает из воды к рыбаку ----------
  caught: {
    update(dt, t) {
      turnRodTo(ROD_ANGLE.idle, dt, 4);
      if (t >= 1.1) setState('photo');
    },
  },

  // ---------- Фото улова (рисуется в photo.js) ----------
  photo: {
    hint: () => T('hint_photo'),
    onEvent(id) {
      if (id === EV.TAP2 && game.stateTime > 0.5) {
        afterPhoto();
      }
    },
    update(dt, t) {
      if (t >= FISH.photoTime) {
        afterPhoto();
      }
    },
  },

  // ---------- Ведро: LOW-G, когда рука с рыбой над ведром (bucket.js) ----------
  bucket: {
    hint: () => bucket.phase === 'aim' ? T('hint_bucket') : '',
    enter() { startBucket(); },
    onEvent(id) {
      if (id === EV.LOW_G) dropBucketFish();
    },
    update(dt, t) {
      turnRodTo(ROD_ANGLE.idle, dt, 4);
      updateBucket(dt, t);
    },
  },

  // ---------- Комар: прихлопнуть рывком (HIGH-G) над ладонью (mosquito.js) ----------
  mosquito: {
    hint: () => T(game.stateTime < MOSQUITO.introTime ? 'hint_buzz' : 'hint_mosquito'),
    enter() { startMosquito(); },
    exit() { buzzStop(); },
    onEvent(id) {
      if (id === EV.HIGH_G) slapMosquito();
    },
    update(dt, t) {
      turnRodTo(ROD_ANGLE.idle, dt, 4);
      updateMosquito(dt, t);
    },
  },

  // ---------- Ночной костёр (campfire.js): дуть в стик, потом крутить вертел ----------
  campfire: {
    hint: () => T(fire.phase === 'kindle' ? 'hint_campfire_blow'
                : fire.phase === 'cook' ? 'hint_campfire_cook'
                : fire.phase === 'eat' || fire.phase === 'done' ? 'hint_campfire_eat' : ''),
    enter() { startCampfire(); },
    exit() { stopCampfire(); },
    onEvent(id, code) { campfireEvent(id, code); },
    update(dt, t) { updateCampfire(dt, t); },
  },

  // ---------- Сматываем леску, поплавок едет к удочке ----------
  reeling: {
    update(dt, t) {
      turnRodTo(ROD_ANGLE.idle, dt, 4);
      const tip = rodTip();
      const dx = tip.x - game.floatX, dy = tip.y + 7 - game.floatY;
      const d = Math.hypot(dx, dy);
      const step = 140 * dt;                 // скорость сматывания, пикселей в секунду
      if (d <= step) {
        finishCast();
      } else {
        game.floatX += dx / d * step;
        game.floatY += dy / d * step;
        if (Math.random() < dt * 8) addRipple(game.floatX, game.floatY + 1, 0);
        if (Math.floor(t * 10) !== Math.floor((t - dt) * 10)) sfx.reel();
      }
    },
  },

  // ---------- Червячки кончились: проигрыш ----------
  gameover: {
    hint: () => T('hint_new_game'),
    alert: true,
    enter() {
      sfx.gameover();
    },
    onEvent(id) {
      if (id === EV.TAP2 && game.stateTime > 1) restartGame();   // 1 с паузы, чтобы не пропустить экран случайно
    },
    update(dt) {
      turnRodTo(ROD_ANGLE.idle, dt, 4);
    },
  },

  // ---------- Набрали цель по весу: победа ----------
  win: {
    hint: () => T('hint_new_game'),
    alert: true,
    enter() {
      sfx.win();
    },
    onEvent(id) {
      if (id === EV.TAP2 && game.stateTime > 1) restartGame();
    },
    update(dt) {
      turnRodTo(ROD_ANGLE.idle, dt, 4);
    },
  },
};
