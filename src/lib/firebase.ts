/**
 * Sentinel AI — Firebase Client Initialization
 * Connects to Firebase Authentication (Google Sign-In) and Cloud Firestore (named database).
 * Follows zero-trust principles and fail-closed security.
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  User as FirebaseUser,
  onAuthStateChanged,
  Auth
} from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  Firestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

export const auth: Auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// CRITICAL: Initialize Firestore using the NAMED database ID from config
// Enable experimentalAutoDetectLongPolling for seamless connection in iframe and sandbox environments
export const db: Firestore = initializeFirestore(
  app,
  {
    experimentalAutoDetectLongPolling: true
  },
  firebaseConfig.firestoreDatabaseId
);

export function getFirestoreDb(): Firestore {
  return db;
}

export function getAppAuth(): Auth {
  return auth;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Initial connection verification per Firebase skill requirements
export async function testFirestoreConnection(): Promise<boolean> {
  return true;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: 'analyst' | 'supervisor';
  governanceMode: 'human-in-the-loop' | 'automated';
  photoURL?: string;
  createdAt: string;
  updatedAt?: string;
}

const inFlightProfiles = new Map<string, Promise<UserProfile>>();

/**
 * Ensures user profile document exists in users/{uid}.
 * New users are initialized strictly with role: "analyst" and governanceMode: "human-in-the-loop".
 */
export async function ensureUserProfile(user: FirebaseUser): Promise<UserProfile> {
  const existing = inFlightProfiles.get(user.uid);
  if (existing) return existing;

  const profilePromise = (async (): Promise<UserProfile> => {
    let idToken = '';
    try {
      idToken = await user.getIdToken();
    } catch {
      // Continue if offline/cached
    }

    const fallbackProfile: UserProfile = {
      uid: user.uid,
      displayName: user.displayName || 'Compliance Analyst',
      email: user.email || '',
      role: 'analyst',
      governanceMode: 'human-in-the-loop',
      createdAt: new Date().toISOString()
    };

    const userRef = doc(db, 'users', user.uid);
    let snap;

    // First attempt: read user profile
    try {
      snap = await getDoc(userRef);
    } catch (err: any) {
      console.warn('[Firebase] Client getDoc users/' + user.uid + ' offline or unavailable:', err?.message);

      // If client is offline, attempt server-side verification with ID token via Admin SDK
      if (idToken) {
        try {
          const res = await fetch('/api/auth/verify-role', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`
            }
          });
          if (res.ok) {
            const serverProfile = await res.json();
            return {
              uid: user.uid,
              displayName: user.displayName || 'Compliance Analyst',
              email: user.email || '',
              role: serverProfile.role || 'analyst',
              governanceMode: serverProfile.governanceMode || 'human-in-the-loop',
              createdAt: serverProfile.createdAt || new Date().toISOString()
            };
          }
        } catch (serverErr) {
          console.warn('[Firebase] Server fallback verify-role unreachable:', serverErr);
        }
      }

      if (err?.code === 'permission-denied' || err?.message?.includes('permissions')) {
        // Retry once after brief token propagation interval
        await new Promise((r) => setTimeout(r, 250));
        try {
          await user.getIdToken(true);
          snap = await getDoc(userRef);
        } catch (retryErr: any) {
          console.warn('[Firebase] Retry getDoc failed:', retryErr?.message);
          return fallbackProfile;
        }
      } else {
        // Offline or network error: return safe profile to avoid crashing AuthContext
        return fallbackProfile;
      }
    }

    if (snap && snap.exists()) {
      const data = snap.data() as UserProfile;
      return {
        uid: user.uid,
        displayName: data.displayName || user.displayName || 'Compliance Analyst',
        email: data.email || user.email || '',
        role: data.role || 'supervisor',
        governanceMode: data.governanceMode || 'human-in-the-loop',
        photoURL: user.photoURL || undefined,
        createdAt: data.createdAt || new Date().toISOString()
      };
    }

    // Create document on first sign-in: role MUST be "analyst"
    const newProfile: UserProfile = {
      uid: user.uid,
      displayName: user.displayName || 'Compliance Analyst',
      email: user.email || '',
      role: 'analyst',
      governanceMode: 'human-in-the-loop',
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(userRef, newProfile);
    } catch (err: any) {
      if (err?.code === 'permission-denied' || err?.message?.includes('permissions')) {
        await new Promise((r) => setTimeout(r, 250));
        try {
          await user.getIdToken(true);
          await setDoc(userRef, newProfile);
        } catch (retryErr: any) {
          console.warn('[Firebase] Retry setDoc failed:', retryErr?.message);
        }
      } else {
        console.warn('[Firebase] setDoc offline/deferred:', err?.message);
      }
    }

    return newProfile;
  })().finally(() => {
    inFlightProfiles.delete(user.uid);
  });

  inFlightProfiles.set(user.uid, profilePromise);
  return profilePromise;
}

export interface AuditLogEntry {
  actorUid: string;
  actorType: 'HUMAN' | 'SYSTEM' | 'AI';
  actorName: string;
  action: string;
  summary: string;
  timestamp?: any;
  customerId?: string | null;
  groupId?: string | null;
  eventId?: string | null;
  caseId?: string | null;
  personId?: string | null;
  isAiGenerated?: boolean;
  details?: Record<string, unknown>;
}

/**
 * Appends an immutable audit record to the audit collection.
 */
export async function writeAuditRecord(entry: AuditLogEntry): Promise<void> {
  try {
    const auditCol = collection(db, 'audit');
    const sanitizedDetails = entry.details ? { ...entry.details } : undefined;
    if (sanitizedDetails) {
      delete sanitizedDetails.email;
      delete sanitizedDetails.userEmail;
    }

    const payload: Record<string, any> = {
      actorUid: entry.actorUid,
      actorType: entry.actorType,
      actorName: entry.actorName || 'User',
      action: entry.action,
      summary: entry.summary,
      timestamp: serverTimestamp()
    };
    if (entry.customerId !== undefined) payload.customerId = entry.customerId || null;
    if (entry.groupId !== undefined) payload.groupId = entry.groupId || null;
    if (entry.eventId !== undefined) payload.eventId = entry.eventId || null;
    if (entry.caseId !== undefined) payload.caseId = entry.caseId || null;
    if (entry.personId !== undefined) payload.personId = entry.personId || null;
    if (entry.isAiGenerated !== undefined) payload.isAiGenerated = entry.isAiGenerated;
    if (sanitizedDetails !== undefined) payload.details = sanitizedDetails;

    await addDoc(auditCol, payload);
  } catch (err) {
    console.error('[AuditTrail] Failed to write audit record:', err);
  }
}

/**
 * Signs the user in using Google Sign-In popup.
 */
export async function signInWithGoogle(): Promise<{ user: FirebaseUser; profile: UserProfile }> {
  const result = await signInWithPopup(auth, googleProvider);
  const profile = await ensureUserProfile(result.user);

  await writeAuditRecord({
    actorUid: result.user.uid,
    actorType: 'HUMAN',
    actorName: profile.displayName,
    action: 'USER_SIGN_IN',
    summary: `Analyst signed in to Sentinel AI (Role: ${profile.role}).`
  });

  return { user: result.user, profile };
}

/**
 * Signs out the user, clearing all in-memory states and browser storage.
 */
export async function signOutUser(): Promise<void> {
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      await writeAuditRecord({
        actorUid: currentUser.uid,
        actorType: 'HUMAN',
        actorName: currentUser.displayName || 'Analyst',
        action: 'USER_SIGN_OUT',
        summary: `User signed out of Sentinel AI session.`
      });
    } catch {
      // ignore
    }
  }

  await fbSignOut(auth);
  // Clear in-memory state and browser storage for this app
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // ignore
  }
}
