import { resolve } from 'node:path';

export const STUDIO_HELP = `Will Studio — local visual website workspace

Usage: node studio/server.mjs --project <trusted-website-folder> [options]
       node scripts/studio-launch.mjs --project <trusted-website-folder>

Options:
  --project <folder>     Open a compatible will-astro-v1 website
  --port <number>        Studio port (default 4310)
  --astro-port <number>  Website preview port (default 4311)
  --open / --no-open    Open / do not open a browser
  --no-astro             API-only mode for diagnostics
  --help                 Show this help without installing or opening anything

The website must already have its own dependencies installed. Only open projects
you trust: their schema, Astro configuration, and build scripts are executable code.
Studio remains local; saving a file does not publish it.
`;

export function parseStudioArguments(args, { defaultProject, defaultOpen = false, cwd = process.cwd() } = {}) {
  const result = { root: defaultProject, port: 4310, astroPort: 4311, open: defaultOpen, noAstro: false, help: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Specify ${flag} only once.`);
    seen.add(flag);
    if (flag === '--help') result.help = true;
    else if (flag === '--open' || flag === '--no-open') result.open = flag === '--open';
    else if (flag === '--no-astro') result.noAstro = true;
    else if (['--project', '--port', '--astro-port'].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
      if (flag === '--project') result.root = resolve(cwd, value);
      else {
        const port = Number(value);
        if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${flag} must be a port between 1 and 65535.`);
        result[flag === '--port' ? 'port' : 'astroPort'] = port;
      }
    } else throw new Error(`Unknown option ${flag}. Use --help for available options.`);
  }
  if (seen.has('--open') && seen.has('--no-open')) throw new Error('Choose either --open or --no-open.');
  if (result.port === result.astroPort && !result.noAstro) throw new Error('Studio and Astro need different ports.');
  return result;
}
