import { Eye, EyeOff } from 'lucide-react';
import type { SwaySummary } from '../engine/swayAnalysis';

export interface SwayViewerCardProps {
  sway: SwaySummary;
  showSwayEnvelope: boolean;
  onToggleSwayEnvelope: () => void;
}

export function SwayViewerCard({
  sway,
  showSwayEnvelope,
  onToggleSwayEnvelope,
}: SwayViewerCardProps) {
  const width = 296;
  const height = 148;
  const padX = 34;
  const padTop = 26;
  const padBottom = 22;

  const { minX, maxX, minY, maxY, members, peakNodeBase, peakNodePlus, peakNodeMinus } =
    sway.elevation;

  // Compute safe bounding box including ±sway envelope so diagram never clips
  let bxMin = minX;
  let bxMax = maxX;
  let byMin = minY;
  let byMax = maxY;
  for (const m of members) {
    for (const pt of [...m.plus, ...m.minus, ...m.base]) {
      bxMin = Math.min(bxMin, pt.x);
      bxMax = Math.max(bxMax, pt.x);
      byMin = Math.min(byMin, pt.y);
      byMax = Math.max(byMax, pt.y);
    }
  }

  const spanX = Math.max(200, bxMax - bxMin);
  const spanY = Math.max(200, byMax - byMin);
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const contentW = spanX * scale;
  const contentH = spanY * scale;
  const offsetX = padX + (innerW - contentW) / 2;
  const offsetY = padTop + (innerH - contentH);

  const toSvg = (pt: { x: number; y: number }) => ({
    x: offsetX + (pt.x - bxMin) * scale,
    y: offsetY + contentH - (pt.y - byMin) * scale,
  });

  const groundY = offsetY + contentH - (minY - byMin) * scale;

  const accentStroke =
    sway.severity === 'severe' || sway.severity === 'unstable'
      ? '#DC2626'
      : sway.severity === 'moderate'
        ? '#D97706'
        : '#059669';

  const bandFill =
    sway.severity === 'severe' || sway.severity === 'unstable'
      ? '#EF4444'
      : sway.severity === 'moderate'
        ? '#F59E0B'
        : '#10B981';

  const badgeCls =
    sway.severity === 'severe' || sway.severity === 'unstable'
      ? 'text-red-700'
      : sway.severity === 'moderate'
        ? 'text-amber-700'
        : 'text-emerald-700';

  const toPolyline = (pts: { x: number; y: number }[]) =>
    pts
      .map((p) => {
        const s = toSvg(p);
        return `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
      })
      .join(' ');

  const peakBaseSvg = peakNodeBase ? toSvg(peakNodeBase) : null;
  const peakPlusSvg = peakNodePlus ? toSvg(peakNodePlus) : null;
  const peakMinusSvg = peakNodeMinus ? toSvg(peakNodeMinus) : null;

  // Non-linear scale position for the static 3-tier tolerance gauge (0..2mm = 0..35%, 2..5mm = 35..65%, 5..25mm+ = 65..100%)
  const gaugePct = !sway.isStable
    ? 100
    : sway.maxSwayMm <= 2
      ? (sway.maxSwayMm / 2) * 35
      : sway.maxSwayMm <= 5
        ? 35 + ((sway.maxSwayMm - 2) / 3) * 30
        : Math.min(100, 65 + ((sway.maxSwayMm - 5) / 20) * 35);

  return (
    <div className="space-y-2.5" aria-label="静态晃动查看器">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-[13px] font-semibold text-slate-900 truncate">静态晃动查看器</h3>
          <span className={`text-xs font-medium ${badgeCls}`}>{sway.severityLabel}</span>
        </div>
        <button
          type="button"
          aria-pressed={showSwayEnvelope}
          onClick={onToggleSwayEnvelope}
          className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap ${
            showSwayEnvelope
              ? 'bg-amber-50 border-amber-300 text-amber-800'
              : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
          }`}
        >
          {showSwayEnvelope ? (
            <Eye className="w-3 h-3" />
          ) : (
            <EyeOff className="w-3 h-3" />
          )}
          <span>3D包络 {showSwayEnvelope ? '开' : '关'}</span>
        </button>
      </div>

      {/* Static 2D Elevation ±Sway Envelope Diagram */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`静态正视晃动包络图：单向晃动 ${sway.maxSwayMm.toFixed(2)} mm`}
          className="block"
        >
          {/* Subtle elevation reference grid */}
          <line x1={12} y1={groundY} x2={width - 12} y2={groundY} stroke="#94A3B8" strokeWidth="1.2" />
          {Array.from({ length: 18 }).map((_, idx) => {
            const hx = 18 + idx * 15;
            return (
              <line
                key={idx}
                x1={hx}
                y1={groundY}
                x2={hx - 5}
                y2={groundY + 6}
                stroke="#CBD5E1"
                strokeWidth="1"
              />
            );
          })}

          {/* 1. Shaded ±Sway sweep bands on vertical columns */}
          {sway.isStable &&
            sway.maxSwayMm > 0.05 &&
            members
              .filter((m) => m.isColumn && m.plus.length >= 2)
              .map((m) => {
                const polyPts = [...m.plus, ...[...m.minus].reverse()];
                return (
                  <polygon
                    key={`band-${m.memberId}`}
                    points={toPolyline(polyPts)}
                    fill={bandFill}
                    fillOpacity="0.16"
                  />
                );
              })}

          {/* 2. Undeformed upright reference skeleton (dashed gray) */}
          {members.map((m) => (
            <polyline
              key={`base-${m.memberId}`}
              fill="none"
              stroke="#94A3B8"
              strokeWidth="1.25"
              strokeDasharray="3 3"
              points={toPolyline(m.base)}
            />
          ))}

          {/* 3. Symmetric reverse (-Δ) sway envelope (dashed amber) */}
          {sway.isStable &&
            sway.maxSwayMm > 0.05 &&
            members.map((m) => (
              <polyline
                key={`minus-${m.memberId}`}
                fill="none"
                stroke="#D97706"
                strokeOpacity="0.6"
                strokeWidth="1.35"
                strokeDasharray="4 2"
                points={toPolyline(m.minus)}
              />
            ))}

          {/* 4. Primary (+Δ) static swayed frame (solid accent) */}
          {sway.isStable &&
            members.map((m) => (
              <polyline
                key={`plus-${m.memberId}`}
                fill="none"
                stroke={accentStroke}
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={toPolyline(m.plus)}
              />
            ))}

          {/* 5. Peak sway horizontal dimension span callout */}
          {sway.isStable && peakBaseSvg && peakPlusSvg && peakMinusSvg && (
            <g>
              {sway.maxSwayMm > 0.05 && (
                <>
                  <line
                    x1={peakMinusSvg.x}
                    y1={Math.max(15, peakBaseSvg.y - 10)}
                    x2={peakPlusSvg.x}
                    y2={Math.max(15, peakBaseSvg.y - 10)}
                    stroke={accentStroke}
                    strokeWidth="1.4"
                  />
                  <line
                    x1={peakMinusSvg.x}
                    y1={Math.max(11, peakBaseSvg.y - 14)}
                    x2={peakMinusSvg.x}
                    y2={Math.max(19, peakBaseSvg.y - 6)}
                    stroke={accentStroke}
                    strokeWidth="1.4"
                  />
                  <line
                    x1={peakPlusSvg.x}
                    y1={Math.max(11, peakBaseSvg.y - 14)}
                    x2={peakPlusSvg.x}
                    y2={Math.max(19, peakBaseSvg.y - 6)}
                    stroke={accentStroke}
                    strokeWidth="1.4"
                  />
                </>
              )}
              <circle cx={peakBaseSvg.x} cy={peakBaseSvg.y} r="2.5" fill="#64748B" />
              <circle cx={peakPlusSvg.x} cy={peakPlusSvg.y} r="3.4" fill={accentStroke} />
              <text
                x={Math.min(width - 54, Math.max(54, peakBaseSvg.x))}
                y={Math.max(13, peakBaseSvg.y - 16)}
                textAnchor="middle"
                fill={accentStroke}
                stroke="#F8FAFC"
                strokeWidth="4"
                paintOrder="stroke"
                fontSize="10.5"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontWeight="700"
              >
                ±{sway.maxSwayMm.toFixed(2)} mm
              </text>
            </g>
          )}
        </svg>

        {/* Legend bar */}
        <div className="px-2.5 py-1.5 bg-white border-t border-slate-200/80 flex items-center justify-between text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 border-t border-dashed border-slate-400" />
            原位
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2 rounded-xs"
              style={{ backgroundColor: bandFill, opacity: 0.3 }}
            />
            ±晃动包络
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-3 border-t-2"
              style={{ borderColor: accentStroke }}
            />
            峰值侧移
          </span>
        </div>
      </div>

      {/* Static Sway Quantitative Readout Strip */}
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="px-2 py-1.5 bg-slate-50 border border-slate-200/80 rounded-md">
          <div className="text-[10px] text-slate-500">单向侧移</div>
          <div className={`text-xs font-mono tabular-nums font-semibold mt-0.5 ${badgeCls}`}>
            {sway.isStable ? `${sway.maxSwayMm.toFixed(2)}mm` : '失稳'}
          </div>
        </div>
        <div className="px-2 py-1.5 bg-slate-50 border border-slate-200/80 rounded-md">
          <div className="text-[10px] text-slate-500">立柱倾角</div>
          <div className="text-xs font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
            {sway.isStable ? `${sway.tiltAngleDeg.toFixed(2)}°` : '—'}
          </div>
        </div>
        <div className="px-2 py-1.5 bg-slate-50 border border-slate-200/80 rounded-md">
          <div className="text-[10px] text-slate-500">侧移比</div>
          <div className="text-xs font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
            {sway.isStable && sway.driftDenominator ? `H/${sway.driftDenominator}` : '极稳'}
          </div>
        </div>
      </div>

      {/* Static 3-Tier Tolerance Ruler */}
      <div className="space-y-1">
        <div className="relative h-2 rounded-full overflow-hidden flex bg-slate-200">
          <div className="h-full bg-emerald-500/80" style={{ width: '35%' }} />
          <div className="h-full bg-amber-400/85" style={{ width: '30%' }} />
          <div className="h-full bg-red-500/80" style={{ width: '35%' }} />
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-1 bg-slate-900"
            style={{ left: `calc(${gaugePct.toFixed(1)}% - 2px)` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500">
          <span>稳固 ≤2mm</span>
          <span>偏晃 2~5mm</span>
          <span>晃动大 &gt;5mm</span>
        </div>
      </div>
    </div>
  );
}
