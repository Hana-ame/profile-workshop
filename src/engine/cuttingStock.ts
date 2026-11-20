import { analyzeMemberConnection, summarizeFrameDiagonalHardware } from './braceConnection';
import { getProfileSpec, PROFILE_ORDER } from './profiles';
import type { BomSummary, FrameModel, JointType, ProfileId, StockBarPlan } from './types';

export interface CuttingOptions {
  stockLengthMm?: number; // Default 3000 mm standard bar
  kerfMm?: number;        // Saw blade kerf loss per cut (default 3 mm)
  jointType?: JointType;  // Selected orthogonal joint craft for accurate hardware BOM
}

/**
 * First-Fit Decreasing (FFD) 1D Cutting Stock Bin-Packing Optimizer.
 * Groups frame members by profile series, annotates exact cut specs (90° straight vs 45° miter vs swivel-hinge),
 * and itemizes orthogonal & diagonal aluminum extrusion hardware accurately.
 */
export function optimizeCuttingStock(
  model: FrameModel,
  options: CuttingOptions = {},
): BomSummary {
  const stockLengthMm = options.stockLengthMm ?? 3000;
  const kerfMm = options.kerfMm ?? 3;
  const jointType = options.jointType ?? 'semi-rigid';

  const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));
  const groupedCuts = new Map<
    ProfileId,
    { memberId: string; lengthMm: number; label: string; cutSpec: string }[]
  >();

  for (const m of model.members) {
    const n1 = nodeMap.get(m.startNodeId);
    const n2 = nodeMap.get(m.endNodeId);
    if (!n1 || !n2) continue;
    const len = Math.round(
      Math.hypot(
        n2.position.x - n1.position.x,
        n2.position.y - n1.position.y,
        n2.position.z - n1.position.z,
      ),
    );
    if (len <= 0) continue;
    const guide = analyzeMemberConnection(model, m);
    const list = groupedCuts.get(m.profileId) ?? [];
    list.push({
      memberId: m.id,
      lengthMm: len,
      label: m.label ?? m.id,
      cutSpec: guide.cutSpec,
    });
    groupedCuts.set(m.profileId, list);
  }

  const stockPlans: StockBarPlan[] = [];
  const profileRows: BomSummary['profileRows'] = [];
  let totalProfileCostCNY = 0;
  let totalMassKg = 0;
  let totalUsedLengthAll = 0;
  let totalStockLengthAll = 0;
  let globalBarCounter = 1;

  for (const profileId of PROFILE_ORDER) {
    const cuts = groupedCuts.get(profileId);
    if (!cuts || cuts.length === 0) continue;

    // Sort descending for First-Fit Decreasing (FFD)
    const sorted = [...cuts].sort((a, b) => b.lengthMm - a.lengthMm);
    const bins: {
      cuts: { memberId: string; lengthMm: number; label: string; cutSpec: string }[];
      usedMm: number;
      kerfMm: number;
    }[] = [];

    for (const cut of sorted) {
      let placed = false;
      for (const bin of bins) {
        const extraKerf = bin.cuts.length > 0 ? kerfMm : 0;
        if (bin.usedMm + bin.kerfMm + extraKerf + cut.lengthMm <= stockLengthMm) {
          bin.cuts.push(cut);
          bin.usedMm += cut.lengthMm;
          bin.kerfMm += extraKerf;
          placed = true;
          break;
        }
      }
      if (!placed) {
        bins.push({
          cuts: [cut],
          usedMm: cut.lengthMm,
          kerfMm: 0,
        });
      }
    }

    const spec = getProfileSpec(profileId);
    let profileTotalCutMm = 0;

    for (const bin of bins) {
      const effectiveStock = Math.max(stockLengthMm, bin.usedMm);
      const wasteMm = Math.max(0, effectiveStock - bin.usedMm - bin.kerfMm);
      const utilizationPct = (bin.usedMm / effectiveStock) * 100;
      profileTotalCutMm += bin.usedMm;
      totalUsedLengthAll += bin.usedMm;
      totalStockLengthAll += effectiveStock;

      stockPlans.push({
        barIndex: globalBarCounter++,
        profileId,
        stockLengthMm: effectiveStock,
        cuts: bin.cuts,
        usedMm: bin.usedMm,
        kerfMm: bin.kerfMm,
        wasteMm,
        utilizationPct,
      });
    }

    const barsNeeded = bins.length;
    const billedMeters = (barsNeeded * stockLengthMm) / 1000;
    const costCNY = billedMeters * spec.pricePerMeterCNY;
    const massKg = (profileTotalCutMm / 1000) * spec.massPerMeterKg;
    const avgUtil = (profileTotalCutMm / (barsNeeded * stockLengthMm)) * 100;

    totalProfileCostCNY += costCNY;
    totalMassKg += massKg;

    profileRows.push({
      profileId,
      name: spec.name,
      pieceCount: cuts.length,
      totalLengthMm: profileTotalCutMm,
      stockBarsNeeded: barsNeeded,
      utilizationPct: avgUtil,
      massKg,
      costCNY,
    });
  }

  // Analyze diagonal/triangular extrusions for real-world specialized hardware
  const diagSummary = summarizeFrameDiagonalHardware(model);
  const diagIds = new Set(diagSummary.guides.map((g) => g.memberId));

  // Count orthogonal node corners (skipping straight-through collinear T-slot attachment nodes)
  const orthoDirsMap = new Map<string, { x: number; y: number; z: number }[]>();
  const allDegreeMap = new Map<string, number>();
  for (const m of model.members) {
    allDegreeMap.set(m.startNodeId, (allDegreeMap.get(m.startNodeId) ?? 0) + 1);
    allDegreeMap.set(m.endNodeId, (allDegreeMap.get(m.endNodeId) ?? 0) + 1);
    if (!diagIds.has(m.id)) {
      const n1 = nodeMap.get(m.startNodeId);
      const n2 = nodeMap.get(m.endNodeId);
      if (n1 && n2) {
        const dx = n2.position.x - n1.position.x;
        const dy = n2.position.y - n1.position.y;
        const dz = n2.position.z - n1.position.z;
        const l = Math.hypot(dx, dy, dz);
        if (l > 1e-4) {
          const u = { x: dx / l, y: dy / l, z: dz / l };
          const l1 = orthoDirsMap.get(n1.id) ?? [];
          l1.push(u);
          orthoDirsMap.set(n1.id, l1);
          const l2 = orthoDirsMap.get(n2.id) ?? [];
          l2.push({ x: -u.x, y: -u.y, z: -u.z });
          orthoDirsMap.set(n2.id, l2);
        }
      }
    }
  }

  let orthoConnectorCount = 0;
  let endCapCount = 0;
  let levelingFootCount = 0;

  for (const n of model.nodes) {
    const dirs = orthoDirsMap.get(n.id) ?? [];
    if (dirs.length >= 2) {
      const isCollinear =
        dirs.length === 2 &&
        Math.abs(dirs[0].x * dirs[1].x + dirs[0].y * dirs[1].y + dirs[0].z * dirs[1].z) > 0.96;
      if (!isCollinear) {
        orthoConnectorCount += Math.max(1, dirs.length - 1);
      }
    }
    const totalDeg = allDegreeMap.get(n.id) ?? 0;
    if (totalDeg === 1) {
      endCapCount += 1;
    }
    if (n.support !== 'free' && n.position.y <= 10) {
      levelingFootCount += 1;
    }
  }
  endCapCount = Math.max(4, endCapCount + levelingFootCount);

  const hardwareRows: BomSummary['hardwareRows'] = [];

  // Primary orthogonal joint hardware matching selected joint craft
  if (jointType === 'gusset-plate') {
    hardwareRows.push({
      id: 'HW-GUSSET',
      name: '外置加厚三角连接板 (5孔L型加强板)',
      spec: '免斜切直装 · 6mm 厚氧化铝板，抗晃主力',
      quantity: orthoConnectorCount,
      unit: '块',
      unitPriceCNY: 6.5,
      totalPriceCNY: orthoConnectorCount * 6.5,
    });
  } else if (jointType === 'builtin') {
    hardwareRows.push({
      id: 'HW-BUILTIN',
      name: '内置隐藏式连接件 (端面攻丝弹片)',
      spec: '外立面平整无凸出 · 适配 20/30/40 槽',
      quantity: orthoConnectorCount,
      unit: '套',
      unitPriceCNY: 2.2,
      totalPriceCNY: orthoConnectorCount * 2.2,
    });
  } else if (jointType === 'rigid') {
    hardwareRows.push({
      id: 'HW-RIGID',
      name: '重型端面通孔高强螺栓 + 双面钢加强板',
      spec: '刚接工业重载标准 · 8.8 级防松锁紧',
      quantity: orthoConnectorCount,
      unit: '套',
      unitPriceCNY: 9.0,
      totalPriceCNY: orthoConnectorCount * 9.0,
    });
  } else {
    hardwareRows.push({
      id: 'HW-BRACKET',
      name: '压铸铝直角角码 (90° L型连接件)',
      spec: '适配主型材槽宽 6/8mm · 用于直角节点',
      quantity: orthoConnectorCount,
      unit: '个',
      unitPriceCNY: 2.8,
      totalPriceCNY: orthoConnectorCount * 2.8,
    });
  }

  // Specialized 45° diagonal bevel blocks (only when 45° mitered braces exist)
  if (diagSummary.miter45BracketCount > 0) {
    hardwareRows.push({
      id: 'HW-MITER45',
      name: '45°/135° 斜角专用连接块 (斜撑角码)',
      spec: `适配 ${diagSummary.miter45MemberCount} 根 45° 斜切角撑两端贴槽锁紧`,
      quantity: diagSummary.miter45BracketCount,
      unit: '个',
      unitPriceCNY: 4.5,
      totalPriceCNY: diagSummary.miter45BracketCount * 4.5,
    });
  }

  // Specialized arbitrary-angle swivel hinges (only when non-45° diagonal braces exist)
  if (diagSummary.swivelHingeCount > 0) {
    hardwareRows.push({
      id: 'HW-SWIVEL',
      name: '铝型材万向活动铰链 (任意角度转向连接件)',
      spec: `适配 ${diagSummary.swivelHingeMemberCount} 根非 45° 长斜撑 · 端面 90° 平切免斜切`,
      quantity: diagSummary.swivelHingeCount,
      unit: '个',
      unitPriceCNY: 8.5,
      totalPriceCNY: diagSummary.swivelHingeCount * 8.5,
    });
  }

  const boltsPerOrtho = jointType === 'gusset-plate' ? 5 : jointType === 'rigid' ? 4 : 2;
  const boltNutSets =
    orthoConnectorCount * boltsPerOrtho +
    diagSummary.miter45BracketCount * 2 +
    diagSummary.swivelHingeCount * 2;

  hardwareRows.push(
    {
      id: 'HW-FASTENER',
      name: 'T型滑块螺母 + 圆柱头内六角螺栓',
      spec: 'M5/M6/M8 碳钢镀镍套装 (含斜撑连接螺栓)',
      quantity: boltNutSets,
      unit: '套',
      unitPriceCNY: 0.65,
      totalPriceCNY: boltNutSets * 0.65,
    },
    {
      id: 'HW-FOOT',
      name: '重型防滑调平蹄脚 (带底板)',
      spec: 'M12 碳钢丝杆 + 橡胶减震垫',
      quantity: levelingFootCount,
      unit: '套',
      unitPriceCNY: 14.5,
      totalPriceCNY: levelingFootCount * 14.5,
    },
    {
      id: 'HW-CAP',
      name: '尼龙端面防尘盖',
      spec: '黑色抗冲击 ABS/尼龙',
      quantity: endCapCount,
      unit: '个',
      unitPriceCNY: 0.8,
      totalPriceCNY: endCapCount * 0.8,
    },
  );

  const totalHardwareCostCNY = hardwareRows.reduce((acc, r) => acc + r.totalPriceCNY, 0);
  const overallUtilizationPct =
    totalStockLengthAll > 0 ? (totalUsedLengthAll / totalStockLengthAll) * 100 : 0;

  return {
    profileRows,
    hardwareRows,
    diagonalGuides: diagSummary.guides,
    stockPlans,
    totalProfileCostCNY,
    totalHardwareCostCNY,
    grandTotalCostCNY: totalProfileCostCNY + totalHardwareCostCNY,
    totalMassKg,
    overallUtilizationPct,
  };
}

/**
 * Generate a clean CSV export string for the BOM & cut list (with exact cut angles & diagonal hardware)
 */
export function generateBomCsv(model: FrameModel, bom: BomSummary): string {
  const lines: string[] = [];
  lines.push(`方案名称,${model.name}`);
  lines.push(`型材总重(kg),${bom.totalMassKg.toFixed(2)}`);
  lines.push(`整材利用率(%),${bom.overallUtilizationPct.toFixed(1)}`);
  lines.push(`材料预估总价(元),${bom.grandTotalCostCNY.toFixed(2)}`);
  lines.push('');
  lines.push('型材汇总表');
  lines.push('规格,名称,段数,净长度(mm),需定尺(根),利用率(%),净重(kg),定尺费用(元)');
  for (const row of bom.profileRows) {
    lines.push(
      `${row.profileId},${row.name},${row.pieceCount},${row.totalLengthMm},${row.stockBarsNeeded},${row.utilizationPct.toFixed(1)},${row.massKg.toFixed(2)},${row.costCNY.toFixed(2)}`,
    );
  }
  lines.push('');
  lines.push('连接件与五金配件表');
  lines.push('物料编码,名称,规格,数量,单位,单价(元),小计(元)');
  for (const hw of bom.hardwareRows) {
    lines.push(
      `${hw.id},${hw.name},${hw.spec},${hw.quantity},${hw.unit},${hw.unitPriceCNY.toFixed(2)},${hw.totalPriceCNY.toFixed(2)}`,
    );
  }
  if (bom.diagonalGuides.length > 0) {
    lines.push('');
    lines.push('斜撑/三角型材切割与连接工艺明细');
    lines.push('构件,规格,长度(mm),两端夹角,切割工艺,配套连接件');
    for (const g of bom.diagonalGuides) {
      lines.push(
        `${g.label},${g.profileId},${g.lengthMm},${g.angleStartDeg}°/${g.angleEndDeg}°,${g.cutSpec},${g.hardwareName} x${g.hardwareQty}`,
      );
    }
  }
  lines.push('');
  lines.push('下料排版明细');
  lines.push('定尺编号,规格,切割清单(mm与切角),已用(mm),余料(mm),利用率(%)');
  for (const plan of bom.stockPlans) {
    const cutStr = plan.cuts
      .map((c) => `${c.label}:${c.lengthMm}mm(${c.cutSpec ?? '90°平切'})`)
      .join(' + ');
    lines.push(
      `BAR-${plan.barIndex},${plan.profileId},"${cutStr}",${plan.usedMm},${plan.wasteMm},${plan.utilizationPct.toFixed(1)}`,
    );
  }
  return lines.join('\n');
}
