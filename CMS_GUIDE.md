# Homepage editor guide

The site uses Pages CMS as a browser-based editing layer over this GitHub repository. Content
remains in Git, and Astro continues to build a fully static site for GitHub Pages.

## First-time connection

1. Open <https://app.pagescms.org/>.
2. Sign in with the GitHub account that owns `Hydr0g3ngz/Hydr0g3ngz.github.io`.
3. Install the Pages CMS GitHub App.
4. Grant access to **only** `Hydr0g3ngz.github.io`, not every repository.
5. Open the repository. Pages CMS will automatically load `.pages.yml`.

The GitHub App can write repository content and trigger Actions. Keep its installation limited
to this repository. It can be reviewed or removed later under GitHub Settings → Applications.

## Editing the homepage

Open **Core pages → Homepage**.

- Edit text directly in its field.
- Expand a section to edit it.
- Drag sections to change their order.
- Use **Visible** to hide a section without deleting it.
- Add a section by choosing one of the designed block types.

The editor intentionally does not expose fonts, arbitrary colours, spacing, HTML, or CSS. Those
remain controlled by the site design.

## Creating a subpage

1. Open **Additional pages** and choose **New**.
2. Enter a short lowercase filename when prompted. This becomes the URL.
3. Fill in the title, search description, page heading, and navigation settings.
4. Add and arrange sections.
5. Leave **Published** off while drafting.
6. Switch **Published** on when the page is ready.

Do not use `index`, `notes`, `404`, or `_astro` as a top-level filename. The automated
validator will reject these reserved routes.

## Writing a note

Open **Notes** and create a new entry. Notes support a rich-text editor with Markdown source
available when needed. Select a category and add an optional cover image.

New notes are drafts. They do not create a public Notes page or navigation item until
**Published** is switched on. The site keeps Notes entirely hidden while there are no published
entries.

## Images

Use **Site images** or an image field to upload JPG, PNG, WebP, or AVIF files.

- Always write meaningful image description text.
- Keep files below 2 MB.
- Record creator, source, and licence information for third-party images.
- Existing image credits are also documented in `IMAGE_CREDITS.md`.

## Publishing and safety

Saving in Pages CMS creates a Git commit. A GitHub Actions run then:

1. validates structured content and reserved routes;
2. checks image descriptions, paths, and file sizes;
3. builds the Astro site;
4. verifies generated pages, internal links, and anchors;
5. deploys only if every check succeeds.

If a check fails, the previous successful GitHub Pages deployment remains online. Fix the field
reported by the workflow and save again.

## Recovery

Every edit is a Git commit. To undo a change, open the repository’s commit history, find the
last good content commit, and revert the newer commit. Core files such as Homepage, About, and
Site settings are protected from deletion in the CMS interface.
