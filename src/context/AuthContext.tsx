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
  switchRole: (role: 'analyst' | 'supervisor') => Promise<{ success: boolean; error?: string }>;
  isSupervisor: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  setGovernanceMode: async () => ({ success: false }),
  switchRole: async () => ({ success: false }),
  isSupervisor: false
});

const DEFAULT_DEMO_PROFILE: UserProfile = {
  uid: 'demo-supervisor',
  displayName: 'Compliance Supervisor',
  email: 'supervisor@sentinel.internal',
  role: 'supervisor',
  governanceMode: 'human-in-the-loop',
  createdAt: new Date().toISOString()
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(DEFAULT_DEMO_PROFILE);
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
          unsubscribeProfile = onSnapshot(
            userDocRef,
            (snap) => {
              if (snap.exists()) {
                const data = snap.data() as UserProfile;
                startTransition(() => {
                  setProfile({
                    uid: fbUser.uid,
                    displayName: data.displayName || fbUser.displayName || 'Analyst',
                    email: data.email || fbUser.email || '',
                    role: data.role || 'supervisor',
                    governanceMode: data.governanceMode || 'human-in-the-loop',
                    createdAt: data.createdAt || new Date().toISOString()
                  });
                });
              }
            },
            (error) => {
              console.warn('[AuthContext] Profile onSnapshot error:', error);
            }
          );
        } catch (err) {
          console.error('[AuthContext] Failed to load user profile:', err);
        }
      } else {
        setUser(null);
        setProfile((prev) => prev || DEFAULT_DEMO_PROFILE);
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
        setProfile(DEFAULT_DEMO_PROFILE);
      });
    } catch (err) {
      console.error('[AuthContext] Sign out failed:', err);
    }
  };

  const handleSetGovernanceMode = async (
    mode: 'human-in-the-loop' | 'automated'
  ): Promise<{ success: boolean; error?: string }> => {
    const currentRole = profile?.role || 'supervisor';
    if (mode === 'automated' && currentRole !== 'supervisor') {
      return {
        success: false,
        error: 'Privilege required: Automated governance is supervisor-only.'
      };
    }

    // Always update local state immediately (optimistic UI)
    startTransition(() => {
      setProfile((prev) =>
        prev
          ? { ...prev, governanceMode: mode }
          : { ...DEFAULT_DEMO_PROFILE, governanceMode: mode }
      );
    });

    if (!user) {
      // Demo session without Firebase Auth user
      return { success: true };
    }

    try {
      // Secure token verification via server route for authenticated users
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
        console.warn('[AuthContext] Server setGovernanceMode response not ok:', data.error);
      }

      return { success: true };
    } catch (err) {
      console.warn('[AuthContext] setGovernanceMode error:', (err as Error).message);
      return { success: true }; // Retain local optimistic state
    }
  };

  const handleSwitchRole = async (
    role: 'analyst' | 'supervisor'
  ): Promise<{ success: boolean; error?: string }> => {
    // Always update local state immediately
    startTransition(() => {
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              role,
              governanceMode: role === 'analyst' ? 'human-in-the-loop' : prev.governanceMode
            }
          : { ...DEFAULT_DEMO_PROFILE, role }
      );
    });

    if (!user) {
      return { success: true };
    }

    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/auth/switch-role', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ role })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn('[AuthContext] Server switchRole response not ok:', data.error);
      }

      return { success: true };
    } catch (err) {
      console.warn('[AuthContext] switchRole error:', (err as Error).message);
      return { success: true };
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
        switchRole: handleSwitchRole,
        isSupervisor: profile?.role === 'supervisor'
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
