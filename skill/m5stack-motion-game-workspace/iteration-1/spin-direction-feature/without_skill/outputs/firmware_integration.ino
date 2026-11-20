// firmware_integration.ino — how to wire SpinDirection into an existing
// M5StickS3 BLE sketch. Only the spin-direction parts are shown; keep your
// existing service / speed characteristic as they are.
#include <M5Unified.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include "SpinDirection.h"

// Add one characteristic to your existing service (generate your own UUIDs).
#define SPIN_DIR_CHAR_UUID  "6e400010-b5a3-f393-e0a9-e50e24dcca9e"  // notify: 4 bytes
#define SPIN_CMD_CHAR_UUID  "6e400011-b5a3-f393-e0a9-e50e24dcca9e"  // write: 0x01 = reset axis

SpinDirection spin;
BLECharacteristic* spinDirChar = nullptr;

class SpinCmdCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = c->getValue();          // String in ESP32 core 3.x (std::string in 2.x)
    if (v.length() && (uint8_t)v[0] == 0x01) spin.resetAxis();
  }
};

// Call this right after you create your existing service, before service->start().
void addSpinDirectionCharacteristics(BLEService* service) {
  spinDirChar = service->createCharacteristic(
      SPIN_DIR_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ);
  spinDirChar->addDescriptor(new BLE2902());
  BLECharacteristic* cmd = service->createCharacteristic(
      SPIN_CMD_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE);
  cmd->setCallbacks(new SpinCmdCallbacks());
}

// In loop(): sample IMU as fast as you can (100-200 Hz), notify at ~30 Hz.
void spinLoop(bool deviceConnected) {
  static uint32_t lastUs = micros(), lastNotify = 0;

  if (M5.Imu.update()) {
    auto d = M5.Imu.getImuData();      // accel in g, gyro in deg/s
    uint32_t now = micros();
    float dt = (now - lastUs) * 1e-6f;
    lastUs = now;
    spin.update(d.gyro.x, d.gyro.y, d.gyro.z, d.accel.x, d.accel.y, d.accel.z, dt);
  }

  // Long-press button A (or whatever is free) = re-learn axis after a grip change.
  if (M5.BtnA.wasHold()) spin.resetAxis();

  if (deviceConnected && spinDirChar && millis() - lastNotify >= 33) {
    lastNotify = millis();
    uint8_t pkt[4];
    spin.pack(pkt);
    spinDirChar->setValue(pkt, sizeof(pkt));
    spinDirChar->notify();
    // Your existing unsigned speed can now just be spin.speedRps().
  }
}

/* setup() additions:
     auto cfg = M5.config();
     M5.begin(cfg);
     ... your BLE setup ...
     addSpinDirectionCharacteristics(pService);
     pService->start();
   loop():
     M5.update();
     spinLoop(deviceConnected);

   Note: the BMI270 gyro range is +-2000 deg/s = 5.5 rev/s. Very fast spins clip
   magnitude but not sign, so direction still works. */
