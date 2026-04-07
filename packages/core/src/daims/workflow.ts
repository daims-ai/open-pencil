export type DaimsWorkflow = {
  order: string[]
  agent: Record<string, unknown>
  common: Record<string, unknown>
}

export function parseDaimsWorkflow(text: string): DaimsWorkflow | null {
  try {
    const workflow = JSON.parse(text)
    if (typeof workflow !== 'object' || !workflow.isWorkflowCard) {
      return null
    }
    return workflow
  } catch {
    return null
  }
}
