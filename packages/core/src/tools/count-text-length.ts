import { defineTool } from './schema'

export const countTextLengthTool = defineTool({
  name: 'count_text_length',
  description: 'Count the number of characters in text.',
  params: {
    text: {
      type: 'string',
      description: 'Text to count',
      required: true
    }
  },
  execute: (_figma, { text }) => {
    return { length: [...text].length }
  }
})
