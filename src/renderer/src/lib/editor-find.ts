export interface FindableEditor {
  focus(): void
  getAction(id: string): { run(): void | Promise<void> } | null
  getDomNode?(): HTMLElement | null
}

export function isEditorFindShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f'
}

export function isMonacoKeyboardEvent(event: Pick<KeyboardEvent, 'target'>): boolean {
  const target = event.target as (EventTarget & { closest?: (selector: string) => Element | null }) | null
  return Boolean(target?.closest?.('.monaco-editor'))
}

export async function openEditorFind(editor: FindableEditor | null): Promise<boolean> {
  const action = editor?.getAction('actions.find')
  if (!editor || !action) return false
  editor.focus()
  await action.run()
  return true
}

/*
 * Monaco explains its find controls through the hover service, but that overlay is positioned on
 * top of the control it describes and used to swallow the click (see the .context-view rule in
 * globals.css, which now hides it). Native `title` attributes carry the same information without
 * the downside: the OS renders them outside the document, offset from the pointer, so they cannot
 * cover a control or intercept anything.
 *
 * Monaco only sets `aria-label` on these controls, so there is nothing to fall back on — the text
 * has to be supplied here. Keyed by Monaco's codicon class, which is also what the CSS rules use.
 */
const FIND_CONTROL_TITLES: ReadonlyArray<readonly [string, string]> = [
  ['codicon-find-previous-match', '上一个匹配 (Shift+Enter)'],
  ['codicon-find-next-match', '下一个匹配 (Enter)'],
  /*-- Monaco no-ops this one unless a non-empty selection exists, so say so up front. --*/
  ['codicon-find-selection', '在选定内容中查找 (Alt+L)：先在编辑器中选中一段文本，再点此按钮'],
  ['codicon-widget-close', '关闭查找 (Escape)'],
  ['codicon-case-sensitive', '区分大小写 (Alt+C)'],
  ['codicon-whole-word', '全字匹配 (Alt+W)'],
  ['codicon-regex', '使用正则表达式 (Alt+R)'],
]

/** Returns how many controls were labelled, so callers and tests can tell whether the widget was present. */
export function labelFindWidgetControls(root: ParentNode): number {
  let labelled = 0
  for (const [codicon, title] of FIND_CONTROL_TITLES) {
    for (const control of root.querySelectorAll<HTMLElement>(`.find-widget .${codicon}`)) {
      if (control.title !== title) control.title = title
      labelled += 1
    }
  }
  return labelled
}

/**
 * Labels the find controls the first time the pointer enters the widget.
 *
 * The widget is created lazily and may be opened by Monaco's own Ctrl+F (which never reaches
 * `openEditorFind`), so labelling cannot be tied to our own open path. A single capturing listener
 * is cheaper and calmer than observing an editor DOM that mutates on every keystroke, and it runs
 * exactly when the labels are about to matter. Once applied it detaches itself.
 */
export function watchFindWidgetControls(container: HTMLElement | null | undefined): () => void {
  if (!container) return () => undefined
  if (labelFindWidgetControls(container) > 0) return () => undefined

  const onPointerOver = (event: Event) => {
    const target = event.target as Element | null
    if (!target?.closest?.('.find-widget')) return
    if (labelFindWidgetControls(container) > 0) detach()
  }
  const detach = () => container.removeEventListener('pointerover', onPointerOver, true)

  container.addEventListener('pointerover', onPointerOver, true)
  return detach
}
