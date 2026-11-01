import { LayerPanel } from '../ui/layers.js';
import { governorRequestRender } from '../renderGovernor.js';
import { markDetectionSourcesChanged } from '../data/detection.js';

const defaultFrame = (fn) =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(fn)
    : setTimeout(fn, 0);

/** Own the layer panel and application reactions to lifecycle activity. */
export class LayerPresentation {
  constructor(
    manager,
    {
      weatherClock,
      requestRender = governorRequestRender,
      invalidateDetection = markDetectionSourcesChanged,
      requestFrame = defaultFrame,
    } = {},
  ) {
    this.manager = manager;
    this.weatherClock = weatherClock;
    this._panel = null;
    this._requestRender = requestRender;
    this._invalidateDetection = invalidateDetection;
    this._requestFrame = requestFrame;
    this._pendingRebuild = null;
    this.pendingVisible = false;
    this._unsubscribe = manager.subscribeActivity((change) => {
      if (change.type === 'status') this.refresh();
      else if (change.type === 'layer-registered') {
        // Phase8E2: a deferred layer just became real. Its toggle row does not
        // exist yet (`_refreshTogglePanel` only updates existing rows), so the
        // rebuild is coalesced to one frame — 24 registrations, one render.
        this.scheduleRebuild();
        requestRender(`layer-registered:${change.layerId}`);
        invalidateDetection(`layer-registered:${change.layerId}`);
      } else if (change.type === 'destroy-all') this.destroy();
      else {
        const reason =
          change.type === 'data-updated'
            ? `layer-tick:${change.layerId}`
            : change.type === 'visibility-settled'
              ? 'layer-visibility'
              : change.type === 'params-settled'
                ? `layer-params:${change.layerId}`
                : null;
        if (!reason) return;
        requestRender(reason);
        if (change.type !== 'params-settled') invalidateDetection(reason);
      }
    });
  }
  get panel() {
    if (!this._panel)
      this._panel = new LayerPanel({
        weatherClock: this.weatherClock,
        getLayers: () => this.manager.getAll(),
        isEnabled: (id) => this.manager.isEnabled(id),
        setEnabled: (id, enabled, options) =>
          this.manager.setEnabled(id, enabled, options),
        setLayerParams: (id, params, options) =>
          this.manager.setLayerParams(id, params, options),
        getRowControls: (id) => {
          const module = this.manager.layers.get(id)?.module;
          try {
            return module?.getRowControls?.() || null;
          } catch (error) {
            console.warn(`[Data] ${id} getRowControls error:`, error);
            return null;
          }
        },
        hasRowControls: (id) =>
          typeof this.manager.layers.get(id)?.module?.getRowControls ===
          'function',
        subscribeRowControls: (id, listener) => {
          const module = this.manager.layers.get(id)?.module;
          module?.setRowControlsListener?.(listener);
          return () => module?.setRowControlsListener?.(null);
        },
        onHiddenRefresh: () => {
          this.pendingVisible = true;
        },
      });
    return this._panel;
  }
  mount(container) {
    this.panel.mount(container);
  }
  /** Hand the Recent Imagery readout factory to the panel (see LayerPanel). */
  attachRecentImagery(factory) {
    // Detaching never builds a panel that teardown already released.
    if (factory) this.panel.attachRecentImagery(factory);
    else this._panel?.attachRecentImagery(null);
  }
  /** Rebuild the layer rows once on the next frame (deferred registrations). */
  scheduleRebuild() {
    if (this._pendingRebuild) return;
    this._pendingRebuild = this._requestFrame(() => {
      this._pendingRebuild = null;
      this.rebuild();
    });
  }
  /** Rebuild every row now, including layers registered after mount. */
  rebuild() {
    this._panel?.rebuild();
  }
  refresh() {
    this._panel?._refreshTogglePanel();
  }
  flushVisible() {
    if (!this.pendingVisible) return;
    this.pendingVisible = false;
    this.refresh();
  }
  destroy() {
    this._panel?.destroy();
    this._panel = null;
    this.pendingVisible = false;
    this._pendingRebuild = null;
    this._unsubscribe?.();
    this._unsubscribe = null;
  }
}
