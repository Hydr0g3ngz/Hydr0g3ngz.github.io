/** Page management stays local; each operation is reviewed and revision checked. */
export function createLifecycle({ api, node, button, openModal, closeModal, toast, currentDoc, dirtyIds, orphanIds = () => [], archiveOrphans, beforeApply, onApplied }) {
  const labels = { move: 'Move / change address', duplicate: 'Duplicate as a draft', delete: 'Move to trash', restore: 'Restore from trash' };

  async function review(payload) {
    const content = node('div', {}, node('p', { class: 'notice', text: 'Checking addresses, references and saved versions…' }));
    openModal('Review page changes', content);
    try {
      const plan = await api('/api/lifecycle/plan', 'POST', payload);
      content.replaceChildren(node('p', { class: 'modal-intro', text: plan.summary || labels[payload.operation] }));
      const changes = node('ul', { class: 'lifecycle-changes' });
      for (const change of plan.changes || []) changes.append(node('li', {}, [node('strong', { text: `${change.action} · ${change.id}` }), node('small', { text: change.detail || '' })]));
      content.append(changes);
      if (plan.references?.length) {
        const refs = node('details', { class: 'lifecycle-references' }, node('summary', { text: `${plan.references.length} linked reference(s)` }));
        for (const ref of plan.references) refs.append(node('p', {}, [node('strong', { text: ref.id }), node('small', { text: `${Array.isArray(ref.path) ? ref.path.join('.') : ref.path || ''} → ${ref.href}${ref.public ? ' · public' : ''}` })]));
        content.append(refs);
      }
      const affected = [...new Set([payload.id, ...(plan.changes || []).map(c => c.id)].filter(Boolean))];
      const orphans = orphanIds(affected, { plan, payload });
      const unsaved = [...new Set([...dirtyIds(affected), ...orphans])];
      const ordinaryDrafts = unsaved.filter(id => !orphans.includes(id));
      const blocked = plan.blocked || unsaved.length > 0;
      if (plan.blocked) content.append(node('p', { class: 'notice error', text: typeof plan.blocked === 'string' ? plan.blocked : 'This change is blocked. Resolve the listed references first.' }));
      if (ordinaryDrafts.length) content.append(node('p', { class: 'notice error', text: `Save or review these browser drafts first: ${ordinaryDrafts.join(', ')}. Nothing has changed on disk.` }));
      if (orphans.length) {
        content.append(node('p', { class: 'notice error', text: `Browser drafts still exist for pages absent on disk: ${orphans.join(', ')}. Keep these words in their original page’s History before continuing. After restoring or recreating the page, open History to recover them; this does not overwrite the restored file.` }));
        if (archiveOrphans) {
          const keep = button('Keep browser draft in History and review again', async () => {
            keep.disabled = true;
            try {
              const result = await archiveOrphans(orphans, { plan, payload });
              toast(result?.preservedIds?.length ? 'The captured draft is in History. Newer browser edits were left untouched; review them again.' : 'Browser drafts are now in their original page’s History. They remain recoverable after restore.');
              await review(payload);
            } catch (error) {
              content.append(node('p', { class: 'notice error', text: error.message }));
              keep.disabled = false;
            }
          }, { class: 'quiet-button' });
          content.append(keep);
        }
      }
      content.append(node('p', { class: 'field-help', text: 'This affects saved local files only. Your live website changes after a separate deployment. Plans expire after 10 minutes; any intervening file change requires a new review.' }));
      const apply = button(payload.operation === 'delete' ? 'Move to trash' : 'Apply local changes', async () => {
        if (dirtyIds(affected).length) { toast('A related browser draft has changed. Save it and review this operation again.', true); return; }
        const inspection = beforeApply?.({ affected, plan, payload });
        if (inspection?.dirtyIds?.length) { toast('Another browser draft changed. Review it before applying this operation.', true); return; }
        apply.disabled = true; apply.textContent = 'Applying safely…';
        const dialog = content.closest('dialog');
        const preventCancel = event => event.preventDefault();
        const controls = [...(dialog?.querySelectorAll('button') ?? [])].map(control => ({ control, disabled: control.disabled }));
        controls.forEach(({ control }) => { control.disabled = true; });
        dialog?.addEventListener('cancel', preventCancel);
        dialog?.setAttribute('aria-busy', 'true');
        try {
          const result = await api('/api/lifecycle/apply', 'POST', { planId: plan.planId });
          const recovery = await onApplied(result, payload, inspection);
          closeModal(); toast(`${payload.operation === 'delete' ? 'Page moved to local trash. It can be restored.' : 'Local page changes applied. The live site has not changed.'}${recovery ? ` ${recovery}` : ''}`);
        } catch (error) {
          content.append(node('p', { class: 'notice error', text: error.message }));
          apply.textContent = 'Review again before retrying';
        } finally {
          controls.forEach(({ control, disabled }) => { control.disabled = disabled; });
          dialog?.removeEventListener('cancel', preventCancel);
          dialog?.removeAttribute('aria-busy');
        }
      }, { class: payload.operation === 'delete' ? 'danger-button' : 'primary-button', disabled: Boolean(blocked) });
      content.append(node('div', { class: 'modal-actions' }, [button('Cancel', closeModal, { class: 'quiet-button' }), apply]));
    } catch (error) { content.replaceChildren(node('p', { class: 'notice error', text: error.message }), button('Close', closeModal, { class: 'quiet-button' })); }
  }

  function configure(operation, doc) {
    if (operation === 'delete') { review({ operation, id: doc.id, revision: doc.revision }); return; }
    const form = node('form');
    const existingSlug = doc.route?.replace(/^\/notes\//, doc.kind === 'note' ? '' : '/notes/').replace(/^\/+|\/+$/g, '') || doc.id.replace(/^(pages|notes)\//, '').replace(/\.(json|md|mdx)$/, '');
    const title = node('input', { name: 'title', required: '', value: operation === 'duplicate' ? `${doc.name || doc.data.title} — copy` : doc.data.title || doc.name });
    const slug = node('input', { name: 'slug', required: '', pattern: '[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*', value: operation === 'duplicate' ? `${existingSlug}-copy` : existingSlug, placeholder: 'reading/a-small-discovery' });
    const route = node('p', { class: 'notice' });
    const routeText = () => route.textContent = `New address: /${doc.kind === 'note' ? 'notes/' : ''}${slug.value || 'your-page'}`;
    slug.addEventListener('input', routeText); routeText();
    form.append(node('p', { class: 'modal-intro', text: operation === 'move' ? 'Move this page into a folder or change its address. Related internal links are updated; a published old address gets a static redirect. Other pages in the same folder do not move.' : 'Make an independent copy. It starts unpublished and stays out of navigation.' }));
    for (const [label, control] of [['Page title', title], ['Address / slug', slug]]) form.append(node('div', { class: 'field' }, node('label', { text: label }, control)));
    form.append(route, node('div', { class: 'modal-actions' }, [button('Cancel', closeModal, { class: 'quiet-button' }), node('button', { type: 'submit', class: 'primary-button', text: 'Review changes' })]));
    form.addEventListener('submit', event => { event.preventDefault(); review({ operation, id: doc.id, revision: doc.revision, slug: slug.value.trim(), title: title.value.trim() }); });
    openModal(labels[operation], form);
  }

  function showActions() {
    const doc = currentDoc(); if (!doc) return;
    const protectedPage = !['page', 'note'].includes(doc.kind) || doc.id === 'pages/about.json';
    const content = node('div', {}, [node('p', { class: 'modal-intro', text: `${doc.name || doc.id} · ${doc.route || '/'}` }), node('p', { class: 'notice', text: 'To change only the displayed title, edit Page details and save locally. Address changes and deletion are reviewed here before touching saved files.' })]);
    if (protectedPage) content.append(node('p', { text: 'This is a core page. Its address is protected to keep the site structure stable.' }));
    const actions = node('div', { class: 'lifecycle-action-list' });
    for (const operation of ['move', 'duplicate', 'delete']) actions.append(button(labels[operation], () => configure(operation, doc), { class: 'quiet-button', disabled: !['page', 'note'].includes(doc.kind) || (protectedPage && operation !== 'duplicate') }));
    content.append(actions); openModal('Page actions', content);
  }

  async function showTrash() {
    const content = node('div', {}, node('p', { text: 'Reading local trash…' })); openModal('Recently removed', content);
    try {
      const result = await api('/api/trash'); const entries = result.trash || result;
      content.replaceChildren(node('p', { class: 'modal-intro', text: 'Removed pages stay on this computer until you restore them. Restore never overwrites an existing page.' }));
      if (!entries.length) content.append(node('p', { class: 'empty', text: 'Nothing here. Your pages are all on the shelf.' }));
      for (const entry of entries) content.append(node('div', { class: 'history-entry' }, [node('div', {}, [node('strong', { text: entry.name || entry.id }), node('small', { text: `${entry.route || entry.id} · ${new Date(entry.deletedAt).toLocaleString()}` })]), button('Review restore', () => review({ operation: 'restore', trashId: entry.trashId }), { class: 'quiet-button' })]));
    } catch (error) { content.replaceChildren(node('p', { class: 'notice error', text: error.message })); }
  }
  return { showActions, showTrash };
}
