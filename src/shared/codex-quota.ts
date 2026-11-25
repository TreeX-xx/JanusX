// Note: .agents/notes/workbench/runtime-drawer-cards-resize.md
export type QuotaReadReason = 'visible' | 'details' | 'manual' | 'reset'
export const QUOTA_FRESH_MS = 60_000
export const QUOTA_DETAILS_MS = 5 * 60_000
export const QUOTA_MANUAL_MS = 10_000

export interface CodexQuotaWindow {
  used: number
  minutes: number | null
  resetsAt: number | null // Unix milliseconds
  updatedAt: number
}
export interface CodexQuota {
  primary: CodexQuotaWindow | null
  secondary: CodexQuotaWindow | null
  updatedAt: number | null
  unavailable: boolean
  blocked: boolean
}
export interface CodexQuotaEvent {
  id: string
  quota: CodexQuota | null
  recheck?: boolean
}
