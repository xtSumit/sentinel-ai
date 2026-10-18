/**
 * Sentinel AI — Event Feed Adapter
 * Conforms to Custom Instructions §11 (Preview vs Production adapters)
 * In PREVIEW: writes event straight to Firestore using client SDK or local API.
 * In PRODUCTION: publishes JSON message to Google Cloud Pub/Sub topic.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase';

export interface RegistryChangeEvent {
  id: string;
  customerId: string;
  groupId: string;
  templateId: string;
  changeType: 'SHARE_CHANGE' | 'NEW_RELATIONSHIP' | 'RELATIONSHIP_ENDED' | 'ENTITY_DISSOLVED';
  payload: Record<string, unknown>;
  description: string;
  source: string;
  confidence: number;
  detectedAt: string;
  status: 'pending' | 'accepted' | 'monitoring' | 'dismissed';
  decidedBy?: string;
  decidedAt?: string;
  dismissReason?: string;
  _simulation?: boolean;
}

export interface IEventFeedAdapter {
  publishEvent(event: RegistryChangeEvent): Promise<void>;
  mode(): 'PREVIEW' | 'PRODUCTION';
}

export class PreviewEventFeedAdapter implements IEventFeedAdapter {
  async publishEvent(event: RegistryChangeEvent): Promise<void> {
    const db = getFirestoreDb();
    if (!db) {
      throw new Error('[PreviewEventFeedAdapter] Firestore client is not initialized.');
    }
    const sanitizedId = event.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    const eventRef = doc(db, 'events', sanitizedId);
    
    // Check if event already exists to prevent duplicate writes
    const snap = await getDoc(eventRef);
    if (snap.exists()) {
      return;
    }

    const { decidedBy, decidedAt, dismissReason, ...cleanEvent } = event;
    await setDoc(eventRef, {
      ...cleanEvent,
      id: sanitizedId,
      status: 'pending',
      _simulation: true
    });
  }

  mode(): 'PREVIEW' {
    return 'PREVIEW';
  }
}

import { getAuth } from 'firebase/auth';

export class ProductionEventFeedAdapter implements IEventFeedAdapter {
  private topicName: string;

  constructor() {
    const topic = process.env.PUBSUB_TOPIC;
    if (!topic) {
      throw new Error('[ProductionEventFeedAdapter] PUBSUB_TOPIC environment variable is required in PRODUCTION mode. Failing closed.');
    }
    this.topicName = topic;
  }

  async publishEvent(event: RegistryChangeEvent): Promise<void> {
    // In production, publishes message to Pub/Sub topic
    // A push subscription forwards to POST /api/events/registry with OIDC authentication
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const auth = getAuth();
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {
      // Running outside client auth context
    }

    const response = await fetch('/api/events/publish', {
      method: 'POST',
      headers,
      body: JSON.stringify({ topic: this.topicName, event })
    });
    if (!response.ok) {
      throw new Error(`[ProductionEventFeedAdapter] Pub/Sub publishing failed with status ${response.status}`);
    }
  }

  mode(): 'PRODUCTION' {
    return 'PRODUCTION';
  }
}

export function getEventFeedAdapter(): IEventFeedAdapter {
  const mode = process.env.APP_MODE?.toLowerCase() === 'production' ? 'PRODUCTION' : 'PREVIEW';
  if (mode === 'PRODUCTION') {
    return new ProductionEventFeedAdapter();
  }
  return new PreviewEventFeedAdapter();
}
