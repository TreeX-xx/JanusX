import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Select, SettingsCheckbox, settingsStyles as styles, type SelectOption } from '@janusx/ui'
import { RefreshCw } from 'lucide-react'
import type { Backend, SettingsCall } from './WorkerSettings'

export type Profile = { model: string | null; effort: string | null }
const efforts = {
  none: ['None', '无'], minimal: ['Minimal', '最低'], low: ['Low', '低'], medium: ['Medium', '中'],
  high: ['High', '高'], xhigh: ['Extra high', '极高'], max: ['Maximum (max)', '最大（max）'], ultra: ['Ultra', '超强（ultra）'],
}

type Props = {
  backend: Backend; enabled: boolean; isDefault: boolean; busy: boolean; zh: boolean
  call: SettingsCall; profile: Profile; resetKey: number
  onProfile(profile: Profile): void; onDefault(): void; onEnable(enabled: boolean): void
}

export function WorkerProfile({ backend, enabled, isDefault, busy, zh, call, profile, resetKey, onProfile, onDefault, onEnable }: Props) {
  const [models, setModels] = useState<string[]>([])
  const [catalog, setCatalog] = useState<'loading' | 'ready' | 'error'>('loading')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setCatalog('loading')
    call('settings.models', backend).then(result => {
      if (!active) return
      setModels([...new Set(result as string[])])
      setCatalog('ready')
    }).catch(() => { if (active) setCatalog('error') })
    return () => { active = false }
  }, [backend, call, revision])

  const text = (en: string, cn: string) => zh ? cn : en
  const name = backend === 'codex' ? 'Codex' : 'Claude Code'
  const disabled = busy || !enabled
  return <section className="worker-profile" aria-label={name}>
    <header><h4>{name}</h4><div className="engine-actions">
      <Button size="small" variant={isDefault ? 'tab' : 'ghost'} aria-pressed={isDefault} disabled={busy} onClick={onDefault}>
        {isDefault ? text('Default', '默认执行') : text('Set as default', '设为默认')}
      </Button>
      <label><SettingsCheckbox aria-label={text('Enable ', '启用 ') + name} checked={enabled} disabled={busy || isDefault}
        onChange={event => onEnable(event.target.checked)} />{text('Enabled', '启用')}</label>
    </div></header>
    <div className="profile-fields">
      <Choice key={'model-' + resetKey} id={'worker-model-' + backend} label={text('Default model', '默认模型')} zh={zh} disabled={disabled}
        value={profile.model} options={models.map(value => ({ value, label: value }))}
        onChange={model => onProfile({ model, effort: model === profile.model ? profile.effort : null })}
        action={<Button variant="ghost" size="icon" disabled={busy || catalog === 'loading'} aria-label={text('Refresh models', '刷新模型')}
          onClick={() => setRevision(n => n + 1)}><RefreshCw size={15} /></Button>}>
        {(catalog !== 'ready' || !models.length) && <span className={styles.hint} role="status">{catalog === 'error' ?
          text('Models unavailable. Try refreshing.', '模型目录不可用，请尝试刷新。') : catalog === 'loading' ?
          text('Loading models…', '正在加载模型…') : text('No models returned by the CLI.', 'CLI 未返回模型。')}</span>}
      </Choice>
      <Choice key={'effort-' + resetKey} id={'worker-effort-' + backend} label={text('Reasoning effort', '推理强度')} zh={zh} disabled={disabled}
        value={profile.effort} options={Object.entries(efforts).map(([value, labels]) => ({ value, label: labels[zh ? 1 : 0] }))}
        onChange={effort => onProfile({ ...profile, effort })} />
    </div>
  </section>
}

type ChoiceProps = {
  id: string; label: string; zh: boolean; disabled: boolean; value: string | null
  options: SelectOption[]; onChange(value: string | null): void; action?: ReactNode; children?: ReactNode
}

// Native catalogs can be offline or omit a user-defined model. Keep manual IDs editable.
function Choice({ id, label, zh, disabled, value, options, onChange, action, children }: ChoiceProps) {
  const [custom, setCustom] = useState(false)
  const native = { value: '', label: zh ? '原生默认' : 'Native default' }
  const choices = [native, ...options]
  if (value && !options.some(option => option.value === value)) choices.push({ value, label: value })
  const other = { value: ':custom', label: zh ? '自定义…' : 'Custom…' }
  return <div className="profile-field">
    <label htmlFor={id}>{label}</label>
    <div className="profile-select">
      <Select id={id} role="combobox" ariaLabel={label} value={custom ? other.value : value ?? ''} options={[...choices, other]}
        disabled={disabled} onChange={next => {
          setCustom(next === other.value)
          if (next !== other.value) onChange(next || null)
        }} />
      {action}
    </div>
    {custom && <Input aria-label={label + ' ID'} disabled={disabled} value={value ?? ''} onChange={event => onChange(event.target.value || null)}
      onBlur={event => {
        const trimmed = event.target.value.trim() || null
        if (trimmed !== value) onChange(trimmed)
      }} />}
    {children}
  </div>
}
