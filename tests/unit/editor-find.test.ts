import { describe, expect, it, vi } from 'vitest'
import {
  isEditorFindShortcut,
  isMonacoKeyboardEvent,
  labelFindWidgetControls,
  openEditorFind,
  watchFindWidgetControls,
  type FindableEditor,
} from '../../src/renderer/src/lib/editor-find'

describe('editor find', () => {
  it('recognizes Ctrl+F and Cmd+F regardless of key casing', () => {
    expect(isEditorFindShortcut({ ctrlKey: true, metaKey: false, key: 'f' })).toBe(true)
    expect(isEditorFindShortcut({ ctrlKey: false, metaKey: true, key: 'F' })).toBe(true)
    expect(isEditorFindShortcut({ ctrlKey: false, metaKey: false, key: 'f' })).toBe(false)
    expect(isEditorFindShortcut({ ctrlKey: true, metaKey: false, key: 'g' })).toBe(false)
  })

  it('leaves shortcuts from inside Monaco to Monaco itself', () => {
    const monacoTarget = { closest: vi.fn(() => ({ className: 'monaco-editor' })) } as unknown as EventTarget
    const outsideTarget = { closest: vi.fn(() => null) } as unknown as EventTarget

    expect(isMonacoKeyboardEvent({ target: monacoTarget })).toBe(true)
    expect(isMonacoKeyboardEvent({ target: outsideTarget })).toBe(false)
    expect(isMonacoKeyboardEvent({ target: null })).toBe(false)
  })

  it('focuses Monaco and opens its native find action', async () => {
    const run = vi.fn()
    const editor: FindableEditor = {
      focus: vi.fn(),
      getAction: vi.fn(() => ({ run })),
    }

    await expect(openEditorFind(editor)).resolves.toBe(true)
    expect(editor.getAction).toHaveBeenCalledWith('actions.find')
    expect(editor.focus).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledOnce()
  })

  it('does nothing when no editor or find action is available', async () => {
    const editor: FindableEditor = {
      focus: vi.fn(),
      getAction: vi.fn(() => null),
    }

    await expect(openEditorFind(null)).resolves.toBe(false)
    await expect(openEditorFind(editor)).resolves.toBe(false)
    expect(editor.focus).not.toHaveBeenCalled()
  })
})

/*
 * Monaco's own hover labels are hidden in globals.css because they covered the controls they
 * described, so native titles are the only thing left explaining these icons.
 *
 * The suite runs in the node environment, so these cover the selector-to-title mapping against a
 * fake root. Real DOM behaviour is asserted in tests/e2e/editor-find-widget.spec.ts, which drives
 * an actual Electron window.
 */
describe('find widget control labels', () => {
  const ALL_CONTROLS = [
    'codicon-find-previous-match',
    'codicon-find-next-match',
    'codicon-find-selection',
    'codicon-widget-close',
    'codicon-case-sensitive',
    'codicon-whole-word',
    'codicon-regex',
  ]

  const createRoot = (codicons: string[] = ALL_CONTROLS) => {
    const controls = new Map(codicons.map((codicon) => [codicon, { title: '' }]))
    return {
      controls,
      asParentNode: {
        querySelectorAll: (selector: string) => {
          const codicon = /^\.find-widget \.([\w-]+)$/.exec(selector)?.[1]
          const control = codicon ? controls.get(codicon) : undefined
          return control ? [control] : []
        },
      } as unknown as ParentNode,
    }
  }

  it('labels every find control, options included', () => {
    const root = createRoot()

    expect(labelFindWidgetControls(root.asParentNode)).toBe(ALL_CONTROLS.length)
    expect(root.controls.get('codicon-find-previous-match')!.title).toContain('上一个匹配')
    expect(root.controls.get('codicon-find-next-match')!.title).toContain('下一个匹配')
    expect(root.controls.get('codicon-widget-close')!.title).toContain('Escape')
    expect(root.controls.get('codicon-case-sensitive')!.title).toContain('区分大小写')
    expect(root.controls.get('codicon-whole-word')!.title).toContain('全字匹配')
    expect(root.controls.get('codicon-regex')!.title).toContain('正则')
  })

  it('spells out that Find in Selection needs a selection, since Monaco silently no-ops without one', () => {
    const root = createRoot()
    labelFindWidgetControls(root.asParentNode)

    const title = root.controls.get('codicon-find-selection')!.title
    expect(title).toContain('Alt+L')
    expect(title).toContain('选中')
  })

  it('reports nothing to label when the widget has not been created yet', () => {
    expect(labelFindWidgetControls(createRoot([]).asParentNode)).toBe(0)
  })

  it('labels immediately when the widget already exists, without attaching a listener', () => {
    const root = createRoot()
    const container = Object.assign(root.asParentNode, {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as HTMLElement & { addEventListener: ReturnType<typeof vi.fn> }

    watchFindWidgetControls(container)

    expect(container.addEventListener).not.toHaveBeenCalled()
    expect(root.controls.get('codicon-widget-close')!.title).toContain('Escape')
  })

  it('waits for the pointer when the widget is still lazy, then detaches once labelled', () => {
    // Monaco's own Ctrl+F never reaches our open path, so labelling is driven by the pointer.
    const empty = createRoot([])
    let live = empty
    const listeners: Array<(event: unknown) => void> = []
    const container = {
      querySelectorAll: (selector: string) => live.asParentNode.querySelectorAll(selector),
      addEventListener: vi.fn((_type: string, handler: (event: unknown) => void) => {
        listeners.push(handler)
      }),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement & {
      addEventListener: ReturnType<typeof vi.fn>
      removeEventListener: ReturnType<typeof vi.fn>
    }

    watchFindWidgetControls(container)
    expect(container.addEventListener).toHaveBeenCalledWith('pointerover', expect.any(Function), true)

    live = createRoot()
    listeners[0]({ target: { closest: (selector: string) => (selector === '.find-widget' ? {} : null) } })

    expect(live.controls.get('codicon-widget-close')!.title).toContain('Escape')
    expect(container.removeEventListener).toHaveBeenCalledWith('pointerover', expect.any(Function), true)
  })

  it('tolerates a missing editor dom node', () => {
    expect(() => watchFindWidgetControls(null)()).not.toThrow()
  })
})
