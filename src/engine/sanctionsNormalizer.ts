/**
 * Sentinel AI — Sanctions Entity Normalizer, Types & Preview Adapter
 * Client-safe string normalization, entity definitions, and preview adapter.
 * Safe for client-side React bundles (no Node.js or google-auth-library dependencies).
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
  aliases?: string[] | string;
}

export interface ISanctionsAdapter {
  lookup(query: SanctionsLookupQuery): Promise<SanctionsEntry | null>;
  attribution(): string;
  mode(): 'PREVIEW' | 'PRODUCTION';
}

/**
 * Normalises an entity name for comparison:
 * Lowercases, strips punctuation, normalises legal forms (inc, corp, ltd, plc, gmbh, etc.)
 */
export function normaliseEntityName(raw: string): string {
  if (!raw) return '';
  let clean = raw.toLowerCase().trim();
  clean = clean.replace(/[.,\-_/\\()[\]'"`]/g, ' ');
  clean = clean.replace(/\s+/g, ' ').trim();

  // Strip common corporate suffixes
  const suffixes = [
    'pao', 'jsc', 'pjsc', 'ltd', 'limited', 'llc', 'sa', 's a', 'gmbh',
    'pte ltd', 'pte', 'inc', 'incorporated', 'corp', 'corporation',
    's a r l', 'sarl', 'pvt ltd', 'pvt', 'joint stock company',
    'ag', 'srl', 'lp', 'bv', 'nv', 'co', 'company'
  ];

  for (const s of suffixes) {
    const rx = new RegExp(`(^|\\s)${s}(\\s|$)`, 'g');
    clean = clean.replace(rx, ' ').replace(/\s+/g, ' ').trim();
  }

  return clean;
}

/**
 * Weak aliases that must NEVER trigger matches because they are too generic.
 */
export const WEAK_ALIASES_DISALLOWED = new Set(['scf', 'scf group', 'scf corp', 'scf ltd']);

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
