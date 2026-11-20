import { canonicalRightToolId, getRightToolDefinitions, isRightToolId, RIGHT_TOOL_REGISTRY } from './registry'
import type {
  PanelCollapseCommand,
  RightToolId,
  RightToolPreferencesV1,
  RightToolTransition,
} from './types'

export { canonicalRightToolId } from './registry'

export const RIGHT_TOOL_SCHEMA_VERSION = 1 as const
export const RIGHT_TOOL_PANEL_MIN_WIDTH = 240
export const RIGHT_TOOL_PANEL_DEFAULT_WIDTH = 280
export const RIGHT_TOOL_PANEL_MAX_WIDTH = 420
export const FILES_PANEL_DEFAULT_WIDTH = 320
export const SESSION_PANEL_MIN_WIDTH = 340
export const SESSION_PANEL_DEFAULT_WIDTH = 360
export const SESSION_PANEL_MAX_WIDTH = 520

export function createDefaultRightToolPreferences(): RightToolPreferencesV1 {
  return {
    schemaVersion: RIGHT_TOOL_SCHEMA_VERSION,
    openToolIds: [],
    activeToolId: null,
    panelWidth: RIGHT_TOOL_PANEL_DEFAULT_WIDTH,
  }
}

export function clampRightToolPanelWidth(
  width: unknown,
  maximum?: number,
  toolId?: RightToolId | null,
): number {
  const minimum = rightToolPanelMinWidth(toolId)
  const upperBound = rightToolPanelMaxWidth(toolId)
  const defaultWidth = rightToolPanelDefaultWidth(toolId)
  const effectiveMaximum = maximum !== undefined && Number.isFinite(maximum)
    ? Math.min(upperBound, Math.max(minimum, maximum))
    : upperBound

  if (typeof width !== 'number' || !Number.isFinite(width)) {
    return Math.min(defaultWidth, effectiveMaximum)
  }

  return Math.min(effectiveMaximum, Math.max(minimum, width))
}

export function rightToolPanelMinWidth(toolId?: RightToolId | null): number {
  return panelWidthDefinition(toolId)?.min ?? RIGHT_TOOL_PANEL_MIN_WIDTH
}

export function rightToolPanelMaxWidth(toolId?: RightToolId | null): number {
  return panelWidthDefinition(toolId)?.max ?? RIGHT_TOOL_PANEL_MAX_WIDTH
}

export function rightToolPanelDefaultWidth(toolId?: RightToolId | null): number {
  return panelWidthDefinition(toolId)?.default ?? RIGHT_TOOL_PANEL_DEFAULT_WIDTH
}

export function preferredRightToolPanelWidth(
  baseWidth: number,
  panelWidths: RightToolPreferencesV1['panelWidths'],
  toolId?: RightToolId | null,
): number {
  const defaultWidth = panelWidthDefinition(toolId)?.default ?? baseWidth
  return clampRightToolPanelWidth(toolId ? panelWidths?.[toolId] ?? defaultWidth : defaultWidth, undefined, toolId)
}

function normalizePanelWidths(value: unknown): RightToolPreferencesV1['panelWidths'] {
  if (!isRecord(value)) return undefined
  const widths: NonNullable<RightToolPreferencesV1['panelWidths']> = {}
  for (const { id } of [...RIGHT_TOOL_REGISTRY, ...getRightToolDefinitions()]) {
    if (typeof value[id] === 'number' && Number.isFinite(value[id])) {
      widths[id] = clampRightToolPanelWidth(value[id], undefined, id)
    }
  }
  return Object.keys(widths).length ? widths : undefined
}

function panelWidthDefinition(toolId?: RightToolId | null) {
  return RIGHT_TOOL_REGISTRY.find(({ id }) => id === canonicalRightToolId(toolId))?.panelWidth
}

export function normalizeRightToolIds(value: unknown): RightToolId[] {
  if (!Array.isArray(value)) return []
  const order = new Map(getRightToolDefinitions().map(({ id }, index) => [id, index]))

  return [...new Set(value.map(canonicalRightToolId).filter(isRightToolId))].sort(
    (left, right) => order.get(left)! - order.get(right)!,
  )
}

export function reconcileRightToolPreferences(value: unknown): RightToolPreferencesV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RIGHT_TOOL_SCHEMA_VERSION ||
    !Array.isArray(value.openToolIds) ||
    (value.activeToolId !== null && typeof value.activeToolId !== 'string')
  ) {
    return createDefaultRightToolPreferences()
  }

  const openToolIds = normalizeRightToolIds(value.openToolIds)
  const activeToolId = openToolIds.includes(canonicalRightToolId(value.activeToolId) as RightToolId)
    ? (canonicalRightToolId(value.activeToolId) as RightToolId)
    : (openToolIds[0] ?? null)
  const panelWidths = normalizePanelWidths(value.panelWidths)

  return {
    schemaVersion: RIGHT_TOOL_SCHEMA_VERSION,
    openToolIds,
    activeToolId,
    panelWidth: clampRightToolPanelWidth(value.panelWidth),
    ...(panelWidths ? { panelWidths } : {}),
  }
}

export function openRightTool(
  preferences: RightToolPreferencesV1,
  toolId: RightToolId,
): RightToolTransition {
  toolId = canonicalRightToolId(toolId) as RightToolId
  const current = reconcileRightToolPreferences(preferences)
  if (!isRightToolId(toolId)) return transition(current)
  const openToolIds = normalizeRightToolIds([...current.openToolIds, toolId])

  return transition({ ...current, openToolIds, activeToolId: toolId }, 'expand')
}

export function activateRightTool(
  preferences: RightToolPreferencesV1,
  toolId: RightToolId,
): RightToolTransition {
  toolId = canonicalRightToolId(toolId) as RightToolId
  const current = reconcileRightToolPreferences(preferences)
  if (!current.openToolIds.includes(toolId)) return transition(current)

  return transition({ ...current, activeToolId: toolId }, 'expand')
}

export function closeRightTool(
  preferences: RightToolPreferencesV1,
  toolId: RightToolId,
): RightToolTransition {
  toolId = canonicalRightToolId(toolId) as RightToolId
  const current = reconcileRightToolPreferences(preferences)
  const closingIndex = current.openToolIds.indexOf(toolId)
  if (closingIndex < 0) return transition(current)

  const openToolIds = current.openToolIds.filter((id) => id !== toolId)
  if (current.activeToolId !== toolId) {
    return transition({ ...current, openToolIds })
  }

  if (openToolIds.length === 0) {
    return transition({ ...current, openToolIds, activeToolId: null }, 'collapse')
  }

  const activeToolId = openToolIds[closingIndex] ?? openToolIds[closingIndex - 1]
  return transition({ ...current, openToolIds, activeToolId })
}

export function toggleRightToolFromRail(
  preferences: RightToolPreferencesV1,
  toolId: RightToolId,
): RightToolTransition {
  toolId = canonicalRightToolId(toolId) as RightToolId
  const current = reconcileRightToolPreferences(preferences)
  if (!current.openToolIds.includes(toolId)) return openRightTool(current, toolId)
  if (current.activeToolId !== toolId) return activateRightTool(current, toolId)

  return transition(current, 'toggle')
}

function transition(
  preferences: RightToolPreferencesV1,
  panelCollapseCommand: PanelCollapseCommand = 'none',
): RightToolTransition {
  return { preferences, panelCollapseCommand }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
