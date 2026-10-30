// Note: fast feedback and complete acceptance — see .agents/notes/desktop/reproducible-verification.md
// All new tests enter the unit project unless explicitly assigned here.
export const browserTestFiles = [
  'tests/unit/workspace-storage-ui.test.ts',
  'tests/unit/assistant-ui.test.ts',
  'tests/unit/blueprint-edge-label.test.ts',
  'tests/unit/blueprint-legacy-import-ui.test.ts',
  'tests/unit/blueprint-plugin-navigation.test.ts',
  'tests/unit/blueprint-settings-ui.test.ts',
  'tests/unit/knowledge-review-state-ui.test.ts',
  'tests/unit/personal-memory-correction-ui.test.ts',
  'tests/unit/personal-profile-editor-ui.test.ts',
  'tests/unit/plugin-workspace-handoff-ui.test.ts',
  'tests/unit/updater/ui.test.ts',
  'tests/unit/usage-stats-loading.test.ts',
]

// These retain real Git, subprocess, repository-corpus and build integration.
// The list uses observed cost, not a filename rule that would hide new tests.
export const integrationTestFiles = [
  'tests/unit/agent-hook-shell.test.ts',
  'tests/unit/agent-hook-cli.test.ts',
  'tests/unit/blueprint-native.test.ts',
  'tests/unit/blueprint-review-engine.test.ts',
  'tests/unit/blueprint-review-git.test.ts',
  'tests/unit/blueprint-suggestions.test.ts',
  'tests/unit/blueprint-workspace-init.test.ts',
  'tests/unit/electron-build-isolation.test.ts',
  'tests/unit/git-service.test.ts',
  'tests/unit/harness-desktop-executor.test.ts',
  'tests/unit/harness-independent-review.test.ts',
  'tests/unit/harness-service.test.ts',
  'tests/unit/note-repair.test.ts',
  'tests/unit/prepare-package.test.ts',
  'tests/unit/workflowx-v2.test.ts',
  'tests/unit/worktree-git.test.ts',
]
