import React from 'react'
import { createRoot } from 'react-dom/client'
import { TerminalSelector } from '../../../src/renderer/src/components/TerminalSelector'
import { FileTreeItem } from '../../../src/renderer/src/components/file-tree/FileTreeItem'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { useShellProfilesStore } from '../../../src/renderer/src/stores/shell-profiles'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import type { GitFileChange } from '../../../src/renderer/src/types'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
Object.assign(window.electron.system, { getLanguage: async () => 'en', setLanguage: async () => undefined })
await initI18n()
await changeLanguage('en')
useThemeStore.getState().applyExternal('white')
useShellProfilesStore.setState({ loaded: true, settings: { ...useShellProfilesStore.getState().settings, hiddenCliPresets: [] } })
const statuses: GitFileChange['status'][] = ['M', 'A', 'D', 'R', '??', 'UU']
const files = ['src', 'index.ts', 'script.py', 'README.md', 'config.json', 'image.png', 'data.db', 'archive.zip', 'file.bin']
createRoot(document.getElementById('root')!).render(
  <main style={{ minHeight: '100vh', background: 'var(--shell-canvas)', color: 'var(--shell-text)' }}>
    <nav style={{ display: 'flex', gap: 16, padding: 16 }}>{['white', 'dark', 'planche'].map(theme => <button key={theme} onClick={() => useThemeStore.getState().applyExternal(theme)}>{theme}</button>)}</nav>
    <section aria-label="Terminal selector" style={{ height: 360 }}><TerminalSelector /></section>
    <section aria-label="Files" style={{ maxWidth: 480, padding: 24 }}>
      {files.map((name, index) => <FileTreeItem key={name} node={{ name, path: `C:/fixture/${name}`, type: index ? 'file' : 'directory', isGitIgnored: name === 'file.bin' }}
        workspacePath="C:/fixture" depth={0} activeFilePath={null} expanded={false} expandedPaths={new Set()} loading={false} loadingDirectoryPaths={new Set()}
        fileChange={index ? { path: name, status: statuses[(index - 1) % statuses.length], staged: false, additions: 0, deletions: 0 } : null}
        fileChangeMap={new Map()} changedDirs={new Map()} onSelect={() => {}} onToggleDirectory={() => {}} onOpenFile={() => {}} onMoveFile={() => {}} onOpenContextMenu={() => {}} />)}
    </section>
  </main>,
)
