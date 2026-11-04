import { useCallback, useEffect, useRef, useState } from 'react'
import { hostedCache } from '@/lib/hosted-cache'

/** Show retained data immediately; only missing/expired resources perform a read. */
export function useHostedResource<T>(key: string | null, loader: () => Promise<T>, ttl: number, refreshKey = 0) {
  const loadRef = useRef(loader)
  loadRef.current = loader
  const currentKey = useRef(key)
  currentKey.current = key
  const [state, setState] = useState<{ key: string | null; data?: T; loading: boolean; error: string }>({ key, data: key ? hostedCache.peek<T>(key) : undefined, loading: false, error: '' })
  const mounted = useRef(true)
  const sequence = useRef(0)
  useEffect(() => { mounted.current = true; const requests = sequence; return () => { mounted.current = false; requests.current++ } }, [])
  const refresh = useCallback(async (force = true) => {
    if (!key) return undefined
    const id = ++sequence.current
    const cached = hostedCache.peek<T>(key)
    setState({ key, data: cached, loading: force || !hostedCache.fresh(key), error: '' })
    try {
      const data = await hostedCache.load(key, loadRef.current, ttl, force)
      if (mounted.current && currentKey.current === key && sequence.current === id) setState({ key, data, loading: false, error: '' })
      return data
    } catch (error) {
      if (mounted.current && currentKey.current === key && sequence.current === id) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }))
      return undefined
    }
  }, [key, ttl])
  const previousRefresh = useRef(refreshKey)
  useEffect(() => {
    const requests = sequence
    const force = previousRefresh.current !== refreshKey
    previousRefresh.current = refreshKey
    void refresh(force)
    return () => { requests.current++ }
  }, [refresh, refreshKey])
  const setData = useCallback((updater: T | ((previous: T | undefined) => T)) => {
    if (!key) return
    const value = typeof updater === 'function' ? (updater as (previous: T | undefined) => T)(hostedCache.peek<T>(key)) : updater
    hostedCache.set(key, value, ttl)
    if (mounted.current && currentKey.current === key) setState(previous => ({ ...previous, key, data: value }))
  }, [key, ttl])
  const same = state.key === key
  return { data: same ? state.data : key ? hostedCache.peek<T>(key) : undefined, loading: same ? state.loading : !!key, error: same ? state.error : '', refresh, setData }
}
