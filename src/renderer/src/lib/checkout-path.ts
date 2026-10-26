// Note: shared checkout-path identity, independent of the Blueprint plugin — see .agents/notes/planning/blueprint-official-plugin.md

/** Path equality tolerant to slash and case spelling variants of one checkout. */
export function sameCheckoutPath(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}
