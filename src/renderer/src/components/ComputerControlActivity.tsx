// Note: .agents/notes/desktop/browser-computer-use.md
import { useEffect, useState } from 'react'
import { Button } from '@janusx/ui'
import { useI18n } from '@/i18n/useI18n'
import type { ComputerActivity } from '../../../shared/ipc/control'

export function ComputerControlActivity({ owner }: { owner?: string }) {
  const { t } = useI18n('control')
  const [activities, setActivities] = useState<ComputerActivity[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const rows = await window.electron.controls.computerActivity()
        if (!cancelled) setActivities(rows.filter(row => !owner || owner === row.owner))
      } catch { if (!cancelled) setActivities([]) }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 750)
    return () => { cancelled = true; clearInterval(timer) }
  }, [owner])
  return <>{activities.filter(row => !owner || owner === row.owner).map(row =>
    <div key={row.runId}>
      <span>{t('computer.active', { target: row.target })}</span>{' '}
      <Button size="small" variant="danger" onClick={async () => {
        try {
          await window.electron.controls.stopComputer(row.runId)
          setActivities(current => current.filter(item => item.runId !== row.runId))
        } catch (cause) { setError(String(cause)) }
      }}>{t('computer.stop')}</Button>
    </div>)}{error && <span role="alert">{error}</span>}</>
}
