// Note: .agents/notes/desktop/application-shutdown.md
let quitting = false

/** Set before renderer acknowledgement or resource cleanup can run callbacks. */
export function markApplicationQuitting(): void { quitting = true }
export function isApplicationQuitting(): boolean { return quitting }
export function assertApplicationRunning(): void {
  if (quitting) throw new Error('Application is quitting')
}
