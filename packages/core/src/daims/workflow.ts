import { DaimsClient } from 'prompt-searcher'

let client = new DaimsClient()

export type DaimsWorkflow = Record<string, unknown> & {
  order: string[]
  agent: Record<string, unknown>
  common: Record<string, unknown>
}

async function getPrompt(skey: string, link?: string) {
  const result = await client.getPrompt(skey)

  if (!result.success || !result.prompt) {
    throw new Error('Failed to fetch prompt')
  }

  return JSON.parse(result.prompt)
}

export async function checkIsDaimsWorkflow(text: string): Promise<boolean> {
  try {
    const workflow = JSON.parse(text)
    return typeof workflow === 'object' && workflow.isWorkflowCard
  } catch (e) {
    console.error('Failed to check if text is a Daims workflow:', e)
    return false
  }
}

export async function parseDaimsWorkflow(text: string): Promise<DaimsWorkflow | null> {
  if (!checkIsDaimsWorkflow(text)) {
    return null
  }

  const workflow = JSON.parse(text)

  if (workflow.common && typeof workflow.common === 'string') {
    const commonPrompt = await getPrompt(workflow.common)
    workflow.common = commonPrompt
  }

  for await (const agentId of workflow.order) {
    const entry = workflow.agent[agentId]
    if (typeof entry === 'string') {
      const prompt = await getPrompt(entry)
      workflow.agent[agentId] = prompt
      if (prompt.isWorkflowCard) {
        const subWorkflow = await parseDaimsWorkflow(JSON.stringify(prompt))
        if (subWorkflow) {
          workflow.agent[agentId] = subWorkflow
        }
      }
    } else if (
      entry &&
      typeof entry === 'object' &&
      (entry as Record<string, unknown>).isWorkflowCard === true
    ) {
      // Inline nested workflow card (e.g. test.json). Recurse so that any
      // string prompt references inside the nested card are resolved too.
      const subWorkflow = await parseDaimsWorkflow(JSON.stringify(entry))
      if (subWorkflow) {
        workflow.agent[agentId] = subWorkflow
      }
    }
  }

  console.log('workflow', workflow)

  return workflow
}
