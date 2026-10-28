// Note: built-in view ownership and compatibility — see .agents/notes/workbench/service-integrations.md
import { lazy, Suspense, type ComponentType } from 'react'
import { Files, GitBranch, MessagesSquare } from 'lucide-react'
import type { RightToolDefinition } from '@/right-tools/types'
import type { ExtensionDefinition, ExtensionViewProps } from './types'

interface BuiltinRightExtension {
  definition: ExtensionDefinition
  tool: RightToolDefinition
}

const builtinRightLoaders: Array<() => Promise<unknown>> = []

/** 空闲时预热右侧工具的懒加载 chunk：首次悬浮不再露出空白卡。 */
export function preloadBuiltinRightTools(): void {
  for (const load of builtinRightLoaders) void load().catch(() => {})
}

function builtinRightExtension(
  tool: RightToolDefinition & { title: string },
  load: () => Promise<{ default: ComponentType<{ active?: boolean }> }>,
): BuiltinRightExtension {
  builtinRightLoaders.push(load)
  // Defer tool imports: stores consult contribution metadata during hydration.
  const Tool = lazy(load)
  function View({ active }: ExtensionViewProps) {
    return <Suspense fallback={null}><Tool active={active} /></Suspense>
  }
  return {
    tool,
    definition: {
      id: `janusx.${tool.id}`,
      views: [{
        id: 'panel', title: tool.title, location: 'right', scope: 'application',
        icon: tool.iconComponent, order: tool.order, component: View,
      }],
    },
  }
}

// Application-scoped shells preserve existing local UI state across project switches.
// The tools retain their existing project/worktree subscriptions and host services.
export const BUILTIN_RIGHT_EXTENSIONS: readonly BuiltinRightExtension[] = [
  builtinRightExtension({
    id: 'files', title: 'Files',
    titleKey: 'common:rightTool.tool.files.title',
    shortTitleKey: 'common:rightTool.tool.files.shortTitle',
    ariaLabelKey: 'common:rightTool.tool.files.ariaLabel',
    iconComponent: Files, order: 0, instancePolicy: 'single', mountPolicy: 'while-open',
    panelWidth: { min: 240, default: 260, max: 420 },
  }, () => import('@/components/FileExplorerTool').then(({ FileExplorerTool }) => ({ default: FileExplorerTool }))),
  builtinRightExtension({
    id: 'git', title: 'Git',
    titleKey: 'common:rightTool.tool.git.title',
    shortTitleKey: 'common:rightTool.tool.git.shortTitle',
    ariaLabelKey: 'common:rightTool.tool.git.ariaLabel',
    iconComponent: GitBranch, order: 1, instancePolicy: 'single', mountPolicy: 'while-open',
    panelWidth: { min: 340, default: 360, max: 520 },
  }, () => import('@/components/GitPanel').then(({ GitPanel }) => ({ default: GitPanel }))),
  builtinRightExtension({
    id: 'sessions', title: 'Sessions',
    titleKey: 'common:rightTool.tool.sessions.title',
    shortTitleKey: 'common:rightTool.tool.sessions.shortTitle',
    ariaLabelKey: 'common:rightTool.tool.sessions.ariaLabel',
    iconComponent: MessagesSquare, order: 5, instancePolicy: 'single', mountPolicy: 'while-open',
    panelWidth: { min: 340, default: 360, max: 520 },
  }, () => import('@/components/SessionPanel').then(({ SessionPanel }) => ({ default: SessionPanel }))),
]

export function builtinRightViewId(extension: BuiltinRightExtension): `extension:${string}/${string}` {
  return `extension:${extension.definition.id}/panel`
}
