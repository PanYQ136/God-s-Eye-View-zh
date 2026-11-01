/**
 * Resolve the actual ordered local CSS imports used by the application entry.
 *
 * Line endings are normalised to `\n` because `.gitattributes` pins every text
 * file to LF (`* text=auto eol=lf`): a stylesheet written by a tool with CRLF
 * would otherwise make every multi-line selector match in the tests fail while
 * the file that ships is byte-identical after checkout.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function readStylesheet(file, ancestors = new Set()) {
  const resolved = path.resolve(
    file instanceof URL ? fileURLToPath(file) : file,
  );
  if (ancestors.has(resolved)) throw new Error('Circular stylesheet import');
  const next = new Set(ancestors).add(resolved);
  return readFileSync(resolved, 'utf8')
    .replace(/\r\n?/g, '\n')
    .replace(/@import ['"]([^'"]+)['"];\s*/g, (_, imported) =>
      readStylesheet(path.resolve(path.dirname(resolved), imported), next),
    );
}
