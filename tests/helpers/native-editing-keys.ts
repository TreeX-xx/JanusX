export const nativeEditingKeys = process.platform === 'darwin'
  ? { start: 'Meta+ArrowUp', end: 'Meta+ArrowDown', undo: 'Meta+z', redo: 'Meta+Shift+z' }
  : { start: 'Control+Home', end: 'Control+End', undo: 'Control+z', redo: 'Control+y' }
