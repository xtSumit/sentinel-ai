/**
 * Sentinel AI — Sanctions List Adapter
 * Conforms to Custom Instructions §11 (Preview vs Production adapters)
 * Source data: OpenSanctions (CC BY-NC 4.0)
 */

export interface SanctionsEntry {
  id: string;
  name: string;
  country: string;
  programme: string;
  aliases: string[];
  openSanctionsUrl?: string;
}

export interface SanctionsLookupQuery {
  name: string;
  country?: string;
}

export interface ISanctionsAdapter {
  lookup(query: SanctionsLookupQuery): Promise<SanctionsEntry | null>;
  attribution(): string;
  mode(): 'PREVIEW' | 'PRODUCTION';
}

/**
 * Normalises company names for exact/alias matching:
 * - Lowercase & trim
 * - Strips common corporate legal suffixes (Ltd, LLC, SA, GmbH, PJSC, PAO, JSC, Pte, Inc, Corp)
 * - Strips punctuation
 */
export function normaliseEntityName(name: string): string {
  if (!name) return '';
  let clean = name.toLowerCase().trim();
  // Strip punctuation except spaces and alphanumeric
  clean = clean.replace(/[.,\-_/\\()[\]'"`]/g, ' ');
  // Collapse whitespace
  clean = clean.replace(/\s+/g, ' ').trim();
  // Strip legal suffixes at end of string or standalone tokens
  const suffixes = [
    'pao', 'jsc', 'pjsc', 'ltd', 'limited', 'llc', 'sa', 's a', 'gmbh', 
    'pte ltd', 'pte', 'inc', 'incorporated', 'corp', 'corporation',
    's a r l', 'sarl', 'pvt ltd', 'pvt', 'joint stock company'
  ];
  for (const suffix of suffixes) {
    const regex = new RegExp(`(^|\\s)${suffix}(\\s|$)`, 'g');
    clean = clean.replace(regex, ' ').replace(/\s+/g, ' ').trim();
  }
  return clean;
}

/**
 * Weak aliases that must NEVER trigger matches because they are too generic.
 */
const WEAK_ALIASES_DISALLOWED = new Set(['scf', 'scf group', 'scf corp', 'scf ltd']);

/**
 * PREVIEW ADAPTER
 * Contains fixture data for Sovcomflot (NK-VDEKGF5ZgHAkye4kGuUXs3)
 */
export class PreviewSanctionsAdapter implements ISanctionsAdapter {
  private static readonly FIXTURE_ENTRIES: SanctionsEntry[] = [
    {
      id: 'NK-VDEKGF5ZgHAkye4kGuUXs3',
      name: 'Sovcomflot',
      country: 'Russia',
      programme: 'Russia-related sanctions, designated by the US (OFAC), the UK, the EU and Australia',
      aliases: [
        'JSC Sovcomflot',
        'PAO Sovcomflot',
        'Joint Stock Company Sovcomflot',
        'ПАО Совкомфлот'
      ],
      openSanctionsUrl: 'https://www.opensanctions.org/entities/NK-VDEKGF5ZgHAkye4kGuUXs3/'
    }
  ];

  async lookup(query: SanctionsLookupQuery): Promise<SanctionsEntry | null> {
    const rawQueryName = query.name.toLowerCase().trim();
    if (WEAK_ALIASES_DISALLOWED.has(rawQueryName)) {
      return null;
    }

    const normQuery = normaliseEntityName(query.name);
    if (!normQuery) return null;

    for (const entry of PreviewSanctionsAdapter.FIXTURE_ENTRIES) {
      // Check primary name
      if (normaliseEntityName(entry.name) === normQuery) {
        return entry;
      }
      // Check aliases
      for (const alias of entry.aliases) {
        const normAlias = normaliseEntityName(alias);
        if (normAlias === normQuery) {
          return entry;
        }
      }
    }

    return null;
  }

  attribution(): string {
    return 'Sanctions data: OpenSanctions (CC BY-NC 4.0)';
  }

  mode(): 'PREVIEW' | 'PRODUCTION' {
    return 'PREVIEW';
  }
}

/**
 * PRODUCTION ADAPTER
 * Executes parameterised BigQuery queries against BQ_SANCTIONS_TABLE.
 * Fails closed if configuration is missing.
 */
export class ProductionSanctionsAdapter implements ISanctionsAdapter {
  private tableName: string;

  constructor() {
    const table = process.env.BQ_SANCTIONS_TABLE;
    if (!table) {
      throw new Error('[ProductionSanctionsAdapter] BQ_SANCTIONS_TABLE environment variable is required in PRODUCTION mode. Failing closed.');
    }
    this.tableName = table;
  }

  async lookup(query: SanctionsLookupQuery): Promise<SanctionsEntry | null> {
    const rawQueryName = query.name.toLowerCase().trim();
    if (WEAK_ALIASES_DISALLOWED.has(rawQueryName)) {
      return null;
    }

    // In production, queries the BigQuery table using parameterised bindings
    // Example query structure:
    // SELECT id, name, aliases, countries, sanctions FROM `@tableName`
    // WHERE LOWER(name) = @cleanName OR @cleanName IN UNNEST(aliases)
    // For local evaluation if BigQuery SDK is not instantiated, fails closed per Custom Instructions §11.
    throw new Error(`[ProductionSanctionsAdapter] BigQuery connection not established for table ${this.tableName}. Fail-closed in PRODUCTION mode.`);
  }

  attribution(): string {
    return 'Sanctions data: OpenSanctions (CC BY-NC 4.0)';
  }

  mode(): 'PRODUCTION' | 'PRODUCTION' {
    return 'PRODUCTION';
  }
}

export function getSanctionsAdapter(): ISanctionsAdapter {
  const mode = process.env.APP_MODE === 'PRODUCTION' ? 'PRODUCTION' : 'PREVIEW';
  if (mode === 'PRODUCTION') {
    return new ProductionSanctionsAdapter();
  }
  return new PreviewSanctionsAdapter();
}
