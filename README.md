<p align="center">
  <a href="https://github.com/TreeX-xx/JanusX" title="Like JanusX? Star the repo to support the project">
    <img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/janus-header.svg" alt="JanusX header artwork" width="620" />
  </a>
  &nbsp;
  <img src="resources/icon.png" alt="JanusX app icon" width="148" />
</p>

<div align="center">

<p align="center">
  <a href="./README.zh-CN.md">中文</a> · <strong>English</strong>
</p>

# JanusX

### A desktop workspace for projects, terminals, and AI coding agents

Switch projects, split terminals, and keep Blueprint, sessions, and everyday tools in one place.

[![Release](https://img.shields.io/github/v/release/TreeX-xx/JanusX?include_prereleases=&style=flat-square&color=D43D2A)](https://github.com/TreeX-xx/JanusX/releases)
[![Windows x64](https://img.shields.io/badge/Windows-x64-1C343B?style=flat-square)](https://treex-xx.github.io/JanusX/)
[![Downloads](https://img.shields.io/github/downloads/TreeX-xx/JanusX/total?style=flat-square&color=1C343B)](https://github.com/TreeX-xx/JanusX/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-1C343B?style=flat-square)](./LICENSE)

[Download](https://treex-xx.github.io/JanusX/) · [Releases](https://github.com/TreeX-xx/JanusX/releases) · [Docs](https://github.com/TreeX-xx/JanusX/blob/v0.9.3/wiki/README.md) · [Issues](https://github.com/TreeX-xx/JanusX/issues)

> Second test · not v1.0 stable

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/janus-overview.png" alt="JanusX workspace with Claude, Codex, OpenCode, and Pi in split terminals, side panels, and Blueprint" width="960" />
</p>

[Split terminals](#split-terminals) · [Island chat](#island-chat) · [Run configs](#generate-run-configs-from-chat) · [Blueprint](#blueprint-keep-project-conventions-current) · [Usage](#from-live-terminal-usage-to-history) · [Sessions](#resume-sessions-where-you-left-off) · [Tools](#tools--integrations)

## Split terminals

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>Compose terminals freely</h3>
<p>Drag tabs into horizontal or vertical splits, resize panes, and merge them back into place.</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-split.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-split.gif" alt="Claude, Codex, OpenCode, and Pi: split, four-pane layout, resize, and merge tabs" width="100%" /></a></td>
</tr>
</table>

Terminals and the global tools area split independently. Switching projects keeps the tools layout. Pull down the Island capsule for notifications; click, press Esc, or click empty space to dismiss.

## Island chat

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>Project context that travels with you</h3>
<p>Open chat from the capsule, ask about entry points and implementations, then follow up on change direction and how to verify.</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-island-chat.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-island-chat.gif" alt="Island attaches a project, reads code, streams answers, and continues a follow-up" width="100%" /></a></td>
</tr>
</table>

<sub>Local scripted model and sample project; shows real file reads and a two-turn chat.</sub>

## Generate run configs from chat

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>From description to launch</h3>
<p>Describe how to start the app, generate development and test configs, review the diff, confirm save, then test and start — you stay in control.</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-run-config.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-run-config.gif" alt="Chat generates develop and test configs, approve save, tests pass, service starts" width="100%" /></a></td>
</tr>
</table>

<sub>Local scripted model and sample project; config writes, tests, and service start are recorded for real.</sub>

## Blueprint: keep project conventions current

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>Maintain Notes in chat</h3>
<p>Browse modules and conventions, update docs in the side chat, and compare the new body with the diff.</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-blueprint-workbench.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-blueprint-workbench.gif" alt="Browse modules, verify against code in chat, update an existing Note, inspect body and diff" width="100%" /></a></td>
</tr>
<tr>
<td width="30%" valign="middle">
<h3>Git commits, automatic review</h3>
<p>Check Notes and project materials against Git commit rules, locate suggestions with evidence, fix in chat, then re-review.</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-blueprint-review.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-blueprint-review.gif" alt="Commit triggers review, inspect Note and source evidence, fix, independent re-review passes" width="100%" /></a></td>
</tr>
</table>

<sub>Local scripted model and sample project with real reads, writes, and re-review; review set to check on every commit.</sub>

<details>
<summary>How to enable and docs</summary>

Enable Blueprint under experimental features in settings. Model-backed maintenance and review need a working model config. Automatic review is off by default and defaults to every 5 commits; saving a doc does not trigger review by itself.

Blueprint reads module and topic docs under `.agents/notes/`. Document identity, lifecycle, module status, and task results are expressed separately. [Static screenshot](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-blueprint-workbench.png) · [Wiki](https://github.com/TreeX-xx/JanusX/blob/v0.9.3/wiki/README.md).

</details>

## From live terminal usage to history

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>Details and trends</h3>
<p>Expand the terminal bottom bar for model, context, and I/O details; open history stats for trends, heatmaps, and cost by time and engine.</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-usage.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-usage.gif" alt="Claude and Codex usage drawer, weekly stats, engine filter, trends, and estimated cost" width="100%" /></a></td>
</tr>
</table>

<sub>Sample usage from real log parsing and ledger stats; missing data stays unknown; costs are estimates.</sub>

<details>
<summary>Static usage screenshots</summary>

Two images from the terminal drawer and the history stats page — click to enlarge.

[Terminal usage drawer](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-usage-drawer.png) · [History, heatmap, and cost](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-usage-statistics.png)

</details>

## Resume sessions where you left off

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>Search, review, continue</h3>
<p>Find chats by scope and keyword, expand recent turns, open full detail, then continue from the entry point.</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-session.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-session.gif" alt="Search a sample session, expand two turns, read detail, confirm continue" width="100%" /></a></td>
</tr>
</table>

<sub>Sample chat records; continue confirmation is shown then cancelled — no model request was sent.</sub>

<details>
<summary>External CLI sessions</summary>

Discover external sessions from native history files, read a transcript read-only, and use the provider continue entry. Requires readable history files and a working matching CLI.

[Source and recent turns](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-session-external-list.png) · [Full detail and continue entry](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-session-external.png)

Sample Claude native history from a real scan/read; continue was not executed in the screenshot.

</details>

## Parallel branches, results beside you

<table width="100%">
<tr>
<td width="50%" valign="top">
<h3>Worktree · multiple lines of work</h3>
<p>Keep a service on the main branch while you develop in an isolated worktree. Preview the merge, then return to the main line with the service still running.</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-worktree.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-worktree.gif" alt="Main-branch service running, new task disk, merge preview, switch back to main terminal" width="100%" /></a>
</td>
<td width="50%" valign="top">
<h3>Artifacts · results stay nearby</h3>
<p>Open artifacts from Island notifications, interact with HTML, switch file tabs, and reload when content changes.</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-product.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-product.gif" alt="Local test report, Island ping, HTML interaction, JSON tab, reload updates result" width="100%" /></a>
</td>
</tr>
</table>

## Tools & integrations

<table width="100%">
<tr>
<td width="50%" valign="top">
<h3>Files and code</h3>
<p>The file tree follows the worktree. Search files, inspect changes, and open code beside the terminal.</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-filetree.png"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-filetree.png" alt="Dark workspace: search files, Git change marks, code search beside a Pi terminal draft" width="100%" /></a>
</td>
<td width="50%" valign="top">
<h3>Built-in browser</h3>
<p>Keep local previews, docs, and web tabs in the tools area, side by side with project work.</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-browser.png"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-browser.png" alt="Built-in browser with address bar, two web tabs, and local task board search" width="100%" /></a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>Markdown</h3>
<p>Edit, split, and preview notes in place. You choose document ownership; switching projects keeps the tools layout.</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-markdown.png"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-markdown.png" alt="Markdown dark split view: Atlas ownership, publish checklist source and preview" width="100%" /></a>
</td>
<td width="50%" valign="top">
<h3>CPA service integration</h3>
<p>Open the CLIProxyAPI admin page to host a local instance or connect an existing one; only accounts and calls wired to that instance are covered.</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-cpa.png"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-cpa.png" alt="Real CPA admin page inside JanusX: local instance connected, no accounts or calls yet" width="100%" /></a>
</td>
</tr>
</table>

<sub>Tool screenshots use a local sample project; CPA is a real local instance with no accounts or calls wired. [CPA connection settings](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-cpa-settings.png).</sub>

Terminals can run Shell, Janus-agentX, Claude Code, Codex, OpenCode, Pi, and similar tools. Install, sign-in, and model setup for each CLI are separate. Model features in Blueprint, Island, and run configs also need a working model config.

<details>
<summary>About the demo media</summary>

Click a feature image to enlarge. Ten feature GIFs were re-recorded on the new UI — mostly the default theme with classic black mixed in, framed with a narrow background. Terminal drafts were not sent; chats used a local scripted model; sessions, usage, and reports used sample data while real tools and actions still ran. Stills are for screens you need to pause and read; images marked as placeholders still need updates.

Recording entry points and usage: [showcase scripts](./scripts/showcase/README.md).

</details>

---

## Install and get started

Go to the **[download page](https://treex-xx.github.io/JanusX/)** and pick a Windows 10 / 11 x64 build.

| Build | Best for | How to use |
| --- | --- | --- |
| Installer `*-x64-setup.exe` | Daily use on your machine | Run the wizard, choose an install folder, then launch JanusX |
| Portable `*-x64-portable.exe` | Run without installing | Download and run the `.exe` |

<details>
<summary>Where portable data lives</summary>

Portable builds keep data under `%APPDATA%\JanusX-Portable` for the current user, isolated from installer and dev builds. There is no carry-on mode and no `data` folder next to the exe. Copying the exe to another PC does not bring personal data along.

</details>

Public downloads currently target Windows. macOS and Linux packaging commands are below; published installers follow whatever is attached on Releases. Everyday users do not need Node.js or a source clone.

**Three steps to start**

1. Add a local project as a workspace.
2. Open Shell or a configured AI CLI and get to work.
3. Split panes as needed and open files, the browser, or Blueprint for context.

---

## Develop from source

For a first setup, follow the **[local development guide](./docs/development.md)**: Node version from `.node-version`; keep `JanusX`, `janus-agentX`, and the `WorkFlowX` used for verification as sibling directories; build with the CI-pinned revisions and dependency order. Cloning JanusX alone is not enough to prepare dependencies.

Contributors branch from upstream `dev` and open PRs into `dev`. Full steps: **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

### Verify

```bash
npm run verify
```

The unified check covers themes, workspace typecheck and tests, unused-symbol checks, production build, package boundary and packaging exclusion checks, i18n and Note checks, lint, and a real Electron desktop smoke on Windows. Environment prep and single-check notes: [local development guide](./docs/development.md).

You can also run end-to-end checks on their own:

```bash
npm run test:e2e:desktop
npm run test:e2e:island
```

### Package

```bash
npm run package:win
npm run package:mac
npm run package:linux
```

Artifacts land in `release/<version>/`. Packaging needs the matching OS and toolchain.

For faster Windows iteration, `npm run package:win:portable` builds only the portable package with compression level 1 in that subprocess, while still running package boundary, dependency exclusion, size budget, and runtime checks. For a separate output dir, append `-- --release-dir artifacts/portable-check`. Version PRs, tags, releases, and recovery: [maintainer guide](./docs/maintainers.md).

Build `dist` in the sibling `janus-agentX` repo before packaging. `prepackage` checks the six local packages against npm publish file lists, refreshes changed files and dependency declarations, and blocks missing siblings or build entry points — it does not replace compiling sibling source.

Architecture and module map: [Wiki](https://github.com/TreeX-xx/JanusX/blob/v0.9.3/wiki/README.md). Optimization status and roadmap: [architecture plan](https://github.com/TreeX-xx/JanusX/blob/v0.9.3/wiki/06-architecture-optimization-plan.md). Contribution rules: [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Experimental features (in progress)

These directions are still in development; behavior and UX will keep changing:

- **[Janus-agentX CLI](https://github.com/TreeX-xx/janus-agentX)**: agent chat, tool use, and script integration inside the terminal.
- **Roundtable**: multi-role discussion for comparing options, clarifying requirements, and design review.
- **Remote**: view terminals, send input, and manage run state across devices over the web.
- **Team**: share and co-maintain projects around Blueprint.
- **Multi-agent monitoring**: observe multi-agent runs, track progress, and summarize results.
- **Multi-agent orchestration**: schedule and coordinate multi-agent tasks.

---

## About

JanusX is an open-source desktop workspace for AI-assisted coding that people already use in the wild: projects, terminals, AI CLIs, and everyday tools in one place. Stable basics first; bolder collaboration experiments second.

Discussion, ideas, and contributions welcome. Fork and open a Pull Request, or share scenarios and bugs in Issues — see [CONTRIBUTING.md](./CONTRIBUTING.md).

If this helps you, a Star helps others find it.

**Friends**: [Linux.Do](https://linux.do/) — a community for technical discussion and resources.

---

## Contact

- **Email**: [740288105@qq.com](mailto:740288105@qq.com)
- **QQ group**: 1125733779 (JanusX group 1). Scan the QR code below to join — feedback, agent development, feature discussion, and early updates.

<p align="center">
  <a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/qq-group-1.png">
    <img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/qq-group-1.png" alt="JanusX QQ group 1 QR code, group id 1125733779" width="300" />
  </a>
</p>

---

## Support

JanusX is free and open source (MIT), maintained long-term by an independent developer.

---

<div align="center">

[MIT License](./LICENSE) · Use / modify / redistribute freely · Made by [@TreeX-X](https://github.com/TreeX-X)

</div>

## Star history

<a href="https://www.star-history.com/#TreeX-xx/JanusX&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=TreeX-xx/JanusX&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=TreeX-xx/JanusX&type=date&theme=dark&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=TreeX-xx/JanusX&type=date&theme=dark&legend=top-left" />
  </picture>
</a>
