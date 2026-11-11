#!/usr/bin/env node
/**
 * Re-run a script when the *process* dies, not when it reports a failure.
 *
 * `check-package-boundaries.mjs` builds 130+ packages through esbuild, and on a
 * memory-tight Windows box either the Node process segfaults (status 139) or
 * esbuild's Go runtime aborts with `The service was stopped`. Both kill the
 * whole check, and both are reproducible only under memory pressure: the same
 * command passes on the next run, with nothing changed.
 *
 * Retrying those is honest — a check that never ran has not failed. A non-zero
 * exit that the child produced itself (a real invariant violation, a bad
 * import) is passed straight through, so a red check stays red.
 *
 *   node scripts/retry-on-crash.mjs scripts/check-package-boundaries.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const MAX_ATTEMPTS = 3;

const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error('usage: node scripts/retry-on-crash.mjs <script> [...args]');
  process.exit(2);
}

/** Statuses that mean the runtime died, not that the script said "no". */
function crashed(status) {
  return status === null || status === 134 || status === 139;
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const result = spawnSync(process.execPath, [path.resolve(script), ...rest], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (!crashed(status)) process.exit(status);
  if (attempt < MAX_ATTEMPTS) {
    console.warn(
      `[retry-on-crash] ${path.basename(script)} died with status ${status} `
        + `(attempt ${attempt}/${MAX_ATTEMPTS}); the environment killed it — re-running.`,
    );
  } else {
    console.error(
      `[retry-on-crash] ${path.basename(script)} died ${MAX_ATTEMPTS} times in a row. `
        + 'That is an environment failure (usually memory), not a verdict: close some '
        + 'apps and re-run, rather than treating this as a failing check.',
    );
    process.exit(status);
  }
}
