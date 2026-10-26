// Frozen legacy IPC; installed plugins use their own native API.
export const BLUEPRINT_REVIEW_CHANNELS = {
  repairPrepare: 'blueprint:review:repair:prepare', repairDiff: 'blueprint:review:repair:diff', repairUndo: 'blueprint:review:repair:undo',
  repairRetryReview: 'blueprint:review:repair:retry-review',
  read: 'blueprint:review:read', readSaved: 'blueprint:review:read-saved', run: 'blueprint:review:run', close: 'blueprint:review:close', cancel: 'blueprint:review:cancel',
  settingsGet: 'blueprint:review:settings:get', settingsUpdate: 'blueprint:review:settings:update',
  configurationTest: 'blueprint:review:configuration:test', credentialStatus: 'blueprint:review:credential:status', credentialSet: 'blueprint:review:credential:set',
  credentialGet: 'blueprint:review:credential:get',
  activityChanged: 'blueprint:review:activity-changed', activityRead: 'blueprint:review:activity-read',
  resultsChanged: 'blueprint:review:results-changed',
  markRead: 'blueprint:notes:mark-read', undoRead: 'blueprint:notes:undo-read', readChanged: 'blueprint:notes:read-changed',
  mcpStatus: 'blueprint:note-mcp:status', mcpChange: 'blueprint:note-mcp:change', mcpProbe: 'blueprint:note-mcp:probe',
} as const
