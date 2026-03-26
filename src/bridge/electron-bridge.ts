import { ref, readonly } from 'vue'

import { IS_FROM_DAIMS } from '@open-pencil/core'

export interface OpenPencilConfig {
  providerID: string
  apiKey: string
}

const externalConfig = ref<OpenPencilConfig | null>(null)
const configReceived = ref(false)

let configResolvers: Array<(config: OpenPencilConfig) => void> = []

function initElectronBridge() {
  if (!IS_FROM_DAIMS) return

  const bridge = (window as Window & { openPencilBridge?: typeof window.openPencilBridge }).openPencilBridge
  if (!bridge) {
    console.warn('[electron-bridge] openPencilBridge not found')
    return
  }

  bridge.onConfig((config) => {
    externalConfig.value = config
    configReceived.value = true

    configResolvers.forEach((resolve) => resolve(config))
    configResolvers = []
  })
}

export function waitForExternalConfig(): Promise<OpenPencilConfig> {
  if (externalConfig.value) {
    return Promise.resolve(externalConfig.value)
  }

  return new Promise((resolve) => {
    configResolvers.push(resolve)
  })
}

export function useElectronBridge() {
  return {
    externalConfig: readonly(externalConfig),
    configReceived: readonly(configReceived),
    waitForExternalConfig,
  }
}

declare global {
  interface Window {
    openPencilBridge?: {
      waitForConfig(): Promise<OpenPencilConfig>
      onConfig(callback: (config: OpenPencilConfig) => void): () => void
      sendMessage(data: unknown): void
    }
  }
}

if (IS_FROM_DAIMS) {
  initElectronBridge()
}
