import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type AriaAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { referenceToken, conversationPrompt, type ConversationReference } from '../../../shared/conversation-context'
import { loadLocalAssetDataUrl } from './viewers/local-asset'
import styles from './ConversationInput.module.css'

// Inline reference editing contract: .agents/notes/workbench/terminal-dialog-dual-mode.md

export interface ConversationInputHandle {
  element: HTMLDivElement | null
  value: string
  selectionStart: number
  selectionEnd: number
  isConnected: boolean
  form: HTMLFormElement | null
  focus(): void
  setSelectionRange(start: number, end: number): void
  isHistoryBoundary(key: 'ArrowUp' | 'ArrowDown'): boolean
  insertReferences(refs: ConversationReference[], range?: [number, number]): void
  captureInsertionRange(): () => [number, number]
  setDropPoint(x: number, y: number): void
}

// The editable DOM owns selection and native undo. Drafts serialize tokens, never HTML.
function read(node: Node): string {
  // A lone BR holds the caret in an empty block; it is not another newline.
  if (node instanceof HTMLElement && /^(DIV|P)$/.test(node.nodeName) && node.innerHTML === '<br>') return ''
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node instanceof HTMLElement && node.dataset.referenceToken) return node.dataset.referenceToken
  if (node.nodeName === 'BR') return '\n'
  return Array.from(node.childNodes).map((child, index) =>
    (index > 0 && /^(DIV|P)$/.test(child.nodeName) ? '\n' : '') + read(child)).join('')
}
function offsets(root: HTMLElement, savedRange?: Range): [number, number] | null {
  const selection = window.getSelection()
  const range = savedRange ?? (selection?.rangeCount ? selection.getRangeAt(0) : null)
  if (!range) return null
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const prefix = document.createRange(); prefix.selectNodeContents(root)
  prefix.setEnd(range.startContainer, range.startOffset)
  const start = read(prefix.cloneContents()).length
  prefix.setEnd(range.endContainer, range.endOffset)
  return [start, read(prefix.cloneContents()).length]
}
function isHistoryBoundary(root: HTMLElement, key: 'ArrowUp' | 'ArrowDown'): boolean {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed) return false
  const caret = selection.getRangeAt(0).cloneRange()
  if (!root.contains(caret.startContainer)) return false
  if (!read(root)) return true
  let rects = Array.from(caret.getClientRects())
  if (!rects.length && caret.startContainer.nodeType === Node.ELEMENT_NODE) {
    const child = caret.startContainer.childNodes[caret.startOffset]
    if (child) {
      caret.selectNodeContents(child); caret.collapse(true)
      rects = Array.from(caret.getClientRects())
      if (!rects.length && (child.nodeName === 'BR' || child instanceof HTMLElement && child.contentEditable === 'false')) {
        caret.selectNode(child); rects = Array.from(caret.getClientRects())
      }
    }
  }
  // If the browser cannot locate the caret, leave its editing keys alone.
  if (!rects.length) return false
  const contents = document.createRange(); contents.selectNodeContents(root)
  const bounds = contents.getBoundingClientRect()
  const tolerance = parseFloat(getComputedStyle(root).lineHeight) / 2
  // A wrap boundary can have two caret rects. Prefer editing over history there.
  return key === 'ArrowUp'
    ? Math.max(...rects.map(rect => rect.top)) <= bounds.top + tolerance
    : Math.min(...rects.map(rect => rect.bottom)) >= bounds.bottom - tolerance
}
function select(root: HTMLElement, start: number, end: number) {
  const point = (offset: number): [Node, number] => {
    let remaining = offset
    const visit = (node: Node): [Node, number] | null => {
      if (node.nodeType === Node.TEXT_NODE) {
        const length = node.textContent?.length ?? 0
        if (remaining <= length) return [node, remaining]
        remaining -= length; return null
      }
      if (node instanceof HTMLElement && node.dataset.referenceToken || node.nodeName === 'BR') {
        const length = read(node).length
        if (remaining <= length) return [node.parentNode!, Array.from(node.parentNode!.childNodes).indexOf(node as ChildNode) + (remaining ? 1 : 0)]
        remaining -= length; return null
      }
      for (const [index, child] of Array.from(node.childNodes).entries()) {
        if (index > 0 && /^(DIV|P)$/.test(child.nodeName)) { if (!remaining) return [node, index]; remaining-- }
        const result = visit(child); if (result) return result
      }
      return null
    }
    return visit(root) ?? [root, root.childNodes.length]
  }
  const range = document.createRange(); range.setStart(...point(start)); range.setEnd(...point(end))
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
}

export const ConversationInput = forwardRef<ConversationInputHandle, {
  value: string; references: ConversationReference[]; disabled: boolean; placeholder: string; label: string; title: string
  onChange(value: string): void; onKeyDown(event: KeyboardEvent<HTMLDivElement>): void
} & AriaAttributes>(function ConversationInput({ value, references, disabled, placeholder, label, title, onChange, onKeyDown, ...aria }, ref) {
  const { t } = useTranslation('terminal')
  const root = useRef<HTMLDivElement>(null)
  const caret = useRef<[number, number]>([value.length, value.length])
  const composing = useRef(false)
  const latest = useRef({ value, references, onChange }); latest.current = { value, references, onChange }
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const previewTrigger = useRef<HTMLButtonElement | null>(null)
  const dragging = useRef<{ token: string; start: number } | null>(null)
  const remember = () => { if (root.current) caret.current = offsets(root.current) ?? caret.current }
  const fragment = (text: string, refs = latest.current.references) => {
    const result = document.createElement('div')
    for (const part of text.split(/(\[\[ref:[^\]]+\]\])/g)) {
      const reference = refs.find(item => referenceToken(item) === part)
      if (!reference) { result.append(document.createTextNode(part)); continue }
      const chip = document.createElement('span')
      chip.contentEditable = 'false'; chip.draggable = true; chip.className = styles.reference
      chip.dataset.referenceToken = part; chip.dataset.referenceId = reference.id; chip.title = reference.path + (reference.quote ? '\n' + reference.quote : '')
      const name = document.createElement('span'); name.textContent = reference.name
      if (reference.kind === 'image') {
        const image = document.createElement('img'); image.alt = reference.name; image.hidden = true
        const previewButton = document.createElement('button'); previewButton.type = 'button'; previewButton.dataset.preview = reference.id
        previewButton.disabled = true
        previewButton.setAttribute('aria-label', `${t('conversation.images.preview')}: ${reference.name}`); previewButton.append(image, name); chip.append(previewButton)
      } else chip.append(name)
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.dataset.remove = part
      remove.setAttribute('aria-label', t('conversation.context.remove', { name: reference.name })); chip.append(remove)
      result.append(chip)
    }
    return result
  }
  const restore = (editor: HTMLElement, text: string) => {
    const lines = text.split('\n')
    editor.replaceChildren(...(lines.length === 1 ? Array.from(fragment(text).childNodes) : lines.map(line => {
      const block = fragment(line)
      if (!line) block.replaceChildren(document.createElement('br'))
      return block
    })))
    editor.dataset.inputEmpty = String(text.length === 0)
  }
  const publish = () => {
    if (!root.current) return
    const text = read(root.current)
    // CSS :only-child ignores text nodes; use the whole draft, including IME text.
    root.current.dataset.inputEmpty = String(text.length === 0)
    if (composing.current) return
    remember()
    if (text.length > 32000) { restore(root.current, latest.current.value); select(root.current, latest.current.value.length, latest.current.value.length); return }
    latest.current.value = text
    latest.current.onChange(text)
  }
  const insert = (text: string, refs = latest.current.references, range = caret.current) => {
    if (!root.current || disabled) return
    root.current.focus(); select(root.current, ...range)
    // Chromium's editing command keeps insertion/deletion in its native undo stack.
    document.execCommand('insertHTML', false, fragment(text, refs).innerHTML)
    publish()
  }
  useImperativeHandle(ref, () => ({
    get element() { return root.current }, get value() { return root.current ? read(root.current) : latest.current.value },
    get form() { return root.current?.closest('form') ?? null }, get isConnected() { return !!root.current?.isConnected },
    get selectionStart() { remember(); return caret.current[0] }, get selectionEnd() { remember(); return caret.current[1] },
    focus() { root.current?.focus() },
    setSelectionRange(start, end) { caret.current = [start, end]; if (root.current) select(root.current, start, end) },
    isHistoryBoundary(key) { return !!root.current && isHistoryBoundary(root.current, key) },
    insertReferences(refs, range) { insert(refs.map(referenceToken).join(' ') + ' ', [...latest.current.references, ...refs], range) },
    captureInsertionRange() {
      const editor = root.current!
      remember()
      select(editor, ...caret.current)
      // A live DOM Range follows edits before the drop point without following
      // subsequent caret moves while the attachment is being imported.
      const range = window.getSelection()!.getRangeAt(0).cloneRange()
      return () => offsets(editor, range) ?? [read(editor).length, read(editor).length]
    },
    setDropPoint(x, y) {
      const range = document.caretRangeFromPoint(x, y)
      if (range && root.current?.contains(range.startContainer)) { root.current.focus({ preventScroll: true }); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(range); remember() }
    },
  }))
  useLayoutEffect(() => {
    const editor = root.current
    if (!editor) return
    const text = read(editor)
    editor.dataset.inputEmpty = String(text.length === 0)
    if (composing.current || text === value) return
    const focused = editor.contains(document.activeElement)
    const position = offsets(editor) ?? caret.current
    restore(editor, value)
    if (focused) select(editor, Math.min(position[0], value.length), Math.min(position[1], value.length))
  })
  useLayoutEffect(() => {
    for (const chip of root.current?.querySelectorAll<HTMLElement>('[data-reference-id]') ?? []) {
      const image = chip.querySelector('img')
      const reference = references.find(item => item.id === chip.dataset.referenceId)
      if (image && !image.dataset.loading && reference) {
        image.dataset.loading = 'true'
        const button = image.parentElement as HTMLButtonElement
        const failed = () => {
          if (!image.isConnected) return
          image.hidden = true; button.disabled = true
          if (!chip.querySelector('[data-image-error]')) { const error = document.createElement('span'); error.dataset.imageError = ''; error.textContent = t('conversation.images.unavailable'); chip.append(error) }
        }
        image.onload = () => { image.hidden = false; button.disabled = false }
        image.onerror = failed
        void loadLocalAssetDataUrl(reference.path).then(url => { if (url && image.isConnected) image.src = url; else failed() }).catch(failed)
      }
    }
  })
  return <>
    <div {...aria} ref={root} className={styles.editor} data-conversation-input contentEditable={!disabled} suppressContentEditableWarning
      role="combobox" aria-multiline="true" aria-disabled={disabled} aria-label={label} title={title} data-placeholder={placeholder} spellCheck={false}
      onInput={publish} onBlur={remember} onKeyUp={remember} onMouseUp={remember}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false; publish() }}
      onKeyDown={event => {
        if (!disabled && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229 && (event.key === 'Enter' && event.shiftKey || event.key.toLowerCase() === 'j' && event.ctrlKey && !event.altKey && !event.metaKey)) {
          event.preventDefault(); event.stopPropagation()
          // Native paragraphs create a visible empty line and preserve undo/caret.
          document.execCommand('insertParagraph'); publish(); return
        }
        onKeyDown(event)
      }}
      onPaste={event => {
        if (event.clipboardData.files.length) return
        event.preventDefault(); remember()
        const internal = event.clipboardData.getData('application/x-janusx-reference-text')
        const known = internal && [...internal.matchAll(/\[\[ref:[^\]]+\]\]/g)].every(([token]) => latest.current.references.some(r => referenceToken(r) === token))
        insert(known ? internal : event.clipboardData.getData('text/plain'))
      }}
      onCopy={event => {
        const selection = window.getSelection(); if (!selection?.rangeCount) return
        const text = read(selection.getRangeAt(0).cloneContents())
        event.preventDefault(); event.clipboardData.setData('text/plain', conversationPrompt(text, latest.current.references.filter(r => text.includes(referenceToken(r)))))
        event.clipboardData.setData('application/x-janusx-reference-text', text)
      }}
      onCut={event => {
        const selection = window.getSelection(); if (!selection?.rangeCount || disabled) return
        const text = read(selection.getRangeAt(0).cloneContents())
        event.preventDefault(); event.clipboardData.setData('text/plain', conversationPrompt(text, latest.current.references.filter(r => text.includes(referenceToken(r)))))
        event.clipboardData.setData('application/x-janusx-reference-text', text)
        remember(); insert('')
      }}
      onClick={event => {
        const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
        if (target?.dataset.remove) {
          const token = target.dataset.remove; const chip = target.closest('[data-reference-token]')!
          const range = document.createRange(); range.selectNode(chip); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(range)
          remember(); if (read(root.current!).includes(token)) insert('')
        } else if (target?.dataset.preview) {
          previewTrigger.current = target
          const reference = latest.current.references.find(r => r.id === target.dataset.preview)
          if (reference) void loadLocalAssetDataUrl(reference.path).then(url => { if (url) { setPreview({ name: reference.name, url }); requestAnimationFrame(() => dialog.current?.showModal()) } }).catch(() => {})
        }
      }}
      onDragStart={event => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-reference-token]')
        if (!chip) return
        const prefix = document.createRange(); prefix.selectNodeContents(root.current!); prefix.setEndBefore(chip)
        dragging.current = { token: chip.dataset.referenceToken!, start: read(prefix.cloneContents()).length }
        event.dataTransfer.setData('application/x-janusx-inline-reference', chip.dataset.referenceToken!)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={event => { if (dragging.current) { event.preventDefault(); const range = document.caretRangeFromPoint(event.clientX, event.clientY); if (range && root.current?.contains(range.startContainer)) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(range); remember() } } }}
      onDragEnd={() => { dragging.current = null }}
      onDrop={event => {
        const move = dragging.current; if (!move) return
        event.preventDefault(); event.stopPropagation(); remember()
        const text = read(root.current!), end = move.start + move.token.length, drop = caret.current[0]
        if (drop < move.start || drop > end) {
          const without = text.slice(0, move.start) + text.slice(end), position = drop > end ? drop - move.token.length : drop
          insert(without.slice(0, position) + move.token + without.slice(position), latest.current.references, [0, text.length])
          select(root.current!, position + move.token.length, position + move.token.length)
        }
        dragging.current = null
      }} />
    <dialog ref={dialog} className={styles.preview} aria-label={preview ? `${t('conversation.images.preview')}: ${preview.name}` : undefined} onClose={() => { setPreview(null); if (previewTrigger.current?.isConnected) previewTrigger.current.focus(); else root.current?.focus() }} onKeyDown={event => event.stopPropagation()}>
      <button type="button" onClick={() => dialog.current?.close()} aria-label={t('conversation.images.close')}>×</button>
      {preview && <img src={preview.url} alt={preview.name} />}
    </dialog>
  </>
})
