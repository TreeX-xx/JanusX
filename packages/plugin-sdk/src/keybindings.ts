/** Canonical, single-stroke, application-local shortcut. */
export function normalizePluginKeybinding(value: string): string | null {
  const parts = value.split('+')
  if (parts.length < 2 || parts.some((part) => !part)) return null
  const key = parts.pop()!
  const modifiers = ['Ctrl', 'Meta', 'Alt', 'Shift']
  if (new Set(parts).size !== parts.length || parts.some((part) => !modifiers.includes(part))
    || !parts.some((part) => part === 'Ctrl' || part === 'Meta' || part === 'Alt')
    || !/^(?:[a-z0-9]|F(?:[1-9]|1[0-2]))$/i.test(key)) return null
  return [...modifiers.filter((part) => parts.includes(part)), key.toUpperCase()].join('+')
}

/** Reserve normal application/editor/browser commands, even outside editable controls. */
export function isReservedPluginKeybinding(value: string): boolean {
  const key = normalizePluginKeybinding(value)
  if (!key) return true
  return /^(?:Ctrl|Meta)(?:\+Shift)?\+[A-Z0-9]$/.test(key)
    || /^Alt\+F4$/.test(key) || /(?:^|\+)F(?:1|5|11|12)$/.test(key)
}
