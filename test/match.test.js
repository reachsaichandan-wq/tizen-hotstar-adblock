'use strict';

const assert = require('node:assert/strict');
const { matchAd } = require('../userScript.js');

const BASE = 'https://www.hotstar.com/in';

const blocked = [
  ['https://pubads.g.doubleclick.net/gampad/ads?iu=/123/hotstar', true],
  ['https://securepubads.g.doubleclick.net/gampad/ads?sz=1x1', true],
  ['https://videoads.hotstar.com/vast/xyz.xml', true],
  ['https://hesads.akamaized.net/videos/ad_720p.mp4', true],
  ['https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/', false],
  ['https://pagead2.googlesyndication.com/pcs/activeview?x=1', false],
  ['https://imasdk.googleapis.com/js/sdkloader/ima3.js', false],
];

const allowed = [
  'https://www.hotstar.com/in/home',
  'https://api.hotstar.com/play/v4/playback',
  'https://hses.akamaized.net/videos/main/master.m3u8',
  'https://pubads.g.doubleclick.net/other/path',
  'https://imasdk.googleapis.com/js/core/bridge.html',
  '/relative/path.json',
  '',
  null,
  'not a url ::',
];

for (const [url, counts] of blocked) {
  const target = matchAd(url, BASE);
  assert.ok(target, `expected block: ${url}`);
  assert.equal(target.counts, counts, `counts flag for ${url}`);
}

for (const url of allowed) {
  assert.equal(matchAd(url, BASE), null, `expected allow: ${url}`);
}

// Host match is case-insensitive, like the extension.
assert.ok(matchAd('https://VIDEOADS.HOTSTAR.COM/x', BASE));

console.log(`ok - ${blocked.length} blocked, ${allowed.length + 1} allowed checks passed`);
