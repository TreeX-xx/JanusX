import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.main'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import typescriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

let configured = false

export function configureMonacoRuntime(): void {
  if (configured) return

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new typescriptWorker()
      return new editorWorker()
    },
  }
  // Note: previews keep file-local editing and find, without symbol navigation.
  // .agents/notes/workbench/file-editor-experience.md
  const { typescript, css, html, json } = monaco
  for (const defaults of [
    typescript.typescriptDefaults, typescript.javascriptDefaults,
    css.cssDefaults, css.scssDefaults, css.lessDefaults,
  ]) {
    defaults.setModeConfiguration({
      ...defaults.modeConfiguration,
      definitions: false,
      references: false,
      documentSymbols: false,
    })
  }
  for (const defaults of [html.htmlDefaults, json.jsonDefaults]) {
    defaults.setModeConfiguration({ ...defaults.modeConfiguration, documentSymbols: false })
  }
  loader.config({ monaco })
  configured = true
}

export function initializeMonacoRuntime() {
  configureMonacoRuntime()
  return loader.init()
}
