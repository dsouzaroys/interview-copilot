import { GoogleGenAI, Content, Part, FunctionCall, FunctionCallingConfigMode } from '@google/genai';
import { env } from '../config/env';
import { toolDeclarations } from './tools';
import { buildSystemPrompt, PromptContext } from './prompts';
import { dispatchTool } from './tool-handlers';
import { getMessages, saveMessages, getSessionMeta } from '../memory/short-term';

const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

const MAX_LOOP_ITERATIONS = 10;
const MODEL = 'gemini-2.5-flash';

export interface AgentLoopResult {
  reply: string;
  toolsUsed: string[];
  iterationCount: number;
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

export async function agentLoop(
  sessionId: string,
  userMessage: string
): Promise<AgentLoopResult> {
  // Load existing conversation history from Redis (Content[] format)
  const storedMessages = await getMessages(sessionId);
  const sessionMeta = await getSessionMeta(sessionId);

  // Build dynamic system prompt with candidate profile
  const promptContext: PromptContext = {
    weakAreas: sessionMeta?.weakAreas ?? [],
    strongAreas: sessionMeta?.strongAreas ?? [],
    avgScore: sessionMeta?.avgScore ?? 0,
    questionsAsked: sessionMeta?.questionsAsked ?? 0,
    difficulty: sessionMeta?.difficulty ?? 'easy',
    interviewType: sessionMeta?.interviewType ?? 'backend',
  };

  const systemInstruction = buildSystemPrompt(promptContext);

  // Build live conversation history
  const history: Content[] = [...storedMessages];

  // Append new user message
  history.push({ role: 'user', parts: [{ text: userMessage }] });

  const toolsUsed: string[] = [];
  let iterationCount = 0;

  // ─── Agentic While-Loop ───────────────────────────────────────────────────
  while (iterationCount < MAX_LOOP_ITERATIONS) {
    iterationCount++;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: history,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: toolDeclarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content) {
      throw new Error('Gemini returned no candidate content');
    }

    const responseContent = candidate.content;

    // ── Function Call Branch ──────────────────────────────────────────────
    const functionCallParts = (responseContent.parts ?? []).filter(
      (p): p is Part & { functionCall: FunctionCall } => !!p.functionCall
    );

    if (functionCallParts.length > 0) {
      // Add model's function-call turn to history
      history.push(responseContent);

      // Execute ALL function calls in parallel
      const functionResponseParts: Part[] = await Promise.all(
        functionCallParts.map(async (part) => {
          const { name, args } = part.functionCall;
          toolsUsed.push(name ?? 'unknown');

          let toolResult: unknown;
          try {
            toolResult = await dispatchTool(
              sessionId,
              name ?? '',
              (args ?? {}) as Record<string, unknown>
            );
          } catch (err) {
            toolResult = {
              error: err instanceof Error ? err.message : 'Tool execution failed',
            };
          }

          return {
            functionResponse: {
              name: name ?? '',
              response: toolResult as Record<string, unknown>,
            },
          } satisfies Part;
        })
      );

      // Function responses go back as 'user' role (Gemini's protocol)
      history.push({ role: 'user', parts: functionResponseParts });

      continue; // Let Gemini process tool results
    }

    // ── Text Response Branch ──────────────────────────────────────────────
    const textPart = (responseContent.parts ?? []).find((p): p is Part => !!p.text);
    const reply =
      textPart?.text ??
      "I had trouble generating a response. Let's continue — please repeat your answer.";

    // Add final model turn to history
    history.push(responseContent);

    // Persist updated conversation to Redis
    await saveMessages(sessionId, history);

    return { reply, toolsUsed, iterationCount };
  }

  throw new Error(
    `Agent loop exceeded ${MAX_LOOP_ITERATIONS} iterations — possible infinite loop`
  );
}
