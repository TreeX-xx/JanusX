import { describe, expect, it } from 'vitest'
import {
  JANUS_BEHAVIOR_DEFAULTS,
  JanusGazeScheduler,
  type GazeStepInput,
  type JanusBehaviorMode,
} from '../../src/renderer/src/components/janus/janusBehavior'

const T0 = 100_000

/** 循环序列随机数：测试内完全确定。 */
function seqRandom(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length] ?? 0.5
}

function makeScheduler(random: () => number = () => 0.5, params = {}): JanusGazeScheduler {
  const s = new JanusGazeScheduler(params, random)
  s.reset(T0)
  return s
}

function baseInput(overrides: Partial<GazeStepInput> = {}): GazeStepInput {
  return {
    now: T0,
    dtMs: 16.7,
    mode: 'order' as JanusBehaviorMode,
    pointer: null,
    pointerFresh: false,
    islandCenter: { x: 500, y: 100 },
    hover: false,
    panelOpen: false,
    reducedMotion: false,
    ...overrides,
  }
}

/** 匀速推进 n 帧（每帧含 perFrame 覆盖），返回最后一帧。 */
function run(s: JanusGazeScheduler, from: number, frames: number, perFrame: (i: number) => Partial<GazeStepInput> = () => ({})) {
  let frame = s.step(baseInput({ now: from, ...perFrame(0) }))
  for (let i = 1; i < frames; i++) {
    frame = s.step(baseInput({ now: from + i * 16.7, ...perFrame(i) }))
  }
  return frame
}

describe('janusBehavior 定稿参数', () => {
  it('默认参数=2026-10-23 手感定稿', () => {
    expect(JANUS_BEHAVIOR_DEFAULTS).toMatchObject({
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
    })
  })
})

describe('注意力调度：吸引 → 驻留 → 主动移开 → 疲劳', () => {
  it('指针新鲜且进入半径 → 驻留跟随，注视朝指针方向', () => {
    const s = makeScheduler()
    const pointer = { x: 500 + 100, y: 100 }
    let frame = s.step(baseInput({ pointer, pointerFresh: true }))
    // 吸引后注视向右（x>0）
    frame = run(s, T0 + 16.7, 30, () => ({ pointer, pointerFresh: true }))
    expect(['dwell', 'attracted']).toContain(frame.state)
    expect(frame.gazeX).toBeGreaterThan(1)
    expect(Math.abs(frame.gazeY)).toBeLessThan(frame.gazeX)
  })

  it('驻留超时 → 主动移开（反向偏置），连续跟随计数 +1', () => {
    const s = makeScheduler()
    const pointer = { x: 600, y: 100 }
    // 驻留 3s 后释放
    let frame = s.step(baseInput({ now: T0, pointer, pointerFresh: true }))
    frame = s.step(baseInput({ now: T0 + 3100, pointer, pointerFresh: true }))
    expect(frame.state).toBe('lookaway')
    expect(frame.gazeX).toBeLessThan(0) // 反方向偏置
  })

  it('连续跟随达到阈值 → 疲劳休息，期间忽略鼠标', () => {
    const s = makeScheduler()
    const pointer = { x: 600, y: 100 }
    let now = T0
    // 3 轮 吸引→驻留超时
    for (let i = 0; i < 3; i++) {
      s.step(baseInput({ now, pointer, pointerFresh: true }))
      now += 3100
      s.step(baseInput({ now, pointer, pointerFresh: true }))
      now += 800
    }
    // 休息期内即使指针新鲜也不被吸引
    const frame = s.step(baseInput({ now, pointer, pointerFresh: true }))
    expect(frame.state).toBe('rest')
    s.step(baseInput({ now: now + 6100, pointer, pointerFresh: true }))
    const after = s.step(baseInput({ now: now + 6200, pointer, pointerFresh: true }))
    expect(after.state).not.toBe('rest')
  })
})

describe('自主游荡', () => {
  it('游荡目标幅度受 gazeAmp 约束', () => {
    const s = makeScheduler(() => 0.9) // 走「明显扫视」分支
    const frame = run(s, T0, 300) // > 游荡间隔 4.5s，确保 pickWanderTarget 已执行
    expect(frame.state).toBe('wander')
    expect(Math.abs(frame.gazeX)).toBeLessThanOrEqual(JANUS_BEHAVIOR_DEFAULTS.gazeAmp + 0.01)
    expect(Math.abs(frame.gazeY)).toBeLessThanOrEqual(JANUS_BEHAVIOR_DEFAULTS.gazeAmp + 0.01)
  })

  it('analytics 态扫视偏横向', () => {
    // reset 眨眼调度 + 远扫分支：0.9 远扫、0.0 负向、0.0/0.0 幅度、0.5 抖动
    const s = makeScheduler(seqRandom([0.9, 0, 0, 0, 0.5, 0.5]))
    const frame = run(s, T0, 300, () => ({ mode: 'analytics' }))
    expect(Math.abs(frame.gazeX)).toBeGreaterThan(Math.abs(frame.gazeY))
  })
})

describe('眨眼生理', () => {
  it('眨眼间隔由随机数驱动（非均匀）', () => {
    const slow = makeScheduler(() => 0.99)
    const fast = makeScheduler(() => 0.01)
    const f1 = run(slow, T0, 1)
    const f2 = run(fast, T0, 1)
    expect(f1.nextWakeupAt).toBeGreaterThan(f2.nextWakeupAt)
  })

  it('双眨概率生效：眨眼曲线闭合到 0.06 附近', () => {
    const s = makeScheduler(() => 0.05) // 间隔 2415ms、0.05<0.18 → double
    let minLid = 1
    for (let t = 2400; t <= 3000; t += 10) {
      const frame = s.step(baseInput({ now: T0 + t }))
      minLid = Math.min(minLid, frame.lid)
      expect(frame.lid).toBeGreaterThanOrEqual(0)
      expect(frame.lid).toBeLessThanOrEqual(1)
    }
    expect(minLid).toBeLessThan(0.5)
  })

  it('闭眼享受时不做无意义眨眼（顺延）', () => {
    // closeMs 拉长到 4s，确保观察窗全程处于闭眼段；眨眼间隔极短（2243ms）
    const s = makeScheduler(() => 0.01, { closeMs: 4000 })
    const frame = run(s, T0, 150, () => ({
      hover: true, pointer: { x: 500, y: 100 }, pointerFresh: true,
    }))
    expect(frame.state).toBe('petting')
    // 眨眼被顺延：越过原定眨眼时刻后 lid 仍压住
    expect(frame.lid).toBeLessThan(0.3)
  })
})

describe('摸头闭眼循环', () => {
  const hoverPointer = { x: 500, y: 100 }

  it('hover → 闭眼享受 → 时间到睁眼偷看 → 再闭上', () => {
    const s = makeScheduler()
    let frame = s.step(baseInput({ now: T0, hover: true, pointer: hoverPointer, pointerFresh: true }))
    frame = run(s, T0 + 16.7, 40, () => ({ hover: true, pointer: hoverPointer, pointerFresh: true })) // ~0.7s
    expect(frame.state).toBe('petting')
    expect(frame.lid).toBeLessThan(0.2)

    frame = s.step(baseInput({ now: T0 + 2300, hover: true, pointer: hoverPointer, pointerFresh: true })) // 过 closeMs
    expect(frame.state).toBe('peeking')
    frame = run(s, T0 + 2316, 30, () => ({ hover: true, pointer: hoverPointer, pointerFresh: true }))
    expect(frame.lid).toBeGreaterThan(0.8)

    frame = s.step(baseInput({ now: T0 + 5200, hover: true, pointer: hoverPointer, pointerFresh: true })) // 过 peekMs
    expect(frame.state).toBe('petting')
  })

  it('松开 hover → 抬头回游荡', () => {
    const s = makeScheduler()
    s.step(baseInput({ now: T0, hover: true, pointer: hoverPointer, pointerFresh: true }))
    run(s, T0 + 16.7, 20, () => ({ hover: true, pointer: hoverPointer, pointerFresh: true }))
    const frame = s.step(baseInput({ now: T0 + 500, hover: false }))
    expect(['wander', 'lookaway', 'attracted', 'dwell']).toContain(frame.state)
    expect(frame.lid).toBeGreaterThan(0)
  })

  it('闭眼时点击 = 惊醒，直接进入偷看', () => {
    const s = makeScheduler()
    s.step(baseInput({ now: T0, hover: true, pointer: hoverPointer, pointerFresh: true }))
    run(s, T0 + 16.7, 30, () => ({ hover: true, pointer: hoverPointer, pointerFresh: true }))
    s.react('flinch', T0 + 600)
    const frame = run(s, T0 + 620, 15, () => ({ hover: true, pointer: hoverPointer, pointerFresh: true }))
    expect(frame.state).toBe('peeking')
    expect(frame.lid).toBeGreaterThan(0.5)
  })
})

describe('事件原语', () => {
  it('flinch 压扁后回落', () => {
    const s = makeScheduler()
    s.react('flinch', T0)
    const mid = s.step(baseInput({ now: T0 + 80 }))
    expect(mid.sy).toBeLessThan(1)
    expect(mid.sx).toBeGreaterThan(1)
    const end = s.step(baseInput({ now: T0 + 400 }))
    expect(end.sy).toBeCloseTo(1, 1)
  })

  it('nod 让脸上下点一下', () => {
    const s = makeScheduler()
    s.react('nod', T0)
    const mid = s.step(baseInput({ now: T0 + 200 }))
    expect(Math.abs(mid.faceY)).toBeGreaterThan(0)
  })

  it('fail 垂眼降眼皮', () => {
    const s = makeScheduler()
    s.react('fail', T0)
    const mid = s.step(baseInput({ now: T0 + 100 }))
    expect(mid.lid).toBeLessThan(0.9)
    expect(mid.gazeY).toBeGreaterThan(0)
  })

  it('lookAt 事件注视优先于游荡，到期归还', () => {
    const s = makeScheduler()
    s.lookAt(2, 0, 1000, T0)
    const during = run(s, T0, 30, () => ({}))
    expect(during.state).toBe('event')
    expect(during.gazeX).toBeGreaterThan(1)
    const after = s.step(baseInput({ now: T0 + 1400 }))
    expect(after.state).not.toBe('event')
  })
})

describe('模式与降级', () => {
  it('running 态凝视降权', () => {
    const s = makeScheduler()
    const pointer = { x: 600, y: 100 }
    const idle = makeScheduler()
    const fRun = run(s, T0, 40, () => ({ pointer, pointerFresh: true, mode: 'running' }))
    const fIdle = run(idle, T0, 40, () => ({ pointer, pointerFresh: true, mode: 'order' }))
    expect(Math.abs(fRun.gazeX)).toBeLessThan(Math.abs(fIdle.gazeX) * 0.8)
  })

  it('reduced-motion → 静止降级', () => {
    const s = makeScheduler()
    const frame = s.step(baseInput({ reducedMotion: true, pointer: { x: 600, y: 100 }, pointerFresh: true }))
    expect(frame.state).toBe('static')
    expect(frame.gazeX).toBe(0)
    expect(frame.lid).toBe(1)
    expect(frame.settled).toBe(true)
  })

  it('panelOpen 低头看列表', () => {
    const s = makeScheduler()
    const frame = s.step(baseInput({ panelOpen: true }))
    expect(frame.state).toBe('reading')
    expect(frame.gazeY).toBeGreaterThan(0)
  })
})

describe('停帧判定', () => {
  it('空闲收敛后 settled 且给出唤醒时刻', () => {
    const s = makeScheduler()
    const frame = run(s, T0, 120)
    expect(frame.settled).toBe(true)
    expect(frame.nextWakeupAt).toBeGreaterThan(T0 + 120 * 16.7)
  })

  it('活跃跟随中不 settled', () => {
    const s = makeScheduler()
    const pointer = { x: 600, y: 100 }
    const frame = run(s, T0, 5, () => ({ pointer, pointerFresh: true }))
    expect(frame.settled).toBe(false)
  })
})

describe('待机动作（2026-10-24 lab 移植）', () => {
  it('默认参数含待机动作间隔 = 7500ms（抖动后 5–10.5s）', () => {
    expect(JANUS_BEHAVIOR_DEFAULTS.actIntervalMs).toBe(7500)
  })

  it('空闲到点自动开演，播完归还且动作中不停帧', () => {
    const s = makeScheduler(() => 0.5)
    const before = s.step(baseInput({ now: T0 + 4400 }))
    expect(before.act).toBeNull()
    const mid = s.step(baseInput({ now: T0 + 4600 }))
    expect(mid.act).not.toBeNull()
    expect(mid.settled).toBe(false)
    const end = s.step(baseInput({ now: T0 + 4600 + 3100 }))
    expect(end.act).toBeNull()
  })

  it('tilt：中段约 ±10°，方向随机，视线随头同侧', () => {
    const s = makeScheduler(() => 0.2) // random < 0.5 → dir = -1
    s.startAct('tilt', T0)
    const mid = s.step(baseInput({ now: T0 + 1000 })) // p≈0.35 微颤稳态段
    expect(mid.act).toBe('tilt')
    expect(mid.rot).toBeLessThan(-5)
    expect(mid.rot).toBeGreaterThan(-12)
    expect(mid.gazeX).toBeLessThan(0)
    expect(mid.settled).toBe(false)
  })

  it('hop：腾空段 faceY 上移', () => {
    const s = makeScheduler()
    s.startAct('hop', T0)
    const mid = s.step(baseInput({ now: T0 + 300 })) // p≈0.35 腾空
    expect(mid.act).toBe('hop')
    expect(mid.faceY).toBeLessThan(-1)
  })

  it('doze：耷拉段压眼皮垂脸', () => {
    const s = makeScheduler()
    s.startAct('doze', T0)
    const droop = run(s, T0, 100) // ≈ T0+1.65s，p≈0.49
    expect(droop.act).toBe('doze')
    expect(droop.lid).toBeLessThan(0.6)
    expect(droop.faceY).toBeGreaterThan(0.5)
  })

  it('lookaround 伴随扫视前眨眼', () => {
    const s = makeScheduler()
    s.startAct('lookaround', T0)
    const frame = run(s, T0, 48) // ≈ T0+786ms，第一颗眨眼 750ms 起
    expect(frame.lid).toBeLessThan(0.95)
  })

  it('hover/panelOpen/busy 不开演；busy 消失后到点开演', () => {
    for (const extra of [{ hover: true }, { panelOpen: true }, { busy: true }]) {
      const s = makeScheduler(() => 0.5)
      const frame = s.step(baseInput({ now: T0 + 4600, ...extra }))
      expect(frame.act).toBeNull()
    }
    const s = makeScheduler(() => 0.5)
    s.step(baseInput({ now: T0 + 4600, busy: true })) // 推迟
    const frame = s.step(baseInput({ now: T0 + 7000 }))
    expect(frame.act).not.toBeNull()
  })

  it('非 order 模式不开演；点击/reduced-motion 即时打断', () => {
    const sMode = makeScheduler(() => 0.5)
    expect(sMode.step(baseInput({ now: T0 + 4600, mode: 'running' })).act).toBeNull()

    const s = makeScheduler(() => 0.5)
    s.step(baseInput({ now: T0 + 4600 }))
    expect(s.step(baseInput({ now: T0 + 4620 })).act).not.toBeNull()
    s.react('flinch', T0 + 4620)
    expect(s.step(baseInput({ now: T0 + 4640 })).act).toBeNull()

    const s2 = makeScheduler()
    s2.startAct('tilt', T0)
    const frame = s2.step(baseInput({ now: T0 + 1000, reducedMotion: true }))
    expect(frame.act).toBeNull()
    expect(frame.rot).toBe(0)
    expect(frame.settled).toBe(true)
  })
})
