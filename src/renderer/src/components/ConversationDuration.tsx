import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function ConversationDuration({ startedAt, durationMs }: { startedAt?: number; durationMs?: number }) {
  const { t } = useTranslation('terminal')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startedAt === undefined || durationMs !== undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt, durationMs])
  const elapsed = durationMs ?? (startedAt === undefined ? undefined : Math.max(0, now - startedAt))
  if (elapsed === undefined || !Number.isFinite(elapsed)) return null
  const seconds = Math.floor(Math.max(0, elapsed) / 1000)
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return <span aria-label={t('conversation.duration', { duration })} title={t('conversation.duration', { duration })}>{duration}</span>
}
