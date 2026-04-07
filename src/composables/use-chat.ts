import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { Chat } from '@ai-sdk/vue'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { useLocalStorage } from '@vueuse/core'
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'
import { computed, shallowRef, watch, type Ref } from 'vue'

import { setDelegateSender } from '@/ai/delegate-bridge'
import SYSTEM_PROMPT from '@/ai/system-prompt.md?raw'
import {
  MAX_AGENT_STEPS,
  createAITools,
  recordStepUsage,
  resetRunSteps,
  type ToolSetType
} from '@/ai/tools'
import { useElectronBridge, type OpenPencilConfig } from '@/bridge/electron-bridge'
import { getActiveEditorStore } from '@/stores/editor'
import {
  ACP_AGENTS,
  AI_PROVIDERS,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  IS_BROWSER,
  IS_FROM_DAIMS,
  IS_TAURI,
  setPexelsApiKey,
  setUnsplashAccessKey
} from '@open-pencil/core'

import type { ACPAgentID, AIProviderID } from '@open-pencil/core'
import type { LanguageModel, UIMessage } from 'ai'

const STORAGE_PREFIX = 'open-pencil:'
const LEGACY_KEY_STORAGE = `${STORAGE_PREFIX}openrouter-api-key`

function keyStorageKey(id: string) {
  return `${STORAGE_PREFIX}ai-key:${id}`
}

function migrateLegacyStorage() {
  const legacyKey = localStorage.getItem(LEGACY_KEY_STORAGE)
  if (legacyKey) {
    localStorage.setItem(keyStorageKey('openrouter'), legacyKey)
    localStorage.removeItem(LEGACY_KEY_STORAGE)
    if (!localStorage.getItem(`${STORAGE_PREFIX}ai-provider`)) {
      localStorage.setItem(`${STORAGE_PREFIX}ai-provider`, 'openrouter')
    }
  }
}

if (IS_BROWSER) migrateLegacyStorage()

const providerID = useLocalStorage<AIProviderID>(
  `${STORAGE_PREFIX}ai-provider`,
  DEFAULT_AI_PROVIDER
)
const apiKeyStorageKey = computed(() => keyStorageKey(providerID.value))
const apiKey = useLocalStorage(apiKeyStorageKey, '')
const modelID = useLocalStorage(`${STORAGE_PREFIX}ai-model`, DEFAULT_AI_MODEL)
const customBaseURL = useLocalStorage(`${STORAGE_PREFIX}ai-base-url`, '')
const customModelID = useLocalStorage(`${STORAGE_PREFIX}ai-custom-model`, '')
const customAPIType = useLocalStorage<'completions' | 'responses'>(
  `${STORAGE_PREFIX}ai-api-type`,
  'completions'
)
const maxOutputTokens = useLocalStorage(`${STORAGE_PREFIX}ai-max-output-tokens`, 16384)
const pexelsApiKey = useLocalStorage(`${STORAGE_PREFIX}pexels-api-key`, '')
const unsplashAccessKey = useLocalStorage(`${STORAGE_PREFIX}unsplash-access-key`, '')

const providerDef = computed(
  () => AI_PROVIDERS.find((p) => p.id === providerID.value) ?? AI_PROVIDERS[0]
)

const isACPProvider = computed(() => providerID.value.startsWith('acp:'))

const isConfigured = computed(() => {
  if (isACPProvider.value) return IS_TAURI
  if (!apiKey.value) return false
  const needsBaseURL =
    providerID.value === 'openai-compatible' || providerID.value === 'anthropic-compatible'
  if (needsBaseURL && !customBaseURL.value) return false
  return true
})

export type ChatTabID = 'ai' | 'agent' | 'pm' | 'designer' | 'validator'

let transportDirty = false
let currentChatStore: ReturnType<typeof getActiveEditorStore> | null = null
let currentChatTab: ChatTabID | null = null
const chatMessages = new Map<string, UIMessage[]>()

const tabChatInstances = new Map<ChatTabID, Chat<UIMessage>>()

const tabChatRefs: Partial<Record<ChatTabID, Ref<Chat<UIMessage> | null>>> = {}

function getTabChatRef(tab: ChatTabID): Ref<Chat<UIMessage> | null> {
  if (!tabChatRefs[tab]) {
    tabChatRefs[tab] = shallowRef<Chat<UIMessage> | null>(null)
  }
  return tabChatRefs[tab]
}

function getChatMessageKey(store: ReturnType<typeof getActiveEditorStore>, tab: ChatTabID): string {
  return `${store.state.currentPageId}:${tab}`
}

function markTransportDirty() {
  transportDirty = true
  currentChatStore = null
  currentChatTab = null
  chatMessages.clear()
}

watch(
  pexelsApiKey,
  (key) => {
    setPexelsApiKey(key || null)
  },
  { immediate: true }
)

watch(
  unsplashAccessKey,
  (key) => {
    setUnsplashAccessKey(key || null)
  },
  { immediate: true }
)

watch(providerID, (id) => {
  const def = AI_PROVIDERS.find((p) => p.id === id)
  if (def?.defaultModel) {
    modelID.value = def.defaultModel
  }
  markTransportDirty()
})

watch(modelID, markTransportDirty)
watch(customModelID, markTransportDirty)
watch(customAPIType, markTransportDirty)
watch(apiKey, markTransportDirty)
watch(customBaseURL, markTransportDirty)

function applyExternalConfig(config: OpenPencilConfig) {
  providerID.value = config.providerID as AIProviderID
  apiKey.value = config.apiKey

  markTransportDirty()
}

let electronBridgeInitialized = false

async function initElectronConfig() {
  if (!IS_FROM_DAIMS || electronBridgeInitialized) return
  electronBridgeInitialized = true

  const { waitForExternalConfig } = useElectronBridge()

  try {
    const config = await waitForExternalConfig()
    applyExternalConfig(config)
    setAPIKey(config.apiKey)
  } catch (e) {
    console.error('[use-chat] Failed to get external config:', e)
  }
}

function setAPIKey(key: string) {
  apiKey.value = key
}

function createModel(): LanguageModel {
  const key = apiKey.value
  const needsCustomModel =
    providerID.value === 'openai-compatible' || providerID.value === 'anthropic-compatible'
  const effectiveModelID = needsCustomModel ? customModelID.value : modelID.value

  switch (providerID.value) {
    case 'openrouter': {
      const openrouter = createOpenRouter({
        apiKey: key,
        headers: {
          'X-OpenRouter-Title': 'OpenPencil',
          'HTTP-Referer': 'https://github.com/open-pencil/open-pencil'
        }
      })
      return openrouter(effectiveModelID)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: key })
      return anthropic(effectiveModelID)
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey: key })
      return openai(effectiveModelID)
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey: key })
      return google(effectiveModelID)
    }
    case 'zai': {
      const zai = createAnthropic({
        apiKey: key,
        baseURL: 'https://api.z.ai/api/anthropic'
      })
      return zai(effectiveModelID)
    }
    case 'minimax': {
      const minimax = createOpenAI({
        apiKey: key,
        baseURL: 'https://api.minimax.io/v1'
      })
      return minimax.chat(effectiveModelID)
    }
    case 'openai-compatible': {
      const custom = createOpenAI({
        apiKey: key,
        baseURL: customBaseURL.value
      })
      return customAPIType.value === 'responses'
        ? custom.responses(effectiveModelID)
        : custom.chat(effectiveModelID)
    }
    case 'anthropic-compatible': {
      const custom = createAnthropic({
        apiKey: key,
        baseURL: customBaseURL.value
      })
      return custom(effectiveModelID)
    }
    default: {
      if (providerID.value.startsWith('acp:')) {
        throw new Error('ACP providers do not use direct API models')
      }
      throw new Error(`Unknown provider: ${providerID.value}`)
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only mock transports don't implement full generics
let overrideTransport: (() => any) | null = null

let chat: Chat<UIMessage> | null = null

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const

function supportsAnthropicCaching(): boolean {
  return (
    providerID.value === 'anthropic' ||
    providerID.value === 'anthropic-compatible' ||
    (providerID.value === 'openrouter' && modelID.value.startsWith('anthropic/'))
  )
}

let acpTransportInstance: { destroy(): Promise<void> } | null = null

async function createACPTransport() {
  const agentId = providerID.value.replace('acp:', '') as ACPAgentID
  const agentDef = ACP_AGENTS.find((a) => a.id === agentId)
  if (!agentDef) throw new Error(`Unknown ACP agent: ${agentId}`)

  const { ACPChatTransport } = await import('@/ai/acp-transport')
  const { homeDir } = await import('@tauri-apps/api/path')
  await acpTransportInstance?.destroy()
  const transport = new ACPChatTransport({ agentDef, cwd: await homeDir() })
  acpTransportInstance = transport
  return transport
}

function getAgentInstructions(store: ReturnType<typeof getActiveEditorStore>) {
  return store.state.activeRibbonTab === 'designer' ? SYSTEM_PROMPT : undefined
}

function getToolSetForTab(tab: ChatTabID): ToolSetType {
  return tab === 'pm' ? 'pm' : 'default'
}

function createTransport(store: ReturnType<typeof getActiveEditorStore>, tab: ChatTabID = 'ai') {
  if (overrideTransport) return overrideTransport()

  void acpTransportInstance?.destroy()
  acpTransportInstance = null

  const toolSet = getToolSetForTab(tab)
  const tools = createAITools(store, toolSet)
  const cacheProviderOptions = supportsAnthropicCaching() ? ANTHROPIC_CACHE_CONTROL : undefined

  const instructions = getAgentInstructions(store)

  const agent = new ToolLoopAgent({
    model: createModel(),
    instructions,
    tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    maxOutputTokens: maxOutputTokens.value,
    providerOptions: cacheProviderOptions,
    prepareCall: (options) => {
      resetRunSteps(store)
      return {
        ...options,
        maxOutputTokens: maxOutputTokens.value,
        providerOptions: cacheProviderOptions
      }
    },
    onStepFinish: ({ usage }) => {
      recordStepUsage(
        {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
          timestamp: Date.now()
        },
        store
      )
    }
  })

  return new DirectChatTransport({ agent })
}

async function ensureChat(tab: ChatTabID): Promise<Chat<UIMessage> | null> {
  if (!isConfigured.value) return null

  const store = getActiveEditorStore()
  const messageKey = getChatMessageKey(store, tab)

  if (currentChatStore && chat && currentChatTab) {
    const oldKey = getChatMessageKey(currentChatStore, currentChatTab)
    chatMessages.set(oldKey, chat.messages)
  }

  const needsNewChat =
    !chat || transportDirty || currentChatStore !== store || currentChatTab !== tab

  if (needsNewChat) {
    const existing = tabChatInstances.get(tab)
    if (existing && !transportDirty) {
      chat = existing
    } else {
      const messages = chatMessages.get(messageKey) ?? []
      const transport = isACPProvider.value
        ? await createACPTransport()
        : createTransport(store, tab)
      chat = new Chat<UIMessage>({ transport, messages })
      tabChatInstances.set(tab, chat)
      getTabChatRef(tab).value = chat
    }
    currentChatStore = store
    currentChatTab = tab
    transportDirty = false
  }
  return chat
}

function getTabChat(tab: ChatTabID): Chat<UIMessage> | null {
  return tabChatInstances.get(tab) ?? null
}

function useTabChat(tab: ChatTabID) {
  return getTabChatRef(tab)
}

function resetChat() {
  if (currentChatStore && currentChatTab) {
    const key = getChatMessageKey(currentChatStore, currentChatTab)
    chatMessages.delete(key)
  }
  chat = null
  currentChatStore = null
  currentChatTab = null
  transportDirty = false
}

function resetTabChat(tab: ChatTabID) {
  if (currentChatStore) {
    const key = getChatMessageKey(currentChatStore, tab)
    chatMessages.delete(key)
  }
  tabChatInstances.delete(tab)
  if (tabChatRefs[tab]) {
    tabChatRefs[tab].value = null
  }
  if (currentChatTab === tab) {
    chat = null
    currentChatTab = null
  }
  transportDirty = true
}

export type AgentID = 'designer' | 'validator'

export interface AgentResponse {
  success: boolean
  result?: string
  error?: string
}

function agentIdToTab(agentId: AgentID): ChatTabID {
  return agentId
}

async function sendMessageToAgent(agentId: AgentID, message: string): Promise<AgentResponse> {
  if (!isConfigured.value) {
    return { success: false, error: 'AI provider not configured' }
  }

  try {
    const tab = agentIdToTab(agentId)
    const agentChat = await ensureChat(tab)

    if (!agentChat) {
      return { success: false, error: 'Failed to create agent chat' }
    }

    await agentChat.sendMessage({ text: message })

    await new Promise<void>((resolve, reject) => {
      const checkStatus = () => {
        if (agentChat.status === 'ready') {
          resolve()
        } else if (agentChat.status === 'error') {
          reject(new Error('Agent chat error'))
        } else {
          setTimeout(checkStatus, 100)
        }
      }
      checkStatus()
    })

    const messages = agentChat.messages
    if (messages.length === 0) {
      return { success: true, result: 'Agent completed' }
    }

    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role === 'assistant') {
      const textParts = lastMessage.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')

      return { success: true, result: textParts || 'Agent completed without text response' }
    }

    return { success: true, result: 'Agent completed' }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e)
    console.error(`[sendMessageToAgent] Error sending to ${agentId}:`, e)
    return { success: false, error: errorMsg }
  }
}

export { sendMessageToAgent, getTabChat, useTabChat }

setDelegateSender(sendMessageToAgent)

if (IS_BROWSER) {
  window.__OPEN_PENCIL_SET_TRANSPORT__ = (factory) => {
    overrideTransport = factory
  }
}

export function useAIChat() {
  if (IS_FROM_DAIMS) {
    void initElectronConfig()
  }

  return {
    providerID,
    providerDef,
    apiKey,
    setAPIKey,
    modelID,
    customBaseURL,
    customModelID,
    customAPIType,
    maxOutputTokens,
    pexelsApiKey,
    unsplashAccessKey,
    isConfigured,
    ensureChat,
    resetChat
  }
}

export { resetTabChat }
