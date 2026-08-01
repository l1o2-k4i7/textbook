# ESP32 4-Channel Direct GPIO Control System

This project provides a **4-channel industrial control system** using an ESP32's
own GPIO pins — **no MCP23017 or any I²C expander needed**.

Everything runs over **USB serial** — no Wi-Fi, Bluetooth, MQTT, or cloud.

```
 Laptop  ──USB──>  ESP32  ──GPIO──>  4 Output Channels
  (GUI)           (Firmware)       (Relays / LEDs / etc.)
```

---

## Architecture

| Layer | Technology | What it does |
|-------|-----------|--------------|
| **ESP32 Firmware** | PlatformIO / Arduino C++ | Listens on USB serial, drives GPIO 16–19 |
| **Backend** | Python Flask + PySerial | Bridges the web GUI to the serial port |
| **Frontend** | HTML + CSS + JS | Premium dark-theme dashboard in your browser |

---

## Hardware Wiring

| ESP32 Pin | Channel | Connect to |
|-----------|---------|------------|
| GPIO 16   | CH 1    | Relay / LED / load driver |
| GPIO 17   | CH 2    | Relay / LED / load driver |
| GPIO 18   | CH 3    | Relay / LED / load driver |
| GPIO 19   | CH 4    | Relay / LED / load driver |
| GND       | —       | Common ground |

> ⚠️ **Safety:** ESP32 GPIOs are 3.3V logic. Always use a relay module or
> transistor/MOSFET driver board to switch any load — never connect mains
> voltage directly to the ESP32.

---

## Quick Start

### Step 1: Flash the ESP32 Firmware

1. Open this folder in **VS Code** with the **PlatformIO** extension.
2. Connect ESP32 via USB.
3. Click **Build** (✔) then **Upload** (→) in the PlatformIO toolbar.
4. Open the **Serial Monitor** (🔌) — you should see `<READY>`.

### Step 2: Install Python dependencies

```bash
cd gui/backend
pip install -r requirements.txt
```

### Step 3: Close the Serial Monitor

Only one application can use the COM port at a time.
**Close** the PlatformIO Serial Monitor before running the GUI.

### Step 4: Launch the GUI

```bash
python app.py
```

### Step 5: Open in browser

Navigate to **http://localhost:5000**

1. Select your ESP32's COM port from the dropdown.
2. Click **Connect**.
3. Toggle any of the 4 channels ON/OFF!

---

## Serial Protocol Reference

All commands and responses are plain text wrapped in `<...>` and terminated
with a newline (`\n`).

| Command | Description | Response |
|---------|-------------|----------|
| `<PING>` | Heartbeat check | `<PONG>` |
| `<SET:ch:state>` | Set one channel (`ch` 0–3, `state` 0 or 1) | `<ACK:SET:ch:state>` |
| `<ALL:state>` | Set all 4 channels at once | `<ACK:ALL:state>` |
| `<STATUS>` | Read current state of all outputs | `<STS:0110>` (4-bit string) |
| `<RESET>` | Force all channels OFF (safe state) | `<ACK:RESET>` |
| `<INFO>` | Firmware/hardware info | `<INFO:v2.0:GPIO_DIRECT:CH:4>` |

**Errors:** `<ERR:INVALID_FORMAT>`, `<ERR:UNKNOWN_CMD>`, `<ERR:CH_OUT_OF_RANGE>`,
`<ERR:PARAM_MISSING>`, `<ERR:WATCHDOG_SAFE_STATE>` (sent automatically if no
command arrives for 15 seconds — all outputs forced OFF for safety).

---

## Project Structure

```
esp32_industrial_control/
├── platformio.ini          # Board, framework, and build settings
├── src/
│   └── main.cpp            # ESP32 firmware (direct GPIO, 4 channels)
├── gui/
│   ├── backend/
│   │   ├── app.py          # Flask server (USB serial ↔ Web API)
│   │   └── requirements.txt
│   └── frontend/
│       ├── index.html      # Web dashboard
│       ├── style.css       # Premium dark-theme styles
│       └── app.js          # Frontend logic
├── include/                # (empty) your header files
├── lib/                    # (empty) private libraries
├── test/                   # (empty) unit tests
└── README.md               # You are here
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| PlatformIO can't find the port | Check USB cable is data-capable; install CP2102/CH340 driver |
| `Timed out waiting for packet header` | Hold **BOOT** button during upload |
| Serial Monitor shows garbage | Confirm baud rate is 115200 |
| GUI can't connect | **Close** the PlatformIO Serial Monitor first |
| Outputs don't switch | Check wiring: GPIO 16/17/18/19, and common GND |
| `pip install` fails | Use `pip3` or ensure Python 3.8+ is installed |
