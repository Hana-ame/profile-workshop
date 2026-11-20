import type { FrameMember, FrameModel, FrameNode, ProfileId } from './types';

export type PresetId = 'workbench' | 'gantry' | 'rack' | 'cantilever';

export interface PresetMeta {
  id: PresetId;
  name: string;
  subtitle: string;
  defaultDimensions: { widthMm: number; depthMm: number; heightMm: number };
}

export const PRESET_LIST: PresetMeta[] = [
  {
    id: 'workbench',
    name: '重型工业工作台',
    subtitle: '1200×600×750 mm · 均布载荷',
    defaultDimensions: { widthMm: 1200, depthMm: 600, heightMm: 750 },
  },
  {
    id: 'gantry',
    name: '桌面龙门加工架',
    subtitle: '800×600×700 mm · 侧向+垂向主轴载荷',
    defaultDimensions: { widthMm: 800, depthMm: 600, heightMm: 700 },
  },
  {
    id: 'rack',
    name: '三层仓储物料架',
    subtitle: '1000×500×1200 mm · 多层货架载荷',
    defaultDimensions: { widthMm: 1000, depthMm: 500, heightMm: 1200 },
  },
  {
    id: 'cantilever',
    name: '悬臂设备检测架',
    subtitle: '900×500×800 mm · 悬挑偏心载荷',
    defaultDimensions: { widthMm: 900, depthMm: 500, heightMm: 800 },
  },
];

export function cloneFrameModel(model: FrameModel): FrameModel {
  return {
    ...model,
    nodes: model.nodes.map((n) => ({
      ...n,
      position: { ...n.position },
      load: { ...n.load },
    })),
    members: model.members.map((m) => ({ ...m })),
  };
}

function makeNode(
  id: string,
  x: number,
  y: number,
  z: number,
  support: FrameNode['support'] = 'free',
  load = { fx: 0, fy: 0, fz: 0 },
): FrameNode {
  return { id, position: { x, y, z }, support, load };
}

function makeMember(
  id: string,
  startNodeId: string,
  endNodeId: string,
  profileId: ProfileId,
  label: string,
  isBrace = false,
): FrameMember {
  return { id, startNodeId, endNodeId, profileId, label, isBrace };
}

/**
 * 1. Heavy Industrial Workbench (Parametric)
 */
export function buildWorkbenchPreset(
  widthMm = 1200,
  depthMm = 600,
  heightMm = 750,
  profileId: ProfileId = '2020',
): FrameModel {
  const hw = Math.round(widthMm / 2);
  const hd = Math.round(depthMm / 2);
  const shelfY = Math.round(heightMm * 0.25);
  const topY = Math.round(heightMm);

  const nodes: FrameNode[] = [
    // Ground feet (y = 0)
    makeNode('N1', -hw, 0, -hd, 'fixed'),
    makeNode('N2', hw, 0, -hd, 'fixed'),
    makeNode('N3', hw, 0, hd, 'fixed'),
    makeNode('N4', -hw, 0, hd, 'fixed'),
    // Lower rail nodes
    makeNode('N5', -hw, shelfY, -hd),
    makeNode('N6', hw, shelfY, -hd),
    makeNode('N7', hw, shelfY, hd),
    makeNode('N8', -hw, shelfY, hd),
    // Top perimeter corners
    makeNode('N9', -hw, topY, -hd, 'free', { fx: 0, fy: -120, fz: 0 }),
    makeNode('N10', hw, topY, -hd, 'free', { fx: 0, fy: -120, fz: 0 }),
    makeNode('N11', hw, topY, hd, 'free', { fx: 0, fy: -120, fz: 0 }),
    makeNode('N12', -hw, topY, hd, 'free', { fx: 0, fy: -120, fz: 0 }),
    // Mid-span top beam nodes carrying central equipment load (pure vertical at rest; lateral push controlled by FEA slider)
    makeNode('N13', 0, topY, -hd, 'free', { fx: 0, fy: -260, fz: 0 }),
    makeNode('N14', 0, topY, hd, 'free', { fx: 0, fy: -260, fz: 0 }),
  ];

  const members: FrameMember[] = [
    // Lower legs
    makeMember('M1', 'N1', 'N5', profileId, '左下立柱-后'),
    makeMember('M2', 'N2', 'N6', profileId, '右下立柱-后'),
    makeMember('M3', 'N3', 'N7', profileId, '右下立柱-前'),
    makeMember('M4', 'N4', 'N8', profileId, '左下立柱-前'),
    // Upper legs
    makeMember('M5', 'N5', 'N9', profileId, '左上立柱-后'),
    makeMember('M6', 'N6', 'N10', profileId, '右上立柱-后'),
    makeMember('M7', 'N7', 'N11', profileId, '右上立柱-前'),
    makeMember('M8', 'N8', 'N12', profileId, '左上立柱-前'),
    // Lower H-tie rails (rear + sides)
    makeMember('M9', 'N5', 'N6', profileId, '下后横梁'),
    makeMember('M10', 'N5', 'N8', profileId, '下左纵梁'),
    makeMember('M11', 'N6', 'N7', profileId, '下右纵梁'),
    // Top perimeter + center rib
    makeMember('M12', 'N9', 'N13', profileId, '上后主梁-左'),
    makeMember('M13', 'N13', 'N10', profileId, '上后主梁-右'),
    makeMember('M14', 'N12', 'N14', profileId, '上前主梁-左'),
    makeMember('M15', 'N14', 'N11', profileId, '上前主梁-右'),
    makeMember('M16', 'N9', 'N12', profileId, '上左纵梁'),
    makeMember('M17', 'N10', 'N11', profileId, '上右纵梁'),
    makeMember('M18', 'N13', 'N14', profileId, '台面中加强筋'),
  ];

  return {
    id: 'workbench',
    name: '重型工业工作台',
    description: `${widthMm}×${depthMm}×${heightMm} mm 欧标铝型材工作台`,
    nodes,
    members,
  };
}

/**
 * 2. Desktop CNC Gantry Frame
 */
export function buildGantryPreset(
  widthMm = 800,
  depthMm = 600,
  heightMm = 700,
  profileId: ProfileId = '2020',
): FrameModel {
  const hw = Math.round(widthMm / 2);
  const hd = Math.round(depthMm / 2);
  const baseH = 120;
  const topY = Math.round(heightMm);

  const nodes: FrameNode[] = [
    // Base ground supports
    makeNode('G1', -hw, 0, -hd, 'fixed'),
    makeNode('G2', hw, 0, -hd, 'fixed'),
    makeNode('G3', hw, 0, hd, 'fixed'),
    makeNode('G4', -hw, 0, hd, 'fixed'),
    // Mid-side gantry mount bases
    makeNode('G5', -hw, baseH, -hd),
    makeNode('G6', hw, baseH, -hd),
    makeNode('G7', hw, baseH, hd),
    makeNode('G8', -hw, baseH, hd),
    makeNode('G9', -hw, baseH, 0),
    makeNode('G10', hw, baseH, 0),
    // Gantry top bridge
    makeNode('G11', -hw, topY, 0),
    makeNode('G12', hw, topY, 0),
    // Spindle head center node (vertical cutting force + lateral X/Z thrust)
    makeNode('G13', 0, topY, 0, 'free', { fx: 280, fy: -1400, fz: 220 }),
  ];

  const members: FrameMember[] = [
    // Short feet posts
    makeMember('GM1', 'G1', 'G5', profileId, '底座支脚-左后'),
    makeMember('GM2', 'G2', 'G6', profileId, '底座支脚-右后'),
    makeMember('GM3', 'G3', 'G7', profileId, '底座支脚-右前'),
    makeMember('GM4', 'G4', 'G8', profileId, '底座支脚-左前'),
    // Base frame
    makeMember('GM5', 'G5', 'G6', profileId, '底座后梁'),
    makeMember('GM6', 'G8', 'G7', profileId, '底座前梁'),
    makeMember('GM7', 'G5', 'G9', profileId, '底座左导轨-后'),
    makeMember('GM8', 'G9', 'G8', profileId, '底座左导轨-前'),
    makeMember('GM9', 'G6', 'G10', profileId, '底座右导轨-后'),
    makeMember('GM10', 'G10', 'G7', profileId, '底座右导轨-前'),
    makeMember('GM11', 'G9', 'G10', profileId, '底座中横撑'),
    // Gantry uprights & bridge
    makeMember('GM12', 'G9', 'G11', profileId, '龙门左立柱'),
    makeMember('GM13', 'G10', 'G12', profileId, '龙门右立柱'),
    makeMember('GM14', 'G11', 'G13', profileId, '龙门主横梁-左'),
    makeMember('GM15', 'G13', 'G12', profileId, '龙门主横梁-右'),
  ];

  return {
    id: 'gantry',
    name: '桌面龙门加工架',
    description: `${widthMm}×${depthMm}×${heightMm} mm CNC 龙门框架`,
    nodes,
    members,
  };
}

/**
 * 3. 3-Tier Industrial Storage Rack
 */
export function buildRackPreset(
  widthMm = 1000,
  depthMm = 500,
  heightMm = 1200,
  profileId: ProfileId = '2020',
): FrameModel {
  const hw = Math.round(widthMm / 2);
  const hd = Math.round(depthMm / 2);
  const y1 = Math.round(heightMm * 0.35);
  const y2 = Math.round(heightMm * 0.7);
  const y3 = Math.round(heightMm);

  const nodes: FrameNode[] = [
    // Level 0 (floor)
    makeNode('R1', -hw, 0, -hd, 'fixed'),
    makeNode('R2', hw, 0, -hd, 'fixed'),
    makeNode('R3', hw, 0, hd, 'fixed'),
    makeNode('R4', -hw, 0, hd, 'fixed'),
    // Level 1
    makeNode('R5', -hw, y1, -hd, 'free', { fx: 0, fy: -320, fz: 0 }),
    makeNode('R6', hw, y1, -hd, 'free', { fx: 0, fy: -320, fz: 0 }),
    makeNode('R7', hw, y1, hd, 'free', { fx: 0, fy: -320, fz: 0 }),
    makeNode('R8', -hw, y1, hd, 'free', { fx: 0, fy: -320, fz: 0 }),
    // Level 2
    makeNode('R9', -hw, y2, -hd, 'free', { fx: 40, fy: -300, fz: 0 }),
    makeNode('R10', hw, y2, -hd, 'free', { fx: 40, fy: -300, fz: 0 }),
    makeNode('R11', hw, y2, hd, 'free', { fx: 40, fy: -300, fz: 0 }),
    makeNode('R12', -hw, y2, hd, 'free', { fx: 40, fy: -300, fz: 0 }),
    // Level 3 (top)
    makeNode('R13', -hw, y3, -hd, 'free', { fx: 75, fy: -280, fz: 0 }),
    makeNode('R14', hw, y3, -hd, 'free', { fx: 75, fy: -280, fz: 0 }),
    makeNode('R15', hw, y3, hd, 'free', { fx: 75, fy: -280, fz: 0 }),
    makeNode('R16', -hw, y3, hd, 'free', { fx: 75, fy: -280, fz: 0 }),
  ];

  const members: FrameMember[] = [
    // Columns tier 1
    makeMember('RM1', 'R1', 'R5', profileId, '立柱一层-左后'),
    makeMember('RM2', 'R2', 'R6', profileId, '立柱一层-右后'),
    makeMember('RM3', 'R3', 'R7', profileId, '立柱一层-右前'),
    makeMember('RM4', 'R4', 'R8', profileId, '立柱一层-左前'),
    // Columns tier 2
    makeMember('RM5', 'R5', 'R9', profileId, '立柱二层-左后'),
    makeMember('RM6', 'R6', 'R10', profileId, '立柱二层-右后'),
    makeMember('RM7', 'R7', 'R11', profileId, '立柱二层-右前'),
    makeMember('RM8', 'R8', 'R12', profileId, '立柱二层-左前'),
    // Columns tier 3
    makeMember('RM9', 'R9', 'R13', profileId, '立柱三层-左后'),
    makeMember('RM10', 'R10', 'R14', profileId, '立柱三层-右后'),
    makeMember('RM11', 'R11', 'R15', profileId, '立柱三层-右前'),
    makeMember('RM12', 'R12', 'R16', profileId, '立柱三层-左前'),
    // Shelf 1 beams
    makeMember('RM13', 'R5', 'R6', profileId, '一层后梁'),
    makeMember('RM14', 'R8', 'R7', profileId, '一层前梁'),
    makeMember('RM15', 'R5', 'R8', profileId, '一层左梁'),
    makeMember('RM16', 'R6', 'R7', profileId, '一层右梁'),
    // Shelf 2 beams
    makeMember('RM17', 'R9', 'R10', profileId, '二层后梁'),
    makeMember('RM18', 'R12', 'R11', profileId, '二层前梁'),
    makeMember('RM19', 'R9', 'R12', profileId, '二层左梁'),
    makeMember('RM20', 'R10', 'R11', profileId, '二层右梁'),
    // Shelf 3 beams
    makeMember('RM21', 'R13', 'R14', profileId, '顶层后梁'),
    makeMember('RM22', 'R16', 'R15', profileId, '顶层前梁'),
    makeMember('RM23', 'R13', 'R16', profileId, '顶层左梁'),
    makeMember('RM24', 'R14', 'R15', profileId, '顶层右梁'),
  ];

  return {
    id: 'rack',
    name: '三层仓储物料架',
    description: `${widthMm}×${depthMm}×${heightMm} mm 多层铝型材货架`,
    nodes,
    members,
  };
}

/**
 * 4. Cantilever Equipment Inspection Stand
 * Classic high-bending showcase where diagonal bracing & section sizing show huge gains!
 */
export function buildCantileverPreset(
  widthMm = 900,
  depthMm = 500,
  heightMm = 800,
  profileId: ProfileId = '2020',
): FrameModel {
  const baseW = Math.round(widthMm * 0.45);
  const armW = Math.round(widthMm * 0.55);
  const hd = Math.round(depthMm / 2);
  const midY = Math.round(heightMm * 0.45);
  const topY = Math.round(heightMm);

  const nodes: FrameNode[] = [
    // Ground base
    makeNode('C1', -baseW, 0, -hd, 'fixed'),
    makeNode('C2', 0, 0, -hd, 'fixed'),
    makeNode('C3', 0, 0, hd, 'fixed'),
    makeNode('C4', -baseW, 0, hd, 'fixed'),
    // Mid-height spine nodes
    makeNode('C5', -baseW, midY, -hd),
    makeNode('C6', 0, midY, -hd),
    makeNode('C7', 0, midY, hd),
    makeNode('C8', -baseW, midY, hd),
    // Top spine nodes
    makeNode('C9', -baseW, topY, -hd),
    makeNode('C10', 0, topY, -hd),
    makeNode('C11', 0, topY, hd),
    makeNode('C12', -baseW, topY, hd),
    // Overhanging cantilever tip nodes carrying sensor/vision head load
    makeNode('C13', armW, topY, -hd, 'free', { fx: 0, fy: -650, fz: 0 }),
    makeNode('C14', armW, topY, hd, 'free', { fx: 0, fy: -650, fz: 0 }),
  ];

  const members: FrameMember[] = [
    // Base ring
    makeMember('CM1', 'C1', 'C2', profileId, '底座后梁'),
    makeMember('CM2', 'C4', 'C3', profileId, '底座前梁'),
    makeMember('CM3', 'C1', 'C4', profileId, '底座左梁'),
    makeMember('CM4', 'C2', 'C3', profileId, '底座右梁'),
    // Lower columns
    makeMember('CM5', 'C1', 'C5', profileId, '下立柱-左后'),
    makeMember('CM6', 'C2', 'C6', profileId, '下立柱-右后'),
    makeMember('CM7', 'C3', 'C7', profileId, '下立柱-右前'),
    makeMember('CM8', 'C4', 'C8', profileId, '下立柱-左前'),
    // Mid ring
    makeMember('CM9', 'C5', 'C6', profileId, '中框后梁'),
    makeMember('CM10', 'C8', 'C7', profileId, '中框前梁'),
    makeMember('CM11', 'C5', 'C8', profileId, '中框左梁'),
    makeMember('CM12', 'C6', 'C7', profileId, '中框右梁'),
    // Upper columns
    makeMember('CM13', 'C5', 'C9', profileId, '上立柱-左后'),
    makeMember('CM14', 'C6', 'C10', profileId, '上立柱-右后'),
    makeMember('CM15', 'C7', 'C11', profileId, '上立柱-右前'),
    makeMember('CM16', 'C8', 'C12', profileId, '上立柱-左前'),
    // Top spine ring
    makeMember('CM17', 'C9', 'C10', profileId, '顶框后梁'),
    makeMember('CM18', 'C12', 'C11', profileId, '顶框前梁'),
    makeMember('CM19', 'C9', 'C12', profileId, '顶框左梁'),
    makeMember('CM20', 'C10', 'C11', profileId, '顶框右梁'),
    // Cantilever overhang arms
    makeMember('CM21', 'C10', 'C13', profileId, '悬臂主梁-后'),
    makeMember('CM22', 'C11', 'C14', profileId, '悬臂主梁-前'),
    makeMember('CM23', 'C13', 'C14', profileId, '悬臂端头横梁'),
  ];

  return {
    id: 'cantilever',
    name: '悬臂设备检测架',
    description: `${widthMm}×${depthMm}×${heightMm} mm 悬挑支架`,
    nodes,
    members,
  };
}

export function buildPreset(
  presetId: PresetId,
  dims?: { widthMm: number; depthMm: number; heightMm: number },
  profileId?: ProfileId,
): FrameModel {
  const pid: ProfileId = profileId ?? '2020';
  switch (presetId) {
    case 'gantry':
      return buildGantryPreset(dims?.widthMm, dims?.depthMm, dims?.heightMm, pid);
    case 'rack':
      return buildRackPreset(dims?.widthMm, dims?.depthMm, dims?.heightMm, pid);
    case 'cantilever':
      return buildCantileverPreset(dims?.widthMm, dims?.depthMm, dims?.heightMm, pid);
    case 'workbench':
    default:
      return buildWorkbenchPreset(dims?.widthMm, dims?.depthMm, dims?.heightMm, pid);
  }
}
