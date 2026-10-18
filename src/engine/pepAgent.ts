/**
 * Sentinel AI — PEP Screening Agent
 * Deterministic evaluation from BODS person records:
 * - Foreign PEPs and International Organisation PEPs at DEFINITE or POSSIBLE classification produce REVIEW (high priority).
 * - Domestic PEPs produce REVIEW (lower priority).
 * - Otherwise CLEAR.
 */

import { BodsPerson } from '../types/bods';
import { UboClassification } from './uboEngine';

export type PepOutcome = 'REVIEW' | 'CLEAR';

export interface PepScreeningResult {
  outcome: PepOutcome;
  priority: 'high' | 'standard' | 'low';
  pepStatus: BodsPerson['pepStatus'];
  reason: string;
  details: string;
}

export function runPepScreening(
  person: BodsPerson,
  classification: UboClassification
): PepScreeningResult {
  const isUbo = classification === 'DEFINITE' || classification === 'POSSIBLE';
  const status = person.pepStatus;

  if (!isUbo || status === 'none') {
    return {
      outcome: 'CLEAR',
      priority: 'low',
      pepStatus: 'none',
      reason: 'No PEP exposure detected for beneficial owner.',
      details: `${person.name} has no current or historical Politically Exposed Person designations recorded.`
    };
  }

  if (status === 'foreign' || status === 'international_organisation') {
    return {
      outcome: 'REVIEW',
      priority: 'high',
      pepStatus: status,
      reason: `${status === 'foreign' ? 'Foreign PEP' : 'International Organisation PEP'} identified as a ${classification} beneficial owner.`,
      details: `${person.name} holds active or recent ${status === 'foreign' ? 'foreign government' : 'international organisation'} official status and holds significant ownership or control (${classification}). Enhanced due diligence (EDD) mandated.`
    };
  }

  if (status === 'domestic') {
    return {
      outcome: 'REVIEW',
      priority: 'standard',
      pepStatus: 'domestic',
      reason: `Domestic PEP identified as a ${classification} beneficial owner.`,
      details: `${person.name} holds domestic public function status. Standard risk-based PEP monitoring and source of wealth corroboration required.`
    };
  }

  return {
    outcome: 'CLEAR',
    priority: 'low',
    pepStatus: 'none',
    reason: 'Cleared PEP screening.',
    details: 'No adverse political exposure found.'
  };
}
