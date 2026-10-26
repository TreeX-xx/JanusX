export type JanusMode = 'sleep' | 'order' | 'analytics' | 'running'

export type JanusIdentityState = 'default' | 'scanning' | 'running' | 'done' | 'failed'

export type JanusIdentityRole =
  | 'main'
  | 'coder'
  | 'evaluator'
  | 'abstracter'
  | 'prompter'
  | 'teammate'
  | 'subagent'

export type JanusIdentitySize = 'pod' | 'lg'

export type JanusEyePattern =
  | 'tall-rect'
  | 'brick'
  | 'scan-bars'
  | 'crystal'
  | 'slit'
  | 'linked-dots'
  | 'hollow-ring'

export const JANUS_IDENTITY_COLORS = {
  mode: {
    sleep: { color: '#ff7830', glow: 'rgba(255,120,48,0.6)' },
    order: { color: '#ff7830', glow: 'rgba(255,120,48,0.6)' },
    analytics: { color: '#ff7830', glow: 'rgba(255,120,48,0.6)' },
    running: { color: '#00ff88', glow: 'rgba(0,255,136,0.6)' },
  },
  state: {
    done: { color: '#ff7830', glow: 'rgba(255,120,48,0.6)' },
    failed: { color: '#ff4a4a', glow: 'rgba(255,74,74,0.6)' },
  },
  role: {
    main: { color: '#ff7830', glow: 'rgba(255,120,48,0.6)' },
    coder: { color: '#38bdf8', glow: 'rgba(56,189,248,0.6)' },
    evaluator: { color: '#a78bfa', glow: 'rgba(167,139,250,0.6)' },
    abstracter: { color: '#fbbf24', glow: 'rgba(251,191,36,0.6)' },
    prompter: { color: '#f472b6', glow: 'rgba(244,114,182,0.6)' },
    teammate: { color: '#94a3b8', glow: 'rgba(148,163,184,0.5)' },
    subagent: { color: '#a9805a', glow: 'rgba(169,128,90,0.55)' },
  },
} as const

export interface JanusModeIdentity {
  mode: JanusMode
  state: Extract<JanusIdentityState, 'default' | 'scanning' | 'running'>
  label: string
  statusText: string
  color: string
  glow: string
  eyePattern: 'single-dot' | 'default-rect' | 'scan-eye' | 'eq-bars'
  source: 'app'
}

export const JANUS_MODE_IDENTITIES: Record<JanusMode, JanusModeIdentity> = {
  sleep: {
    mode: 'sleep',
    state: 'default',
    label: 'Idle',
    statusText: 'ORDER // IDLE',
    color: JANUS_IDENTITY_COLORS.mode.sleep.color,
    glow: JANUS_IDENTITY_COLORS.mode.sleep.glow,
    eyePattern: 'single-dot',
    source: 'app',
  },
  order: {
    mode: 'order',
    state: 'default',
    label: 'Ready',
    statusText: 'ORDER // IDLE',
    color: JANUS_IDENTITY_COLORS.mode.order.color,
    glow: JANUS_IDENTITY_COLORS.mode.order.glow,
    eyePattern: 'default-rect',
    source: 'app',
  },
  analytics: {
    mode: 'analytics',
    state: 'scanning',
    label: 'Scanning Eye',
    statusText: 'ANALYTICS // PROCESSING...',
    color: JANUS_IDENTITY_COLORS.mode.analytics.color,
    glow: JANUS_IDENTITY_COLORS.mode.analytics.glow,
    eyePattern: 'scan-eye',
    source: 'app',
  },
  running: {
    mode: 'running',
    state: 'running',
    label: 'Running',
    statusText: 'RUNNING // ACTIVE',
    color: JANUS_IDENTITY_COLORS.mode.running.color,
    glow: JANUS_IDENTITY_COLORS.mode.running.glow,
    eyePattern: 'eq-bars',
    source: 'app',
  },
}

export interface JanusIdentityStateSpec {
  id: JanusIdentityState
  mode: JanusMode
  label: string
  statusLabel: string
  color: string
  glow: string
  eyePattern?: JanusModeIdentity['eyePattern']
  source: 'app' | 'design'
}

export const JANUS_IDENTITY_STATES: Record<JanusIdentityState, JanusIdentityStateSpec> = {
  default: {
    id: 'default',
    mode: 'order',
    label: 'Default',
    statusLabel: 'idle · order',
    color: JANUS_IDENTITY_COLORS.mode.order.color,
    glow: JANUS_IDENTITY_COLORS.mode.order.glow,
    source: 'app',
  },
  scanning: {
    id: 'scanning',
    mode: 'analytics',
    label: 'Scanning Eye',
    statusLabel: 'idle · scan',
    color: JANUS_IDENTITY_COLORS.mode.analytics.color,
    glow: JANUS_IDENTITY_COLORS.mode.analytics.glow,
    source: 'app',
  },
  running: {
    id: 'running',
    mode: 'running',
    label: 'Running',
    statusLabel: 'running · active',
    color: JANUS_IDENTITY_COLORS.mode.running.color,
    glow: JANUS_IDENTITY_COLORS.mode.running.glow,
    eyePattern: 'eq-bars',
    source: 'app',
  },
  done: {
    id: 'done',
    mode: 'order',
    label: 'Done',
    statusLabel: 'done',
    color: JANUS_IDENTITY_COLORS.state.done.color,
    glow: JANUS_IDENTITY_COLORS.state.done.glow,
    source: 'design',
  },
  failed: {
    id: 'failed',
    mode: 'order',
    label: 'Failed',
    statusLabel: 'failed',
    color: JANUS_IDENTITY_COLORS.state.failed.color,
    glow: JANUS_IDENTITY_COLORS.state.failed.glow,
    source: 'design',
  },
}

export type JanusAgentIdentityId =
  | 'main'
  | 'coder'
  | 'evaluator'
  | 'abstracter'
  | 'prompter'
  | 'teammate'
  | 'subagent'

export interface JanusAgentIdentitySpec {
  id: JanusAgentIdentityId
  role: JanusIdentityRole
  displayName: string
  roleTag: string
  defaultState: JanusIdentityState
  eyePattern: JanusEyePattern
  statusLabel: string
  color: string
  glow: string
  source: 'design'
}

export const JANUS_AGENT_IDENTITIES: Record<JanusAgentIdentityId, JanusAgentIdentitySpec> = {
  main: {
    id: 'main',
    role: 'main',
    displayName: 'Main Claude',
    roleTag: 'MAIN',
    defaultState: 'default',
    eyePattern: 'tall-rect',
    statusLabel: 'idle · order',
    color: JANUS_IDENTITY_COLORS.role.main.color,
    glow: JANUS_IDENTITY_COLORS.role.main.glow,
    source: 'design',
  },
  coder: {
    id: 'coder',
    role: 'coder',
    // Runtime instances such as coderX #1/#2/#3 all reuse this single coder visual identity.
    displayName: 'coderX',
    roleTag: 'CODER',
    defaultState: 'default',
    eyePattern: 'brick',
    statusLabel: 'idle · brick',
    color: JANUS_IDENTITY_COLORS.role.coder.color,
    glow: JANUS_IDENTITY_COLORS.role.coder.glow,
    source: 'design',
  },
  evaluator: {
    id: 'evaluator',
    role: 'evaluator',
    displayName: 'evaluatorX',
    roleTag: 'EVAL',
    defaultState: 'default',
    eyePattern: 'scan-bars',
    statusLabel: 'idle · scan',
    color: JANUS_IDENTITY_COLORS.role.evaluator.color,
    glow: JANUS_IDENTITY_COLORS.role.evaluator.glow,
    source: 'design',
  },
  abstracter: {
    id: 'abstracter',
    role: 'abstracter',
    displayName: 'abstracterX',
    roleTag: 'ABS',
    defaultState: 'default',
    eyePattern: 'crystal',
    statusLabel: 'idle · crystal',
    color: JANUS_IDENTITY_COLORS.role.abstracter.color,
    glow: JANUS_IDENTITY_COLORS.role.abstracter.glow,
    source: 'design',
  },
  prompter: {
    id: 'prompter',
    role: 'prompter',
    displayName: 'promptMasterX',
    roleTag: 'PROMPT',
    defaultState: 'default',
    eyePattern: 'slit',
    statusLabel: 'idle · slit',
    color: JANUS_IDENTITY_COLORS.role.prompter.color,
    glow: JANUS_IDENTITY_COLORS.role.prompter.glow,
    source: 'design',
  },
  teammate: {
    id: 'teammate',
    role: 'teammate',
    displayName: 'coder-teammate',
    roleTag: 'TEAM',
    defaultState: 'default',
    eyePattern: 'linked-dots',
    statusLabel: 'idle · linked',
    color: JANUS_IDENTITY_COLORS.role.teammate.color,
    glow: JANUS_IDENTITY_COLORS.role.teammate.glow,
    source: 'design',
  },
  subagent: {
    id: 'subagent',
    role: 'subagent',
    displayName: 'general-purpose',
    roleTag: 'SUB',
    defaultState: 'default',
    eyePattern: 'hollow-ring',
    statusLabel: 'idle · ring',
    color: JANUS_IDENTITY_COLORS.role.subagent.color,
    glow: JANUS_IDENTITY_COLORS.role.subagent.glow,
    source: 'design',
  },
}

export const JANUS_AGENT_IDENTITY_LIST = Object.values(JANUS_AGENT_IDENTITIES)

export function getJanusModeIdentity(mode: JanusMode): JanusModeIdentity {
  return JANUS_MODE_IDENTITIES[mode]
}

export function getJanusIdentityState(state: JanusIdentityState): JanusIdentityStateSpec {
  return JANUS_IDENTITY_STATES[state]
}

export function getJanusAgentIdentity(id: JanusAgentIdentityId): JanusAgentIdentitySpec {
  return JANUS_AGENT_IDENTITIES[id]
}

export function getJanusAgentIdentitiesByRole(role: JanusIdentityRole): JanusAgentIdentitySpec[] {
  return JANUS_AGENT_IDENTITY_LIST.filter((identity) => identity.role === role)
}
