import React from 'react';
import { X, AlertTriangle, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { CorporateGroupSeed } from '../types/bods';
import {
  formatEffectiveRange,
  formatSharePct,
  UboResolutionResult,
} from '../engine/uboEngine';
import { SelectedGraphNode } from './OwnershipGraph';

interface NodeDrawerProps {
  selected: SelectedGraphNode | null;
  group: CorporateGroupSeed;
  resolution: UboResolutionResult;
  onClose: () => void;
}

export const NodeDrawer: React.FC<NodeDrawerProps> = ({
  selected,
  group,
  resolution,
  onClose,
}) => {
  if (!selected) return null;

  const getNodeLabel = (id: string): string => {
    return (
      group.entities.find((e) => e.id === id)?.name ??
      group.persons.find((p) => p.id === id)?.name ??
      group.unspecifiedOwners.find((u) => u.id === id)?.label ??
      id
    );
  };

  const nodeId = selected.record.id;
  const ownedByRelationships =
    selected.kind === 'implicitGap'
      ? []
      : group.relationships.filter((r) => r.subjectId === nodeId);
  const ownsRelationships =
    selected.kind === 'implicitGap'
      ? []
      : group.relationships.filter((r) => r.interestedPartyId === nodeId);

  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-[372px] z-30 flex flex-col anim-drawer select-text"
      style={{
        backgroundColor: 'var(--card)',
        borderLeft: '1px solid var(--line)',
        boxShadow: 'var(--sh3)',
      }}
      role="dialog"
      aria-label="Node Details Drawer"
    >
      {/* Drawer Header */}
      <div
        className="px-4 py-3.5 flex items-start justify-between gap-3 shrink-0"
        style={{ borderBottom: '1px solid var(--line)' }}
      >
        <div className="min-w-0">
          <div className="section-label mb-1">
            {selected.kind === 'entity'
              ? 'BODS Entity Record'
              : selected.kind === 'person'
              ? 'BODS Natural Person Record'
              : selected.kind === 'unspecified'
              ? 'BODS Unspecified Owner Record'
              : 'Unaccounted Ownership Gap'}
          </div>
          <h3
            className="font-display font-bold text-base leading-snug truncate"
            style={{ color: 'var(--ink)' }}
          >
            {selected.kind === 'unspecified'
              ? selected.record.label
              : selected.kind === 'implicitGap'
              ? selected.record.label
              : `${selected.kind === 'entity' ? selected.record.countryFlag : selected.record.flag} ${selected.record.name}`}
          </h3>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg2)] transition-colors shrink-0"
          aria-label="Close node drawer"
        >
          <X className="w-4 h-4" style={{ color: 'var(--ink2)' }} />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Amber Note Box for PEP, Data Gaps, or Dissolved Status */}
        {selected.kind === 'person' && selected.record.pepStatus !== 'none' && (
          <div
            className="p-3 rounded-xl flex items-start gap-2.5 text-xs"
            style={{
              backgroundColor: 'var(--amber-s)',
              border: '1px solid rgba(217, 119, 6, 0.28)',
              color: 'var(--amber)',
            }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold uppercase tracking-wide text-[10px] mb-0.5">
                Politically Exposed Person ({selected.record.pepStatus.toUpperCase()})
              </div>
              <div style={{ color: 'var(--ink)' }}>
                {selected.record.pepRoleDescription ||
                  'Enhanced Due Diligence required under multi-layer PEP control policy.'}
              </div>
            </div>
          </div>
        )}

        {selected.kind === 'unspecified' && (
          <div
            className="p-3 rounded-xl flex items-start gap-2.5 text-xs"
            style={{
              backgroundColor: 'var(--amber-s)',
              border: '1px solid rgba(217, 119, 6, 0.28)',
              color: 'var(--amber)',
            }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold uppercase tracking-wide text-[10px] mb-0.5">
                Ownership Opacity Gap · -{selected.record.estimatedImpactOnCompleteness}% Completeness
              </div>
              <div style={{ color: 'var(--ink)' }}>{selected.record.description}</div>
            </div>
          </div>
        )}

        {selected.kind === 'entity' && selected.record.status === 'dissolved' && (
          <div
            className="p-3 rounded-xl flex items-start gap-2.5 text-xs"
            style={{
              backgroundColor: 'var(--rose-s)',
              border: '1px solid rgba(225, 29, 72, 0.25)',
              color: 'var(--rose)',
            }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold uppercase tracking-wide text-[10px] mb-0.5">
                Dissolved Legal Entity — Excluded from Active UBO Chains
              </div>
              <div style={{ color: 'var(--ink)' }}>
                This entity is struck off / dissolved and is skipped during deterministic effective
                ownership multiplication, while remaining visible for historical audit completeness.
              </div>
            </div>
          </div>
        )}

        {/* Key-Value Rows */}
        <div
          className="rounded-xl p-3 space-y-2.5 text-xs"
          style={{
            backgroundColor: 'var(--bg2)',
            border: '1px solid var(--line)',
          }}
        >
          <div className="section-label mb-1">Attributes</div>

          <KeyValueRow label="BODS Statement ID" value={selected.record.id} mono />

          {selected.kind === 'entity' && (
            <>
              <KeyValueRow label="Entity Type" value={selected.record.entityType.toUpperCase()} />
              <KeyValueRow
                label="Jurisdiction"
                value={`${selected.record.countryFlag} ${selected.record.jurisdictionCode}`}
              />
              <KeyValueRow label="Registration ID" value={selected.record.registrationId} mono />
              <KeyValueRow label="Status" value={selected.record.status.toUpperCase()} mono />
              <KeyValueRow label="Registered Address" value={selected.record.registeredAddress} />
              <KeyValueRow label="Primary Source" value={selected.record.source} />
              <KeyValueRow label="As-Of Date" value={selected.record.asOfDate} mono />
            </>
          )}

          {selected.kind === 'person' && (
            <>
              <KeyValueRow
                label="Nationality"
                value={`${selected.record.flag} ${selected.record.nationality}`}
              />
              <KeyValueRow
                label="Year of Birth"
                value={String(selected.record.yearOfBirth)}
                mono
              />
              <KeyValueRow
                label="PEP Classification"
                value={selected.record.pepStatus.toUpperCase()}
                mono
              />
              {selected.record.pepRoleDescription && (
                <KeyValueRow label="Role / Mandate" value={selected.record.pepRoleDescription} />
              )}
              {selected.resolved && (
                <>
                  <KeyValueRow
                    label={`Classification (${resolution.thresholdPct}%)`}
                    value={selected.resolved.classification}
                    mono
                  />
                  <KeyValueRow
                    label="Effective Root Stake"
                    value={formatEffectiveRange(
                      selected.resolved.totalMinPct,
                      selected.resolved.totalMaxPct
                    )}
                    mono
                  />
                </>
              )}
              <KeyValueRow label="Synthetic Flag" value="synthetic: true (Fictional)" mono />
            </>
          )}

          {selected.kind === 'unspecified' && (
            <>
              <KeyValueRow label="BODS Gap Reason" value={selected.record.reason} mono />
              <KeyValueRow
                label="Completeness Deduction"
                value={`-${selected.record.estimatedImpactOnCompleteness}%`}
                mono
              />
              <KeyValueRow label="Source" value={selected.record.source} />
              <KeyValueRow label="As-Of Date" value={selected.record.asOfDate} mono />
            </>
          )}

          {selected.kind === 'implicitGap' && (
            <>
              <KeyValueRow label="Subject Entity" value={selected.record.entityName} />
              <KeyValueRow label="Unidentified Remainder" value={`${selected.record.remainderPct}%`} mono />
              <KeyValueRow label="Identified Share" value={`${selected.record.identifiedSharePct}%`} mono />
              <KeyValueRow
                label="Entity Stake in Root"
                value={`${selected.record.entityEffectiveStakeInRoot}%`}
                mono
              />
              <KeyValueRow
                label="Impact on Root"
                value={`-${selected.record.effectOnRootPct}%`}
                mono
              />
              <KeyValueRow
                label="Statutory Context"
                value="May include holdings below statutory disclosure threshold"
              />
            </>
          )}
        </div>

        {/* Relationships Section */}
        <div className="space-y-3">
          <div className="section-label">Direct Relationships</div>

          {ownedByRelationships.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold flex items-center gap-1" style={{ color: 'var(--ink2)' }}>
                <ArrowDownLeft className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                <span>Owned / Controlled By ({ownedByRelationships.length})</span>
              </div>
              {ownedByRelationships.map((rel) => {
                const primary = rel.interests[0];
                return (
                  <div
                    key={rel.id}
                    className="p-2.5 rounded-lg text-xs flex items-center justify-between gap-2"
                    style={{
                      backgroundColor: 'var(--bg2)',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate" style={{ color: 'var(--ink)' }}>
                        {getNodeLabel(rel.interestedPartyId)}
                      </div>
                      <div className="text-[10px] font-mono-code mt-0.5" style={{ color: 'var(--ink3)' }}>
                        {primary?.type.replace(/_/g, ' ')} · {primary?.asOfDate}
                      </div>
                    </div>
                    {primary && (
                      <span
                        className="px-2 py-0.5 rounded font-mono-code font-bold text-xs shrink-0"
                        style={{
                          backgroundColor: 'var(--primary-s)',
                          color: 'var(--primary)',
                        }}
                      >
                        {formatSharePct(primary.share)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {ownsRelationships.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold flex items-center gap-1" style={{ color: 'var(--ink2)' }}>
                <ArrowUpRight className="w-3.5 h-3.5" style={{ color: 'var(--emerald)' }} />
                <span>Holds Stake / Interest In ({ownsRelationships.length})</span>
              </div>
              {ownsRelationships.map((rel) => {
                const primary = rel.interests[0];
                return (
                  <div
                    key={rel.id}
                    className="p-2.5 rounded-lg text-xs flex items-center justify-between gap-2"
                    style={{
                      backgroundColor: 'var(--bg2)',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate" style={{ color: 'var(--ink)' }}>
                        {getNodeLabel(rel.subjectId)}
                      </div>
                      <div className="text-[10px] font-mono-code mt-0.5" style={{ color: 'var(--ink3)' }}>
                        {primary?.type.replace(/_/g, ' ')} · conf {(primary?.confidence ?? 1) * 100}%
                      </div>
                    </div>
                    {primary && (
                      <span
                        className="px-2 py-0.5 rounded font-mono-code font-bold text-xs shrink-0"
                        style={{
                          backgroundColor: 'var(--emerald-s)',
                          color: 'var(--emerald)',
                        }}
                      >
                        {formatSharePct(primary.share)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const KeyValueRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div className="flex items-start justify-between gap-3">
    <span className="shrink-0" style={{ color: 'var(--ink3)' }}>
      {label}
    </span>
    <span
      className={`text-right break-words ${mono ? 'font-mono-code font-medium' : 'font-medium'}`}
      style={{ color: 'var(--ink)' }}
    >
      {value}
    </span>
  </div>
);
