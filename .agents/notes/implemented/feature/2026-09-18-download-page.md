# Agent Note: JanusX download page

Status: implemented

## Problem

Visitors need to choose a Windows package, understand installation and see the current application before downloading. The previous captures emphasize the retired four-terminal/tool layout and do not explain the terminal/conversation workflow.

## Decision

The static gh-pages site introduces JanusX as one workspace for terminals and conversations. The first screen provides an immediate Windows installer action, followed by an expanding brand visual, package selection, three setup steps, product captures and support links. Setup is explained as installing the application, opening a local project and connecting an installed CLI. Supported CLI sessions can switch between Terminal and Conversation; interactions depend on the CLI. AI CLIs require their own installation and login or model configuration. Blueprint is explicitly described as an installed and enabled plugin.

The established design remains a neutral light canvas with restrained red accents, self-hosted Urbanist and system CJK faces. The opening uses original local artwork in `assets/intro-atmosphere.svg`. Gel pill controls, clay surfaces and one-time entrance reveals provide consistent styling. Product captures use text/image rows on desktop and stack below 855px. Every image has alternative text, actual dimensions and a full-size image link; feature images load lazily.

The introduction and dark brand panel share 24px gutters and 28px corners, becoming 10px and 22px on mobile. The desktop particle capsule expands into the workspace through a reversible sticky scroll stage. CSS and `hero.js` share the compact breakpoint `(max-width: 855px), (max-height: 768px)`. Small screens, short windows and reduced-motion visitors get a static layout. Canvas drawing sleeps between idle gestures and pauses outside the viewport. Without JavaScript the capsule fallback and workspace image remain visible, while view controls stay hidden. Mobile keeps the installer action in the first viewport.

Four hero controls select the workspace overview, conversation, native terminal or right file panel. Selection updates the image, intrinsic dimensions, alternative text, caption, pressed state and original-image links after decoding succeeds. A failed load preserves the previous view, and the latest requested selection wins. Six product rows show conversation mode, the same Codex session in its native terminal, split conversations, the right file panel, session history and Blueprint with Janus chat.

Release lookup selects explicitly named JanusX Windows x64 assets and validates their GitHub download origin. Installer and portable cards show release size and date. The first-screen installer action shares the package section's URL and fallback state. A 404 means no public stable release; network errors, timeouts and rate limits show unavailable metadata. Missing packages and disabled JavaScript leave release-history links usable. The site advertises Windows downloads only.

## Asset maintenance

The seven current PNGs in `assets/workspace/` come from the sibling application's reviewed November 10–12, 2026 Electron captures, documented in its `.agents/notes/desktop/readme-showcase.md`. They use the isolated Atlas demonstration project and local scripted conversation responses. These are existing captures, not a fresh capture of current HEAD or a claim about a specific public release. The source dual-view manifest records an unchanged thread; the session-panel recording uses demonstration session data. The overview retains its existing composed surround; the other images are original screenshot bytes.

Run `node scripts/import-current-ui.mjs` from this checkout, optionally setting `JANUSX_APP_ROOT`, to copy the selected source PNGs without pixel edits. The script requires the recorded manifests and original frame directories, checks the relevant evidence, reads all source images before writing, and records source paths, SHA-256 hashes and dimensions in `assets/workspace/current-ui.json`. If recording archives are absent, recreate them in the application checkout rather than silently substituting old images. Published assets are branch-local and do not depend on remote app-branch URLs.

After checking references, the obsolete top-level feature GIF/PNG pairs, unused hero artwork, seven earlier workspace captures, two provenance manifests and four-terminal capture script were removed: 23 files totaling 4,180,374 bytes. Keep only assets used by the page or other maintained content. Git history preserves prior assets and their recording evidence.

## Alternatives and consequences

Keeping the previous screenshots would contradict the conversation workflow. A framework or autoplay GIFs would add tooling and motion without helping package selection, so the page retains static PNG previews and its existing layout. Imported captures depend on local recording archives for regeneration; published PNGs and their hashes are self-contained. Refresh them when the application's visible workflow changes.

## Verification

On 2026-11-14 Main ran `node tests/download.test.cjs` and `node tests/hero.test.cjs`, with `JANUSX_PLAYWRIGHT` pointing to the sibling app's Playwright installation. The download suite passed ten scenarios covering release success and failure, architecture exclusion, no JavaScript, reduced motion, current image hashes and dimensions, original-image links and five viewport bounds. The hero suite passed nine checks covering the first-screen action, particle settling and idle behavior, pointer response, scroll expansion/reversal, all four previews, failed-image preservation, three compact sizes, reduced motion and no-JavaScript fallback. Both reported no page errors. Main visually inspected the expanded desktop workspace and mobile controls. Preview captures are outside the site at `%TEMP%/janusx-install-current-ui`. These are local checks.
