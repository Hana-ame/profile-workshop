import type {
  BraceConnectionCraft,
  DiagonalMemberGuide,
  FrameMember,
  FrameModel,
  FrameNode,
  Vec3,
} from './types';

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3): Vec3 {
  const l = len(v);
  if (l < 1e-6) return { x: 1, y: 0, z: 0 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Returns true when a member is aligned with the global X, Y, or Z axis within 3 degrees.
 */
export function isOrthogonalDirection(dir: Vec3): boolean {
  const u = normalize(dir);
  const maxComp = Math.max(Math.abs(u.x), Math.abs(u.y), Math.abs(u.z));
  return maxComp >= Math.cos((3 * Math.PI) / 180);
}

/**
 * Finds the acute angle (in degrees, 0..90) between a diagonal member's outgoing direction
 * from `nodeId` and the primary orthogonal frame beam/column meeting at `nodeId`.
 */
function computeEndpointAngleDeg(
  model: FrameModel,
  nodeMap: Map<string, FrameNode>,
  member: FrameMember,
  nodeId: string,
  outDir: Vec3,
): number {
  const uOut = normalize(outDir);
  let bestAngle = 90;
  let foundNeighbor = false;

  for (const other of model.members) {
    if (other.id === member.id) continue;
    if (other.startNodeId !== nodeId && other.endNodeId !== nodeId) continue;

    const otherEndId = other.startNodeId === nodeId ? other.endNodeId : other.startNodeId;
    const nSelf = nodeMap.get(nodeId);
    const nOther = nodeMap.get(otherEndId);
    if (!nSelf || !nOther) continue;

    const otherVec = sub(nOther.position, nSelf.position);
    if (!isOrthogonalDirection(otherVec)) continue;

    const uOther = normalize(otherVec);
    const c = Math.max(-1, Math.min(1, Math.abs(dot(uOut, uOther))));
    const deg = (Math.acos(c) * 180) / Math.PI;
    // Prefer the acute miter angle against the coplanar frame leg (10°..80°)
    if (deg >= 5 && deg <= 85) {
      if (!foundNeighbor || Math.abs(deg - 45) < Math.abs(bestAngle - 45)) {
        bestAngle = deg;
        foundNeighbor = true;
      }
    }
  }

  if (foundNeighbor) return Math.round(bestAngle * 10) / 10;

  // Fallback: angle against global vertical axis Y
  const cY = Math.max(-1, Math.min(1, Math.abs(uOut.y)));
  const degY = (Math.acos(cY) * 180) / Math.PI;
  return Math.round(degY * 10) / 10;
}

/**
 * Analyzes how any aluminum extrusion member should be physically cut and connected in real assembly.
 */
export function analyzeMemberConnection(
  model: FrameModel,
  member: FrameMember,
): DiagonalMemberGuide {
  const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));
  const n1 = nodeMap.get(member.startNodeId);
  const n2 = nodeMap.get(member.endNodeId);

  if (!n1 || !n2) {
    return {
      memberId: member.id,
      label: member.label ?? member.id,
      profileId: member.profileId,
      lengthMm: 0,
      isDiagonal: false,
      craft: 'orthogonal',
      angleStartDeg: 90,
      angleEndDeg: 90,
      craftTitle: '90° 直角常规连接',
      cutSpec: '90°平切',
      hardwareName: '直角角码 / 内置连接件',
      hardwareQty: 2,
      assemblySteps: '两端 90° 平切，使用常规直角角码或内置连接件锁紧。',
    };
  }

  const vec = sub(n2.position, n1.position);
  const lengthMm = Math.round(len(vec));

  if (isOrthogonalDirection(vec)) {
    return {
      memberId: member.id,
      label: member.label ?? member.id,
      profileId: member.profileId,
      lengthMm,
      isDiagonal: false,
      craft: 'orthogonal',
      angleStartDeg: 90,
      angleEndDeg: 90,
      craftTitle: '90° 直角常规连接',
      cutSpec: '90°平切',
      hardwareName: '直角角码 / 三角连接板',
      hardwareQty: 2,
      assemblySteps: '两端 90° 平切，贴合主框 T 型槽用直角角码、内置连接件或三角连接板锁紧。',
    };
  }

  const angleStartDeg = computeEndpointAngleDeg(model, nodeMap, member, n1.id, vec);
  const angleEndDeg = computeEndpointAngleDeg(
    model,
    nodeMap,
    member,
    n2.id,
    { x: -vec.x, y: -vec.y, z: -vec.z },
  );

  // Within 45° ± 1.2° at both ends => true standard 45° mitered knee brace
  const isMiter45 =
    Math.abs(angleStartDeg - 45) <= 1.2 && Math.abs(angleEndDeg - 45) <= 1.2;

  const craft: BraceConnectionCraft = isMiter45 ? 'miter-45' : 'swivel-hinge';

  if (craft === 'miter-45') {
    return {
      memberId: member.id,
      label: member.label ?? member.id,
      profileId: member.profileId,
      lengthMm,
      isDiagonal: true,
      craft: 'miter-45',
      angleStartDeg,
      angleEndDeg,
      craftTitle: '45° 斜切角撑 + 45°/135° 斜角码',
      cutSpec: '两端45°斜切',
      hardwareName: '45°/135° 专用斜角连接块',
      hardwareQty: 2,
      assemblySteps:
        '两端按 45° 斜切贴合立柱与横梁凹槽，在夹角处用 45°/135° 专用斜角码 + T型滑块螺母锁紧（也可直接用带 45° 斜撑槽的角件）。',
    };
  }

  return {
    memberId: member.id,
    label: member.label ?? member.id,
    profileId: member.profileId,
    lengthMm,
    isDiagonal: true,
    craft: 'swivel-hinge',
    angleStartDeg,
    angleEndDeg,
    craftTitle: '90° 平切 + 万向活动铰链（免斜切）',
    cutSpec: '90°平切(配万向铰链)',
    hardwareName: '铝型材万向活动铰链 (任意角度转向件)',
    hardwareQty: 2,
    assemblySteps: `两端夹角为 ${angleStartDeg.toFixed(1)}° / ${angleEndDeg.toFixed(1)}°（非标准 45°），普通角码装不上！型材两端只需 90° 平切，各装 1 个万向活动铰链（端面攻丝锁入或卡槽锁紧），再将铰链另一端拧入主框 T 型槽即可。`,
  };
}

export interface FrameDiagonalHardwareSummary {
  guides: DiagonalMemberGuide[];
  miter45MemberCount: number;
  miter45BracketCount: number;
  swivelHingeMemberCount: number;
  swivelHingeCount: number;
}

/**
 * Summarizes every diagonal/triangular aluminum extrusion in the model and exact specialized hardware needed.
 */
export function summarizeFrameDiagonalHardware(
  model: FrameModel,
): FrameDiagonalHardwareSummary {
  const guides: DiagonalMemberGuide[] = [];
  let miter45MemberCount = 0;
  let swivelHingeMemberCount = 0;

  for (const m of model.members) {
    const g = analyzeMemberConnection(model, m);
    if (!g.isDiagonal) continue;
    guides.push(g);
    if (g.craft === 'miter-45') miter45MemberCount++;
    else if (g.craft === 'swivel-hinge') swivelHingeMemberCount++;
  }

  return {
    guides,
    miter45MemberCount,
    miter45BracketCount: miter45MemberCount * 2,
    swivelHingeMemberCount,
    swivelHingeCount: swivelHingeMemberCount * 2,
  };
}
