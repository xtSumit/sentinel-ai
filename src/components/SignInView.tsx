/**
 * Sentinel AI — Sign-In Screen
 * Built per DESIGN.md and custom specification:
 * - Centred card
 * - Sentinel shield (SENTINEL_MARK_192) displayed at 96px
 * - "Sentinel AI" in Sora beneath it
 * - Gradient headline
 * - One-line description
 * - "Continue with Google"
 * - Note that all data is synthetic
 */

import React, { useState } from 'react';
import { SENTINEL_MARK_192 } from '../brand-assets';
import { useAuth } from '../context/AuthContext';
import { ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';

export const SignInView: React.FC = () => {
  const { signIn } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signIn();
    } catch (err: any) {
      console.error('Sign-in error:', err);
      setError(err?.message || 'Authentication failed. Please verify popup permissions and retry.');
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-0)',
        backgroundImage: `
          radial-gradient(ellipse at 50% 20%, rgba(59, 130, 246, 0.12) 0%, transparent 60%),
          radial-gradient(ellipse at 80% 80%, rgba(16, 185, 129, 0.05) 0%, transparent 50%)
        `
      }}
    >
      {/* Background ambient grid lines */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      />

      {/* Centred Card */}
      <div
        className="relative z-10 w-full max-w-md rounded-2xl p-8 flex flex-col items-center text-center transition-all duration-300"
        style={{
          backgroundColor: 'var(--bg-1)',
          border: '1px solid var(--border)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(59, 130, 246, 0.15)'
        }}
      >
        {/* Sentinel Shield 96px */}
        <div className="relative mb-4 flex items-center justify-center">
          <div
            className="absolute inset-0 rounded-full blur-xl opacity-40"
            style={{ backgroundColor: 'var(--primary)' }}
          />
          <img
            src={SENTINEL_MARK_192}
            alt="Sentinel AI Shield"
            width={96}
            height={96}
            className="relative z-10 w-24 h-24 object-contain drop-shadow-md select-none pointer-events-none"
          />
        </div>

        {/* Brand Name in Sora */}
        <div className="flex items-center gap-1.5 mb-3">
          <span
            className="text-2xl font-bold tracking-tight"
            style={{ fontFamily: "'Sora', sans-serif", color: 'var(--ink-0)' }}
          >
            Sentinel <span style={{ color: 'var(--primary)' }}>AI</span>
          </span>
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold"
            style={{
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--primary)',
              border: '1px solid rgba(59, 130, 246, 0.3)'
            }}
          >
            v0.4 BODS
          </span>
        </div>

        {/* Gradient Headline */}
        <h1
          className="text-xl md:text-2xl font-bold mb-2 tracking-tight"
          style={{
            fontFamily: "'Sora', sans-serif",
            background: 'linear-gradient(135deg, #FFFFFF 0%, #93C5FD 50%, #3B82F6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}
        >
          Beneficial Ownership &amp; Perpetual KYC
        </h1>

        {/* One-Line Description */}
        <p
          className="text-xs md:text-sm mb-6 leading-relaxed max-w-sm"
          style={{ color: 'var(--ink-2)' }}
        >
          Autonomous multi-layer UBO graph resolution, live registry change monitoring, and deterministic compliance materiality for bank analysts.
        </p>

        {error && (
          <div
            className="w-full mb-4 p-3 rounded-lg text-xs flex items-center gap-2 text-left"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#F87171'
            }}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Continue with Google Button */}
        <button
          onClick={handleGoogleSignIn}
          disabled={signingIn}
          className="w-full py-3 px-4 rounded-xl font-medium text-sm flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer shadow-lg active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed group"
          style={{
            background: 'linear-gradient(135deg, var(--bg-2) 0%, rgba(30, 41, 59, 0.9) 100%)',
            border: '1px solid var(--border)',
            color: 'var(--ink-0)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--primary)';
            e.currentTarget.style.boxShadow = '0 0 20px rgba(59, 130, 246, 0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          {signingIn ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--primary)' }} />
              <span>Verifying credentials...</span>
            </>
          ) : (
            <>
              {/* Google G Logo SVG */}
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </>
          )}
        </button>

        {/* Security & Synthetic Data Compliance Notice */}
        <div
          className="mt-6 pt-5 w-full border-t flex flex-col items-center gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-2)' }}>
            <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--emerald)' }} />
            <span>Bank-Grade Firebase Authentication &amp; Firestore ABAC</span>
          </div>
          <p
            className="text-[10px] leading-relaxed text-center font-mono"
            style={{ color: 'var(--ink-3)' }}
          >
            Notice: All natural person records and ownership group scenarios in this application are synthetic (BODS v0.4). Designated entity screening is grounded in OpenSanctions official designations (CC BY-NC 4.0).
          </p>
        </div>
      </div>
    </div>
  );
};
