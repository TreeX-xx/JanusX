---
{
  "schema": "harness-note/2",
  "id": "8795ab54-4051-4d53-9805-e85a9073ca5d",
  "kind": "requirement",
  "lifecycle": "draft",
  "created": "2026-10-03",
  "class": "feature",
  "tags": ["dsh","telemetry","terminal"],
  "relations": [
    {"type":"derived-from","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/b28d07a3-bc27-4be1-9868-87849e9efb16"}
  ],
  "updated": "2026-11-20T13:11:34.745Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# DSH 成功、审批与真实用量信号补全

## Problem

[DSH 接入决策](../dsh-terminal-integration.md)已提供启动、正向状态、声明模型与 headless 事件。PTY 成功结束、审批与问卷面板及非零上下文格式缺少真实样本；历史请求已接入用量管理，终端自动绑定仍缺少身份依据。running 无可靠结束信号时不能保证回到 wait，声明窗口及启动零值不等于实测 token。

## Expected behavior

在配置 key 的真实会话中采集成功、失败、审批、问卷和非零用量样本，保留可公开的脱敏协议片段、版本与来源。只有样本能够稳定区分生命周期时才增加映射，不能把等待输出或文本消失推断为空闲。审批信号不得被普通 running/degraded 更新覆盖。

区分单轮消耗、累计消耗和当前窗口占用。statusBar.tokens/tps 默认关闭，contextUsage/contextBar 必须以真实非零输出定格式；无 ctx/context 锚定的 turn 头仍不能进入窗口统计。用量管理读取每个会话目录中版本最高的 `session[.vN].jsonl[.zstd]`，同版本选择最近更新的文件。扫描仅从 `assistant/message.data.usage` 取输入、输出及可选的缓存读写；推理已包含在输出中。按原生会话 ID 和 `seq` 去重，以事件时间归桶。早期格式按 `seedLength` 排除继承序号，v2 起等待 `session/end-seed` 确认继承范围。压缩文件逐帧解码，输入与展开上限各为 64 MiB，半写尾部下次重读。格式与公开样本参照 [Magpie 的 DSH 请求读取器](https://github.com/yetone/magpie/blob/5f952c8f1ba3007acd5f1ec1a740f562a21dc5a6/internal/sessions/calls_dsh.go)。

会话自动绑定必须有可验证的终端身份来源。现有 conpty pid 与内部挂载 pid 不一致，不能把时间邻近或最新目录当作授权身份；无可靠来源时继续要求显式 sessionId。若上游提供 hook，应在核实协议后接既有 AgentHookCoordinator，而非虚构 DSH 通知投影函数。

## Scope

覆盖 DSH PTY 信号、历史读取及终端绑定的后续设计与验证，以及真实 App 中选择器卡片、设置工具行、React/Ink 在 xterm.js 中的可读性和安装自举复验。历史版本组合及已落地行为由接入决策持有。

[全引擎统计](./usage-telemetry-fix-and-stats.md)继续拥有设置面板、跨终端聚合与全引擎回归；本需求不重写其 AC 或宣告全量历史完整。模型配置投影继续拒绝，远程 DSH 创建不在范围内。

## Acceptance criteria

- [ ] AC-1: 成功、审批、问卷及非零数值信号有脱敏真实样本和明确版本；无样本的映射保持未实现。
- [ ] AC-2: 结束信号正确收敛状态，普通 PTY 更新不覆盖审批、输入和进程错误；无 ctx/context 的单轮用量不冒充窗口占用。
- [x] AC-3: 历史读取如启用，具备有界解码、坏件诊断、来源与幂等累计验证；不能把缺失数值或启动零值当作真实用量。
- [ ] AC-4: 自动绑定如启用，使用可验证终端身份；不以 conpty pid、最新目录或时间邻近猜测会话。
- [ ] AC-5: 真实 App 验证选择器、设置行、TUI 安装与渲染；记录实际运行的针对性及全引擎回归，不沿用原文历史通过数冒充新结果。

## Alternatives considered

保留当前正向状态与声明模型方案不增加解析维护成本，在缺少样本时继续采用；代价是结束与精确用量不可见。直接按其他引擎格式或文本相似度猜测实现很快，但会混淆窗口和消耗、覆盖审批或绑定错会话。仅做 headless 可取得结构化事件，却不能补齐交互 TUI 的上下文，因此两条入口分别验证。

## Risks

上游 TUI 与日志格式变动会使模式失效；真实样本可能包含密钥或私人提示，必须脱敏后再记录。当前读取有文件和解压大小上限，超限或损坏的来源会留下缺口。用 Magpie 公开的 8 个会话样本核验了明文、多帧压缩、格式升级和 fork，共导入 11 条请求、31,924 tokens，重扫未新增记录。
