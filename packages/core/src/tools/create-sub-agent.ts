import { defineTool } from './schema'

export interface SubAgentConfig {
  key: string
  role: string
  workflow?: unknown
}

export interface WorkflowContext {
  agents: Record<string, SubAgentConfig>
  common: Record<string, unknown>
}

export interface WorkflowStepResult {
  step: string
  agentKey: string
  success: boolean
  response?: string
  error?: string
}

let currentWorkflowContext: WorkflowContext | null = null
let subAgentExecutor:
  | ((agentKey: string, message: string, retryCount: number) => Promise<string>)
  | null = null
let workflowHistory: WorkflowStepResult[] = []
let workflowResetHandler: (() => Promise<void>) | null = null
let retryCount = 0

export function setWorkflowContext(context: WorkflowContext | null): void {
  currentWorkflowContext = context
  if (!context) {
    workflowHistory = []
    retryCount = 0
  }
}

export function getRetryCount(): number {
  return retryCount
}

export function getWorkflowContext(): WorkflowContext | null {
  return currentWorkflowContext
}

export function setSubAgentExecutor(
  executor: ((agentKey: string, message: string, retryCount: number) => Promise<string>) | null
): void {
  subAgentExecutor = executor
}

export function setWorkflowResetHandler(handler: (() => Promise<void>) | null): void {
  workflowResetHandler = handler
}

export function addWorkflowStepResult(result: WorkflowStepResult): void {
  workflowHistory.push(result)
}

export function getWorkflowHistory(): WorkflowStepResult[] {
  return [...workflowHistory]
}

export function clearWorkflowHistory(): void {
  workflowHistory = []
}

export const createSubAgent = defineTool({
  name: 'create_sub_agent',
  description: `Create a temporary sub-agent, send a message, receive the response, and dispose of it.
The sub-agent is created from the workflow configuration and automatically cleaned up after returning the response.
Use this to delegate specific tasks to specialized agents defined in the workflow.`,
  params: {
    agent_key: {
      type: 'string',
      description: 'The key of the agent to create (must be defined in the workflow configuration)',
      required: true
    },
    message: {
      type: 'string',
      description: 'The message/task to send to the sub-agent',
      required: true
    }
  },
  execute: async (_figma, { agent_key, message }) => {
    if (!currentWorkflowContext) {
      return {
        success: false,
        error: 'No workflow context available. This tool can only be used within a workflow.'
      }
    }

    const agentConfig = currentWorkflowContext.agents[agent_key] as SubAgentConfig | undefined
    if (!agentConfig) {
      const availableAgents = Object.keys(currentWorkflowContext.agents)
      return {
        success: false,
        error: `Agent "${agent_key}" not found in workflow configuration.`,
        availableAgents
      }
    }

    if (!subAgentExecutor) {
      return {
        success: false,
        error: 'Sub-agent executor not configured. Cannot create sub-agents.'
      }
    }

    try {
      const response = await subAgentExecutor(agent_key, message, retryCount)
      addWorkflowStepResult({
        step: `create_sub_agent:${agent_key}`,
        agentKey: agent_key,
        success: true,
        response
      })
      return {
        success: true,
        agentKey: agent_key,
        retryCount,
        response
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      addWorkflowStepResult({
        step: `create_sub_agent:${agent_key}`,
        agentKey: agent_key,
        success: false,
        error: errorMsg
      })
      return {
        success: false,
        agentKey: agent_key,
        retryCount,
        error: errorMsg
      }
    }
  }
})

export const checkWorkflowStatus = defineTool({
  name: 'check_workflow_status',
  description: `Check the success/failure status of a workflow step based on the response.
Use this after receiving a response from a sub-agent to determine if the step was successful.
Returns success status and allows PM to decide next action.`,
  params: {
    step_name: {
      type: 'string',
      description: 'Name of the workflow step being checked (e.g., "designer_task", "validation")',
      required: true
    },
    response: {
      type: 'string',
      description: 'The response text from the sub-agent to evaluate',
      required: true
    },
    success_keywords: {
      type: 'string',
      description: 'Comma-separated keywords that indicate success (e.g., "DONE,SUCCESS,PASS")',
      required: true
    },
    failure_keywords: {
      type: 'string',
      description: 'Comma-separated keywords that indicate failure (e.g., "ERROR,FAIL,REJECTED")',
      required: true
    }
  },
  execute: async (_figma, { step_name, response, success_keywords, failure_keywords }) => {
    const successList = success_keywords.split(',').map((k) => k.trim().toUpperCase())
    const failureList = failure_keywords.split(',').map((k) => k.trim().toUpperCase())
    const upperResponse = response.toUpperCase()

    const hasSuccess = successList.some((keyword) => upperResponse.includes(keyword))
    const hasFailure = failureList.some((keyword) => upperResponse.includes(keyword))

    let status: 'success' | 'failure' | 'unknown'
    if (hasSuccess && !hasFailure) {
      status = 'success'
    } else if (hasFailure) {
      status = 'failure'
    } else {
      status = 'unknown'
    }

    const result: WorkflowStepResult = {
      step: step_name,
      agentKey: 'check',
      success: status === 'success',
      response
    }
    addWorkflowStepResult(result)

    return {
      step: step_name,
      status,
      matchedSuccessKeywords: successList.filter((k) => upperResponse.includes(k)),
      matchedFailureKeywords: failureList.filter((k) => upperResponse.includes(k)),
      history: getWorkflowHistory()
    }
  }
})

export const resetWorkflowAndRetry = defineTool({
  name: 'reset_workflow_and_retry',
  description: `Reset the entire workflow context and delete all created content to start fresh.
Use this when a workflow step fails and you need to clear everything and retry from the beginning.
This will:
1. Delete all nodes created during this workflow session
2. Clear workflow history
3. Reset context for a fresh start`,
  params: {
    reason: {
      type: 'string',
      description: 'The reason for resetting (e.g., "Validation failed", "Designer error")',
      required: true
    }
  },
  mutates: true,
  execute: async (figma, { reason }) => {
    const historyBeforeReset = getWorkflowHistory()

    if (workflowResetHandler) {
      try {
        await workflowResetHandler()
      } catch (error) {
        return {
          success: false,
          error: `Reset handler failed: ${error instanceof Error ? error.message : String(error)}`
        }
      }
    }

    const currentPage = figma.currentPage
    const nodesToDelete: string[] = []

    for (const child of currentPage.children) {
      nodesToDelete.push(child.id)
    }

    for (const nodeId of nodesToDelete) {
      const node = figma.getNodeById(nodeId)
      if (node && 'remove' in node) {
        node.remove()
      }
    }

    clearWorkflowHistory()
    retryCount++

    return {
      success: true,
      reason,
      retryCount,
      deletedNodes: nodesToDelete.length,
      previousHistory: historyBeforeReset,
      message: `Workflow reset complete. Deleted ${nodesToDelete.length} nodes. This is retry #${retryCount}. Ready to retry.`
    }
  }
})
