/**
 * Sentinel AI — Cases View (Phase 4)
 * Table of PKYC and ONBOARDING compliance cases with search and filter chips.
 * Case detail view with trigger delta, materiality verdict, screening agent cards,
 * persons in scope, case audit trail, and four-eyes case closure.
 */

import React, { useState, useEffect } from 'react';
import { db, writeAuditRecord, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, onSnapshot, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { ComplianceCaseRecord } from '../engine/screeningOrchestrator';
import {
  Briefcase,
  Search,
  Filter,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  Clock,
  AlertTriangle,
  User,
  CheckCircle2,
  Lock,
  ArrowLeft,
  ExternalLink,
  Sparkles,
  FileText,
  Archive,
  RotateCcw
} from 'lucide-react';
import { BodsPerson } from '../types/bods';
import { bodsRepository } from '../data/repository';
import { ArticleReaderModal } from './ArticleReaderModal';

interface CasesViewProps {
  onOpenCustomerWorkspace: (groupId: string, customerId: string) => void;
  onOpenDossier?: (person: BodsPerson) => void;
  initialCaseId?: string | null;
}

export const CasesView: React.FC<CasesViewProps> = ({
  onOpenCustomerWorkspace,
  onOpenDossier,
  initialCaseId
}) => {
  const { user, profile, isSupervisor } = useAuth();
  const [cases, setCases] = useState<ComplianceCaseRecord[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(initialCaseId || null);

  useEffect(() => {
    setSelectedCaseId(initialCaseId || null);
  }, [initialCaseId]);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'PKYC' | 'ONBOARDING'>('ALL');
  const [stateFilter, setStateFilter] = useState<'ALL' | 'open' | 'closed'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CRITICAL' | 'STANDARD' | 'CLEAR'>('ALL');
  const [showArchived, setShowArchived] = useState(false);

  // Case closing state
  const [closing, setClosing] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);

  // Case archiving state (Supervisor-only)
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // Case restoring state (Supervisor-only)
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreReason, setRestoreReason] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Article reader modal
  const [readingArticleId, setReadingArticleId] = useState<string | null>(null);
  const [highlightQuote, setHighlightQuote] = useState<string | undefined>(undefined);

  // Real-time Firestore cases listener
  useEffect(() => {
    if (!user) return;
    const casesCol = collection(db, 'cases');
    const q = query(casesCol);
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: ComplianceCaseRecord[] = [];
        snapshot.forEach((snap) => {
          list.push(snap.data() as ComplianceCaseRecord);
        });
        // Sort newest first
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setCases(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'cases');
      }
    );
    return () => unsubscribe();
  }, [user]);

  const [fetchedCase, setFetchedCase] = useState<ComplianceCaseRecord | null>(null);

  useEffect(() => {
    if (!selectedCaseId) {
      setFetchedCase(null);
      return;
    }
    const found = cases.find((c) => c.id === selectedCaseId || c.caseId === selectedCaseId);
    if (found) {
      setFetchedCase(null);
      return;
    }
    let active = true;
    getDoc(doc(db, 'cases', selectedCaseId)).then((snap) => {
      if (active && snap.exists()) {
        setFetchedCase(snap.data() as ComplianceCaseRecord);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [selectedCaseId, cases]);

  const selectedCase = cases.find((c) => c.id === selectedCaseId || c.caseId === selectedCaseId) || fetchedCase;

  // Filter cases safely handling null properties from Firestore
  const filteredCases = cases.filter((c) => {
    if (!showArchived && c.archived) return false;
    if (typeFilter !== 'ALL' && c.type !== typeFilter) return false;
    if (stateFilter !== 'ALL' && c.state !== stateFilter) return false;
    if (statusFilter !== 'ALL' && c.overallStatus !== statusFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = ((c.id || c.caseId || '') as string).toLowerCase().includes(q);
      const matchCustomer = ((c.customerId || '') as string).toLowerCase().includes(q);
      const matchGroup = ((c.groupName || '') as string).toLowerCase().includes(q);
      const matchAnalyst = ((c.analystName || '') as string).toLowerCase().includes(q);
      const matchSummary = ((c.triggerSummary || '') as string).toLowerCase().includes(q);
      const matchArchiveReason = c.archiveReason ? c.archiveReason.toLowerCase().includes(q) : false;
      if (!matchId && !matchCustomer && !matchGroup && !matchAnalyst && !matchSummary && !matchArchiveReason) return false;
    }
    return true;
  });

  // Four-eyes check for closing
  const canCloseCase = (caseItem: ComplianceCaseRecord): { allowed: boolean; reason?: string } => {
    if (caseItem.state === 'closed') {
      return { allowed: false, reason: 'Case is already closed.' };
    }
    if (caseItem.overallStatus === 'CRITICAL') {
      if (!isSupervisor) {
        return {
          allowed: false,
          reason: 'Four-eyes rule: CRITICAL cases require a Supervisor to close.'
        };
      }
      if (user && (caseItem.analystUid === user.uid || caseItem.triggerEvent?.decidedBy === user.uid)) {
        return {
          allowed: false,
          reason: 'Four-eyes rule: a different supervisor must close this case.'
        };
      }
    }
    return { allowed: true };
  };

  const handleCloseCase = async () => {
    if (!selectedCase || !user) return;
    const check = canCloseCase(selectedCase);
    if (!check.allowed) {
      setCloseError(check.reason || 'Permission denied.');
      return;
    }

    if (!resolutionNote.trim() || resolutionNote.trim().length < 5) {
      setCloseError('A written resolution note (minimum 5 characters) is required to close this case.');
      return;
    }

    setClosing(true);
    setCloseError(null);

    try {
      const caseDocRef = doc(db, 'cases', selectedCase.id);
      const closerName = (profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Analyst').slice(0, 120);
      await updateDoc(caseDocRef, {
        state: 'closed',
        resolutionNote: resolutionNote.trim(),
        closedBy: user.uid,
        closedByName: closerName,
        closedAt: serverTimestamp()
      });

      // Audit case closure
      await writeAuditRecord({
        actorUid: user.uid,
        actorType: 'HUMAN',
        actorName: closerName,
        action: 'CASE_CLOSED',
        summary: `Closed compliance case ${selectedCase.id} with resolution note.`,
        customerId: selectedCase.customerId,
        groupId: selectedCase.groupId,
        caseId: selectedCase.id,
        details: {
          caseId: selectedCase.id,
          resolutionNote: resolutionNote.trim(),
          overallStatus: selectedCase.overallStatus
        }
      });

      setResolutionNote('');
    } catch (err: any) {
      console.error('Error closing case:', err);
      const isPermission = err?.code === 'permission-denied' || err?.message?.includes('Missing or insufficient permissions');
      if (isPermission) {
        if (selectedCase.overallStatus === 'CRITICAL' && selectedCase.analystUid === user.uid) {
          setCloseError('Four-eyes rule: a different supervisor must close this case.');
        } else {
          setCloseError('Permission denied: You do not have authorization to close this case under the four-eyes compliance policy.');
        }
      } else {
        setCloseError(err?.message || 'Failed to close case.');
      }
    } finally {
      setClosing(false);
    }
  };

  const handleArchiveCase = async () => {
    if (!selectedCase || !user || !isSupervisor) return;
    if (!archiveReason.trim() || archiveReason.trim().length < 5) {
      setArchiveError('A written reason for archiving (minimum 5 characters) is required.');
      return;
    }

    setArchiving(true);
    setArchiveError(null);

    try {
      const caseDocRef = doc(db, 'cases', selectedCase.id);
      const archiverName = (profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Supervisor').slice(0, 120);
      await updateDoc(caseDocRef, {
        archived: true,
        archivedBy: user.uid,
        archivedByName: archiverName,
        archivedAt: serverTimestamp(),
        archiveReason: archiveReason.trim()
      });

      await writeAuditRecord({
        actorUid: user.uid,
        actorType: 'HUMAN',
        actorName: archiverName,
        action: 'CASE_ARCHIVED',
        summary: `Archived compliance case ${selectedCase.id}. Reason: ${archiveReason.trim()}`,
        customerId: selectedCase.customerId,
        groupId: selectedCase.groupId,
        caseId: selectedCase.id,
        details: {
          caseId: selectedCase.id,
          archiveReason: archiveReason.trim(),
          archivedBy: user.uid
        }
      });

      setShowArchiveModal(false);
      setArchiveReason('');
    } catch (err: any) {
      console.error('Error archiving case:', err);
      const isPermission = err?.code === 'permission-denied' || err?.message?.includes('Missing or insufficient permissions');
      if (isPermission) {
        setArchiveError('Permission denied: Case archiving is restricted to compliance supervisors.');
      } else {
        setArchiveError(err?.message || 'Failed to archive case.');
      }
    } finally {
      setArchiving(false);
    }
  };

  const handleRestoreCase = async () => {
    if (!selectedCase || !user || !isSupervisor) return;
    if (!restoreReason.trim() || restoreReason.trim().length < 5) {
      setRestoreError('A written reason for restoring (minimum 5 characters) is required.');
      return;
    }

    setRestoring(true);
    setRestoreError(null);

    try {
      const caseDocRef = doc(db, 'cases', selectedCase.id);
      const restorerName = (profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Supervisor').slice(0, 120);
      await updateDoc(caseDocRef, {
        archived: false,
        restoredBy: user.uid,
        restoredByName: restorerName,
        restoredAt: serverTimestamp(),
        restoreReason: restoreReason.trim()
      });

      await writeAuditRecord({
        actorUid: user.uid,
        actorType: 'HUMAN',
        actorName: restorerName,
        action: 'CASE_RESTORED',
        summary: `Restored compliance case ${selectedCase.id}. Reason: ${restoreReason.trim()}`,
        customerId: selectedCase.customerId,
        groupId: selectedCase.groupId,
        caseId: selectedCase.id,
        details: {
          caseId: selectedCase.id,
          restoreReason: restoreReason.trim(),
          restoredBy: user.uid
        }
      });

      setShowRestoreModal(false);
      setRestoreReason('');
    } catch (err: any) {
      console.error('Error restoring case:', err);
      const isPermission = err?.code === 'permission-denied' || err?.message?.includes('Missing or insufficient permissions');
      if (isPermission) {
        setRestoreError('Permission denied: Case restoration is restricted to compliance supervisors.');
      } else {
        setRestoreError(err?.message || 'Failed to restore case.');
      }
    } finally {
      setRestoring(false);
    }
  };

  // -------------------------------------------------------------
  // DETAIL VIEW
  // -------------------------------------------------------------
  if (selectedCase) {
    const closeCheck = canCloseCase(selectedCase);
    const isCritical = selectedCase.overallStatus === 'CRITICAL';
    const isStandard = selectedCase.overallStatus === 'STANDARD';

    const statusDotColor = isCritical
      ? 'var(--rose)'
      : isStandard
      ? 'var(--amber)'
      : 'var(--emerald)';

    return (
      <div className="h-full w-full overflow-y-auto px-6 md:px-8 py-7 anim-vin select-text">
        <ArticleReaderModal
          articleId={readingArticleId}
          highlightQuote={highlightQuote}
          onClose={() => {
            setReadingArticleId(null);
            setHighlightQuote(undefined);
          }}
        />

        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--line)]">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSelectedCaseId(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center border hover:bg-[var(--bg2)] transition-colors cursor-pointer focus-visible:ring-2"
                style={{ borderColor: 'var(--line)', color: 'var(--ink2)' }}
                aria-label="Back to Cases List"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>

              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono-code font-bold text-lg text-[var(--ink)]">
                    {selectedCase.id}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono-code font-semibold border"
                    style={{
                      backgroundColor: 'var(--bg2)',
                      borderColor: 'var(--line)',
                      color: 'var(--ink2)'
                    }}
                  >
                    {selectedCase.type}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider flex items-center gap-1.5 border"
                    style={{
                      backgroundColor: 'var(--bg2)',
                      borderColor: 'var(--line)',
                      color: 'var(--ink2)'
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusDotColor }} />
                    <span>{selectedCase.overallStatus}</span>
                  </span>
                  <span
                    className="text-[11px] font-mono-code font-semibold uppercase px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: selectedCase.state === 'open' ? 'var(--amber-s)' : 'var(--bg2)',
                      color: selectedCase.state === 'open' ? 'var(--amber)' : 'var(--ink3)'
                    }}
                  >
                    {selectedCase.state}
                  </span>
                </div>

                <div className="text-xs text-[var(--ink2)] mt-0.5">
                  Client: <strong className="text-[var(--ink)]">{selectedCase.groupName}</strong> · Customer ID: <span className="font-mono-code">{selectedCase.customerId}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isSupervisor && !selectedCase.archived && (
                <button
                  type="button"
                  onClick={() => {
                    setShowArchiveModal(true);
                    setArchiveReason('');
                    setArchiveError(null);
                  }}
                  className="py-2 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border shadow-sm transition-all cursor-pointer bg-[var(--card)] hover:bg-[var(--bg2)] text-[var(--ink)] border-[var(--line)] focus-visible:ring-2"
                >
                  <Archive className="w-3.5 h-3.5 text-[var(--ink2)]" />
                  <span>Archive case</span>
                </button>
              )}

              {isSupervisor && selectedCase.archived && (
                <button
                  type="button"
                  onClick={() => {
                    setShowRestoreModal(true);
                    setRestoreReason('');
                    setRestoreError(null);
                  }}
                  className="py-2 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border shadow-sm transition-all cursor-pointer bg-[var(--card)] hover:bg-[var(--bg2)] text-[var(--primary)] border-[var(--line)] focus-visible:ring-2"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[var(--primary)]" />
                  <span>Restore case</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onOpenCustomerWorkspace(selectedCase.groupId, selectedCase.customerId)}
                className="py-2 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-2 border shadow-sm transition-all cursor-pointer hover:bg-[var(--bg2)] focus-visible:ring-2"
                style={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--line)',
                  color: 'var(--primary)'
                }}
              >
                <span>Open ownership tree</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Archive / Restore History Banner */}
          {(selectedCase.archived || selectedCase.archivedBy || selectedCase.restoredBy) && (
            <div className="p-4 rounded-xl border space-y-3 bg-amber-500/10 border-amber-500/30 text-[var(--ink)]">
              {selectedCase.archived && (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Archive className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400">Archived Compliance Record</span>
                        <span className="text-xs text-[var(--ink2)]">
                          Archived by <strong className="text-[var(--ink)]">{selectedCase.archivedByName || selectedCase.archivedBy}</strong>
                          {selectedCase.archivedAt && ` on ${new Date(selectedCase.archivedAt).toLocaleDateString('en-GB')}`}
                        </span>
                      </div>
                      {selectedCase.archiveReason && (
                        <div className="text-xs text-[var(--ink)] font-mono-code">
                          <strong className="font-semibold">Archive Reason:</strong> {selectedCase.archiveReason}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSupervisor && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowRestoreModal(true);
                        setRestoreReason('');
                        setRestoreError(null);
                      }}
                      className="py-1.5 px-3 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:opacity-95 shrink-0"
                      style={{ backgroundColor: 'var(--primary)' }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore case</span>
                    </button>
                  )}
                </div>
              )}

              {!selectedCase.archived && selectedCase.archivedBy && (
                <div className="p-3 rounded-lg border bg-[var(--card)] border-[var(--line)] text-xs space-y-1.5">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold uppercase tracking-wider text-[11px]">
                    <Archive className="w-3.5 h-3.5" />
                    <span>Archived History</span>
                  </div>
                  <div className="text-[var(--ink2)]">
                    Archived by <strong className="text-[var(--ink)]">{selectedCase.archivedByName || selectedCase.archivedBy}</strong>
                    {selectedCase.archivedAt && ` on ${new Date(selectedCase.archivedAt).toLocaleDateString('en-GB')}`}
                  </div>
                  {selectedCase.archiveReason && (
                    <div className="font-mono-code text-[var(--ink)]">
                      <strong className="font-semibold">Reason:</strong> {selectedCase.archiveReason}
                    </div>
                  )}
                </div>
              )}

              {selectedCase.restoredBy && (
                <div className="p-3 rounded-lg border bg-[var(--card)] border-[var(--line)] text-xs space-y-1.5">
                  <div className="flex items-center gap-2 text-[var(--emerald)] font-bold uppercase tracking-wider text-[11px]">
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restoration History</span>
                  </div>
                  <div className="text-[var(--ink2)]">
                    Restored by <strong className="text-[var(--ink)]">{selectedCase.restoredByName || selectedCase.restoredBy}</strong>
                    {selectedCase.restoredAt && ` on ${new Date(selectedCase.restoredAt).toLocaleDateString('en-GB')}`}
                  </div>
                  {selectedCase.restoreReason && (
                    <div className="font-mono-code text-[var(--ink)]">
                      <strong className="font-semibold">Reason:</strong> {selectedCase.restoreReason}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Trigger Section */}
          <div
            className="p-4 rounded-xl border space-y-2"
            style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
          >
            <span className="section-label">Case Intake &amp; Trigger Context</span>
            {selectedCase.type === 'PKYC' && selectedCase.triggerEvent ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono-code pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--ink3)]">Shareholding delta:</span>
                  <span className="line-through text-[var(--ink3)]">
                    {selectedCase.triggerEvent.payload?.oldValueText || 'Prior stake'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--primary)]" />
                  <span className="font-bold text-[var(--coral)]">
                    {selectedCase.triggerEvent.payload?.newValueText || selectedCase.triggerEvent.description}
                  </span>
                </div>
                <div className="text-[var(--ink3)] text-[11px]">
                  Detected: {new Date(selectedCase.triggerEvent.detectedAt || selectedCase.createdAt).toLocaleString('en-GB')}
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--ink)]">
                Onboarding due diligence triggered by analyst <strong className="font-medium">{selectedCase.analystName}</strong> at intake.
              </p>
            )}
          </div>

          {/* Materiality Verdict (PKYC only) */}
          {selectedCase.type === 'PKYC' && selectedCase.materialityVerdict && (
            <div
              className="p-4 rounded-xl border space-y-3"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div className="flex items-center justify-between">
                <span className="section-label">Materiality Determination</span>
                <span
                  className="px-3 py-1 rounded font-mono-code font-extrabold text-xs uppercase tracking-wider border"
                  style={{
                    backgroundColor: selectedCase.materialityVerdict === 'CRITICAL' ? 'var(--rose-s)' : 'var(--amber-s)',
                    borderColor: selectedCase.materialityVerdict === 'CRITICAL' ? 'var(--rose)' : 'var(--amber)',
                    color: selectedCase.materialityVerdict === 'CRITICAL' ? 'var(--rose)' : 'var(--amber)'
                  }}
                >
                  {selectedCase.materialityVerdict}
                </span>
              </div>

              {selectedCase.materialityExplanation && (
                <div className="p-3 rounded-lg border text-xs leading-relaxed" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-[var(--primary)] flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Regulatory Compliance Rationale</span>
                    </span>
                    <span className="text-[10px] font-mono-code px-1.5 py-0.2 rounded border bg-[var(--card)] text-[var(--ink2)]">
                      {selectedCase.isAiExplanation ? 'AI-Generated' : 'Rule Template'}
                    </span>
                  </div>
                  <p className="text-[var(--ink)]">{selectedCase.materialityExplanation}</p>
                </div>
              )}
            </div>
          )}

          {/* Screening Agents Overview */}
          <div
            className="p-4 rounded-xl border space-y-3"
            style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
          >
            <span className="section-label">Screening Agent Outcomes</span>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
              <div className="p-3 rounded-lg border text-xs" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                <div className="text-[10px] font-mono-code text-[var(--ink3)]">SANCTIONS</div>
                <div className="font-bold font-mono-code mt-1 text-[var(--ink)]">{selectedCase.screeningSummary.sanctionsOutcome}</div>
              </div>
              <div className="p-3 rounded-lg border text-xs" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                <div className="text-[10px] font-mono-code text-[var(--ink3)]">PEP EXPOSURE</div>
                <div className="font-bold font-mono-code mt-1 text-[var(--ink)]">{selectedCase.screeningSummary.pepOutcome}</div>
              </div>
              <div className="p-3 rounded-lg border text-xs" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                <div className="text-[10px] font-mono-code text-[var(--ink3)]">ADVERSE MEDIA</div>
                <div className="font-bold font-mono-code mt-1 text-[var(--ink)]">{selectedCase.screeningSummary.adverseMediaOutcome}</div>
              </div>
              <div className="p-3 rounded-lg border text-xs" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                <div className="text-[10px] font-mono-code text-[var(--ink3)]">OWNERSHIP INTEGRITY</div>
                <div className="font-bold font-mono-code mt-1 text-[var(--ink)]">{selectedCase.screeningSummary.integrityOutcome}</div>
              </div>
            </div>
          </div>

          {/* Persons in Scope Table */}
          <div
            className="p-4 rounded-xl border space-y-3"
            style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
          >
            <div className="flex items-center justify-between">
              <span className="section-label">Beneficial Owners in Scope ({selectedCase.personsInScope.length})</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[10px] uppercase font-mono-code text-[var(--ink3)]" style={{ borderColor: 'var(--line)' }}>
                    <th className="pb-2">Natural Person</th>
                    <th className="pb-2">Nationality</th>
                    <th className="pb-2">Effective Stake</th>
                    <th className="pb-2">PEP Status</th>
                    <th className="pb-2">Screening</th>
                    <th className="pb-2 text-right">Dossier</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--line2)' }}>
                  {selectedCase.personsInScope.map((p) => (
                    <tr key={p.id} className="hover:bg-[var(--bg2)] transition-colors">
                      <td className="py-2.5 font-medium text-[var(--ink)]">{p.name}</td>
                      <td className="py-2.5 text-[var(--ink2)]">{p.nationality}</td>
                      <td className="py-2.5 font-mono-code text-[var(--ink)]">{p.effectiveRangeText} ({p.classification})</td>
                      <td className="py-2.5 font-mono-code capitalize text-[var(--ink2)]">{p.pepStatus}</td>
                      <td className="py-2.5">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-mono-code font-bold uppercase"
                          style={{
                            backgroundColor: p.outcome === 'HIT' ? 'var(--rose-s)' : p.outcome === 'REVIEW' ? 'var(--amber-s)' : 'var(--emerald-s)',
                            color: p.outcome === 'HIT' ? 'var(--rose)' : p.outcome === 'REVIEW' ? 'var(--amber)' : 'var(--emerald)'
                          }}
                        >
                          {p.outcome}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        {onOpenDossier && (
                          <button
                            type="button"
                            onClick={() => {
                              const fullPerson = bodsRepository.getGroupById(selectedCase.groupId)?.persons.find((per) => per.id === p.id);
                              onOpenDossier(fullPerson || {
                                id: p.id,
                                name: p.name,
                                initials: p.name.split(' ').map((n: string) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'BO',
                                nationality: p.nationality,
                                flag: p.nationality?.includes('Cyprus') ? '🇨🇾' : p.nationality?.includes('United Kingdom') ? '🇬🇧' : '🌐',
                                yearOfBirth: 1970,
                                pepStatus: p.pepStatus as any,
                                synthetic: true
                              });
                            }}
                            className="px-2 py-1 rounded text-[11px] font-semibold text-[var(--primary)] hover:bg-[var(--primary-s)] transition-colors cursor-pointer"
                          >
                            Dossier →
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Case Resolution / Closing Section */}
          <div
            className="p-5 rounded-xl border space-y-4"
            style={{
              backgroundColor: 'var(--card)',
              borderColor: 'var(--line)'
            }}
          >
            <div className="flex items-center justify-between">
              <span className="section-label">Case Governance &amp; Resolution</span>
              {selectedCase.state === 'closed' ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    Closed by{' '}
                    {(selectedCase as any).closedByName ||
                      (selectedCase.closedBy &&
                      !selectedCase.closedBy.includes('usr-') &&
                      !selectedCase.closedBy.includes('auth0') &&
                      !selectedCase.closedBy.includes('usr_') &&
                      selectedCase.closedBy.length < 20
                        ? selectedCase.closedBy
                        : selectedCase.analystName || 'Analyst')}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-xs text-amber-700">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Four-Eyes Governance Active</span>
                </div>
              )}
            </div>

            {selectedCase.state === 'closed' ? (
              <div className="p-3.5 rounded-lg border text-xs space-y-1.5" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                <div className="font-semibold text-[var(--ink)]">Resolution Note:</div>
                <p className="text-[var(--ink2)] leading-relaxed">{selectedCase.resolutionNote}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {!closeCheck.allowed && (
                  <div className="p-3 rounded-lg border text-xs flex items-center gap-2 text-amber-800 bg-amber-50 border-amber-200">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{closeCheck.reason}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--ink)]">
                    Resolution Note <span className="text-[var(--coral)]">*</span>
                  </label>
                  <textarea
                    rows={3}
                    disabled={!closeCheck.allowed || closing}
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    placeholder="Enter compliance resolution rationale, risk acceptance notes, and statutory evidence references..."
                    className="w-full p-3 text-xs rounded-lg border outline-none transition-colors focus-visible:ring-2 disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--bg2)',
                      borderColor: 'var(--line)',
                      color: 'var(--ink)'
                    }}
                  />
                </div>

                {closeError && (
                  <p className="text-xs text-[var(--rose)] font-medium">{closeError}</p>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!closeCheck.allowed || closing || !resolutionNote.trim()}
                    onClick={handleCloseCase}
                    className="py-2 px-4 rounded-xl text-xs font-bold text-white flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2"
                    style={{ backgroundColor: 'var(--primary)' }}
                  >
                    <span>{closing ? 'Recording Resolution...' : 'Close Case with Resolution'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Archive Case Modal (Supervisor-only) */}
        {showArchiveModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          >
            <div
              className="w-full max-w-md rounded-2xl border p-6 space-y-4 shadow-xl"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-500/10 text-amber-600">
                  <Archive className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="archive-modal-title" className="font-display font-bold text-base text-[var(--ink)]">
                    Archive Case {selectedCase.id}
                  </h3>
                  <p className="text-xs text-[var(--ink2)]">
                    Archiving removes this case from the default cases list. It remains permanently stored in compliance records.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ink)]">
                  Archive Reason <span className="text-[var(--coral)]">*</span>
                </label>
                <textarea
                  rows={3}
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  placeholder="Enter supervisor rationale for archiving this case (minimum 5 characters)..."
                  className="w-full p-3 text-xs rounded-xl border outline-none focus-visible:ring-2"
                  style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                />
              </div>

              {archiveError && (
                <p className="text-xs text-[var(--rose)] font-medium">{archiveError}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--line)]">
                <button
                  type="button"
                  disabled={archiving}
                  onClick={() => setShowArchiveModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border hover:bg-[var(--bg2)] cursor-pointer"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink2)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={archiving || !archiveReason.trim() || archiveReason.trim().length < 5}
                  onClick={handleArchiveCase}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {archiving ? 'Archiving...' : 'Confirm Archive'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Restore Case Modal (Supervisor-only) */}
        {showRestoreModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          >
            <div
              className="w-full max-w-md rounded-2xl border p-6 space-y-4 shadow-xl"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-500/10 text-[var(--primary)]">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="restore-modal-title" className="font-display font-bold text-base text-[var(--ink)]">
                    Restore Case {selectedCase.id}
                  </h3>
                  <p className="text-xs text-[var(--ink2)]">
                    Restoring returns this case to the default compliance cases list and clears its archived status.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ink)]">
                  Restore Reason <span className="text-[var(--coral)]">*</span>
                </label>
                <textarea
                  rows={3}
                  value={restoreReason}
                  onChange={(e) => setRestoreReason(e.target.value)}
                  placeholder="Enter supervisor rationale for restoring this case to active list (minimum 5 characters)..."
                  className="w-full p-3 text-xs rounded-xl border outline-none focus-visible:ring-2"
                  style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                />
              </div>

              {restoreError && (
                <p className="text-xs text-[var(--rose)] font-medium">{restoreError}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--line)]">
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => setShowRestoreModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border hover:bg-[var(--bg2)] cursor-pointer"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink2)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={restoring || !restoreReason.trim() || restoreReason.trim().length < 5}
                  onClick={handleRestoreCase}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {restoring ? 'Restoring...' : 'Confirm Restore'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // LIST VIEW
  // -------------------------------------------------------------
  return (
    <div className="h-full w-full overflow-y-auto px-6 md:px-8 py-7 anim-vin select-text">
      <div className="max-w-[1360px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-2 border-b border-[var(--line)]">
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="section-label">Compliance Lifecycle Management</span>
              <span
                className="px-2 py-0.5 rounded text-[10px] font-mono-code font-semibold border"
                style={{
                  backgroundColor: 'var(--bg2)',
                  borderColor: 'var(--line)',
                  color: 'var(--ink2)'
                }}
              >
                Cases
              </span>
            </div>
            <h1 className="font-display font-bold text-2xl tracking-tight text-[var(--ink)]">
              Compliance Cases
            </h1>
            <p className="text-sm leading-relaxed text-[var(--ink2)]">
              Auditable case docket for Onboarding Due Diligence and Perpetual KYC (PKYC) material adverse changes.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <div
              className="px-3 py-1.5 rounded-xl border text-xs font-mono-code"
              style={{
                backgroundColor: 'var(--bg2)',
                borderColor: 'var(--line)',
                color: 'var(--ink)'
              }}
            >
              <span className="font-bold tabular-nums">
                {cases.filter((c) => c.state === 'open').length} Open Cases
              </span>
            </div>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[260px] flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink3)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search case ID, customer, client name, analyst..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border outline-none transition-colors focus-visible:ring-2"
              style={{
                backgroundColor: 'var(--card)',
                borderColor: 'var(--line)',
                color: 'var(--ink)'
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Type filter */}
            <div className="flex items-center p-1 rounded-lg border text-xs font-mono-code" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
              {(['ALL', 'PKYC', 'ONBOARDING'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: typeFilter === t ? 'var(--card)' : 'transparent',
                    color: typeFilter === t ? 'var(--primary)' : 'var(--ink2)',
                    boxShadow: typeFilter === t ? 'var(--sh1)' : 'none'
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* State filter */}
            <div className="flex items-center p-1 rounded-lg border text-xs font-mono-code" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
              {(['ALL', 'open', 'closed'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStateFilter(s)}
                  className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer capitalize"
                  style={{
                    backgroundColor: stateFilter === s ? 'var(--card)' : 'transparent',
                    color: stateFilter === s ? 'var(--primary)' : 'var(--ink2)',
                    boxShadow: stateFilter === s ? 'var(--sh1)' : 'none'
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <div className="flex items-center p-1 rounded-lg border text-xs font-mono-code" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
              {(['ALL', 'CRITICAL', 'STANDARD', 'CLEAR'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: statusFilter === st ? 'var(--card)' : 'transparent',
                    color: statusFilter === st ? 'var(--primary)' : 'var(--ink2)',
                    boxShadow: statusFilter === st ? 'var(--sh1)' : 'none'
                  }}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Show archived toggle */}
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              className="px-3 py-1.5 rounded-lg border text-xs font-mono-code flex items-center gap-1.5 transition-colors cursor-pointer"
              style={{
                backgroundColor: showArchived ? 'var(--card)' : 'var(--bg2)',
                borderColor: showArchived ? 'var(--primary)' : 'var(--line)',
                color: showArchived ? 'var(--primary)' : 'var(--ink2)',
                boxShadow: showArchived ? 'var(--sh1)' : 'none'
              }}
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Show archived</span>
            </button>
          </div>
        </div>

        {/* Cases Container */}
        <div
          className="rounded-2xl border overflow-hidden shadow-sm"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
        >
          {filteredCases.length === 0 ? (
            <div className="text-center py-16 p-6">
              <Briefcase className="w-8 h-8 mx-auto mb-2 text-[var(--ink3)]" />
              <h3 className="font-display font-semibold text-sm text-[var(--ink)]">No cases match filters</h3>
              <p className="text-xs text-[var(--ink2)] mt-1">Screening runs and perpetual monitoring events will populate cases here.</p>
            </div>
          ) : (
            <>
              {/* Stacked Card Layout below 700px */}
              <div className="block min-[700px]:hidden divide-y" style={{ borderColor: 'var(--line2)' }}>
                {filteredCases.map((c) => {
                  const statusDot =
                    c.overallStatus === 'CRITICAL'
                      ? 'var(--rose)'
                      : c.overallStatus === 'STANDARD'
                      ? 'var(--amber)'
                      : 'var(--emerald)';

                  const dateObj = new Date(c.createdAt);
                  const formattedDate = dateObj.toLocaleDateString('en-GB');

                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedCaseId(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedCaseId(c.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open compliance case ${c.id} for ${c.groupName}`}
                      className="p-4 space-y-2.5 hover:bg-[var(--bg2)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono-code font-bold text-sm text-[var(--ink)]">{c.id}</span>
                          <span
                            className="px-1.5 py-0.2 rounded text-[10px] font-mono-code font-medium border"
                            style={{
                              backgroundColor: 'var(--bg2)',
                              borderColor: 'var(--line)',
                              color: 'var(--ink2)'
                            }}
                          >
                            {c.type}
                          </span>
                        </div>

                        {/* Risk badge */}
                        <div
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider border shrink-0"
                          style={{
                            backgroundColor: 'var(--bg2)',
                            borderColor: 'var(--line)',
                            color: 'var(--ink2)'
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusDot }} />
                          <span>{c.overallStatus}</span>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[var(--ink3)] font-mono-code text-[11px] shrink-0">Customer:</span>
                          <span className="font-semibold text-right text-[var(--ink)] truncate">
                            {c.groupName} <span className="font-mono-code font-normal text-[var(--ink3)]">({c.customerId})</span>
                          </span>
                        </div>

                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[var(--ink3)] font-mono-code text-[11px] shrink-0">Trigger:</span>
                          <span className="text-right text-[var(--ink2)] text-xs line-clamp-2">{c.triggerSummary}</span>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[var(--ink3)] font-mono-code text-[11px] shrink-0">State:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono-code capitalize font-semibold" style={{ color: c.state === 'open' ? 'var(--amber)' : 'var(--ink3)' }}>
                              {c.state}
                            </span>
                            {c.archived && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono-code font-bold uppercase bg-amber-500/10 text-amber-700 border border-amber-500/20">
                                Archived
                              </span>
                            )}
                          </div>
                        </div>

                        {c.archived && (
                          <div className="text-[11px] font-mono-code text-[var(--ink2)] bg-[var(--bg2)] p-2 rounded border border-[var(--line)]">
                            <span className="font-bold">Archived:</span> {c.archiveReason} <span className="text-[var(--ink3)]">(by {c.archivedByName || c.archivedBy})</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[var(--ink3)] font-mono-code text-[11px] shrink-0">Analyst:</span>
                          <span className="font-mono-code text-[var(--ink2)]">{c.analystName}</span>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[var(--ink3)] font-mono-code text-[11px] shrink-0">Created:</span>
                          <span className="font-mono-code text-[var(--ink3)]">{formattedDate}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Table Layout above 700px with Risk right after Case ID */}
              <div className="hidden min-[700px]:block overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr
                      className="border-b text-[10.5px] uppercase font-mono-code text-[var(--ink3)] tracking-wider"
                      style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}
                    >
                      <th className="py-3 px-4">Case ID</th>
                      <th className="py-3 px-4">Risk</th>
                      <th className="py-3 px-4">Customer Entity</th>
                      <th className="py-3 px-4">Trigger Summary</th>
                      <th className="py-3 px-4">State</th>
                      <th className="py-3 px-4">Analyst</th>
                      <th className="py-3 px-4 text-right">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--line2)' }}>
                    {filteredCases.map((c) => {
                      const statusDot =
                        c.overallStatus === 'CRITICAL'
                          ? 'var(--rose)'
                          : c.overallStatus === 'STANDARD'
                          ? 'var(--amber)'
                          : 'var(--emerald)';

                      const dateObj = new Date(c.createdAt);
                      const formattedDate = dateObj.toLocaleDateString('en-GB');

                      return (
                        <tr
                          key={c.id}
                          onClick={() => setSelectedCaseId(c.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedCaseId(c.id);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-label={`Open compliance case ${c.id}`}
                          className="hover:bg-[var(--bg2)] transition-colors cursor-pointer group focus-visible:bg-[var(--bg2)] focus-visible:outline-none"
                        >
                          <td className="py-3.5 px-4 font-mono-code font-bold text-[var(--ink)] group-hover:text-[var(--primary)] transition-colors">
                            <div className="flex items-center gap-1.5">
                              <span>{c.id}</span>
                              <span
                                className="px-1.5 py-0.2 rounded text-[10px] font-mono-code font-medium border"
                                style={{
                                  backgroundColor: 'var(--bg2)',
                                  borderColor: 'var(--line)',
                                  color: 'var(--ink2)'
                                }}
                              >
                                {c.type}
                              </span>
                            </div>
                          </td>

                          {/* Risk Column right after Case ID */}
                          <td className="py-3.5 px-4">
                            <div
                              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider border"
                              style={{
                                backgroundColor: 'var(--bg2)',
                                borderColor: 'var(--line)',
                                color: 'var(--ink2)'
                              }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusDot }} />
                              <span>{c.overallStatus}</span>
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-[var(--ink)]">{c.groupName}</div>
                            <div className="text-[10px] font-mono-code text-[var(--ink3)]">{c.customerId}</div>
                          </td>

                          <td className="py-3.5 px-4 max-w-xs truncate text-[var(--ink2)]">
                            {c.triggerSummary}
                          </td>

                          <td className="py-3.5 px-4 font-mono-code font-semibold">
                            <div className="flex flex-col items-start gap-1">
                              <span className="capitalize" style={{ color: c.state === 'open' ? 'var(--amber)' : 'var(--ink3)' }}>
                                {c.state}
                              </span>
                              {c.archived && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono-code font-bold uppercase bg-amber-500/10 text-amber-700 border border-amber-500/20"
                                  title={`Archived by ${c.archivedByName || c.archivedBy}: ${c.archiveReason}`}
                                >
                                  <Archive className="w-2.5 h-2.5" />
                                  <span>Archived</span>
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-[var(--ink2)] font-mono-code">
                            {c.analystName}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono-code text-[var(--ink3)]" title={dateObj.toLocaleString('en-GB')}>
                            {formattedDate}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
