/**
 * src/renderer/src/components/ProjectConfigForm/JsonEditor.tsx
 *
 * JSON 编辑器组件
 * 使用 @monaco-editor/react 进行 JSON 编辑和验证
 */

import { useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { configureMonacoRuntime } from '@/lib/monaco-runtime'
import { defineJanusxThemes, getMonacoThemeName } from '@/lib/monaco-theme'
import { useThemeDefinition } from '@/stores/theme'
import { useI18n } from '@/i18n/useI18n'

configureMonacoRuntime()
import styles from './JsonEditor.module.css'

interface JsonEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}

/*-- janusx 主题定义（planche + dark，注册表顺序），与 MonacoViewer 保持一致 --*/
const handleBeforeMount = (monaco: any) => {
  defineJanusxThemes(monaco)
}

function LoadingIndicator() {
  const { t } = useI18n('editor')
  return (
    <div className={styles.loading} style={{ background: '#151517' }}>
      <div className={styles.loadingInner}>
        <span style={{ color: '#555', fontSize: 12 }}>{t('editor:config.loading')}</span>
        <span className={styles.loadingDot} />
      </div>
    </div>
  )
}

/**
 * JSON 编辑器
 * 基于 @monaco-editor/react 的完整 JSON 编辑体验
 */
export function JsonEditor({ value, onChange, readOnly = false }: JsonEditorProps) {
  const { t } = useI18n('editor')
  const appTheme = useThemeDefinition().id
  const handleChange = useCallback(
    (val: string | undefined) => {
      onChange(val || '')
    },
    [onChange],
  )

  return (
    <div className={styles.container}>
      <div className={styles.editor}>
        <Editor
          height="100%"
          language="json"
          value={value}
          onChange={handleChange}
          theme={getMonacoThemeName(appTheme)}
          loading={<LoadingIndicator />}
          options={{
            fontSize: 13,
            fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            lineNumbers: 'on',
            renderLineHighlight: 'line',
            padding: { top: 12, bottom: 12 },
            readOnly,
            domReadOnly: readOnly,
            formatOnPaste: true,
            formatOnType: true,
            tabSize: 2,
            contextmenu: false,
            automaticLayout: true,
          }}
          beforeMount={handleBeforeMount}
        />
      </div>
      <div className={styles.hint}>
        {t('editor:config.jsonHint')}
      </div>
    </div>
  )
}

export default JsonEditor
