/**
 * dashboard-web/lib/path-safety.mjs — Path-traversal sanitizer factory.
 *
 * Returns a resolver bound to a base directory. Rejects anything that would
 * escape the base, contains directory separators, uses unsafe charset, or
 * doesn't end in `.md`. Same logic as the inlined `resolveSafeReportPath`
 * in server.mjs — extracted so it can be unit-tested.
 */

import path from 'path';

export function makeSafeResolver(baseDir, opts = {}) {
  const { extension = '.md', allowChars = /^[A-Za-z0-9._-]+$/ } = opts;
  const baseResolved = path.resolve(baseDir);

  return function resolveSafe(input) {
    if (!input || typeof input !== 'string') return null;
    // Strip URL fragments / query strings (markdown links may include them).
    const clean = input.split(/[#?]/)[0];
    const basename = path.basename(clean);
    if (!basename || basename === '.' || basename === '..') return null;
    if (!allowChars.test(basename)) return null;
    if (extension && !basename.endsWith(extension)) return null;
    const resolved = path.resolve(baseResolved, basename);
    if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) return null;
    return resolved;
  };
}
