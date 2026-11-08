/* ============================================================================
   src/lc/app-adapter.js —— L0 App 触点（DOM/API 的唯一入口）
   ----------------------------------------------------------------------------
   架构 §5.1：snapshot 只在这里产生，且只在**测量帧**批量读一次（读一次全缓存）。
   职责：
     · measure(pushes) → Snapshot（viewport / safe / 每卡 mini+visual+contentH / dock / protected）
     · 占位与脱层（#lc-stage）—— 展开卡必须离开 App 容器，否则被 max-height/flex 钳制
     · 内容高度测量（唯一「写-读-还原」通道，只在测量帧发生）
     · App 面板 API 的唯一入口（setPanelCollapsed）→ 供 CollapsePort 调用
   明确禁止：改相位、决定盒子、写动画。
   ========================================================================== */
import * as bridge from '../bridge.js';
import { CARDS, CARD_IDS, GEO, PROTECT_IDS, HEAD_SEL } from './cards.js';

const px = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
const rectOf = (el) => {
  if (!el) return null;
  const b = el.getBoundingClientRect();
  if (!b || (!b.width && !b.height)) return null;
  return {
    x: px(b.x),
    y: px(b.y),
    w: px(b.width),
    h: px(b.height),
    right: px(b.right),
    bottom: px(b.bottom),
  };
};
export function createAdapter({ ids = CARD_IDS, doc = document } = {}) {
  const stage = (() => {
    let el = doc.getElementById('lc-stage');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'lc-stage';
      el.setAttribute('aria-hidden', 'false');
      el.className = 'lc-stage';
      doc.body.appendChild(el);
    }
    return el;
  })();

  const els = new Map();
  const placeholders = new Map();
  const origin = new Map(); // id → {parent, next}

  function el(id) {
    const cached = els.get(id);
    if (!cached || !cached.isConnected) els.set(id, doc.getElementById(id));
    return els.get(id);
  }

  const headerOf = (id) => {
    const e = el(id);
    if (!e) return null;
    return e.querySelector(HEAD_SEL);
  };

  /* ── 占位 / 脱层 ────────────────────────────────────────────────────────── */
  function ensurePlaceholder(id, box) {
    const e = el(id);
    if (!e) return null;
    let ph = placeholders.get(id);
    if (!ph || !ph.isConnected) {
      ph = doc.createElement('div');
      ph.className = 'gev-lc-placeholder';
      ph.dataset.lcFor = id;
      /* 占位必须继承原卡的 flex order（左栈用 order 排序），否则占位跑到最上 */
      try {
        const ord = getComputedStyle(e).order;
        if (ord) ph.style.order = ord;
      } catch (_) {}
      if (e.parentElement) e.parentElement.insertBefore(ph, e);
      /* 占位必须**逐像素复刻原卡槽位**，不能靠文档流/静态位置：
         App 的 #left-panel-stack / 右栏用绝对定位（top 由 App JS 写），新插入的占位没有
         inline top，一旦同轨兄弟卡回栈（脱离文档流），占位的静态位置会塌到栈顶（94）——
         实测 data→scene 切换时 scene 的 mini 被读成 y=94（= data 的槽位），导致展开盒
         跳位 56px、FLIP 重启动画、并瞬时压住 data 的 mini（mini-overlap 违规）。 */
      ph.style.pointerEvents = 'none';
      placeholders.set(id, ph);
    }
    if (box) {
      ph.style.width = Math.round(box.w) + 'px';
      ph.style.height = Math.round(box.h) + 'px';
    }
    return ph;
  }

  function placeholderRect(id) {
    const ph = placeholders.get(id);
    return ph && ph.isConnected ? rectOf(ph) : null;
  }

  /** 把展开卡移到 #lc-stage（唯一脱层实现）。
      关键：脱层瞬间就把 mini 几何写成 inline fixed —— 否则卡片在新容器里会先落到
      静态位置（左上角）闪一帧；这段几何也正是 FLIP 的起点。 */
  function stageCard(id, miniBox) {
    const e = el(id);
    if (!e) return false;
    if (!origin.has(id) && e.parentElement && e.parentElement !== stage) {
      origin.set(id, { parent: e.parentElement, next: e.nextElementSibling });
    }
    const ph = ensurePlaceholder(id, miniBox);
    if (e.parentElement !== stage) stage.appendChild(e);
    if (miniBox && !parseFloat(e.style.width || '0')) {
      e.style.position = 'fixed';
      e.style.left = Math.round(miniBox.x) + 'px';
      e.style.top = Math.round(miniBox.y) + 'px';
      e.style.width = Math.round(miniBox.w) + 'px';
      e.style.height = Math.round(miniBox.h) + 'px';
      e.style.transform = 'none';
    }
    void ph;
    return true;
  }

  /** 回填槽位：先清 inline 几何、再插回占位前、最后删占位。 */
  function unstageCard(id) {
    const e = el(id);
    const ph = placeholders.get(id);
    if (!e) return;
    e.style.left = '';
    e.style.top = '';
    e.style.width = '';
    e.style.height = '';
    e.style.transform = '';
    e.style.overflowY = '';
    e.removeAttribute('data-lc-phase');
    e.classList.remove('dock-panel');
    const o = origin.get(id);
    if (ph && ph.isConnected) {
      const parent = ph.parentElement || (o && o.parent);
      if (parent && e.parentElement !== parent) parent.insertBefore(e, ph);
      ph.remove();
    } else if (
      o &&
      o.parent &&
      o.parent.isConnected &&
      e.parentElement !== o.parent
    ) {
      o.parent.insertBefore(e, o.next && o.next.isConnected ? o.next : null);
    }
    placeholders.delete(id);
    origin.delete(id);
  }

  function isStaged(id) {
    const e = el(id);
    return !!e && e.parentElement === stage;
  }

  function detachedByApp(id) {
    const e = el(id);
    return !!e && e.parentElement !== stage;
  }

  /* ── 内容高度（唯一允许的「写-读-还原」测量通道）──────────────────────── */
  function contentHeight(id, width, fallback) {
    const e = el(id);
    if (!e) return fallback || GEO.PANEL_MIN_H;
    const st = e.style;
    const save = {
      width: st.width,
      height: st.height,
      position: st.position,
      visibility: st.visibility,
      left: st.left,
      top: st.top,
      right: st.right,
      bottom: st.bottom,
      overflowY: st.overflowY,
    };
    /* 必须先把卡切到**目标呈现**再量：App 的披露已打开、但材质层的 open 态规则
       （data-lc-phase + .dock-panel）还没落的那一帧，量到的是 App 原始展开态内容
       （location 600 / control 694），会让 dock 面板按 maxH 撑满 → 底部大片空白（P0-3 回归）。
       这里在同一个任务里临时切到 open 呈现，量完逐项还原，不触发重排泄漏。 */
    const savePhase = e.dataset.lcPhase;
    const hadDock = e.classList.contains('dock-panel');
    let h = fallback;
    try {
      if (CARDS[id] && CARDS[id].rail === 'dock') e.classList.add('dock-panel');
      e.dataset.lcPhase = 'open';
      st.width = Math.round(width) + 'px';
      st.height = 'auto';
      st.position = isStaged(id) ? 'absolute' : 'fixed';
      st.left = '-99999px';
      st.top = '0px';
      /* App 给 dock 卡同时设了 top+bottom（如 bottom:130px）：height:auto 会被拉伸成
         「视口高 − top − bottom」= 516px，量出来的永远是 maxH。测量期间必须解除这个约束。 */
      st.right = 'auto';
      st.bottom = 'auto';
      st.visibility = 'hidden';
      st.overflowY = 'auto';
      h = Math.max(0, Math.ceil(e.scrollHeight));
      /* 只读诊断环（断言/排障用；不影响渲染）：最近 12 次内容高度测量 */
      try {
        const w = typeof window !== 'undefined' ? window : null;
        if (w) {
          w.__lc = w.__lc || {};
          w.__lc.chDbg = w.__lc.chDbg || [];
          w.__lc.chDbg.push({
            id,
            width: Math.round(width),
            fallback,
            h,
            phase: e.dataset.lcPhase || '',
            cls: e.className,
          });
          if (w.__lc.chDbg.length > 12) w.__lc.chDbg.shift();
        }
      } catch (_) {}
    } catch (_) {
      h = 0;
    } finally {
      /* G09：还原必须走 finally。旧写法把 9 个 inline 属性的还原排在 try/catch 之后，
         任何一处抛错（或测量窗口被打断）都会把「left:-99999px / height:auto / 透明」
         留在卡上；下一次读 rect 得到的就是测量态，dock 面板 resize 往返后 y 偏 +67px 即此因。 */
      if (!hadDock) e.classList.remove('dock-panel');
      if (savePhase === undefined) delete e.dataset.lcPhase;
      else e.dataset.lcPhase = savePhase;
      st.width = save.width;
      st.height = save.height;
      st.position = save.position;
      st.visibility = save.visibility;
      st.left = save.left;
      st.top = save.top;
      st.right = save.right;
      st.bottom = save.bottom;
      st.overflowY = save.overflowY;
    }
    /* 测量失败（抛错/量到 0）→ 交回 fallback，并让布局按新值重算，禁止沿用上一次 */
    return h || fallback || GEO.PANEL_MIN_H;
  }

  /* ── 测量帧 ───────────────────────────────────────────────────────────── */
  const slotCache = new Map(); // id → 自然槽位 {x,y,w,h}（只在 push=0 的帧里刷新）
  let slotViewKey = ''; // 视口变了 → 槽位缓存失效（否则 resize 后仍用旧槽位）

  /* 槽位「稳定确认」闸门。为什么要它：dock 轨（location-bar / control-panel / 语音卡）
     同处 #command-dock，一张卡脱层展开后 App 的 flex 会把剩下两张重新居中；
     收起的那一帧 App 还没把兄弟排回原位，此刻读到的 rect（实测 x=631）是**中间态**，
     一旦写进槽位缓存就永久偏 —— 表现是「开一次卡，dock 卡从此站到 dock 中央」。
     规则：与缓存差异大的候选值必须连续两帧一致才采纳，否则继续用缓存。
     （真实布局变化只延迟一帧 ≈16ms，肉眼不可见；中间态却再也写不脏槽位。） */
  const slotSettle = new Map(); // id → { sig, n }

  function slotSig(m) {
    return (
      Math.round(m.x) + ',' + Math.round(m.y) + ',' + Math.round(m.w) + ',' + Math.round(m.h)
    );
  }

  function nearSlot(a, b) {
    return (
      a &&
      b &&
      Math.abs(a.x - b.x) < 1 &&
      Math.abs(a.y - b.y) < 1 &&
      Math.abs(a.w - b.w) < 1 &&
      Math.abs(a.h - b.h) < 1
    );
  }

  /** 采纳/否决一个候选槽位。返回本帧该卡应使用的槽位。
      need：连续几次同签名才采纳（左右轨 2，dock 轨 3 —— dock 会被 App flex 重排，
      中间态更黏，实测 x 549→631 这种居中态能连续出现两帧）。 */
  function confirmSlot(id, cand, need) {
    const cached = slotCache.get(id);
    if (!cached) {
      slotCache.set(id, cand);
      slotSettle.set(id, { sig: slotSig(cand), n: 0 });
      return cand;
    }
    if (nearSlot(cached, cand)) {
      slotCache.set(id, cand);
      slotSettle.set(id, { sig: slotSig(cand), n: 0 });
      return cand;
    }
    const st = slotSettle.get(id) || { sig: '', n: 0 };
    const sig = slotSig(cand);
    if (st.sig === sig) {
      st.n += 1;
      if (st.n >= (need || 2)) {
        slotCache.set(id, cand);
        slotSettle.set(id, { sig, n: 0 });
        return cand;
      }
    } else {
      st.sig = sig;
      st.n = 1;
    }
    slotSettle.set(id, st);
    return cached;
  }

  /* G05：槽位的失效条件不能只看 viewport。"轨道几何变了但视口没变" 是常态
     （liftRails 平移、App 重排/换 active、移动端地址栏收起），此时 live 卡仍按旧槽位
     布局 —— 实测错位 −211px / +67px 都出自这里。所有轨道几何变化点都显式调用本函数。

     注意：这里**只标记失效、不清缓存**。早先直接 slotCache.clear() 会让「开着的卡」
     在回 mini 时找不到目标槽位，只能落回 App 给的原始位置（实测 data-panel 在
     resize 后停在 [100,306,280,48] —— 就是「缩放后位置乱跳」）。
     标记失效后由 measure 在「该轨空闲」的那一帧重锁，忙时继续用旧槽位（旧槽位永远安全）。 */
  const slotStale = new Set(['left', 'right', 'dock']);

  /* dock 轨的槽位必须等 App 把 #command-dock 摆好之后才能锁。
     启动早期 App 会把两张 dock 卡临时靠拢（实测 control-panel 637，正常 888），
     这一帧要是被锁进缓存，后面所有「开→合」都以此为家 —— 也就是「位置乱跳」的另一条来源。
     index.js 在左右轨顶部稳定 1s 后调用 armDockSlots()，此前 dock 卡不参与槽位锁定。 */
  let dockArmed = false;

  function armDockSlots() {
    if (dockArmed) return false;
    dockArmed = true;
    slotStale.add('dock');
    if (typeof globalThis !== 'undefined') globalThis.__lcDockArmed = true;
    return true;
  }

  function invalidateSlots() {
    slotStale.add('left');
    slotStale.add('right');
    slotStale.add('dock');
    slotViewKey = '';
    return true;
  }

  /* 轨道顺序（配置序，唯一一份；槽位归一化只依赖它 + 实测卡高） */
  const RAIL_ORDER = Object.freeze({
    left: ['data-panel', 'scene-panel'],
    right: ['pp-toggles', 'cctv-panel', 'global-context-panel'],
  });

  /** 槽位归一化（§5.4「固定 mini 槽位」）：y = 轨道顶 + Σ(卡高 + GAP)。
      为什么不能读当前 rect 的 y：任何一张卡脱层/动画期间，兄弟在 DOM 里会整体上移一个卡高，
      把这个 y 写进槽位 = 槽位被毒化（实测 scene 被写 94 = data 的槽位 → scene 展开压住 data、
      data 展开时 scene 不让位、切卡时展开盒跳位）。归一化后槽位与「谁在动画」完全解耦。 */
  function normalizeRailSlots(cards) {
    for (const rail in RAIL_ORDER) {
      const list = RAIL_ORDER[rail].filter(
        (id) => cards[id] && cards[id].connected && cards[id].mini,
      );
      if (!list.length) continue;
      const top = Math.min(...list.map((id) => cards[id].mini.y));
      let y = top;
      for (const id of list) {
        const m = cards[id].mini;
        if (Math.abs(m.y - y) > 0.5) {
          const fixed = { ...m, y };
          cards[id].mini = fixed;
          slotCache.set(id, fixed);
        }
        y += m.h + GEO.GAP;
      }
    }
  }

  function measure({ pushes = {}, phases = {}, dockId = null } = {}) {
    const view = {
      w: Math.round(doc.documentElement.clientWidth || innerWidth),
      h: Math.round(doc.documentElement.clientHeight || innerHeight),
      dpr: devicePixelRatio || 1,
    };
    const viewKey = view.w + 'x' + view.h;
    if (viewKey !== slotViewKey) {
      /* 曾经这里直接 slotCache.clear()。清空后脱层卡既无缓存也无可靠占位，只能回退读
         自身 rect —— 而脱层卡的 rect 是「内容自然尺寸 + 残留 transform」，不是槽位。
         实测（probe-v14→diag-box）：1600→1180→1600 往返后第一次开 data-panel，
         槽位宽度被永久写成 280（内容自然宽，正确 176），此后右轨 x 计算、让位宽度、
         收起目标全部跟着偏，直到 reload —— 这就是「缩放后位置乱跳」的根因。
         槽位宽高不随视口变化，只有 x/y 会变；x/y 由非脱层的静止帧自然刷新即可。 */
      slotViewKey = viewKey;
    }
    /* 轨道级「忙」判定（槽位缓存的门禁）：
       同轨只要有一张卡在脱层 / 动画 / 让位 / 非 mini 相位，该轨其余卡虽然自己「静止」，
       它在 DOM 里的 y 也已经不是真实槽位 —— 脱层卡离开文档流后，兄弟会整体上移一整个卡高。
       本帧若拿这个 y 去刷新槽位缓存，槽位会被**永久毒化**（实测：data→scene 切换的瞬时帧里
       scene 的槽位被写成 94（= data 的槽位），之后 scene 展开就落在 94 压住 data 的 mini）。 */
    const busyRails = new Set();
    for (const id of ids) {
      const e0 = el(id);
      const ph0 = phases[id] || 'mini';
      const push0 = pushes[id] || { x: 0, y: 0 };
      const anim0 =
        e0 && e0.getAnimations ? e0.getAnimations().length > 0 : false;
      if (
        isStaged(id) ||
        ph0 !== 'mini' ||
        anim0 ||
        Math.abs(push0.x) > 0.5 ||
        Math.abs(push0.y) > 0.5
      ) {
        busyRails.add((CARDS[id] && CARDS[id].rail) || 'chrome');
      }
    }
    const cards = {};
    for (const id of ids) {
      const e = el(id);
      if (!e || !e.isConnected) {
        cards[id] = { connected: false };
        continue;
      }
      const vis = rectOf(e);
      const phRect = placeholderRect(id);
      const push = pushes[id] || { x: 0, y: 0 };
      const pushing = Math.abs(push.x) > 0.5 || Math.abs(push.y) > 0.5;
      const ph = phases[id] || 'mini';
      const animating = e.getAnimations ? e.getAnimations().length > 0 : false;
      const railBusy = busyRails.has((CARDS[id] && CARDS[id].rail) || 'chrome');
      /* mini 槽位（自然位置）三层判定：
         ① 有占位 → 读占位（最准）
         ② 「不静止」（在让位 / 不是 mini 相位 / 还有动画在跑）→ 只用缓存：
            rect 里混着 translate 与 WAAPI 让位动画，「rect − push」在动画中途是错的
            （曾把 cctv 的槽位算成 94，导致整栈漏推 + 展开卡压住上方卡）
         ③ 真正静止 → 读 rect 并刷新缓存 */
      let mini = null;
      if (isStaged(id) && slotCache.has(id)) {
        /* 脱层期间**槽位冻结**：App 的轨道是它自己的 JS 摆的，兄弟卡回栈/换 active 都会让
           轨道重排；此时若读占位/rect，槽位会漂（实测 data→scene 切换时 scene 槽位被读成
           data 的 94 → 展开盒跳位 56px + FLIP 重启 + 瞬时压住 data 的 mini）。 */
        mini = slotCache.get(id);
      } else if (phRect)
        mini = { x: phRect.x, y: phRect.y, w: phRect.w, h: phRect.h };
      else if (
        slotCache.has(id) &&
        (railBusy || pushing || ph !== 'mini' || animating)
      )
        mini = slotCache.get(id);
      else if (vis && !isStaged(id)) {
        /* 脱层中的卡不能用自身 rect 当槽位：rect = 内容自然尺寸 + 动画/让位 transform。
           实测把 data-panel 的槽位宽永久写成 280（内容自然宽，正确 176）→ 后续右轨 x、
           让位宽度、收起目标全偏。脱层卡只认占位与缓存。
           静止卡也要过「稳定确认」闸门：收起瞬间兄弟的重排中间态不是槽位。
           dock 轨另有硬规矩：卡片开合会把兄弟在 #command-dock 里重新居中（实测 x 549→631），
           这种 flex 中间态一律不吃 —— dock 槽位只在「显式失效（resize / App 改几何）
           且 dock 全空闲」时才重锁。 */
        const railKey = (CARDS[id] && CARDS[id].rail) || 'chrome';
        const stale = slotStale.has(railKey);
        const isDock = railKey === 'dock';
        /* dock 未 arm：不给槽位、不写缓存（本帧该卡不参与布局，留在 App 原位） */
        const dockCold = isDock && !dockArmed && !slotCache.has(id);
        /* 只有「轨道忙」才沿用旧槽位。
           早先写成 dock 一律 hold 缓存，结果是 arm 那一帧锁到 App 的居中态
           （control-panel 637，正确 888），之后 App 改成右对齐也不再回锁 —— 脏槽位永久留存，
           表现为开→合回到 637 再被 App 弹回 888 的「位置乱跳」。 */
        const hold = slotCache.has(id) && (isDock ? railBusy : stale && railBusy);
        if (!dockCold)
          mini = hold
            ? slotCache.get(id)
            : confirmSlot(
                id,
                { x: vis.x, y: vis.y, w: vis.w, h: vis.h },
                isDock ? 3 : 2,
              );
        if (!railBusy) slotStale.delete(railKey);
      }
      /* 兜底：缓存缺失且本卡被钳在「轨道忙」里 → 用当前 rect（宁可一次小跳，不给 null）。
         脱层卡例外：本帧宁可没有 mini（该卡不参与本帧布局），也不把脏 rect 写成槽位。
         dock 轨同样例外：忙时无缓存说明它正在被 App 重排，本帧不参与布局更安全。 */
      if (
        !mini &&
        vis &&
        !isStaged(id) &&
        !(
          CARDS[id] &&
          CARDS[id].rail === 'dock' &&
          (railBusy || (!dockArmed && !slotCache.has(id)))
        )
      )
        mini = { x: vis.x, y: vis.y, w: vis.w, h: vis.h };
      /* G07：该卡可用的最大高度 = 宿主栈底 − 该卡 mini 顶 − 间隙。
         展开盒此前只受视口 SAFE_BOTTOM 约束，左卡内容高时会长出 #left-panel-stack
         的可视底界，压到栈下方的内容与坞上沿。宿主 rect 已含 liftRails 的 translate。 */
      const hostEl = e.parentElement;
      const hostR = hostEl ? hostEl.getBoundingClientRect() : null;
      const limitH =
        hostR && mini
          ? Math.max(
              GEO.PANEL_MIN_H,
              Math.round(hostR.bottom - mini.y - GEO.GAP),
            )
          : 0;
      cards[id] = {
        connected: true,
        mini,
        visual: vis,
        header: rectOf(headerOf(id)),
        contentH: 0,
        limitH,
      };
    }
    /* 槽位归一化：把「谁在动画」的影响从槽位里彻底去掉（见 normalizeRailSlots 注释） */
    normalizeRailSlots(cards);
    const dockEl = doc.getElementById('command-dock');
    const dRect = rectOf(dockEl);
    const dock = dRect
      ? { ...dRect, cx: dRect.x + dRect.w / 2, top: dRect.y }
      : null;

    /* dock 面板的内容高：只在有 dock 卡在开/开中时量（测量帧内一次） */
    if (dockId && dock) {
      const panelW = Math.max(
        GEO.PANEL_MIN_W,
        Math.min(
          Math.min(dock.w, GEO.PANEL_MAX_W),
          view.w - 2 * GEO.PANEL_EDGE,
        ),
      );
      const maxH = Math.max(
        GEO.PANEL_MIN_H,
        Math.round(dock.top - GEO.SAFE_TOP - GEO.DOCK_LIFT),
      );
      const h = contentHeight(
        dockId,
        panelW,
        Math.min(CARDS[dockId] ? CARDS[dockId].expH : GEO.PANEL_MIN_H, maxH),
      );
      if (cards[dockId]) cards[dockId].contentH = h;
    }

    const protectedRects = [];
    for (const pid of PROTECT_IDS) {
      const r = rectOf(doc.getElementById(pid));
      if (r && r.w > 1 && r.h > 1)
        protectedRects.push({ id: pid, x: r.x, y: r.y, w: r.w, h: r.h });
    }
    const credits = rectOf(doc.querySelector('.cesium-widget-credits'));
    if (credits)
      protectedRects.push({
        id: 'cesium-credits',
        x: credits.x,
        y: credits.y,
        w: credits.w,
        h: credits.h,
      });
    /* 左右轨道卡不得压住底部 dock（横向相交才算） */
    if (dock)
      protectedRects.push({
        id: 'command-dock',
        x: dock.x,
        y: dock.y,
        w: dock.w,
        h: dock.h,
      });

    const safe = {
      top: GEO.SAFE_TOP,
      bottom: GEO.SAFE_BOTTOM,
      left: 0,
      right: 0,
    };
    /* Q1：侧轨容器边缘（实时 DOM 几何）。
       为什么要它：右轨展开盒的 x 依赖 `c.mini`，而槽位在「同轨有卡在展开」时按设计
       **冻结不刷新**（hold = stale && railBusy，展开卡自身就让该轨 busy）。视口一变，
       旧槽位不会自愈 —— 展开盒带着旧绝对坐标，只是被 EDGE 兜底 clamp 顶到右缘 12px，
       与 mini 卡的右对齐基准（rail 右界，实测距屏 100px）错位 74px。
       槽位不能为此解冻（解冻会重新引入「缩放后位置乱跳」），所以另给一条**永不 stale**
       的锚：rail 容器的实时 rect。layout 用 railRight 回推 x，与 mini 右缘天然一致。 */
    const rails = {};
    for (const [key, sel] of [
      ['left', '#left-panel-stack'],
      ['right', '#right-context-rail'],
    ]) {
      const r = rectOf(doc.querySelector(sel));
      if (r && r.w > 1 && r.h > 1)
        rails[key] = { x: r.x, y: r.y, w: r.w, h: r.h, right: r.x + r.w };
    }
    return {
      viewport: view,
      safe,
      rails,
      cards,
      dock,
      protected: protectedRects,
      phases,
    };
  }

  /* ── 页面 chrome 几何：两条侧轨上移到标题栏之下（旧 App 层用 transform 做的事）──
     App 的自然位置是 26vh（≈190），Hermes 一直把轨道提到 94。
     这里必须用独立的 `translate`（瞬时生效），不能改成写 --*-stack-safe-top：
     轨道有 `transition: top`，改写变量会让轨道在 200–300ms 里从 190 滑到 94，
     而 src/lc 的槽位测量恰好发生在这段过渡里 —— 实测槽位被写成 190，
     之后 data 展开盒落在 y=190（= 高出槽位 96px），P2 验收 T2/T4 直接失败。
     translate 不参与布局、无过渡，测到的 rect 就是最终位置，且按当前 rect 求差 → 幂等。 */
  function liftRails(targetTop = 94) {
    const out = {};
    for (const sel of ['#left-panel-stack', '#right-context-rail']) {
      const rail = doc.querySelector(sel);
      if (!rail) continue;
      const r = rail.getBoundingClientRect();
      if (!r.height) continue;
      const cur =
        parseFloat(
          (getComputedStyle(rail).translate || 'none').split(' ')[1] || '0',
        ) || 0;
      /* natural = 去掉我们自己 translate 后的位置 → 幂等：App 把轨道摆到哪都不会累积漂移 */
      const natural = r.top - cur;
      const want = Math.round(Math.min(0, targetTop - natural));
      if (Math.abs(want - cur) > 0.5) {
        rail.style.setProperty('translate', `0 ${want}px`);
        /* 轨道位置变了 → 槽位缓存整体作废（G05 统一入口）。
           慢渲染（软件渲染/SwiftShader）下第一帧测量可能发生在 translate 之前，
           缓存里留下 pre-lift 的 y（实测 pp=190）→ normalizeRailSlots 按 190 归一，
           cctv 槽位变 248，展开卡与 mini 全错位（T19 实测）。 */
        invalidateSlots();
      }
      out[sel] = want;
    }
    return out;
  }

  /* ── App 面板 API（CollapsePort 唯一调用点）──────────────────────────────── */
  function panelApi() {
    const api = bridge.get('app.panelApi') || null;
    return api && typeof api.setPanelCollapsed === 'function' ? api : null;
  }

  function setPanelCollapsed(id, collapsed, opts) {
    const api = panelApi();
    if (api) {
      api.setPanelCollapsed(id, collapsed, opts || {});
      return 'app';
    }
    /* 兜底：App 未注入 API（旧构建/单测）→ 直写 class，并通过 diagnostics 记账，
       让测试能发现「走到了第二写入者」。
       Phase7A3：卡片层现在先于 Cesium/App 起来，preboot 期的写入是**预期**的
       （不是 App API 缺失的缺陷）→ 记进 prebootWrites，App 起来后由
       CollapsePort.reconcile() 把状态回灌给 App，S2/S3（direct/appApiMissing 为 0）
       仍然成立。 */
    const preboot = !!(opts && opts.preboot);
    const e = el(id);
    if (e) e.classList.toggle('collapsed', !!collapsed);
    if (typeof window !== 'undefined') {
      const LC = bridge.ensure('lc', {
        global: '__lc',
        owner: 'src/lc/index.js',
      });
      LC.diagnostics = LC.diagnostics || {};
      const key = preboot ? 'prebootWrites' : 'appApiMissing';
      LC.diagnostics[key] = (LC.diagnostics[key] || 0) + 1;
    }
    return preboot ? 'preboot' : 'direct';
  }

  const isCollapsed = (id) => {
    const e = el(id);
    return !!e && e.classList.contains('collapsed');
  };

  return {
    el,
    headerOf,
    stage,
    stageCard,
    unstageCard,
    isStaged,
    detachedByApp,
    placeholderRect,
    ensurePlaceholder,
    contentHeight,
    measure,
    liftRails,
    invalidateSlots,
    armDockSlots,
    slotsSnapshot() {
      const out = {};
      for (const [id, v] of slotCache)
        out[id] = { x: v.x, y: v.y, w: v.w, h: v.h };
      return { slots: out, stale: [...slotStale], dockArmed };
    },
    setPanelCollapsed,
    isCollapsed,
    hasPanelApi: () => !!panelApi(),
  };
}

export default { createAdapter };
