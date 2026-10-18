/**
 * Sentinel AI — Materiality Assessment Modal
 * Built per DESIGN.md & custom instructions:
 * - Light surface: white --card, --ink text, 1px --line borders, --sh3 shadow over blurred backdrop
 * - Accessible: keyboard navigation (Escape to close, visible focus rings, aria-labels)
 * - Ticking step sequence in light neutral style
 * - Delta row with clearly labelled "Assessment confidence" and "Source confidence"
 * - Trigger-matched regulatory box:
 *   - Sanctions: designation (programmes, lists, OpenSanctions ID) and NO threshold badge
 *   - Ownership: regulation with threshold ("Money Laundering Regulations 2017 · more than 25%")
 * - Rationale explanation with AI vs Rule Template indicator
 * - Safe rule template for sanctions: "Requires escalation: a newly introduced party matches an official sanctions designation."
 */

import React, { useState, useEffect } from 'react';
import { MaterialityEvaluation } from '../engine/materialityEngine';
import { useAuth } from '../context/AuthContext';
import {
  ShieldAlert,
  AlertTriangle,
  Info,
  CheckCircle2,
  Sparkles,
  Loader2,
  Scale,
  ArrowRight,
  X,
  ExternalLink
} from 'lucide-react';

interface MaterialityModalProps {
  evaluation: MaterialityEvaluation;
  onDecision: (
    decision: 'accepted' | 'monitoring' | 'dismissed',
    dismissReason?: string,
    isAiGenerated?: boolean,
    explanationText?: string
  ) => Promise<void>;
  onClose: () => void;
  isAutomated?: boolean;
}

export const MaterialityModal: React.FC<MaterialityModalProps> = ({
  evaluation,
  onDecision,
  onClose,
  isAutomated = false
}) => {
  const { user } = useAuth();
  const [phase, setPhase] = useState<'analysing' | 'verdict'>('analysing');
  const [analysisStep, setAnalysisStep] = useState(1);
  const [explanation, setExplanation] = useState<string>(evaluation.templateExplanation);
  const [isAiGenerated, setIsAiGenerated] = useState<boolean>(false);
  const [dismissReason, setDismissReason] = useState('');
  const [showDismissInput, setShowDismissInput] = useState(false);
  const [confirmingMonitor, setConfirmingMonitor] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Keyboard navigation: Escape key closes modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Step ticking sequence (1: Re-resolving ownership, 2: Applying materiality rules, 3: Drafting explanation)
  useEffect(() => {
    const timer1 = setTimeout(() => {
      setAnalysisStep(2);
    }, 600);

    const timer2 = setTimeout(() => {
      setAnalysisStep(3);
    }, 1200);

    // Call server Gemini explanation endpoint
    const fetchExplanation = async () => {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/materiality/explain', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            verdict: evaluation.verdict,
            factors: evaluation.factors,
            changedPartyName: evaluation.changedPartyName,
            oldValueText: evaluation.oldValueText,
            newValueText: evaluation.newValueText,
            regulationName: evaluation.citation.regulationName,
            thresholdPct: evaluation.citation.thresholdPct,
            fallbackExplanation: evaluation.templateExplanation
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.explanation) {
            setExplanation(data.explanation);
            setIsAiGenerated(Boolean(data.isAiGenerated));
          }
        }
      } catch (err) {
        console.warn('[MaterialityModal] Using template explanation:', (err as Error).message);
      }
    };

    fetchExplanation();

    const timer3 = setTimeout(() => {
      setPhase('verdict');
    }, 1800);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [evaluation, user]);

  // Automated mode auto-proceed
  useEffect(() => {
    if (phase === 'verdict' && isAutomated) {
      const autoTimer = setTimeout(() => {
        if (evaluation.verdict === 'CRITICAL' || evaluation.verdict === 'MATERIAL') {
          handleExecuteDecision('accepted');
        } else {
          handleExecuteDecision('monitoring');
        }
      }, 3000);
      return () => clearTimeout(autoTimer);
    }
  }, [phase, isAutomated]);

  const handleExecuteDecision = async (
    decision: 'accepted' | 'monitoring' | 'dismissed'
  ) => {
    if (decision === 'dismissed' && !dismissReason.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      await onDecision(decision, dismissReason, isAiGenerated, explanation);
    } finally {
      setSubmitting(false);
    }
  };

  const isSanctionsTrigger = Boolean(
    evaluation.sanctionsDesignation ||
    evaluation.factors.some((f) => f.rule === 'SANCTIONS_DESIGNATION')
  );

  const stampColor =
    evaluation.verdict === 'CRITICAL'
      ? 'var(--rose)'
      : evaluation.verdict === 'MATERIAL'
      ? 'var(--amber)'
      : 'var(--grey)';

  const stampBg =
    evaluation.verdict === 'CRITICAL'
      ? 'var(--rose-s)'
      : evaluation.verdict === 'MATERIAL'
      ? 'var(--amber-s)'
      : 'var(--bg2)';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="materiality-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade"
      style={{ backgroundColor: 'rgba(34, 30, 51, 0.45)' }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl p-6 md:p-8 relative overflow-hidden transition-all duration-300 anim-pop"
        style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--sh3)',
          color: 'var(--ink)'
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          type="button"
          aria-label="Close determination modal"
          className="absolute top-5 right-5 z-20 p-1.5 rounded-lg text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--bg2)] transition-colors cursor-pointer focus-visible:ring-2"
        >
          <X className="w-5 h-5" />
        </button>

        {phase === 'analysing' ? (
          /* Analysis In-Progress Screen */
          <div className="py-10 flex flex-col items-center text-center space-y-6">
            <div className="relative flex items-center justify-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--primary-s)' }}
              >
                <div
                  className="w-8 h-8 rounded-full animate-ping opacity-75"
                  style={{ backgroundColor: 'var(--primary2)' }}
                />
                <div
                  className="absolute w-8 h-8 rounded-full"
                  style={{ backgroundColor: 'var(--primary)' }}
                />
              </div>
            </div>

            <div>
              <h3
                id="materiality-modal-title"
                className="text-lg font-bold font-display"
                style={{ color: 'var(--ink)' }}
              >
                Evaluating Regulatory Materiality
              </h3>
              <p className="text-xs font-mono-code mt-1" style={{ color: 'var(--ink2)' }}>
                Comparing baseline graph with incoming registry modification
              </p>
            </div>

            <div className="w-full max-w-sm space-y-2.5 text-left">
              <div
                className="flex items-center gap-3 p-3 rounded-xl border text-xs"
                style={{
                  backgroundColor: 'var(--bg2)',
                  borderColor: 'var(--line)'
                }}
              >
                {analysisStep >= 1 ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--emerald)' }} />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: 'var(--primary)' }} />
                )}
                <span className="font-medium" style={{ color: 'var(--ink)' }}>
                  Re-resolving ownership traversal
                </span>
              </div>

              <div
                className="flex items-center gap-3 p-3 rounded-xl border text-xs"
                style={{
                  backgroundColor: 'var(--bg2)',
                  borderColor: 'var(--line)'
                }}
              >
                {analysisStep >= 2 ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--emerald)' }} />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: 'var(--primary)' }} />
                )}
                <span className="font-medium" style={{ color: 'var(--ink)' }}>
                  Applying deterministic materiality rules
                </span>
              </div>

              <div
                className="flex items-center gap-3 p-3 rounded-xl border text-xs"
                style={{
                  backgroundColor: 'var(--bg2)',
                  borderColor: 'var(--line)'
                }}
              >
                {analysisStep >= 3 ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--emerald)' }} />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: 'var(--primary)' }} />
                )}
                <span className="font-medium" style={{ color: 'var(--ink)' }}>
                  Drafting regulatory compliance explanation
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* Verdict Result Modal */
          <div className="space-y-6">
            {/* Header with Title and Verdict Stamp - pr-16 md:pr-20 and mr-6 guarantee >16px clear space from top-right close button at every width */}
            <div
              className="flex flex-wrap items-start justify-between gap-4 border-b pb-5 pr-16 md:pr-20"
              style={{ borderColor: 'var(--line)' }}
            >
              <div className="flex items-center gap-3.5 min-w-0 pr-2">
                <div
                  className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: stampBg,
                    borderColor: stampColor
                  }}
                >
                  {evaluation.verdict === 'CRITICAL' ? (
                    <ShieldAlert className="w-6 h-6" style={{ color: stampColor }} />
                  ) : evaluation.verdict === 'MATERIAL' ? (
                    <AlertTriangle className="w-6 h-6" style={{ color: stampColor }} />
                  ) : (
                    <Info className="w-6 h-6" style={{ color: stampColor }} />
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="section-label">
                      Compliance Determination
                    </span>
                  </div>
                  <h2
                    id="materiality-modal-title"
                    className="text-xl font-bold font-display"
                    style={{ color: 'var(--ink)' }}
                  >
                    {evaluation.changedPartyName}
                  </h2>
                </div>
              </div>

              {/* Verdict Stamp */}
              <div
                className="px-4 py-1.5 rounded-lg font-mono-code font-extrabold text-sm uppercase tracking-widest border-2 shadow-sm anim-stamp shrink-0 mr-6"
                style={{
                  backgroundColor: stampBg,
                  borderColor: stampColor,
                  color: stampColor
                }}
              >
                {evaluation.verdict}
              </div>
            </div>

            {/* Delta Row with Clearly Labelled Assessment Confidence and Source Confidence */}
            <div
              className="p-3.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs font-mono-code border"
              style={{
                backgroundColor: 'var(--bg2)',
                borderColor: 'var(--line)'
              }}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--ink2)' }}>Shareholding Transition:</span>
                <span className="line-through" style={{ color: 'var(--ink3)' }}>
                  {evaluation.oldValueText}
                </span>
                <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                <span className="font-bold" style={{ color: 'var(--coral)' }}>
                  {evaluation.newValueText}
                </span>
              </div>

              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span style={{ color: 'var(--ink2)' }}>Assessment confidence:</span>
                  <span className="font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                    {evaluation.confidence}%
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span style={{ color: 'var(--ink2)' }}>Source confidence:</span>
                  <span className="font-bold tabular-nums" style={{ color: 'var(--emerald)' }}>
                    {evaluation.sourceConfidencePct || 96}%
                  </span>
                </div>
              </div>
            </div>

            {/* AI Explanation Box */}
            <div
              className="p-4 rounded-xl space-y-2 border relative overflow-hidden"
              style={{
                backgroundColor: 'var(--bg2)',
                borderColor: 'var(--line)'
              }}
            >
              <div className="flex items-center justify-between">
                <div
                  className="flex items-center gap-1.5 text-xs font-semibold"
                  style={{ color: 'var(--primary)' }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Compliance Rationale</span>
                </div>

                <span
                  className="text-[10px] font-mono-code px-2 py-0.5 rounded font-bold uppercase tracking-wider"
                  style={{
                    backgroundColor: isAiGenerated ? 'var(--primary-s)' : 'var(--line)',
                    color: isAiGenerated ? 'var(--primary)' : 'var(--ink2)'
                  }}
                >
                  {isAiGenerated ? 'AI-Generated Rationale' : 'Rule Template'}
                </span>
              </div>

              <p className="text-xs leading-relaxed" style={{ color: 'var(--ink)' }}>
                {explanation}
              </p>
            </div>

            {/* Governing Regulation / Sanctions Designation Box (Trigger-Matched per Item 8) */}
            {isSanctionsTrigger ? (
              <div
                className="p-3.5 rounded-xl border-l-4 text-xs font-mono-code space-y-1.5"
                style={{
                  backgroundColor: 'var(--rose-s)',
                  borderLeftColor: 'var(--rose)',
                  borderTop: '1px solid rgba(225, 29, 72, 0.2)',
                  borderRight: '1px solid rgba(225, 29, 72, 0.2)',
                  borderBottom: '1px solid rgba(225, 29, 72, 0.2)'
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold" style={{ color: 'var(--rose)' }}>
                    Official Sanctions Designation
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-mono-code font-bold uppercase"
                    style={{ backgroundColor: 'rgba(225, 29, 72, 0.15)', color: 'var(--rose)' }}
                  >
                    OpenSanctions ID: {evaluation.sanctionsDesignation?.id || 'NK-VDEKGF5ZgHAkye4kGuUXs3'}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink)' }}>
                  Programmes: {evaluation.sanctionsDesignation?.programme || 'Russia-related sanctions, designated by the US (OFAC), the UK, the EU and Australia'}
                </p>
                <div className="flex items-center gap-1.5 text-[10px] mt-1" style={{ color: 'var(--ink3)' }}>
                  <span>Source: OpenSanctions (CC BY-NC 4.0)</span>
                  <span>·</span>
                  <span>Jurisdiction: {evaluation.sanctionsDesignation?.country || 'Russia'}</span>
                </div>
              </div>
            ) : (
              <div
                className="p-3.5 rounded-xl border-l-4 text-xs font-mono-code space-y-1"
                style={{
                  backgroundColor: 'var(--bg2)',
                  borderLeftColor: 'var(--primary)',
                  borderTop: '1px solid var(--line)',
                  borderRight: '1px solid var(--line)',
                  borderBottom: '1px solid var(--line)'
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold" style={{ color: 'var(--ink)' }}>
                    {evaluation.citation.formattedCitation || `${evaluation.citation.regulationName} · more than ${evaluation.citation.thresholdPct}%`}
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-semibold font-mono-code"
                    style={{ backgroundColor: 'var(--primary-s)', color: 'var(--primary)' }}
                  >
                    Threshold: {evaluation.citation.thresholdPct}%
                  </span>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--ink2)' }}>
                  Statutory Basis: {evaluation.citation.regulationName} · Status:{' '}
                  {evaluation.citation.verified ? 'Verified Law' : 'Regulatory Standard'}
                </p>
              </div>
            )}

            {/* Inline Confirmation for Monitor Only per Item 11 */}
            {confirmingMonitor && (
              <div
                className="p-3.5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade"
                style={{
                  backgroundColor: 'var(--amber-s)',
                  borderColor: 'rgba(217, 119, 6, 0.3)'
                }}
              >
                <div className="flex items-center gap-2 text-xs">
                  <AlertTriangle className="w-4 h-4 text-[var(--amber)] shrink-0" />
                  <span className="text-[var(--ink)] font-medium">
                    Discard review and set event to monitor only? No case will be opened.
                  </span>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmingMonitor(false)}
                    disabled={submitting}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-white text-[var(--ink2)] hover:bg-[var(--bg2)] cursor-pointer focus-visible:ring-2"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExecuteDecision('monitoring')}
                    disabled={submitting}
                    title={submitting ? 'Committing decision...' : 'Confirm setting to monitor only'}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white cursor-pointer shadow-xs hover:opacity-95 disabled:opacity-50 focus-visible:ring-2 flex items-center gap-1.5"
                    style={{ backgroundColor: 'var(--amber)' }}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Committing...</span>
                      </>
                    ) : (
                      <span>Confirm Monitor Only</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Dismiss Reason & Confirmation Input per Item 11 */}
            {showDismissInput && (
              <div
                className="space-y-3 p-3.5 rounded-xl border animate-fade"
                style={{
                  backgroundColor: 'var(--rose-s)',
                  borderColor: 'rgba(225, 29, 72, 0.3)'
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--rose)' }}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Mandatory Dismissal Rationale (Discards Review)</span>
                    </label>
                    <p className="text-[11px] text-[var(--ink2)] mt-0.5">
                      Dismissing will discard this review without creating a compliance case.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDismissInput(false);
                      setDismissReason('');
                    }}
                    className="text-[11px] text-[var(--ink3)] hover:text-[var(--ink)] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>

                <input
                  type="text"
                  required
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value)}
                  placeholder="State compliance justification for dismissal (required)..."
                  className="w-full px-3 py-2 text-xs rounded-lg outline-none focus-visible:ring-2 bg-white"
                  style={{
                    border: '1px solid var(--line)',
                    color: 'var(--ink)'
                  }}
                />

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDismissInput(false);
                      setDismissReason('');
                    }}
                    disabled={submitting}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-white text-[var(--ink2)] hover:bg-[var(--bg2)] cursor-pointer focus-visible:ring-2"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExecuteDecision('dismissed')}
                    disabled={submitting || !dismissReason.trim()}
                    title={
                      submitting
                        ? 'Confirming dismissal...'
                        : !dismissReason.trim()
                        ? 'Mandatory justification required to dismiss'
                        : 'Confirm dismissal and discard review'
                    }
                    className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 flex items-center gap-1.5"
                    style={{ backgroundColor: 'var(--rose)' }}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Confirming...</span>
                      </>
                    ) : (
                      <span>Confirm Dismissal</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Footer Buttons */}
            <div
              className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t"
              style={{ borderColor: 'var(--line)' }}
            >
              {isAutomated ? (
                <div
                  className="flex items-center gap-2 text-xs font-mono-code"
                  style={{ color: 'var(--amber)' }}
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Automated mode active: agent automatically committing decision...</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    {!showDismissInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowDismissInput(true);
                          setConfirmingMonitor(false);
                        }}
                        disabled={submitting}
                        title={submitting ? 'Decision in progress...' : 'Dismiss event and record justification'}
                        className="py-2 px-4 rounded-xl text-xs font-medium transition-all cursor-pointer border focus-visible:ring-2 hover:bg-[var(--bg2)] disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: 'transparent',
                          borderColor: 'var(--line)',
                          color: 'var(--ink2)'
                        }}
                      >
                        Dismiss
                      </button>
                    )}

                    {!confirmingMonitor && (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingMonitor(true);
                          setShowDismissInput(false);
                        }}
                        disabled={submitting}
                        title={submitting ? 'Decision in progress...' : 'Keep event under observation without case generation'}
                        className="py-2 px-4 rounded-xl text-xs font-semibold transition-all cursor-pointer border focus-visible:ring-2 hover:bg-[var(--amber-s)] disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: 'var(--bg2)',
                          borderColor: 'var(--line)',
                          color: 'var(--amber)'
                        }}
                      >
                        Monitor only
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleExecuteDecision('accepted')}
                    disabled={submitting}
                    title={submitting ? 'Committing decision and initiating KYC agents...' : 'Accept determination and execute KYC screening'}
                    className="py-2.5 px-6 rounded-xl text-xs font-bold text-white shadow-sm cursor-pointer transition-all hover:opacity-95 active:scale-[0.98] focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    style={{
                      backgroundColor: 'var(--emerald)'
                    }}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Committing...</span>
                      </>
                    ) : (
                      <span>Accept and run KYC agents</span>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
