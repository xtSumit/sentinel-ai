import assert from 'node:assert/strict';
import { bodsRepository } from '../data/repository';
import { resolveBeneficialOwnership, passesThreshold } from './uboEngine';
import { CorporateGroupSeed } from '../types/bods';

interface TestResult {
  scenario: string;
  passed: boolean;
  assertions: string[];
}

const results: TestResult[] = [];

function runTest(scenario: string, fn: (log: (msg: string) => void) => void) {
  const assertions: string[] = [];
  const log = (msg: string) => assertions.push(msg);
  try {
    fn(log);
    results.push({ scenario, passed: true, assertions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assertions.push(`FAILED: ${message}`);
    results.push({ scenario, passed: false, assertions });
    throw err;
  }
}

// Scenario 1: Hidden PEP through layering
runTest('Scenario 1 — Hidden PEP through layering (Aurelia Maritime Logistics Ltd, 25% UK Threshold)', (log) => {
  const group = bodsRepository.getGroupById('grp-01-aurelia');
  assert.ok(group, 'Group 1 must exist');

  const res = resolveBeneficialOwnership(group, 25);

  const pep = res.persons.find((p) => p.person.id === 'per-g1-pep');
  const exec = res.persons.find((p) => p.person.id === 'per-g1-exec');
  const min = res.persons.find((p) => p.person.id === 'per-g1-min');

  assert.ok(pep && exec && min, 'All 3 persons must be resolved');

  // Path 1: 45% * 60% * 70% = 18.9%
  // Path 2: 35% * 40% * 70% = 9.8%
  // Sum = 28.7% -> DEFINITE (> 25%)
  assert.equal(pep.paths.length, 2, 'PEP must have 2 contributing indirect paths');
  assert.equal(Math.round(pep.totalMinPct * 10) / 10, 28.7);
  assert.equal(Math.round(pep.totalMaxPct * 10) / 10, 28.7);
  assert.equal(pep.classification, 'DEFINITE');
  log(`Dr. Kaelen Vance-Morozov (Foreign PEP): 2 paths (18.9% + 9.8% = 28.7%) → ${pep.classification}`);

  // Eleanor Thorne-Finch: 20.0% -> BELOW
  assert.equal(Math.round(exec.totalMinPct * 10) / 10, 20.0);
  assert.equal(exec.classification, 'BELOW');
  log(`Eleanor Thorne-Finch: 1 path (20.0%) → ${exec.classification}`);

  // Tariq Al-Mansoor: 45% * 40% = 18.0% -> BELOW
  assert.equal(Math.round(min.totalMinPct * 10) / 10, 18.0);
  assert.equal(min.classification, 'BELOW');
  log(`Tariq Al-Mansoor: 1 path (45% × 40% = 18.0%) → ${min.classification}`);

  // Unaccounted ownership & Completeness check (Solstice Crest 30% rem, Meridian Strait 60% rem)
  assert.equal(res.completenessScore, 67, 'Group 1 completeness must be ~67% due to unaccounted ownership');
  assert.equal(res.implicitGaps.length, 2, 'Group 1 must yield 2 implicit gaps (Solstice Crest and Meridian Strait)');
  assert.equal(res.totalUnaccountedEffectOnRoot, 33.3, 'Total unaccounted effect on root must be 33.3%');
  assert.equal(res.hiddenOwnershipWarning, true, 'Hidden-ownership warning must fire (33.3% > 25%)');
  assert.equal(
    res.hiddenOwnershipMessage,
    'Unidentified holders could together hold up to 33.3% of Aurelia Maritime Logistics Ltd, enough to conceal a UBO.'
  );
  assert.equal(res.riskAssessment.tier, 'HIGH', 'Group 1 risk tier must be HIGH');
  log(`✓ Group 1 Completeness: ${res.completenessScore}% (unaccounted effect on root: 33.3%)`);
  log(`✓ Hidden-Ownership Warning fired: "${res.hiddenOwnershipMessage}"`);
  log(`✓ Deterministic Risk: ${res.riskAssessment.tier} (${res.riskAssessment.reason})`);

  // Check Group 1 first monitoring event template uses Sovcomflot (OpenSanctions) and is NOT in baseline entities
  const baselineSanctions = group.entities.find((e) => e.id === 'ent-g1-sovcomflot');
  assert.equal(baselineSanctions, undefined, 'ent-g1-sovcomflot must NOT be in baseline entities');
  const firstTpl = group.monitoringEventTemplates[0];
  assert.equal(firstTpl.changeType, 'NEW_RELATIONSHIP');
  if (firstTpl.data.changeType === 'NEW_RELATIONSHIP') {
    assert.equal(firstTpl.data.newEntity?.id, 'ent-g1-sovcomflot');
    assert.equal(firstTpl.data.newEntity?.name, 'Sovcomflot');
    log(`✓ Verified Group 1 Template 1: NEW_RELATIONSHIP for Sovcomflot (OpenSanctions NK-VDEKGF5ZgHAkye4kGuUXs3) at 9%`);
  }
});

// Scenario 2: The banded-percentage problem + dissolved entity skipping
runTest('Scenario 2 — The banded-percentage problem (Cairnstone Precision Holdings Ltd, 25% UK Threshold)', (log) => {
  const group = bodsRepository.getGroupById('grp-02-cairn');
  assert.ok(group, 'Group 2 must exist');

  const res = resolveBeneficialOwnership(group, 25);

  const defPerson = res.persons.find((p) => p.person.id === 'per-g2-def');
  const posPerson = res.persons.find((p) => p.person.id === 'per-g2-pos');
  const belPerson = res.persons.find((p) => p.person.id === 'per-g2-bel');

  assert.ok(defPerson && posPerson && belPerson, 'All 3 banded persons must be resolved');

  // Morag Drummond-Fletcher: [52..60]% * [50..75]% = [26.0..45.0]% -> DEFINITE (> 25%)
  assert.equal(defPerson.person.name, 'Morag Drummond-Fletcher', 'Name must be Morag Drummond-Fletcher');
  assert.equal(defPerson.person.initials, 'MD', 'Initials must be MD');
  assert.equal(Math.round(defPerson.totalMinPct * 10) / 10, 26.0);
  assert.equal(Math.round(defPerson.totalMaxPct * 10) / 10, 45.0);
  assert.equal(defPerson.classification, 'DEFINITE');
  log(`Morag Drummond-Fletcher: 52–60% × 50–75% = 26.0–45.0% → ${defPerson.classification}`);

  // Henrik Lindqvist-Holm: [25..50]% * [60..75]% = [15.0..37.5]% -> POSSIBLE
  assert.equal(Math.round(posPerson.totalMinPct * 10) / 10, 15.0);
  assert.equal(Math.round(posPerson.totalMaxPct * 10) / 10, 37.5);
  assert.equal(posPerson.classification, 'POSSIBLE');
  log(`Henrik Lindqvist-Holm: 25–50% × 60–75% = 15.0–37.5% → ${posPerson.classification}`);

  // Clara Dumont-Moreau: [25..50]% * [25..30]% = [6.25..15.0]% -> BELOW
  assert.equal(Math.round(belPerson.totalMinPct * 100) / 100, 6.25);
  assert.equal(Math.round(belPerson.totalMaxPct * 10) / 10, 15.0);
  assert.equal(belPerson.classification, 'BELOW');
  log(`Clara Dumont-Moreau: 25–50% × 25–30% = 6.3–15.0% → ${belPerson.classification}`);

  // Dissolved entity skipped and reported
  assert.equal(res.skippedDissolved.length, 1, 'Dissolved entity must be skipped and reported');
  assert.equal(res.skippedDissolved[0].entity.id, 'ent-g2-dissolved');
  log(`Skipped & reported dissolved entity: ${res.skippedDissolved[0].entity.name}`);
});

// Scenario 3: Jurisdiction-sensitive threshold (10% India vs 25% International)
runTest('Scenario 3 — Jurisdiction-sensitive threshold (Deccan Grid Infrastructure Pvt Ltd at 10% and 25%)', (log) => {
  const group = bodsRepository.getGroupById('grp-03-deccan');
  assert.ok(group, 'Group 3 must exist');

  // At 10% (India PML Rules: strictly_greater, > 10%)
  const res10 = resolveBeneficialOwnership(group, 10);
  const major10 = res10.persons.find((p) => p.person.id === 'per-g3-major')!;
  const sbo10 = res10.persons.find((p) => p.person.id === 'per-g3-12pct')!;
  const minor10 = res10.persons.find((p) => p.person.id === 'per-g3-minor')!;

  assert.equal(major10.classification, 'DEFINITE');
  assert.equal(Math.round(sbo10.totalMinPct * 10) / 10, 12.6);
  assert.equal(sbo10.classification, 'DEFINITE', 'Ananya (12.6%) must be DEFINITE at 10%');
  assert.equal(Math.round(minor10.totalMinPct * 10) / 10, 8.6);
  assert.equal(minor10.classification, 'BELOW', 'Rohan (5.4% + 3.2% = 8.6%) must be BELOW at 10%');
  assert.equal(res10.uboCount, 2);
  log(`At 10% (India Rule): Vikramaditya (48.0% → DEFINITE), Ananya (12.6% → DEFINITE), Rohan (8.6% → BELOW)`);

  // At 25% (Standard Rule)
  const res25 = resolveBeneficialOwnership(group, 25);
  const major25 = res25.persons.find((p) => p.person.id === 'per-g3-major')!;
  const sbo25 = res25.persons.find((p) => p.person.id === 'per-g3-12pct')!;
  const minor25 = res25.persons.find((p) => p.person.id === 'per-g3-minor')!;

  assert.equal(major25.classification, 'DEFINITE');
  assert.equal(sbo25.classification, 'BELOW', 'Ananya (12.6%) must drop to BELOW at 25%');
  assert.equal(minor25.classification, 'BELOW');
  assert.equal(res25.uboCount, 1);
  log(`At 25% (Standard Rule): Vikramaditya (48.0% → DEFINITE), Ananya (12.6% → BELOW), Rohan (8.6% → BELOW)`);
});

// Scenario 4: Circular ownership
runTest('Scenario 4 — Circular ownership (Ouroboros Meridian Trade S.A., 25% EU Threshold)', (log) => {
  const group = bodsRepository.getGroupById('grp-04-ouroboros');
  assert.ok(group, 'Group 4 must exist');

  const res = resolveBeneficialOwnership(group, 25);

  assert.ok(res.cyclesFound.length >= 1, 'Cycle between Cygnus and Lyra must be detected and broken');
  log(`Cycles detected & broken: ${res.cyclesFound.length} (${res.cyclesFound[0].cycleDisplay})`);

  const ubo1 = res.persons.find((p) => p.person.id === 'per-g4-ubo1')!;
  const ubo2 = res.persons.find((p) => p.person.id === 'per-g4-ubo2')!;
  const min3 = res.persons.find((p) => p.person.id === 'per-g4-min')!;

  // Sébastien: 55% * 60% = 33.0% + 45% * 25% * 60% = 6.75% => 39.75% -> DEFINITE
  assert.equal(Math.round(ubo1.totalMinPct * 100) / 100, 39.75);
  assert.equal(ubo1.classification, 'DEFINITE');
  log(`Sébastien Voss-Delacroix: 2 simple paths (33.0% + 6.8% = 39.8%) → ${ubo1.classification}`);

  // Mei-Ling: 45% * 75% = 33.75% + 55% * 30% * 75% = 12.375% => 46.125% -> DEFINITE
  assert.equal(Math.round(ubo2.totalMinPct * 1000) / 1000, 46.125);
  assert.equal(ubo2.classification, 'DEFINITE');
  log(`Mei-Ling Tan-Kwan: 2 simple paths (33.8% + 12.4% = 46.1%) → ${ubo2.classification}`);

  // Lukas Van Der Berg: 55% * 10% = 5.5% + 45% * 25% * 10% = 1.125% => 6.625% -> BELOW
  assert.equal(Math.round(min3.totalMinPct * 1000) / 1000, 6.625);
  assert.equal(min3.classification, 'BELOW');
  log(`Lukas Van Der Berg: 2 simple paths (5.5% + 1.1% = 6.6%) → ${min3.classification}`);
});

// Scenario 5: Opacity and completeness deduction
runTest('Scenario 5 — Opacity & Data Gaps (Obsidian Wharf Properties Ltd, 25% UK Threshold)', (log) => {
  const group = bodsRepository.getGroupById('grp-05-obsidian');
  assert.ok(group, 'Group 5 must exist');

  const res = resolveBeneficialOwnership(group, 25);

  const known = res.persons.find((p) => p.person.id === 'per-g5-known')!;
  const minor = res.persons.find((p) => p.person.id === 'per-g5-minor')!;
  assert.equal(known.totalMinPct, 28);
  assert.equal(known.classification, 'DEFINITE');
  assert.equal(minor.totalMinPct, 10);
  assert.equal(minor.classification, 'BELOW');
  log(`Julian Sterling-Houghton: 1 path (28.0%) → ${known.classification}`);
  log(`Beatrice Aldridge-Vane: 1 path (10.0%) → ${minor.classification} (exact 10.0% threshold boundary test subject)`);

  assert.equal(res.gapsReached.length, 2, 'Both unspecified owners must be collected');
  // Completeness: 100 - (24 + 18) = 58%
  assert.equal(res.completenessScore, 58, 'Completeness must be 100 - 24 - 18 = 58%');
  log(`Gaps reached: ${res.gapsReached.length} (-24% nominee undisclosed, -18% trust beneficiary withheld)`);
  log(`Completeness score: ${res.completenessScore}%`);
});

// Scenario 6: Comparison Rule & Threshold Boundary Tests (strictly_greater vs greater_or_equal)
runTest('Scenario 6 — Threshold Boundary Tests: Exact Equality under strictly_greater vs greater_or_equal', (log) => {
  // 1. Verify jurisdiction rules from seed data
  const rules = bodsRepository.getJurisdictionRules();
  assert.equal(rules.length, 5, 'Must have 5 jurisdiction rules');
  for (const r of rules) {
    assert.equal(r.verified, false, `Rule for ${r.code} must have verified: false`);
  }
  log('Verified all 5 jurisdiction rules have verified: false');

  const ukRule = bodsRepository.getJurisdictionRule('UK')!;
  const euRule = bodsRepository.getJurisdictionRule('EU')!;
  const sgRule = bodsRepository.getJurisdictionRule('SG')!;
  const inRule = bodsRepository.getJurisdictionRule('IN')!;
  const usRule = bodsRepository.getJurisdictionRule('US')!;

  assert.equal(ukRule.comparison, 'strictly_greater');
  assert.equal(euRule.comparison, 'strictly_greater');
  assert.equal(sgRule.comparison, 'strictly_greater');
  assert.equal(inRule.comparison, 'strictly_greater');
  assert.equal(usRule.comparison, 'greater_or_equal');
  log('Verified comparison rules: UK, EU, SG, IN are strictly_greater (>); US is greater_or_equal (≥)');

  // 2. Pure threshold boundary comparison helper checks at exactly 25.0%
  assert.equal(
    passesThreshold(25.0, 25, 'strictly_greater'),
    false,
    '25.0% strictly greater than 25% must be false'
  );
  assert.equal(
    passesThreshold(25.0, 25, 'greater_or_equal'),
    true,
    '25.0% greater or equal to 25% must be true'
  );
  log('passesThreshold(25.0, 25, "strictly_greater") === false');
  log('passesThreshold(25.0, 25, "greater_or_equal") === true');

  // 3. Test exact 10.0% boundary
  assert.equal(
    passesThreshold(10.0, 10, 'strictly_greater'),
    false,
    '10.0% strictly greater than 10% must be false'
  );
  assert.equal(
    passesThreshold(10.0, 10, 'greater_or_equal'),
    true,
    '10.0% greater or equal to 10% must be true'
  );
  log('passesThreshold(10.0, 10, "strictly_greater") === false');
  log('passesThreshold(10.0, 10, "greater_or_equal") === true');

  // 4. Test on a complete CorporateGroupSeed with persons at exact threshold boundaries
  const testGroup: CorporateGroupSeed = {
    id: 'grp-test-threshold-boundary',
    name: 'Threshold Boundary Test Holdings Ltd',
    rootEntityId: 'ent-root-tb',
    rootJurisdiction: 'UK',
    rootFlag: '🇬🇧',
    description: 'Synthetic group testing exact threshold boundaries across jurisdictions.',
    scenarioSummary: 'Testing persons exactly at 25.0%, [20..25]%, and [25..30]%.',
    iconName: 'scale',
    accentColor: 'primary',
    riskTier: 'STANDARD',
    riskTone: 'emerald',
    traits: [],
    synthetic: true,
    entities: [
      {
        id: 'ent-root-tb',
        name: 'Boundary Test Root Corp',
        displayLines: ['Boundary Test Root Corp'],
        entityType: 'company',
        jurisdictionCode: 'UK',
        countryFlag: '🇬🇧',
        registrationId: 'TB-001',
        status: 'active',
        registeredAddress: '1 London Wall, London EC2Y 5EB, UK',
        source: 'UK Companies House',
        asOfDate: '2026-10-12',
      },
    ],
    persons: [
      {
        id: 'per-exact-25',
        name: 'Person Exact Twenty-Five',
        initials: 'ET',
        nationality: 'United Kingdom',
        flag: '🇬🇧',
        yearOfBirth: 1980,
        pepStatus: 'none',
        synthetic: true,
      },
      {
        id: 'per-range-upper-25',
        name: 'Person Banded Upper Twenty-Five',
        initials: 'BU',
        nationality: 'United Kingdom',
        flag: '🇬🇧',
        yearOfBirth: 1982,
        pepStatus: 'none',
        synthetic: true,
      },
      {
        id: 'per-range-lower-25',
        name: 'Person Banded Lower Twenty-Five',
        initials: 'BL',
        nationality: 'United Kingdom',
        flag: '🇬🇧',
        yearOfBirth: 1984,
        pepStatus: 'none',
        synthetic: true,
      },
    ],
    unspecifiedOwners: [],
    relationships: [
      {
        id: 'rel-tb-1',
        subjectId: 'ent-root-tb',
        interestedPartyId: 'per-exact-25',
        interestedPartyType: 'person',
        interests: [
          {
            type: 'shareholding',
            share: { kind: 'exact', value: 25.0 },
            directOrIndirect: 'direct',
            source: 'Share Register',
            asOfDate: '2026-10-12',
            confidence: 1.0,
          },
        ],
      },
      {
        id: 'rel-tb-2',
        subjectId: 'ent-root-tb',
        interestedPartyId: 'per-range-upper-25',
        interestedPartyType: 'person',
        interests: [
          {
            type: 'shareholding',
            share: { kind: 'range', min: 20.0, max: 25.0 },
            directOrIndirect: 'direct',
            source: 'Share Register',
            asOfDate: '2026-10-12',
            confidence: 1.0,
          },
        ],
      },
      {
        id: 'rel-tb-3',
        subjectId: 'ent-root-tb',
        interestedPartyId: 'per-range-lower-25',
        interestedPartyType: 'person',
        interests: [
          {
            type: 'shareholding',
            share: { kind: 'range', min: 25.0, max: 30.0 },
            directOrIndirect: 'direct',
            source: 'Share Register',
            asOfDate: '2026-10-12',
            confidence: 1.0,
          },
        ],
      },
    ],
    monitoringEventTemplates: [],
  };

  // Test under UK / EU / SG / IN rule ('strictly_greater' / > 25%)
  const resStrict = resolveBeneficialOwnership(testGroup, 25, 'strictly_greater');
  const pExactStrict = resStrict.persons.find((p) => p.person.id === 'per-exact-25')!;
  const pRangeUpperStrict = resStrict.persons.find((p) => p.person.id === 'per-range-upper-25')!;
  const pRangeLowerStrict = resStrict.persons.find((p) => p.person.id === 'per-range-lower-25')!;

  assert.equal(
    pExactStrict.classification,
    'BELOW',
    'Under strictly_greater (> 25%), exact 25.0% person MUST be classified as BELOW'
  );
  assert.equal(
    pRangeUpperStrict.classification,
    'BELOW',
    'Under strictly_greater (> 25%), [20..25]% person (max 25.0%) MUST be classified as BELOW'
  );
  assert.equal(
    pRangeLowerStrict.classification,
    'POSSIBLE',
    'Under strictly_greater (> 25%), [25..30]% person (min 25.0%, max 30.0%) MUST be classified as POSSIBLE'
  );
  log('Under strictly_greater (> 25%): Exact 25.0% → BELOW; [20..25]% → BELOW; [25..30]% → POSSIBLE');

  // Test under US rule ('greater_or_equal' / ≥ 25%)
  const resGe = resolveBeneficialOwnership(testGroup, 25, 'greater_or_equal');
  const pExactGe = resGe.persons.find((p) => p.person.id === 'per-exact-25')!;
  const pRangeUpperGe = resGe.persons.find((p) => p.person.id === 'per-range-upper-25')!;
  const pRangeLowerGe = resGe.persons.find((p) => p.person.id === 'per-range-lower-25')!;

  assert.equal(
    pExactGe.classification,
    'DEFINITE',
    'Under greater_or_equal (≥ 25%), exact 25.0% person MUST be classified as DEFINITE'
  );
  assert.equal(
    pRangeUpperGe.classification,
    'POSSIBLE',
    'Under greater_or_equal (≥ 25%), [20..25]% person (max 25.0%) MUST be classified as POSSIBLE'
  );
  assert.equal(
    pRangeLowerGe.classification,
    'DEFINITE',
    'Under greater_or_equal (≥ 25%), [25..30]% person (min 25.0%) MUST be classified as DEFINITE'
  );
  log('Under greater_or_equal (≥ 25%): Exact 25.0% → DEFINITE; [20..25]% → POSSIBLE; [25..30]% → DEFINITE');

  // 5. Test Beatrice Aldridge-Vane (from Group 5) who holds exact 10.0% when evaluated at 10% threshold:
  const g5 = bodsRepository.getGroupById('grp-05-obsidian')!;
  // UK / India / EU rule at 10%: > 10%
  const resG5Strict10 = resolveBeneficialOwnership(g5, 10, 'strictly_greater');
  const beatriceStrict = resG5Strict10.persons.find((p) => p.person.id === 'per-g5-minor')!;
  assert.equal(
    beatriceStrict.classification,
    'BELOW',
    'Beatrice (10.0%) under strictly_greater (> 10%) must be BELOW'
  );
  log('Beatrice Aldridge-Vane (10.0%) at threshold 10% under strictly_greater (>) → BELOW');

  // US rule at 10%: >= 10%
  const resG5Ge10 = resolveBeneficialOwnership(g5, 10, 'greater_or_equal');
  const beatriceGe = resG5Ge10.persons.find((p) => p.person.id === 'per-g5-minor')!;
  assert.equal(
    beatriceGe.classification,
    'DEFINITE',
    'Beatrice (10.0%) under greater_or_equal (≥ 10%) must be DEFINITE'
  );
  log('Beatrice Aldridge-Vane (10.0%) at threshold 10% under greater_or_equal (≥) → DEFINITE');
});

console.log('================================================================');
console.log('SENTINEL AI — DETERMINISTIC UBO RESOLUTION ENGINE TEST SUITE');
console.log('================================================================');
for (const r of results) {
  console.log(`\n[PASS] ${r.scenario}`);
  for (const line of r.assertions) {
    console.log(`  ✓ ${line}`);
  }
}
console.log('\n----------------------------------------------------------------');
console.log(`SUMMARY: ${results.length}/${results.length} test suites passed (0 failures).`);
console.log('================================================================');
