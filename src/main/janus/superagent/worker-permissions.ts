import { join } from 'node:path'
import type { SuperAgentEnvironmentLease } from './environments'

const PROFILE = 'janus-superagent'
const quote = (value: string) => JSON.stringify(value.replaceAll('\\', '/'))

/** A native filesystem policy, not a prompt or a command-name filter. P3 must apply it on every start/resume. */
export function workerPermissions(lease: SuperAgentEnvironmentLease) {
  const { checkout } = lease
  const readOnly = [...new Set([join(checkout.path, '.git'), join(checkout.path, '.agents'), join(checkout.path, '.codex'),
    join(checkout.path, '.aws'), checkout.gitDir, checkout.commonDir])]
  const filesystem = [`":root"="read"`, `${quote(checkout.path)}="write"`, ...readOnly.map(path => `${quote(path)}="read"`)].join(',')
  // Native questions and rule prompts remain interactive. Filesystem expansion is handled by the host,
  // never by granting a worker a persistent full-access exception to this profile.
  const approvalPolicy = { granular: { sandbox_approval: false, request_permissions: false, rules: true, mcp_elicitations: true, skill_approval: true } }
  return {
    profile: PROFILE,
    cwd: checkout.path,
    configOverrides: [
      ...(process.platform === 'win32' ? ['windows.sandbox="mxc"'] : []),
      `permissions.${PROFILE}={filesystem={${filesystem}},network={enabled=false}}`,
      `default_permissions="${PROFILE}"`,
      'approval_policy={granular={sandbox_approval=false,request_permissions=false,rules=true,mcp_elicitations=true,skill_approval=true}}',
    ],
    thread: { permissions: PROFILE, runtimeWorkspaceRoots: [checkout.path], approvalPolicy, approvalsReviewer: 'user' as const },
    readOnlyPaths: readOnly,
  }
}
