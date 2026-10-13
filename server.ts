/**
 * Sentinel AI — Full-Stack Server
 * Express entry point hosting secure API routes and mounting Vite dev middleware.
 * Enforces fail-closed token verification, Admin SDK role derivation, and prompt injection defense.
 */

import express, { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read Firebase config
const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
let firebaseConfig: {
  projectId: string;
  firestoreDatabaseId: string;
  [key: string]: unknown;
} = {
  projectId: 'untangle-7',
  firestoreDatabaseId: 'ai-studio-sentinelai-1a66e7cb-9c43-4e20-98b7-cd3f760ce19a'
};

if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error('[Server] Failed to read firebase-applet-config.json:', err);
  }
}

// Initialize Firebase Admin SDK
if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId
  });
}

// Helper to access named Firestore database
function getAdminDb() {
  return getFirestore(firebaseConfig.firestoreDatabaseId);
}

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// MOUNT BODY PARSERS BEFORE ROUTES (per Custom Instructions §6)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/**
 * Middleware: Verify Firebase ID Token
 * Fails closed on any error. Derives user UID from verified token ONLY.
 */
async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header.' });
    return;
  }

  const idToken = authHeader.substring(7);
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    (req as any).user = decodedToken;
    (req as any).uid = decodedToken.uid;
    next();
  } catch (error) {
    // Fail closed: no sandbox bypasses, log no personal data
    console.error('[Auth] Token verification failed:', (error as Error).message);
    res.status(401).json({ error: 'Unauthorized: Invalid authentication credentials.' });
  }
}

// -------------------------------------------------------------
// API ROUTE: Verify Role & Fetch User Details
// -------------------------------------------------------------
app.post('/api/auth/verify-role', requireAuth, async (req: Request, res: Response) => {
  try {
    const uid = (req as any).uid;
    const db = getAdminDb();
    const docRef = db.collection('users').doc(uid);
    const snap = await docRef.get();

    if (!snap.exists) {
      // First sign-in user profile defaults to analyst
      const newProfile = {
        uid,
        role: 'analyst',
        governanceMode: 'human-in-the-loop',
        createdAt: new Date().toISOString()
      };
      await docRef.set(newProfile);
      res.json(newProfile);
      return;
    }

    const data = snap.data();
    res.json({
      uid,
      role: data?.role || 'analyst',
      governanceMode: data?.governanceMode || 'human-in-the-loop'
    });
  } catch (error) {
    console.error('[API /api/auth/verify-role] Error:', (error as Error).message);
    res.status(500).json({ error: 'Internal server error verifying user role.' });
  }
});

// -------------------------------------------------------------
// API ROUTE: Governance Mode Toggle
// "Automated" is supervisor-only: verified on server, fails closed.
// -------------------------------------------------------------
app.post('/api/governance/set-mode', requireAuth, async (req: Request, res: Response) => {
  try {
    const uid = (req as any).uid;
    const { mode } = req.body;

    if (mode !== 'human-in-the-loop' && mode !== 'automated') {
      res.status(400).json({ error: 'Invalid governance mode requested.' });
      return;
    }

    const db = getAdminDb();
    const docRef = db.collection('users').doc(uid);
    const snap = await docRef.get();

    if (!snap.exists) {
      res.status(404).json({ error: 'User record not found.' });
      return;
    }

    const userData = snap.data();
    const userRole = userData?.role || 'analyst';

    if (mode === 'automated' && userRole !== 'supervisor') {
      res.status(403).json({
        error: 'Privilege required: Automated governance mode can only be enabled by a Supervisor.'
      });
      return;
    }

    await docRef.update({
      governanceMode: mode,
      updatedAt: new Date().toISOString()
    });

    // Write audit record
    await db.collection('audit').add({
      actorUid: uid,
      actorType: 'HUMAN',
      actorName: userData?.displayName || 'User',
      action: 'GOVERNANCE_MODE_CHANGED',
      summary: `Governance mode updated to ${mode.toUpperCase()} by ${userRole}.`,
      details: { mode, role: userRole },
      timestamp: FieldValue.serverTimestamp(),
      isoTimestamp: new Date().toISOString()
    });

    res.json({ success: true, mode });
  } catch (error) {
    console.error('[API /api/governance/set-mode] Error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to update governance mode.' });
  }
});

// -------------------------------------------------------------
// API ROUTE: Materiality Explanation Generation (Gemini Ladder)
// Pass facts as structured fields, never instructions. 6s timeout.
// -------------------------------------------------------------
app.post('/api/materiality/explain', requireAuth, async (req: Request, res: Response) => {
  const {
    verdict,
    factors,
    changedPartyName,
    oldValueText,
    newValueText,
    regulationName,
    thresholdPct,
    fallbackExplanation
  } = req.body;

  // Validate inputs
  if (!verdict || !Array.isArray(factors)) {
    res.status(400).json({ error: 'Missing or malformed materiality payload.' });
    return;
  }

  // Strip delimiter tokens from untrusted entity and party names
  const cleanName = String(changedPartyName || 'Corporate Entity').replace(/[`'"\r\n{}<>]/g, ' ');
  const cleanReg = String(regulationName || 'Statutory Framework').replace(/[`'"\r\n{}<>]/g, ' ');
  const cleanOld = String(oldValueText || '0%').replace(/[`'"\r\n{}<>]/g, ' ');
  const cleanNew = String(newValueText || '0%').replace(/[`'"\r\n{}<>]/g, ' ');

  const prompt = `You are a bank compliance regulatory officer writing a concise 2-3 sentence explanation for an adverse change review.
FACTS:
- Deterministic Verdict: ${verdict}
- Applicable Regulation: ${cleanReg} (Threshold: ${thresholdPct}%)
- Changed Entity: ${cleanName}
- Ownership Change: ${cleanOld} to ${cleanNew}
- Triggered Factors: ${factors.map((f: any) => f.description).join('; ')}

TASK:
Write exactly 2 to 3 factual, professional sentences in plain English explaining WHY this change produced the verdict under the regulation. Do not make determinations, output only the explanatory rationale.`;

  // Fallback models ladder
  const MODEL_LADDER = ['gemini-2.5-flash', 'gemini-1.5-flash'];
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    res.json({
      explanation: fallbackExplanation || 'Deterministic rule determination verified under governing statutory thresholds.',
      isAiGenerated: false
    });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });

  // 6-second hard timeout
  const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
    setTimeout(() => resolve({ timeout: true }), 6000)
  );

  async function tryGenerate(): Promise<string | null> {
    for (const model of MODEL_LADDER) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt
        });
        const text = response.text?.trim();
        if (text) return text;
      } catch (err) {
        console.warn(`[Gemini] Model ${model} failed, trying next ladder step:`, (err as Error).message);
      }
    }
    return null;
  }

  try {
    const result = await Promise.race([tryGenerate(), timeoutPromise]);
    if (result && typeof result === 'string') {
      res.json({
        explanation: result,
        isAiGenerated: true
      });
      return;
    }

    // Timeout or model ladder exhaustion: fall back to deterministic template
    res.json({
      explanation: fallbackExplanation || 'Deterministic rule determination verified under governing statutory thresholds.',
      isAiGenerated: false
    });
  } catch {
    res.json({
      explanation: fallbackExplanation || 'Deterministic rule determination verified under governing statutory thresholds.',
      isAiGenerated: false
    });
  }
});

// -------------------------------------------------------------
// API ROUTE: Pub/Sub Registry Event Push Endpoint
// POST /api/events/registry
// Verifies Pub/Sub OIDC token with google-auth-library in PRODUCTION
// -------------------------------------------------------------
app.post('/api/events/registry', async (req: Request, res: Response) => {
  const isProd = process.env.APP_MODE === 'PRODUCTION';

  if (isProd) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: Missing Pub/Sub bearer token.' });
      return;
    }

    const token = authHeader.substring(7);
    const audience = process.env.PUBSUB_PUSH_AUDIENCE;
    const expectedSa = process.env.PUBSUB_PUSH_SA;

    try {
      const client = new OAuth2Client();
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: audience || undefined
      });
      const payload = ticket.getPayload();
      if (!payload || (expectedSa && payload.email !== expectedSa)) {
        res.status(401).json({ error: 'Unauthorized: Service account token mismatch.' });
        return;
      }
    } catch (err) {
      console.error('[PubSub Push] OIDC verification failed:', (err as Error).message);
      res.status(401).json({ error: 'Unauthorized: Invalid OIDC token signature.' });
      return;
    }
  }

  try {
    const event = req.body;
    if (!event || !event.id || !event.customerId || !event.groupId) {
      res.status(400).json({ error: 'Invalid registry change event schema.' });
      return;
    }

    const db = getAdminDb();
    await db.collection('events').doc(event.id).set({
      ...event,
      status: 'pending',
      detectedAt: new Date().toISOString()
    });

    res.status(200).json({ status: 'received', eventId: event.id });
  } catch (error) {
    console.error('[PubSub Push] Error processing event:', (error as Error).message);
    res.status(500).json({ error: 'Internal server error recording registry event.' });
  }
});

// -------------------------------------------------------------
// Mount Vite in Dev Mode or Serve Static in Production
// -------------------------------------------------------------
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`[Sentinel AI] Full-Stack server running at http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
