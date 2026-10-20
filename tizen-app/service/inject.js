"use strict";

const CDP = require('chrome-remote-interface');

const HOTSTAR_ORIGIN = /^https?:\/\/([a-z0-9-]+\.)*hotstar\.com$/i;

/*
 * Attaches to a DevTools endpoint and injects `script` into hotstar.com documents (or
 * every document when `allOrigins`, for the native app whose pages are not on hotstar.com).
 * Retries while the debug-mode app is still starting. Calls onReady(client) once
 * attached, onDisconnect() when DevTools goes away and onFail(error) after the last retry.
 */
function attach(options, attempt) {
    const { port, host, script, allOrigins, maxAttempts, onReady, onDisconnect, onFail, log } = options;
    attempt = attempt || 1;
    CDP({ port, host, local: true }, (client) => {
        log('DevTools attached on ' + host + ':' + port);

        // Runs at document start of every later navigation, before Hotstar's own scripts.
        client.Page.enable();
        client.Page.addScriptToEvaluateOnNewDocument({ source: script })
            .catch((e) => log('addScriptToEvaluateOnNewDocument failed: ' + e.message));

        // Fallback for engines that ignore the above; the script guards against running twice.
        client.Runtime.enable();
        client.on('Runtime.executionContextCreated', (msg) => {
            if (allOrigins || HOTSTAR_ORIGIN.test(msg.context.origin || '')) {
                client.Runtime.evaluate({ expression: script, contextId: msg.context.id })
                    .catch((e) => log('evaluate failed: ' + e.message));
            }
        });

        client.on('disconnect', () => {
            log('DevTools disconnected');
            onDisconnect();
        });
        onReady(client);
    }).on('error', (err) => {
        if (attempt >= maxAttempts) {
            onFail(err);
            return;
        }
        setTimeout(() => attach(options, attempt + 1), 750);
    });
}

module.exports = { attach, HOTSTAR_ORIGIN };
