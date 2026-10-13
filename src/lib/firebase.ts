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
export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export function getFirestoreDb(): Firestore {
  return db;
}

export function getAppAuth(): Auth {
  return auth;
}

// Initial connection verification per Firebase skill requirements
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('[Sentinel AI] Firestore offline or connecting...');
    }
    return false;
  }
}
testFirestoreConnection().catch(() => {});

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

/**
 * Ensures user profile document exists in users/{uid}.
 * New users are initialized strictly with role: "analyst" and governanceMode: "human-in-the-loop".
 */
export async function ensureUserProfile(user: FirebaseUser): Promise<UserProfile> {
  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const data = snap.data() as UserProfile;
    return {
      uid: user.uid,
      displayName: data.displayName || user.displayName || 'Compliance Analyst',
      email: data.email || user.email || '',
      role: data.role || 'analyst',
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

  await setDoc(userRef, newProfile);
  return newProfile;
}

export interface AuditLogEntry {
  actorUid: string;
  actorType: 'HUMAN' | 'SYSTEM' | 'AI';
  actorName: string;
  action: string;
  summary: string;
  timestamp?: any;
  customerId?: string;
  groupId?: string;
  eventId?: string;
  caseId?: string;
  personId?: string;
  isAiGenerated?: boolean;
  details?: Record<string, unknown>;
}

/**
 * Appends an immutable audit record to the audit collection.
 */
export async function writeAuditRecord(entry: AuditLogEntry): Promise<void> {
  try {
    const auditCol = collection(db, 'audit');
    await addDoc(auditCol, {
      ...entry,
      timestamp: serverTimestamp(),
      isoTimestamp: new Date().toISOString()
    });
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
    summary: `Analyst signed in to Sentinel AI (Role: ${profile.role}).`,
    details: {
      provider: 'google.com',
      email: result.user.email
    }
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
