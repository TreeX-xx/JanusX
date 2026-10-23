import { useEffect, useState } from 'react'
import { Bell, BookOpen, Brain, ChartNoAxesCombined, Cloud, Info, ListFilter, Plug, Puzzle, Settings, ShieldCheck, SlidersHorizontal, Sparkles, SquareTerminal, Users, X, type LucideIcon } from 'lucide-react'
import { ModalFrame } from '@/components/shared/ModalFrame'
import { GeneralSettingsPanel } from './GeneralSettingsPanel'
import { AboutSettingsPanel } from './AboutSettingsPanel'
import { TerminalManagerPanel } from './TerminalManagerPanel'
import { ExperimentalSettingsPanel } from './ExperimentalSettingsPanel'
import { NotificationSettingsPanel } from './NotificationSettingsPanel'
import { PersonalMemorySettingsPanel } from './PersonalMemorySettingsPanel'
import { BlueprintSettingsPanel } from './blueprint/BlueprintSettingsPanel'
import { LlmConfigModal } from './LlmConfigModal'
import { ModelCatalogPanel } from './ModelCatalogPanel'
import { AgentSettingsPanel } from './AgentSettingsPanel'
import { UsageStatsPanel } from './UsageStatsPanel'
import { HostedSettingsPanel } from './HostedSettingsPanel'
import { TeamSettingsPanel } from './team/TeamSettingsPanel'
import { CpaSettingsPanel } from './cpa/CpaSettingsPanel'
import { PluginSettingsPanel } from './plugins/PluginSettingsPanel'
import type { PluginConfigurationTarget } from '@/extensions/plugin-configuration-navigation'
import { useExperimentalStore } from '@/stores/experimental'
import { useI18n } from '@/i18n/useI18n'
import styles from './AppSettingsModal.module.css'
import { LearningButton } from './onboarding/LearningButton'

export type SettingsTab = 'general' | 'terminal' | 'integrations' | 'plugins' | 'experimental' | 'notifications' | 'personal' | 'knowledge' | 'agent' | 'llm' | 'usage' | 'models' | 'team' | 'hosted' | 'about'

interface AppSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: SettingsTab
  pluginConfiguration?: PluginConfigurationTarget | null
}

// Note: grouped navigation preserves independent feature gates — see .agents/notes/knowledge/assistant-persona-layout.md
const TAB_GROUPS: { id: string; tabs: SettingsTab[] }[] = [
  { id: 'application', tabs: ['general', 'terminal', 'integrations', 'plugins', 'notifications', 'experimental'] },
  { id: 'memory', tabs: ['knowledge', 'personal'] },
  { id: 'models', tabs: ['llm', 'models', 'usage'] },
  { id: 'collaboration', tabs: ['agent', 'team', 'hosted'] },
  { id: 'about', tabs: ['about'] },
]
const TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  general: Settings, terminal: SquareTerminal, notifications: Bell, experimental: Sparkles,
  knowledge: BookOpen, personal: Brain, llm: SlidersHorizontal,
  models: ListFilter, usage: ChartNoAxesCombined, agent: ShieldCheck,
  team: Users, hosted: Cloud, about: Info,
  integrations: Plug,
  plugins: Puzzle,
}

// Note: the modal mounts only while open, so ModalFrame owns the whole
// open/closing/hidden lifecycle — see shared/ModalFrame.css and
// .agents/notes/terminal/settings-workbench-transition.md
export function AppSettingsModal({ isOpen, onClose, initialTab = 'general', pluginConfiguration }: AppSettingsModalProps) {
  const { t } = useI18n('settings')
  const { t: tTeam } = useI18n('team')
  const { t: tBlueprint } = useI18n('blueprint')
  const { t: tKnowledge } = useI18n('knowledge')
  const { t: tCommon } = useI18n('common')
  const { t: tPlugins } = useI18n('plugins')
  // 「终端管理」文案走 terminal 命名空间：settings.json 有历史编码损坏，不再追加 key。
  const { t: tTerminal } = useI18n('terminal')
  const [selectedTab, setActiveTab] = useState<SettingsTab>(initialTab)
  // 创新开关门控团队页：关闭时 tab 隐藏；正停在 team 页则退回 general，避免悬空态。
  const teamCollabEnabled = useExperimentalStore((s) => s.teamCollab)
  const personaEnabled = useExperimentalStore((s) => s.persona)
  const blueprintEnabled = useExperimentalStore((s) => s.blueprint)
  const loadExperimental = useExperimentalStore((s) => s.load)
  const groups = TAB_GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) =>
      (tab !== 'team' || teamCollabEnabled) &&
      (tab !== 'knowledge' || blueprintEnabled) &&
      (tab !== 'personal' || personaEnabled)),
  })).filter((group) => group.tabs.length > 0)
  const tabOrder = groups.flatMap((group) => group.tabs)
  // Note: blueprint settings are independent of the retiring knowledge gate — see .agents/notes/blueprint/product-direction.md
  const activeTab = tabOrder.includes(selectedTab) ? selectedTab : 'general'

  useEffect(() => {
    void loadExperimental()
  }, [loadExperimental])

  useEffect(() => {
    setActiveTab((prev) => (prev === 'team' && !teamCollabEnabled || prev === 'knowledge' && !blueprintEnabled || prev === 'personal' && !personaEnabled) ? 'general' : prev)
  }, [teamCollabEnabled, blueprintEnabled, personaEnabled])

  useEffect(() => {
    if (isOpen) setActiveTab(initialTab)
  }, [isOpen, initialTab, pluginConfiguration])

  if (!isOpen) return null

  // team 页文案走 team 命名空间（settings.json 存在历史编码损坏，不再追加 key）。
  // hosted 页同理走 common 命名空间。
  const tabNav = (tab: SettingsTab) =>
    tab === 'plugins' ? tPlugins('plugins:nav') : tab === 'integrations' ? tCommon('common:cpa.settingsNav') : tab === 'knowledge' ? tBlueprint('blueprint:review.settingsTitle') : tab === 'personal' ? tKnowledge('knowledge:memorySettings.title') : tab === 'team'
      ? tTeam('team:settingsTab.nav')
      : tab === 'terminal'
        ? tTerminal('terminal:shellSettings.nav')
        : tab === 'hosted'
        ? tCommon('common:hosted.nav')
        : t(`settings:tab.${tab}.nav`)
  const meta = activeTab === 'plugins' ? { title: tPlugins('plugins:title'), subtitle: tPlugins('plugins:subtitle') } : activeTab === 'integrations' ? { title: tCommon('common:cpa.settingsNav'), subtitle: tCommon('common:cpa.settingsSubtitle') } : activeTab === 'knowledge' ? { title: tBlueprint('blueprint:review.settingsTitle'), subtitle: tBlueprint('blueprint:review.settingsSubtitle') } : activeTab === 'personal' ? { title: tKnowledge('knowledge:memorySettings.title'), subtitle: tKnowledge('knowledge:memorySettings.navMeta') } : activeTab === 'team'
    ? { title: tTeam('team:settingsTab.title'), subtitle: tTeam('team:settingsTab.subtitle') }
    : activeTab === 'terminal'
      ? { title: tTerminal('terminal:shellSettings.title'), subtitle: tTerminal('terminal:shellSettings.subtitle') }
      : activeTab === 'hosted'
      ? { title: tCommon('common:hosted.title'), subtitle: tCommon('common:hosted.subtitle') }
      : {
        title: t(`settings:tab.${activeTab}.title`),
        subtitle: t(`settings:tab.${activeTab}.subtitle`),
      }

  return (
    <ModalFrame
      label={meta.title}
      onClose={onClose}
      backdropClassName={styles.backdrop}
      panelClassName={styles.panel}
      focusPanelOnReveal
      zIndex={9999}
    >
      {({ requestClose }) => (
        <>
          <aside className={styles.sidebar}>
            <div className={styles.brand}>
              <span className={styles.brandTitle}>JanusX</span>
              <span className={styles.brandMeta}>{t('settings:brand')}</span>
            </div>
            <nav className={styles.navigation} aria-label={t('settings:brand')}>
              {groups.map((group) => (
                <section key={group.id} className={styles.navGroup} aria-label={group.id === 'about' ? tabNav('about') : t(`settings:groups.${group.id}`)}>
                  {group.id !== 'about' && <h3 className={styles.groupTitle}>{t(`settings:groups.${group.id}`)}</h3>}
                  <div className={styles.groupItems}>
                    {group.tabs.map((tab) => {
                      const Icon = TAB_ICONS[tab]
                      return (
                        <button
                          key={tab}
                          type="button"
                          data-tab={tab}
                          className={`${styles.tabButton} ${activeTab === tab ? styles.tabButtonActive : ''}`}
                          aria-current={activeTab === tab ? 'page' : undefined}
                          onClick={() => setActiveTab(tab)}
                        >
                          <Icon size={16} strokeWidth={1.7} aria-hidden="true" className={styles.tabIcon} />
                          <span className={styles.tabLabel}>{tabNav(tab)}{tab === 'experimental' && <span className={styles.tabBadge}>{t('settings:experimental.badge')}</span>}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </nav>
            <LearningButton onOpen={onClose} />
          </aside>

          <section className={styles.content}>
            <header className={styles.header}>
              <div className={styles.titleWrap}>
                <h2 className={styles.title}>{meta.title}</h2>
                <div className={styles.subtitle}>{meta.subtitle}</div>
              </div>
              <button type="button" className={styles.closeButton} aria-label={tCommon('common:action.close')} onClick={requestClose}>
                <X size={18} strokeWidth={1.7} aria-hidden="true" />
              </button>
            </header>

            <main className={styles.body}>
              {activeTab === 'general' && <GeneralSettingsPanel />}
              {activeTab === 'about' && <AboutSettingsPanel />}
              {activeTab === 'terminal' && <TerminalManagerPanel />}
              {activeTab === 'integrations' && <CpaSettingsPanel onOpened={requestClose} />}
              {activeTab === 'plugins' && <PluginSettingsPanel configurationTarget={pluginConfiguration} onOpened={requestClose} />}
              {activeTab === 'experimental' && <ExperimentalSettingsPanel />}
              {activeTab === 'notifications' && <NotificationSettingsPanel />}
              {activeTab === 'personal' && <PersonalMemorySettingsPanel />}
              {activeTab === 'knowledge' && <BlueprintSettingsPanel />}
              {activeTab === 'agent' && <AgentSettingsPanel />}
              {activeTab === 'llm' && <LlmConfigModal embedded />}
              {activeTab === 'usage' && <UsageStatsPanel />}
              {activeTab === 'models' && <ModelCatalogPanel />}
              {activeTab === 'team' && <TeamSettingsPanel />}
              {activeTab === 'hosted' && <HostedSettingsPanel />}
            </main>
          </section>
        </>
      )}
    </ModalFrame>
  )
}
