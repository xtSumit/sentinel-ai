import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import {
  CorporateGroupSeed,
  EntityRecord,
  PersonRecord,
  RelationshipRecord,
  UnspecifiedOwnerRecord,
} from '../types/bods';
import {
  formatNumber,
  formatSharePct,
  ImplicitGapRecord,
  ResolvedPersonUbo,
  UboResolutionResult,
} from '../engine/uboEngine';

export type SelectedGraphNode =
  | { kind: 'entity'; record: EntityRecord }
  | { kind: 'person'; record: PersonRecord; resolved?: ResolvedPersonUbo }
  | { kind: 'unspecified'; record: UnspecifiedOwnerRecord }
  | { kind: 'implicitGap'; record: ImplicitGapRecord };

interface OwnershipGraphProps {
  group: CorporateGroupSeed;
  resolution: UboResolutionResult;
  highlightedPersonId: string | null;
  selectedNodeId: string | null;
  onSelectNode: (node: SelectedGraphNode) => void;
  onClearHighlight: () => void;
}

interface PositionedNode {
  id: string;
  kind: 'entity' | 'person' | 'unspecified' | 'implicitGap';
  tier: number; // 0 = top tier (persons + unknown owners), maxTier = root entity
  x: number; // center x
  y: number; // center y
  width: number;
  height: number;
  entity?: EntityRecord;
  person?: PersonRecord;
  unspecified?: UnspecifiedOwnerRecord;
  implicitGap?: ImplicitGapRecord;
  targetEntityId?: string;
}

interface PositionedEdge {
  rel: RelationshipRecord;
  fromNode: PositionedNode; // owner
  toNode: PositionedNode; // subject (owned entity)
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

export const OwnershipGraph: React.FC<OwnershipGraphProps> = ({
  group,
  resolution,
  highlightedPersonId,
  selectedNodeId,
  onSelectNode,
  onClearHighlight,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null);
  const [rippleNode, setRippleNode] = useState<{ id: string; color: string; key: number } | null>(null);

  const resolvedPersonMap = useMemo(() => {
    const m = new Map<string, ResolvedPersonUbo>();
    for (const p of resolution.persons) {
      m.set(p.person.id, p);
    }
    return m;
  }, [resolution.persons]);

  // Compute deterministic tiered layout
  const { nodes, edges, bounds } = useMemo(() => {
    const entityMap = new Map<string, EntityRecord>();
    group.entities.forEach((e) => entityMap.set(e.id, e));

    // Longest path distance from root for entities (without looping)
    const distFromRoot = new Map<string, number>();
    distFromRoot.set(group.rootEntityId, 0);

    const inboundBySubject = new Map<string, RelationshipRecord[]>();
    for (const rel of group.relationships) {
      const list = inboundBySubject.get(rel.subjectId) ?? [];
      list.push(rel);
      inboundBySubject.set(rel.subjectId, list);
    }

    const computeDist = (entityId: string, visited: Set<string>, currentDist: number) => {
      const prev = distFromRoot.get(entityId) ?? 0;
      if (currentDist > prev) {
        distFromRoot.set(entityId, currentDist);
      }
      const incoming = inboundBySubject.get(entityId) ?? [];
      for (const rel of incoming) {
        if (rel.interestedPartyType === 'entity' && !visited.has(rel.interestedPartyId)) {
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

    // Total tiers:
    // Tier 0 = Top tier (natural persons + unspecified owners)
    // Tiers 1..maxEntityDist = Intermediate entities (tier = maxEntityDist + 1 - dist)
    // Bottom tier = maxEntityDist + 1 = Root entity (dist = 0)
    const rootTier = maxEntityDist + 1;

    const tierBuckets = new Map<number, PositionedNode[]>();
    for (let t = 0; t <= rootTier; t++) {
      tierBuckets.set(t, []);
    }

    // 1. Top tier: persons and unspecified owners
    for (const p of group.persons) {
      tierBuckets.get(0)!.push({
        id: p.id,
        kind: 'person',
        tier: 0,
        x: 0,
        y: 0,
        width: 52,
        height: 52,
        person: p,
      });
    }
    for (const u of group.unspecifiedOwners) {
      tierBuckets.get(0)!.push({
        id: u.id,
        kind: 'unspecified',
        tier: 0,
        x: 0,
        y: 0,
        width: 154,
        height: 52,
        unspecified: u,
      });
    }

    // 2. Entities placed by longest path from root
    for (const ent of group.entities) {
      const isRoot = ent.id === group.rootEntityId;
      const d = distFromRoot.get(ent.id) ?? 1;
      const tier = isRoot ? rootTier : Math.max(1, rootTier - d);
      tierBuckets.get(tier)!.push({
        id: ent.id,
        kind: 'entity',
        tier,
        x: 0,
        y: 0,
        width: isRoot ? 192 : 154,
        height: isRoot ? 62 : 52,
        entity: ent,
      });
    }

    const verticalGap = 152;
    const horizontalGap = 225;

    // Assign initial X and Y per tier
    for (let t = rootTier; t >= 0; t--) {
      const bucket = tierBuckets.get(t) ?? [];
      if (bucket.length === 0) continue;

      // Order nodes within tier to minimize crossings based on connected lower-tier nodes
      if (t < rootTier) {
        bucket.sort((a, b) => {
          const aTargets = group.relationships
            .filter((r) => r.interestedPartyId === a.id)
            .map((r) => r.subjectId);
          const bTargets = group.relationships
            .filter((r) => r.interestedPartyId === b.id)
            .map((r) => r.subjectId);

          const getAvgX = (ids: string[]) => {
            if (ids.length === 0) return 0;
            let sum = 0;
            let count = 0;
            for (const id of ids) {
              for (let lowerT = t + 1; lowerT <= rootTier; lowerT++) {
                const found = tierBuckets.get(lowerT)?.find((n) => n.id === id);
                if (found) {
                  sum += found.x;
                  count++;
                }
              }
            }
            return count > 0 ? sum / count : 0;
          };

          return getAvgX(aTargets) - getAvgX(bTargets);
        });
      }

      const totalWidth = (bucket.length - 1) * horizontalGap;
      bucket.forEach((node, idx) => {
        const override =
          node.entity?.positionOverride ??
          node.person?.positionOverride ??
          node.unspecified?.positionOverride;
        node.x = override?.x ?? -totalWidth / 2 + idx * horizontalGap;
        node.y = override?.y ?? t * verticalGap;
      });
    }

    const allNodes: PositionedNode[] = [];
    for (let t = 0; t <= rootTier; t++) {
      allNodes.push(...(tierBuckets.get(t) ?? []));
    }

    const nodeMap = new Map<string, PositionedNode>();
    allNodes.forEach((n) => nodeMap.set(n.id, n));

    // 3. Implicit gaps (unidentified holders) placed above their respective entity
    resolution.implicitGaps.forEach((gap) => {
      const targetEntity = nodeMap.get(gap.entityId);
      if (!targetEntity) return;

      const gapWidth = 160;
      const gapHeight = 38;
      const offsetX = targetEntity.id === 'ent-g1-bvi' ? 70 : 0;
      const x = targetEntity.x + offsetX;
      const y = targetEntity.y - 74;

      const gapNode: PositionedNode = {
        id: gap.id,
        kind: 'implicitGap',
        tier: Math.max(0, targetEntity.tier - 0.5),
        x,
        y,
        width: gapWidth,
        height: gapHeight,
        implicitGap: gap,
        targetEntityId: targetEntity.id,
      };

      allNodes.push(gapNode);
      nodeMap.set(gap.id, gapNode);
    });

    const cycleEdgeSet = new Set<string>();
    for (const c of resolution.cyclesFound) {
      c.edgeIds.forEach((eid) => cycleEdgeSet.add(eid));
    }

    const allEdges: PositionedEdge[] = [];
    group.relationships.forEach((rel, idx) => {
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

      const strokeWidth = isHot ? 3.2 : 1.3 + 2 * shareFraction;

      let strokeColor = '#8fb0e3'; // entity-owned default
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

      // Compute perimeter points and S-shaped cubic Bézier curve
      let startX = fromNode.x;
      let startY = fromNode.y;
      let endX = toNode.x;
      let endY = toNode.y;
      let pathD = '';
      let midX = 0;
      let midY = 0;

      const sameTier = Math.abs(fromNode.y - toNode.y) < 20;
      if (sameTier) {
        // Horizontal / arched S-curve for reciprocal cross-holdings (Scenario 4)
        const goingRight = toNode.x > fromNode.x;
        const yOffset = goingRight ? -12 : 12;
        startX = fromNode.x + (goingRight ? fromNode.width / 2 : -fromNode.width / 2);
        startY = fromNode.y + yOffset;
        endX = toNode.x + (goingRight ? -toNode.width / 2 - 6 : toNode.width / 2 + 6);
        endY = toNode.y + yOffset;

        const archY = startY + (goingRight ? -46 : 46);
        pathD = `M ${startX} ${startY} C ${(startX + endX) / 2 - 30} ${archY}, ${(startX + endX) / 2 + 30} ${archY}, ${endX} ${endY}`;
        midX = (startX + endX) / 2;
        midY = startY + (goingRight ? -34 : 34);
      } else {
        // Vertical S-shaped cubic Bézier curve from owner bottom perimeter to subject top perimeter
        const fromBottomOffset =
          fromNode.kind === 'person' ? 28 : fromNode.height / 2;
        const toTopOffset =
          toNode.kind === 'person' ? 28 : toNode.height / 2 + 5;

        startX = fromNode.x;
        startY = fromNode.y + fromBottomOffset;
        endX = toNode.x;
        endY = toNode.y - toTopOffset;

        const dy = endY - startY;
        const cp1x = startX;
        const cp1y = startY + dy * 0.48;
        const cp2x = endX;
        const cp2y = endY - dy * 0.48;

        pathD = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
        midX = 0.125 * startX + 0.375 * cp1x + 0.375 * cp2x + 0.125 * endX;
        midY = 0.125 * startY + 0.375 * cp1y + 0.375 * cp2y + 0.125 * endY;
      }

      const labelText = formatSharePct(share);
      const dotDurationSec = 3.5 + ((idx * 0.67) % 3.0);

      allEdges.push({
        rel,
        fromNode,
        toNode,
        pathD,
        midX,
        midY,
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

    // Connector edges for implicit gaps
    resolution.implicitGaps.forEach((gap) => {
      const fromNode = nodeMap.get(gap.id);
      const toNode = nodeMap.get(gap.entityId);
      if (!fromNode || !toNode) return;

      const startX = fromNode.x;
      const startY = fromNode.y + fromNode.height / 2;
      const endX = toNode.x;
      const endY = toNode.y - toNode.height / 2;

      const dy = endY - startY;
      const cpY1 = startY + dy * 0.45;
      const cpY2 = endY - dy * 0.45;
      const pathD = `M ${startX} ${startY} C ${startX} ${cpY1}, ${endX} ${cpY2}, ${endX} ${endY}`;

      const relMock: RelationshipRecord = {
        id: `rel-${gap.id}`,
        subjectId: toNode.id,
        interestedPartyId: fromNode.id,
        interestedPartyType: 'unspecified',
        interests: [
          {
            type: 'shareholding',
            share: { kind: 'exact', value: gap.remainderPct },
            directOrIndirect: 'direct',
            source: 'Inferred unaccounted remainder',
            asOfDate: '2026-10-12',
            confidence: 1.0,
          },
        ],
      };

      allEdges.push({
        rel: relMock,
        fromNode,
        toNode,
        pathD,
        midX: (startX + endX) / 2,
        midY: (startY + endY) / 2,
        labelText: `${formatNumber(gap.remainderPct)}%`,
        strokeWidth: 1.3,
        strokeColor: 'var(--grey)',
        isDashed: true,
        isHistorical: false,
        isHot: false,
        dotColor: 'var(--grey)',
        dotDurationSec: 3.8,
        isCycleEdge: false,
      });
    });

    // Compute bounding box
    let minX = -260;
    let maxX = 260;
    let minY = -80;
    let maxY = rootTier * verticalGap + 90;

    for (const n of allNodes) {
      minX = Math.min(minX, n.x - n.width / 2 - 60);
      maxX = Math.max(maxX, n.x + n.width / 2 + 60);
      minY = Math.min(minY, n.y - n.height / 2 - 50);
      maxY = Math.max(maxY, n.y + n.height / 2 + 65);
    }

    return {
      nodes: allNodes,
      edges: allEdges,
      bounds: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY },
    };
  }, [group, resolution.cyclesFound]);

  // Fit-to-view helper (maximum scale 1.15, with padding)
  const fitToView = () => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const pad = 64;
    const availW = Math.max(200, rect.width - pad * 2);
    const availH = Math.max(200, rect.height - pad * 2);

    const scaleX = availW / bounds.width;
    const scaleY = availH / bounds.height;
    const targetScale = Math.min(1.15, Math.max(0.4, Math.min(scaleX, scaleY)));

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    setTransform({
      x: rect.width / 2 - centerX * targetScale,
      y: rect.height / 2 - centerY * targetScale,
      scale: targetScale,
    });
  };

  useEffect(() => {
    fitToView();
    const handleResize = () => fitToView();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [group.id, bounds.width, bounds.height]);

  // Active path highlight set when a UBO is selected
  const { highlightedNodeSet, highlightedEdgeSet } = useMemo(() => {
    const nSet = new Set<string>();
    const eSet = new Set<string>();
    if (!highlightedPersonId) {
      return { highlightedNodeSet: nSet, highlightedEdgeSet: eSet };
    }
    const resolved = resolvedPersonMap.get(highlightedPersonId);
    if (resolved) {
      for (const path of resolved.paths) {
        path.nodeIds.forEach((id) => nSet.add(id));
        path.edgeIds.forEach((id) => eSet.add(id));
      }
    }
    return { highlightedNodeSet: nSet, highlightedEdgeSet: eSet };
  }, [highlightedPersonId, resolvedPersonMap]);

  // Mouse wheel zoom between 0.4x and 2.6x centred on cursor
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const nextScale = Math.min(2.6, Math.max(0.4, transform.scale * zoomFactor));

    const worldX = (cursorX - transform.x) / transform.scale;
    const worldY = (cursorY - transform.y) / transform.scale;

    setTransform({
      x: cursorX - worldX * nextScale,
      y: cursorY - worldY * nextScale,
      scale: nextScale,
    });
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startX: transform.x,
      startY: transform.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.clientX;
    const dy = e.clientY - dragStartRef.current.clientY;
    setTransform((prev) => ({
      ...prev,
      x: dragStartRef.current!.startX + dx,
      y: dragStartRef.current!.startY + dy,
    }));
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isDragging && dragStartRef.current) {
      const moved =
        Math.hypot(
          e.clientX - dragStartRef.current.clientX,
          e.clientY - dragStartRef.current.clientY
        ) > 4;
      if (!moved && (e.target as Element).tagName === 'svg') {
        onClearHighlight();
      }
    }
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const triggerNodeClick = (node: PositionedNode, e: React.MouseEvent) => {
    e.stopPropagation();
    let severityColor = 'var(--primary)';
    if (node.kind === 'person' && node.person) {
      const r = resolvedPersonMap.get(node.person.id);
      if (node.person.pepStatus !== 'none' || r?.classification === 'POSSIBLE') {
        severityColor = 'var(--amber)';
      } else if (r?.classification === 'DEFINITE') {
        severityColor = 'var(--emerald)';
      }
      onSelectNode({ kind: 'person', record: node.person, resolved: r });
    } else if (node.kind === 'entity' && node.entity) {
      if (node.entity.status === 'dissolved') severityColor = 'var(--rose)';
      onSelectNode({ kind: 'entity', record: node.entity });
    } else if (node.kind === 'unspecified' && node.unspecified) {
      severityColor = 'var(--amber)';
      onSelectNode({ kind: 'unspecified', record: node.unspecified });
    } else if (node.kind === 'implicitGap' && node.implicitGap) {
      severityColor = 'var(--grey)';
      onSelectNode({ kind: 'implicitGap', record: node.implicitGap });
    }
    setRippleNode({ id: node.id, color: severityColor, key: Date.now() });
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden graph-canvas-bg select-none"
    >
      <svg
        key={`${group.id}`}
        className={`w-full h-full block ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setIsDragging(false);
          dragStartRef.current = null;
        }}
      >
        <defs>
          {/* Drop shadows & glow filters */}
          <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#221e33" floodOpacity="0.07" />
          </filter>
          <filter id="root-shadow" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#016EFD" floodOpacity="0.24" />
          </filter>
          <filter id="path-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#016EFD" floodOpacity="0.45" />
          </filter>

          {/* Arrowhead markers */}
          <marker
            id="arrow-emerald"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="var(--emerald)" />
          </marker>
          <marker
            id="arrow-entity"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#8fb0e3" />
          </marker>
          <marker
            id="arrow-amber"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="var(--amber)" />
          </marker>
          <marker
            id="arrow-grey"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="var(--grey)" />
          </marker>
          <marker
            id="arrow-historical"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#c9c2d2" />
          </marker>
        </defs>

        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* EDGES */}
          {edges.map((edge, idx) => {
            const isDimmed =
              highlightedPersonId !== null && !highlightedEdgeSet.has(edge.rel.id);
            const isHighlighted =
              highlightedPersonId !== null && highlightedEdgeSet.has(edge.rel.id);

            const edgeDelay = 0.5 + idx * 0.09;
            const labelDelay = edgeDelay + 0.45;
            const pathDomId = `edge-path-${group.id}-${edge.rel.id}`;

            let markerUrl = 'url(#arrow-entity)';
            if (edge.isHistorical) markerUrl = 'url(#arrow-historical)';
            else if (edge.isHot) markerUrl = 'url(#arrow-amber)';
            else if (edge.rel.interestedPartyType === 'person') markerUrl = 'url(#arrow-emerald)';
            else if (edge.rel.interestedPartyType === 'unspecified') markerUrl = 'url(#arrow-grey)';

            return (
              <g
                key={edge.rel.id}
                style={{
                  opacity: isDimmed ? 0.08 : edge.isHistorical ? 0.45 : 1,
                  transition: 'opacity 0.3s ease',
                }}
              >
                <path
                  id={pathDomId}
                  d={edge.pathD}
                  fill="none"
                  stroke={edge.strokeColor}
                  strokeWidth={isHighlighted ? edge.strokeWidth + 0.8 : edge.strokeWidth}
                  strokeDasharray={
                    edge.isDashed ? '6 4' : undefined
                  }
                  markerEnd={markerUrl}
                  className={edge.isDashed ? '' : 'anim-edge-draw'}
                  style={
                    edge.isDashed
                      ? {
                          animation: `fadeIn 0.5s ease ${edgeDelay}s both`,
                        }
                      : {
                          animationDelay: `${edgeDelay}s`,
                        }
                  }
                />

                {/* Flowing dot along active ownership edges */}
                {!edge.isHistorical && (
                  <circle r="3.2" fill={edge.dotColor} opacity={0.9}>
                    <animateMotion
                      dur={`${edge.dotDurationSec.toFixed(2)}s`}
                      repeatCount="indefinite"
                      path={edge.pathD}
                    />
                  </circle>
                )}

                {/* Edge Label Pill at midpoint */}
                <g
                  transform={`translate(${edge.midX}, ${edge.midY})`}
                  className="anim-edge-label"
                  style={{ animationDelay: `${labelDelay}s` }}
                >
                  <rect
                    x={-edge.labelText.length * 3.4 - 7}
                    y={-10}
                    width={edge.labelText.length * 6.8 + 14}
                    height={20}
                    rx={10}
                    fill="#ffffff"
                    stroke={edge.isHot ? 'var(--amber)' : 'var(--line)'}
                    strokeWidth={1.2}
                  />
                  <text
                    x={0}
                    y={3.5}
                    textAnchor="middle"
                    className="font-mono-code font-semibold"
                    fontSize={10}
                    fill={edge.isHot ? 'var(--amber)' : 'var(--ink)'}
                  >
                    {edge.labelText}
                  </text>
                </g>
              </g>
            );
          })}

          {/* NODES */}
          {nodes.map((node) => {
            const isDimmed =
              highlightedPersonId !== null && !highlightedNodeSet.has(node.id);
            const isOnPath =
              highlightedPersonId !== null && highlightedNodeSet.has(node.id);
            const isSelected = selectedNodeId === node.id;
            const nodeDelay = node.tier * 0.11;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={(e) => triggerNodeClick(node, e)}
                className="cursor-pointer"
                style={{
                  opacity: isDimmed ? 0.16 : 1,
                  transition: 'opacity 0.3s ease',
                  filter: isOnPath ? 'url(#path-glow)' : undefined,
                }}
              >
                <g
                  className="anim-nodein"
                  style={{ animationDelay: `${nodeDelay}s` }}
                >
                  {/* Expanding ripple ring on click ("rip") */}
                  {rippleNode && rippleNode.id === node.id && (
                    <circle
                      key={rippleNode.key}
                      cx={0}
                      cy={0}
                      r={16}
                      fill="none"
                      stroke={rippleNode.color}
                      strokeWidth={2.5}
                      className="anim-rip pointer-events-none"
                    />
                  )}

                  {/* 1. ENTITY NODE */}
                  {node.kind === 'entity' && node.entity && (() => {
                    const ent = node.entity;
                    const isRoot = ent.id === group.rootEntityId;
                    const isDissolved = ent.status === 'dissolved';
                    const w = node.width;
                    const h = node.height;

                    return (
                      <g opacity={isDissolved ? 0.55 : 1}>
                        <rect
                          x={-w / 2}
                          y={-h / 2}
                          width={w}
                          height={h}
                          rx={12}
                          fill={isRoot ? 'var(--primary)' : '#ffffff'}
                          stroke={
                            isSelected
                              ? 'var(--primary)'
                              : isRoot
                              ? 'var(--primary)'
                              : isDissolved
                              ? 'var(--rose)'
                              : '#c4d0e2'
                          }
                          strokeWidth={isSelected ? 2.4 : 1.6}
                          filter={isRoot ? 'url(#root-shadow)' : 'url(#node-shadow)'}
                        />

                        {/* Flag at left */}
                        <text
                          x={-w / 2 + 14}
                          y={-2}
                          fontSize={16}
                          dominantBaseline="central"
                        >
                          {ent.countryFlag}
                        </text>

                        {/* Name across one or two lines */}
                        <text
                          x={-w / 2 + 38}
                          y={ent.displayLines.length > 1 ? -11 : -4}
                          fontSize={isRoot ? 12 : 11.5}
                          fontWeight={600}
                          fill={isRoot ? '#ffffff' : 'var(--ink)'}
                        >
                          {ent.displayLines[0]}
                        </text>
                        {ent.displayLines[1] && (
                          <text
                            x={-w / 2 + 38}
                            y={3}
                            fontSize={isRoot ? 12 : 11.5}
                            fontWeight={600}
                            fill={isRoot ? '#ffffff' : 'var(--ink)'}
                          >
                            {ent.displayLines[1]}
                          </text>
                        )}

                        {/* Subtitle */}
                        <text
                          x={-w / 2 + 38}
                          y={h / 2 - 9}
                          fontSize={9}
                          fontWeight={700}
                          className="font-mono-code"
                          fill={
                            isRoot
                              ? '#cfe3ff'
                              : isDissolved
                              ? 'var(--rose)'
                              : 'var(--ink3)'
                          }
                        >
                          {isRoot
                            ? `ROOT · ${ent.jurisdictionCode}`
                            : isDissolved
                            ? 'DISSOLVED'
                            : `${ent.jurisdictionCode} · ${ent.entityType.toUpperCase()}`}
                        </text>

                        {/* Rose strikethrough line across dissolved entity */}
                        {isDissolved && (
                          <line
                            x1={-w / 2 + 8}
                            y1={0}
                            x2={w / 2 - 8}
                            y2={0}
                            stroke="var(--rose)"
                            strokeWidth={2}
                          />
                        )}
                      </g>
                    );
                  })()}

                  {/* 2. DATA-GAP / UNSPECIFIED OWNER NODE */}
                  {node.kind === 'unspecified' && node.unspecified && (() => {
                    const gap = node.unspecified;
                    const w = node.width;
                    const h = node.height;

                    return (
                      <g>
                        {/* Outer amber dotted ring (2 5) that pulses (warnp) */}
                        <rect
                          x={-w / 2 - 6}
                          y={-h / 2 - 6}
                          width={w + 12}
                          height={h + 12}
                          rx={16}
                          fill="none"
                          stroke="var(--amber)"
                          strokeWidth={1.8}
                          strokeDasharray="2 5"
                          className="anim-warnp"
                        />

                        {/* Dashed grey stroke (6 4), fill #f5f4f1 */}
                        <rect
                          x={-w / 2}
                          y={-h / 2}
                          width={w}
                          height={h}
                          rx={12}
                          fill="#f5f4f1"
                          stroke="var(--grey)"
                          strokeWidth={1.6}
                          strokeDasharray="6 4"
                        />

                        <text
                          x={-w / 2 + 13}
                          y={-2}
                          fontSize={15}
                          dominantBaseline="central"
                        >
                          {gap.countryFlag || '❓'}
                        </text>

                        <text
                          x={-w / 2 + 35}
                          y={-7}
                          fontSize={11}
                          fontWeight={600}
                          fill="var(--ink)"
                        >
                          {gap.label.slice(0, 19)}
                        </text>
                        <text
                          x={-w / 2 + 35}
                          y={6}
                          fontSize={9.5}
                          fontWeight={600}
                          fill="var(--amber)"
                        >
                          GAP · -{gap.estimatedImpactOnCompleteness}% COMPLETENESS
                        </text>
                      </g>
                    );
                  })()}

                  {/* 3. PERSON NODE */}
                  {node.kind === 'person' && node.person && (() => {
                    const per = node.person;
                    const resolved = resolvedPersonMap.get(per.id);
                    const classification = resolved?.classification ?? 'BELOW';
                    const isPep = per.pepStatus !== 'none';

                    // Styling per DESIGN.md
                    let circleFill = '#e8f2ff';
                    let circleStroke = 'var(--primary2)';
                    let textFill = 'var(--primary)';
                    let ringColor: string | null = null;
                    let statusText = `${ formatEffectiveStatus(resolved) }`;
                    let statusColor = 'var(--ink2)';

                    if (classification === 'DEFINITE') {
                      circleFill = 'var(--emerald-s)';
                      circleStroke = 'var(--emerald)';
                      textFill = 'var(--emerald)';
                      ringColor = 'var(--emerald)';
                      statusColor = 'var(--emerald)';
                    } else if (classification === 'POSSIBLE') {
                      circleFill = 'var(--amber-s)';
                      circleStroke = 'var(--amber)';
                      textFill = 'var(--amber)';
                      ringColor = 'var(--amber)';
                      statusColor = 'var(--amber)';
                    }

                    if (isPep) {
                      circleStroke = 'var(--amber)';
                      statusText = `PEP · ${statusText}`;
                      statusColor = 'var(--amber)';
                    }

                    return (
                      <g>
                        {/* Dashed outer ring of radius 32 (3 4) for DEFINITE or POSSIBLE */}
                        {ringColor && (
                          <circle
                            cx={0}
                            cy={0}
                            r={32}
                            fill="none"
                            stroke={ringColor}
                            strokeWidth={1.6}
                            strokeDasharray="3 4"
                          />
                        )}

                        <circle
                          cx={0}
                          cy={0}
                          r={26}
                          fill={circleFill}
                          stroke={circleStroke}
                          strokeWidth={2.2}
                          filter="url(#node-shadow)"
                        />

                        <text
                          x={0}
                          y={1}
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="font-display font-bold"
                          fontSize={13}
                          fill={textFill}
                        >
                          {per.initials}
                        </text>

                        {/* "flag + name" beneath */}
                        <text
                          x={0}
                          y={44}
                          textAnchor="middle"
                          fontSize={11.5}
                          fontWeight={600}
                          fill="var(--ink)"
                        >
                          {per.flag} {per.name}
                        </text>

                        {/* Status line beneath that */}
                        <text
                          x={0}
                          y={58}
                          textAnchor="middle"
                          className="font-mono-code font-bold"
                          fontSize={9.5}
                          fill={statusColor}
                        >
                          {statusText}
                        </text>
                      </g>
                    );
                  })()}

                  {/* 4. IMPLICIT GAP / UNIDENTIFIED HOLDERS NODE */}
                  {node.kind === 'implicitGap' && node.implicitGap && (() => {
                    const gap = node.implicitGap;
                    const w = node.width;
                    const h = node.height;

                    return (
                      <g>
                        {/* Dashed grey card, fill var(--card) */}
                        <rect
                          x={-w / 2}
                          y={-h / 2}
                          width={w}
                          height={h}
                          rx={10}
                          fill="var(--card)"
                          stroke="var(--grey)"
                          strokeWidth={1.5}
                          strokeDasharray="5 3"
                        />

                        <text
                          x={-w / 2 + 13}
                          y={-1}
                          fontSize={13}
                          dominantBaseline="central"
                        >
                          ❓
                        </text>

                        <text
                          x={-w / 2 + 32}
                          y={-5}
                          fontSize={10.5}
                          fontWeight={600}
                          fill="var(--ink)"
                        >
                          Unidentified holders · {formatNumber(gap.remainderPct)}%
                        </text>

                        <text
                          x={-w / 2 + 32}
                          y={8}
                          fontSize={8.5}
                          fontWeight={500}
                          fill="var(--ink3)"
                        >
                          May include &lt; threshold
                        </text>
                      </g>
                    );
                  })()}
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Bottom-left Viewport Controls */}
      <div
        className="absolute bottom-4 left-4 flex items-center gap-1 p-1 rounded-xl z-10"
        style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--sh1)',
        }}
      >
        <button
          type="button"
          onClick={() =>
            setTransform((prev) => ({
              ...prev,
              scale: Math.min(2.6, prev.scale * 1.18),
            }))
          }
          className="p-1.5 rounded-lg hover:bg-[var(--bg2)] transition-colors"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn className="w-4 h-4" style={{ color: 'var(--ink2)' }} />
        </button>
        <span
          className="px-2 text-[11px] font-mono-code font-semibold"
          style={{ color: 'var(--ink2)' }}
        >
          {Math.round(transform.scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() =>
            setTransform((prev) => ({
              ...prev,
              scale: Math.max(0.4, prev.scale / 1.18),
            }))
          }
          className="p-1.5 rounded-lg hover:bg-[var(--bg2)] transition-colors"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-4 h-4" style={{ color: 'var(--ink2)' }} />
        </button>
        <button
          type="button"
          onClick={fitToView}
          className="p-1.5 rounded-lg hover:bg-[var(--bg2)] transition-colors border-l"
          style={{ borderColor: 'var(--line)' }}
          title="Fit graph to view"
          aria-label="Fit graph to view"
        >
          <Maximize2 className="w-4 h-4" style={{ color: 'var(--ink2)' }} />
        </button>
      </div>
    </div>
  );
};

function formatEffectiveStatus(resolved?: ResolvedPersonUbo): string {
  if (!resolved) return 'BELOW';
  const minR = Math.round(resolved.totalMinPct * 10) / 10;
  const maxR = Math.round(resolved.totalMaxPct * 10) / 10;
  const valStr =
    Math.abs(maxR - minR) < 0.05
      ? `${minR.toFixed(1)}%`
      : `${minR.toFixed(1)}–${maxR.toFixed(1)}%`;
  return `${resolved.classification} · ${valStr}`;
}
