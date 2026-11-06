// fork LC 外露面板配置（原 index.html 内联脚本；上游 CSP 禁内联故外置）。
window.__lcExternalDisclosure = new Set([
  'data-panel',
  'scene-panel',
  'pp-toggles',
  'cctv-panel',
  'global-context-panel',
  'location-bar',
  'control-panel',
]);
