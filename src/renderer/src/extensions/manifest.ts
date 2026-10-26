import { BookOpen, ChartNoAxesColumn, Clock, Code, File, List, Puzzle } from 'lucide-react'
import { parsePluginManifest, type PluginManifest, type PluginView } from '@janusx/plugin-sdk'
import type { ExtensionDefinition, ExtensionView } from './types'

const icons = { puzzle: Puzzle, book: BookOpen, list: List, chart: ChartNoAxesColumn, file: File, code: Code, clock: Clock }

/** Trusted adapter only: P2 must authorize the source before supplying an isolated shell. */
export function manifestContribution(manifest: PluginManifest, component: (view: PluginView) => ExtensionView['component']): ExtensionDefinition {
  const checked = parsePluginManifest(JSON.stringify(manifest))
  return {
    id: checked.id,
    views: checked.contributes.views.map((view) => ({
      id: view.id, title: view.title, location: view.location, scope: view.scope, instancePolicy: view.instancePolicy,
      order: view.order, frame: view.frame, icon: icons[view.icon ?? 'puzzle'], component: component(view),
    })),
    commands: checked.contributes.commands ?? [], menus: checked.contributes.menus ?? [], keybindings: checked.contributes.keybindings ?? [],
  }
}
