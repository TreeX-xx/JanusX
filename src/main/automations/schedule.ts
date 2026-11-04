import type { AutomationInput } from '../../shared/automations'

// Fixed product policy; no user-facing tuning controls.
export const MISSED_GRACE_MS = 60 * 60 * 1000
export const RUN_TIMEOUT_MS = 30 * 60 * 1000
export const RUN_HISTORY_LIMIT = 100

export function nextOccurrence(input: AutomationInput, after: number): string | null {
  if (!input.enabled || input.schedule === 'manual') return null
  if (input.schedule === 'interval') {
    if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes! < 1 || input.intervalMinutes! > 10080) throw new Error('Invalid interval minutes')
    return new Date(after + input.intervalMinutes! * 60_000).toISOString()
  }
  const format = new Intl.DateTimeFormat('en-US', { timeZone: input.timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const previous = Object.fromEntries(format.formatToParts(after).map(part => [part.type, part.value]))
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  for (let at = Math.floor(after / 60_000) * 60_000 + 60_000; at <= after + 8 * 86400_000; at += 60_000) {
    const parts = Object.fromEntries(format.formatToParts(at).map(part => [part.type, part.value]))
    if (`${parts.hour}:${parts.minute}` !== input.time) continue
    // A repeated wall-clock hour at DST fall-back still represents one daily occurrence.
    if (parts.year === previous.year && parts.month === previous.month && parts.day === previous.day && `${previous.hour}:${previous.minute}` >= input.time) continue
    if (input.schedule === 'weekdays' && ['Sat', 'Sun'].includes(parts.weekday)) continue
    if (input.schedule === 'weekly' && parts.weekday !== days[input.weekday]) continue
    return new Date(at).toISOString()
  }
  throw new Error('No schedule occurrence within eight days')
}
