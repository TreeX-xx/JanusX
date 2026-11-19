// Local desktop OS only. Remote execution uses the target's RuntimeIdentity.
export function localPlatform(): NodeJS.Platform {
  return process.platform
}
