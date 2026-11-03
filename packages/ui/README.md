# JanusX UI

Shared React controls and settings layout for the desktop and independently built plugins. Import from `@janusx/ui`; CSS is loaded by the package. The host and official plugins consume the same package, not copies of its source or styles.

```tsx
import { Button, Input, Select, SettingsCheckbox, SettingsSurface, SettingsSection, SettingsRow, settingsStyles } from '@janusx/ui'

<SettingsSurface className={settingsStyles.panel}>
  <SettingsSection>
    <h3>Connection</h3>
    <SettingsRow>
      <label htmlFor="endpoint">Endpoint</label>
      <Input id="endpoint" value={endpoint} onChange={event => setEndpoint(event.target.value)} />
    </SettingsRow>
    <Button variant="primary" onClick={save}>Save</Button>
  </SettingsSection>
</SettingsSurface>
```

Controls inherit the semantic palette, including `--shell-canvas`, `--shell-text`, `--shell-muted`, `--shell-hover`, `--shell-border-soft`, `--control-border`, `--popover-background`, and `--popover-shadow`, from the app theme. Independent plugins import `@janusx/plugin-sdk/theme.css` before mounting controls and apply the host theme context; controls do not embed a separate dark fallback palette. Actions and selected controls use neutral foreground/background contrast. Error and success text retain semantic colors. Custom page CSS should only set sizing and placement; use `variant` and `size` for button appearance. Use `tab` for tab lists and reserve `plain` for structural buttons such as navigation or expandable list rows.

`SettingsCheckbox` keeps native checkbox semantics, supports `role="switch"`, labels, disabled fieldsets and keyboard interaction. `Select` keeps focus on its trigger, supports arrows/Home/End/Enter/Space/Escape, skips disabled options, and positions its portal inside the viewport. Callers supply translated labels and `emptyLabel`. `SettingsSection`, `SettingsFieldset`, `SettingsRow`, `SettingsLabel`, and `SettingsFooter` share spacing, separators and alignment. Use `stacked` for complex full-width row content.

Run `npm run build:ui` in the repository before building the desktop. Blueprint pins the public archive at `vendor/janusx-ui-0.1.0.tgz`; CPA uses the local package during development and packs it for its independent build check. Both bundle the package with their UI and can build outside the host checkout. After changing the package, rebuild and refresh the Blueprint archive and dependency locks; its independent build check verifies the pinned bytes.
