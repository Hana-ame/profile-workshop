import { getProfileSpec } from './profiles';
import type { FrameMember, FrameModel, FrameNode, Vec3 } from './types';

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Real-world assembly priority tier for aluminum extrusions at shared nodes:
 *   1 = Vertical columns (full-height continuous posts)
 *   2 = Primary X-axis rails (butt cleanly against column side faces)
 *   3 = Transverse Z-axis crossbars (butt cleanly against column & X-rail faces)
 *   4 = Diagonal/angled braces (trim back to seat flush against orthogonal faces)
 */
export function getMemberAssemblyTier(n1: FrameNode, n2: FrameNode, isBrace?: boolean): 1 | 2 | 3 | 4 {
  if (isBrace) return 4;
  const dx = Math.abs(n2.position.x - n1.position.x);
  const dy = Math.abs(n2.position.y - n1.position.y);
  const dz = Math.abs(n2.position.z - n1.position.z);
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-4) return 2;

  const cosTol = Math.cos((3 * Math.PI) / 180);
  if (dy / l >= cosTol) return 1; // Vertical column
  if (dx / l >= cosTol) return 2; // Longitudinal X rail
  if (dz / l >= cosTol) return 3; // Transverse Z crossbar
  return 4; // Angled / diagonal bar
}

/**
 * Half cross-section extent (in mm) of an extrusion along a given unit world direction `dir`.
 * Accounts for horizontal beams standing with `heightMm` vertical (Y) and `widthMm` lateral.
 */
export function getMemberHalfExtentAlongDir(
  member: FrameMember,
  n1: FrameNode,
  n2: FrameNode,
  dirUnit: Vec3,
): number {
  const spec = getProfileSpec(member.profileId);
  const dx = Math.abs(n2.position.x - n1.position.x);
  const dy = Math.abs(n2.position.y - n1.position.y);
  const dz = Math.abs(n2.position.z - n1.position.z);
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-4) return spec.widthMm * 0.5;

  const isVertical = dy / l > 0.98;
  if (isVertical) {
    // Column: widthMm along X, heightMm along Z (square for 2020/3030/4040)
    const hx = spec.widthMm * 0.5;
    const hz = spec.heightMm * 0.5;
    return Math.abs(dirUnit.x) * hx + Math.abs(dirUnit.z) * hz;
  }

  // Horizontal or angled beam: strong axis heightMm is aligned vertically, widthMm laterally
  const hy = spec.heightMm * 0.5;
  const hLat = spec.widthMm * 0.5;
  const latComp = Math.hypot(dirUnit.x, dirUnit.z);
  return Math.abs(dirUnit.y) * hy + latComp * hLat;
}

export interface TrimmedMemberGeometry {
  startPos: Vec3;
  endPos: Vec3;
  startTrimMm: number;
  endTrimMm: number;
  trimmedLengthMm: number;
  centerLengthMm: number;
  capStart: boolean;
  capEnd: boolean;
  tier: 1 | 2 | 3 | 4;
}

/**
 * Computes exact physically-assembled butt-joint endpoints for any extrusion in the frame
 * so orthogonal rails butt cleanly against column side faces, crossbars butt against rails,
 * and diagonal braces never pierce through the far side of any member.
 */
export function computeTrimmedMemberEndpoints(
  model: FrameModel,
  member: FrameMember,
): TrimmedMemberGeometry | null {
  const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));
  const n1 = nodeMap.get(member.startNodeId);
  const n2 = nodeMap.get(member.endNodeId);
  if (!n1 || !n2) return null;

  const delta = sub(n2.position, n1.position);
  const centerLengthMm = len(delta);
  if (centerLengthMm < 1) return null;

  const u: Vec3 = {
    x: delta.x / centerLengthMm,
    y: delta.y / centerLengthMm,
    z: delta.z / centerLengthMm,
  };
  const selfTier = getMemberAssemblyTier(n1, n2, member.isBrace);

  const computeEndTrim = (
    node: FrameNode,
    outDirFromNode: Vec3,
  ): { trimMm: number; isFreeOpenEnd: boolean } => {
    let maxTrim = 0;
    let hasCollinearContinuation = false;
    let hasOtherIncident = false;

    for (const other of model.members) {
      if (other.id === member.id) continue;
      if (other.startNodeId !== node.id && other.endNodeId !== node.id) continue;

      const o1 = nodeMap.get(other.startNodeId);
      const o2 = nodeMap.get(other.endNodeId);
      if (!o1 || !o2) continue;

      const otherFar = other.startNodeId === node.id ? o2 : o1;
      const oVec = sub(otherFar.position, node.position);
      const oLen = len(oVec);
      if (oLen < 1) continue;
      const oUnit: Vec3 = { x: oVec.x / oLen, y: oVec.y / oLen, z: oVec.z / oLen };

      const align = Math.abs(dot(outDirFromNode, oUnit));
      if (align > 0.96) {
        // Straight-through collinear continuation of the same extrusion
        hasCollinearContinuation = true;
        continue;
      }

      hasOtherIncident = true;
      const otherTier = getMemberAssemblyTier(o1, o2, other.isBrace);

      // Higher-priority (lower tier number) member runs through; we butt cleanly against its face
      if (otherTier < selfTier) {
        const halfExtent = getMemberHalfExtentAlongDir(other, o1, o2, outDirFromNode);
        if (selfTier === 4) {
          // Diagonal brace: pull back along diagonal so corner edges never protrude through the host face
          const sinTheta = Math.max(0.45, Math.sqrt(Math.max(0, 1 - align * align)));
          const selfSpec = getProfileSpec(member.profileId);
          const diagClearance = halfExtent / sinTheta + (selfSpec.widthMm * 0.28) / sinTheta;
          maxTrim = Math.max(maxTrim, diagClearance);
        } else {
          maxTrim = Math.max(maxTrim, halfExtent);
        }
      }
    }

    // Only open ends of Tier 1 vertical columns (top free ends) or isolated degree-1 ends receive plastic end caps
    const isFreeOpenEnd =
      !hasCollinearContinuation &&
      ((!hasOtherIncident && node.support === 'free') ||
        (selfTier === 1 && outDirFromNode.y < -0.9 && node.support === 'free'));

    return { trimMm: maxTrim, isFreeOpenEnd };
  };

  const startInfo = computeEndTrim(n1, u);
  const endInfo = computeEndTrim(n2, { x: -u.x, y: -u.y, z: -u.z });

  // Clamp trims safely so even very short members preserve at least 20mm visible length
  const maxTotalTrim = Math.max(0, centerLengthMm - 20);
  let startTrimMm = startInfo.trimMm;
  let endTrimMm = endInfo.trimMm;
  if (startTrimMm + endTrimMm > maxTotalTrim && startTrimMm + endTrimMm > 0) {
    const scale = maxTotalTrim / (startTrimMm + endTrimMm);
    startTrimMm *= scale;
    endTrimMm *= scale;
  }

  const startPos: Vec3 = {
    x: n1.position.x + u.x * startTrimMm,
    y: n1.position.y + u.y * startTrimMm,
    z: n1.position.z + u.z * startTrimMm,
  };
  const endPos: Vec3 = {
    x: n2.position.x - u.x * endTrimMm,
    y: n2.position.y - u.y * endTrimMm,
    z: n2.position.z - u.z * endTrimMm,
  };

  return {
    startPos,
    endPos,
    startTrimMm,
    endTrimMm,
    trimmedLengthMm: Math.max(1, centerLengthMm - startTrimMm - endTrimMm),
    centerLengthMm,
    capStart: startInfo.isFreeOpenEnd,
    capEnd: endInfo.isFreeOpenEnd,
    tier: selfTier,
  };
}

/**
 * Returns true if the open interiors of 3D line segments (a1..a2) and (b1..b2) pass closer
 * than `clearanceMm` to each other (detects X-crossing or through-member collisions while
 * ignoring legitimate shared endpoint joints).
 */
export function segmentsInteriorCollide3D(
  a1: Vec3,
  a2: Vec3,
  b1: Vec3,
  b2: Vec3,
  clearanceMm = 22,
): boolean {
  const u = sub(a2, a1);
  const v = sub(b2, b1);
  const w0 = sub(a1, b1);

  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w0);
  const e = dot(v, w0);
  const denom = a * c - b * b;

  if (a < 1e-4 || c < 1e-4) return false;

  let sc: number;
  let tc: number;

  if (denom < 1e-6) {
    // Nearly parallel segments: check midpoint distance if overlapping in projection
    sc = 0.5;
    tc = Math.max(0, Math.min(1, (b * sc + e) / c));
  } else {
    sc = (b * e - c * d) / denom;
    tc = (a * e - b * d) / denom;
    sc = Math.max(0, Math.min(1, sc));
    tc = Math.max(0, Math.min(1, tc));
  }

  // Ignore shared endpoint touch (within 6% of either end)
  const eps = 0.06;
  const aAtEnd = sc < eps || sc > 1 - eps;
  const bAtEnd = tc < eps || tc > 1 - eps;
  if (aAtEnd && bAtEnd) return false;

  const closestA: Vec3 = {
    x: a1.x + u.x * sc,
    y: a1.y + u.y * sc,
    z: a1.z + u.z * sc,
  };
  const closestB: Vec3 = {
    x: b1.x + v.x * tc,
    y: b1.y + v.y * tc,
    z: b1.z + v.z * tc,
  };
  const dist = len(sub(closestA, closestB));

  // If the segments cross/collide in their interior, reject
  if (dist < clearanceMm) {
    // Double-check it's not simply two collinear segments meeting at a node
    const cp = cross(u, v);
    if (len(cp) < 1e-2 && (aAtEnd || bAtEnd)) return false;
    return true;
  }
  return false;
}
