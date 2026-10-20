'use strict';

/*
 * Sideloads dist/HotstarAdBlock.wgt through a running TizenBrew Installer
 * (https://github.com/reisxd/TizenBrewInstaller), which re-signs it with the Samsung
 * certificate it already created and installs it over SDB.
 *
 *   node install.js <tv-ip>
 *
 * Needs: TizenBrew Installer running on this PC (ws://localhost:8091) and the TV's
 * Developer Mode Host PC IP set to this PC's IP.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require(path.join(__dirname, 'service', 'node_modules', 'ws-new'));

const tvIp = process.argv[2];
if (!tvIp) {
  console.error('usage: node install.js <tv-ip>');
  process.exit(2);
}

const Events = { InstallPackage: 1, Error: 3, InstallationStatus: 4, ConnectToTV: 6, InstallFile: 7 };
const wgtPath = path.join(__dirname, 'dist', 'HotstarAdBlock.wgt');
const certConfig = path.join(os.homedir(), 'share', 'tizenbrewInstallerConfig.json');
// The installer's InstallFile handler falls through into DeleteConfiguration and wipes
// the certificate, so keep a copy and put it back afterwards.
const certBackup = fs.existsSync(certConfig) ? fs.readFileSync(certConfig) : null;
if (!certBackup) {
  console.error(`no Samsung certificate at ${certConfig}; create one with the installer first`);
  process.exit(1);
}

function restoreCert() {
  fs.writeFileSync(certConfig, certBackup);
}

function finish(code, message) {
  restoreCert();
  console.log(message);
  process.exit(code);
}

const ws = new WebSocket('ws://localhost:8091');
const send = (type, payload) => ws.send(JSON.stringify({ type, payload }));

ws.on('open', () => {
  console.log(`connecting installer to TV ${tvIp}…`);
  send(Events.ConnectToTV, tvIp);
});

ws.on('message', (raw) => {
  const { type, payload } = JSON.parse(raw.toString());
  if (type === Events.ConnectToTV) {
    if (!payload || !payload.success) finish(1, `TV connection failed: ${payload && payload.error}`);
    // The installer learns the Tizen version asynchronously after connecting; installing
    // before that skips re-signing. Give it time.
    console.log('connected; waiting for TV version check…');
    setTimeout(() => {
      console.log(`uploading ${path.basename(wgtPath)}…`);
      send(Events.InstallFile, fs.readFileSync(wgtPath).toString('base64'));
    }, 8000);
  } else if (type === Events.InstallationStatus) {
    console.log(`status: ${payload}`);
    // Undo the certificate wipe as soon as it happens.
    restoreCert();
  } else if (type === Events.InstallPackage) {
    if (payload && payload.response === 0) finish(0, `installed: ${JSON.stringify(payload.result || '')}`);
    if (payload && payload.response === 2) finish(1, 'installer has no Samsung certificate');
  } else if (type === Events.Error) {
    finish(1, `installer error: ${payload}`);
  }
});

ws.on('error', (error) => finish(1, `cannot reach TizenBrew Installer on ws://localhost:8091 (${error.message})`));
setTimeout(() => finish(1, 'timed out after 3 minutes'), 180000);
