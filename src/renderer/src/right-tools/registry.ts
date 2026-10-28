// Note: rail plus singleton tools with shared icon taxonomy — see .agents/notes/workbench/right-dock.md
import type { RightToolDefinition, RightToolId } from './types'
import type { ExperimentalFeatures } from '../../../shared/ipc/experimental'
import { extensionRegistry } from '@/extensions/registry'
import { BUILTIN_RIGHT_EXTENSIONS, builtinRightViewId } from '@/extensions/builtins'
import type { TypedI18nKey } from '@/i18n/types'
import { Sparkles } from 'lucide-react'

// Built-ins register before preference hydration; components load only on mount.
for (const { definition } of BUILTIN_RIGHT_EXTENSIONS) extensionRegistry.register(definition)

const ASSISTANT_TOOL = {
  id: 'assist',
  titleKey: 'common:rightTool.tool.assist.title',
  shortTitleKey: 'common:rightTool.tool.assist.shortTitle',
  ariaLabelKey: 'common:rightTool.tool.assist.ariaLabel',
  iconComponent: Sparkles, order: 3, instancePolicy: 'single', mountPolicy: 'while-open', feature: 'persona',
} as const satisfies RightToolDefinition

// Compatibility catalog also retains widths while a built-in is disabled.
export const RIGHT_TOOL_REGISTRY: readonly RightToolDefinition[] = [
  ASSISTANT_TOOL, ...BUILTIN_RIGHT_EXTENSIONS.map(({ tool }) => tool),
].sort((a, b) => a.order - b.order)
export const RIGHT_TOOL_IDS: readonly RightToolId[] = RIGHT_TOOL_REGISTRY.map(({ id }) => id)

export function canonicalRightToolId(id: unknown): unknown {
  if (id === 'persona' || id === 'review') return 'assist'
  return BUILTIN_RIGHT_EXTENSIONS.find((extension) => builtinRightViewId(extension) === id)?.tool.id ?? id
}

export function getRightToolView(toolId: RightToolId) {
  const builtin = BUILTIN_RIGHT_EXTENSIONS.find(({ tool }) => tool.id === toolId)
  return extensionRegistry.getView(builtin ? builtinRightViewId(builtin) : toolId)
}

export function isRightToolEnabled(toolId: RightToolId, features: Pick<ExperimentalFeatures, 'knowledge' | 'persona'>): boolean {
  const id = canonicalRightToolId(toolId)
  const tool = getRightToolDefinitions().find((item) => item.id === id)
  return Boolean(tool && (!tool.feature || features[tool.feature]))
}

export function isRightToolId(value: unknown): value is RightToolId {
  return typeof value === 'string' && getRightToolDefinitions().some(({ id }) => id === value)
}

export function getRightToolDefinitions(): readonly RightToolDefinition[] {
  return [ASSISTANT_TOOL, ...extensionRegistry.getSnapshot()
    .filter((view) => view.location === 'right')
    .map((view): RightToolDefinition => {
      const builtin = BUILTIN_RIGHT_EXTENSIONS.find((extension) => builtinRightViewId(extension) === view.id)
      return builtin?.tool ?? {
        id: view.id, title: view.title, iconComponent: view.icon, order: view.order ?? 100,
        instancePolicy: 'single', mountPolicy: 'while-open',
      }
    })].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export function rightToolLabel(
  tool: RightToolDefinition,
  translate: (key: TypedI18nKey) => string,
  kind: 'title' | 'shortTitle' | 'ariaLabel' = 'title',
): string {
  const key = kind === 'shortTitle' ? tool.shortTitleKey : kind === 'ariaLabel' ? tool.ariaLabelKey : tool.titleKey
  return key ? translate(key) : tool.title ?? tool.id
}
