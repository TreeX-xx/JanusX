import type { CSSProperties } from 'react'
import {
  getJanusAgentIdentity,
  getJanusIdentityState,
  type JanusAgentIdentityId,
  type JanusIdentityRole,
  type JanusIdentitySize,
  type JanusIdentityState,
} from './janusIdentity'
import './janus-identity.css'

export interface JanusIdentityCoreProps {
  identity?: JanusAgentIdentityId
  role?: JanusIdentityRole
  state?: JanusIdentityState
  size?: JanusIdentitySize
  className?: string
  showHalo?: boolean
  showScanline?: boolean
  'aria-label'?: string
}

function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function JanusIdentityCore({
  identity = 'subagent',
  role,
  state,
  size = 'pod',
  className,
  showHalo = true,
  showScanline = true,
  'aria-label': ariaLabel,
}: JanusIdentityCoreProps) {
  const spec = getJanusAgentIdentity(identity)
  const activeState = getJanusIdentityState(state ?? spec.defaultState)
  const activeRole = role ?? spec.role

  const style = {
    '--janus-identity-role-color': spec.color,
    '--janus-identity-role-glow': spec.glow,
    '--janus-identity-state-color': activeState.color,
    '--janus-identity-state-glow': activeState.glow,
  } as CSSProperties

  return (
    <span
      className={classNames('janus-identity-core', className)}
      data-size={size}
      data-role={activeRole}
      data-state={activeState.id}
      data-state-pattern={activeState.eyePattern}
      role="img"
      aria-label={ariaLabel ?? 'Janus'}
      style={style}
    >
      {showScanline && <span className="janus-identity-scanline" aria-hidden="true" />}
      {showHalo && (
        <span className="janus-identity-halo" aria-hidden="true">
          <span className="janus-identity-ring-outer" />
          <span className="janus-identity-ring-inner" />
        </span>
      )}
      <span className="janus-identity-face" aria-hidden="true">
        <span className="janus-identity-eye" />
        <span className="janus-identity-eye" />
      </span>
    </span>
  )
}
