import { SettingsSurface, SettingsSection, SettingsRow, Button as SettingsButton, Input as SettingsInput } from '@janusx/ui'
import { useState } from 'react'
import { Select } from '../ui/Select'
import { Check, Copy } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import { useTeamStore } from '@/stores/team'
import type { TeamRole } from '../../../../shared/team/types'
import { settingsStyles as styles } from '@janusx/ui'

const ROLE_ORDER: TeamRole[] = ['viewer', 'contributor', 'maintainer', 'owner']

/**
 * 设置中心 team 页（ToB M2）：成员列表/角色/禁用 + 邀请码 + 飞书占位。
 * 权限判断在主进程，UI 只做展示与触发。
 *
 * 视觉与通知/知识库/Agent 页同构：panel > section 灰卡 > row（左 label+hint，右控件），
 * 按钮统一透明底 + 发丝边框（ghost / primary），不做橙色填充色块；
 * 邀请码展示复用 controlStatus 发丝线样式，不用橙色底 pill。
 */
export function TeamSettingsPanel() {
  const { t } = useI18n('team')
  const status = useTeamStore((s) => s.status)
  const user = useTeamStore((s) => s.user)
  const tenants = useTeamStore((s) => s.tenants)
  const activeTenantId = useTeamStore((s) => s.activeTenantId)
  const members = useTeamStore((s) => s.members)
  const busy = useTeamStore((s) => s.busy)
  const error = useTeamStore((s) => s.error)
  const inviteMember = useTeamStore((s) => s.inviteMember)
  const setRole = useTeamStore((s) => s.setRole)
  const setMemberStatus = useTeamStore((s) => s.setMemberStatus)
  const switchTenant = useTeamStore((s) => s.switchTenant)
  const createTenant = useTeamStore((s) => s.createTenant)
  const acceptInvite = useTeamStore((s) => s.acceptInvite)
  const logout = useTeamStore((s) => s.logout)
  const clearError = useTeamStore((s) => s.clearError)
  const requestLogin = useTeamStore((s) => s.requestLogin)

  const [inviteRole, setInviteRole] = useState<TeamRole>('viewer')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')
  const [joinCode, setJoinCode] = useState('')

  const active = tenants.find((tenant) => tenant.id === activeTenantId) ?? null
  const myRole = active?.myRole ?? 'viewer'
  const canManage = myRole === 'owner' || myRole === 'maintainer'

  const doInvite = async () => {
    clearError()
    setCopied(false)
    const result = await inviteMember(inviteRole)
    if (result) setInviteCode(result.code)
  }

  const copyCode = async () => {
    if (!inviteCode) return
    try {
      await navigator.clipboard.writeText(inviteCode)
    } catch {
      /* 剪贴板不可用时仍显示邀请码 */
    }
    setCopied(true)
  }

  return (
    <SettingsSurface className={styles.panel}>
      <SettingsSection className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('team:gate.title')}</h3>
        {status !== 'authed' ? (
          <SettingsRow className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>{t('team:footer.login')}</span>
              <span className={styles.hint}>{t('team:gate.subtitle')}</span>
            </div>
            <SettingsButton variant="primary"
              type="button"
              onClick={() => requestLogin()}
            >
              {t('team:footer.login')}
            </SettingsButton>
          </SettingsRow>
        ) : (
          user && (
            <SettingsRow className={styles.row}>
              <div className={styles.label}>
                <span className={styles.labelText}>{user.name}</span>
                <span className={styles.hint}>{user.email}</span>
              </div>
              <SettingsButton variant="ghost"
                type="button"
                onClick={() => void logout()}
              >
                {t('team:footer.logout')}
              </SettingsButton>
            </SettingsRow>
          )
        )}
      </SettingsSection>

      <SettingsSection className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('team:footer.switchOrg')}</h3>
        {tenants.map((tenant) => {
          const isActive = tenant.id === activeTenantId
          return (
            <SettingsRow className={styles.row} key={tenant.id}>
              <div className={styles.label}>
                <span className={styles.labelText}>{tenant.name}</span>
                <span className={styles.hint}>{t(`team:panel.${tenant.myRole}`)}</span>
              </div>
              {isActive ? (
                <span className={styles.status}>{t('team:panel.current')}</span>
              ) : (
                <SettingsButton variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => void switchTenant(tenant.id)}
                >
                  {t('team:panel.switch')}
                </SettingsButton>
              )}
            </SettingsRow>
          )
        })}
        <SettingsRow className={styles.row}>
          <div className={styles.label}>
            <span className={styles.labelText}>{t('team:footer.createOrg')}</span>
            <span className={styles.hint}>{t('team:gate.createOrgDesc')}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <SettingsInput
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder={t('team:footer.createOrgPlaceholder')}
              className={`${styles.input} ${styles.textInput}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newOrgName.trim()) {
                  void createTenant(newOrgName.trim())
                  setNewOrgName('')
                }
              }}
            />
            <SettingsButton variant="primary"
              type="button"
              disabled={busy || !newOrgName.trim()}
              onClick={() => {
                void createTenant(newOrgName.trim())
                setNewOrgName('')
              }}
            >
              {t('team:footer.createOrg')}
            </SettingsButton>
          </div>
        </SettingsRow>
        <SettingsRow className={styles.row}>
          <div className={styles.label}>
            <span className={styles.labelText}>{t('team:gate.joinOrgAction')}</span>
            <span className={styles.hint}>{t('team:gate.inviteHint')}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <SettingsInput
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder={t('team:gate.inviteCodePlaceholder')}
              className={`${styles.input} ${styles.textInput}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && joinCode.trim()) {
                  void acceptInvite(joinCode)
                  setJoinCode('')
                }
              }}
            />
            <SettingsButton variant="ghost"
              type="button"
              disabled={busy || !joinCode.trim()}
              onClick={() => {
                void acceptInvite(joinCode)
                setJoinCode('')
              }}
            >
              {t('team:gate.joinOrgAction')}
            </SettingsButton>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection className={styles.section}>
        <h3 className={styles.sectionTitle}>
          {t('team:panel.members')} · {active?.name ?? '—'}
        </h3>
        {members.length === 0 && <div className={styles.status}>{t('team:panel.empty')}</div>}
        {members.map((m) => {
          const isMe = m.user.id === user?.id
          const disabled = m.membership.status !== 'active'
          return (
            <SettingsRow className={styles.row} key={m.user.id} style={disabled ? { opacity: 0.55 } : undefined}>
              <div className={styles.label}>
                <span className={styles.labelText}>
                  {m.user.name}
                  {isMe && <span className={styles.hint}> · {t('team:panel.you')}</span>}
                </span>
                <span className={styles.hint}>
                  {m.user.email} · {disabled ? t('team:panel.disabled') : t(`team:panel.${m.membership.role}`)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {canManage && !isMe && !disabled && (
                  <>
                    <Select
                      value={m.membership.role}
                      disabled={busy}
                      onChange={value => void setRole(m.user.id, value as TeamRole)}
                      className={styles.select}
                      ariaLabel={t('team:panel.role')}
                      options={ROLE_ORDER.map(role => ({ value: role, label: t(`team:panel.${role}`) }))}
                    />
                    <SettingsButton variant="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => void setMemberStatus(m.user.id, 'disabled')}
                    >
                      {t('team:panel.disable')}
                    </SettingsButton>
                  </>
                )}
                {canManage && !isMe && disabled && (
                  <SettingsButton variant="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => void setMemberStatus(m.user.id, 'active')}
                  >
                    {t('team:panel.enable')}
                  </SettingsButton>
                )}
              </div>
            </SettingsRow>
          )
        })}
      </SettingsSection>

      {canManage && (
        <SettingsSection className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('team:panel.inviteSection')}</h3>
          <SettingsRow className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>{t('team:panel.inviteRole')}</span>
              <span className={styles.hint}>{t('team:panel.codeLabel')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Select
                value={inviteRole}
                disabled={busy}
                onChange={value => setInviteRole(value as TeamRole)}
                className={styles.select}
                ariaLabel={t('team:panel.inviteRole')}
                options={(['viewer', 'contributor', 'maintainer'] as const).map(role => ({ value: role, label: t(`team:panel.${role}`) }))}
              />
              <SettingsButton variant="primary"
                type="button"
                disabled={busy}
                onClick={() => void doInvite()}
              >
                {busy ? t('team:panel.inviting') : t('team:panel.inviteAction')}
              </SettingsButton>
            </div>
          </SettingsRow>
          {inviteCode && (
            <div className={styles.controlStatus}>
              <div className={styles.label}>
                <span className={styles.labelText}>{t('team:panel.codeLabel')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  className="font-mono"
                  style={{ fontSize: 13, fontWeight: 650, letterSpacing: '0.12em' }}
                >
                  {inviteCode}
                </span>
                <SettingsButton variant="ghost"
                  type="button"
                  onClick={() => void copyCode()}

                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                  {copied ? t('team:panel.copied') : t('team:panel.copyCode')}
                </SettingsButton>
              </div>
            </div>
          )}
        </SettingsSection>
      )}

      {error && <div className={`${styles.status} ${styles.statusError}`}>{error}</div>}

      <p className={styles.controlNotice}>{t('team:panel.feishuSoon')}</p>
    </SettingsSurface>
  )
}
