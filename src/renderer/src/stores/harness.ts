/**
 * @file Harness Store — project scope, bindings, share, conflict notices
 * @description Thin state over services/harness.ts. The canvas keeps reading
 *  the Blueprint projection through stores/blueprint.ts; this store owns only
 *  the S4 additions: which repo is bound, share previews, and save conflicts.
 */
import { create } from 'zustand'
import {
  getBindings,
  rescanProject,
  resolveProject,
  setBinding,
  shareExport,
  shareImportApply,
  shareImportPreview,
  sharePreview,
  type HarnessBinding,
  type HarnessResolveResult,
  type HarnessShareImportPreview,
  type HarnessShareImportResult,
} from '@/services/harness'

interface HarnessStore {
  scope: HarnessResolveResult | null
  bindings: HarnessBinding[]
  shareJson: string | null
  shareNotes: number
  shareImportSnapshot: unknown | null
  shareImportPreview: HarnessShareImportPreview | null
  shareImportReport: HarnessShareImportResult | null
  loading: boolean
  error: string | null

  /** Resolve the current checkout: repo identity, project id, binding state. */
  resolveScope: (cwd: string) => Promise<void>
  refreshGraph: (cwd: string) => Promise<void>
  saveBinding: (cwd: string, binding: HarnessBinding) => Promise<void>
  previewShare: (cwd: string) => Promise<void>
  exportShare: (cwd: string, outPath: string) => Promise<boolean>
  previewShareImport: (cwd: string, snapshot: unknown) => Promise<HarnessShareImportPreview | null>
  applyShareImport: (cwd: string, snapshot: unknown) => Promise<HarnessShareImportResult | null>
  clearShareImport: () => void
}

export const useHarnessStore = create<HarnessStore>((set) => ({
  scope: null,
  bindings: [],
  shareJson: null,
  shareNotes: 0,
  shareImportSnapshot: null,
  shareImportPreview: null,
  shareImportReport: null,
  loading: false,
  error: null,

  resolveScope: async (cwd) => {
    set({ loading: true, error: null })
    try {
      const scope = await resolveProject(cwd)
      const bindings = scope.ok ? await getBindings(cwd) : []
      set({ scope, bindings, loading: false })
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  refreshGraph: async (cwd) => {
    try {
      await rescanProject(cwd)
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  saveBinding: async (cwd, binding) => {
    try {
      const bindings = await setBinding(cwd, binding)
      set({ bindings, error: null })
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  previewShare: async (cwd) => {
    try {
      const preview = await sharePreview(cwd, {})
      set({ shareJson: preview.json, shareNotes: preview.notes, error: null })
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  exportShare: async (cwd, outPath) => {
    try {
      await shareExport(cwd, {}, outPath)
      set({ error: null })
      return true
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return false
    }
  },

  previewShareImport: async (cwd, snapshot) => {
    try {
      const preview = await shareImportPreview(cwd, snapshot)
      set({ shareImportSnapshot: snapshot, shareImportPreview: preview, shareImportReport: null, error: null })
      return preview
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },

  applyShareImport: async (cwd, snapshot) => {
    try {
      const report = await shareImportApply(cwd, snapshot)
      set({ shareImportReport: report, error: null })
      return report
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },

  clearShareImport: () => set({ shareImportSnapshot: null, shareImportPreview: null, shareImportReport: null }),
}))
