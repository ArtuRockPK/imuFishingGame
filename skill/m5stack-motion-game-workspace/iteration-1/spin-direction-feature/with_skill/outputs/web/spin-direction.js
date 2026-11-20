'use strict';
/*
 * spin-direction.js — turns REEL packets (speed + aux byte) into a steady, grip-independent
 * "push" value for the game:  stickSpin.push  in -1..+1  (+ = clockwise = push right).
 *
 * Three layers:
 *   1. Calibration (per device name, localStorage): learn which direction key (aux & 0x83 =
 *      axis + sign) THIS player's clockwise and counter-clockwise produce.
 *   2. reelDirection(aux): one packet -> +1 / -1 / 0 using the saved keys.
 *   3. SpinInput: votes over recent packets, holds the last direction through short "unknown"
 *      gaps, times out if the stop packet was lost, and smooths the push the game reads.
 *
 * Wiring (in your controller.js):
 *   - in onBleEvent, BEFORE routing to the game:
 *         if (spinSetup.active) { spinSetup.onPacket(id, code, aux); return; }
 *         if (id === EV.REEL) stickSpin.onReel(code, aux);
 *   - after connect:  loadSpinCalibration(device.name)
 *   - stickSpin.update(dt) once per frame while a spin mini-game runs (hold-fish.js does it)
 *   - keyboard: R held = CW, E held = CCW (see bottom) — same path, so the mini-game is testable
 *     without hardware.
 * Uses EV, setReel(on), inputMode from your controller code; T() for strings if you have i18n.
 */

const SPIN = {
  CAL_PACKETS: 45,        // known-direction packets to collect per calibration step (~4.5 s of spinning)
  CAL_AGREE: 0.70,        // share of votes the winning key needs
  CAL_UNSUPPORTED_AFTER: 50, // spinning packets with < 3 known -> firmware can't tell direction
  VOTE_WINDOW: 5,         // last N known packets (~0.5 s) used for the in-game direction
  HOLD_DIR_SEC: 0.4,      // keep the last direction this long through "unknown" packets
  PACKET_TIMEOUT_SEC: 0.3,// no REEL packet for this long -> treat as stopped (lost "0" packet)
  FULL_PUSH_RPS: 2.0,     // spin speed that gives full push; slower = proportionally weaker
  MIN_RPS: 0.3,           // below this, no push (wobble)
  SMOOTH: 6,              // push follows its target at this rate (1/s); lower = softer
  MISMATCH_HINT: 12,      // known packets matching neither CW nor CCW in a row -> "grip changed?"
};

// ---------------------------------------------------------------- 1. calibration storage
let spinCal = null;       // { cw, ccw, unsupported }
let spinCalKey = null;
function loadSpinCalibration(deviceName) {
  spinCalKey = 'fishing.spin.' + (deviceName || 'stick');
  try { spinCal = JSON.parse(localStorage.getItem(spinCalKey)); } catch (_) { spinCal = null; }
}
function saveSpinCalibration(cal) {
  spinCal = cal;
  try { localStorage.setItem(spinCalKey, JSON.stringify(cal)); } catch (_) { /* private mode */ }
}
const spinCalibrated = () => !!(spinCal && spinCal.cw != null);

// ---------------------------------------------------------------- 2. one packet -> direction
function reelDirection(aux) {
  if (!(aux & 0x40) || !spinCalibrated()) return 0;     // bit 6: firmware is sure
  const k = aux & 0x83;                                  // axis + sign; method bits ignored
  if (k === spinCal.cw) return 1;
  if (k === spinCal.ccw || k === (spinCal.cw ^ 0x80)) return -1;
  if (spinCal.ccw != null && k === (spinCal.ccw ^ 0x80)) return 1;
  return 0;                                              // some other axis: don't guess
}

// ---------------------------------------------------------------- 3. steady in-game value
const stickSpin = {
  speed: 0,          // rev/s, last reported
  dir: 0,            // +1 CW, -1 CCW, 0 none — after voting/holding
  push: 0,           // smoothed -1..+1 the mini-game reads
  votes: [],
  sinceLastPacket: 99,
  sinceKnown: 99,
  mismatches: 0,
  gripHint: false,   // true -> show "Grip changed? Redo spin setup"

  reset() { this.speed = 0; this.dir = 0; this.push = 0; this.votes = []; this.mismatches = 0; this.gripHint = false; },

  // Called for every REEL event: code = rev/s * 10, aux = byte 3. Keyboard passes aux = null + dir.
  onReel(code, aux, keyboardDir) {
    this.speed = code / 10;
    this.sinceLastPacket = 0;
    if (code === 0) { this.votes = []; this.dir = 0; return; }   // explicit stop: instant
    const d = keyboardDir != null ? keyboardDir : reelDirection(aux);
    if (d !== 0) {
      this.votes.push(d);
      if (this.votes.length > SPIN.VOTE_WINDOW) this.votes.shift();
      this.sinceKnown = 0; this.mismatches = 0; this.gripHint = false;
      const sum = this.votes.reduce((a, b) => a + b, 0);
      // majority with hysteresis: flip only when the new direction clearly dominates
      if (this.dir === 0) this.dir = Math.sign(sum) || d;
      else if (Math.sign(sum) === -this.dir && Math.abs(sum) >= 2) this.dir = -this.dir;
    } else if (aux != null && (aux & 0x40) && spinCalibrated()) {
      if (++this.mismatches >= SPIN.MISMATCH_HINT) this.gripHint = true;   // sure, but not a learned key
    }
  },

  update(dt) {
    this.sinceLastPacket += dt; this.sinceKnown += dt;
    if (this.sinceLastPacket > SPIN.PACKET_TIMEOUT_SEC) { this.speed = 0; this.dir = 0; this.votes = []; }
    if (this.sinceKnown > SPIN.HOLD_DIR_SEC) this.dir = 0;     // spinning, but direction unclear too long
    const s = this.speed < SPIN.MIN_RPS ? 0 : Math.min(1, this.speed / SPIN.FULL_PUSH_RPS);
    const target = this.dir * s;
    this.push += (target - this.push) * Math.min(1, dt * SPIN.SMOOTH);
    if (Math.abs(this.push) < 0.01 && target === 0) this.push = 0;
  },
};

// ---------------------------------------------------------------- calibration steps
// Two overlay steps: "spin clockwise" then "spin counter-clockwise", each with a looping video
// (media/gestures/<device-type>/reel_cw.mp4 / reel_ccw.mp4). Call spinSetup.start(onDone).
// Plug the ui callbacks into your shared overlay (progress bar, message, ✓ sound).
const spinSetup = {
  active: false, step: null, votes: {}, known: 0, spinning: 0, cw: null, onDone: null,
  ui: { show(step) {}, progress(p) {}, message(key) {}, success() {} },   // replace with your overlay

  start(onDone) {
    this.onDone = onDone; this.cw = null; this.active = true;
    setReel(true);
    this.begin('cw');
  },
  begin(step) { this.step = step; this.votes = {}; this.known = 0; this.spinning = 0; this.ui.show(step); this.ui.progress(0); },
  skip() { this.finish({ cw: null, ccw: null, skipped: true }); },   // saved so we don't nag every time

  onPacket(id, code, aux) {
    if (!this.active || id !== EV.REEL || code === 0) return;
    this.spinning++;
    if (aux & 0x40) {
      const k = aux & 0x83;
      this.votes[k] = (this.votes[k] || 0) + 1;
      this.known++;
    } else if (this.spinning >= SPIN.CAL_UNSUPPORTED_AFTER && this.known < 3) {
      this.ui.message('spin_unsupported');                 // "Update the controller firmware"
      return this.finish({ cw: null, ccw: null, unsupported: true });
    }
    this.ui.progress(Math.min(1, this.known / SPIN.CAL_PACKETS));
    if (this.known < SPIN.CAL_PACKETS) return;

    const [key, n] = Object.entries(this.votes).sort((a, b) => b[1] - a[1])[0];
    const k = +key;
    if (n / this.known < SPIN.CAL_AGREE) {                 // mixed directions
      this.ui.message('spin_steady');                      // "Spin steadily in ONE direction"
      return this.begin(this.step);
    }
    if (this.step === 'cw') {
      this.cw = k; this.ui.success();
      setTimeout(() => this.begin('ccw'), 900);
    } else {
      if (k === this.cw) { this.ui.message('spin_same_way'); return this.begin('ccw'); }  // "That was the same way"
      this.ui.success();
      setTimeout(() => this.finish({ cw: this.cw, ccw: k }), 900);
    }
  },

  finish(cal) {
    this.active = false; setReel(false);
    saveSpinCalibration(cal);
    stickSpin.reset();
    if (this.onDone) this.onDone(cal);
  },
};

// ---------------------------------------------------------------- keyboard: same path
// R held = clockwise, E held = counter-clockwise, T held = slow clockwise.
const KEY_SPIN = { KeyR: [1, 2.0], KeyE: [-1, 2.0], KeyT: [1, 0.8] };
addEventListener('keydown', e => {
  if (inputMode !== 'keyboard' || e.repeat || !KEY_SPIN[e.code]) return;
  const [dir, rps] = KEY_SPIN[e.code];
  stickSpin.onReel(Math.round(rps * 10), null, dir);
  if (typeof onControllerEvent === 'function') onControllerEvent(EV.REEL, Math.round(rps * 10));
});
addEventListener('keyup', e => {
  if (inputMode !== 'keyboard' || !KEY_SPIN[e.code]) return;
  stickSpin.onReel(0, null, 0);
  if (typeof onControllerEvent === 'function') onControllerEvent(EV.REEL, 0);
});
// The firmware only sends REEL every 100 ms; a held key sends one keydown. Keep keyboard spin
// alive so the packet timeout doesn't stop it:
setInterval(() => {
  if (inputMode !== 'keyboard') return;
  for (const code in KEY_SPIN) if (heldKeys.has(code)) { const [d, r] = KEY_SPIN[code]; stickSpin.onReel(Math.round(r * 10), null, d); }
}, 100);
const heldKeys = new Set();
addEventListener('keydown', e => heldKeys.add(e.code));
addEventListener('keyup', e => heldKeys.delete(e.code));
addEventListener('blur', () => { heldKeys.clear(); stickSpin.onReel(0, null, 0); });
