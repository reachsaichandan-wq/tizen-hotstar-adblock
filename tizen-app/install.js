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

const APP_ID = 'HtsAdBlock.HotstarAdBlock';
const PACKAGE_ID = 'HtsAdBlock';
const PUSHED_PATH = '/home/owner/share/tmp/sdk_tools/package.wgt';
const version = /<widget[^>]*\bversion="([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, 'config.xml'), 'utf8'))[1];

function installedVersion() {
  return fetch(`http://${tvIp}:8001/api/v2/applications/${APP_ID}`)
    .then((res) => res.json())
    .then((info) => (info.id === APP_ID ? info.version : null))
    .catch(() => null);
}

// The installer pushes the package without waiting for SDB acknowledgements and starts
// the install straight away, so the TV can install a stale package.wgt left from an
// earlier install. By now the push has landed; install that file again ourselves.
function reinstallPushedPackage() {
  const adbhost = require(path.join(__dirname, 'service', 'node_modules', 'adbhost'));
  return new Promise((resolve) => {
    const adb = adbhost.createConnection({ host: tvIp, port: 26101 });
    let output = '';
    adb._stream.on('connect', () => {
      const shell = adb.createStream(`shell:0 vd_appinstall ${PACKAGE_ID} ${PUSHED_PATH}`);
      shell.on('data', (data) => {
        output += data.toString();
        if (output.includes('spend time')) {
          adb._stream.end();
          resolve(output);
        }
      });
    });
    adb._stream.on('error', (error) => resolve(`sdb error: ${error.message}`));
    setTimeout(() => resolve(output || 'sdb: no reply'), 30000);
  });
}

async function verify() {
  await new Promise((r) => setTimeout(r, 3000));
  if (await installedVersion() === version) finish(0, `verified: ${APP_ID} ${version} on the TV`);
  console.log('TV did not register the new package; reinstalling the pushed file…');
  ws.close();
  await new Promise((r) => setTimeout(r, 3000));
  console.log(await reinstallPushedPackage());
  const after = await installedVersion();
  if (after === version) finish(0, `verified: ${APP_ID} ${version} on the TV`);
  finish(1, `install not verified (TV reports version ${after})`);
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
    if (payload && payload.response === 0) {
      restoreCert();
      console.log('installer reports installed; verifying…');
      verify();
    }
    if (payload && payload.response === 2) finish(1, 'installer has no Samsung certificate');
  } else if (type === Events.Error) {
    finish(1, `installer error: ${payload}`);
  }
});

ws.on('error', (error) => finish(1, `cannot reach TizenBrew Installer on ws://localhost:8091 (${error.message})`));
setTimeout(() => finish(1, 'timed out after 3 minutes'), 180000);
