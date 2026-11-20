import type { WorkspaceTab } from '../engine/types';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOpenExport: () => void;
}

const NAV_ITEMS: { id: WorkspaceTab; label: string }[] = [
  { id: 'draw', label: '结构画图' },
  { id: 'fea', label: '受力分析' },
  { id: 'optimize', label: '算法优化' },
  { id: 'bom', label: '物料清单' },
];

export function TopBar({ activeTab, onSelectTab, onOpenExport }: TopBarProps) {
  return (
    <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 z-20">
      {/* Zone 1: Single-element brand wordmark */}
      <button
        type="button"
        onClick={() => onSelectTab('draw')}
        className="flex items-baseline gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 rounded"
      >
        <span>型材工坊</span>
        <span className="text-sm font-semibold text-red-600">不要用，未成品</span>
      </button>

      {/* Zone 2: Clean single-line text navigation tabs */}
      <nav aria-label="工作区导航" className="flex items-center gap-6 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelectTab(item.id)}
              className={`relative h-14 px-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                isActive
                  ? 'text-blue-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-700"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Single primary action CTA */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onOpenExport}
          className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          导出方案
        </button>
      </div>
    </header>
  );
}
