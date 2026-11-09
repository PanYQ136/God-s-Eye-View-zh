/**
 * Single source of truth for the phone/desktop breakpoint.
 *
 * Every media query that answers "is this a phone layout?" reads these values,
 * and the stylesheets have to agree: mobile-portrait.css, cockpit.css and
 * cyber.css already switch at 760px. When the JS gate said 720px instead, the
 * band 721-760px was laid out by the phone CSS (rails pushed off-screen) while
 * no shell took over, so nothing was reachable.
 *
 * Width alone is not enough. A phone held sideways is 812-930px wide but only
 * ~390px tall, so a width-only gate handed it the desktop layout: the tab bar
 * disappeared and the panels were squeezed into a few dozen pixels. The phone
 * layout therefore also owns short coarse-pointer viewports, and the desktop
 * queries exclude exactly that case so the two never overlap.
 *
 * CSS cannot read a JS constant, so scripts/check-breakpoints.mjs keeps the
 * stylesheets honest: viewport widths in media queries must be 760 or 761, and
 * every phone query must carry the landscape branch.
 */

/** Widest viewport the phone layout owns. */
export const MOBILE_MAX_WIDTH = 760;

/** Tallest landscape viewport (px) that still counts as a phone. */
export const MOBILE_LANDSCAPE_MAX_HEIGHT = 480;

/** A phone held sideways: wide, short, and driven by a finger. */
export const MOBILE_LANDSCAPE_QUERY = `(max-height: ${MOBILE_LANDSCAPE_MAX_HEIGHT}px) and (pointer: coarse)`;

/** Media query the phone layout switches on: narrow, or a sideways phone. */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px), ${MOBILE_LANDSCAPE_QUERY}`;

/** Media query the desktop layout switches on; the exact complement. */
export const DESKTOP_MEDIA_QUERY = `(min-width: ${MOBILE_MAX_WIDTH + 1}px) and (not (${MOBILE_LANDSCAPE_QUERY}))`;

/**
 * Whether a viewport is narrow enough for the phone layout.
 * @param {Window} [viewport] Window-like object with matchMedia.
 * @returns {boolean} True when the phone layout owns the viewport.
 */
export function isMobileViewport(viewport = globalThis) {
  return Boolean(viewport?.matchMedia?.(MOBILE_MEDIA_QUERY)?.matches);
}
