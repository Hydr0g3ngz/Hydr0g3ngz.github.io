# Security and trust boundaries

## Intended use

Will Studio is a local tool for compatible, trusted `will-astro-v1` projects.
Its server and development preview bind to loopback (`127.0.0.1`). Do not expose
them through a public interface, reverse proxy, or tunnel. Studio is not a hosted
multi-user service, and loopback binding is not a sandbox against local software.

Only select a project whose code you trust. Its content schema, Astro configuration,
dependencies, and build scripts are executable code. A valid
`will-studio.config.json` checks compatibility and metadata; it does not make an
untrusted project safe. Merely receiving a repository or website link is not a
reason to run its code. See [the project contract](studio/PROJECT_CONTRACT.md).

## Launchpad checks and consent (0.3.0)

The independent editor defaults to a browser project chooser; a bundled website
still defaults to its own project. `--choose-project` explicitly selects the chooser.
Supplying `--project` directly selects a trusted target and bypasses the chooser's
checkbox flow; do not use it for code you have not reviewed.

**Check project** performs read-only structure and installed-dependency inspection.
It does not import the target's schema, run its Astro configuration, or install its
dependencies. A successful check is neither a safety certification nor a production
build. **Open in Studio** separately requires explicit trust and a valid inspection
ticket before the selected project's local code runs. Changed or expired checks
must be repeated. The guided launcher may install the editor's own locked
dependencies; this is distinct from installing anything in a selected website.

Recent entries never execute automatically. Their full local paths, names, timestamps,
and preferred ports are stored in the editor runtime's `.studio/projects.json`.
Treat that file as private and keep it out of commits, published assets, and public
support attachments. **Forget** removes only a shortcut, not project files, browser
drafts, or an active server.

Each Launchpad manages at most three active workspaces. Browser-tab closure is not
process shutdown. Save all editor tabs before using Ctrl+C in the Launchpad terminal;
it stops that chooser and its owned workspaces, not unrelated services. Forgetting
a shortcut does not stop the associated process or release its active slot.

## Browser data and local files

Drafts and recovered browser versions are scoped to the selected project's real
path and stored within the browser's origin. This prevents accidental reuse of
same-named page drafts across projects; it is not encryption or isolation from
scripts on the same origin, a shared browser profile, or other local users.
Changing project paths, browser profiles, or ports does not transfer drafts.
Launchpad tries to reuse recorded port pairs when free to preserve an existing
origin, but a conflict may require a different address. Even `localhost` and
`127.0.0.1` are different origins. Port reuse is a convenience, not a security
boundary or a guarantee that an old browser draft will be available everywhere.

Save important work to disk and keep an independent backup. Revision checks,
history, and recoverable trash reduce accidental loss, but they do not replace
external backups. Content exports and project snapshots omit media files: back up
`public/images` and other assets used by the website separately. Avoid publishing
`.studio` recovery data or browser-storage dumps, which may contain private drafts.

Saving locally and running a build do not publish the website. Review content and
repository changes before performing a separate commit, push, or deployment.

## Reporting a concern

For a report, include the Studio version or commit, operating system, affected
workflow, and a minimal reproduction using synthetic content. Remove access tokens,
passwords, cookies, private URLs, personal content, and unnecessary local paths from
logs, screenshots, configuration, and exported files.

Use a private security-reporting option on the repository if one is available.
Otherwise, ask for a suitable reporting channel without posting sensitive details
or private project data in a public issue. No response timetable or confidential
contact address is established by this document.
