// Note: engine tool rules, shared desktop processes — see .agents/notes/agent/ideas/superagent-harness-reliability.md
import { createProjectTools } from '@janus-agent/janus-agent/tools/project/tools'
import { getProjectRunner } from '../../../project/runner/service'
export const { projectDetectTool, projectGenerateConfigTool, projectApplyConfigTool, projectListProcessesTool,
  projectProcessOutputTool, projectStartProcessTool, projectStopProcessTool, registerProjectTools } = createProjectTools(getProjectRunner)
