import { useEffect, useState } from 'react'

/** Live surfaces follow plugin activation. Saved work remains a host query. */
export function useSuperAgentAvailability(workspaceId?: string | null, enabled = true) {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!enabled) { setAvailable(false); return }
    let revision = 0
    const check = () => {
      const current = ++revision
      const result = window.electron.superAgent?.available?.(workspaceId ?? undefined)
      if (!result) { setAvailable(false); return }
      void result.then(ready => { if (current === revision) setAvailable(ready) },
        () => { if (current === revision) setAvailable(false) })
    }
    check()
    const unsubscribe = window.electron.plugins?.onChanged?.(check)
    return () => { revision++; unsubscribe?.() }
  }, [workspaceId, enabled])
  return available
}
