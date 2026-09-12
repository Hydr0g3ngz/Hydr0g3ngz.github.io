import assert from 'node:assert/strict';
import test from 'node:test';
import { renderNoteMarkdown } from '../src/lib/markdown.ts';

test('preview and published notes preserve ordinary Markdown structure', async () => {
  const html = await renderNoteMarkdown('## A small note\n\nA **clear** thought.\n\n- One\n- Two\n\n[Reading](/reading)');
  assert.match(html, /<h2>A small note<\/h2>/);
  assert.match(html, /<strong>clear<\/strong>/);
  assert.match(html, /<li>Two<\/li>/);
  assert.match(html, /href="\/reading"/);
});

test('notes cannot inject scripts, event handlers, unsafe URLs, or editor frames', async () => {
  const html = await renderNoteMarkdown('<script>fetch("/api/state")</script>\n\n<img src="/images/books-library.jpg" alt="Books" onerror="alert(1)">\n\n<a href="javascript:alert(1)">Click</a>\n\n<iframe src="/api/state"></iframe>');
  assert.doesNotMatch(html, /<script|onerror|javascript:|<iframe|fetch\(/);
  assert.match(html, /src="\/images\/books-library.jpg"/);
  assert.match(html, /alt="Books"/);
});
