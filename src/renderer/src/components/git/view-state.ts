import { useCallback, useState } from 'react'
import type { GitHistoryScope } from '../../../../shared/ipc/git'

export interface GitViewState {
  tab: 'changes' | 'history'
  fileMode: 'tree' | 'list'
  fileSearch: string
  collapsed: Record<string, boolean>
  subject: string
  description: string
  descriptionOpen: boolean
  historyScope: GitHistoryScope
  historySearch: string
  selectedCommit: string | null
  selectedFile: string | null
  changesScroll: number
  historyScroll: number
}
const scopes = new Map<string, GitViewState>()
export const getGitViewState = (scope: string) => scopes.get(scope)
export function useGitViewState(scope: string) {
  const [state, setState] = useState<GitViewState>(() => scopes.get(scope) ?? {
    tab: 'changes', fileMode: 'tree', fileSearch: '', collapsed: {}, subject: '', description: '', descriptionOpen: false,
    historyScope: 'all', historySearch: '', selectedCommit: null, selectedFile: null, changesScroll: 0, historyScroll: 0,
  })
  if (!scopes.has(scope)) scopes.set(scope, state)
  const update = useCallback((patch: Partial<GitViewState>) => {
    const next = { ...scopes.get(scope)!, ...patch }
    scopes.set(scope, next)
    setState(next)
  }, [scope])
  // Scroll positions need no React render; drafts and view state live only in this app session.
  const saveScroll = (key: 'changesScroll' | 'historyScroll', value: number) => {
    scopes.set(scope, { ...(scopes.get(scope) ?? state), [key]: value })
  }
  return { state, update, saveScroll }
}
