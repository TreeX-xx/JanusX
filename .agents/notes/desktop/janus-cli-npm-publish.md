---
{
  "schema": "harness-note/2",
  "id": "ad7e45c2-3f6b-5c81-89c0-37bb979b9e73",
  "kind": "decision",
  "lifecycle": "proposed",
  "created": "2026-09-20",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-20-agent-note-janus-cli-npm--ad7e45c2.md",
      "sourceHash": "a1ded58e9d8b98b9c8c60c86c07ee8dbd70d6418071e4a9788a23fb8aa76423b",
      "originalBodyHash": "3f7a8e1f8d17ec413624b70b1a40bb399bfd62dea1743fdd66e6f582cca94184",
      "category": "formal",
      "reason": "Retains the source decision in proposed lifecycle; body documents Janus CLI npm 发布与设置页检测安装. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/proposed/feature/2026-09-20-janus-cli-npm-publish.md",
        "sourceHash": "f8ad34dc9aefc77cd29c60e2cc4f3e5c52cabbcb4c90234ba2108ea055dc32c3",
        "originalBodyHash": "eb218670f7eb28b57c1900851921ccf302c4b2b9ad5e2ff2775a4f6b5f091521"
      }
    }
  },
  "updated": "2026-11-09T11:07:03.952Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---
# Janus CLI npm 发布与设置页检测安装


## Problem

设置页外部终端的 Janus 卡片只能服务开发者：`tool-registry.ts` 的 `janus` 项走 `latestStrategy: local-source`，`installer.ts` 无 sibling 源码直接失败并提示手跑 `npm link`。普通用户没有 `janus-agentX` 同级检出，检测到未安装后无法一键安装。可运行的 `@janus-agent/cli` 首版已发到 npm（单文件 bundle，零运行时依赖），但 JanusX 侧还没切到 npm 主路径，发布核对项也散落在聊天记录里。

## Decision

Janus 条目与 claude/codex/opencode/pi 收敛：`npmPackage: @janus-agent/cli` + `latestStrategy: npm-dist-tags` + `npm i -g` 安装/升级/卸载；保留 `localLifecycle` 仅作有 sibling 源码时的 dev 回退（源码命中则 `build + link`，否则走 npm）。`latest()` 因此走 dist-tags 轻端点，不再读 sibling `package.json`。

## Alternatives considered

- 去掉 `localLifecycle` 只留 npm——最干净，但开发者本地联调又要手跑两步，否决；回退分支保留，行为按“有源码用源码”优先。
- `latest` 继续读 sibling 源码——离线可用，但用户侧永远 unknown，且与安装源（npm）版本脱节，否决。
- 发完整依赖包而非 bundle 单文件——`file:` 依赖出包不可装，bundle 是 `pack-cli.mjs` 已验证的形态，沿用。

## Acceptance criteria

发布侧（janus-agentX 仓）：

- [x] npm 组织 `janus-agent` 建好，Automation token（publish and stage）配好
- [x] `pack-cli.mjs` 的 `bin` 修成 `janus.js`（`./` 前缀会被 npm 干掉，装完无命令）
- [x] `@janus-agent/cli@0.1.0` 发到 registry，状态 public
- [x] 隔离 `npm install -g <tarball>`：落出 `janus/janus.cmd/janus.ps1`，`janus --version` 报 0.1.0
- [ ] packument 索引延迟消除：`npm view @janus-agent/cli version` 可见，`npm i -g @janus-agent/cli` 按名可装
- [ ] `pack-cli.mjs` 的 bin 修复提交推送
- [ ] 后续版本流程固定：改 `packages/cli` 版号 → `pack:cli` → `publish --access public`，JanusX 卡片自动跟进

JanusX 侧（本仓）：

- [ ] `janus` 条目带 `npmPackage`，`latest` 走 npm dist-tags
- [ ] 无源码时安装回退到 `npm i -g` 而非直接失败；有源码仍 `build + link`
- [ ] `uninstall('janus')` 走 `npm rm -g`
- [ ] 设置页 janus 文案与 npm 路径一致（中英）
- [ ] external-cli 单测全绿，`check:notes` 通过

## Consequences

- 新 scope 首发的 packument 延迟会让用户侧短暂“搜不到包”：卡片 `latest` 未知不阻塞安装，`latest.ts` 超时/异常本就回 unknown。
- 用户全局源是镜像站时 `npm i -g` 行为不变（安装走用户本机 npm 配置，与 JanusX 无关）；`--version` 重探是安装成功的唯一判据。
- 日常 `npm install` 仍走镜像，只有发版命令需要官方源；token 只活在维护者本机与 CI secret，不进仓库。
