"""
ESP32 Industrial Control — Web GUI Backend
===========================================
Flask server that talks to ESP32 over USB serial and serves the web GUI.

Usage:
    pip install flask pyserial flask-cors
    python app.py

Then open http://localhost:5000 in your browser.
"""

import serial
import serial.tools.list_ports
import threading
import time
import json
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

# ── Serial connection state ──────────────────────────────────────
ser = None
ser_lock = threading.Lock()
NUM_CHANNELS = 4
channel_states = [False] * NUM_CHANNELS
connected_port = None
ping_thread = None
stop_ping = threading.Event()


def send_command(cmd):
    """Send a command to ESP32 and return the response line."""
    global ser
    with ser_lock:
        if ser is None or not ser.is_open:
            return None
        try:
            ser.write((cmd + '\n').encode('utf-8'))
            ser.flush()
            # Wait for response (timeout handled by serial config)
            response = ser.readline().decode('utf-8').strip()
            return response
        except Exception as e:
            print(f"Serial error: {e}")
            return None


def ping_loop():
    """Background thread that pings ESP32 every 10s to keep watchdog alive."""
    while not stop_ping.is_set():
        if ser and ser.is_open:
            send_command('<PING>')
        stop_ping.wait(10)


# ── API Routes ───────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/api/ports', methods=['GET'])
def list_ports():
    """List available serial/COM ports."""
    ports = serial.tools.list_ports.comports()
    port_list = [
        {
            'device': p.device,
            'description': p.description,
            'hwid': p.hwid
        }
        for p in ports
    ]
    return jsonify({'ports': port_list})


@app.route('/api/connect', methods=['POST'])
def connect():
    """Connect to a specific COM port."""
    global ser, connected_port, ping_thread, stop_ping

    data = request.get_json()
    port = data.get('port')
    baud = data.get('baud', 115200)

    if not port:
        return jsonify({'success': False, 'error': 'No port specified'}), 400

    # Disconnect existing connection first
    with ser_lock:
        if ser and ser.is_open:
            stop_ping.set()
            if ping_thread:
                ping_thread.join(timeout=2)
            ser.close()
            ser = None

    try:
        s = serial.Serial(port, baud, timeout=2)
        time.sleep(2)  # Wait for ESP32 boot / serial init

        # Drain any boot messages
        while s.in_waiting:
            s.readline()

        with ser_lock:
            ser = s
            connected_port = port

        # Sync state from ESP32
        resp = send_command('<STATUS>')
        if resp and resp.startswith('<STS:'):
            bits = resp[5:-1]  # Extract bit string
            for i in range(min(len(bits), NUM_CHANNELS)):
                channel_states[i] = (bits[i] == '1')

        # Start keep-alive ping thread
        stop_ping = threading.Event()
        ping_thread = threading.Thread(target=ping_loop, daemon=True)
        ping_thread.start()

        return jsonify({
            'success': True,
            'port': port,
            'channels': channel_states
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/disconnect', methods=['POST'])
def disconnect():
    """Disconnect from the current serial port."""
    global ser, connected_port
    stop_ping.set()
    if ping_thread:
        ping_thread.join(timeout=2)

    with ser_lock:
        if ser and ser.is_open:
            # Send reset before disconnect for safety
            try:
                ser.write(b'<RESET>\n')
                ser.flush()
                time.sleep(0.1)
            except:
                pass
            ser.close()
        ser = None
        connected_port = None

    for i in range(NUM_CHANNELS):
        channel_states[i] = False

    return jsonify({'success': True})


@app.route('/api/status', methods=['GET'])
def status():
    """Get current connection status and channel states."""
    is_connected = ser is not None and ser.is_open
    return jsonify({
        'connected': is_connected,
        'port': connected_port if is_connected else None,
        'channels': channel_states
    })


@app.route('/api/set', methods=['POST'])
def set_channel():
    """Set a single channel ON or OFF."""
    data = request.get_json()
    ch = data.get('channel')
    val = data.get('state')

    if ch is None or val is None:
        return jsonify({'success': False, 'error': 'Missing channel or state'}), 400

    if ch < 0 or ch >= NUM_CHANNELS:
        return jsonify({'success': False, 'error': 'Channel out of range'}), 400

    state_int = 1 if val else 0
    resp = send_command(f'<SET:{ch}:{state_int}>')

    if resp and 'ACK:SET' in resp:
        channel_states[ch] = bool(val)
        return jsonify({'success': True, 'channel': ch, 'state': bool(val)})
    else:
        return jsonify({'success': False, 'error': f'ESP32 response: {resp}'}), 500


@app.route('/api/all', methods=['POST'])
def set_all():
    """Set ALL channels ON or OFF."""
    data = request.get_json()
    val = data.get('state')

    if val is None:
        return jsonify({'success': False, 'error': 'Missing state'}), 400

    state_int = 1 if val else 0
    resp = send_command(f'<ALL:{state_int}>')

    if resp and 'ACK:ALL' in resp:
        for i in range(NUM_CHANNELS):
            channel_states[i] = bool(val)
        return jsonify({'success': True, 'state': bool(val)})
    else:
        return jsonify({'success': False, 'error': f'ESP32 response: {resp}'}), 500


@app.route('/api/reset', methods=['POST'])
def reset():
    """Reset all channels to OFF (safe state)."""
    resp = send_command('<RESET>')
    if resp and 'ACK:RESET' in resp:
        for i in range(NUM_CHANNELS):
            channel_states[i] = False
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'error': f'ESP32 response: {resp}'}), 500


@app.route('/api/info', methods=['GET'])
def info():
    """Get firmware info from ESP32."""
    resp = send_command('<INFO>')
    return jsonify({'response': resp})


if __name__ == '__main__':
    print("=" * 55)
    print("  ESP32 Industrial Control — Web GUI")
    print("  Open http://localhost:5000 in your browser")
    print("=" * 55)
    app.run(host='0.0.0.0', port=5000, debug=False)
