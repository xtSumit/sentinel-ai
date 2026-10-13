/**
 * Sentinel AI — Event Feed Adapter
 * Conforms to Custom Instructions §11 (Preview vs Production adapters)
 * In PREVIEW: writes event straight to Firestore using client SDK or local API.
 * In PRODUCTION: publishes JSON message to Google Cloud Pub/Sub topic.
 */

import { doc, setDoc } from 'firebase/firestore';
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
    const eventRef = doc(db, 'events', event.id);
    await setDoc(eventRef, {
      ...event,
      _simulation: true
    });
  }

  mode(): 'PREVIEW' {
    return 'PREVIEW';
  }
}

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
    const response = await fetch('/api/events/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  const mode = process.env.APP_MODE === 'PRODUCTION' ? 'PRODUCTION' : 'PREVIEW';
  if (mode === 'PRODUCTION') {
    return new ProductionEventFeedAdapter();
  }
  return new PreviewEventFeedAdapter();
}
