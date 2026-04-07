/**
 * Delegate tools for multi-agent orchestration.
 *
 * PM agent can use these to delegate tasks to specialized agents
 * (Designer, Validator) and receive their responses.
 *
 * The actual chat dispatch is injected at runtime via setDelegateHandler().
 */

import { defineTool } from './schema'

export type DelegateAgentID = 'designer' | 'validator'

export interface DelegateResponse {
  success: boolean
  result?: string
  error?: string
}

export type DelegateHandler = (
  agentId: DelegateAgentID,
  message: string
) => Promise<DelegateResponse>

export interface WorkflowConfig {
  isWorkflowCard?: boolean
  order?: string[]
  agent: {
    pm?: Record<string, unknown>
    designer?: Record<string, unknown>
    validator?: Record<string, unknown>
  }
  common: Record<string, unknown>
}

let delegateHandler: DelegateHandler | null = null
let workflowConfig: WorkflowConfig | null = null

export function setDelegateHandler(handler: DelegateHandler | null): void {
  delegateHandler = handler
}

export function getDelegateHandler(): DelegateHandler | null {
  return delegateHandler
}

export function setWorkflowConfig(config: WorkflowConfig | null): void {
  workflowConfig = config
}

export function getWorkflowConfig(): WorkflowConfig | null {
  return workflowConfig
}

function buildAgentMessage(agentId: DelegateAgentID, userInput: string): string {
  if (!workflowConfig) {
    return userInput
  }

  const agentConfig = workflowConfig.agent[agentId]
  if (!agentConfig) {
    return userInput
  }

  const commonJson = JSON.stringify(workflowConfig.common, null, 2)

  const agentContext = {
    ...agentConfig,
    common: workflowConfig.common,
    user_input: userInput
  }

  let message = JSON.stringify(agentContext, null, 2)
  // message = message.replace(/##COMMON##/g, commonJson)

  // if (userInput) {
  //   message += `\n\nUser Input: ${userInput}`
  // }

  return message
}

/**
 * Build initial message for PM agent.
 * PM only gets its own config from the JSON - no additional instructions.
 */
export function buildPMStartMessage(config: WorkflowConfig): string {
  const pmConfig = config.agent.pm
  if (!pmConfig) {
    return '{}'
  }

  return JSON.stringify(pmConfig, null, 2)
}

/**
 * Check if text is a workflow JSON config
 */
export function isWorkflowJson(text: string): WorkflowConfig | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed.isWorkflowCard === true || (parsed.agent && parsed.common))
    ) {
      return parsed as WorkflowConfig
    }
  } catch {
    return null
  }
  return null
}

async function executeDelegation(
  agentId: DelegateAgentID,
  userInput: string
): Promise<DelegateResponse> {
  if (!delegateHandler) {
    return {
      success: false,
      error: 'Delegate handler not configured. Multi-agent orchestration unavailable.'
    }
  }

  const message = buildAgentMessage(agentId, userInput)
  return delegateHandler(agentId, message)
}

export const delegateToDesigner = defineTool({
  name: 'delegate_to_designer',
  description:
    'Send user input to the Designer agent. The workflow config will be automatically applied. Pass only the user input text (e.g., marketing copy, headline text).',
  params: {
    user_input: {
      type: 'string',
      description: 'User input text to pass to designer (e.g., headline text, marketing copy)',
      required: true
    }
  },
  execute: async (_figma, args) => {
    const response = await executeDelegation('designer', args.user_input)

    if (!response.success) {
      return { error: response.error, agent: 'designer' }
    }

    return {
      agent: 'designer',
      status: 'DONE',
      result: response.result
    }
  }
})

export const delegateToValidator = defineTool({
  name: 'delegate_to_validator',
  description:
    'Send validation request to the Validator agent. The workflow config will be automatically applied. Pass any specific validation context if needed.',
  params: {
    context: {
      type: 'string',
      description: 'Additional validation context or specific items to check (optional)',
      required: false
    }
  },
  execute: async (_figma, args) => {
    const response = await executeDelegation('validator', args.context ?? '')

    if (!response.success) {
      return { error: response.error, agent: 'validator' }
    }

    const result = response.result ?? ''
    const isPassed =
      result.includes('PASS') || result.includes('pass') || result.includes('SUCCESS')
    const hasError = result.includes('ERROR') || result.includes('error') || result.includes('fail')

    // const status = hasError ? 'ERROR' : isPassed ? 'PASS' : 'DONE'

    const status = isPassed ? 'PASS' : 'ERROR'

    return {
      agent: 'validator',
      status,
      result: response.result
    }
  }
})

const MAX_WORKFLOW_RETRIES = 20

export type DeleteCreatedContentHandler = () => Promise<void>

let deleteCreatedContentHandler: DeleteCreatedContentHandler | null = null

export function setDeleteCreatedContentHandler(handler: DeleteCreatedContentHandler | null): void {
  deleteCreatedContentHandler = handler
}

export interface WorkflowStepResult {
  step: string
  agent?: DelegateAgentID
  status: 'success' | 'error' | 'retry'
  result?: string
  error?: string
}

export interface WorkflowResult {
  success: boolean
  steps: WorkflowStepResult[]
  finalStatus: 'PASS' | 'ERROR' | 'MAX_RETRIES_EXCEEDED'
  summary?: string
  error?: string
  retryCount: number
}

function checkValidatorResult(result: string): { isPassed: boolean; hasError: boolean } {
  const isPassed = result.includes('PASS') || result.includes('pass') || result.includes('SUCCESS')
  const hasError = result.includes('ERROR') || result.includes('error') || result.includes('fail')
  return { isPassed, hasError }
}

async function runDesignerStep(
  userInput: string,
  attempt: number,
  steps: WorkflowStepResult[]
): Promise<{ success: boolean; done: boolean; error?: string }> {
  steps.push({
    step: `STEP2: Designer (attempt ${attempt})`,
    agent: 'designer',
    status: 'success',
    result: 'Starting design...'
  })

  const inputWithAttempt =
    attempt > 1
      ? `[Retry attempt ${attempt}/${MAX_WORKFLOW_RETRIES} - previous attempt failed validation]\n\n${userInput}`
      : userInput

  const response = await executeDelegation('designer', inputWithAttempt)
  const lastStep = steps[steps.length - 1]

  if (!response.success) {
    lastStep.status = 'error'
    lastStep.error = response.error
    return { success: false, done: false, error: response.error }
  }

  const result = response.result ?? ''
  const done = result.includes('DONE') || result.includes('done')

  lastStep.result = result
  lastStep.status = done ? 'success' : 'error'

  return { success: true, done }
}

async function runValidatorStep(
  attempt: number,
  steps: WorkflowStepResult[]
): Promise<{ success: boolean; passed: boolean; error?: string }> {
  steps.push({
    step: 'STEP3: Validator',
    agent: 'validator',
    status: 'success',
    result: 'Starting validation...'
  })

  const contextWithAttempt =
    attempt > 1
      ? `[Validation attempt ${attempt}/${MAX_WORKFLOW_RETRIES} - timestamp: ${Date.now()}]`
      : `[timestamp: ${Date.now()}]`

  const response = await executeDelegation('validator', contextWithAttempt)
  const lastStep = steps[steps.length - 1]

  if (!response.success) {
    lastStep.status = 'error'
    lastStep.error = response.error
    return { success: false, passed: false, error: response.error }
  }

  const result = response.result ?? ''
  lastStep.result = result

  const { isPassed, hasError } = checkValidatorResult(result)
  const passed = isPassed && !hasError

  lastStep.status = passed ? 'success' : 'retry'

  return { success: true, passed }
}

import type { FigmaAPI } from '../figma-api'

async function cleanupContent(
  figma: FigmaAPI,
  retryNum: number,
  steps: WorkflowStepResult[]
): Promise<void> {
  steps.push({
    step: `STEP4: Cleanup before retry ${retryNum}`,
    status: 'success',
    result: 'Deleting created content...'
  })

  const lastStep = steps[steps.length - 1]

  if (deleteCreatedContentHandler) {
    try {
      await deleteCreatedContentHandler()
      lastStep.result = 'Content deleted, retrying...'
    } catch (e) {
      lastStep.status = 'error'
      lastStep.error = e instanceof Error ? e.message : String(e)
    }
  } else {
    const pageId = figma.currentPage.id
    const page = figma.graph.getNode(pageId)
    if (page && 'childIds' in page) {
      const childIds = page.childIds.slice()
      for (const childId of childIds) {
        const child = figma.getNodeById(childId)
        if (child) child.remove()
      }
    }
    lastStep.result = 'Content deleted via figma API, retrying...'
  }
}

export const runWorkflow = defineTool({
  name: 'run_workflow',
  description:
    'Execute the complete design workflow: Designer creates content, Validator checks it. If validation fails, content is deleted and retried. Loops until PASS or max retries reached.',
  params: {
    user_input: {
      type: 'string',
      description: 'User input text (e.g., marketing headline)',
      required: true
    },
    max_retries: {
      type: 'number',
      description: 'Maximum retry attempts on validation failure (default: 3)',
      required: false,
      default: MAX_WORKFLOW_RETRIES
    }
  },
  execute: async (figma, args) => {
    const userInput = args.user_input
    const maxRetries = MAX_WORKFLOW_RETRIES

    const steps: WorkflowStepResult[] = []
    let retryCount = 0

    while (retryCount < maxRetries) {
      const designResult = await runDesignerStep(userInput, retryCount + 1, steps)

      if (!designResult.success) {
        return {
          success: false,
          steps,
          finalStatus: 'ERROR',
          error: `Designer failed: ${designResult.error}`,
          retryCount
        } as WorkflowResult
      }

      if (!designResult.done) {
        return {
          success: false,
          steps,
          finalStatus: 'ERROR',
          error: 'Designer did not return DONE',
          retryCount
        } as WorkflowResult
      }

      const validResult = await runValidatorStep(retryCount + 1, steps)

      if (!validResult.success) {
        return {
          success: false,
          steps,
          finalStatus: 'ERROR',
          error: `Validator failed: ${validResult.error}`,
          retryCount
        } as WorkflowResult
      }

      if (validResult.passed) {
        return {
          success: true,
          steps,
          finalStatus: 'PASS',
          summary: `Workflow completed successfully after ${retryCount + 1} attempt(s)`,
          retryCount
        } as WorkflowResult
      }

      retryCount++

      if (retryCount < maxRetries) {
        await cleanupContent(figma, retryCount + 1, steps)
      }
    }

    return {
      success: false,
      steps,
      finalStatus: 'MAX_RETRIES_EXCEEDED',
      error: `Validation failed after ${maxRetries} attempts`,
      retryCount
    } as WorkflowResult
  }
})

export const DELEGATE_TOOLS = [delegateToDesigner, delegateToValidator, runWorkflow]
