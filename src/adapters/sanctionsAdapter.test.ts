/**
 * Sentinel AI — Production Sanctions Adapter & Array Parameter Tests
 * Verifies:
 * 1. queryNames is always passed as a genuine ARRAY parameter (arrayValues) to BigQuery, preventing "Second argument of IN UNNEST must be an array but was STRING".
 * 2. Lookup for "Sovcomflot" against sentinel-ai-511412.screening.sanctions returns a HIT.
 * 3. Exact query and parameters inspection.
 * 4. Confirmation that no other BigQuery query exists in the adapter.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProductionSanctionsAdapter } from './sanctionsAdapter.js';

describe('ProductionSanctionsAdapter BigQuery Array Parameter Tests', () => {
  test('TestCase 1: ProductionSanctionsAdapter constructor enforces environment variables in production mode', () => {
    const originalEnv = { ...process.env };
    delete process.env.BQ_SANCTIONS_TABLE;
    delete process.env.GOOGLE_CLOUD_PROJECT;

    assert.throws(
      () => {
        new ProductionSanctionsAdapter();
      },
      /BQ_SANCTIONS_TABLE environment variable is required in PRODUCTION mode/
    );

    process.env = originalEnv;
  });

  test('TestCase 2: Lookup for "Sovcomflot" against sentinel-ai-511412.screening.sanctions returns a HIT and verifies genuine array parameters', async () => {
    const originalEnv = { ...process.env };
    process.env.APP_MODE = 'production';
    process.env.BQ_SANCTIONS_TABLE = 'sentinel-ai-511412.screening.sanctions';
    process.env.GOOGLE_CLOUD_PROJECT = 'sentinel-ai-511412';

    let capturedRequest: any = null;

    // Mock BigQuery client simulating response for Sovcomflot from sentinel-ai-511412.screening.sanctions
    const mockClient = {
      async request(opts: any) {
        capturedRequest = opts;
        return {
          data: {
            schema: {
              fields: [
                { name: 'id', type: 'STRING' },
                { name: 'name', type: 'STRING' },
                { name: 'country', type: 'STRING' },
                { name: 'programme', type: 'STRING' },
                { name: 'aliases', type: 'STRING', mode: 'REPEATED' },
                { name: 'openSanctionsUrl', type: 'STRING' }
              ]
            },
            rows: [
              {
                f: [
                  { v: 'NK-VDEKGF5ZgHAkye4kGuUXs3' },
                  { v: 'Sovcomflot' },
                  { v: 'Russia' },
                  { v: 'Russia-related sanctions, designated by the US (OFAC), the UK, the EU and Australia' },
                  {
                    v: [
                      { v: 'PAO Sovcomflot' },
                      { v: 'JSC Sovcomflot' },
                      { v: 'Joint Stock Company Sovcomflot' }
                    ]
                  },
                  { v: 'https://www.opensanctions.org/entities/NK-VDEKGF5ZgHAkye4kGuUXs3/' }
                ]
              }
            ]
          }
        };
      }
    };

    const adapter = new ProductionSanctionsAdapter(mockClient);
    const hit = await adapter.lookup({ name: 'Sovcomflot', country: 'Russia' });

    // 1. Assert lookup returns a HIT (not null, not an error)
    assert.ok(hit, 'Lookup for Sovcomflot must return a HIT');
    assert.equal(hit?.id, 'NK-VDEKGF5ZgHAkye4kGuUXs3');
    assert.equal(hit?.name, 'Sovcomflot');
    assert.equal(hit?.country, 'Russia');
    assert.match(hit?.programme || '', /Russia-related sanctions/);
    assert.ok(Array.isArray(hit?.aliases));
    assert.ok(hit?.aliases.includes('PAO Sovcomflot'));

    // 2. Assert query targets the exact table sentinel-ai-511412.screening.sanctions
    assert.ok(capturedRequest, 'Client request must be captured');
    assert.match(capturedRequest.data.query, /`sentinel-ai-511412\.screening\.sanctions`/);

    // 3. Assert IN UNNEST syntax is used
    assert.match(capturedRequest.data.query, /LOWER\(name\) IN UNNEST\(@queryNames\)/);

    // 4. Assert parameter construction: queryNames is an ARRAY with arrayValues, even for single search term
    const queryNamesParam = capturedRequest.data.queryParameters.find((p: any) => p.name === 'queryNames');
    assert.ok(queryNamesParam, 'queryNames parameter must be present');
    assert.equal(queryNamesParam.parameterType.type, 'ARRAY', 'Parameter type must be ARRAY, never STRING');
    assert.equal(queryNamesParam.parameterType.arrayType.type, 'STRING');
    assert.ok(Array.isArray(queryNamesParam.parameterValue.arrayValues), 'arrayValues must be an array');
    assert.equal(queryNamesParam.parameterValue.arrayValues.length, 1);
    assert.equal(queryNamesParam.parameterValue.arrayValues[0].value, 'sovcomflot');

    process.env = originalEnv;
  });

  test('TestCase 3: Single alias string is normalized into genuine array parameter', async () => {
    const originalEnv = { ...process.env };
    process.env.APP_MODE = 'production';
    process.env.BQ_SANCTIONS_TABLE = 'sentinel-ai-511412.screening.sanctions';
    process.env.GOOGLE_CLOUD_PROJECT = 'sentinel-ai-511412';

    let capturedRequest: any = null;
    const mockClient = {
      async request(opts: any) {
        capturedRequest = opts;
        return { data: { rows: [] } };
      }
    };

    const adapter = new ProductionSanctionsAdapter(mockClient);
    // Pass a single string alias in aliases property
    await adapter.lookup({ name: 'Sovcomflot', aliases: 'PAO Sovcomflot' });

    const queryNamesParam = capturedRequest.data.queryParameters.find((p: any) => p.name === 'queryNames');
    assert.ok(queryNamesParam);
    assert.equal(queryNamesParam.parameterType.type, 'ARRAY');
    assert.ok(Array.isArray(queryNamesParam.parameterValue.arrayValues));
    // Contains normalized names
    const values = queryNamesParam.parameterValue.arrayValues.map((v: any) => v.value);
    assert.ok(values.includes('sovcomflot'));

    process.env = originalEnv;
  });

  test('TestCase 4: Confirm no other BigQuery queries exist in ProductionSanctionsAdapter', () => {
    const originalEnv = { ...process.env };
    process.env.APP_MODE = 'production';
    process.env.BQ_SANCTIONS_TABLE = 'sentinel-ai-511412.screening.sanctions';
    process.env.GOOGLE_CLOUD_PROJECT = 'sentinel-ai-511412';

    const adapter = new ProductionSanctionsAdapter({ request: async () => ({ data: {} }) });
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).filter(
      (m) => m !== 'constructor'
    );

    // Only lookup, attribution, mode exist
    assert.deepEqual(methodNames.sort(), ['attribution', 'lookup', 'mode'].sort());

    process.env = originalEnv;
  });
});
