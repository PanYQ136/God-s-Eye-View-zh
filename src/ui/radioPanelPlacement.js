/** Keep Radio in Context in every theme, reusing the same playback controls. */
export function syncRadioPanelPlacement(doc) {
  if (!doc?.getElementById) return;
  const panel = doc.getElementById('radio-panel');
  const context = doc.getElementById('global-context-panel');
  const parent =
    context?.querySelector('.cyber-panel-body') ||
    context?.querySelector('.global-context-panel-inner');
  if (!panel || !parent) return;
  if (panel.parentElement !== parent) parent.append(panel);
<<<<<<< ours
=======
  if (dock.parentElement !== header)
    header.insertBefore(
      dock,
      header.firstChild ?? header.children?.[0] ?? null,
    );
  if (mini.parentElement !== dock) dock.append(mini);
>>>>>>> theirs
}
