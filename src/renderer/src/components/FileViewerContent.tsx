// Note: .agents/notes/workbench/plugin-contract-v1.md — optional read-only plugin viewers in the embedded editor.
import { productKindForPath } from '../../../shared/product'
import { OfficeFileViewer } from './office/OfficeFileViewer'
import { useEditorStore } from '@/stores/editor'
import { MonacoViewer, MarkdownViewer, HtmlViewer, ImageViewer, BinaryInfo } from '@/components/viewers'
import { getMonacoLanguage } from '@/lib/file-utils'
import type { FindableEditor } from '@/lib/editor-find'
import type { OpenFile } from '@/types'
import type { DefinitionTarget } from '@/lib/monaco-definition'
import type { EditorNavigationTarget } from '@/stores/editor'
import { DocumentViewerHost } from '@/extensions/DocumentViewerHost'

interface FileViewerContentProps {
  pluginViewers?: boolean
  onReadOnlyChange?: (value: boolean) => void
  file: OpenFile
  onContentChange: (content: string) => void
  onEditorMount?: (editor: FindableEditor | null) => void
  diffOriginalContent?: string
  workspacePath?: string
  navigationTarget?: EditorNavigationTarget | null
  onDefinitionNavigate?: (target: DefinitionTarget) => void
  onNavigationComplete?: (requestId: number) => void
  definitionActionLabel?: string
  definitionErrorMessage?: string
}

export function FileViewerContent(props: FileViewerContentProps) {
  const builtin = <BuiltinFileViewerContent {...props} />
  if (!props.pluginViewers || props.file.isLoading || props.file.error || ['image', 'binary'].includes(props.file.viewType)
    || productKindForPath(props.file.absolutePath) === 'office') return builtin
  return <DocumentViewerHost file={props.file} workspacePath={props.workspacePath}
    onReadOnlyChange={props.onReadOnlyChange}
    forceBuiltin={props.diffOriginalContent !== undefined || Boolean(props.navigationTarget)}>{builtin}</DocumentViewerHost>
}

function BuiltinFileViewerContent({ file, onContentChange, onEditorMount, diffOriginalContent, workspacePath, navigationTarget, onDefinitionNavigate, onNavigationComplete, definitionActionLabel, definitionErrorMessage }: FileViewerContentProps) {
  if (file.isLoading) {
    return (
      <div
        className="flex items-center justify-center flex-1"
        style={{ background: 'var(--shell-canvas)', minHeight: 0 }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--shell-dim)', fontSize: 12 }}>Loading</span>
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: 'var(--shell-accent)',
              animation: 'pulse-dot 1.2s ease-in-out infinite',
            }}
          />
        </div>
      </div>
    )
  }

  if (file.error) {
    return (
      <div
        className="flex flex-col items-center justify-center flex-1 gap-2"
        style={{ background: 'var(--shell-canvas)', minHeight: 0 }}
      >
        <span style={{ color: 'var(--shell-diff-del)', fontSize: 13 }}>Error</span>
        <span style={{ color: 'var(--shell-dim)', fontSize: 11 }}>{file.error}</span>
        <span style={{ color: 'var(--shell-dim)', fontSize: 10 }}>Try closing and reopening the file</span>
      </div>
    )
  }

  if (productKindForPath(file.absolutePath) === 'office') return <OfficeFileViewer absolutePath={file.absolutePath} onClose={() => useEditorStore.getState().closeFile(file.id)} />

  if (file.saveConflict && file.conflictDisk) return <MonacoViewer content={file.content} originalContent={file.conflictDisk.text}
    language={getMonacoLanguage(file.path)} modelPath={file.absolutePath} workspacePath={workspacePath} onChange={onContentChange} onEditorMount={onEditorMount} />

  switch (file.viewType) {
    case 'code':
      return (
        <MonacoViewer
          content={file.content}
          language={getMonacoLanguage(file.path)}
          originalContent={diffOriginalContent}
          modelPath={file.absolutePath}
          workspacePath={workspacePath}
          navigationTarget={navigationTarget?.fileId === file.id ? navigationTarget : null}
          onDefinitionNavigate={onDefinitionNavigate}
          onNavigationComplete={onNavigationComplete}
          definitionActionLabel={definitionActionLabel}
          definitionErrorMessage={definitionErrorMessage}
          onChange={onContentChange}
          onEditorMount={onEditorMount}
        />
      )
    case 'markdown':
      return (
        <MarkdownViewer
          content={file.content}
          originalContent={diffOriginalContent}
          modelPath={file.absolutePath}
          workspacePath={workspacePath}
          documentPath={file.absolutePath}
          onChange={onContentChange}
          onEditorMount={onEditorMount}
        />
      )
    case 'html':
      return (
        <HtmlViewer
          content={file.content}
          originalContent={diffOriginalContent}
          modelPath={file.absolutePath}
          workspacePath={workspacePath}
          documentPath={file.absolutePath}
          onChange={onContentChange}
          onEditorMount={onEditorMount}
        />
      )
    case 'image':
      return (
        <ImageViewer
          base64={file.base64!}
          mimeType={file.mimeType!}
          fileName={file.name}
        />
      )
    case 'binary':
      return (
        <BinaryInfo
          fileName={file.name}
          size={file.size}
        />
      )
    default:
      return null
  }
}
