import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const distRoot = join(projectRoot, 'dist');
const errors = [];

function listFiles(directory, extension) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath, extension);
    return extname(entry.name) === extension ? [fullPath] : [];
  });
}

function outputPathFor(urlPath) {
  const clean = decodeURI(urlPath).replace(/^\//, '');
  if (!clean) return join(distRoot, 'index.html');
  if (extname(clean)) return join(distRoot, clean);
  return join(distRoot, clean, 'index.html');
}

const htmlFiles = listFiles(distRoot, '.html');
if (htmlFiles.length === 0) {
  errors.push('No HTML pages were generated.');
}

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);

  for (const reference of references) {
    if (
      reference.startsWith('https://') ||
      reference.startsWith('http://') ||
      reference.startsWith('mailto:') ||
      reference.startsWith('data:')
    ) {
      continue;
    }

    const [pathPart, fragment] = reference.split('#');
    const targetPath = pathPart
      ? pathPart.startsWith('/')
        ? pathPart
        : '/' + relative(distRoot, join(file, '..', pathPart)).replaceAll('\\', '/')
      : '/' + relative(distRoot, file).replaceAll('\\', '/').replace(/\/index\.html$/, '');

    const targetFile = outputPathFor(targetPath.split('?')[0]);
    if (!existsSync(targetFile)) {
      errors.push(
        `${relative(distRoot, file)} references missing output "${reference}".`
      );
      continue;
    }

    if (fragment && extname(targetFile) === '.html') {
      const targetHtml = readFileSync(targetFile, 'utf8');
      const escaped = fragment.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      if (!new RegExp(`id=["']${escaped}["']`).test(targetHtml)) {
        errors.push(
          `${relative(distRoot, file)} references missing anchor "#${fragment}" in ${relative(distRoot, targetFile)}.`
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Generated-site validation failed:\n');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Generated-site validation passed: ${htmlFiles.length} HTML page(s).`);
