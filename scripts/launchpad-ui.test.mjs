import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { editorAddress, mountLaunchpad } from '../studio/web/launchpad.js';

const html = await readFile(new URL('../studio/web/launchpad.html', import.meta.url), 'utf8');
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const project = { id: 'project-a', name: 'A quiet website', path: 'D:\\my-website' };
const state = (recent = []) => ({ token: 'test-launchpad-session', recent, warnings: [] });
const checked = (extra = {}) => ({ ticket: 'check-ticket-a', project, checks: [{ label: 'Project structure', status: 'pass', detail: 'Compatible will-astro-v1 content model.' }, { label: 'Dependencies', status: 'pass', detail: 'Installed in the selected project.' }], ready: true, ...extra });

function setup(t, handler = endpoint => endpoint === 'state' ? state() : endpoint === 'inspect' ? checked() : { url: 'http://127.0.0.1:4410/', project, warnings: [] }) {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:4300/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const doc = dom.window.document, root = doc.querySelector('[data-launchpad]'), requests = [];
  const fetcher = async (url, options) => {
    const endpoint = url.split('/').at(-1), payload = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ endpoint, payload, options });
    const data = await Promise.resolve(handler(endpoint, payload, options));
    return new Response(JSON.stringify(data?.httpStatus ? data.body : data), { status: data?.httpStatus || 200, headers: { 'Content-Type': 'application/json' } });
  };
  const api = mountLaunchpad({ root, fetch: fetcher });
  const input = root.querySelector('.lp-path'), form = root.querySelector('form'), trust = root.querySelector('[type="checkbox"]'), check = form.querySelector('[type="submit"]'), open = root.querySelector('.lp-trust>.lp-button');
  const type = value => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const submit = () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const accept = () => { trust.checked = true; trust.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  const status = () => root.querySelector('.lp-status').textContent;
  t.after(() => { api.destroy(); dom.window.close(); });
  return { dom, doc, root, api, requests, input, form, trust, check, open, type, submit, accept, status, fetcher };
}

test('checks never start project code; only explicit trust permits a ticketed open in a separate tab', async t => {
  const opening = deferred();
  const ui = setup(t, endpoint => endpoint === 'state' ? state() : endpoint === 'inspect' ? checked() : opening.promise);
  assert.equal(ui.check.disabled, true);
  await pause();
  assert.equal(ui.open.disabled, true);
  ui.type(project.path); ui.submit();
  assert.equal(ui.check.disabled, true);
  assert.equal(ui.form.getAttribute('aria-busy'), 'true');
  await pause();
  assert.equal(ui.root.querySelector('.lp-inspection').hidden, false);
  assert.match(ui.root.textContent, /does not run the project/);
  assert.equal(ui.trust.checked, false);
  assert.equal(ui.open.disabled, true);
  assert.deepEqual(ui.requests.map(item => item.endpoint), ['state', 'inspect']);
  const inspectionRequest = ui.requests[1];
  assert.deepEqual(inspectionRequest.payload, { path: project.path });
  assert.equal(inspectionRequest.options.headers['x-studio-token'], 'test-launchpad-session');
  assert.equal(Object.hasOwn(inspectionRequest.options.headers, 'Origin'), false, 'the browser supplies the actual Origin');
  ui.accept(); assert.equal(ui.open.disabled, false); ui.open.click(); ui.open.click();
  assert.equal(ui.input.readOnly, true);
  assert.equal(ui.open.disabled, true);
  assert.match(ui.status(), /Starting local preview/);
  assert.deepEqual(ui.requests.at(-1).payload, { ticket: 'check-ticket-a', trustProject: true });
  assert.equal(ui.requests.filter(item => item.endpoint === 'open').length, 1);
  assert.equal(ui.root.querySelector('.lp-opened a'), null, 'no popup or navigation before the response');
  opening.resolve({ url: 'http://127.0.0.1:4410', project, warnings: ['Keep the local launcher running.'] }); await pause();
  const editor = ui.root.querySelector('.lp-opened a');
  assert.equal(editor.href, 'http://127.0.0.1:4410/');
  assert.equal(editor.target, '_blank');
  assert.match(editor.rel, /noopener/); assert.match(editor.rel, /noreferrer/);
  assert.equal(ui.dom.window.location.href, 'http://127.0.0.1:4300/');
  assert.equal(ui.doc.activeElement, editor);
  assert.equal(ui.trust.checked, false);
  assert.equal(ui.open.disabled, true, 'a consumed ticket cannot be replayed');
  assert.match(ui.root.querySelector('.lp-opened').textContent, /no website has been published/);
});

test('editing a checked path invalidates trust and ticket; stale inspect responses cannot revive them', async t => {
  const older = deferred(), newer = deferred(); let count = 0;
  const ui = setup(t, endpoint => endpoint === 'state' ? state() : ++count === 1 ? older.promise : newer.promise);
  await pause(); ui.type('D:\\old'); ui.submit();
  ui.type('D:\\new');
  assert.equal(ui.check.disabled, false, 'a new path can be checked while an old read is pending');
  ui.submit();
  newer.resolve(checked({ ticket: 'new-ticket', project: { ...project, name: 'New project', path: 'D:\\new' } })); await pause();
  ui.accept(); assert.equal(ui.open.disabled, false);
  older.resolve(checked({ ticket: 'old-ticket', project: { ...project, name: 'Old project', path: 'D:\\old' } })); await pause();
  assert.equal(ui.root.querySelector('.lp-inspection h3').textContent, 'New project');
  ui.type('D:\\changed-again');
  assert.equal(ui.trust.checked, false); assert.equal(ui.open.disabled, true);
  assert.equal(ui.root.querySelector('.lp-inspection').hidden, true);
  ui.accept(); ui.open.click();
  assert.equal(ui.requests.some(item => item.endpoint === 'open'), false);
});

test('invalid paths, failing checks and missing dependencies never enable Open; corrected checks can retry', async t => {
  let ready = false;
  const ui = setup(t, endpoint => endpoint === 'state' ? state() : ready ? checked() : checked({ ready: false, ticket: undefined, checks: [{ label: 'Dependencies', status: 'error', detail: 'Install the trusted project’s own dependencies, then check again.' }] }));
  await pause();
  for (const path of ['', 'relative/website', 'https://example.com/', 'D:relative', 'D:\\bad\u0000path']) {
    ui.type(path); ui.submit();
    assert.equal(ui.input.getAttribute('aria-invalid'), 'true');
  }
  assert.equal(ui.requests.length, 1);
  ui.type(project.path); ui.submit(); await pause();
  assert.match(ui.status(), /needs attention/);
  assert.equal(ui.root.querySelector('.lp-trust').hidden, true);
  ui.accept(); assert.equal(ui.open.disabled, true);
  ready = true; ui.submit(); await pause();
  assert.equal(ui.input.hasAttribute('aria-invalid'), false);
  assert.equal(ui.trust.checked, false); assert.equal(ui.trust.disabled, false);
  ui.accept(); assert.equal(ui.open.disabled, false);
  assert.equal(ui.requests.filter(item => item.endpoint === 'open').length, 0);
});

test('HTTP 401/403 expire the session permanently, show Reload, and never retry writes', async t => {
  const ui = setup(t, endpoint => endpoint === 'state' ? state() : { httpStatus: 403, body: { error: 'Invalid session token' } });
  await pause(); ui.type(project.path); ui.submit(); await pause();
  assert.equal(ui.root.querySelector('.lp-session').hidden, false);
  assert.match(ui.status(), /Session expired/);
  assert.equal(ui.root.querySelector('.lp-session a').href, 'http://127.0.0.1:4300/');
  assert.equal(ui.check.disabled, true); assert.equal(ui.open.disabled, true);
  const before = ui.requests.length;
  await ui.api.refresh(); ui.submit(); ui.accept(); ui.open.click(); await pause();
  assert.equal(ui.requests.length, before);
});

test('a failed open consumes client trust and forces a fresh check, without automatically starting again', async t => {
  const ui = setup(t, endpoint => endpoint === 'state' ? state() : endpoint === 'inspect' ? checked() : { httpStatus: 409, body: { error: 'Inspection ticket expired.' } });
  await pause(); ui.type(project.path); ui.submit(); await pause(); ui.accept(); ui.open.click(); await pause();
  assert.equal(ui.open.disabled, true); assert.equal(ui.trust.checked, false);
  assert.match(ui.status(), /Check the project again/);
  assert.equal(ui.root.querySelector('.lp-session').hidden, true);
  ui.submit(); await pause();
  assert.equal(ui.trust.checked, false);
  assert.equal(ui.requests.filter(item => item.endpoint === 'open').length, 1);
});

test('recent project selection only rechecks; safe running links preserve the chooser and Forget removes only the shortcut', async t => {
  let forgotten = false;
  const recent = { ...project, running: true, url: 'http://127.0.0.1:4410/', lastOpenedAt: '2026-09-12T08:00:00Z' };
  const ui = setup(t, endpoint => {
    if (endpoint === 'state') return state(forgotten ? [] : [recent]);
    if (endpoint === 'inspect') return checked();
    if (endpoint === 'forget') { forgotten = true; return { forgotten: true }; }
    assert.fail('recent shortcuts must not execute project code');
  });
  await pause();
  const returnLink = ui.root.querySelector('.lp-recent-actions a');
  assert.equal(returnLink.href, recent.url); assert.equal(returnLink.target, '_blank'); assert.match(returnLink.rel, /noopener/);
  ui.root.querySelector('[data-recent-action="choose"]').click(); await pause();
  assert.equal(ui.input.value, project.path); assert.equal(ui.trust.checked, false); assert.equal(ui.open.disabled, true);
  assert.deepEqual(ui.requests.map(item => item.endpoint), ['state', 'inspect']);
  ui.root.querySelector('.lp-forget').click();
  assert.match(ui.root.querySelector('.lp-forget-confirm').textContent, /No files will be deleted/);
  assert.match(ui.root.querySelector('.lp-forget-confirm').textContent, /running editor will stay open/);
  assert.equal(ui.requests.some(item => item.endpoint === 'forget'), false);
  ui.root.querySelector('.lp-forget-confirm button').click(); await pause();
  assert.deepEqual(ui.requests.find(item => item.endpoint === 'forget').payload, { id: project.id });
  assert.match(ui.root.querySelector('.lp-recent-list').textContent, /No recent projects/);
  assert.match(ui.root.querySelector('.lp-recent>.lp-status').textContent, /Project files and running editors are unchanged/);
  assert.equal(ui.dom.window.location.pathname, '/');
});

test('untrusted project names, long paths, checks and warnings remain text; unsafe editor URLs never become links', async t => {
  const malicious = '<img src=x onerror="window.attacked=true"><script>window.attacked=true</script>';
  const longPath = 'D:\\' + ('a-long-folder-name\\'.repeat(80)) + malicious;
  const unsafeProject = { ...project, name: malicious, path: longPath, running: true, url: 'http://127.0.0.1:4410@evil.test/' };
  const ui = setup(t, endpoint => endpoint === 'state' ? { ...state([unsafeProject]), warnings: [malicious] } : endpoint === 'inspect' ? checked({ project: unsafeProject, checks: [{ label: malicious, status: 'pass', detail: malicious }] }) : { url: 'javascript:window.attacked=true', project: unsafeProject, warnings: [] });
  await pause();
  assert.equal(ui.root.querySelector('img,script'), null);
  assert.equal(ui.root.querySelector('.lp-recent-actions a'), null);
  assert.equal(ui.root.querySelector('.lp-recent-project h3').textContent, malicious);
  assert.equal(ui.root.querySelector('.lp-recent-project .lp-project-path').textContent, longPath);
  ui.type(longPath); ui.submit(); await pause(); ui.accept(); ui.open.click(); await pause();
  assert.equal(ui.root.querySelector('img,script'), null);
  assert.equal(ui.dom.window.attacked, undefined);
  assert.equal(ui.root.querySelector('.lp-opened a'), null);
  assert.match(ui.status(), /unsafe editor address/);
  assert.equal(ui.dom.window.location.hostname, '127.0.0.1');
});

test('editor addresses require exact IPv4 loopback, explicit valid port, and no additional URL components', () => {
  for (const safe of ['http://127.0.0.1:4310', 'http://127.0.0.1:1/', 'http://127.0.0.1:65535/']) assert.ok(editorAddress(safe));
  for (const unsafe of [null, '', 'http://localhost:4310/', 'https://127.0.0.1:4310/', 'http://127.0.0.2:4310/', 'http://127.1:4310/', 'http://2130706433:4310/', 'http://127.0.0.1/', 'http://127.0.0.1:0/', 'http://127.0.0.1:65536/', 'http://127.0.0.1:04310/', 'http://127.0.0.1:4310/path', 'http://127.0.0.1:4310//', 'http://127.0.0.1:4310/?token=secret', 'http://127.0.0.1:4310/#fragment', 'http://user@127.0.0.1:4310/', 'http://127.0.0.1:4310@evil.test/', 'http://127.0.0.1:4310/\\evil.test', ' http://127.0.0.1:4310/', 'http://127.0.0.1:4310/\n']) assert.equal(editorAddress(unsafe), null, String(unsafe));
});

test('IME Enter cannot submit or open; completed input still needs an explicit check and trust', async t => {
  const ui = setup(t); await pause();
  ui.input.dispatchEvent(new ui.dom.window.CompositionEvent('compositionstart', { bubbles: true })); ui.type('D:\\网站');
  const enter = new ui.dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
  ui.input.dispatchEvent(enter); ui.submit();
  assert.equal(enter.defaultPrevented, true); assert.equal(ui.requests.length, 1);
  ui.input.dispatchEvent(new ui.dom.window.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(ui.requests.length, 1); ui.submit(); await pause();
  assert.equal(ui.requests[1].endpoint, 'inspect'); assert.equal(ui.trust.checked, false); assert.equal(ui.open.disabled, true);
  const ids = [...ui.root.querySelectorAll('[id]')].map(node => node.id); assert.equal(new Set(ids).size, ids.length);
  for (const label of ui.root.querySelectorAll('label[for]')) assert.ok(ui.doc.getElementById(label.htmlFor));
  assert.equal(ui.root.querySelector('.lp-session').getAttribute('role'), 'alert');
  assert.equal(ui.root.querySelector('.lp-status').getAttribute('aria-live'), 'polite');
});

test('failed state reads can refresh, latest state wins, and destroy cleans pending requests and detached listeners', async t => {
  const old = deferred(), newer = deferred(); let stateCalls = 0;
  const ui = setup(t, endpoint => { assert.equal(endpoint, 'state'); stateCalls++; if (stateCalls === 1) return { httpStatus: 500, body: { error: 'Launcher is not ready' } }; return stateCalls === 2 ? old.promise : newer.promise; });
  await pause(); assert.match(ui.status(), /Could not connect/); assert.equal(ui.check.disabled, true);
  const olderRefresh = ui.api.refresh(), newerRefresh = ui.api.refresh();
  newer.resolve(state([{ ...project, name: 'Newest list' }])); await newerRefresh;
  old.resolve(state([{ ...project, name: 'Older list' }])); await olderRefresh;
  assert.match(ui.root.querySelector('.lp-recent-list').textContent, /Newest list/);
  assert.doesNotMatch(ui.root.querySelector('.lp-recent-list').textContent, /Older list/);
  assert.equal(ui.root.querySelector('.lp-recent>.lp-status').textContent, '', 'a successful retry clears the old connection error');
  assert.equal(mountLaunchpad({ root: ui.root, fetch: ui.fetcher }), ui.api, 'mounting twice does not duplicate the UI');
  const priorCalls = ui.requests.length;
  ui.api.destroy(); ui.type(project.path); ui.submit(); await ui.api.refresh();
  assert.equal(ui.requests.length, priorCalls); assert.equal(ui.root.children.length, 0);
  assert.equal(ui.root.hasAttribute('data-launchpad-mounted'), false);
});

test('destroy aborts a pending check and a late result cannot rebuild the chooser', async t => {
  const result = deferred();
  const ui = setup(t, endpoint => endpoint === 'state' ? state() : result.promise);
  await pause(); ui.type(project.path); ui.submit();
  const request = ui.requests.find(item => item.endpoint === 'inspect');
  assert.equal(request.options.signal.aborted, false);
  ui.api.destroy();
  assert.equal(request.options.signal.aborted, true);
  result.resolve(checked()); await pause();
  assert.equal(ui.root.children.length, 0);
  ui.submit(); assert.equal(ui.requests.length, 2);
});

test('inconsistent or malformed check responses cannot authorize code execution', async t => {
  let response = checked({ checks: [{ label: 'Dependencies', status: 'error', detail: 'Not installed.' }] });
  const ui = setup(t, endpoint => endpoint === 'state' ? state() : response);
  await pause(); ui.type(project.path); ui.submit(); await pause();
  ui.accept(); assert.equal(ui.open.disabled, true, 'an error check overrides an inconsistent ready flag');
  response = checked({ ticket: undefined });
  ui.submit(); await pause(); ui.accept();
  assert.equal(ui.open.disabled, true); assert.match(ui.status(), /incomplete response/);
  assert.equal(ui.requests.some(item => item.endpoint === 'open'), false);
});
