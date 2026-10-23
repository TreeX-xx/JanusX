import { z } from 'zod'

const color = z.string().regex(/^#[0-9a-f]{6}$/i)
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}
function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
/** Note: .agents/notes/workbench/plugin-contract-v1.md — inert palettes, never CSS. */
export const pluginThemeSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1).max(80).refine(value => Boolean(value.trim())),
  base: z.enum(['planche', 'dark']),
  colors: z.object({ canvas: color, text: color, muted: color, card: color, border: color, accent: color }).strict(),
}).strict().superRefine(({ colors }, context) => {
  if (contrast(colors.text, colors.canvas) < 4.5 || contrast(colors.text, colors.card) < 4.5
    || contrast(colors.muted, colors.canvas) < 3 || contrast(colors.accent, colors.canvas) < 3
    || contrast(colors.accent, colors.card) < 3) context.addIssue({ code: 'custom', message: 'Palette contrast is insufficient' })
})
export type PluginTheme = z.infer<typeof pluginThemeSchema>
