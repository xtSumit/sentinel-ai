import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseEntityName } from './sanctionsNormalizer';
import { normalisePersonName, evaluateIdentityMatch, runAdverseMediaScreening } from './adverseMediaAgent';
import { runSanctionsScreening, calculateTokenSimilarity } from './sanctionsAgent';
import { runPepScreening } from './pepAgent';
import { runOwnershipIntegrityScreening } from './ownershipIntegrityAgent';
import { resolveBeneficialOwnership } from './uboEngine';
import adverseMediaCorpus from '../data/adverseMediaCorpus.json';
import groundTruth from '../data/adverseMediaGroundTruth.json';
import bodsSeed from '../data/bods-seed.json';

describe('Part 1 — Screening Agents & Deterministic Rules', () => {
  describe('1. Name Normalisation', () => {
    test('normalises entity names stripping legal suffixes and punctuation', () => {
      assert.equal(normaliseEntityName('Sovcomflot PJSC'), 'sovcomflot');
      assert.equal(normaliseEntityName('Cairnstone Precision Holdings Ltd.'), 'cairnstone precision holdings');
      assert.equal(normaliseEntityName('Aurelia Maritime Logistics Ltd'), 'aurelia maritime logistics');
      assert.equal(normaliseEntityName('Cygnus Trade Holdings Pte. Ltd.'), 'cygnus trade holdings');
    });

    test('normalises person names stripping honorifics', () => {
      assert.equal(normalisePersonName('Dr. Kaelen Vance Morozov'), 'kaelen vance morozov');
      assert.equal(normalisePersonName('Sir Alistair Drummond'), 'alistair drummond');
      assert.equal(normalisePersonName('Dame Patricia Vance'), 'patricia vance');
      assert.equal(normalisePersonName('Morag Drummond Fletcher'), 'morag drummond fletcher');
    });
  });

  describe('2. Disambiguation & Exclusion of Different Individuals', () => {
    test('excludes art-disambig-01 for Kaelen Vance Morozov using ground truth', () => {
      const g1 = bodsSeed.groups.find((g) => g.id === 'grp-01-aurelia')!;
      const pep = g1.persons.find((p) => p.id === 'per-g1-pep')!;

      const disambigArticle = adverseMediaCorpus.find((a) => a.id === 'art-disambig-01')!;
      assert.ok(disambigArticle, 'art-disambig-01 must exist in corpus');

      // Verify ground truth classifies art-disambig-01 as EXCLUDED_DISAMBIGUATION
      const truthTarget = (groundTruth.mappings as any)['art-disambig-01'];
      assert.equal(truthTarget, 'EXCLUDED_DISAMBIGUATION');

      // Run identity match
      const match = evaluateIdentityMatch(disambigArticle as any, pep as any);
      assert.equal(match.isMatch, false);
      assert.match(match.evidence, /Different individual/);
    });
  });

  describe('3. Sanctions Screening Agent', () => {
    test('detects exact match for Sovcomflot as HIT', async () => {
      const res = await runSanctionsScreening('Sovcomflot', 'Russia');
      assert.equal(res.outcome, 'HIT');
      assert.equal(res.score, 100);
      assert.equal(res.openSanctionsId, 'NK-VDEKGF5ZgHAkye4kGuUXs3');
      assert.match(res.attribution, /OpenSanctions/);
    });

    test('detects alias match for PAO Sovcomflot as HIT', async () => {
      const res = await runSanctionsScreening('PAO Sovcomflot', 'Russia');
      assert.equal(res.outcome, 'HIT');
      assert.equal(res.score, 100);
    });

    test('calculates token similarity and clears non-matching names', async () => {
      const res = await runSanctionsScreening('Cairnstone Precision Holdings Ltd', 'UK');
      assert.equal(res.outcome, 'CLEAR');
      assert.equal(res.score, 0);
    });
  });

  describe('4. PEP Screening Agent', () => {
    test('marks foreign PEP at DEFINITE as REVIEW with high priority', () => {
      const person = {
        id: 'p1',
        name: 'Kaelen Vance Morozov',
        initials: 'KV',
        nationality: 'Foreign Jurisdiction',
        flag: '🇨🇾',
        pepStatus: 'foreign' as const,
        yearOfBirth: 1968,
        synthetic: true as const
      };
      const res = runPepScreening(person, 'DEFINITE');
      assert.equal(res.outcome, 'REVIEW');
      assert.equal(res.priority, 'high');
    });

    test('marks domestic PEP as REVIEW with standard priority', () => {
      const person = {
        id: 'p2',
        name: 'Domestic Councillor',
        initials: 'DC',
        nationality: 'UK',
        flag: '🇬🇧',
        pepStatus: 'domestic' as const,
        yearOfBirth: 1975,
        synthetic: true as const
      };
      const res = runPepScreening(person, 'POSSIBLE');
      assert.equal(res.outcome, 'REVIEW');
      assert.equal(res.priority, 'standard');
    });

    test('clears non-PEP individuals', () => {
      const person = {
        id: 'p3',
        name: 'Regular Individual',
        initials: 'RI',
        nationality: 'UK',
        flag: '🇬🇧',
        pepStatus: 'none' as const,
        yearOfBirth: 1980,
        synthetic: true as const
      };
      const res = runPepScreening(person, 'DEFINITE');
      assert.equal(res.outcome, 'CLEAR');
    });
  });

  describe('5. Ownership Integrity Agent', () => {
    test('flags circular ownership loop in Group 4 (Ouroboros)', () => {
      const g4 = bodsSeed.groups.find((g) => g.id === 'grp-04-ouroboros')!;
      const resolution = resolveBeneficialOwnership(g4 as any, 25);
      const res = runOwnershipIntegrityScreening(resolution);
      assert.equal(res.outcome, 'REVIEW');
      assert.ok(res.findings.some((f) => f.type === 'CYCLE'));
    });

    test('flags dissolved entity in Group 2 (Cairnstone)', () => {
      const g2 = bodsSeed.groups.find((g) => g.id === 'grp-02-cairn')!;
      const resolution = resolveBeneficialOwnership(g2 as any, 25);
      const res = runOwnershipIntegrityScreening(resolution);
      assert.equal(res.outcome, 'REVIEW');
      assert.ok(res.findings.some((f) => f.type === 'DISSOLVED_ENTITY'));
    });

    test('flags opacity gaps in Group 5 (Obsidian Wharf)', () => {
      const g5 = bodsSeed.groups.find((g) => g.id === 'grp-05-obsidian')!;
      const resolution = resolveBeneficialOwnership(g5 as any, 25);
      const res = runOwnershipIntegrityScreening(resolution);
      assert.equal(res.outcome, 'REVIEW');
      assert.ok(res.findings.some((f) => f.type === 'OPACITY_GAP'));
    });
  });

  describe('6. Adverse Media Agent Full Run', () => {
    test('extracts findings and derives outcome for Kaelen Vance Morozov', async () => {
      const g1 = bodsSeed.groups.find((g) => g.id === 'grp-01-aurelia')!;
      const pep = g1.persons.find((p) => p.id === 'per-g1-pep')!;
      const res = await runAdverseMediaScreening(pep as any);

      assert.ok(res.totalRetrievedArticles >= 8, 'Expected at least 8 articles retrieved');
      assert.ok(res.matchedFindings.length >= 7, 'Expected matched findings for target');
      assert.ok(res.excludedFindings.length >= 1, 'Expected at least 1 disambiguation exclusion');

      // Check legal stages represented
      const stages = new Set(res.matchedFindings.map((f) => f.legalStage));
      assert.ok(stages.has('allegation'));
      assert.ok(stages.has('cleared'));
      assert.ok(stages.has('regulatory finding'));

      // Check source of wealth statement extracted
      const sowFindings = res.matchedFindings.filter((f) => Boolean(f.sourceOfWealthStatement));
      assert.ok(sowFindings.length >= 2, 'Expected at least 2 source of wealth statements');
    });

    test('extracts findings for Morag Drummond Fletcher covering SFO and export controls', async () => {
      const g2 = bodsSeed.groups.find((g) => g.id === 'grp-02-cairn')!;
      const def = g2.persons.find((p) => p.id === 'per-g2-def')!;
      const res = await runAdverseMediaScreening(def as any);

      assert.ok(res.totalRetrievedArticles >= 8);
      assert.ok(res.matchedFindings.length >= 7);
      const stages = new Set(res.matchedFindings.map((f) => f.legalStage));
      assert.ok(stages.has('regulatory finding') || stages.has('charge') || stages.has('cleared'));
    });
  });
});
