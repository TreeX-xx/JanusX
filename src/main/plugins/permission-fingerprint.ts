import { createHash } from 'node:crypto'
import type { PluginManifest } from '@janusx/plugin-sdk'

/** Keep consent stable across desktop and standalone launches. */
export const permissionFingerprint = (manifest: PluginManifest) => createHash('sha256').update(JSON.stringify(manifest.native || manifest.contributes.themes || manifest.contributes.views.some(view => view.frame === 'plugin' || view.location === 'window' || view.location === 'settings' || view.instancePolicy === 'multiple') || manifest.contributes.contextProviders || manifest.contributes.skills || manifest.contributes.tasks || manifest.contributes.credentials || manifest.contributes.events || manifest.contributes.services || manifest.contributes.consumes
  ? { permissions: manifest.permissions, contributes: manifest.contributes, ...(manifest.native ? { native: manifest.native } : {}) }
  : manifest.contributes.configurationViews
  ? { permissions: manifest.permissions, viewers: manifest.contributes.viewers ?? [], configurationViews: manifest.contributes.configurationViews }
  : manifest.contributes.viewers?.length ? { permissions: manifest.permissions, viewers: manifest.contributes.viewers } : manifest.permissions)).digest('hex')
