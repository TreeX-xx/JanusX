import { isBlueprintBusy } from '../../../../plugins/blueprint/src/shared/blueprint-loading'
import { readReviewWithDeadline, REVIEW_READ_TIMEOUT_MS } from './blueprint-review-read'

/** A busy checkout is still loading. Switching workspaces cancels its wait. */
export async function readBlueprintWhenReady<T>(
  read: () => Promise<T>, signal: AbortSignal, onWaiting: () => void,
): Promise<T> {
  let delay = 250
  const deadline = Date.now() + REVIEW_READ_TIMEOUT_MS
  for (;;) {
    signal.throwIfAborted()
    try { return await readReviewWithDeadline(read, Math.max(0, deadline - Date.now()), signal) } catch (error) {
      if (signal.aborted || !isBlueprintBusy(error)) throw error
      onWaiting()
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, Math.min(delay, Math.max(0, deadline - Date.now())))
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) { signal.removeEventListener('abort', abort); abort() }
      })
      delay = Math.min(delay * 2, 3000)
    }
  }
}
