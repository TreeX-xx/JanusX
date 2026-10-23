/**
 * JanusX Monaco themes: values live in the theme definition (M1 统一结构）,
 * this module keeps viewer-facing names + registration helpers.
 *
 * All three viewers (code / markdown / html) register themes under shared names, so whichever
 * mounted last used to win — and they had drifted apart on selection colors. Keeping the colors
 * here means the editor chrome, and in particular the find widget, looks the same whichever
 * viewer opened the file.
 */
import { getThemeDefinition, listThemeDefinitions, subscribeThemeRegistry } from '../../../shared/theme/registry'

export const JANUSX_DARK_THEME_NAME = 'janusx-dark'
export const JANUSX_PLANCHE_THEME_NAME = 'janusx-planche'

/** Monaco wants `#RRGGBB` / `#RRGGBBAA` — `rgba()` strings are ignored. */
export const JANUSX_DARK_THEME = getThemeDefinition('dark').monaco

/** Monaco wants `#RRGGBB` / `#RRGGBBAA` — `rgba()` strings are ignored. */
export const JANUSX_PLANCHE_THEME = getThemeDefinition('planche').monaco

interface MonacoThemeApi {
  editor: {
    defineTheme(name: string, theme: unknown): void
  }
}

export function defineJanusxDarkTheme(monaco: MonacoThemeApi): void {
  monaco.editor.defineTheme(JANUSX_DARK_THEME_NAME, JANUSX_DARK_THEME)
}

export function defineJanusxPlancheTheme(monaco: MonacoThemeApi): void {
  monaco.editor.defineTheme(JANUSX_PLANCHE_THEME_NAME, JANUSX_PLANCHE_THEME)
}

let activeMonaco: MonacoThemeApi | undefined
// Monaco is a page-wide singleton; late plugin catalogs must reach already-mounted editors.
subscribeThemeRegistry(() => { if (activeMonaco) registerThemes(activeMonaco) })
function registerThemes(monaco: MonacoThemeApi): void {
  for (const definition of listThemeDefinitions()) {
    monaco.editor.defineTheme(definition.monacoName, definition.monaco)
  }
}

export function defineJanusxThemes(monaco: MonacoThemeApi): void {
  activeMonaco = monaco
  registerThemes(monaco)
}

export function getMonacoThemeName(theme: string | unknown): string {
  return getThemeDefinition(theme).monacoName
}
