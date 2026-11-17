interface JanusIconProps {
  size?: number
  className?: string
}

/** Static version of the Island's ready eyes: two 8 × 10 rectangles, 3px apart. */
export function JanusIcon({ size = 16, className }: JanusIconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24"
      fill="currentColor" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <rect x="2.5" y="7" width="8" height="10" />
      <rect x="13.5" y="7" width="8" height="10" />
    </svg>
  )
}
