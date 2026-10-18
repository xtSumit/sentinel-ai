/**
 * Sentinel AI — Ownership Structures View
 * Conforms strictly to Item 4 & DESIGN.md:
 * - Card grid preserved and refined
 * - Page header with title, one-line description, neutral "Synthetic data" badge, primary "Initiate KYC" button
 * - Row of 4 compact neutral stat tiles (Structures, Onboarded, High risk, Average completeness)
 * - Search box and filter chips for Risk, Onboarding, and Jurisdiction
 * - Strict card layout: 40px neutral icon tile, wrapping 2-line name, info-icon scenario tooltip,
 *   single risk badge with rule tooltip, meta line with inline dot + onboarded text,
 *   four identical metric columns (LAYERS, UBOS, ENTITIES, COMPLETENESS with 48px bar and threshold tooltip),
 *   footer with <= 2 neutral outline trait chips (+n) and primary blue "Open tree →"
 */

import React, { useState, useMemo } from 'react';
import {
  ShieldAlert,
  Layers,
  Scale,
  RefreshCw,
  EyeOff,
  ArrowRight,
  Info,
  Search,
  Plus
} from 'lucide-react';
import { CorporateGroupSeed, ScenarioTrait } from '../types/bods';
import { bodsRepository } from '../data/repository';
import { resolveBeneficialOwnership } from '../engine/uboEngine';

interface OwnershipStructuresViewProps {
  groups: readonly CorporateGroupSeed[];
  onSelectGroup: (groupId: string) => void;
  onboardedCustomerMap?: Record<string, string>;
  onInitiateKyc?: () => void;
}

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  shield: ShieldAlert,
  layers: Layers,
  scale: Scale,
  refresh: RefreshCw,
  eye_off: EyeOff,
};

const TRAIT_LABELS: Record<ScenarioTrait, string> = {
  pep: 'PEP',
  banded: 'Banded',
  cross_border: 'Cross-border',
  cycle: 'Cycle',
  data_gap: 'Data gap',
};

export const OwnershipStructuresView: React.FC<OwnershipStructuresViewProps> = ({
  groups,
  onSelectGroup,
  onboardedCustomerMap = {},
  onInitiateKyc,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRisk, setSelectedRisk] = useState<string>('all');
  const [selectedOnboarding, setSelectedOnboarding] = useState<string>('all');
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<string>('all');

  // Compute stats and resolution map
  const { resolvedMap, stats } = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveBeneficialOwnership>>();
    let highRiskCount = 0;
    let onboardedCount = 0;
    let completenessSum = 0;

    groups.forEach((g) => {
      const jurRule = bodsRepository.getJurisdictionRule(g.rootJurisdiction);
      const threshold = jurRule ? jurRule.uboThreshold : 25;
      const resolved = resolveBeneficialOwnership(g, threshold);
      map.set(g.id, resolved);

      if (resolved.riskAssessment.tier === 'HIGH') {
        highRiskCount++;
      }
      if (onboardedCustomerMap[g.id]) {
        onboardedCount++;
      }
      completenessSum += resolved.completenessScore;
    });

    const avgCompleteness =
      groups.length > 0 ? (completenessSum / groups.length).toFixed(1) : '0.0';

    return {
      resolvedMap: map,
      stats: {
        total: groups.length,
        onboarded: onboardedCount,
        highRisk: highRiskCount,
        avgCompleteness: `${avgCompleteness}%`,
      },
    };
  }, [groups, onboardedCustomerMap]);

  // Unique jurisdictions for filter
  const jurisdictions = useMemo(() => {
    const set = new Set<string>();
    groups.forEach((g) => set.add(g.rootJurisdiction));
    return Array.from(set).sort();
  }, [groups]);

  // Filtered groups
  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      const resolved = resolvedMap.get(g.id);
      const rootEntity = g.entities.find((e) => e.id === g.rootEntityId);
      const isOnboarded = Boolean(onboardedCustomerMap[g.id]);

      // Search match
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = g.name.toLowerCase().includes(q);
        const idMatch = (rootEntity?.registrationId || '').toLowerCase().includes(q);
        const jurMatch = g.rootJurisdiction.toLowerCase().includes(q);
        if (!nameMatch && !idMatch && !jurMatch) return false;
      }

      // Risk filter
      if (selectedRisk !== 'all') {
        if (resolved?.riskAssessment.tier.toLowerCase() !== selectedRisk.toLowerCase()) {
          return false;
        }
      }

      // Onboarding filter
      if (selectedOnboarding === 'onboarded' && !isOnboarded) return false;
      if (selectedOnboarding === 'not_onboarded' && isOnboarded) return false;

      // Jurisdiction filter
      if (selectedJurisdiction !== 'all' && g.rootJurisdiction !== selectedJurisdiction) {
        return false;
      }

      return true;
    });
  }, [
    groups,
    resolvedMap,
    onboardedCustomerMap,
    searchQuery,
    selectedRisk,
    selectedOnboarding,
    selectedJurisdiction,
  ]);

  return (
    <div className="h-full w-full overflow-y-auto px-6 md:px-8 py-7 anim-vin select-text">
      <div className="max-w-[1360px] mx-auto space-y-6">
        {/* Page Header: Title, one-line description, "Synthetic data" badge, primary action "Initiate KYC" */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-2 border-b border-[var(--line)]">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex items-center gap-2.5">
              <span className="section-label">Beneficial Ownership · BODS v0.4</span>
              <span
                className="px-2 py-0.5 rounded-full text-[10.5px] font-mono-code font-semibold"
                style={{
                  backgroundColor: 'var(--bg2)',
                  color: 'var(--ink2)',
                  border: '1px solid var(--line)',
                }}
              >
                Synthetic data
              </span>
            </div>
            <h1
              className="font-display font-bold text-2xl tracking-tight"
              style={{ color: 'var(--ink)' }}
            >
              Ownership Structures
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink2)' }}>
              Deterministic multi-layer beneficial ownership graph resolution across corporate registries, banded disclosures, and offshore opacity gaps.
            </p>
          </div>

          {onInitiateKyc && (
            <button
              type="button"
              onClick={onInitiateKyc}
              className="py-2.5 px-4 rounded-xl text-xs font-bold text-white flex items-center gap-2 cursor-pointer shadow-sm transition-all hover:opacity-95 active:scale-[0.98] focus-visible:ring-2"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              <Plus className="w-4 h-4" />
              <span>Initiate KYC</span>
            </button>
          )}
        </div>

        {/* Four Compact Neutral Stat Tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div
            className="p-3.5 rounded-xl border flex flex-col justify-between"
            style={{
              backgroundColor: 'var(--card)',
              borderColor: 'var(--line)',
            }}
          >
            <span className="section-label">Structures</span>
            <div className="font-display font-bold text-[22px] tabular-nums mt-1" style={{ color: 'var(--ink)' }}>
              {stats.total}
            </div>
          </div>

          <div
            className="p-3.5 rounded-xl border flex flex-col justify-between"
            style={{
              backgroundColor: 'var(--card)',
              borderColor: 'var(--line)',
            }}
          >
            <span className="section-label">Onboarded</span>
            <div className="font-display font-bold text-[22px] tabular-nums mt-1" style={{ color: 'var(--ink)' }}>
              {stats.onboarded}
            </div>
          </div>

          <div
            className="p-3.5 rounded-xl border flex flex-col justify-between"
            style={{
              backgroundColor: 'var(--card)',
              borderColor: 'var(--line)',
            }}
          >
            <span className="section-label">High Risk</span>
            <div className="font-display font-bold text-[22px] tabular-nums mt-1" style={{ color: 'var(--ink)' }}>
              {stats.highRisk}
            </div>
          </div>

          <div
            className="p-3.5 rounded-xl border flex flex-col justify-between"
            style={{
              backgroundColor: 'var(--card)',
              borderColor: 'var(--line)',
            }}
          >
            <span className="section-label">Average Completeness</span>
            <div className="font-display font-bold text-[22px] tabular-nums mt-1 font-mono-code" style={{ color: 'var(--ink)' }}>
              {stats.avgCompleteness}
            </div>
          </div>
        </div>

        {/* Search Box and Filter Chips for Risk, Onboarding, and Jurisdiction */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Search Box */}
          <div className="relative min-w-[240px] flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink3)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entity name, registration ID, or country..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border outline-none transition-colors focus-visible:ring-2"
              style={{
                backgroundColor: 'var(--card)',
                borderColor: 'var(--line)',
                color: 'var(--ink)',
              }}
            />
          </div>

          {/* Filter Chips */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Risk filter */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg border bg-[var(--bg2)]" style={{ borderColor: 'var(--line)' }}>
              <span className="px-2 text-[10px] font-bold uppercase text-[var(--ink3)]">Risk:</span>
              {(['all', 'high', 'elevated', 'standard'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedRisk(r)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-colors cursor-pointer"
                  style={{
                    backgroundColor: selectedRisk === r ? 'var(--card)' : 'transparent',
                    color: selectedRisk === r ? 'var(--primary)' : 'var(--ink2)',
                    boxShadow: selectedRisk === r ? 'var(--sh1)' : 'none',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>

            {/* Onboarding filter */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg border bg-[var(--bg2)]" style={{ borderColor: 'var(--line)' }}>
              <span className="px-2 text-[10px] font-bold uppercase text-[var(--ink3)]">Status:</span>
              {[
                { id: 'all', label: 'All' },
                { id: 'onboarded', label: 'Onboarded' },
                { id: 'not_onboarded', label: 'Not onboarded' },
              ].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelectedOnboarding(o.id)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: selectedOnboarding === o.id ? 'var(--card)' : 'transparent',
                    color: selectedOnboarding === o.id ? 'var(--primary)' : 'var(--ink2)',
                    boxShadow: selectedOnboarding === o.id ? 'var(--sh1)' : 'none',
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {/* Jurisdiction filter */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg border bg-[var(--bg2)]" style={{ borderColor: 'var(--line)' }}>
              <span className="px-2 text-[10px] font-bold uppercase text-[var(--ink3)]">Jurisdiction:</span>
              <button
                type="button"
                onClick={() => setSelectedJurisdiction('all')}
                className="px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: selectedJurisdiction === 'all' ? 'var(--card)' : 'transparent',
                  color: selectedJurisdiction === 'all' ? 'var(--primary)' : 'var(--ink2)',
                  boxShadow: selectedJurisdiction === 'all' ? 'var(--sh1)' : 'none',
                }}
              >
                All
              </button>
              {jurisdictions.map((j) => (
                <button
                  key={j}
                  type="button"
                  onClick={() => setSelectedJurisdiction(j)}
                  className="px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: selectedJurisdiction === j ? 'var(--card)' : 'transparent',
                    color: selectedJurisdiction === j ? 'var(--primary)' : 'var(--ink2)',
                    boxShadow: selectedJurisdiction === j ? 'var(--sh1)' : 'none',
                  }}
                >
                  {j}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Card Grid per Item 4 */}
        <div
          className="grid gap-5"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          }}
        >
          {filteredGroups.map((group) => {
            const IconComponent = ICON_MAP[group.iconName] || ShieldAlert;
            const jurRule = bodsRepository.getJurisdictionRule(group.rootJurisdiction);
            const defaultThreshold = jurRule ? jurRule.uboThreshold : 25;
            const resolved = resolvedMap.get(group.id) || resolveBeneficialOwnership(group, defaultThreshold);
            const rootEntity = group.entities.find((e) => e.id === group.rootEntityId);
            const isOnboarded = Boolean(onboardedCustomerMap[group.id]);

            // Semantic dot color for the single risk badge
            const riskTier = resolved.riskAssessment.tier;
            const riskDotColor =
              riskTier === 'HIGH'
                ? 'var(--rose)'
                : riskTier === 'ELEVATED'
                ? 'var(--amber)'
                : 'var(--grey)';

            const visibleTraits = group.traits.slice(0, 2);
            const hiddenTraitsCount = Math.max(0, group.traits.length - 2);

            return (
              <div
                key={group.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectGroup(group.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectGroup(group.id);
                  }
                }}
                className="group text-left flex flex-col justify-between cursor-pointer rounded-[12px] p-5 border transition-all duration-200 focus-visible:ring-2 hover:-translate-y-0.5"
                style={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--line)',
                  boxShadow: 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--sh2)';
                  e.currentTarget.style.borderColor = 'var(--primary2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.borderColor = 'var(--line)';
                }}
              >
                <div>
                  {/* Top Row: 40px neutral icon tile, entity name (wrapped up to 2 lines), scenario info tooltip, meta line, ONE risk badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {/* 40px Neutral Icon Tile */}
                      <div
                        className="w-[40px] h-[40px] rounded-[10px] flex items-center justify-center shrink-0 border"
                        style={{
                          backgroundColor: 'var(--bg2)',
                          borderColor: 'var(--line)',
                          color: 'var(--ink2)',
                        }}
                      >
                        <IconComponent className="w-5 h-5" />
                      </div>

                      <div className="min-w-0">
                        {/* Name (wrapping to at most 2 lines, never single-line truncate) + Info icon with scenario tooltip */}
                        <div className="flex items-baseline gap-1.5">
                          <h2
                            className="font-display font-bold text-[15px] leading-snug line-clamp-2 text-[var(--ink)] group-hover:text-[var(--primary)] transition-colors"
                          >
                            {group.name}
                          </h2>
                          <span
                            title={group.scenarioSummary}
                            className="inline-flex shrink-0 cursor-help text-[var(--ink3)] hover:text-[var(--ink)] transition-colors"
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Scenario details: ${group.scenarioSummary}`}
                          >
                            <Info className="w-3.5 h-3.5 mt-0.5" />
                          </span>
                        </div>

                        {/* Meta line beneath: flag, jurisdiction code and mono registration id in --ink3, then " · Onboarded" / " · Not onboarded" with 6px dot */}
                        <div className="flex items-center flex-wrap gap-1.5 text-xs mt-1" style={{ color: 'var(--ink3)' }}>
                          <span>{group.rootFlag}</span>
                          <span>{group.rootJurisdiction}</span>
                          <span>·</span>
                          <span className="font-mono-code text-[11px]">
                            {rootEntity?.registrationId || group.rootEntityId}
                          </span>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1.5 text-[var(--ink2)] font-sans">
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{
                                backgroundColor: isOnboarded ? 'var(--emerald)' : 'var(--grey)',
                              }}
                            />
                            <span>{isOnboarded ? 'Onboarded' : 'Not onboarded'}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: ONE risk badge with tooltip naming the triggering rule */}
                    <div className="shrink-0">
                      <div
                        className="px-2.5 py-1 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider flex items-center gap-1.5 border cursor-help"
                        style={{
                          backgroundColor: 'var(--bg2)',
                          borderColor: 'var(--line)',
                          color: 'var(--ink2)',
                        }}
                        title={resolved.riskAssessment.reason}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: riskDotColor }}
                        />
                        <span>{riskTier}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div className="my-4 border-t border-[var(--line)]" />

                {/* Metrics Row: Four equal columns with identical labels: LAYERS, UBOS, ENTITIES, COMPLETENESS */}
                <div>
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {/* LAYERS */}
                    <div>
                      <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--ink3)]">
                        LAYERS
                      </div>
                      <div className="font-display font-bold text-[20px] tabular-nums mt-0.5 text-[var(--ink)]">
                        {resolved.maxLayerDepth}
                      </div>
                    </div>

                    {/* UBOS */}
                    <div>
                      <div
                        className="text-[10px] uppercase font-bold tracking-wider text-[var(--ink3)] cursor-help"
                        title="Uses root jurisdiction's statutory threshold"
                      >
                        UBOS
                      </div>
                      <div className="font-display font-bold text-[20px] tabular-nums mt-0.5 text-[var(--ink)]">
                        {resolved.uboCount}
                      </div>
                      <div className="text-[10.5px] font-mono-code text-[var(--ink3)] truncate">
                        {resolved.definiteCount} definite · {resolved.possibleCount} possible
                      </div>
                    </div>

                    {/* ENTITIES */}
                    <div>
                      <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--ink3)]">
                        ENTITIES
                      </div>
                      <div className="font-display font-bold text-[20px] tabular-nums mt-0.5 text-[var(--ink)]">
                        {group.entities.length}
                      </div>
                    </div>

                    {/* COMPLETENESS */}
                    <div>
                      <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--ink3)]">
                        COMPLETENESS
                      </div>
                      <div className="font-display font-bold text-[20px] tabular-nums mt-0.5 font-mono-code text-[var(--ink)]">
                        {resolved.completenessScore}%
                      </div>
                      {/* 48px bar that is amber below 70% and --primary2 otherwise */}
                      <div
                        className="w-[48px] h-[5px] rounded-full overflow-hidden mt-1.5"
                        style={{ backgroundColor: 'var(--line)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, resolved.completenessScore)}%`,
                            backgroundColor:
                              resolved.completenessScore < 70
                                ? 'var(--amber)'
                                : 'var(--primary2)',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Footer: At most two neutral outline trait chips (+n) and "Open tree →" in primary blue */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--line2)]">
                    <div className="flex items-center gap-1.5">
                      {visibleTraits.map((t) => (
                        <span
                          key={t}
                          className="px-2 py-0.5 text-[10.5px] font-medium rounded-md border"
                          style={{
                            backgroundColor: 'var(--bg2)',
                            borderColor: 'var(--line)',
                            color: 'var(--ink2)',
                          }}
                        >
                          {TRAIT_LABELS[t] || t}
                        </span>
                      ))}
                      {hiddenTraitsCount > 0 && (
                        <span
                          className="px-1.5 py-0.5 text-[10.5px] font-mono-code text-[var(--ink3)]"
                        >
                          +{hiddenTraitsCount}
                        </span>
                      )}
                    </div>

                    <span
                      className="text-xs font-semibold flex items-center gap-1 text-[var(--primary)] group-hover:translate-x-0.5 transition-transform shrink-0"
                    >
                      <span>Open tree</span>
                      <ArrowRight className="w-3.5 h-3.5" />
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
