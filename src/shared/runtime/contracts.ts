// Note: .agents/notes/desktop/platform-runtime-boundaries.md
export type RuntimePlatform = 'win32' | 'darwin' | 'linux'
export interface RuntimeIdentity {
  id: string
  kind: 'local' | 'wsl' | 'ssh'
  platform: RuntimePlatform | null
  architecture: string | null
  home: string | null
  /** Replaced when the target connection or its effective environment changes. */
  revision: string
}

/** A failed/unknown target probe must never borrow the desktop's platform. */
export function runtimeIdentityFromProbe(
  target: Pick<RuntimeIdentity, 'id' | 'kind' | 'revision'>,
  probe: { platform?: string; architecture?: string; home?: string } | null,
): RuntimeIdentity {
  const platform = probe?.platform
  return { ...target,
    platform: platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : null,
    architecture: probe?.architecture?.trim() || null,
    home: probe?.home?.trim() || null,
  }
}
