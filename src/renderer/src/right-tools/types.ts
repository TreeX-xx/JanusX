import type { TypedI18nKey } from '@/i18n/types'
import type { ExtensionViewId } from '@/extensions/types'
import type { LucideIcon } from 'lucide-react'

export type BuiltinRightToolId = 'files' | 'git' | 'assist' | 'persona' | 'review' | 'sessions'
export type RightToolId = BuiltinRightToolId | ExtensionViewId

export interface RightToolDefinition {
  id: RightToolId
  titleKey?: TypedI18nKey
  shortTitleKey?: TypedI18nKey
  ariaLabelKey?: TypedI18nKey
  title?: string
  iconComponent?: LucideIcon
  order: number
  instancePolicy: 'single'
  mountPolicy: 'while-open'
  feature?: 'persona'
  panelWidth?: { min: number; default: number; max: number }
}

export interface RightToolPreferencesV1 {
  schemaVersion: 1
  openToolIds: RightToolId[]
  activeToolId: RightToolId | null
  panelWidth: number
  /** User-set widths by tab. Missing entries use the tool default. */
  panelWidths?: Partial<Record<RightToolId, number>>
}

export type PanelCollapseCommand = 'none' | 'expand' | 'collapse' | 'toggle'

export interface RightToolTransition {
  preferences: RightToolPreferencesV1
  panelCollapseCommand: PanelCollapseCommand
}
