import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { analyzeMemberConnection } from '../engine/braceConnection';
import { canAutoMergeNode } from '../engine/frameEditing';
import {
  getJointCraftSpec,
  JOINT_CRAFT_CATALOG,
  JOINT_CRAFT_ORDER,
} from '../engine/jointCrafts';
import { PRESET_LIST, type PresetId } from '../engine/presets';
import { PROFILE_CATALOG, PROFILE_ORDER } from '../engine/profiles';
import type { SwaySummary } from '../engine/swayAnalysis';
import { SwayViewerCard } from './SwayViewerCard';
import type {
  AutoDesignResult,
  AutoDesignSchemeId,
  AutoDesignWeights,
  CadTool,
  ColorMode,
  FeaResult,
  FinishType,
  FrameMember,
  FrameModel,
  FrameNode,
  JointType,
  OptimizationConstraints,
  OptimizationReport,
  OptimizationStrategy,
  ProfileId,
  SupportType,
  WorkspaceTab,
} from '../engine/types';

export interface RightInspectorPanelProps {
  activeTab: WorkspaceTab;
  collapsed: boolean;
  onToggleCollapse: () => void;

  // Model & presets
  activePreset: PresetId;
  onSelectPreset: (preset: PresetId) => void;
  dimensions: { widthMm: number; depthMm: number; heightMm: number };
  onApplyDimensions: (dims: { widthMm: number; depthMm: number; heightMm: number }) => void;
  model: FrameModel;
  fea: FeaResult;

  // Drawing controls
  cadTool: CadTool;
  activeProfile: ProfileId;
  onSelectActiveProfile: (profile: ProfileId) => void;
  onApplyProfileToAll: (profile: ProfileId) => void;
  finish: FinishType;
  onSelectFinish: (finish: FinishType) => void;
  workplaneY: number;
  onChangeWorkplaneY: (y: number) => void;
  drawStartNodeId: string | null;
  onCancelDraw: () => void;

  // Selection inspection / editing
  selectedMember: FrameMember | null;
  selectedNode: FrameNode | null;
  onSelectMember: (memberId: string | null) => void;
  onSelectNode: (nodeId: string | null) => void;
  onChangeMemberProfile: (memberId: string, profileId: ProfileId) => void;
  onToggleMemberLock: (memberId: string) => void;
  onQuickLockGroup: (group: 'top-rails' | 'columns' | 'clear') => void;
  onReplaceBraceWithGusset: (memberId: string) => void;
  onDeleteMember: (memberId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onUpdateNodePosition: (nodeId: string, pos: { x: number; y: number; z: number }) => void;
  onUpdateNodeLoad: (nodeId: string, load: { fx: number; fy: number; fz: number }) => void;
  onUpdateNodeSupport: (nodeId: string, support: SupportType) => void;

  // FEA controls
  colorMode: ColorMode;
  onSelectColorMode: (mode: ColorMode) => void;
  deformScale: number;
  onChangeDeformScale: (scale: number) => void;
  loadMultiplier: number;
  onChangeLoadMultiplier: (mult: number) => void;
  includeGravity: boolean;
  onToggleGravity: () => void;
  jointType: JointType;
  onChangeJointType: (jt: JointType) => void;
  lateralPushN: number;
  onChangeLateralPushN: (n: number) => void;
  comparePushN: number;
  craftComparisons: {
    id: JointType;
    swayMm: number;
    maxShearN: number;
    slipRisk: boolean;
    isStable: boolean;
  }[];
  swaySummary: SwaySummary;
  showSwayEnvelope: boolean;
  onToggleSwayEnvelope: () => void;
  onQuickAntiSway: () => void;

  // Optimization & Constrained Auto-Designer controls
  optConstraints: OptimizationConstraints;
  onChangeOptConstraints: (next: OptimizationConstraints) => void;
  optReport: OptimizationReport | null;
  optPreviewMode: 'after' | 'before';
  onChangeOptPreviewMode: (mode: 'after' | 'before') => void;
  onRunOptimization: () => void;
  onApplyOptimization: () => void;
  onClearOptimization: () => void;
  autoWeights: AutoDesignWeights;
  onChangeAutoWeights: (next: AutoDesignWeights) => void;
  autoMaxSwayMm: number;
  onChangeAutoMaxSwayMm: (mm: number) => void;
  autoDesignResult: AutoDesignResult | null;
  autoPreviewId: AutoDesignSchemeId | 'before';
  onSelectAutoPreviewId: (id: AutoDesignSchemeId | 'before') => void;
  onRunAutoDesign: () => void;
  onApplyAutoDesign: (schemeId: AutoDesignSchemeId) => void;
  onClearAutoDesign: () => void;
}

const PRESET_SHORT_DESC: Record<PresetId, string> = {
  workbench: '四柱承重 · 工作台',
  gantry: '跨梁加工 · 龙门架',
  rack: '三层立柱 · 物料架',
  cantilever: '侧壁悬挑 · 检测架',
};

const STRATEGY_ITEMS: { id: OptimizationStrategy; label: string }[] = [
  { id: 'combined', label: '联合寻优' },
  { id: 'bracing', label: '斜撑加固' },
  { id: 'sizing', label: '截面减重' },
];

function ConvergenceChart({ report }: { report: OptimizationReport }) {
  const pts = report.history;
  if (pts.length < 2) return null;

  const width = 296;
  const height = 74;
  const pad = 8;
  const maxDisp = Math.max(...pts.map((p) => p.maxDisplacementMm), 0.01);
  const maxMass = Math.max(...pts.map((p) => p.massKg), 0.1);
  const minMass = Math.min(...pts.map((p) => p.massKg), maxMass * 0.8);
  const massSpan = Math.max(0.1, maxMass - minMass);

  const dispPoints = pts
    .map((p, i) => {
      const x = pad + (i / (pts.length - 1)) * (width - pad * 2);
      const y = height - pad - (p.maxDisplacementMm / maxDisp) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const massPoints = pts
    .map((p, i) => {
      const x = pad + (i / (pts.length - 1)) * (width - pad * 2);
      const y = height - pad - ((p.massKg - minMass) / massSpan) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>收敛过程（{pts.length - 1} 轮迭代）</span>
        <span className="font-mono tabular-nums">
          <span className="text-blue-700">位移</span> / <span className="text-emerald-700">质量</span>
        </span>
      </div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="bg-slate-50 border border-slate-200 rounded-md"
        aria-label="算法迭代收敛曲线"
      >
        <polyline fill="none" stroke="#1D4ED8" strokeWidth="2" points={dispPoints} />
        <polyline
          fill="none"
          stroke="#059669"
          strokeWidth="1.75"
          strokeDasharray="4 2"
          points={massPoints}
        />
      </svg>
    </div>
  );
}

export function RightInspectorPanel(props: RightInspectorPanelProps) {
  const {
    activeTab,
    collapsed,
    onToggleCollapse,
    activePreset,
    onSelectPreset,
    dimensions,
    onApplyDimensions,
    model,
    fea,
    cadTool,
    activeProfile,
    onSelectActiveProfile,
    onApplyProfileToAll,
    finish,
    onSelectFinish,
    workplaneY,
    onChangeWorkplaneY,
    drawStartNodeId,
    onCancelDraw,
    selectedMember,
    selectedNode,
    onSelectMember,
    onSelectNode,
    onChangeMemberProfile,
    onToggleMemberLock,
    onQuickLockGroup,
    onReplaceBraceWithGusset,
    onDeleteMember,
    onDeleteNode,
    onUpdateNodePosition,
    onUpdateNodeLoad,
    onUpdateNodeSupport,
    colorMode,
    onSelectColorMode,
    deformScale,
    onChangeDeformScale,
    loadMultiplier,
    onChangeLoadMultiplier,
    includeGravity,
    onToggleGravity,
    jointType,
    onChangeJointType,
    lateralPushN,
    onChangeLateralPushN,
    comparePushN,
    craftComparisons,
    swaySummary,
    showSwayEnvelope,
    onToggleSwayEnvelope,
    onQuickAntiSway,
    optConstraints,
    onChangeOptConstraints,
    optReport,
    optPreviewMode,
    onChangeOptPreviewMode,
    onRunOptimization,
    onApplyOptimization,
    onClearOptimization,
    autoWeights,
    onChangeAutoWeights,
    autoMaxSwayMm,
    onChangeAutoMaxSwayMm,
    autoDesignResult,
    autoPreviewId,
    onSelectAutoPreviewId,
    onRunAutoDesign,
    onApplyAutoDesign,
    onClearAutoDesign,
  } = props;

  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineTab, setOutlineTab] = useState<'nodes' | 'members'>('nodes');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedNode?.id || selectedMember?.id) {
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [selectedNode?.id, selectedMember?.id]);

  if (collapsed) {
    return (
      <div className="w-11 shrink-0 bg-white border-l border-slate-200 flex flex-col items-center py-3 z-10">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={false}
          aria-label="展开属性面板"
          title="展开属性面板 (H)"
          className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const selectedMemberRes = selectedMember ? fea.memberResults[selectedMember.id] : null;
  const selectedNodeDisp = selectedNode ? fea.nodeDisplacements[selectedNode.id] : null;
  const selectedNodeMergeInfo = selectedNode ? canAutoMergeNode(model, selectedNode.id) : null;
  const criticalMember = fea.criticalMemberId
    ? model.members.find((m) => m.id === fea.criticalMemberId) ?? null
    : null;

  const swayState =
    !fea.isStable
      ? { label: '失稳', cls: 'text-red-700' }
      : fea.maxLateralSwayMm > 5
        ? { label: '晃动大', cls: 'text-red-700' }
        : fea.maxLateralSwayMm > 2
          ? { label: '偏晃', cls: 'text-amber-700' }
          : { label: '稳固', cls: 'text-emerald-700' };

  const activeCraft = getJointCraftSpec(jointType);
  const shearRatio =
    fea.jointShearCapacityN > 0 ? fea.maxShearForceN / fea.jointShearCapacityN : 0;
  const shearState = fea.jointSlipRisk
    ? { label: '打滑风险', cls: 'text-red-700', barCls: 'bg-red-600' }
    : shearRatio >= 0.7
      ? { label: '接近上限', cls: 'text-amber-700', barCls: 'bg-amber-500' }
      : { label: '抗滑安全', cls: 'text-emerald-700', barCls: 'bg-blue-700' };

  return (
    <aside
      aria-label="工程属性面板"
      className="w-[340px] shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden z-10"
    >
      {/* Inspector Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 truncate">
            {activeTab === 'draw'
              ? '结构建模与属性'
              : activeTab === 'fea'
                ? '力学分析与防晃'
                : '自动方案与优化'}
          </h2>
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {model.name} · {model.members.length} 根型材 · {model.nodes.length} 节点
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={true}
          aria-label="收起属性面板"
          title="收起属性面板 (H)"
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors shrink-0"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* Pinned 2x2 Live Structural Health Summary */}
      <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50/70 shrink-0 text-xs">
        <div className="px-4 py-2.5 border-r border-b border-slate-200/80">
          <div className="text-slate-500">竖向挠度</div>
          <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-900">
            {fea.isStable ? `${fea.maxVerticalDeflectionMm.toFixed(2)} mm` : '—'}
          </div>
        </div>
        <div className="px-4 py-2.5 border-b border-slate-200/80">
          <div className="flex items-center justify-between gap-1">
            <span className="text-slate-500">水平晃动</span>
            <span className={`font-medium ${swayState.cls}`}>{swayState.label}</span>
          </div>
          <div className={`mt-0.5 font-mono tabular-nums text-sm font-semibold ${swayState.cls}`}>
            {fea.isStable ? `${fea.maxLateralSwayMm.toFixed(2)} mm` : '机构失稳'}
          </div>
        </div>
        <div className="px-4 py-2.5 border-r border-slate-200/80">
          <div className="flex items-center justify-between gap-1">
            <span className="text-slate-500">最大切向力</span>
            <span className={`font-medium ${shearState.cls}`}>{shearState.label}</span>
          </div>
          <div className={`mt-0.5 font-mono tabular-nums text-sm font-semibold ${shearState.cls}`}>
            {fea.isStable ? `${Math.round(fea.maxShearForceN)} N` : '—'}
          </div>
        </div>
        <div className="px-4 py-2.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-slate-500">安全系数 / 总重</span>
          </div>
          <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-900 flex items-baseline gap-1.5">
            <span
              className={
                !fea.isStable || fea.minSafetyFactor < 1.5
                  ? 'text-red-700'
                  : fea.minSafetyFactor < 2.5
                    ? 'text-amber-700'
                    : 'text-emerald-700'
              }
            >
              {fea.isStable ? `SF ${fea.minSafetyFactor.toFixed(1)}` : '不稳'}
            </span>
            <span className="text-xs font-normal text-slate-500">
              · {fea.totalMassKg.toFixed(1)}kg
            </span>
          </div>
        </div>
      </div>

      {/* Scrollable Inspector Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto divide-y divide-slate-200/80">
        {/* ACTIVE DRAWING GUIDANCE */}
        {drawStartNodeId && cadTool === 'draw-beam' && activeTab !== 'optimize' && (
          <section className="p-4 bg-blue-50/70 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-blue-900">
                正在绘制 {activeProfile} 型材
              </span>
              <button
                type="button"
                onClick={onCancelDraw}
                className="text-xs font-medium text-blue-700 hover:text-blue-900"
              >
                取消 (Esc)
              </button>
            </div>
            <p className="text-xs text-blue-800 leading-relaxed">
              已选起点 <span className="font-mono font-semibold">{drawStartNodeId}</span>，请点击另一节点或网格交点完成连杆。
            </p>
          </section>
        )}

        {/* SELECTED MEMBER INSPECTOR */}
        {selectedMember && activeTab !== 'optimize' && (
          <section aria-label="选中型材属性" className="p-4 space-y-3.5 bg-blue-50/35">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-slate-900 truncate">
                  型材 · {selectedMember.label ?? selectedMember.id}
                </h3>
                <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                  {selectedMember.startNodeId} → {selectedMember.endNodeId} ·{' '}
                  {selectedMemberRes ? Math.round(selectedMemberRes.lengthMm) : 0} mm
                </p>
              </div>
              <button
                type="button"
                aria-label="取消选中型材"
                onClick={() => onSelectMember(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedMemberRes && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs bg-white border border-slate-200 rounded-md p-2.5">
                <div>
                  <div className="text-slate-500">等效应力</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                    {selectedMemberRes.vonMisesMPa.toFixed(1)} MPa
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">节点切向剪力</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                    {Math.round(selectedMemberRes.maxShearN)} N
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">轴力</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                    {selectedMemberRes.axialForceN >= 0 ? '+' : ''}
                    {Math.round(selectedMemberRes.axialForceN)} N
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">安全系数</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                    {selectedMemberRes.safetyFactor.toFixed(1)}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">截面规格</span>
                <span className="font-mono tabular-nums text-[11px] text-slate-500">
                  {PROFILE_CATALOG[selectedMember.profileId].massPerMeterKg} kg/m · ¥
                  {PROFILE_CATALOG[selectedMember.profileId].pricePerMeterCNY}/m
                </span>
              </div>
              <div
                role="group"
                aria-label="选中型材截面规格"
                className="grid grid-cols-5 gap-1 p-1 bg-slate-100 rounded-lg"
              >
                {PROFILE_ORDER.map((pid) => (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => onChangeMemberProfile(selectedMember.id, pid)}
                    className={`py-1.5 text-xs font-mono font-medium rounded-md transition-colors ${
                      selectedMember.profileId === pid
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {pid}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const guide = analyzeMemberConnection(model, selectedMember);
              if (!guide.isDiagonal) return null;
              const isMiter = guide.craft === 'miter-45';
              return (
                <div
                  aria-label="斜撑连接工艺说明"
                  className={`rounded-md border p-2.5 space-y-2 text-xs ${
                    isMiter
                      ? 'bg-teal-50/75 border-teal-200 text-teal-950'
                      : 'bg-amber-50/80 border-amber-200 text-amber-950'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">三角斜撑怎么连</span>
                    <span className="font-mono tabular-nums text-[11px] font-semibold">
                      夹角 {guide.angleStartDeg.toFixed(1)}° / {guide.angleEndDeg.toFixed(1)}°
                    </span>
                  </div>
                  <div className="font-medium text-[11px]">
                    推荐工艺：{guide.craftTitle}
                  </div>
                  <div className="text-[11px] opacity-90 leading-relaxed">
                    {guide.assemblySteps}
                  </div>
                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-black/10">
                    <span>切割：{guide.cutSpec}</span>
                    <span className="font-mono font-medium">
                      {isMiter ? '45°斜角码 ×2' : '万向铰链 ×2'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReplaceBraceWithGusset(selectedMember.id)}
                    className="w-full h-8 text-[11px] font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded transition-colors"
                  >
                    不想锯斜角？删此斜撑改用外置三角连接板
                  </button>
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={Boolean(selectedMember.locked)}
                onClick={() => onToggleMemberLock(selectedMember.id)}
                className={`h-9 inline-flex items-center justify-center gap-1.5 text-xs font-medium rounded-md border transition-colors ${
                  selectedMember.locked
                    ? 'bg-amber-50 border-amber-400 text-amber-900 hover:bg-amber-100'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {selectedMember.locked ? (
                  <Lock className="w-3.5 h-3.5 text-amber-700" />
                ) : (
                  <Unlock className="w-3.5 h-3.5" />
                )}
                <span>{selectedMember.locked ? '已固定位置' : '固定此型材'}</span>
              </button>

              <button
                type="button"
                onClick={() => onDeleteMember(selectedMember.id)}
                className="h-9 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-md transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除型材</span>
              </button>
            </div>
          </section>
        )}

        {/* SELECTED NODE INSPECTOR */}
        {selectedNode && activeTab !== 'optimize' && (
          <section aria-label="选中节点属性" className="p-4 space-y-3.5 bg-blue-50/35">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-slate-900">
                  节点 {selectedNode.id}
                </h3>
                {selectedNodeDisp && (
                  <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                    合位移 {selectedNodeDisp.magnitudeMm.toFixed(2)} mm
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="取消选中节点"
                onClick={() => onSelectNode(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Coordinates (mm) */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-700">空间坐标 (mm)</div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { key: 'x', label: 'X' },
                    { key: 'y', label: 'Y (高)' },
                    { key: 'z', label: 'Z' },
                  ] as const
                ).map((axis) => (
                  <label key={axis.key} className="block">
                    <span className="block text-[11px] text-slate-500 mb-1">{axis.label}</span>
                    <input
                      type="number"
                      step={50}
                      value={selectedNode.position[axis.key]}
                      onChange={(e) =>
                        onUpdateNodePosition(selectedNode.id, {
                          ...selectedNode.position,
                          [axis.key]: Number(e.target.value) || 0,
                        })
                      }
                      className="w-full h-8 px-2 text-xs font-mono tabular-nums border border-slate-200 rounded-md bg-white text-slate-900"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Support constraint */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-700">支座约束</div>
              <div
                role="group"
                aria-label="节点约束类型"
                className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg text-xs"
              >
                {(
                  [
                    { id: 'free', label: '自由节点' },
                    { id: 'fixed', label: '固定刚接' },
                    { id: 'pinned', label: '铰接可转' },
                  ] as { id: SupportType; label: string }[]
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onUpdateNodeSupport(selectedNode.id, s.id)}
                    className={`py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
                      selectedNode.support === s.id
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Node Load Fx / Fy / Fz */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">节点外力 (N)</span>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateNodeLoad(selectedNode.id, { ...selectedNode.load, fy: -500 })
                    }
                    className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:text-slate-900"
                  >
                    -500N
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateNodeLoad(selectedNode.id, { ...selectedNode.load, fy: -1000 })
                    }
                    className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:text-slate-900"
                  >
                    -1000N
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateNodeLoad(selectedNode.id, { fx: 0, fy: 0, fz: 0 })}
                    className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:text-slate-900"
                  >
                    清零
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="block text-[11px] text-slate-500 mb-1">Fx (侧推)</span>
                  <input
                    aria-label="Fx"
                    type="number"
                    step={50}
                    value={selectedNode.load.fx}
                    onChange={(e) =>
                      onUpdateNodeLoad(selectedNode.id, {
                        ...selectedNode.load,
                        fx: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full h-8 px-2 text-xs font-mono tabular-nums border border-slate-200 rounded-md bg-white text-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] text-slate-500 mb-1">Fy (下压)</span>
                  <input
                    aria-label="Fy(N)"
                    type="number"
                    step={100}
                    value={selectedNode.load.fy}
                    onChange={(e) =>
                      onUpdateNodeLoad(selectedNode.id, {
                        ...selectedNode.load,
                        fy: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full h-8 px-2 text-xs font-mono tabular-nums border border-slate-200 rounded-md bg-white text-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] text-slate-500 mb-1">Fz (前后)</span>
                  <input
                    aria-label="Fz"
                    type="number"
                    step={50}
                    value={selectedNode.load.fz}
                    onChange={(e) =>
                      onUpdateNodeLoad(selectedNode.id, {
                        ...selectedNode.load,
                        fz: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full h-8 px-2 text-xs font-mono tabular-nums border border-slate-200 rounded-md bg-white text-slate-900"
                  />
                </label>
              </div>
            </div>

            {/* Delete Node (Auto-Merge Aware) */}
            <button
              type="button"
              onClick={() => onDeleteNode(selectedNode.id)}
              className={`w-full h-9 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md border transition-colors ${
                selectedNodeMergeInfo?.canMerge
                  ? 'bg-blue-700 hover:bg-blue-800 text-white border-blue-700'
                  : 'bg-white hover:bg-red-50 text-red-700 border-red-200'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>
                {selectedNodeMergeInfo?.canMerge
                  ? `删除节点并自动合并 (${selectedNodeMergeInfo.mergedLengthMm}mm)`
                  : '删除节点'}
              </span>
            </button>
          </section>
        )}

        {/* TAB 1: CAD DRAWING CONTROLS */}
        {activeTab === 'draw' && (
          <>
            {/* Preset Templates */}
            <section className="p-4 space-y-3">
              <h3 className="text-[13px] font-semibold text-slate-900">结构模板</h3>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="结构模板">
                {PRESET_LIST.map((p) => {
                  const active = activePreset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectPreset(p.id)}
                      className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                        active
                          ? 'bg-blue-50/80 border-blue-600 text-blue-900'
                          : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-xs font-semibold truncate">{p.name}</div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {PRESET_SHORT_DESC[p.id]}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Dimensions */}
              <div className="pt-1 space-y-1.5">
                <div className="text-xs font-medium text-slate-600">外廓尺寸 (mm)</div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="block text-[11px] text-slate-500 mb-1">宽 W</span>
                    <input
                      aria-label="框架宽度(mm)"
                      type="number"
                      min={400}
                      max={2400}
                      step={100}
                      value={dimensions.widthMm}
                      onChange={(e) =>
                        onApplyDimensions({
                          ...dimensions,
                          widthMm: Math.max(400, Math.min(2400, Number(e.target.value) || 800)),
                        })
                      }
                      className="w-full h-9 px-2.5 text-xs font-mono tabular-nums border border-slate-200 rounded-md bg-white text-slate-900"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-slate-500 mb-1">深 D</span>
                    <input
                      aria-label="框架深度(mm)"
                      type="number"
                      min={300}
                      max={1600}
                      step={100}
                      value={dimensions.depthMm}
                      onChange={(e) =>
                        onApplyDimensions({
                          ...dimensions,
                          depthMm: Math.max(300, Math.min(1600, Number(e.target.value) || 500)),
                        })
                      }
                      className="w-full h-9 px-2.5 text-xs font-mono tabular-nums border border-slate-200 rounded-md bg-white text-slate-900"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-slate-500 mb-1">高 H</span>
                    <input
                      aria-label="框架高度(mm)"
                      type="number"
                      min={300}
                      max={2000}
                      step={50}
                      value={dimensions.heightMm}
                      onChange={(e) =>
                        onApplyDimensions({
                          ...dimensions,
                          heightMm: Math.max(300, Math.min(2000, Number(e.target.value) || 750)),
                        })
                      }
                      className="w-full h-9 px-2.5 text-xs font-mono tabular-nums border border-slate-200 rounded-md bg-white text-slate-900"
                    />
                  </label>
                </div>
              </div>
            </section>

            {/* Profile & Finish Settings */}
            <section className="p-4 space-y-3">
              <h3 className="text-[13px] font-semibold text-slate-900">型材规格与外观</h3>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">默认型材规格</span>
                  <button
                    type="button"
                    onClick={() => onApplyProfileToAll(activeProfile)}
                    className="text-[11px] font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                  >
                    全框统一为 {activeProfile}
                  </button>
                </div>
                <div
                  role="group"
                  aria-label="默认型材规格"
                  className="grid grid-cols-5 gap-1 p-1 bg-slate-100 rounded-lg"
                >
                  {PROFILE_ORDER.map((pid) => (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => onSelectActiveProfile(pid)}
                      className={`py-1.5 text-xs font-mono font-medium rounded-md transition-colors ${
                        activeProfile === pid
                          ? 'bg-white text-blue-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {pid}
                    </button>
                  ))}
                </div>
              </div>

              {(cadTool === 'add-node' || cadTool === 'draw-beam') && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="workplane-y-input"
                    className="flex items-center justify-between text-xs text-slate-600"
                  >
                    <span>绘图工作平面标高 Y</span>
                    <span className="font-mono tabular-nums text-slate-900">{workplaneY} mm</span>
                  </label>
                  <input
                    id="workplane-y-input"
                    aria-label="绘图工作平面高度(mm)"
                    type="range"
                    min={0}
                    max={Math.max(1200, dimensions.heightMm + 300)}
                    step={50}
                    value={workplaneY}
                    onChange={(e) => onChangeWorkplaneY(Number(e.target.value))}
                    className="eng-slider w-full"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <div className="text-xs text-slate-600">阳极氧化工艺</div>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => onSelectFinish('silver')}
                    className={`py-1.5 rounded-md font-medium transition-colors ${
                      finish === 'silver'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    银白氧化
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectFinish('black')}
                    className={`py-1.5 rounded-md font-medium transition-colors ${
                      finish === 'black'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    工业哑光黑
                  </button>
                </div>
              </div>
            </section>

            {/* Collapsible Structure Outline (Easy Node / Member Picking!) */}
            <section className="p-4 space-y-2.5">
              <button
                type="button"
                aria-expanded={outlineOpen}
                onClick={() => setOutlineOpen((o) => !o)}
                className="w-full flex items-center justify-between text-[13px] font-semibold text-slate-900"
              >
                <span>结构构件列表</span>
                <span className="flex items-center gap-1 text-xs font-normal text-slate-500">
                  <span>
                    {model.nodes.length} 节点 / {model.members.length} 型材
                  </span>
                  {outlineOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </span>
              </button>

              {outlineOpen && (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setOutlineTab('nodes')}
                      className={`py-1 rounded-md font-medium transition-colors ${
                        outlineTab === 'nodes'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      节点 ({model.nodes.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setOutlineTab('members')}
                      className={`py-1 rounded-md font-medium transition-colors ${
                        outlineTab === 'members'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      型材 ({model.members.length})
                    </button>
                  </div>

                  <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
                    {outlineTab === 'nodes'
                      ? model.nodes.map((n) => {
                          const mergeInfo = canAutoMergeNode(model, n.id);
                          const active = selectedNode?.id === n.id;
                          return (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => onSelectNode(n.id)}
                              className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors ${
                                active
                                  ? 'bg-blue-50 text-blue-900 font-semibold'
                                  : 'bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span className="font-mono">{n.id}</span>
                              <span className="font-mono tabular-nums text-[11px] text-slate-500">
                                {mergeInfo.canMerge
                                  ? '可删并合并'
                                  : n.support === 'fixed'
                                    ? '固定支座'
                                    : n.support === 'pinned'
                                      ? '铰接支座'
                                      : `${n.position.x},${n.position.y},${n.position.z}`}
                              </span>
                            </button>
                          );
                        })
                      : model.members.map((m) => {
                          const active = selectedMember?.id === m.id;
                          const res = fea.memberResults[m.id];
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => onSelectMember(m.id)}
                              className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors ${
                                active
                                  ? 'bg-blue-50 text-blue-900 font-semibold'
                                  : 'bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span className="truncate">{m.label ?? m.id}</span>
                              <span className="font-mono tabular-nums text-[11px] text-slate-500 shrink-0">
                                {m.profileId} · {res ? Math.round(res.lengthMm) : 0}mm
                              </span>
                            </button>
                          );
                        })}
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {/* TAB 2: FEA STRUCTURAL ANALYSIS & ANTI-SWAY */}
        {activeTab === 'fea' && (
          <>
            {/* Static Sway Visualizer (2D ±Envelope + Tilt/Drift + 3D Envelope Toggle) */}
            <section className="p-4">
              <SwayViewerCard
                sway={swaySummary}
                showSwayEnvelope={showSwayEnvelope}
                onToggleSwayEnvelope={onToggleSwayEnvelope}
              />
            </section>

            <section className="p-4 space-y-4">
              {/* 5 Joint Connection Crafts with Live Sway & Shear Comparison */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold text-slate-900">节点连接工艺</h3>
                  <span className="font-mono tabular-nums text-[11px] text-slate-500">
                    按 {comparePushN}N 侧推对比晃动
                  </span>
                </div>
                <div
                  role="group"
                  aria-label="节点连接工艺"
                  className="space-y-1.5"
                >
                  {JOINT_CRAFT_ORDER.map((cid) => {
                    const spec = JOINT_CRAFT_CATALOG[cid];
                    const cmp = craftComparisons.find((c) => c.id === cid);
                    const active = jointType === cid;
                    const swayVal = cmp?.isStable ? cmp.swayMm : null;
                    const swayCls =
                      swayVal === null || swayVal > 5
                        ? 'text-red-700'
                        : swayVal > 2
                          ? 'text-amber-700'
                          : 'text-emerald-700';

                    return (
                      <button
                        key={cid}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChangeJointType(cid)}
                        className={`w-full px-3 py-2 rounded-lg border text-left transition-colors flex items-center justify-between gap-2 ${
                          active
                            ? 'bg-blue-50/80 border-blue-600 text-blue-950'
                            : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{spec.shortName}</div>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                            抗滑上限 {spec.shearCapacityN} N
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-xs font-mono tabular-nums font-semibold ${swayCls}`}>
                            {swayVal !== null ? `晃动 ${swayVal.toFixed(2)} mm` : '失稳'}
                          </div>
                          <div className="text-[10px] font-mono tabular-nums text-slate-500">
                            {cmp?.slipRisk ? '超切向抗滑' : `刚度 ${Math.round(spec.fixityFactor * 100)}%`}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {activeCraft.name}：{activeCraft.description}。
                </p>
              </div>

              {/* Continuous Tangential Push Force Slider + Presets */}
              <div className="space-y-2.5 pt-1 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="lateral-push-slider" className="text-[13px] font-semibold text-slate-900">
                    切向侧推力（推一下测试）
                  </label>
                  <span className="font-mono tabular-nums font-semibold text-amber-700">
                    {lateralPushN} N
                  </span>
                </div>
                <input
                  id="lateral-push-slider"
                  aria-label="切向侧推力(N)"
                  type="range"
                  min={0}
                  max={500}
                  step={10}
                  value={lateralPushN}
                  onChange={(e) => onChangeLateralPushN(Number(e.target.value))}
                  className="eng-slider w-full"
                />
                <div
                  role="group"
                  aria-label="侧向推力快捷预设"
                  className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg text-xs"
                >
                  {[
                    { val: 0, label: '0N' },
                    { val: 100, label: '100N' },
                    { val: 200, label: '200N' },
                    { val: 300, label: '300N' },
                  ].map((p) => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => onChangeLateralPushN(p.val)}
                      className={`py-1.5 rounded-md font-mono font-medium whitespace-nowrap transition-colors ${
                        lateralPushN === p.val
                          ? p.val > 0
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Joint Tangential Shear Force vs Craft Slip Capacity Bar */}
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">节点切向力负荷</span>
                  <span className={`font-medium ${shearState.cls}`}>{shearState.label}</span>
                </div>
                <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${shearState.barCls}`}
                    style={{ width: `${Math.min(100, Math.round(shearRatio * 100))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600">
                  <span>实测 {Math.round(fea.maxShearForceN)} N</span>
                  <span>
                    {activeCraft.shortName}上限 {fea.jointShearCapacityN} N (
                    {Math.round(shearRatio * 100)}%)
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={onQuickAntiSway}
                className="w-full h-10 inline-flex items-center justify-center gap-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>一键加斜撑防晃</span>
              </button>
            </section>

            {/* Heatmap & Sliders */}
            <section className="p-4 space-y-4">
              <div className="space-y-2">
                <h3 className="text-[13px] font-semibold text-slate-900">云图显示模式</h3>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg text-xs">
                  {(
                    [
                      { id: 'stress', label: '等效应力' },
                      { id: 'axial', label: '拉压轴力' },
                      { id: 'material', label: '真实材质' },
                    ] as { id: ColorMode; label: string }[]
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelectColorMode(m.id)}
                      className={`py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
                        colorMode === m.id
                          ? 'bg-white text-blue-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="load-mult-slider" className="text-slate-600">
                      载荷倍率
                    </label>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      {loadMultiplier.toFixed(1)}×
                    </span>
                  </div>
                  <input
                    id="load-mult-slider"
                    type="range"
                    min={0.2}
                    max={3.0}
                    step={0.1}
                    value={loadMultiplier}
                    onChange={(e) => onChangeLoadMultiplier(Number(e.target.value))}
                    className="eng-slider w-full"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="deform-scale-slider" className="text-slate-600">
                      变形可视化放大
                    </label>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      {deformScale}×
                    </span>
                  </div>
                  <input
                    id="deform-scale-slider"
                    type="range"
                    min={0}
                    max={45}
                    step={1}
                    value={deformScale}
                    onChange={(e) => onChangeDeformScale(Number(e.target.value))}
                    className="eng-slider w-full"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-700 pt-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeGravity}
                    onChange={onToggleGravity}
                    className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <span>计入铝型材自重（9.81 m/s²）</span>
                </label>
              </div>
            </section>

            {/* Engineering Diagnosis */}
            <section className="p-4 space-y-3">
              <h3 className="text-[13px] font-semibold text-slate-900">结构受力诊断</h3>
              <div
                className={`p-3 rounded-lg border text-xs leading-relaxed flex items-start gap-2 ${
                  fea.status === 'safe'
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : fea.status === 'warning'
                      ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                      : 'bg-red-50/70 border-red-200 text-red-900'
                }`}
              >
                {fea.status === 'safe' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                )}
                <span>{fea.statusMessage}</span>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-slate-500">最大等效应力</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {fea.maxStressMPa.toFixed(1)} MPa / 145 MPa
                </span>
              </div>

              {criticalMember && (
                <button
                  type="button"
                  onClick={() => onSelectMember(criticalMember.id)}
                  className="w-full px-3 py-2 text-xs text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md flex items-center justify-between transition-colors"
                >
                  <span className="text-slate-600">
                    关键受力杆：<strong className="text-slate-900">{criticalMember.label ?? criticalMember.id}</strong>
                  </span>
                  <span className="text-blue-700 font-medium">定位选中</span>
                </button>
              )}
            </section>
          </>
        )}

        {/* TAB 3: CONSTRAINED MULTI-OBJECTIVE AUTO-DESIGNER & OPTIMIZATION */}
        {activeTab === 'optimize' && (
          <>
            {/* Step 1: Fixed / Locked Extrusion Anchors */}
            <section className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-slate-900">1. 固定型材位置</h3>
                <span className="font-mono tabular-nums text-xs text-amber-800 font-medium">
                  已锁定 {model.members.filter((m) => m.locked).length} 根
                </span>
              </div>

              <div
                role="group"
                aria-label="快捷锁定型材"
                className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg text-xs"
              >
                <button
                  type="button"
                  onClick={() => onQuickLockGroup('top-rails')}
                  className="py-1.5 rounded-md font-medium text-slate-700 hover:bg-white hover:text-slate-900 transition-colors whitespace-nowrap"
                >
                  锁顶梁
                </button>
                <button
                  type="button"
                  onClick={() => onQuickLockGroup('columns')}
                  className="py-1.5 rounded-md font-medium text-slate-700 hover:bg-white hover:text-slate-900 transition-colors whitespace-nowrap"
                >
                  锁立柱
                </button>
                <button
                  type="button"
                  onClick={() => onQuickLockGroup('clear')}
                  className="py-1.5 rounded-md font-medium text-slate-600 hover:bg-white hover:text-slate-900 transition-colors whitespace-nowrap"
                >
                  清空锁定
                </button>
              </div>

              {model.members.some((m) => m.locked) ? (
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {model.members
                    .filter((m) => m.locked)
                    .map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-amber-50/80 border border-amber-200 text-xs"
                      >
                        <span className="inline-flex items-center gap-1.5 text-amber-950 truncate">
                          <Lock className="w-3 h-3 shrink-0 text-amber-700" />
                          <span className="truncate">{m.label ?? m.id}</span>
                          <span className="font-mono text-[11px] text-amber-700">{m.profileId}</span>
                        </span>
                        <button
                          type="button"
                          aria-label={`解除锁定 ${m.label ?? m.id}`}
                          onClick={() => onToggleMemberLock(m.id)}
                          className="p-0.5 text-amber-700 hover:text-amber-950 rounded"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 leading-relaxed">
                  直接点击 3D 视图中的任意型材或点上方按钮锁定其位置与规格，系统将围绕固定件自动计算其余结构。
                </p>
              )}
            </section>

            {/* Step 2: Multi-Objective Preferences (Material / Stability / Brackets) */}
            <section className="p-4 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-slate-900">2. 多目标偏好</h3>
                <span className="text-[11px] text-slate-500">兼顾用料 · 稳固 · 角码</span>
              </div>

              <div
                role="group"
                aria-label="多目标偏好预设"
                className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg text-xs"
              >
                {[
                  { label: '省料少角码', w: { material: 5, stability: 2, brackets: 5 } },
                  { label: '均衡兼顾', w: { material: 3, stability: 4, brackets: 3 } },
                  { label: '稳固优先', w: { material: 1, stability: 5, brackets: 2 } },
                ].map((preset) => {
                  const active =
                    autoWeights.material === preset.w.material &&
                    autoWeights.stability === preset.w.stability &&
                    autoWeights.brackets === preset.w.brackets;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => onChangeAutoWeights(preset.w)}
                      className={`py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
                        active
                          ? 'bg-white text-blue-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-2.5 text-xs">
                {(
                  [
                    { key: 'material', label: '省料控成本' },
                    { key: 'stability', label: '稳固防晃动' },
                    { key: 'brackets', label: '减少角码数' },
                  ] as const
                ).map((item) => (
                  <div key={item.key} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label htmlFor={`weight-${item.key}`} className="text-slate-600">
                        {item.label}
                      </label>
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        权重 {autoWeights[item.key]} / 5
                      </span>
                    </div>
                    <input
                      id={`weight-${item.key}`}
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={autoWeights[item.key]}
                      onChange={(e) =>
                        onChangeAutoWeights({
                          ...autoWeights,
                          [item.key]: Number(e.target.value),
                        })
                      }
                      className="eng-slider w-full"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <label className="block">
                  <span className="block text-[11px] text-slate-600 mb-1">安全系数 ≥</span>
                  <input
                    aria-label="目标安全系数"
                    type="number"
                    min={1.2}
                    max={10}
                    step={0.5}
                    value={optConstraints.targetSafetyFactor}
                    onChange={(e) =>
                      onChangeOptConstraints({
                        ...optConstraints,
                        targetSafetyFactor: Math.max(1.2, Number(e.target.value) || 2.5),
                      })
                    }
                    className="w-full h-8 px-2 font-mono tabular-nums border border-slate-200 rounded-md bg-white text-slate-900"
                  />
                </label>

                <label className="block">
                  <span className="block text-[11px] text-slate-600 mb-1">目标晃动 ≤ (mm)</span>
                  <input
                    aria-label="最大允许晃动(mm)"
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={autoMaxSwayMm}
                    onChange={(e) =>
                      onChangeAutoMaxSwayMm(Math.max(0.5, Number(e.target.value) || 2.0))
                    }
                    className="w-full h-8 px-2 font-mono tabular-nums border border-slate-200 rounded-md bg-white text-slate-900"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={onRunAutoDesign}
                className="w-full h-10 inline-flex items-center justify-center gap-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>自动计算 3 套最优方案</span>
              </button>
            </section>

            {/* Step 3: Auto-Computed Multi-Objective Schemes Comparison */}
            {autoDesignResult ? (
              <section aria-label="自动计算方案对比" className="p-4 space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold text-slate-900">3. 自动生成方案对比</h3>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectAutoPreviewId(
                        autoPreviewId === 'before' ? autoDesignResult.recommendedId : 'before',
                      )
                    }
                    className={`px-2 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                      autoPreviewId === 'before'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
                    }`}
                  >
                    {autoPreviewId === 'before' ? '正看原方案' : '对比原方案'}
                  </button>
                </div>

                {/* Original baseline bar */}
                <div className="px-3 py-2 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-center justify-between font-mono tabular-nums">
                  <span>原方案</span>
                  <span>
                    {autoDesignResult.beforeFea.totalMassKg.toFixed(1)}kg ·{' '}
                    {autoDesignResult.beforeBracketCount}角码 · 晃动
                    {autoDesignResult.beforeFea.maxLateralSwayMm.toFixed(1)}mm · ¥
                    {autoDesignResult.beforeTotalCostCNY}
                  </span>
                </div>

                {/* 3 Pareto Scheme Cards */}
                <div className="space-y-2.5">
                  {autoDesignResult.candidates.map((cand) => {
                    const isActive = autoPreviewId === cand.id;
                    const isBest = autoDesignResult.recommendedId === cand.id;
                    const brkDiff = cand.bracketCount - autoDesignResult.beforeBracketCount;
                    const craftLabel = getJointCraftSpec(cand.recommendedJointType).shortName;

                    return (
                      <div
                        key={cand.id}
                        className={`rounded-lg border transition-colors ${
                          isActive
                            ? 'bg-blue-50/70 border-blue-600'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectAutoPreviewId(cand.id)}
                          className="w-full p-3 text-left space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-slate-900">
                                  {cand.title}
                                </span>
                                {isBest && (
                                  <span className="text-[10px] font-semibold text-blue-700">
                                    综合最优
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                                {cand.tagline}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono tabular-nums text-sm font-bold text-blue-700">
                                {cand.score} 分
                              </div>
                              <div className="text-[10px] text-slate-500">{craftLabel}</div>
                            </div>
                          </div>

                          <div className="px-2 py-1 rounded bg-slate-100/90 text-[11px] text-slate-700 font-medium truncate">
                            连接工艺：{cand.assemblyMethod}
                          </div>

                          <div className="grid grid-cols-3 gap-1.5 text-[11px] bg-white/90 border border-slate-200/80 rounded-md p-2 font-mono tabular-nums">
                            <div>
                              <div className="text-slate-500 font-sans">用料/总价</div>
                              <div className="font-semibold text-slate-900 mt-0.5 whitespace-nowrap">
                                {cand.totalMassKg.toFixed(1)} kg
                              </div>
                              <div className="text-[10px] text-slate-500">¥{cand.totalCostCNY}</div>
                            </div>
                            <div>
                              <div className="text-slate-500 font-sans">水平晃动</div>
                              <div
                                className={`font-semibold mt-0.5 whitespace-nowrap ${
                                  cand.maxSwayMm <= 2
                                    ? 'text-emerald-700'
                                    : cand.maxSwayMm <= 5
                                      ? 'text-amber-700'
                                      : 'text-red-700'
                                }`}
                              >
                                {cand.maxSwayMm.toFixed(2)} mm
                              </div>
                              <div className="text-[10px] text-slate-500">
                                SF {Math.min(cand.minSafetyFactor, 99).toFixed(1)}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 font-sans">角码个数</div>
                              <div className="font-semibold text-slate-900 mt-0.5 whitespace-nowrap">
                                {cand.bracketCount} 个
                              </div>
                              <div className="text-[10px] text-slate-500">
                                较原 {brkDiff >= 0 ? `+${brkDiff}` : brkDiff}
                              </div>
                            </div>
                          </div>

                          <ul className="space-y-0.5 text-[11px] text-slate-600">
                            {cand.highlights.map((hl, i) => (
                              <li key={i} className="truncate">
                                · {hl}
                              </li>
                            ))}
                          </ul>
                        </button>

                        {isActive && (
                          <div className="px-3 pb-3 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onApplyAutoDesign(cand.id)}
                              className="flex-1 h-8 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors"
                            >
                              采纳「{cand.title}」
                            </button>
                            <button
                              type="button"
                              onClick={onClearAutoDesign}
                              aria-label="关闭方案对比"
                              className="h-8 px-2.5 text-xs text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : optReport ? (
              <section className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-slate-900">优化对比报告</h3>
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md text-xs">
                    <button
                      type="button"
                      onClick={() => onChangeOptPreviewMode('before')}
                      className={`px-2 py-1 rounded transition-colors ${
                        optPreviewMode === 'before'
                          ? 'bg-white text-slate-900 font-medium shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      优化前
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeOptPreviewMode('after')}
                      className={`px-2 py-1 rounded transition-colors ${
                        optPreviewMode === 'after'
                          ? 'bg-white text-blue-700 font-medium shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      优化后
                    </button>
                  </div>
                </div>

                <ConvergenceChart report={optReport} />

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onApplyOptimization}
                    className="h-9 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors"
                  >
                    采纳优化方案
                  </button>
                  <button
                    type="button"
                    onClick={onClearOptimization}
                    className="h-9 inline-flex items-center justify-center gap-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>放弃</span>
                  </button>
                </div>
              </section>
            ) : (
              <section className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-700">快速单策略优化</h3>
                  <button
                    type="button"
                    onClick={onRunOptimization}
                    className="text-xs font-medium text-blue-700 hover:text-blue-800"
                  >
                    单策略运行 →
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg text-xs">
                  {STRATEGY_ITEMS.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() =>
                        onChangeOptConstraints({ ...optConstraints, strategy: st.id })
                      }
                      className={`py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
                        optConstraints.strategy === st.id
                          ? 'bg-white text-blue-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
