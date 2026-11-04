import { useEffect, useRef } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { closeLocalCliSetup, prepareLocalCli, useLocalCliSetup } from '@/stores/cli-readiness'
import { EXTERNAL_CLI_TOOL_META } from '../../../shared/ipc/external-cli'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import styles from './LocalCliSetup.module.css'

export function LocalCliSetup() {
  const request = useLocalCliSetup(s => s.request)
  const dialog = useRef<HTMLDialogElement>(null)
  const { i18n } = useTranslation()
  const text = (zh: string, en: string) => i18n.language.startsWith('zh') ? zh : en
  // Note: .agents/notes/terminal/cc-switch-multi-terminal.md
  // The initial probe reserves the launch intent, but is not a setup request yet.
  const open = Boolean(request && !request.checking)
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])
  const name = request ? EXTERNAL_CLI_TOOL_META[request.toolId].displayName : ''
  const openDownloads = () => {
    void window.electron.file.openPreviewLink('https://nodejs.org/en/download').catch(error => {
      if (request && useLocalCliSetup.getState().request === request) {
        useLocalCliSetup.setState({ request: { ...request, error: String(error) } })
      }
    })
  }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="local-cli-title" onCancel={event => { event.preventDefault(); closeLocalCliSetup() }}>
    {open && request && <>
      <TerminalPresetIcon preset={request.toolId} style={{ width: 32, height: 32 }} />
      <h2 id="local-cli-title">{text(`准备使用 ${name}`, `Set up ${name}`)}</h2>
      <p>{text('JanusX 会准备所需运行环境并安装工具，完成后自动打开。首次使用可能需要登录账号。', 'JanusX will prepare the runtime, install this tool, and open it. You may need to sign in on first use.')}</p>
      <div className={styles.environment}>{text('安装位置：当前电脑 · 缺少 Node.js/npm 时使用 JanusX 私有环境', 'This computer · A private JanusX runtime is used if Node.js/npm is missing')}</div>
      {request.checking ? <p role="status">{text('正在检测…', 'Checking…')}</p> : request.busy ? <p role="status"><LoaderCircle size={14} className={styles.spinner} /> {text('正在准备环境并安装，请稍候…', 'Preparing and installing, please wait…')}</p> : <p>{request.broken ? text('工具已安装，但暂时无法运行。可以修复后重新打开。', 'This tool is installed but cannot run. Repair it to continue.') : text('此工具尚未就绪，点击下方按钮即可开始。', 'This tool is not ready yet. Use the button below to get started.')}</p>}
      {request.error && <div role="alert" className={styles.error}><p>{text('准备未完成。请检查网络后重试，或使用下方手动安装。', 'Setup did not complete. Check your connection and retry, or install manually below.')}</p><details><summary>{text('查看原因', 'Show details')}</summary><pre>{request.error}</pre></details></div>}
      <div className={styles.actions}>
        <button autoFocus className={styles.primary} disabled={request.busy || request.checking} onClick={() => void prepareLocalCli(true)}><Download size={14} />{request.broken ? text('修复并打开', 'Repair and open') : text('安装并打开', 'Install and open')}</button>
        <button onClick={() => closeLocalCliSetup()}>{text('返回', 'Back')}</button>
      </div>
      <button className={styles.recheck} disabled={request.busy || request.checking} onClick={() => void prepareLocalCli(false)}>{text('我已安装，重新检测', 'Already installed? Check again')}</button>
      <details className={styles.manual}><summary>{text('手动安装运行环境', 'Install the runtime manually')}</summary><p>{text('打开 Node.js 官网安装 LTS 版本（包含 npm），然后返回重新检测并安装工具。若仍未识别，请重启 JanusX。', 'Install Node.js LTS (including npm), then return to check again and install the tool. Restart JanusX if it is still not detected.')}</p><a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer" onClick={event => { event.preventDefault(); openDownloads() }}>{text('打开 Node.js 官网', 'Open Node.js downloads')}</a></details>
      {request.busy && <small>{text('返回后安装会继续，但不会自动打开终端。', 'Going back leaves installation running without opening a terminal.')}</small>}
    </>}
  </dialog>
}
