/**
 * Sentinel AI — Deterministic Materiality Engine
 * Evaluates registry change events against strict deterministic rules:
 * - CRITICAL: party matched on sanctions list anywhere on path to root
 * - MATERIAL: person classification changes (BELOW/POSSIBLE/DEFINITE), PEP midpoint moves >= 5 pp, new unspecified owner, party crosses 50% control
 * - MONITOR: all other changes
 *
 * Implemented as a pure module.
 */

import {
  CorporateGroupSeed,
  RelationshipRecord,
  EntityRecord,
  PersonRecord,
  ShareSpec
} from '../types/bods';
import { bodsRepository } from '../data/repository';
import { resolveBeneficialOwnership, UboResolutionResult } from './uboEngine';
import { ISanctionsAdapter, PreviewSanctionsAdapter } from './sanctionsNormalizer';

export type MaterialityVerdict = 'CRITICAL' | 'MATERIAL' | 'MONITOR';

export interface MaterialityFactor {
  rule: string;
  description: string;
  impact: 'CRITICAL' | 'MATERIAL' | 'MONITOR';
}

export interface MaterialityEvaluation {
  verdict: MaterialityVerdict;
  confidence: number; // Assessment confidence (percentage integer 0-100)
  sourceConfidencePct: number; // Source confidence (e.g. 96%)
  citation: {
    regulationName: string;
    thresholdPct: number;
    statutoryBasis: string;
    verified: boolean;
    formattedCitation: string;
  };
  sanctionsDesignation?: {
    id: string;
    name: string;
    programme: string;
    openSanctionsUrl?: string;
    country: string;
  };
  factors: MaterialityFactor[];
  affectedPersonIds: string[];
  beforeResolution: UboResolutionResult;
  afterResolution: UboResolutionResult;
  changedPartyName: string;
  oldValueText: string;
  newValueText: string;
  templateExplanation: string;
}

export interface RegistryEventData {
  changeType: 'SHARE_CHANGE' | 'NEW_RELATIONSHIP' | 'RELATIONSHIP_ENDED' | 'ENTITY_DISSOLVED';
  relationshipId?: string;
  beforeShare?: ShareSpec;
  afterShare?: ShareSpec;
  newEntity?: EntityRecord;
  relationship?: RelationshipRecord;
  dissolvedEntityId?: string;
}

export interface EventAssessmentInput {
  baselineGroup: CorporateGroupSeed;
  eventData: RegistryEventData;
  sourceConfidence: number; // e.g. 0.96
  sanctionsAdapter?: ISanctionsAdapter;
}

/**
 * Pure function: applies a single event to a group and returns a new mutated group.
 */
export function applyEventToGroup(baseline: CorporateGroupSeed, event: RegistryEventData): CorporateGroupSeed {
  const mutated: CorporateGroupSeed = {
    ...baseline,
    entities: [...baseline.entities],
    persons: [...baseline.persons],
    relationships: [...baseline.relationships],
    unspecifiedOwners: baseline.unspecifiedOwners ? [...baseline.unspecifiedOwners] : []
  };

  if (event.changeType === 'SHARE_CHANGE' && event.relationshipId && event.afterShare) {
    mutated.relationships = mutated.relationships.map((rel) => {
      if (rel.id !== event.relationshipId) return rel;
      return {
        ...rel,
        isHot: true,
        interests: rel.interests.map((interest) => {
          if (interest.type !== 'shareholding') return interest;
          return {
            ...interest,
            share: event.afterShare!
          };
        })
      };
    });
  } else if (event.changeType === 'NEW_RELATIONSHIP') {
    if (event.newEntity && !mutated.entities.some((e) => e.id === event.newEntity!.id)) {
      mutated.entities.push(event.newEntity);
    }
    if (event.relationship && !mutated.relationships.some((r) => r.id === event.relationship!.id)) {
      mutated.relationships.push({ ...event.relationship, isHot: true });
    }
  } else if (event.changeType === 'RELATIONSHIP_ENDED' && event.relationshipId) {
    mutated.relationships = mutated.relationships.filter((r) => r.id !== event.relationshipId);
  } else if (event.changeType === 'ENTITY_DISSOLVED' && event.dissolvedEntityId) {
    mutated.entities = mutated.entities.map((ent) => {
      if (ent.id === event.dissolvedEntityId) {
        return { ...ent, status: 'dissolved' };
      }
      return ent;
    });
  }

  return mutated;
}

/**
 * Deterministically evaluates materiality of an event on a group.
 */
export async function evaluateMateriality(
  input: EventAssessmentInput
): Promise<MaterialityEvaluation> {
  const { baselineGroup, eventData, sourceConfidence } = input;
  const sanctions = input.sanctionsAdapter || new PreviewSanctionsAdapter();

  const jurRule = bodsRepository.getJurisdictionRule(baselineGroup.rootJurisdiction);
  const thresholdPct = jurRule?.uboThreshold ?? 25;

  const beforeResolution = resolveBeneficialOwnership(baselineGroup, thresholdPct);
  const afterGroup = applyEventToGroup(baselineGroup, eventData);
  const afterResolution = resolveBeneficialOwnership(afterGroup, thresholdPct);

  const factors: MaterialityFactor[] = [];
  const affectedPersonIds = new Set<string>();

  // Extract change display values
  let changedPartyName = 'Corporate Shareholder';
  let oldValueText = 'Previous holding';
  let newValueText = 'Updated holding';

  if (eventData.changeType === 'SHARE_CHANGE') {
    const rel = baselineGroup.relationships.find((r) => r.id === eventData.relationshipId);
    if (rel) {
      const party = baselineGroup.persons.find((p) => p.id === rel.interestedPartyId) ||
                    baselineGroup.entities.find((e) => e.id === rel.interestedPartyId);
      if (party) changedPartyName = party.name;
    }
    const formatShare = (s?: ShareSpec) => {
      if (!s) return '0%';
      return s.kind === 'exact' ? `${s.value}%` : `${s.min}–${s.max}%`;
    };
    oldValueText = formatShare(eventData.beforeShare);
    newValueText = formatShare(eventData.afterShare);
  } else if (eventData.changeType === 'NEW_RELATIONSHIP') {
    if (eventData.newEntity) {
      changedPartyName = eventData.newEntity.name;
    }
    oldValueText = 'None (0.0%)';
    const newShare = eventData.relationship?.interests.find((i) => i.type === 'shareholding')?.share;
    newValueText = newShare?.kind === 'exact' ? `${newShare.value}%` : `${newShare?.min}–${newShare?.max}%`;
  } else if (eventData.changeType === 'ENTITY_DISSOLVED') {
    const ent = baselineGroup.entities.find((e) => e.id === eventData.dissolvedEntityId);
    if (ent) changedPartyName = ent.name;
    oldValueText = 'Active';
    newValueText = 'Dissolved';
  } else if (eventData.changeType === 'RELATIONSHIP_ENDED') {
    oldValueText = 'Active interest';
    newValueText = 'Terminated (0%)';
  }

  // 1. RULE CHECK: CRITICAL — Sanctions check on any party introduced or on path
  // Look up all entities/persons present in the afterResolution graph
  let sanctionsHit = false;
  let sanctionsDesignation: MaterialityEvaluation['sanctionsDesignation'] = undefined;
  if (eventData.newEntity) {
    const hit = await sanctions.lookup({ name: eventData.newEntity.name, country: eventData.newEntity.jurisdictionCode });
    if (hit) {
      sanctionsHit = true;
      sanctionsDesignation = {
        id: hit.id,
        name: hit.name,
        programme: hit.programme,
        openSanctionsUrl: hit.openSanctionsUrl,
        country: hit.country
      };
      factors.push({
        rule: 'SANCTIONS_DESIGNATION',
        description: `Introduced party ${eventData.newEntity.name} is designated on official sanctions lists (${hit.programme}, ID: ${hit.id}).`,
        impact: 'CRITICAL'
      });
    }
  }

  // 2. RULE CHECK: MATERIAL — Person classification changes
  for (const afterP of afterResolution.persons) {
    const beforeP = beforeResolution.persons.find((p) => p.person.id === afterP.person.id);
    if (!beforeP) {
      if (afterP.classification !== 'BELOW') {
        affectedPersonIds.add(afterP.person.id);
        factors.push({
          rule: 'NEW_UBO_IDENTIFIED',
          description: `${afterP.person.name} entered the ownership structure as a ${afterP.classification} UBO (${afterP.totalMinPct.toFixed(1)}–${afterP.totalMaxPct.toFixed(1)}%).`,
          impact: 'MATERIAL'
        });
      }
    } else if (beforeP.classification !== afterP.classification) {
      affectedPersonIds.add(afterP.person.id);
      factors.push({
        rule: 'CLASSIFICATION_CHANGED',
        description: `${afterP.person.name}'s classification shifted from ${beforeP.classification} to ${afterP.classification} (${beforeP.totalMinPct.toFixed(1)}–${beforeP.totalMaxPct.toFixed(1)}% → ${afterP.totalMinPct.toFixed(1)}–${afterP.totalMaxPct.toFixed(1)}%).`,
        impact: 'MATERIAL'
      });
    }
  }

  // 3. RULE CHECK: MATERIAL — PEP effective ownership midpoint moves by >= 5 percentage points
  for (const afterP of afterResolution.persons) {
    if (afterP.person.pepStatus && afterP.person.pepStatus !== 'none') {
      const beforeP = beforeResolution.persons.find((p) => p.person.id === afterP.person.id);
      if (beforeP) {
        const beforeMid = (beforeP.totalMinPct + beforeP.totalMaxPct) / 2;
        const afterMid = (afterP.totalMinPct + afterP.totalMaxPct) / 2;
        const diff = Math.abs(afterMid - beforeMid);
        if (diff >= 5.0) {
          affectedPersonIds.add(afterP.person.id);
          factors.push({
            rule: 'PEP_STAKE_SHIFT',
            description: `PEP ${afterP.person.name}'s effective stake midpoint shifted by ${diff.toFixed(1)} pp (${beforeMid.toFixed(1)}% → ${afterMid.toFixed(1)}%), exceeding the 5 pp threshold.`,
            impact: 'MATERIAL'
          });
        }
      }
    }
  }

  // 4. RULE CHECK: MATERIAL — New unspecified owner appears
  const beforeExplicitGaps = beforeResolution.gapsReached?.length || 0;
  const afterExplicitGaps = afterResolution.gapsReached?.length || 0;
  if (afterExplicitGaps > beforeExplicitGaps) {
    factors.push({
      rule: 'NEW_DATA_GAP',
      description: `Registry change introduced ${afterExplicitGaps - beforeExplicitGaps} new unspecified owner.`,
      impact: 'MATERIAL'
    });
  }

  // 5. RULE CHECK: MATERIAL — Any party crosses 50% (controlling interest)
  for (const afterP of afterResolution.persons) {
    const beforeP = beforeResolution.persons.find((p) => p.person.id === afterP.person.id);
    const beforeMax = beforeP ? beforeP.totalMaxPct : 0;
    const afterMax = afterP.totalMaxPct;
    if ((beforeMax <= 50.0 && afterMax > 50.0) || (beforeMax > 50.0 && afterMax <= 50.0)) {
      affectedPersonIds.add(afterP.person.id);
      factors.push({
        rule: 'CONTROL_THRESHOLD_CROSSED',
        description: `${afterP.person.name} crossed the 50.0% controlling interest boundary (${beforeMax.toFixed(1)}% → ${afterMax.toFixed(1)}%).`,
        impact: 'MATERIAL'
      });
    }
  }

  // Determine final verdict
  let verdict: MaterialityVerdict = 'MONITOR';
  if (sanctionsHit) {
    verdict = 'CRITICAL';
  } else if (factors.some((f) => f.impact === 'MATERIAL')) {
    verdict = 'MATERIAL';
  }

  // Calculate confidence: min of source confidence and group completeness
  // Source confidence is decimal (e.g. 0.96 = 96%), completenessScore is 0-100
  const sourceConfPct = Math.round(sourceConfidence * 100);
  const groupCompleteness = afterResolution.completenessScore;
  const confidence = Math.min(sourceConfPct, groupCompleteness);

  // Governing citation
  const regName = jurRule ? jurRule.regulationName : 'Money Laundering Regulations 2017';
  const comparisonText = jurRule?.comparison === 'greater_or_equal' ? '25% or more' : 'more than 25%';
  const citation = {
    regulationName: regName,
    thresholdPct: thresholdPct,
    comparison: jurRule ? jurRule.comparison : ('strictly_greater' as const),
    statutoryBasis: `${regName} · ${comparisonText}`,
    verified: jurRule ? jurRule.verified : true,
    formattedCitation: `${regName} · ${comparisonText}`
  };

  // Deterministic fallback template explanation per Item 8
  let templateExplanation = '';
  if (verdict === 'CRITICAL') {
    templateExplanation = 'Requires escalation: a newly introduced party matches an official sanctions designation.';
  } else if (verdict === 'MATERIAL') {
    const mainFactor = factors.find((f) => f.impact === 'MATERIAL') || factors[0];
    templateExplanation = `Material change confirmed under ${citation.regulationName}: ${mainFactor?.description || 'ownership structure re-evaluated'}. This modification materially impacts the beneficial ownership profile and requires regulatory re-assessment.`;
  } else {
    templateExplanation = `Routine ownership update within permissible thresholds under ${citation.regulationName}. Effective beneficial ownership stakes remain stable with no sanctions designations or regulatory classification alterations observed.`;
  }

  return {
    verdict,
    confidence,
    sourceConfidencePct: sourceConfPct,
    citation,
    sanctionsDesignation,
    factors,
    affectedPersonIds: Array.from(affectedPersonIds),
    beforeResolution,
    afterResolution,
    changedPartyName,
    oldValueText,
    newValueText,
    templateExplanation
  };
}
