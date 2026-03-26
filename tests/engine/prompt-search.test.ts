import { describe, it, expect } from 'bun:test'
import { DaimsClient } from 'prompt-searcher'

describe('Prompt Search Tool', () => {
  it('should export searchPrompts, getPrompt, searchAndApplyPrompt', async () => {
    const { searchPrompts, getPrompt, searchAndApplyPrompt } = await import(
      '../../packages/core/src/tools/prompt-search'
    )

    expect(searchPrompts).toBeDefined()
    expect(getPrompt).toBeDefined()
    expect(searchAndApplyPrompt).toBeDefined()

    expect(searchPrompts.name).toBe('search_prompts')
    expect(getPrompt.name).toBe('get_prompt')
    expect(searchAndApplyPrompt.name).toBe('search_and_apply_prompt')
  })

  it('should search prompts using DaimsClient', async () => {
    const client = new DaimsClient()

    const result = await client.search({
      card_type: 'create',
      search_type: 'keyword',
      value: 'Cinematic'
    })

    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data.items).toBeInstanceOf(Array)
  })

  it('should fetch prompt by card key', async () => {
    const client = new DaimsClient()

    // First search to get a card key
    const searchResult = await client.search({
      card_type: 'create',
      search_type: 'keyword',
      value: 'Cinematic'
    })

    if (searchResult.success && searchResult.data.items.length > 0) {
      const cardKey = searchResult.data.items[0].metadata.key
      const promptResult = await client.getPrompt(cardKey)

      expect(promptResult.success).toBe(true)
      expect(promptResult.prompt).toBeDefined()
      expect(typeof promptResult.prompt).toBe('string')
      expect(promptResult.prompt.length).toBeGreaterThan(0)
    }
  })
})
