/**
 * Sentinel AI — Pub/Sub Authentication & Push Handler
 * Enforces fail-closed token verification, case-insensitive APP_MODE normalization,
 * and strict validation of audience, service account email, and email_verified.
 */

import { OAuth2Client } from 'google-auth-library';
import type { Request, Response } from 'express';

export type AppMode = 'preview' | 'production';

/**
 * Validates and normalizes APP_MODE case-insensitively.
 * Accepts only "preview" or "production" (case-insensitive).
 * Defaults to "preview" when unset or empty.
 * Throws an error on any other value.
 */
export function parseAppMode(raw?: string): AppMode {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return 'preview';
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'preview') {
    return 'preview';
  }
  if (normalized === 'production') {
    return 'production';
  }
  throw new Error(`Fatal: Invalid APP_MODE "${raw}". APP_MODE must be either "preview" or "production" (case-insensitive).`);
}

export interface PubSubAuthConfig {
  appMode: AppMode;
  audience?: string;
  expectedSaEmail?: string;
}

export interface VerificationResult {
  ok: boolean;
  statusCode: number;
  error?: string;
  payload?: any;
}

/**
 * Verifies the incoming Pub/Sub push request according to environment and mode:
 * 1. In PREVIEW: Returns 404 (preview injects events directly through Firestore; push is disabled).
 * 2. In PRODUCTION:
 *    - Rejects with 500 if PUBSUB_PUSH_AUDIENCE or PUBSUB_PUSH_SA is missing.
 *    - Rejects with 401 if Authorization header is missing, malformed, or has empty token.
 *    - Verifies ID token signature and audience using OAuth2Client.
 *    - Rejects with 401 if payload is empty or email_verified !== true.
 *    - Rejects with 401 if payload.email !== PUBSUB_PUSH_SA.
 */
export async function verifyPubSubPushAuth(
  headers: Record<string, string | string[] | undefined>,
  config: PubSubAuthConfig,
  oauthClient: OAuth2Client = new OAuth2Client()
): Promise<VerificationResult> {
  // 1. In PREVIEW, endpoint must never skip verification; returns 404
  if (config.appMode === 'preview') {
    return {
      ok: false,
      statusCode: 404,
      error: 'Not Found: Pub/Sub push endpoint is disabled in PREVIEW mode.'
    };
  }

  // 2. In PRODUCTION, configuration must be present
  const audience = config.audience?.trim();
  const expectedSa = config.expectedSaEmail?.trim();

  if (!audience || !expectedSa) {
    return {
      ok: false,
      statusCode: 500,
      error: 'Server Configuration Error: Both PUBSUB_PUSH_AUDIENCE and PUBSUB_PUSH_SA are required in PRODUCTION mode.'
    };
  }

  // 3. Check Authorization header
  const authHeader = (headers['authorization'] || headers['Authorization']) as string | undefined;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Unauthorized: Missing or invalid Pub/Sub Bearer token.'
    };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Unauthorized: Empty Pub/Sub Bearer token.'
    };
  }

  // 4. Verify OIDC ID Token with Google OAuth2Client
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: token,
      audience
    });
    const payload = ticket.getPayload();

    if (!payload) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Unauthorized: Empty token payload.'
      };
    }

    if (payload.email_verified !== true) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Unauthorized: Service account email is not verified.'
      };
    }

    if (payload.email !== expectedSa) {
      return {
        ok: false,
        statusCode: 401,
        error: `Unauthorized: Service account token mismatch (expected ${expectedSa}).`
      };
    }

    return {
      ok: true,
      statusCode: 200,
      payload
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: 401,
      error: `Unauthorized: OIDC verification failed: ${(err as Error).message}`
    };
  }
}
