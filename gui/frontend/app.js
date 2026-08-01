/* ================================================================
   ESP32 Industrial Control Panel — JavaScript Application
   Handles serial communication via Flask backend API
   ================================================================ */

const API = '';  // Same origin

const NUM_CHANNELS = 4;
const CHANNEL_CONFIG = [
    { name: 'Channel 1', pin: 'GPIO 16', colorVar: '--ch0', glowVar: '--ch0-glow' },
    { name: 'Channel 2', pin: 'GPIO 17', colorVar: '--ch1', glowVar: '--ch1-glow' },
    { name: 'Channel 3', pin: 'GPIO 18', colorVar: '--ch2', glowVar: '--ch2-glow' },
    { name: 'Channel 4', pin: 'GPIO 19', colorVar: '--ch3', glowVar: '--ch3-glow' },
];

// ── State ───────────────────────────────────────────────────
let isConnected = false;
let channelStates = [false, false, false, false];
let statusPollInterval = null;

// ── DOM References ──────────────────────────────────────────
const portSelect   = document.getElementById('portSelect');
const refreshBtn   = document.getElementById('refreshBtn');
const connectBtn   = document.getElementById('connectBtn');
const connBadge    = document.getElementById('connBadge');
const connDot      = document.getElementById('connDot');
const connText     = document.getElementById('connText');
const connInfo     = document.getElementById('connInfo');
const connPortName = document.getElementById('connPortName');
const fwInfo       = document.getElementById('fwInfo');
const allOffBtn    = document.getElementById('allOffBtn');
const logBody      = document.getElementById('logBody');
const clearLogBtn  = document.getElementById('clearLogBtn');
const channelGrid  = document.querySelector('.channel-grid');

// ── Logging ─────────────────────────────────────────────────
function log(msg, type = '') {
    const now = new Date();
    const ts = now.toLocaleTimeString('en-GB', { hour12: false });

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `
        <span class="log-time">${ts}</span>
        <span class="log-msg ${type}">${msg}</span>
    `;

    // Remove the "waiting" placeholder
    const empty = logBody.querySelector('.log-empty');
    if (empty) empty.remove();

    logBody.appendChild(entry);
    logBody.scrollTop = logBody.scrollHeight;
}

clearLogBtn.addEventListener('click', () => {
    logBody.innerHTML = '<div class="log-empty">Log cleared.</div>';
});

// ── API Helpers ─────────────────────────────────────────────
async function api(endpoint, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);

    try {
        const res = await fetch(`${API}${endpoint}`, opts);
        const data = await res.json();
        return data;
    } catch (e) {
        log(`API error: ${e.message}`, 'err');
        return null;
    }
}

// ── Port List ───────────────────────────────────────────────
async function loadPorts() {
    const data = await api('/api/ports');
    if (!data || !data.ports) {
        log('Failed to list serial ports', 'err');
        return;
    }

    portSelect.innerHTML = '<option value="">— Select COM Port —</option>';
    data.ports.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.device;
        opt.textContent = `${p.device} — ${p.description}`;
        portSelect.appendChild(opt);
    });

    log(`Found ${data.ports.length} serial port(s)`, 'info');
}

refreshBtn.addEventListener('click', () => {
    refreshBtn.style.transform = 'rotate(360deg)';
    setTimeout(() => refreshBtn.style.transform = '', 500);
    loadPorts();
});

// ── Connect / Disconnect ────────────────────────────────────
connectBtn.addEventListener('click', async () => {
    if (isConnected) {
        // Disconnect
        connectBtn.querySelector('.btn-text').textContent = 'Disconnecting…';
        const data = await api('/api/disconnect', 'POST');
        if (data && data.success) {
            setConnectionUI(false);
            log('Disconnected from ESP32', 'warn');
        }
    } else {
        // Connect
        const port = portSelect.value;
        if (!port) {
            log('Please select a COM port first', 'warn');
            return;
        }

        connectBtn.querySelector('.btn-text').textContent = 'Connecting…';
        connectBtn.disabled = true;

        const data = await api('/api/connect', 'POST', { port });

        if (data && data.success) {
            channelStates = data.channels || [false, false, false, false];
            setConnectionUI(true, port);
            updateChannelCards();
            log(`Connected to ${port}`, 'ok');

            // Fetch firmware info
            const info = await api('/api/info');
            if (info && info.response) {
                fwInfo.textContent = info.response;
                fwInfo.hidden = false;
            }
        } else {
            log(`Connection failed: ${data ? data.error : 'unknown'}`, 'err');
        }

        connectBtn.disabled = false;
    }
});

function setConnectionUI(connected, port = '') {
    isConnected = connected;

    if (connected) {
        connBadge.classList.add('connected');
        connText.textContent = 'Connected';
        connectBtn.querySelector('.btn-text').textContent = 'Disconnect';
        connectBtn.classList.add('connected');
        portSelect.disabled = true;
        connInfo.hidden = false;
        connPortName.textContent = port;

        // Enable channel cards
        document.querySelectorAll('.channel-card').forEach(c => c.classList.remove('disabled'));

        // Start status polling
        if (statusPollInterval) clearInterval(statusPollInterval);
        statusPollInterval = setInterval(pollStatus, 5000);
    } else {
        connBadge.classList.remove('connected');
        connText.textContent = 'Disconnected';
        connectBtn.querySelector('.btn-text').textContent = 'Connect';
        connectBtn.classList.remove('connected');
        portSelect.disabled = false;
        connInfo.hidden = true;
        fwInfo.hidden = true;

        // Reset all channel states
        channelStates = [false, false, false, false];
        updateChannelCards();

        // Disable channel cards
        document.querySelectorAll('.channel-card').forEach(c => c.classList.add('disabled'));

        if (statusPollInterval) {
            clearInterval(statusPollInterval);
            statusPollInterval = null;
        }
    }
}

// ── Status Polling ──────────────────────────────────────────
async function pollStatus() {
    const data = await api('/api/status');
    if (data) {
        if (!data.connected && isConnected) {
            setConnectionUI(false);
            log('Connection lost!', 'err');
            return;
        }
        if (data.channels) {
            channelStates = data.channels;
            updateChannelCards();
        }
    }
}

// ── Channel Cards ───────────────────────────────────────────
function buildChannelCards() {
    channelGrid.innerHTML = '';
    CHANNEL_CONFIG.forEach((cfg, i) => {
        const card = document.createElement('div');
        card.className = 'channel-card disabled';
        card.id = `ch-card-${i}`;
        card.style.setProperty('--ch-color', `var(${cfg.colorVar})`);
        card.style.setProperty('--ch-glow', `var(${cfg.glowVar})`);

        card.innerHTML = `
            <div class="ch-indicator">
                <div class="ch-indicator-inner"></div>
            </div>
            <div class="ch-label">
                <div class="ch-name">${cfg.name}</div>
                <div class="ch-pin">${cfg.pin}</div>
            </div>
            <div class="toggle-wrapper">
                <input type="checkbox" class="toggle" id="toggle-${i}"
                       data-channel="${i}"
                       style="--ch-color: var(${cfg.colorVar}); --ch-glow: var(${cfg.glowVar});">
            </div>
            <div class="ch-status" id="ch-status-${i}">OFF</div>
        `;

        // Toggle click handler
        const toggle = card.querySelector('.toggle');
        toggle.addEventListener('change', async (e) => {
            const ch = parseInt(e.target.dataset.channel);
            const newState = e.target.checked;

            // Optimistic UI update
            if (newState) {
                // Mutually exclusive: turn others off
                for (let i = 0; i < NUM_CHANNELS; i++) {
                    channelStates[i] = (i === ch);
                }
                updateChannelCards();
            } else {
                channelStates[ch] = false;
                updateSingleCard(ch);
            }
            log(`CH${ch + 1} → ${newState ? 'ON' : 'OFF'}`, 'info');

            const data = await api('/api/set', 'POST', { channel: ch, state: newState });

            if (!data || !data.success) {
                // Revert on failure
                channelStates[ch] = !newState;
                updateSingleCard(ch);
                log(`Failed to set CH${ch + 1}: ${data ? data.error : 'no response'}`, 'err');
            } else {
                log(`CH${ch + 1} ${newState ? 'ENABLED' : 'DISABLED'} ✓`, 'ok');
            }
        });

        // Click on card body also toggles (unless clicking the toggle itself)
        card.addEventListener('click', (e) => {
            if (e.target.closest('.toggle-wrapper')) return;
            if (card.classList.contains('disabled')) return;
            toggle.click();
        });

        channelGrid.appendChild(card);
    });
}

function updateChannelCards() {
    for (let i = 0; i < NUM_CHANNELS; i++) {
        updateSingleCard(i);
    }
}

function updateSingleCard(i) {
    const card = document.getElementById(`ch-card-${i}`);
    const toggle = document.getElementById(`toggle-${i}`);
    const status = document.getElementById(`ch-status-${i}`);

    if (!card) return;

    const on = channelStates[i];
    toggle.checked = on;
    status.textContent = on ? 'ON' : 'OFF';

    if (on) {
        card.classList.add('active');
    } else {
        card.classList.remove('active');
    }
}

// ── Bulk Actions ────────────────────────────────────────────

allOffBtn.addEventListener('click', async () => {
    if (!isConnected) return;
    log('Setting ALL channels OFF…', 'info');
    const data = await api('/api/all', 'POST', { state: false });
    if (data && data.success) {
        channelStates = [false, false, false, false];
        updateChannelCards();
        log('All channels DISABLED ✓', 'ok');
    } else {
        log('Failed to disable all channels', 'err');
    }
});

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    buildChannelCards();
    loadPorts();
    log('Control panel initialized', 'info');
});
