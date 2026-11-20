import { getJointCraftSpec } from './jointCrafts';
import { ALUMINUM_6063_T5, getProfileSpec } from './profiles';
import type {
  FeaResult,
  FrameMember,
  FrameModel,
  FrameNode,
  JointType,
  MemberResult,
  NodeDisplacement,
  StructuralStatus,
  Vec3,
} from './types';

export interface FeaOptions {
  includeGravity?: boolean;
  loadMultiplier?: number;
  curveSubdivisions?: number;
  jointType?: JointType;      // Joint connection craft (builtin, semi-rigid L-bracket, gusset-plate, rigid, pinned)
  lateralPushN?: number;      // Optional horizontal tangential push force (+X) distributed on top nodes
}

/**
 * Rotational stiffness fixity factor for aluminum T-slot bolted connection crafts.
 */
export function getJointFixityFactor(jointType: JointType): number {
  return getJointCraftSpec(jointType).fixityFactor;
}

/**
 * Compute local-to-global 3x3 direction cosine matrix R for a 3D beam from p1 to p2.
 * Local x-axis: along beam from p1 -> p2.
 * Local y-axis: aligned as closely as possible to global +Y (vertical strong bending axis).
 * Local z-axis: local x cross local y.
 * For vertical beams (along global Y), local z aligns with global +Z and local y with global -X/+X.
 */
export function computeBeamRotationMatrix(p1: Vec3, p2: Vec3): {
  L: number;
  R: number[][]; // 3x3 rows = [ex, ey, ez]
} {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.z - p1.z;
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-6) {
    return {
      L: 0,
      R: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    };
  }

  const cx = dx / L;
  const cy = dy / L;
  const cz = dz / L;

  const ex = [cx, cy, cz];
  let ey: number[];
  let ez: number[];

  // Check if beam is nearly vertical (parallel to global Y)
  if (Math.abs(cy) > 0.999) {
    // Reference global +Z as local z
    const refZ = [0, 0, 1];
    // ey = ez x ex
    ey = [
      refZ[1] * ex[2] - refZ[2] * ex[1],
      refZ[2] * ex[0] - refZ[0] * ex[2],
      refZ[0] * ex[1] - refZ[1] * ex[0],
    ];
    const eyLen = Math.hypot(ey[0], ey[1], ey[2]) || 1;
    ey = [ey[0] / eyLen, ey[1] / eyLen, ey[2] / eyLen];
    ez = [
      ex[1] * ey[2] - ex[2] * ey[1],
      ex[2] * ey[0] - ex[0] * ey[2],
      ex[0] * ey[1] - ex[1] * ey[0],
    ];
  } else {
    // Reference global +Y as approximate strong vertical plane
    // ez = ex x [0, 1, 0] = [-cz, 0, cx]
    ez = [-cz, 0, cx];
    const ezLen = Math.hypot(ez[0], ez[1], ez[2]) || 1;
    ez = [ez[0] / ezLen, ez[1] / ezLen, ez[2] / ezLen];
    // ey = ez x ex (points generally upward in +Y)
    ey = [
      ez[1] * ex[2] - ez[2] * ex[1],
      ez[2] * ex[0] - ez[0] * ex[2],
      ez[0] * ex[1] - ez[1] * ex[0],
    ];
  }

  return {
    L,
    R: [ex, ey, ez],
  };
}

/**
 * Build 12x12 local Euler-Bernoulli 3D space frame beam stiffness matrix with end fixity factor.
 * When fixity < 1 (semi-rigid bolted T-slot joints or pinned hinges), end-moment transfer degrades
 * while axial stiffness EA/L stays 100% intact (which is why triangulated diagonal braces stop sway!).
 */
function buildLocalStiffnessMatrix(
  E: number,
  G: number,
  A: number,
  Iz: number,
  Iy: number,
  J: number,
  L: number,
  fixity = 1.0,
): Float64Array {
  const k = new Float64Array(12 * 12);
  const set = (r: number, c: number, val: number) => {
    k[r * 12 + c] = val;
    k[c * 12 + r] = val;
  };

  const L2 = L * L;
  const L3 = L2 * L;

  // Axial (DOF 0, 6) - unaffected by rotational joint looseness
  const kA = (E * A) / L;
  set(0, 0, kA);
  set(6, 6, kA);
  set(0, 6, -kA);

  // Torsion (DOF 3, 9) - scales with joint rotational stiffness
  const kT = (G * J * Math.max(0.05, fixity)) / L;
  set(3, 3, kT);
  set(9, 9, kT);
  set(3, 9, -kT);

  // Effective bending rigidity with semi-rigid / pinned joint end-rotational compliance
  const IzEff = Iz * fixity;
  const IyEff = Iy * fixity;

  // Bending in local x-y plane (v1=1, rz1=5, v2=7, rz2=11) using IzEff
  const c1z = (12 * E * IzEff) / L3;
  const c2z = (6 * E * IzEff) / L2;
  const c3z = (4 * E * IzEff) / L;
  const c4z = (2 * E * IzEff) / L;

  set(1, 1, c1z);
  set(1, 5, c2z);
  set(1, 7, -c1z);
  set(1, 11, c2z);

  set(5, 5, c3z);
  set(5, 7, -c2z);
  set(5, 11, c4z);

  set(7, 7, c1z);
  set(7, 11, -c2z);

  set(11, 11, c3z);

  // Bending in local x-z plane (w1=2, ry1=4, w2=8, ry2=10) using IyEff
  const c1y = (12 * E * IyEff) / L3;
  const c2y = (6 * E * IyEff) / L2;
  const c3y = (4 * E * IyEff) / L;
  const c4y = (2 * E * IyEff) / L;

  set(2, 2, c1y);
  set(2, 4, -c2y);
  set(2, 8, -c1y);
  set(2, 10, -c2y);

  set(4, 4, c3y);
  set(4, 8, c2y);
  set(4, 10, c4y);

  set(8, 8, c1y);
  set(8, 10, c2y);

  set(10, 10, c3y);

  return k;
}

/**
 * Transform 12x12 local stiffness matrix to global coordinates: K_global = T^T * K_local * T
 * where T is block-diagonal with four 3x3 blocks equal to R.
 */
function transformStiffnessToGlobal(kLocal: Float64Array, R: number[][]): Float64Array {
  // Compute temp = K_local * T
  const temp = new Float64Array(12 * 12);
  for (let row = 0; row < 12; row++) {
    for (let block = 0; block < 4; block++) {
      const colBase = block * 3;
      for (let j = 0; j < 3; j++) {
        let sum = 0;
        for (let m = 0; m < 3; m++) {
          sum += kLocal[row * 12 + colBase + m] * R[m][j];
        }
        temp[row * 12 + colBase + j] = sum;
      }
    }
  }

  // Compute K_global = T^T * temp
  const kGlobal = new Float64Array(12 * 12);
  for (let block = 0; block < 4; block++) {
    const rowBase = block * 3;
    for (let i = 0; i < 3; i++) {
      for (let col = 0; col < 12; col++) {
        let sum = 0;
        for (let m = 0; m < 3; m++) {
          sum += R[m][i] * temp[(rowBase + m) * 12 + col];
        }
        kGlobal[(rowBase + i) * 12 + col] = sum;
      }
    }
  }

  return kGlobal;
}

/**
 * Multiply 12x12 block-diagonal T by 12-vector uGlobal -> uLocal
 */
function toLocalVector(uGlobal: Float64Array, R: number[][]): Float64Array {
  const out = new Float64Array(12);
  for (let block = 0; block < 4; block++) {
    const base = block * 3;
    for (let i = 0; i < 3; i++) {
      out[base + i] =
        R[i][0] * uGlobal[base] +
        R[i][1] * uGlobal[base + 1] +
        R[i][2] * uGlobal[base + 2];
    }
  }
  return out;
}

/**
 * Gaussian elimination with partial pivoting for dense n x n system Ax = b.
 * Returns null if matrix is singular or ill-conditioned.
 */
function solveLinearSystem(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  if (n === 0) return new Float64Array(0);
  const M = new Float64Array(A);
  const rhs = new Float64Array(b);

  for (let col = 0; col < n; col++) {
    // Partial pivot search
    let pivotRow = col;
    let maxAbs = Math.abs(M[col * n + col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(M[row * n + col]);
      if (val > maxAbs) {
        maxAbs = val;
        pivotRow = row;
      }
    }

    if (!Number.isFinite(maxAbs) || maxAbs < 1e-9) {
      return null;
    }

    if (pivotRow !== col) {
      for (let k = col; k < n; k++) {
        const tmp = M[col * n + k];
        M[col * n + k] = M[pivotRow * n + k];
        M[pivotRow * n + k] = tmp;
      }
      const tmpR = rhs[col];
      rhs[col] = rhs[pivotRow];
      rhs[pivotRow] = tmpR;
    }

    const pivot = M[col * n + col];
    for (let row = col + 1; row < n; row++) {
      const factor = M[row * n + col] / pivot;
      if (Math.abs(factor) < 1e-18) continue;
      M[row * n + col] = 0;
      for (let k = col + 1; k < n; k++) {
        M[row * n + k] -= factor * M[col * n + k];
      }
      rhs[row] -= factor * rhs[col];
    }
  }

  // Back substitution
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i * n + j] * x[j];
    }
    const diag = M[i * n + i];
    if (!Number.isFinite(diag) || Math.abs(diag) < 1e-12) return null;
    const val = sum / diag;
    if (!Number.isFinite(val)) return null;
    x[i] = val;
  }

  return x;
}

/**
 * Evaluate Hermite cubic interpolated deformed & base points along a beam.
 */
function buildMemberCurve(
  p1: Vec3,
  p2: Vec3,
  R: number[][],
  L: number,
  uLocal: Float64Array,
  subdivisions: number,
  hermiteWeight = 1.0,
): { basePoints: Vec3[]; curvePoints: Vec3[] } {
  const basePoints: Vec3[] = [];
  const curvePoints: Vec3[] = [];

  const u1 = uLocal[0];
  const v1 = uLocal[1];
  const w1 = uLocal[2];
  const ry1 = uLocal[4];
  const rz1 = uLocal[5];
  const u2 = uLocal[6];
  const v2 = uLocal[7];
  const w2 = uLocal[8];
  const ry2 = uLocal[10];
  const rz2 = uLocal[11];

  const hw = Math.max(0, Math.min(1, hermiteWeight));

  for (let i = 0; i <= subdivisions; i++) {
    const xi = i / subdivisions;
    const xi2 = xi * xi;
    const xi3 = xi2 * xi;

    const bx = p1.x + (p2.x - p1.x) * xi;
    const by = p1.y + (p2.y - p1.y) * xi;
    const bz = p1.z + (p2.z - p1.z) * xi;
    basePoints.push({ x: bx, y: by, z: bz });

    // Hermite shape functions blended with linear displacement for pinned/truss members
    const h1 = 1 - 3 * xi2 + 2 * xi3;
    const h2 = L * (xi - 2 * xi2 + xi3);
    const h3 = 3 * xi2 - 2 * xi3;
    const h4 = L * (-xi2 + xi3);

    const du = u1 * (1 - xi) + u2 * xi;
    const dvLinear = v1 * (1 - xi) + v2 * xi;
    const dwLinear = w1 * (1 - xi) + w2 * xi;
    const dvHermite = h1 * v1 + h2 * rz1 + h3 * v2 + h4 * rz2;
    const dwHermite = h1 * w1 - h2 * ry1 + h3 * w2 - h4 * ry2;
    const dv = dvLinear * (1 - hw) + dvHermite * hw;
    const dw = dwLinear * (1 - hw) + dwHermite * hw;

    // Transform local displacement [du, dv, dw] to global via R^T
    const gx = R[0][0] * du + R[1][0] * dv + R[2][0] * dw;
    const gy = R[0][1] * du + R[1][1] * dv + R[2][1] * dw;
    const gz = R[0][2] * du + R[1][2] * dv + R[2][2] * dw;

    curvePoints.push({ x: gx, y: gy, z: gz });
  }

  return { basePoints, curvePoints };
}

function createUnstableResult(
  model: FrameModel,
  message: string,
  totalMassKg: number,
  totalCostCNY: number,
  totalLengthMm: number,
  totalLoadN: number,
): FeaResult {
  const nodeDisplacements: Record<string, NodeDisplacement> = {};
  for (const n of model.nodes) {
    nodeDisplacements[n.id] = {
      nodeId: n.id,
      dx: 0,
      dy: 0,
      dz: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      magnitudeMm: 0,
    };
  }
  const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));
  const memberResults: Record<string, MemberResult> = {};
  for (const m of model.members) {
    const n1 = nodeMap.get(m.startNodeId);
    const n2 = nodeMap.get(m.endNodeId);
    const spec = getProfileSpec(m.profileId);
    const L =
      n1 && n2
        ? Math.hypot(
            n2.position.x - n1.position.x,
            n2.position.y - n1.position.y,
            n2.position.z - n1.position.z,
          )
        : 0;
    const basePoints = n1 && n2 ? [n1.position, n2.position] : [];
    memberResults[m.id] = {
      memberId: m.id,
      lengthMm: L,
      axialForceN: 0,
      maxShearN: 0,
      maxMomentNmm: 0,
      axialStressMPa: 0,
      bendingStressMPa: 0,
      combinedStressMPa: 0,
      vonMisesMPa: 0,
      utilization: 0,
      safetyFactor: 0,
      massKg: (L / 1000) * spec.massPerMeterKg,
      costCNY: (L / 1000) * spec.pricePerMeterCNY,
      strainEnergyNmm: 0,
      basePoints,
      curvePoints: basePoints.map(() => ({ x: 0, y: 0, z: 0 })),
    };
  }

  return {
    isStable: false,
    status: 'unstable',
    statusMessage: message,
    nodeDisplacements,
    memberResults,
    maxDisplacementMm: 0,
    maxVerticalDeflectionMm: 0,
    maxLateralSwayMm: 0,
    maxDisplacementNodeId: null,
    maxStressMPa: 0,
    maxShearForceN: 0,
    jointShearCapacityN: 900,
    jointSlipRisk: false,
    criticalMemberId: null,
    minSafetyFactor: 0,
    totalMassKg,
    totalCostCNY,
    totalLengthMm,
    totalLoadN,
    totalComplianceNmm: 0,
    reactionForceSumY: 0,
  };
}

/**
 * Full 3D Euler-Bernoulli Space Frame Direct Stiffness Method FEA Solver.
 * Units: mm, N, MPa (N/mm^2), rad.
 */
export function solveFrameFea(model: FrameModel, options: FeaOptions = {}): FeaResult {
  const includeGravity = options.includeGravity ?? true;
  const loadMultiplier = options.loadMultiplier ?? 1.0;
  const subdivisions = options.curveSubdivisions ?? 6;
  const jointType: JointType = options.jointType ?? 'rigid';
  const lateralPushN = options.lateralPushN ?? 0;
  const jointFixity = getJointFixityFactor(jointType);

  const E = ALUMINUM_6063_T5.youngsModulusMPa;
  const G = ALUMINUM_6063_T5.shearModulusMPa;
  const yieldMPa = ALUMINUM_6063_T5.yieldStrengthMPa;

  const nodes = model.nodes;
  const members = model.members;
  const nodeIndexMap = new Map<string, number>();
  nodes.forEach((n, idx) => nodeIndexMap.set(n.id, idx));

  // Precompute total mass, length, cost
  let totalMassKg = 0;
  let totalCostCNY = 0;
  let totalLengthMm = 0;

  interface MemberCache {
    member: FrameMember;
    iIdx: number;
    jIdx: number;
    L: number;
    R: number[][];
    kLocal: Float64Array;
    massKg: number;
    costCNY: number;
  }

  const caches: MemberCache[] = [];
  const connectedNodeSet = new Set<number>();

  for (const m of members) {
    const iIdx = nodeIndexMap.get(m.startNodeId);
    const jIdx = nodeIndexMap.get(m.endNodeId);
    if (iIdx === undefined || jIdx === undefined || iIdx === jIdx) continue;
    const p1 = nodes[iIdx].position;
    const p2 = nodes[jIdx].position;
    const { L, R } = computeBeamRotationMatrix(p1, p2);
    if (L < 1e-3) continue;

    const spec = getProfileSpec(m.profileId);
    // Diagonal braces transfer force primarily axially; apply member joint fixity to bending terms
    const kLocal = buildLocalStiffnessMatrix(
      E,
      G,
      spec.areaMm2,
      spec.ixMm4,
      spec.iyMm4,
      spec.jMm4,
      L,
      jointFixity,
    );
    const massKg = (L / 1000) * spec.massPerMeterKg;
    const costCNY = (L / 1000) * spec.pricePerMeterCNY;
    totalMassKg += massKg;
    totalCostCNY += costCNY;
    totalLengthMm += L;

    connectedNodeSet.add(iIdx);
    connectedNodeSet.add(jIdx);

    caches.push({ member: m, iIdx, jIdx, L, R, kLocal, massKg, costCNY });
  }

  // External force vector (full 6*N)
  const numNodes = nodes.length;
  const totalDofs = numNodes * 6;
  const F = new Float64Array(totalDofs);
  let totalLoadN = 0;

  for (let idx = 0; idx < numNodes; idx++) {
    const load = nodes[idx].load;
    const fx = load.fx * loadMultiplier;
    const fy = load.fy * loadMultiplier;
    const fz = load.fz * loadMultiplier;
    F[idx * 6 + 0] += fx;
    F[idx * 6 + 1] += fy;
    F[idx * 6 + 2] += fz;
    totalLoadN += Math.hypot(fx, fy, fz);
  }

  // Optional "推一下" lateral push test distributed across highest-elevation free nodes (+X)
  if (Math.abs(lateralPushN) > 0.1 && numNodes > 0) {
    let maxY = -Infinity;
    for (let idx = 0; idx < numNodes; idx++) {
      if (connectedNodeSet.has(idx) && nodes[idx].support === 'free') {
        maxY = Math.max(maxY, nodes[idx].position.y);
      }
    }
    const topIndices: number[] = [];
    for (let idx = 0; idx < numNodes; idx++) {
      if (
        connectedNodeSet.has(idx) &&
        nodes[idx].support === 'free' &&
        Math.abs(nodes[idx].position.y - maxY) <= 50
      ) {
        topIndices.push(idx);
      }
    }
    if (topIndices.length > 0) {
      const perNodeFx = lateralPushN / topIndices.length;
      for (const idx of topIndices) {
        F[idx * 6 + 0] += perNodeFx;
      }
      totalLoadN += Math.abs(lateralPushN);
    }
  }

  // Add gravity lumped at beam end nodes
  if (includeGravity) {
    for (const c of caches) {
      const halfWeightN = (c.massKg * ALUMINUM_6063_T5.gravityMps2) / 2;
      F[c.iIdx * 6 + 1] -= halfWeightN;
      F[c.jIdx * 6 + 1] -= halfWeightN;
    }
  }

  // Quick support check
  const constrainedDof = new Uint8Array(totalDofs);
  let constrainedCount = 0;
  for (let idx = 0; idx < numNodes; idx++) {
    const sup = nodes[idx].support;
    if (!connectedNodeSet.has(idx)) {
      // Isolated node: constrain all 6 DOFs so it doesn't make K singular
      for (let d = 0; d < 6; d++) constrainedDof[idx * 6 + d] = 1;
      continue;
    }
    if (sup === 'fixed') {
      for (let d = 0; d < 6; d++) {
        constrainedDof[idx * 6 + d] = 1;
        constrainedCount++;
      }
    } else if (sup === 'pinned') {
      for (let d = 0; d < 3; d++) {
        constrainedDof[idx * 6 + d] = 1;
        constrainedCount++;
      }
    }
  }

  if (caches.length === 0 || constrainedCount < 6) {
    return createUnstableResult(
      model,
      '结构缺少足够的支座约束（至少需要 1 个固定约束或 3 个非共线铰接支座）',
      totalMassKg,
      totalCostCNY,
      totalLengthMm,
      totalLoadN,
    );
  }

  // Build free DOF mapping
  const freeDofIndices: number[] = [];
  const fullToFree = new Int32Array(totalDofs).fill(-1);
  for (let d = 0; d < totalDofs; d++) {
    if (!constrainedDof[d]) {
      fullToFree[d] = freeDofIndices.length;
      freeDofIndices.push(d);
    }
  }

  const nFree = freeDofIndices.length;
  const Kff = new Float64Array(nFree * nFree);
  const Ff = new Float64Array(nFree);
  for (let i = 0; i < nFree; i++) {
    Ff[i] = F[freeDofIndices[i]];
  }

  // Assemble global Kff and also retain element global matrices for reaction calculation
  for (const c of caches) {
    const kGlobal = transformStiffnessToGlobal(c.kLocal, c.R);
    const dofMap = [
      c.iIdx * 6 + 0,
      c.iIdx * 6 + 1,
      c.iIdx * 6 + 2,
      c.iIdx * 6 + 3,
      c.iIdx * 6 + 4,
      c.iIdx * 6 + 5,
      c.jIdx * 6 + 0,
      c.jIdx * 6 + 1,
      c.jIdx * 6 + 2,
      c.jIdx * 6 + 3,
      c.jIdx * 6 + 4,
      c.jIdx * 6 + 5,
    ];

    for (let r = 0; r < 12; r++) {
      const fr = fullToFree[dofMap[r]];
      if (fr === -1) continue;
      for (let col = 0; col < 12; col++) {
        const fc = fullToFree[dofMap[col]];
        if (fc === -1) continue;
        Kff[fr * nFree + fc] += kGlobal[r * 12 + col];
      }
    }
  }

  const uFree = solveLinearSystem(Kff, Ff, nFree);
  if (!uFree) {
    return createUnstableResult(
      model,
      '刚度矩阵奇异：结构存在局部几何可变机构，请补充支座约束或连接型材',
      totalMassKg,
      totalCostCNY,
      totalLengthMm,
      totalLoadN,
    );
  }

  // Expand full displacement vector
  const U = new Float64Array(totalDofs);
  for (let i = 0; i < nFree; i++) {
    U[freeDofIndices[i]] = uFree[i];
  }

  // Compute nodal displacements & compliance
  let maxDisplacementMm = 0;
  let maxVerticalDeflectionMm = 0;
  let maxLateralSwayMm = 0;
  let maxDisplacementNodeId: string | null = null;
  let totalComplianceNmm = 0;

  for (let i = 0; i < nFree; i++) {
    totalComplianceNmm += Ff[i] * uFree[i];
  }

  const nodeDisplacements: Record<string, NodeDisplacement> = {};
  for (let idx = 0; idx < numNodes; idx++) {
    const dx = U[idx * 6 + 0];
    const dy = U[idx * 6 + 1];
    const dz = U[idx * 6 + 2];
    const rx = U[idx * 6 + 3];
    const ry = U[idx * 6 + 4];
    const rz = U[idx * 6 + 5];
    const mag = Math.hypot(dx, dy, dz);
    const vert = Math.abs(dy);
    const sway = Math.hypot(dx, dz);

    if (!Number.isFinite(mag) || mag > 50000) {
      return createUnstableResult(
        model,
        '位移发散：结构缺少三角形斜撑或固定约束，推一下即失稳晃动',
        totalMassKg,
        totalCostCNY,
        totalLengthMm,
        totalLoadN,
      );
    }

    nodeDisplacements[nodes[idx].id] = {
      nodeId: nodes[idx].id,
      dx,
      dy,
      dz,
      rx,
      ry,
      rz,
      magnitudeMm: mag,
    };

    if (vert > maxVerticalDeflectionMm) maxVerticalDeflectionMm = vert;
    if (sway > maxLateralSwayMm) maxLateralSwayMm = sway;
    if (mag >= maxDisplacementMm) {
      maxDisplacementMm = mag;
      maxDisplacementNodeId = nodes[idx].id;
    }
  }

  // Post-process element internal forces, stresses, tangential shear, and reactions
  const memberResults: Record<string, MemberResult> = {};
  let maxStressMPa = 0;
  let maxShearForceN = 0;
  let criticalMemberId: string | null = null;
  let minSafetyFactor = 99;
  const globalInternalForces = new Float64Array(totalDofs);
  const jointCraft = getJointCraftSpec(jointType);

  for (const c of caches) {
    const spec = getProfileSpec(c.member.profileId);
    const uElemGlobal = new Float64Array(12);
    for (let d = 0; d < 6; d++) {
      uElemGlobal[d] = U[c.iIdx * 6 + d];
      uElemGlobal[6 + d] = U[c.jIdx * 6 + d];
    }

    const uLocal = toLocalVector(uElemGlobal, c.R);
    const fLocal = new Float64Array(12);
    for (let r = 0; r < 12; r++) {
      let sum = 0;
      for (let col = 0; col < 12; col++) {
        sum += c.kLocal[r * 12 + col] * uLocal[col];
      }
      fLocal[r] = sum;
    }

    // Accumulate global internal forces for reaction check: f_global = T^T * f_local
    for (let block = 0; block < 4; block++) {
      const base = block * 3;
      const targetNode = block < 2 ? c.iIdx : c.jIdx;
      const dofOffset = block % 2 === 0 ? 0 : 3;
      for (let i = 0; i < 3; i++) {
        const fg =
          c.R[0][i] * fLocal[base] +
          c.R[1][i] * fLocal[base + 1] +
          c.R[2][i] * fLocal[base + 2];
        globalInternalForces[targetNode * 6 + dofOffset + i] += fg;
      }
    }

    // Strain energy: 0.5 * uLocal^T * fLocal
    let strainEnergy = 0;
    for (let r = 0; r < 12; r++) {
      strainEnergy += 0.5 * uLocal[r] * fLocal[r];
    }

    // Axial force: + = tension (fLocal[6] > 0), - = compression
    const axialForceN = fLocal[6];
    const vy = Math.max(Math.abs(fLocal[1]), Math.abs(fLocal[7]));
    const vz = Math.max(Math.abs(fLocal[2]), Math.abs(fLocal[8]));
    const maxShearN = Math.hypot(vy, vz);

    const mxTorque = Math.abs(fLocal[3]);
    const myMax = Math.max(Math.abs(fLocal[4]), Math.abs(fLocal[10]));
    const mzMax = Math.max(Math.abs(fLocal[5]), Math.abs(fLocal[11]));
    const maxMomentNmm = Math.hypot(myMax, mzMax);

    const axialStressMPa = Math.abs(axialForceN) / spec.areaMm2;
    const bendingStressMPa = mzMax / spec.wxMm3 + myMax / spec.wyMm3;
    const combinedStressMPa = axialStressMPa + bendingStressMPa;

    // Average shear + torsional shear stress approximation
    const shearStressMPa =
      (1.5 * maxShearN) / spec.areaMm2 +
      (mxTorque * (Math.max(spec.widthMm, spec.heightMm) * 0.5)) / spec.jMm4;

    const vonMisesMPa = Math.sqrt(
      combinedStressMPa * combinedStressMPa + 3 * shearStressMPa * shearStressMPa,
    );

    const utilization = vonMisesMPa / yieldMPa;
    const safetyFactor = vonMisesMPa > 1e-4 ? Math.min(99, yieldMPa / vonMisesMPa) : 99;

    const hermiteWeight = c.member.isBrace ? 0 : jointCraft.hermiteWeight;

    const { basePoints, curvePoints } = buildMemberCurve(
      nodes[c.iIdx].position,
      nodes[c.jIdx].position,
      c.R,
      c.L,
      uLocal,
      subdivisions,
      hermiteWeight,
    );

    memberResults[c.member.id] = {
      memberId: c.member.id,
      lengthMm: c.L,
      axialForceN,
      maxShearN,
      maxMomentNmm,
      axialStressMPa,
      bendingStressMPa,
      combinedStressMPa,
      vonMisesMPa,
      utilization,
      safetyFactor,
      massKg: c.massKg,
      costCNY: c.costCNY,
      strainEnergyNmm: Math.max(0, strainEnergy),
      basePoints,
      curvePoints,
    };

    if (maxShearN > maxShearForceN) {
      maxShearForceN = maxShearN;
    }
    if (vonMisesMPa >= maxStressMPa) {
      maxStressMPa = vonMisesMPa;
      criticalMemberId = c.member.id;
    }
    if (safetyFactor < minSafetyFactor) {
      minSafetyFactor = safetyFactor;
    }
  }

  // Sum vertical support reactions
  let reactionForceSumY = 0;
  for (let idx = 0; idx < numNodes; idx++) {
    if (nodes[idx].support === 'fixed' || nodes[idx].support === 'pinned') {
      reactionForceSumY += globalInternalForces[idx * 6 + 1] - F[idx * 6 + 1];
    }
  }

  const jointShearCapacityN = jointCraft.shearCapacityN;
  const jointSlipRisk = maxShearForceN > jointShearCapacityN;

  let status: StructuralStatus = 'safe';
  let statusMessage = `${jointCraft.shortName}工艺满足抗弯、抗切向滑移与抗晃要求`;
  if (minSafetyFactor < 1.5 || maxStressMPa > yieldMPa * 0.67 || maxLateralSwayMm > 10 || jointSlipRisk) {
    status = 'critical';
    statusMessage = jointSlipRisk
      ? `节点切向滑移风险（${Math.round(maxShearForceN)} N > ${jointCraft.shortName}上限 ${jointShearCapacityN} N）：请更换三角连接板或加装斜撑`
      : maxLateralSwayMm > 10
        ? `晃动过大（侧移 ${maxLateralSwayMm.toFixed(1)} mm）：${jointCraft.shortName}抗弯不足且缺少斜撑，建议改用三角连接板或一键加斜撑`
        : '警告：局部型材应力接近或超出许用极限，建议升级截面（如 3030/4040）或增加斜撑';
  } else if (minSafetyFactor < 2.5 || maxDisplacementMm > 3.0 || maxLateralSwayMm > 2.5) {
    status = 'warning';
    statusMessage =
      maxLateralSwayMm > 2.5
        ? `存在明显侧向晃动（侧移 ${maxLateralSwayMm.toFixed(2)} mm）：建议升级为三角连接板或加装斜撑`
        : '提示：竖向挠度偏大或安全余量偏低，建议升级主梁截面或加斜撑';
  }

  return {
    isStable: true,
    status,
    statusMessage,
    nodeDisplacements,
    memberResults,
    maxDisplacementMm,
    maxVerticalDeflectionMm,
    maxLateralSwayMm,
    maxDisplacementNodeId,
    maxStressMPa,
    maxShearForceN,
    jointShearCapacityN,
    jointSlipRisk,
    criticalMemberId,
    minSafetyFactor,
    totalMassKg,
    totalCostCNY,
    totalLengthMm,
    totalLoadN,
    totalComplianceNmm: Math.max(0, totalComplianceNmm),
    reactionForceSumY,
  };
}
