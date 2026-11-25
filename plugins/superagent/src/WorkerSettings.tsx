// Notes: .agents/notes/workbench/settings-layout.md and .agents/notes/agent/superagent-interface.md
import { useEffect, useState } from 'react'
import { Button, Input, SettingsFooter, SettingsRow, SettingsSection, SettingsSurface, settingsStyles as styles } from '@janusx/ui'
import type { JsonValue } from '@janusx/plugin-sdk'
import { Cpu, Layers3 } from 'lucide-react'
import { WorkerProfile, type Profile } from './WorkerProfile'

export type Backend = 'codex' | 'claude'
export type SettingsCall = (method: string, input?: JsonValue) => Promise<JsonValue>
const backends: Backend[] = ['codex', 'claude']
type Policy = { defaultBackend: Backend; enabled: Backend[] }
type Settings = Policy & { profiles: Record<Backend, Profile>; idle: number; capacity: number | null }
type Props = { call: SettingsCall; zh: boolean }

export function WorkerSettings({ call, zh }: Props) {
  const [initial, setInitial] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    call('settings.read').then(result => {
      if (active) setInitial(result as Settings)
    }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [call, revision])

  return <SettingsSurface className={styles.panel + ' worker-settings'}>
    {initial ? <Editor initial={initial} call={call} zh={zh} /> : error ? <div>
      <p role="alert">{error}</p>
      <Button onClick={() => setRevision(value => value + 1)}>{zh ? '重新加载' : 'Reload'}</Button>
    </div> : <p role="status">{zh ? '正在加载设置…' : 'Loading settings…'}</p>}
  </SettingsSurface>
}

function Editor({ initial, call, zh }: Props & { initial: Settings }) {
  const [saved, setSaved] = useState(initial)
  const [profiles, setProfiles] = useState(initial.profiles)
  const [policy, setPolicy] = useState<Policy>({ defaultBackend: initial.defaultBackend, enabled: initial.enabled })
  const [idle, setIdle] = useState(String(initial.idle))
  const [capacity, setCapacity] = useState(String(initial.capacity ?? ''))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const text = (en: string, cn: string) => zh ? cn : en
  const busy = status === 'saving'
  const idleValid = Number.isInteger(+idle) && +idle >= 1 && +idle <= 10080
  const capacityValid = saved.capacity === null || (Number.isSafeInteger(+capacity) && +capacity >= 1)
  const idleError = text('Enter a whole number of minutes between 1 and 10080.', '请输入 1 到 10080 之间的整数分钟。')
  const capacityError = text('Enter a whole number greater than or equal to 1.', '请输入大于等于 1 的整数。')
  const policyChanged = policy.defaultBackend !== saved.defaultBackend || backends.some(id => policy.enabled.includes(id) !== saved.enabled.includes(id))
  const changedProfiles = backends.filter(id => profiles[id].model !== saved.profiles[id].model || profiles[id].effort !== saved.profiles[id].effort)
  const capacityChanged = saved.capacity !== null && +capacity !== saved.capacity
  const dirty = policyChanged || changedProfiles.length > 0 || +idle !== saved.idle || capacityChanged
  const edited = () => { setError(''); setStatus('idle') }

  async function save() {
    if (busy || !dirty || !idleValid || !capacityValid) return
    setError('')
    setStatus('saving')
    // Each host method commits independently. Retry only writes still outstanding.
    let confirmed = saved
    try {
      for (const id of changedProfiles) {
        const profile = profiles[id]
        await call('settings.model', { terminal: id, model: profile.model, effort: profile.effort })
        confirmed = { ...confirmed, profiles: { ...confirmed.profiles, [id]: profile } }
      }
      if (policyChanged) {
        const update = { defaultBackend: policy.defaultBackend, enabled: policy.enabled }
        await call('settings.save', update)
        confirmed = { ...confirmed, ...update }
      }
      if (+idle !== saved.idle) {
        await call('settings.idle', +idle)
        confirmed = { ...confirmed, idle: +idle }
      }
      if (capacityChanged) {
        await call('settings.capacity', +capacity)
        confirmed = { ...confirmed, capacity: +capacity }
      }
      setStatus('saved')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setStatus('idle')
    } finally {
      setSaved(confirmed)
    }
  }

  function restore() {
    setProfiles({ codex: { model: null, effort: null }, claude: { model: null, effort: null } })
    setIdle('30')
    setResetKey(key => key + 1)
    edited()
  }

  return <>
    <SettingsSection aria-labelledby="worker-engines">
      <h3 id="worker-engines" className={styles.sectionTitle}><Cpu size={17} />{text('Worker engines', 'Worker 引擎')}</h3>
      {backends.map(id => <WorkerProfile key={id} backend={id} profile={profiles[id]} enabled={policy.enabled.includes(id)}
        isDefault={policy.defaultBackend === id} busy={busy} call={call} zh={zh} resetKey={resetKey}
        onProfile={profile => { setProfiles(current => ({ ...current, [id]: profile })); edited() }}
        onDefault={() => {
          setPolicy({ defaultBackend: id, enabled: backends.filter(key => key === id || policy.enabled.includes(key)) })
          edited()
        }}
        onEnable={enabled => {
          setPolicy({ ...policy, enabled: backends.filter(key => key === id ? enabled : policy.enabled.includes(key)) })
          edited()
        }} />)}
    </SettingsSection>
    <SettingsSection aria-labelledby="worker-scheduling">
      <h3 id="worker-scheduling" className={styles.sectionTitle}><Layers3 size={17} />{text('Worker scheduling', 'Worker 调度')}</h3>
      <SettingsRow><div className={styles.label}>
        <label htmlFor="worker-capacity">{text('Concurrency limit', '并发上限')}</label>
        <p className={styles.hint} id="capacity-hint">{saved.capacity === null ? text('Scheduling is unavailable.', '调度当前不可用。') :
          text('Shared across workspaces. Additional tasks wait in the queue.', '所有工作区共用名额，超出上限的任务会排队。')}</p>
      </div>
        <div className={styles.numberControl}><Input id="worker-capacity" type="number" className={styles.input} min={1} step={1} value={capacity}
          aria-invalid={!capacityValid} aria-describedby="capacity-hint" disabled={busy || saved.capacity === null}
          onChange={event => { setCapacity(event.target.value); edited() }} /></div>
      </SettingsRow>
      <SettingsRow><div className={styles.label}>
        <label htmlFor="worker-idle">{text('Idle auto-close time', '空闲自动关闭时间')}</label>
        <p className={styles.hint} id="idle-hint">{text('Applies to completed, stopped Workers at the next check.', '仅回收已完成且确认停止的 Worker，下次检查时生效。')}</p>
      </div><div className={styles.numberControl}>
        <Input id="worker-idle" type="number" className={styles.input} min={1} max={10080} step={1} value={idle}
          aria-invalid={!idleValid} aria-describedby="idle-hint" disabled={busy} onChange={event => { setIdle(event.target.value); edited() }} />
        <span className={styles.unit}>{text('minutes', '分钟')}</span>
      </div></SettingsRow>
    </SettingsSection>
    <SettingsFooter>
      {error || !idleValid || !capacityValid ? <span className={styles.status + ' ' + styles.statusError} role="alert">{error || (!idleValid ? idleError : capacityError)}</span> :
        <span className={status === 'saved' ? styles.status + ' ' + styles.statusSuccess : styles.status} role="status">{busy ? text('Saving…', '正在保存…') : dirty ? text('Unsaved changes', '有未保存的修改') : status === 'saved' ? text('Saved', '已保存') : ''}</span>}
      <div className={styles.actions}>
        <Button variant="ghost" disabled={busy} onClick={restore} title={text('Reset models, reasoning and the idle timeout (30 minutes)', '重置模型、推理强度和空闲时间（30 分钟）')}>{text('Restore native defaults', '恢复原生默认')}</Button>
        <Button variant="primary" disabled={busy || !dirty || !idleValid || !capacityValid} onClick={() => void save()}>{text('Save', '保存')}</Button>
      </div>
    </SettingsFooter>
  </>
}
