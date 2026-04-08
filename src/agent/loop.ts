import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { tools } from './tools';
import { buildSystemPrompt, PromptContext } from './prompts';
import { dispatchTool } from './tool-handlers';
import { getMessages, saveMessages, getSessionMeta } from '../memory/short-term';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const MAX_LOOP_ITERATIONS = 10; // Safety limit

export interface AgentLoopResult {
  reply: string;
  toolsUsed: string[];
  iterationCount: number;
}

export async function agentLoop(
  sessionId: string,
  userMessage: string
): Promise<AgentLoopResult> {
  // Load existing conversation history from Redis
  const messages = await getMessages(sessionId);
  const sessionMeta = await getSessionMeta(sessionId);

  // Append the new user message
  messages.push({ role: 'user', content: userMessage });

  // Build dynamic system prompt injecting current candidate profile
  const promptContext: PromptContext = {
    weakAreas: sessionMeta?.weakAreas ?? [],
    strongAreas: sessionMeta?.strongAreas ?? [],
    avgScore: sessionMeta?.avgScore ?? 0,
    questionsAsked: sessionMeta?.questionsAsked ?? 0,
    difficulty: sessionMeta?.difficulty ?? 'easy',
    interviewType: sessionMeta?.interviewType ?? 'backend',
  };

  const systemPrompt = buildSystemPrompt(promptContext);
  const toolsUsed: string[] = [];
  let iterationCount = 0;

  // ─── Agentic While-Loop ──────────────────────────────────────────────────────
  while (iterationCount < MAX_LOOP_ITERATIONS) {
    iterationCount++;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    // ── Tool Use branch ─────────────────────────────────────────────────────
    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      // Execute ALL tool calls in PARALLEL
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (toolBlock) => {
          toolsUsed.push(toolBlock.name);

          let result: unknown;
          try {
            result = await dispatchTool(
              sessionId,
              toolBlock.name,
              toolBlock.input as Record<string, unknown>
            );
          } catch (err) {
            result = {
              error: err instanceof Error ? err.message : 'Tool execution failed',
            };
          }

          return {
            type: 'tool_result' as const,
            tool_use_id: toolBlock.id,
            content: JSON.stringify(result),
          };
        })
      );

      // Append assistant message (MUST include tool_use blocks)
      messages.push({ role: 'assistant', content: response.content });

      // Append tool results in a USER message — Anthropic's required format
      messages.push({ role: 'user', content: toolResults });

      continue; // Loop back to next Claude call
    }

    // ── End Turn branch ─────────────────────────────────────────────────────
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );

      const reply =
        textBlock?.text ??
        "I had an issue generating a response. Let's continue — please repeat your answer.";

      // Append the final assistant reply
      messages.push({ role: 'assistant', content: reply });

      // Persist updated conversation to Redis
      await saveMessages(sessionId, messages);

      return { reply, toolsUsed, iterationCount };
    }

    // ── Safety: unexpected stop reason ─────────────────────────────────────
    throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
  }

  throw new Error(`Agent loop exceeded ${MAX_LOOP_ITERATIONS} iterations — possible infinite loop`);
}
