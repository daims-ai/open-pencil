import { DaimsClient } from 'prompt-searcher'

import { defineTool } from './schema'

const client = new DaimsClient()

export interface PromptSearchResult {
  success: boolean
  items?: Array<{
    id: string
    metadata: {
      key: string
      provider: string
      directory: string
      model: string
      type: string
      maker: string
      refs: string
      uid: string
    }
    references: string[]
  }>
  error?: string
}

export interface PromptFetchResult {
  success: boolean
  prompt?: string
  skey?: string
  error?: string
}

export const searchPrompts = defineTool({
  name: 'search_prompts',
  description:
    'Search for AI design prompts using keyword, style, or object type. Returns a list of matching prompts with their metadata. Use get_prompt to fetch the full prompt content by card key (metadata.key).',
  params: {
    value: {
      type: 'string',
      description: 'Search keyword (e.g., "Cinematic", "Mobile App", "Landing Page")',
      required: true
    },
    search_type: {
      type: 'string',
      description:
        'Search type: "keyword" for text search, "style" for style matching, "object" for object-based search',
      enum: ['keyword', 'style', 'object'],
      default: 'keyword'
    },
    card_type: {
      type: 'string',
      description: 'Filter by card type: "create" for creation prompts, "edit" for editing prompts',
      enum: ['create', 'edit'],
      default: 'create'
    },
    limit: {
      type: 'number',
      description: 'Maximum number of results to return (default: 20)',
      default: 20
    }
  },
  execute: async (_figma, { value, search_type, card_type, limit }) => {
    try {
      const list = await client.search({
        card_type: (card_type ?? 'create') as 'create' | 'edit',
        search_type: (search_type ?? 'keyword') as 'keyword' | 'style' | 'object',
        value
      })

      if (!list.success) {
        return {
          success: false,
          error: 'Search failed',
          count: 0,
          items: []
        }
      }

      const items = list.data.items
      const limitedItems = items.slice(0, limit ?? 20)

      return {
        success: true,
        count: limitedItems.length,
        total: list.data.count,
        hasNext: list.data.hasNext,
        search_type,
        card_type,
        value,
        items: limitedItems.map((item) => ({
          id: item.id,
          metadata: item.metadata,
          references: item.references
        }))
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        count: 0,
        items: []
      }
    }
  }
})

export const getPrompt = defineTool({
  name: 'get_prompt',
  description:
    'Fetch the full prompt content by card key (metadata.key from search_prompts results).',
  params: {
    skey: {
      type: 'string',
      description: 'The card key (metadata.key) from search_prompts results',
      required: true
    }
  },
  execute: async (_figma, { skey }) => {
    try {
      const result = await client.getPrompt(skey)

      if (!result.success) {
        return {
          success: false,
          error: 'Failed to fetch prompt',
          skey
        }
      }

      return {
        success: true,
        skey,
        prompt: result.prompt
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        skey
      }
    }
  }
})

export const searchAndApplyPrompt = defineTool({
  name: 'search_and_apply_prompt',
  mutates: true,
  description:
    'Search for prompts and apply the first result directly. Combines search_prompts and get_prompt into one step. Returns the prompt text and search metadata.',
  params: {
    value: {
      type: 'string',
      description: 'Search keyword (e.g., "Cinematic", "Mobile App Dashboard")',
      required: true
    },
    card_type: {
      type: 'string',
      description: 'Filter by card type: "create" or "edit"',
      enum: ['create', 'edit'],
      default: 'create'
    }
  },
  execute: async (_figma, { value, card_type }) => {
    try {
      // Search
      const searchResult = await client.search({
        card_type: (card_type ?? 'create') as 'create' | 'edit',
        search_type: 'keyword',
        value
      })

      if (!searchResult.success || searchResult.data.items.length === 0) {
        return {
          success: false,
          error: 'No prompts found for the search query',
          value,
          card_type
        }
      }

      const firstItem = searchResult.data.items[0]
      const cardKey = firstItem.metadata.key

      // Fetch full prompt
      const promptResult = await client.getPrompt(cardKey)

      if (!promptResult.success) {
        return {
          success: false,
          error: 'Found prompts but failed to fetch the prompt content',
          value,
          card_type,
          searchResults: searchResult.data.items.slice(0, 5).map((item) => ({
            id: item.id,
            key: item.metadata.key,
            type: item.metadata.type
          }))
        }
      }

      return {
        success: true,
        value,
        card_type,
        prompt: promptResult.prompt,
        selectedPrompt: {
          id: firstItem.id,
          key: cardKey,
          metadata: firstItem.metadata,
          references: firstItem.references
        },
        otherResults: searchResult.data.items.slice(1, 5).map((item) => ({
          id: item.id,
          key: item.metadata.key,
          type: item.metadata.type
        }))
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        value,
        card_type
      }
    }
  }
})
