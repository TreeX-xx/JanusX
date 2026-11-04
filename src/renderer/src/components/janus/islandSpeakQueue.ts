// Notification delivery and reading are independent. Closing a surface never deletes history.
import type { IslandNotification } from './islandNotifications'

export interface IslandSpeakEntry {
  id: string
  body: string
  at: number
  title?: string
  kicker?: string
  groupKey?: string
  notification?: IslandNotification
}

export interface IslandNoticeRecord extends IslandSpeakEntry {
  key: string
  count: number
  read: boolean
}

export interface IslandSpeakSnapshot {
  speaking: IslandNoticeRecord | null
  historyCount: number
  unreadCount: number
  /** Stable chronological order: arrivals never move the row being read. */
  history: readonly IslandNoticeRecord[]
  pendingCount: number
  nextEventAt: number
}

export class IslandSpeakQueue {
  private pending: IslandNoticeRecord[] = []
  private history: IslandNoticeRecord[] = []
  private seen = new Set<string>()
  private current: IslandNoticeRecord | null = null
  private speakUntil = 0
  private resumeAt = 0
  private paused = false
  private pausedAt: number | null = null
  private readonly soloHoldMs: number
  private readonly queuedHoldMs: number
  private readonly gapMs: number
  private readonly historyLimit: number

  constructor(opts: { soloHoldMs?: number; queuedHoldMs?: number; gapMs?: number; historyLimit?: number } = {}) {
    this.soloHoldMs = opts.soloHoldMs ?? 6000
    this.queuedHoldMs = opts.queuedHoldMs ?? 6000
    this.gapMs = opts.gapMs ?? 420
    this.historyLimit = opts.historyLimit ?? 50
  }

  enqueue(entry: IslandSpeakEntry, now: number, present = true): void {
    const key = entry.groupKey ?? entry.id
    const previous = this.history.find(item => item.key === key)
    if (this.seen.has(entry.id)) {
      // Live plugin progress may update an existing notice; a cleared notice stays cleared.
      if (previous?.id === entry.id) {
        const updated = { ...previous, ...entry, at: previous.at }
        this.history = this.history.map(item => item.key === key ? updated : item)
        this.pending = this.pending.map(item => item.key === key ? updated : item)
        if (this.current?.key === key) this.current = updated
      }
      return
    }
    this.seen.add(entry.id)
    const record: IslandNoticeRecord = { ...entry, key, count: (previous?.count ?? 0) + 1, read: false }
    this.history = previous
      ? this.history.map(item => item.key === key ? record : item)
      : [...this.history, record].slice(-this.historyLimit)
    const retained = new Set(this.history.map(item => item.key))
    this.pending = this.pending.filter(item => retained.has(item.key) && item.key !== key)
    if (this.current && !retained.has(this.current.key)) this.current = null
    if (!present) return
    if (this.current?.key === key) {
      this.current = record
      this.speakUntil = now + this.soloHoldMs
      if (this.paused) this.pausedAt = now
    } else {
      this.pending.push(record)
      this.pump(now)
    }
  }

  dismiss(now: number): boolean {
    if (!this.current) return false
    this.current = null
    this.pausedAt = null
    this.resumeAt = now + this.gapMs
    return true
  }

  /** Reading/Chat suppresses presentation, preserving unread records. */
  silence(): void {
    this.pending = []
    this.current = null
    this.pausedAt = null
  }

  setPaused(paused: boolean, now: number): void {
    if (this.paused === paused) return
    this.paused = paused
    if (paused && this.current) this.pausedAt = now
    else if (!paused && this.pausedAt !== null) {
      this.speakUntil += now - this.pausedAt
      this.pausedAt = null
    }
  }

  markRead(key: string): void {
    this.history = this.history.map(item => item.key === key ? { ...item, read: true } : item)
  }

  clear(readOnly = false): void {
    this.history = readOnly ? this.history.filter(item => !item.read) : []
    const retained = new Set(this.history.map(item => item.key))
    this.pending = this.pending.filter(item => retained.has(item.key))
    if (this.current && !retained.has(this.current.key)) this.current = null
  }

  removeAutomation(id: string): void {
    this.history = this.history.filter(item => item.notification?.automation?.definitionId !== id)
    this.pending = this.pending.filter(item => item.notification?.automation?.definitionId !== id)
    if (this.current?.notification?.automation?.definitionId === id) { this.current = null; this.pausedAt = null }
  }

  step(now: number): IslandSpeakSnapshot {
    if (this.current && !this.paused && now >= this.speakUntil) this.dismiss(now)
    this.pump(now)
    return {
      speaking: this.current,
      historyCount: this.history.length,
      unreadCount: this.history.filter(item => !item.read).length,
      history: this.history,
      pendingCount: this.pending.length + (this.current ? 1 : 0),
      nextEventAt: this.current
        ? this.paused ? Number.POSITIVE_INFINITY : this.speakUntil
        : this.pending.length ? Math.max(this.resumeAt, now) : Number.POSITIVE_INFINITY,
    }
  }

  private pump(now: number): void {
    if (this.current || !this.pending.length || now < this.resumeAt) return
    this.current = this.pending.shift()!
    this.speakUntil = now + (this.pending.length ? this.queuedHoldMs : this.soloHoldMs)
    if (this.paused) this.pausedAt = now
  }
}
