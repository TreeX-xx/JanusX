// Note: legacy callers cannot start a second Blueprint runtime — see .agents/notes/planning/blueprint-official-plugin.md
export function requireBlueprintPlugin(): never {
  throw new Error('BLUEPRINT_PLUGIN_REQUIRED: 请从设置 → 插件打开蓝图，继续文档审核、修复或维护。 Open Blueprint from Settings → Plugins to continue.')
}
