/**
 * 创新实验功能开关 IPC 契约。
 * 蓝图 / 知识库 / 圆桌 / 个人画像 / 远程协作控制 / 团队协作独立控制，
 * 默认全部关闭（打包默认隐藏，仅在设置中心开启后可用）。
 * 缺席/非法一律回落默认，兼容旧配置。
 */
// Note: sessions and memos are default features — see .agents/notes/workbench/experimental-preview-features.md
export const EXPERIMENTAL_CHANNELS = {
  get: 'experimental:get',
  update: 'experimental:update',
} as const

export type ExperimentalChannel = (typeof EXPERIMENTAL_CHANNELS)[keyof typeof EXPERIMENTAL_CHANNELS]

export interface ExperimentalFeatures {
  /** 蓝图工作台入口（标题栏切换器 + 工作台本体 + 相关跳转）。 */
  blueprint: boolean
  /** 工程知识采集、处理、召回、设置与审核；知识与记忆入口由任一领域开启。 */
  knowledge: boolean
  /** 圆桌视图（灵动岛二级展开的 roundtable 页）。 */
  roundtable: boolean
  /** 个人记忆采集、处理与召回，以及画像、详细设置和个人审核。关闭保留数据。 */
  persona: boolean
  /** Android 手机配对与 Claude Code 远程终端。关闭入口并停止连接，保留电脑终端。 */
  remoteControl: boolean
  /** 团队协作（侧栏团队行 + 首屏登录挡板 + 设置中心 team 页；关闭仅隐藏入口，登录态数据保留）。 */
  teamCollab: boolean
}

export const DEFAULT_EXPERIMENTAL_FEATURES: ExperimentalFeatures = {
  blueprint: false,
  knowledge: false,
  roundtable: false,
  persona: false,
  remoteControl: false,
  teamCollab: false,
}

/** 无 IPC 环境（浏览器预览 / 用例 harness）下的降级：全部可见，避免旧用例误杀。 */
export const EXPERIMENTAL_ENABLED_ALL: ExperimentalFeatures = {
  blueprint: true,
  knowledge: true,
  roundtable: true,
  persona: true,
  remoteControl: true,
  teamCollab: true,
}

export function normalizeExperimentalFeatures(value: unknown): ExperimentalFeatures {
  if (!value || typeof value !== 'object') return { ...DEFAULT_EXPERIMENTAL_FEATURES }
  const record = value as Partial<Record<keyof ExperimentalFeatures, unknown>>
  return {
    blueprint: record.blueprint === undefined ? DEFAULT_EXPERIMENTAL_FEATURES.blueprint : record.blueprint === true,
    knowledge: record.knowledge === undefined ? DEFAULT_EXPERIMENTAL_FEATURES.knowledge : record.knowledge === true,
    roundtable: record.roundtable === undefined ? DEFAULT_EXPERIMENTAL_FEATURES.roundtable : record.roundtable === true,
    persona: record.persona === undefined ? DEFAULT_EXPERIMENTAL_FEATURES.persona : record.persona === true,
    remoteControl: record.remoteControl === undefined ? DEFAULT_EXPERIMENTAL_FEATURES.remoteControl : record.remoteControl === true,
    teamCollab: record.teamCollab === undefined ? DEFAULT_EXPERIMENTAL_FEATURES.teamCollab : record.teamCollab === true,
  }
}

export interface ExperimentalAPI {
  get(): Promise<ExperimentalFeatures>
  update(settings: Partial<ExperimentalFeatures>): Promise<ExperimentalFeatures>
}
