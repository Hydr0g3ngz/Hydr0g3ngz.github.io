const mounted = new WeakMap();
let launchpadCount = 0;

/** Only literal loopback editor origins with an explicit port are navigable. */
export function editorAddress(value) {
  if (typeof value !== 'string') return null;
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/.exec(value);
  return match && Number(match[1]) <= 65535 ? `http://127.0.0.1:${match[1]}/` : null;
}

function absoluteDirectory(value) {
  return typeof value === 'string' && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value)
    && /^(?:[a-z]:[\\/]|\/|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/i.test(value);
}

/** Self-contained chooser. No editor imports and no automatic project execution. */
export function mountLaunchpad({ root = document.querySelector('[data-launchpad]'), fetch: fetcher = (...args) => globalThis.fetch(...args) } = {}) {
  if (!root) throw new Error('A launchpad container is required.');
  if (mounted.has(root)) return mounted.get(root);
  const doc = root.ownerDocument, win = doc.defaultView;
  const events = new win.AbortController(), pending = new Set();
  let recentEvents = new win.AbortController();
  const uid = `launchpad-${++launchpadCount}`;
  let alive = true, token = '', connected = false, expired = false, composing = false;
  let checking = false, opening = false, inspection = null, checkedValue = '';
  let selection = 0, stateSequence = 0, openSequence = 0, recent = [], confirming = null;
  const forgetting = new Set();
  function el(tag, className, text) { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; }
  function button(text, className = 'lp-button') { const node = el('button', className, text); node.type = 'button'; return node; }
  function listen(target, type, handler) { target.addEventListener(type, handler, { signal: events.signal }); }
  function externalEditor(url, text) { const safe = editorAddress(url); if (!safe) return null; const link = el('a', 'lp-button lp-editor-link', text); link.href = safe; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; }

  const introduction = el('section', 'lp-introduction');
  introduction.append(el('p', 'lp-eyebrow', 'A PLACE TO MAKE THINGS'), el('h1', '', 'Put a project on your desk.'), el('p', 'lp-lead', 'Open a website from your computer. Check its setup first, then decide whether to run it. Your live website stays as it is.'));
  const session = el('section', 'lp-session lp-notice lp-error'); session.hidden = true; session.setAttribute('role', 'alert');
  const sessionTitle = el('h2', '', 'Your launcher session has expired'); sessionTitle.tabIndex = -1;
  const reload = el('a', 'lp-button', 'Reload launcher'); reload.href = '/';
  session.append(sessionTitle, el('p', '', 'Reload this page before checking or opening another project. No operation will be retried automatically.'), reload);
  const layout = el('div', 'lp-layout');
  const chooser = el('section', 'lp-card lp-chooser'); chooser.setAttribute('aria-labelledby', `${uid}-choose`);
  const chooseTitle = el('h2', '', 'Choose a website'); chooseTitle.id = `${uid}-choose`;
  const form = el('form', 'lp-path-form'); form.noValidate = true;
  const pathLabel = el('label', '', 'Local project folder'); pathLabel.htmlFor = `${uid}-path`;
  const pathRow = el('div', 'lp-path-row');
  const path = el('input', 'lp-path'); path.id = `${uid}-path`; path.name = 'path'; path.type = 'text'; path.autocomplete = 'off'; path.spellcheck = false; path.maxLength = 4096; path.placeholder = 'D:\\my-website';
  path.setAttribute('aria-describedby', `${uid}-path-help ${uid}-status`);
  const check = button('Check project', 'lp-button lp-primary'); check.type = 'submit';
  pathRow.append(path, check);
  const pathHelp = el('p', 'lp-help', 'Use an absolute folder path, such as D:\\my-website or /Users/you/my-website.'); pathHelp.id = `${uid}-path-help`;
  const checkNotice = el('p', 'lp-safe-note', 'Checking reads project metadata and dependency information. It does not run the project’s code or install packages.');
  const status = el('p', 'lp-status', 'Connecting to your local launcher…'); status.id = `${uid}-status`; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  form.append(pathLabel, pathRow, pathHelp, checkNotice);
  const inspected = el('section', 'lp-inspection'); inspected.hidden = true; inspected.setAttribute('aria-labelledby', `${uid}-project`);
  const inspectedTitle = el('h3', '', 'Project checks'); inspectedTitle.id = `${uid}-project`; inspectedTitle.tabIndex = -1;
  const inspectedPath = el('p', 'lp-project-path');
  const checkList = el('ul', 'lp-checks'); checkList.setAttribute('aria-label', 'Project checks');
  const trustArea = el('div', 'lp-trust');
  const trustLabel = el('label', 'lp-trust-label');
  const trust = el('input'); trust.type = 'checkbox'; trust.id = `${uid}-trust`; trust.setAttribute('aria-describedby', `${uid}-trust-help`);
  trustLabel.append(trust, el('span', '', 'I trust this project and allow its local code to run'));
  const trustHelp = el('p', 'lp-help', 'Opening runs the project’s schema, Astro configuration and local preview. A compatible folder is not a security sandbox. Only open code you trust.'); trustHelp.id = `${uid}-trust-help`;
  const open = button('Open in Studio', 'lp-button lp-primary');
  trustArea.append(trustLabel, trustHelp, open);
  inspected.append(inspectedTitle, inspectedPath, checkList, trustArea);
  const opened = el('section', 'lp-opened lp-notice'); opened.hidden = true; opened.setAttribute('aria-label', 'Project ready');
  chooser.append(chooseTitle, el('p', 'lp-card-intro', 'Compatible will-astro-v1 projects only. This is not an editor for arbitrary websites.'), form, status, inspected, opened);

  const history = el('section', 'lp-card lp-recent'); history.setAttribute('aria-labelledby', `${uid}-recent`);
  const historyHead = el('div', 'lp-section-heading');
  const historyTitle = el('h2', '', 'Recently opened'); historyTitle.id = `${uid}-recent`;
  const retry = button('Refresh', 'lp-button lp-quiet');
  historyHead.append(historyTitle, retry);
  const recentHelp = el('p', 'lp-card-intro', 'Choose a folder to check it again. Nothing here starts automatically.');
  const recentStatus = el('p', 'lp-status'); recentStatus.setAttribute('role', 'status'); recentStatus.setAttribute('aria-live', 'polite');
  const recentList = el('div', 'lp-recent-list');
  const warnings = el('div', 'lp-warnings'); warnings.setAttribute('role', 'status');
  history.append(historyHead, recentHelp, recentStatus, recentList, warnings);
  layout.append(chooser, history);
  const footer = el('footer', 'lp-footer', 'Local editing only. Opening, checking and saving do not publish a website. Existing editor tabs and their browser drafts stay separate.');
  root.replaceChildren(introduction, session, layout, footer);
  root.dataset.launchpadMounted = 'true';

  function canOpen() { return connected && !expired && !checking && !opening && inspection?.ready === true && checkedValue === path.value && trust.checked; }
  function controls() {
    check.disabled = !connected || expired || checking || opening || composing;
    check.textContent = checking ? 'Checking…' : 'Check project';
    path.readOnly = opening || expired;
    form.setAttribute('aria-busy', String(checking));
    trust.disabled = !connected || expired || opening || checking || inspection?.ready !== true;
    open.disabled = !canOpen(); open.textContent = opening ? 'Starting local preview…' : 'Open in Studio';
    inspected.setAttribute('aria-busy', String(opening));
    retry.disabled = expired;
    for (const node of recentList.querySelectorAll('[data-recent-action]')) node.disabled = expired || !connected || (node.dataset.recentAction === 'choose' && opening) || forgetting.has(node.dataset.projectId);
  }
  function message(text, error = false) { status.textContent = text; status.classList.toggle('lp-error-text', error); }
  function expire() {
    if (!alive || expired) return;
    expired = true; inspection = null; trust.checked = false; checking = false; opening = false; selection++; openSequence++;
    session.hidden = false; controls(); sessionTitle.focus({ preventScroll: true });
    message('Session expired. Reload the launcher to continue.', true);
  }
  async function request(endpoint, payload) {
    const controller = new win.AbortController(); pending.add(controller);
    try {
      const response = await fetcher(`/api/launchpad/${endpoint}`, { method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'x-studio-token': token }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
      let data;
      try { data = await response.json(); } catch { data = {}; }
      if (response.status === 401 || response.status === 403) { expire(); throw new Error('Session expired. Reload the launcher to continue.'); }
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : `The request failed (${response.status}). Try again.`);
      return data;
    } finally { pending.delete(controller); }
  }
  function invalidate() {
    selection++; inspection = null; checkedValue = ''; checking = false; trust.checked = false; inspected.hidden = true; opened.hidden = true;
    path.removeAttribute('aria-invalid');
    if (!expired) message(connected ? 'Check this folder before opening it.' : 'Connecting to your local launcher…');
    controls();
  }
  function showInspection(data) {
    inspected.hidden = false; inspectedTitle.textContent = data.project.name; inspectedPath.textContent = data.project.path;
    checkList.replaceChildren();
    for (const item of data.checks) {
      const row = el('li', `lp-check lp-check-${item.status}`);
      const body = el('div'); body.append(el('strong', '', item.label), el('p', '', item.detail || ''));
      const tag = el('span', 'lp-check-status', { pass: 'Passed', error: 'Needs attention', warning: 'Note' }[item.status]);
      row.append(tag, body); checkList.append(row);
    }
    trustArea.hidden = !data.ready;
  }
  async function inspectProject() {
    if (!alive || !connected || expired || opening || composing || checking) return;
    const value = path.value;
    invalidate();
    if (!absoluteDirectory(value.trim())) { path.setAttribute('aria-invalid', 'true'); message('Enter an absolute local folder path, such as D:\\my-website.', true); path.focus(); return; }
    const intent = selection;
    checking = true; message('Checking project structure and installed dependencies…'); controls();
    try {
      const data = await request('inspect', { path: value.trim() });
      if (!alive || expired || intent !== selection || path.value !== value) return;
      if (!data?.project || typeof data.project.name !== 'string' || typeof data.project.path !== 'string' || !Array.isArray(data.checks) || !data.checks.length || data.checks.some(item => !item || typeof item.label !== 'string' || !['pass', 'error', 'warning'].includes(item.status)) || typeof data.ready !== 'boolean' || (data.ready && (typeof data.ticket !== 'string' || !data.ticket))) throw new Error('The project check returned an incomplete response. Check the folder again.');
      inspection = { ...data, ready: data.ready && !data.checks.some(item => item.status === 'error') };
      checkedValue = value; trust.checked = false; showInspection(inspection);
      message(inspection.ready ? 'Checks passed. Review the project, then confirm that you trust its code.' : 'This project needs attention. Resolve the checks below, then check again.', !inspection.ready);
      if (doc.activeElement === path || doc.activeElement === check) inspectedTitle.focus({ preventScroll: true });
    } catch (error) {
      if (alive && !expired && intent === selection) { inspection = null; message(error.message || 'Could not check this folder. Try again.', true); }
    } finally { if (alive && intent === selection) { checking = false; controls(); } }
  }
  async function openProject() {
    if (!alive || !canOpen()) return;
    const intent = ++openSequence, chosen = inspection.project, ticket = inspection.ticket;
    opening = true; message('Starting local preview… This can take a little while. Keep this page open; nothing is being published.'); controls();
    try {
      const data = await request('open', { ticket, trustProject: true });
      if (!alive || expired || intent !== openSequence) return;
      const link = externalEditor(data.url, 'Open editor ↗');
      if (!link) throw new Error('The launcher returned an unsafe editor address. No navigation was allowed. Check the project again.');
      inspection = null; trust.checked = false; inspected.hidden = true;
      opened.replaceChildren(el('p', 'lp-eyebrow', 'READY WHEN YOU ARE'), el('h3', '', chosen.name), el('p', 'lp-project-path', chosen.path), el('p', '', 'Continue in a new tab. This project chooser stays open, and no website has been published.'), link);
      for (const warning of Array.isArray(data.warnings) ? data.warnings : []) opened.append(el('p', 'lp-help', warning));
      opened.hidden = false; message('Your local editor is ready. Use Open editor to continue.'); link.focus({ preventScroll: true });
      void refresh();
    } catch (error) {
      if (alive && !expired && intent === openSequence) { inspection = null; trust.checked = false; inspected.hidden = true; message(`${error.message || 'The project could not be started.'} Check the project again before retrying.`, true); }
    } finally { if (alive && intent === openSequence) { opening = false; controls(); } }
  }
  function renderRecent() {
    recentEvents.abort(); recentEvents = new win.AbortController();
    const recentListen = (node, type, handler) => node.addEventListener(type, handler, { signal: recentEvents.signal });
    recentList.replaceChildren();
    if (!recent.length) { recentList.append(el('p', 'lp-empty', connected ? 'No recent projects yet. Your first workspace can begin on the left.' : 'Recent projects will appear here.')); return; }
    for (const project of recent) {
      const card = el('article', 'lp-recent-project');
      const head = el('div', 'lp-recent-title'); head.append(el('h3', '', project.name), el('span', 'lp-running', project.running ? 'Running locally' : 'Local folder'));
      const date = new Date(project.lastOpenedAt);
      const actions = el('div', 'lp-recent-actions');
      const choose = button('Check this project', 'lp-button lp-quiet'); choose.dataset.recentAction = 'choose'; choose.dataset.projectId = project.id;
      const forget = button('Forget', 'lp-forget'); forget.dataset.recentAction = 'forget'; forget.dataset.projectId = project.id;
      choose.setAttribute('aria-label', `Check project ${project.name}`); forget.setAttribute('aria-label', `Forget ${project.name} from recent projects`);
      recentListen(choose, 'click', () => { if (opening || expired) return; path.value = project.path; composing = false; invalidate(); path.focus(); void inspectProject(); });
      recentListen(forget, 'click', () => { confirming = project.id; renderRecent(); recentList.querySelector('.lp-forget-confirm button')?.focus(); });
      actions.append(choose);
      if (project.running) { const link = externalEditor(project.url, 'Return to editor ↗'); if (link) actions.append(link); else actions.append(el('span', 'lp-help lp-error-text', 'Editor address unavailable. Check this project again.')); }
      actions.append(forget);
      card.append(head, el('p', 'lp-project-path', project.path));
      if (!Number.isNaN(date.getTime())) card.append(el('p', 'lp-date', `Last opened ${date.toLocaleString()}`));
      card.append(actions);
      if (confirming === project.id) {
        const confirmation = el('div', 'lp-forget-confirm');
        confirmation.append(el('p', '', 'Forget this shortcut only? No files will be deleted, and a running editor will stay open.'));
        const yes = button(forgetting.has(project.id) ? 'Forgetting…' : 'Forget shortcut', 'lp-button lp-quiet'), no = button('Keep it', 'lp-button lp-quiet');
        yes.dataset.recentAction = 'forget'; yes.dataset.projectId = project.id; no.disabled = forgetting.has(project.id);
        recentListen(no, 'click', () => { confirming = null; renderRecent(); [...recentList.querySelectorAll('.lp-forget')].find(node => node.dataset.projectId === project.id)?.focus(); });
        recentListen(yes, 'click', () => void forgetProject(project.id));
        confirmation.append(yes, no); card.append(confirmation);
      }
      recentList.append(card);
    }
    controls();
  }
  async function forgetProject(id) {
    if (!alive || expired || !connected || forgetting.has(id)) return;
    forgetting.add(id); renderRecent(); recentStatus.textContent = 'Removing the recent-project shortcut…';
    try {
      await request('forget', { id });
      if (!alive || expired) return;
      confirming = null; recentStatus.textContent = 'Shortcut forgotten. Project files and running editors are unchanged.';
      await refresh();
    } catch (error) { if (alive && !expired) recentStatus.textContent = error.message || 'Could not forget this shortcut. Try again.'; }
    finally { if (alive) { forgetting.delete(id); renderRecent(); } }
  }
  async function refresh() {
    if (!alive || expired) return;
    const requestId = ++stateSequence;
    retry.disabled = true;
    try {
      const data = await request('state');
      if (!alive || expired || requestId !== stateSequence) return;
      if (typeof data.token !== 'string' || !data.token || !Array.isArray(data.recent)) throw new Error('The launcher returned an incomplete workspace list. Refresh to try again.');
      token = data.token; connected = true;
      recent = data.recent.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.path === 'string');
      if (!forgetting.size) recentStatus.textContent = '';
      warnings.replaceChildren();
      for (const warning of Array.isArray(data.warnings) ? data.warnings : []) warnings.append(el('p', 'lp-help', warning));
      renderRecent();
      if (!inspection && !opening && opened.hidden) message(path.value ? 'Check this folder before opening it.' : 'Choose a folder to begin. Checking will not run project code.');
    } catch (error) {
      if (alive && !expired && requestId === stateSequence) { recentStatus.textContent = error.message || 'Could not load recent projects. Refresh to try again.'; if (!connected) message('Could not connect to the launcher. Use Refresh to try again.', true); }
    } finally { if (alive && requestId === stateSequence) controls(); }
  }
  listen(path, 'input', invalidate);
  listen(path, 'compositionstart', () => { composing = true; invalidate(); });
  listen(path, 'compositionend', () => { composing = false; controls(); });
  listen(form, 'submit', event => { event.preventDefault(); if (!composing) void inspectProject(); });
  listen(path, 'keydown', event => { if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); } });
  listen(trust, 'change', controls);
  listen(open, 'click', () => void openProject());
  listen(retry, 'click', () => void refresh());
  const api = { refresh, destroy() { if (!alive) return; alive = false; selection++; stateSequence++; openSequence++; events.abort(); recentEvents.abort(); for (const controller of pending) controller.abort(); pending.clear(); root.replaceChildren(); delete root.dataset.launchpadMounted; mounted.delete(root); } };
  mounted.set(root, api); controls(); renderRecent(); void refresh();
  return api;
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-launchpad]');
  if (root) mountLaunchpad({ root });
}
