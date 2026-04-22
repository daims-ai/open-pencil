import { INTERNAL_GRAPH } from '../figma-api/proxy'
import { defineTool } from './schema'

import type { SceneNode } from '../scene-graph'

export interface SubAgentConfig {
  key: string
  role: string
  workflow?: unknown
  // Nested workflow-card fields. Present when this sub-agent is itself a
  // workflow card (e.g. a "banner" agent that orchestrates its own
  // pm/designer/validator sub-agents). When `isWorkflowCard` is true, the
  // executor should run this as a nested workflow rather than a leaf agent.
  isWorkflowCard?: boolean
  order?: string[]
  agent?: Record<string, unknown>
  common?: Record<string, unknown>
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
  | ((
      agentKey: string,
      message: string,
      retryCount: number,
      currentPageId: string
    ) => Promise<string>)
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

export function setRetryCount(count: number): void {
  retryCount = count
}

export function getWorkflowContext(): WorkflowContext | null {
  return currentWorkflowContext
}

export function setSubAgentExecutor(
  executor:
    | ((
        agentKey: string,
        message: string,
        retryCount: number,
        currentPageId: string
      ) => Promise<string>)
    | null
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

export function setWorkflowHistory(entries: WorkflowStepResult[]): void {
  workflowHistory = [...entries]
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

    const currentPageId = _figma.currentPageId

    try {
      const response = await subAgentExecutor(agent_key, message, retryCount, currentPageId)
      addWorkflowStepResult({
        step: `create_sub_agent:${agent_key}`,
        agentKey: agent_key,
        success: true,
        response: `${agent_key} agent has been created successfully`
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
  description: `Record the success/failure status of a workflow step.
Use this after evaluating a sub-agent's response to explicitly log whether the step succeeded.
The caller (PM) decides success/failure and provides the reason; this tool stores it in the workflow history and returns the current history so PM can decide the next action.`,
  params: {
    step_name: {
      type: 'string',
      description: 'Name of the workflow step being checked (e.g., "designer_task", "validation")',
      required: true
    },
    success: {
      type: 'boolean',
      description: 'Whether the step succeeded. true for success, false for failure.',
      required: true
    },
    reason: {
      type: 'string',
      description:
        'Human-readable reason summarizing why the step is considered success or failure.',
      required: true
    }
  },
  execute: async (_figma, { step_name, success, reason }) => {
    const status: 'success' | 'failure' = success ? 'success' : 'failure'

    const result: WorkflowStepResult = {
      step: step_name,
      agentKey: 'check',
      success,
      response: reason,
      ...(success ? {} : { error: reason })
    }
    addWorkflowStepResult(result)

    return {
      step: step_name,
      status,
      success,
      reason,
      history: getWorkflowHistory()
    }
  }
})

export const resetContextAndRetry = defineTool({
  name: 'reset_context_and_retry',
  description: `Reset the workflow context to start fresh and prepare for retry.
Use this when a workflow step fails and you need to clear the context and retry from the beginning.
This will:
1. Call the workflow reset handler (if configured)
2. Clear workflow history
3. Increment retry counter
Note: This does NOT delete any nodes. Use delete_workflow_nodes separately before calling this if needed.
After this tool returns, you should restart the workflow from the beginning.`,
  params: {
    reason: {
      type: 'string',
      description: 'The reason for resetting (e.g., "Validation failed", "Designer error")',
      required: true
    }
  },
  execute: async (_figma, { reason }) => {
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

    clearWorkflowHistory()
    retryCount++

    return {
      success: true,
      reason,
      retryCount,
      previousHistory: historyBeforeReset,
      message: `Workflow context reset complete. This is retry #${retryCount}. Ready to retry.`
    }
  }
})

export const deleteWorkflowNodes = defineTool({
  name: 'delete_workflow_nodes',
  description: `Delete nodes on the current page (at any depth) whose name EXACTLY matches the given name.
Use this when you need to clear created content before retrying or when the workflow fails.

STRICT NAME MATCHING RULES:
- The 'name' argument MUST be copied verbatim from the workflow step / instruction that told you which node to delete. Do NOT paraphrase, translate, pluralize, append "-frame", strip suffixes, or otherwise transform the name.
- Example: if the workflow says "delete 'kakao-banner-badge' frame", the correct call is name="kakao-banner-badge" (NOT "kakao-banner-frame", NOT "kakao-banner-badge-frame", NOT "kakao-banner").
- Matching is exact and case-sensitive; any descendant of the current page (top-level or nested inside another frame/group) whose 'name' equals the provided string is removed.
- If no node matches the provided name, NOTHING is deleted and the tool reports deletedNodes: 0. In that case, do not retry with a guessed/modified name — stop and surface the mismatch.`,
  params: {
    reason: {
      type: 'string',
      description: 'The reason for deleting nodes (e.g., "Failed validation", "Starting over")',
      required: true
    },
    name: {
      type: 'string',
      description:
        'Exact, verbatim node name to delete. Must be copied character-for-character from the workflow instruction / designer output (no added or removed suffixes such as "-frame"). Every descendant of the current page (at any depth) whose name equals this string will be removed.',
      required: true
    }
  },
  mutates: true,
  execute: async (figma, { reason, name }) => {
    const currentPage = figma.currentPage
    const targetName = name.trim()

    if (!targetName) {
      return {
        success: false,
        reason,
        error: 'name is required and cannot be empty.'
      }
    }

    const matches = currentPage.findAll((node) => node.name === targetName)
    const nodesToDelete = matches.map((node) => node.id)

    if (nodesToDelete.length === 0) {
      return {
        success: false,
        reason,
        name: targetName,
        deletedNodes: 0,
        error: `No descendant of the current page matches name="${targetName}" exactly. Nothing was deleted. Do not retry with a modified name; verify the node name and try again only if you can copy it verbatim from the workflow instruction or designer output.`
      }
    }

    let deletedCount = 0
    for (const nodeId of nodesToDelete) {
      const node = figma.getNodeById(nodeId)
      if (!node || !('remove' in node)) continue
      try {
        node.remove()
        deletedCount++
      } catch {
        // A parent match may have already removed this descendant; skip silently.
      }
    }

    const scope = `nodes named "${targetName}" from the current page`

    return {
      success: true,
      reason,
      name: targetName,
      deletedNodes: deletedCount,
      message: `Deleted ${deletedCount} ${scope}.`
    }
  }
})

export const getCurrentPageChildren = defineTool({
  name: 'get_current_page_children',
  description: 'Get the children of the current page.',
  params: {},
  execute: async (figma) => {
    const currentPage = figma.currentPage
    const nodesById = new Map<string, SceneNode>()

    for (const child of currentPage.children) {
      const graph = child[INTERNAL_GRAPH]
      for (const [nodeId, node] of graph.nodes) {
        if (nodesById.has(nodeId)) continue
        nodesById.set(nodeId, structuredClone(node))
      }
    }

    if (nodesById.size === 0) {
      const graph = currentPage[INTERNAL_GRAPH]
      for (const [nodeId, node] of graph.nodes) {
        if (nodesById.has(nodeId)) continue
        nodesById.set(nodeId, structuredClone(node))
      }
    }

    const nodes = [...nodesById.values()]

    return { nodes }
  }
})
