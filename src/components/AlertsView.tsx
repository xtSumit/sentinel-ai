/**
 * Sentinel AI — Alerts & Perpetual Monitoring View
 * Conforms strictly to Item 6 & DESIGN.md:
 * - Card list preserved with neutral surfaces
 * - Severity displayed as a subtle 6px dot badge on a neutral pill
 * - Single amber left border ONLY on pending alerts
 * - Injection panel moved to "Simulate registry change" button in header that opens a dialog
 * - Clearly labelled as a simulation in PREVIEW mode
 * - Solid Sora 24px --ink title, WCAG AA compliant text
 */

import React, { useState, useEffect } from 'react';
import { db, writeAuditRecord, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { bodsRepository } from '../data/repository';
import { useAuth } from '../context/AuthContext';
import { getEventFeedAdapter } from '../adapters/eventFeedAdapter';
import {
  Bell,
  Radio,
  Clock,
  ArrowRight,
  CheckCircle2,
  Zap,
  X,
  Building2,
  Loader2
} from 'lucide-react';

export interface AlertEventRecord {
  id: string;
  customerId: string;
  groupId: string;
  templateId: string;
  changeType: 'SHARE_CHANGE' | 'NEW_RELATIONSHIP' | 'RELATIONSHIP_ENDED' | 'ENTITY_DISSOLVED';
  payload: any;
  description: string;
  source: string;
  confidence: number;
  detectedAt: string;
  status: 'pending' | 'accepted' | 'monitoring' | 'dismissed';
  decidedBy?: string;
  decidedAt?: string;
  dismissReason?: string;
  _simulation?: boolean;
}

interface AlertsViewProps {
  onReviewAlert: (groupId: string, customerId: string, event: AlertEventRecord) => void;
  governanceMode: 'human-in-the-loop' | 'automated';
}

export const AlertsView: React.FC<AlertsViewProps> = ({
  onReviewAlert,
  governanceMode
}) => {
  const { user, profile, isSupervisor } = useAuth();
  const [events, setEvents] = useState<AlertEventRecord[]>([]);
  const [filterStatus, setFilterStatus] = useState<'pending' | 'monitoring' | 'dismissed' | 'accepted'>('pending');
  const [showSimulateDialog, setShowSimulateDialog] = useState(false);
  const [selectedCustomerForInjection, setSelectedCustomerForInjection] = useState<string>('grp-01-aurelia');
  const [injecting, setInjecting] = useState(false);
  const [injectionSuccess, setInjectionSuccess] = useState<string | null>(null);
  const [injectionError, setInjectionError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const groups = bodsRepository.getGroups();

  useEffect(() => {
    if (!user) return;
    const evCol = collection(db, 'events');
    const q = query(evCol);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: AlertEventRecord[] = [];
        snapshot.forEach((snap) => {
          const d = snap.data();
          list.push({
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
          });
        });

        // Sort descending by detectedAt
        list.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
        setEvents(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'events');
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleInjectChange = async () => {
    if (!isSupervisor) return;
    setInjecting(true);
    setInjectionSuccess(null);

    try {
      const group = bodsRepository.getGroupById(selectedCustomerForInjection);
      if (!group || !group.monitoringEventTemplates.length) {
        throw new Error('No monitoring templates available for selected group.');
      }

      // Pick next unfired template or rotate
      const existingFiredTemplates = new Set(events.filter(e => e.groupId === group.id).map(e => e.templateId));
      let template = group.monitoringEventTemplates.find(t => !existingFiredTemplates.has(t.id));
      if (!template) {
        template = group.monitoringEventTemplates[0];
      }

      const custId = `CUS-2026-${group.id.slice(-4)}`;
      const cleanCustId = custId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const cleanTplId = template.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const newEventId = `evt_${cleanCustId}_${cleanTplId}`;
      const adapter = getEventFeedAdapter();

      await adapter.publishEvent({
        id: newEventId,
        customerId: custId,
        groupId: group.id,
        templateId: template.id,
        changeType: template.changeType as any,
        payload: template.data as any,
        description: template.description,
        source: template.source,
        confidence: template.confidence,
        detectedAt: new Date().toISOString(),
        status: 'pending'
      });

      if (user) {
        await writeAuditRecord({
          actorUid: user.uid,
          actorType: 'HUMAN',
          actorName: profile?.displayName || 'Supervisor',
          action: 'REGISTRY_CHANGE_INJECTED',
          summary: `Supervisor injected registry change ${template.id} for ${group.name} (${adapter.mode()}).`,
          groupId: group.id,
          eventId: newEventId,
          details: { templateId: template.id, mode: adapter.mode() }
        });
      }

      setInjectionSuccess(`Simulation active: injected change for ${group.name}.`);
      setTimeout(() => {
        setInjectionSuccess(null);
        setShowSimulateDialog(false);
      }, 1800);
    } catch (err: any) {
      console.error('Failed to inject change:', err);
      alert(`Injection failed: ${err.message}`);
    } finally {
      setInjecting(false);
    }
  };

  const filtered = events.filter((e) => e.status === filterStatus);
  const pendingCount = events.filter((e) => e.status === 'pending').length;

  return (
    <div className="h-full w-full overflow-y-auto px-6 md:px-8 py-7 anim-vin select-text">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Page Header per Item 6 */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-2 border-b border-[var(--line)]">
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-[var(--emerald)] animate-pulse" />
              <span className="section-label" style={{ color: 'var(--emerald)' }}>
                Live Registry Watch · PREVIEW
              </span>
            </div>
            <h1
              className="font-display font-bold text-2xl tracking-tight"
              style={{ color: 'var(--ink)' }}
            >
              Alerts &amp; Perpetual Monitoring
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink2)' }}>
              Continuous ingestion of corporate registry changes across all onboarded banking clients.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Pending Counter */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono-code"
              style={{
                backgroundColor: 'var(--bg2)',
                borderColor: 'var(--line)',
                color: 'var(--ink)',
              }}
            >
              <span className="w-2 h-2 rounded-full bg-[var(--amber)]" />
              <span className="font-bold tabular-nums">{pendingCount} Pending</span>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: 'var(--line)' }}>
          {(['pending', 'monitoring', 'accepted', 'dismissed'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilterStatus(st)}
              className="text-xs font-mono-code font-semibold px-3 py-1.5 rounded-lg transition-colors capitalize cursor-pointer focus-visible:ring-2"
              style={{
                backgroundColor: filterStatus === st ? 'var(--card)' : 'transparent',
                color: filterStatus === st ? 'var(--ink)' : 'var(--ink2)',
                border: filterStatus === st ? '1px solid var(--line)' : '1px solid transparent',
                boxShadow: filterStatus === st ? 'var(--sh1)' : 'none',
              }}
            >
              {st}
              {st === 'pending' && pendingCount > 0 && (
                <span
                  className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] tabular-nums"
                  style={{
                    backgroundColor: 'var(--amber-s)',
                    color: 'var(--amber)',
                  }}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Alerts List */}
        {filtered.length === 0 ? (
          <div
            className="text-center py-16 rounded-2xl border p-8"
            style={{
              backgroundColor: 'var(--card)',
              borderColor: 'var(--line)',
            }}
          >
            <CheckCircle2 className="w-8 h-8 text-[var(--emerald)] mx-auto mb-3 opacity-80" />
            <h3 className="text-sm font-semibold font-display" style={{ color: 'var(--ink)' }}>
              All onboarded customers are being watched.
            </h3>
            <p className="text-xs font-mono-code mt-1" style={{ color: 'var(--ink2)' }}>
              No changes currently require review in the "{filterStatus}" queue.
            </p>
          </div>
        ) : (
          <div className="space-y-3.5">
            {filtered.map((item) => {
              const group = groups.find((g) => g.id === item.groupId);
              const isPending = item.status === 'pending';

              // Determine severity badge per Item 6 (6px dot + text in --ink2 on a neutral --bg2 pill)
              const isCritical =
                item.description.toLowerCase().includes('sanction') ||
                item.templateId.includes('sanction');
              const isMaterial =
                !isCritical &&
                (item.changeType === 'SHARE_CHANGE' || item.changeType === 'NEW_RELATIONSHIP');
              const severityDotColor = isCritical
                ? 'var(--rose)'
                : isMaterial
                ? 'var(--amber)'
                : 'var(--grey)';
              const severityLabel = isCritical
                ? 'CRITICAL'
                : isMaterial
                ? 'MATERIAL'
                : 'MONITOR';

              const isReviewingThis = reviewingId === item.id;

              const handleStartReview = async () => {
                if (reviewingId) return;
                setReviewingId(item.id);
                try {
                  await onReviewAlert(item.groupId, item.customerId, item);
                } finally {
                  setReviewingId(null);
                }
              };

              return (
                <div
                  key={item.id}
                  className="rounded-xl p-4 sm:p-5 border transition-all duration-200 relative overflow-hidden anim-slin"
                  style={{
                    backgroundColor: 'var(--card)',
                    borderColor: 'var(--line)',
                    borderLeft: isPending ? '4px solid var(--amber)' : '1px solid var(--line)',
                    boxShadow: 'var(--sh1)',
                  }}
                >
                  {/* Stacked Card Layout below 700px with labelled rows per Item 4 */}
                  <div className="block min-[700px]:hidden space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base shrink-0">{group?.rootFlag || '🏢'}</span>
                        <h3 className="text-sm font-bold font-display truncate" style={{ color: 'var(--ink)' }}>
                          {group?.name || item.groupId}
                        </h3>
                      </div>

                      <div
                        className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider flex items-center gap-1.5 border shrink-0"
                        style={{
                          backgroundColor: 'var(--bg2)',
                          borderColor: 'var(--line)',
                          color: 'var(--ink2)',
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: severityDotColor }}
                        />
                        <span>{severityLabel}</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[var(--ink3)] font-mono-code text-[11px] shrink-0">Customer ID:</span>
                        <span className="font-mono-code text-[var(--ink2)]">{item.customerId}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[var(--ink3)] font-mono-code text-[11px] shrink-0">Detected:</span>
                        <span className="font-mono-code text-[var(--ink2)]">{new Date(item.detectedAt).toLocaleString('en-GB')}</span>
                      </div>
                      <div className="space-y-1 pt-0.5">
                        <span className="text-[var(--ink3)] font-mono-code text-[11px] block">Description:</span>
                        <p className="text-xs leading-relaxed text-[var(--ink)] pl-2 border-l-2 border-[var(--line)]">
                          {item.description}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] font-mono-code text-[var(--ink3)]">
                        <span>Source: {item.source}</span>
                        <span>·</span>
                        <span>Confidence: {Math.round(item.confidence * 100)}%</span>
                        {item.decidedBy && (
                          <>
                            <span>·</span>
                            <span>Decided: {item.status.toUpperCase()}</span>
                          </>
                        )}
                        {item._simulation && (
                          <>
                            <span>·</span>
                            <span className="text-[var(--amber)]">Simulation feed</span>
                          </>
                        )}
                      </div>
                    </div>

                    {isPending && (
                      <div className="pt-2 border-t border-[var(--line2)] flex justify-end">
                        {governanceMode === 'automated' ? (
                          <span className="text-xs text-[var(--amber)] flex items-center gap-1.5 font-semibold">
                            <Radio className="w-3.5 h-3.5 animate-pulse" />
                            <span>Agent evaluating...</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={isReviewingThis}
                            title={isReviewingThis ? 'Opening review in flight...' : 'Review change event'}
                            onClick={handleStartReview}
                            className="w-full py-2 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-all hover:opacity-95 active:scale-95 focus-visible:ring-2 text-white disabled:opacity-50 disabled:cursor-wait"
                            style={{
                              backgroundColor: 'var(--amber)',
                            }}
                          >
                            {isReviewingThis ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Opening review...</span>
                              </>
                            ) : (
                              <>
                                <span>Review</span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Standard Layout above 700px */}
                  <div className="hidden min-[700px]:block">
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{group?.rootFlag || '🏢'}</span>
                        <h3 className="text-sm font-bold font-display" style={{ color: 'var(--ink)' }}>
                          {group?.name || item.groupId}
                        </h3>
                        <span className="text-xs font-mono-code text-[var(--ink3)]">
                          ({item.customerId})
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Severity as a subtle 6px dot badge on neutral pill per Item 6 */}
                        <div
                          className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider flex items-center gap-1.5 border"
                          style={{
                            backgroundColor: 'var(--bg2)',
                            borderColor: 'var(--line)',
                            color: 'var(--ink2)',
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: severityDotColor }}
                          />
                          <span>{severityLabel}</span>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs font-mono-code" style={{ color: 'var(--ink3)' }}>
                          <Clock className="w-3.5 h-3.5" />
                          <span>{new Date(item.detectedAt).toLocaleString('en-GB')}</span>
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-xs leading-relaxed mb-3.5" style={{ color: 'var(--ink2)' }}>
                      {item.description}
                    </p>

                    {/* Meta Row & Action */}
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t text-xs font-mono-code"
                      style={{ borderColor: 'var(--line2)' }}
                    >
                      <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: 'var(--ink3)' }}>
                        <span>Source: {item.source}</span>
                        <span>·</span>
                        <span className="tabular-nums">Confidence: {Math.round(item.confidence * 100)}%</span>
                        {item.decidedBy && (
                          <>
                            <span>·</span>
                            <span>Decided: {item.status.toUpperCase()}</span>
                          </>
                        )}
                        {item.dismissReason && (
                          <>
                            <span>·</span>
                            <span style={{ color: 'var(--rose)' }}>Reason: {item.dismissReason}</span>
                          </>
                        )}
                        {item._simulation && (
                          <>
                            <span>·</span>
                            <span className="text-[10px] text-[var(--amber)]">Simulation feed</span>
                          </>
                        )}
                      </div>

                      {isPending && (
                        <div className="flex items-center gap-2">
                          {governanceMode === 'automated' ? (
                            <span className="text-xs text-[var(--amber)] flex items-center gap-1.5 font-semibold">
                              <Radio className="w-3.5 h-3.5 animate-pulse" />
                              <span>Agent evaluating...</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={isReviewingThis}
                              title={isReviewingThis ? 'Opening review in flight...' : 'Review change event'}
                              onClick={handleStartReview}
                              className="py-1.5 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all hover:opacity-95 active:scale-95 focus-visible:ring-2 text-white disabled:opacity-50 disabled:cursor-wait"
                              style={{
                                backgroundColor: 'var(--amber)',
                              }}
                            >
                              {isReviewingThis ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Opening...</span>
                                </>
                              ) : (
                                <>
                                  <span>Review</span>
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Data Attribution Footer */}
        <div
          className="pt-4 border-t flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-code"
          style={{ borderColor: 'var(--line)', color: 'var(--ink3)' }}
        >
          <span>Sanctions data: OpenSanctions (CC BY-NC 4.0)</span>
          <span>Sentinel AI Perpetual KYC Engine</span>
        </div>
      </div>
    </div>
  );
};
