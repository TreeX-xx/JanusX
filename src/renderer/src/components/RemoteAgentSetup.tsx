import { Download, LoaderCircle, TerminalSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace'
import { cancelRemoteAgentSetup, installAndOpenRemoteAgent } from '@/lib/remote-agent-setup'
import { launchTerminalPreset } from '@/lib/terminal-launch'
import { getTerminalPresetMeta } from '../../../shared/terminalLaunch'
import styles from './RemoteAgentSetup.module.css'

export function RemoteAgentSetup({ terminalId }: { terminalId: string }) {
  const terminal = useWorkspaceStore(s => s.terminals.find(item => item.id === terminalId))
  const { i18n } = useTranslation()
  const text = (zh: string, en: string) => i18n.language.startsWith('zh') ? zh : en
  if (!terminal?.agentSetup) return null
  const setup = terminal.agentSetup
  const name = getTerminalPresetMeta(terminal.preset).label
  const close = () => {
    cancelRemoteAgentSetup(terminalId)
    useWorkspaceStore.getState().removeTerminal(terminalId)
  }
  const shell = () => {
    close()
    void launchTerminalPreset({ preset: 'shell', workspaceId: terminal.workspaceId, workspacePath: terminal.cwd, cwd: terminal.cwd })
  }
  return <section className={styles.overlay} aria-label={text('安装 Agent', 'Install Agent')}>
    <div className={styles.panel}>
      <TerminalSquare size={24} strokeWidth={1.5} className={styles.icon} />
      <h2>{text(`安装 ${name}`, `Install ${name}`)}</h2>
      <p>{text('在当前 Linux 环境安装，完成后自动打开。', 'Install in this Linux environment, then open automatically.')}</p>
      <div className={styles.environment}>{setup.environment}</div>
      {setup.error && <p className={styles.error} role="alert">{setup.error}</p>}
      {setup.busy && <p role="status">{text('正在准备并安装…', 'Preparing and installing…')}</p>}
      {setup.log && <details><summary>{text('安装详情', 'Installation details')}</summary><pre>{setup.log}</pre></details>}
      <div className={styles.actions}>
        <button className={styles.primary} disabled={setup.busy} onClick={() => void installAndOpenRemoteAgent(terminalId)}>
          {setup.busy ? <LoaderCircle size={14} className={styles.spinner} /> : <Download size={14} />}
          {text('安装并打开', 'Install and open')}
        </button>
        <button onClick={close}>{text('取消', 'Cancel')}</button>
      </div>
      <button className={styles.shell} onClick={shell}>{text('打开普通终端', 'Open Linux terminal')}</button>
      {setup.busy && <small>{text('关闭面板不会中断远端安装。', 'Closing this panel leaves the remote installation running.')}</small>}
    </div>
  </section>
}
