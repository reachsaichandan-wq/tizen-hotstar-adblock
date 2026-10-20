/*
 * Launcher page.
 *   Default: ask the background service to debug-launch the Samsung JioHotstar app and
 *   inject the ad blocker into it, then get out of the way.
 *   Fallback (ENTER after a failure): relaunch this app in debug mode and open the
 *   hotstar.com website with the blocker injected.
 */
(function () {
  'use strict';

  var HOTSTAR_URL = 'https://www.hotstar.com/in';
  var SERVICE_PORT = 8095;
  var KEYS = ['ColorF0Red', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaFastForward', 'MediaRewind'];
  var BACK = 10009;
  var ENTER = 13;
  var WEBSITE_FLAG = 'hotstarAdblock.websiteMode';

  var statusEl = document.getElementById('status');
  var hintEl = document.getElementById('hint');
  var socket = null;
  var pollTimer = null;
  var unknownPolls = 0;
  var nativeRequested = false;
  var onEnter = null;

  function setStatus(text, hint, isError) {
    statusEl.textContent = text;
    statusEl.className = isError ? 'error' : '';
    hintEl.textContent = hint || '';
  }

  function app() {
    return tizen.application.getCurrentApplication();
  }

  function registerKeys() {
    KEYS.forEach(function (key) {
      try { tizen.tvinputdevice.registerKey(key); } catch (_e) { /* key not on this model */ }
    });
  }

  function tvIp() {
    try { return webapis.network.getIp() || ''; } catch (_e) { return ''; }
  }

  function flag(name, value) {
    try {
      if (value === undefined) return localStorage.getItem(name);
      if (value === null) localStorage.removeItem(name);
      else localStorage.setItem(name, value);
    } catch (_e) { /* storage unavailable */ }
    return null;
  }

  function send(message) {
    message.tvIP = tvIp();
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  function poll(delay) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(function () { send({ type: 'status' }); }, delay);
  }

  function startWebsiteMode() {
    flag(WEBSITE_FLAG, '1');
    setStatus('Restarting app with ad blocker…');
    send({ type: 'relaunch' });
    setTimeout(function () { app().exit(); }, 300);
  }

  function handleWebsite(status) {
    if (status.debugReady) {
      flag(WEBSITE_FLAG, null);
      setStatus('Opening hotstar.com…', 'Ad blocking is active. RED button turns it on/off.');
      registerKeys();
      setTimeout(function () { location.href = HOTSTAR_URL; }, 400);
    } else if (status.launching) {
      setStatus('Connecting ad blocker…');
      poll(500);
    } else if (status.lastError) {
      flag(WEBSITE_FLAG, null);
      setStatus('Could not start website mode: ' + status.lastError, 'BACK: exit', true);
    } else {
      startWebsiteMode();
    }
  }

  function handleStatus(status) {
    clearTimeout(pollTimer);

    if (status.canDebug === false) {
      flag(WEBSITE_FLAG, null);
      setStatus('Developer Mode Host PC IP must be 127.0.0.1',
        'Apps → 12345 → Host PC IP = 127.0.0.1 → hold power until the Samsung logo shows → open this app again.', true);
      return;
    }
    if (status.canDebug === null && unknownPolls < 6) {
      unknownPolls += 1;
      poll(500);
      return;
    }

    if (flag(WEBSITE_FLAG) === '1') {
      handleWebsite(status);
      return;
    }

    if (!nativeRequested) {
      nativeRequested = true;
      setStatus('Opening JioHotstar with ad blocker…', 'This takes a few seconds.');
      send({ type: 'launchNative' });
      return;
    }
    if (status.native && status.native.ok === true) {
      setStatus('Ad blocker attached to JioHotstar.');
      setTimeout(function () { app().exit(); }, 500);
      return;
    }
    if (status.native && status.native.ok === false) {
      setStatus('Could not attach to the JioHotstar app: ' + status.native.error,
        'ENTER: open hotstar.com website instead    BACK: exit', true);
      onEnter = startWebsiteMode;
      return;
    }
    poll(500);
  }

  function startService(onStarted) {
    var pkgId = app().appInfo.packageId;
    tizen.application.launchAppControl(
      new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
      pkgId + '.Service',
      onStarted,
      function (error) { setStatus('Service failed to start: ' + error.message, 'BACK: exit', true); }
    );
  }

  function connect(attempt) {
    socket = new WebSocket('ws://127.0.0.1:' + SERVICE_PORT);
    socket.onopen = function () { send({ type: 'status' }); };
    socket.onmessage = function (event) {
      var message = JSON.parse(event.data);
      if (message.type === 'status') handleStatus(message);
    };
    socket.onerror = function () {
      socket.onclose = null;
      if (attempt === 0) {
        setStatus('Starting service…');
        startService(function () { setTimeout(function () { connect(1); }, 1000); });
      } else if (attempt < 20) {
        setTimeout(function () { connect(attempt + 1); }, 500);
      } else {
        setStatus('Service did not respond.', 'ENTER: retry    BACK: exit', true);
        onEnter = function () { connect(0); };
      }
    };
  }

  document.addEventListener('keydown', function (event) {
    if (event.keyCode === BACK) {
      event.preventDefault();
      flag(WEBSITE_FLAG, null);
      app().exit();
    } else if (event.keyCode === ENTER && onEnter) {
      var action = onEnter;
      onEnter = null;
      action();
    }
  });

  registerKeys();
  connect(0);
})();
