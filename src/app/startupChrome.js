import { initFirstRunExperience } from '../firstRunExperience.js';

/**
 * Fired the moment the cover starts leaving. Deferred warm-ups (the 2.7 MB
 * EGM96 grid in `src/data/geoid.js`) listen for this so they stop competing
 * with the first-paint chunks. The literal is duplicated there on purpose:
 * `data/` must not import from `app/`, and the event name is the contract.
 */
const STARTUP_REVEAL_EVENT = 'gev:startup-revealed';

/** Announce the reveal to deferred work; no-op outside a browser (tests). */
function announceStartupReveal() {
  if (typeof window === 'undefined') return;
  window.__gevStartupRevealed = true;
  if (typeof Event === 'function')
    window.dispatchEvent(new Event(STARTUP_REVEAL_EVENT));
}

/** Reveal welcome controls only after restoration and the loading transition. */
export function startApplicationChrome({
  loadingScreen,
  styleManager,
  dataManager,
  signal,
  initializeWelcome = initFirstRunExperience,
  initializeSettings,
}) {
  let disposed = false;
  let firstRun;
  let revealTimer;
  let resolveDelay;
  const minimumDelay = new Promise((resolve) => {
    resolveDelay = resolve;
  });
  /* Floor that keeps the loading screen from flickering when restoration is
     instant. It is a lower bound, not extra work: the cover still waits for
     `initialRestorePromise`. 1000ms was longer than the 450ms fade below, so
     the tail of the hold was pure waiting on cold start. */
  const delayTimer = setTimeout(resolveDelay, 350);
  const revealFirstRun = () => {
    if (disposed || signal.aborted || firstRun) return;
    firstRun = initializeWelcome?.({ styleManager, dataManager });
    clearTimeout(revealTimer);
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
  };
  void Promise.all([styleManager.initialRestorePromise, minimumDelay])
    .catch(() => {
      /* Restoration reports its own outcome through the controls. */
    })
    .then(() => {
      if (disposed || signal.aborted) return;
      loadingScreen.classList.add('hidden');
      announceStartupReveal();
      loadingScreen.addEventListener('transitionend', revealFirstRun, {
        once: true,
      });
      revealTimer = setTimeout(revealFirstRun, 900);
    });
  const keySetup = Promise.resolve(
    signal.aborted ? null : initializeSettings?.({ signal }),
  );
  // Own the pending initializer too; it must not reveal a dialog after abort.
  void keySetup.catch(() =>
    console.error('Provider settings initialization failed'),
  );
  return async () => {
    disposed = true;
    clearTimeout(delayTimer);
    clearTimeout(revealTimer);
    resolveDelay();
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
    firstRun?.destroy();
    (await keySetup.catch(() => null))?.destroy();
  };
}
