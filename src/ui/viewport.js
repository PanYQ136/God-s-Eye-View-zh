/**
 * Single source of truth for the phone/desktop breakpoint.
 *
 * Every media query that answers "is this a phone layout?" reads these values,
 * and the stylesheets have to agree: mobile-portrait.css, cockpit.css and
 * cyber.css already switch at 760px. When the JS gate said 720px instead, the
 * band 721-760px was laid out by the phone CSS (rails pushed off-screen) while
 * no shell took over, so nothing was reachable.
 *
 * CSS cannot read a JS constant, so scripts/check-breakpoints.mjs keeps the
 * stylesheets honest: viewport widths in media queries must be 760 or 761.
 */

/** Widest viewport the phone layout owns. */
export const MOBILE_MAX_WIDTH = 760;

/** Media query the phone layout switches on. */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

/** Media query the desktop layout switches on; the exact complement. */
export const DESKTOP_MEDIA_QUERY = `(min-width: ${MOBILE_MAX_WIDTH + 1}px)`;

/**
 * Whether a viewport is narrow enough for the phone layout.
 * @param {Window} [viewport] Window-like object with matchMedia.
 * @returns {boolean} True when the phone layout owns the viewport.
 */
export function isMobileViewport(viewport = globalThis) {
  return Boolean(viewport?.matchMedia?.(MOBILE_MEDIA_QUERY)?.matches);
}
