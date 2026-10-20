'use strict';

// Builds dist/HotstarAdBlock.wgt (unsigned). The TizenBrew Installer re-signs it with
// your Samsung certificate when it installs it on the TV.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appDir = __dirname;
const serviceDir = path.join(appDir, 'service');
const outDir = path.join(appDir, 'dist');

function run(command, cwd) {
  console.log(`> ${command}`);
  execSync(command, { cwd, stdio: 'inherit' });
}

if (!fs.existsSync(path.join(serviceDir, 'node_modules'))) run('npm install --no-audit --no-fund', serviceDir);
run('npm run build', serviceDir);
fs.copyFileSync(path.join(appDir, '..', 'userScript.js'), path.join(serviceDir, 'dist', 'userScript.js'));

// Secret for the developer bridge (port 8096). Kept out of git; reused across builds so
// an installed app keeps matching the local copy.
const tokenFile = path.join(appDir, '.bridge-token');
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, require('node:crypto').randomBytes(24).toString('hex'));
fs.copyFileSync(tokenFile, path.join(serviceDir, 'dist', 'bridge-token.txt'));

const AdmZip = require(path.join(serviceDir, 'node_modules', 'adm-zip'));
const zip = new AdmZip();
for (const file of ['config.xml', 'icon.png', 'index.html', 'app.js']) {
  zip.addLocalFile(path.join(appDir, file));
}
zip.addLocalFolder(path.join(serviceDir, 'dist'), 'service/dist');

fs.mkdirSync(outDir, { recursive: true });
const wgt = path.join(outDir, 'HotstarAdBlock.wgt');
zip.writeZip(wgt);
console.log(`built ${wgt} (${fs.statSync(wgt).size} bytes)`);
