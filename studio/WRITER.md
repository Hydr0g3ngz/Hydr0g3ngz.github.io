# Local visual writer

The writing surface uses Tiptap and ProseMirror, bundled locally with esbuild. It does not load editor scripts from a CDN, make cloud editor requests, or add an editor bundle to the public website.

Run `npm run build:studio` to create `studio/web/generated/writer.js` and `writer.css`. Studio also builds them on startup. The generated directory is ignored by Git; install dependencies with `npm ci` after cloning.

```js
const { mountWriter } = await import('/generated/writer.js');
const writer = mountWriter({
  container: document.querySelector('#note-body'),
  value: note.body,
  label: 'Note body',
  onChange(markdown) { note.body = markdown; },
  async onChooseImage() {
    // Return null on cancellation. Selection is separate from inserting the image.
    return { src: '/images/my-photo.jpg', alt: 'Describe the photo', title: '' };
  }
});

writer.setValue(markdown); // External replacement; does not fire onChange.
writer.getValue();         // The current Markdown source, not rendered HTML.
writer.focus();
writer.expand();           // Opens the existing surface without losing selection/history.
writer.destroy();          // Call before replacing the parent DOM or changing documents.
```

Load `/generated/writer.css` in the Studio document. `mountWriter` is synchronous once its module is loaded. `onChange` is called for each actual content change; the caller owns debounced preview and persistence. It is not called when mounting, receiving `setValue`, or switching modes. `onChooseImage` is optional; the built-in image form always supports a direct address and alt text. The optional `resolveImage(src)` adapts preview URLs; by default only local `/images/` and `/uploads/` addresses are prefixed with `/preview`, while saved Markdown keeps its original address.

Visual mode supports headings 1–6, bold, italic, strikethrough, links with titles, nested bulleted and numbered lists, blockquotes, inline/fenced code, line breaks, horizontal rules, and inline/standalone images with alt text and titles. Toolbar controls, Markdown input shortcuts and ProseMirror history work together. Ctrl/Command+K opens the link form. Ctrl/Command+Z belongs to the writing surface; it does not undo unrelated page edits. Expanded mode keeps the same editor instance, traps keyboard focus, returns on Escape and restores document scrolling.

The exact source string is retained until an edit occurs; merely opening a note does not normalize Markdown. A visual edit writes standard Markdown, which may normalize markers and spacing but preserves supported document semantics. The public note renderer remains the site's existing `marked` + `sanitize-html` pipeline.

Tiptap's Markdown bridge is currently marked beta by its maintainers. The regression suite checks real parse/serialize cycles, nested lists, escaped image alt text and titles, code containing fences, paste sanitization, untouched source preservation, mode switching, media selection, expansion cleanup and IME replacement. Custom adapters fix known serialization/schema mismatches rather than relying on output-string tests alone.

Tables, task checklists and embedded raw HTML currently stay in Markdown mode with an explanation, so changing modes cannot silently discard them. Removing those structures makes visual mode available again. Unsafe link/image protocols also stay as inert source; rich paste is sanitized with DOMPurify and the editor schema. Further rich structures should be enabled only when their roundtrip behavior is covered.

Run `npm run test:writer` for focused checks. Source references: [Tiptap Markdown](https://tiptap.dev/docs/editor/markdown), [StarterKit](https://tiptap.dev/docs/editor/extensions/functionality/starterkit), [Image](https://tiptap.dev/docs/editor/extensions/nodes/image).
