import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { generateText } from 'ai';

const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const SYSTEM_PROMPT = `You are a task extractor. The user describes things they need to do in natural language.
Break the input into separate, individual tasks — one per line.
Each task should be a clear, concise 1-2 line action item. Be direct and actionable.
No dates, priorities, categories, or bullet points/numbering. Just the task text, one per line.
If the input only describes one thing, return one line.

IMPORTANT: If the input does not contain any actionable tasks or to-dos (e.g. greetings, questions, gibberish, casual chat), respond with exactly: NO_TASKS`;

let apiKey = '';

export function initClient(key: string): void {
  apiKey = key;
}

export async function generateTasks(input: string): Promise<string[]> {
  if (!apiKey) throw new Error('API key not set');

  const bedrock = createAmazonBedrock({
    region: 'us-east-1',
    apiKey,
  });

  const { text } = await generateText({
    model: bedrock(MODEL_ID),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: input }],
    maxOutputTokens: 300,
  });

  const trimmed = text.trim();

  if (trimmed === 'NO_TASKS' || trimmed.startsWith('NO_TASKS')) {
    throw new Error('Say something actionable to create a task — like "buy groceries" or "fix the login bug".');
  }

  return trimmed
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean);
}
