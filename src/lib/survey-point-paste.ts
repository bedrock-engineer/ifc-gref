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

function tokenize(line: string): Array<string> {
  return line.split(/[\t,;]|\s+/).filter((t) => t.length > 0);
}

function isNumericLine(line: string): boolean {
  const tokens = tokenize(line);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.every((t) => Number.isFinite(Number(t)));
}

export function parseSurveyPointPaste(
  raw: string,
): Result<PasteParseSuccess, PasteParseError> {
  const lines = raw
    .split(/\r?\n/)
    .map((line, index) => ({
      lineNumber: index + 1,
      raw: line,
      trimmed: line.trim(),
    }))
    .filter((l) => l.trimmed.length > 0);

  if (lines.length === 0) {
    return err({ kind: "empty", issues: [] });
  }

  const [firstLine] = lines;
  const skippedHeader =
    firstLine !== undefined && !isNumericLine(firstLine.trimmed);
  const dataLines = skippedHeader ? lines.slice(1) : lines;

  if (dataLines.length === 0) {
    return err({ kind: "empty", issues: [] });
  }

  const rows: Array<ParsedPointRow> = [];
  const issues: Array<RowIssue> = [];

  for (const { lineNumber, raw: rawLine, trimmed } of dataLines) {
    const tokens = tokenize(trimmed);

    if (tokens.length !== EXPECTED_COLS) {
      issues.push({
        lineNumber,
        rawLine,
        reason: `expected ${EXPECTED_COLS} values, got ${tokens.length}`,
      });
      continue;
    }

    const numeric = tokens.map(Number);
    const firstBadIndex = numeric.findIndex((n) => !Number.isFinite(n));
    if (firstBadIndex !== -1) {
      const badToken = tokens[firstBadIndex] ?? "?";
      issues.push({
        lineNumber,
        rawLine,
        reason: `'${badToken}' is not a number — decimal separator must be '.'`,
      });
      continue;
    }

    const [lx = 0, ly = 0, lz = 0, tx = 0, ty = 0, tz = 0] = numeric;
    rows.push({
      localX: lx,
      localY: ly,
      localZ: lz,
      targetX: tx,
      targetY: ty,
      targetZ: tz,
    });
  }

  if (rows.length === 0) {
    return err({ kind: "all-rows-invalid", issues });
  }

  return ok({ rows, issues, skippedHeader });
}
