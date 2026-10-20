/*
 * Hotstar AdBlock — TizenBrew "mods" module for Samsung Tizen TVs.
 *
 * Injected by TizenBrew into https://www.hotstar.com. Ported from the behaviour of the
 * Chrome extension "Ad Blocker for JioHotstar" (v1.1.0):
 *   1. Network blocking. Chrome's declarativeNetRequest does not exist on Tizen, so the
 *      same host/path rules are enforced in-page by wrapping fetch, XHR, sendBeacon and
 *      the src setters of script/img/iframe/media elements.
 *   2. Sponsored billboard hiding ([data-testid^="bbtype-"] containing ad markers).
 *   3. Ad video skipping (<video> inside #ad-video-container is seeked to its end).
 * TV-only additions: remote D-pad navigation, media keys, a RED-button on/off toggle and
 * a small on-screen counter.
 */
(function () {
  'use strict';

  // Same targets as the extension's rules/hotstar-ads.json. `counts` marks real ad
  // breaks; the others (tracking pixels, the IMA SDK loader) are blocked silently.
  var AD_TARGETS = [
    { host: 'pubads.g.doubleclick.net', paths: ['/gampad/ads'], counts: true },
    { host: 'securepubads.g.doubleclick.net', paths: ['/gampad/ads'], counts: true },
    { host: 'videoads.hotstar.com', paths: [], counts: true },
    { host: 'hesads.akamaized.net', paths: [], counts: true },
    { host: 'googleads.g.doubleclick.net', paths: ['/pagead', '/pcs/'], counts: false },
    { host: 'pagead2.googlesyndication.com', paths: ['/pagead', '/pcs/'], counts: false },
    { host: 'imasdk.googleapis.com', paths: ['/sdkloader/'], counts: false }
  ];

  function matchAd(value, base) {
    if (value === null || value === undefined || value === '') return null;
    var parsed;
    try {
      parsed = new URL(String(value), base);
    } catch (_error) {
      return null;
    }
    var host = parsed.hostname.toLowerCase();
    for (var i = 0; i < AD_TARGETS.length; i += 1) {
      var target = AD_TARGETS[i];
      if (target.host !== host) continue;
      if (target.paths.length === 0) return target;
      // Substring match, like Chrome's declarativeNetRequest urlFilter that the extension
      // relies on (the real IMA loader lives at /js/sdkloader/ima3.js).
      for (var j = 0; j < target.paths.length; j += 1) {
        if (parsed.pathname.indexOf(target.paths[j]) !== -1) return target;
      }
      return null;
    }
    return null;
  }

  // Loaded by Node for tests: expose the matcher and stop before touching the DOM.
  if (typeof window === 'undefined') {
    module.exports = { matchAd: matchAd, AD_TARGETS: AD_TARGETS };
    return;
  }

  if (window.__tvHotstarAdblock) return;
  window.__tvHotstarAdblock = true;

  var LOG = '[Hotstar AdBlock]';
  var ENABLED_KEY = 'tvHotstarAdblock.enabled';
  var ACTIVITY_KEY = 'tvHotstarAdblock.activity';
  var AD_CONTAINER_SELECTOR = '#ad-video-container';
  var AD_EVIDENCE_SELECTORS = ['[data-testid="ad-media"]', '[data-testid="ad-details"]'];
  var BANNER_TESTID_PREFIX = 'bbtype-';
  var BANNER_LOOKUP_DEPTH = 6;
  // One ad break fires several requests; count a break once (same window as the extension).
  var AD_BREAK_WINDOW_MS = 8000;

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009,
    RED: 403, PLAY_PAUSE: 10252, PLAY: 415, PAUSE: 19, FAST_FORWARD: 417, REWIND: 412
  };

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (_error) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_error) { /* storage unavailable */ }
  }

  var enabled = storageGet(ENABLED_KEY) !== 'false';

  // ---------------------------------------------------------------- activity counter

  function dayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function loadActivity() {
    var today = dayKey();
    try {
      var stored = JSON.parse(storageGet(ACTIVITY_KEY) || '{}');
      if (stored.day === today && typeof stored.count === 'number') return stored;
    } catch (_error) { /* corrupt value: start over */ }
    return { day: today, count: 0 };
  }

  var activity = loadActivity();
  var lastCountedAt = 0;

  function recordBlocked(target, url) {
    console.debug(LOG, 'blocked', String(url));
    if (!target.counts) return;
    var now = Date.now();
    if (lastCountedAt && now - lastCountedAt < AD_BREAK_WINDOW_MS) return;
    lastCountedAt = now;
    if (activity.day !== dayKey()) activity = { day: dayKey(), count: 0 };
    activity.count += 1;
    storageSet(ACTIVITY_KEY, JSON.stringify(activity));
    toast('Ad blocked • ' + activity.count + ' today');
  }

  // ---------------------------------------------------------------- toast

  var toastEl = null;
  var toastTimer = null;

  function toast(text) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.setAttribute('style', [
        'position:fixed', 'right:48px', 'bottom:48px', 'z-index:2147483647',
        'padding:14px 22px', 'border-radius:12px', 'background:rgba(15,16,20,.92)',
        'color:#fff', 'font:600 24px/1.2 sans-serif', 'box-shadow:0 6px 24px rgba(0,0,0,.5)',
        'transition:opacity .3s', 'opacity:0', 'pointer-events:none'
      ].join(';'));
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, 2500);
  }

  // ---------------------------------------------------------------- network blocking

  function blockedTarget(url) {
    if (!enabled) return null;
    return matchAd(url, location.href);
  }

  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (resource) {
      var url = resource && typeof resource === 'object' && 'url' in resource ? resource.url : resource;
      var target = blockedTarget(url);
      if (target) {
        recordBlocked(target, url);
        // Same outcome the page sees when Chrome blocks the request.
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return nativeFetch.apply(this, arguments);
    };
  }

  var XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    var nativeOpen = XHR.open;
    var nativeSend = XHR.send;
    XHR.open = function (method, url) {
      this.__tvAdblockUrl = blockedTarget(url) ? url : null;
      return nativeOpen.apply(this, arguments);
    };
    XHR.send = function () {
      var url = this.__tvAdblockUrl;
      if (!url) return nativeSend.apply(this, arguments);
      var xhr = this;
      recordBlocked(matchAd(url, location.href), url);
      // Fake a network error: readyState 4, status 0, then error + loadend.
      setTimeout(function () {
        try { Object.defineProperty(xhr, 'readyState', { configurable: true, value: 4 }); } catch (_e) { /* keep native */ }
        ['readystatechange', 'error', 'loadend'].forEach(function (type) {
          xhr.dispatchEvent(new Event(type));
        });
      }, 0);
    };
  }

  if (navigator.sendBeacon) {
    var nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      var target = blockedTarget(url);
      if (target) {
        recordBlocked(target, url);
        return true;
      }
      return nativeBeacon(url, data);
    };
  }

  // Elements that load a URL as soon as `src` is set.
  var GUARDED_ELEMENTS = ['HTMLScriptElement', 'HTMLImageElement', 'HTMLIFrameElement', 'HTMLMediaElement', 'HTMLSourceElement']
    .map(function (name) { return window[name]; })
    .filter(Boolean);

  function isGuarded(element) {
    for (var i = 0; i < GUARDED_ELEMENTS.length; i += 1) {
      if (element instanceof GUARDED_ELEMENTS[i]) return true;
    }
    return false;
  }

  function failElement(element) {
    setTimeout(function () { element.dispatchEvent(new Event('error')); }, 0);
  }

  GUARDED_ELEMENTS.forEach(function (ctor) {
    var descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, 'src');
    if (!descriptor || !descriptor.set) return;
    Object.defineProperty(ctor.prototype, 'src', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: function (value) {
        var target = blockedTarget(value);
        if (target) {
          recordBlocked(target, value);
          failElement(this);
          return;
        }
        descriptor.set.call(this, value);
      }
    });
  });

  var nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (typeof name === 'string' && name.toLowerCase() === 'src' && isGuarded(this)) {
      var target = blockedTarget(value);
      if (target) {
        recordBlocked(target, value);
        failElement(this);
        return undefined;
      }
    }
    return nativeSetAttribute.apply(this, arguments);
  };

  // ---------------------------------------------------------------- banners + ad video

  var HIDE_STYLE_ID = 'tv-hotstar-adblock-style';
  var HIDE_STYLE = [
    '[data-testid^="bbtype-"]:has([data-testid="ad-media"]),',
    '[data-testid^="bbtype-"]:has([data-testid="ad-details"]) { display: none !important; }'
  ].join('\n');
  // Visible focus ring for remote navigation, applied whether blocking is on or off.
  var FOCUS_STYLE = [
    'a:focus, button:focus, [role="button"]:focus, [tabindex]:focus {',
    '  outline: 4px solid #1f80e0 !important; outline-offset: 3px !important; }'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(HIDE_STYLE_ID) || !document.documentElement) return;
    var style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = enabled ? HIDE_STYLE + '\n' + FOCUS_STYLE : FOCUS_STYLE;
    document.documentElement.appendChild(style);
  }

  function isVisible(element) {
    if (!element || element.hidden) return false;
    if (typeof element.checkVisibility === 'function') {
      try { return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); } catch (_e) { /* fall back */ }
    }
    return element.getClientRects().length > 0;
  }

  function hide(element) {
    if (!element || element.hidden) return;
    element.hidden = true;
    element.style.setProperty('display', 'none', 'important');
  }

  // Walk up from an ad marker to its billboard; JS fallback for engines without :has().
  function bannerFor(marker) {
    var node = marker;
    for (var depth = 0; node && depth < BANNER_LOOKUP_DEPTH; depth += 1) {
      var testid = node.getAttribute && node.getAttribute('data-testid');
      if (typeof testid === 'string' && testid.indexOf(BANNER_TESTID_PREFIX) === 0) return node;
      node = node.parentElement;
    }
    return null;
  }

  function hideSponsoredBanners(root) {
    AD_EVIDENCE_SELECTORS.forEach(function (selector) {
      root.querySelectorAll(selector).forEach(function (marker) {
        hide(bannerFor(marker) || marker);
      });
    });
  }

  var watchedVideos = new WeakSet();
  var skippedVideos = new WeakSet();

  function skipAdVideo(video) {
    if (!enabled || !isVisible(video)) return;
    var container = video.closest(AD_CONTAINER_SELECTOR);
    if (!container || !isVisible(container)) return;
    var duration = Number(video.duration);
    if (!isFinite(duration) || duration <= 0 || video.currentTime >= duration) return;
    try {
      video.currentTime = duration;
      hide(container);
      if (!skippedVideos.has(video)) {
        skippedVideos.add(video);
        recordBlocked({ counts: true }, 'ad-video');
      }
    } catch (error) {
      console.debug(LOG, 'ad video not seekable', error);
    }
  }

  function watchVideo(video) {
    if (!watchedVideos.has(video)) {
      watchedVideos.add(video);
      ['loadedmetadata', 'durationchange', 'canplay'].forEach(function (type) {
        video.addEventListener(type, function () { skipAdVideo(video); });
      });
    }
    skipAdVideo(video);
  }

  function scan(root) {
    if (!enabled || !root || typeof root.querySelectorAll !== 'function') return;
    hideSponsoredBanners(root);
    if (root.matches && root.matches(AD_CONTAINER_SELECTOR)) root.querySelectorAll('video').forEach(watchVideo);
    root.querySelectorAll(AD_CONTAINER_SELECTOR + ' video').forEach(watchVideo);
  }

  function startDomWatch() {
    injectStyle();
    if (!enabled) return;
    new MutationObserver(function (records) {
      var roots = new Set();
      records.forEach(function (record) {
        if (record.type === 'attributes') {
          roots.add(record.target);
          return;
        }
        var container = record.target.closest && record.target.closest(AD_CONTAINER_SELECTOR);
        if (container) roots.add(container);
        record.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) roots.add(node);
        });
      });
      roots.forEach(scan);
    }).observe(document, {
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style'],
      childList: true,
      subtree: true
    });
    scan(document);
  }

  // ---------------------------------------------------------------- remote control

  var FOCUSABLE = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';

  function mainVideo() {
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i += 1) {
      if (!videos[i].closest(AD_CONTAINER_SELECTOR) && isVisible(videos[i])) return videos[i];
    }
    return null;
  }

  // On the player page the site's own keyboard handling (seek, volume) wins.
  function playerIsFront() {
    var video = mainVideo();
    if (!video) return false;
    var rect = video.getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.6;
  }

  function focusCandidates() {
    return Array.prototype.filter.call(document.querySelectorAll(FOCUSABLE), function (el) {
      if (el.disabled || !isVisible(el)) return false;
      var r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    });
  }

  function center(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function moveFocus(keyCode) {
    var candidates = focusCandidates();
    if (!candidates.length) return false;
    var current = document.activeElement;
    if (!current || current === document.body || candidates.indexOf(current) === -1) {
      candidates[0].focus();
      candidates[0].scrollIntoView({ block: 'center', inline: 'center' });
      return true;
    }
    var from = center(current.getBoundingClientRect());
    var best = null;
    var bestScore = Infinity;
    candidates.forEach(function (el) {
      if (el === current) return;
      var to = center(el.getBoundingClientRect());
      var dx = to.x - from.x;
      var dy = to.y - from.y;
      var primary;
      var cross;
      if (keyCode === KEY.LEFT) { primary = -dx; cross = Math.abs(dy); }
      else if (keyCode === KEY.RIGHT) { primary = dx; cross = Math.abs(dy); }
      else if (keyCode === KEY.UP) { primary = -dy; cross = Math.abs(dx); }
      else { primary = dy; cross = Math.abs(dx); }
      if (primary <= 1) return;
      var score = primary + cross * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (!best) return false;
    best.focus();
    best.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  }

  function toggleBlocking() {
    enabled = !enabled;
    storageSet(ENABLED_KEY, String(enabled));
    toast(enabled ? 'Ad blocking ON • reloading…' : 'Ad blocking OFF • reloading…');
    // Request hooks are installed at start-up, so a reload applies the new state cleanly.
    setTimeout(function () { location.reload(); }, 1200);
  }

  function handleMediaKey(keyCode) {
    var video = mainVideo();
    if (!video) return false;
    if (keyCode === KEY.PLAY_PAUSE) { if (video.paused) video.play(); else video.pause(); }
    else if (keyCode === KEY.PLAY) video.play();
    else if (keyCode === KEY.PAUSE) video.pause();
    else if (keyCode === KEY.FAST_FORWARD) video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
    else if (keyCode === KEY.REWIND) video.currentTime = Math.max(0, video.currentTime - 10);
    else return false;
    return true;
  }

  document.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    var handled = false;
    if (code === KEY.RED) {
      toggleBlocking();
      handled = true;
    } else if (code === KEY.PLAY_PAUSE || code === KEY.PLAY || code === KEY.PAUSE ||
               code === KEY.FAST_FORWARD || code === KEY.REWIND) {
      handled = handleMediaKey(code);
    } else if (code === KEY.BACK) {
      if (document.fullscreenElement) { document.exitFullscreen(); handled = true; }
      else if (history.length > 1) { history.back(); handled = true; }
    } else if (code >= KEY.LEFT && code <= KEY.DOWN) {
      var typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (!typing && !playerIsFront()) handled = moveFocus(code);
    } else if (code === KEY.ENTER) {
      var el = document.activeElement;
      // <a>/<button> already click on Enter; role="button" divs do not.
      if (el && el !== document.body && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
        el.click();
        handled = true;
      }
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  // ---------------------------------------------------------------- start

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDomWatch, { once: true });
  } else {
    startDomWatch();
  }
  window.addEventListener('load', function () {
    toast(enabled ? 'Hotstar AdBlock ON • RED button toggles' : 'Hotstar AdBlock OFF • RED button toggles');
  }, { once: true });
  console.info(LOG, enabled ? 'enabled' : 'disabled');
})();
