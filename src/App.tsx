import { useCallback, useEffect, useMemo, useState } from 'react';
import { BomView } from './components/BomView';
import { ExportModal } from './components/ExportModal';
import { LeftToolRail } from './components/LeftToolRail';
import { RightInspectorPanel } from './components/RightInspectorPanel';
import { TopBar } from './components/TopBar';
import { runConstrainedAutoDesign } from './engine/autoDesigner';
import { solveFrameFea } from './engine/feaSolver';
import { deleteNodeWithAutoMerge } from './engine/frameEditing';
import { JOINT_CRAFT_ORDER } from './engine/jointCrafts';
import { runFrameOptimization } from './engine/optimizer';
import { buildPreset, cloneFrameModel, PRESET_LIST, type PresetId } from './engine/presets';
import { computeSwaySummary } from './engine/swayAnalysis';
import type {
  AutoDesignResult,
  AutoDesignSchemeId,
  AutoDesignWeights,
  CadTool,
  CameraPreset,
  ColorMode,
  FinishType,
  FrameModel,
  JointType,
  OptimizationConstraints,
  OptimizationReport,
  ProfileId,
  SupportType,
  Vec3,
  WorkspaceTab,
} from './engine/types';
import { AluminumViewport } from './scene/AluminumViewport';

const CAMERA_VIEWS: { id: CameraPreset; label: string }[] = [
  { id: 'iso', label: '等轴测' },
  { id: 'front', label: '正视' },
  { id: 'side', label: '侧视' },
  { id: 'top', label: '俯视' },
];

const TOOL_HINTS: Record<CadTool, string> = {
  'select-member': '型材选择模式：点击铝型材修改规格或删除，拖拽旋转视角',
  'select-node': '节点选择模式：点击节点编辑坐标/外力/支座，删节点可自动合并',
  'draw-beam': '依次点击两个节点或工作平面网格连接新铝型材',
  'add-node': '点击蓝色工作平面网格捕捉并添加新节点',
  'add-load': '点击任意节点叠加向下载荷 (-500N)',
  'toggle-support': '点击任意节点循环切换：自由 → 固定支座 → 铰接支座',
};

const MAX_HISTORY = 30;

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('draw');
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Preset & model state + Undo/Redo stacks
  const [activePreset, setActivePreset] = useState<PresetId>('workbench');
  const [dimensions, setDimensions] = useState(PRESET_LIST[0].defaultDimensions);
  const [activeProfile, setActiveProfile] = useState<ProfileId>('2020');
  const [finish, setFinish] = useState<FinishType>('silver');
  const [model, setModel] = useState<FrameModel>(() =>
    buildPreset('workbench', PRESET_LIST[0].defaultDimensions, '2020'),
  );
  const [historyPast, setHistoryPast] = useState<FrameModel[]>([]);
  const [historyFuture, setHistoryFuture] = useState<FrameModel[]>([]);

  // CAD interaction state
  const [cadTool, setCadTool] = useState<CadTool>('select-member');
  const [workplaneY, setWorkplaneY] = useState<number>(750);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drawStartNodeId, setDrawStartNodeId] = useState<string | null>(null);

  // FEA state (realistic aluminum T-slot semi-rigid joints & static sway viewer)
  const [colorMode, setColorMode] = useState<ColorMode>('material');
  const [deformScale, setDeformScale] = useState<number>(0);
  const [loadMultiplier, setLoadMultiplier] = useState<number>(1.0);
  const [includeGravity, setIncludeGravity] = useState<boolean>(true);
  const [jointType, setJointType] = useState<JointType>('semi-rigid');
  const [lateralPushN, setLateralPushN] = useState<number>(150);
  const [showSwayEnvelope, setShowSwayEnvelope] = useState<boolean>(true);

  // Optimization state
  const [optConstraints, setOptConstraints] = useState<OptimizationConstraints>({
    strategy: 'combined',
    targetSafetyFactor: 2.5,
    maxDeflectionMm: 1.2,
    maxNewBraces: 4,
    allowProfiles: ['2020', '2040', '3030', '4040', '4080'],
    includeGravity: true,
    loadMultiplier: 1.0,
  });
  const [optReport, setOptReport] = useState<OptimizationReport | null>(null);
  const [optPreviewMode, setOptPreviewMode] = useState<'after' | 'before'>('after');

  // Constrained Multi-Objective Auto-Designer state (locked extrusions + material/stability/brackets)
  const [autoWeights, setAutoWeights] = useState<AutoDesignWeights>({
    material: 3,
    stability: 4,
    brackets: 3,
  });
  const [autoMaxSwayMm, setAutoMaxSwayMm] = useState<number>(2.0);
  const [autoDesignResult, setAutoDesignResult] = useState<AutoDesignResult | null>(null);
  const [autoPreviewId, setAutoPreviewId] = useState<AutoDesignSchemeId | 'before'>('balanced');

  // Camera trigger
  const [cameraTrigger, setCameraTrigger] = useState<{ preset: CameraPreset; seq: number }>({
    preset: 'iso',
    seq: 0,
  });

  const showNotice = useCallback((msg: string) => {
    setActionNotice(msg);
  }, []);

  // Auto-dismiss transient feedback notice after 5 seconds
  useEffect(() => {
    if (!actionNotice) return;
    const t = window.setTimeout(() => setActionNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [actionNotice]);

  // Helper to commit a model edit onto the undo stack
  const commitModel = useCallback((updater: (prev: FrameModel) => FrameModel) => {
    setModel((prev) => {
      const next = updater(prev);
      if (next === prev) return prev;
      setHistoryPast((past) => [...past.slice(-(MAX_HISTORY - 1)), cloneFrameModel(prev)]);
      setHistoryFuture([]);
      return next;
    });
    setOptReport(null);
    setAutoDesignResult(null);
  }, []);

  // Undo & Redo handlers
  const handleUndo = useCallback(() => {
    setHistoryPast((past) => {
      if (past.length === 0) return past;
      const previous = past[past.length - 1];
      setModel((curr) => {
        setHistoryFuture((fut) => [cloneFrameModel(curr), ...fut.slice(0, MAX_HISTORY - 1)]);
        return cloneFrameModel(previous);
      });
      setSelectedMemberId(null);
      setSelectedNodeId(null);
      setDrawStartNodeId(null);
      setOptReport(null);
      showNotice('已撤销上一步操作');
      return past.slice(0, -1);
    });
  }, [showNotice]);

  const handleRedo = useCallback(() => {
    setHistoryFuture((fut) => {
      if (fut.length === 0) return fut;
      const next = fut[0];
      setModel((curr) => {
        setHistoryPast((past) => [...past.slice(-(MAX_HISTORY - 1)), cloneFrameModel(curr)]);
        return cloneFrameModel(next);
      });
      setSelectedMemberId(null);
      setSelectedNodeId(null);
      setDrawStartNodeId(null);
      setOptReport(null);
      showNotice('已重做操作');
      return fut.slice(1);
    });
  }, [showNotice]);

  // Active model & joint craft displayed in 3D viewport (supports multi-scheme preview in Optimize tab)
  const activeAutoCandidate = useMemo(() => {
    if (activeTab !== 'optimize' || !autoDesignResult || autoPreviewId === 'before') return null;
    return autoDesignResult.candidates.find((c) => c.id === autoPreviewId) ?? null;
  }, [activeTab, autoDesignResult, autoPreviewId]);

  const displayedModel = useMemo(() => {
    if (activeTab === 'optimize' && autoDesignResult) {
      return activeAutoCandidate ? activeAutoCandidate.model : autoDesignResult.beforeModel;
    }
    if (activeTab === 'optimize' && optReport) {
      return optPreviewMode === 'after' ? optReport.afterModel : optReport.beforeModel;
    }
    return model;
  }, [activeTab, autoDesignResult, activeAutoCandidate, optReport, optPreviewMode, model]);

  const effectiveJointType: JointType = activeAutoCandidate
    ? activeAutoCandidate.recommendedJointType
    : jointType;

  // Apply lateral push only in FEA/Optimize modes so Draw mode reflects clean static gravity load
  const effectiveLateralPushN = activeTab === 'draw' ? 0 : lateralPushN;

  // Live 3D Euler-Bernoulli Space Frame FEA solve
  const fea = useMemo(
    () =>
      solveFrameFea(displayedModel, {
        includeGravity,
        loadMultiplier,
        jointType: effectiveJointType,
        lateralPushN: effectiveLateralPushN,
        curveSubdivisions: 6,
      }),
    [displayedModel, includeGravity, loadMultiplier, effectiveJointType, effectiveLateralPushN],
  );

  // Static sway metrics & 2D front-elevation ±sway envelope
  const swaySummary = useMemo(
    () => computeSwaySummary(displayedModel, fea),
    [displayedModel, fea],
  );

  // Live 5-craft sway & shear comparison for FEA inspector
  const comparePushN = effectiveLateralPushN > 0 ? effectiveLateralPushN : 150;
  const craftComparisons = useMemo(() => {
    if (activeTab !== 'fea') return [];
    return JOINT_CRAFT_ORDER.map((jt) => {
      if (jt === jointType && effectiveLateralPushN === comparePushN) {
        return {
          id: jt,
          swayMm: fea.isStable ? fea.maxLateralSwayMm : Infinity,
          maxShearN: fea.maxShearForceN,
          slipRisk: fea.jointSlipRisk,
          isStable: fea.isStable,
        };
      }
      const res = solveFrameFea(displayedModel, {
        includeGravity,
        loadMultiplier,
        jointType: jt,
        lateralPushN: comparePushN,
        curveSubdivisions: 2,
      });
      return {
        id: jt,
        swayMm: res.isStable ? res.maxLateralSwayMm : Infinity,
        maxShearN: res.maxShearForceN,
        slipRisk: res.jointSlipRisk,
        isStable: res.isStable,
      };
    });
  }, [
    activeTab,
    displayedModel,
    includeGravity,
    loadMultiplier,
    jointType,
    effectiveLateralPushN,
    comparePushN,
    fea,
  ]);

  // Member deletion
  const handleDeleteMember = useCallback(
    (memberId: string) => {
      commitModel((prev) => ({
        ...prev,
        members: prev.members.filter((m) => m.id !== memberId),
      }));
      setSelectedMemberId(null);
      showNotice('已删除所选型材');
    },
    [commitModel, showNotice],
  );

  // Node deletion with automatic 2-member merge
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      commitModel((prev) => {
        const res = deleteNodeWithAutoMerge(prev, nodeId);
        showNotice(res.message);
        if (res.merged && res.mergedMember) {
          setSelectedMemberId(res.mergedMember.id);
          setSelectedNodeId(null);
        } else {
          setSelectedNodeId(null);
          setSelectedMemberId(null);
        }
        return res.model;
      });
    },
    [commitModel, showNotice],
  );

  // Keyboard shortcuts: CAD tools (V/L/N/F/S), Undo/Redo (Ctrl+Z/Y), Delete, Esc, H
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'h') {
        setInspectorCollapsed((prev) => !prev);
      } else if (key === 'v') {
        setCadTool('select-member');
        setDrawStartNodeId(null);
      } else if (key === 'k') {
        setCadTool('select-node');
        setDrawStartNodeId(null);
      } else if (key === 'l') {
        setCadTool('draw-beam');
        setDrawStartNodeId(null);
      } else if (key === 'n') {
        setCadTool('add-node');
        setDrawStartNodeId(null);
      } else if (key === 'f') {
        setCadTool('add-load');
        setDrawStartNodeId(null);
      } else if (key === 's') {
        setCadTool('toggle-support');
        setDrawStartNodeId(null);
      } else if (e.key === 'Escape') {
        setDrawStartNodeId(null);
        setSelectedMemberId(null);
        setSelectedNodeId(null);
        setCadTool('select-member');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
        } else if (selectedMemberId) {
          e.preventDefault();
          handleDeleteMember(selectedMemberId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedNodeId,
    selectedMemberId,
    handleDeleteNode,
    handleDeleteMember,
    handleUndo,
    handleRedo,
  ]);

  // Tab switch with sensible domain defaults
  const handleSelectTab = useCallback((tab: WorkspaceTab) => {
    setActiveTab(tab);
    setDrawStartNodeId(null);
    if (tab === 'draw') {
      setColorMode('material');
      setDeformScale(0);
    } else if (tab === 'fea') {
      setCadTool((prev) => (prev === 'select-node' ? 'select-node' : 'select-member'));
      setColorMode('stress');
      setDeformScale((prev) => (prev === 0 ? 18 : prev));
    } else if (tab === 'optimize') {
      setCadTool('select-member');
      setColorMode('stress');
      setDeformScale((prev) => (prev === 0 ? 14 : prev));
    }
  }, []);

  // Preset switch (all templates default to 2020)
  const handleSelectPreset = useCallback((presetId: PresetId) => {
    const meta = PRESET_LIST.find((p) => p.id === presetId) ?? PRESET_LIST[0];
    const defaultProfile: ProfileId = '2020';
    setActivePreset(presetId);
    setDimensions(meta.defaultDimensions);
    setActiveProfile(defaultProfile);
    setWorkplaneY(meta.defaultDimensions.heightMm);
    setModel(buildPreset(presetId, meta.defaultDimensions, defaultProfile));
    setHistoryPast([]);
    setHistoryFuture([]);
    setOptReport(null);
    setSelectedMemberId(null);
    setSelectedNodeId(null);
    setDrawStartNodeId(null);
    setActionNotice(null);
    setCameraTrigger((prev) => ({ preset: 'iso', seq: prev.seq + 1 }));
  }, []);

  // Reset current preset
  const handleResetPreset = useCallback(() => {
    commitModel(() => buildPreset(activePreset, dimensions, activeProfile));
    setSelectedMemberId(null);
    setSelectedNodeId(null);
    setDrawStartNodeId(null);
    setCameraTrigger((prev) => ({ preset: 'iso', seq: prev.seq + 1 }));
    showNotice('已恢复当前模板初始结构');
  }, [activePreset, dimensions, activeProfile, commitModel, showNotice]);

  // Parametric dimension change
  const handleApplyDimensions = useCallback(
    (dims: { widthMm: number; depthMm: number; heightMm: number }) => {
      setDimensions(dims);
      setWorkplaneY(dims.heightMm);
      commitModel(() => buildPreset(activePreset, dims, activeProfile));
      setSelectedMemberId(null);
      setSelectedNodeId(null);
    },
    [activePreset, activeProfile, commitModel],
  );

  // Member profile editing
  const handleChangeMemberProfile = useCallback(
    (memberId: string, profileId: ProfileId) => {
      commitModel((prev) => ({
        ...prev,
        members: prev.members.map((m) => (m.id === memberId ? { ...m, profileId } : m)),
      }));
    },
    [commitModel],
  );

  // Batch apply selected default profile to entire frame
  const handleApplyProfileToAll = useCallback(
    (profileId: ProfileId) => {
      setActiveProfile(profileId);
      commitModel((prev) => ({
        ...prev,
        members: prev.members.map((m) => ({ ...m, profileId })),
      }));
      showNotice(`已将全部型材切换为 ${profileId} 规格`);
    },
    [commitModel, showNotice],
  );

  // Toggle lock/pin on a single extrusion (keeps its exact position & profile immutable during auto-design)
  const handleToggleMemberLock = useCallback(
    (memberId: string) => {
      const target = model.members.find((m) => m.id === memberId);
      if (!target) return;
      const nextLocked = !target.locked;
      commitModel((prev) => ({
        ...prev,
        members: prev.members.map((m) =>
          m.id === memberId ? { ...m, locked: nextLocked } : m,
        ),
      }));
      showNotice(
        nextLocked
          ? `已固定「${target.label ?? target.id}」位置与规格，自动算方案时保持不动`
          : `已解除「${target.label ?? target.id}」位置固定`,
      );
    },
    [model.members, commitModel, showNotice],
  );

  // Quick lock/unlock groups for constrained auto-design
  const handleQuickLockGroup = useCallback(
    (group: 'top-rails' | 'columns' | 'clear') => {
      const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));
      let maxY = -Infinity;
      for (const n of model.nodes) maxY = Math.max(maxY, n.position.y);

      commitModel((prev) => ({
        ...prev,
        members: prev.members.map((m) => {
          if (group === 'clear') return { ...m, locked: false };
          const n1 = nodeMap.get(m.startNodeId);
          const n2 = nodeMap.get(m.endNodeId);
          if (!n1 || !n2) return m;
          const absDx = Math.abs(n2.position.x - n1.position.x);
          const absDy = Math.abs(n2.position.y - n1.position.y);
          const absDz = Math.abs(n2.position.z - n1.position.z);
          if (group === 'top-rails') {
            const isTopBeam =
              absDy < 25 && n1.position.y >= maxY - 40 && n2.position.y >= maxY - 40;
            return isTopBeam ? { ...m, locked: true } : m;
          }
          const isColumn = absDy > absDx && absDy > absDz;
          return isColumn ? { ...m, locked: true } : m;
        }),
      }));

      if (group === 'clear') showNotice('已清空所有型材位置锁定');
      else if (group === 'top-rails') showNotice('已锁定全部顶部横梁位置与规格');
      else showNotice('已锁定全部立柱位置与规格');
    },
    [model.nodes, commitModel, showNotice],
  );

  // Replace a diagonal extrusion with external 5-hole triangular gusset plates (zero miter cutting)
  const handleReplaceBraceWithGusset = useCallback(
    (memberId: string) => {
      commitModel((prev) => ({
        ...prev,
        members: prev.members.filter((m) => m.id !== memberId),
      }));
      setJointType('gusset-plate');
      if (selectedMemberId === memberId) setSelectedMemberId(null);
      showNotice('已删除该斜撑，并将直角节点切换为「外置5孔三角连接板」（免锯斜角直装防晃）');
    },
    [commitModel, selectedMemberId, showNotice],
  );

  // Run constrained multi-objective auto-design solver (generates 3 Pareto schemes)
  const handleRunAutoDesign = useCallback(() => {
    const res = runConstrainedAutoDesign(model, {
      weights: autoWeights,
      targetSafetyFactor: optConstraints.targetSafetyFactor,
      maxSwayMm: autoMaxSwayMm,
      maxDeflectionMm: optConstraints.maxDeflectionMm,
      allowProfiles: optConstraints.allowProfiles,
      includeGravity,
      loadMultiplier,
      jointType,
      lateralPushN: lateralPushN > 0 ? lateralPushN : 150,
    });
    setAutoDesignResult(res);
    setAutoPreviewId(res.recommendedId);
    setOptReport(null);
    setColorMode('stress');
    setDeformScale(14);
    const best = res.candidates[0];
    showNotice(
      `已围绕 ${res.lockedMemberIds.length} 根固定型材生成 3 套方案，推荐「${best.title}」（${best.score}分 · ${best.bracketCount}角码 · 晃动 ${best.maxSwayMm.toFixed(2)}mm）`,
    );
  }, [
    model,
    autoWeights,
    autoMaxSwayMm,
    optConstraints,
    includeGravity,
    loadMultiplier,
    jointType,
    lateralPushN,
    showNotice,
  ]);

  const handleApplyAutoDesign = useCallback(
    (schemeId: AutoDesignSchemeId) => {
      if (!autoDesignResult) return;
      const picked = autoDesignResult.candidates.find((c) => c.id === schemeId);
      if (!picked) return;
      commitModel(() => cloneFrameModel(picked.model));
      setJointType(picked.recommendedJointType);
      setAutoDesignResult(null);
      setActiveTab('fea');
      showNotice(
        `已采纳「${picked.title}」：用料 ${picked.totalMassKg.toFixed(2)}kg · 晃动 ${picked.maxSwayMm.toFixed(2)}mm · ${picked.bracketCount} 个角码`,
      );
    },
    [autoDesignResult, commitModel, showNotice],
  );

  // Node coordinate, load & support editing
  const handleUpdateNodePosition = useCallback(
    (nodeId: string, pos: { x: number; y: number; z: number }) => {
      commitModel((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, position: pos } : n)),
      }));
    },
    [commitModel],
  );

  const handleUpdateNodeLoad = useCallback(
    (nodeId: string, load: { fx: number; fy: number; fz: number }) => {
      commitModel((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, load } : n)),
      }));
    },
    [commitModel],
  );

  const handleUpdateNodeSupport = useCallback(
    (nodeId: string, support: SupportType) => {
      commitModel((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, support } : n)),
      }));
    },
    [commitModel],
  );

  // One-click anti-sway diagonal bracing directly from FEA mode
  const handleQuickAntiSway = useCallback(() => {
    const testPush = lateralPushN > 0 ? lateralPushN : 150;
    const report = runFrameOptimization(model, {
      strategy: 'bracing',
      targetSafetyFactor: 2.5,
      maxDeflectionMm: 1.5,
      maxNewBraces: 6,
      allowProfiles: ['2020', '2040', '3030', '4040', '4080'],
      includeGravity,
      loadMultiplier,
      jointType,
      lateralPushN: testPush,
    });
    if (report.addedBraceCount > 0) {
      commitModel(() => cloneFrameModel(report.afterModel));
      showNotice(
        `已自动加装 ${report.addedBraceCount} 根三角形抗侧斜撑：水平晃动从 ${report.beforeFea.maxLateralSwayMm.toFixed(2)} mm 降至 ${report.afterFea.maxLateralSwayMm.toFixed(2)} mm`,
      );
    } else {
      showNotice('当前框架已具备充分的三角形抗侧支撑');
    }
  }, [model, lateralPushN, includeGravity, loadMultiplier, jointType, commitModel, showNotice]);

  // Interactive 3D CAD click handlers
  const handleClickNodeForTool = useCallback(
    (nodeId: string) => {
      if (cadTool === 'toggle-support') {
        const order: SupportType[] = ['free', 'fixed', 'pinned'];
        commitModel((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const next = order[(order.indexOf(n.support) + 1) % order.length];
            return { ...n, support: next };
          }),
        }));
        setSelectedNodeId(nodeId);
        setSelectedMemberId(null);
        return;
      }

      if (cadTool === 'add-load') {
        commitModel((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, load: { ...n.load, fy: n.load.fy - 500 } }
              : n,
          ),
        }));
        setSelectedNodeId(nodeId);
        setSelectedMemberId(null);
        return;
      }

      if (cadTool === 'draw-beam') {
        if (!drawStartNodeId) {
          setDrawStartNodeId(nodeId);
          setSelectedNodeId(nodeId);
          setSelectedMemberId(null);
          return;
        }
        if (drawStartNodeId === nodeId) {
          setDrawStartNodeId(null);
          return;
        }
        // Create new aluminum extrusion member between drawStartNodeId and nodeId
        const exists = model.members.some(
          (m) =>
            (m.startNodeId === drawStartNodeId && m.endNodeId === nodeId) ||
            (m.startNodeId === nodeId && m.endNodeId === drawStartNodeId),
        );
        if (!exists) {
          const newId = `M_USR_${Date.now().toString(36).slice(-4)}`;
          commitModel((prev) => ({
            ...prev,
            members: [
              ...prev.members,
              {
                id: newId,
                startNodeId: drawStartNodeId,
                endNodeId: nodeId,
                profileId: activeProfile,
                label: `自绘型材 (${drawStartNodeId}-${nodeId})`,
              },
            ],
          }));
          setSelectedMemberId(newId);
          setSelectedNodeId(null);
        }
        setDrawStartNodeId(null);
      }
    },
    [cadTool, drawStartNodeId, model.members, activeProfile, commitModel],
  );

  const handleClickWorkplane = useCallback(
    (pt: Vec3) => {
      // Reuse existing node if within 35mm
      const existing = model.nodes.find(
        (n) =>
          Math.hypot(n.position.x - pt.x, n.position.y - pt.y, n.position.z - pt.z) < 35,
      );

      if (cadTool === 'add-node') {
        if (existing) {
          setSelectedNodeId(existing.id);
          setSelectedMemberId(null);
          return;
        }
        const newNodeId = `N${model.nodes.length + 1}`;
        commitModel((prev) => ({
          ...prev,
          nodes: [
            ...prev.nodes,
            {
              id: newNodeId,
              position: pt,
              support: pt.y <= 10 ? 'fixed' : 'free',
              load: { fx: 0, fy: 0, fz: 0 },
            },
          ],
        }));
        setSelectedNodeId(newNodeId);
        setSelectedMemberId(null);
        return;
      }

      if (cadTool === 'draw-beam') {
        let targetId = existing?.id;
        let createdNode: FrameModel['nodes'][number] | null = null;

        if (!targetId) {
          targetId = `N${model.nodes.length + 1}`;
          createdNode = {
            id: targetId,
            position: pt,
            support: pt.y <= 10 ? 'fixed' : 'free',
            load: { fx: 0, fy: 0, fz: 0 },
          };
        }

        if (!drawStartNodeId) {
          if (createdNode) {
            commitModel((prev) => ({ ...prev, nodes: [...prev.nodes, createdNode!] }));
          }
          setDrawStartNodeId(targetId);
          setSelectedNodeId(targetId);
          setSelectedMemberId(null);
        } else if (drawStartNodeId !== targetId) {
          const newMemberId = `M_USR_${Date.now().toString(36).slice(-4)}`;
          commitModel((prev) => ({
            ...prev,
            nodes: createdNode ? [...prev.nodes, createdNode] : prev.nodes,
            members: [
              ...prev.members,
              {
                id: newMemberId,
                startNodeId: drawStartNodeId,
                endNodeId: targetId!,
                profileId: activeProfile,
                label: `自绘型材 (${drawStartNodeId}-${targetId})`,
              },
            ],
          }));
          setDrawStartNodeId(null);
          setSelectedMemberId(newMemberId);
          setSelectedNodeId(null);
        }
      }
    },
    [cadTool, drawStartNodeId, model.nodes, activeProfile, commitModel],
  );

  // Algorithmic Optimization
  const handleRunOptimization = useCallback(() => {
    const report = runFrameOptimization(model, {
      ...optConstraints,
      includeGravity,
      loadMultiplier,
      jointType,
      lateralPushN,
    });
    setOptReport(report);
    setOptPreviewMode('after');
    setColorMode('stress');
    setDeformScale(14);
  }, [model, optConstraints, includeGravity, loadMultiplier, jointType, lateralPushN]);

  const handleApplyOptimization = useCallback(() => {
    if (!optReport) return;
    commitModel(() => cloneFrameModel(optReport.afterModel));
    setOptReport(null);
    setActiveTab('fea');
    showNotice('已采纳结构优化方案');
  }, [optReport, commitModel, showNotice]);

  const selectedMember = useMemo(
    () => displayedModel.members.find((m) => m.id === selectedMemberId) ?? null,
    [displayedModel.members, selectedMemberId],
  );

  const selectedNode = useMemo(
    () => displayedModel.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [displayedModel.nodes, selectedNodeId],
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#F1F5F9]">
      <TopBar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenExport={() => setExportOpen(true)}
      />

      {activeTab === 'bom' ? (
        <BomView
          model={model}
          fea={fea}
          jointType={effectiveJointType}
          onOpenExport={() => setExportOpen(true)}
        />
      ) : (
        <main
          data-state={activeTab}
          data-member-count={displayedModel.members.length}
          data-node-count={displayedModel.nodes.length}
          className="flex-1 flex min-h-0 overflow-hidden"
        >
          {/* Left Docked CAD Tool Rail */}
          <LeftToolRail
            cadTool={cadTool}
            onSelectCadTool={(tool) => {
              if (activeTab !== 'draw') {
                setActiveTab('draw');
                setColorMode('material');
                setDeformScale(0);
              }
              setCadTool(tool);
              setDrawStartNodeId(null);
            }}
            canUndo={historyPast.length > 0}
            canRedo={historyFuture.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onResetPreset={handleResetPreset}
          />

          {/* Center Unobstructed 3D CAD & FEA Viewport */}
          <div className="flex-1 relative min-w-0 overflow-hidden bg-[#EEF2F6]">
            <AluminumViewport
              model={displayedModel}
              fea={fea}
              colorMode={colorMode}
              finish={finish}
              deformScale={deformScale}
              jointType={effectiveJointType}
              lateralPushN={effectiveLateralPushN}
              showSwayEnvelope={activeTab !== 'draw' && showSwayEnvelope}
              cadTool={cadTool}
              workplaneY={workplaneY}
              selectedMemberId={selectedMemberId}
              selectedNodeId={selectedNodeId}
              drawStartNodeId={drawStartNodeId}
              cameraPresetTrigger={cameraTrigger}
              onSelectMember={(id) => {
                if (activeTab === 'optimize' && !autoDesignResult && id) {
                  handleToggleMemberLock(id);
                  return;
                }
                setSelectedMemberId(id);
                if (id) setSelectedNodeId(null);
              }}
              onSelectNode={(id) => {
                setSelectedNodeId(id);
                if (id) setSelectedMemberId(null);
              }}
              onClickNodeForTool={handleClickNodeForTool}
              onClickWorkplane={handleClickWorkplane}
            />

            {/* Top-Left Quiet Active Tool Hint */}
            <div className="pointer-events-none absolute top-3.5 left-4 z-10 text-xs text-slate-600 bg-[#EEF2F6]/85 px-2.5 py-1 rounded">
              {activeTab === 'draw'
                ? TOOL_HINTS[cadTool]
                : activeTab === 'fea'
                  ? '受力分析视图 · 可在右侧切换 5 种节点连接工艺与切向推力大小'
                  : autoDesignResult
                    ? '自动方案对比预览 · 点击右侧 3 套方案卡片可即时切换 3D 效果'
                    : '自动方案模式 · 在 3D 视图点击任意型材可固定/解除位置，右侧一键算出最佳方案'}
            </div>

            {/* Bottom-Center Transient Action Toast */}
            {actionNotice && (
              <div
                role="status"
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-md px-3.5 py-2 text-xs font-medium text-blue-900 bg-white/95 border border-blue-200 rounded-lg shadow-sm text-center"
              >
                {actionNotice}
              </div>
            )}

            {/* Top-Right Compact FEA Colorbar Legend (Stress / Axial Modes Only) */}
            {(colorMode === 'stress' || colorMode === 'axial') && (
              <div
                aria-label="有限元云图色阶标尺"
                className="pointer-events-none absolute top-3.5 right-4 z-10 bg-white/95 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-600 shadow-xs"
              >
                <div className="flex items-center justify-between gap-4 mb-1">
                  <span className="font-medium text-slate-800">
                    {colorMode === 'stress' ? 'Von Mises 应力 (MPa)' : '型材轴力 (N)'}
                  </span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {colorMode === 'stress' ? '屈服 145' : '压(-) / 拉(+)'}
                  </span>
                </div>
                <div
                  className="h-2 w-44 rounded-xs"
                  style={{
                    background:
                      colorMode === 'stress'
                        ? 'linear-gradient(90deg, #2563EB 0%, #0EA5E9 25%, #10B981 50%, #F59E0B 75%, #DC2626 100%)'
                        : 'linear-gradient(90deg, #1D4ED8 0%, #94A3B8 50%, #EA580C 100%)',
                  }}
                />
                <div className="flex items-center justify-between font-mono tabular-nums text-[10px] text-slate-500 mt-1">
                  {colorMode === 'stress' ? (
                    <>
                      <span>0</span>
                      <span>35</span>
                      <span>70</span>
                      <span>105</span>
                      <span>125+</span>
                    </>
                  ) : (
                    <>
                      <span>受压</span>
                      <span>0</span>
                      <span>受拉</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Bottom-Left Compact Camera View Switcher */}
            <div
              role="group"
              aria-label="相机视角切换"
              className="absolute bottom-4 left-4 z-10 flex items-center gap-0.5 p-1 bg-white border border-slate-200 rounded-lg shadow-xs"
            >
              {CAMERA_VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    setCameraTrigger((prev) => ({ preset: v.id, seq: prev.seq + 1 }))
                  }
                  className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right Docked Engineering Inspector */}
          <RightInspectorPanel
            activeTab={activeTab}
            collapsed={inspectorCollapsed}
            onToggleCollapse={() => setInspectorCollapsed((c) => !c)}
            activePreset={activePreset}
            onSelectPreset={handleSelectPreset}
            dimensions={dimensions}
            onApplyDimensions={handleApplyDimensions}
            model={displayedModel}
            fea={fea}
            cadTool={cadTool}
            activeProfile={activeProfile}
            onSelectActiveProfile={setActiveProfile}
            onApplyProfileToAll={handleApplyProfileToAll}
            finish={finish}
            onSelectFinish={setFinish}
            workplaneY={workplaneY}
            onChangeWorkplaneY={setWorkplaneY}
            drawStartNodeId={drawStartNodeId}
            onCancelDraw={() => setDrawStartNodeId(null)}
            selectedMember={selectedMember}
            selectedNode={selectedNode}
            onSelectMember={(id) => {
              setSelectedMemberId(id);
              if (id) setSelectedNodeId(null);
            }}
            onSelectNode={(id) => {
              setSelectedNodeId(id);
              if (id) setSelectedMemberId(null);
            }}
            onChangeMemberProfile={handleChangeMemberProfile}
            onToggleMemberLock={handleToggleMemberLock}
            onQuickLockGroup={handleQuickLockGroup}
            onReplaceBraceWithGusset={handleReplaceBraceWithGusset}
            onDeleteMember={handleDeleteMember}
            onDeleteNode={handleDeleteNode}
            onUpdateNodePosition={handleUpdateNodePosition}
            onUpdateNodeLoad={handleUpdateNodeLoad}
            onUpdateNodeSupport={handleUpdateNodeSupport}
            colorMode={colorMode}
            onSelectColorMode={setColorMode}
            deformScale={deformScale}
            onChangeDeformScale={setDeformScale}
            loadMultiplier={loadMultiplier}
            onChangeLoadMultiplier={setLoadMultiplier}
            includeGravity={includeGravity}
            onToggleGravity={() => setIncludeGravity((g) => !g)}
            jointType={effectiveJointType}
            onChangeJointType={setJointType}
            lateralPushN={lateralPushN}
            onChangeLateralPushN={setLateralPushN}
            comparePushN={comparePushN}
            craftComparisons={craftComparisons}
            swaySummary={swaySummary}
            showSwayEnvelope={showSwayEnvelope}
            onToggleSwayEnvelope={() => setShowSwayEnvelope((v) => !v)}
            onQuickAntiSway={handleQuickAntiSway}
            optConstraints={optConstraints}
            onChangeOptConstraints={setOptConstraints}
            optReport={optReport}
            optPreviewMode={optPreviewMode}
            onChangeOptPreviewMode={setOptPreviewMode}
            onRunOptimization={handleRunOptimization}
            onApplyOptimization={handleApplyOptimization}
            onClearOptimization={() => setOptReport(null)}
            autoWeights={autoWeights}
            onChangeAutoWeights={setAutoWeights}
            autoMaxSwayMm={autoMaxSwayMm}
            onChangeAutoMaxSwayMm={setAutoMaxSwayMm}
            autoDesignResult={autoDesignResult}
            autoPreviewId={autoPreviewId}
            onSelectAutoPreviewId={setAutoPreviewId}
            onRunAutoDesign={handleRunAutoDesign}
            onApplyAutoDesign={handleApplyAutoDesign}
            onClearAutoDesign={() => setAutoDesignResult(null)}
          />
        </main>
      )}

      <ExportModal
        open={exportOpen}
        model={model}
        fea={fea}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
