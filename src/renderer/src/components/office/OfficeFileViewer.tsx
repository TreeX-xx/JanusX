import { useEffect, useState } from 'react'
import type { OfficeErrorCode, OfficePreviewLease } from '../../../../shared/office'
import { officeService } from '@/services/office'
import { OfficePreviewFrame } from './OfficePreviewFrame'

// Note: leases belong to the mounted host, not the migrating file session.
// .agents/notes/workbench/unified-file-window.md
export function OfficeFileViewer({ absolutePath, onClose }: { absolutePath: string; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState<{ port?: number; status: 'starting' | 'ready' | 'error'; errorCode?: OfficeErrorCode }>({ status: 'starting' })
  useEffect(() => {
    let disposed = false
    let stop: (() => Promise<unknown>) | undefined
    let unsubscribe: (() => void) | undefined
    setPreview({ status: 'starting' })
    void (async () => {
      const workspaces = await window.electron.workspace.list()
      const normalized = absolutePath.replace(/\\/g, '/')
      const fold = (path: string) => /^[a-z]:/i.test(path) || path.startsWith('//') ? path.toLowerCase() : path
      let workspace = workspaces.filter(item => fold(normalized).startsWith(fold(item.path.replace(/\\/g, '/').replace(/\/+$/, '')) + '/')).sort((a, b) => b.path.length - a.path.length)[0]
      let scopePath = workspace?.path
      if (!workspace) {
        for (const candidate of workspaces) {
          const trees = await window.electron.worktree.list(candidate.id, candidate.path).catch(() => [])
          const tree = trees.filter(item => fold(normalized).startsWith(fold(item.path.replace(/\\/g, '/').replace(/\/+$/, '')) + '/')).sort((a, b) => b.path.length - a.path.length)[0]
          if (tree) { workspace = candidate; scopePath = tree.path; break }
        }
      }
      if (!workspace || !scopePath) { if (!disposed) setPreview({ status: 'error', errorCode: 'OUTSIDE_ROOT' }); return }
      const relative = normalized.slice(scopePath.replace(/[\\/]+$/, '').length + 1)
      const relPath = scopePath.startsWith('janusx-workspace://') ? relative.split('/').map(decodeURIComponent).join('/') : relative
      const result = await officeService.startPreview({ workspaceId: workspace.id, scopePath, relPath })
      if (!result.ok) { if (!disposed) setPreview({ status: 'error', errorCode: result.error.code }); return }
      const lease: OfficePreviewLease = result.value
      stop = () => officeService.stopPreview({ workspaceId: workspace.id, relPath, previewLeaseId: lease.previewLeaseId })
      if (disposed) { await stop(); return }
      setPreview({ status: 'ready', port: lease.port })
      unsubscribe = officeService.onWatchEvicted(event => {
        if (event.previewLeaseIds.includes(lease.previewLeaseId)) setPreview({ status: 'error', errorCode: 'UNAVAILABLE' })
      })
    })().catch(() => { if (!disposed) setPreview({ status: 'error', errorCode: 'UNAVAILABLE' }) })
    return () => { disposed = true; unsubscribe?.(); void stop?.().catch(console.error) }
  }, [absolutePath, attempt])
  return <OfficePreviewFrame {...preview} onRetry={() => setAttempt(value => value + 1)} onClose={onClose} />
}
