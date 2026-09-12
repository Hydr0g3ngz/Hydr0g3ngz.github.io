/** GitHub Pages-compatible redirect manifest; no external destinations or loops. */
export function redirectMap(manifest, { routes, publishedRoutes } = {}) {
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.redirects) || manifest.redirects.length > 2000) throw new Error('Redirects must use version 1 with at most 2000 entries.');
  const output = Object.create(null);
  const route = value => typeof value === 'string' && /^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\/?$/.test(value) && !/^\/(?:__studio|studio|api|preview|_astro|images|uploads|404|index)(?:\/|$)/.test(value);
  const normalize = value => value.replace(/\/$/, '');
  for (const entry of manifest.redirects) {
    if (!entry || !route(entry.from) || !route(entry.to)) throw new Error('Redirects require safe internal page addresses.');
    const from = normalize(entry.from), to = normalize(entry.to);
    if (from === to || Object.hasOwn(output, from)) throw new Error(`Duplicate or self-referencing redirect: ${from}`);
    if (routes?.has(from)) throw new Error(`Redirect source conflicts with a content page: ${from}`);
    output[from] = to;
  }
  for (const from of Object.keys(output)) {
    const seen = new Set([from]); let target = output[from];
    while (Object.hasOwn(output, target)) {
      if (seen.has(target)) throw new Error(`Redirect loop at ${from}`);
      seen.add(target); target = output[target];
    }
    if (publishedRoutes && !publishedRoutes.has(target)) throw new Error(`Redirect ${from} points to a missing or unpublished page: ${target}`);
    output[from] = target;
  }
  return output;
}
