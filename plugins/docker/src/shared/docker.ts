export interface Port { host: string; port: number; container: number; protocol: string }
export interface Container { id: string; name: string; image: string; state: string; status: string; project: string; service: string; ports: Port[] }
export interface Engine { endpoint: string; name: string; version: string; os: string }
export type DetailTab = 'overview' | 'logs' | 'terminal'
export interface ContainerView { tab: DetailTab; logSearch: string; scroll: number; paused: boolean; terminal?: string }
export interface ViewState { selected: string; search: string; runningOnly: boolean; containers: Record<string, ContainerView> }
export interface LogBatch { subscription: string; container: string; text: string; reset?: boolean; truncated?: boolean; ended?: boolean; error?: string }
export type RuntimePhase = 'checking' | 'wsl-required' | 'not-installed' | 'stopped' | 'ready' | 'preparing-wsl' | 'restart-required' | 'downloading' | 'importing' | 'installing' | 'starting' | 'error' | 'unsupported'
export interface RuntimeStatus { phase: RuntimePhase; busy: boolean; progress?: number; error?: string }
export type DockerTarget = { kind: 'local' } | { kind: 'managed' } | { kind: 'wsl'; distribution: string }
export interface WslDistribution { name: string }
export interface EnvironmentState { target: DockerTarget; status: RuntimeStatus; distributions: WslDistribution[]; discovering: boolean; discoveryError?: string; revision: number; windows: boolean }
