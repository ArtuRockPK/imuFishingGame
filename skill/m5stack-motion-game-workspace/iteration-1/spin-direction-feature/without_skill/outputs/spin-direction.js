// spin-direction.js — turns the stick's signed rev/s into a reliable
// "push left / push right" input, with a one-time calibration that makes it
// independent of how the player holds the stick.

export const SPIN_DIR_CHAR_UUID = '6e400010-b5a3-f393-e0a9-e50e24dcca9e';
export const SPIN_CMD_CHAR_UUID = '6e400011-b5a3-f393-e0a9-e50e24dcca9e';

const STORE_KEY = 'spinDir.calibration.v1';

export class SpinDirectionInput {
  constructor(opts = {}) {
    this.cfg = {
      onRps: 0.45,        // start pushing above this (rev/s)
      offRps: 0.25,       // stop pushing below this (hysteresis)
      fullRps: 2.5,       // push strength 1.0 at this speed
      minQuality: 0.55,   // ignore wobble that isn't a real spin
      switchMs: 90,       // opposite direction must persist this long to flip
      smoothMs: 60,       // extra EMA in the browser
      staleMs: 300,       // no packet for this long -> neutral
      ...opts,
    };
    this.rps = 0; this.quality = 0; this.epoch = -1;
    this.filtered = 0;
    this.state = 0;            // -1 left, 0 none, +1 right
    this.pending = 0; this.pendingSince = 0;
    this.lastPacket = 0;
    this.sign = this._load();  // +1 / -1 / null (not calibrated)
    this.calib = null;
    this.onEpochChange = null; // optional callback(epoch)
  }

  // ---------- BLE ----------
  async attach(service) {
    const ch = await service.getCharacteristic(SPIN_DIR_CHAR_UUID);
    ch.addEventListener('characteristicvaluechanged', e => this.handlePacket(e.target.value));
    await ch.startNotifications();
    try { this.cmdChar = await service.getCharacteristic(SPIN_CMD_CHAR_UUID); } catch { this.cmdChar = null; }
  }

  async resetAxis() {                        // after a grip change
    if (this.cmdChar) await this.cmdChar.writeValue(new Uint8Array([0x01]));
  }

  handlePacket(dv, now = performance.now()) {
    const rps = dv.getInt16(0, true) / 100;
    const quality = dv.getUint8(2) / 255;
    const epoch = dv.getUint8(3);
    if (this.epoch !== -1 && epoch !== this.epoch && this.onEpochChange) this.onEpochChange(epoch);
    this.epoch = epoch;

    const dt = this.lastPacket ? Math.min(now - this.lastPacket, 200) : 33;
    this.lastPacket = now;
    this.rps = rps; this.quality = quality;

    // Low-quality samples (wobble, shaking) are treated as "no spin".
    const v = quality >= this.cfg.minQuality ? rps : 0;
    const k = dt / (this.cfg.smoothMs + dt);
    this.filtered += k * (v - this.filtered);

    if (this.calib) this._calibSample(v, now);
    this._updateState(now);
  }

  // ---------- direction with hysteresis + debounce ----------
  _updateState(now) {
    const s = (this.sign ?? 1) * this.filtered;   // + = clockwise = right
    const mag = Math.abs(s);
    let want = this.state;
    if (this.state === 0) {
      if (mag > this.cfg.onRps) want = Math.sign(s);
    } else if (Math.sign(s) === this.state) {
      if (mag < this.cfg.offRps) want = 0;
    } else {
      // going the other way: release immediately, re-engage only if sustained
      const opposite = -this.state;
      this.state = 0;
      want = mag > this.cfg.onRps ? opposite : 0;
    }

    if (want === this.state) { this.pending = 0; return; }
    if (want === 0) { this.state = 0; this.pending = 0; return; }   // releasing is instant
    if (this.pending !== want) { this.pending = want; this.pendingSince = now; }
    if (now - this.pendingSince >= this.cfg.switchMs) { this.state = want; this.pending = 0; }
  }

  /** Call every frame. Returns { dir: -1|0|1, push: -1..1, calibrated } */
  read(now = performance.now()) {
    if (now - this.lastPacket > this.cfg.staleMs) { this.state = 0; this.filtered = 0; }
    const s = (this.sign ?? 1) * this.filtered;
    const strength = Math.min(1, Math.max(0,
      (Math.abs(s) - this.cfg.offRps) / (this.cfg.fullRps - this.cfg.offRps)));
    return { dir: this.state, push: this.state * strength, calibrated: this.sign !== null };
  }

  // ---------- calibration: "spin CLOCKWISE (as you see it) for 2 seconds" ----------
  startCalibration(durationMs = 2000) {
    return new Promise(resolve => {
      this.calib = { sum: 0, n: 0, until: 0, durationMs, resolve };
    });
  }

  _calibSample(v, now) {
    const c = this.calib;
    if (Math.abs(v) < this.cfg.onRps) return;   // wait until they actually spin
    if (!c.until) c.until = now + c.durationMs; // timer starts at first real spin
    c.sum += v; c.n++;
    if (now < c.until) return;
    this.calib = null;
    const mean = c.sum / c.n;
    // Require a consistent spin: mean must be clearly one-signed.
    if (c.n < 10 || Math.abs(mean) < this.cfg.onRps) { c.resolve({ ok: false }); return; }
    this.sign = mean > 0 ? 1 : -1;
    this._save();
    c.resolve({ ok: true, sign: this.sign });
  }

  cancelCalibration() { if (this.calib) { this.calib.resolve({ ok: false }); this.calib = null; } }
  invert() { this.sign = -(this.sign ?? 1); this._save(); }   // "controls feel backwards" button
  clearCalibration() { this.sign = null; try { localStorage.removeItem(STORE_KEY); } catch {} }

  _load() { try { const v = +localStorage.getItem(STORE_KEY); return v === 1 || v === -1 ? v : null; } catch { return null; } }
  _save() { try { localStorage.setItem(STORE_KEY, String(this.sign)); } catch {} }
}
