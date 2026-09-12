# Continuing the website and Studio

The active goal is the user's full request: keep improving the personal website with
engaging music, reading, quotations, and richer presentation; build a comprehensive,
extremely convenient local visual website tool whose scope extends beyond editing.
This is an ongoing goal, not satisfied by delivering a compatible CMS or one release.

## Product principles

- English public copy; Will Qing / Yunshu Qing; SJTU Information Engineering.
- Reading, music, and film come first. Sports remain secondary; research stays modest.
- Personal reflections are authored by Will. Editorial suggestions are not presented
  as invented experiences or opinions. Attribute excerpts and recordings accurately.
- Preserve the high-quality static publication while improving the local workflow.
- Judge improvements by real browser use, working persistence/recovery, and deploys.

## First Studio release, September 2026

Implemented: local server and one-click Windows launcher; real-page draft previews;
inline simple-text editing; recursive schema-based inspector; blocks and nested
collections; ordering/duplication/removal; page/note creation; media uploads; undo/redo;
browser draft recovery; atomic revision-checked saves; per-file history/restore;
project health, Git status, snapshots, content export, and full build checks.

Public content: dedicated Reading and Listening pages, four book introductions,
three sourced Song ci excerpts, official artist recordings, and three functioning
locally synthesized sound studies. Reflection fields remain available for Will.

## Current content direction (latest user revision)

The initial audio direction above was superseded by Will's explicit choices.
Remove synthetic demos and the unreleased sequencer, do not reintroduce them.
The reading room now has four complete chosen Song ci works, not fragments.
The listening room has five chosen songs with YouTube/NetEase links, not embedded
players. Homepage card links replace duplicate room entrances. Films and artists
follow Will's supplied list; personal reasons remain unwritten until supplied.

## Remaining work toward the full goal

1. Complete publishing workflow: reviewed changes, validation jobs, commit/push,
   deployment progress, and rollback. Preserve explicit draft vs publication state.
2. Page operations: reusable templates, search across content/media, bulk operations,
   file-history continuity after moves, and a command palette. Move/duplicate/trash
   with reviewed link maintenance now have a dedicated local transaction API.
3. Rich writing: side-by-side source, document-level find/replace, table editing and
   richer embeds. The Markdown-backed visual writer now has an independent mount
   API, expanded writing space, clean paste, and source-preservation safeguards.
4. Design tools: controlled typography/colour/spacing variants, accessible themes,
   preview comparison, and reusable component templates without breaking layouts.
5. Media: metadata, alt-text coverage, image optimisation, and convenient source/link
   maintenance. Any future audio feature or playlist addition must follow Will's
   explicit selection, not invent a listening profile or add synthetic experiments.
6. Whole-project management: portable asset-inclusive bundles, previewable import,
   snapshot comparison and full restore, a publish queue, and useful diagnostics.
7. Continue actual content curation and visual refinement with verified sources.
8. Expand real-user acceptance testing: long sessions, multi-tab conflicts, offline
   recovery, cold start, international text, accessibility and touch interaction.
9. Product direction explicitly requested by the user: a standalone Will Studio,
   usable beyond this homepage. Separate the editor shell from project adapters;
   define a versioned project contract, configurable branding/deployment providers,
   onboarding, distributable packaging, upgrade/migration and diagnostics. Extract
   proven workflows incrementally rather than claiming universal compatibility.

Do not mark the full active goal complete based only on green checks for this first
release. Validate newly added workflows against their actual intended behaviour.
