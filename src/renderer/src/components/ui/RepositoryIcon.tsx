import { createLucideIcon } from 'lucide-react'

// A code container: generous spacing keeps the lid and brackets distinct at 16px.
// Shares Lucide's sizing, stroke and currentColor behavior with the tool rail.
export const RepositoryIcon = createLucideIcon('Repository', [
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', key: 'container' }],
  ['path', { d: 'M3 7h18', key: 'lid' }],
  ['path', { d: 'm9 11-3 3 3 3', key: 'code-left' }],
  ['path', { d: 'm15 11 3 3-3 3', key: 'code-right' }],
])
