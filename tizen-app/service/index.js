"use strict";

/*
 * Background service (Tizen web service app, Node runtime).
 *
 * Talks to the launcher page over ws://127.0.0.1:8095. On request it opens the TV's own
 * SDB daemon (127.0.0.1:26101, needs Developer Mode Host PC IP = 127.0.0.1), runs
 * `debug <appId>` to relaunch the app with DevTools on, attaches over the Chrome DevTools
 * Protocol and injects userScript.js into every hotstar.com document.
 */
module.exports.onStart = function () {
    const fs = require('fs');
    const path = require('path');
    const http = require('http');
    const adbhost = require('adbhost');
    const { attach } = require('./inject.js');
    const WebSocket = process.version === 'v4.4.3' ? require('ws-old') : require('ws-new');

    const SERVICE_PORT = 8095;
    const SDB_PORT = 26101;
    const MAX_ATTACH_ATTEMPTS = 20;
    const USER_SCRIPT = fs.readFileSync(path.join(__dirname, 'userScript.js'), 'utf8');

    const state = {
        debugReady: false,
        launching: false,
        canDebug: null,
        lastError: ''
    };

    function log(message) {
        console.log('[HotstarAdBlock] ' + message);
    }

    // Debug relaunch only works when Developer Mode points at the TV itself.
    function checkCanDebug() {
        http.get('http://127.0.0.1:8001/api/v2/', (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const device = JSON.parse(body).device;
                    state.canDebug = device.developerMode === '1' &&
                        (device.developerIP === '127.0.0.1' || device.developerIP === '1.0.0.127');
                } catch (e) {
                    state.canDebug = null;
                }
            });
        }).on('error', () => { state.canDebug = null; });
    }

    function attachToApp(port, host) {
        attach({
            port,
            host,
            script: USER_SCRIPT,
            maxAttempts: MAX_ATTACH_ATTEMPTS,
            log,
            onReady: () => {
                state.debugReady = true;
                state.launching = false;
                state.lastError = '';
            },
            onDisconnect: () => { state.debugReady = false; },
            onFail: (err) => {
                state.launching = false;
                state.lastError = 'DevTools connection failed (' + err.message + ')';
                log(state.lastError);
            }
        });
    }

    function relaunchInDebug(tvIP) {
        state.launching = true;
        state.lastError = '';
        const appId = tizen.application.getAppInfo().packageId + '.HotstarAdBlock';
        const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');
        const adb = adbhost.createConnection({ host: '127.0.0.1', port: SDB_PORT });

        adb._stream.on('connect', () => {
            log('SDB connected, relaunching ' + appId + ' in debug mode');
            const shell = adb.createStream('shell:0 debug ' + appId + (isTizen3 ? ' 0' : ''));
            shell.on('data', (data) => {
                const text = data.toString();
                if (!text.includes('debug')) return;
                const port = Number(text.substr(text.indexOf(':') + 1, 6).replace(' ', ''));
                if (!port) {
                    state.launching = false;
                    state.lastError = 'unexpected debug reply: ' + text.trim();
                    return;
                }
                attachToApp(port, tvIP || '127.0.0.1');
                setTimeout(() => adb._stream.end(), 1000);
            });
        });
        adb._stream.on('error', (e) => {
            state.launching = false;
            state.lastError = 'SDB connection failed (' + e.message + ')';
            log(state.lastError);
        });
    }

    const server = http.createServer((req, res) => res.end('Hotstar AdBlock service'));
    const wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw);
            } catch (e) {
                return;
            }
            if (msg.type === 'status') {
                if (msg.reset) state.lastError = '';
                checkCanDebug();
                ws.send(JSON.stringify({
                    type: 'status',
                    debugReady: state.debugReady,
                    launching: state.launching,
                    canDebug: state.canDebug,
                    lastError: state.lastError
                }));
            } else if (msg.type === 'relaunch') {
                if (state.launching || state.debugReady) return;
                state.launching = true;
                // Give the page time to exit before the debug relaunch.
                setTimeout(() => relaunchInDebug(msg.tvIP), 1000);
            }
        });
    });

    server.listen(SERVICE_PORT, '127.0.0.1');
    checkCanDebug();
    log('service started');
};
