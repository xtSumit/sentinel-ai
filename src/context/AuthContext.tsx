/**
 * Sentinel AI — Authentication Context & State Management
 * Provides reactive Firebase user authentication, role management, and governance settings.
 */

import React, { createContext, useContext, useEffect, useState, useTransition } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  auth,
  db,
  ensureUserProfile,
  signInWithGoogle,
  signOutUser,
  UserProfile,
  writeAuditRecord
} from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  setGovernanceMode: (mode: 'human-in-the-loop' | 'automated') => Promise<{ success: boolean; error?: string }>;
  isSupervisor: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  setGovernanceMode: async () => ({ success: false }),
  isSupervisor: false
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        setUser(fbUser);
        try {
          const prof = await ensureUserProfile(fbUser);
          startTransition(() => {
            setProfile(prof);
          });

          // Subscribe to live profile updates (e.g. role promotions or governance changes)
          const userDocRef = doc(db, 'users', fbUser.uid);
          unsubscribeProfile = onSnapshot(userDocRef, (snap) => {
            if (snap.exists()) {
              const data = snap.data() as UserProfile;
              startTransition(() => {
                setProfile({
                  uid: fbUser.uid,
                  displayName: data.displayName || fbUser.displayName || 'Analyst',
                  email: data.email || fbUser.email || '',
                  role: data.role || 'analyst',
                  governanceMode: data.governanceMode || 'human-in-the-loop',
                  createdAt: data.createdAt || new Date().toISOString()
                });
              });
            }
          });
        } catch (err) {
          console.error('[AuthContext] Failed to load user profile:', err);
        }
      } else {
        setUser(null);
        setProfile(null);
        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = null;
        }
      }
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      const { user: fbUser, profile: prof } = await signInWithGoogle();
      startTransition(() => {
        setUser(fbUser);
        setProfile(prof);
      });
    } catch (err) {
      console.error('[AuthContext] Google sign-in failed:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
      startTransition(() => {
        setUser(null);
        setProfile(null);
      });
    } catch (err) {
      console.error('[AuthContext] Sign out failed:', err);
    }
  };

  const handleSetGovernanceMode = async (
    mode: 'human-in-the-loop' | 'automated'
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user || !profile) {
      return { success: false, error: 'User is not authenticated.' };
    }

    if (mode === 'automated' && profile.role !== 'supervisor') {
      return {
        success: false,
        error: 'Privilege required: Automated governance is supervisor-only.'
      };
    }

    try {
      // Secure token verification via server route
      const token = await user.getIdToken();
      const res = await fetch('/api/governance/set-mode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ mode })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.error || 'Failed to update governance mode on server.' };
      }

      startTransition(() => {
        setProfile((prev) => (prev ? { ...prev, governanceMode: mode } : prev));
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signIn: handleSignIn,
        signOut: handleSignOut,
        setGovernanceMode: handleSetGovernanceMode,
        isSupervisor: profile?.role === 'supervisor'
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
