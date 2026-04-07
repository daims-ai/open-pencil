import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

import { getDelegateSender } from '@/ai/delegate-bridge'
import { makeFigmaFromStore } from '@/automation/figma-factory'
import { getActiveEditorStore } from '@/stores/editor'
import {
  CORE_TOOLS,
  PM_TOOLS,
  collectFontKeys,
  computeAllLayouts,
  isFontLoaded,
  loadFont,
  setDelegateHandler,
  setWorkflowConfig,
  toolsToAI
} from '@open-pencil/core'

import type { EditorStore } from '@/stores/editor'
import type { SceneNode, StepBudget, ToolLogEntry, WorkflowConfig } from '@open-pencil/core'

setDelegateHandler(async (agentId, message) => {
  const sender = getDelegateSender()
  if (!sender) {
    return { success: false, error: 'Delegate sender not initialized' }
  }
  return sender(agentId, message)
})

export function loadWorkflowConfig(config: WorkflowConfig): void {
  setWorkflowConfig(config)
}

export const MAX_AGENT_STEPS = 50

export interface StepUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  timestamp: number
}

class RunState {
  toolLog: ToolLogEntry[] = []
  stepUsages: StepUsage[] = []
  currentSteps = 0

  recordStep(usage: StepUsage): void {
    this.stepUsages.push(usage)
    this.currentSteps++
  }

  resetSteps(): void {
    this.currentSteps = 0
  }

  hitLimit(): boolean {
    return this.currentSteps >= MAX_AGENT_STEPS
  }

  clear(): void {
    this.toolLog = []
    this.stepUsages = []
    this.currentSteps = 0
  }
}

const runStates = new WeakMap<EditorStore, RunState>()

function getRunState(store?: EditorStore): RunState {
  const target = store ?? getActiveEditorStore()
  const existing = runStates.get(target)
  if (existing) return existing
  const created = new RunState()
  runStates.set(target, created)
  return created
}

export function getToolLogEntries(store?: EditorStore): ToolLogEntry[] {
  return getRunState(store).toolLog
}

export function getStepUsages(store?: EditorStore): StepUsage[] {
  return getRunState(store).stepUsages
}

export function recordStepUsage(usage: StepUsage, store?: EditorStore): void {
  getRunState(store).recordStep(usage)
}

export function resetRunSteps(store?: EditorStore): void {
  getRunState(store).resetSteps()
}

export function didHitStepLimit(store?: EditorStore): boolean {
  return getRunState(store).hitLimit()
}

export function clearToolLogEntries(store?: EditorStore): void {
  getRunState(store).clear()
}

export type ToolSetType = 'default' | 'pm'

export function createAITools(store: EditorStore, toolSet: ToolSetType = 'default') {
  let beforeSnapshot: Map<string, SceneNode> | null = null
  const runState = getRunState(store)

  const tools = toolSet === 'pm' ? PM_TOOLS : CORE_TOOLS

  return toolsToAI(
    tools,
    {
      getFigma: () => makeFigmaFromStore(store),
      onBeforeExecute: (def) => {
        if (def.mutates) {
          beforeSnapshot = store.snapshotPage()
        }
      },
      onAfterExecute: async (def) => {
        if (def.mutates) {
          const pageId = store.state.currentPageId
          const pageNode = store.graph.getNode(pageId)
          if (pageNode) {
            const fontKeys = collectFontKeys(store.graph, pageNode.childIds)
            const missing = fontKeys.filter(([family]) => !isFontLoaded(family))
            if (missing.length > 0) {
              const results = await Promise.all(
                missing.map(([family, style]) => loadFont(family, style))
              )
              if (results.some((r) => r !== null)) {
                for (const [, node] of store.graph.nodes) {
                  if (node.type === 'TEXT' && node.textPicture) node.textPicture = null
                }
              }
            }
          }
          computeAllLayouts(store.graph, pageId)
          store.requestRender()
          if (beforeSnapshot) {
            const before = beforeSnapshot
            const after = store.snapshotPage()
            store.pushUndoEntry({
              label: `AI: ${def.name}`,
              forward: () => store.restorePageFromSnapshot(after),
              inverse: () => store.restorePageFromSnapshot(before)
            })
            beforeSnapshot = null
          }
        }
      },
      onFlashNodes: (nodeIds) => {
        store.renderer?.aiClearActive()
        if (nodeIds.length > 0) {
          store.aiFlashDone(nodeIds)
        }
      },
      onToolLog: (entry) => {
        runState.toolLog.push(entry)
      },
      getStepBudget: (): StepBudget => ({
        current: runState.currentSteps,
        max: MAX_AGENT_STEPS
      })
    },
    { v, valibotSchema, tool }
  )
}

export type AITools = ReturnType<typeof createAITools>
