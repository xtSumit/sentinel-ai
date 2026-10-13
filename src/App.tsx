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
import { AuthProvider, useAuth } from './context/AuthContext';
import { db, writeAuditRecord } from './lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  doc,
  updateDoc
} from 'firebase/firestore';
import { applyEventToGroup, evaluateMateriality, MaterialityEvaluation } from './engine/materialityEngine';
import { CorporateGroupSeed } from './types/bods';
import { Loader2, Radio, ArrowRight, X, CheckCircle2 } from 'lucide-react';
import { SENTINEL_MARK_64 } from './brand-assets';

function MainApp() {
  const { user, profile, loading } = useAuth();
  const groups = bodsRepository.getGroups();

  // Navigation State
  const [activeRailItem, setActiveRailItem] = useState<'kyc-initiation' | 'beneficial-ownership' | 'alerts'>('beneficial-ownership');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Firestore Data State
  const [onboardedCustomerMap, setOnboardedCustomerMap] = useState<Record<string, string>>({}); // groupKey -> customerId
  const [events, setEvents] = useState<AlertEventRecord[]>([]);

  // Materiality Review State
  const [reviewingEvent, setReviewingEvent] = useState<AlertEventRecord | null>(null);
  const [currentEvaluation, setCurrentEvaluation] = useState<MaterialityEvaluation | null>(null);

  // Toast State
  const [activeToast, setActiveToast] = useState<{ id: string; message: string; event: AlertEventRecord } | null>(null);
  const [generalToast, setGeneralToast] = useState<string | null>(null);

  const initialListenRef = useRef(false);

  // 1. Listen to onboarded customers
  useEffect(() => {
    if (!user) return;
    const custCol = collection(db, 'customers');
    const unsubscribe = onSnapshot(custCol, (snapshot) => {
      const map: Record<string, string> = {};
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.groupKey && d.customerId) {
          map[d.groupKey] = d.customerId;
        }
      });
      setOnboardedCustomerMap(map);
    });
    return () => unsubscribe();
  }, [user]);

  // 2. Single Firestore listener watching pending events across ALL onboarded customers
  useEffect(() => {
    if (!user) return;
    const evCol = collection(db, 'events');
    const unsubscribe = onSnapshot(evCol, async (snapshot) => {
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

        // Check for new pending event arriving live
        if (ev.status === 'pending' && initialListenRef.current) {
          const isExisting = events.some((e) => e.id === ev.id);
          if (!isExisting) {
            newArrival = ev;
          }
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
    });

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

    // Apply all ACCEPTED events in order
    const groupAcceptedEvents = events
      .filter((e) => e.groupId === selectedGroupId && e.status === 'accepted')
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
    if (reviewingEvent) return 5;
    if (pendingEventForSelectedGroup) return 4;
    if (selectedGroupId) return 3;
    return 2;
  }, [activeRailItem, reviewingEvent, pendingEventForSelectedGroup, selectedGroupId]);

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
      await updateDoc(eventRef, {
        status: decision,
        decidedBy: user.uid,
        decidedAt: new Date().toISOString(),
        ...(dismissReason ? { dismissReason } : {})
      });

      // Audit decision
      const group = bodsRepository.getGroupById(reviewingEvent.groupId);
      await writeAuditRecord({
        actorUid: user.uid,
        actorType: profile?.governanceMode === 'automated' ? 'SYSTEM' : 'HUMAN',
        actorName: profile?.displayName || 'Analyst',
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
        setGeneralToast('Change permanently committed. KYC agents run in Phase 4.');
        setTimeout(() => setGeneralToast(null), 4000);
      }

      setReviewingEvent(null);
      setCurrentEvaluation(null);
    } catch (err: any) {
      console.error('Failed to commit decision:', err);
      alert(`Error committing decision: ${err.message}`);
    }
  };

  // Loading Screen
  if (loading) {
    return (
      <div
        className="h-screen w-screen flex flex-col items-center justify-center p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg-0)' }}
      >
        <img
          src={SENTINEL_MARK_64}
          alt="Sentinel AI"
          width={48}
          height={48}
          className="animate-pulse"
        />
        <div className="flex items-center gap-2 text-xs font-mono" style={{ color: 'var(--ink-2)' }}>
          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
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
        setActiveRailItem(railId as any);
        if (railId === 'beneficial-ownership') {
          // If returning to ownership structures rail, reset workspace selection
          setSelectedGroupId(null);
          setSelectedCustomerId(null);
        }
      }}
      pendingAlertsCount={pendingEventsCount}
    >
      {/* Live Arrival Toast */}
      {activeToast && (
        <div className="fixed top-20 right-6 z-50 animate-drop max-w-md w-full shadow-2xl rounded-2xl p-4 border bg-slate-900/95 border-amber-500/40 backdrop-blur-md">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                <Radio className="w-4 h-4 text-amber-400 animate-pulse" />
              </span>
              <div>
                <p className="text-xs font-bold text-slate-100">{activeToast.message}</p>
                <p className="text-[11px] font-mono text-amber-400 truncate mt-0.5">
                  {activeToast.event.description}
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveToast(null)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3 pt-2 border-t border-slate-800 flex justify-end gap-2">
            <button
              onClick={() => setActiveToast(null)}
              className="px-2.5 py-1 text-xs text-slate-400 hover:text-white font-medium"
            >
              Dismiss
            </button>
            <button
              onClick={() => startReviewEvent(activeToast.event)}
              className="px-3.5 py-1 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center gap-1 shadow-md"
            >
              <span>Review</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* General Phase Notification Toast */}
      {generalToast && (
        <div className="fixed top-20 right-6 z-50 animate-drop max-w-md shadow-2xl rounded-2xl p-4 border bg-emerald-950/90 border-emerald-500/40 backdrop-blur-md flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-emerald-200">{generalToast}</span>
        </div>
      )}

      {/* View Routing */}
      {activeRailItem === 'kyc-initiation' ? (
        <KycInitiationView
          onOpenCustomerWorkspace={(groupId, custId) => {
            setSelectedGroupId(groupId);
            setSelectedCustomerId(custId);
            setActiveRailItem('beneficial-ownership');
          }}
        />
      ) : activeRailItem === 'alerts' ? (
        <AlertsView
          onReviewAlert={(_gid, _cid, event) => startReviewEvent(event)}
          governanceMode={profile?.governanceMode || 'human-in-the-loop'}
        />
      ) : currentGroup ? (
        <EntityWorkspaceView
          group={currentGroup}
          customerId={selectedCustomerId || undefined}
          onBack={() => {
            setSelectedGroupId(null);
            setSelectedCustomerId(null);
          }}
          pendingEvent={pendingEventForSelectedGroup}
          onReviewEvent={(ev) => startReviewEvent(ev)}
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
        />
      )}

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
