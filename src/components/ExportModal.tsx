import { useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { generateBomCsv, optimizeCuttingStock } from '../engine/cuttingStock';
import type { FeaResult, FrameModel } from '../engine/types';

interface ExportModalProps {
  open: boolean;
  model: FrameModel;
  fea: FeaResult;
  onClose: () => void;
}

export function ExportModal({ open, model, fea, onClose }: ExportModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const bom = optimizeCuttingStock(model, { stockLengthMm: 3000, kerfMm: 3 });
  const csvContent = generateBomCsv(model, bom);

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    downloadFile('\uFEFF' + csvContent, `${model.name}-物料与下料清单.csv`, 'text/csv;charset=utf-8');
  };

  const handleDownloadJson = () => {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        model,
        feaSummary: {
          maxStressMPa: Number(fea.maxStressMPa.toFixed(2)),
          maxDisplacementMm: Number(fea.maxDisplacementMm.toFixed(3)),
          minSafetyFactor: Number(fea.minSafetyFactor.toFixed(2)),
          totalMassKg: Number(fea.totalMassKg.toFixed(2)),
          status: fea.status,
        },
      },
      null,
      2,
    );
    downloadFile(payload, `${model.name}-结构模型.json`, 'application/json;charset=utf-8');
  };

  const handleCopySummary = async () => {
    const summary = [
      `方案：${model.name}`,
      `型材段数：${model.members.length} 根 · 节点数：${model.nodes.length}`,
      `总净重：${bom.totalMassKg.toFixed(2)} kg · 3米定尺：${bom.stockPlans.length} 根（利用率 ${bom.overallUtilizationPct.toFixed(1)}%）`,
      `最大等效应力：${fea.maxStressMPa.toFixed(1)} MPa · 最大位移：${fea.maxDisplacementMm.toFixed(2)} mm · 最小安全系数：${fea.minSafetyFactor.toFixed(2)}`,
      `预估材料与五金总价：¥${bom.grandTotalCostCNY.toFixed(0)}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 id="export-modal-title" className="text-base font-semibold text-slate-900">
            导出结构方案与下料清单
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭导出窗口"
            className="p-1 text-slate-400 hover:text-slate-700 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm text-slate-600">
          <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-md p-3.5">
            <div>
              <div className="text-slate-500">当前方案</div>
              <div className="font-semibold text-slate-900 mt-0.5">{model.name}</div>
            </div>
            <div>
              <div className="text-slate-500">结构安全评估</div>
              <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                SF {fea.minSafetyFactor.toFixed(2)} · δ {fea.maxDisplacementMm.toFixed(2)} mm
              </div>
            </div>
            <div>
              <div className="text-slate-500">3米定尺采购</div>
              <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                {bom.stockPlans.length} 根 · 利用率 {bom.overallUtilizationPct.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-slate-500">预估总成本</div>
              <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                ¥{bom.grandTotalCostCNY.toFixed(0)} ({bom.totalMassKg.toFixed(2)} kg)
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>下载 CSV 物料与下料排版清单（Excel 兼容）</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadJson}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>下载 JSON 三维结构模型与力学报告</span>
            </button>

            <button
              type="button"
              onClick={handleCopySummary}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? '已复制工程摘要到剪贴板' : '复制文字版工程评估摘要'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
