import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreAdverseMediaFindings,
  computeFindingWeight,
  calculateRecencyMultiplier,
  SEVERITY_WEIGHTS,
  STAGE_WEIGHTS,
  SOURCE_TIER_WEIGHTS
} from './adverseMediaScoring';
import { AdverseMediaFinding } from './adverseMediaAgent';

describe('Part 2 — Adverse Media Dossier Scoring Engine', () => {
  const mockBaseFinding: AdverseMediaFinding = {
    articleId: 'art-001',
    title: 'Test Article',
    date: '2023-01-01',
    typology: 'fraud',
    legalStage: 'allegation',
    severity: 'medium',
    jurisdictions: ['UK'],
    isMatchingIdentity: true,
    identityEvidence: 'Match confirmed',
    outlet: 'Global Gazette',
    sourceTier: 'tier1',
    matterLabel: 'Matter A',
    quote: 'Test verbatim quote from article.'
  };

  test('1. Multiplier weights verification', () => {
    assert.equal(SEVERITY_WEIGHTS.low, 1);
    assert.equal(SEVERITY_WEIGHTS.medium, 2);
    assert.equal(SEVERITY_WEIGHTS.high, 3);
    assert.equal(SEVERITY_WEIGHTS.severe, 4);

    assert.equal(STAGE_WEIGHTS.allegation, 1.0);
    assert.equal(STAGE_WEIGHTS.investigation, 1.5);
    assert.equal(STAGE_WEIGHTS.charge, 2.0);
    assert.equal(STAGE_WEIGHTS['regulatory finding'], 2.5);
    assert.equal(STAGE_WEIGHTS.conviction, 3.0);

    assert.equal(SOURCE_TIER_WEIGHTS.regulator, 1.2);
    assert.equal(SOURCE_TIER_WEIGHTS.tier1, 1.0);
    assert.equal(SOURCE_TIER_WEIGHTS.established, 0.8);
    assert.equal(SOURCE_TIER_WEIGHTS.blog, 0.4);
  });

  test('2. Recency multipliers: <=3y 1.0, 3-7y 0.7, >7y 0.4', () => {
    const fixedNow = new Date('2024-01-01');
    assert.equal(calculateRecencyMultiplier('2023-01-01', fixedNow), 1.0); // 1 yr
    assert.equal(calculateRecencyMultiplier('2019-01-01', fixedNow), 0.7); // 5 yrs
    assert.equal(calculateRecencyMultiplier('2014-01-01', fixedNow), 0.4); // 10 yrs
  });

  test('3. Cleared rule: matter scores 0 if latest finding is cleared', () => {
    const findings: AdverseMediaFinding[] = [
      {
        ...mockBaseFinding,
        articleId: 'art-1',
        legalStage: 'charge',
        severity: 'severe',
        date: '2020-01-01'
      },
      {
        ...mockBaseFinding,
        articleId: 'art-2',
        legalStage: 'cleared',
        severity: 'low',
        date: '2022-01-01',
        outlet: 'Times Dispatch'
      }
    ];

    const res = scoreAdverseMediaFindings(findings, new Date('2024-01-01'));
    assert.equal(res.score, 0);
    assert.equal(res.band, 'LOW');
    assert.equal(res.resolvedMattersCount, 1);
    assert.equal(res.matters[0].isResolvedCleared, true);
    assert.equal(res.matters[0].rawPoints, 0);
  });

  test('4. Score calculation and risk bands', () => {
    const asOf = new Date('2024-01-01');

    // Case A: 1 Low Allegation, established, older -> 1 * 1 * 0.8 * 0.4 = 0.32 pts -> 5 * 0.32 = 1.6 -> 2 (LOW)
    const findingA: AdverseMediaFinding = {
      ...mockBaseFinding,
      severity: 'low',
      legalStage: 'allegation',
      sourceTier: 'established',
      date: '2015-01-01'
    };
    const resA = scoreAdverseMediaFindings([findingA], asOf);
    assert.equal(resA.band, 'LOW');
    assert.ok(resA.score < 20);

    // Case B: Severe conviction, regulator, recent -> 4 * 3.0 * 1.2 * 1.0 = 14.4 pts -> 5 * 14.4 = 72 -> 72 (SEVERE)
    const findingB: AdverseMediaFinding = {
      ...mockBaseFinding,
      severity: 'severe',
      legalStage: 'conviction',
      sourceTier: 'regulator',
      date: '2023-01-01'
    };
    const resB = scoreAdverseMediaFindings([findingB], asOf);
    assert.equal(resB.score, 72);
    assert.equal(resB.band, 'SEVERE');

    // Case C: Medium Investigation, tier1, recent -> 2 * 1.5 * 1.0 * 1.0 = 3.0 pts -> 5 * 3.0 = 15 (LOW)
    // plus another matter: High Charge, established, recent -> 3 * 2.0 * 0.8 * 1.0 = 4.8 pts -> total 7.8 pts -> 5 * 7.8 = 39 (MEDIUM)
    const findingC1: AdverseMediaFinding = {
      ...mockBaseFinding,
      matterLabel: 'Matter 1',
      severity: 'medium',
      legalStage: 'investigation',
      sourceTier: 'tier1',
      date: '2023-01-01'
    };
    const findingC2: AdverseMediaFinding = {
      ...mockBaseFinding,
      matterLabel: 'Matter 2',
      severity: 'high',
      legalStage: 'charge',
      sourceTier: 'established',
      date: '2023-01-01'
    };
    const resC = scoreAdverseMediaFindings([findingC1, findingC2], asOf);
    assert.equal(resC.score, 39);
    assert.equal(resC.band, 'MEDIUM');
  });

  test('5. Score cap at 100', () => {
    const asOf = new Date('2024-01-01');
    // Multiple severe convictions
    const findings: AdverseMediaFinding[] = [1, 2, 3, 4].map((i) => ({
      ...mockBaseFinding,
      articleId: `art-${i}`,
      matterLabel: `Matter ${i}`,
      severity: 'severe',
      legalStage: 'conviction',
      sourceTier: 'regulator',
      date: '2023-01-01'
    }));
    const res = scoreAdverseMediaFindings(findings, asOf);
    assert.equal(res.score, 100);
    assert.equal(res.band, 'SEVERE');
  });

  test('6. Corroboration evaluation across distinct outlets', () => {
    const findingsSingle: AdverseMediaFinding[] = [
      { ...mockBaseFinding, outlet: 'Outlet Alpha' },
      { ...mockBaseFinding, outlet: 'Outlet Alpha' }
    ];
    const resSingle = scoreAdverseMediaFindings(findingsSingle);
    assert.equal(resSingle.matters[0].isCorroborated, false);
    assert.equal(resSingle.singleSourceMattersCount, 1);

    const findingsCorroborated: AdverseMediaFinding[] = [
      { ...mockBaseFinding, outlet: 'Outlet Alpha' },
      { ...mockBaseFinding, outlet: 'Outlet Beta' }
    ];
    const resCorroborated = scoreAdverseMediaFindings(findingsCorroborated);
    assert.equal(resCorroborated.matters[0].isCorroborated, true);
    assert.equal(resCorroborated.corroboratedMattersCount, 1);
  });
});
