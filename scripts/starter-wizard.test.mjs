import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { mountStarterWizard } from '../studio/web/starter-wizard.js';
import { mountLaunchpad } from '../studio/web/launchpad.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const project = { name: 'My website', path: 'D:\\my-website' };
const inspected = (extra = {}) => ({ ready: true, ticket: 'starter-ticket', project, files: ['package.json', 'src/pages/index.astro', 'public/.gitkeep'], directories: ['src', 'src/pages', 'public'], warnings: ['Dependencies must be installed separately.'], expiresAt: Date.now() + 300000, ...extra });
const created = (extra = {}) => ({ project, files: inspected().files, directories: inspected().directories, commands: { powershell: "Set-Location -LiteralPath 'D:\\my-website'\nnpm install\nnpm run build", posix: "cd -- '/Users/you/my-website'\nnpm install\nnpm run build" }, warnings: [], ...extra });

function setup(t, options = {}) {
  const dom = new JSDOM('<button id="outside">Outside</button><div id="root"><p id="host">Host content</p></div>', { url: 'http://127.0.0.1:4310/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const doc = dom.window.document, root = doc.querySelector('#root'), calls = [], checkedPaths = [];
  const api = mountStarterWizard({ root, request(endpoint, payload) { calls.push({ endpoint, payload }); return options.request ? options.request(endpoint, payload) : endpoint === 'starter/inspect' ? inspected() : created(); }, onCheckProject: options.onCheckProject || (path => { checkedPaths.push(path); return true; }) });
  const path = root.querySelector('.sw-path'), name = root.querySelector('.sw-name'), form = root.querySelector('.sw-form'), review = form.querySelector('button'), create = root.querySelector('.sw-review>button'), dialog = root.querySelector('dialog'), launch = root.querySelector('.sw-launch');
  const type = (field, value) => { field.value = value; field.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const submit = () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const fill = (pathValue = project.path, nameValue = project.name) => { type(path, pathValue); type(name, nameValue); };
  const status = () => root.querySelector('.sw-status').textContent;
  const reviewReady = async () => { api.open(); fill(); submit(); await pause(); };
  t.after(() => { api.destroy(); dom.window.close(); });
  return { dom, doc, root, api, path, name, form, review, create, dialog, launch, calls, checkedPaths, type, fill, submit, status, reviewReady };
}

test('review lists every path without writing; only the explicit create button sends a ticketed creation', async t => {
  const ui = setup(t); ui.launch.focus(); ui.launch.click();
  assert.equal(ui.dialog.open, true); assert.equal(ui.doc.activeElement, ui.path); assert.equal(ui.create.disabled, true);
  assert.match(ui.dialog.textContent, /No packages are installed/); assert.match(ui.dialog.textContent, /no project code is run/);
  ui.fill('  D:\\my-website  ', ' My website '); ui.submit(); await pause();
  assert.deepEqual(ui.calls, [{ endpoint: 'starter/inspect', payload: project }]);
  assert.equal(ui.create.disabled, false);
  assert.deepEqual([...ui.root.querySelectorAll('[aria-label="Files to create"]>li')].map(node => node.textContent), inspected().files);
  assert.deepEqual([...ui.root.querySelectorAll('[aria-label="Directories to create"]>li')].map(node => node.textContent), inspected().directories);
  assert.equal(ui.root.querySelector('.sw-counts').textContent, '3 files · 3 directories');
  ui.create.click(); ui.create.click(); await pause();
  assert.deepEqual(ui.calls.at(-1), { endpoint: 'starter/create', payload: { ticket: 'starter-ticket', createProject: true } });
  assert.equal(ui.calls.length, 2); assert.equal(ui.root.querySelector('.sw-success').hidden, false);
  assert.equal(ui.root.querySelector('.sw-success>.sw-project-path').textContent, project.path);
  assert.equal(ui.root.querySelector('.sw-form').hidden, true);
  assert.match(ui.status(), /Nothing has been run or published/);
  assert.match(ui.root.querySelector('.sw-success').textContent, /run npm install first/);
  assert.equal(ui.root.querySelector('[aria-label="PowerShell setup commands"]').value, created().commands.powershell);
  assert.equal(ui.root.querySelector('[aria-label="macOS / Linux shell setup commands"]').value, created().commands.posix);
  ui.root.querySelector('.sw-success-actions button').click(); await pause();
  assert.deepEqual(ui.checkedPaths, [project.path]); assert.equal(ui.dialog.open, false); assert.equal(ui.doc.activeElement, ui.launch);
  assert.equal(ui.dom.window.location.href, 'http://127.0.0.1:4310/');
});

test('invalid folder and display names stay local; failed and incomplete reviews never authorize creation', async t => {
  let result = inspected({ ready: false, ticket: undefined, warnings: ['The folder is not empty.'] });
  const ui = setup(t, { request: () => result }); ui.api.open();
  for (const path of ['', 'relative/site', 'https://example.com/', 'D:relative', 'D:\\bad\u0000folder']) { ui.fill(path); ui.submit(); assert.equal(ui.path.getAttribute('aria-invalid'), 'true'); }
  assert.equal(ui.calls.length, 0);
  for (const name of ['', '   ', 'a'.repeat(101), 'Bad\u0007name']) { ui.fill(project.path, name); ui.submit(); assert.equal(ui.name.getAttribute('aria-invalid'), 'true'); }
  assert.equal(ui.calls.length, 0);
  ui.fill(); ui.submit(); await pause(); assert.equal(ui.create.disabled, true); assert.match(ui.status(), /not ready/);
  result = inspected({ ticket: '' }); ui.submit(); await pause(); assert.equal(ui.create.disabled, true); assert.match(ui.status(), /incomplete response/);
  result = inspected(); ui.submit(); await pause(); assert.equal(ui.create.disabled, false);
  assert.equal(ui.path.hasAttribute('aria-invalid'), false); assert.equal(ui.name.hasAttribute('aria-invalid'), false);
});

test('editing either field invalidates the review; stale and closed reviews cannot restore it', async t => {
  const older = deferred(), newer = deferred(), closed = deferred(); let count = 0;
  const ui = setup(t, { request: () => [older, newer, closed][count++].promise }); ui.api.open(); ui.fill('D:\\old', 'Old'); ui.submit();
  ui.type(ui.path, 'D:\\new'); ui.type(ui.name, 'New'); assert.equal(ui.review.disabled, false); ui.submit();
  newer.resolve(inspected({ ticket: 'new', project: { name: 'New', path: 'D:\\new' } })); await pause();
  assert.equal(ui.create.disabled, false); assert.equal(ui.root.querySelector('.sw-project-name').textContent, 'New');
  older.resolve(inspected({ project: { name: 'Old', path: 'D:\\old' } })); await pause();
  assert.equal(ui.root.querySelector('.sw-project-name').textContent, 'New');
  ui.type(ui.name, 'Newest'); assert.equal(ui.create.disabled, true); assert.equal(ui.root.querySelector('.sw-review').hidden, true);
  ui.submit(); ui.api.close(); ui.api.open(); closed.resolve(inspected()); await pause();
  assert.equal(ui.create.disabled, true); assert.equal(ui.review.disabled, false); assert.equal(ui.root.querySelector('.sw-review').hidden, true);
  assert.doesNotMatch(ui.status(), /Reviewing the destination/);
});

test('creating is single-flight across close and reopen; the explicit warning and final result survive', async t => {
  const completion = deferred();
  const ui = setup(t, { request: endpoint => endpoint === 'starter/inspect' ? inspected() : completion.promise }); await ui.reviewReady();
  ui.create.click(); assert.equal(ui.path.readOnly, true); assert.equal(ui.name.readOnly, true); assert.equal(ui.create.disabled, true);
  assert.equal(ui.root.querySelector('.sw-notice:not(.sw-error)').hidden, false); assert.match(ui.dialog.textContent, /Closing this window does not cancel it/);
  const unload = new ui.dom.window.Event('beforeunload', { cancelable: true }); ui.dom.window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
  ui.api.close(); ui.launch.click(); ui.create.click(); ui.submit();
  assert.equal(ui.dialog.open, true); assert.equal(ui.calls.filter(call => call.endpoint === 'starter/create').length, 1);
  ui.api.close(); completion.resolve(created()); await pause();
  assert.equal(ui.dialog.open, false); assert.equal(ui.launch.textContent, 'View created website');
  ui.launch.click(); assert.equal(ui.root.querySelector('.sw-success').hidden, false); assert.equal(ui.doc.activeElement, ui.root.querySelector('.sw-success h3'));
  ui.root.querySelector('.sw-success-actions button:last-child').click();
  assert.equal(ui.path.value, ''); assert.equal(ui.name.value, ''); assert.equal(ui.root.querySelector('.sw-success').hidden, true); assert.equal(ui.create.disabled, true);
});

test('expired reviews and create failures require a new review; no automatic retry or installation is attempted', async t => {
  let failure = false, expired = true;
  const ui = setup(t, { request: endpoint => {
    if (endpoint === 'starter/inspect') return inspected({ expiresAt: Date.now() + (expired ? -1000 : 300000) });
    if (failure) throw Object.assign(new Error('Destination changed since review.'), { status: 409 });
    return created({ commands: {} });
  } });
  await ui.reviewReady(); ui.create.click(); assert.match(ui.status(), /review has expired/); assert.equal(ui.calls.length, 1);
  expired = false; ui.submit(); await pause(); ui.create.click(); await pause();
  assert.match(ui.status(), /may have created files/); assert.match(ui.status(), /No retry will happen automatically/); assert.equal(ui.create.disabled, true);
  failure = true; ui.submit(); await pause(); ui.create.click(); await pause();
  assert.match(ui.status(), /Destination changed/); assert.equal(ui.review.disabled, false); assert.equal(ui.create.disabled, true);
  assert.ok(ui.calls.every(call => ['starter/inspect', 'starter/create'].includes(call.endpoint)));
});

test('host availability and expired sessions disable all new operations, with a reload link for HTTP 401/403', async t => {
  const ui = setup(t, { request: () => { throw Object.assign(new Error('Session expired.'), { status: 403 }); } });
  ui.api.setAvailability('Connecting to the launcher.'); assert.equal(ui.launch.disabled, true); ui.api.open(); assert.equal(ui.dialog.open, false);
  ui.api.setAvailability(); ui.api.open(); ui.fill(); ui.submit(); await pause();
  assert.equal(ui.create.disabled, true); assert.equal(ui.review.disabled, true); assert.equal(ui.launch.disabled, true);
  assert.equal(ui.root.querySelector('.sw-reload').hidden, false); assert.equal(ui.root.querySelector('.sw-reload').href, 'http://127.0.0.1:4310/');
  assert.match(ui.root.querySelector('[role="alert"]').textContent, /session has expired/);
  ui.api.setAvailability(); ui.submit(); assert.equal(ui.calls.length, 1, 'availability cannot revive an expired session');
});

test('all returned text and shell commands are inert, exact and copyable; clipboard fallback selects without executing', async t => {
  const malicious = '<img src=x onerror="window.attacked=true"><script>window.attacked=true</script>';
  const unsafeProject = { name: malicious, path: `D:\\${'long-folder\\'.repeat(80)}${malicious}` };
  const command = `Set-Location -LiteralPath 'D:\\semi; quote'' ${malicious}'\nnpm install\nnpm run build`;
  const ui = setup(t, { request: endpoint => endpoint === 'starter/inspect' ? inspected({ project: unsafeProject, files: [malicious], directories: [malicious], warnings: [malicious] }) : created({ project: unsafeProject, commands: { powershell: command, posix: malicious }, warnings: [malicious] }) });
  await ui.reviewReady(); assert.equal(ui.root.querySelector('.sw-project-name').textContent, malicious); assert.equal(ui.root.querySelector('.sw-project-path').textContent, unsafeProject.path);
  ui.create.click(); await pause();
  assert.equal(ui.root.querySelector('img,script,iframe,a[target]'), null); assert.equal(ui.dom.window.attacked, undefined);
  const input = ui.root.querySelector('[aria-label="PowerShell setup commands"]'); assert.equal(input.value, command); assert.equal(input.readOnly, true);
  ui.root.querySelector('[aria-label="Copy PowerShell commands"]').click(); await pause();
  assert.equal(ui.doc.activeElement, input); assert.equal(input.selectionStart, 0); assert.equal(input.selectionEnd, command.length); assert.match(ui.status(), /commands are selected/);
  const copied = []; Object.defineProperty(ui.dom.window.navigator, 'clipboard', { value: { writeText: async value => { copied.push(value); } }, configurable: true });
  ui.root.querySelector('[aria-label="Copy PowerShell commands"]').click(); await pause();
  assert.deepEqual(copied, [command]); assert.match(ui.status(), /Nothing has been run/); assert.equal(ui.calls.length, 2);
});

test('IME confirmation never reviews or creates, labels resolve, Escape closes, and reopening restores usable input', async t => {
  const ui = setup(t); ui.launch.focus(); ui.launch.click(); ui.fill();
  ui.name.dispatchEvent(new ui.dom.window.CompositionEvent('compositionstart', { bubbles: true })); ui.type(ui.name, '我的网站');
  const enter = new ui.dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }); ui.name.dispatchEvent(enter); ui.submit();
  assert.equal(enter.defaultPrevented, false, 'do not cancel the IME candidate confirmation'); assert.equal(ui.calls.length, 0); assert.equal(ui.review.disabled, true);
  const cancelComposing = new ui.dom.window.Event('cancel', { cancelable: true }); ui.dialog.dispatchEvent(cancelComposing); assert.equal(ui.dialog.open, true);
  ui.name.dispatchEvent(new ui.dom.window.CompositionEvent('compositionend', { bubbles: true })); assert.equal(ui.review.disabled, false); assert.equal(ui.calls.length, 0);
  ui.submit(); await pause(); assert.equal(ui.calls.length, 1); assert.equal(ui.create.disabled, false);
  for (const label of ui.root.querySelectorAll('label[for]')) assert.ok(ui.doc.getElementById(label.htmlFor));
  assert.equal(new Set([...ui.root.querySelectorAll('[id]')].map(node => node.id)).size, ui.root.querySelectorAll('[id]').length);
  const cancel = new ui.dom.window.Event('cancel', { cancelable: true }); ui.dialog.dispatchEvent(cancel); assert.equal(cancel.defaultPrevented, true); assert.equal(ui.dialog.open, false); assert.equal(ui.doc.activeElement, ui.launch);
  ui.api.open(); assert.equal(ui.doc.activeElement, ui.path); assert.equal(ui.create.disabled, true);
});

test('a failed or late handoff preserves the creation result and never closes a reopened wizard', async t => {
  let accepted = false; const paths = [];
  const ui = setup(t, { onCheckProject: async path => { paths.push(path); return accepted; } }); await ui.reviewReady(); ui.create.click(); await pause();
  const check = ui.root.querySelector('.sw-success-actions button'); check.click(); check.click(); await pause();
  assert.deepEqual(paths, [project.path]); assert.equal(ui.dialog.open, true); assert.equal(check.disabled, false);
  accepted = true; check.click(); await pause(); assert.equal(ui.dialog.open, false); assert.equal(ui.calls.length, 2);
  const pending = deferred(); const other = setup(t, { onCheckProject: () => pending.promise }); await other.reviewReady(); other.create.click(); await pause();
  other.root.querySelector('.sw-success-actions button').click(); other.api.close(); other.api.open();
  pending.resolve(true); await pause(); assert.equal(other.dialog.open, true); assert.equal(other.root.querySelector('.sw-success-actions button').disabled, false);
});

test('destroy ignores late inspect, creation and clipboard results and removes only owned UI and listeners', async t => {
  const pending = deferred(); const ui = setup(t, { request: () => pending.promise }); ui.api.open(); ui.fill(); ui.submit();
  ui.api.destroy(); pending.resolve(inspected()); await pause(); assert.equal(ui.root.querySelector('.sw-dialog'), null); assert.ok(ui.root.querySelector('#host'));
  ui.submit(); ui.api.open(); assert.equal(ui.calls.length, 1);
  const completion = deferred(); const other = setup(t, { request: endpoint => endpoint === 'starter/inspect' ? inspected() : completion.promise }); await other.reviewReady(); other.create.click(); other.api.destroy();
  completion.resolve(created()); await pause(); assert.equal(other.root.querySelector('.sw-success'), null);
  const unload = new other.dom.window.Event('beforeunload', { cancelable: true }); other.dom.window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, false);
  const copied = deferred(); const copyUI = setup(t); await copyUI.reviewReady(); copyUI.create.click(); await pause();
  Object.defineProperty(copyUI.dom.window.navigator, 'clipboard', { value: { writeText: () => copied.promise }, configurable: true });
  copyUI.root.querySelector('[aria-label="Copy PowerShell commands"]').click(); copyUI.api.destroy(); copied.reject(new Error('Clipboard closed')); await pause();
  assert.equal(copyUI.root.querySelector('.sw-status'), null); assert.ok(copyUI.root.querySelector('#host'));
});

test('real Launchpad integration shares its token and checks the created path without opening or installing it', async t => {
  const dom = new JSDOM('<main data-launchpad></main>', { url: 'http://127.0.0.1:4310/', pretendToBeVisual: true }); const root = dom.window.document.querySelector('main'), calls = [];
  const api = mountLaunchpad({ root, fetch: async (url, options) => {
    const endpoint = url.replace('/api/launchpad/', ''); const payload = options.body ? JSON.parse(options.body) : undefined; calls.push({ endpoint, payload, headers: options.headers });
    const data = endpoint === 'state' ? { token: 'shared-session', recent: [], warnings: [] } : endpoint === 'starter/inspect' ? inspected() : endpoint === 'starter/create' ? created() : { project, ready: false, checks: [{ label: 'Dependencies', status: 'error', detail: 'Run npm install, then check again.' }] };
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  } }); t.after(() => { api.destroy(); dom.window.close(); }); await pause();
  const launch = root.querySelector('.sw-launch'); assert.equal(launch.disabled, false); launch.click();
  root.querySelector('.sw-path').value = project.path; root.querySelector('.sw-name').value = project.name;
  root.querySelector('.sw-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause(); root.querySelector('.sw-review>button').click(); await pause();
  root.querySelector('.sw-success-actions button').click(); await pause();
  assert.deepEqual(calls.map(call => call.endpoint), ['state', 'starter/inspect', 'starter/create', 'inspect']);
  assert.equal(calls[1].headers['x-studio-token'], 'shared-session'); assert.equal(calls[2].headers['x-studio-token'], 'shared-session');
  assert.equal(Object.hasOwn(calls[2].headers, 'Origin'), false);
  assert.equal(root.querySelector('.lp-path').value, project.path); assert.equal(root.querySelector('.sw-dialog').open, false);
  assert.equal(root.querySelector('.lp-trust input').checked, false); assert.equal(root.querySelector('.lp-trust>button').disabled, true);
  assert.match(root.querySelector('.lp-checks').textContent, /Run npm install/); assert.equal(root.querySelector('.lp-recent-list').textContent.includes('No recent projects'), true);
});
