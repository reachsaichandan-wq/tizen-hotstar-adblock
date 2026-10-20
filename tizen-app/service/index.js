"use strict";

/*
 * Background service (Tizen web service app, Node runtime).
 *
 * Talks to the launcher page over ws://127.0.0.1:8095. It opens the TV's own SDB daemon
 * (127.0.0.1:26101, needs Developer Mode Host PC IP = 127.0.0.1), runs `debug <appId>` to
 * launch an app with DevTools on, attaches over the Chrome DevTools Protocol and injects
 * userScript.js:
 *   - native:  the Samsung JioHotstar app (fiZNCxMH9Y.Hotstar), every document
 *   - website: this app itself, then the launcher navigates to hotstar.com
 *
 * A token-protected bridge on port 8096 lets the developer PC request a debug launch of
 * the same two apps, to inspect them over DevTools.
 */
module.exports.onStart = function () {
    const fs = require('fs');
    const path = require('path');
    const http = require('http');
    const https = require('https');
    const adbhost = require('adbhost');
    const { attach } = require('./inject.js');
    const WebSocket = process.version === 'v4.4.3' ? require('ws-old') : require('ws-new');

    const SERVICE_PORT = 8095;
    const BRIDGE_PORT = 8096;
    const SDB_PORT = 26101;
    const MAX_ATTACH_ATTEMPTS = 20;
    const NATIVE_APP_ID = 'fiZNCxMH9Y.Hotstar';
    const SELF_APP_ID = tizen.application.getAppInfo().packageId + '.HotstarAdBlock';
    const SCRIPT_URL = 'https://cdn.jsdelivr.net/gh/reachsaichandan-wq/tizen-hotstar-adblock@main/userScript.js';
    const BUNDLED_SCRIPT = fs.readFileSync(path.join(__dirname, 'userScript.js'), 'utf8');
    const BRIDGE_TOKEN = readOptional(path.join(__dirname, 'bridge-token.txt')).trim();

    const state = {
        debugReady: false,
        launching: false,
        canDebug: null,
        lastError: '',
        native: { ok: null, error: '', port: 0 },
        scriptSource: 'bundled'
    };
    let userScript = BUNDLED_SCRIPT;

    function readOptional(file) {
        try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
    }

    function log(message) {
        console.log('[HotstarAdBlock] ' + message);
    }

    // Newest blocker from the repo, so ad host fixes don't need a reinstall. Falls back to
    // the copy bundled in the package when offline or when the download looks wrong.
    function refreshScript() {
        const req = https.get(SCRIPT_URL, { timeout: 5000 }, (res) => {
            if (res.statusCode !== 200) { res.resume(); return; }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                // Must be a blocker build that knows native mode, or it would take over
                // the remote inside the JioHotstar app.
                if (body.indexOf('__tvHotstarAdblockMode') !== -1) {
                    userScript = body;
                    state.scriptSource = 'github';
                    log('using userScript.js from GitHub');
                }
            });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => {});
    }

    // Debug launches only work when Developer Mode points at the TV itself.
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

    // DevTools listens on the TV's LAN address (TizenBrew connects there too).
    let reportedIp = '';
    function tvIp() {
        if (reportedIp) return reportedIp;
        const interfaces = require('os').networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const address of interfaces[name]) {
                if (address.family === 'IPv4' && !address.internal) return address.address;
            }
        }
        return '127.0.0.1';
    }

    // Runs `debug <appId>` over the TV's own SDB and resolves with the DevTools port.
    function debugLaunch(appId) {
        const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');
        return new Promise((resolve, reject) => {
            const adb = adbhost.createConnection({ host: '127.0.0.1', port: SDB_PORT });
            let output = '';
            const timer = setTimeout(() => {
                adb._stream.end();
                reject(new Error('no reply to debug command: ' + output.trim()));
            }, 20000);
            adb._stream.on('connect', () => {
                log('SDB connected, debug-launching ' + appId);
                const shell = adb.createStream('shell:0 debug ' + appId + (isTizen3 ? ' 0' : ''));
                shell.on('data', (data) => {
                    output += data.toString();
                    const match = /port:\s*(\d+)/i.exec(output);
                    if (match) {
                        clearTimeout(timer);
                        setTimeout(() => adb._stream.end(), 1000);
                        resolve(Number(match[1]));
                    } else if (/fail|error|denied|not permitted/i.test(output)) {
                        clearTimeout(timer);
                        adb._stream.end();
                        reject(new Error(output.trim()));
                    }
                });
            });
            adb._stream.on('error', (e) => {
                clearTimeout(timer);
                reject(new Error('SDB connection failed (' + e.message + ')'));
            });
        });
    }

    function attachTo(port, host, mode) {
        return new Promise((resolve, reject) => {
            const prefix = mode === 'native' ? 'window.__tvHotstarAdblockMode = "native";\n' : '';
            attach({
                port,
                host,
                script: prefix + userScript,
                allOrigins: mode === 'native',
                maxAttempts: MAX_ATTACH_ATTEMPTS,
                log,
                onReady: resolve,
                onDisconnect: () => {
                    if (mode === 'website') state.debugReady = false;
                },
                onFail: reject
            });
        });
    }

    function launchNative() {
        state.native = { ok: null, error: '', port: 0 };
        return debugLaunch(NATIVE_APP_ID)
            .then((port) => {
                state.native.port = port;
                return attachTo(port, tvIp(), 'native');
            })
            .then(() => {
                state.native.ok = true;
                log('native JioHotstar attached');
            })
            .catch((e) => {
                state.native.ok = false;
                state.native.error = e.message;
                log('native launch failed: ' + e.message);
            });
    }

    function relaunchSelfInDebug(ip) {
        state.launching = true;
        state.lastError = '';
        debugLaunch(SELF_APP_ID)
            .then((port) => attachTo(port, ip || tvIp(), 'website'))
            .then(() => {
                state.debugReady = true;
                state.launching = false;
            })
            .catch((e) => {
                state.launching = false;
                state.lastError = e.message;
                log('website mode failed: ' + e.message);
            });
    }

    function statusMessage() {
        return {
            type: 'status',
            debugReady: state.debugReady,
            launching: state.launching,
            canDebug: state.canDebug,
            lastError: state.lastError,
            native: state.native,
            scriptSource: state.scriptSource
        };
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
            if (msg.tvIP && /^\d+\.\d+\.\d+\.\d+$/.test(msg.tvIP) && msg.tvIP !== '127.0.0.1') reportedIp = msg.tvIP;
            if (msg.type === 'status') {
                if (msg.reset) state.lastError = '';
                checkCanDebug();
                ws.send(JSON.stringify(statusMessage()));
            } else if (msg.type === 'launchNative') {
                launchNative().then(() => {
                    if (ws.readyState === 1) ws.send(JSON.stringify(statusMessage()));
                });
            } else if (msg.type === 'relaunch') {
                if (state.launching || state.debugReady) return;
                state.launching = true;
                // Give the page time to exit before the debug relaunch.
                setTimeout(() => relaunchSelfInDebug(msg.tvIP), 1000);
            }
        });
    });
    server.listen(SERVICE_PORT, '127.0.0.1');

    // Developer bridge: {token, type: 'debugApp', appId} -> {port}. Only the two Hotstar
    // targets, only with the token generated at build time.
    if (BRIDGE_TOKEN) {
        const bridge = new WebSocket.Server({ port: BRIDGE_PORT });
        bridge.on('connection', (ws) => {
            ws.on('message', (raw) => {
                let msg;
                try { msg = JSON.parse(raw); } catch (e) { return ws.close(); }
                if (msg.token !== BRIDGE_TOKEN) return ws.close();
                const reply = (data) => ws.readyState === 1 && ws.send(JSON.stringify(data));
                if (msg.type === 'status') {
                    reply(statusMessage());
                } else if (msg.type === 'debugApp' && (msg.appId === NATIVE_APP_ID || msg.appId === SELF_APP_ID)) {
                    debugLaunch(msg.appId)
                        .then((port) => reply({ type: 'debugApp', ok: true, port }))
                        .catch((e) => reply({ type: 'debugApp', ok: false, error: e.message }));
                } else if (msg.type === 'launchNative') {
                    launchNative().then(() => reply(statusMessage()));
                }
            });
        });
    }

    refreshScript();
    checkCanDebug();
    log('service started');
};
