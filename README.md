# Hotstar AdBlock for Samsung TV (TizenBrew module)

Blocks known JioHotstar ad requests, hides sponsored billboards and skips ad videos when you
watch **hotstar.com inside TizenBrew** on a Samsung Tizen TV.

It's a port of the Chrome extension "Ad Blocker for JioHotstar" (v1.1.0). It only works on the
Hotstar **website** opened through TizenBrew. It does not touch the official Hotstar Tizen app,
because Tizen sandboxes every installed app.

## What it does

| Feature | How |
|---|---|
| Block ad requests | Wraps `fetch`, `XMLHttpRequest`, `sendBeacon` and the `src` setters of script/img/iframe/video. Requests to the hosts below fail as if they hit a network error. |
| Hide sponsored billboards | CSS `:has()` rule plus a MutationObserver fallback on `[data-testid^="bbtype-"]` that contains `ad-media` / `ad-details` |
| Skip ad videos | `<video>` inside `#ad-video-container` is seeked to its end and hidden |
| Remote control | D-pad focus navigation, Enter clicks, Back goes back, media keys play/pause/±10s |
| On/off | **RED** button toggles blocking and reloads the page |
| Counter | Toast "Ad blocked • N today" (one count per ad break, 8 s window) |

Blocked hosts (copied from the extension's ruleset):

```
pubads.g.doubleclick.net        /gampad/ads   (ad break)
securepubads.g.doubleclick.net  /gampad/ads   (ad break)
videoads.hotstar.com            *             (ad break)
hesads.akamaized.net            *             (ad break)
googleads.g.doubleclick.net     /pagead /pcs/ (tracking, silent)
pagead2.googlesyndication.com   /pagead /pcs/ (tracking, silent)
imasdk.googleapis.com           /sdkloader/   (IMA SDK loader, silent)
```

To add a host, edit `AD_TARGETS` at the top of `userScript.js`.

## Install on the TV

Target TV: UA55DU8300 (2024 DU8000 series, Tizen 8). Not yet run on the TV itself.

1. **Developer Mode** (already done): Apps → type `12345` → Developer mode **On** → Host PC IP =
   your PC's LAN IP → restart the TV.
2. **Install TizenBrew**: download *TizenBrew Installer* for Windows from
   <https://github.com/reisxd/TizenBrew/releases>, run it, pick the TV, click **Install TizenBrew**.
   Tizen 7+ asks you to sign in to a Samsung account so it can create a signing certificate.
3. **Publish this folder to GitHub** (public repo), e.g. `reachsaichandan-wq/tizen-hotstar-adblock`.
   TizenBrew fetches modules from GitHub or npm via jsDelivr.
4. **Add the module**: open TizenBrew on the TV → Module Manager → Add → type
   `reachsaichandan-wq/tizen-hotstar-adblock` (or add it from the Installer on the PC).
5. Launch **Hotstar AdBlock** from TizenBrew. A toast "Hotstar AdBlock ON" confirms the injection.

After every change, push to GitHub. jsDelivr caches for up to 12 h; purge it at
`https://purge.jsdelivr.net/gh/reachsaichandan-wq/tizen-hotstar-adblock@main/userScript.js`.

## Test on the PC

```bash
npm test          # URL matcher unit tests (Node)
node test/server.js   # open http://localhost:5178 → browser harness, 14 checks
```

## Limits

- **Hotstar web playback on the TV is not verified yet.** If hotstar.com refuses the TV browser
  (unsupported browser or DRM error), this module can't help there.
- **Server-side inserted ads** (often used for live cricket) are stitched into the video stream
  itself. No request blocker can remove those, and the Chrome extension can't either.
- Hotstar can rename hosts or `data-testid`s at any time; update `AD_TARGETS` and the selectors.
- Only the top frame gets the script.
