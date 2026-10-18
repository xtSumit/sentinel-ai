/**
 * Sentinel AI — Live Immutable Audit Trail
 * Built per Custom Instructions §9 & prompt Section 5:
 * - 2px vertical timeline line, coloured dots, mono timestamps
 * - Actor chips: AI (primary blue), HUMAN (emerald), SYSTEM (grey)
 * - Live updates via Firestore onSnapshot listener
 * - Strict zero-PII logging: record IDs and regulatory status codes only
 */

import React, { useEffect, useState } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { Shield, Sparkles, User, Terminal, Clock, Filter } from 'lucide-react';

interface AuditRecord {
  id: string;
  actorUid: string;
  actorType: 'HUMAN' | 'SYSTEM' | 'AI';
  actorName: string;
  action: string;
  summary: string;
  timestamp?: any;
  isoTimestamp?: string;
  customerId?: string;
  groupId?: string;
  isAiGenerated?: boolean;
  details?: Record<string, unknown>;
}

interface AuditTrailViewProps {
  groupId?: string;
  customerId?: string;
  onRecordsCountChange?: (count: number) => void;
}

export const AuditTrailView: React.FC<AuditTrailViewProps> = ({ groupId, customerId, onRecordsCountChange }) => {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actorFilter, setActorFilter] = useState<'ALL' | 'HUMAN' | 'AI' | 'SYSTEM'>('ALL');

  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const auditCol = collection(db, 'audit');

    // Build query filtered to current group if supplied
    let q = query(auditCol, limit(100));
    if (groupId) {
      q = query(auditCol, where('groupId', '==', groupId), limit(100));
    } else if (customerId) {
      q = query(auditCol, where('customerId', '==', customerId), limit(100));
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: AuditRecord[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            actorUid: data.actorUid,
            actorType: data.actorType || 'SYSTEM',
            actorName: data.actorName || 'System',
            action: data.action,
            summary: data.summary,
            timestamp: data.timestamp,
            customerId: data.customerId,
            groupId: data.groupId,
            isAiGenerated: data.isAiGenerated,
            details: data.details
          });
        });

        // Sort descending by timestamp in memory (ensures consistent order without complex compound index requirements)
        list.sort((a, b) => {
          const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
          const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
          return timeB - timeA;
        });

        setRecords(list);
        onRecordsCountChange?.(list.length);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.GET, 'audit');
      }
    );

    return () => unsubscribe();
  }, [user, groupId, customerId]);

  const filteredRecords = records.filter((rec) => {
    if (actorFilter === 'ALL') return true;
    return rec.actorType === actorFilter;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: 'var(--line)' }}>
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <Shield className="w-4 h-4" style={{ color: 'var(--primary)' }} />
            <span>Immutable Regulatory Audit Trail</span>
          </h2>
          <p className="text-xs font-mono-code mt-0.5" style={{ color: 'var(--ink2)' }}>
            Append-only compliance log · Zero-PII sanitised · Live Firestore sync
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg border" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
          <Filter className="w-3 h-3 ml-1.5" style={{ color: 'var(--ink3)' }} />
          {(['ALL', 'HUMAN', 'AI', 'SYSTEM'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setActorFilter(type)}
              className="text-[10px] font-mono-code px-2 py-0.5 rounded font-medium transition-all cursor-pointer focus-visible:ring-2"
              style={{
                backgroundColor: actorFilter === type ? 'var(--card)' : 'transparent',
                color: actorFilter === type ? 'var(--primary)' : 'var(--ink2)',
                boxShadow: actorFilter === type ? 'var(--sh1)' : 'none'
              }}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-xs font-mono-code" style={{ color: 'var(--ink2)' }}>
          Connecting to audit log feed...
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-dashed p-6" style={{ borderColor: 'var(--line)' }}>
          <p className="text-xs font-mono-code" style={{ color: 'var(--ink2)' }}>
            No audit records found matching criteria. Actions in this workspace are continuously journaled.
          </p>
        </div>
      ) : (
        /* Vertical Timeline */
        <div className="relative pl-6 space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-[var(--line)]">
          {filteredRecords.map((item) => {
            const isHuman = item.actorType === 'HUMAN';
            const isAi = item.actorType === 'AI';

            const dotColor = isAi ? 'var(--primary)' : isHuman ? 'var(--emerald)' : 'var(--grey)';
            const chipBg = isAi ? 'var(--primary-s)' : isHuman ? 'var(--emerald-s)' : 'var(--bg2)';
            const chipColor = isAi ? 'var(--primary)' : isHuman ? 'var(--emerald)' : 'var(--ink2)';

            const tsMillis = item.timestamp?.toMillis ? item.timestamp.toMillis() : (item.timestamp?.seconds ? item.timestamp.seconds * 1000 : Date.now());
            const dateObj = new Date(tsMillis);

            const formattedTime = dateObj.toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              fractionalSecondDigits: 3
            });

            const formattedDate = dateObj.toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric'
            });

            return (
              <div
                key={item.id}
                className="relative flex items-start gap-3 group animate-slide-in"
              >
                {/* Colored Dot on Timeline */}
                <div
                  className="absolute -left-[19px] top-1.5 w-2.5 h-2.5 rounded-full border-2 transition-transform duration-200 group-hover:scale-125"
                  style={{
                    backgroundColor: dotColor,
                    borderColor: 'var(--card)',
                    boxShadow: `0 0 6px ${dotColor}`
                  }}
                />

                {/* Content Block */}
                <div
                  className="flex-1 rounded-xl p-3.5 transition-all duration-150 border"
                  style={{
                    backgroundColor: 'var(--card)',
                    borderColor: 'var(--line)'
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    {/* Actor Chip */}
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-mono-code px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1 border"
                        style={{ backgroundColor: chipBg, color: chipColor, borderColor: 'var(--line)' }}
                      >
                        {isAi && <Sparkles className="w-2.5 h-2.5" />}
                        {isHuman && <User className="w-2.5 h-2.5" />}
                        {!isAi && !isHuman && <Terminal className="w-2.5 h-2.5" />}
                        <span>{item.actorType}</span>
                      </span>

                      <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                        {item.action}
                      </span>
                    </div>

                    {/* Mono Timestamp */}
                    <div className="flex items-center gap-1 text-[11px] font-mono-code" style={{ color: 'var(--ink2)' }}>
                      <Clock className="w-3 h-3" />
                      <span>{formattedDate} {formattedTime}</span>
                    </div>
                  </div>

                  {/* Summary */}
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--ink)' }}>
                    {item.summary}
                  </p>

                  {/* Meta / IDs */}
                  <div className="mt-2 pt-2 border-t flex flex-wrap items-center gap-3 text-[10px] font-mono-code" style={{ borderColor: 'var(--line2)', color: 'var(--ink3)' }}>
                    <span>Actor: {item.actorName}</span>
                    {item.customerId && <span>Customer: {item.customerId}</span>}
                    {item.groupId && <span>Group: {item.groupId}</span>}
                    {item.isAiGenerated && (
                      <span style={{ color: 'var(--primary)' }}>Model-Assisted Rationale</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
