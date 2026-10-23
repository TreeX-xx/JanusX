import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/stores/editor'
import { useI18n } from '@/i18n/useI18n'
import styles from './EditorCloseDialog.module.css'
import { useBrowserOcclusion } from '@/hooks/useBrowserOcclusion'

interface CloseRequest {
  ids: string[]
  action: () => void | Promise<void>
}

/** Shared by tab, panel and native-window close paths. Failed saves never close. */
export function useEditorCloseDialog() {
  const { t } = useI18n('editor')
  const [request, setRequest] = useState<CloseRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingRef = useRef<CloseRequest | null>(null)
  const busyRef = useRef(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openFiles = useEditorStore(state => state.openFiles)
  const dirtyFiles = openFiles.filter(file => request?.ids.includes(file.id) && file.isDirty)
  useBrowserOcclusion(Boolean(request))

  useEffect(() => {
    if (request) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [request])

  const confirmClose = useCallback((ids: string[], action: CloseRequest['action']) => {
    if (pendingRef.current) return
    const dirty = useEditorStore.getState().openFiles.some(file => ids.includes(file.id) && file.isDirty)
    if (!dirty) { void action(); return }
    const next = { ids, action }
    pendingRef.current = next
    setError('')
    setRequest(next)
  }, [])

  const cancel = () => {
    if (busyRef.current) return
    pendingRef.current = null
    setRequest(null)
  }

  const finish = async (save: boolean) => {
    const pending = pendingRef.current
    if (!pending || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      if (save) {
        for (const id of pending.ids) {
          const state = useEditorStore.getState()
          const file = state.openFiles.find(item => item.id === id)
          if (file?.isDirty && (!await state.saveFile(id) || useEditorStore.getState().openFiles.find(item => item.id === id)?.isDirty)) {
            setError(t('editor:fileEditor.saveFailed', { name: file.name }))
            return
          }
        }
      }
      await pending.action()
      pendingRef.current = null
      setRequest(null)
    } catch (cause) {
      setError(String(cause))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const closeDialog = (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="editor-close-title" aria-describedby="editor-close-description" tabIndex={-1}
      onKeyDown={event => {
        if (event.key !== 'Tab') return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const target = event.shiftKey ? buttons.at(-1) : buttons[0]
        if (!buttons.length || (event.shiftKey ? document.activeElement === buttons[0] : document.activeElement === buttons.at(-1))) {
          event.preventDefault()
          target?.focus()
        }
      }}
      onCancel={event => { event.preventDefault(); cancel() }}>
      <h2 id="editor-close-title">{t('editor:fileEditor.unsavedTitle')}</h2>
      <p id="editor-close-description">{t('editor:fileEditor.unsavedDescription')}</p>
      <ul>{dirtyFiles.map(file => <li key={file.id} title={file.absolutePath}>{file.path}</li>)}</ul>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={cancel} autoFocus>{t('editor:fileEditor.cancelClose')}</button>
        <button type="button" disabled={busy} onClick={() => void finish(false)}>{t('editor:fileEditor.discardClose')}</button>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void finish(true)}>
          {t(busy ? 'editor:fileEditor.saving' : 'editor:fileEditor.saveClose')}
        </button>
      </div>
    </dialog>
  )
  return { confirmClose, closeDialog }
}
