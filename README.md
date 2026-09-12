# Will Homepage

A minimal personal homepage that is intentionally **not** a CV-first academic site.

Live site: <https://hydr0g3ngz.github.io>

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL Astro prints in the terminal.

## Local visual workspace

Double-click **Start Studio.cmd** on Windows, or run `npm run studio -- --open`
(Node.js 24+). The local Studio previews the actual site while you edit, supports
sections and nested pages, and includes media, history, project checks, snapshots,
and export. See [STUDIO_GUIDE.md](./STUDIO_GUIDE.md) for the workflow and recovery.
The ongoing product roadmap is recorded in [DEVELOPMENT.md](./DEVELOPMENT.md).

## Edit content in the browser

Content is managed with [Pages CMS](https://app.pagescms.org/) and stored in this repository.
The editor configuration lives in `.pages.yml`; validated content lives in `src/content/`.

See [CMS_GUIDE.md](./CMS_GUIDE.md) for setup, editing, publishing, image, and recovery
instructions.

## Deploy to GitHub Pages

Push to the `main` branch of `Hydr0g3ngz/Hydr0g3ngz.github.io`. The included
GitHub Actions workflow builds the Astro site and publishes it to GitHub Pages.
Every deployment validates content, internal links, page anchors, image paths, and image sizes.
