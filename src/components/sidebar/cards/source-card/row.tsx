interface RowProps {
  label: string;
  value: string;
  /**
   * Allow the value to wrap across lines instead of truncating with an
   * ellipsis. Default false — most rows hold short values (coords, EPSG
   * codes, unit names) and a clean single-line layout is preferable.
   * Opt in for free-form text like `Description`.
   */
  wrap?: boolean;
}

export function Row({ label, value, wrap = false }: RowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>

      <dd
        className={`font-mono text-slate-900 ${wrap ? "wrap-break-word text-right" : "truncate"}`}
      >
        {value}
      </dd>
    </div>
  );
}
