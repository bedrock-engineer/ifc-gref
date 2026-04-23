import { Axis, Orient } from "d3-axis-for-react";
import { scaleLinear } from "d3-scale";
import { applyHelmert, type HelmertParams, type PointPair } from "../../../lib/helmert";

// Levenberg-Marquardt minimises Σᵢ ‖targetᵢ − f(localᵢ, params)‖². This chart
// surfaces the per-point residuals that make up that sum so the user can see
// whether the fit is tight, biased, or dominated by one outlier. Residuals
// are recomputed against the *current* params (not the fitted ones), so the
// chart stays meaningful when the user nudges the anchor or rotation after
// the solve.
interface Residual {
  index: number;
  dx: number;
  dy: number;
  dz: number;
  magnitudeXY: number;
}

function computeResiduals(
  points: Array<PointPair>,
  params: HelmertParams,
): Array<Residual> {
  return points.map((p, index) => {
    const predicted = applyHelmert(p.local, params);
    const dx = p.target.x - predicted.x;
    const dy = p.target.y - predicted.y;
    const dz = p.target.z - predicted.z;
    return { index, dx, dy, dz, magnitudeXY: Math.hypot(dx, dy) };
  });
}

// Symmetric domain around zero so the origin is always in the centre — makes
// bias (cluster offset) visually obvious.
function symmetricDomain(values: Array<number>): [number, number] {
  const max = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
  return [-max, max];
}

interface ResidualChartProps {
  points: Array<PointPair>;
  params: HelmertParams;
  /** Unit label for axis titles, e.g. "m" or "ft". */
  crsUnitShort: string;
}

export function ResidualChart({
  points,
  params,
  crsUnitShort,
}: ResidualChartProps) {
  const residuals = computeResiduals(points, params);
  if (residuals.length === 0) {
    return null;
  }

  const scatterSize = 180;
  const margin = { top: 8, right: 12, bottom: 28, left: 36 };
  const innerW = scatterSize;
  const innerH = scatterSize;

  const xDomain = symmetricDomain(residuals.map((r) => r.dx));
  const yDomain = symmetricDomain(residuals.map((r) => r.dy));
  // Shared square-ish domain so ΔX and ΔY are comparable at a glance.
  const shared = Math.max(xDomain[1], yDomain[1]);
  const xScale = scaleLinear().domain([-shared, shared]).range([0, innerW]).nice();
  const yScale = scaleLinear().domain([-shared, shared]).range([innerH, 0]).nice();

  // Z bars: stacked under the scatter, so they share width with it and only
  // need enough height to make magnitudes comparable.
  const zDomain = symmetricDomain(residuals.map((r) => r.dz));
  const zChartW = scatterSize;
  const zChartH = 60;
  const zScale = scaleLinear()
    .domain(zDomain)
    .range([zChartH, 0])
    .nice();

  let sumSqXY = 0;
  let sumSqZ = 0;
  let worst = residuals[0];
  for (const r of residuals) {
    sumSqXY += r.dx * r.dx + r.dy * r.dy;
    sumSqZ += r.dz * r.dz;
    if (!worst || r.magnitudeXY > worst.magnitudeXY) {
      worst = r;
    }
  }
  const rmsXY = Math.sqrt(sumSqXY / residuals.length);
  const rmsZ = Math.sqrt(sumSqZ / residuals.length);
  if (!worst) {
    return null;
  }

  const tickFormat = (v: number) => {
    const abs = Math.abs(v);
    if (abs === 0) {
      return "0";
    }
    if (abs >= 1) {
      return v.toFixed(2);
    }
    if (abs >= 0.01) {
      return v.toFixed(3);
    }
    return v.toExponential(1);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs text-slate-600">
        <span className="font-medium text-slate-700">Residuals</span>
        <span className="text-slate-500">
          {residuals.length} point{residuals.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {/* XY scatter */}
        <svg
          width={innerW + margin.left + margin.right}
          height={innerH + margin.top + margin.bottom}
          role="img"
          aria-label={`XY residual scatter, RMS ${rmsXY.toFixed(3)} ${crsUnitShort}`}
          className="shrink-0"
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            <rect
              width={innerW}
              height={innerH}
              fill="white"
              stroke="rgb(226 232 240)"
            />
            {/* Origin crosshair = zero residual */}
            <line
              x1={0}
              x2={innerW}
              y1={yScale(0)}
              y2={yScale(0)}
              stroke="rgb(148 163 184)"
              strokeDasharray="2 2"
            />
            <line
              x1={xScale(0)}
              x2={xScale(0)}
              y1={0}
              y2={innerH}
              stroke="rgb(148 163 184)"
              strokeDasharray="2 2"
            />

            {residuals.map((r) => (
              <g key={r.index}>
                <circle
                  cx={xScale(r.dx)}
                  cy={yScale(r.dy)}
                  r={r === worst ? 4 : 3}
                  fill={r === worst ? "rgb(220 38 38)" : "rgb(15 23 42)"}
                  fillOpacity={0.8}
                />
                <text
                  x={xScale(r.dx) + 5}
                  y={yScale(r.dy) - 5}
                  fontSize={9}
                  fill="rgb(71 85 105)"
                >
                  {r.index + 1}
                </text>
              </g>
            ))}

            <g transform={`translate(0,${innerH})`}>
              <Axis
                scale={xScale}
                orient={Orient.bottom}
                ticks={[5]}
                tickFormat={tickFormat}
                tickTextProps={{ fontSize: 9, fill: "rgb(71 85 105)" }}
                tickLineProps={{ stroke: "rgb(148 163 184)" }}
                domainPathProps={{ stroke: "rgb(148 163 184)" }}
              />
            </g>
            <g>
              <Axis
                scale={yScale}
                orient={Orient.left}
                ticks={[5]}
                tickFormat={tickFormat}
                tickTextProps={{ fontSize: 9, fill: "rgb(71 85 105)" }}
                tickLineProps={{ stroke: "rgb(148 163 184)" }}
                domainPathProps={{ stroke: "rgb(148 163 184)" }}
              />
            </g>

            <text
              x={innerW / 2}
              y={innerH + 24}
              textAnchor="middle"
              fontSize={10}
              fill="rgb(51 65 85)"
            >
              ΔX [{crsUnitShort}]
            </text>
            <text
              transform={`translate(-28,${innerH / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize={10}
              fill="rgb(51 65 85)"
            >
              ΔY [{crsUnitShort}]
            </text>
          </g>
        </svg>

        {/* Z residual bars — ΔZ per point, stacked under the scatter */}
        <svg
          width={zChartW + margin.left + margin.right}
          height={zChartH + margin.top + margin.bottom}
          role="img"
          aria-label={`Z residual bars, RMS ${rmsZ.toFixed(3)} ${crsUnitShort}`}
          className="shrink-0"
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            <rect
              width={zChartW}
              height={zChartH}
              fill="white"
              stroke="rgb(226 232 240)"
            />
            <line
              x1={0}
              x2={zChartW}
              y1={zScale(0)}
              y2={zScale(0)}
              stroke="rgb(148 163 184)"
            />
            {residuals.map((r, index) => {
              const bandW = zChartW / residuals.length;
              const x = index * bandW + bandW * 0.15;
              const w = bandW * 0.7;
              const zeroY = zScale(0);
              const valueY = zScale(r.dz);
              return (
                <rect
                  key={r.index}
                  x={x}
                  y={Math.min(zeroY, valueY)}
                  width={w}
                  height={Math.abs(valueY - zeroY)}
                  fill="rgb(15 23 42)"
                  fillOpacity={0.75}
                />
              );
            })}
            <g>
              <Axis
                scale={zScale}
                orient={Orient.left}
                ticks={[3]}
                tickFormat={tickFormat}
                tickTextProps={{ fontSize: 9, fill: "rgb(71 85 105)" }}
                tickLineProps={{ stroke: "rgb(148 163 184)" }}
                domainPathProps={{ stroke: "rgb(148 163 184)" }}
              />
            </g>
            <text
              x={zChartW / 2}
              y={zChartH + 22}
              textAnchor="middle"
              fontSize={10}
              fill="rgb(51 65 85)"
            >
              ΔZ per point [{crsUnitShort}]
            </text>
          </g>
        </svg>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-slate-500">RMS XY</dt>
        <dd className="text-right font-mono text-slate-900">
          {rmsXY.toFixed(3)} {crsUnitShort}
        </dd>
        <dt className="text-slate-500">RMS Z</dt>
        <dd className="text-right font-mono text-slate-900">
          {rmsZ.toFixed(3)} {crsUnitShort}
        </dd>
        <dt className="text-slate-500">Max XY</dt>
        <dd className="text-right font-mono text-slate-900">
          {worst.magnitudeXY.toFixed(3)} {crsUnitShort}
          <span className="ml-1 font-sans text-slate-500">
            (point {worst.index + 1})
          </span>
        </dd>
      </dl>
    </div>
  );
}
