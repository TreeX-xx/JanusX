/** Electron may preserve only an Error's message across invoke. */
export function isBlueprintBusy(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
  return ['BUSY', 'EBUSY', 'EAGAIN'].includes(code)
    || /notes busy: lock held|\b(?:EBUSY|EAGAIN)\b/.test(message)
}
