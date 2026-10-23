import { lazy, Suspense } from 'react'
import { useEditorStore } from '@/stores/editor'
const FileWindow = lazy(() => import('./StandaloneFileEditor').then(module => ({ default: module.StandaloneFileEditor })))
// Note: same content and toolbar in both hosts ? .agents/notes/workbench/unified-file-window.md
export function FileEditor({ active = true }: { active?: boolean }) {
  const hasFiles = useEditorStore(state => state.openFiles.length > 0)
  return hasFiles ? <Suspense fallback={null}><FileWindow embedded active={active} /></Suspense> : null
}
