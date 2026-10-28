import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/i18n/useI18n'
import { updateExperimentalFeatures } from '@/services/experimental-features'
import { useExperimentalStore } from '@/stores/experimental'
import type { ExperimentalFeatures } from '../../../shared/ipc/experimental'
import styles from './NotificationSettingsPanel.module.css'
import confirmationStyles from './ExperimentalSettingsPanel.module.css'

type FeatureKey = keyof ExperimentalFeatures

// Note: persona stays in development while project knowledge matures — see .agents/notes/knowledge/memory-domain-controls.md
// Note: sessions and memos are default features — see .agents/notes/workbench/experimental-preview-features.md
// Note: blueprint is installed and managed as an official plugin; see .agents/notes/planning/blueprint-official-plugin.md
const DEV_FEATURES: FeatureKey[] = ['persona', 'roundtable', 'remoteControl', 'teamCollab']

// Note: every feature transition requires explicit confirmation — see .agents/notes/knowledge/assistant-persona-layout.md
export function ExperimentalSettingsPanel() {
  const { t } = useI18n('settings')
  const loaded = useExperimentalStore((s) => s.loaded)
  const load = useExperimentalStore((s) => s.load)
  const apply = useExperimentalStore((s) => s.apply)
  const blueprint = useExperimentalStore((s) => s.blueprint)
  const knowledge = useExperimentalStore((s) => s.knowledge)
  const roundtable = useExperimentalStore((s) => s.roundtable)
  const persona = useExperimentalStore((s) => s.persona)
  const remoteControl = useExperimentalStore((s) => s.remoteControl)
  const teamCollab = useExperimentalStore((s) => s.teamCollab)
  const [savingKey, setSavingKey] = useState<FeatureKey | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ key: FeatureKey; value: boolean } | null>(null)
  const saving = useRef(false)

  useEffect(() => {
    void load()
  }, [load])

  const checked: Record<FeatureKey, boolean> = { blueprint, knowledge, roundtable, persona, remoteControl, teamCollab }
  const apiMissing = typeof window.electron?.experimental === 'undefined'
  const busy = !loaded || savingKey !== null || pending !== null

  const toggle = (key: FeatureKey, value: boolean) => {
    if (busy || apiMissing || checked[key] === value) return
    setPending({ key, value })
  }

  const doToggle = async (key: FeatureKey, value: boolean) => {
    if (saving.current) return
    saving.current = true
    setSavingKey(key)
    setError('')
    try {
      const next = await updateExperimentalFeatures({ [key]: value })
      apply(next)
    } catch {
      setError(t('settings:experimental.error.save'))
    } finally {
      saving.current = false
      setSavingKey(null)
      setPending(null)
    }
  }

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={`${styles.status} ${styles.statusError}`} role="note">
          {t('settings:experimental.warning')}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings:experimental.section.dev')}</h3>
        {apiMissing && (
          <div className={styles.status}>{t('settings:experimental.unavailable')}</div>
        )}
        {DEV_FEATURES.map((key) => (
          <SettingSwitch
            key={key}
            label={t(`settings:experimental.toggle.${key}.label`)}
            hint={t(`settings:experimental.toggle.${key}.hint`)}
            note={t(`settings:experimental.toggle.${key}.note`)}
            checked={checked[key]}
            disabled={busy || apiMissing}
            onChange={(value) => void toggle(key, value)}
          />
        ))}
        {savingKey && <div className={styles.status}>{t('settings:footer.saving')}</div>}
        {error && <div role="alert" className={`${styles.status} ${styles.statusError}`}>{error}</div>}
      </section>

      {pending && <FeatureConfirmation
        title={t(`settings:experimental.confirm.${pending.value ? 'enableTitle' : 'disableTitle'}`, { name: t(`settings:experimental.toggle.${pending.key}.label`) })}
        description={t(`settings:experimental.confirm.${pending.value ? 'enableDescription' : 'disableDescription'}`)}
        hint={t(`settings:experimental.toggle.${pending.key}.hint`)}
        note={t(`settings:experimental.toggle.${pending.key}.note`)}
        confirmText={savingKey ? t('settings:footer.saving') : t(`settings:experimental.confirm.${pending.value ? 'enable' : 'disable'}`)}
        cancelText={t('settings:experimental.confirm.cancel')}
        busy={savingKey !== null}
        onConfirm={() => void doToggle(pending.key, pending.value)}
        onCancel={() => { if (!saving.current) setPending(null) }}
      />}
    </div>
  )
}

function FeatureConfirmation({ title, description, hint, note, confirmText, cancelText, busy, onConfirm, onCancel }: {
  title: string; description: string; hint: string; note: string; confirmText: string; cancelText: string
  busy: boolean; onConfirm: () => void; onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return createPortal(
    <dialog ref={ref} className={confirmationStyles.dialog} aria-labelledby="experimental-confirm-title"
      aria-describedby="experimental-confirm-description" aria-busy={busy}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => { event.preventDefault(); onCancel() }}>
      <h2 id="experimental-confirm-title">{title}</h2>
      <p id="experimental-confirm-description">{description}</p>
      <p>{hint}</p>
      <p className={confirmationStyles.note}>{note}</p>
      <div className={confirmationStyles.actions}>
        <button type="button" autoFocus disabled={busy} onClick={onCancel}>{cancelText}</button>
        <button type="button" disabled={busy} className={confirmationStyles.confirm} onClick={onConfirm}>{confirmText}</button>
      </div>
    </dialog>, document.body,
  )
}

function SettingSwitch({ label,
  hint,
  note,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  note: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className={styles.row}>
      <div className={styles.label}>
        <span className={styles.labelText}>{label}</span>
        <span className={styles.hint}>{hint}</span>
        <span className={styles.note}>{note}</span>
      </div>
      <label className={styles.switch}>
        <input
          type="checkbox"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className={styles.switchTrack} />
      </label>
    </div>
  )
}
