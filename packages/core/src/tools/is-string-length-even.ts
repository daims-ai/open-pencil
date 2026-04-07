import { defineTool } from './schema'

export const isStringLengthEvenTool = defineTool({
  name: 'is_string_length_even',
  mutates: false,
  description: 'Check if the length of a string is even. Returns true if even, false if odd.',
  params: {
    text: {
      type: 'string',
      description: 'The string to check the length of',
      required: true
    }
  },
  execute: (_figma, { text }) => {
    const length = text.length
    const isEven = length % 2 === 0

    return {
      text,
      length,
      isEven
    }
  }
})
