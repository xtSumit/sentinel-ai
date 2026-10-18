/**
 * Sentinel AI — Adverse Media Dossier Scoring Engine (Phase 4b)
 * Pure, deterministic mathematical scoring module:
 * Points per matter = severity × stage × sourceTier × recency
 * Score = min(100, round(5 × sum of matter points))
 * Bands: 0–19 LOW, 20–44 MEDIUM, 45–69 HIGH, 70–100 SEVERE
 */

import {
  AdverseMediaFinding,
  AdverseMediaSeverity,
  AdverseMediaLegalStage
} from './adverseMediaAgent';

export type AdverseMediaRiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE';

export interface ScoredMatter {
  matterLabel: string;
  findings: AdverseMediaFinding[];
  highestWeightedFinding: AdverseMediaFinding;
  isResolvedCleared: boolean;
  isCorroborated: boolean;
  distinctOutlets: string[];
  severityMultiplier: number;
  stageMultiplier: number;
  sourceTierMultiplier: number;
  recencyMultiplier: number;
  rawPoints: number;
}

export interface AdverseMediaDossierScoreResult {
  score: number; // 0..100
  band: AdverseMediaRiskBand;
  matters: ScoredMatter[];
  totalMatters: number;
  corroboratedMattersCount: number;
  singleSourceMattersCount: number;
  resolvedMattersCount: number;
  formulaDisplay: string;
}

export const SEVERITY_WEIGHTS: Record<AdverseMediaSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  severe: 4
};

export const STAGE_WEIGHTS: Record<AdverseMediaLegalStage, number> = {
  allegation: 1.0,
  investigation: 1.5,
  charge: 2.0,
  'regulatory finding': 2.5,
  conviction: 3.0,
  cleared: 0.0 // Handled explicitly: matter scores 0 if latest is cleared
};

export const SOURCE_TIER_WEIGHTS: Record<'regulator' | 'tier1' | 'established' | 'blog', number> = {
  regulator: 1.2,
  tier1: 1.0,
  established: 0.8,
  blog: 0.4
};

/**
 * Recency multiplier:
 * published within 3 years: 1.0
 * 3 to 7 years: 0.7
 * older (> 7 years): 0.4
 */
export function calculateRecencyMultiplier(publicationDate: string, asOfDate: Date = new Date()): number {
  const pubTime = new Date(publicationDate).getTime();
  const asOfTime = asOfDate.getTime();
  const diffYears = (asOfTime - pubTime) / (1000 * 60 * 60 * 24 * 365.25);

  if (diffYears <= 3) return 1.0;
  if (diffYears <= 7) return 0.7;
  return 0.4;
}

export function computeFindingWeight(finding: AdverseMediaFinding, asOfDate: Date = new Date()): number {
  if (finding.legalStage === 'cleared') return 0;
  const sev = SEVERITY_WEIGHTS[finding.severity] ?? 1;
  const stg = STAGE_WEIGHTS[finding.legalStage] ?? 1.0;
  const tier = SOURCE_TIER_WEIGHTS[finding.sourceTier] ?? 0.8;
  const rec = calculateRecencyMultiplier(finding.date, asOfDate);
  return sev * stg * tier * rec;
}

/**
 * Groups findings by matter, evaluates corroboration and cleared status,
 * takes highest weighted finding per matter, and calculates overall score.
 */
export function scoreAdverseMediaFindings(
  findings: AdverseMediaFinding[],
  asOfDate: Date = new Date()
): AdverseMediaDossierScoreResult {
  // Only matched identity findings count
  const matched = findings.filter((f) => f.isMatchingIdentity);

  if (matched.length === 0) {
    return {
      score: 0,
      band: 'LOW',
      matters: [],
      totalMatters: 0,
      corroboratedMattersCount: 0,
      singleSourceMattersCount: 0,
      resolvedMattersCount: 0,
      formulaDisplay: '0 points = Score 0 (LOW)'
    };
  }

  // Group by matter label
  const matterGroups = new Map<string, AdverseMediaFinding[]>();
  for (const f of matched) {
    const list = matterGroups.get(f.matterLabel) || [];
    list.push(f);
    matterGroups.set(f.matterLabel, list);
  }

  const scoredMatters: ScoredMatter[] = [];
  let totalMatterPoints = 0;

  for (const [matterLabel, groupFindings] of matterGroups.entries()) {
    // Sort chronological ascending
    const sorted = [...groupFindings].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Latest finding in matter
    const latestFinding = sorted[sorted.length - 1];
    const isResolvedCleared = latestFinding.legalStage === 'cleared';

    // Corroboration: at least two different outlets
    const distinctOutlets = Array.from(new Set(groupFindings.map((f) => f.outlet)));
    const isCorroborated = distinctOutlets.length >= 2;

    if (isResolvedCleared) {
      scoredMatters.push({
        matterLabel,
        findings: groupFindings,
        highestWeightedFinding: latestFinding,
        isResolvedCleared: true,
        isCorroborated,
        distinctOutlets,
        severityMultiplier: 0,
        stageMultiplier: 0,
        sourceTierMultiplier: 0,
        recencyMultiplier: 0,
        rawPoints: 0
      });
      continue;
    }

    // Find highest-weighted finding in this matter
    let highestFinding = groupFindings[0];
    let maxWeight = -1;

    for (const f of groupFindings) {
      const w = computeFindingWeight(f, asOfDate);
      if (w > maxWeight) {
        maxWeight = w;
        highestFinding = f;
      }
    }

    const sev = SEVERITY_WEIGHTS[highestFinding.severity] ?? 1;
    const stg = STAGE_WEIGHTS[highestFinding.legalStage] ?? 1.0;
    const tier = SOURCE_TIER_WEIGHTS[highestFinding.sourceTier] ?? 0.8;
    const rec = calculateRecencyMultiplier(highestFinding.date, asOfDate);
    const rawPoints = sev * stg * tier * rec;

    totalMatterPoints += rawPoints;

    scoredMatters.push({
      matterLabel,
      findings: groupFindings,
      highestWeightedFinding: highestFinding,
      isResolvedCleared: false,
      isCorroborated,
      distinctOutlets,
      severityMultiplier: sev,
      stageMultiplier: stg,
      sourceTierMultiplier: tier,
      recencyMultiplier: rec,
      rawPoints
    });
  }

  // Score = min(100, round(5 × sum of matter points))
  const score = Math.min(100, Math.round(5 * totalMatterPoints));

  // Bands: 0–19 LOW, 20–44 MEDIUM, 45–69 HIGH, 70–100 SEVERE
  let band: AdverseMediaRiskBand = 'LOW';
  if (score >= 70) {
    band = 'SEVERE';
  } else if (score >= 45) {
    band = 'HIGH';
  } else if (score >= 20) {
    band = 'MEDIUM';
  } else {
    band = 'LOW';
  }

  const corroboratedCount = scoredMatters.filter((m) => m.isCorroborated).length;
  const singleSourceCount = scoredMatters.length - corroboratedCount;
  const resolvedCount = scoredMatters.filter((m) => m.isResolvedCleared).length;

  return {
    score,
    band,
    matters: scoredMatters,
    totalMatters: scoredMatters.length,
    corroboratedMattersCount: corroboratedCount,
    singleSourceMattersCount: singleSourceCount,
    resolvedMattersCount: resolvedCount,
    formulaDisplay: `min(100, round(5 × ${totalMatterPoints.toFixed(2)} pts)) = ${score}`
  };
}
