import { create } from 'zustand'
import type { HostedConnection, HostedQuery } from '../../../shared/ipc/hosted'
import { hostedCache } from '@/lib/hosted-cache'

const pending = new Map<string, Promise<HostedConnection | null>>()
const checkedAt = new Map<string, number>()
export interface RepositoryView {
  tab: 'overview' | 'issue' | 'review'
  query: HostedQuery
  selected: { kind: 'issue' | 'review'; number: number } | null
  scrollTop: number
  tabs?: Partial<Record<'issue' | 'review', { query: HostedQuery; scrollTop: number }>>
}
export const DEFAULT_REPOSITORY_VIEW: RepositoryView = {
  tab: 'overview',
  query: { kind: 'issue', state: 'open', filter: 'all', search: '', page: 1 }, selected: null, scrollTop: 0,
}
interface HostedStore {
  connections: Record<string, HostedConnection | null>
  loginPath: string | null
  revision: number
  views: Record<string, RepositoryView>
  refresh: (path: string) => Promise<HostedConnection | null>
  ensure: (path: string) => Promise<HostedConnection | null>
  signIn: (path: string | null) => void
  authorized: () => void
  setView: (path: string, view: RepositoryView) => void
}
export const useHostedStore = create<HostedStore>((set, get) => ({
  connections: {}, loginPath: null, revision: 0, views: {},
  refresh: (path) => {
    const existing = pending.get(path)
    if (existing) return existing
    const revision = get().revision
    const request = window.electron.hosted.connection(path).then(connection => {
      if (revision !== get().revision) throw new Error('Authorization session changed')
      checkedAt.set(path, Date.now())
      if (connection?.status === 'unauthenticated' && get().connections[path]?.status === 'ready') { hostedCache.clear(); set(state => ({ revision: state.revision + 1 })) }
      set(state => ({ connections: { ...state.connections, [path]: connection } }))
      return connection
    }).finally(() => { if (pending.get(path) === request) pending.delete(path) })
    pending.set(path, request)
    return request
  },
  ensure: path => get().connections[path]?.status === 'ready' && Date.now() - (checkedAt.get(path) ?? 0) < 60_000
    ? Promise.resolve(get().connections[path]) : get().refresh(path),
  signIn: loginPath => set({ loginPath }),
  authorized: () => { hostedCache.clear(); pending.clear(); checkedAt.clear(); set(state => ({ connections: {}, revision: state.revision + 1, loginPath: null })) },
  setView: (path, view) => set(state => ({ views: { ...state.views, [path]: { ...view, tabs: { ...view.tabs, [view.query.kind]: { query: view.query, scrollTop: view.scrollTop } } } } })),
}))

hostedCache.onAuthFailure = () => {
  hostedCache.clear(); pending.clear(); checkedAt.clear()
  useHostedStore.setState(state => ({ revision: state.revision + 1, views: {}, connections: Object.fromEntries(Object.entries(state.connections).map(([path, connection]) => [path, connection ? { ...connection, status: 'unauthenticated' as const } : null])) }))
}
