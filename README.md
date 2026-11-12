<p align="center">
  <img src="./docs/assets/readme/janus-header.svg" alt="JanusX capsule and pixel wordmark" width="360" />
</p>

<div align="center">

<p align="center">
  <a href="./README.zh-CN.md">中文</a> · <strong>English</strong>
</p>

# JanusX

### A desktop workspace for projects, terminals, and AI coding agents

Run projects and terminals side by side, switch between terminal and chat in the same CLI session, and keep files, Git, and session history close.

[![Release](https://img.shields.io/github/v/release/TreeX-xx/JanusX?include_prereleases=&style=flat-square&color=D43D2A)](https://github.com/TreeX-xx/JanusX/releases)
[![Windows x64](https://img.shields.io/badge/Windows-x64-1C343B?style=flat-square)](https://treex-xx.github.io/JanusX/)
[![Downloads](https://img.shields.io/github/downloads/TreeX-xx/JanusX/total?style=flat-square&color=1C343B)](https://github.com/TreeX-xx/JanusX/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-1C343B?style=flat-square)](./LICENSE)

[Download](https://treex-xx.github.io/JanusX/) · [Releases](https://github.com/TreeX-xx/JanusX/releases) · [Issues](https://github.com/TreeX-xx/JanusX/issues)

</div>

<p align="center">
  <a href="./docs/assets/readme/workbench-overview.png"><img src="./docs/assets/readme/workbench-overview.png" alt="JanusX workspace with the Claude Code terminal on the left and Codex conversation on the right" width="840" /></a>
</p>

[Install and get started](#install-and-get-started) · [Core workflows](#core-workflows) · [Right-side workbench](#right-side-workbench) · [Plugins](#plugins) · [Contributing and community](#contributing-and-community)

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

Public downloads target Windows. Installing and using JanusX requires neither Node.js nor a source clone. For other platforms, see the [maintainer guide](./docs/maintainers.md).

**Three steps to start**

1. Add a local project as a workspace.
2. Open Shell or a configured AI CLI and get to work.
3. Split panes as needed and open Files or Git on the right for context.

## Core workflows

### Split terminals

Run Shell, Claude Code, Codex, OpenCode, Pi, and other CLIs in one workspace. Drag tabs into horizontal or vertical splits, resize panes, and merge the tabs back together.

<p align="center">
  <a href="./docs/assets/readme/terminal-split.gif"><img src="./docs/assets/readme/terminal-split.gif" alt="Split Claude Code and Codex conversation tabs, resize their panes, and merge the tabs" width="840" /></a>
</p>

### One session, terminal and chat

Switch between terminal and chat in a supported AI CLI session. Use the terminal for direct interaction, or open chat to read messages, follow file references, and respond to approvals. Supported interactions vary by CLI.

<p align="center">
  <a href="./docs/assets/readme/codex-dual-view.gif"><img src="./docs/assets/readme/codex-dual-view.gif" alt="The same Codex prompt and answer in Conversation view, then in the native terminal, and back in Conversation view" width="840" /></a>
</p>

### Parallel work with Worktrees

Keep the preview service running on the main branch while developing and testing in an isolated Worktree. Commit the changes, review the diff, merge into main, and return to the running preview.

<p align="center">
  <a href="./docs/assets/readme/worktree-parallel.gif"><img src="./docs/assets/readme/worktree-parallel.gif" alt="Claude Code and Codex in separate Worktrees, followed by a commit, a merge into main, and a return to the running service" width="840" /></a>
</p>

**Island chat and notifications.** Open chat from the top capsule and attach a project for context. Use notifications to open artifacts such as reports and interactive previews.

**Run configs and usage.** Generate a run configuration in chat, review it before saving, then test and start it. Usage views show live details and history for supported CLIs.

## Right-side workbench

The vertical tool rail keeps everyday tools beside the terminal. Hover over a collapsed tool to preview it, then click to dock the panel.

- **Files.** Browse and search project files, inspect their contents, and see Git status markers.
- **Git and repositories.** Review changes, commits, and diffs, and open the hosted repository sidebar from the workbench.
- **Sessions.** Search history, review recent turns and details, and resume through the matching entry.
- **Automation.** View task cards, progress, and results.

<p align="center">
  <a href="./docs/assets/readme/right-workbench.gif"><img src="./docs/assets/readme/right-workbench.gif" alt="Preview and pin Files, search the project, browse Git history, repository issues and pull requests, review session details, and run an automation" width="840" /></a>
</p>

The built-in browser and Markdown editor live in the global tools area for working with web pages, project previews, and documents side by side.

## Plugins

Install official plugins as needed. Download a package, import it in **Settings → Plugins → Installed**, then review permissions and enable it.

<p align="center">
  <a href="./docs/assets/readme/plugin-management.png"><img src="./docs/assets/readme/plugin-management.png" alt="JanusX plugin settings showing the import button, Blueprint enabled, and CPA and Docker installed but disabled" width="840" /></a>
</p>

| Plugin | What it adds |
| --- | --- |
| [Blueprint](./plugins/blueprint/README.md) | Browse project modules and Notes, maintain conventions through chat, and optionally enable review on Git commits. |
| [CPA](./plugins/cpa/README.md) | Host a local CLIProxyAPI instance or connect an existing instance and open its admin page in JanusX. |
| [Docker](./plugins/docker/README.md) (experimental) | Manage local Docker containers, inspect logs, and open container terminals. |

[Download official plugin packages](https://github.com/TreeX-xx/JanusX/releases/tag/v0.9.8)

<p align="center">
  <a href="./docs/assets/readme/blueprint-workbench.png"><img src="./docs/assets/readme/blueprint-workbench.png" alt="Blueprint workbench with a Note preview on the left, the 11-node Atlas graph in the center, and a Janus conversation on the right" width="840" /></a>
</p>

## Contributing and community

JanusX is available under the [MIT License](./LICENSE). Share issues and workflows in [Issues](https://github.com/TreeX-xx/JanusX/issues), or follow the [contribution guide](./CONTRIBUTING.md) to open a PR against dev.

- The [local development guide](./docs/development.md) covers setup, sibling repositories, and verification commands.
- The [testing guide](./docs/testing.md) lists the test entry points.
- The [maintainer guide](./docs/maintainers.md) covers packaging, releases, and recovery.

- **Email**: [740288105@qq.com](mailto:740288105@qq.com)
- **QQ group**: 1125733779 (JanusX group 1). Scan the QR code below to join — feedback, agent development, feature discussion, and early updates.

<p align="center">
  <a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/qq-group-1.png">
    <img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/qq-group-1.png" alt="JanusX QQ group 1 QR code, group id 1125733779" width="300" />
  </a>
</p>

[Linux.Do](https://linux.do/) · [Star history](https://www.star-history.com/#TreeX-xx/JanusX&Date)

<div align="center">

[MIT License](./LICENSE) · Use / modify / redistribute freely · Made by [@TreeX-X](https://github.com/TreeX-X)

</div>
