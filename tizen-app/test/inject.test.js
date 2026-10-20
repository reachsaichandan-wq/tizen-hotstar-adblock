'use strict';

// End-to-end check of service/inject.js against real Chromium (Edge or Chrome, headless).
// www.hotstar.com is mapped to a local fake page, so the origin filter and the injected
// userScript.js behave exactly as they would on the TV.
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const serviceDir = path.join(__dirname, '..', 'service');
const { attach } = require(path.join(serviceDir, 'inject.js'));
const CDP = require(path.join(serviceDir, 'node_modules', 'chrome-remote-interface'));
const script = fs.readFileSync(path.join(__dirname, '..', '..', 'userScript.js'), 'utf8');

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const browserPath = process.env.CHROME_PATH || BROWSERS.find((p) => fs.existsSync(p));
assert.ok(browserPath, 'no Chromium-based browser found; set CHROME_PATH');

const PAGE = `<!doctype html><html><body>
<div data-testid="bbtype-hero" id="sponsored"><div><span data-testid="ad-media">ad</span></div></div>
<div data-testid="bbtype-hero" id="editorial"><div>editorial</div></div>
<script>window.pageSawFetch = String(window.fetch).indexOf('[native code]') === -1;</script>
</body></html>`;

const DEBUG_PORT = 9333;

async function main() {
  const server = http.createServer((req, res) => res.end(PAGE)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const sitePort = server.address().port;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hsab-cdp-'));
  const browser = spawn(browserPath, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    `--host-resolver-rules=MAP www.hotstar.com 127.0.0.1:${sitePort}`,
    '--no-first-run',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    // Same call the TV service makes; retries while the browser starts.
    await new Promise((resolve, reject) => attach({
      port: DEBUG_PORT,
      host: '127.0.0.1',
      script,
      maxAttempts: 20,
      log: () => {},
      onReady: resolve,
      onDisconnect: () => {},
      onFail: reject,
    }));

    // Drive the page with a second client, like the launcher's location.href change.
    const client = await CDP({ port: DEBUG_PORT, host: '127.0.0.1', local: true });
    await client.Page.enable();
    const loaded = client.Page.loadEventFired();
    await client.Page.navigate({ url: 'http://www.hotstar.com/in' });
    await loaded;
    await new Promise((r) => setTimeout(r, 300));

    const evalJson = async (expression) => {
      const { result } = await client.Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true });
      return result.value;
    };

    const checks = await evalJson(`(async () => {
      let fetchBlocked = false;
      try { await fetch('https://pubads.g.doubleclick.net/gampad/ads?x=1'); } catch (e) { fetchBlocked = e instanceof TypeError; }
      return {
        origin: location.origin,
        installed: window.__tvHotstarAdblock === true,
        hookedBeforePageScripts: window.pageSawFetch === true,
        fetchBlocked,
        sponsoredHidden: getComputedStyle(document.getElementById('sponsored')).display === 'none',
        editorialVisible: getComputedStyle(document.getElementById('editorial')).display !== 'none',
      };
    })()`);
    await client.close();

    console.log(checks);
    assert.equal(checks.origin, 'http://www.hotstar.com');
    assert.equal(checks.installed, true, 'userScript not injected');
    assert.equal(checks.hookedBeforePageScripts, true, 'script ran after page scripts');
    assert.equal(checks.fetchBlocked, true, 'ad fetch not blocked');
    assert.equal(checks.sponsoredHidden, true, 'sponsored billboard visible');
    assert.equal(checks.editorialVisible, true, 'editorial billboard hidden');
    console.log('ok - injection test passed');
  } finally {
    browser.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
