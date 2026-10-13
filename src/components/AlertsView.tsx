/**
 * Sentinel AI — Alerts & Live Monitoring View
 * Built per Custom Instructions §11 & prompt Section 3a:
 * - Watches events across all onboarded customers in real time
 * - Filter tabs: Pending, Monitoring, Dismissed, Accepted
 * - Supervisor demo panel: Customer selector + "Inject registry change"
 * - "Review" button opens customer workspace with monitoring banner active
 * - Automated mode processing indicator
 * - OpenSanctions attribution
 */

import React, { useState, useEffect } from 'react';
import { db, writeAuditRecord } from '../lib/firebase';
import { collection, query, onSnapshot, doc, updateDoc, setDoc } from 'firebase/firestore';
import { bodsRepository } from '../data/repository';
import { useAuth } from '../context/AuthContext';
import { getEventFeedAdapter } from '../adapters/eventFeedAdapter';
import {
  Bell,
  Radio,
  Clock,
  ArrowRight,
  Filter,
  CheckCircle2,
  XCircle,
  Eye,
  AlertTriangle,
  Building2,
  Zap,
  Info,
  ExternalLink
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
  const [selectedCustomerForInjection, setSelectedCustomerForInjection] = useState<string>('grp-01-aurelia');
  const [injecting, setInjecting] = useState(false);
  const [injectionSuccess, setInjectionSuccess] = useState<string | null>(null);

  const groups = bodsRepository.getGroups();

  useEffect(() => {
    const evCol = collection(db, 'events');
    const q = query(evCol);

    const unsubscribe = onSnapshot(q, (snapshot) => {
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
    });

    return () => unsubscribe();
  }, []);

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
        template = group.monitoringEventTemplates[0]; // fallback loop
      }

      const newEventId = `evt-${Date.now()}`;
      const adapter = getEventFeedAdapter();

      await adapter.publishEvent({
        id: newEventId,
        customerId: `CUS-2026-${group.id.slice(-4)}`,
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

      setInjectionSuccess(`Injected "${template.description}" via ${adapter.mode()} adapter.`);
      setTimeout(() => setInjectionSuccess(null), 4000);
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
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400">
              Live Registry Watch
            </span>
          </div>
          <h1
            className="text-2xl md:text-3xl font-bold tracking-tight mt-1"
            style={{
              fontFamily: "'Sora', sans-serif",
              background: 'linear-gradient(135deg, #FFFFFF 0%, #93C5FD 50%, #3B82F6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}
          >
            Alerts &amp; Perpetual Monitoring
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Continuous ingestion of corporate registry changes across all onboarded banking clients.
          </p>
        </div>

        {/* Pending Counter */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border bg-black/30" style={{ borderColor: 'var(--border)' }}>
          <Bell className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-mono font-bold" style={{ color: 'var(--ink-0)' }}>
            {pendingCount} Pending
          </span>
        </div>
      </div>

      {/* Supervisor Demo Panel */}
      {isSupervisor && (
        <div
          className="rounded-2xl p-4 md:p-5 border transition-all shadow-lg"
          style={{
            backgroundColor: 'rgba(30, 41, 59, 0.4)',
            borderColor: 'rgba(59, 130, 246, 0.3)',
            boxShadow: '0 0 30px rgba(59, 130, 246, 0.08)'
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Supervisor Registry Feed Simulator
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
              Adapter: PREVIEW / PUBSUB
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[240px]">
              <select
                value={selectedCustomerForInjection}
                onChange={(e) => setSelectedCustomerForInjection(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-700 text-slate-200 outline-none cursor-pointer"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.rootFlag} {g.name} ({g.monitoringEventTemplates.length} templates)
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleInjectChange}
              disabled={injecting}
              className="py-2 px-4 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all cursor-pointer shadow-md disabled:opacity-50"
            >
              {injecting ? 'Publishing Event...' : 'Inject Registry Change'}
            </button>
          </div>

          {injectionSuccess && (
            <p className="text-xs font-mono text-emerald-400 mt-2 flex items-center gap-1.5 animate-fade-in">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{injectionSuccess}</span>
            </p>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
        {(['pending', 'monitoring', 'accepted', 'dismissed'] as const).map((st) => (
          <button
            key={st}
            onClick={() => setFilterStatus(st)}
            className="text-xs font-mono font-semibold px-3 py-1.5 rounded-lg transition-all capitalize cursor-pointer"
            style={{
              backgroundColor: filterStatus === st ? 'var(--bg-2)' : 'transparent',
              color: filterStatus === st ? 'var(--ink-0)' : 'var(--ink-2)',
              border: filterStatus === st ? '1px solid var(--border)' : '1px solid transparent'
            }}
          >
            {st}
            {st === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-400">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Alerts List */}
      {filtered.length === 0 ? (
        <div
          className="text-center py-16 rounded-2xl border border-dashed p-8"
          style={{ borderColor: 'var(--border)' }}
        >
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-3 opacity-80" />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-0)' }}>
            All onboarded customers are being watched.
          </h3>
          <p className="text-xs font-mono mt-1" style={{ color: 'var(--ink-2)' }}>
            No changes currently require review in the "{filterStatus}" queue.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => {
            const group = groups.find((g) => g.id === item.groupId);
            const isPending = item.status === 'pending';

            return (
              <div
                key={item.id}
                className="rounded-2xl p-5 border transition-all duration-200 relative overflow-hidden shadow-lg animate-slide-in"
                style={{
                  backgroundColor: 'var(--bg-1)',
                  borderColor: isPending ? 'rgba(245, 158, 11, 0.4)' : 'var(--border)',
                  borderLeftWidth: '5px',
                  borderLeftColor: isPending ? 'var(--amber)' : item.status === 'accepted' ? 'var(--emerald)' : 'var(--ink-3)'
                }}
              >
                {item._simulation && (
                  <span className="absolute top-3 right-4 text-[9px] font-mono uppercase tracking-wider text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                    Simulated Change
                  </span>
                )}

                <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{group?.rootFlag || '🏢'}</span>
                    <h3 className="text-sm font-bold" style={{ color: 'var(--ink-0)' }}>
                      {group?.name || item.groupId}
                    </h3>
                    <span className="text-xs font-mono text-slate-400">({item.customerId})</span>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono" style={{ color: 'var(--ink-2)' }}>
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(item.detectedAt).toLocaleString('en-GB')}</span>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--ink-1)' }}>
                  {item.description}
                </p>

                {/* Meta Row & Action */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t text-xs font-mono" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: 'var(--ink-2)' }}>
                    <span>Source: {item.source}</span>
                    <span>Confidence: {Math.round(item.confidence * 100)}%</span>
                    {item.decidedBy && <span>Decided: {item.status.toUpperCase()}</span>}
                    {item.dismissReason && <span className="text-red-400">Reason: {item.dismissReason}</span>}
                  </div>

                  {isPending && (
                    <div className="flex items-center gap-2">
                      {governanceMode === 'automated' ? (
                        <span className="text-xs text-amber-400 flex items-center gap-1.5 font-semibold">
                          <Radio className="w-3.5 h-3.5 animate-ping" />
                          <span>Agent proceeding...</span>
                        </span>
                      ) : (
                        <button
                          onClick={() => onReviewAlert(item.groupId, item.customerId, item)}
                          className="py-1.5 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-md hover:scale-[1.02] active:scale-[0.98]"
                          style={{
                            background: 'linear-gradient(135deg, var(--amber) 0%, #D97706 100%)',
                            color: '#000000'
                          }}
                        >
                          <span>Review</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Data Attribution Footer */}
      <div className="pt-4 border-t flex items-center justify-between text-[11px] font-mono text-slate-500">
        <span>Sanctions data: OpenSanctions (CC BY-NC 4.0)</span>
        <span>Sentinel AI Perpetual KYC Engine</span>
      </div>
    </div>
  );
};
