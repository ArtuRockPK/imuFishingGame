---
type: llm
focus: trace
weight: 1
---

The answer identifies that M5Unified's internal I2C driver (M5.In_I2C) re-attaches pins 47/48 on its own transactions (e.g. during M5.update()), taking them away from Arduino Wire
