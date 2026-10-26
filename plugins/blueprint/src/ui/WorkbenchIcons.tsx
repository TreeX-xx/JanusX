import type { SVGProps } from 'react'
type Props = SVGProps<SVGSVGElement> & { size?: number }
const icon = (path: string) => ({ size = 16, ...props }: Props) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={path} /></svg>
export const ChevronRight = icon('m9 18 6-6-6-6')
export const ArrowLeft = icon('m12 19-7-7 7-7M5 12h14')
export const ArrowRight = icon('m12 5 7 7-7 7M5 12h14')
export const RefreshCw = icon('M3 11a9 9 0 0 1 15.5-6.5L21 7M21 3v4h-4M21 13a9 9 0 0 1-15.5 6.5L3 17M3 21v-4h4')
export const SettingsIcon = icon('m9 3-.5 3L6 7l-3 1 1 4-1 4 3 1 2.5 1L9 21h6l.5-3 2.5-1 3-1-1-4 1-4-3-1-2.5-1L15 3ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6')
export const Ellipsis = icon('M5 12h.01M12 12h.01M19 12h.01')
export const Folder = icon('M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z')
export const FileText = icon('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h8M8 9h2')

export const X = icon('M18 6 6 18M6 6l12 12')
export const Check = icon('m20 6-11 11-5-5')
export const ArrowUp = icon('m12 19V5m-7 7 7-7 7 7')
export const ArrowDown = icon('m12 5v14m-7-7 7 7 7-7')
export const ArrowUpRight = icon('M7 17 17 7M7 7h10v10')
export const Square = icon('M5 5h14v14H5z')
export const ChevronsDownUp = icon('m7 3 5 5 5-5m-10 18 5-5 5 5')
export const ChevronsUpDown = icon('m7 8 5-5 5 5m-10 8 5 5 5-5')
