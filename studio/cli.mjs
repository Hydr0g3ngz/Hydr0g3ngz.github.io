import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const STUDIO_HELP = `Will Studio — local visual website workspace

Usage: node studio/server.mjs [--project <trusted-website-folder>] [options]
       node scripts/studio-launch.mjs [--choose-project]

Options:
  --project <folder>     Open a compatible will-astro-v1 website
  --choose-project       Open the project chooser, even in a bundled website
  --port <number>        Studio port (default 4310; chooser minimum 1024)
  --astro-port <number>  Website preview port (default 4311)
  --open / --no-open    Open / do not open a browser
  --no-astro             API-only mode for diagnostics
  --help                 Show this help without installing or opening anything

The website must already have its own dependencies installed. Only open projects
you trust: their schema, Astro configuration, and build scripts are executable code.
Without a selected project, the standalone editor opens a browser project chooser.
Checking a folder there does not run its code; opening it requires confirmation.
Studio remains local; saving a file does not publish it.
`;

export function parseStudioArguments(args, { defaultProject, defaultOpen = false, cwd = process.cwd() } = {}) {
  const result = { root: defaultProject, port: 4310, astroPort: 4311, open: defaultOpen, noAstro: false, help: false, chooseProject: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Specify ${flag} only once.`);
    seen.add(flag);
    if (flag === '--help') result.help = true;
    else if (flag === '--open' || flag === '--no-open') result.open = flag === '--open';
    else if (flag === '--no-astro') result.noAstro = true;
    else if (flag === '--choose-project') result.chooseProject = true;
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
  if (result.chooseProject && seen.has('--project')) throw new Error('Choose either --project or --choose-project.');
  if (result.chooseProject) result.root = undefined;
  if (!result.help && !result.root && (seen.has('--astro-port') || result.noAstro)) throw new Error('--astro-port and --no-astro require a selected project. The chooser manages workspace ports.');
  if (result.root && result.port === result.astroPort && !result.noAstro) throw new Error('Studio and Astro need different ports.');
  return result;
}

export async function defaultStudioProject(runtimeRoot) {
  try { await access(join(runtimeRoot, '.pages.yml')); return runtimeRoot; }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

export function studioServerArguments(options, entrypoint) {
  const args = [entrypoint, '--port', String(options.port)];
  if (options.root) args.push('--project', options.root, '--astro-port', String(options.astroPort));
  else args.push('--choose-project');
  if (options.open) args.push('--open');
  if (options.noAstro) args.push('--no-astro');
  return args;
}
