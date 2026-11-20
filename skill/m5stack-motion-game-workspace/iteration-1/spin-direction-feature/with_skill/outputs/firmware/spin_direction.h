/*
 * spin_direction.h — wrist-spin DIRECTION for the reel (add next to your existing spin-speed meter).
 *
 * Why it reports "axis + sign" and not "clockwise":
 *   Clockwise depends on how the player holds the stick (screen up/down, button left/right,
 *   twisting the stick around its own length vs. circling the wrist like a reel handle).
 *   The firmware cannot know which of those the player does, so it reports WHICH IMU axis the
 *   rotation is around and WITH WHICH SIGN. The game learns in calibration which axis+sign
 *   means "clockwise" for this player and this device, and stores it in localStorage.
 *
 * Three candidate rotation vectors are accumulated (each decayed x0.5 every send = ~last 0.2 s):
 *   twist        – stick spins around its own axis:            sum of omega*dt  (rad)
 *   gyro circle  – wrist circles, stick tilts along with it:   sum of (w_prev x w)/(|w_prev||w|)
 *   accel circle – stick moves round without tilting (a real  sum of (a_prev x a)/(|a_prev||a|)
 *                  reel handle), seen in linear acceleration    on accel minus gravity
 * The strongest one wins; its largest component is the "main axis".
 *
 * Packet fields filled from here (see protocol: REEL event):
 *   byte 3  aux:  bit7 sign(1 = minus) | bit6 direction known | bit5 twist | bit4 accel circle
 *                 | bits0-1 axis (0 X, 1 Y, 2 Z).  Neither bit5 nor bit4 = gyro circle.
 *   byte 10 diag: strength of the winning method, rad*40 (clamped 255)
 *   byte 11 diag: main-axis share, %  (energy share: c^2 / |v|^2, 33..100)
 *
 * IMU-agnostic: feed it gyro in deg/s and accel in g from whatever you read
 * (BMI270 via Bosch API: raw/16.4 for +-2000 dps, raw/4096 for +-8 g; MPU6886: M5.Imu.getGyro/getAccel).
 * Call add() for every IMU sample while the reel is on (100 Hz), encode() once per send window
 * (100 ms) — encode() also applies the decay.
 */
#pragma once
#include <math.h>
#include <stdint.h>

// ---- Tunables (print them / their live effect to Serial while tuning) ----
const float SPIN_DIR_DECAY      = 0.5f;   // per send window; lower = reacts faster, flickers more
const float SPIN_DIR_MIN_RAD    = 0.5f;   // winner must be at least this strong to be "known"; raise if it guesses while still
const float SPIN_DIR_MIN_SHARE  = 0.50f;  // main axis must carry this share of the vector; raise for stricter
const float SPIN_GYRO_MIN_DPS   = 100.f;  // below this the gyro is noise / no rotation (same as the speed meter)
const float SPIN_ACC_MIN_G      = 0.25f;  // below this linear accel is noise (same as the speed meter)
const float SPIN_GRAVITY_K      = 0.02f;  // slow gravity filter for linear acceleration

struct Vec3 { float x = 0, y = 0, z = 0; };
static inline float v3len(const Vec3& v) { return sqrtf(v.x * v.x + v.y * v.y + v.z * v.z); }
static inline Vec3  v3cross(const Vec3& a, const Vec3& b) {
  Vec3 r; r.x = a.y * b.z - a.z * b.y; r.y = a.z * b.x - a.x * b.z; r.z = a.x * b.y - a.y * b.x; return r; }

struct SpinDirection {
  enum Method : uint8_t { GYRO_CIRCLE = 0, ACCEL_CIRCLE = 1, TWIST = 2 };

  Vec3 twist, gyroCircle, accelCircle;      // accumulators
  Vec3 wPrev, aPrev, grav;
  bool haveW = false, haveA = false, haveGrav = false;

  // Last result (for Serial / the device screen)
  uint8_t aux = 0, diagStrength = 0, diagShare = 0;
  Method  method = GYRO_CIRCLE;

  void reset() { *this = SpinDirection(); }

  // gx,gy,gz in deg/s; ax,ay,az in g; dt in seconds (actual time since the previous sample)
  void add(float gx, float gy, float gz, float ax, float ay, float az, float dt) {
    const float D2R = 0.01745329f;
    Vec3 w; w.x = gx * D2R; w.y = gy * D2R; w.z = gz * D2R;          // rad/s
    float wm = v3len(w);
    bool rotating = wm >= SPIN_GYRO_MIN_DPS * D2R;

    // twist: plain integrated angular velocity
    if (rotating) { twist.x += w.x * dt; twist.y += w.y * dt; twist.z += w.z * dt; }

    // gyro circle: the angular-velocity vector itself turns when the wrist circles
    if (rotating) {
      if (haveW) {
        Vec3 c = v3cross(wPrev, w); float n = v3len(wPrev) * wm;
        if (n > 1e-6f) { gyroCircle.x += c.x / n; gyroCircle.y += c.y / n; gyroCircle.z += c.z / n; }
      }
      wPrev = w; haveW = true;
    } else haveW = false;                     // through zero = rocking, not rotation

    // accel circle: linear acceleration (accel - slow gravity) turns round
    if (!haveGrav) { grav.x = ax; grav.y = ay; grav.z = az; haveGrav = true; }
    grav.x += (ax - grav.x) * SPIN_GRAVITY_K; grav.y += (ay - grav.y) * SPIN_GRAVITY_K; grav.z += (az - grav.z) * SPIN_GRAVITY_K;
    Vec3 a; a.x = ax - grav.x; a.y = ay - grav.y; a.z = az - grav.z;
    float am = v3len(a);
    if (am >= SPIN_ACC_MIN_G && rotating) {   // only while the gyro agrees something rotates
      if (haveA) {
        Vec3 c = v3cross(aPrev, a); float n = v3len(aPrev) * am;
        float s = v3len(c) / n;               // sin of the step angle
        if (s < 0.94f) {                      // > ~70 deg per sample = glitch, skip
          accelCircle.x += c.x / n; accelCircle.y += c.y / n; accelCircle.z += c.z / n; }
      }
      aPrev = a; haveA = true;
    } else haveA = false;
  }

  // Once per send window. Returns the aux byte for packet byte 3; fills diag bytes; decays.
  uint8_t encode() {
    float lt = v3len(twist), lg = v3len(gyroCircle), la = v3len(accelCircle);
    const Vec3* best = &gyroCircle; float bl = lg; method = GYRO_CIRCLE;
    if (lt > bl) { best = &twist;       bl = lt; method = TWIST; }
    if (la > bl) { best = &accelCircle; bl = la; method = ACCEL_CIRCLE; }

    float c[3] = { best->x, best->y, best->z };
    int axis = 0; for (int i = 1; i < 3; i++) if (fabsf(c[i]) > fabsf(c[axis])) axis = i;
    float share = bl > 1e-6f ? (c[axis] * c[axis]) / (bl * bl) : 0;

    aux = (uint8_t)axis;
    if (c[axis] < 0)           aux |= 0x80;
    if (method == TWIST)       aux |= 0x20;
    if (method == ACCEL_CIRCLE)aux |= 0x10;
    if (bl >= SPIN_DIR_MIN_RAD && share >= SPIN_DIR_MIN_SHARE) aux |= 0x40;   // known

    float st = bl * 40.f; diagStrength = st > 255.f ? 255 : (uint8_t)st;
    diagShare = (uint8_t)(share * 100.f + 0.5f);

    twist.x *= SPIN_DIR_DECAY;       twist.y *= SPIN_DIR_DECAY;       twist.z *= SPIN_DIR_DECAY;
    gyroCircle.x *= SPIN_DIR_DECAY;  gyroCircle.y *= SPIN_DIR_DECAY;  gyroCircle.z *= SPIN_DIR_DECAY;
    accelCircle.x *= SPIN_DIR_DECAY; accelCircle.y *= SPIN_DIR_DECAY; accelCircle.z *= SPIN_DIR_DECAY;
    return aux;
  }

  uint16_t diag() const { return (uint16_t)diagStrength | ((uint16_t)diagShare << 8); }  // bytes 10,11

  static const char* methodName(uint8_t a) { return (a & 0x20) ? "twist" : (a & 0x10) ? "acirc" : "gcirc"; }
};
