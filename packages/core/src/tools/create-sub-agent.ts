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

let currentWorkflowContext: WorkflowContext | null = null
let subAgentExecutor: ((agentKey: string, message: string) => Promise<string>) | null = null

export function setWorkflowContext(context: WorkflowContext | null): void {
  currentWorkflowContext = context
}

export function getWorkflowContext(): WorkflowContext | null {
  return currentWorkflowContext
}

export function setSubAgentExecutor(
  executor: ((agentKey: string, message: string) => Promise<string>) | null
): void {
  subAgentExecutor = executor
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
      const response = await subAgentExecutor(agent_key, message)
      return {
        success: true,
        agentKey: agent_key,
        response
      }
    } catch (error) {
      return {
        success: false,
        agentKey: agent_key,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
})
