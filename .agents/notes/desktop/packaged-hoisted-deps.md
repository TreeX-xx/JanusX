---
{
  "schema": "harness-note/2",
  "id": "39f58575-dba9-584f-a285-a33a2c73cdc4",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-20",
  "class": "bug-fix",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-20-agent-note-packaged-node-modules-is-copied-verbatim-not-re-derived--39f58575.md",
      "sourceHash": "34979c850a4957f0f1008409baeb3503d482df771689efbc21e93a6b9d2385ee",
      "originalBodyHash": "a1ad61bf0d817d4c8d2cf532836d55b3bc508dbbd3f5d7b47548a9dd1e893fca",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Packaged node_modules is copied verbatim, not re-derived. No age-based archival.",
      "edits": [
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/bug-fix/2026-09-20-packaged-hoisted-deps.md",
        "sourceHash": "cbde457fea7e3b8c5500103b7f08bda2334f0b65b1b2b5c184a6c7d23c9dc670",
        "originalBodyHash": "d4969e9f9f5057f66303e7a26dac176f80da0d9d824e8e13f1deeb8e89c97613"
      }
    }
  },
  "updated": "2026-10-27T16:06:18Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---
# Packaged node_modules: verbatim copy and production closure

## Problem
The 0.8.7 portable and setup builds start and immediately exit: no window, no error dialog, no log. The packaged main process rejects during `bootstrapApp` with `ERR_MODULE_NOT_FOUND` for `micromark-util-subtokenize` (imported by `micromark-core-commonmark`) and `unist-util-visit-parents` (imported by `mdast-util-find-and-replace`), and `src/main/index.ts` turns that rejection into `process.exit(1)` before Electron is ready. Nothing is written anywhere because `electron-log` is itself reached through the broken chain (`src/main/updater/service.ts` is one of the bootstrap dynamic imports), so the failure is invisible from the user's side.

The packages are not missing from the install: `package-lock.json` hoists both to the project root and they exist there on disk. They are missing from `app.asar`'s `node_modules` root. electron-builder does not copy `node_modules` verbatim; it re-derives the tree with `node-dep-tree --flatten` (`app-builder-lib`'s `computeNodeModuleFileSets`) and writes anything that tool calls a conflict one level down, under whichever parent it picked. Measured on the shipped 0.8.7 archive, 35 packages end up nested-only. Two of them sit on the startup path, so startup dies; the rest (`semver`, `fs-extra`, `chalk`, `negotiator`, `iconv-lite`, `lru-cache`, `ajv`, `side-channel-list/map/weakmap`, `socks-proxy-agent`, `http-proxy-agent`, `node-addon-api`, `mdast-util-gfm-*`, `micromark-extension-gfm-*`) would have failed later at runtime, and the same missing set breaks the renderer's `react-markdown` chain, which is also resolved from inside the archive.

Local verification never saw this. `scripts/check-packaged-runtime.mjs` launched `win-unpacked/JanusX.exe` from inside the repository, where Node's ESM resolver walks out of the archive and finds the missing packages in the repo's own `node_modules`; and its `--smoke-test=llm-runtime` mode only imports `./llm/ai-runtime` and `./llm/LlmService`, so it never touched the markdown chain either. Both were confirmed by running the same binary from a neutral directory.

### Packaged node_modules carries the production closure only
The portable installer of 0.8.7 ships 301 MiB because app.asar carries the entire installed node_modules. The archive holds 870 MiB of file payload, and 612 MiB of that belongs to packages the production dependency closure never reaches: `electron`'s own dist (284 MiB, including the 192 MiB electron.exe that electron-builder also places beside the app), every platform binary of `app-builder-bin` (207 MiB), `typescript` (19 MiB) and the test and build toolchain. smart unpacking writes the same 490 MiB a second time into app.asar.unpacked, because it flags every .exe and .dll inside those trees as unpacked, so the packaged build holds 1.3 GiB on disk for an app whose own code is 39 MiB. node_modules reaches the archive verbatim so that hoisted dependencies stay resolvable from the archive root, and the note that introduced that copy records the size as a follow-up for a resolution audit: Packaged node_modules is copied verbatim, not re-derived.


## Decision
`node_modules` is now copied exactly as npm installed it. `electron-builder.yml` sets `beforeBuild: ./scripts/electron-before-pack.cjs`, whose `false` return tells electron-builder that dependencies are prepared outside of it, which switches off `computeNodeModuleFileSets` entirely; `includeSubNodeModules: true` plus a `**/*` `files` pattern then copy the installed tree through the normal file walk. Nothing is re-derived, so no hoisted package can be nested away from the archive root, and the fix covers main, preload and renderer in one move.

`files` excludes only what provably cannot reach a packaged runtime: repository sources, caches and build outputs, and `packages` plus `node_modules/monaco-editor`, both of which are bundled into `out` (`electron.vite.config.ts` lists `@janusx/llm-core` under `externalizeDepsPlugin({ exclude })`, and Monaco ships as per-language renderer assets).

Detection replaced false-pass checking. `scripts/check-packaged-runtime.mjs` copies `win-unpacked` into a temp directory outside the repository before launching, so no path above the archive can stand in for a missing package, asserts that every declared runtime dependency is present at the archive root, and runs two smoke modes: `llm-runtime` for the AI runtime and the new `--smoke-test=module-graph`, which imports exactly what `bootstrapApp` imports plus the three lazy `createWindow` imports and then exits. `src/main/index.ts` exposes that graph through a shared `importBootstrapModules` so the smoke cannot drift from real startup. `release-win.yml` packs with `--publish never`. `scripts/publish-win.mjs` verifies the neutral-directory unpacked and portable runtime plus the setup hash and size recorded by the update manifest before creating a GitHub draft. The `stage:win` entry uploads the existing setup, blockmap, portable and channel manifest with GitHub CLI and leaves the release in draft. Repeated staging skips identical remote bytes and uploads missing files, rejecting conflicting assets. Local `package:win:stage` builds and stages; `publish:win` separately compares the four remote assets with the retained local candidate and publishes without rebuilding or launching the application.

### Packaged node_modules carries the production closure only
Local Codex scratch directories `.codex-cache`, `.codex-session`, `.codex-sessions` and `.codex-tmp` are excluded alongside the existing local tool directories. A stale checkout under `.codex-tmp/prepush-*` otherwise contributes its dependencies to the packaged archive. Release candidates are packaged from an isolated committed checkout so untracked screenshots, discussions and local drafts are not distribution inputs.

`files` in `electron-builder.yml` negates every top-level package that the production dependency closure does not reach, plus `node_modules/electron`, `node_modules/typescript` and `**/*.map`. The closure is `npm ls --omit=dev --all`: it reports 501 root-level names against 936 installed at the root, and the 436 installed names outside it are negated as 416 patterns, with a scope collapsed into one directory only when every member of that scope is dev-only. `scripts/sync-packaging-exclusions.mjs` rewrites that block between markers in `electron-builder.yml`. `package:prepare` and the release workflow run it before electron-builder, so both Windows targets use the closure of the tree they pack, and `npm run exclusions:check` fails `verify` when the committed block is stale. `package:win:portable` retains the preparation, size and runtime gates while building only portable for local iteration. Its builder subprocess uses ELECTRON_BUILDER_COMPRESSION_LEVEL=1; this setting is not applied to release builds. The installed electron-builder shares an application archive between nsis and portable through AppPackageHelper. Its default standalone portable archive uses solid compression, while the nsis-led shared archive uses a 1 MiB dictionary and non-solid compression; dropping nsis alone can therefore slow packaging down.

`scripts/check-packaged-runtime.mjs` asserts both directions against the same closure: every root-installed package in the closure must be present in the archive, and no package outside the closure may be present. The three closure-reported names that stay excluded are listed there with their reason — `electron` resolves to the built-in Electron module, `typescript` is declared by the MCP and Lark SDKs but required by neither at runtime, and `monaco-editor` ships as renderer assets. The script also enforces budgets on the asar payload (260 MiB), app.asar.unpacked (64 MiB) and the portable installer (200 MiB), each measured above the shipped shape with headroom for dependency growth.

The exclusions keep the verbatim layout. They remove whole package directories instead of asking electron-builder to re-derive the tree, so hoisted packages stay where npm installed them and the archive root keeps every name a consumer resolves.



## Alternatives considered
- Repair the archive after packaging by hoisting nested-only packages — closest to the original layout and the smallest diff, but `@electron/asar` cannot reproduce electron-builder's asar writer: electron-builder marks unpacked paths through its own smartUnpack detection, so a re-pack from `asarUnpack` globs alone silently repacked `node_modules/node-pty/LICENSE` into the archive and would have broken the native module.
- Overlay only the affected packages through `files` object-form entries — keeps the archive within a few megabytes of the old one, but the affected set cannot be predicted: a lockfile rule of "required by more than one declared dependency" missed 29 of the 35 nested-only packages, and the only exact source is the archive electron-builder already wrote, which forces a two-pass build.
- Ship a flat `node_modules` beside the archive under `resources/` — resolution does reach it, but the overlay must be self-contained, so it costs the whole tree again instead of the 1.5 MB that verbatim selection adds.
- Keep the dep tree and add the missing packages to `dependencies` — two lines today, but the affected set moves with every dependency change and the failure stays silent until something is added.

### Packaged node_modules carries the production closure only
Re-deriving the tree with electron-builder's own dependency pass, by dropping the `beforeBuild` hook, produces an exact production selection for free. That pass writes a package it calls a conflict one level down, which is what removed hoisted packages from the archive root and killed packaged startup; the verbatim copy is the fix that keeps them resolvable. Pruning node_modules inside `beforePack` mutates the working tree that dev and verify run against, and a staging copy would have to carry `out/`, `packages/` and `package.json` as well, making the packaged build depend on a second tree that can drift from the first. Keeping a hand-maintained exclusion list without the closure generator is fragile in the other direction: the list is 416 entries, it drifts with every dependency change, and nothing notices until an installer grows back to 300 MiB. Excluding only the largest trees leaves most of the weight in place, since the 436 dev-only packages total 741 MiB on disk and the largest 45 of them account for under half.


## Consequences
- **Gains**: the packaged app launches from a directory outside the repository; 35 nested-only packages, including runtime-required `semver`, `fs-extra` and the markdown chain, resolve from the archive root; `check:packaged-runtime` fails loudly instead of passing on a build whose artifacts are broken. Verification: `npm run typecheck`, `npm run build`, `npm run check:notes`, `npm run package:win` (which ends in `check:portable-runtime`) and a neutral-directory launch of both the unpacked and portable builds.
- **Costs and limits**: `app.asar` grows because npm's hoisted tree is larger than electron-builder's pruned selection, so both installers grow with it; `package:win` and the release workflow now spend a launch on verification; the smoke covers the main-process module graph, so a renderer-only unresolvable import still needs the archive-root assertion or a renderer check to catch. Revisit the size by excluding build-toolchain packages once a resolution audit can prove each exclusion is safe.

### Packaged node_modules carries the production closure only
Local iteration trades archive size for compression time without changing release defaults. In the Windows comparison, the builder stage takes 81.6s for the default dual target, 181.3s for standalone portable at its defaults, and 60.1s for portable at level 1. The fast portable is 162.2 MiB against the dual target's 130.5 MiB and remains below the 200 MiB gate. These are single-run builder timings, excluding build, npm and runtime checks. Keep the fast profile local; revisit it if the size budget fails or repeated measurements no longer show useful savings.

The asar payload falls from 870 MiB to 169 MiB, app.asar.unpacked from 539 MiB to 11 MiB (only node-pty and quickjs-wasi remain unpacked), the portable installer from 301 MiB to 130 MiB, and the archive from 32,015 entries to 14,838. Verified by `npm run package:win`, which ends in `npm run check:portable-runtime`: that check copies win-unpacked into a temp directory outside the repository and runs both smoke modes against it, so a package the app needs but the closure excludes fails at launch rather than shipping.

The portable branch of that check had been reporting success without launching anything. The installer's stub extracts the payload, starts the app detached and exits 0 on its own, so the exit code and the output the check collected belonged to the stub and not to the app; a payload that died during bootstrap passed. The check now verifies the two halves separately: it extracts the payload with 7za and runs both smoke modes against the extracted JanusX.exe, then launches the installer itself and requires a new app process to appear, finish its smoke and leave the stub exiting 0. Nothing is killed — the smoke makes the app exit on its own, and only process ids that appear during the window are watched.

`electron-builder.yml` now carries 416 generated negations. They are refreshed by one command and no longer diverge in CI, but a reviewer reading the file sees a machine-maintained block rather than a hand-picked list. Each packaged-runtime check spends one `npm ls` (about 20s), one 7za extraction of the portable payload (about 15s and 600 MiB of temp disk) and six app launches. A package that the app uses while declaring it only as a devDependency now fails the launch gate instead of shipping silently, which is the intended direction but turns a latent bug into a failed build.

`typescript` is excluded on an audit of its two declared consumers that found no runtime require. A future release of the MCP or Lark SDK that requires it fails the neutral-directory launch instead of shipping a missing module, and the fix is to drop its negation. The assembly is still the majority of the installer: the Electron runtime, its 55 locales and the bundled OfficeCLI hold 285 MiB of the 514 MiB that reaches the portable target, so further reduction needs a locale whitelist or a lighter editor bundle, neither of which this change attempts. `external-mcp.ts` resolves the knowledge MCP entry from app.asar.unpacked in a packaged build while `asarUnpack` names only node-pty, so that entry stays inside the archive; the gap predates this change and a caller verifies existence before reporting it.
