import { SettingsSurface, Button as SettingsButton, Input as SettingsInput } from '@janusx/ui'
import { useCallback, useId, useMemo, useState } from 'react'
import { ChevronDown, Eye, EyeOff, Plus, RefreshCw, SquareTerminal, Star, Trash2 } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import {
  isShellEntryLaunchable,
  describeShellEntry,
  parseCommandLine,
  quoteCommandToken,
  shellEntryExecutable,
  type ShellCandidate,
  type ShellProfileEntry,
  type ShellProfilesSettings,
} from '../../../shared/shellProfiles'
import { useShellProfilesStore } from '@/stores/shell-profiles'
import { ExternalCliManager } from './ExternalCliManager'
import {
  EXTERNAL_CLI_TOOL_ORDER,
  type ExternalCliToolId,
} from '../../../shared/ipc/external-cli'
import styles from './AppSettingsModal.module.css'
import shellStyles from './TerminalManagerPanel.module.css'

/** 标红时显示的可执行名：命令首个 token，命令为空时退回整条命令。 */
function executableOf(entry: ShellProfileEntry): string {
  const tokens = parseCommandLine(entry.command)
  return tokens.length > 0 ? tokens[0] : entry.command
}

/** persist 只收要改的字段，其余与当前设置合并，调用点不必反复重述。 */
type TerminalSettingsPatch = Partial<Pick<ShellProfilesSettings, 'entries' | 'hiddenCliPresets'>>

/**
 * 设置「终端管理」：Shell 使用通栏概览与按需展开的编辑区，
 * 外部 CLI 参考 MCP 接入使用通栏终端列表；检测候选区保留按需扫描。
 */
export function TerminalManagerPanel() {
  const { t } = useI18n('terminal')
  const settings = useShellProfilesStore((s) => s.settings)
  const save = useShellProfilesStore((s) => s.save)
  const detect = useShellProfilesStore((s) => s.detect)
  const [candidates, setCandidates] = useState<ShellCandidate[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const persist = useCallback(
    async (patch: TerminalSettingsPatch) => {
      setSaveError(null)
      try {
        await save({ ...settings, ...patch })
      } catch {
        setSaveError(t('terminal:shellSettings.saveError'))
      }
    },
    [save, settings, t],
  )

  const scanCandidates = useCallback(async () => {
    setScanning(true)
    try {
      setCandidates(await detect())
    } catch {
      setCandidates([])
    } finally {
      setScanning(false)
    }
  }, [detect])

  // 标红依据：扫描过的可执行名集合里找不到该条目的可执行名。
  const detectedExecutables = useMemo(() => {
    if (!candidates) return null
    return new Set(candidates.filter((candidate) => candidate.path).map((candidate) => candidate.executable))
  }, [candidates])

  const patchEntry = (id: string, patch: Partial<ShellProfileEntry>) => {
    void persist({
      entries: settings.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    })
  }

  const removeEntry = (id: string) => {
    void persist({
      entries: settings.entries.filter((entry) => entry.id !== id),
    })
  }

  const addEntry = () => {
    const entry: ShellProfileEntry = {
      id: crypto.randomUUID(),
      name: t('terminal:shellSettings.configured.newName'),
      command: '',
      visible: true,
      isDefault: false,
    }
    void persist({
      entries: [...settings.entries, entry],
    })
  }

  const addCandidate = (candidate: ShellCandidate) => {
    const entry: ShellProfileEntry = {
      id: crypto.randomUUID(),
      name: candidate.suggestedName,
      // 检测到的绝对路径可能带空格（Program Files），预填时必须加引号才能整体解析。
      command: quoteCommandToken(candidate.path ?? candidate.executable),
      ...(candidate.suggestedSuffix ? { suffix: candidate.suggestedSuffix } : {}),
      visible: true,
      isDefault: false,
    }
    void persist({
      entries: [...settings.entries, entry],
    })
  }

  const setCliVisible = (toolId: ExternalCliToolId, visible: boolean) => {
    void persist({
      entries: settings.entries,
      hiddenCliPresets: visible
        ? settings.hiddenCliPresets.filter((item) => item !== toolId)
        : [...settings.hiddenCliPresets, toolId],
    })
  }

  return (
    <SettingsSurface className={styles.generalPanel}>
      {/* ── 已配置 shell 条目 ── */}
      <section className={shellStyles.configured} aria-labelledby="configured-shells-heading">
        <div className={shellStyles.sectionHeader}>
          <div className={styles.generalLabelCol}>
            <h3 id="configured-shells-heading" className={styles.generalLabel}>
              {t('terminal:shellSettings.configured.title')}
            </h3>
            <div className={styles.generalHelp}>{t('terminal:shellSettings.configured.help')}</div>
          </div>
          <SettingsButton type="button" className={shellStyles.addButton} onClick={addEntry}>
            <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
            {t('terminal:shellSettings.configured.add')}
          </SettingsButton>
        </div>
        <div className={shellStyles.entryList}>
          {settings.entries.length === 0 && (
            <div className={styles.lsEmpty}>{t('terminal:shellSettings.configured.empty')}</div>
          )}
          {settings.entries.map((entry) => (
            <ShellEntryCard
              key={entry.id}
              entry={entry}
              missing={
                detectedExecutables !== null && !detectedExecutables.has(shellEntryExecutable(entry))
              }
              onPatch={patchEntry}
              onRemove={removeEntry}
              onMakeDefault={() =>
                void persist({
                  entries: settings.entries.map((item) => ({
                    ...item,
                    isDefault: item.id === entry.id,
                  })),
                })
              }
              onRedetect={() => void scanCandidates()}
            />
          ))}
        </div>
      </section>

      {/* ── 外部 CLI：检测/安装 + 新建入口显隐（自「通用」移来） ── */}
      <section className={`${styles.generalRow} ${styles.generalRowWide}`} aria-labelledby="external-cli-heading">
        <div className={styles.generalLabelCol}>
          <h3 id="external-cli-heading" className={styles.generalLabel}>{t('terminal:shellSettings.externalCli.title')}</h3>
          <div className={styles.generalHelp}>{t('terminal:shellSettings.externalCli.help')}</div>
        </div>
        <div className={styles.generalControlCol}>
          <div className={`${styles.lsCard} ${shellStyles.externalList}`}>
            {EXTERNAL_CLI_TOOL_ORDER.map((toolId) => (
              <ExternalCliManager
                key={toolId}
                toolId={toolId}
                visible={!settings.hiddenCliPresets.includes(toolId)}
                onVisibleChange={(visible) => setCliVisible(toolId, visible)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── 检测候选区：扫描按钮与候选列表同住一张卡 ── */}
      <div className={`${styles.generalRow} ${styles.generalRowWide}`}>
        <div className={styles.generalLabelCol}>
          <div className={styles.generalLabel}>{t('terminal:shellSettings.candidates.title')}</div>
          <div className={styles.generalHelp}>{t('terminal:shellSettings.candidates.help')}</div>
        </div>
        <div className={styles.generalControlCol}>
          <div className={styles.lsCard}>
            <div className={styles.lsCardHeader}>
              <div className={styles.lsCardInfo}>
                <span className={styles.lsCardDesc}>
                  {candidates === null
                    ? t('terminal:shellSettings.candidates.idle')
                    : t('terminal:shellSettings.candidates.count', { count: candidates.length })}
                </span>
              </div>
              <div className={styles.lsCardActions}>
                {/* 只留图标：文字在 label 栏与 aria-label 里都有了 */}
                <SettingsButton variant="ghost" size="icon"
                  type="button"
                  className={`${styles.lsIconButton}${scanning ? ` ${styles.lsIconSpin}` : ''}`}
                  aria-label={t('terminal:shellSettings.candidates.scan')}
                  title={t('terminal:shellSettings.candidates.scan')}
                  disabled={scanning}
                  onClick={() => void scanCandidates()}
                >
                  <RefreshCw size={14} strokeWidth={1.8} aria-hidden="true" />
                </SettingsButton>
              </div>
            </div>

            {candidates !== null && candidates.length === 0 && (
              <div className={styles.lsEmpty}>{t('terminal:shellSettings.candidates.empty')}</div>
            )}
            {candidates?.map((candidate) => (
              <div key={candidate.executable} className={styles.lsToolRow}>
                <div className={styles.lsToolRowMain}>
                  <div className={styles.lsToolRowInfo}>
                    <span className={styles.lsCardName}>{candidate.suggestedName}</span>
                    <span className={styles.lsToolRowMeta}>
                      {[candidate.path ?? candidate.executable, candidate.suggestedSuffix]
                        .filter(Boolean)
                        .join('  ')}
                    </span>
                  </div>
                  {candidate.configured ? (
                    <span className={`${styles.lsStateBadge} ${styles.lsStateIdle}`}>
                      {t('terminal:shellSettings.candidates.configured')}
                    </span>
                  ) : (
                    <span className={styles.lsToolRowActions}>
                      <SettingsButton variant="primary"
                        type="button"
                        className={`${styles.lsButton} ${styles.lsButtonPrimary}`}
                        onClick={() => addCandidate(candidate)}
                      >
                        {t('terminal:shellSettings.candidates.add')}
                      </SettingsButton>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {saveError && <div className={styles.lsCardError}>{saveError}</div>}
    </SettingsSurface>
  )
}

/** 概览行保留日常操作，展开后才呈现编辑表单与删除。空命令的新条目直接进入编辑。 */
function ShellEntryCard({
  entry,
  missing,
  onPatch,
  onRemove,
  onMakeDefault,
  onRedetect,
}: {
  entry: ShellProfileEntry
  missing: boolean
  onPatch: (id: string, patch: Partial<ShellProfileEntry>) => void
  onRemove: (id: string) => void
  onMakeDefault: () => void
  onRedetect: () => void
}) {
  const { t } = useI18n('terminal')
  const [expanded, setExpanded] = useState(!entry.command.trim())
  const detailsId = useId()

  return (
    <div className={shellStyles.entry} data-shell-entry={entry.id}>
      <div className={shellStyles.entryHeader}>
        <SettingsButton variant="plain"
          type="button"
          className={shellStyles.summary}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
        >
          <SquareTerminal className={shellStyles.entryIcon} size={18} strokeWidth={1.6} aria-hidden="true" />
          <span className={shellStyles.summaryText}>
            <span className={shellStyles.name}>{entry.name}</span>
            <span className={`${shellStyles.command}${missing ? ` ${shellStyles.missing}` : ''}`}>
              {describeShellEntry(entry) || t('terminal:shellSettings.configured.needsCommand')}
            </span>
          </span>
          <ChevronDown className={shellStyles.chevron} size={14} aria-hidden="true" />
        </SettingsButton>
        <div className={shellStyles.entryActions}>
          <SettingsButton
            type="button"
            className={shellStyles.stateButton}
            aria-label={t('terminal:shellSettings.visibility.default')}
            aria-pressed={entry.isDefault}
            disabled={!isShellEntryLaunchable(entry)}
            onClick={onMakeDefault}
          >
            <Star size={13} strokeWidth={1.8} fill={entry.isDefault ? 'currentColor' : 'none'} aria-hidden="true" />
            {t(entry.isDefault ? 'terminal:shellSettings.configured.default' : 'terminal:shellSettings.configured.makeDefault')}
          </SettingsButton>
          <SettingsButton
            type="button"
            className={shellStyles.visibilityButton}
            aria-label={t(entry.visible ? 'terminal:shellSettings.visibility.visible' : 'terminal:shellSettings.visibility.hidden')}
            aria-pressed={entry.visible}
            onClick={() => onPatch(entry.id, { visible: !entry.visible })}
          >
            {entry.visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
            {t(entry.visible ? 'terminal:shellSettings.configured.visible' : 'terminal:shellSettings.configured.hidden')}
          </SettingsButton>
        </div>
      </div>

      <div id={detailsId} className={shellStyles.editor} hidden={!expanded}>
        <label className={styles.lsField}>
          <span className={styles.lsFieldLabel}>{t('terminal:shellSettings.configured.name')}</span>
          <SettingsInput
            className={styles.lsInput}
            value={entry.name}
            placeholder={t('terminal:shellSettings.configured.newName')}
            autoFocus={!entry.command.trim()}
            onChange={(event) => onPatch(entry.id, { name: event.target.value })}
          />
        </label>
        <label className={styles.lsField}>
          <span className={styles.lsFieldLabel}>{t('terminal:shellSettings.configured.command')}</span>
          <SettingsInput
            className={`${styles.lsInput}${missing ? ` ${styles.lsInputMissing}` : ''}`}
            value={entry.command}
            placeholder="bash --login -i"
            spellCheck={false}
            onChange={(event) => onPatch(entry.id, { command: event.target.value })}
          />
        </label>
        <label className={styles.lsField}>
          <span className={styles.lsFieldLabel}>
            {t('terminal:shellSettings.configured.suffix')}
            <span className={shellStyles.optional}>{t('terminal:shellSettings.configured.optional')}</span>
          </span>
          <SettingsInput
            className={`${styles.lsInput}`}
            value={entry.suffix ?? ''}
            placeholder="--login -i"
            spellCheck={false}
            onChange={(event) => onPatch(entry.id, { suffix: event.target.value })}
          />
        </label>
        <div className={shellStyles.editorFooter}>
          <span className={styles.generalHelp}>{t('terminal:shellSettings.configured.launchHelp')}</span>
          <SettingsButton variant="danger" type="button" className={shellStyles.removeButton} onClick={() => onRemove(entry.id)}>
            <Trash2 size={13} aria-hidden="true" />
            {t('terminal:shellSettings.configured.remove')}
          </SettingsButton>
        </div>
      </div>
      {missing && (
        <div className={`${styles.lsMissingRow} ${shellStyles.missingRow}`} role="status">
          <span className={styles.lsMissingText}>
            {t('terminal:shellSettings.configured.missing', { executable: executableOf(entry) })}
          </span>
          <SettingsButton type="button" className={styles.lsLinkButton} onClick={onRedetect}>
            {t('terminal:shellSettings.configured.redetect')}
          </SettingsButton>
          <SettingsButton
            type="button"
            className={styles.lsLinkButton}
            onClick={() => onPatch(entry.id, { visible: false })}
          >
            {t('terminal:shellSettings.configured.hide')}
          </SettingsButton>
        </div>
      )}
    </div>
  )
}
