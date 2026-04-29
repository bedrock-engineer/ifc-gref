import { dsvFormat } from "d3-dsv";
import { err, ok, type Result } from "neverthrow";

/**
 * Bulk paste parser for survey point rows. Accepts clipboard text from
 * Excel (tab-separated), CSV, semicolon-CSV, or whitespace-delimited
 * sources. Every data row must yield exactly six numeric tokens in the
 * order shown on screen: engineering X/Y/Z, then projected X/Y/Z.
 *
 * A first line that contains any non-numeric token is treated as a
 * header and silently dropped — this covers the usual spreadsheet
 * `localX,localY,localZ,targetX,targetY,targetZ` banner. Everything
 * else must be strictly numeric; decimal commas are rejected because
 * we can't distinguish them from the delimiter without guessing locale.
 *
 * Uses d3-dsv for tab/comma/semicolon-separated input (handles quoted
 * fields, mixed line endings, trailing whitespace). Falls through to a
 * plain whitespace split when the paste has no explicit delimiter.
 */
export interface ParsedPointRow {
  localX: number;
  localY: number;
  localZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export interface RowIssue {
  lineNumber: number;
  rawLine: string;
  reason: string;
}

export interface PasteParseSuccess {
  rows: Array<ParsedPointRow>;
  issues: Array<RowIssue>;
  skippedHeader: boolean;
}

export interface PasteParseError {
  kind: "empty" | "all-rows-invalid";
  issues: Array<RowIssue>;
}

const EXPECTED_COLS = 6;

/**
 * Pick a single-character delimiter for the whole paste, or null when no
 * tab/semicolon/comma appears anywhere and we should fall back to
 * whitespace splitting. Priority tab > semicolon > comma mirrors "Excel
 * copy-paste first, then European CSV, then US CSV" — the common case.
 */
function detectDelimiter(text: string): "\t" | ";" | "," | null {
  if (text.includes("\t")) {
    return "\t";
  }
  if (text.includes(";")) {
    return ";";
  }
  if (text.includes(",")) {
    return ",";
  }
  return null;
}

function splitWhitespaceRows(text: string): Array<Array<string>> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/));
}

function tokenizeAll(text: string): Array<Array<string>> {
  const delimiter = detectDelimiter(text);
  if (delimiter === null) {
    return splitWhitespaceRows(text);
  }
  // d3-dsv preserves empty trailing fields and respects quoted fields
  // (e.g. "1,234","2,345" in a CSV with decimal commas would still land
  // as two fields). Trim each cell so "1.0 " and "1.0" parse identically.
  return dsvFormat(delimiter)
    .parseRows(text)
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));
}

function isNumericRow(row: Array<string>): boolean {
  if (row.length === 0) {
    return false;
  }
  return row.every((t) => t.length > 0 && Number.isFinite(Number(t)));
}

export function parseSurveyPointPaste(
  raw: string,
): Result<PasteParseSuccess, PasteParseError> {
  const rows = tokenizeAll(raw);
  if (rows.length === 0) {
    return err({ kind: "empty", issues: [] });
  }

  const [firstRow] = rows;
  const skippedHeader = firstRow !== undefined && !isNumericRow(firstRow);
  const dataRows = skippedHeader ? rows.slice(1) : rows;

  if (dataRows.length === 0) {
    return err({ kind: "empty", issues: [] });
  }

  const parsedRows: Array<ParsedPointRow> = [];
  const issues: Array<RowIssue> = [];
  // d3-dsv strips the original line so we can't recover "the full raw line"
  // per row. Reconstruct something close by joining the cells with a tab —
  // the user sees the fields that were parsed, which is what matters for
  // the "line N — reason" error message.
  for (const [index, row] of dataRows.entries()) {
    const lineNumber = skippedHeader ? index + 2 : index + 1;
    const rawLine = row.join("\t");

    if (row.length !== EXPECTED_COLS) {
      issues.push({
        lineNumber,
        rawLine,
        reason: `expected ${EXPECTED_COLS} values, got ${row.length}`,
      });
      continue;
    }

    const numeric = row.map(Number);
    const firstBadIndex = numeric.findIndex((n) => !Number.isFinite(n));
    if (firstBadIndex !== -1) {
      const badToken = row[firstBadIndex] ?? "?";
      issues.push({
        lineNumber,
        rawLine,
        reason: `'${badToken}' is not a number — decimal separator must be '.'`,
      });
      continue;
    }

    const [lx = 0, ly = 0, lz = 0, tx = 0, ty = 0, tz = 0] = numeric;
    parsedRows.push({
      localX: lx,
      localY: ly,
      localZ: lz,
      targetX: tx,
      targetY: ty,
      targetZ: tz,
    });
  }

  if (parsedRows.length === 0) {
    return err({ kind: "all-rows-invalid", issues });
  }

  return ok({ rows: parsedRows, issues, skippedHeader });
}
