import type { CSSProperties } from 'react'
import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TerminalPreset } from '@/types'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import janusx from '@/assets/superagent-wordmark.svg'
import janusxAccent from '@/assets/wordmarks/janusx-accent.svg'
import codex from '@/assets/wordmarks/codex.svg'
import claude from '@/assets/wordmarks/claude.svg'
import opencode from '@/assets/wordmarks/opencode.svg'
import pi from '@/assets/wordmarks/pi.svg'
import dsh from '@/assets/wordmarks/dsh.svg'
import shell from '@/assets/wordmarks/shell.svg'
import janus from '@/assets/wordmarks/janus.svg'
import styles from './ConversationWelcome.module.css'

const wordmarks = {
  janusx: { src: janusx, width: 420, name: 'JanusX' },
  codex: { src: codex, width: 346, name: 'Codex' },
  claude: { src: claude, width: 408, name: 'Claude' },
  opencode: { src: opencode, width: 556, name: 'OpenCode' },
  pi: { src: pi, width: 118, name: 'Pi' },
  dsh: { src: dsh, width: 544, name: 'DeepSeek' },
  shell: { src: shell, width: 338, name: 'Shell' },
  janus: { src: janus, width: 350, name: 'Janus' },
} satisfies Record<TerminalPreset | 'janusx', { src: string; width: number; name: string }>

/** Shared welcome geometry; each caller keeps its composer mounted through startup and history. */
export function ConversationWelcome({ brand, workspacePath, workspaceName, loading = false, active = true }: {
  brand: TerminalPreset | 'janusx'
  workspacePath?: string
  workspaceName?: string
  loading?: boolean
  active?: boolean
}) {
  const { t } = useTranslation(['common', 'terminal'])
  const wordmark = wordmarks[brand]
  const workspace = workspaceName || workspacePath?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || workspacePath
  return <section className={styles.welcome} data-conversation-welcome data-brand={brand} data-loading={loading} data-animate={loading && active}>
    <div className={styles.identity}>
      {brand !== 'janusx' && <span className={styles.icon} aria-hidden="true"><TerminalPresetIcon preset={brand} /><span className={styles.ring} /></span>}
      <span className={styles.wordmark} role="img" aria-label={wordmark.name} style={{ '--wordmark-mask': `url(${JSON.stringify(wordmark.src)})`, '--wordmark-ratio': wordmark.width / 80 } as CSSProperties}>
        {brand === 'janusx' && <span className={styles.accent} style={{ maskImage: `url(${JSON.stringify(janusxAccent)})` }} />}
      </span>
    </div>
    <div className={styles.layers}>
      <div data-active={loading} data-conversation-loading={loading ? '' : undefined} aria-hidden={!loading} role={loading ? 'status' : undefined} aria-live={loading ? 'polite' : undefined}>
        <h2>{t('terminal:conversation.starting')}</h2><p>{t('terminal:conversation.startingHint')}</p>
        <div className={styles.lines} aria-hidden="true"><span /><span /><span /></div>
      </div>
      <div data-active={!loading} aria-hidden={loading}>
        <h2>{t('conversationWelcome.title')}</h2><p>{t('conversationWelcome.hint')}</p>
        <div className={styles.workspace} title={workspacePath} data-welcome-workspace>
          <FolderOpen size={13} aria-hidden="true" />
          {workspace ? <><span>{workspace}</span><i aria-hidden="true" /><small>{t('conversationWelcome.workspace')}</small></> : <span>{t('conversationWelcome.noWorkspace')}</span>}
        </div>
      </div>
    </div>
  </section>
}
