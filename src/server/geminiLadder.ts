/**
 * Sentinel AI — Shared Gemini Model Ladder Helper
 * Conforms to Custom Instructions §6 (Functional Stability) & §10 (Data Handling).
 *
 * Implements a fallback ladder across current Gemini Flash models:
 *   1. gemini-3.8-flash
 *   2. gemini-flash-latest
 *   3. gemini-3.1-flash-lite
 *
 * Automatically falls through on 429, 404, 500, 503, or other transient errors.
 * When all models in the ladder are rate-limited, throws a GeminiRateLimitError
 * with the plain user-facing message while keeping raw errors in server logs only.
 */

import { GoogleGenAI } from '@google/genai';

export const VERTEX_AI_MODEL_LADDER = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
] as const;

export const GEMINI_API_MODEL_LADDER = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
] as const;

export const MODEL_LADDER = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
] as const;

export type GeminiFlashModel = (typeof MODEL_LADDER)[number];

export const RATE_LIMIT_MESSAGE = 'AI features are temporarily rate-limited. Please try again later.';

export class GeminiRateLimitError extends Error {
  public readonly isRateLimit = true;
  public readonly rawErrors: Array<{ model: string; message: string; status?: number }>;

  constructor(message: string = RATE_LIMIT_MESSAGE, rawErrors: Array<{ model: string; message: string; status?: number }> = []) {
    super(message);
    this.name = 'GeminiRateLimitError';
    this.rawErrors = rawErrors;
  }
}

/**
 * Checks if an error is a Gemini API rate limit or quota exhaustion (HTTP 429 / RESOURCE_EXHAUSTED).
 */
export function isRateLimitError(err: any): boolean {
  if (!err) return false;
  if (err.isRateLimit) return true;
  if (err.status === 429 || err.code === 429) return true;
  if (err.status === 503 || err.code === 503) return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('rate-limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests')
  );
}

export interface GeminiLadderCallOptions {
  taskName: string;
  contents: any;
  config?: any;
  timeoutMs?: number;
}

export interface GeminiLadderCallResult {
  text: string;
  modelUsed: string;
}

let sharedAiClient: GoogleGenAI | null = null;

export function isUsingVertexAi(): boolean {
  const val = process.env.GOOGLE_GENAI_USE_VERTEXAI;
  return val === 'true' || val === '1';
}

export function isGeminiAvailable(): boolean {
  if (isUsingVertexAi()) {
    return Boolean(process.env.GOOGLE_CLOUD_PROJECT);
  }
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

export function getSharedGeminiClient(): GoogleGenAI {
  if (sharedAiClient) {
    return sharedAiClient;
  }

  // When GOOGLE_GENAI_USE_VERTEXAI is true, use Vertex AI with runtime service account (no API key)
  if (isUsingVertexAi()) {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    if (!project) {
      throw new Error('GOOGLE_CLOUD_PROJECT is required when GOOGLE_GENAI_USE_VERTEXAI is true.');
    }
    console.log(`[GeminiLadder] Initializing Gemini SDK on Vertex AI (project=${project}, location=${location}) via runtime service account (no API key).`);
    sharedAiClient = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
    return sharedAiClient;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the environment.');
  }
  sharedAiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
  return sharedAiClient;
}

/**
 * Executes a Gemini prompt through the fallback ladder of Gemini Flash models.
 * Automatically catches 429 / 404 / 500 / 503 and attempts the next model.
 * If all ladder models are exhausted due to rate limits, throws a GeminiRateLimitError.
 * Full raw Google errors are preserved strictly in server logs.
 */
export async function callGeminiWithLadder(
  options: GeminiLadderCallOptions
): Promise<GeminiLadderCallResult> {
  const { taskName, contents, config, timeoutMs } = options;
  const ai = getSharedGeminiClient();

  const attemptErrors: Array<{ model: string; message: string; status?: number; raw: any }> = [];

  const normalizedContents =
    typeof contents === 'string'
      ? [{ role: 'user', parts: [{ text: contents }] }]
      : contents;

  const activeLadder = isUsingVertexAi() ? VERTEX_AI_MODEL_LADDER : GEMINI_API_MODEL_LADDER;

  for (const model of activeLadder) {
    try {
      console.log(`[GeminiLadder] Attempting task "${taskName}" with model "${model}" (${isUsingVertexAi() ? 'Vertex AI' : 'Gemini Developer API'})...`);

      const callPromise = ai.models.generateContent({
        model,
        contents: normalizedContents,
        ...(config ? { config } : {})
      });

      let response: any;
      if (timeoutMs && timeoutMs > 0) {
        let timer: any;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Call timed out after ${timeoutMs}ms on model ${model}`));
          }, timeoutMs);
        });

        try {
          response = await Promise.race([callPromise, timeoutPromise]);
        } finally {
          clearTimeout(timer);
        }
      } else {
        response = await callPromise;
      }

      const text = response?.text?.trim();
      if (text !== undefined && text !== null) {
        console.log(`[GeminiLadder] Task "${taskName}" succeeded with model "${model}".`);
        return {
          text,
          modelUsed: model
        };
      } else {
        throw new Error(`Empty response received from model ${model}`);
      }
    } catch (modelErr: any) {
      const status = modelErr?.status || modelErr?.code;
      const rawMessage = modelErr?.message || String(modelErr);
      attemptErrors.push({
        model,
        message: rawMessage,
        status,
        raw: modelErr
      });

      console.warn(
        `[GeminiLadder] Model "${model}" failed for task "${taskName}" (Status: ${status || 'unknown'}): ${rawMessage}`
      );
      // Advance to next model in the ladder
    }
  }

  // All models in the ladder failed. Check if rate-limited or capacity-exhausted:
  const hadRateLimit = attemptErrors.some((e) => isRateLimitError(e.raw));

  if (hadRateLimit) {
    console.warn(
      `[GeminiLadder] Task "${taskName}" transiently rate-limited/unavailable across ladder models [${activeLadder.join(', ')}]. Engaging deterministic fallback.`
    );
    throw new GeminiRateLimitError(RATE_LIMIT_MESSAGE, attemptErrors);
  }

  // Non-rate-limit unexpected error: log full raw error in server logs only per Item 4
  console.error(
    `[GeminiLadder] Task "${taskName}" failed across all ladder models [${activeLadder.join(', ')}].`,
    'Server-side error details:',
    JSON.stringify(
      attemptErrors.map((e) => ({
        model: e.model,
        status: e.status,
        message: e.message
      })),
      null,
      2
    )
  );

  // Generic sanitized failure (never leaking Google raw internals to caller)
  throw new Error(`AI processing failed for ${taskName}. Please try again later.`);
}
