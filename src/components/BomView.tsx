import { useMemo, useState } from 'react';
import { optimizeCuttingStock } from '../engine/cuttingStock';
import type { FeaResult, FrameModel, JointType } from '../engine/types';

interface BomViewProps {
  model: FrameModel;
  fea: FeaResult;
  jointType: JointType;
  onOpenExport: () => void;
}

const CUT_BAR_COLORS = [
  'bg-blue-600',
  'bg-sky-600',
  'bg-indigo-600',
  'bg-teal-600',
  'bg-slate-600',
];

export function BomView({ model, fea, jointType, onOpenExport }: BomViewProps) {
  const [stockLengthMm, setStockLengthMm] = useState<number>(3000);
  const [kerfMm, setKerfMm] = useState<number>(3);

  const bom = useMemo(
    () => optimizeCuttingStock(model, { stockLengthMm, kerfMm, jointType }),
    [model, stockLengthMm, kerfMm, jointType],
  );

  const totalBars = bom.stockPlans.length;

  return (
    <main className="flex-1 overflow-y-auto bg-[#F8FAFC] px-6 py-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header & Stock Settings */}
        <div className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              物料清单与一维下料排版优化
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {model.name} · {model.members.length} 段型材 · {model.nodes.length} 个结构节点 · 6063-T5 工业铝型材
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-600">
              <span>标准定尺</span>
              <div
                role="group"
                aria-label="原料定尺长度"
                className="flex items-center gap-0.5 p-0.5 bg-slate-200/70 rounded-md"
              >
                {[2000, 3000, 6000].map((len) => (
                  <button
                    key={len}
                    type="button"
                    onClick={() => setStockLengthMm(len)}
                    className={`px-2.5 py-1.5 font-mono rounded transition-colors whitespace-nowrap ${
                      stockLengthMm === len
                        ? 'bg-white text-blue-700 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {len / 1000}m
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 text-slate-600">
              <span>锯口损耗</span>
              <div
                role="group"
                aria-label="锯片切割损耗"
                className="flex items-center gap-0.5 p-0.5 bg-slate-200/70 rounded-md"
              >
                {[2, 3, 4].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKerfMm(k)}
                    className={`px-2.5 py-1.5 font-mono rounded transition-colors whitespace-nowrap ${
                      kerfMm === k
                        ? 'bg-white text-blue-700 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {k}mm
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenExport}
              className="h-9 px-4 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
            >
              下载 CSV / JSON
            </button>
          </div>
        </div>

        {/* 4-Column Quantitative Summary Strip */}
        <section aria-label="成本与材料汇总" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs text-slate-500">铝型材总净重</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {bom.totalMassKg.toFixed(2)} <span className="text-sm font-normal text-slate-500">kg</span>
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              净长 {(fea.totalLengthMm / 1000).toFixed(2)} m · 安全系数 {fea.minSafetyFactor.toFixed(1)}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs text-slate-500">定尺整材需求</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {totalBars} <span className="text-sm font-normal text-slate-500">根 ({stockLengthMm / 1000}m)</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              一维 FFD 装箱算法排版
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs text-slate-500">综合套料利用率</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
              {bom.overallUtilizationPct.toFixed(1)}%
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              含每刀 {kerfMm} mm 锯缝损耗
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs text-slate-500">材料与配件预估总价</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
              ¥{bom.grandTotalCostCNY.toFixed(0)}
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              型材 ¥{bom.totalProfileCostCNY.toFixed(0)} · 五金 ¥{bom.totalHardwareCostCNY.toFixed(0)}
            </div>
          </div>
        </section>

        {/* 1D Cutting Stock Visual Layout */}
        <section aria-label="下料排版示意图" className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">
              一维定尺切割套料方案 ({stockLengthMm} mm 标准原材)
            </h2>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              共 {bom.stockPlans.length} 根原料 · 锯缝 {kerfMm} mm
            </span>
          </div>

          <div className="space-y-3">
            {bom.stockPlans.map((plan) => (
              <div key={plan.barIndex} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between text-xs text-slate-600">
                  <span className="font-mono font-medium text-slate-900">
                    原材 #{plan.barIndex} · 欧标 {plan.profileId}
                  </span>
                  <span className="font-mono tabular-nums text-slate-500">
                    实切 {plan.usedMm} mm · 锯损 {plan.kerfMm} mm · 余料 {plan.wasteMm} mm · 利用率{' '}
                    <strong className="text-slate-900">{plan.utilizationPct.toFixed(1)}%</strong>
                  </span>
                </div>
                <div className="h-8 w-full bg-slate-100 rounded overflow-hidden flex border border-slate-200">
                  {plan.cuts.map((cut, cIdx) => {
                    const pct = (cut.lengthMm / plan.stockLengthMm) * 100;
                    const colorClass = CUT_BAR_COLORS[cIdx % CUT_BAR_COLORS.length];
                    const isAngledCut = Boolean(cut.cutSpec && cut.cutSpec !== '90°平切');
                    return (
                      <div
                        key={`${plan.barIndex}-${cut.memberId}-${cIdx}`}
                        style={{ width: `${pct}%` }}
                        title={`${cut.label}: ${cut.lengthMm} mm · ${cut.cutSpec ?? '90°平切'}`}
                        className={`${isAngledCut ? 'bg-amber-600' : colorClass} h-full border-r border-white/80 flex items-center justify-center px-1 text-[11px] font-mono tabular-nums text-white overflow-hidden whitespace-nowrap`}
                      >
                        {pct >= 11
                          ? `${cut.lengthMm}${isAngledCut ? (cut.cutSpec?.includes('45°') ? ' (45°)' : ' (铰)') : ''}`
                          : pct >= 7
                            ? `${cut.lengthMm}`
                            : ''}
                      </div>
                    );
                  })}
                  {plan.wasteMm > 0 && (
                    <div
                      style={{ width: `${(plan.wasteMm / plan.stockLengthMm) * 100}%` }}
                      className="h-full bg-slate-200/70 flex items-center justify-center text-[11px] font-mono tabular-nums text-slate-500 overflow-hidden whitespace-nowrap"
                    >
                      {(plan.wasteMm / plan.stockLengthMm) * 100 >= 11 ? `余 ${plan.wasteMm}` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tables: Profile Summary + Fasteners/Hardware */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">型材规格采购汇总</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">规格</th>
                    <th className="py-2.5 px-3 font-medium text-right">段数</th>
                    <th className="py-2.5 px-3 font-medium text-right">净长(mm)</th>
                    <th className="py-2.5 px-3 font-medium text-right">定尺数</th>
                    <th className="py-2.5 px-3 font-medium text-right">净重(kg)</th>
                    <th className="py-2.5 px-4 font-medium text-right">费用(元)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {bom.profileRows.map((row) => (
                    <tr key={row.profileId}>
                      <td className="py-2.5 px-4 font-medium text-slate-900">{row.name}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{row.pieceCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{row.totalLengthMm}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{row.stockBarsNeeded} 根</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{row.massKg.toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                        ¥{row.costCNY.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">连接件与标准五金清单</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">配件名称</th>
                    <th className="py-2.5 px-3 font-medium text-right">数量</th>
                    <th className="py-2.5 px-3 font-medium text-right">单价</th>
                    <th className="py-2.5 px-4 font-medium text-right">小计(元)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {bom.hardwareRows.map((hw) => (
                    <tr key={hw.id}>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{hw.name}</div>
                        <div className="text-[11px] text-slate-500">{hw.spec}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {hw.quantity} {hw.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        ¥{hw.unitPriceCNY.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                        ¥{hw.totalPriceCNY.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Diagonal / Triangular Extrusion Fabrication & Connection Guide */}
        {bom.diagonalGuides.length > 0 && (
          <section
            aria-label="斜撑与三角型材连接加工明细"
            className="bg-white border border-slate-200 rounded-lg overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  斜撑 / 三角型材切割与连接工艺明细
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  标准 45° 角撑采用两端 45° 斜切 + 45° 斜角码；非 45° 满跨斜撑采用 90° 平切 + 万向活动铰链直连主框 T 型槽
                </p>
              </div>
              <span className="font-mono tabular-nums text-xs text-slate-600">
                共 {bom.diagonalGuides.length} 根斜撑
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">构件名称</th>
                    <th className="py-2.5 px-3 font-medium">规格</th>
                    <th className="py-2.5 px-3 font-medium text-right">下料长度</th>
                    <th className="py-2.5 px-3 font-medium text-right">两端夹角</th>
                    <th className="py-2.5 px-3 font-medium">端面锯切工艺</th>
                    <th className="py-2.5 px-4 font-medium">配套连接件（每根×2）</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {bom.diagonalGuides.map((g) => (
                    <tr key={g.memberId}>
                      <td className="py-2.5 px-4 font-medium text-slate-900">{g.label}</td>
                      <td className="py-2.5 px-3 font-mono">{g.profileId}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {g.lengthMm} mm
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {g.angleStartDeg.toFixed(1)}° / {g.angleEndDeg.toFixed(1)}°
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`font-medium ${
                            g.craft === 'miter-45' ? 'text-teal-700' : 'text-amber-700'
                          }`}
                        >
                          {g.cutSpec}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">
                        {g.hardwareName} ×{g.hardwareQty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
