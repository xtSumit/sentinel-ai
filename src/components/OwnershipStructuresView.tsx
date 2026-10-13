import React from 'react';
import {
  ShieldAlert,
  Layers,
  Scale,
  RefreshCw,
  EyeOff,
  ArrowUpRight,
  Database,
} from 'lucide-react';
import { CorporateGroupSeed, ScenarioTrait } from '../types/bods';
import { bodsRepository } from '../data/repository';
import { resolveBeneficialOwnership } from '../engine/uboEngine';

interface OwnershipStructuresViewProps {
  groups: readonly CorporateGroupSeed[];
  onSelectGroup: (groupId: string) => void;
  onboardedCustomerMap?: Record<string, string>;
}

const ICON_MAP = {
  shield: ShieldAlert,
  layers: Layers,
  scale: Scale,
  refresh: RefreshCw,
  eye_off: EyeOff,
};

const ACCENT_STYLES: Record<
  CorporateGroupSeed['accentColor'],
  { bg: string; fg: string; border: string }
> = {
  amber: {
    bg: 'var(--amber-s)',
    fg: 'var(--amber)',
    border: 'rgba(217, 119, 6, 0.2)',
  },
  primary: {
    bg: 'var(--primary-s)',
    fg: 'var(--primary)',
    border: 'rgba(1, 110, 253, 0.2)',
  },
  emerald: {
    bg: 'var(--emerald-s)',
    fg: 'var(--emerald)',
    border: 'rgba(5, 150, 105, 0.2)',
  },
  coral: {
    bg: 'var(--coral-s)',
    fg: 'var(--coral)',
    border: 'rgba(244, 85, 63, 0.2)',
  },
  grey: {
    bg: 'var(--grey-s)',
    fg: 'var(--ink2)',
    border: 'rgba(139, 135, 152, 0.25)',
  },
};

const TRAIT_META: Record<
  ScenarioTrait,
  { label: string; bg: string; fg: string }
> = {
  pep: {
    label: 'PEP',
    bg: 'var(--amber-s)',
    fg: 'var(--amber)',
  },
  banded: {
    label: 'Banded',
    bg: 'var(--primary-s)',
    fg: 'var(--primary)',
  },
  cross_border: {
    label: 'Cross-border',
    bg: 'var(--emerald-s)',
    fg: 'var(--emerald)',
  },
  cycle: {
    label: 'Cycle',
    bg: 'var(--coral-s)',
    fg: 'var(--coral)',
  },
  data_gap: {
    label: 'Data gap',
    bg: 'var(--grey-s)',
    fg: 'var(--grey)',
  },
};

const RISK_PILL_STYLES: Record<
  CorporateGroupSeed['riskTone'],
  { bg: string; fg: string }
> = {
  rose: { bg: 'var(--rose-s)', fg: 'var(--rose)' },
  amber: { bg: 'var(--amber-s)', fg: 'var(--amber)' },
  emerald: { bg: 'var(--emerald-s)', fg: 'var(--emerald)' },
  primary: { bg: 'var(--primary-s)', fg: 'var(--primary)' },
  grey: { bg: 'var(--grey-s)', fg: 'var(--grey)' },
};

export const OwnershipStructuresView: React.FC<OwnershipStructuresViewProps> = ({
  groups,
  onSelectGroup,
  onboardedCustomerMap = {},
}) => {
  return (
    <div className="h-full w-full overflow-y-auto px-8 py-7 anim-vin select-text">
      <div className="max-w-[1360px] mx-auto">
        {/* Header Section */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="section-label">Beneficial Ownership · BODS v0.4</span>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-semibold"
                style={{
                  backgroundColor: 'var(--bg2)',
                  color: 'var(--ink2)',
                  border: '1px solid var(--line)',
                }}
              >
                Synthetic dataset · 100% fictional persons
              </span>
            </div>
            <h1
              className="font-display font-extrabold"
              style={{ fontSize: '22px', color: 'var(--ink)' }}
            >
              Ownership Structures
            </h1>
            <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--ink2)' }}>
              Deterministic multi-layer ownership resolution across corporate registries, banded
              disclosures, circular cross-holdings, and offshore opacity gaps. Select a corporate
              group to inspect its ownership graph and arithmetic provenance.
            </p>
          </div>

          <div
            className="flex items-center gap-4 px-4 py-2.5 rounded-xl text-xs"
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--line)',
              boxShadow: 'var(--sh1)',
            }}
          >
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              <span style={{ color: 'var(--ink2)' }}>Corporate Groups:</span>
              <span className="font-mono-code font-bold" style={{ color: 'var(--ink)' }}>
                {groups.length}
              </span>
            </div>
            <span style={{ color: 'var(--line)' }}>|</span>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--ink2)' }}>Standard:</span>
              <span className="font-mono-code font-semibold" style={{ color: 'var(--primary)' }}>
                BODS v0.4
              </span>
            </div>
          </div>
        </div>

        {/* Responsive Grid of Cards (min 330px) */}
        <div
          className="grid gap-5"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          }}
        >
          {groups.map((group) => {
            const Icon = ICON_MAP[group.iconName] || ShieldAlert;
            const accent = ACCENT_STYLES[group.accentColor];
            const riskStyle = RISK_PILL_STYLES[group.riskTone];
            const rule = bodsRepository.getJurisdictionRule(group.rootJurisdiction);
            const defaultThreshold = rule ? rule.uboThreshold : 25;
            const resolved = resolveBeneficialOwnership(group, defaultThreshold);
            const rootEntity = group.entities.find((e) => e.id === group.rootEntityId);

            return (
              <div
                key={group.id}
                onClick={() => onSelectGroup(group.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectGroup(group.id);
                  }
                }}
                className="sentinel-card text-left flex flex-col justify-between cursor-pointer group focus:outline-none focus-visible:ring-2"
              >
                <div>
                  {/* Top Row: 44px coloured icon tile, entity name, meta line, Status pill top-right */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div
                        className="w-[44px] h-[44px] rounded-[12px] flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: accent.bg,
                          color: accent.fg,
                          border: `1px solid ${accent.border}`,
                        }}
                      >
                        <Icon className="w-5 h-5" />
                      </div>

                      <div className="min-w-0">
                        <h2
                          className="font-display font-bold text-[15px] leading-snug truncate group-hover:text-[var(--primary)] transition-colors"
                          style={{ color: 'var(--ink)' }}
                        >
                          {group.name}
                        </h2>
                        <div
                          className="flex items-center flex-wrap gap-1.5 text-xs mt-1"
                          style={{ color: 'var(--ink2)' }}
                        >
                          <span>
                            {group.rootFlag} {group.rootJurisdiction}
                          </span>
                          <span>·</span>
                          <span
                            className="font-mono-code text-[11px]"
                            style={{ color: 'var(--ink3)' }}
                          >
                            {rootEntity?.registrationId}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Status Pills top-right (Onboarded status & deterministic risk tier) */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {onboardedCustomerMap && onboardedCustomerMap[group.id] ? (
                        <span
                          className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider flex items-center gap-1"
                          style={{
                            backgroundColor: 'rgba(5, 150, 105, 0.12)',
                            color: 'var(--emerald)',
                            border: '1px solid rgba(5, 150, 105, 0.25)'
                          }}
                          title={`Onboarded customer account ${onboardedCustomerMap[group.id]}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>Onboarded</span>
                        </span>
                      ) : (
                        <span
                          className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider flex items-center gap-1"
                          style={{
                            backgroundColor: 'rgba(139, 135, 152, 0.12)',
                            color: 'var(--ink3)',
                            border: '1px solid var(--line)'
                          }}
                          title="Not onboarded in KYC registry. Explore freely or onboard in KYC Initiation."
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                          <span>Not onboarded</span>
                        </span>
                      )}

                      <span
                        className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider cursor-help transition-all"
                        style={{
                          backgroundColor: RISK_PILL_STYLES[resolved.riskAssessment.tone].bg,
                          color: RISK_PILL_STYLES[resolved.riskAssessment.tone].fg,
                        }}
                        title={resolved.riskAssessment.reason}
                      >
                        {resolved.riskAssessment.label}
                      </span>
                    </div>
                  </div>

                  {/* Scenario Summary */}
                  <p
                    className="text-xs leading-relaxed mt-3.5 line-clamp-2"
                    style={{ color: 'var(--ink2)' }}
                  >
                    {group.scenarioSummary}
                  </p>
                </div>

                <div className="mt-4 pt-3.5" style={{ borderTop: '1px solid var(--line2)' }}>
                  {/* Metrics Row: Layer count, UBO count, Threshold, Completeness */}
                  <div className="grid grid-cols-4 gap-2 mb-3.5">
                    <div>
                      <div
                        className="text-[10px] uppercase font-semibold"
                        style={{ color: 'var(--ink3)' }}
                      >
                        Layers
                      </div>
                      <div
                        className="font-mono-code font-bold text-sm mt-0.5"
                        style={{ color: 'var(--ink)' }}
                      >
                        {resolved.maxLayerDepth} tiers
                      </div>
                    </div>
                    <div>
                      <div
                        className="text-[10px] uppercase font-semibold"
                        style={{ color: 'var(--ink3)' }}
                      >
                        UBOs ({defaultThreshold}%)
                      </div>
                      <div
                        className="font-mono-code font-bold text-sm mt-0.5"
                        style={{
                          color:
                            resolved.possibleCount > 0
                              ? 'var(--amber)'
                              : resolved.definiteCount > 0
                              ? 'var(--emerald)'
                              : 'var(--ink)',
                        }}
                      >
                        {resolved.uboCount}{' '}
                        <span
                          className="text-[11px] font-normal"
                          style={{ color: 'var(--ink3)' }}
                        >
                          ({resolved.definiteCount}D/{resolved.possibleCount}P)
                        </span>
                      </div>
                    </div>
                    <div>
                      <div
                        className="text-[10px] uppercase font-semibold"
                        style={{ color: 'var(--ink3)' }}
                      >
                        Entities
                      </div>
                      <div
                        className="font-mono-code font-bold text-sm mt-0.5"
                        style={{ color: 'var(--ink)' }}
                      >
                        {group.entities.length}
                      </div>
                    </div>
                    <div>
                      <div
                        className="text-[10px] uppercase font-semibold"
                        style={{ color: 'var(--ink3)' }}
                      >
                        Completeness
                      </div>
                      <div
                        className="font-mono-code font-bold text-sm mt-0.5"
                        style={{
                          color:
                            resolved.completenessScore < 100
                              ? 'var(--amber)'
                              : 'var(--primary)',
                        }}
                      >
                        {resolved.completenessScore}%
                      </div>
                    </div>
                  </div>

                  {/* Chip Row: small 14px-radius chips in soft variants */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {group.traits.map((trait) => {
                        const meta = TRAIT_META[trait];
                        return (
                          <span
                            key={trait}
                            className="px-2.5 py-0.5 text-[11px] font-semibold"
                            style={{
                              borderRadius: '14px',
                              backgroundColor: meta.bg,
                              color: meta.fg,
                            }}
                          >
                            {meta.label}
                          </span>
                        );
                      })}
                      <span
                        className="px-2.5 py-0.5 text-[11px] font-mono-code font-medium"
                        style={{
                          borderRadius: '14px',
                          backgroundColor: 'var(--bg2)',
                          color: 'var(--ink2)',
                        }}
                      >
                        {group.rootJurisdiction} {defaultThreshold}% Rule
                      </span>
                    </div>

                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold shrink-0 group-hover:translate-x-0.5 transition-transform"
                      style={{ color: 'var(--primary)' }}
                    >
                      <span>Open Tree</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
