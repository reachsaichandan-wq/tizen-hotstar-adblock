/*
 * Launcher page. Flow (same handshake TizenBrew uses):
 *   1. Make sure the background service is running (it listens on ws://127.0.0.1:8095).
 *   2. Ask it whether DevTools is attached to this app.
 *      - attached      -> navigate to hotstar.com; the service injects userScript.js there.
 *      - not attached  -> ask the service to relaunch this app in debug mode, then exit.
 */
(function () {
  'use strict';

  var HOTSTAR_URL = 'https://www.hotstar.com/in';
  var SERVICE_PORT = 8095;
  var KEYS = ['ColorF0Red', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaFastForward', 'MediaRewind'];
  var BACK = 10009;
  var ENTER = 13;

  var statusEl = document.getElementById('status');
  var hintEl = document.getElementById('hint');
  var socket = null;
  var pollTimer = null;
  var waitingForUser = false;

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
    try { return webapis.network.getIp() || '127.0.0.1'; } catch (_e) { return '127.0.0.1'; }
  }

  function send(message) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  function openHotstar() {
    try { sessionStorage.setItem('hotstarOpened', '1'); } catch (_e) { /* ignore */ }
    setStatus('Opening Hotstar…', 'Ad blocking is active. RED button turns it on/off.');
    registerKeys();
    setTimeout(function () { location.href = HOTSTAR_URL; }, 400);
  }

  function handleStatus(status) {
    clearTimeout(pollTimer);
    if (status.debugReady) {
      // Coming back from Hotstar with the Back key: don't bounce straight back in.
      var returned = false;
      try { returned = sessionStorage.getItem('hotstarOpened') === '1'; } catch (_e) { /* ignore */ }
      if (returned) {
        waitingForUser = true;
        setStatus('Ad blocking is ready.', 'ENTER: open Hotstar    BACK: exit');
        return;
      }
      openHotstar();
      return;
    }
    if (status.launching) {
      setStatus('Connecting ad blocker…', status.lastError || '');
      pollTimer = setTimeout(function () { send({ type: 'status' }); }, 500);
      return;
    }
    if (status.canDebug === false) {
      setStatus('Developer Mode Host PC IP must be 127.0.0.1',
        'Apps → 12345 → Host PC IP = 127.0.0.1 → hold power until the Samsung logo shows → open this app again.', true);
      return;
    }
    if (status.lastError) {
      setStatus('Could not start ad blocker: ' + status.lastError,
        'Press ENTER to retry, BACK to exit.', true);
      waitingForUser = true;
      return;
    }
    setStatus('Restarting app with ad blocker…');
    send({ type: 'relaunch', tvIP: tvIp() });
    setTimeout(function () { app().exit(); }, 300);
  }

  function startService(onStarted) {
    var pkgId = app().appInfo.packageId;
    tizen.application.launchAppControl(
      new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
      pkgId + '.Service',
      onStarted,
      function (error) { setStatus('Service failed to start: ' + error.message, 'Press BACK to exit.', true); }
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
        setStatus('Service did not respond.', 'Press ENTER to retry, BACK to exit.', true);
        waitingForUser = true;
      }
    };
  }

  document.addEventListener('keydown', function (event) {
    if (event.keyCode === BACK) {
      event.preventDefault();
      app().exit();
    } else if (event.keyCode === ENTER && waitingForUser) {
      waitingForUser = false;
      try { sessionStorage.removeItem('hotstarOpened'); } catch (_e) { /* ignore */ }
      if (socket && socket.readyState === 1) send({ type: 'status', reset: true });
      else connect(0);
    }
  });

  registerKeys();
  connect(0);
})();
