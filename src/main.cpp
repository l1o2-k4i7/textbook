/*
 * ================================================================
 *  Industrial USB Control System — ESP32 Firmware (Direct GPIO)
 * ================================================================
 *  Hardware   : ESP32 DevKit — 4 GPIO outputs (NO MCP23017)
 *  Comm.      : USB Serial @ 115200 baud
 *
 *  Register-Level Updates:
 *    - Replaced Arduino String objects with C-style char arrays (zero heap fragmentation).
 *    - Replaced blocking Serial.readStringUntil with non-blocking ISR-like buffer.
 *    - Replaced digitalWrite with direct GPIO register writes (GPIO.out_w1ts / GPIO.out_w1tc).
 *    - Retained mutual exclusivity logic but optimized state tracking.
 *
 *  Channel Mapping (directly on ESP32 pins):
 *    Channel 0  ->  GPIO 16
 *    Channel 1  ->  GPIO 17
 *    Channel 2  ->  GPIO 18
 *    Channel 3  ->  GPIO 19
 * ================================================================
 */

#include <Arduino.h>

// ---------------------------------------------------------------
// Pin and Bitmask Configuration
// ---------------------------------------------------------------
#define NUM_CHANNELS 4

const uint8_t CHANNEL_PINS[NUM_CHANNELS] = {16, 17, 18, 19};

// Pre-calculate bitmasks for register-level access (Pins 0-31 only)
const uint32_t PIN_MASKS[NUM_CHANNELS] = {
    (1UL << 16),
    (1UL << 17),
    (1UL << 18),
    (1UL << 19)
};

// Mask containing all our output pins
const uint32_t ALL_PINS_MASK = (1UL << 16) | (1UL << 17) | (1UL << 18) | (1UL << 19);

// ---------------------------------------------------------------
// Firmware / protocol constants
// ---------------------------------------------------------------
#define FW_VERSION "v3.0-REG"
const unsigned long WATCHDOG_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
uint8_t activeChannel = 255; // 255 means ALL OFF
unsigned long lastCommandTime = 0;
bool watchdogTripped = false;

// Non-blocking serial buffer
const int RX_BUF_SIZE = 64;
char rxBuffer[RX_BUF_SIZE];
int rxIndex = 0;

// ---------------------------------------------------------------
// Low-Level GPIO Helpers
// ---------------------------------------------------------------
void applyOutputStates() {
  if (activeChannel < NUM_CHANNELS) {
    // 1. Clear all our pins via the W1TC (Write 1 to Clear) register
    GPIO.out_w1tc = ALL_PINS_MASK;
    // 2. Set only the active pin via the W1TS (Write 1 to Set) register
    GPIO.out_w1ts = PIN_MASKS[activeChannel];
  } else {
    // Set all our pins to LOW
    GPIO.out_w1tc = ALL_PINS_MASK;
  }
}

void setSafeState() {
  activeChannel = 255;
  applyOutputStates();
}

// ---------------------------------------------------------------
// Command parsing (C-strings, no dynamic memory)
// ---------------------------------------------------------------
void processCommand(char* cmdLine) {
  // Check format <CMD...>
  int len = strlen(cmdLine);
  if (len < 3 || cmdLine[0] != '<' || cmdLine[len - 1] != '>') {
    Serial.println("<ERR:INVALID_FORMAT>");
    return;
  }

  // Remove the trailing '>'
  cmdLine[len - 1] = '\0';
  
  // Point inside the brackets
  char* content = &cmdLine[1];
  
  lastCommandTime = millis();
  watchdogTripped = false;

  if (strncmp(content, "PING", 4) == 0) {
    Serial.println("<PONG>");
  }
  else if (strncmp(content, "SET:", 4) == 0) {
    int ch, val;
    // Fast parsing using sscanf
    if (sscanf(content + 4, "%d:%d", &ch, &val) == 2) {
      if (ch >= 0 && ch < NUM_CHANNELS) {
        if (val == 1) {
          activeChannel = ch; // Mutually exclusive by design
        } else {
          if (activeChannel == ch) {
            activeChannel = 255; // Turn off if it was the active one
          }
        }
        applyOutputStates();
        Serial.printf("<ACK:SET:%d:%d>\n", ch, val);
      } else {
        Serial.println("<ERR:CH_OUT_OF_RANGE>");
      }
    } else {
      Serial.println("<ERR:PARAM_MISSING>");
    }
  }
  else if (strncmp(content, "ALL:", 4) == 0) {
    int val;
    if (sscanf(content + 4, "%d", &val) == 1) {
      if (val == 1) {
        Serial.println("<ERR:MUTUALLY_EXCLUSIVE>");
      } else {
        setSafeState();
        Serial.println("<ACK:ALL:0>");
      }
    }
  }
  else if (strncmp(content, "STATUS", 6) == 0) {
    char sts[NUM_CHANNELS + 1];
    for (int i = 0; i < NUM_CHANNELS; i++) {
      sts[i] = (activeChannel == i) ? '1' : '0';
    }
    sts[NUM_CHANNELS] = '\0';
    Serial.printf("<STS:%s>\n", sts);
  }
  else if (strncmp(content, "RESET", 5) == 0) {
    setSafeState();
    Serial.println("<ACK:RESET>");
  }
  else if (strncmp(content, "INFO", 4) == 0) {
    Serial.printf("<INFO:%s:GPIO_DIRECT:CH:%d>\n", FW_VERSION, NUM_CHANNELS);
  }
  else {
    Serial.println("<ERR:UNKNOWN_CMD>");
  }
}

// ---------------------------------------------------------------
// Arduino entry points
// ---------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  while (!Serial) { /* wait for USB CDC */ }

  // We can still use pinMode for setup as it's only called once.
  // (True register-level pinMode is highly complex due to IO_MUX routing)
  for (int i = 0; i < NUM_CHANNELS; i++) {
    pinMode(CHANNEL_PINS[i], OUTPUT);
  }

  setSafeState();
  lastCommandTime = millis();
  Serial.println("<READY>");
}

void loop() {
  // Non-blocking serial read
  while (Serial.available() > 0) {
    char c = Serial.read();
    
    if (c == '\n') {
      rxBuffer[rxIndex] = '\0';
      processCommand(rxBuffer);
      rxIndex = 0; // Reset buffer index for next command
    } 
    else if (c != '\r') {
      // Prevent buffer overflow
      if (rxIndex < RX_BUF_SIZE - 1) {
        rxBuffer[rxIndex++] = c;
      }
    }
  }

  // Watchdog
  if (!watchdogTripped && (millis() - lastCommandTime > WATCHDOG_TIMEOUT_MS)) {
    watchdogTripped = true;
    if (activeChannel != 255) {
      setSafeState();
    }
    Serial.println("<ERR:WATCHDOG_SAFE_STATE>");
  }
}
