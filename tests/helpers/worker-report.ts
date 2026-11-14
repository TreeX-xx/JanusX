/** Structured report emitted by local provider fixtures, not real-model verification evidence. */
export const fixtureWorkerReport = (details: string) => ({
  completed: [details], artifacts: [],
  checks: [{ method: 'Provider fixture tool sequence', status: 'passed', result: 'The configured tool sequence returned.', evidence: [] }],
  limitations: ['Local provider fixture; no live-model quality claim.'], questions: [], details,
})
