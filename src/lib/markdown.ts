import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/** Shared by the public note and the local preview, including safe HTML handling. */
export async function renderNoteMarkdown(body: string) {
  return sanitizeHtml(await marked.parse(body), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ['src', 'alt', 'title'], '*': ['id'] },
    allowedSchemes: ['https'],
    allowProtocolRelative: false
  });
}
