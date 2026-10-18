/**
 * Sentinel AI — Sanctions List Adapter
 * Conforms to Custom Instructions §11 (Preview vs Production adapters)
 * Source data: OpenSanctions (CC BY-NC 4.0)
 */

export type {
  SanctionsEntry,
  SanctionsLookupQuery,
  ISanctionsAdapter
} from '../engine/sanctionsNormalizer';

export {
  normaliseEntityName,
  WEAK_ALIASES_DISALLOWED,
  PreviewSanctionsAdapter
} from '../engine/sanctionsNormalizer';

import type {
  SanctionsEntry,
  SanctionsLookupQuery,
  ISanctionsAdapter
} from '../engine/sanctionsNormalizer';

import {
  normaliseEntityName,
  WEAK_ALIASES_DISALLOWED,
  PreviewSanctionsAdapter
} from '../engine/sanctionsNormalizer';


/**
 * PRODUCTION ADAPTER
 * Executes parameterised BigQuery queries against BQ_SANCTIONS_TABLE.
 * Strict SQL injection defence: uses named queryParameters, never string concatenation.
 * Fails closed if configuration is missing or query fails.
 */
export class ProductionSanctionsAdapter implements ISanctionsAdapter {
  private tableName: string;
  private projectId: string;

  constructor() {
    const table = process.env.BQ_SANCTIONS_TABLE;
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!table) {
      throw new Error('[ProductionSanctionsAdapter] BQ_SANCTIONS_TABLE environment variable is required in PRODUCTION mode. Failing closed.');
    }
    if (!project) {
      throw new Error('[ProductionSanctionsAdapter] GOOGLE_CLOUD_PROJECT environment variable is required in PRODUCTION mode. Failing closed.');
    }
    this.tableName = table;
    this.projectId = project;
  }

  async lookup(query: SanctionsLookupQuery): Promise<SanctionsEntry | null> {
    const rawQueryName = query.name.toLowerCase().trim();
    if (WEAK_ALIASES_DISALLOWED.has(rawQueryName)) {
      return null;
    }

    const normQuery = normaliseEntityName(query.name);
    if (!normQuery) return null;

    try {
      const { GoogleAuth } = await import(/* @vite-ignore */ 'google-auth-library');
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/bigquery', 'https://www.googleapis.com/auth/cloud-platform']
      });
      const client = await auth.getClient();

      // Parameterised BigQuery query (OWASP Top 10 strict query parameterisation)
      const sql = `SELECT id, name, country, programme, aliases, openSanctionsUrl FROM \`${this.tableName}\` WHERE LOWER(name) = @cleanName OR @cleanName IN UNNEST(aliases) LIMIT 1`;

      const requestBody = {
        query: sql,
        useLegacySql: false,
        parameterMode: 'NAMED',
        queryParameters: [
          {
            name: 'cleanName',
            parameterType: { type: 'STRING' },
            parameterValue: { value: normQuery }
          }
        ]
      };

      const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/queries`;
      const res: any = await client.request({
        url,
        method: 'POST',
        data: requestBody
      });

      const rows = res.data?.rows;
      if (!rows || rows.length === 0) {
        return null;
      }

      const fields = res.data?.schema?.fields || [];
      const firstRowValues = rows[0]?.f || [];
      const getVal = (fieldName: string) => {
        const idx = fields.findIndex((f: any) => f.name === fieldName);
        if (idx === -1 || !firstRowValues[idx]) return undefined;
        return firstRowValues[idx].v;
      };

      const id = String(getVal('id') || `BQ-${Date.now()}`);
      const name = String(getVal('name') || query.name);
      const country = String(getVal('country') || query.country || 'Unknown');
      const programme = String(getVal('programme') || 'Designated Sanctions Programme');
      const openSanctionsUrl = getVal('openSanctionsUrl') ? String(getVal('openSanctionsUrl')) : undefined;

      let aliases: string[] = [];
      const rawAliases = getVal('aliases');
      if (Array.isArray(rawAliases)) {
        aliases = rawAliases.map((a: any) => (typeof a === 'object' && a?.v ? a.v : String(a)));
      }

      return {
        id,
        name,
        country,
        programme,
        aliases,
        openSanctionsUrl
      };
    } catch (err: any) {
      console.error(`[ProductionSanctionsAdapter] BigQuery execution failure: ${err?.message}`);
      throw new Error(`[ProductionSanctionsAdapter] BigQuery parameterised query failed for table ${this.tableName}: ${err?.message}`);
    }
  }

  attribution(): string {
    return 'Sanctions data: OpenSanctions (CC BY-NC 4.0)';
  }

  mode(): 'PRODUCTION' {
    return 'PRODUCTION';
  }
}

export function getSanctionsAdapter(): ISanctionsAdapter {
  const mode = process.env.APP_MODE?.toLowerCase() === 'production' ? 'PRODUCTION' : 'PREVIEW';
  if (mode === 'PRODUCTION') {
    return new ProductionSanctionsAdapter();
  }
  return new PreviewSanctionsAdapter();
}
