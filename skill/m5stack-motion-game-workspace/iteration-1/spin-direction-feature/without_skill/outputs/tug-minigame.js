// tug-minigame.js — minimal "fish pulls left/right" loop using SpinDirectionInput.
// Plug render() into your own canvas drawing.
import { SpinDirectionInput } from './spin-direction.js';

export function createTugMinigame({ spinInput, durationS = 12, onEnd, render }) {
  const st = {
    pos: 0,            // -1 (left edge) .. +1 (right edge); keep it near 0
    fishForce: 0,      // current fish pull
    fishTarget: 0,
    nextChange: 0,
    danger: 0,         // seconds spent at the edge
    t: 0,
    done: false,
  };
  const PLAYER_GAIN = 1.6, FISH_MAX = 0.9, LOSE_AFTER = 1.2;
  let last = performance.now();

  function pickFishMove() {
    // Alternate sides most of the time so the player must switch directions.
    const side = Math.random() < 0.75 ? -Math.sign(st.fishTarget || 1) : Math.sign(st.fishTarget || 1);
    st.fishTarget = side * (0.4 + Math.random() * 0.6) * FISH_MAX;
    st.nextChange = st.t + 0.9 + Math.random() * 1.4;
  }

  function frame(now) {
    if (st.done) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now; st.t += dt;

    if (st.t >= st.nextChange) pickFishMove();
    st.fishForce += (st.fishTarget - st.fishForce) * Math.min(1, dt * 4);   // fish ramps, no teleports

    const { dir, push } = spinInput.read(now);
    // push > 0 = clockwise = toward the right
    st.pos += (st.fishForce + push * PLAYER_GAIN) * dt;
    st.pos = Math.max(-1, Math.min(1, st.pos));

    st.danger = Math.abs(st.pos) > 0.85 ? st.danger + dt : Math.max(0, st.danger - dt * 2);

    render?.({ ...st, dir, push });

    if (st.danger > LOSE_AFTER) { st.done = true; onEnd?.(false); return; }
    if (st.t >= durationS)      { st.done = true; onEnd?.(true);  return; }
    requestAnimationFrame(frame);
  }

  return {
    async start() {
      // First time (or after "controls backwards"): calibrate.
      if (!spinInput.read().calibrated) {
        // show: "Spin CLOCKWISE (as you look at it) to calibrate"
        const r = await spinInput.startCalibration();
        if (!r.ok) return this.start();   // re-prompt; show "keep spinning one way"
      }
      pickFishMove();
      last = performance.now();
      requestAnimationFrame(frame);
    },
    stop() { st.done = true; },
  };
}

/* Wiring example (after your existing navigator.bluetooth connect):
   const spin = new SpinDirectionInput();
   await spin.attach(service);                    // same GATT service as your speed char
   spin.onEpochChange = () => showToast('Grip changed? Spin clockwise to re-check');
   const game = createTugMinigame({ spinInput: spin, onEnd: win => ..., render: drawTug });
   game.start();
   // Settings menu: "Recalibrate" -> spin.clearCalibration(); "Invert" -> spin.invert();
*/
