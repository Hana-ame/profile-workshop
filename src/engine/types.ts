export type ProfileId = '2020' | '2040' | '3030' | '4040' | '4080';

export type SupportType = 'free' | 'pinned' | 'fixed';

export type JointType = 'pinned' | 'builtin' | 'semi-rigid' | 'gusset-plate' | 'rigid';

export type FinishType = 'silver' | 'black';

export type WorkspaceTab = 'draw' | 'fea' | 'optimize' | 'bom';

export type CadTool =
  | 'select-member'
  | 'select-node'
  | 'draw-beam'
  | 'add-node'
  | 'add-load'
  | 'toggle-support';

export type ColorMode = 'material' | 'stress' | 'axial';

export type CameraPreset = 'iso' | 'front' | 'top' | 'side';

export type OptimizationStrategy = 'sizing' | 'bracing' | 'combined';

export interface ProfileSpec {
  id: ProfileId;
  name: string;
  widthMm: number;       // Cross-section width along local z (mm)
  heightMm: number;      // Cross-section height along local y (mm)
  slotWidthMm: number;   // T-slot opening width (mm)
  areaMm2: number;       // Cross-sectional area A (mm^2)
  ixMm4: number;         // Strong axis moment of inertia Iz (bending in local y, mm^4)
  iyMm4: number;         // Weak axis moment of inertia Iy (bending in local z, mm^4)
  wxMm3: number;         // Section modulus Wz (mm^3)
  wyMm3: number;         // Section modulus Wy (mm^3)
  jMm4: number;          // Torsional constant J (mm^4)
  massPerMeterKg: number;
  pricePerMeterCNY: number;
}

export interface Vec3 {
  x: number; // mm (width)
  y: number; // mm (height, 0 = floor)
  z: number; // mm (depth)
}

export interface ForceVec3 {
  fx: number; // Newtons
  fy: number; // Newtons (negative = downward)
  fz: number; // Newtons
}

export interface FrameNode {
  id: string;
  position: Vec3;        // Coordinates in mm
  support: SupportType;
  load: ForceVec3;       // External nodal point load (N)
}

export interface FrameMember {
  id: string;
  startNodeId: string;
  endNodeId: string;
  profileId: ProfileId;
  isBrace?: boolean;
  locked?: boolean;
  label?: string;
}

export interface FrameModel {
  id: string;
  name: string;
  description: string;
  nodes: FrameNode[];
  members: FrameMember[];
}

export interface NodeDisplacement {
  nodeId: string;
  dx: number; // mm
  dy: number; // mm
  dz: number; // mm
  rx: number; // rad
  ry: number; // rad
  rz: number; // rad
  magnitudeMm: number;
}

export interface MemberResult {
  memberId: string;
  lengthMm: number;
  axialForceN: number;         // + tension, - compression
  maxShearN: number;
  maxMomentNmm: number;
  axialStressMPa: number;
  bendingStressMPa: number;
  combinedStressMPa: number;   // Max normal stress |N/A| + |My/Wy| + |Mz/Wz|
  vonMisesMPa: number;         // Equivalent Von Mises stress including shear
  utilization: number;         // vonMisesMPa / yieldStressMPa
  safetyFactor: number;        // yieldStressMPa / vonMisesMPa (capped at 99)
  massKg: number;
  costCNY: number;
  strainEnergyNmm: number;
  // Local end displacements & rotations for exact cubic Hermite deflected shape
  curvePoints: Vec3[];         // Displaced points (unscaled delta added to base)
  basePoints: Vec3[];          // Undeformed points along beam
}

export type StructuralStatus = 'safe' | 'warning' | 'critical' | 'unstable';

export interface FeaResult {
  isStable: boolean;
  status: StructuralStatus;
  statusMessage: string;
  nodeDisplacements: Record<string, NodeDisplacement>;
  memberResults: Record<string, MemberResult>;
  maxDisplacementMm: number;
  maxVerticalDeflectionMm: number;
  maxLateralSwayMm: number;
  maxDisplacementNodeId: string | null;
  maxStressMPa: number;
  maxShearForceN: number;
  jointShearCapacityN: number;
  jointSlipRisk: boolean;
  criticalMemberId: string | null;
  minSafetyFactor: number;
  totalMassKg: number;
  totalCostCNY: number;
  totalLengthMm: number;
  totalLoadN: number;
  totalComplianceNmm: number;
  reactionForceSumY: number;
}

export interface OptimizationConstraints {
  strategy: OptimizationStrategy;
  targetSafetyFactor: number;
  maxDeflectionMm: number;
  maxNewBraces: number;
  allowProfiles: ProfileId[];
  includeGravity: boolean;
  loadMultiplier: number;
  jointType?: JointType;
  lateralPushN?: number;
}

export interface OptimizationStep {
  iteration: number;
  action: string;
  massKg: number;
  costCNY: number;
  maxDisplacementMm: number;
  minSafetyFactor: number;
  maxStressMPa: number;
}

export interface OptimizationReport {
  strategy: OptimizationStrategy;
  beforeModel: FrameModel;
  afterModel: FrameModel;
  beforeFea: FeaResult;
  afterFea: FeaResult;
  history: OptimizationStep[];
  massDeltaPct: number;        // negative means lighter
  costDeltaPct: number;
  deflectionDeltaPct: number;  // negative means stiffer
  stressDeltaPct: number;
  addedBraceCount: number;
  resizedMemberCount: number;
  summary: string;
}

export interface AutoDesignWeights {
  material: number;   // 1..5 weight for low mass & cost
  stability: number;  // 1..5 weight for low sway & deflection
  brackets: number;   // 1..5 weight for fewer corner brackets / hardware
}

export type AutoDesignSchemeId = 'balanced' | 'eco-brackets' | 'ultra-rigid';

export interface AutoDesignCandidate {
  id: AutoDesignSchemeId;
  title: string;
  tagline: string;
  model: FrameModel;
  fea: FeaResult;
  recommendedJointType: JointType;
  bracketCount: number;
  fastenerSetCount: number;
  stockBarsNeeded: number;
  totalMassKg: number;
  totalCostCNY: number;
  maxSwayMm: number;
  maxDeflectionMm: number;
  minSafetyFactor: number;
  addedMemberCount: number;
  resizedMemberCount: number;
  lockedMemberCount: number;
  /** Weighted multi-objective score 0..100 */
  score: number;
  /** Highlights of what was auto-computed around locked members */
  highlights: string[];
  /** Explicit real-world assembly craft for diagonal/triangular connections */
  assemblyMethod: string;
  /** Number of 45° mitered knee braces */
  miter45BraceCount: number;
  /** Number of arbitrary-angle long braces using swivel hinges */
  swivelHingeCount: number;
}

export interface AutoDesignResult {
  beforeModel: FrameModel;
  beforeFea: FeaResult;
  beforeBracketCount: number;
  beforeTotalCostCNY: number;
  lockedMemberIds: string[];
  candidates: AutoDesignCandidate[];
  recommendedId: AutoDesignSchemeId;
}

export type BraceConnectionCraft = 'orthogonal' | 'miter-45' | 'swivel-hinge';

export interface DiagonalMemberGuide {
  memberId: string;
  label: string;
  profileId: ProfileId;
  lengthMm: number;
  isDiagonal: boolean;
  craft: BraceConnectionCraft;
  angleStartDeg: number;
  angleEndDeg: number;
  craftTitle: string;
  cutSpec: string;
  hardwareName: string;
  hardwareQty: number;
  assemblySteps: string;
}

export interface StockBarPlan {
  barIndex: number;
  profileId: ProfileId;
  stockLengthMm: number;
  cuts: { memberId: string; lengthMm: number; label: string; cutSpec?: string }[];
  usedMm: number;
  kerfMm: number;
  wasteMm: number;
  utilizationPct: number;
}

export interface BomSummary {
  profileRows: {
    profileId: ProfileId;
    name: string;
    pieceCount: number;
    totalLengthMm: number;
    stockBarsNeeded: number;
    utilizationPct: number;
    massKg: number;
    costCNY: number;
  }[];
  hardwareRows: {
    id: string;
    name: string;
    spec: string;
    quantity: number;
    unit: string;
    unitPriceCNY: number;
    totalPriceCNY: number;
  }[];
  diagonalGuides: DiagonalMemberGuide[];
  stockPlans: StockBarPlan[];
  totalProfileCostCNY: number;
  totalHardwareCostCNY: number;
  grandTotalCostCNY: number;
  totalMassKg: number;
  overallUtilizationPct: number;
}
