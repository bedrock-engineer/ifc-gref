import {
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableHeader,
} from "react-aria-components";
import {
  computeResiduals,
  type HelmertParams,
  type PointPair,
  summarizeResiduals,
} from "#modules/helmert/solve";

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
  const residuals = computeResiduals(points, params);
  const summary = summarizeResiduals(residuals);
  if (!summary) {
    return null;
  }

  // Only flag the worst point when it's a meaningful outlier — otherwise
  // every fit, even a perfect one with mm residuals, gets one row painted
  // red, which trains users to ignore the colour. Two conditions: at least
  // 2× the RMS XY (genuine outlier rather than uniform noise) AND above an
  // absolute 1 cm floor (mm-level fits stay clean even when the spread of
  // residuals happens to be uneven).
  const hasMeaningfulOutlier =
    summary.worstMagnitudeXY > 2 * summary.rmsXY &&
    summary.worstMagnitudeXY > 0.01;

  const rows: Array<RowResidual> = residuals.map((r, index) => ({
    ...r,
    id: `p${index}`,
    index,
    isWorst: hasMeaningfulOutlier && index === summary.worstIndex,
  }));

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
        <dd className="text-right font-mono text-slate-900">
          {fmt(summary.rmsXY)}
        </dd>
        <dt className="text-slate-500">RMS Z</dt>
        <dd className="text-right font-mono text-slate-900">
          {fmt(summary.rmsZ)}
        </dd>
        <dt className="text-slate-500">Max XY</dt>
        <dd className="text-right font-mono text-slate-900">
          {fmt(summary.worstMagnitudeXY)}
          <span className="ml-1 font-sans text-slate-500">
            (point {summary.worstIndex + 1})
          </span>
        </dd>
      </dl>
    </div>
  );
}
