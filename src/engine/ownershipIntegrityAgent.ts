/**
 * Sentinel AI — Ownership Integrity Agent
 * Deterministic graph topological integrity checks:
 * - Detects circular holding cycles
 * - Flags dissolved entities on ownership paths
 * - Identifies unspecified/nominee disclosure opacity gaps
 * - Produces REVIEW with specific findings if issues present; otherwise CLEAR.
 */

import { UboResolutionResult } from './uboEngine';

export type IntegrityOutcome = 'REVIEW' | 'CLEAR';

export interface IntegrityFinding {
  type: 'CYCLE' | 'DISSOLVED_ENTITY' | 'OPACITY_GAP';
  severity: 'high' | 'medium';
  title: string;
  description: string;
}

export interface OwnershipIntegrityResult {
  outcome: IntegrityOutcome;
  findings: IntegrityFinding[];
  summary: string;
  details: string;
}

export function runOwnershipIntegrityScreening(
  resolution: UboResolutionResult
): OwnershipIntegrityResult {
  const findings: IntegrityFinding[] = [];

  // 1. Cycles
  if (resolution.cyclesFound && resolution.cyclesFound.length > 0) {
    resolution.cyclesFound.forEach((cycle) => {
      findings.push({
        type: 'CYCLE',
        severity: 'high',
        title: 'Circular Shareholding Loop Detected',
        description: `Path contains circular dependency: ${cycle.cycleDisplay || cycle.cycleNodeIds?.join(' ⇄ ')}. Cycles artificially inflate ownership and obscure controller identification.`
      });
    });
  }

  // 2. Dissolved entities on paths
  if (resolution.skippedDissolved && resolution.skippedDissolved.length > 0) {
    resolution.skippedDissolved.forEach((d) => {
      findings.push({
        type: 'DISSOLVED_ENTITY',
        severity: 'high',
        title: `Dissolved Corporate Entity on Path: ${d.entity.name}`,
        description: `Entity ${d.entity.name} (${d.entity.jurisdictionCode}) is recorded as officially dissolved on ${d.entity.asOfDate || 'prior register'}. Ownership traversal halted along dissolved branch.`
      });
    });
  }

  // 3. Unspecified owners and implicit opacity gaps
  const totalGaps = (resolution.gapsReached?.length || 0) + (resolution.implicitGaps?.length || 0);
  if (totalGaps > 0) {
    resolution.gapsReached?.forEach((reached) => {
      findings.push({
        type: 'OPACITY_GAP',
        severity: 'medium',
        title: `Disclosure Opacity Gap: ${reached.gap.label || reached.gap.reasonDisplay}`,
        description: `Statutory filing records undisclosed holder "${reached.gap.label}" with estimated completeness impact of ${reached.gap.estimatedImpactOnCompleteness}%. Path: ${reached.pathDisplay}.`
      });
    });

    resolution.implicitGaps?.forEach((gap) => {
      findings.push({
        type: 'OPACITY_GAP',
        severity: 'medium',
        title: `Unaccounted Ownership Residue: ${gap.label}`,
        description: `Entity ${gap.entityName} has ${gap.remainderPct}% unaccounted equity (${gap.description}). Possible undisclosed beneficial owner.`
      });
    });
  }

  if (findings.length > 0) {
    const hasHigh = findings.some((f) => f.severity === 'high');
    return {
      outcome: 'REVIEW',
      findings,
      summary: `${findings.length} structural integrity anomalies identified across holding traversal.`,
      details: findings.map((f) => `• [${f.type}] ${f.title}: ${f.description}`).join('\n')
    };
  }

  return {
    outcome: 'CLEAR',
    findings: [],
    summary: 'Ownership graph topology verified with zero structural anomalies.',
    details: 'All ownership paths resolve cleanly with no circular loops, dissolved intermediaries, or disclosure opacity gaps.'
  };
}
