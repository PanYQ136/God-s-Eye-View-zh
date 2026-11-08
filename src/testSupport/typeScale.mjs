/**
 * Resolve the type-scale tokens declared in foundation.css.
 *
 * History: every small font-size used to be a raw px literal, and the layout
 * tests asserted on that spelling ("font-size: 12px"). Audit UI-03 moved the
 * six smallest sizes onto a five-step scale (--fs-3xs…--fs-lg) and lifted the
 * 6/7/8px strays onto the 9px floor, so the spelling changed while the
 * contract those tests guard — "this label renders at N pixels" — did not.
 * Resolving through the scale keeps the assertions honest: a test that wants
 * "at least 10px" still fails if the token is redefined to 8px.
 *
 * Deliberately does not model calc()/rem/min() chains: those carry their own
 * meaning (browser-root scaling, clamping) and tests that need them match the
 * expression instead.
 */
import { readFileSync } from 'node:fs';

const SCALE = readScale();

function readScale() {
  const css = readFileSync(
    new URL('../ui/styles/foundation.css', import.meta.url),
    'utf8',
  );
  const start = css.indexOf(':root');
  const root = css.slice(start, css.indexOf('}', start));
  const scale = new Map();
  for (const match of root.matchAll(/(--fs-[a-z0-9-]+):\s*([\d.]+)px/g)) {
    scale.set(match[1], Number(match[2]));
  }
  return scale;
}

/** The px a `font-size` declaration resolves to, or null when it is not a
 *  plain px / scale-token value. */
export function fontSizePx(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  const direct = /^(-?[\d.]+)px$/.exec(raw);
  if (direct) return Number(direct[1]);
  const token = /^var\((--fs-[a-z0-9-]+)(?:,\s*(-?[\d.]+)px)?\)$/.exec(raw);
  if (token) {
    const declared = SCALE.get(token[1]);
    if (declared !== undefined) return declared;
    return token[2] === undefined ? null : Number(token[2]);
  }
  return null;
}

/** Every declared step, for tests that assert the scale itself. */
export function typeScale() {
  return new Map(SCALE);
}
