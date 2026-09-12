let wizardCount = 0;

function absoluteDirectory(value) {
  return typeof value === 'string' && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value)
    && /^(?:[a-z]:[\\/]|\/|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/i.test(value);
}

/** Local source-file creation only. The host supplies its authenticated request helper. */
export function mountStarterWizard({ root, request, onCheckProject } = {}) {
  if (!root?.ownerDocument || typeof request !== 'function') throw new Error('A starter container and request function are required.');
  const doc = root.ownerDocument, win = doc.defaultView, events = new win.AbortController();
  const uid = `starter-wizard-${++wizardCount}`;
  let alive = true, visible = false, unavailable = '', expired = false, composing = false;
  let inspecting = false, creating = false, handingOff = false, sequence = 0, viewSequence = 0, inspection = null, created = null, restoreFocus = null;
  const el = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const button = (text, className = 'sw-button') => { const node = el('button', className, text); node.type = 'button'; return node; };
  const listen = (node, name, handler) => node.addEventListener(name, handler, { signal: events.signal });
  const entry = el('section', 'sw-entry');
  const entryCopy = el('div'); entryCopy.append(el('h3', '', 'Start with a small website.'), el('p', '', 'Create a neutral, compatible starter in a new local folder.'));
  const launch = button('Create a website', 'sw-button sw-launch'); launch.setAttribute('aria-haspopup', 'dialog');
  entry.append(entryCopy, launch);
  const dialog = el('dialog', 'sw-dialog'); dialog.setAttribute('aria-labelledby', `${uid}-title`); dialog.setAttribute('aria-describedby', `${uid}-intro`);
  const header = el('header', 'sw-header');
  const heading = el('h2', '', 'Create a website'); heading.id = `${uid}-title`;
  const dismiss = button('Close', 'sw-button sw-quiet'); dismiss.setAttribute('aria-label', 'Close website creation');
  header.append(heading, dismiss);
  const body = el('div', 'sw-body');
  const intro = el('p', 'sw-intro', 'A simple starting point for Will Studio. Review every file before creating it on your computer.'); intro.id = `${uid}-intro`;
  const boundary = el('p', 'sw-boundary', 'Source files only. No packages are installed, no project code is run, and nothing is published. There are no network or Git operations.');
  const availability = el('p', 'sw-notice sw-error'); availability.hidden = true; availability.setAttribute('role', 'alert');
  const reload = el('a', 'sw-reload', 'Reload launcher'); reload.href = '/'; reload.hidden = true;
  const form = el('form', 'sw-form'); form.noValidate = true;
  const pathLabel = el('label', '', 'New website folder'); pathLabel.htmlFor = `${uid}-path`;
  const path = el('input', 'sw-input sw-path'); path.id = `${uid}-path`; path.name = 'path'; path.type = 'text'; path.maxLength = 4096; path.autocomplete = 'off'; path.spellcheck = false; path.placeholder = 'D:\\my-website'; path.setAttribute('aria-describedby', `${uid}-path-help`);
  const pathHelp = el('p', 'sw-help', 'Use an absolute path to a new or empty folder, such as D:\\my-website or /Users/you/my-website. Existing files will not be overwritten.'); pathHelp.id = `${uid}-path-help`;
  const nameLabel = el('label', '', 'Project display name'); nameLabel.htmlFor = `${uid}-name`;
  const name = el('input', 'sw-input sw-name'); name.id = `${uid}-name`; name.name = 'name'; name.type = 'text'; name.maxLength = 100; name.autocomplete = 'off'; name.placeholder = 'My website';
  const review = button('Review files', 'sw-button sw-primary'); review.type = 'submit';
  form.append(pathLabel, path, pathHelp, nameLabel, name, review);
  const status = el('p', 'sw-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const reviewPanel = el('section', 'sw-review'); reviewPanel.hidden = true; reviewPanel.setAttribute('aria-labelledby', `${uid}-review`);
  const reviewTitle = el('h3', '', 'Review the starter'); reviewTitle.id = `${uid}-review`; reviewTitle.tabIndex = -1;
  const reviewedName = el('p', 'sw-project-name'), reviewedPath = el('p', 'sw-project-path'), counts = el('p', 'sw-counts');
  const expiry = el('p', 'sw-help');
  const warningList = el('ul', 'sw-warnings'); warningList.setAttribute('aria-label', 'Starter warnings');
  const fileDetails = el('details', 'sw-files'); fileDetails.open = true;
  const fileSummary = el('summary', '', 'Files and folders to create');
  const fileList = el('ul'); fileList.setAttribute('aria-label', 'Files to create');
  const directoryDetails = el('details', 'sw-directories'), directoryList = el('ul'); directoryList.setAttribute('aria-label', 'Directories to create');
  directoryDetails.append(el('summary', '', 'Directories'), directoryList); fileDetails.append(fileSummary, fileList, directoryDetails);
  const create = button('Create website files', 'sw-button sw-primary');
  const createNote = el('p', 'sw-help', 'This writes the reviewed source files to the folder above. It does not install dependencies or start the website.');
  reviewPanel.append(reviewTitle, reviewedName, reviewedPath, counts, expiry, warningList, fileDetails, createNote, create);
  const continuing = el('p', 'sw-notice', 'Creation has been requested. Closing this window does not cancel it. Keep the launcher running; reopen this window to see the result.'); continuing.hidden = true;
  const success = el('section', 'sw-success'); success.hidden = true; success.setAttribute('aria-labelledby', `${uid}-success`);
  const successTitle = el('h3', '', 'Your source files are ready'); successTitle.id = `${uid}-success`; successTitle.tabIndex = -1;
  const successPath = el('p', 'sw-project-path');
  const successWarnings = el('ul', 'sw-warnings'); successWarnings.setAttribute('aria-label', 'Creation warnings');
  const next = el('p', '', 'Dependencies are not installed yet. In your own terminal, run npm install first, then npm run build to check the starter. The commands below are for you to review and run; Will Studio will not execute them.');
  const commands = el('div', 'sw-commands');
  const commandInputs = {};
  for (const [key, label] of [['powershell', 'PowerShell'], ['posix', 'macOS / Linux shell']]) {
    const group = el('section', 'sw-command'); const commandLabel = el('label', '', label); commandLabel.htmlFor = `${uid}-${key}`;
    const input = el('textarea', 'sw-command-text'); input.id = `${uid}-${key}`; input.readOnly = true; input.rows = 4; input.spellcheck = false; input.setAttribute('aria-label', `${label} setup commands`);
    const copy = button('Copy commands', 'sw-button sw-quiet'); copy.setAttribute('aria-label', `Copy ${label} commands`);
    listen(copy, 'click', async () => {
      if (!alive || !created) return;
      const result = created;
      try {
        if (!win.navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await win.navigator.clipboard.writeText(input.value);
        if (alive && created === result) message(`${label} commands copied. Nothing has been run.`);
      } catch {
        if (!alive || created !== result) return;
        input.focus(); input.select(); message('Copy is unavailable here. The commands are selected; use your usual keyboard shortcut to copy them.');
      }
    });
    group.append(commandLabel, input, copy); commands.append(group); commandInputs[key] = input;
  }
  const checkCreated = button('Check this project', 'sw-button sw-primary');
  const checkHelp = el('p', 'sw-help', 'After installing dependencies, check the folder here. Checking is read-only; opening it later still requires your explicit trust.');
  const again = button('Create another website', 'sw-button sw-quiet');
  const successActions = el('div', 'sw-success-actions'); successActions.append(checkCreated, again);
  success.append(successTitle, successPath, el('p', 'sw-help', 'Created locally. No installation, preview, Git repository or publication was started.'), successWarnings, next, commands, checkHelp, successActions);
  body.append(intro, boundary, availability, reload, form, status, continuing, reviewPanel, success); dialog.append(header, body); root.append(entry, dialog);

  function message(text, error = false) { status.textContent = text; status.classList.toggle('sw-error-text', error); }
  function controls() {
    const blocked = Boolean(unavailable) || expired;
    availability.hidden = !blocked; availability.textContent = expired ? 'Your launcher session has expired. Reload before reviewing or creating another website.' : unavailable;
    reload.hidden = !expired;
    launch.disabled = blocked; launch.textContent = creating ? 'View website creation' : created ? 'View created website' : 'Create a website';
    review.disabled = blocked || inspecting || creating || composing || Boolean(created);
    review.textContent = inspecting ? 'Reviewing…' : 'Review files';
    path.readOnly = name.readOnly = creating || handingOff || blocked;
    form.hidden = Boolean(created); form.setAttribute('aria-busy', String(inspecting));
    create.disabled = blocked || creating || composing || !inspection?.ready || inspection.path !== path.value || inspection.name !== name.value;
    create.textContent = creating ? 'Creating files…' : 'Create website files';
    reviewPanel.setAttribute('aria-busy', String(creating)); continuing.hidden = !creating;
    checkCreated.disabled = blocked || handingOff || !created || typeof onCheckProject !== 'function';
    checkCreated.textContent = handingOff ? 'Checking…' : 'Check this project';
    again.disabled = handingOff;
  }
  function invalidate() {
    if (!alive || creating || created) return;
    sequence++; inspecting = false; inspection = null; reviewPanel.hidden = true;
    path.removeAttribute('aria-invalid'); name.removeAttribute('aria-invalid');
    message('Review the destination and files before creating anything.'); controls();
  }
  function isProject(value) { return value && typeof value.name === 'string' && value.name.trim() && absoluteDirectory(value.path); }
  function arePaths(value) { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
  function renderWarnings(target, values) { target.replaceChildren(); for (const value of Array.isArray(values) ? values : []) if (typeof value === 'string') target.append(el('li', '', value)); target.hidden = !target.children.length; }
  function responseError(error, fallback) { if (error?.status === 401 || error?.status === 403) expired = true; return typeof error?.message === 'string' ? error.message : fallback; }
  async function inspect() {
    if (!alive || !visible || !dialog.isConnected || review.disabled || composing) return;
    invalidate();
    const pathValue = path.value, nameValue = name.value;
    if (!absoluteDirectory(pathValue.trim())) { path.setAttribute('aria-invalid', 'true'); message('Enter an absolute local path to a new or empty folder.', true); path.focus(); return; }
    if (!nameValue.trim() || nameValue.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(nameValue)) { name.setAttribute('aria-invalid', 'true'); message('Enter a project name of 1–100 characters, without control characters.', true); name.focus(); return; }
    const intent = sequence;
    inspecting = true; message('Reviewing the destination and starter file list. No files are being written…'); controls();
    try {
      const data = await request('starter/inspect', { path: pathValue.trim(), name: nameValue.trim() });
      if (!alive || !visible || intent !== sequence || path.value !== pathValue || name.value !== nameValue) return;
      if (!isProject(data?.project) || typeof data.ready !== 'boolean' || !arePaths(data.files) || !arePaths(data.directories) || (data.ready && (typeof data.ticket !== 'string' || !data.ticket || !data.files.length))) throw new Error('The file review returned an incomplete response. Review the folder again.');
      inspection = { ...data, path: pathValue, name: nameValue };
      reviewedName.textContent = data.project.name; reviewedPath.textContent = data.project.path;
      counts.textContent = `${data.files.length} files · ${data.directories.length} directories`;
      const expires = new Date(data.expiresAt); expiry.hidden = !Number.isFinite(expires.getTime()); expiry.textContent = expiry.hidden ? '' : `This review expires at ${expires.toLocaleTimeString()}. Editing either field requires a new review.`;
      renderWarnings(warningList, data.warnings); fileList.replaceChildren(); directoryList.replaceChildren();
      for (const value of data.files) fileList.append(el('li', '', value));
      for (const value of data.directories) directoryList.append(el('li', '', value));
      reviewPanel.hidden = false;
      message(data.ready ? 'Review the files and destination, then choose Create website files.' : 'This destination is not ready. Review the warnings and choose another folder.', !data.ready);
      if (doc.activeElement === review || doc.activeElement === path || doc.activeElement === name) reviewTitle.focus({ preventScroll: true });
    } catch (error) {
      if (alive && intent === sequence) { inspection = null; message(responseError(error, 'Could not review this destination. Try again.'), true); }
    } finally { if (alive && intent === sequence) { inspecting = false; controls(); } }
  }
  async function createFiles() {
    if (!alive || !visible || !dialog.isConnected || create.disabled || creating || composing) return;
    const checked = inspection, intent = ++sequence;
    const expiryTime = new Date(checked.expiresAt).getTime();
    if (Number.isFinite(expiryTime) && expiryTime <= Date.now()) { invalidate(); message('This review has expired. Review the files again before creating them.', true); return; }
    creating = true; message('Creating the reviewed source files locally. No packages are being installed…'); controls();
    try {
      const data = await request('starter/create', { ticket: checked.ticket, createProject: true });
      if (!alive || intent !== sequence) return;
      if (!isProject(data?.project) || !arePaths(data.files) || !data.files.length || !arePaths(data.directories) || typeof data.commands?.powershell !== 'string' || !data.commands.powershell || typeof data.commands?.posix !== 'string' || !data.commands.posix) throw new Error('The launcher did not return a complete creation result.');
      created = data; inspection = null; reviewPanel.hidden = true; success.hidden = false; successPath.textContent = data.project.path;
      successTitle.textContent = `${data.project.name} is ready for setup`;
      renderWarnings(successWarnings, data.warnings);
      commandInputs.powershell.value = data.commands.powershell; commandInputs.posix.value = data.commands.posix;
      message('Source files created. Install dependencies yourself before checking the project. Nothing has been run or published.');
      if (visible) successTitle.focus({ preventScroll: true });
    } catch (error) {
      if (alive && intent === sequence) { inspection = null; reviewPanel.hidden = true; message(`${responseError(error, 'Could not confirm creation.')} The request may have created files; check the destination before reviewing it again. No retry will happen automatically.`, true); }
    } finally { if (alive && intent === sequence) { creating = false; controls(); } }
  }
  function open() {
    if (!alive || !dialog.isConnected || launch.disabled || visible) return;
    restoreFocus = doc.activeElement; visible = true; viewSequence++;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    if (created) successTitle.focus(); else if (creating) { status.tabIndex = -1; status.focus(); } else path.focus();
  }
  function close() {
    if (!alive || !visible) return;
    visible = false; viewSequence++;
    composing = false;
    if (!creating && !created) invalidate();
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    if (restoreFocus?.isConnected) restoreFocus.focus();
  }
  listen(launch, 'click', open); listen(dismiss, 'click', close);
  listen(dialog, 'cancel', event => { event.preventDefault(); if (!composing) close(); });
  listen(form, 'submit', event => { event.preventDefault(); if (!composing) void inspect(); });
  for (const field of [path, name]) {
    listen(field, 'input', invalidate);
    listen(field, 'compositionstart', () => { composing = true; invalidate(); controls(); });
    listen(field, 'compositionend', () => { composing = false; controls(); });
    listen(field, 'keydown', event => { if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229)) event.stopPropagation(); });
  }
  listen(create, 'click', () => void createFiles());
  listen(checkCreated, 'click', async () => {
    if (!alive || !created || checkCreated.disabled) return;
    const view = viewSequence;
    handingOff = true; controls();
    try { const accepted = await Promise.resolve(onCheckProject(created.project.path)); if (alive && view === viewSequence && accepted !== false) close(); }
    catch (error) { if (alive && view === viewSequence) message(responseError(error, 'Could not check this project. Use its folder in the project chooser.'), true); }
    finally { if (alive) { handingOff = false; controls(); } }
  });
  listen(again, 'click', () => { if (!alive || creating || handingOff) return; created = null; success.hidden = true; path.value = ''; name.value = ''; commandInputs.powershell.value = ''; commandInputs.posix.value = ''; invalidate(); path.focus(); });
  listen(win, 'beforeunload', event => { if (creating) { event.preventDefault(); event.returnValue = ''; } });
  controls();
  return {
    open, close,
    setAvailability(reason = '') { if (!alive) return; unavailable = typeof reason === 'string' ? reason : ''; controls(); },
    destroy() { if (!alive) return; alive = false; sequence++; events.abort(); if (visible && typeof dialog.close === 'function') dialog.close(); entry.remove(); dialog.remove(); inspection = null; created = null; }
  };
}
