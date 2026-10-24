// Note: Janus 眼睛行为系统内核（凝视调度 / 眨眼生理 / 事件原语 / 摸头循环）—
// 设计定稿见 .agents/notes/workbench/tasks/island-behavior-system.md（P1）。
// 纯逻辑、无 DOM：时间与随机数可注入，单测覆盖；rAF 桥在 useJanusGaze.ts。

export type JanusBehaviorMode = 'sleep' | 'order' | 'analytics' | 'running'

/** 待机动作（2026-10-24 lab 定稿移植；事件反应仍走真实事件，不进此池）。 */
export type JanusActKind = 'stretch' | 'tilt' | 'lookaround' | 'hop' | 'doze' | 'breathe'

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
  /** 待机动作间隔 ms（实际 ×0.67–1.4 抖动 ≈ 5–10.5s） */
  actIntervalMs: number
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
  actIntervalMs: 7500,
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
  /** 外部忙（传话中/拖拽中）：待机动作让位 */
  busy?: boolean
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
  /** 头部旋转（度，歪头等动作） */
  rot: number
  /** 进行中的待机动作 */
  act: JanusActKind | null
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

/*── 待机动作包络（2026-10-24 lab 定稿，verify-lab7 全绿后移植）──
   aim 输出接管视线/眼睑（动作播完归还），pose 输出形变（叠加在 flinch/nod 之上）。
   blinks = 伴随急眨眼相对起点的 ms 偏移（扫视前眨眼/钓鱼惊醒等）。 */
interface ActPose {
  sx: number
  sy: number
  fy: number
  rot: number
}
interface ActAim {
  lid?: number
  gaze?: { x: number; y: number }
}
interface ActDef {
  dur: number
  blinks: number[]
  aim(p: number, dir: number, amp: number): ActAim
  pose(p: number, dir: number): ActPose
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const JANUS_ACTS: Record<JanusActKind, ActDef> = {
  stretch: {
    // 伸懒腰：蹲下蓄力 → 拉长 → 回位
    dur: 1500,
    blinks: [0],
    aim: () => ({}),
    pose: (p) => {
      let sx: number
      let sy: number
      if (p < 0.22) {
        const q = p / 0.22
        sy = lerpNum(1, 0.86, q)
        sx = lerpNum(1, 1.09, q)
      } else if (p < 0.55) {
        const q = (p - 0.22) / 0.33
        sy = lerpNum(0.86, 1.14, q)
        sx = lerpNum(1.09, 0.92, q)
      } else {
        const q = (p - 0.55) / 0.45
        sy = lerpNum(1.14, 1, q)
        sx = lerpNum(0.92, 1, q)
      }
      return { sx, sy, fy: 0, rot: 0 }
    },
  },
  tilt: {
    // 歪头好奇：视线抢先 → 回弹入倾（冲过 12.5° 回落 10°，微颤）→ 第二感缩回再倾 12° → 回正
    dur: 2900,
    blinks: [0, 2450],
    aim: (p, dir, amp) => {
      let k: number
      if (p < 0.12) k = easeOut(p / 0.12) * 0.95
      else if (p < 0.42) k = 0.95 + 0.05 * Math.sin((p - 0.12) * 26)
      else if (p < 0.52) k = lerpNum(0.95, 0.78, easeInOut((p - 0.42) / 0.1))
      else if (p < 0.8) k = lerpNum(0.82, 1.15, easeOut((p - 0.52) / 0.28))
      else k = lerpNum(1.15, 0, easeInOut((p - 0.8) / 0.2))
      return { gaze: { x: dir * amp * 0.72 * k, y: -amp * 0.24 * k } }
    },
    pose: (p, dir) => {
      let deg: number
      if (p < 0.12) deg = lerpNum(0, 12.5, easeOut(p / 0.12))
      else if (p < 0.22) deg = lerpNum(12.5, 10, easeInOut((p - 0.12) / 0.1))
      else if (p < 0.42) deg = 10 + 0.4 * Math.sin((p - 0.22) * 34)
      else if (p < 0.52) deg = lerpNum(10, 5, easeInOut((p - 0.42) / 0.1))
      else if (p < 0.64) deg = lerpNum(5, 12, easeOut((p - 0.52) / 0.12))
      else if (p < 0.8) deg = 12 + 0.35 * Math.sin((p - 0.64) * 30)
      else deg = lerpNum(12, 0, easeInOut((p - 0.8) / 0.2))
      return { sx: 1, sy: 1, fy: 0, rot: dir * deg }
    },
  },
  lookaround: {
    // 环顾四周：左看 → 右看 → 回中，转向前急眨眼（真实眼动特征）
    dur: 3000,
    blinks: [750, 1550, 2380],
    aim: (p, _dir, amp) => {
      let x: number
      if (p < 0.22) x = lerpNum(0, -amp * 0.95, p / 0.22)
      else if (p < 0.42) x = -amp * 0.95
      else if (p < 0.62) x = lerpNum(-amp * 0.95, amp * 0.95, (p - 0.42) / 0.2)
      else if (p < 0.82) x = amp * 0.95
      else x = lerpNum(amp * 0.95, 0, (p - 0.82) / 0.18)
      return { gaze: { x, y: amp * 0.12 } }
    },
    pose: () => ({ sx: 1, sy: 1, fy: 0, rot: 0 }),
  },
  hop: {
    // 小跳：蹲 → 腾空拉伸 → 落地压扁 → 回位
    dur: 850,
    blinks: [],
    aim: () => ({}),
    pose: (p) => {
      let fy = 0
      let sx = 1
      let sy = 1
      if (p < 0.16) {
        const q = p / 0.16
        sy = lerpNum(1, 0.8, q)
        sx = lerpNum(1, 1.13, q)
      } else if (p < 0.48) {
        const q = (p - 0.16) / 0.32
        fy = -3.4 * Math.sin(q * Math.PI * 0.5)
        sy = lerpNum(1.1, 1.13, q)
        sx = lerpNum(0.95, 0.9, q)
      } else if (p < 0.7) {
        const q = (p - 0.48) / 0.22
        fy = -3.4 * (1 - q * q)
        sy = lerpNum(1.1, 0.84, q)
        sx = lerpNum(0.93, 1.11, q)
      } else {
        const q = (p - 0.7) / 0.3
        sy = lerpNum(0.84, 1, q)
        sx = lerpNum(1.11, 1, q)
      }
      return { sx, sy, fy, rot: 0 }
    },
  },
  doze: {
    // 打瞌睡钓鱼：垂眼耷拉 → 一激灵惊醒
    dur: 3400,
    blinks: [2450],
    aim: (p, _dir, amp) => (p < 0.72
      ? { lid: lerpNum(1, 0.22, Math.min(1, p / 0.55)), gaze: { x: 0, y: amp * 0.5 } }
      : { lid: 1 }),
    pose: (p) => {
      if (p < 0.72) return { sx: 1, sy: 1, fy: 1.3 * Math.min(1, p / 0.55), rot: 0 }
      const q = (p - 0.72) / 0.28
      const k = (1 - q) * Math.sin(q * Math.PI)
      return { sx: 1 + 0.08 * k, sy: 1 - 0.1 * k, fy: lerpNum(1.3, 0, q), rot: 0 }
    },
  },
  breathe: {
    // 深呼吸：整体缓慢舒展 + 眼睑轻合
    dur: 3000,
    blinks: [],
    aim: (p) => ({ lid: 1 - 0.18 * Math.sin(p * Math.PI) }),
    pose: (p) => {
      const b = Math.sin(p * Math.PI)
      return { sx: 1 + 0.03 * b, sy: 1 + 0.055 * b, fy: 0, rot: 0 }
    },
  },
}

/** 生产池只含待机动作（权重同 lab）；事件反应由真实事件驱动，不自发。 */
const JANUS_ACT_POOL: { kind: JanusActKind; weight: number }[] = [
  { kind: 'stretch', weight: 3 },
  { kind: 'tilt', weight: 3 },
  { kind: 'lookaround', weight: 3 },
  { kind: 'breathe', weight: 2 },
  { kind: 'hop', weight: 2 },
  { kind: 'doze', weight: 2 },
]

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

  // 待机动作
  private act: { kind: JanusActKind; t0: number; dir: number; blinks: number[] } | null = null
  private nextActAt = 0
  private lastActKind: JanusActKind | null = null

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
    this.act = null
    this.lastActKind = null
    this.nextActAt = now + this.params.actIntervalMs * 0.6
    this.scheduleBlink(now)
    this.nextWanderAt = now + this.params.wanderIntervalMs
  }

  /** 事件注视：看向指定方向（相对幅度坐标，调用方换算）。 */
  lookAt(x: number, y: number, durationMs: number, now: number): void {
    const amp = this.params.gazeAmp
    this.act = null // 念词/事件注视优先，待机动作让位
    this.attention = 'event'
    this.eventUntil = now + durationMs
    this.eventTarget = { x: clamp(x, -amp, amp), y: clamp(y, -amp, amp) }
  }

  /** 手动/测试：立即播一个待机动作（打断当前动作）。 */
  startAct(kind: JanusActKind, now: number): void {
    this.act = {
      kind,
      t0: now,
      dir: this.random() < 0.5 ? -1 : 1,
      blinks: [...JANUS_ACTS[kind].blinks],
    }
    this.lastActKind = kind
  }

  react(kind: JanusReaction, now: number): void {
    this.act = null // 点击/事件反应优先，待机动作让位
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
      this.act = null
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

    /*─ 1.5 待机动作：让位/开演/接管视线与眼睑 ─*/
    if (hover || panelOpen || this.attention === 'event') {
      this.act = null // 交互/事件即时打断（摸头、开面、点击、念词）
    } else {
      this.maybeStartAct(now, mode, input.busy === true)
    }
    let actPose: ActPose | null = null
    if (this.act) {
      const def = JANUS_ACTS[this.act.kind]
      const age = now - this.act.t0
      if (age >= def.dur) {
        this.act = null
      } else {
        // 伴随急眨眼按偏移到期消费（不与进行中眨眼叠加）
        while (this.act.blinks.length && now >= this.act.t0 + this.act.blinks[0]) {
          this.act.blinks.shift()
          if (!this.blink) this.triggerBlink(now, true)
        }
        const pr = age / def.dur
        const aim = def.aim(pr, this.act.dir, amp)
        if (aim.lid !== undefined) lidTarget = aim.lid
        if (aim.gaze) this.gazeTarget = { x: aim.gaze.x, y: aim.gaze.y }
        actPose = def.pose(pr, this.act.dir)
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

    /*─ 6. 惊跳 / 点头 / 待机动作 变换 ─*/
    let sx = 1
    let sy = 1
    let faceYExtra = 0
    let rot = 0
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
    if (actPose) {
      sx *= actPose.sx
      sy *= actPose.sy
      faceYExtra += actPose.fy
      rot = actPose.rot
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

    return this.composeFrame(now, sx, sy, state, false, faceYExtra, rot)
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

  private maybeStartAct(now: number, mode: JanusBehaviorMode, busy: boolean): void {
    if (this.act || now < this.nextActAt) return
    if (mode !== 'order' || busy) {
      // 忙时让位（传话/拖拽）：稍后再试；非 order 模式各有本职表情，不开演
      this.nextActAt = now + 2200
      return
    }
    this.startAct(this.pickActKind(), now)
    this.nextActAt = now + this.params.actIntervalMs * (0.67 + this.random() * 0.73)
  }

  private pickActKind(): JanusActKind {
    const pool = JANUS_ACT_POOL.filter((a) => a.kind !== this.lastActKind) // 不连重
    let total = 0
    for (const a of pool) total += a.weight
    let r = this.random() * total
    for (const a of pool) {
      r -= a.weight
      if (r <= 0) return a.kind
    }
    return 'stretch'
  }

  private composeFrame(
    now: number,
    sx: number,
    sy: number,
    state: JanusGazeState,
    forceSettled: boolean,
    faceYExtra = 0,
    rot = 0,
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
    const wakeups = [this.nextBlinkAt, this.nextWanderAt, this.eventUntil, this.restUntil, this.lookawayUntil, this.nextActAt]
      .filter((t) => t > now)
    if (this.attention === 'mouse') wakeups.push(this.dwellUntil)
    if (this.hoverT0 >= 0) {
      const cyc = (now - this.hoverT0) % (p.closeMs + p.peekMs)
      wakeups.push(now + (cyc < p.closeMs ? p.closeMs - cyc : p.closeMs + p.peekMs - cyc))
    }
    if (this.act) wakeups.push(this.act.t0 + JANUS_ACTS[this.act.kind].dur)
    const nextWakeupAt = wakeups.length ? Math.min(...wakeups) : now + 5000

    // 动作进行中形变每帧在变，不得停帧
    const settled = forceSettled || (gazeSettled && lidSettled && !reactionActive && !this.act && nextWakeupAt - now > 300)

    return {
      gazeX: this.gaze.x,
      gazeY: this.gaze.y,
      faceX: this.face.x,
      faceY: this.face.y + faceYExtra,
      lid: this.lid,
      sx,
      sy,
      rot,
      act: this.act?.kind ?? null,
      state,
      settled,
      nextWakeupAt,
    }
  }
}
