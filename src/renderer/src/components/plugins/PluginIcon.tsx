// Note: .agents/notes/planning/blueprint-official-plugin.md
import { useState } from 'react'
import cpaIcon from '@/assets/plugins/cpa.jpg'
import dockerIcon from '@/assets/plugins/docker.svg'
import blueprintIcon from '@/assets/plugins/blueprint.svg'
import styles from './PluginSettingsPanel.module.css'

const officialIcons: Record<string, string> = {
  'official.cpa': cpaIcon,
  'official.docker': dockerIcon,
  'official.blueprint': blueprintIcon,
}

export function PluginIcon({ id, name }: { id: string; name: string }) {
  const source = officialIcons[id]
  const [failedSource, setFailedSource] = useState<string>()
  return <span className={styles.avatar} aria-hidden="true">
    {source && source !== failedSource
      ? <img className={styles.pluginIcon} src={source} alt="" draggable={false} onError={() => setFailedSource(source)} />
      : name.trim().charAt(0).toUpperCase() || '?'}
  </span>
}
