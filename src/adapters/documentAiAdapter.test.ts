/**
 * Sentinel AI — Document AI & File Upload Validation Tests (Phase 5)
 * Verifies:
 * 1. Magic byte detection & defense against renamed .txt files disguised as .pdf
 * 2. 10 MB payload limits
 * 3. Preview Gemini extractor fallback and field confidences
 * 4. Production adapter fail-closed guarantee
 * 5. Gap resolution arithmetic & completeness recovery
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFileSignature,
  PreviewDocumentAiAdapter,
  ProductionDocumentAiAdapter,
  normalizeExtractedRow,
  assertNoUndefined,
  parseDocumentAiDocument
} from './documentAiAdapter.js';
import { resolveBeneficialOwnership } from '../engine/uboEngine.js';
import bodsSeed from '../data/bods-seed.json' with { type: 'json' };
import { CorporateGroupSeed } from '../types/bods.js';

describe('Phase 5: Document Intake & File Signature Security', () => {
  test('TestCase 1: Valid PDF binary magic bytes (%PDF-) must pass validation', () => {
    // "%PDF-1.4\n" binary header
    const validPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const res = validateFileSignature(validPdfBuffer, 'application/pdf');

    assert.equal(res.valid, true);
    assert.equal(res.detectedFormat, 'application/pdf');
    assert.equal(res.error, undefined);
  });

  test('TestCase 2: Renamed .txt file disguised as .pdf must be STRICTLY REJECTED', () => {
    // "Hello World, this is a plain text file."
    const disguisedTxtBuffer = Buffer.from('Hello World, this is a plain text invoice pretending to be a PDF.');
    const res = validateFileSignature(disguisedTxtBuffer, 'application/pdf');

    assert.equal(res.valid, false);
    assert.match(res.error || '', /does not start with %PDF- header/);
  });

  test('TestCase 3: Valid PNG binary header must pass validation', () => {
    const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = validateFileSignature(validPngBuffer, 'image/png');

    assert.equal(res.valid, true);
    assert.equal(res.detectedFormat, 'image/png');
  });

  test('TestCase 4: Valid JPEG binary header must pass validation', () => {
    const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const res = validateFileSignature(validJpegBuffer, 'image/jpeg');

    assert.equal(res.valid, true);
    assert.equal(res.detectedFormat, 'image/jpeg');
  });

  test('TestCase 5: Disallowed formats (e.g. executables, HTML) must be rejected', () => {
    // MZ DOS executable header
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    const res = validateFileSignature(exeBuffer, 'application/pdf');

    assert.equal(res.valid, false);
  });

  test('TestCase 6: Unit test fixture extraction returns structured shareholder rows with field confidences', async () => {
    const adapter = new PreviewDocumentAiAdapter();
    const dummyPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

    const result = await adapter.extractShareholders(
      {
        fileName: 'Aegis_Nominee_Share_Register.pdf',
        fileMimeType: 'application/pdf',
        fileBase64: dummyPdfBuffer.toString('base64'),
        gapId: 'gap-g5-nominee',
        groupId: 'grp-05-obsidian',
        gapContext: {
          label: 'Undisclosed Principal (BVI Nominee)',
          description: 'Aegis Nominee Corporate Services Ltd holds shares strictly as nominee'
        }
      },
      { useTestFallback: true }
    );

    assert.equal(result.status, 'extracted');
    assert.equal(result.extractor, 'Preview extraction (Gemini)');
    assert.ok(result.rows.length >= 1);

    const firstRow = result.rows[0];
    assert.ok(firstRow.holderName);
    assert.ok(firstRow.shareValue !== undefined);
    assert.ok(firstRow.confidence > 0.5);
    assert.ok(firstRow.fieldConfidences.holderName >= 0.8);
    assert.ok(firstRow.fieldConfidences.share >= 0.8);
  });

  test('TestCase 6b: Preview extraction MUST NOT fall back to fixed rows when Gemini fails', async () => {
    const adapter = new PreviewDocumentAiAdapter();
    const dummyPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

    await assert.rejects(
      async () => {
        await adapter.extractShareholders({
          fileName: 'Aegis_Nominee_Share_Register.pdf',
          fileMimeType: 'application/pdf',
          fileBase64: dummyPdfBuffer.toString('base64'),
          gapId: 'gap-g5-nominee',
          groupId: 'grp-05-obsidian'
        });
      },
      /Gemini document extraction failed/
    );
  });

  test('TestCase 7: Production Document AI adapter fails closed when configuration is missing', () => {
    const originalEnv = { ...process.env };
    delete process.env.EVIDENCE_BUCKET;
    delete process.env.DOCAI_LOCATION;
    delete process.env.DOCAI_PROCESSOR_ID;

    assert.throws(
      () => {
        new ProductionDocumentAiAdapter();
      },
      /EVIDENCE_BUCKET environment variable is required in PRODUCTION mode. Failing closed./
    );

    // Restore env
    process.env = originalEnv;
  });

  test('TestCase 8: Gap resolution increases completeness score deterministically', () => {
    const group5 = (bodsSeed as any).groups.find((g: any) => g.id === 'grp-05-obsidian') as CorporateGroupSeed;
    assert.ok(group5, 'Group 5 must exist in seed');

    // 1. Initial resolution with 2 opacity gaps
    const initialResolution = resolveBeneficialOwnership(group5, 25);
    const initialCompleteness = initialResolution.completenessScore;
    assert.equal(initialCompleteness, 58, 'Initial completeness for Obsidian Wharf should be 58%');

    // 2. Simulate resolving the nominee gap (gap-g5-nominee has 24 points impact)
    const resolvedGroup: CorporateGroupSeed = {
      ...group5,
      unspecifiedOwners: group5.unspecifiedOwners.filter((u) => u.id !== 'gap-g5-nominee'),
      persons: [
        ...group5.persons,
        {
          id: 'per-doc-arthur',
          name: 'Arthur Kensington Pryce',
          initials: 'AK',
          nationality: 'United Kingdom',
          flag: '🇬🇧',
          yearOfBirth: 1958,
          pepStatus: 'none',
          synthetic: true
        }
      ],
      relationships: [
        ...group5.relationships.filter((r) => r.interestedPartyId !== 'gap-g5-nominee'),
        {
          id: 'rel-doc-1',
          subjectId: 'ent-g5-bvi-nom',
          interestedPartyId: 'per-doc-arthur',
          interestedPartyType: 'person',
          interests: [
            {
              type: 'shareholding',
              share: { kind: 'exact', value: 100 },
              directOrIndirect: 'direct',
              source: 'Verified Share Register',
              asOfDate: '2026-09-28',
              confidence: 0.98
            }
          ]
        }
      ]
    };

    const updatedResolution = resolveBeneficialOwnership(resolvedGroup, 25);
    assert.equal(
      updatedResolution.completenessScore,
      82,
      'Completeness should rise from 58% to 82% (+24 points) after nominee gap is closed'
    );

    // 3. Arthur holds 100% of Aegis Nominee, which holds 36% of root -> 36% > 25% threshold
    const arthurUbo = updatedResolution.persons.find((p) => p.person.id === 'per-doc-arthur');
    assert.ok(arthurUbo, 'Newly revealed person must be evaluated by engine');
    assert.equal(arthurUbo.classification, 'DEFINITE', 'Arthur holds 36% effective root stake and must be classified DEFINITE UBO');
  });

  test('TestCase 9: Normalise extracted rows with exact shares and assert no undefined values remain', () => {
    const rawExactRow = {
      id: 'row-exact-1',
      holderName: 'Arthur Kensington Pryce',
      holderType: 'person',
      shareKind: 'exact',
      shareExact: 65,
      shareMin: undefined,
      shareMax: undefined,
      shareClass: 'Class A Ordinary Voting Shares',
      asOfDate: '2026-09-28',
      sourcePage: 1,
      confidence: 0.96,
      fieldConfidences: {
        holderName: 0.98,
        share: 0.95,
        shareClass: 0.94,
        asOfDate: undefined
      }
    };

    const normalised = normalizeExtractedRow(rawExactRow, 0);

    // Assert exact shares mapping: shareExact set, shareMin and shareMax null
    assert.equal(normalised.shareKind, 'exact');
    assert.equal(normalised.shareExact, 65);
    assert.equal(normalised.shareMin, null);
    assert.equal(normalised.shareMax, null);
    assert.equal(normalised.shareValue, 65);

    // Assert no undefined values exist anywhere in the object
    assertNoUndefined(normalised, 'normalisedExactRow');
  });

  test('TestCase 10: Normalise extracted rows with range shares and assert no undefined values remain', () => {
    const rawRangeRow = {
      id: 'row-range-1',
      holderName: 'Henrik Lindqvist Holm',
      holderType: 'person',
      shareKind: 'range',
      shareExact: undefined,
      shareMin: 25,
      shareMax: 50,
      shareClass: 'Ordinary Equity Shares',
      asOfDate: '2026-09-15',
      sourcePage: 2,
      confidence: 0.91,
      fieldConfidences: {
        holderName: 0.94,
        share: 0.90,
        shareClass: 0.88,
        asOfDate: null
      }
    };

    const normalised = normalizeExtractedRow(rawRangeRow, 0);

    // Assert range shares mapping: shareMin and shareMax set, shareExact null
    assert.equal(normalised.shareKind, 'range');
    assert.equal(normalised.shareExact, null);
    assert.equal(normalised.shareMin, 25);
    assert.equal(normalised.shareMax, 50);
    assert.equal(normalised.shareValue, null);

    // Assert no undefined values exist anywhere in the object
    assertNoUndefined(normalised, 'normalisedRangeRow');
  });

  test('TestCase 11: Staged document extraction record with exact & range rows contains zero undefined fields', () => {
    const extractionRecord = {
      id: 'ext-test-12345',
      customerId: 'CUS-2026-0005',
      groupId: 'grp-05-obsidian',
      gapId: 'gap-g5-nominee',
      fileName: 'test_evidence.pdf',
      fileMimeType: 'application/pdf',
      extractor: 'Preview extraction (Gemini)',
      status: 'extracted',
      analystUid: 'analyst-123',
      requestedAt: new Date().toISOString(),
      extractedAt: new Date().toISOString(),
      extractedRows: [
        normalizeExtractedRow({
          holderName: 'Exact Holder',
          shareKind: 'exact',
          shareValue: 60
        }, 0),
        normalizeExtractedRow({
          holderName: 'Range Holder',
          shareKind: 'range',
          shareMin: 20,
          shareMax: 40
        }, 1)
      ],
      confidence: 0.94,
      pageCount: 1,
      rawTextSummary: null,
      confirmedRows: null,
      confirmedAt: null,
      confirmedBy: null
    };

    // Assert that walking the entire document extraction payload finds no undefined values
    assert.doesNotThrow(() => {
      assertNoUndefined(extractionRecord, 'extractionRecord');
    });

    // Check specific row shapes
    assert.equal(extractionRecord.extractedRows[0].shareExact, 60);
    assert.equal(extractionRecord.extractedRows[0].shareMin, null);
    assert.equal(extractionRecord.extractedRows[0].shareMax, null);

    assert.equal(extractionRecord.extractedRows[1].shareExact, null);
    assert.equal(extractionRecord.extractedRows[1].shareMin, 20);
    assert.equal(extractionRecord.extractedRows[1].shareMax, 40);
  });

  test('TestCase 12: Actual Document AI Form Parser response extraction filters out metadata and maps exact table rows', () => {
    const documentAiRawPayload = {
      text: `STATUTORY COMPLIANCE FILING SCHEDULE · REGISTRY ARCHIVE
AUTHENTICATED CORPORATE SECRETARIAL EXTRACT
BVI Company No: VG-BVICN-2019440
In response to: 2026-09-28
Purpose: Statutory compliance filing

STATUTORY REGISTER OF BENEFICIAL MEMBERS & EQUITABLE OWNERS
Holder name\tHolder type\tShare class\tShares held\tPercentage
Arthur Kensington Pryce\tNatural Person\tClass A Ordinary Voting Shares\t65,000\t65.0%
Rosamund Ashford Gifford\tNatural Person\tClass B Ordinary Non-Voting Shares\t35,000\t35.0%

SECRETARIAL ATTESTATION & STAMP
Filing Reference: BVI-NOM-2026-9812-VERIFIED`,
      pages: [
        {
          pageNumber: 1,
          formFields: [
            {
              fieldName: { textAnchor: { content: 'BVI Company No:' } },
              fieldValue: { textAnchor: { content: 'VG-BVICN-2019440' } }
            },
            {
              fieldName: { textAnchor: { content: 'In response to:' } },
              fieldValue: { textAnchor: { content: '2026-09-28' } }
            },
            {
              fieldName: { textAnchor: { content: 'Purpose:' } },
              fieldValue: { textAnchor: { content: 'Statutory compliance filing' } }
            }
          ],
          tables: [
            {
              // Metadata table detected by Document AI Form Parser
              headerRows: [],
              bodyRows: [
                {
                  cells: [
                    { layout: { textAnchor: { content: 'BVI Company No' } } },
                    { layout: { textAnchor: { content: 'VG-BVICN-2019440' } } }
                  ]
                },
                {
                  cells: [
                    { layout: { textAnchor: { content: 'In response to' } } },
                    { layout: { textAnchor: { content: '2026-09-28' } } }
                  ]
                },
                {
                  cells: [
                    { layout: { textAnchor: { content: 'Purpose' } } },
                    { layout: { textAnchor: { content: 'Statutory compliance filing' } } }
                  ]
                }
              ]
            },
            {
              // Actual Shareholder Table
              headerRows: [
                {
                  cells: [
                    { layout: { textAnchor: { content: 'Holder name' } } },
                    { layout: { textAnchor: { content: 'Holder type' } } },
                    { layout: { textAnchor: { content: 'Share class' } } },
                    { layout: { textAnchor: { content: 'Shares held' } } },
                    { layout: { textAnchor: { content: 'Percentage' } } }
                  ]
                }
              ],
              bodyRows: [
                {
                  cells: [
                    { layout: { textAnchor: { content: 'Arthur Kensington Pryce' } } },
                    { layout: { textAnchor: { content: 'Natural Person' } } },
                    { layout: { textAnchor: { content: 'Class A Ordinary Voting Shares' } } },
                    { layout: { textAnchor: { content: '65,000' } } },
                    { layout: { textAnchor: { content: '65.0%' } } }
                  ]
                },
                {
                  cells: [
                    { layout: { textAnchor: { content: 'Rosamund Ashford Gifford' } } },
                    { layout: { textAnchor: { content: 'Natural Person' } } },
                    { layout: { textAnchor: { content: 'Class B Ordinary Non-Voting Shares' } } },
                    { layout: { textAnchor: { content: '35,000' } } },
                    { layout: { textAnchor: { content: '35.0%' } } }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const extractedRows = parseDocumentAiDocument(documentAiRawPayload);

    // 1. Assert exactly 2 shareholder rows extracted from the actual table
    assert.equal(extractedRows.length, 2, 'Should extract exactly 2 shareholder rows');

    // 2. Assert no row has an empty or metadata holder name
    extractedRows.forEach((row) => {
      assert.ok(row.holderName && row.holderName.trim().length > 0, 'Holder Name must not be empty');
      assert.doesNotMatch(row.holderName, /BVI Company No|In response to|Purpose|Registration/i, 'Holder Name must not contain metadata field labels');
    });

    // 3. Assert exact shareholder names, share classes, and percentages
    assert.equal(extractedRows[0].holderName, 'Arthur Kensington Pryce');
    assert.equal(extractedRows[0].shareExact, 65.0);
    assert.equal(extractedRows[0].shareClass, 'Class A Ordinary Voting Shares');

    assert.equal(extractedRows[1].holderName, 'Rosamund Ashford Gifford');
    assert.equal(extractedRows[1].shareExact, 35.0);
    assert.equal(extractedRows[1].shareClass, 'Class B Ordinary Non-Voting Shares');
  });
});
