// Note: 胶囊传话队列（串行播报 / 收起续播 / 面板清队 / 看过即焚）—
// 设计定稿见 .agents/notes/workbench/tasks/island-behavior-system.md（P3）。
// 纯逻辑、时间由调用方注入；实验台修过的三个语义在这里固化：
// 收起当前条队列必须续播、打开面板=已读清队、历史与计数一致。

export interface IslandSpeakEntry {
  id: string
  body: string
  at: number
  /** 小标签（kicker 已解析文本，如 NOTICE / CODER） */
  kicker?: string
}

export interface IslandSpeakSnapshot {
  /** 正在传话的条目；无则 null */
  speaking: IslandSpeakEntry | null
  /** 历史条数（= 左上角计数；看过即焚由 burnHistory 清零） */
  historyCount: number
  /** 含当前在内的待播总数 */
  pendingCount: number
  /** 下一个必然变化的时刻（毫秒时间戳；空闲时为远期哨兵） */
  nextEventAt: number
}

export class IslandSpeakQueue {
  private pending: IslandSpeakEntry[] = []
  private history: IslandSpeakEntry[] = []
  private current: IslandSpeakEntry | null = null
  private speakUntil = 0
  private resumeAt = 0
  private readonly soloHoldMs: number
  private readonly queuedHoldMs: number
  private readonly gapMs: number

  constructor(opts: { soloHoldMs?: number; queuedHoldMs?: number; gapMs?: number } = {}) {
    this.soloHoldMs = opts.soloHoldMs ?? 2600
    this.queuedHoldMs = opts.queuedHoldMs ?? 1900
    this.gapMs = opts.gapMs ?? 420
  }

  /** 通知到达：入历史与待播队列。 */
  enqueue(entry: IslandSpeakEntry, now: number): void {
    this.history.push(entry)
    this.pending.push(entry)
    this.pump(now)
  }

  /** 收起当前条（keepQueue：队列续播，不连坐清定时器）。 */
  dismiss(now: number): boolean {
    if (!this.current) return false
    this.current = null
    this.resumeAt = now + this.gapMs
    return true
  }

  /** 打开通知中心 = 已读：中断当前、清空待播；历史保留给面板展示。 */
  markSeen(): void {
    this.pending = []
    this.current = null
  }

  /** 看过即焚：收起面板时清空历史，返回清掉的条数。 */
  burnHistory(): number {
    const n = this.history.length
    this.history = []
    return n
  }

  historyList(): readonly IslandSpeakEntry[] {
    return this.history
  }

  step(now: number): IslandSpeakSnapshot {
    if (this.current && now >= this.speakUntil) {
      this.current = null
      this.resumeAt = now + this.gapMs
    }
    this.pump(now)
    return {
      speaking: this.current,
      historyCount: this.history.length,
      pendingCount: this.pending.length + (this.current ? 1 : 0),
      nextEventAt: this.current
        ? this.speakUntil
        : this.pending.length
          ? Math.max(this.resumeAt, now)
          : now + 600_000,
    }
  }

  private pump(now: number): void {
    if (this.current || !this.pending.length || now < this.resumeAt) return
    this.current = this.pending.shift()!
    // 还有排队时略赶一点（lab 定稿节奏）
    this.speakUntil = now + (this.pending.length ? this.queuedHoldMs : this.soloHoldMs)
  }
}
