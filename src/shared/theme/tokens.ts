/**
 * 语义令牌表：组件层唯一允许使用的颜色来源。
 * 新增令牌先加到这里 + 每个 definition 补值（completeness 测试会卡），再在组件里用。
 * JS 侧用 getThemeTokens() / useThemeTokens()，CSS 侧用 var(--<key>)。
 */
import { getThemeDefinition, listThemeDefinitions } from './registry'

export const SEMANTIC_TOKENS = [
  'on-accent',
  'glow-core',
  'glow-strength',
  'surface-tint',
  'surface-shade',
  'shadow-color',
  'modal-backdrop',
  'selection-background',
  'status-info',
  'status-degraded',
  'git-lane-blue',
  'git-lane-purple',
  'git-lane-green',
  'git-lane-slate',
  'role-coder',
  'role-evaluator',
  'role-abstracter',
  'role-prompter',
  'role-teammate',
  'role-subagent',
  'usage-claude',
  'usage-codex',
  'usage-opencode',
  'usage-pi',
  'usage-janus',
  'usage-dsh',
  'usage-input',
  'usage-output',
  'roundtable-paper',
  'roundtable-paper-light',
  'roundtable-paper-edge',
  'roundtable-wood',
  'roundtable-wood-deep',
  'roundtable-ribbon',
  'support-star-stroke',
  'support-star-fill',
  'dialog-backdrop',
  'dialog-shadow',
  'run-bud-border',
  'run-bud-glow',
  'run-bud-skin-top',
  'run-bud-skin-bottom',
  'run-bud-text',
  'run-bud-hover',
  'run-bud-active-ring',
  'run-bud-active-glow',
  'run-bud-stop-border',
  'run-bud-stop-text',
  'run-bud-stop-glow',
  'run-scope-accent',
  'usage-heatmap-mid',
  'usage-heatmap-high',
  'preview-paper',
  'preview-shadow',
  'font-mono',
  'focus-progress',
  'sidebar-codex-filter',
  'session-sheet-base-weight',
  'cli-logo-light',
  'cli-logo-dark',
  'shell-void',
  'shell-canvas',
  'shell-pane',
  'shell-pane-chrome',
  'shell-chrome',
  'shell-chrome-raised',
  'shell-card',
  'shell-drawer',
  'island-panel-background',
  'island-panel-border',
  'island-panel-radius',
  'island-panel-shadow',
  'tool-canvas',
  'tool-card',
  'tool-chrome',
  'tool-hover',
  'popover-background',
  'popover-hover',
  'popover-shadow',
  'control-h',
  'control-border',
  'shell-hover',
  'shell-active',
  'shell-border',
  'shell-border-soft',
  'shell-text',
  'shell-muted',
  'shell-dim',
  'shell-diff-add',
  'shell-diff-del',
  'status-success',
  'status-warning',
  'status-danger',
  'shell-accent',
  'shell-accent-strong',
  'shell-accent-soft',
  'shell-accent-border',
  'primary',
  'bg-app',
  'bg-deep',
  'bg-dark',
  'bg-darker',
  'workbench-canvas',
  'workbench-grid',
  'surface',
  'surface-elevated',
  'chrome-bg',
  'text',
  'text-secondary',
  'text-dim',
  'border',
  'border-soft',
  'accent-soft',
  'accent-mid',
  'accent-glow',
] as const

export type SemanticToken = (typeof SEMANTIC_TOKENS)[number]

/** 纯函数：取某主题的令牌表（CSS 变量值原样，含 var() 引用与非颜色值如 control-h）。 */
export function getThemeTokens(id: unknown): Record<string, string> {
  return { ...getThemeDefinition(id).tokens }
}

/** 完整性断言：每个已注册主题必须覆盖全部语义令牌（测试与生成脚本共用）。 */
export function assertThemeCompleteness(): string[] {
  const missing: string[] = []
  for (const definition of listThemeDefinitions()) {
    for (const token of SEMANTIC_TOKENS) {
      if (!(token in definition.tokens)) {
        missing.push(`${definition.id}:${token}`)
      }
    }
  }
  return missing
}
