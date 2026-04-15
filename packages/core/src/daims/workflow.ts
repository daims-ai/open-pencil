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

  const common = await getPrompt(workflow.common)
  workflow.common = common

  for await (const agentId of workflow.order) {
    const key = workflow.agent[agentId]
    const prompt = await getPrompt(key)
    workflow.agent[agentId] = prompt
  }

  return workflow
}
