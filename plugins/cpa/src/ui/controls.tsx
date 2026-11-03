import type { ReactNode } from 'react'
export { Select } from '@janusx/ui'
export function ThemedTooltip({ label, children }: {label: string; children: ReactNode}) { return <span title={label}>{children}</span> }
