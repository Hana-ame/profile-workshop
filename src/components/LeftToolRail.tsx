import {
  Anchor,
  ArrowDownToLine,
  CircleDot,
  MousePointer2,
  PenTool,
  PlusCircle,
  Redo2,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import type { CadTool } from '../engine/types';

interface LeftToolRailProps {
  cadTool: CadTool;
  onSelectCadTool: (tool: CadTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onResetPreset: () => void;
}

const TOOL_ITEMS: {
  id: CadTool;
  label: string;
  hotkey: string;
  hint: string;
  icon: typeof MousePointer2;
}[] = [
  { id: 'select-member', label: '选型材', hotkey: 'V', hint: '型材选择模式：只选铝型材杆件 (V)', icon: MousePointer2 },
  { id: 'select-node', label: '选节点', hotkey: 'K', hint: '节点选择模式：只选节点坐标/支座/删并合并 (K)', icon: CircleDot },
  { id: 'draw-beam', label: '画型材', hotkey: 'L', hint: '连接两节点或网格绘制型材 (L)', icon: PenTool },
  { id: 'add-node', label: '加节点', hotkey: 'N', hint: '在工作平面网格添加节点 (N)', icon: PlusCircle },
  { id: 'add-load', label: '加荷载', hotkey: 'F', hint: '点击节点叠加向下外力 (F)', icon: ArrowDownToLine },
  { id: 'toggle-support', label: '设支座', hotkey: 'S', hint: '循环切换自由/固定/铰接支座 (S)', icon: Anchor },
];

export function LeftToolRail({
  cadTool,
  onSelectCadTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onResetPreset,
}: LeftToolRailProps) {
  return (
    <aside
      aria-label="CAD 绘图工具栏"
      className="w-[70px] shrink-0 bg-white border-r border-slate-200 flex flex-col items-center justify-between py-3 px-1.5 z-10 select-none"
    >
      {/* Primary CAD Tools (explicit Member Select vs Node Select) */}
      <div role="group" aria-label="CAD绘图工具" className="flex flex-col items-center gap-1.5 w-full">
        {TOOL_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = cadTool === item.id;
          return (
            <button
              key={item.id}
              type="button"
              title={item.hint}
              aria-pressed={active}
              onClick={() => onSelectCadTool(item.id)}
              className={`w-full py-2 px-1 rounded-lg flex flex-col items-center justify-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                active
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
              }`}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              <span className="text-[11px] leading-none whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* History & Reset Utilities */}
      <div className="flex flex-col items-center gap-1.5 w-full pt-3 border-t border-slate-200">
        <button
          type="button"
          title="撤销 (Ctrl+Z)"
          aria-label="撤销"
          disabled={!canUndo}
          onClick={onUndo}
          className="w-full py-2 px-1 rounded-lg flex flex-col items-center justify-center gap-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35 disabled:hover:bg-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <Undo2 className="w-4 h-4 shrink-0" />
          <span className="text-[11px] leading-none whitespace-nowrap">撤销</span>
        </button>

        <button
          type="button"
          title="重做 (Ctrl+Shift+Z)"
          aria-label="重做"
          disabled={!canRedo}
          onClick={onRedo}
          className="w-full py-2 px-1 rounded-lg flex flex-col items-center justify-center gap-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35 disabled:hover:bg-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <Redo2 className="w-4 h-4 shrink-0" />
          <span className="text-[11px] leading-none whitespace-nowrap">重做</span>
        </button>

        <button
          type="button"
          title="恢复当前模板初始结构"
          aria-label="重置模型"
          onClick={onResetPreset}
          className="w-full py-2 px-1 rounded-lg flex flex-col items-center justify-center gap-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <RotateCcw className="w-4 h-4 shrink-0" />
          <span className="text-[11px] leading-none whitespace-nowrap">重置</span>
        </button>
      </div>
    </aside>
  );
}
