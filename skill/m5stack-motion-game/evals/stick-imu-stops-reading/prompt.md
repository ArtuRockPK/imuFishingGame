---
tags: [skill-creator]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

help pls. M5StickS3, I'm reading the BMI270 with the SparkFun lib: Wire.begin(47,48); imu.beginI2C(0x68, Wire). first few readings are fine then everything is zeros / errors forever. my loop calls M5.update() for the buttons. Also next I want proper single/double tap and orientation events from the sensor itself, not my own math. what's wrong and how should I do it?
