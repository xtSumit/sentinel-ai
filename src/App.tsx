/**
 * Sentinel AI — Main Application Orchestrator
 * Integrates:
 * - Firebase Google Sign-In & AuthProvider
 * - Sign-In View for unauthenticated users
 * - Full-featured navigation rail: KYC Initiation (Step 1), Ownership Structures (Step 3), Alerts (Step 4)
 * - Single persistent Firestore listener across all onboarded customers
 * - Live arrival toast notifications for registry modifications
 * - Provisionally and permanently mutated event-sourced graph
 * - Materiality Assessment Modal & deterministic decision auditing
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { bodsRepository } from './data/repository';
import { AppShell } from './components/AppShell';
import { OwnershipStructuresView } from './components/OwnershipStructuresView';
import { EntityWorkspaceView } from './components/EntityWorkspaceView';
import { KycInitiationView } from './components/KycInitiationView';
import { AlertsView, AlertEventRecord } from './components/AlertsView';
import { SignInView } from './components/SignInView';
import { MaterialityModal } from './components/MaterialityModal';
import { CasesView } from './components/CasesView';
import { AdverseMediaDossierView } from './components/AdverseMediaDossierView';
import { AuthProvider, useAuth } from './context/AuthContext';
import { db, writeAuditRecord, handleFirestoreError, OperationType } from './lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  doc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { applyEventToGroup, evaluateMateriality, MaterialityEvaluation } from './engine/materialityEngine';
import { executeScreeningWorkflow, ComplianceCaseRecord } from './engine/screeningOrchestrator';
import { CorporateGroupSeed, BodsPerson } from './types/bods';
import { Loader2, Radio, ArrowRight, X, CheckCircle2, Briefcase, AlertTriangle } from 'lucide-react';
import { SENTINEL_MARK_64 } from './brand-assets';

function MainApp() {
  const { user, profile, loading } = useAuth();
  const groups = bodsRepository.getGroups();

  // Navigation State
  const [activeRailItem, setActiveRailItem] = useState<'kyc-initiation' | 'beneficial-ownership' | 'alerts' | 'cases'>('beneficial-ownership');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [intakeSessionKey, setIntakeSessionKey] = useState<number>(Date.now());
  const [targetCaseId, setTargetCaseId] = useState<string | null>(null);

  const handleInitiateIntake = (groupId: string, customerId: string) => {
    setIntakeSessionKey(Date.now());
    setSelectedGroupId(groupId);
    setSelectedCustomerId(customerId);
  };
  const [caseToast, setCaseToast] = useState<{
    caseId: string;
    groupName: string;
    triggerType: string;
  } | null>(null);
  const [viewingDossierPerson, setViewingDossierPerson] = useState<BodsPerson | null>(null);
  const [dossierOriginCaseId, setDossierOriginCaseId] = useState<string | null>(null);

  // Firestore Data State
  const [onboardedCustomerMap, setOnboardedCustomerMap] = useState<Record<string, string>>({}); // groupKey -> customerId
  const [events, setEvents] = useState<AlertEventRecord[]>([]);
  const [cases, setCases] = useState<ComplianceCaseRecord[]>([]);

  // Materiality Review State
  const [reviewingEvent, setReviewingEvent] = useState<AlertEventRecord | null>(null);
  const [currentEvaluation, setCurrentEvaluation] = useState<MaterialityEvaluation | null>(null);

  // Toast State
  const [activeToast, setActiveToast] = useState<{ id: string; message: string; event: AlertEventRecord } | null>(null);
  const [generalToast, setGeneralToast] = useState<string | null>(null);
  const [caseErrorToast, setCaseErrorToast] = useState<{
    message: string;
    onRetry: () => void;
  } | null>(null);
  const [activeScreeningRun, setActiveScreeningRun] = useState<{
    triggerEvent: AlertEventRecord;
    evaluation: any;
    timestamp: number;
  } | null>(null);
  const [neutralToast, setNeutralToast] = useState<{ message: string } | null>(null);

  const initialListenRef = useRef(false);
  const seenPendingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (neutralToast) {
      const timer = setTimeout(() => setNeutralToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [neutralToast]);

  // Real-time listener for cases
  useEffect(() => {
    if (!user) return;
    const casesCol = collection(db, 'cases');
    const unsubscribe = onSnapshot(
      casesCol,
      (snapshot) => {
        const list: ComplianceCaseRecord[] = [];
        snapshot.forEach((snap) => {
          list.push(snap.data() as ComplianceCaseRecord);
        });
        setCases(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'cases');
      }
    );
    return () => unsubscribe();
  }, [user]);

  const openCasesCount = useMemo(() => {
    return cases.filter((c) => c.state === 'open').length;
  }, [cases]);

  // 1. Listen to onboarded customers
  useEffect(() => {
    if (!user) return;
    const custCol = collection(db, 'customers');
    const unsubscribe = onSnapshot(
      custCol,
      (snapshot) => {
        const map: Record<string, string> = {};
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          if (d.groupKey && d.customerId) {
            map[d.groupKey] = d.customerId;
          }
        });
        setOnboardedCustomerMap(map);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'customers');
      }
    );
    return () => unsubscribe();
  }, [user]);

  // 2. Single Firestore listener watching pending events across ALL onboarded customers
  useEffect(() => {
    if (!user) return;
    const evCol = collection(db, 'events');
    const unsubscribe = onSnapshot(
      evCol,
      async (snapshot) => {
        const list: AlertEventRecord[] = [];
        let newArrival: AlertEventRecord | null = null;

        snapshot.forEach((snap) => {
          const d = snap.data();
          const ev: AlertEventRecord = {
            id: snap.id,
            customerId: d.customerId,
            groupId: d.groupId,
            templateId: d.templateId,
            changeType: d.changeType,
            payload: d.data || d.payload || {},
            description: d.description,
            source: d.source,
            confidence: d.confidence,
            detectedAt: d.detectedAt,
            status: d.status || 'pending',
            decidedBy: d.decidedBy,
            decidedAt: d.decidedAt,
            dismissReason: d.dismissReason,
            _simulation: d._simulation
          };
          list.push(ev);

          // Check for new pending event arriving live (reacting strictly to status == 'pending')
          if (ev.status === 'pending') {
            if (initialListenRef.current && !seenPendingIdsRef.current.has(ev.id)) {
              newArrival = ev;
            }
            seenPendingIdsRef.current.add(ev.id);
          }
        });

        // Audit once per session: "Monitoring armed for N customers"
        if (!initialListenRef.current) {
          initialListenRef.current = true;
          const onboardedCount = Object.keys(onboardedCustomerMap).length;
          writeAuditRecord({
            actorUid: user.uid,
            actorType: 'SYSTEM',
            actorName: 'Sentinel Live Monitoring',
            action: 'MONITORING_ARMED',
            summary: `Perpetual KYC monitoring armed across ${onboardedCount || 5} corporate registries.`
          }).catch(() => {});
        }

        setEvents(list);

        // Trigger live toast if new event arrived
        if (newArrival) {
          const group = groups.find((g) => g.id === (newArrival as AlertEventRecord).groupId);
          setActiveToast({
            id: (newArrival as AlertEventRecord).id,
            message: `Live Monitoring detected a change for ${group?.name || (newArrival as AlertEventRecord).groupId}`,
            event: newArrival
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'events');
      }
    );

    return () => unsubscribe();
  }, [user, onboardedCustomerMap, groups]);

  // Calculate pending events count for rail badge
  const pendingEventsCount = useMemo(() => {
    return events.filter((e) => e.status === 'pending').length;
  }, [events]);

  // Derive mutated group applying accepted events + provisional review event
  const currentGroup = useMemo(() => {
    if (!selectedGroupId) return null;
    const baseline = bodsRepository.getGroupById(selectedGroupId);
    if (!baseline) return null;

    // Apply all ACCEPTED registry change events in order (excluding local document extractions for fresh intake)
    const groupAcceptedEvents = events
      .filter((e) => e.groupId === selectedGroupId && e.status === 'accepted' && !e.id.startsWith('evt-doc-'))
      .sort((a, b) => new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime());

    let mutated = baseline;
    for (const ev of groupAcceptedEvents) {
      mutated = applyEventToGroup(mutated, ev.payload);
    }

    // If currently reviewing a provisional event for this group, apply it provisionally
    if (reviewingEvent && reviewingEvent.groupId === selectedGroupId) {
      mutated = applyEventToGroup(mutated, reviewingEvent.payload);
    }

    return mutated;
  }, [selectedGroupId, events, reviewingEvent]);

  // Find pending event for currently selected customer/workspace
  const pendingEventForSelectedGroup = useMemo(() => {
    if (!selectedGroupId) return null;
    return events.find((e) => e.groupId === selectedGroupId && e.status === 'pending') || null;
  }, [selectedGroupId, events]);

  const [justCompletedScreeningGroupId, setJustCompletedScreeningGroupId] = useState<string | null>(null);

  // Flow Step:
  // 1: KYC Initiation
  // 2: Autonomous Mapping
  // 3: Ownership Tree
  // 4: Live Monitoring
  // 5: Materiality
  // 6: KYC Agents
  // 7: Unified Results
  const activeStep = useMemo(() => {
    if (activeRailItem === 'kyc-initiation') return 1;
    if (activeRailItem === 'alerts') return 4;
    if (activeRailItem === 'cases') return 7;

    if (!selectedGroupId) return 2;

    // Inside Entity Workspace:
    if (reviewingEvent && reviewingEvent.groupId === selectedGroupId) {
      return 5; // Materiality Assessment
    }

    if (activeScreeningRun && activeScreeningRun.triggerEvent.groupId === selectedGroupId) {
      return 6; // KYC Agents Orchestration
    }

    if (justCompletedScreeningGroupId === selectedGroupId) {
      return 7; // Step 7: Unified Results (shown only at the moment a review completes while staying on screen)
    }

    return 4; // Step 4: Live Monitoring
  }, [activeRailItem, selectedGroupId, reviewingEvent, activeScreeningRun, justCompletedScreeningGroupId]);

  // Start Materiality Review on an event
  const startReviewEvent = async (event: AlertEventRecord) => {
    const group = bodsRepository.getGroupById(event.groupId);
    if (!group) return;

    // Open workspace for this customer with banner active
    setSelectedGroupId(group.id);
    setSelectedCustomerId(event.customerId);
    setActiveRailItem('beneficial-ownership');
    setActiveToast(null);

    // Provisionally evaluate materiality
    const evalResult = await evaluateMateriality({
      baselineGroup: group,
      eventData: event.payload,
      sourceConfidence: event.confidence
    });

    setCurrentEvaluation(evalResult);
    setReviewingEvent(event);
  };

  // Commit decision on an event
  const handleMaterialityDecision = async (
    decision: 'accepted' | 'monitoring' | 'dismissed',
    dismissReason?: string,
    isAiGenerated?: boolean,
    explanationText?: string
  ) => {
    if (!reviewingEvent || !user) return;

    try {
      const eventRef = doc(db, 'events', reviewingEvent.id);
      const deciderName = (profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Analyst').slice(0, 120);
      const updatePayload: Record<string, any> = {
        status: decision,
        decidedBy: user.uid,
        decidedByName: deciderName,
        decidedAt: serverTimestamp()
      };
      if (decision === 'dismissed') {
        updatePayload.dismissReason = (dismissReason && dismissReason.trim()) ? dismissReason.trim() : 'Dismissed by compliance analyst';
      }
      await updateDoc(eventRef, updatePayload);

      // Audit decision
      const group = bodsRepository.getGroupById(reviewingEvent.groupId);
      await writeAuditRecord({
        actorUid: user.uid,
        actorType: profile?.governanceMode === 'automated' ? 'SYSTEM' : 'HUMAN',
        actorName: deciderName,
        action: `EVENT_${decision.toUpperCase()}`,
        summary: `Registry change ${reviewingEvent.id} for ${group?.name} marked as ${decision.toUpperCase()}.`,
        groupId: reviewingEvent.groupId,
        customerId: reviewingEvent.customerId,
        eventId: reviewingEvent.id,
        isAiGenerated,
        details: {
          decision,
          dismissReason: dismissReason || null,
          verdict: currentEvaluation?.verdict,
          explanation: explanationText
        }
      });

      if (decision === 'accepted') {
        setCaseToast(null);
        setCaseErrorToast(null);
        setActiveScreeningRun({
          triggerEvent: reviewingEvent,
          evaluation: currentEvaluation,
          timestamp: Date.now()
        });
      } else if (decision === 'monitoring') {
        setCaseToast(null);
        setNeutralToast({ message: 'Change logged. Monitoring continues.' });
      } else if (decision === 'dismissed') {
        setCaseToast(null);
        setNeutralToast({ message: 'Change dismissed and recorded.' });
      }

      setReviewingEvent(null);
      setCurrentEvaluation(null);
    } catch (err: any) {
      console.error('Failed to commit decision:', err);
      const isPermission = err?.code === 'permission-denied' || err?.message?.includes('Missing or insufficient permissions');
      const friendlyMsg = isPermission
        ? 'Permission denied: You do not have authorization to record a decision on this registry event. Check that your account is authenticated.'
        : `Error committing decision: ${err?.message || 'An error occurred'}`;
      alert(friendlyMsg);
    }
  };

  // Loading Screen
  if (loading) {
    return (
      <div
        className="h-screen w-screen flex flex-col items-center justify-center p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg)' }}
      >
        <img
          src={SENTINEL_MARK_64}
          alt="Sentinel AI"
          width={48}
          height={48}
          className="animate-pulse"
        />
        <div className="flex items-center gap-2 text-xs font-mono-code" style={{ color: 'var(--ink2)' }}>
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--primary)' }} />
          <span>Verifying Firebase session credentials...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated Screen
  if (!user) {
    return <SignInView />;
  }

  return (
    <AppShell
      activeStep={activeStep}
      activeRailItem={activeRailItem}
      onSelectRailItem={(railId) => {
        setViewingDossierPerson(null);
        setDossierOriginCaseId(null);
        setActiveRailItem(railId as any);
        if (railId === 'cases') {
          setTargetCaseId(null);
        }
        if (railId === 'beneficial-ownership') {
          // If returning to ownership structures rail, reset workspace selection
          setSelectedGroupId(null);
          setSelectedCustomerId(null);
        }
      }}
      pendingAlertsCount={pendingEventsCount}
      pendingCasesCount={openCasesCount}
    >
      {/* Live Arrival Toast */}
      {activeToast && (
        <div
          role="alert"
          className="fixed top-20 right-6 z-50 anim-drop max-w-[440px] w-full rounded-2xl p-4 border backdrop-blur-sm shadow-xl"
          style={{
            backgroundColor: 'var(--card)',
            borderColor: 'var(--amber)',
            boxShadow: 'var(--sh3)',
            color: 'var(--ink)'
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: 'var(--amber-s)', color: 'var(--amber)' }}
              >
                <Radio className="w-4 h-4 animate-pulse" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold font-display leading-snug" style={{ color: 'var(--ink)' }}>
                  {activeToast.message}
                </p>
                <p className="text-[11px] font-mono-code leading-relaxed mt-1 whitespace-normal break-words" style={{ color: 'var(--amber)' }}>
                  {activeToast.event.description}
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveToast(null)}
              type="button"
              aria-label="Close notification"
              className="text-[var(--ink3)] hover:text-[var(--ink)] p-1 rounded transition-colors focus-visible:ring-2 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div
            className="mt-3 pt-2 flex justify-end gap-2 border-t"
            style={{ borderColor: 'var(--line)' }}
          >
            <button
              onClick={() => setActiveToast(null)}
              type="button"
              className="px-2.5 py-1 text-xs font-medium text-[var(--ink2)] hover:text-[var(--ink)] transition-colors focus-visible:ring-2"
            >
              Dismiss
            </button>
            <button
              onClick={() => startReviewEvent(activeToast.event)}
              type="button"
              className="px-3.5 py-1 text-xs font-bold rounded-lg text-white flex items-center gap-1 shadow-sm transition-transform active:scale-95 focus-visible:ring-2 cursor-pointer"
              style={{ backgroundColor: 'var(--amber)' }}
            >
              <span>Review</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* PKYC Case Toast */}
      {caseToast && (
        <div
          role="status"
          className="fixed top-20 right-6 z-50 anim-drop max-w-[440px] w-full rounded-2xl p-4 border backdrop-blur-sm shadow-xl flex items-start justify-between gap-3"
          style={{
            backgroundColor: 'var(--card)',
            borderColor: 'var(--amber)',
            boxShadow: 'var(--sh3)',
          }}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border mt-0.5"
              style={{
                backgroundColor: 'var(--amber-s)',
                borderColor: 'var(--amber)',
                color: 'var(--amber)',
              }}
            >
              <Briefcase className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-[var(--ink)]">Perpetual KYC Case Initiated</span>
                <span
                  className="px-1.5 py-0.5 rounded font-mono-code font-bold text-[10.5px]"
                  style={{
                    backgroundColor: 'var(--bg2)',
                    color: 'var(--amber)',
                    border: '1px solid var(--line)',
                  }}
                >
                  {caseToast.caseId}
                </span>
              </div>
              <p className="text-xs text-[var(--ink2)] mt-1.5 leading-relaxed whitespace-normal break-words">
                Screening completed for {caseToast.groupName}
              </p>
              <button
                type="button"
                onClick={() => {
                  setTargetCaseId(caseToast.caseId);
                  setActiveRailItem('cases');
                  setCaseToast(null);
                }}
                className="mt-2 text-xs font-bold text-[var(--primary)] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>Open case</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCaseToast(null)}
            aria-label="Dismiss case notification"
            className="text-[var(--ink3)] hover:text-[var(--ink)] p-1 rounded transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* PKYC Case Write Error Toast with Retry */}
      {caseErrorToast && (
        <div
          role="alert"
          className="fixed top-20 right-6 z-50 anim-drop max-w-[440px] w-full rounded-2xl p-4 border backdrop-blur-sm shadow-xl flex items-start justify-between gap-3"
          style={{
            backgroundColor: 'var(--card)',
            borderColor: 'var(--rose)',
            boxShadow: 'var(--sh3)',
          }}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border mt-0.5"
              style={{
                backgroundColor: 'var(--coral-s)',
                borderColor: 'var(--rose)',
                color: 'var(--rose)',
              }}
            >
              <AlertTriangle className="w-4 h-4 animate-bounce" />
            </div>
            <div className="min-w-0 text-xs">
              <div className="font-bold text-[var(--ink)]">Case Persistence Failed</div>
              <p className="text-[var(--ink2)] mt-1.5 whitespace-normal break-words leading-relaxed">
                {caseErrorToast.message}
              </p>
              <button
                type="button"
                onClick={caseErrorToast.onRetry}
                className="mt-2.5 text-xs font-bold text-[var(--rose)] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>Retry writing case</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCaseErrorToast(null)}
            aria-label="Dismiss error notification"
            className="text-[var(--ink3)] hover:text-[var(--ink)] p-1 rounded transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Neutral Confirmation Toast (for Monitor only & Dismiss per prompt requirement) */}
      {neutralToast && (
        <div
          role="status"
          className="fixed top-20 right-6 z-50 anim-drop max-w-[400px] w-full rounded-2xl p-4 border backdrop-blur-sm shadow-xl flex items-center justify-between gap-3"
          style={{
            backgroundColor: 'var(--card)',
            borderColor: 'var(--line)',
            boxShadow: 'var(--sh3)',
          }}
        >
          <div className="flex items-center gap-2.5 text-xs font-semibold text-[var(--ink)]">
            <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />
            <span>{neutralToast.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNeutralToast(null)}
            aria-label="Dismiss notification"
            className="text-[var(--ink3)] hover:text-[var(--ink)] p-1 rounded transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* General Phase Notification Toast */}
      {generalToast && (
        <div
          role="status"
          className="fixed top-20 right-6 z-50 anim-drop max-w-[440px] w-full rounded-2xl p-4 border backdrop-blur-sm flex items-center gap-3"
          style={{
            backgroundColor: 'var(--card)',
            borderColor: 'var(--emerald)',
            boxShadow: 'var(--sh3)',
            color: 'var(--ink)'
          }}
        >
          <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: 'var(--emerald)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            {generalToast}
          </span>
        </div>
      )}

      {/* View Routing */}
      {viewingDossierPerson && (
        <AdverseMediaDossierView
          person={viewingDossierPerson}
          onBack={() => {
            setViewingDossierPerson(null);
            if (dossierOriginCaseId) {
              setTargetCaseId(dossierOriginCaseId);
              setActiveRailItem('cases');
            }
            setDossierOriginCaseId(null);
          }}
        />
      )}

      <div style={{ display: viewingDossierPerson ? 'none' : 'contents' }}>
        {activeRailItem === 'kyc-initiation' ? (
          <KycInitiationView
            onOpenCustomerWorkspace={(groupId, custId) => {
              setSelectedGroupId(groupId);
              setSelectedCustomerId(custId);
              setActiveRailItem('beneficial-ownership');
            }}
            onInitiateIntake={handleInitiateIntake}
          />
        ) : activeRailItem === 'alerts' ? (
          <AlertsView
            onReviewAlert={(_gid, _cid, event) => startReviewEvent(event)}
            governanceMode={profile?.governanceMode || 'human-in-the-loop'}
          />
        ) : activeRailItem === 'cases' ? (
          <CasesView
            initialCaseId={targetCaseId}
            onOpenCustomerWorkspace={(groupId, custId) => {
              setSelectedGroupId(groupId);
              setSelectedCustomerId(custId);
              setActiveRailItem('beneficial-ownership');
            }}
            onOpenDossier={(person) => {
              setDossierOriginCaseId(targetCaseId);
              setViewingDossierPerson(person);
            }}
          />
        ) : currentGroup ? (
          <EntityWorkspaceView
            key={`${selectedGroupId}-${intakeSessionKey}`}
            group={currentGroup}
            customerId={selectedCustomerId || undefined}
            intakeSessionKey={intakeSessionKey}
            onBack={() => {
              setSelectedGroupId(null);
              setSelectedCustomerId(null);
            }}
            pendingEvent={pendingEventForSelectedGroup}
            events={events}
            activeScreeningRun={activeScreeningRun}
            onScreeningComplete={(createdCase) => {
              setCaseErrorToast(null);
              setJustCompletedScreeningGroupId(currentGroup.id);
              setCaseToast({
                caseId: createdCase.caseId,
                groupName: currentGroup.name,
                triggerType: 'PKYC'
              });
            }}
            onScreeningError={(err) => {
              console.error('[PKYC Screening Workflow Error]', err);
              const isPermission = err?.code === 'permission-denied' || err?.message?.includes('Missing or insufficient permissions');
              setCaseErrorToast({
                message: isPermission
                  ? 'Permission denied: Insufficient permissions to create PKYC compliance case.'
                  : (err?.message || 'Failed to persist case document in Firestore.'),
                onRetry: () => {
                  if (activeScreeningRun) {
                    setActiveScreeningRun({ ...activeScreeningRun, timestamp: Date.now() });
                  }
                }
              });
            }}
            onScreeningFinished={() => setActiveScreeningRun(null)}
            onReviewEvent={(ev) => startReviewEvent(ev)}
            onOpenCase={(caseId) => {
              if (caseId) setTargetCaseId(caseId);
              setActiveRailItem('cases');
            }}
            onOpenDossier={(person) => setViewingDossierPerson(person)}
          />
        ) : (
          <OwnershipStructuresView
            groups={groups}
            onSelectGroup={(groupId) => {
              setSelectedGroupId(groupId);
              const foundCust = onboardedCustomerMap[groupId];
              setSelectedCustomerId(foundCust || null);
            }}
            onboardedCustomerMap={onboardedCustomerMap}
            onInitiateKyc={() => setActiveRailItem('kyc-initiation')}
          />
        )}
      </div>

      {/* Materiality Assessment Modal */}
      {reviewingEvent && currentEvaluation && (
        <MaterialityModal
          evaluation={currentEvaluation}
          onDecision={handleMaterialityDecision}
          onClose={() => {
            setReviewingEvent(null);
            setCurrentEvaluation(null);
          }}
          isAutomated={profile?.governanceMode === 'automated'}
        />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
