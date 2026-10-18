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
import {
  computeGraphLayout,
  formatPersonStatus,
  getCountryCode,
  getPersonDisplayLines,
  GraphLayoutStats,
  MeasuredNodeDimensions,
  PositionedEdge,
  PositionedNode,
} from '../engine/graphLayoutEngine';

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
  rippleTrigger?: { nodeId: string; color: string } | null;
  density?: 'compact' | 'comfortable';
  onLayoutChange?: (stats: GraphLayoutStats) => void;
  expandedNodeIds?: Set<string>;
  onToggleExpandNode?: (nodeId: string) => void;
}

/**
 * Wraps text into multiple lines if longer than maxLineChars
 */
export function wrapTextToLines(text: string, maxLineChars: number = 20): string[] {
  if (!text || text.length <= maxLineChars) return [text];
  const words = text.split(/\s+/);
  if (words.length <= 1) return [text];

  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxLineChars) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

export const OwnershipGraph: React.FC<OwnershipGraphProps> = ({
  group,
  resolution,
  highlightedPersonId,
  selectedNodeId,
  onSelectNode,
  onClearHighlight,
  rippleTrigger,
  density = 'compact',
  onLayoutChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null);
  const [rippleNode, setRippleNode] = useState<{ id: string; color: string; key: number } | null>(null);

  const [measuredDimensions, setMeasuredDimensions] = useState<Map<string, MeasuredNodeDimensions>>(new Map());
  const measuredDimensionsRef = useRef<Map<string, MeasuredNodeDimensions>>(new Map());

  useEffect(() => {
    if (rippleTrigger) {
      setRippleNode({
        id: rippleTrigger.nodeId,
        color: rippleTrigger.color,
        key: Date.now(),
      });
      const timer = setTimeout(() => setRippleNode(null), 1200);
      return () => clearTimeout(timer);
    }
  }, [rippleTrigger]);

  const resolvedPersonMap = useMemo(() => {
    const m = new Map<string, ResolvedPersonUbo>();
    if (!resolution?.persons) return m;
    for (const p of resolution.persons) {
      m.set(p.person.id, p);
    }
    return m;
  }, [resolution]);

  // Compute deterministic tiered tree layout with measured node dimensions
  const { nodes, edges, bounds, stats } = useMemo(() => {
    return computeGraphLayout(group, resolution, { density, measuredDimensions });
  }, [group, resolution, density, measuredDimensions]);

  useEffect(() => {
    if (onLayoutChange && stats) {
      onLayoutChange(stats);
    }
  }, [stats, onLayoutChange]);

  // DOM measurement pass with getComputedTextLength() and document.fonts.ready re-measurement
  useEffect(() => {
    let active = true;

    const measureAll = () => {
      if (!active) return;
      const nextMap = new Map<string, MeasuredNodeDimensions>();
      let changed = false;

      for (const node of nodes) {
        const el = document.getElementById(`node-text-${node.id}`);
        if (el) {
          try {
            let maxTextLength = 0;
            // Measure text content using getComputedTextLength()
            const textElements = el.querySelectorAll('text, tspan');
            textElements.forEach((nodeEl) => {
              const textEl = nodeEl as unknown as SVGTextContentElement;
              if (typeof textEl.getComputedTextLength === 'function') {
                const len = textEl.getComputedTextLength();
                if (len > maxTextLength) {
                  maxTextLength = len;
                }
              }
            });

            // Also check getBBox for vertical span and fallback
            let bboxHeight = 0;
            let bboxWidth = 0;
            if (typeof (el as unknown as SVGGraphicsElement).getBBox === 'function') {
              const bbox = (el as unknown as SVGGraphicsElement).getBBox();
              bboxHeight = bbox.height;
              bboxWidth = bbox.width;
            }

            const effectiveTextWidth = Math.max(maxTextLength, bboxWidth);
            if (effectiveTextWidth > 0) {
              const isEntity = node.kind === 'entity';
              const isUnspecified = node.kind === 'unspecified';
              // Left offset + right padding (at least 16px right padding)
              const paddingX = isEntity ? 58 : isUnspecified ? 51 : 32;
              const paddingY = 22;

              // Enforce 154px minimum width requirement
              const w = Math.max(154, Math.ceil(effectiveTextWidth + paddingX));
              const tspanCount = el.querySelectorAll('tspan').length;
              const lines = Math.max(1, tspanCount) + 1;
              const h = Math.max(52, Math.ceil(Math.max(bboxHeight + paddingY, lines * 15 + 22)));

              // Apply calculated dimensions directly to .nbody rect elements
              const nodeContainer = el.closest('g.cursor-pointer') || el.parentElement;
              if (nodeContainer) {
                const nbody = nodeContainer.querySelector('rect.nbody');
                if (nbody) {
                  nbody.setAttribute('width', String(w));
                  nbody.setAttribute('height', String(h));
                  nbody.setAttribute('x', String(-w / 2));
                  nbody.setAttribute('y', String(-h / 2));
                }
              }

              nextMap.set(node.id, { width: w, height: h });

              const prev = measuredDimensionsRef.current.get(node.id);
              if (!prev || Math.abs(prev.width - w) > 1 || Math.abs(prev.height - h) > 1) {
                changed = true;
              }
            }
          } catch {
            // Ignore unmounted or hidden elements
          }
        }
      }

      if (changed) {
        measuredDimensionsRef.current = nextMap;
        setMeasuredDimensions(new Map(nextMap));
      }
    };

    const rafId = requestAnimationFrame(measureAll);

    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (active) measureAll();
      });
    }

    window.addEventListener('resize', measureAll);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measureAll);
    };
  }, [group.id, resolution, nodes.length]);

  // Fit-to-view helper ensuring the entire ownership graph fits cleanly in view
  const fitToView = () => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const padX = 40;
    const padY = 32;
    const availW = Math.max(100, rect.width - padX * 2);
    const availH = Math.max(100, rect.height - padY * 2);

    const scaleX = availW / bounds.width;
    const scaleY = availH / bounds.height;
    const targetScale = Math.min(1.0, Math.max(0.35, Math.min(scaleX, scaleY)));

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

  // Active path highlight set when a UBO, person or data-gap is selected
  const { highlightedNodeSet, highlightedEdgeSet } = useMemo(() => {
    const nSet = new Set<string>();
    const eSet = new Set<string>();
    if (!highlightedPersonId) {
      return { highlightedNodeSet: nSet, highlightedEdgeSet: eSet };
    }

    // Root entity is always lit on UBO / gap path to root
    nSet.add(group.rootEntityId);

    const resolved = resolvedPersonMap.get(highlightedPersonId);
    if (resolved) {
      for (const path of resolved.paths) {
        path.nodeIds.forEach((id) => nSet.add(id));
        path.edgeIds.forEach((id) => eSet.add(id));
      }
    } else {
      // Walk path from entity or data gap down to root
      nSet.add(highlightedPersonId);
      const queue = [highlightedPersonId];
      const visited = new Set<string>([highlightedPersonId]);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const rel of group.relationships) {
          if (rel.interestedPartyId === curr) {
            eSet.add(rel.id);
            if (!visited.has(rel.subjectId)) {
              visited.add(rel.subjectId);
              nSet.add(rel.subjectId);
              queue.push(rel.subjectId);
            }
          }
        }
      }
    }
    return { highlightedNodeSet: nSet, highlightedEdgeSet: eSet };
  }, [highlightedPersonId, resolvedPersonMap, group]);

  // Mouse wheel zoom between 0.38x and 2.6x
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const worldX = (cursorX - transform.x) / transform.scale;
    const worldY = (cursorY - transform.y) / transform.scale;

    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const nextScale = Math.min(2.6, Math.max(0.38, transform.scale * factor));

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
    const dragStart = dragStartRef.current;
    if (!isDragging || !dragStart) return;
    const dx = e.clientX - dragStart.clientX;
    const dy = e.clientY - dragStart.clientY;
    const targetX = dragStart.startX + dx;
    const targetY = dragStart.startY + dy;
    setTransform((prev) => ({
      ...prev,
      x: targetX,
      y: targetY,
    }));
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    const dragStart = dragStartRef.current;
    if (isDragging && dragStart) {
      const moved =
        Math.hypot(
          e.clientX - dragStart.clientX,
          e.clientY - dragStart.clientY
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
      if (node.entity.status === 'dissolved' || node.entity.status === 'sanctioned') {
        severityColor = 'var(--rose)';
      }
      onSelectNode({ kind: 'entity', record: node.entity });
    } else if (node.kind === 'unspecified' && node.unspecified) {
      severityColor = 'var(--amber)';
      onSelectNode({ kind: 'unspecified', record: node.unspecified });
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
          {/* Arrowhead Markers matching prototype style */}
          <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#a89bd0" />
          </marker>
          <marker id="arrGreen" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#059669" />
          </marker>
          <marker id="arrHot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#d97706" />
          </marker>
          <marker id="arrGrey" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#9995a8" />
          </marker>

          {/* Drop shadows & glow filters */}
          <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#221e33" floodOpacity="0.09" />
          </filter>
          <filter id="root-shadow" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#6d28d9" floodOpacity="0.25" />
          </filter>
          <filter id="sanction-shadow" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="3" stdDeviation="6" floodColor="#f4553f" floodOpacity="0.25" />
          </filter>
          <filter id="path-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#0284c7" floodOpacity="0.5" />
          </filter>
        </defs>

        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* 1. EDGES LAYER */}
          {edges.map((edge) => {
            const isHighlighted =
              highlightedEdgeSet.has(edge.rel.id) ||
              (highlightedNodeSet.has(edge.fromNode.id) && highlightedNodeSet.has(edge.toNode.id));
            const isDimmed =
              highlightedPersonId != null && !isHighlighted;

            const isPersonPath = edge.fromNode.kind === 'person' || edge.rel.interestedPartyType === 'person';

            const activeColor = edge.isHot
              ? 'var(--amber)'
              : isPersonPath
              ? '#059669'
              : edge.isHistorical
              ? '#c9c2d2'
              : '#0284c7';

            const markerEnd = edge.isHot
              ? 'url(#arrHot)'
              : isPersonPath
              ? 'url(#arrGreen)'
              : edge.isHistorical || edge.isDashed
              ? 'url(#arrGrey)'
              : 'url(#arr)';

            // Requirement 2: Pill width = characters x 6.4 + 12, height = 18
            const pillW = Math.max(48, Math.ceil(edge.labelText.length * 6.4 + 12));
            const pillH = 18;

            return (
              <g
                key={edge.rel.id}
                opacity={isDimmed ? 0.08 : 1}
                className="transition-opacity duration-300"
              >
                {/* Glow underlay if highlighted */}
                {isHighlighted && (
                  <path
                    d={edge.pathD}
                    fill="none"
                    stroke={activeColor}
                    strokeWidth={edge.strokeWidth + 4}
                    opacity={0.4}
                    filter="url(#path-glow)"
                  />
                )}

                {/* Base SVG S-Curve Path */}
                <path
                  d={edge.pathD}
                  fill="none"
                  stroke={isHighlighted ? activeColor : activeColor}
                  strokeWidth={isHighlighted ? edge.strokeWidth + 1.2 : edge.strokeWidth}
                  strokeDasharray={edge.isDashed ? '5 4' : undefined}
                  markerEnd={markerEnd}
                />

                {/* Flowing animated dot along edge */}
                {!edge.isHistorical && (
                  <circle r={edge.isHot ? 3.2 : 2.5} fill={isHighlighted ? activeColor : isPersonPath ? '#059669' : edge.dotColor}>
                    <animateMotion
                      path={edge.pathD}
                      dur={`${edge.dotDurationSec}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                )}

                {/* Requirement 2: Edge Shareholding Percentage Pill sitting ON edge */}
                <g transform={`translate(${edge.midX}, ${edge.midY})`}>
                  <rect
                    x={-pillW / 2}
                    y={-pillH / 2}
                    width={pillW}
                    height={pillH}
                    rx={6}
                    fill="#ffffff"
                    stroke="var(--line)"
                    strokeWidth={1}
                    filter="url(#node-shadow)"
                  />
                  <text
                    x={0}
                    y={0.5}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={10}
                    fontWeight={600}
                    className="font-mono-code"
                    fill={edge.isHot ? '#b45309' : 'var(--ink)'}
                  >
                    {edge.labelText}
                  </text>
                </g>
              </g>
            );
          })}

          {/* 2. NODES LAYER */}
          {nodes.map((node, idx) => {
            const isSelected = selectedNodeId === node.id;
            const isHighlighted = highlightedNodeSet.has(node.id);
            const isDimmed = highlightedPersonId != null && !isHighlighted;
            const nodeDelay = Math.min(0.35, idx * 0.04);

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                opacity={isDimmed ? 0.16 : 1}
                className="transition-opacity duration-300"
              >
                <g
                  className="cursor-pointer"
                  onClick={(e) => triggerNodeClick(node, e)}
                >
                  <g
                    className="anim-nodein"
                    style={{ animationDelay: `${nodeDelay}s` }}
                  >
                    {/* Soft glow for lit nodes during UBO path highlight */}
                    {isHighlighted && (
                      <rect
                        x={-node.width / 2 - 4}
                        y={-node.height / 2 - 4}
                        width={node.width + 8}
                        height={node.height + 8}
                        rx={16}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth={2.5}
                        filter="url(#path-glow)"
                      />
                    )}

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

                    {/* Requirement 1: ENTITY NODE */}
                    {node.kind === 'entity' && node.entity && (() => {
                      const ent = node.entity;
                      const isRoot = ent.id === group.rootEntityId;
                      const isDissolved = ent.status === 'dissolved';
                      const isSanctioned = ent.status === 'sanctioned' || Boolean(ent.sanctionsProgramme);
                      const w = node.width;
                      const h = node.height;
                      const code = getCountryCode(ent.countryFlag || ent.jurisdictionCode);

                      const nameLines = wrapTextToLines(ent.name, 22);
                      const subtitleText = isSanctioned
                        ? `Sanctioned · ${ent.jurisdictionCode}`
                        : isRoot
                        ? `ROOT · ${ent.jurisdictionCode}`
                        : isDissolved
                        ? `Dissolved · ${ent.jurisdictionCode}`
                        : `${ent.jurisdictionCode}`;

                      return (
                        <g opacity={isDissolved ? 0.55 : 1}>
                          <rect
                            x={-w / 2}
                            y={-h / 2}
                            width={w}
                            height={h}
                            rx={12}
                            fill={isSanctioned ? '#fff8f7' : isRoot ? '#6d28d9' : '#ffffff'}
                            stroke={
                              isSelected
                                ? 'var(--primary)'
                                : isSanctioned
                                ? 'var(--rose)'
                                : isRoot
                                ? '#5b21b6'
                                : isDissolved
                                ? 'var(--rose)'
                                : 'var(--line)'
                            }
                            strokeWidth={isSanctioned ? 2 : isSelected ? 2.2 : 1.4}
                            className="nbody"
                            style={{
                              filter: isSanctioned
                                ? 'url(#sanction-shadow)'
                                : isRoot
                                ? 'url(#root-shadow)'
                                : 'url(#node-shadow)',
                            }}
                          />

                          {/* Requirement 1: Jurisdiction code at left (x+13, 11px, --ink3 grey, not purple!) */}
                          <text
                            x={-w / 2 + 13}
                            y={-h / 2 + 18}
                            fontSize={11}
                            fontWeight={700}
                            fill={isRoot ? '#e9d5ff' : 'var(--ink3)'}
                            className="font-mono-code"
                          >
                            {code}
                          </text>

                          {/* Requirement 1: Entity name starting at x+36, Inter 600 at 11px (12px for root), line height 14px */}
                          <text
                            x={-w / 2 + 36}
                            y={-h / 2 + 18}
                            fontSize={isRoot ? 12 : 11}
                            fontWeight={600}
                            fill={isSanctioned ? 'var(--rose)' : isRoot ? '#ffffff' : 'var(--ink)'}
                          >
                            {nameLines.slice(0, 2).map((line, lIdx) => (
                              <tspan key={lIdx} x={-w / 2 + 36} dy={lIdx === 0 ? 0 : 14}>
                                {line}
                              </tspan>
                            ))}
                          </text>

                          {/* Requirement 1: Jurisdiction subtitle on bottom line (x+36, y+h-7) in --ink3 */}
                          <text
                            x={-w / 2 + 36}
                            y={h / 2 - 7}
                            fontSize={9}
                            fontWeight={600}
                            className="font-mono-code"
                            fill={isRoot ? '#e9d5ff' : isSanctioned ? 'var(--rose)' : 'var(--ink3)'}
                          >
                            {subtitleText}
                          </text>

                          {/* Strikethrough for dissolved entity */}
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

                          {/* Requirement 3: Attached "Unidentified holders" tag on TOP-RIGHT corner of entity, offset 8px up and inward */}
                          {node.implicitGap && !isSanctioned && (() => {
                            const gap = node.implicitGap;
                            const pillText = `? ${formatNumber(gap.remainderPct)}% unidentified`;
                            const pillW = Math.max(110, Math.ceil(pillText.length * 6.0 + 16));
                            const pillH = 18;

                            // TOP-RIGHT attachment offset 8px up and inward clear of top-centre (x=0)
                            const tagX = Math.max(14 + pillW / 2, w / 2 - pillW / 2 - 4);
                            const tagY = -h / 2 - 14;

                            return (
                              <g
                                className="cursor-pointer"
                                onClick={(evt) => {
                                  evt.stopPropagation();
                                  onSelectNode({ kind: 'implicitGap', record: gap });
                                }}
                              >
                                <line
                                  x1={tagX}
                                  y1={-h / 2}
                                  x2={tagX}
                                  y2={tagY + pillH / 2}
                                  stroke="var(--amber)"
                                  strokeWidth={1.2}
                                  strokeDasharray="2 2"
                                />
                                <rect
                                  x={tagX - pillW / 2}
                                  y={tagY - pillH / 2}
                                  width={pillW}
                                  height={pillH}
                                  rx={6}
                                  fill="#ffffff"
                                  stroke="var(--amber)"
                                  strokeWidth={1.2}
                                  strokeDasharray="3 3"
                                />
                                <text
                                  x={tagX}
                                  y={tagY + 0.5}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fontSize={10}
                                  fontWeight={600}
                                  fill="var(--amber)"
                                  className="font-mono-code"
                                >
                                  {pillText}
                                </text>
                              </g>
                            );
                          })()}
                        </g>
                      );
                    })()}

                    {/* Requirement 1: EXPLICIT DATA-GAP / UNSPECIFIED OWNER NODE */}
                    {node.kind === 'unspecified' && node.unspecified && (() => {
                      const gap = node.unspecified;
                      const w = node.width;
                      const h = node.height;
                      const labelLines = wrapTextToLines(gap.label, 22);

                      return (
                        <g>
                          {/* Pulsing amber dotted outer ring offset 5px */}
                          <rect
                            x={-w / 2 - 5}
                            y={-h / 2 - 5}
                            width={w + 10}
                            height={h + 10}
                            rx={15}
                            fill="none"
                            stroke="var(--amber)"
                            strokeWidth={1.5}
                            strokeDasharray="2 4"
                            className="anim-warnp"
                          />
                          {/* Dashed grey stroke, #f5f4f1 fill */}
                          <rect
                            x={-w / 2}
                            y={-h / 2}
                            width={w}
                            height={h}
                            rx={12}
                            fill="#f5f4f1"
                            stroke="var(--grey)"
                            strokeWidth={1.4}
                            strokeDasharray="6 4"
                            className="nbody"
                            style={{
                              filter: 'url(#node-shadow)',
                            }}
                          />
                          <text
                            x={-w / 2 + 13}
                            y={-h / 2 + 18}
                            fontSize={11}
                            fontWeight={700}
                            fill="var(--ink3)"
                            className="font-mono-code"
                          >
                            {gap.countryFlag || '❓'}
                          </text>

                          <text
                            x={-w / 2 + 36}
                            y={-h / 2 + 18}
                            fontSize={11}
                            fontWeight={600}
                            fill="var(--ink)"
                          >
                            {labelLines.slice(0, 2).map((line, lIdx) => (
                              <tspan key={lIdx} x={-w / 2 + 36} dy={lIdx === 0 ? 0 : 14}>
                                {line}
                              </tspan>
                            ))}
                          </text>
                          <text
                            x={-w / 2 + 36}
                            y={h / 2 - 7}
                            fontSize={9}
                            fontWeight={600}
                            fill="var(--amber)"
                            className="font-mono-code"
                          >
                            GAP · -{gap.estimatedImpactOnCompleteness}% COMPLETENESS
                          </text>
                        </g>
                      );
                    })()}

                    {/* Requirement 1: PERSON NODE (Stays as now) */}
                    {node.kind === 'person' && node.person && (() => {
                      const per = node.person;
                      const resolved = resolvedPersonMap.get(per.id);
                      const isUbo = resolved?.classification === 'DEFINITE' || (resolved?.totalMaxPct ?? 0) >= 25;
                      const isPep = per.pepStatus !== 'none';

                      let circleFill = '#f0efec';
                      let circleStroke = '#a78bfa';
                      let textFill = '#6d28d9';
                      let ringColor: string | null = null;
                      let statusText = node.personStatusText || formatPersonStatus(per, resolved);
                      let statusColor = 'var(--ink3)';

                      if (isUbo) {
                        circleFill = '#e6f6ef';
                        circleStroke = 'var(--emerald)';
                        textFill = 'var(--emerald)';
                        ringColor = 'var(--emerald)';
                        statusColor = 'var(--emerald)';
                      } else if (resolved?.classification === 'POSSIBLE') {
                        circleFill = 'var(--amber-s)';
                        circleStroke = 'var(--amber)';
                        textFill = 'var(--amber)';
                        ringColor = 'var(--amber)';
                        statusColor = 'var(--amber)';
                      }

                      if (isPep) {
                        circleStroke = 'var(--amber)';
                        statusColor = 'var(--amber)';
                      }

                      const displayLines = node.personDisplayLines || getPersonDisplayLines(per.name, per.flag || per.nationality);
                      const haloW = Math.max(90, node.footprint.width - 8);
                      const isTwoLines = displayLines.length > 1;

                      return (
                        <g id={`card-person-${per.id}`}>
                          {/* Dashed outer ring for UBO / Definite / Possible / PEP */}
                          {ringColor && (
                            <circle
                              cx={0}
                              cy={0}
                              r={32}
                              fill="none"
                              stroke={ringColor}
                              strokeWidth={1.4}
                              strokeDasharray="3 4"
                              opacity={0.85}
                            />
                          )}

                          {/* Avatar Circle */}
                          <circle
                            cx={0}
                            cy={0}
                            r={26}
                            fill={circleFill}
                            stroke={circleStroke}
                            strokeWidth={2}
                            filter="url(#node-shadow)"
                          />

                          {/* Initials in center */}
                          <text
                            x={0}
                            y={1}
                            textAnchor="middle"
                            dominantBaseline="central"
                            className="font-display font-bold"
                            fontSize={12}
                            fill={textFill}
                          >
                            {per.initials}
                          </text>

                          {/* Soft background halo */}
                          <rect
                            x={-haloW / 2}
                            y={31}
                            width={haloW}
                            height={isTwoLines ? 44 : 32}
                            rx={6}
                            fill="#ffffff"
                            opacity={0.95}
                          />

                          {/* Person text group */}
                          <g id={`node-text-${node.id}`}>
                            <text
                              x={0}
                              y={isTwoLines ? 41 : 42}
                              textAnchor="middle"
                              fontSize={11}
                              fontWeight={600}
                              fill="var(--ink)"
                            >
                              {displayLines[0]}
                            </text>

                            {isTwoLines && (
                              <text
                                x={0}
                                y={53}
                                textAnchor="middle"
                                fontSize={11}
                                fontWeight={600}
                                fill="var(--ink)"
                              >
                                {displayLines[1]}
                              </text>
                            )}

                            <text
                              x={0}
                              y={isTwoLines ? 67 : 56}
                              textAnchor="middle"
                              className="font-mono-code font-semibold"
                              fontSize={9.5}
                              fill={statusColor}
                            >
                              {statusText}
                            </text>
                          </g>
                        </g>
                      );
                    })()}
                  </g>
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
          className="p-1.5 rounded-lg hover:bg-[var(--bg2)] transition-colors cursor-pointer"
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
              scale: Math.max(0.38, prev.scale / 1.18),
            }))
          }
          className="p-1.5 rounded-lg hover:bg-[var(--bg2)] transition-colors cursor-pointer"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-4 h-4" style={{ color: 'var(--ink2)' }} />
        </button>
        <div className="w-[1px] h-4 bg-[var(--line)] mx-0.5" />
        <button
          type="button"
          onClick={fitToView}
          className="p-1.5 rounded-lg hover:bg-[var(--bg2)] transition-colors cursor-pointer"
          title="Fit to view"
          aria-label="Fit to view"
        >
          <Maximize2 className="w-4 h-4" style={{ color: 'var(--ink2)' }} />
        </button>
      </div>
    </div>
  );
};
