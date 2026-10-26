import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }
function Icon({ size = 14, children, ...props }: Props) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>{children}</svg>
}
export const Cpu = (props: Props) => <Icon {...props}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3"/></Icon>
export const Timer = (props: Props) => <Icon {...props}><path d="M10 2h4m-2 7v4m6-8 2 2"/><circle cx="12" cy="14" r="8"/></Icon>
export const RefreshCw = (props: Props) => <Icon {...props}><path d="M3 11a9 9 0 0 1 15-6l3 3m0-6v6h-6M21 13a9 9 0 0 1-15 6l-3-3m0 6v-6h6"/></Icon>
export const Eye = (props: Props) => <Icon {...props}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/></Icon>
export const EyeOff = (props: Props) => <Icon {...props}><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c7 0 10 7 10 7a16 16 0 0 1-3 4m-3 2.5A11 11 0 0 1 12 19C5 19 2 12 2 12a16 16 0 0 1 4-5"/></Icon>
export const Minus = (props: Props) => <Icon {...props}><path d="M5 12h14"/></Icon>
export const Plus = (props: Props) => <Icon {...props}><path d="M5 12h14m-7-7v14"/></Icon>
export const Plug = (props: Props) => <Icon {...props}><path d="M12 22v-5m-5-7V2m10 8V2M5 10h14v2a7 7 0 0 1-14 0Z"/></Icon>
export const CircleHelp = (props: Props) => <Icon {...props}><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01"/></Icon>
