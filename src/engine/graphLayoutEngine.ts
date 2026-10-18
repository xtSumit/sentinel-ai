import {
  CorporateGroupSeed,
  EntityRecord,
  PersonRecord,
  RelationshipRecord,
  UnspecifiedOwnerRecord,
} from '../types/bods';
import {
  formatNumber,
  ImplicitGapRecord,
  ResolvedPersonUbo,
  UboResolutionResult,
} from './uboEngine';

export interface NodeFootprint {
  width: number;
  height: number;
  leftOffset: number;   // distance from center X to left edge
  rightOffset: number;  // distance from center X to right edge
  topOffset: number;    // distance from center Y to top edge
  bottomOffset: number; // distance from center Y to bottom edge
}

export interface PositionedNode {
  id: string;
  kind: 'entity' | 'person' | 'unspecified';
  tier: number; // 0 = top tier (persons + explicit unknown owners), rootTier = root entity
  x: number; // center X
  y: number; // center Y
  width: number;
  height: number;
  footprint: NodeFootprint;
  entity?: EntityRecord;
  person?: PersonRecord;
  unspecified?: UnspecifiedOwnerRecord;
  implicitGap?: ImplicitGapRecord;
  personDisplayLines?: string[];
  personStatusText?: string;
}

export interface PositionedEdge {
  rel: RelationshipRecord;
  fromNode: PositionedNode;
  toNode: PositionedNode;
  pathD: string;
  midX: number;
  midY: number;
  labelText: string;
  strokeWidth: number;
  strokeColor: string;
  isDashed: boolean;
  isHistorical: boolean;
  isHot: boolean;
  dotColor: string;
  dotDurationSec: number;
  isCycleEdge: boolean;
}

export interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface GraphLayoutStats {
  totalTiers: number;
  nodeCount: number;
  edgeCount: number;
  crossingCount: number;
  compactRatio: number;
}

export interface GraphLayoutResult {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  bounds: LayoutBounds;
  tierYMap: Map<number, number>;
  rootTier: number;
  stats: GraphLayoutStats;
}

export interface MeasuredNodeDimensions {
  width: number;
  height: number;
  displayLines?: string[];
}

export interface GraphLayoutOptions {
  density?: 'compact' | 'comfortable';
  measuredDimensions?: Map<string, MeasuredNodeDimensions>;
}

/**
 * Helper to resolve 2-letter ISO country code from flag emoji or country name string.
 */
export function getCountryCode(flagOrJur?: string): string {
  if (!flagOrJur) return '';
  const str = flagOrJur.toLowerCase();
  if (str.includes('singapore') || str.includes('🇸🇬') || str === 'sg') return 'SG';
  if (str.includes('united kingdom') || str.includes('uk') || str.includes('🇬🇧') || str === 'gb') return 'GB';
  if (str.includes('united states') || str.includes('us') || str.includes('🇺🇸')) return 'US';
  if (str.includes('malaysia') || str.includes('🇲🇾') || str === 'my') return 'MY';
  if (str.includes('india') || str.includes('🇮🇳') || str === 'in') return 'IN';
  if (str.includes('germany') || str.includes('🇩🇪') || str === 'de') return 'DE';
  if (str.includes('luxembourg') || str.includes('🇱🇺') || str === 'lu') return 'LU';
  if (str.includes('netherlands') || str.includes('🇳🇱') || str === 'nl') return 'NL';
  if (str.includes('switzerland') || str.includes('🇨🇭') || str === 'ch') return 'CH';
  if (str.includes('russia') || str.includes('🇷🇺') || str === 'ru') return 'RU';
  if (str.includes('china') || str.includes('🇨🇳') || str === 'cn') return 'CN';
  if (str.includes('hong kong') || str.includes('🇭🇰') || str === 'hk') return 'HK';
  if (str.includes('australia') || str.includes('🇦🇺') || str === 'au') return 'AU';
  if (str.includes('cayman') || str.includes('🇰🇾') || str === 'ky') return 'KY';
  if (str.includes('bvi') || str.includes('virgin') || str.includes('🇻🇬') || str === 'vg') return 'VG';
  if (str.includes('nigeria') || str.includes('🇳🇬') || str === 'ng') return 'NG';
  if (str.includes('liechtenstein') || str.includes('🇱🇮') || str === 'li') return 'LI';
  if (str.includes('france') || str.includes('🇫🇷') || str === 'fr') return 'FR';
  if (str.includes('spain') || str.includes('🇪🇸') || str === 'es') return 'ES';
  if (str.includes('emirates') || str.includes('uae') || str.includes('🇦🇪') || str === 'ae') return 'AE';

  return flagOrJur.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '';
}

/**
 * Formats person status string matching original style:
 * - "PEP · Definite · 36.9%"
 * - "Below · 18.0%"
 * - "Possible · 15.0–37.5%"
 */
export function formatPersonStatus(per: PersonRecord, resolved?: ResolvedPersonUbo): string {
  const parts: string[] = [];
  if (per.pepStatus && per.pepStatus !== 'none') {
    parts.push('PEP');
  }

  if (resolved) {
    const isRange = resolved.isRange || resolved.totalMinPct !== resolved.totalMaxPct;
    const stakeStr = isRange
      ? `${formatNumber(resolved.totalMinPct)}–${formatNumber(resolved.totalMaxPct)}%`
      : `${formatNumber(resolved.totalMaxPct)}%`;

    if (resolved.classification === 'DEFINITE') {
      parts.push(`Definite · ${stakeStr}`);
    } else if (resolved.classification === 'POSSIBLE') {
      parts.push(`Possible · ${stakeStr}`);
    } else {
      parts.push(`Below · ${stakeStr}`);
    }
  } else {
    parts.push('No Reach');
  }

  return parts.join(' · ');
}

/**
 * Formats person name display lines centered under node circle.
 * Wraps to two lines if needed so names are never clipped.
 */
export function getPersonDisplayLines(name: string, flagOrJur?: string): string[] {
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  let lines: string[] = [];

  if (trimmed.length > 16 && parts.length > 1) {
    const mid = Math.ceil(parts.length / 2);
    lines = [parts.slice(0, mid).join(' '), parts.slice(mid).join(' ')];
  } else if (trimmed.includes('-') && trimmed.length > 14) {
    const dashIdx = trimmed.indexOf('-');
    lines = [trimmed.slice(0, dashIdx), trimmed.slice(dashIdx + 1)];
  } else {
    lines = [trimmed];
  }

  const code = getCountryCode(flagOrJur);
  if (code) {
    lines[0] = `${code} ${lines[0]}`;
  }

  return lines;
}

/**
 * Counts total edge crossings between adjacent layers.
 */
function countEdgeCrossings(edges: PositionedEdge[]): number {
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const e1 = edges[i];
      const e2 = edges[j];
      if (
        e1.fromNode.tier === e2.fromNode.tier &&
        e1.toNode.tier === e2.toNode.tier &&
        e1.fromNode.id !== e2.fromNode.id &&
        e1.toNode.id !== e2.toNode.id
      ) {
        const fromDiff = e1.fromNode.x - e2.fromNode.x;
        const toDiff = e1.toNode.x - e2.toNode.x;
        if (fromDiff * toDiff < 0) {
          crossings++;
        }
      }
    }
  }
  return crossings;
}

/**
 * Evaluates a cubic Bézier curve point at parameter t in [0, 1].
 * Formula: B(t) = (1-t)^3 * P0 + 3*(1-t)^2*t * P1 + 3*(1-t)*t^2 * P2 + t^3 * P3
 */
function evaluateCubicBezier(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  t: number
): { x: number; y: number } {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  const x = uuu * p0x + 3 * uu * t * p1x + 3 * u * tt * p2x + ttt * p3x;
  const y = uuu * p0y + 3 * uu * t * p1y + 3 * u * tt * p2y + ttt * p3y;
  return { x, y };
}

/**
 * Compact Tree-Layout Algorithm for Corporate Ownership Graphs
 */
export function computeGraphLayout(
  group: CorporateGroupSeed,
  resolution: UboResolutionResult,
  options?: GraphLayoutOptions
): GraphLayoutResult {
  if (!group || !resolution) {
    return {
      nodes: [],
      edges: [],
      bounds: { minX: -280, maxX: 280, minY: -90, maxY: 200, width: 560, height: 290 },
      tierYMap: new Map(),
      rootTier: 0,
      stats: { totalTiers: 0, nodeCount: 0, edgeCount: 0, crossingCount: 0, compactRatio: 1 },
    };
  }

  // Mandatory clear space rules:
  // - At least 56px between footprints in the same tier
  // - At least 100px clear space between tiers
  const minHorizontalClearSpace = 56;
  const minVerticalClearSpace = 100;

  const resolvedPersonMap = new Map<string, ResolvedPersonUbo>();
  if (resolution.persons) {
    for (const p of resolution.persons) {
      resolvedPersonMap.set(p.person.id, p);
    }
  }

  const implicitGapByEntity = new Map<string, ImplicitGapRecord>();
  if (resolution.implicitGaps) {
    for (const gap of resolution.implicitGaps) {
      implicitGapByEntity.set(gap.entityId, gap);
    }
  }

  // 1. Longest path distance from root entity to calculate tree depth
  const distFromRoot = new Map<string, number>();
  distFromRoot.set(group.rootEntityId, 0);

  const computeDist = (currId: string, visited: Set<string>, currentDist: number) => {
    for (const rel of group.relationships) {
      if (rel.subjectId === currId && !visited.has(rel.interestedPartyId)) {
        const prev = distFromRoot.get(rel.interestedPartyId) ?? -1;
        if (currentDist + 1 > prev) {
          distFromRoot.set(rel.interestedPartyId, currentDist + 1);
        }
        const nextVisited = new Set(visited);
        nextVisited.add(rel.interestedPartyId);
        computeDist(rel.interestedPartyId, nextVisited, currentDist + 1);
      }
    }
  };

  computeDist(group.rootEntityId, new Set([group.rootEntityId]), 0);

  let maxEntityDist = 0;
  for (const d of distFromRoot.values()) {
    if (d > maxEntityDist) maxEntityDist = d;
  }

  const rootTier = maxEntityDist + 1;

  const tierBuckets = new Map<number, PositionedNode[]>();
  for (let t = 0; t <= rootTier; t++) {
    tierBuckets.set(t, []);
  }

  // 2. Build PositionedNode objects for Tier 0 (persons & unspecified owners)
  for (const p of group.persons) {
    const resolved = resolvedPersonMap.get(p.id);
    const displayLines = getPersonDisplayLines(p.name, p.flag);
    const statusText = formatPersonStatus(p, resolved);

    const maxLineLen = Math.max(...displayLines.map((l) => l.length));
    const nameWidth = maxLineLen * 7.2 + 20;
    const statusWidth = statusText.length * 6.5 + 20;
    const footprintWidth = Math.max(52, nameWidth, statusWidth);

    const topOffset = 28;
    const bottomOffset = displayLines.length > 1 ? 76 : 66;

    const footprint: NodeFootprint = {
      width: footprintWidth,
      height: topOffset + bottomOffset,
      leftOffset: footprintWidth / 2,
      rightOffset: footprintWidth / 2,
      topOffset,
      bottomOffset,
    };

    tierBuckets.get(0)!.push({
      id: p.id,
      kind: 'person',
      tier: 0,
      x: 0,
      y: 0,
      width: 52,
      height: 52,
      footprint,
      person: p,
      personDisplayLines: displayLines,
      personStatusText: statusText,
    });
  }

  for (const u of group.unspecifiedOwners) {
    const measured = options?.measuredDimensions?.get(u.id);
    const labelLen = u.label.length;
    // Standard entity sizing: height 52, width = max(154, text width + 48), capped at 220
    const textWidthEstimate = labelLen * 6.8;
    const calcWidth = measured
      ? Math.min(220, Math.max(154, measured.width))
      : Math.min(220, Math.max(154, Math.ceil(textWidthEstimate + 48)));
    const boxHeight = 52;
    const footprintWidth = calcWidth;

    const footprint: NodeFootprint = {
      width: footprintWidth,
      height: boxHeight,
      leftOffset: footprintWidth / 2,
      rightOffset: footprintWidth / 2,
      topOffset: boxHeight / 2,
      bottomOffset: boxHeight / 2,
    };

    tierBuckets.get(0)!.push({
      id: u.id,
      kind: 'unspecified',
      tier: 0,
      x: 0,
      y: 0,
      width: calcWidth,
      height: boxHeight,
      footprint,
      unspecified: u,
    });
  }

  // 3. Build PositionedNode objects for intermediate entities & root
  for (const ent of group.entities) {
    const isRoot = ent.id === group.rootEntityId;
    const d = distFromRoot.get(ent.id) ?? 1;
    const tier = isRoot ? rootTier : Math.max(1, rootTier - d);

    const measured = options?.measuredDimensions?.get(ent.id);
    const line0 = ent.displayLines[0] || ent.name;
    const line1 = ent.displayLines[1] || '';
    const maxLen = Math.max(line0.length, line1.length);
    const textWidthEstimate = maxLen * 6.8;

    // Requirement 1:
    // Standard entity: height 52, width = max(154, text width + 48), capped at 220.
    // Root entity: height 62, width = max(192, text width + 48), capped at 240.
    const calcWidth = isRoot
      ? Math.min(240, Math.max(192, Math.ceil(textWidthEstimate + 48)))
      : Math.min(220, Math.max(154, Math.ceil(textWidthEstimate + 48)));
    const boxHeight = isRoot ? 62 : 52;

    const gap = implicitGapByEntity.get(ent.id);
    const isSanctioned = ent.status === 'sanctioned' || Boolean(ent.sanctionsProgramme);
    const hasPill = gap && !isSanctioned;

    let topOffset = boxHeight / 2;
    if (hasPill) {
      topOffset += 24; // Attached dashed pill offset up
    }
    const bottomOffset = boxHeight / 2;

    const footprintWidth = calcWidth;

    const footprint: NodeFootprint = {
      width: footprintWidth,
      height: topOffset + bottomOffset,
      leftOffset: footprintWidth / 2,
      rightOffset: footprintWidth / 2,
      topOffset,
      bottomOffset,
    };

    tierBuckets.get(tier)!.push({
      id: ent.id,
      kind: 'entity',
      tier,
      x: 0,
      y: 0,
      width: calcWidth,
      height: boxHeight,
      footprint,
      entity: ent,
      implicitGap: gap,
    });
  }

  // 4. Calculate Tier Y positions based on clear vertical spacing (>= 160px between tiers)
  const tierYMap = new Map<number, number>();
  tierYMap.set(0, 0);

  for (let t = 0; t < rootTier; t++) {
    const currentBucket = tierBuckets.get(t) ?? [];
    const nextBucket = tierBuckets.get(t + 1) ?? [];

    const currentY = tierYMap.get(t) ?? 0;

    let maxCurrentBottom = 32;
    if (currentBucket.length > 0) {
      maxCurrentBottom = Math.max(...currentBucket.map((n) => n.footprint.bottomOffset));
    }

    let maxNextTop = 32;
    if (nextBucket.length > 0) {
      maxNextTop = Math.max(...nextBucket.map((n) => n.footprint.topOffset));
    }

    const nextY = currentY + maxCurrentBottom + minVerticalClearSpace + maxNextTop;
    tierYMap.set(t + 1, nextY);
  }

  // 5. COMPACT TREE-LAYOUT ALGORITHM WITH MULTI-PASS BARYCENTER SWEEPING
  const rootNode = tierBuckets.get(rootTier)?.[0];
  if (rootNode) {
    rootNode.x = 0;
    rootNode.y = tierYMap.get(rootTier) ?? (rootTier * 260);
  }

  const downstreamMap = new Map<string, string[]>();
  const upstreamMap = new Map<string, string[]>();

  group.relationships.forEach((rel) => {
    const down = downstreamMap.get(rel.interestedPartyId) ?? [];
    down.push(rel.subjectId);
    downstreamMap.set(rel.interestedPartyId, down);

    const up = upstreamMap.get(rel.subjectId) ?? [];
    up.push(rel.interestedPartyId);
    upstreamMap.set(rel.subjectId, up);
  });

  // Pack a tier left-to-right with exact minHorizontalClearSpace (>= 64px)
  const packTier = (bucket: PositionedNode[], targetCenter: number = 0) => {
    if (bucket.length === 0) return;
    if (bucket.length === 1) {
      bucket[0].x = targetCenter;
      return;
    }

    let totalSpan = 0;
    for (let i = 0; i < bucket.length; i++) {
      totalSpan += bucket[i].footprint.width;
      if (i > 0) totalSpan += minHorizontalClearSpace;
    }

    let currentX = targetCenter - totalSpan / 2;
    for (let i = 0; i < bucket.length; i++) {
      const node = bucket[i];
      node.x = currentX + node.footprint.leftOffset;
      currentX += node.footprint.width + minHorizontalClearSpace;
    }
  };

  // Initial placement
  for (let t = rootTier - 1; t >= 0; t--) {
    const bucket = tierBuckets.get(t) ?? [];
    packTier(bucket, 0);
  }

  // Multi-pass Barycenter Sweeping
  const allNodesMap = new Map<string, PositionedNode>();
  for (let t = 0; t <= rootTier; t++) {
    (tierBuckets.get(t) ?? []).forEach((n) => allNodesMap.set(n.id, n));
  }

  for (let iteration = 0; iteration < 4; iteration++) {
    for (let t = rootTier - 1; t >= 0; t--) {
      const bucket = tierBuckets.get(t) ?? [];
      if (bucket.length <= 1) continue;

      const scored = bucket.map((node) => {
        const subjects = downstreamMap.get(node.id) ?? [];
        let sumX = 0;
        let count = 0;
        subjects.forEach((sid) => {
          const sNode = allNodesMap.get(sid);
          if (sNode && sNode.tier > t) {
            sumX += sNode.x;
            count++;
          }
        });
        const barycenter = count > 0 ? sumX / count : node.x;
        return { node, barycenter };
      });

      scored.sort((a, b) => a.barycenter - b.barycenter);
      const sortedNodes = scored.map((s) => s.node);
      tierBuckets.set(t, sortedNodes);
      packTier(sortedNodes, 0);
    }

    for (let t = 1; t < rootTier; t++) {
      const bucket = tierBuckets.get(t) ?? [];
      if (bucket.length <= 1) continue;

      const scored = bucket.map((node) => {
        const owners = upstreamMap.get(node.id) ?? [];
        let sumX = 0;
        let count = 0;
        owners.forEach((oid) => {
          const oNode = allNodesMap.get(oid);
          if (oNode && oNode.tier < t) {
            sumX += oNode.x;
            count++;
          }
        });
        const barycenter = count > 0 ? sumX / count : node.x;
        return { node, barycenter };
      });

      scored.sort((a, b) => a.barycenter - b.barycenter);
      const sortedNodes = scored.map((s) => s.node);
      tierBuckets.set(t, sortedNodes);
      packTier(sortedNodes, 0);
    }
  }

  // Subtree clustering for Tier 0
  const tier0Bucket = tierBuckets.get(0) ?? [];
  if (tier0Bucket.length > 2 && rootTier >= 2) {
    const tier1Nodes = tierBuckets.get(1) ?? [];
    if (tier1Nodes.length >= 2) {
      const tier1PosMap = new Map<string, number>();
      tier1Nodes.forEach((n) => tier1PosMap.set(n.id, n.x));

      tier0Bucket.sort((a, b) => {
        const aSubs = downstreamMap.get(a.id) ?? [];
        const bSubs = downstreamMap.get(b.id) ?? [];

        const getPrimaryX = (subs: string[]) => {
          for (const sid of subs) {
            if (tier1PosMap.has(sid)) return tier1PosMap.get(sid)!;
          }
          return 0;
        };

        return getPrimaryX(aSubs) - getPrimaryX(bSubs);
      });

      packTier(tier0Bucket, 0);
    }
  }

  // Assign final Y positions
  for (let t = 0; t <= rootTier; t++) {
    const tierY = tierYMap.get(t) ?? (t * 260);
    const bucket = tierBuckets.get(t) ?? [];
    bucket.forEach((node) => {
      node.y = node.entity?.positionOverride?.y ??
               node.person?.positionOverride?.y ??
               node.unspecified?.positionOverride?.y ??
               tierY;

      const overrideX = node.entity?.positionOverride?.x ??
                        node.person?.positionOverride?.x ??
                        node.unspecified?.positionOverride?.x;
      if (overrideX !== undefined) {
        node.x = overrideX;
      }
    });
  }

  // 6. Collect all positioned nodes
  const allNodes: PositionedNode[] = [];
  for (let t = 0; t <= rootTier; t++) {
    allNodes.push(...(tierBuckets.get(t) ?? []));
  }

  const nodeMap = new Map<string, PositionedNode>();
  allNodes.forEach((n) => nodeMap.set(n.id, n));

  const cycleEdgeSet = new Set<string>();
  for (const c of (resolution.cyclesFound ?? [])) {
    c.edgeIds.forEach((eid) => cycleEdgeSet.add(eid));
  }

  // 7. Route positioned edges & percentage labels ON their vertical S-curves
  const allEdges: PositionedEdge[] = [];
  group.relationships.forEach((rel) => {
    const fromNode = nodeMap.get(rel.interestedPartyId);
    const toNode = nodeMap.get(rel.subjectId);
    if (!fromNode || !toNode) return;

    const interest = rel.interests[0];
    if (!interest) return;

    const share = interest.share;
    const midpointPct =
      share.kind === 'exact' ? share.value : (share.min + share.max) / 2;
    const shareFraction = Math.max(0.05, Math.min(1, midpointPct / 100));

    const isHot = Boolean(rel.isHot);
    const isHistorical =
      Boolean(rel.isHistorical) || fromNode.entity?.status === 'dissolved';
    const isCycleEdge = cycleEdgeSet.has(rel.id);

    const strokeWidth = isHot ? 3.0 : 1.3 + 1.8 * shareFraction;

    let strokeColor = '#8fb0e3';
    let dotColor = '#5AA9FE';
    let isDashed = false;

    if (isHistorical) {
      strokeColor = '#c9c2d2';
      isDashed = true;
    } else if (isHot) {
      strokeColor = 'var(--amber)';
      dotColor = 'var(--amber)';
    } else if (rel.interestedPartyType === 'person') {
      strokeColor = 'var(--emerald)';
      dotColor = 'var(--emerald)';
    } else if (rel.interestedPartyType === 'unspecified') {
      strokeColor = 'var(--grey)';
      dotColor = 'var(--grey)';
      isDashed = true;
    }

    let startX = fromNode.x;
    let startY = fromNode.y;
    let endX = toNode.x;
    let endY = toNode.y;
    let pathD = '';

    const sameTier = Math.abs(fromNode.y - toNode.y) < 20;
    if (sameTier) {
      const goingRight = toNode.x > fromNode.x;
      const yOffset = goingRight ? -12 : 12;
      startX = fromNode.x + (goingRight ? fromNode.width / 2 : -fromNode.width / 2);
      startY = fromNode.y + yOffset;
      endX = toNode.x + (goingRight ? -toNode.width / 2 - 6 : toNode.width / 2 + 6);
      endY = toNode.y + yOffset;

      const archY = startY + (goingRight ? -48 : 48);
      pathD = `M ${startX} ${startY} C ${(startX + endX) / 2 - 25} ${archY}, ${(startX + endX) / 2 + 25} ${archY}, ${endX} ${endY}`;
    } else {
      // Requirement 2:
      // Vertical S-shaped cubic Bézier between perimeter points: M a C (a.x, midY) (b.x, midY) b
      const fromBottomOffset = fromNode.kind === 'person' ? 26 : fromNode.height / 2;
      const toTopOffset = toNode.kind === 'person' ? 26 : toNode.height / 2;

      startX = fromNode.x;
      startY = fromNode.y + fromBottomOffset;
      endX = toNode.x;
      endY = toNode.y - toTopOffset;

      const midY = (startY + endY) / 2;
      pathD = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
    }

    const labelText =
      share.kind === 'exact'
        ? `${formatNumber(share.value)}%`
        : `${formatNumber(share.min)}–${formatNumber(share.max)}%`;

    const dotDurationSec = isHot ? 1.8 : Math.max(2.2, 4.8 - 2.8 * shareFraction);

    // Initial label midpoint on curve (t = 0.5)
    const midY = (startY + endY) / 2;
    const initialPos = sameTier
      ? { x: (startX + endX) / 2, y: startY + (toNode.x > fromNode.x ? -36 : 36) }
      : evaluateCubicBezier(startX, startY, startX, midY, endX, midY, endX, endY, 0.5);

    allEdges.push({
      rel,
      fromNode,
      toNode,
      pathD,
      midX: initialPos.x,
      midY: initialPos.y,
      labelText,
      strokeWidth,
      strokeColor,
      isDashed,
      isHistorical,
      isHot,
      dotColor,
      dotDurationSec,
      isCycleEdge,
    });
  });

  // Collect tag boxes for collision avoidance
  const tagBoxes: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [];
  allNodes.forEach((node) => {
    if (node.implicitGap) {
      const pillText = `? ${formatNumber(node.implicitGap.remainderPct)}% unidentified`;
      const pillW = Math.max(105, Math.ceil(pillText.length * 6.0 + 16));
      const tagX = node.x + 18 + pillW / 2;
      const tagY = node.y - node.height / 2 - 14;
      tagBoxes.push({
        minX: tagX - pillW / 2,
        maxX: tagX + pillW / 2,
        minY: tagY - 9,
        maxY: tagY + 9,
      });
    }
  });

  // Label overlap & tag collision resolution along curve (t in [0.35, 0.65])
  for (let i = 0; i < allEdges.length; i++) {
    const edge = allEdges[i];
    const w = edge.labelText.length * 6.4 + 12;
    const h = 18;

    const fromY = edge.fromNode.y + (edge.fromNode.kind === 'person' ? 26 : edge.fromNode.height / 2);
    const toY = edge.toNode.y - (edge.toNode.kind === 'person' ? 26 : edge.toNode.height / 2);
    const mY = (fromY + toY) / 2;

    const checkCollision = (cx: number, cy: number) => {
      const box = { minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2 };

      // Tag collision
      for (const tBox of tagBoxes) {
        if (box.minX < tBox.maxX && box.maxX > tBox.minX && box.minY < tBox.maxY && box.maxY > tBox.minY) {
          return true;
        }
      }

      // Other label collision
      for (let j = 0; j < i; j++) {
        const other = allEdges[j];
        const ow = other.labelText.length * 6.4 + 12;
        const oBox = { minX: other.midX - ow / 2, maxX: other.midX + ow / 2, minY: other.midY - h / 2, maxY: other.midY + h / 2 };
        if (box.minX < oBox.maxX && box.maxX > oBox.minX && box.minY < oBox.maxY && box.maxY > oBox.minY) {
          return true;
        }
      }
      return false;
    };

    if (checkCollision(edge.midX, edge.midY)) {
      const candidateTs = [0.42, 0.58, 0.35, 0.65, 0.46, 0.54];
      for (const tCand of candidateTs) {
        const pt = evaluateCubicBezier(
          edge.fromNode.x, fromY,
          edge.fromNode.x, mY,
          edge.toNode.x, mY,
          edge.toNode.x, toY,
          tCand
        );
        if (!checkCollision(pt.x, pt.y)) {
          edge.midX = pt.x;
          edge.midY = pt.y;
          break;
        }
      }
    }
  }

  // 8. Bounding Box Calculation
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const n of allNodes) {
    minX = Math.min(minX, n.x - n.footprint.leftOffset - 28);
    maxX = Math.max(maxX, n.x + n.footprint.rightOffset + 28);
    minY = Math.min(minY, n.y - n.footprint.topOffset - 24);
    maxY = Math.max(maxY, n.y + n.footprint.bottomOffset + 28);
  }

  if (minX === Infinity) {
    minX = -280;
    maxX = 280;
    minY = -90;
    maxY = 200;
  }

  const crossingCount = countEdgeCrossings(allEdges);

  return {
    nodes: allNodes,
    edges: allEdges,
    bounds: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY },
    tierYMap,
    rootTier,
    stats: {
      totalTiers: rootTier + 1,
      nodeCount: allNodes.length,
      edgeCount: allEdges.length,
      crossingCount,
      compactRatio: 0.80,
    },
  };
}

