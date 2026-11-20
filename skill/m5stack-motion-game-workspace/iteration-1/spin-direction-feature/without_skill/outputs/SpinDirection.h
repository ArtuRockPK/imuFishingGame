// SpinDirection.h — grip-independent signed wrist-spin rate for M5StickS3 (BMI270)
//
// Idea: we do NOT assume which body axis the player spins around. Instead we
// learn the spin axis on the fly from the gyro vector (an *unsigned* axis,
// averaged with sign alignment), keep its sign continuous, and project the
// gyro onto it. Result: a signed rev/s that keeps a consistent sign for a
// given physical spin direction, whatever the grip. The game then maps
// "+ = clockwise" with a 1-second calibration (see spin-direction.js).
//
// Units in: gyro deg/s, accel g, dt seconds.  Output: signed rev/s.
#pragma once
#include <math.h>
#include <stdint.h>

class SpinDirection {
public:
  // --- tunables -----------------------------------------------------------
  float learnMinRps   = 0.5f;   // only learn the axis while spinning at least this fast
  float axisTau       = 1.2f;   // s, how fast the axis follows grip changes
  float outTau        = 0.04f;  // s, output smoothing
  float restGyroDps   = 3.0f;   // "at rest" thresholds for gyro bias tracking
  float restAccelG    = 0.05f;
  float restHoldS     = 0.5f;
  float biasTau       = 2.0f;   // s

  void resetAxis() { axisValid_ = false; }

  void update(float gxDps, float gyDps, float gzDps,
              float axG, float ayG, float azG, float dt) {
    if (dt <= 0.f || dt > 0.1f) dt = 0.01f;

    // 1) Slow gyro bias removal while the stick is still (matters near zero,
    //    which is exactly where direction decisions happen).
    float aMag = sqrtf(axG * axG + ayG * ayG + azG * azG);
    float rx = gxDps - bias_[0], ry = gyDps - bias_[1], rz = gzDps - bias_[2];
    bool still = fabsf(aMag - 1.f) < restAccelG &&
                 sqrtf(rx * rx + ry * ry + rz * rz) < restGyroDps;
    restTime_ = still ? restTime_ + dt : 0.f;
    if (restTime_ > restHoldS) {
      float k = dt / biasTau;
      bias_[0] += k * (gxDps - bias_[0]);
      bias_[1] += k * (gyDps - bias_[1]);
      bias_[2] += k * (gzDps - bias_[2]);
    }

    // 2) Bias-corrected angular velocity in rev/s.
    const float toRps = 1.f / 360.f;
    float w[3] = { (gxDps - bias_[0]) * toRps,
                   (gyDps - bias_[1]) * toRps,
                   (gzDps - bias_[2]) * toRps };
    float mag = sqrtf(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);

    // 3) Learn the spin axis (unsigned) with sign continuity.
    if (mag > learnMinRps) {
      float u[3] = { w[0] / mag, w[1] / mag, w[2] / mag };
      if (!axisValid_) {
        // First estimate: make the largest component positive. Same grip ->
        // same sign convention, so a saved calibration usually stays valid.
        int big = 0;
        for (int i = 1; i < 3; i++) if (fabsf(u[i]) > fabsf(u[big])) big = i;
        float s = u[big] < 0 ? -1.f : 1.f;
        for (int i = 0; i < 3; i++) axis_[i] = u[i] * s;
        axisValid_ = true;
        epoch_++;
      } else {
        // Flip the sample to the axis' hemisphere (direction reversals must
        // not drag the axis), then nudge the axis toward it.
        float d = u[0] * axis_[0] + u[1] * axis_[1] + u[2] * axis_[2];
        if (d < 0) { u[0] = -u[0]; u[1] = -u[1]; u[2] = -u[2]; }
        float k = (dt / axisTau) * fminf(mag / (2.f * learnMinRps), 1.f);
        for (int i = 0; i < 3; i++) axis_[i] += k * (u[i] - axis_[i]);
        float n = sqrtf(axis_[0] * axis_[0] + axis_[1] * axis_[1] + axis_[2] * axis_[2]);
        if (n > 1e-6f) for (int i = 0; i < 3; i++) axis_[i] /= n;
      }
    }

    // 4) Project onto the axis -> signed rate; quality = how "pure" the spin is.
    float signedRps = 0.f, q = 0.f;
    if (axisValid_) {
      signedRps = w[0] * axis_[0] + w[1] * axis_[1] + w[2] * axis_[2];
      q = mag > 0.05f ? fabsf(signedRps) / mag : 0.f;
    }
    float k = dt / (outTau + dt);
    out_ += k * (signedRps - out_);
    quality_ += k * (q - quality_);
  }

  float   signedRps() const { return out_; }          // + / - depends on spin direction
  float   speedRps()  const { return fabsf(out_); }   // drop-in for the old unsigned value
  float   quality()   const { return quality_; }      // 0..1, <0.6 = wobble, not a clean spin
  uint8_t epoch()     const { return epoch_; }        // changes when the axis is re-learned
  bool    axisValid() const { return axisValid_; }

  // 4-byte BLE payload: int16 LE centi-rev/s, uint8 quality*255, uint8 epoch
  void pack(uint8_t out[4]) const {
    float c = out_ * 100.f;
    if (c > 32767.f) c = 32767.f;
    if (c < -32768.f) c = -32768.f;
    int16_t v = (int16_t)lrintf(c);
    out[0] = (uint8_t)(v & 0xFF);
    out[1] = (uint8_t)((v >> 8) & 0xFF);
    float qq = quality_ < 0 ? 0 : (quality_ > 1 ? 1 : quality_);
    out[2] = (uint8_t)lrintf(qq * 255.f);
    out[3] = epoch_;
  }

private:
  float bias_[3] = {0, 0, 0};
  float axis_[3] = {0, 1, 0};
  bool  axisValid_ = false;
  uint8_t epoch_ = 0;
  float restTime_ = 0, out_ = 0, quality_ = 0;
};
