import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import seedJson from '../data/bods-seed.json';
import { CorporateGroupSeed, BodsPerson, RelationshipRecord } from '../types/bods';
import { resolveBeneficialOwnership } from './uboEngine';
import { computeGraphLayout, GraphLayoutResult, PositionedNode } from './graphLayoutEngine';

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

function validateGroupGraphLayout(group: CorporateGroupSeed, stageLabel: string): GraphLayoutResult {
  const resolution = resolveBeneficialOwnership(group, 25);
  const layout = computeGraphLayout(group, resolution);

  assert.ok(layout.nodes.length > 0, `[${stageLabel}] Group ${group.id} must produce positioned nodes`);

  // 1. Assert No Node Footprints Overlap across all node pairs
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i];
      const b = layout.nodes[j];

      const boxA = {
        minX: a.x - a.footprint.leftOffset,
        maxX: a.x + a.footprint.rightOffset,
        minY: a.y - a.footprint.topOffset,
        maxY: a.y + a.footprint.bottomOffset,
      };

      const boxB = {
        minX: b.x - b.footprint.leftOffset,
        maxX: b.x + b.footprint.rightOffset,
        minY: b.y - b.footprint.topOffset,
        maxY: b.y + b.footprint.bottomOffset,
      };

      const intersects =
        boxA.minX < boxB.maxX &&
        boxA.maxX > boxB.minX &&
        boxA.minY < boxB.maxY &&
        boxA.maxY > boxB.minY;

      assert.ok(
        !intersects,
        `[${stageLabel}] Group ${group.id}: Node "${a.id}" footprint overlaps with Node "${b.id}" footprint`
      );
    }
  }

  // 2. Assert Every Edge Label lies ON its own edge path
  for (const edge of layout.edges) {
    const sameTier = Math.abs(edge.fromNode.y - edge.toNode.y) < 20;

    let p0x: number, p0y: number, p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number;

    if (sameTier) {
      const goingRight = edge.toNode.x > edge.fromNode.x;
      const yOffset = goingRight ? -12 : 12;
      const startX = edge.fromNode.x + (goingRight ? edge.fromNode.width / 2 : -edge.fromNode.width / 2);
      const startY = edge.fromNode.y + yOffset;
      const endX = edge.toNode.x + (goingRight ? -edge.toNode.width / 2 - 6 : edge.toNode.width / 2 + 6);
      const endY = edge.toNode.y + yOffset;
      const archY = startY + (goingRight ? -48 : 48);

      p0x = startX; p0y = startY;
      p1x = (startX + endX) / 2 - 25; p1y = archY;
      p2x = (startX + endX) / 2 + 25; p2y = archY;
      p3x = endX; p3y = endY;
    } else {
      const fromY = edge.fromNode.y + (edge.fromNode.kind === 'person' ? 26 : edge.fromNode.height / 2);
      const toY = edge.toNode.y - (edge.toNode.kind === 'person' ? 26 : edge.toNode.height / 2);
      const mY = (fromY + toY) / 2;

      p0x = edge.fromNode.x; p0y = fromY;
      p1x = edge.fromNode.x; p1y = mY;
      p2x = edge.toNode.x; p2y = mY;
      p3x = edge.toNode.x; p3y = toY;
    }

    // Search parameter t in [0.35, 0.65]
    let minDistance = Infinity;
    for (let step = 0; step <= 100; step++) {
      const t = 0.35 + (step / 100) * 0.3;
      const pt = evaluateCubicBezier(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, t);
      const dist = Math.hypot(edge.midX - pt.x, edge.midY - pt.y);
      if (dist < minDistance) minDistance = dist;
    }

    assert.ok(
      minDistance < 15,
      `[${stageLabel}] Group ${group.id}: Label "${edge.labelText}" on edge ${edge.rel.id} is off its curve (dist: ${minDistance.toFixed(1)}px)`
    );
  }

  // 3. Assert No Tag Overlaps an edge or label
  for (const node of layout.nodes) {
    if (node.implicitGap) {
      const gap = node.implicitGap;
      const pillText = `? ${gap.remainderPct}% unidentified`;
      const pillW = Math.max(110, Math.ceil(pillText.length * 6.0 + 16));
      const pillH = 18;

      const tagX = Math.max(14 + pillW / 2, node.width / 2 - pillW / 2 - 4) + node.x;
      const tagY = -node.height / 2 - 14 + node.y;

      const tagBox = {
        minX: tagX - pillW / 2,
        maxX: tagX + pillW / 2,
        minY: tagY - pillH / 2,
        maxY: tagY + pillH / 2,
      };

      for (const edge of layout.edges) {
        const labelW = edge.labelText.length * 6.4 + 12;
        const labelBox = {
          minX: edge.midX - labelW / 2,
          maxX: edge.midX + labelW / 2,
          minY: edge.midY - 9,
          maxY: edge.midY + 9,
        };

        const tagLabelOverlap =
          tagBox.minX < labelBox.maxX &&
          tagBox.maxX > labelBox.minX &&
          tagBox.minY < labelBox.maxY &&
          tagBox.maxY > labelBox.minY;

        assert.ok(
          !tagLabelOverlap,
          `[${stageLabel}] Group ${group.id}: Unidentified holders tag on "${node.id}" overlaps with edge label "${edge.labelText}"`
        );
      }
    }
  }

  // 4. Assert No Text Truncation across all nodes
  for (const node of layout.nodes) {
    if (node.kind === 'person' && node.person) {
      assert.ok(node.personStatusText, `Person ${node.person.id} must have status text`);
      assert.ok(
        !node.personStatusText.includes('...'),
        `Person ${node.person.id} status text truncated: "${node.personStatusText}"`
      );
      for (const line of node.personDisplayLines || []) {
        assert.ok(!line.includes('...'), `Person ${node.person.id} name line truncated: "${line}"`);
      }
    }

    if (node.kind === 'entity' && node.entity) {
      for (const line of node.entity.displayLines) {
        assert.ok(!line.includes('...'), `Entity ${node.entity.id} line truncated: "${line}"`);
      }
    }
  }

  // 5. Assert Vertical & Horizontal Spacing Rules
  const tierMap = new Map<number, PositionedNode[]>();
  for (const node of layout.nodes) {
    const list = tierMap.get(node.tier) || [];
    list.push(node);
    tierMap.set(node.tier, list);
  }

  // Horizontal clear space check (>= 56px)
  for (const [tier, tierNodes] of tierMap.entries()) {
    const sorted = [...tierNodes].sort((a, b) => a.x - b.x);
    for (let k = 0; k < sorted.length - 1; k++) {
      const leftNode = sorted[k];
      const rightNode = sorted[k + 1];
      const leftEdge = leftNode.x + leftNode.footprint.rightOffset;
      const rightEdge = rightNode.x - rightNode.footprint.leftOffset;
      const clearHoriz = rightEdge - leftEdge;
      assert.ok(
        clearHoriz >= 55.9,
        `[${stageLabel}] Group ${group.id}: Tier ${tier} horizontal clear space between ${leftNode.id} and ${rightNode.id} is ${clearHoriz.toFixed(1)}px (must be >= 56px)`
      );
    }
  }

  // Vertical clear space check (>= 100px between adjacent tiers)
  const tiers = Array.from(tierMap.keys()).sort((a, b) => a - b);
  for (let k = 0; k < tiers.length - 1; k++) {
    const upperTier = tiers[k];
    const lowerTier = tiers[k + 1];
    const upperNodes = tierMap.get(upperTier)!;
    const lowerNodes = tierMap.get(lowerTier)!;

    const maxUpperBottom = Math.max(...upperNodes.map((n) => n.y + n.footprint.bottomOffset));
    const minLowerTop = Math.min(...lowerNodes.map((n) => n.y - n.footprint.topOffset));
    const clearVert = minLowerTop - maxUpperBottom;

    assert.ok(
      clearVert >= 99.9,
      `[${stageLabel}] Group ${group.id}: Vertical clear space between tier ${upperTier} and tier ${lowerTier} is ${clearVert.toFixed(1)}px (must be >= 100px)`
    );

    // Centre-to-centre distance check (roughly 165 to 200px per tier step)
    const upperCenterY = upperNodes[0].y;
    const lowerCenterY = lowerNodes[0].y;
    const tierStep = lowerTier - upperTier;
    const perTierCenterDist = (lowerCenterY - upperCenterY) / tierStep;
    assert.ok(
      perTierCenterDist >= 150 && perTierCenterDist <= 220,
      `[${stageLabel}] Group ${group.id}: Centre-to-centre distance per tier step between tier ${upperTier} and tier ${lowerTier} is ${perTierCenterDist.toFixed(1)}px (expected ~165-200px)`
    );
  }

  return layout;
}

function applyFirstChangeToGroup(group: CorporateGroupSeed): CorporateGroupSeed {
  const clone: CorporateGroupSeed = JSON.parse(JSON.stringify(group));
  const tpl = clone.monitoringEventTemplates[0];

  if (tpl) {
    const newPersonId = `per-sim-${Date.now()}`;
    const newPerson: BodsPerson = {
      id: newPersonId,
      name: (tpl.data as any)?.holderName || 'Disclosed Shareholder',
      initials: 'DS',
      nationality: 'United Kingdom',
      flag: '🇬🇧',
      yearOfBirth: 1978,
      pepStatus: 'none',
      synthetic: true,
    };
    clone.persons.push(newPerson);

    const targetEntityId = clone.entities[1]?.id || clone.rootEntityId;
    const newRel: RelationshipRecord = {
      id: `rel-sim-${Date.now()}`,
      subjectId: targetEntityId,
      interestedPartyId: newPersonId,
      interestedPartyType: 'person',
      isHot: true,
      interests: [
        {
          type: 'shareholding',
          share: { kind: 'exact', value: (tpl.data as any)?.newValue || 30 },
          directOrIndirect: 'direct',
          confidence: 1.0,
          source: 'Simulated Change',
          asOfDate: new Date().toISOString().slice(0, 10),
        },
      ],
    };
    clone.relationships.push(newRel);

    if (clone.unspecifiedOwners.length > 0) {
      clone.unspecifiedOwners.shift();
    }
  }

  return clone;
}

describe('SENTINEL AI — OWNERSHIP GRAPH LAYOUT INTEGRITY SUITE', () => {
  const groups = seedJson.groups as unknown as CorporateGroupSeed[];

  test('All 5 Corporate Groups — Initial and Post-Change Layout Validation', () => {
    assert.strictEqual(groups.length, 5, 'Dataset must contain exactly 5 corporate groups');

    for (const group of groups) {
      console.log(`\n--- [INITIAL] Validating Group Layout: ${group.name} (${group.id}) ---`);
      const initialLayout = validateGroupGraphLayout(group, 'INITIAL');
      console.log(
        `[PASS] Initial layout validated for ${group.name} (Nodes: ${initialLayout.nodes.length}, Edges: ${initialLayout.edges.length}, Crossings: ${initialLayout.stats.crossingCount})`
      );

      console.log(`--- [POST-CHANGE] Applying 1st change and re-validating: ${group.name} (${group.id}) ---`);
      const modifiedGroup = applyFirstChangeToGroup(group);
      const postChangeLayout = validateGroupGraphLayout(modifiedGroup, 'POST-CHANGE');
      console.log(
        `[PASS] Post-change layout validated for ${group.name} (Nodes: ${postChangeLayout.nodes.length}, Edges: ${postChangeLayout.edges.length}, Crossings: ${postChangeLayout.stats.crossingCount})`
      );
    }
  });
});

