import { initFirstRunExperience } from '../firstRunExperience.js';

/* 观测（boot-timeline）：无 window/无时间线时是空操作；不 import 是为了让
   startupChrome 的单测（剥离 import 后在 vm 里跑）保持零依赖。 */
const bootMark = (name, meta) => {
  try {
    const timeline = globalThis.__bootTimeline;
    if (timeline && typeof timeline.mark === 'function')
      timeline.mark(name, meta);
  } catch (_) {}
};

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
  const delayTimer = setTimeout(resolveDelay, 1000);
  bootMark('chrome:begin');
  /* Phase7A-D：把「输入放行」和「视觉撤遮罩」拆开。
     放行后遮罩只剩一枚不可点的状态胶囊（CSS .input-released），卡片/地图立即可用；
     视觉上完全撤除仍由 B5（gate.whenReadyToHide）+ 1s 地板决定。 */
  const releaseInput = () => {
    if (disposed || signal.aborted) return;
    if (!loadingScreen || loadingScreen.classList.contains('hidden')) return;
    loadingScreen.classList.add('input-released');
    bootMark('mask:input-released');
    /* 底图细化期：只给地图区加一层暗纱（卡片在更高层不受影响），
       遮住半屏粗 LOD 的撕裂；B5 达标撤遮罩时瞬时移除。 */
    document.getElementById('cesiumContainer')?.classList.add('boot-refining');
    /* 诚实反馈：地图此时是粗层、仍在细化（B5 视觉门还没过）。 */
    const status = loadingScreen.querySelector('.loader-status');
    if (status) status.textContent = 'Refining imagery…';
  };
  {
    const gate = globalThis.__gevBoot;
    if (gate && typeof gate.whenInputRelease === 'function') {
      gate.whenInputRelease(15000).then(releaseInput, () => {});
    }
  }
  const revealFirstRun = () => {
    if (disposed || signal.aborted || firstRun) return;
    firstRun = initializeWelcome?.({ styleManager, dataManager });
    clearTimeout(revealTimer);
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
  };
  void Promise.all([
    styleManager.initialRestorePromise,
    minimumDelay,
    /* Phase6C3-B：遮罩不再「App 恢复完就收」——先等冷启动就绪门
       （src/gev-boot-gate.js：最终视角真的有影像 + 相机落位）。
       window.__gevBoot 缺失时立即 resolve，等价旧行为。 */
    (() => {
      const gate = globalThis.__gevBoot;
      if (!gate || typeof gate.whenReadyToHide !== 'function')
        return Promise.resolve(null);
      bootMark('mask:gate-wait:begin');
      return gate
        .whenReadyToHide(26000)
        .then((reason) => {
          bootMark('mask:gate-ready', { reason });
          return reason;
        })
        .catch(() => null);
    })(),
  ])
    .catch(() => {
      /* Restoration reports its own outcome through the controls. */
    })
    .then(() => {
      if (disposed || signal.aborted) return;
      /* 观测：遮罩收起请求（= gate 判定就绪 + App 恢复完成 + 最小展示 1s 都满足） */
      bootMark('mask:hide-request');
      /* 撤遮罩 = 底图已到 B5 清晰：暗纱瞬时移除（无 transition，保证这一帧就是地图真实样子）。 */
      document.getElementById('cesiumContainer')?.classList.remove('boot-refining');
      loadingScreen.classList.add('hidden');
      bootMark('mask:hidden');
      loadingScreen.addEventListener(
        'transitionend',
        () => {
          bootMark('mask:transitionend');
          revealFirstRun();
        },
        { once: true },
      );
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
