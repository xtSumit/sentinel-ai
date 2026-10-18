/**
 * Sentinel AI — Adverse Media Extraction Server-Side Cache
 * Conforms to Requirement 3:
 * "Cache adverse-media extraction results server-side, keyed by article id, subject and model.
 * The corpus never changes, so re-running screening must reuse cached findings instead of calling Gemini again."
 */

import { AdverseMediaFinding, AdverseMediaArticle, normalisePersonName } from '../engine/adverseMediaAgent.js';
import { MODEL_LADDER } from './geminiLadder.js';

// Server-side in-memory cache: key -> AdverseMediaFinding
const cache = new Map<string, AdverseMediaFinding>();

/**
 * Builds the canonical cache key: `${articleId}:${normSubject}:${model}`
 */
export function getAdverseMediaCacheKey(articleId: string, subject: string, model: string): string {
  const normSubject = normalisePersonName(subject).replace(/\s+/g, '_');
  return `${articleId}:${normSubject}:${model}`;
}

/**
 * Retrieves a single cached finding if present.
 */
export function getCachedFinding(
  articleId: string,
  subject: string,
  model: string
): AdverseMediaFinding | undefined {
  const key = getAdverseMediaCacheKey(articleId, subject, model);
  return cache.get(key);
}

/**
 * Stores a single finding in the cache.
 */
export function setCachedFinding(
  articleId: string,
  subject: string,
  model: string,
  finding: AdverseMediaFinding
): void {
  const key = getAdverseMediaCacheKey(articleId, subject, model);
  cache.set(key, finding);
}

/**
 * Batch-checks articles for a given subject against the cache.
 * Checks available models in the ladder. If all articles for a person are found under any
 * active ladder model, returns the full cached findings and empty uncached array.
 * Otherwise returns the cached findings and the list of uncached articles needing extraction.
 */
export function partitionArticlesByCache(
  articles: AdverseMediaArticle[],
  subject: string
): {
  cachedFindings: AdverseMediaFinding[];
  uncachedArticles: AdverseMediaArticle[];
  modelUsed?: string;
} {
  // Check if any model in the ladder has ALL articles cached
  for (const model of MODEL_LADDER) {
    const findings: AdverseMediaFinding[] = [];
    let allPresent = true;

    for (const art of articles) {
      const key = getAdverseMediaCacheKey(art.id, subject, model);
      const found = cache.get(key);
      if (found) {
        findings.push(found);
      } else {
        allPresent = false;
        break;
      }
    }

    if (allPresent && findings.length > 0) {
      console.log(
        `[AdverseMediaCache] Cache HIT: All ${findings.length} article findings for subject "${subject}" retrieved from cache for model "${model}". Zero Gemini calls required.`
      );
      return {
        cachedFindings: findings,
        uncachedArticles: [],
        modelUsed: model
      };
    }
  }

  // If not all articles are found under a single model, find which articles are cached under any ladder model
  const cachedFindings: AdverseMediaFinding[] = [];
  const uncachedArticles: AdverseMediaArticle[] = [];

  for (const art of articles) {
    let foundFinding: AdverseMediaFinding | undefined;
    for (const model of MODEL_LADDER) {
      const key = getAdverseMediaCacheKey(art.id, subject, model);
      const item = cache.get(key);
      if (item) {
        foundFinding = item;
        break;
      }
    }

    if (foundFinding) {
      cachedFindings.push(foundFinding);
    } else {
      uncachedArticles.push(art);
    }
  }

  console.log(
    `[AdverseMediaCache] Partition for subject "${subject}": ${cachedFindings.length} cached, ${uncachedArticles.length} uncached.`
  );

  return {
    cachedFindings,
    uncachedArticles
  };
}

/**
 * Cache statistics for monitoring and testing.
 */
export function getCacheStats() {
  return {
    totalEntries: cache.size,
    keys: Array.from(cache.keys())
  };
}

/**
 * Clear cache helper (useful for test suites).
 */
export function clearAdverseMediaCache() {
  cache.clear();
}
