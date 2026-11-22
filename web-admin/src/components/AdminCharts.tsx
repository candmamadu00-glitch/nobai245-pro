import React, { useState } from 'react';

export interface BarDatum {
  label: string;
  value: number;
  secondaryValue?: number;
  color?: string;
  secondaryColor?: string;
  formattedValue?: string;
  subtitle?: string;
}

export function BarComparisonChart({
  title,
  subtitle,
  data,
  primaryLabel = 'Principal',
  secondaryLabel,
  valueFormatter = (v) => v.toLocaleString('pt-BR'),
}: {
  title: string;
  subtitle?: string;
  data: BarDatum[];
  primaryLabel?: string;
  secondaryLabel?: string;
  valueFormatter?: (v: number) => string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxVal = Math.max(
    1,
    ...data.map((d) => Math.max(Number(d.value || 0), Number(d.secondaryValue || 0)))
  );

  return (
    <div className="modern-chart-card">
      <div className="modern-chart-header">
        <div>
          <h3 className="modern-chart-title">{title}</h3>
          {subtitle && <p className="modern-chart-subtitle">{subtitle}</p>}
        </div>
        {secondaryLabel && (
          <div className="modern-chart-legend">
            <span className="legend-dot-item">
              <i style={{ background: '#059669' }} /> {primaryLabel}
            </span>
            <span className="legend-dot-item">
              <i style={{ background: '#0284C7' }} /> {secondaryLabel}
            </span>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <div className="modern-chart-empty">Sem dados suficientes para exibir o gráfico.</div>
      ) : (
        <div className="modern-bar-chart-grid">
          {data.map((item, idx) => {
            const pct1 = Math.max(6, Math.round((Number(item.value || 0) / maxVal) * 100));
            const pct2 =
              item.secondaryValue !== undefined
                ? Math.max(6, Math.round((Number(item.secondaryValue || 0) / maxVal) * 100))
                : null;
            const isHovered = hoveredIdx === idx;

            return (
              <div
                key={`${item.label}-${idx}`}
                className={`modern-bar-col ${isHovered ? 'is-hovered' : ''}`}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <div className="modern-bar-value-tag">
                  {item.formattedValue || valueFormatter(item.value)}
                </div>
                <div className="modern-bar-track">
                  <div
                    className="modern-bar-fill"
                    style={{
                      height: `${pct1}%`,
                      background:
                        item.color ||
                        'linear-gradient(180deg, #10B981 0%, #059669 100%)',
                    }}
                    title={`${item.label}: ${valueFormatter(item.value)}`}
                  />
                  {pct2 !== null && (
                    <div
                      className="modern-bar-fill"
                      style={{
                        height: `${pct2}%`,
                        background:
                          item.secondaryColor ||
                          'linear-gradient(180deg, #38BDF8 0%, #0284C7 100%)',
                      }}
                      title={`${secondaryLabel}: ${valueFormatter(item.secondaryValue || 0)}`}
                    />
                  )}
                </div>
                <div className="modern-bar-label" title={item.label}>
                  {item.label}
                </div>
                {item.subtitle && <div className="modern-bar-sub">{item.subtitle}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function DonutDistributionChart({
  title,
  subtitle,
  segments,
  centerLabel = 'Total',
  centerValue,
}: {
  title: string;
  subtitle?: string;
  segments: DonutSegment[];
  centerLabel?: string;
  centerValue?: string | number;
}) {
  const total = segments.reduce((acc, s) => acc + Math.max(0, Number(s.value || 0)), 0);
  const safeTotal = total > 0 ? total : 1;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let cumulativePercent = 0;

  return (
    <div className="modern-chart-card">
      <div className="modern-chart-header">
        <div>
          <h3 className="modern-chart-title">{title}</h3>
          {subtitle && <p className="modern-chart-subtitle">{subtitle}</p>}
        </div>
      </div>

      <div className="modern-donut-layout">
        <div className="modern-donut-svg-wrap">
          <svg viewBox="0 0 140 140" className="modern-donut-svg">
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="transparent"
              stroke="#E2E8F0"
              strokeWidth="16"
            />
            {total > 0 &&
              segments.map((seg, idx) => {
                const val = Math.max(0, Number(seg.value || 0));
                if (val === 0) return null;
                const percent = val / safeTotal;
                const dashArray = `${percent * circumference} ${circumference}`;
                const dashOffset = -cumulativePercent * circumference;
                cumulativePercent += percent;

                return (
                  <circle
                    key={`${seg.label}-${idx}`}
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="transparent"
                    stroke={seg.color}
                    strokeWidth="16"
                    strokeDasharray={dashArray}
                    strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                    transform="rotate(-90 70 70)"
                    style={{ transition: 'stroke-dasharray 0.5s ease' }}
                  />
                );
              })}
          </svg>
          <div className="modern-donut-center">
            <span className="donut-center-val">
              {centerValue !== undefined ? centerValue : total.toLocaleString('pt-BR')}
            </span>
            <span className="donut-center-lbl">{centerLabel}</span>
          </div>
        </div>

        <div className="modern-donut-legend">
          {segments.map((seg, idx) => {
            const pct = total > 0 ? Math.round((Math.max(0, seg.value) / total) * 100) : 0;
            return (
              <div key={`${seg.label}-leg-${idx}`} className="donut-legend-row">
                <div className="donut-legend-left">
                  <span className="donut-swatch" style={{ backgroundColor: seg.color }} />
                  <span className="donut-legend-name">{seg.label}</span>
                </div>
                <div className="donut-legend-right">
                  <strong>{seg.value.toLocaleString('pt-BR')}</strong>
                  <span className="donut-pct">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
