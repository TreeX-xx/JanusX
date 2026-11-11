import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { vi } from 'vitest'
import { I18nContext } from 'react-i18next'

type ElementProps = Record<string, unknown> & { children?: ReactNode }
export type TestElement = ReactElement<ElementProps>

const noop = () => undefined
const fallbackT = (key: string) => key
const fallbackI18nInstance = {
  t: fallbackT,
  options: { ns: ['common'], defaultNS: 'common' },
  language: 'zh-CN',
  languages: ['zh-CN'],
  initialized: true,
  isInitialized: true,
  initializedStoreOnce: true,
  hasLoadedNamespace: () => true,
  reportNamespaces: { addUsedNamespaces: noop, getUsedNamespaces: () => [] },
  on: noop,
  off: noop,
  store: { on: noop, off: noop },
  getFixedT: () => fallbackT,
}

const FALLBACK_I18N_CONTEXT = {
  i18n: fallbackI18nInstance,
  t: fallbackT,
  i18nInstance: fallbackI18nInstance,
  ready: true,
}

export function withSynchronousHooks<T>(render: () => T): T {
  const internals = (React as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      ReactCurrentDispatcher: { current: unknown }
    }
  }).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  const previous = internals.ReactCurrentDispatcher.current
  let nextId = 0

  internals.ReactCurrentDispatcher.current = {
    useCallback: <V,>(callback: V) => callback,
    useContext: (context: unknown) => {
      if (context === I18nContext) return FALLBACK_I18N_CONTEXT
      return undefined
    },
    useEffect: () => undefined,
    useId: () => `test-id-${nextId++}`,
    useLayoutEffect: () => undefined,
    useMemo: <V,>(factory: () => V) => factory(),
    useReducer: <V,>(initial: V) => [initial, vi.fn()],
    useRef: <V,>(value: V) => ({ current: value }),
    useState: <V,>(initial: V | (() => V)) => [
      typeof initial === 'function' ? (initial as () => V)() : initial,
      vi.fn(),
    ],
    useSyncExternalStore: <V,>(subscribe: unknown, getSnapshot: () => V) => getSnapshot(),
  }

  try {
    return render()
  } finally {
    internals.ReactCurrentDispatcher.current = previous
  }
}

export function findElement(root: ReactNode, predicate: (element: TestElement) => boolean): TestElement {
  if (isValidElement<ElementProps>(root)) {
    if (predicate(root)) return root
    for (const child of Children.toArray(root.props.children)) {
      try {
        return findElement(child, predicate)
      } catch {
        // Continue through sibling branches.
      }
    }
  }
  throw new Error('Element not found')
}
