import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  HelpCircle,
  Info,
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
  ArrowRight,
  Play,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Sparkles,
  Briefcase,
  UserCheck,
  User,
  ArrowUpRight,
  FileText
} from 'lucide-react';
import { CorporateGroupSeed, BodsPerson } from '../types/bods';
import { bodsRepository } from '../data/repository';
import {
  formatEffectiveRange,
  formatNumber,
  resolveBeneficialOwnership,
  ResolvedPersonUbo,
} from '../engine/uboEngine';
import { OwnershipGraph, SelectedGraphNode } from './OwnershipGraph';
import { GraphLayoutStats } from '../engine/graphLayoutEngine';
import { GraphErrorBoundary } from './GraphErrorBoundary';
import { NodeDrawer } from './NodeDrawer';
import { AuditTrailView } from './AuditTrailView';
import { useAuth } from '../context/AuthContext';
import { writeAuditRecord, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, onSnapshot, doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { executeScreeningWorkflow, ScreeningRunRecord, ComplianceCaseRecord } from '../engine/screeningOrchestrator';
import { MonitoringFlowStage, MonitoringIndicator } from './MonitoringIndicator';
import { ExtractedShareholderRow } from '../types/documentAi';
import { getEventFeedAdapter } from '../adapters/eventFeedAdapter';
import { AlertEventRecord } from './AlertsView';

interface EntityWorkspaceViewProps {
  group: CorporateGroupSeed;
  customerId?: string;
  onBack: () => void;
  pendingEvent?: any;
  events?: AlertEventRecord[];
  activeScreeningRun?: {
    triggerEvent: AlertEventRecord;
    evaluation: any;
    timestamp: number;
  } | null;
  onScreeningComplete?: (createdCase: ComplianceCaseRecord) => void;
  onScreeningError?: (err: any) => void;
  onScreeningFinished?: () => void;
  onReviewEvent?: (event: any) => void;
  onOpenCase?: (caseId: string) => void;
  onOpenDossier?: (person: BodsPerson) => void;
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
  events = [],
  activeScreeningRun,
  onScreeningComplete,
  onScreeningError,
  onScreeningFinished,
  onReviewEvent,
  onOpenCase,
  onOpenDossier,
}) => {
  const { user, profile, isSupervisor } = useAuth();
  const [activeGroup, setActiveGroup] = useState<CorporateGroupSeed>(group);
  const [initiallyRequestDocs, setInitiallyRequestDocs] = useState<boolean>(false);
  const [rippleTrigger, setRippleTrigger] = useState<{ nodeId: string; color: string } | null>(null);
  const [injecting, setInjecting] = useState(false);
  const [screeningRuns, setScreeningRuns] = useState<ScreeningRunRecord[]>([]);
  const [screeningLoading, setScreeningLoading] = useState(false);
  const [activeScreeningStep, setActiveScreeningStep] = useState<string>('');
  const [reviewStarted, setReviewStarted] = useState<boolean>(false);
  const [flowStage, setFlowStage] = useState<MonitoringFlowStage>('monitoring');
  const [auditCount, setAuditCount] = useState<number>(0);

  useEffect(() => {
    setReviewStarted(false);
  }, [pendingEvent?.id]);

  useEffect(() => {
    setActiveGroup(group);
  }, [group]);

  // 1. Live detection after opening a tree
  // When a supervisor opens the Entity Workspace of an onboarded customer that has no pending change and still has an unfired prepared change,
  // the agent strip shows "monitoring live" and, about 6 seconds later, Sentinel receives that customer's next prepared change automatically.
  // In PREVIEW it is written as it is now; in PRODUCTION it is published to Pub/Sub.
  // This happens at most once per prepared change.
  const scheduledTemplateRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSupervisor || !customerId || pendingEvent) {
      return;
    }

    const firedTemplateIds = new Set(
      (events || [])
        .filter((e) => e.groupId === group.id || e.customerId === customerId)
        .map((e) => e.templateId)
    );

    const unfiredTemplate = group.monitoringEventTemplates.find(
      (t) => !firedTemplateIds.has(t.id) && !(events || []).some((e) => e.id.includes(t.id))
    );

    if (!unfiredTemplate) {
      return;
    }

    if (scheduledTemplateRef.current === unfiredTemplate.id) {
      return;
    }

    scheduledTemplateRef.current = unfiredTemplate.id;
    setFlowStage('monitoring');

    const timer = setTimeout(async () => {
      try {
        const adapter = getEventFeedAdapter();
        const cleanCustId = (customerId || `CUS-2026-${group.id.slice(-4)}`).replace(/[^a-zA-Z0-9_-]/g, '_');
        const cleanTplId = unfiredTemplate.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const deterministicId = `evt_${cleanCustId}_${cleanTplId}`;

        await adapter.publishEvent({
          id: deterministicId,
          customerId: customerId || `CUS-2026-${group.id.slice(-4)}`,
          groupId: group.id,
          templateId: unfiredTemplate.id,
          changeType: unfiredTemplate.changeType as any,
          payload: unfiredTemplate.data as any,
          description: unfiredTemplate.description,
          source: unfiredTemplate.source,
          confidence: unfiredTemplate.confidence,
          detectedAt: new Date().toISOString(),
          status: 'pending'
        });

        if (user) {
          await writeAuditRecord({
            actorUid: user.uid,
            actorType: 'SYSTEM',
            actorName: 'Sentinel Live Monitoring',
            action: 'LIVE_REGISTRY_CHANGE_DETECTED',
            summary: `Automated live monitoring detected prepared registry change for ${group.name} (${unfiredTemplate.id}).`,
            groupId: group.id,
            customerId: customerId,
            eventId: deterministicId
          });
        }
      } catch (err) {
        console.warn('[LiveMonitoring] Failed to emit automatic prepared change:', err);
      }
    }, 6000);

    return () => clearTimeout(timer);
  }, [isSupervisor, customerId, pendingEvent, group.id, events]);

  // 2. Redirect to screening: In both governance modes, once an Accept decision is saved,
  // the workspace switches automatically to the Screening tab, shows the four agents starting,
  // and shows their progress as they run. When all four finish, show the case toast with "Open case".
  useEffect(() => {
    if (!activeScreeningRun || activeScreeningRun.triggerEvent.groupId !== group.id) {
      return;
    }

    setActiveTab('screening');
    setFlowStage('running_agents');
    setScreeningLoading(true);
    setActiveScreeningStep('Sanctions & Watchlist Screening...');

    const resolvedCustId = customerId || `CUS-2026-${group.id.slice(-4)}`;
    const deciderName = profile?.displayName || user?.displayName || 'Analyst';

    executeScreeningWorkflow({
      group,
      customerId: resolvedCustId,
      triggerType: 'PKYC',
      triggerEvent: activeScreeningRun.triggerEvent,
      materialityEvaluation: activeScreeningRun.evaluation,
      user: { uid: user?.uid || 'analyst', displayName: deciderName },
      thresholdPct: 25,
      onProgress: (stepName) => {
        setActiveScreeningStep(stepName);
      }
    })
      .then((res) => {
        setFlowStage('complete');
        setScreeningLoading(false);
        setActiveScreeningStep('');
        if (!res?.isExisting && res?.createdCase) {
          onScreeningComplete?.(res.createdCase);
        }
        onScreeningFinished?.();
      })
      .catch((err) => {
        setFlowStage('monitoring');
        setScreeningLoading(false);
        setActiveScreeningStep('');
        onScreeningError?.(err);
        onScreeningFinished?.();
      });
  }, [activeScreeningRun?.timestamp]);

  const [lastCase, setLastCase] = useState<ComplianceCaseRecord | null>(null);
  useEffect(() => {
    if (!user) return;
    const casesCol = collection(db, 'cases');
    const unsubscribe = onSnapshot(casesCol, (snapshot) => {
      const list: ComplianceCaseRecord[] = [];
      snapshot.forEach((snap) => {
        const d = snap.data() as ComplianceCaseRecord;
        if (d.groupId === group.id || (customerId && d.customerId === customerId)) {
          list.push(d);
        }
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setLastCase(list[0] || null);
    });
    return () => unsubscribe();
  }, [user, group.id, customerId]);

  // Default flowStage to 'monitoring' (monitoring live) unless screening agents are currently running
  useEffect(() => {
    if (activeScreeningRun && activeScreeningRun.triggerEvent.groupId === group.id) {
      setFlowStage('running_agents');
      setActiveTab('screening');
    } else {
      setFlowStage('monitoring');
    }
  }, [group.id, activeScreeningRun]);

  // 3. Automated mode: banner appears, review starts automatically after about 2 seconds
  const isAutomated = profile?.governanceMode === 'automated';
  useEffect(() => {
    if (isAutomated && pendingEvent && !reviewStarted) {
      const autoReviewTimer = setTimeout(() => {
        setReviewStarted(true);
        if (user) {
          writeAuditRecord({
            actorUid: user.uid,
            actorType: 'SYSTEM',
            actorName: 'Sentinel Automated Governance',
            action: 'AUTOMATED_REVIEW_INITIATED',
            summary: `Automated governance initiated materiality review for ${group.name}.`,
            groupId: group.id,
            customerId: customerId,
            eventId: pendingEvent.id
          }).catch(() => {});
        }
        onReviewEvent?.(pendingEvent);
      }, 2000);
      return () => clearTimeout(autoReviewTimer);
    }
  }, [isAutomated, pendingEvent?.id, reviewStarted]);

  const jurisdictionRule = bodsRepository.getJurisdictionRule(activeGroup.rootJurisdiction);
  const jurisdictionThreshold = jurisdictionRule ? jurisdictionRule.uboThreshold : 25;
  const comparison = jurisdictionRule
    ? jurisdictionRule.comparison
    : activeGroup.rootJurisdiction.toUpperCase() === 'US'
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
  const [layoutStats, setLayoutStats] = useState<GraphLayoutStats | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());

  const handleToggleExpandNode = (nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const allGroupNodeIds = useMemo(() => {
    const ids: string[] = [];
    activeGroup.entities.forEach((e) => ids.push(e.id));
    activeGroup.persons.forEach((p) => ids.push(p.id));
    activeGroup.unspecifiedOwners.forEach((u) => ids.push(u.id));
    return ids;
  }, [activeGroup]);

  const allMetadataExpanded = allGroupNodeIds.length > 0 && allGroupNodeIds.every((id) => expandedNodeIds.has(id));

  const handleToggleAllMetadata = () => {
    if (allMetadataExpanded) {
      setExpandedNodeIds(new Set());
    } else {
      setExpandedNodeIds(new Set(allGroupNodeIds));
    }
  };

  // Real-time Firestore subscription to screeningRuns for this group
  useEffect(() => {
    if (!user) return;
    const runsCol = collection(db, 'screeningRuns');
    const unsubscribe = onSnapshot(
      runsCol,
      (snapshot) => {
        const list: ScreeningRunRecord[] = [];
        snapshot.forEach((snap) => {
          const data = snap.data() as ScreeningRunRecord;
          if (data.groupId === activeGroup.id || (customerId && data.customerId === customerId)) {
            list.push(data);
          }
        });
        list.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        setScreeningRuns(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'screeningRuns');
      }
    );
    return () => unsubscribe();
  }, [user, activeGroup.id, customerId]);

  // Set of screened person IDs to enable Adverse Media Dossier button in drawer
  const screenedPersonIds = useMemo(() => {
    const ids = new Set<string>();
    screeningRuns.forEach((run) => {
      if (run.personsInScope) {
        run.personsInScope.forEach((p) => ids.add(p.id));
      }
      if (run.personResults) {
        Object.keys(run.personResults).forEach((id) => ids.add(id));
      }
    });
    return ids;
  }, [screeningRuns]);

  // Reset state when switching corporate group
  useEffect(() => {
    setThresholdMode('jurisdiction');
    setHighlightedPersonId(null);
    setSelectedGraphNode(null);
    setInitiallyRequestDocs(false);
    setExpandedNodeIds(new Set());
  }, [activeGroup.id]);

  // Global Escape key handler to clear active selection or path highlight
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHighlightedPersonId(null);
        setSelectedGraphNode(null);
        setInitiallyRequestDocs(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const activeThresholdPct = useMemo(() => {
    if (thresholdMode === '10') return 10;
    if (thresholdMode === '25') return 25;
    return jurisdictionThreshold;
  }, [thresholdMode, jurisdictionThreshold]);

  const resolution = useMemo(
    () => resolveBeneficialOwnership(activeGroup, activeThresholdPct, comparison),
    [activeGroup, activeThresholdPct, comparison]
  );

  // Animate completeness bar width over 1s
  useEffect(() => {
    setAnimatedCompleteness(0);
    const timer = setTimeout(() => {
      setAnimatedCompleteness(resolution.completenessScore);
    }, 60);
    return () => clearTimeout(timer);
  }, [activeGroup.id, resolution.completenessScore]);

  // Confirmed document extraction application to graph
  const handleConfirmExtraction = async ({
    gapId,
    extractionId,
    fileName,
    confirmedRows
  }: {
    gapId: string;
    extractionId: string;
    fileName: string;
    confirmedRows: ExtractedShareholderRow[];
  }) => {
    // 1. Locate subject entity
    const relToGap = activeGroup.relationships.find((r) => r.interestedPartyId === gapId);
    const parentEntityId = relToGap ? relToGap.subjectId : (activeGroup.entities[1]?.id || activeGroup.rootEntityId);

    // 2. Build new revealed persons and relationships
    const newPersons: BodsPerson[] = [];
    const newRelationships: any[] = [];

    confirmedRows.forEach((row, idx) => {
      const personId = `per-doc-${gapId.replace(/[^a-zA-Z0-9]/g, '-')}-${idx + 1}`;
      const initials = row.holderName
        .split(' ')
        .map((n) => n[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase() || 'BO';

      if (row.holderType === 'person') {
        newPersons.push({
          id: personId,
          name: row.holderName,
          initials,
          nationality: 'United Kingdom',
          flag: '🇬🇧',
          yearOfBirth: 1968 + idx * 4,
          pepStatus: 'none',
          pepRoleDescription: 'Disclosed via verified statutory filing',
          synthetic: true
        });

        newRelationships.push({
          id: `rel-doc-${gapId}-${idx + 1}`,
          subjectId: parentEntityId,
          interestedPartyId: personId,
          interestedPartyType: 'person',
          isHot: true,
          interests: [
            {
              type: 'shareholding',
              share: { kind: 'exact', value: row.shareExact ?? row.shareValue ?? 50 },
              directOrIndirect: 'direct',
              source: `Client Document (${fileName})`,
              asOfDate: row.asOfDate || new Date().toISOString().slice(0, 10),
              confidence: row.confidence
            }
          ]
        });
      }
    });

    // 3. Update group: remove the resolved gap from unspecifiedOwners and replace relationships
    const updatedUnspecifiedOwners = activeGroup.unspecifiedOwners.filter((u) => u.id !== gapId);
    const updatedRelationships = activeGroup.relationships
      .filter((r) => r.interestedPartyId !== gapId)
      .concat(newRelationships);
    const updatedPersons = [...activeGroup.persons, ...newPersons];

    const updatedGroup: CorporateGroupSeed = {
      ...activeGroup,
      unspecifiedOwners: updatedUnspecifiedOwners,
      persons: updatedPersons,
      relationships: updatedRelationships
    };

    setActiveGroup(updatedGroup);

    // 4. Trigger ripple animation
    setRippleTrigger({
      nodeId: parentEntityId,
      color: 'var(--emerald)'
    });
    setTimeout(() => setRippleTrigger(null), 1500);

    // 5. Create accepted event in Firestore (create as pending, then update to accepted to satisfy rules)
    try {
      if (user) {
        const eventId = `evt-doc-${Date.now()}`;
        const eventDocRef = doc(db, 'events', eventId);
        await setDoc(eventDocRef, {
          id: eventId,
          customerId: customerId || `CUS-2026-${activeGroup.id.slice(-4)}`,
          groupId: activeGroup.id,
          templateId: `tpl-doc-${gapId}`,
          changeType: 'NEW_RELATIONSHIP',
          description: `Verified document (${fileName}) resolved data gap ${gapId}, disclosing ${confirmedRows.length} shareholder(s).`,
          source: 'client document',
          confidence: 0.98,
          detectedAt: new Date().toISOString(),
          status: 'pending'
        });
        await updateDoc(eventDocRef, {
          status: 'accepted',
          decidedBy: user.uid,
          decidedAt: serverTimestamp()
        });
      }
    } catch (e) {
      console.warn('[DocEvent] Could not persist accepted event:', e);
    }

    setSelectedGraphNode(null);
    setInitiallyRequestDocs(false);
  };

  const rootEntity = activeGroup.entities.find((e) => e.id === activeGroup.rootEntityId);
  const Icon = ICON_MAP[activeGroup.iconName] || ShieldAlert;
  const accent = ACCENT_STYLES[activeGroup.accentColor];
  const riskStyle = RISK_PILL_STYLES[activeGroup.riskTone];

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
      <MonitoringIndicator isArmed={true} isConnected={true} simulationMode={true} flowStage={flowStage} />

      {/* WORKSPACE HEADER ROW — white, bottom border */}
      <div
        className="h-[62px] shrink-0 px-5 flex items-center justify-between gap-4 z-20"
        style={{
          backgroundColor: 'var(--card)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        {/* Left: 33px back button, 40px neutral Building2 icon tile, entity name + scenario info tooltip, meta line */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="w-[33px] h-[33px] rounded-lg flex items-center justify-center hover:bg-[var(--bg2)] transition-colors shrink-0 focus-visible:ring-2"
            style={{ border: '1px solid var(--line)', color: 'var(--ink2)' }}
            title="Back to Ownership Structures"
            aria-label="Back to Ownership Structures"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div
            className="w-[40px] h-[40px] rounded-[10px] flex items-center justify-center shrink-0 border"
            style={{
              backgroundColor: 'var(--bg2)',
              borderColor: 'var(--line)',
              color: 'var(--ink2)',
            }}
          >
            <Building2 className="w-5 h-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="font-display font-bold text-base leading-snug truncate text-[var(--ink)]">
                {group.name}
              </h1>
              <span
                title={group.scenarioSummary}
                className="inline-flex shrink-0 cursor-help text-[var(--ink3)] hover:text-[var(--ink)] transition-colors p-0.5"
                aria-label={`Scenario details: ${group.scenarioSummary}`}
              >
                <HelpCircle className="w-4 h-4 text-[var(--ink3)]" />
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-xs mt-0.5" style={{ color: 'var(--ink2)' }}>
              <span>
                {group.rootFlag} {jurisdictionRule?.name || group.rootJurisdiction}
              </span>
              <span>·</span>
              <span
                className="px-1.5 py-0.2 rounded font-mono-code text-[10.5px] font-semibold"
                style={{
                  backgroundColor: 'var(--primary-s)',
                  color: 'var(--primary)',
                }}
              >
                {rootEntity?.registrationId || group.rootEntityId}
              </span>
            </div>
          </div>
        </div>

        {/* Right per Requirement 4.1: ONLY Risk badge with rule tooltip, plus supervisor Simulate registry change button */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Risk Badge with tooltip naming triggering rule */}
          <div
            className="px-2.5 py-1 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider flex items-center gap-1.5 border cursor-help"
            style={{
              backgroundColor: 'var(--bg2)',
              borderColor: 'var(--line)',
              color: 'var(--ink2)',
            }}
            title={resolution.riskAssessment.reason}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                backgroundColor:
                  resolution.riskAssessment.tier === 'HIGH'
                    ? 'var(--rose)'
                    : resolution.riskAssessment.tier === 'ELEVATED'
                    ? 'var(--amber)'
                    : 'var(--grey)',
              }}
            />
            <span>{resolution.riskAssessment.tier}</span>
          </div>

          {/* Last Completed Review Chip */}
          {lastCase && (
            <button
              type="button"
              onClick={() => onOpenCase?.(lastCase.id || lastCase.caseId)}
              className="py-1 px-2.5 rounded-full text-[10px] font-mono-code font-bold flex items-center gap-1.5 border transition-all hover:opacity-90 cursor-pointer shadow-sm"
              style={{
                backgroundColor: 'var(--bg2)',
                borderColor: 'var(--line)',
                color: 'var(--ink2)'
              }}
              title="Click to open last completed review case"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    lastCase.overallStatus === 'CRITICAL'
                      ? 'var(--rose)'
                      : lastCase.overallStatus === 'STANDARD'
                      ? 'var(--amber)'
                      : 'var(--emerald)'
                }}
              />
              <span>Last review: {lastCase.id || lastCase.caseId} · {lastCase.overallStatus}</span>
              <ArrowUpRight className="w-3 h-3 text-[var(--ink3)]" />
            </button>
          )}

          {/* Review Pending Header Chip: Shown when review was started/abandoned without a decision */}
          {pendingEvent && reviewStarted && (
            <button
              type="button"
              onClick={() => onReviewEvent?.(pendingEvent)}
              className="py-1 px-2.5 rounded-lg text-xs font-mono-code font-bold flex items-center gap-1.5 border transition-all hover:opacity-90 cursor-pointer shadow-sm animate-pulse"
              style={{
                backgroundColor: 'var(--amber-s)',
                borderColor: 'var(--amber)',
                color: 'var(--amber)'
              }}
              title="Review pending: click to open materiality review modal"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] shrink-0" />
              <span>Review pending</span>
              <ArrowRight className="w-3 h-3 text-[var(--amber)]" />
            </button>
          )}

          {/* Supervisor Registry Change Trigger */}
          {isSupervisor && (
            <button
              type="button"
              disabled={injecting}
              onClick={async () => {
                setInjecting(true);
                try {
                  const adapter = getEventFeedAdapter();
                  const firedTemplateIds = new Set(
                    (events || [])
                      .filter((e) => (e.groupId === group.id || e.customerId === customerId) && e.status !== 'pending')
                      .map((e) => e.templateId)
                  );
                  const tpl = group.monitoringEventTemplates.find((t) => !firedTemplateIds.has(t.id)) || group.monitoringEventTemplates[0];
                  const cleanCustId = (customerId || `CUS-2026-${group.id.slice(-4)}`).replace(/[^a-zA-Z0-9_-]/g, '_');
                  const cleanTplId = tpl.id.replace(/[^a-zA-Z0-9_-]/g, '_');
                  // Manual simulation ALWAYS generates a fresh event ID so PreviewEventFeedAdapter writes a new document and listener fires
                  const newEventId = `evt_${cleanCustId}_${cleanTplId}_sim${Date.now()}`;
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
              className="py-1 px-3 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all shadow-sm cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--primary)] hover:opacity-95 active:scale-[0.98] disabled:opacity-50"
              style={{
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                borderColor: 'var(--primary)'
              }}
              title="Simulates an incoming registry feed for this company."
            >
              <Zap className="w-3.5 h-3.5 text-white" />
              <span>{injecting ? 'Injecting...' : 'Simulate registry change'}</span>
              <span
                className="px-1.5 py-0.5 text-[9px] font-mono-code font-bold rounded"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.35)'
                }}
              >
                Demo
              </span>
            </button>
          )}
        </div>
      </div>

      {/* MONITORING DROP-IN BANNER (Only shown if pending event exists AND review has NOT been clicked) */}
      {pendingEvent && !reviewStarted && (
        <div
          className="mx-5 my-2.5 p-3 rounded-xl border flex items-center justify-between gap-4 shadow-sm anim-drop z-20"
          style={{
            backgroundColor: 'var(--amber-s)',
            borderLeftWidth: '4px',
            borderLeftColor: 'var(--amber)',
            borderColor: 'var(--line)'
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-white/70 flex items-center justify-center shrink-0">
              <Radio className="w-4 h-4 text-[var(--amber)] animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono-code font-bold uppercase tracking-wider text-[var(--amber)]">
                  Live Registry Alert Detected
                </span>
                <span className="text-[10px] font-mono-code" style={{ color: 'var(--ink3)' }}>
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
            onClick={() => {
              setReviewStarted(true);
              onReviewEvent?.(pendingEvent);
            }}
            className="py-1.5 px-4 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 cursor-pointer shadow-sm transition-all hover:opacity-95 active:scale-95 focus-visible:ring-2 text-white"
            style={{
              backgroundColor: 'var(--amber)',
            }}
          >
            <span>Review</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* WORKSPACE BODY: Graph Column + Side Panel (stacks below graph full-width below 1000px per Item 4) */}
      <div className="flex-1 flex flex-col min-[1000px]:flex-row min-h-0 overflow-y-auto min-[1000px]:overflow-hidden relative">
        {/* GRAPH COLUMN */}
        <div className="flex-1 flex flex-col min-w-0 min-h-[500px] min-[1000px]:min-h-0 min-[1000px]:h-full overflow-hidden relative">
          {/* COMPACT GRAPH LEGEND STRIP ABOVE CANVAS (One row, no scrollbar) */}
          <div
            className="h-[38px] shrink-0 px-4 flex items-center justify-between gap-4 z-10 border-b overflow-hidden"
            style={{
              backgroundColor: 'var(--bg2)',
              borderColor: 'var(--line)',
            }}
          >
            {/* 5 Short Legend Swatches */}
            <div className="flex items-center gap-3 text-[11px] font-mono-code shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: '#221e33' }} />
                <span style={{ color: 'var(--ink)' }}>Root</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: 'var(--emerald)' }} />
                <span style={{ color: 'var(--ink)' }}>UBO</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: 'var(--amber)' }} />
                <span style={{ color: 'var(--ink)' }}>PEP / review</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: 'var(--rose)' }} />
                <span style={{ color: 'var(--rose)' }}>Sanctions hit</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs border border-dashed border-[var(--grey)]" style={{ backgroundColor: 'var(--card)' }} />
                <span style={{ color: 'var(--ink2)' }}>Data gap</span>
              </div>
            </div>

            {/* Right side: Completeness (label, small bar, percentage) */}
            <div className="flex items-center gap-2 text-xs shrink-0">
              <span className="text-[11px] font-medium" style={{ color: 'var(--ink2)' }}>
                Completeness
              </span>
              <div
                className="w-[48px] h-[5px] rounded-full overflow-hidden"
                style={{ backgroundColor: 'var(--line)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, resolution.completenessScore)}%`,
                    backgroundColor:
                      resolution.completenessScore < 70 ? 'var(--amber)' : 'var(--primary2)',
                  }}
                />
              </div>
              <span className="font-mono-code font-bold text-xs tabular-nums" style={{ color: 'var(--ink)' }}>
                {resolution.completenessScore}%
              </span>
            </div>
          </div>

          {/* SVG GRAPH CANVAS */}
          <div className="flex-1 min-h-0 relative">
            <GraphErrorBoundary>
              <OwnershipGraph
                group={activeGroup}
                resolution={resolution}
                density="compact"
                onLayoutChange={setLayoutStats}
                expandedNodeIds={expandedNodeIds}
                onToggleExpandNode={handleToggleExpandNode}
                highlightedPersonId={highlightedPersonId}
                selectedNodeId={selectedGraphNode?.record.id ?? null}
                onSelectNode={(node) => {
                  setInitiallyRequestDocs(false);
                  setSelectedGraphNode(node);
                  if (node.kind === 'person') {
                    setHighlightedPersonId(node.record.id);
                    setActiveTab('ubos');
                    setTimeout(() => {
                      document.getElementById(`card-person-${node.record.id}`)?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                      });
                    }, 50);
                  } else if (node.kind === 'implicitGap' || node.kind === 'unspecified') {
                    setHighlightedPersonId(node.record.id);
                  }
                }}
                onClearHighlight={() => {
                  setHighlightedPersonId(null);
                  setSelectedGraphNode(null);
                  setInitiallyRequestDocs(false);
                }}
                rippleTrigger={rippleTrigger}
              />
            </GraphErrorBoundary>

            {/* Slide-in Node Drawer (372px wide) */}
            <NodeDrawer
              selected={selectedGraphNode}
              group={activeGroup}
              customerId={customerId}
              resolution={resolution}
              onClose={() => {
                setSelectedGraphNode(null);
                setInitiallyRequestDocs(false);
              }}
              onOpenDossier={onOpenDossier}
              screenedPersonIds={screenedPersonIds}
              initiallyRequestDocuments={initiallyRequestDocs}
              onConfirmExtraction={handleConfirmExtraction}
            />
          </div>
        </div>

        {/* RIGHT SIDE PANEL — 318px wide on desktop, full-width below 1000px per Item 4 */}
        <aside
          className="w-full min-[1000px]:w-[318px] shrink-0 min-[1000px]:h-full border-t min-[1000px]:border-t-0 min-[1000px]:border-l border-[var(--line)] flex flex-col z-20 select-text"
          style={{
            backgroundColor: 'var(--card)',
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
              count={screeningRuns.length}
            />
            <SideTabButton
              active={activeTab === 'audit'}
              onClick={() => setActiveTab('audit')}
              label="Audit"
              count={auditCount}
            />
          </div>

          {/* Scrollable Body with 13px padding */}
          <div className="flex-1 overflow-y-auto p-[13px] space-y-3">
            {activeTab === 'ubos' && (
              <>
                {/* Header row with "Ultimate beneficial owners" label and compact threshold control */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="section-label">Ultimate beneficial owners</span>
                      {highlightedPersonId && (
                        <button
                          type="button"
                          onClick={() => setHighlightedPersonId(null)}
                          className="text-[10px] font-mono-code font-semibold hover:underline"
                          style={{ color: 'var(--primary)' }}
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <div
                      className="inline-flex p-0.5 rounded-lg font-mono-code text-[11px] shrink-0"
                      style={{
                        backgroundColor: 'var(--bg2)',
                        border: '1px solid var(--line)',
                      }}
                      title={jurisdictionRule?.regulationName || 'Statutory UBO Threshold Rule'}
                    >
                      <button
                        type="button"
                        onClick={() => setThresholdMode('jurisdiction')}
                        className="py-1 px-2 rounded-md font-semibold transition-all truncate cursor-pointer"
                        style={{
                          backgroundColor:
                            thresholdMode === 'jurisdiction' ? 'var(--primary)' : 'transparent',
                          color: thresholdMode === 'jurisdiction' ? '#ffffff' : 'var(--ink2)',
                        }}
                      >
                        {activeGroup.rootJurisdiction} {comparisonSymbol} {jurisdictionThreshold}%
                      </button>
                      {[10, 25].filter((val) => val !== jurisdictionThreshold).map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setThresholdMode(String(val) as ThresholdMode)}
                          className="py-1 px-2 rounded-md font-semibold transition-all cursor-pointer"
                          style={{
                            backgroundColor:
                              thresholdMode === String(val) ? 'var(--primary)' : 'transparent',
                            color: thresholdMode === String(val) ? '#ffffff' : 'var(--ink2)',
                          }}
                        >
                          {comparisonSymbol} {val}%
                        </button>
                      ))}
                    </div>
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

                        <div className="pt-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              setSelectedGraphNode({ kind: 'unspecified', record: item.gap });
                              setInitiallyRequestDocs(true);
                              if (user) {
                                writeAuditRecord({
                                  actorUid: user.uid,
                                  actorType: 'HUMAN',
                                  actorName: profile?.displayName || 'Analyst',
                                  action: 'DOCUMENT_REQUESTED',
                                  summary: `Requested documents for data gap: ${item.gap.label || item.gap.reasonDisplay}.`,
                                  groupId: activeGroup.id,
                                  customerId: customerId || `CUS-2026-${activeGroup.id.slice(-4)}`,
                                  details: { gapId: item.gap.id, kind: 'unspecified' }
                                }).catch(console.error);
                              }
                            }}
                            className="w-full py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition-all active:scale-95 shadow-sm hover:bg-[var(--primary)] hover:text-white focus-visible:ring-2"
                            style={{
                              backgroundColor: 'var(--card)',
                              borderColor: 'var(--line)',
                              color: 'var(--primary)',
                            }}
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Request documents</span>
                          </button>
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

                        <div className="pt-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              setSelectedGraphNode({ kind: 'implicitGap', record: item });
                              setInitiallyRequestDocs(true);
                              if (user) {
                                writeAuditRecord({
                                  actorUid: user.uid,
                                  actorType: 'HUMAN',
                                  actorName: profile?.displayName || 'Analyst',
                                  action: 'DOCUMENT_REQUESTED',
                                  summary: `Requested documents for data gap: ${item.label}.`,
                                  groupId: activeGroup.id,
                                  customerId: customerId || `CUS-2026-${activeGroup.id.slice(-4)}`,
                                  details: { gapId: item.id, kind: 'implicitGap' }
                                }).catch(console.error);
                              }
                            }}
                            className="w-full py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition-all active:scale-95 shadow-sm hover:bg-[var(--primary)] hover:text-white focus-visible:ring-2"
                            style={{
                              backgroundColor: 'var(--card)',
                              borderColor: 'var(--line)',
                              color: 'var(--primary)',
                            }}
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Request documents</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* SCREENING TAB — Real Asynchronous Screening Runs and Unified Results */}
            {activeTab === 'screening' && (
              <div className="space-y-4 anim-vin">
                {/* Header & Run Screening Action */}
                <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: 'var(--line)' }}>
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider font-display" style={{ color: 'var(--ink)' }}>
                      Screening &amp; Due Diligence
                    </h3>
                    <p className="text-[10px] font-mono-code mt-0.5" style={{ color: 'var(--ink3)' }}>
                      {screeningRuns.length} run{screeningRuns.length === 1 ? '' : 's'} recorded
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={screeningLoading}
                    onClick={async () => {
                      if (!user || screeningLoading) return;
                      setScreeningLoading(true);
                      setActiveScreeningStep('Sanctions & Watchlist Screening...');
                      try {
                        const resolvedCustId = customerId || `CUS-2026-${group.id.slice(-4)}`;
                        await executeScreeningWorkflow({
                          group,
                          customerId: resolvedCustId,
                          triggerType: 'ONBOARDING',
                          user: { uid: user.uid, displayName: profile?.displayName },
                          thresholdPct: activeThresholdPct,
                          onProgress: (agentName) => {
                            setActiveScreeningStep(agentName);
                          }
                        });
                      } catch (err: any) {
                        console.error('Failed to run screening:', err);
                      } finally {
                        setScreeningLoading(false);
                        setActiveScreeningStep('');
                      }
                    }}
                    className="py-1 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm focus-visible:ring-2 text-white"
                    style={{
                      backgroundColor: 'var(--primary)',
                      opacity: screeningLoading ? 0.7 : 1,
                      cursor: screeningLoading ? 'wait' : 'pointer'
                    }}
                  >
                    {screeningLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Screening...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-current" />
                        <span>Run Screening</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Loading Banner when actively screening */}
                {screeningLoading && (
                  <div
                    className="p-3 rounded-xl border flex items-center gap-3 animate-pulse"
                    style={{
                      backgroundColor: 'var(--primary-s)',
                      borderColor: 'var(--primary2)',
                      color: 'var(--primary)'
                    }}
                  >
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <div className="text-xs font-mono-code font-medium">
                      {activeScreeningStep || 'Screening agents executing asynchronously...'}
                    </div>
                  </div>
                )}

                {/* If runs exist, render the latest run details and history */}
                {screeningRuns.length > 0 ? (
                  (() => {
                    const latestRun = screeningRuns[0];
                    const isCritical = latestRun.overallOutcome === 'HIT';
                    const isReview = latestRun.overallOutcome === 'REVIEW';
                    const outcomeDotColor = isCritical
                      ? 'var(--rose)'
                      : isReview
                      ? 'var(--amber)'
                      : 'var(--emerald)';
                    const outcomeLabel = isCritical
                      ? 'CRITICAL / HIT'
                      : isReview
                      ? 'STANDARD / REVIEW'
                      : 'CLEAR';

                    return (
                      <div className="space-y-4">
                        {/* Unified Results Summary Card */}
                        <div
                          className="rounded-xl p-3 border space-y-3"
                          style={{
                            backgroundColor: 'var(--card)',
                            borderColor: 'var(--line)',
                            borderLeftWidth: '4px',
                            borderLeftColor: outcomeDotColor
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono-code font-bold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>
                              Latest Screening Outcome
                            </span>
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-bold flex items-center gap-1.5 border"
                              style={{
                                backgroundColor: 'var(--bg2)',
                                borderColor: 'var(--line)',
                                color: 'var(--ink2)'
                              }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: outcomeDotColor }} />
                              <span>{outcomeLabel}</span>
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--ink2)' }}>
                            <span className="font-mono-code text-[11px]">
                              Trigger: {latestRun.triggerType} · {new Date(latestRun.startedAt).toLocaleDateString()}
                            </span>
                            {onOpenCase && (
                              <button
                                type="button"
                                onClick={() => {
                                  const caseIdToOpen = lastCase?.id || lastCase?.caseId || (latestRun as any).caseId;
                                  if (caseIdToOpen) {
                                    onOpenCase(caseIdToOpen);
                                  }
                                }}
                                className="text-[11px] font-semibold text-[var(--primary)] hover:underline flex items-center gap-1 cursor-pointer"
                              >
                                <span>Open Case</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 4 Agent Rows */}
                        <div className="space-y-2">
                          <div className="section-label">Screening Agents ({Object.keys(latestRun.personResults || {}).length} in scope)</div>

                          {/* Sanctions Agent */}
                          <div
                            className="p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs"
                            style={{
                              backgroundColor: 'var(--card)',
                              borderColor: 'var(--line)'
                            }}
                            title="Sanctions (official sanctions lists)"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
                                style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)', color: 'var(--ink2)' }}
                              >
                                <ShieldAlert className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold whitespace-normal break-words leading-tight" style={{ color: 'var(--ink)' }}>
                                  Sanctions Screening Agent
                                </div>
                                <div className="text-[10px] font-mono-code truncate mt-0.5" style={{ color: 'var(--ink3)' }}>
                                  OpenSanctions designations &amp; strong aliases
                                </div>
                              </div>
                            </div>

                            {(() => {
                              const hasSanctionHit =
                                Object.values(latestRun.personResults || {}).some((p) => p.sanctionsResult?.outcome === 'HIT') ||
                                Object.values(latestRun.entityResults || {}).some((e) => e.sanctionsResult?.outcome === 'HIT');
                              return (
                                <span
                                  className="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-bold flex items-center gap-1.5 border shrink-0"
                                  style={{
                                    backgroundColor: 'var(--bg2)',
                                    borderColor: 'var(--line)',
                                    color: 'var(--ink2)'
                                  }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: hasSanctionHit ? 'var(--rose)' : 'var(--emerald)' }}
                                  />
                                  <span>{hasSanctionHit ? 'HIT' : 'CLEAR'}</span>
                                </span>
                              );
                            })()}
                          </div>

                          {/* PEP Agent */}
                          <div
                            className="p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs"
                            style={{
                              backgroundColor: 'var(--card)',
                              borderColor: 'var(--line)'
                            }}
                            title="PEP (politically exposed persons)"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
                                style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)', color: 'var(--ink2)' }}
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold whitespace-normal break-words leading-tight" style={{ color: 'var(--ink)' }}>
                                  PEP Screening Agent
                                </div>
                                <div className="text-[10px] font-mono-code truncate mt-0.5" style={{ color: 'var(--ink3)' }}>
                                  FATF foreign &amp; domestic PEP checks
                                </div>
                              </div>
                            </div>

                            {(() => {
                              const hasPep = Object.values(latestRun.personResults || {}).some(
                                (p) => p.pepResult?.outcome === 'REVIEW'
                              );
                              return (
                                <span
                                  className="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-bold flex items-center gap-1.5 border shrink-0"
                                  style={{
                                    backgroundColor: 'var(--bg2)',
                                    borderColor: 'var(--line)',
                                    color: 'var(--ink2)'
                                  }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: hasPep ? 'var(--amber)' : 'var(--emerald)' }}
                                  />
                                  <span>{hasPep ? 'REVIEW' : 'CLEAR'}</span>
                                </span>
                              );
                            })()}
                          </div>

                          {/* Adverse Media Agent */}
                          <div
                            className="p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs"
                            style={{
                              backgroundColor: 'var(--card)',
                              borderColor: 'var(--line)'
                            }}
                            title="Adverse media (news findings verified against source articles)"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
                                style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)', color: 'var(--ink2)' }}
                              >
                                <FileClock className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold whitespace-normal break-words leading-tight" style={{ color: 'var(--ink)' }}>
                                  Adverse Media Agent
                                </div>
                                <div className="text-[10px] font-mono-code truncate mt-0.5" style={{ color: 'var(--ink3)' }}>
                                  Financial crime, SFO, and export controls
                                </div>
                              </div>
                            </div>

                            {(() => {
                              const mediaOutcomes = Object.values(latestRun.personResults || {}).map(
                                (p) => p.adverseMediaResult?.outcome || 'CLEAR'
                              );
                              const hasHit = mediaOutcomes.includes('HIT');
                              const hasReview = mediaOutcomes.includes('REVIEW');
                              return (
                                <span
                                  className="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-bold flex items-center gap-1.5 border shrink-0"
                                  style={{
                                    backgroundColor: 'var(--bg2)',
                                    borderColor: 'var(--line)',
                                    color: 'var(--ink2)'
                                  }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{
                                      backgroundColor: hasHit
                                        ? 'var(--rose)'
                                        : hasReview
                                        ? 'var(--amber)'
                                        : 'var(--emerald)'
                                    }}
                                  />
                                  <span>{hasHit ? 'HIT' : hasReview ? 'REVIEW' : 'CLEAR'}</span>
                                </span>
                              );
                            })()}
                          </div>

                          {/* Ownership Integrity Agent */}
                          <div
                            className="p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs"
                            style={{
                              backgroundColor: 'var(--card)',
                              borderColor: 'var(--line)'
                            }}
                            title="Ownership integrity (cycles, dissolved entities and data gaps)"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
                                style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)', color: 'var(--ink2)' }}
                              >
                                <Scale className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold whitespace-normal break-words leading-tight" style={{ color: 'var(--ink)' }}>
                                  Ownership Integrity Agent
                                </div>
                                <div className="text-[10px] font-mono-code truncate mt-0.5" style={{ color: 'var(--ink3)' }}>
                                  Circular loops, dissolved entities &amp; gaps
                                </div>
                              </div>
                            </div>

                            {(() => {
                              const integrityIssue =
                                latestRun.integrityResult?.outcome === 'REVIEW' ||
                                (latestRun.integrityResult?.findings?.length || 0) > 0;
                              return (
                                <span
                                  className="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-bold flex items-center gap-1.5 border shrink-0"
                                  style={{
                                    backgroundColor: 'var(--bg2)',
                                    borderColor: 'var(--line)',
                                    color: 'var(--ink2)'
                                  }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: integrityIssue ? 'var(--amber)' : 'var(--emerald)' }}
                                  />
                                  <span>{integrityIssue ? 'REVIEW' : 'CLEAR'}</span>
                                </span>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Persons In Scope with View Dossier Action */}
                        <div className="space-y-2 pt-1">
                          <div className="section-label">Persons In Scope</div>
                          <div className="space-y-2">
                            {Object.values(latestRun.personResults || {}).map((pSummary) => {
                              const p = pSummary.person;
                              const outcome = pSummary.overallPersonOutcome;
                              const outcomeColor =
                                outcome === 'HIT'
                                  ? 'var(--rose)'
                                  : outcome === 'REVIEW'
                                  ? 'var(--amber)'
                                  : 'var(--emerald)';

                              return (
                                <div
                                  key={p.id}
                                  className="p-3 rounded-xl border text-xs space-y-2"
                                  style={{
                                    backgroundColor: 'var(--card)',
                                    borderColor: 'var(--line)'
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div
                                        className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0"
                                        style={{ backgroundColor: 'var(--bg2)', color: 'var(--ink2)' }}
                                      >
                                        {p.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="font-semibold truncate" style={{ color: 'var(--ink)' }}>
                                          {p.name}
                                        </div>
                                        <div className="text-[10.5px] font-mono-code flex items-center gap-1" style={{ color: 'var(--ink3)' }}>
                                          <span>{p.nationality}</span>
                                          <span>·</span>
                                          <span>{pSummary.effectiveRangeText}</span>
                                        </div>
                                      </div>
                                    </div>

                                    <span
                                      className="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-bold flex items-center gap-1 border shrink-0"
                                      style={{
                                        backgroundColor: 'var(--bg2)',
                                        borderColor: 'var(--line)',
                                        color: 'var(--ink2)'
                                      }}
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: outcomeColor }} />
                                      <span>{outcome}</span>
                                    </span>
                                  </div>

                                  {onOpenDossier && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenDossier(p)}
                                      className="w-full py-1.5 px-2.5 rounded-lg text-[11px] font-semibold border flex items-center justify-center gap-1.5 transition-all hover:bg-[var(--bg2)] cursor-pointer"
                                      style={{
                                        borderColor: 'var(--line)',
                                        color: 'var(--primary)',
                                        backgroundColor: 'transparent'
                                      }}
                                    >
                                      <Sparkles className="w-3.5 h-3.5" />
                                      <span>View Adverse Media Dossier</span>
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="py-10 px-4 text-center space-y-3 anim-vin">
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
                      Execute due diligence screening across Sanctions, PEP, Adverse Media, and
                      Ownership Integrity for all natural persons and legal entities on path.
                    </p>
                    <button
                      type="button"
                      disabled={screeningLoading}
                      onClick={async () => {
                        if (!user || screeningLoading) return;
                        setScreeningLoading(true);
                        setActiveScreeningStep('Initializing screening agents...');
                        try {
                          const resolvedCustId = customerId || `CUS-2026-${group.id.slice(-4)}`;
                          await executeScreeningWorkflow({
                            group,
                            customerId: resolvedCustId,
                            triggerType: 'ONBOARDING',
                            user: { uid: user.uid, displayName: profile?.displayName },
                            thresholdPct: activeThresholdPct,
                            onProgress: (agentName) => {
                              setActiveScreeningStep(agentName);
                            }
                          });
                        } catch (err: any) {
                          console.error('Failed to run screening:', err);
                        } finally {
                          setScreeningLoading(false);
                          setActiveScreeningStep('');
                        }
                      }}
                      className="py-1.5 px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer shadow-sm text-white"
                      style={{ backgroundColor: 'var(--primary)' }}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Run Initial Screening</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* AUDIT TAB — Live Immutable Audit Trail */}
            <div style={{ display: activeTab === 'audit' ? 'block' : 'none' }}>
              <AuditTrailView groupId={group.id} customerId={customerId} onRecordsCountChange={setAuditCount} />
            </div>
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
        border: isHighlighted ? '2px solid var(--primary)' : '1px solid var(--line)',
        borderLeft: isHighlighted ? '4px solid var(--primary)' : `4px solid ${leftBorderColor}`,
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
