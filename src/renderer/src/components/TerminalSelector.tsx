import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useShellProfilesStore } from '@/stores/shell-profiles'
import type { TerminalPreset } from '@/types'
import { getTerminalPresetMeta } from '../../../shared/terminalLaunch'
import {
  describeShellEntry,
  listVisibleCliPresets,
  listVisibleShellEntries,
  type ShellProfileEntry,
} from '../../../shared/shellProfiles'
import {
  launchTerminalPreset,
  warmDefaultShellCache,
  warmShellProfilesCache,
  warmTerminalCreatePath,
} from '@/lib/terminal-launch'
import { useI18n } from '@/i18n/useI18n'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import { TerminalLaunchIcon } from './ui/TerminalLaunchIcon'
import styles from './TerminalSelector.module.css'

interface TerminalOptionProps {
  preset: TerminalPreset
  name: string
  busy: boolean
  onClick: () => void
  onHover?: () => void
}

function TerminalOption({ preset, name, busy, onClick, onHover }: TerminalOptionProps) {
  const { t } = useI18n('terminal')
  return (
    <button
      type="button"
      disabled={busy}
      onClick={busy ? undefined : onClick}
      onMouseEnter={busy ? undefined : onHover}
      onFocus={busy ? undefined : onHover}
      className={`${styles.card}${busy ? ` ${styles.cardBusy}` : ''}`}
    >
      <span className={styles.iconWrap}>
        <TerminalLaunchIcon preset={preset} className={styles.icon} />
      </span>
      <span className={styles.label}>
        {busy ? t('terminal:selector.starting') : name}
      </span>
    </button>
  )
}

/**
 * Shell 卡片：外形与其他 preset 卡片完全一致（同边框、同圆角、同单行标签），
 * 只在右下角多一枚安静的箭头提供本次临时选择；默认 shell 的完整启动行进原生 tooltip。
 */
function ShellCard({
  busyKey,
  onLaunch,
}: {
  busyKey: string | null
  onLaunch: (entry: ShellProfileEntry) => void
}) {
  const { t } = useI18n('terminal')
  const settings = useShellProfilesStore((s) => s.settings)
  const entries = listVisibleShellEntries(settings)
  const defaultEntry = settings.entries.find((entry) => entry.isDefault) ?? entries[0]
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  return (
    <div className={styles.shellCard} ref={rootRef}>
      <button
        type="button"
        data-onboarding="shell"
        disabled={!defaultEntry || busyKey !== null}
        onClick={() => defaultEntry && onLaunch(defaultEntry)}
        onMouseEnter={() => {
          warmDefaultShellCache()
          warmShellProfilesCache()
        }}
        title={defaultEntry ? describeShellEntry(defaultEntry) : undefined}
        className={`${styles.card}${busyKey ? ` ${styles.cardBusy}` : ''}`}
      >
        <span className={styles.iconWrap}>
          <TerminalPresetIcon preset="shell" className={styles.icon} />
        </span>
        <span className={styles.label}>
          {busyKey ? t('terminal:selector.starting') : (defaultEntry?.name ?? t('terminal:provider.shell'))}
        </span>
      </button>
      <button
        type="button"
        aria-label={t('terminal:shellMenu.pickShell')}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        disabled={busyKey !== null || entries.length === 0}
        onClick={() => setMenuOpen((open) => !open)}
        className={`${styles.shellPick}${menuOpen ? ` ${styles.shellPickOpen}` : ''}`}
      >
        <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
      </button>
      {menuOpen && (
        <div className={styles.shellMenu} role="menu">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className={styles.shellMenuItem}
              onClick={() => {
                setMenuOpen(false)
                onLaunch(entry)
              }}
            >
              <span className={styles.shellMenuItemHead}>
                <span className={styles.shellMenuItemName}>{entry.name}</span>
                {entry.isDefault && <span className={styles.shellMenuBadge}>{t('terminal:shellMenu.default')}</span>}
              </span>
              <span className={styles.shellMenuItemCommand}>{describeShellEntry(entry)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TerminalSelector() {
  const { t } = useI18n('terminal')
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const settings = useShellProfilesStore((s) => s.settings)
  const loadProfiles = useShellProfilesStore((s) => s.load)
  // 启动中的 key：shell 条目用 `shell:<id>`，CLI 预设用 preset 名。
  const [launchingKey, setLaunchingKey] = useState<string | null>(null)

  useEffect(() => {
    warmDefaultShellCache()
    warmShellProfilesCache()
    void loadProfiles()
    warmTerminalCreatePath()
  }, [loadProfiles])

  const launch = useCallback(
    async (preset: TerminalPreset, shellProfileId?: string) => {
      if (!activeWorkspaceId || launchingKey) return

      const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === activeWorkspaceId)
      if (!workspace) return

      const key = shellProfileId ? `shell:${shellProfileId}` : preset
      setLaunchingKey(key)
      try {
        await launchTerminalPreset({
          preset,
          workspaceId: activeWorkspaceId,
          workspacePath: workspace.path,
          cwd: useWorktreeStore.getState().activePaths[activeWorkspaceId] ?? workspace.path,
          ...(shellProfileId ? { shellProfileId } : {}),
        })
      } finally {
        setLaunchingKey(null)
      }
    },
    [activeWorkspaceId, launchingKey]
  )

  const launchShellEntry = useCallback(
    (entry: ShellProfileEntry) => launch('shell', entry.id),
    [launch]
  )

  const cliPresets = listVisibleCliPresets(settings, ['janus', 'claude', 'codex', 'opencode', 'pi', 'dsh'])

  return (
    <div
      className={`${styles.root} flex flex-col items-center justify-center h-full gap-6 px-4 py-8 sm:px-6 md:px-10`}
      style={{
        background: 'var(--bg-deep)',
      }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="text-sm font-medium" style={{ color: 'var(--shell-muted)' }}>{t('terminal:selector.title')}</div>
        <div className="text-[11px] max-w-[520px] leading-relaxed" style={{ color: 'var(--shell-dim)' }}>
          {t('terminal:selector.hint')}
        </div>
      </div>
      <div className={styles.grid}>
        <ShellCard busyKey={launchingKey} onLaunch={launchShellEntry} />
        {cliPresets.map((preset) => (
          <TerminalOption
            key={preset}
            preset={preset}
            name={getTerminalPresetMeta(preset).label}
            busy={launchingKey === preset}
            onClick={() => void launch(preset)}
            onHover={() => warmTerminalCreatePath([preset])}
          />
        ))}
      </div>
    </div>
  )
}
