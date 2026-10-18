import {
  CorporateGroupSeed,
  EntityRecord,
  InterestType,
  PersonRecord,
  ShareSpec,
  ThresholdComparison,
  UnspecifiedOwnerRecord,
} from '../types/bods';

export type UboClassification = 'DEFINITE' | 'POSSIBLE' | 'BELOW';

export interface PathEdgeStep {
  relationshipId: string;
  fromOwnerId: string; // owner
  fromOwnerName: string;
  toSubjectId: string; // owned entity
  toSubjectName: string;
  interestType: InterestType;
  share: ShareSpec;
  minPct: number; // 0..100
  maxPct: number; // 0..100
}

export interface ContributingPath {
  pathId: string;
  personId: string;
  nodeIds: string[]; // ordered from root upward to person: [rootId, ..., personId]
  edgeIds: string[];
  steps: PathEdgeStep[];
  effectiveMinPct: number; // 0..100
  effectiveMaxPct: number; // 0..100
  arithmeticFormula: string; // e.g. "45% × 60% × 70% = 18.9%" or "25–50% × 60–75% = 15.0–37.5%"
}

export interface ResolvedPersonUbo {
  person: PersonRecord;
  totalMinPct: number;
  totalMaxPct: number;
  isRange: boolean;
  classification: UboClassification;
  paths: ContributingPath[];
  hasControlInterest: boolean;
}

export interface ReachedGapRecord {
  gap: UnspecifiedOwnerRecord;
  nodeIds: string[]; // [rootId, ..., gapId]
  edgeIds: string[];
  pathDisplay: string;
  effectiveReachMinPct: number;
  effectiveReachMaxPct: number;
}

export interface CycleReport {
  cycleId: string;
  cycleNodeIds: string[];
  cycleDisplay: string;
  edgeIds: string[];
}

export interface SkippedDissolvedReport {
  entity: EntityRecord;
  relationshipId: string;
  subjectEntityId: string;
  share: ShareSpec;
}

export interface ImplicitGapRecord {
  id: string;
  entityId: string;
  entityName: string;
  identifiedSharePct: number;
  remainderPct: number;
  entityEffectiveStakeInRoot: number; // e.g. 41.0 (%)
  effectOnRootPct: number; // e.g. 12.3 (%)
  label: string; // e.g. "Unidentified holders · 30%"
  description: string;
}

export type DeterministicRiskTier = 'HIGH' | 'ELEVATED' | 'STANDARD';

export interface DeterministicRiskAssessment {
  tier: DeterministicRiskTier;
  label: DeterministicRiskTier;
  tone: 'rose' | 'amber' | 'emerald';
  reason: string;
}

export interface UboResolutionResult {
  groupId: string;
  rootEntityId: string;
  thresholdPct: number;
  comparison: ThresholdComparison;
  comparisonSymbol: string; // '>' or '≥'
  MAX_DEPTH: number;
  pathsWalkedCount: number;
  persons: ResolvedPersonUbo[];
  uboCount: number; // count of persons with DEFINITE or POSSIBLE
  definiteCount: number;
  possibleCount: number;
  belowCount: number;
  cyclesFound: CycleReport[];
  skippedDissolved: SkippedDissolvedReport[];
  gapsReached: ReachedGapRecord[];
  implicitGaps: ImplicitGapRecord[];
  totalUnaccountedEffectOnRoot: number;
  hiddenOwnershipWarning: boolean;
  hiddenOwnershipMessage?: string;
  completenessScore: number; // 100 minus summed impact of explicit and implicit gaps reached, floored at 0
  riskAssessment: DeterministicRiskAssessment;
  maxLayerDepth: number;
}

const MAX_DEPTH_CAP = 15;

export function formatSharePct(share: ShareSpec): string {
  if (share.kind === 'exact') {
    return `${formatNumber(share.value)}%`;
  }
  return `${formatNumber(share.min)}–${formatNumber(share.max)}%`;
}

export function formatNumber(val: number): string {
  const rounded = Math.round(val * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

export function formatEffectiveRange(minPct: number, maxPct: number): string {
  const rMin = Math.round(minPct * 10) / 10;
  const rMax = Math.round(maxPct * 10) / 10;
  if (Math.abs(rMin - rMax) < 0.05) {
    return `${rMin.toFixed(1)}%`;
  }
  return `${rMin.toFixed(1)}–${rMax.toFixed(1)}%`;
}

function getShareBounds(share: ShareSpec): { min: number; max: number } {
  if (share.kind === 'exact') {
    return { min: share.value, max: share.value };
  }
  return { min: share.min, max: share.max };
}

/**
 * Helper to test if a percentage value passes the threshold under the jurisdiction comparison rule.
 * - 'strictly_greater': val > threshold
 * - 'greater_or_equal': val >= threshold
 */
export function passesThreshold(
  val: number,
  thresholdPct: number,
  comparison: ThresholdComparison
): boolean {
  const epsilon = 1e-6;
  if (comparison === 'strictly_greater') {
    return val - thresholdPct > epsilon;
  }
  // 'greater_or_equal'
  return val - thresholdPct >= -epsilon;
}

/**
 * Pure, deterministic UBO resolution engine.
 * Walks every ownership path from rootEntityId upward to natural persons and unspecified owners.
 */
export function resolveBeneficialOwnership(
  group: CorporateGroupSeed,
  thresholdPct: number,
  comparisonOverride?: ThresholdComparison
): UboResolutionResult {
  // Determine comparison rule: US uses greater_or_equal; UK, EU, SG, IN use strictly_greater
  const defaultComparison: ThresholdComparison =
    group.rootJurisdiction.toUpperCase() === 'US' ? 'greater_or_equal' : 'strictly_greater';
  const comparison = comparisonOverride ?? defaultComparison;
  const comparisonSymbol = comparison === 'strictly_greater' ? '>' : '≥';

  const entityMap = new Map<string, EntityRecord>();
  for (const ent of group.entities) {
    entityMap.set(ent.id, ent);
  }

  const personMap = new Map<string, PersonRecord>();
  for (const per of group.persons) {
    personMap.set(per.id, per);
  }

  const gapMap = new Map<string, UnspecifiedOwnerRecord>();
  for (const gap of group.unspecifiedOwners) {
    gapMap.set(gap.id, gap);
  }

  // Group relationships by subjectId (the owned entity)
  const inboundBySubject = new Map<string, typeof group.relationships>();
  for (const rel of group.relationships) {
    const list = inboundBySubject.get(rel.subjectId) ?? [];
    list.push(rel);
    inboundBySubject.set(rel.subjectId, list);
  }

  const contributingPathsByPerson = new Map<string, ContributingPath[]>();
  const cyclesByKey = new Map<string, CycleReport>();
  const skippedDissolvedMap = new Map<string, SkippedDissolvedReport>();
  const gapsReachedMap = new Map<string, ReachedGapRecord>();

  let pathsWalkedCount = 0;
  let maxLayerDepth = 1;

  interface TraversalFrame {
    currentNodeId: string;
    visitedNodeIds: string[]; // [rootId, ..., currentNodeId]
    visitedEdgeIds: string[];
    steps: PathEdgeStep[];
    cumMinFraction: number; // 0..1
    cumMaxFraction: number; // 0..1
    depth: number;
  }

  const getNodeName = (id: string): string => {
    return (
      entityMap.get(id)?.name ??
      personMap.get(id)?.name ??
      gapMap.get(id)?.label ??
      id
    );
  };

  const walk = (frame: TraversalFrame) => {
    if (frame.depth > maxLayerDepth) {
      maxLayerDepth = frame.depth;
    }

    if (frame.depth >= MAX_DEPTH_CAP) {
      return;
    }

    const incomingRels = inboundBySubject.get(frame.currentNodeId) ?? [];

    for (const rel of incomingRels) {
      const ownerId = rel.interestedPartyId;
      const primaryInterest = rel.interests[0];
      if (!primaryInterest) continue;

      const bounds = getShareBounds(primaryInterest.share);

      // Check if owner is a dissolved entity
      if (rel.interestedPartyType === 'entity') {
        const ownerEntity = entityMap.get(ownerId);
        if (ownerEntity && ownerEntity.status === 'dissolved') {
          skippedDissolvedMap.set(rel.id, {
            entity: ownerEntity,
            relationshipId: rel.id,
            subjectEntityId: frame.currentNodeId,
            share: primaryInterest.share,
          });
          continue;
        }
      }

      // Check for cycle on current path
      const existingIdx = frame.visitedNodeIds.indexOf(ownerId);
      if (existingIdx !== -1) {
        const cycleSlice = [...frame.visitedNodeIds.slice(existingIdx), ownerId];
        const cycleEdges = [...frame.visitedEdgeIds.slice(existingIdx), rel.id];
        const uniqueNodes = cycleSlice.slice(0, -1);
        const minNode = [...uniqueNodes].sort()[0];
        const minPos = uniqueNodes.indexOf(minNode);
        const rotated = [
          ...uniqueNodes.slice(minPos),
          ...uniqueNodes.slice(0, minPos),
        ];
        const cycleKey = rotated.join('->');

        if (!cyclesByKey.has(cycleKey)) {
          const cycleDisplay = cycleSlice.map((nid) => getNodeName(nid)).join(' ⇄ ');
          cyclesByKey.set(cycleKey, {
            cycleId: `cycle-${cyclesByKey.size + 1}`,
            cycleNodeIds: cycleSlice,
            cycleDisplay,
            edgeIds: cycleEdges,
          });
        }
        continue;
      }

      const nextMinFraction = frame.cumMinFraction * (bounds.min / 100);
      const nextMaxFraction = frame.cumMaxFraction * (bounds.max / 100);

      const step: PathEdgeStep = {
        relationshipId: rel.id,
        fromOwnerId: ownerId,
        fromOwnerName: getNodeName(ownerId),
        toSubjectId: frame.currentNodeId,
        toSubjectName: getNodeName(frame.currentNodeId),
        interestType: primaryInterest.type,
        share: primaryInterest.share,
        minPct: bounds.min,
        maxPct: bounds.max,
      };

      const nextNodes = [...frame.visitedNodeIds, ownerId];
      const nextEdges = [...frame.visitedEdgeIds, rel.id];
      const nextSteps = [...frame.steps, step];

      if (rel.interestedPartyType === 'person') {
        pathsWalkedCount += 1;
        const nextDepth = frame.depth + 1;
        if (nextDepth > maxLayerDepth) {
          maxLayerDepth = nextDepth;
        }

        const effMinPct = nextMinFraction * 100;
        const effMaxPct = nextMaxFraction * 100;

        const terms = nextSteps.map((s) => formatSharePct(s.share)).join(' × ');
        const resultStr = formatEffectiveRange(effMinPct, effMaxPct);
        const arithmeticFormula = `${terms} = ${resultStr}`;

        const pathRecord: ContributingPath = {
          pathId: `path-${ownerId}-${pathsWalkedCount}`,
          personId: ownerId,
          nodeIds: nextNodes,
          edgeIds: nextEdges,
          steps: nextSteps,
          effectiveMinPct: effMinPct,
          effectiveMaxPct: effMaxPct,
          arithmeticFormula,
        };

        const existingPaths = contributingPathsByPerson.get(ownerId) ?? [];
        existingPaths.push(pathRecord);
        contributingPathsByPerson.set(ownerId, existingPaths);
      } else if (rel.interestedPartyType === 'unspecified') {
        pathsWalkedCount += 1;
        const nextDepth = frame.depth + 1;
        if (nextDepth > maxLayerDepth) {
          maxLayerDepth = nextDepth;
        }

        const gapRecord = gapMap.get(ownerId);
        if (gapRecord) {
          const chainNames = nextNodes.map((nid) => getNodeName(nid)).join(' ← ');
          gapsReachedMap.set(`${ownerId}:${nextEdges.join(',')}`, {
            gap: gapRecord,
            nodeIds: nextNodes,
            edgeIds: nextEdges,
            pathDisplay: chainNames,
            effectiveReachMinPct: nextMinFraction * 100,
            effectiveReachMaxPct: nextMaxFraction * 100,
          });
        }
      } else if (rel.interestedPartyType === 'entity') {
        const ownerEntity = entityMap.get(ownerId);
        if (!ownerEntity) continue;

        const prevStake = entityStakeInRootMap.get(ownerId) ?? 0;
        entityStakeInRootMap.set(ownerId, prevStake + nextMaxFraction);

        const furtherInbound = inboundBySubject.get(ownerId) ?? [];
        if (furtherInbound.length === 0) {
          pathsWalkedCount += 1;
          const nextDepth = frame.depth + 1;
          if (nextDepth > maxLayerDepth) {
            maxLayerDepth = nextDepth;
          }
        } else {
          walk({
            currentNodeId: ownerId,
            visitedNodeIds: nextNodes,
            visitedEdgeIds: nextEdges,
            steps: nextSteps,
            cumMinFraction: nextMinFraction,
            cumMaxFraction: nextMaxFraction,
            depth: frame.depth + 1,
          });
        }
      }
    }
  };

  const entityStakeInRootMap = new Map<string, number>();
  entityStakeInRootMap.set(group.rootEntityId, 1.0);

  walk({
    currentNodeId: group.rootEntityId,
    visitedNodeIds: [group.rootEntityId],
    visitedEdgeIds: [],
    steps: [],
    cumMinFraction: 1,
    cumMaxFraction: 1,
    depth: 1,
  });

  // Classify every person in the group:
  // DEFINITE when the minimum passes the jurisdiction's test,
  // POSSIBLE when only the maximum passes,
  // BELOW when neither does.
  const resolvedPersons: ResolvedPersonUbo[] = group.persons.map((person) => {
    const paths = contributingPathsByPerson.get(person.id) ?? [];
    let totalMinPct = 0;
    let totalMaxPct = 0;
    let hasControlInterest = false;

    for (const p of paths) {
      totalMinPct += p.effectiveMinPct;
      totalMaxPct += p.effectiveMaxPct;
      for (const s of p.steps) {
        if (s.interestType !== 'shareholding') {
          hasControlInterest = true;
        }
      }
    }

    totalMinPct = Math.round(totalMinPct * 10000) / 10000;
    totalMaxPct = Math.round(totalMaxPct * 10000) / 10000;

    let classification: UboClassification;
    if (passesThreshold(totalMinPct, thresholdPct, comparison)) {
      classification = 'DEFINITE';
    } else if (passesThreshold(totalMaxPct, thresholdPct, comparison)) {
      classification = 'POSSIBLE';
    } else {
      classification = 'BELOW';
    }

    const isRange = Math.abs(totalMaxPct - totalMinPct) >= 0.05;

    return {
      person,
      totalMinPct,
      totalMaxPct,
      isRange,
      classification,
      paths,
      hasControlInterest,
    };
  });

  const rankOrder: Record<UboClassification, number> = {
    DEFINITE: 0,
    POSSIBLE: 1,
    BELOW: 2,
  };
  resolvedPersons.sort((a, b) => {
    if (rankOrder[a.classification] !== rankOrder[b.classification]) {
      return rankOrder[a.classification] - rankOrder[b.classification];
    }
    return b.totalMaxPct - a.totalMaxPct;
  });

  const definiteCount = resolvedPersons.filter((p) => p.classification === 'DEFINITE').length;
  const possibleCount = resolvedPersons.filter((p) => p.classification === 'POSSIBLE').length;
  const belowCount = resolvedPersons.filter((p) => p.classification === 'BELOW').length;
  const uboCount = definiteCount + possibleCount;

  // Calculate implicit gaps for entities whose identified ownership is below 100%
  const implicitGaps: ImplicitGapRecord[] = [];
  let totalUnaccountedEffectOnRoot = 0;

  for (const ent of group.entities) {
    const isSanctioned = ent.status === 'sanctioned' || Boolean(ent.sanctionsProgramme);
    if (isSanctioned) {
      // Sanctioned entity is a terminal node: do not generate an "Unidentified holders" remainder above it
      continue;
    }

    const incoming = inboundBySubject.get(ent.id) ?? [];
    let sumOwnerMax = 0;
    for (const rel of incoming) {
      const primary = rel.interests[0];
      if (!primary) continue;
      sumOwnerMax += getShareBounds(primary.share).max;
    }
    const identifiedShare = Math.min(100, Math.round(sumOwnerMax * 10) / 10);
    const remainderPct = Math.max(0, Math.round((100 - identifiedShare) * 10) / 10);

    const stakeFraction = entityStakeInRootMap.get(ent.id) ?? 0;
    const stakePct = Math.round(stakeFraction * 1000) / 10;

    if (remainderPct > 0 && stakeFraction > 0) {
      const effectOnRootPct = Math.round((remainderPct * stakeFraction) * 10) / 10;
      totalUnaccountedEffectOnRoot += effectOnRootPct;

      implicitGaps.push({
        id: `unidentified-${ent.id}`,
        entityId: ent.id,
        entityName: ent.name,
        identifiedSharePct: identifiedShare,
        remainderPct,
        entityEffectiveStakeInRoot: stakePct,
        effectOnRootPct,
        label: `Unidentified holders · ${formatNumber(remainderPct)}%`,
        description: `Unaccounted ownership in ${ent.name}. May include holdings below the disclosure threshold.`,
      });
    }
  }

  totalUnaccountedEffectOnRoot = Math.round(totalUnaccountedEffectOnRoot * 10) / 10;

  const hiddenOwnershipWarning = passesThreshold(
    totalUnaccountedEffectOnRoot,
    thresholdPct,
    comparison
  );

  const rootEntityRecord = entityMap.get(group.rootEntityId);
  const rootEntityName = rootEntityRecord?.name ?? group.name;

  const hiddenOwnershipMessage = hiddenOwnershipWarning
    ? `Unidentified holders could together hold up to ${formatNumber(totalUnaccountedEffectOnRoot)}% of ${rootEntityName}, enough to conceal a UBO.`
    : undefined;

  const uniqueGapIds = new Set<string>();
  let totalGapImpact = 0;
  const gapsReached = Array.from(gapsReachedMap.values());
  for (const reached of gapsReached) {
    if (!uniqueGapIds.has(reached.gap.id)) {
      uniqueGapIds.add(reached.gap.id);
      totalGapImpact += reached.gap.estimatedImpactOnCompleteness;
    }
  }

  // Completeness subtracts both explicit gaps and unaccounted remainders' effect on root
  const completenessScore = Math.max(
    0,
    Math.round((100 - totalGapImpact - totalUnaccountedEffectOnRoot) * 10) / 10
  );

  // Derive risk tier deterministically per Custom Instructions §8:
  // - HIGH: a PEP is DEFINITE or POSSIBLE, or completeness is below 70%, or the hidden-ownership warning fires
  // - ELEVATED: a cycle, a dissolved entity on an ownership path, or any POSSIBLE UBO
  // - STANDARD: none of the above
  const pepUbo = resolvedPersons.find(
    (p) =>
      p.person.pepStatus !== 'none' &&
      (p.classification === 'DEFINITE' || p.classification === 'POSSIBLE')
  );

  let riskTier: DeterministicRiskTier = 'STANDARD';
  let riskTone: 'rose' | 'amber' | 'emerald' = 'emerald';
  let riskReason = 'All UBOs resolved deterministically without cycles, gaps, or PEP exposure';

  if (pepUbo || completenessScore < 70 || hiddenOwnershipWarning) {
    riskTier = 'HIGH';
    riskTone = 'rose';
    const reasons: string[] = [];
    if (pepUbo) {
      reasons.push(`PEP (${pepUbo.person.name}) is a ${pepUbo.classification} UBO`);
    }
    if (completenessScore < 70) {
      reasons.push(`Completeness score is ${completenessScore}% (< 70%)`);
    }
    if (hiddenOwnershipWarning) {
      reasons.push(
        `Unaccounted holdings could conceal a UBO (${formatNumber(totalUnaccountedEffectOnRoot)}% of root)`
      );
    }
    riskReason = reasons.join(' · ');
  } else if (cyclesByKey.size > 0 || skippedDissolvedMap.size > 0 || possibleCount > 0) {
    riskTier = 'ELEVATED';
    riskTone = 'amber';
    const reasons: string[] = [];
    if (cyclesByKey.size > 0) {
      reasons.push('Circular ownership cycle detected and broken');
    }
    if (skippedDissolvedMap.size > 0) {
      reasons.push('Dissolved entity on ownership chain');
    }
    if (possibleCount > 0) {
      reasons.push(`Banded ownership yields ${possibleCount} POSSIBLE UBO`);
    }
    riskReason = reasons.join(' · ');
  }

  const riskAssessment: DeterministicRiskAssessment = {
    tier: riskTier,
    label: riskTier,
    tone: riskTone,
    reason: riskReason,
  };

  return {
    groupId: group.id,
    rootEntityId: group.rootEntityId,
    thresholdPct,
    comparison,
    comparisonSymbol,
    MAX_DEPTH: MAX_DEPTH_CAP,
    pathsWalkedCount,
    persons: resolvedPersons,
    uboCount,
    definiteCount,
    possibleCount,
    belowCount,
    cyclesFound: Array.from(cyclesByKey.values()),
    skippedDissolved: Array.from(skippedDissolvedMap.values()),
    gapsReached,
    implicitGaps,
    totalUnaccountedEffectOnRoot,
    hiddenOwnershipWarning,
    hiddenOwnershipMessage,
    completenessScore,
    riskAssessment,
    maxLayerDepth,
  };
}
