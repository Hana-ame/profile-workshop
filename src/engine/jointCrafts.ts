import type { JointType } from './types';

export interface JointCraftSpec {
  id: JointType;
  name: string;
  shortName: string;
  description: string;
  /** Rotational moment transfer fixity factor (0..1) */
  fixityFactor: number;
  /** Single-joint tangential / shear slip resistance (N) for 2020-4040 T-slot hardware */
  shearCapacityN: number;
  /** Hermite curve blending weight for 3D visual deformation */
  hermiteWeight: number;
}

export const JOINT_CRAFT_ORDER: JointType[] = [
  'builtin',
  'semi-rigid',
  'gusset-plate',
  'rigid',
  'pinned',
];

export const JOINT_CRAFT_CATALOG: Record<JointType, JointCraftSpec> = {
  pinned: {
    id: 'pinned',
    name: '纯铰接（活动铰链/松动）',
    shortName: '纯铰接',
    description: '节点可自由转动，无斜撑时受切向推力极易大幅晃动',
    fixityFactor: 0.012,
    shearCapacityN: 300,
    hermiteWeight: 0,
  },
  builtin: {
    id: 'builtin',
    name: '内置连接件 / 十字螺栓',
    shortName: '内置连接件',
    description: '外观隐蔽但抗弯力臂极小，2020型材受侧向推力最容易晃',
    fixityFactor: 0.06,
    shearCapacityN: 450,
    hermiteWeight: 0.18,
  },
  'semi-rigid': {
    id: 'semi-rigid',
    name: '标准铸铝角码（2孔）',
    shortName: '标准角码',
    description: '最常用T型螺母+铸铝角码工艺，常规半刚性连接',
    fixityFactor: 0.3,
    shearCapacityN: 900,
    hermiteWeight: 0.55,
  },
  'gusset-plate': {
    id: 'gusset-plate',
    name: '加厚三角/L型连接板',
    shortName: '三角连接板',
    description: '4~5颗螺栓锁紧外置加厚铝板，大幅提升抗弯与抗切向滑移',
    fixityFactor: 0.72,
    shearCapacityN: 2200,
    hermiteWeight: 0.85,
  },
  rigid: {
    id: 'rigid',
    name: '穿心锁死 / 满焊刚接',
    shortName: '全刚接',
    description: '理想刚性节点基准，完全传递弯矩与切向剪力',
    fixityFactor: 1.0,
    shearCapacityN: 4500,
    hermiteWeight: 1.0,
  },
};

export function getJointCraftSpec(jointType: JointType): JointCraftSpec {
  return JOINT_CRAFT_CATALOG[jointType] ?? JOINT_CRAFT_CATALOG['semi-rigid'];
}
