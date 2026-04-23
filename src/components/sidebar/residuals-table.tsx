import {
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableHeader,
} from "react-aria-components";
import {
  applyHelmert,
  type HelmertParams,
  type PointPair,
} from "../../lib/helmert";

function fmt(value: number): string {
  return value.toFixed(3);
}

// Per-point residuals in tabular form — the shape engineers expect in survey
// reports. Complements the on-map arrow view: arrows show *where* the misfit
// is, this table shows *exactly how much* per component.
interface ResidualsTableProps {
  points: Array<PointPair>;
  params: HelmertParams;
  /** Unit label for the numeric columns, e.g. "m" or "ft". */
  crsUnitShort: string;
}

interface RowResidual {
  id: string;
  index: number;
  dx: number;
  dy: number;
  dz: number;
  magnitudeXY: number;
  isWorst: boolean;
}

export function ResidualsTable({
  points,
  params,
  crsUnitShort,
}: ResidualsTableProps) {
  const computed: Array<Omit<RowResidual, "isWorst">> = points.map(
    (p, index) => {
      const predicted = applyHelmert(p.local, params);
      const dx = p.target.x - predicted.x;
      const dy = p.target.y - predicted.y;
      const dz = p.target.z - predicted.z;
      return {
        id: `p${index}`,
        index,
        dx,
        dy,
        dz,
        magnitudeXY: Math.hypot(dx, dy),
      };
    },
  );

  let sumSqXY = 0;
  let sumSqZ = 0;
  let worstIndex = 0;
  let worstMagnitude = -1;
  for (const r of computed) {
    sumSqXY += r.dx * r.dx + r.dy * r.dy;
    sumSqZ += r.dz * r.dz;
    if (r.magnitudeXY > worstMagnitude) {
      worstMagnitude = r.magnitudeXY;
      worstIndex = r.index;
    }
  }
  if (computed.length === 0) {
    return null;
  }

  const rows: Array<RowResidual> = computed.map((r) => ({
    ...r,
    isWorst: r.index === worstIndex,
  }));
  const rmsXY = Math.sqrt(sumSqXY / rows.length);
  const rmsZ = Math.sqrt(sumSqZ / rows.length);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs text-slate-600">
        <span className="font-medium text-slate-700">Residuals</span>
        <span className="text-slate-500">all values in {crsUnitShort}</span>
      </div>

      <Table
        aria-label="Per-point residuals"
        className="w-full border-collapse text-xs"
      >
        <TableHeader>
          <Column
            id="point"
            isRowHeader
            className="py-1 text-left text-xs font-medium text-slate-500"
          >
            Point
          </Column>
          <Column
            id="dx"
            className="py-1 text-right text-xs font-medium text-slate-500"
          >
            ΔX
          </Column>
          <Column
            id="dy"
            className="py-1 text-right text-xs font-medium text-slate-500"
          >
            ΔY
          </Column>
          <Column
            id="dz"
            className="py-1 text-right text-xs font-medium text-slate-500"
          >
            ΔZ
          </Column>
          <Column
            id="mag"
            className="py-1 text-right text-xs font-medium text-slate-500"
          >
            |r| XY
          </Column>
        </TableHeader>
        <TableBody items={rows}>
          {(row) => (
            <Row
              className={
                row.isWorst
                  ? "border-t border-slate-200 bg-red-50"
                  : "border-t border-slate-200"
              }
            >
              <Cell className="py-1 pr-2 text-left font-medium text-slate-700">
                {row.index + 1}
              </Cell>
              <Cell className="py-1 text-right font-mono text-slate-900">
                {fmt(row.dx)}
              </Cell>
              <Cell className="py-1 text-right font-mono text-slate-900">
                {fmt(row.dy)}
              </Cell>
              <Cell className="py-1 text-right font-mono text-slate-900">
                {fmt(row.dz)}
              </Cell>
              <Cell className="py-1 text-right font-mono text-slate-900">
                {fmt(row.magnitudeXY)}
              </Cell>
            </Row>
          )}
        </TableBody>
      </Table>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t-2 border-slate-300 pt-1 text-xs">
        <dt className="text-slate-500">RMS XY</dt>
        <dd className="text-right font-mono text-slate-900">{fmt(rmsXY)}</dd>
        <dt className="text-slate-500">RMS Z</dt>
        <dd className="text-right font-mono text-slate-900">{fmt(rmsZ)}</dd>
        <dt className="text-slate-500">Max XY</dt>
        <dd className="text-right font-mono text-slate-900">
          {fmt(worstMagnitude)}
          <span className="ml-1 font-sans text-slate-500">
            (point {worstIndex + 1})
          </span>
        </dd>
      </dl>
    </div>
  );
}
