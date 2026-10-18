/**
 * Unit Tests for Pub/Sub Push Authentication & APP_MODE Normalization
 * Tests:
 * 1. APP_MODE parsing: lowercase, uppercase, mixed-case, undefined fallback, and invalid values (refusal to start).
 * 2. PREVIEW mode: endpoint returns 404 immediately.
 * 3. PRODUCTION mode with unset configuration (missing audience or missing SA email): rejected.
 * 4. PRODUCTION mode with missing token (no header, non-Bearer, empty token): rejected with 401.
 * 5. PRODUCTION mode with wrong audience: rejected with 401.
 * 6. PRODUCTION mode with wrong email: rejected with 401.
 * 7. PRODUCTION mode with unverified email: rejected with 401.
 * 8. PRODUCTION mode with valid token, matching audience, matching SA email and email_verified=true: accepted (200).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppMode, verifyPubSubPushAuth, PubSubAuthConfig } from './pubsubHandler.js';
import { OAuth2Client } from 'google-auth-library';

describe('1. APP_MODE Normalization & Validation', () => {
  test('accepts lowercase "preview"', () => {
    assert.equal(parseAppMode('preview'), 'preview');
  });

  test('accepts uppercase "PREVIEW"', () => {
    assert.equal(parseAppMode('PREVIEW'), 'preview');
  });

  test('accepts mixed-case "Preview"', () => {
    assert.equal(parseAppMode('Preview'), 'preview');
  });

  test('accepts lowercase "production"', () => {
    assert.equal(parseAppMode('production'), 'production');
  });

  test('accepts uppercase "PRODUCTION"', () => {
    assert.equal(parseAppMode('PRODUCTION'), 'production');
  });

  test('accepts mixed-case "Production"', () => {
    assert.equal(parseAppMode('Production'), 'production');
  });

  test('falls back to "preview" when unset or empty', () => {
    assert.equal(parseAppMode(undefined), 'preview');
    assert.equal(parseAppMode(''), 'preview');
    assert.equal(parseAppMode('   '), 'preview');
  });

  test('refuses to start on invalid values (throws error)', () => {
    assert.throws(() => parseAppMode('staging'), /Invalid APP_MODE "staging"/);
    assert.throws(() => parseAppMode('sandbox'), /Invalid APP_MODE "sandbox"/);
    assert.throws(() => parseAppMode('development'), /Invalid APP_MODE "development"/);
  });
});

describe('2. Pub/Sub Push Auth in PREVIEW mode', () => {
  test('returns 404 in PREVIEW mode, never skipping verification or exposing endpoint', async () => {
    const config: PubSubAuthConfig = {
      appMode: 'preview',
      audience: 'https://example.com/api/events/registry',
      expectedSaEmail: 'pubsub-invoker@sentinel-ai-511412.iam.gserviceaccount.com'
    };

    const res = await verifyPubSubPushAuth({ authorization: 'Bearer some-token' }, config);
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 404);
    assert.match(res.error || '', /disabled in PREVIEW mode/);
  });
});

describe('3. Pub/Sub Push Auth in PRODUCTION mode: Unset Configuration', () => {
  test('rejects when PUBSUB_PUSH_AUDIENCE is missing', async () => {
    const config: PubSubAuthConfig = {
      appMode: 'production',
      audience: undefined,
      expectedSaEmail: 'pubsub-invoker@sentinel-ai-511412.iam.gserviceaccount.com'
    };

    const res = await verifyPubSubPushAuth({ authorization: 'Bearer some-token' }, config);
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 500);
    assert.match(res.error || '', /Both PUBSUB_PUSH_AUDIENCE and PUBSUB_PUSH_SA are required/);
  });

  test('rejects when PUBSUB_PUSH_SA is missing', async () => {
    const config: PubSubAuthConfig = {
      appMode: 'production',
      audience: 'https://sentinel.internal/api/events/registry',
      expectedSaEmail: undefined
    };

    const res = await verifyPubSubPushAuth({ authorization: 'Bearer some-token' }, config);
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 500);
    assert.match(res.error || '', /Both PUBSUB_PUSH_AUDIENCE and PUBSUB_PUSH_SA are required/);
  });
});

describe('4. Pub/Sub Push Auth in PRODUCTION mode: Missing / Malformed Token', () => {
  const validConfig: PubSubAuthConfig = {
    appMode: 'production',
    audience: 'https://sentinel.internal/api/events/registry',
    expectedSaEmail: 'pubsub-invoker@sentinel-ai-511412.iam.gserviceaccount.com'
  };

  test('rejects when Authorization header is absent', async () => {
    const res = await verifyPubSubPushAuth({}, validConfig);
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.error || '', /Missing or invalid Pub\/Sub Bearer token/);
  });

  test('rejects when Authorization header does not start with Bearer', async () => {
    const res = await verifyPubSubPushAuth({ authorization: 'Basic dXNlcjpwYXNz' }, validConfig);
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 401);
  });

  test('rejects when Bearer token is empty', async () => {
    const res = await verifyPubSubPushAuth({ authorization: 'Bearer   ' }, validConfig);
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.error || '', /Empty Pub\/Sub Bearer token/);
  });
});

describe('5. Pub/Sub Push Auth in PRODUCTION mode: Token Verification (Wrong Audience, Email, Verification)', () => {
  const validConfig: PubSubAuthConfig = {
    appMode: 'production',
    audience: 'https://sentinel.internal/api/events/registry',
    expectedSaEmail: 'pubsub-invoker@sentinel-ai-511412.iam.gserviceaccount.com'
  };

  test('rejects when Google OAuth2Client fails audience or signature validation', async () => {
    // Mock OAuth2Client that throws on wrong audience
    const mockClient = {
      async verifyIdToken(options: { idToken: string; audience: string }) {
        if (options.audience !== 'https://sentinel.internal/api/events/registry') {
          throw new Error('Wrong recipient, payload audience != requiredAudience');
        }
        if (options.idToken === 'wrong-aud-token') {
          throw new Error('Token used with wrong audience');
        }
        return {
          getPayload: () => ({
            email: 'pubsub-invoker@sentinel-ai-511412.iam.gserviceaccount.com',
            email_verified: true
          })
        };
      }
    } as unknown as OAuth2Client;

    const res = await verifyPubSubPushAuth(
      { authorization: 'Bearer wrong-aud-token' },
      validConfig,
      mockClient
    );

    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.error || '', /OIDC verification failed/);
  });

  test('rejects when token email does not match expected service account', async () => {
    const mockClient = {
      async verifyIdToken() {
        return {
          getPayload: () => ({
            email: 'attacker@evil-domain.com',
            email_verified: true
          })
        };
      }
    } as unknown as OAuth2Client;

    const res = await verifyPubSubPushAuth(
      { authorization: 'Bearer attacker-token' },
      validConfig,
      mockClient
    );

    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.error || '', /Service account token mismatch/);
  });

  test('rejects when token email_verified is false', async () => {
    const mockClient = {
      async verifyIdToken() {
        return {
          getPayload: () => ({
            email: 'pubsub-invoker@sentinel-ai-511412.iam.gserviceaccount.com',
            email_verified: false
          })
        };
      }
    } as unknown as OAuth2Client;

    const res = await verifyPubSubPushAuth(
      { authorization: 'Bearer unverified-token' },
      validConfig,
      mockClient
    );

    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.error || '', /email is not verified/);
  });

  test('accepts when token, audience, email and email_verified are all valid', async () => {
    const mockClient = {
      async verifyIdToken() {
        return {
          getPayload: () => ({
            email: 'pubsub-invoker@sentinel-ai-511412.iam.gserviceaccount.com',
            email_verified: true,
            sub: '1044485290316'
          })
        };
      }
    } as unknown as OAuth2Client;

    const res = await verifyPubSubPushAuth(
      { authorization: 'Bearer valid-signed-google-token' },
      validConfig,
      mockClient
    );

    assert.equal(res.ok, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.email, 'pubsub-invoker@sentinel-ai-511412.iam.gserviceaccount.com');
  });
});
