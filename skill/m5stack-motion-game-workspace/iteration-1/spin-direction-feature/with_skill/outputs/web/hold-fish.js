'use strict';
/*
 * hold-fish.js — "hold the fish" mini-game: the fish pulls the line left/right, the player spins
 * clockwise to push right and counter-clockwise to push left, keeping the marker in the green zone.
 *
 * Design (gentle on purpose — raw spin input is noisy):
 *   - the marker has inertia (velocity + damping), so it drifts and overshoots believably;
 *   - the fish force changes target every 0.35–1.1 s and eases toward it (never a hard jump);
 *   - 1.5 s grace at the start, the fish force ramps in;
 *   - progress fills only inside the zone (faster near the centre);
 *   - leaving the zone fills a "strain" reserve; you lose only when it is full, and it recovers
 *     while you are back inside — touching the edge for one frame never kills you.
 *
 * Plugs into a STATES table:  STATES.holdFish = HOLD_FISH_STATE;  setState('holdFish')
 * Needs: stickSpin / spinSetup / spinCalibrated / spinCal (spin-direction.js), setReel, setState,
 * T(), a 320x180 canvas context for draw. Keyboard: hold R (CW) / E (CCW).
 */

const HOLD = {
  GRACE_SEC: 1.5,          // no fish force, no strain at the start
  FORCE_RAMP_SEC: 2.0,     // fish force grows to full over this
  FISH_FORCE: 0.9,         // max fish pull (units/s^2, marker range is -1..+1)
  FORCE_CHANGE_MIN: 0.35, FORCE_CHANGE_MAX: 1.1,  // seconds between new fish targets
  FORCE_EASE: 3,           // how fast the actual force follows its target (1/s)
  PUSH_GAIN: 1.6,          // player push strength; must beat FISH_FORCE with margin
  DAMPING: 2.2,            // velocity damping (1/s); higher = less overshoot
  ZONE: 0.35,              // half-width of the green zone
  WIN_SEC: 8,              // seconds in the zone to land the fish
  CENTER_BONUS: 0.6,       // up to +60 % progress speed right at the centre
  STRAIN_SEC: 2.5,         // seconds outside the zone before the line snaps
  STRAIN_RECOVER: 1.5,     // reserve recovers this many times faster while inside
  REEL_KEEPALIVE_SEC: 20,  // re-send "REEL on" so the device's 60 s safety timeout never fires
};

const holdFish = { x: 0, v: 0, force: 0, forceTarget: 0, nextChange: 0, progress: 0, strain: 0,
                   mode: 'dir', keepalive: 0, done: null };

const HOLD_FISH_STATE = {
  hint: () => holdFish.mode === 'dir' ? T('hint_hold_dir')        // "SPIN ↻ = RIGHT, ↺ = LEFT"
                                      : T('hint_hold_speed'),      // "SPIN TO HOLD THE FISH"
  enter() {
    Object.assign(holdFish, { x: 0, v: 0, force: 0, forceTarget: 0, nextChange: HOLD.GRACE_SEC,
                              progress: 0, strain: 0, keepalive: 0, done: null });
    stickSpin.reset();
    const begin = () => {
      // Old firmware / skipped setup: fall back to "spin speed pulls toward the centre"
      holdFish.mode = (inputMode === 'keyboard' || spinCalibrated()) ? 'dir' : 'speed';
      setReel(true);
    };
    if (inputMode === 'ble' && !spinCal) { paused = true; spinSetup.start(() => { paused = false; begin(); }); }
    else begin();
  },
  exit() { setReel(false); stickSpin.reset(); },

  update(dt, t) {
    const h = holdFish;
    if (h.done) return;
    stickSpin.update(dt);

    if ((h.keepalive += dt) > HOLD.REEL_KEEPALIVE_SEC) { h.keepalive = 0; setReel(true); }

    // fish force: random target, eased; ramped in after the grace period
    if (t >= h.nextChange) {
      h.forceTarget = (Math.random() * 2 - 1);
      // bias away from the side the marker is already on, so it doesn't feel unfair
      if (Math.abs(h.x) > HOLD.ZONE && Math.sign(h.forceTarget) === Math.sign(h.x)) h.forceTarget *= 0.5;
      h.nextChange = t + HOLD.FORCE_CHANGE_MIN + Math.random() * (HOLD.FORCE_CHANGE_MAX - HOLD.FORCE_CHANGE_MIN);
    }
    const ramp = Math.max(0, Math.min(1, (t - HOLD.GRACE_SEC) / HOLD.FORCE_RAMP_SEC));
    h.force += (h.forceTarget * HOLD.FISH_FORCE * ramp - h.force) * Math.min(1, dt * HOLD.FORCE_EASE);

    // player push
    let push;
    if (h.mode === 'dir') push = stickSpin.push * HOLD.PUSH_GAIN;                         // + right, - left
    else push = -Math.sign(h.x) * Math.min(1, stickSpin.speed / SPIN.FULL_PUSH_RPS) * HOLD.PUSH_GAIN;

    // marker physics with inertia
    h.v += (h.force + push - h.v * HOLD.DAMPING) * dt;
    h.x += h.v * dt;
    if (h.x > 1) { h.x = 1; h.v = 0; } else if (h.x < -1) { h.x = -1; h.v = 0; }

    // progress / strain
    const inZone = Math.abs(h.x) <= HOLD.ZONE;
    if (inZone) {
      const centre = 1 - Math.abs(h.x) / HOLD.ZONE;
      h.progress += dt * (1 + HOLD.CENTER_BONUS * centre) / HOLD.WIN_SEC;
      h.strain = Math.max(0, h.strain - dt * HOLD.STRAIN_RECOVER / HOLD.STRAIN_SEC);
    } else if (t > HOLD.GRACE_SEC) {
      h.strain += dt / HOLD.STRAIN_SEC;
    }
    if (h.progress >= 1) { h.done = 'win';  sfx.lock && sfx.lock(); setTimeout(() => setState('caught'), 1200); }
    if (h.strain   >= 1) { h.done = 'lose'; sfx.snap && sfx.snap(); setTimeout(() => setState('escaped'), 1200); }
  },
};

// Minimal drawing in 320x180 scene coordinates — restyle in your pixel-art draw.js.
function drawHoldFish(ctx, t) {
  const h = holdFish, W = 320, barY = 150, barX = 40, barW = 240;
  const toPx = x => barX + (x + 1) / 2 * barW;
  ctx.fillStyle = '#3a1c1c'; ctx.fillRect(barX, barY, barW, 8);                          // bar
  ctx.fillStyle = '#2f9e44'; ctx.fillRect(toPx(-HOLD.ZONE), barY, toPx(HOLD.ZONE) - toPx(-HOLD.ZONE), 8);  // zone
  ctx.fillStyle = '#ffd43b'; ctx.fillRect(Math.round(toPx(h.x)) - 2, barY - 4, 4, 16);    // marker
  // fish pull arrow and player push arrow, so the player SEES why the marker moves
  const arrow = (val, y, col) => { if (Math.abs(val) < 0.05) return;
    ctx.fillStyle = col; const len = Math.round(Math.abs(val) * 30), x0 = W / 2;
    ctx.fillRect(val > 0 ? x0 : x0 - len, y, len, 3); };
  arrow(h.force / HOLD.FISH_FORCE, barY + 14, '#4dabf7');                                // fish
  arrow(stickSpin.push, barY + 19, '#ffd43b');                                          // you
  // progress and strain bars
  ctx.fillStyle = '#2f9e44'; ctx.fillRect(barX, barY - 12, barW * Math.min(1, h.progress), 3);
  if (h.strain > 0.4) { ctx.fillStyle = (Math.floor(t * 6) % 2) ? '#e03131' : '#862e2e';
                        ctx.fillRect(barX, barY - 8, barW * Math.min(1, h.strain), 2); }
  // fish under water follows the marker, with a little dart
  const fx = toPx(h.x) + Math.sin(t * 7) * 3;
  ctx.fillStyle = '#1c3d5a'; ctx.fillRect(Math.round(fx) - 6, 110 + Math.round(Math.sin(t * 3) * 2), 12, 5);
  if (stickSpin.gripHint) drawHintText(T('hint_grip_changed'));   // "GRIP CHANGED? REDO SPIN SETUP IN ⚙"
  if (!h.done && h.strain > 0.4) drawHintText(h.x > 0 ? T('hint_push_left') : T('hint_push_right'));
}
