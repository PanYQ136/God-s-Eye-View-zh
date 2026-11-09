/**
 * Keeps the phone breakpoint single-sourced.
 *
 * src/ui/viewport.js owns the value (760px, desktop at 761px). CSS cannot read
 * a JS constant, so this guard fails when a stylesheet invents a neighbouring
 * phone breakpoint or when runtime code hard-codes the media query instead of
 * importing the helper. Bands outside the phone range (620, 900, 1180 …) are
 * legitimate feature breakpoints and stay untouched.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

/** The phone layout owns up to 760px; desktop starts at 761px. */
const PHONE_MAX = 760;
const DESKTOP_MIN = 761;

/** Widths close enough to the phone gate to become a dead band if they differ. */
const PHONE_BAND = { min: 700, max: 800 };

const CSS_MEDIA = /@media[^{]*?\((min|max)-width:\s*(\d+(?:\.\d+)?)px\)/g;
const RUNTIME_QUERY = /['"`]\((min|max)-width:\s*(\d+(?:\.\d+)?)px\)['"`]/g;
const RUNTIME_ALLOWED = new Set([
  'src/ui/viewport.js',
  'scripts/check-breakpoints.mjs',
]);

function walk(dir, extensions) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(full, extensions));
    } else if (extensions.some((suffix) => entry.name.endsWith(suffix))) {
      out.push(full);
    }
  }
  return out;
}

const problems = [];

for (const file of walk(SRC, ['.css'])) {
  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  const source = readFileSync(file, 'utf8');
  for (const [, axis, raw] of source.matchAll(CSS_MEDIA)) {
    const width = Number(raw);
    const inPhoneBand = width >= PHONE_BAND.min && width <= PHONE_BAND.max;
    const matchesGate =
      (axis === 'max' && width === PHONE_MAX) ||
      (axis === 'min' && width === DESKTOP_MIN);
    if (inPhoneBand && !matchesGate) {
      problems.push(
        `${relative}: ${axis}-width ${raw}px sits inside the phone band but is not the ${PHONE_MAX}/${DESKTOP_MIN} gate from src/ui/viewport.js`,
      );
    }
  }
}

for (const file of walk(SRC, ['.js', '.mjs', '.vue'])) {
  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  if (RUNTIME_ALLOWED.has(relative)) continue;
  const source = readFileSync(file, 'utf8');
  for (const [match, axis, raw] of source.matchAll(RUNTIME_QUERY)) {
    const width = Number(raw);
    const inPhoneBand = width >= PHONE_BAND.min && width <= PHONE_BAND.max;
    if (inPhoneBand) {
      problems.push(
        `${relative}: hard-codes "${axis}-width: ${raw}px"; import isMobileViewport from src/ui/viewport.js instead (${match})`,
      );
    }
  }
}

if (problems.length) {
  console.error('[check-breakpoints] phone breakpoint drifted from src/ui/viewport.js:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `[check-breakpoints] phone gate is ${PHONE_MAX}/${DESKTOP_MIN} everywhere`,
);
