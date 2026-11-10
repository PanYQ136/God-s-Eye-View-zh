- Restore the runtime `window.__gevViewer` handle: the perf HUD (FPS badge,
  perf-mode toggle, adaptive resolution), the graphics settings panel and the
  target dossier all wait for that name, which an earlier merge stopped
  assigning, so they silently never started. The handle is now written once
  when the viewer is created and stays for the session (#1309).
- Bound every cost endpoint: the OpenAI HUD summary and both Google Places
  routes now carry an upstream deadline, so a stalled provider yields a clean
  502 instead of holding the request to the platform limit (#1309).
- Bound the Kartverket ground-height lookup with a referenced timer: an
  `AbortSignal.timeout()` deadline is unref'ed in Node, so a lookup that was the
  only pending work could outlive its own deadline (#1309).
- Answer an oversized provider-key POST with 413 instead of a dropped
  connection: the endpoint drains past its cap rather than destroying the
  socket, and counts bytes rather than UTF-16 units (#1309).
- Tighten the shipped security headers: `'unsafe-eval'` is gone from
  `script-src` (verified in Chromium against the built app with zero CSP
  violations) and `Strict-Transport-Security` is sent. Event imagery and models
  gain a day-long cache with stale-while-revalidate (#1309).
