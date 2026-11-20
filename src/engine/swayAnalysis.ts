import type { FeaResult, FrameModel } from './types';

export type SwaySeverity = 'stable' | 'moderate' | 'severe' | 'unstable';

export interface NodeSwayMetric {
  nodeId: string;
  dx: number;
  dy: number;
  dz: number;
  horizontalMm: number;
}

export interface ElevationMemberPaths {
  memberId: string;
  isColumn: boolean;
  /** Undeformed 2D points (x, y) in mm */
  base: { x: number; y: number }[];
  /** +Sway deformed 2D points (x, y) in mm (scaled for clear visual display) */
  plus: { x: number; y: number }[];
  /** -Sway symmetric mirror 2D points (x, y) in mm (scaled for static ± envelope) */
  minus: { x: number; y: number }[];
}

export interface SwaySummary {
  isStable: boolean;
  maxSwayMm: number;
  maxSwayNodeId: string | null;
  maxSwayHeightMm: number;
  tiltAngleDeg: number;
  driftRatio: number;
  driftDenominator: number | null;
  severity: SwaySeverity;
  severityLabel: string;
  nodeSways: Record<string, NodeSwayMetric>;
  /** Front-view (X-Y) static sway envelope paths for the 2D Sway Viewer */
  elevation: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    visualScale: number;
    members: ElevationMemberPaths[];
    peakNodeBase: { x: number; y: number } | null;
    peakNodePlus: { x: number; y: number } | null;
    peakNodeMinus: { x: number; y: number } | null;
  };
}

/**
 * Computes static lateral sway metrics, column tilt angle, drift ratio (H/N),
 * and a 2D front-elevation ±sway envelope for static visualization.
 */
export function computeSwaySummary(model: FrameModel, fea: FeaResult): SwaySummary {
  const emptyElevation = {
    minX: -600,
    maxX: 600,
    minY: 0,
    maxY: 750,
    visualScale: 1,
    members: [] as ElevationMemberPaths[],
    peakNodeBase: null,
    peakNodePlus: null,
    peakNodeMinus: null,
  };

  if (!fea.isStable || model.nodes.length === 0) {
    return {
      isStable: false,
      maxSwayMm: 0,
      maxSwayNodeId: null,
      maxSwayHeightMm: 0,
      tiltAngleDeg: 0,
      driftRatio: 0,
      driftDenominator: null,
      severity: 'unstable',
      severityLabel: '机构失稳',
      nodeSways: {},
      elevation: emptyElevation,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of model.nodes) {
    minX = Math.min(minX, n.position.x);
    maxX = Math.max(maxX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxY = Math.max(maxY, n.position.y);
  }

  const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));
  const nodeSways: Record<string, NodeSwayMetric> = {};
  let maxSwayMm = 0;
  let maxSwayNodeId: string | null = null;
  let maxSwayHeightMm = Math.max(100, maxY - minY);

  for (const n of model.nodes) {
    const d = fea.nodeDisplacements[n.id];
    const dx = d?.dx ?? 0;
    const dy = d?.dy ?? 0;
    const dz = d?.dz ?? 0;
    const horizontalMm = Math.hypot(dx, dz);
    nodeSways[n.id] = { nodeId: n.id, dx, dy, dz, horizontalMm };
    if (horizontalMm > maxSwayMm) {
      maxSwayMm = horizontalMm;
      maxSwayNodeId = n.id;
      maxSwayHeightMm = Math.max(100, n.position.y - minY);
    }
  }

  const driftRatio = maxSwayHeightMm > 0 ? maxSwayMm / maxSwayHeightMm : 0;
  const driftDenominator = maxSwayMm > 0.01 ? Math.round(maxSwayHeightMm / maxSwayMm) : null;
  const tiltAngleDeg = (Math.atan2(maxSwayMm, maxSwayHeightMm) * 180) / Math.PI;

  const severity: SwaySeverity =
    maxSwayMm > 5 ? 'severe' : maxSwayMm > 2 ? 'moderate' : 'stable';
  const severityLabel =
    severity === 'severe' ? '晃动大' : severity === 'moderate' ? '偏晃' : '稳固';

  // Compute readable static visual scale for the 2D elevation diagram
  // Target: severe sway reaches ~14% of width, moderate ~7%, tiny sway stays visibly subtle
  const spanX = Math.max(400, maxX - minX);
  const targetMaxShift = spanX * 0.16;
  const desiredScale =
    maxSwayMm <= 0.01
      ? 1
      : Math.min(28, Math.max(1.2, targetMaxShift / Math.max(maxSwayMm, 6)));

  const elevationMembers: ElevationMemberPaths[] = [];
  for (const m of model.members) {
    const n1 = nodeMap.get(m.startNodeId);
    const n2 = nodeMap.get(m.endNodeId);
    const mRes = fea.memberResults[m.id];
    if (!n1 || !n2) continue;

    const absDx = Math.abs(n2.position.x - n1.position.x);
    const absDy = Math.abs(n2.position.y - n1.position.y);
    const absDz = Math.abs(n2.position.z - n1.position.z);
    const isColumn = absDy > absDx && absDy > absDz;

    const basePts =
      mRes && mRes.basePoints.length >= 2
        ? mRes.basePoints.map((p) => ({ x: p.x, y: p.y }))
        : [
            { x: n1.position.x, y: n1.position.y },
            { x: n2.position.x, y: n2.position.y },
          ];

    const dispPts =
      mRes && mRes.curvePoints.length === basePts.length
        ? mRes.curvePoints
        : [
            {
              x: fea.nodeDisplacements[n1.id]?.dx ?? 0,
              y: fea.nodeDisplacements[n1.id]?.dy ?? 0,
              z: fea.nodeDisplacements[n1.id]?.dz ?? 0,
            },
            {
              x: fea.nodeDisplacements[n2.id]?.dx ?? 0,
              y: fea.nodeDisplacements[n2.id]?.dy ?? 0,
              z: fea.nodeDisplacements[n2.id]?.dz ?? 0,
            },
          ];

    // If horizontal sway happens primarily in Z (front-back), project its signed magnitude onto X so the 2D diagram still shows it clearly
    const plus = basePts.map((bp, i) => {
      const dp = dispPts[i];
      const lat = Math.abs(dp.x) >= Math.abs(dp.z) ? dp.x : dp.z;
      return {
        x: bp.x + lat * desiredScale,
        y: bp.y + dp.y * Math.min(desiredScale * 0.45, 6),
      };
    });

    const minus = basePts.map((bp, i) => {
      const dp = dispPts[i];
      const lat = Math.abs(dp.x) >= Math.abs(dp.z) ? dp.x : dp.z;
      return {
        x: bp.x - lat * desiredScale,
        y: bp.y + dp.y * Math.min(desiredScale * 0.45, 6),
      };
    });

    elevationMembers.push({
      memberId: m.id,
      isColumn,
      base: basePts,
      plus,
      minus,
    });
  }

  let peakNodeBase: { x: number; y: number } | null = null;
  let peakNodePlus: { x: number; y: number } | null = null;
  let peakNodeMinus: { x: number; y: number } | null = null;
  if (maxSwayNodeId) {
    const pn = nodeMap.get(maxSwayNodeId);
    const pd = nodeSways[maxSwayNodeId];
    if (pn && pd) {
      const lat = Math.abs(pd.dx) >= Math.abs(pd.dz) ? pd.dx : pd.dz;
      const latSigned = lat >= 0 ? Math.max(lat, pd.horizontalMm * 0.85) : Math.min(lat, -pd.horizontalMm * 0.85);
      peakNodeBase = { x: pn.position.x, y: pn.position.y };
      peakNodePlus = {
        x: pn.position.x + latSigned * desiredScale,
        y: pn.position.y + pd.dy * Math.min(desiredScale * 0.45, 6),
      };
      peakNodeMinus = {
        x: pn.position.x - latSigned * desiredScale,
        y: pn.position.y + pd.dy * Math.min(desiredScale * 0.45, 6),
      };
    }
  }

  return {
    isStable: true,
    maxSwayMm,
    maxSwayNodeId,
    maxSwayHeightMm,
    tiltAngleDeg,
    driftRatio,
    driftDenominator,
    severity,
    severityLabel,
    nodeSways,
    elevation: {
      minX,
      maxX,
      minY,
      maxY,
      visualScale: desiredScale,
      members: elevationMembers,
      peakNodeBase,
      peakNodePlus,
      peakNodeMinus,
    },
  };
}
