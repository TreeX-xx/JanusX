// Note: .agents/notes/workbench/requirements/auxiliary-panels-preview-controls.md
import { create } from 'zustand'

// Presentation only: never overwrite the panels' user visibility preferences.
export const useAuxiliaryPanelsStore = create<{
  priority: 'tools' | 'editor'
  toolsCompact: boolean
  editorCompact: boolean
  activate: (priority: 'tools' | 'editor') => void
}>((set) => ({
  priority: 'editor', toolsCompact: false, editorCompact: false,
  activate: (priority) => set({ priority, ...(priority === 'editor' ? { editorCompact: false } : {}) }),
}))
