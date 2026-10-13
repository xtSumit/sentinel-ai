import assert from 'node:assert/strict';
import { bodsRepository } from '../data/repository';
import { evaluateMateriality } from './materialityEngine';
import { PreviewSanctionsAdapter } from '../adapters/sanctionsAdapter';

async function runTestSuite() {
  console.log('================================================================');
  console.log('SENTINEL AI — DETERMINISTIC MATERIALITY ENGINE TEST SUITE');
  console.log('================================================================');

  const adapter = new PreviewSanctionsAdapter();

  // Test 1: CRITICAL verdict — Sanctioned entity Sovcomflot in Group 1 Template 1
  {
    const group1 = bodsRepository.getGroupById('grp-01-aurelia');
    assert.ok(group1, 'Group 1 must exist');
    const tpl1 = group1.monitoringEventTemplates[0];
    assert.equal(tpl1.changeType, 'NEW_RELATIONSHIP');

    const result = await evaluateMateriality({
      baselineGroup: group1,
      eventData: tpl1.data as any,
      sourceConfidence: tpl1.confidence,
      sanctionsAdapter: adapter
    });

    console.log(`[PASS] Case 1 — Sovcomflot Sanctions Hit:`);
    console.log(`  Verdict: ${result.verdict} (Expected: CRITICAL)`);
    console.log(`  Confidence: ${result.confidence}%`);
    console.log(`  Citation: ${result.citation.regulationName} (${result.citation.statutoryBasis})`);
    console.log(`  Factor: ${result.factors[0]?.description}`);

    assert.equal(result.verdict, 'CRITICAL', 'Sovcomflot introduction must trigger CRITICAL verdict');
    assert.ok(result.factors.some((f) => f.rule === 'SANCTIONS_DESIGNATION'));
  }

  // Test 2: MATERIAL verdict — PEP Dr. Kaelen Vance-Morozov stake rise in Group 1 Template 2
  {
    const group1 = bodsRepository.getGroupById('grp-01-aurelia');
    assert.ok(group1, 'Group 1 must exist');
    const tpl2 = group1.monitoringEventTemplates[1];
    assert.equal(tpl2.changeType, 'SHARE_CHANGE');

    const result = await evaluateMateriality({
      baselineGroup: group1,
      eventData: tpl2.data as any,
      sourceConfidence: tpl2.confidence,
      sanctionsAdapter: adapter
    });

    console.log(`[PASS] Case 2 — PEP Stake Shift >= 5 pp:`);
    console.log(`  Verdict: ${result.verdict} (Expected: MATERIAL)`);
    console.log(`  Confidence: ${result.confidence}%`);
    console.log(`  Old: ${result.oldValueText} → New: ${result.newValueText}`);
    console.log(`  Factors: ${result.factors.map(f => f.rule).join(', ')}`);

    assert.equal(result.verdict, 'MATERIAL', 'PEP stake increase >= 5 pp must be MATERIAL');
    assert.ok(result.factors.some((f) => f.rule === 'PEP_STAKE_SHIFT'));
  }

  // Test 3: MATERIAL verdict — Classification change (Henrik Lindqvist-Holm POSSIBLE -> DEFINITE in Group 2)
  {
    const group2 = bodsRepository.getGroupById('grp-02-cairn');
    assert.ok(group2, 'Group 2 must exist');
    const tpl = group2.monitoringEventTemplates[0];

    const result = await evaluateMateriality({
      baselineGroup: group2,
      eventData: tpl.data as any,
      sourceConfidence: tpl.confidence,
      sanctionsAdapter: adapter
    });

    console.log(`[PASS] Case 3 — Classification Change (POSSIBLE -> DEFINITE):`);
    console.log(`  Verdict: ${result.verdict} (Expected: MATERIAL)`);
    console.log(`  Affected Persons: ${result.affectedPersonIds.join(', ')}`);

    assert.equal(result.verdict, 'MATERIAL', 'Classification shift must trigger MATERIAL verdict');
    assert.ok(result.factors.some((f) => f.rule === 'CLASSIFICATION_CHANGED'));
  }

  // Test 4: MONITOR verdict — Minor shift that does not alter classification or trigger rules
  {
    const group5 = bodsRepository.getGroupById('grp-05-obsidian');
    assert.ok(group5, 'Group 5 must exist');
    const tpl = group5.monitoringEventTemplates[1]; // Beatrice Aldridge-Vane 10.0% -> 9.5%

    const result = await evaluateMateriality({
      baselineGroup: group5,
      eventData: tpl.data as any,
      sourceConfidence: tpl.confidence,
      sanctionsAdapter: adapter
    });

    console.log(`[PASS] Case 4 — Minor Shift Below Threshold:`);
    console.log(`  Verdict: ${result.verdict} (Expected: MONITOR)`);
    console.log(`  Old: ${result.oldValueText} → New: ${result.newValueText}`);

    assert.equal(result.verdict, 'MONITOR', 'Minor stakeholder shift remaining below threshold must be MONITOR');
  }

  console.log('----------------------------------------------------------------');
  console.log('SUMMARY: 4/4 materiality test cases passed successfully.');
  console.log('================================================================');
}

runTestSuite().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
