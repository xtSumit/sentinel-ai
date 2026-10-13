import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ShieldAlert,
  Layers,
  Scale,
  RefreshCw,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Calculator,
  AlertCircle,
  ShieldCheck,
  FileClock,
  Radio,
  Zap,
  ArrowRight
} from 'lucide-react';
import { CorporateGroupSeed } from '../types/bods';
import { bodsRepository } from '../data/repository';
import {
  formatEffectiveRange,
  formatNumber,
  resolveBeneficialOwnership,
  ResolvedPersonUbo,
} from '../engine/uboEngine';
import { OwnershipGraph, SelectedGraphNode } from './OwnershipGraph';
import { NodeDrawer } from './NodeDrawer';
import { AuditTrailView } from './AuditTrailView';
import { useAuth } from '../context/AuthContext';
import { getEventFeedAdapter } from '../adapters/eventFeedAdapter';
import { writeAuditRecord } from '../lib/firebase';

interface EntityWorkspaceViewProps {
  group: CorporateGroupSeed;
  customerId?: string;
  onBack: () => void;
  pendingEvent?: any;
  onReviewEvent?: (event: any) => void;
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
  { bg: string; fg: string }
> = {
  amber: { bg: 'var(--amber-s)', fg: 'var(--amber)' },
  primary: { bg: 'var(--primary-s)', fg: 'var(--primary)' },
  emerald: { bg: 'var(--emerald-s)', fg: 'var(--emerald)' },
  coral: { bg: 'var(--coral-s)', fg: 'var(--coral)' },
  grey: { bg: 'var(--grey-s)', fg: 'var(--ink2)' },
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

type SideTab = 'ubos' | 'screening' | 'audit';
type ThresholdMode = 'jurisdiction' | '10' | '25';

export const EntityWorkspaceView: React.FC<EntityWorkspaceViewProps> = ({
  group,
  customerId,
  onBack,
  pendingEvent,
  onReviewEvent,
}) => {
  const { user, profile, isSupervisor } = useAuth();
  const [injecting, setInjecting] = useState(false);
  const jurisdictionRule = bodsRepository.getJurisdictionRule(group.rootJurisdiction);
  const jurisdictionThreshold = jurisdictionRule ? jurisdictionRule.uboThreshold : 25;
  const comparison = jurisdictionRule
    ? jurisdictionRule.comparison
    : group.rootJurisdiction.toUpperCase() === 'US'
      ? 'greater_or_equal'
      : 'strictly_greater';
  const comparisonSymbol = comparison === 'strictly_greater' ? '>' : '≥';

  const [thresholdMode, setThresholdMode] = useState<ThresholdMode>('jurisdiction');
  const [activeTab, setActiveTab] = useState<SideTab>('ubos');
  const [highlightedPersonId, setHighlightedPersonId] = useState<string | null>(null);
  const [selectedGraphNode, setSelectedGraphNode] = useState<SelectedGraphNode | null>(null);
  const [expandedMathIds, setExpandedMathIds] = useState<Record<string, boolean>>({});
  const [showBelowThreshold, setShowBelowThreshold] = useState<boolean>(true);
  const [animatedCompleteness, setAnimatedCompleteness] = useState<number>(0);

  // Reset state when switching corporate group
  useEffect(() => {
    setThresholdMode('jurisdiction');
    setHighlightedPersonId(null);
    setSelectedGraphNode(null);
  }, [group.id]);

  const activeThresholdPct = useMemo(() => {
    if (thresholdMode === '10') return 10;
    if (thresholdMode === '25') return 25;
    return jurisdictionThreshold;
  }, [thresholdMode, jurisdictionThreshold]);

  const resolution = useMemo(
    () => resolveBeneficialOwnership(group, activeThresholdPct, comparison),
    [group, activeThresholdPct, comparison]
  );

  // Animate completeness bar width over 1s
  useEffect(() => {
    setAnimatedCompleteness(0);
    const timer = setTimeout(() => {
      setAnimatedCompleteness(resolution.completenessScore);
    }, 60);
    return () => clearTimeout(timer);
  }, [group.id, resolution.completenessScore]);

  const rootEntity = group.entities.find((e) => e.id === group.rootEntityId);
  const Icon = ICON_MAP[group.iconName] || ShieldAlert;
  const accent = ACCENT_STYLES[group.accentColor];
  const riskStyle = RISK_PILL_STYLES[group.riskTone];

  const uboPersons = resolution.persons.filter(
    (p) => p.classification === 'DEFINITE' || p.classification === 'POSSIBLE'
  );
  const belowPersons = resolution.persons.filter((p) => p.classification === 'BELOW');

  const toggleMath = (personId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedMathIds((prev) => ({
      ...prev,
      [personId]: !prev[personId],
    }));
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden anim-vin">
      {/* WORKSPACE HEADER ROW — white, bottom border */}
      <div
        className="h-[62px] shrink-0 px-5 flex items-center justify-between gap-4 z-20"
        style={{
          backgroundColor: 'var(--card)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        {/* Left: 33px back button, 42px icon tile, entity name in Sora 16px, meta line with mono id chip on primary-s */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="w-[33px] h-[33px] rounded-lg flex items-center justify-center hover:bg-[var(--bg2)] transition-colors shrink-0"
            style={{ border: '1px solid var(--line)', color: 'var(--ink2)' }}
            title="Back to Ownership Structures"
            aria-label="Back to Ownership Structures"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div
            className="w-[42px] h-[42px] rounded-[11px] flex items-center justify-center shrink-0"
            style={{ backgroundColor: accent.bg, color: accent.fg }}
          >
            <Icon className="w-5 h-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1
                className="font-display font-bold truncate"
                style={{ fontSize: '16px', color: 'var(--ink)' }}
              >
                {group.name}
              </h1>
              {/* Visible "Synthetic data" label in the workspace header */}
              <span
                className="px-2 py-0.5 rounded text-[10px] font-mono-code font-semibold shrink-0"
                style={{
                  backgroundColor: 'var(--bg2)',
                  color: 'var(--ink2)',
                  border: '1px solid var(--line)',
                }}
              >
                Synthetic data
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs mt-0.5" style={{ color: 'var(--ink2)' }}>
              <span
                className="px-1.5 py-0.2 rounded font-mono-code text-[10.5px] font-semibold"
                style={{
                  backgroundColor: 'var(--primary-s)',
                  color: 'var(--primary)',
                }}
              >
                {rootEntity?.registrationId || group.rootEntityId}
              </span>
              <span>·</span>
              <span>
                {group.rootFlag} {jurisdictionRule?.name || group.rootJurisdiction}
              </span>
              {jurisdictionRule && (
                <>
                  <span>·</span>
                  <span className="truncate text-[11px]" style={{ color: 'var(--ink3)' }}>
                    {jurisdictionRule.regulationName}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Supervisor Injection Control & Risk pill */}
        <div className="flex items-center gap-2.5 shrink-0">
          {isSupervisor && (
            <button
              type="button"
              disabled={injecting}
              onClick={async () => {
                setInjecting(true);
                try {
                  const adapter = getEventFeedAdapter();
                  const tpl = group.monitoringEventTemplates[0];
                  const newEventId = `evt-${Date.now()}`;
                  await adapter.publishEvent({
                    id: newEventId,
                    customerId: customerId || `CUS-2026-${group.id.slice(-4)}`,
                    groupId: group.id,
                    templateId: tpl.id,
                    changeType: tpl.changeType as any,
                    payload: tpl.data as any,
                    description: tpl.description,
                    source: tpl.source,
                    confidence: tpl.confidence,
                    detectedAt: new Date().toISOString(),
                    status: 'pending'
                  });
                  if (user) {
                    await writeAuditRecord({
                      actorUid: user.uid,
                      actorType: 'HUMAN',
                      actorName: profile?.displayName || 'Supervisor',
                      action: 'REGISTRY_CHANGE_INJECTED',
                      summary: `Supervisor injected registry change for open workspace: ${group.name}.`,
                      groupId: group.id,
                      eventId: newEventId
                    });
                  }
                } catch (e: any) {
                  console.error(e);
                } finally {
                  setInjecting(false);
                }
              }}
              className="py-1 px-2.5 rounded-lg text-[10.5px] font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer border shadow-sm"
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                color: 'var(--primary)',
                borderColor: 'rgba(59, 130, 246, 0.3)'
              }}
              title="Supervisor demo: trigger registry change event for this open company"
            >
              <Zap className="w-3 h-3" />
              <span>{injecting ? 'Injecting...' : 'Inject Change'}</span>
            </button>
          )}

          <span
            className="px-3 py-1 rounded-full text-[11px] font-mono-code font-bold uppercase tracking-wider cursor-help transition-all"
            style={{
              backgroundColor: RISK_PILL_STYLES[resolution.riskAssessment.tone].bg,
              color: RISK_PILL_STYLES[resolution.riskAssessment.tone].fg,
            }}
            title={resolution.riskAssessment.reason}
          >
            {resolution.riskAssessment.label}
          </span>
        </div>
      </div>

      {/* MONITORING DROP-IN BANNER (If pending event for this customer) */}
      {pendingEvent && (
        <div
          className="mx-5 my-2.5 p-3 rounded-xl border flex items-center justify-between gap-4 shadow-lg animate-drop z-20"
          style={{
            backgroundColor: 'var(--card)',
            borderLeftWidth: '5px',
            borderLeftColor: 'var(--amber)',
            borderColor: 'rgba(245, 158, 11, 0.4)'
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
              <Radio className="w-4 h-4 text-amber-500 animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-500">
                  Live Registry Alert Detected
                </span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--ink3)' }}>
                  ({pendingEvent.source})
                </span>
              </div>
              <p className="text-xs font-medium truncate" style={{ color: 'var(--ink)' }}>
                {pendingEvent.description}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onReviewEvent?.(pendingEvent)}
            className="py-1.5 px-4 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 cursor-pointer shadow transition-all hover:scale-105 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, var(--amber) 0%, #D97706 100%)',
              color: '#000000'
            }}
          >
            <span>Review</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* WORKSPACE BODY: Graph Column + 318px Right Side Panel */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* GRAPH COLUMN */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
          {/* GRAPH TOOLBAR ABOVE CANVAS */}
          <div
            className="h-[42px] shrink-0 px-4 flex items-center justify-between gap-4 z-10"
            style={{
              backgroundColor: 'var(--bg2)',
              borderBottom: '1px solid var(--line)',
            }}
          >
            {/* Legend of small coloured swatches with labels */}
            <div className="flex items-center flex-wrap gap-3.5 text-[11px]" style={{ color: 'var(--ink2)' }}>
              <LegendSwatch color="var(--emerald)" label="Definite UBO / Person Edge" />
              <LegendSwatch color="var(--amber)" label="Possible UBO / PEP / Hot Edge" />
              <LegendSwatch color="#8fb0e3" label="Corporate Holding" />
              <LegendSwatch color="var(--grey)" label="Data Gap / Unknown" dashed />
              <LegendSwatch color="var(--rose)" label="Dissolved / Hit" />
            </div>

            {/* Right: Completeness Indicator (label, 86 by 6px track with signature-gradient fill animating over 1s, mono primary blue percentage) */}
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="text-[11px] font-medium" style={{ color: 'var(--ink2)' }}>
                Completeness
              </span>
              <div
                className="w-[86px] h-[6px] rounded-full overflow-hidden"
                style={{ backgroundColor: 'var(--line)' }}
              >
                <div
                  className="h-full rounded-full sig-gradient-bg"
                  style={{
                    width: `${animatedCompleteness}%`,
                    transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
              </div>
              <span
                className="font-mono-code font-bold text-xs"
                style={{ color: 'var(--primary)' }}
              >
                {resolution.completenessScore}%
              </span>
            </div>
          </div>

          {/* SVG GRAPH CANVAS */}
          <div className="flex-1 min-h-0 relative">
            <OwnershipGraph
              group={group}
              resolution={resolution}
              highlightedPersonId={highlightedPersonId}
              selectedNodeId={selectedGraphNode?.record.id ?? null}
              onSelectNode={(node) => setSelectedGraphNode(node)}
              onClearHighlight={() => {
                setHighlightedPersonId(null);
                setSelectedGraphNode(null);
              }}
            />

            {/* Slide-in Node Drawer (372px wide) */}
            <NodeDrawer
              selected={selectedGraphNode}
              group={group}
              resolution={resolution}
              onClose={() => setSelectedGraphNode(null)}
            />
          </div>
        </div>

        {/* RIGHT SIDE PANEL — 318px wide */}
        <aside
          className="w-[318px] shrink-0 h-full flex flex-col z-20 select-text"
          style={{
            backgroundColor: 'var(--card)',
            borderLeft: '1px solid var(--line)',
          }}
        >
          {/* Side Panel Tabs across the top (UBOs, Screening, Audit) each with a mono count badge */}
          <div
            className="grid grid-cols-3 shrink-0"
            style={{ borderBottom: '1px solid var(--line)' }}
          >
            <SideTabButton
              active={activeTab === 'ubos'}
              onClick={() => setActiveTab('ubos')}
              label="UBOs"
              count={uboPersons.length}
            />
            <SideTabButton
              active={activeTab === 'screening'}
              onClick={() => setActiveTab('screening')}
              label="Screening"
              count={0}
            />
            <SideTabButton
              active={activeTab === 'audit'}
              onClick={() => setActiveTab('audit')}
              label="Audit"
              count={0}
            />
          </div>

          {/* Scrollable Body with 13px padding */}
          <div className="flex-1 overflow-y-auto p-[13px] space-y-3">
            {activeTab === 'ubos' && (
              <>
                {/* Jurisdiction Threshold Control (segmented mono pill: jurisdiction's own threshold plus 10% and 25%) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="section-label">Threshold Rule</span>
                    {highlightedPersonId && (
                      <button
                        type="button"
                        onClick={() => setHighlightedPersonId(null)}
                        className="text-[10px] font-mono-code font-semibold hover:underline"
                        style={{ color: 'var(--primary)' }}
                      >
                        Clear highlight
                      </button>
                    )}
                  </div>

                  <div
                    className="grid grid-cols-3 p-0.5 rounded-lg font-mono-code text-[11px]"
                    style={{
                      backgroundColor: 'var(--bg2)',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setThresholdMode('jurisdiction')}
                      className="py-1.5 px-1.5 rounded-md font-semibold transition-all truncate"
                      style={{
                        backgroundColor:
                          thresholdMode === 'jurisdiction' ? 'var(--primary)' : 'transparent',
                        color: thresholdMode === 'jurisdiction' ? '#ffffff' : 'var(--ink2)',
                      }}
                    >
                      {group.rootJurisdiction} ({comparisonSymbol} {jurisdictionThreshold}%)
                    </button>
                    <button
                      type="button"
                      onClick={() => setThresholdMode('10')}
                      className="py-1.5 px-1.5 rounded-md font-semibold transition-all"
                      style={{
                        backgroundColor:
                          thresholdMode === '10' ? 'var(--primary)' : 'transparent',
                        color: thresholdMode === '10' ? '#ffffff' : 'var(--ink2)',
                      }}
                    >
                      {comparisonSymbol} 10%
                    </button>
                    <button
                      type="button"
                      onClick={() => setThresholdMode('25')}
                      className="py-1.5 px-1.5 rounded-md font-semibold transition-all"
                      style={{
                        backgroundColor:
                          thresholdMode === '25' ? 'var(--primary)' : 'transparent',
                        color: thresholdMode === '25' ? '#ffffff' : 'var(--ink2)',
                      }}
                    >
                      {comparisonSymbol} 25%
                    </button>
                  </div>

                  {/* Small mono "engine line" summarising paths walked, cycles found and gaps */}
                  <div
                    className="mt-2 px-2.5 py-1.5 rounded-lg font-mono-code text-[10.5px] flex items-center justify-between"
                    style={{
                      backgroundColor: 'var(--bg2)',
                      color: 'var(--ink2)',
                      border: '1px solid var(--line2)',
                    }}
                  >
                    <span>{resolution.pathsWalkedCount} paths walked</span>
                    <span>·</span>
                    <span
                      style={{
                        color:
                          resolution.cyclesFound.length > 0 ? 'var(--coral)' : 'var(--ink2)',
                        fontWeight: resolution.cyclesFound.length > 0 ? 700 : 400,
                      }}
                    >
                      {resolution.cyclesFound.length} cycles
                    </span>
                    <span>·</span>
                    <span
                      style={{
                        color:
                          (resolution.gapsReached.length + resolution.implicitGaps.length) > 0
                            ? 'var(--amber)'
                            : 'var(--ink2)',
                        fontWeight:
                          (resolution.gapsReached.length + resolution.implicitGaps.length) > 0
                            ? 700
                            : 400,
                      }}
                    >
                      {resolution.gapsReached.length + resolution.implicitGaps.length} gaps
                    </span>
                  </div>
                </div>

                {/* Hidden Ownership Warning Box */}
                {resolution.hiddenOwnershipWarning && (
                  <div
                    className="p-3 rounded-xl text-[11px] space-y-1.5 anim-slin"
                    style={{
                      backgroundColor: 'var(--amber-s)',
                      border: '1.5px solid var(--amber)',
                      color: 'var(--ink)',
                    }}
                  >
                    <div
                      className="flex items-center gap-1.5 font-mono-code font-bold text-[10px] uppercase"
                      style={{ color: 'var(--amber)' }}
                    >
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Hidden Ownership Risk</span>
                    </div>
                    <div
                      className="font-semibold text-xs leading-snug"
                      style={{ color: 'var(--ink)' }}
                    >
                      {resolution.hiddenOwnershipMessage}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--ink2)' }}>
                      Combined unaccounted remainder across intermediate entities ({formatNumber(resolution.totalUnaccountedEffectOnRoot)}%) passes the {group.rootJurisdiction} {resolution.comparisonSymbol} {activeThresholdPct}% threshold test.
                    </div>
                  </div>
                )}

                {/* Cycle Warning Box if any cycle was broken */}
                {resolution.cyclesFound.map((cycle) => (
                  <div
                    key={cycle.cycleId}
                    className="p-2.5 rounded-xl text-[11px] space-y-1 anim-slin"
                    style={{
                      backgroundColor: 'var(--coral-s)',
                      border: '1px solid rgba(244, 85, 63, 0.25)',
                      color: 'var(--ink)',
                    }}
                  >
                    <div
                      className="font-mono-code font-bold text-[10px] uppercase"
                      style={{ color: 'var(--coral)' }}
                    >
                      Circular Ownership Loop Broken
                    </div>
                    <div className="font-mono-code text-[10px]" style={{ color: 'var(--ink2)' }}>
                      {cycle.cycleDisplay}
                    </div>
                  </div>
                ))}

                {/* UBO Cards (DEFINITE or POSSIBLE) */}
                <div className="space-y-2.5">
                  {uboPersons.map((ubo, idx) => (
                    <PersonUboCard
                      key={`${ubo.person.id}-${ubo.classification}`}
                      ubo={ubo}
                      thresholdPct={activeThresholdPct}
                      comparisonSymbol={comparisonSymbol}
                      isHighlighted={highlightedPersonId === ubo.person.id}
                      isMathExpanded={Boolean(expandedMathIds[ubo.person.id])}
                      onSelect={() =>
                        setHighlightedPersonId((prev) =>
                          prev === ubo.person.id ? null : ubo.person.id
                        )
                      }
                      onToggleMath={(e) => toggleMath(ubo.person.id, e)}
                      delayIndex={idx}
                    />
                  ))}
                </div>

                {/* Collapsible "Below threshold (N)" section */}
                {belowPersons.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowBelowThreshold((prev) => !prev)}
                      className="w-full flex items-center justify-between py-1.5 px-1 text-left"
                    >
                      <span className="section-label">
                        Below threshold ({belowPersons.length})
                      </span>
                      {showBelowThreshold ? (
                        <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--ink3)' }} />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--ink3)' }} />
                      )}
                    </button>

                    {showBelowThreshold && (
                      <div className="space-y-2 mt-1.5">
                        {belowPersons.map((ubo, idx) => (
                          <PersonUboCard
                            key={`${ubo.person.id}-${ubo.classification}`}
                            ubo={ubo}
                            thresholdPct={activeThresholdPct}
                            comparisonSymbol={comparisonSymbol}
                            isHighlighted={highlightedPersonId === ubo.person.id}
                            isMathExpanded={Boolean(expandedMathIds[ubo.person.id])}
                            onSelect={() =>
                              setHighlightedPersonId((prev) =>
                                prev === ubo.person.id ? null : ubo.person.id
                              )
                            }
                            onToggleMath={(e) => toggleMath(ubo.person.id, e)}
                            delayIndex={idx}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Data-Gap Cards below UBO cards: explicit gaps and implicit unaccounted gaps */}
                {(resolution.gapsReached.length > 0 || resolution.implicitGaps.length > 0) && (
                  <div className="pt-2 space-y-2">
                    <div className="section-label">
                      Ownership Data Gaps ({resolution.gapsReached.length + resolution.implicitGaps.length})
                    </div>

                    {/* Explicit Gaps */}
                    {resolution.gapsReached.map((item, idx) => (
                      <div
                        key={`${item.gap.id}-${idx}`}
                        className="p-3 rounded-xl space-y-1.5 anim-slin"
                        style={{
                          backgroundColor: 'var(--grey-s)',
                          border: '1.5px dashed var(--grey)',
                          animationDelay: `${idx * 0.06}s`,
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs font-bold" style={{ color: 'var(--ink)' }}>
                            {item.gap.countryFlag} {item.gap.reasonDisplay}
                          </div>
                          <span
                            className="px-1.5 py-0.5 rounded font-mono-code font-bold text-[10px] shrink-0"
                            style={{
                              backgroundColor: 'var(--amber-s)',
                              color: 'var(--amber)',
                            }}
                          >
                            -{item.gap.estimatedImpactOnCompleteness}% impact
                          </span>
                        </div>

                        <div className="text-[11px]" style={{ color: 'var(--ink2)' }}>
                          {item.gap.description}
                        </div>

                        <div
                          className="font-mono-code text-[10px] pt-1 border-t"
                          style={{
                            color: 'var(--ink3)',
                            borderColor: 'var(--line)',
                          }}
                        >
                          Path: {item.pathDisplay}
                        </div>
                      </div>
                    ))}

                    {/* Implicit Unaccounted Gaps */}
                    {resolution.implicitGaps.map((item, idx) => (
                      <div
                        key={`${item.id}-${idx}`}
                        className="p-3 rounded-xl space-y-1.5 anim-slin"
                        style={{
                          backgroundColor: 'var(--grey-s)',
                          border: '1.5px dashed var(--grey)',
                          animationDelay: `${(resolution.gapsReached.length + idx) * 0.06}s`,
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs font-bold" style={{ color: 'var(--ink)' }}>
                            ❓ {item.label}
                          </div>
                          <span
                            className="px-1.5 py-0.5 rounded font-mono-code font-bold text-[10px] shrink-0"
                            style={{
                              backgroundColor: 'var(--amber-s)',
                              color: 'var(--amber)',
                            }}
                          >
                            -{formatNumber(item.effectOnRootPct)}% effect on root
                          </span>
                        </div>

                        <div className="text-[11px]" style={{ color: 'var(--ink2)' }}>
                          {item.description}
                        </div>

                        <div
                          className="font-mono-code text-[10px] pt-1 border-t flex items-center justify-between"
                          style={{
                            color: 'var(--ink3)',
                            borderColor: 'var(--line)',
                          }}
                        >
                          <span>Entity: {item.entityName}</span>
                          <span>Stake in root: {formatNumber(item.entityEffectiveStakeInRoot)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* SCREENING TAB — friendly empty state */}
            {activeTab === 'screening' && (
              <div className="py-12 px-4 text-center space-y-2.5 anim-vin">
                <div
                  className="w-10 h-10 rounded-full mx-auto flex items-center justify-center"
                  style={{ backgroundColor: 'var(--primary-s)', color: 'var(--primary)' }}
                >
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div className="font-display font-bold text-sm" style={{ color: 'var(--ink)' }}>
                  No Screening Runs Yet
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>
                  Sanctions, PEP, and adverse media screening will run automatically when UBOs are
                  confirmed or when a material ownership event triggers a review case.
                </p>
              </div>
            )}

            {/* AUDIT TAB — Live Immutable Audit Trail */}
            {activeTab === 'audit' && (
              <AuditTrailView groupId={group.id} customerId={customerId} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

interface PersonUboCardProps {
  ubo: ResolvedPersonUbo;
  thresholdPct: number;
  comparisonSymbol: string;
  isHighlighted: boolean;
  isMathExpanded: boolean;
  onSelect: () => void;
  onToggleMath: (e: React.MouseEvent) => void;
  delayIndex: number;
}

const PersonUboCard: React.FC<PersonUboCardProps> = ({
  ubo,
  thresholdPct,
  comparisonSymbol,
  isHighlighted,
  isMathExpanded,
  onSelect,
  onToggleMath,
  delayIndex,
}) => {
  const { person, classification, totalMinPct, totalMaxPct, isRange, paths, hasControlInterest } =
    ubo;
  const isPep = person.pepStatus !== 'none';
  const isBelow = classification === 'BELOW';

  // Left border colour: amber for PEP, rose for sanctions, emerald for DEFINITE, primary blue for control
  let leftBorderColor = 'var(--grey)';
  if (isPep) {
    leftBorderColor = 'var(--amber)';
  } else if (classification === 'DEFINITE') {
    leftBorderColor = 'var(--emerald)';
  } else if (hasControlInterest) {
    leftBorderColor = 'var(--primary)';
  } else if (classification === 'POSSIBLE') {
    leftBorderColor = 'var(--amber)';
  }

  // Badge styling (DEFINITE emerald, POSSIBLE amber, BELOW grey)
  let badgeBg = 'var(--grey-s)';
  let badgeFg = 'var(--grey)';
  let barColor = 'var(--grey)';

  if (classification === 'DEFINITE') {
    badgeBg = 'var(--emerald-s)';
    badgeFg = 'var(--emerald)';
    barColor = 'var(--emerald)';
  } else if (classification === 'POSSIBLE') {
    badgeBg = 'var(--amber-s)';
    badgeFg = 'var(--amber)';
    barColor = 'var(--amber)';
  }

  // Range bar geometry (0..100% scale)
  const clampPct = (v: number) => Math.max(0, Math.min(100, v));
  const minLeft = clampPct(totalMinPct);
  const maxRight = clampPct(totalMaxPct);
  const segmentWidth = Math.max(3, maxRight - minLeft);
  const thresholdPos = clampPct(thresholdPct);

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className="rounded-xl p-3 cursor-pointer transition-all anim-slin"
      style={{
        backgroundColor: isHighlighted ? 'var(--primary-s)' : 'var(--card)',
        borderTop: `1px solid ${isHighlighted ? 'var(--primary2)' : 'var(--line)'}`,
        borderRight: `1px solid ${isHighlighted ? 'var(--primary2)' : 'var(--line)'}`,
        borderBottom: `1px solid ${isHighlighted ? 'var(--primary2)' : 'var(--line)'}`,
        borderLeft: `4px solid ${leftBorderColor}`,
        boxShadow: isHighlighted ? 'var(--sh2)' : 'var(--sh1)',
        opacity: isBelow && !isHighlighted ? 0.82 : 1,
        animationDelay: `${delayIndex * 0.05}s`,
      }}
    >
      {/* Top Row: Avatar circle, Name, Role, Classification badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-xs shrink-0"
            style={{
              backgroundColor: badgeBg,
              color: badgeFg,
              border: `1.5px solid ${badgeFg}`,
            }}
          >
            {person.initials}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold truncate" style={{ color: 'var(--ink)' }}>
              {person.flag} {person.name}
            </div>
            <div className="text-[10.5px] truncate" style={{ color: 'var(--ink2)' }}>
              {isPep ? `PEP (${person.pepStatus}) · ` : ''}
              {person.pepRoleDescription || 'Beneficial Shareholder'}
            </div>
          </div>
        </div>

        <span
          className="px-2 py-0.5 rounded-full font-mono-code font-bold text-[9.5px] uppercase shrink-0 transition-colors"
          style={{
            backgroundColor: badgeBg,
            color: badgeFg,
          }}
        >
          {classification}
        </span>
      </div>

      {/* Effective ownership in Sora 19px + Expandable Maths toggle */}
      <div className="mt-2.5 flex items-baseline justify-between">
        <div>
          <span
            className="font-display font-extrabold leading-none"
            style={{
              fontSize: '19px',
              color: isBelow ? 'var(--ink2)' : 'var(--ink)',
            }}
          >
            {formatEffectiveRange(totalMinPct, totalMaxPct)}
          </span>
          <span className="ml-1.5 text-[10px] font-mono-code" style={{ color: 'var(--ink3)' }}>
            {isRange ? 'effective band' : 'effective stake'}
          </span>
        </div>

        <button
          type="button"
          onClick={onToggleMath}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono-code font-semibold hover:bg-[var(--bg2)] transition-colors"
          style={{ color: 'var(--primary)' }}
        >
          <Calculator className="w-3 h-3" />
          <span>{isMathExpanded ? 'Hide maths' : `Maths (${paths.length})`}</span>
        </button>
      </div>

      {/* Range Bar: grey track, coloured segment from minimum to maximum, thin vertical threshold marker that slides */}
      <div className="mt-2.5 relative pt-1 pb-1">
        <div
          className="w-full h-[7px] rounded-full relative overflow- visible"
          style={{ backgroundColor: 'var(--line)' }}
        >
          {/* Coloured segment from min to max */}
          <div
            className="absolute top-0 bottom-0 rounded-full transition-all duration-300"
            style={{
              left: `${minLeft}%`,
              width: `${segmentWidth}%`,
              backgroundColor: barColor,
            }}
          />

          {/* Thin vertical threshold marker that slides when threshold changes */}
          <div
            className="absolute -top-1.5 -bottom-1.5 w-[2px] rounded-full z-10"
            style={{
              left: `${thresholdPos}%`,
              backgroundColor: 'var(--ink)',
              transition: 'left 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            title={`Threshold: ${comparisonSymbol} ${thresholdPct}%`}
          />
        </div>
        <div
          className="flex justify-between text-[9px] font-mono-code mt-1"
          style={{ color: 'var(--ink3)' }}
        >
          <span>0%</span>
          <span>Threshold: {comparisonSymbol} {thresholdPct}%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Expandable Mono Maths Box showing each path's multiplication */}
      {isMathExpanded && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-2 p-2.5 rounded-lg font-mono-code text-[10.5px] space-y-1.5"
          style={{
            backgroundColor: 'var(--bg2)',
            border: '1px solid var(--line)',
            color: 'var(--ink)',
          }}
        >
          {paths.map((p, idx) => (
            <div key={p.pathId} className="space-y-0.5">
              <div className="text-[9.5px]" style={{ color: 'var(--ink3)' }}>
                Path {idx + 1}: {p.steps.map((s) => s.toSubjectName).join(' → ')} ←{' '}
                {person.name}
              </div>
              <div className="font-semibold" style={{ color: 'var(--primary)' }}>
                {p.arithmeticFormula}
              </div>
            </div>
          ))}
          {paths.length > 1 && (
            <div
              className="pt-1 border-t font-bold flex justify-between"
              style={{ borderColor: 'var(--line)' }}
            >
              <span>Combined Effective Stake:</span>
              <span>{formatEffectiveRange(totalMinPct, totalMaxPct)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const LegendSwatch: React.FC<{ color: string; label: string; dashed?: boolean }> = ({
  color,
  label,
  dashed,
}) => (
  <div className="flex items-center gap-1.5">
    <span
      className="w-2.5 h-2.5 rounded-sm inline-block shrink-0"
      style={{
        backgroundColor: dashed ? 'transparent' : color,
        border: dashed ? `1.5px dashed ${color}` : 'none',
      }}
    />
    <span>{label}</span>
  </div>
);

const SideTabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}> = ({ active, onClick, label, count }) => (
  <button
    type="button"
    onClick={onClick}
    className="py-2.5 px-2 flex items-center justify-center gap-1.5 text-xs font-semibold transition-all relative"
    style={{
      color: active ? 'var(--primary)' : 'var(--ink2)',
    }}
  >
    <span>{label}</span>
    <span
      className="px-1.5 py-0.2 rounded-full font-mono-code text-[10px]"
      style={{
        backgroundColor: active ? 'var(--primary-s)' : 'var(--bg2)',
        color: active ? 'var(--primary)' : 'var(--ink3)',
      }}
    >
      {count}
    </span>
    {active && (
      <span
        className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t"
        style={{ backgroundColor: 'var(--primary)' }}
      />
    )}
  </button>
);
