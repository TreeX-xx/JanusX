// Note: Janus 眼睛行为系统内核（凝视调度 / 眨眼生理 / 事件原语 / 摸头循环）—
// 设计定稿见 .agents/notes/workbench/tasks/island-behavior-system.md（P1）。
// 纯逻辑、无 DOM：时间与随机数可注入，单测覆盖；rAF 桥在 useJanusGaze.ts。

export type JanusBehaviorMode = 'sleep' | 'order' | 'analytics' | 'running'

export type JanusGazeState =
  | 'static'      // reduced-motion 降级
  | 'wander'      // 自主游荡
  | 'attracted'   // 被鼠标吸引
  | 'dwell'       // 驻留跟随
  | 'lookaway'    // 主动移开（含偏置）
  | 'rest'        // 疲劳休息（忽略鼠标）
  | 'petting'     // 被摸头 · 闭眼享受
  | 'peeking'     // 被摸头 · 睁眼偷看
  | 'reading'     // 通知中心开着 · 低头看列表
  | 'event'       // 事件注视（传话/通知方向）

export interface JanusBehaviorParams {
  /** 感知半径 px */
  radius: number
  /** 驻留时长 ms */
  dwellMs: number
  /** 跟随阻尼（每 16.7ms 帧的插值系数 ×100） */
  lerp: number
  /** 眼动幅度 px（1× 尺寸） */
  gazeAmp: number
  /** 头部微移 px */
  headAmp: number
  /** 眨眼下限/上限 ms（非均匀随机） */
  blinkMinMs: number
  blinkMaxMs: number
  /** 双眨概率 0-1 */
  doubleBlinkP: number
  /** 游荡间隔 ms（实际 ×0.6-1.4 抖动） */
  wanderIntervalMs: number
  /** 连续跟随多少次进入疲劳 */
  fatigueAfter: number
  /** 疲劳休息 ms */
  restMs: number
  /** 摸头闭眼享受时长 ms */
  closeMs: number
  /** 睁眼偷看时长 ms */
  peekMs: number
  /** 大幅扫视前先眨眼 */
  blinkBeforeSaccade: boolean
  /** running 态凝视降权系数 */
  runningGazeScale: number
}

/** 2026-10-23 用户实测定稿（实验台手感参数）。 */
export const JANUS_BEHAVIOR_DEFAULTS: JanusBehaviorParams = {
  radius: 250,
  dwellMs: 3000,
  lerp: 12,
  gazeAmp: 2.4,
  headAmp: 1,
  blinkMinMs: 2200,
  blinkMaxMs: 6500,
  doubleBlinkP: 0.18,
  wanderIntervalMs: 4500,
  fatigueAfter: 3,
  restMs: 6000,
  closeMs: 2200,
  peekMs: 2800,
  blinkBeforeSaccade: true,
  runningGazeScale: 0.35,
}

export interface GazeStepInput {
  now: number
  /** 帧间隔 ms，建议已 clamp 到 ≤64 */
  dtMs: number
  mode: JanusBehaviorMode
  /** 指针位置（页面坐标）；null = 无指针 */
  pointer: { x: number; y: number } | null
  /** 指针是否「新鲜」（近期有移动） */
  pointerFresh: boolean
  /** 胶囊中心（页面坐标） */
  islandCenter: { x: number; y: number }
  /** 指针停在胶囊上（含容差，由调用方判定） */
  hover: boolean
  /** 通知中心展开中 */
  panelOpen: boolean
  reducedMotion: boolean
}

export interface JanusGazeFrame {
  gazeX: number
  gazeY: number
  faceX: number
  faceY: number
  /** 眼睑开度 1=睁 */
  lid: number
  /** 惊跳压扁 */
  sx: number
  sy: number
  state: JanusGazeState
  /** 输出全部收敛、可停帧 */
  settled: boolean
  /** 下一个必然有输出变化的时刻（停帧唤醒用） */
  nextWakeupAt: number
}

export type JanusReaction = 'flinch' | 'nod' | 'fail' | 'greet' | 'wake'

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lerpNum = (a: number, b: number, t: number) => a + (b - a) * t

interface BlinkState {
  t0: number
  dur: number
  double: boolean
}

export class JanusGazeScheduler {
  params: JanusBehaviorParams
  private random: () => number

  // 注意力
  private attention: 'auto' | 'mouse' | 'event' = 'auto'
  private dwellUntil = 0
  private restUntil = 0
  private followCount = 0
  private eventUntil = 0
  private eventTarget = { x: 0, y: 0 }

  // 注视物理
  private gaze = { x: 0, y: 0 }
  private gazeTarget = { x: 0, y: 0 }
  private face = { x: 0, y: 0 }
  private wanderTarget = { x: 0, y: 0 }
  private lookawayUntil = 0
  private lookawayBias = { x: 0, y: 0 }
  private nextWanderAt = 0

  // 生理
  private lid = 1
  private lidTarget = 1
  private blink: BlinkState | null = null
  private nextBlinkAt = 0

  // 摸头（-1 = 未在摸）
  private hoverT0 = -1
  private hoverPeekLogged = false

  // 事件原语
  private flinchT0 = -1e9
  private nodT0 = -1e9
  private failT0 = -1e9

  constructor(params: Partial<JanusBehaviorParams> = {}, random: () => number = Math.random) {
    this.params = { ...JANUS_BEHAVIOR_DEFAULTS, ...params }
    this.random = random
  }

  /** 首帧或换会话时重置时基。 */
  reset(now: number): void {
    this.attention = 'auto'
    this.dwellUntil = 0
    this.restUntil = 0
    this.followCount = 0
    this.eventUntil = 0
    this.gaze = { x: 0, y: 0 }
    this.gazeTarget = { x: 0, y: 0 }
    this.face = { x: 0, y: 0 }
    this.lid = 1
    this.blink = null
    this.hoverT0 = -1
    this.flinchT0 = -1e9
    this.nodT0 = -1e9
    this.failT0 = -1e9
    this.scheduleBlink(now)
    this.nextWanderAt = now + this.params.wanderIntervalMs
  }

  /** 事件注视：看向指定方向（相对幅度坐标，调用方换算）。 */
  lookAt(x: number, y: number, durationMs: number, now: number): void {
    const amp = this.params.gazeAmp
    this.attention = 'event'
    this.eventUntil = now + durationMs
    this.eventTarget = { x: clamp(x, -amp, amp), y: clamp(y, -amp, amp) }
  }

  react(kind: JanusReaction, now: number): void {
    if (kind === 'flinch') {
      // 闭眼享受时被点击 = 惊醒：直接进入睁眼偷看阶段
      if (this.hoverT0 >= 0 && this.lid < 0.35) {
        this.hoverT0 = now - this.params.closeMs - 60
        return
      }
      this.flinchT0 = now
      this.triggerBlink(now, true)
      return
    }
    if (kind === 'wake') {
      if (this.hoverT0 >= 0) this.hoverT0 = now - this.params.closeMs - 60
      this.triggerBlink(now, true)
      return
    }
    if (kind === 'nod') this.nodT0 = now
    else if (kind === 'fail') this.failT0 = now
    else if (kind === 'greet') {
      // 打招呼 = 一次强制双眨
      this.triggerBlink(now, false)
      if (this.blink) this.blink.double = true
    }
  }

  step(input: GazeStepInput): JanusGazeFrame {
    const { now, mode, hover, panelOpen, reducedMotion } = input
    const dt = clamp(input.dtMs, 0, 64)

    if (reducedMotion) {
      this.lid = 1
      this.gaze = { x: 0, y: 0 }
      this.face = { x: 0, y: 0 }
      return this.composeFrame(now, 1, 1, 'static', true)
    }

    const p = this.params
    const amp = p.gazeAmp

    /*─ 1. 注意力调度 ─*/
    let lidTarget = 1
    if (panelOpen) {
      lidTarget = 1
      this.gazeTarget = { x: 0, y: amp * 0.65 }
    } else if (this.attention === 'event') {
      if (now > this.eventUntil) {
        this.attention = 'auto'
      } else {
        this.gazeTarget = { ...this.eventTarget }
      }
    }

    if (!panelOpen && this.attention !== 'event') {
      if (hover) {
        /*─ 被摸头：闭眼享受 ↔ 睁眼偷看 循环 ─*/
        const closeDur = p.closeMs
        const peekDur = p.peekMs
        if (this.hoverT0 < 0) {
          this.hoverT0 = now
          this.hoverPeekLogged = false
        }
        const cyc = (now - this.hoverT0) % (closeDur + peekDur)
        if (cyc < closeDur) {
          lidTarget = 0.05
          this.gazeTarget = { x: 0, y: 0.5 }
          this.hoverPeekLogged = false
        } else {
          lidTarget = 1
          const dir = this.dirToPointer(input)
          this.gazeTarget = { x: dir.x * amp * 0.85, y: dir.y * amp * 0.55 }
          this.hoverPeekLogged = true
        }
      } else {
        if (this.hoverT0 >= 0) this.hoverT0 = -1
        if (this.attention === 'mouse') {
          const dir = this.dirToPointer(input)
          this.gazeTarget = { x: dir.x * amp, y: dir.y * amp * 0.85 }
          if (now > this.dwellUntil || !input.pointerFresh || dir.dist > p.radius * 1.35) {
            // 主动移开：朝鼠标反方向偏置（同帧生效）
            this.attention = 'auto'
            this.lookawayUntil = now + 700
            this.lookawayBias = { x: -dir.x * amp * 0.55, y: -dir.y * amp * 0.3 }
            this.gazeTarget = { ...this.lookawayBias }
            this.followCount++
            if (this.followCount >= p.fatigueAfter) {
              this.restUntil = now + p.restMs
              this.followCount = 0
            }
          }
        } else {
          // auto：吸引 / 游荡
          const dir = this.dirToPointer(input)
          if (input.pointerFresh && input.pointer && dir.dist < p.radius && now > this.restUntil) {
            this.attention = 'mouse'
            this.dwellUntil = now + p.dwellMs
          } else {
            if (now > this.nextWanderAt) this.pickWanderTarget(now, mode)
            const bias = now < this.lookawayUntil ? this.lookawayBias : { x: 0, y: 0 }
            this.gazeTarget = { x: this.wanderTarget.x + bias.x, y: this.wanderTarget.y + bias.y }
          }
        }
      }
    }

    /*─ 2. 眨眼生理 ─*/
    this.lidTarget = lidTarget
    if (lidTarget < 0.3 && !this.blink) {
      this.nextBlinkAt = Math.max(this.nextBlinkAt, now + 800)
    }
    if (now >= this.nextBlinkAt && !this.blink) this.triggerBlink(now, false)
    if (this.blink) {
      const b = this.blink
      const pr = (now - b.t0) / b.dur
      if (now < b.t0) {
        // 预备段（双眨间隔）：保持目标
        this.lid = lerpNum(this.lid, lidTarget, this.k(dt))
      } else if (pr >= 1) {
        if (b.double) {
          this.blink = { t0: now + 60, dur: b.dur * 0.8, double: false }
        } else {
          this.blink = null
          this.lid = lidTarget
        }
      } else {
        // 快闭慢开
        this.lid = pr < 0.35 ? lerpNum(1, 0.06, pr / 0.35) : lerpNum(0.06, 1, (pr - 0.35) / 0.65)
      }
    } else {
      this.lid = lerpNum(this.lid, lidTarget, this.k(dt) * 1.5)
    }

    /*─ 3. 模式修正 ─*/
    if (mode === 'sleep') {
      const halfOpen = Math.sin(now / 1000 * 0.35) > 0.97 ? 0.85 : 0.42
      this.lid = Math.min(this.lid, halfOpen)
    }
    if (mode === 'running') {
      this.gazeTarget = {
        x: this.gazeTarget.x * p.runningGazeScale,
        y: this.gazeTarget.y * p.runningGazeScale,
      }
    }

    /*─ 4. 失败情绪 ─*/
    const fAge = now - this.failT0
    if (fAge < 1400) {
      const pr = fAge / 1400
      this.gazeTarget = { x: this.gazeTarget.x, y: this.gazeTarget.y + 2 * (1 - pr) }
      this.lid = Math.min(this.lid, lerpNum(0.55, 1, pr))
    }

    /*─ 5. 物理积分 ─*/
    const k = this.k(dt)
    this.gaze.x = lerpNum(this.gaze.x, clamp(this.gazeTarget.x, -amp, amp), k)
    this.gaze.y = lerpNum(this.gaze.y, clamp(this.gazeTarget.y, -amp, amp), k)
    const overload = clamp((Math.hypot(this.gaze.x, this.gaze.y) / (amp || 1) - 0.7) / 0.3, 0, 1)
    this.face.x = lerpNum(this.face.x, (this.gaze.x / (amp || 1)) * p.headAmp * overload, k)
    this.face.y = lerpNum(this.face.y, (this.gaze.y / (amp || 1)) * p.headAmp * 0.6 * overload, k)

    /*─ 6. 惊跳 / 点头 ─*/
    let sx = 1
    let sy = 1
    let faceYExtra = 0
    const f2 = now - this.flinchT0
    if (f2 < 320) {
      const pr = f2 / 320
      const squash = pr < 0.25 ? lerpNum(1, 0.86, pr / 0.25) : lerpNum(0.86, 1, (pr - 0.25) / 0.75)
      sy = squash
      sx = 1 + (1 - squash) * 0.7
    }
    const nAge = now - this.nodT0
    if (nAge < 800) {
      const pr = nAge / 800
      faceYExtra = Math.sin(pr * Math.PI * 2) * 1.6 * (1 - pr)
    }

    /*─ 7. 状态归类 ─*/
    let state: JanusGazeState
    if (panelOpen) state = 'reading'
    else if (this.attention === 'event') state = 'event'
    else if (hover) state = this.hoverPeekLogged ? 'peeking' : 'petting'
    else if (this.attention === 'mouse') {
      state = now - (this.dwellUntil - p.dwellMs) < 120 ? 'attracted' : 'dwell'
    } else if (now < this.restUntil) state = 'rest'
    else if (now < this.lookawayUntil) state = 'lookaway'
    else state = 'wander'

    return this.composeFrame(now, sx, sy, state, false, faceYExtra)
  }

  /*── 内部 ──*/

  private k(dt: number): number {
    return clamp((this.params.lerp / 100) * (dt / 16.7), 0, 1)
  }

  private dirToPointer(input: GazeStepInput): { x: number; y: number; dist: number } {
    if (!input.pointer) return { x: 0, y: 0, dist: 1e4 }
    const dx = input.pointer.x - input.islandCenter.x
    const dy = input.pointer.y - input.islandCenter.y
    const dist = Math.hypot(dx, dy) || 1
    return { x: dx / dist, y: dy / dist, dist }
  }

  private scheduleBlink(now: number, extraDelay = 0): void {
    const { blinkMinMs, blinkMaxMs } = this.params
    const max = Math.max(blinkMaxMs, blinkMinMs + 10)
    this.nextBlinkAt = now + extraDelay + (blinkMinMs + this.random() * (max - blinkMinMs))
  }

  private triggerBlink(now: number, quick: boolean): void {
    this.blink = {
      t0: now,
      dur: quick ? 110 : 140 + this.random() * 70,
      double: !quick && this.random() < this.params.doubleBlinkP,
    }
    this.scheduleBlink(now)
  }

  private pickWanderTarget(now: number, mode: JanusBehaviorMode): void {
    const amp = this.params.gazeAmp
    const r = this.random
    if (r() < 0.7) {
      this.wanderTarget = { x: (r() * 0.7 - 0.35) * amp, y: (r() * 0.6 - 0.3) * amp }
    } else if (mode === 'analytics') {
      // 扫描模式：像在读内容，横向定格
      this.wanderTarget = { x: (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.4) * amp, y: (r() * 0.4 - 0.2) * amp }
    } else {
      this.wanderTarget = { x: (r() * 2 - 1) * amp, y: (r() * 1.6 - 0.8) * amp }
    }
    const dist = Math.hypot(this.wanderTarget.x - this.gaze.x, this.wanderTarget.y - this.gaze.y)
    if (this.params.blinkBeforeSaccade && dist > amp * 0.55 && !this.blink) {
      this.triggerBlink(now, true)
    }
    this.nextWanderAt = now + this.params.wanderIntervalMs * (0.6 + r() * 0.8)
  }

  private composeFrame(
    now: number,
    sx: number,
    sy: number,
    state: JanusGazeState,
    forceSettled: boolean,
    faceYExtra = 0,
  ): JanusGazeFrame {
    const p = this.params
    const amp = p.gazeAmp || 1
    const gazeSettled =
      Math.abs(this.gaze.x - clamp(this.gazeTarget.x, -amp, amp)) < 0.01 &&
      Math.abs(this.gaze.y - clamp(this.gazeTarget.y, -amp, amp)) < 0.01
    const lidSettled = !this.blink && Math.abs(this.lid - this.lidTarget) < 0.01
    const reactionActive =
      now - this.flinchT0 < 320 || now - this.nodT0 < 800 || now - this.failT0 < 1400

    // 下一个会改变输出的时刻（未设置的 0 哨兵要滤掉）
    const wakeups = [this.nextBlinkAt, this.nextWanderAt, this.eventUntil, this.restUntil, this.lookawayUntil]
      .filter((t) => t > now)
    if (this.attention === 'mouse') wakeups.push(this.dwellUntil)
    if (this.hoverT0 >= 0) {
      const cyc = (now - this.hoverT0) % (p.closeMs + p.peekMs)
      wakeups.push(now + (cyc < p.closeMs ? p.closeMs - cyc : p.closeMs + p.peekMs - cyc))
    }
    const nextWakeupAt = wakeups.length ? Math.min(...wakeups) : now + 5000

    const settled = forceSettled || (gazeSettled && lidSettled && !reactionActive && nextWakeupAt - now > 300)

    return {
      gazeX: this.gaze.x,
      gazeY: this.gaze.y,
      faceX: this.face.x,
      faceY: this.face.y + faceYExtra,
      lid: this.lid,
      sx,
      sy,
      state,
      settled,
      nextWakeupAt,
    }
  }
}
