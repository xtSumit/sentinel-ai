/**
 * Sentinel AI — Unified Screening Orchestrator
 * Coordinates parallel execution of:
 * 1. Sanctions Screening Agent (persons and entities on paths)
 * 2. PEP Agent (definite/possible natural persons)
 * 3. Adverse Media Agent (definite/possible natural persons)
 * 4. Ownership Integrity Agent (entire resolved graph topology)
 *
 * Persists screeningRuns/{runId} and creates cases/{caseId}.
 */

import { CorporateGroupSeed, BodsPerson, BodsEntity } from '../types/bods';
import { resolveBeneficialOwnership, UboResolutionResult, ResolvedPersonUbo, formatEffectiveRange } from './uboEngine';
import { runSanctionsScreening, SanctionsScreeningResult } from './sanctionsAgent';
import { runPepScreening, PepScreeningResult } from './pepAgent';
import { runAdverseMediaScreening, AdverseMediaScreeningResult } from './adverseMediaAgent';
import { runOwnershipIntegrityScreening, OwnershipIntegrityResult } from './ownershipIntegrityAgent';
import { db, writeAuditRecord } from '../lib/firebase';
import { doc, setDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';

export type ScreeningTriggerType = 'PKYC' | 'ONBOARDING';
export type CaseOverallStatus = 'CRITICAL' | 'STANDARD' | 'CLEAR';

export interface PersonScreeningSummary {
  person: BodsPerson;
  classification: 'DEFINITE' | 'POSSIBLE' | 'BELOW';
  effectiveRangeText: string;
  pepResult: PepScreeningResult;
  sanctionsResult: SanctionsScreeningResult;
  adverseMediaResult: AdverseMediaScreeningResult;
  overallPersonOutcome: 'HIT' | 'REVIEW' | 'CLEAR';
}

export interface EntityScreeningSummary {
  entity: BodsEntity;
  sanctionsResult: SanctionsScreeningResult;
}

export interface ScreeningRunRecord {
  runId: string;
  customerId: string;
  groupId: string;
  triggerType: ScreeningTriggerType;
  triggerEvent?: any;
  startedAt: string;
  startedBy: string;
  completedAt: string;
  overallOutcome: 'HIT' | 'REVIEW' | 'CLEAR';
  integrityResult: OwnershipIntegrityResult;
  eventId?: string | null;
  personResults: Record<string, PersonScreeningSummary>;
  entityResults: Record<string, EntityScreeningSummary>;
  personsInScope?: Array<{
    id: string;
    name: string;
    nationality: string;
    classification: string;
    effectiveRangeText: string;
    pepStatus: string;
    outcome: string;
  }>;
}

export interface ComplianceCaseRecord {
  id: string; // e.g. PKYC-2026-#### or KYC-2026-####
  caseId: string;
  type: ScreeningTriggerType;
  customerId: string;
  groupId: string;
  groupName: string;
  triggerSummary: string;
  triggerEvent?: any;
  eventId?: string | null;
  materialityVerdict?: string;
  materialityExplanation?: string;
  materialityCitation?: string;
  materialityConfidence?: number;
  isAiExplanation?: boolean;
  screeningRunId: string;
  overallStatus: CaseOverallStatus;
  state: 'open' | 'closed';
  analystUid: string;
  analystName: string;
  createdAt: string;
  closedBy?: string;
  closedAt?: string;
  resolutionNote?: string;
  archived?: boolean;
  archivedBy?: string;
  archivedByName?: string;
  archivedAt?: string;
  archiveReason?: string;
  restoredBy?: string;
  restoredByName?: string;
  restoredAt?: string;
  restoreReason?: string;
  personsInScope: Array<{
    id: string;
    name: string;
    nationality: string;
    classification: 'DEFINITE' | 'POSSIBLE' | 'BELOW';
    effectiveRangeText: string;
    pepStatus: string;
    outcome: 'HIT' | 'REVIEW' | 'CLEAR';
  }>;
  screeningSummary: {
    sanctionsOutcome: 'HIT' | 'REVIEW' | 'CLEAR';
    pepOutcome: 'REVIEW' | 'CLEAR';
    adverseMediaOutcome: 'HIT' | 'REVIEW' | 'CLEAR';
    integrityOutcome: 'REVIEW' | 'CLEAR';
  };
}

export interface RunScreeningOptions {
  group: CorporateGroupSeed;
  customerId: string;
  triggerType: ScreeningTriggerType;
  triggerEvent?: any;
  materialityEvaluation?: any;
  user: { uid: string; displayName?: string | null };
  thresholdPct?: number;
  onProgress?: (agentName: string, step: number) => void;
}

const inMemoryScreeningRunCache = new Map<string, { run: ScreeningRunRecord; createdCase: ComplianceCaseRecord }>();

export async function executeScreeningWorkflow(
  opts: RunScreeningOptions
): Promise<{ run: ScreeningRunRecord; createdCase: ComplianceCaseRecord; isExisting?: boolean }> {
  const {
    group,
    customerId,
    triggerType,
    triggerEvent,
    materialityEvaluation,
    user,
    thresholdPct = 25,
    onProgress
  } = opts;

  // Idempotency check: if screening run or case already exists for this trigger event, return existing without re-running
  const eventId = triggerEvent?.eventId || triggerEvent?.id;
  if (eventId) {
    if (inMemoryScreeningRunCache.has(eventId)) {
      const cached = inMemoryScreeningRunCache.get(eventId)!;
      return {
        run: cached.run,
        createdCase: cached.createdCase,
        isExisting: true
      };
    }
    try {
      const runsCol = collection(db, 'screeningRuns');
      const q = query(runsCol, where('eventId', '==', eventId), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const existingRun = snap.docs[0].data() as ScreeningRunRecord;
        let existingCase: ComplianceCaseRecord | null = null;
        try {
          const casesCol = collection(db, 'cases');
          const cq = query(casesCol, where('eventId', '==', eventId), limit(1));
          const cSnap = await getDocs(cq);
          if (!cSnap.empty) {
            existingCase = cSnap.docs[0].data() as ComplianceCaseRecord;
          }
        } catch (cErr) {
          console.warn('[Screening] Could not fetch existing case:', cErr);
        }
        inMemoryScreeningRunCache.set(eventId, { run: existingRun, createdCase: existingCase as any });
        return {
          run: existingRun,
          createdCase: existingCase as any,
          isExisting: true
        };
      }
    } catch (err) {
      // Ignore Firestore permission-denied errors in unauthenticated/test mode
    }
  }

  const startedAt = new Date().toISOString();
  const runId = `run-${Date.now()}`;

  // Log start of screening run
  await writeAuditRecord({
    actorUid: user.uid,
    actorType: 'HUMAN',
    actorName: user.displayName || 'Analyst',
    action: 'SCREENING_RUN_STARTED',
    summary: `Started ${triggerType} screening run ${runId} for ${group.name} (${customerId}).`,
    customerId,
    groupId: group.id,
    details: { runId, triggerType }
  });

  // 1. Resolve ownership to identify persons in scope (DEFINITE or POSSIBLE)
  const resolution = resolveBeneficialOwnership(group, thresholdPct);
  const uboPersons = resolution.persons.filter(
    (p) => p.classification === 'DEFINITE' || p.classification === 'POSSIBLE'
  );

  // Entities on their paths
  const inScopeEntityIds = new Set<string>();
  uboPersons.forEach((p) => {
    p.paths.forEach((path) => {
      path.nodeIds.forEach((id) => {
        if (group.entities.some((e) => e.id === id)) {
          inScopeEntityIds.add(id);
        }
      });
    });
  });

  // 2. Run Sanctions Screening on path entities
  onProgress?.('Sanctions Screening Agent', 1);
  const entityResults: Record<string, EntityScreeningSummary> = {};
  for (const entityId of inScopeEntityIds) {
    const ent = group.entities.find((e) => e.id === entityId);
    if (!ent) continue;
    const res = await runSanctionsScreening(ent.name, ent.jurisdictionCode);
    entityResults[entityId] = { entity: ent, sanctionsResult: res };
  }

  // 3. Screen Persons in Scope across Sanctions, PEP, Adverse Media
  onProgress?.('PEP & Sanctions Agents', 2);
  const personResults: Record<string, PersonScreeningSummary> = {};
  for (const ubo of uboPersons) {
    const person = ubo.person;
    const sanctionsRes = await runSanctionsScreening(person.name, person.nationality);
    const pepRes = runPepScreening(person, ubo.classification);
    onProgress?.(`Adverse Media Agent (${person.name})`, 3);
    const adverseRes = await runAdverseMediaScreening(person);

    // Derive overall outcome for this person
    let overallPersonOutcome: 'HIT' | 'REVIEW' | 'CLEAR' = 'CLEAR';
    if (sanctionsRes.outcome === 'HIT' || adverseRes.outcome === 'HIT') {
      overallPersonOutcome = 'HIT';
    } else if (
      pepRes.outcome === 'REVIEW' ||
      adverseRes.outcome === 'REVIEW' ||
      sanctionsRes.outcome === 'POSSIBLE_MATCH'
    ) {
      overallPersonOutcome = 'REVIEW';
    }

    personResults[person.id] = {
      person,
      classification: ubo.classification,
      effectiveRangeText: formatEffectiveRange(ubo.totalMinPct, ubo.totalMaxPct),
      pepResult: pepRes,
      sanctionsResult: sanctionsRes,
      adverseMediaResult: adverseRes,
      overallPersonOutcome
    };
  }

  // 4. Run Ownership Integrity Agent
  onProgress?.('Ownership Integrity Agent', 4);
  const integrityResult = runOwnershipIntegrityScreening(resolution);

  // Determine overall outcome across all agents
  let overallOutcome: 'HIT' | 'REVIEW' | 'CLEAR' = 'CLEAR';
  const hasAnyHit =
    Object.values(personResults).some((p) => p.overallPersonOutcome === 'HIT') ||
    Object.values(entityResults).some((e) => e.sanctionsResult.outcome === 'HIT');

  const hasAnyReview =
    Object.values(personResults).some((p) => p.overallPersonOutcome === 'REVIEW') ||
    Object.values(entityResults).some((e) => e.sanctionsResult.outcome === 'POSSIBLE_MATCH') ||
    integrityResult.outcome === 'REVIEW';

  if (hasAnyHit) {
    overallOutcome = 'HIT';
  } else if (hasAnyReview) {
    overallOutcome = 'REVIEW';
  }

  const completedAt = new Date().toISOString();

  // Helper to remove undefined properties before persisting to Firestore
  const sanitizeForFirestore = <T>(obj: T): T => {
    return JSON.parse(
      JSON.stringify(obj, (_key, value) => (value === undefined ? null : value))
    );
  };

  // Create ScreeningRunRecord
  const runRecord: ScreeningRunRecord = sanitizeForFirestore({
    runId,
    customerId,
    groupId: group.id,
    triggerType,
    triggerEvent,
    eventId: eventId || null,
    startedAt,
    startedBy: user.uid,
    completedAt,
    overallOutcome,
    integrityResult,
    personResults,
    entityResults
  });

  // Persist to Firestore: screeningRuns/{runId}
  try {
    const runDocRef = doc(db, 'screeningRuns', runId);
    await setDoc(runDocRef, runRecord);
  } catch (err) {
    console.warn('[Screening] Could not persist screening run to Firestore:', (err as Error).message);
  }

  // Log completion of screening run
  await writeAuditRecord({
    actorUid: user.uid,
    actorType: 'SYSTEM',
    actorName: 'Sentinel Screening Engine',
    action: 'SCREENING_RUN_COMPLETED',
    summary: `Completed screening run ${runId} with overall outcome ${overallOutcome}.`,
    customerId,
    groupId: group.id,
    details: { runId, overallOutcome, inScopeCount: uboPersons.length }
  });

  // 5. Generate Case ID & Create Case
  // Type PKYC (PKYC-2026-####) or ONBOARDING (KYC-2026-####)
  const caseRandomNumber = Math.floor(1000 + Math.random() * 9000);
  const caseId =
    triggerType === 'PKYC'
      ? `PKYC-2026-${caseRandomNumber}`
      : `KYC-2026-${caseRandomNumber}`;

  const overallStatus: CaseOverallStatus =
    overallOutcome === 'HIT' ? 'CRITICAL' : overallOutcome === 'REVIEW' ? 'STANDARD' : 'CLEAR';

  let triggerSummary = 'Onboarding due diligence screening completed for client entity.';
  if (triggerType === 'PKYC' && triggerEvent) {
    triggerSummary = `Registry modification: ${triggerEvent.description || 'Shareholding change detected'}.`;
  }

  const rawCase: ComplianceCaseRecord = {
    id: caseId,
    caseId,
    type: triggerType,
    customerId,
    groupId: group.id,
    groupName: group.name,
    triggerSummary,
    triggerEvent,
    eventId: eventId || null,
    materialityVerdict: materialityEvaluation?.verdict,
    materialityExplanation: materialityEvaluation?.explanation,
    materialityCitation: materialityEvaluation?.citation?.formattedCitation,
    materialityConfidence: materialityEvaluation?.confidence,
    isAiExplanation: materialityEvaluation?.isAiGenerated,
    screeningRunId: runId,
    overallStatus,
    state: 'open',
    analystUid: user.uid,
    analystName: user.displayName || 'Analyst',
    createdAt: completedAt,
    personsInScope: uboPersons.map((p) => {
      const pRes = personResults[p.person.id];
      return {
        id: p.person.id,
        name: p.person.name,
        nationality: p.person.nationality,
        classification: p.classification,
        effectiveRangeText: formatEffectiveRange(p.totalMinPct, p.totalMaxPct),
        pepStatus: p.person.pepStatus,
        outcome: pRes ? pRes.overallPersonOutcome : 'CLEAR'
      };
    }),
    screeningSummary: {
      sanctionsOutcome: Object.values(entityResults).some((e) => e.sanctionsResult.outcome === 'HIT') ||
        Object.values(personResults).some((p) => p.sanctionsResult.outcome === 'HIT')
        ? 'HIT'
        : Object.values(entityResults).some((e) => e.sanctionsResult.outcome === 'POSSIBLE_MATCH') ||
          Object.values(personResults).some((p) => p.sanctionsResult.outcome === 'POSSIBLE_MATCH')
        ? 'REVIEW'
        : 'CLEAR',
      pepOutcome: Object.values(personResults).some((p) => p.pepResult.outcome === 'REVIEW') ? 'REVIEW' : 'CLEAR',
      adverseMediaOutcome: Object.values(personResults).some((p) => p.adverseMediaResult.outcome === 'HIT')
        ? 'HIT'
        : Object.values(personResults).some((p) => p.adverseMediaResult.outcome === 'REVIEW')
        ? 'REVIEW'
        : 'CLEAR',
      integrityOutcome: integrityResult.outcome
    }
  };

  const createdCase: ComplianceCaseRecord = sanitizeForFirestore(rawCase);

  // Persist case to Firestore: cases/{caseId}
  try {
    const caseDocRef = doc(db, 'cases', caseId);
    await setDoc(caseDocRef, createdCase);
  } catch (err) {
    console.warn('[Screening] Could not persist case to Firestore:', (err as Error).message);
  }

  // Audit case creation
  await writeAuditRecord({
    actorUid: user.uid,
    actorType: 'HUMAN',
    actorName: user.displayName || 'Analyst',
    action: 'CASE_CREATED',
    summary: `Created compliance case ${caseId} (${triggerType}) with status ${overallStatus}.`,
    customerId,
    groupId: group.id,
    caseId,
    details: { caseId, type: triggerType, overallStatus }
  });

  if (eventId) {
    inMemoryScreeningRunCache.set(eventId, { run: runRecord, createdCase });
  }

  return { run: runRecord, createdCase };
}
