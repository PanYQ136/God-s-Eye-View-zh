import { CITY_POIS } from '../cityPois.js';

/**
 * City-name normalisation shared by the radio and location voice actions.
 *
 * Kept in its own module so neither half of the voice surface has to import the
 * other: `gevActions.js` and `gevActionRadio.js` both need it, and a circular
 * import between them would make the alias tables reachable in only one order.
 */
const CITY_ALIASES = new Map([
  ['new york', 'nyc'],
  ['new york city', 'nyc'],
  ['san francisco', 'sf'],
  ['washington', 'dc'],
  ['washington dc', 'dc'],
  ['washington d.c.', 'dc'],
]);

/**
 * Canonical city id for a spoken/typed name, or null when it names no city we
 * know. Accepts curated ids and the alias table above.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeLocationId(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (CITY_POIS[raw]) return raw;
  if (CITY_ALIASES.has(raw)) return CITY_ALIASES.get(raw);
  return null;
}
