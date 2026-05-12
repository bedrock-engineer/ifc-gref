/**
 * Post-save HEADER stamping. We overwrite FILE_NAME's `preprocessor_version`
 * slot (index 4 per ISO 10303-21) so the saved file carries a record of
 * which tool wrote these bytes — leaving `originating_system` (slot 5)
 * intact so the original authoring CAD is preserved.
 *
 * web-ifc exposes `WriteHeaderLine` but it appends rather than replaces, so
 * we can't reach for it without producing a duplicate FILE_NAME line that
 * downstream parsers would choke on. Instead we surgically patch the
 * serialised STEP bytes after `SaveModelToCallback`. The HEADER is always at
 * the start of the file and tiny, so a 16 KB slice is more than enough.
 */

import { emitLog } from "#lib/log";

export const ATTRIBUTION =
  "IFC Georeferencer by Bedrock.engineer for buildingSMART Netherlands";

const HEAD_BYTES = 16 * 1024;

interface ArgRange {
  start: number;
  end: number;
}

/**
 * Find the byte range of FILE_NAME's 5th positional argument
 * (preprocessor_version), trimmed of surrounding whitespace. Returns null
 * if FILE_NAME isn't found within the head slice or has fewer than 5 args.
 */
function findPreprocessorRange(head: string): ArgRange | null {
  const match = /FILE_NAME\s*\(/i.exec(head);
  if (!match) return null;

  const ranges: ArgRange[] = [];
  let argStart = match.index + match[0].length;
  let depth = 0;
  let inStr = false;
  let closed = false;

  for (let i = argStart; i < head.length; i++) {
    const c = head.charAt(i);
    if (inStr) {
      if (c === "'") {
        // `''` is an escaped single quote inside a STEP string.
        if (head.charAt(i + 1) === "'") {
          i++;
          continue;
        }
        inStr = false;
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      continue;
    }
    if (c === "(") {
      depth++;
      continue;
    }
    if (c === ")") {
      if (depth === 0) {
        ranges.push({ start: argStart, end: i });
        closed = true;
        break;
      }
      depth--;
      continue;
    }
    if (c === "," && depth === 0) {
      ranges.push({ start: argStart, end: i });
      argStart = i + 1;
    }
  }

  if (!closed) return null;
  const raw = ranges[4];
  if (!raw) return null;

  let s = raw.start;
  let e = raw.end;
  while (s < e && /\s/.test(head.charAt(s))) s++;
  while (e > s && /\s/.test(head.charAt(e - 1))) e--;
  return { start: s, end: e };
}

/**
 * Replace FILE_NAME.preprocessor_version with our attribution. No-op if
 * the field already holds the exact string (idempotent on round-trip).
 */
export async function stampHeaderPreprocessor(blob: Blob): Promise<Blob> {
  const headBuf = await blob.slice(0, HEAD_BYTES).arrayBuffer();
  const headBytes = new Uint8Array(headBuf);
  // Latin-1 gives a 1:1 byte↔char mapping. STEP HEADER is ASCII by spec, so
  // the decode is lossless and char indices line up with byte offsets — we
  // can splice bytes back without worrying about multi-byte boundaries.
  const head = new TextDecoder("iso-8859-1").decode(headBytes);

  const range = findPreprocessorRange(head);
  if (!range) return blob;

  const escaped = ATTRIBUTION.replace(/'/g, "''");
  const replacement = `'${escaped}'`;
  if (head.slice(range.start, range.end) === replacement) {
    return blob;
  }

  const replacementBytes = new TextEncoder().encode(replacement);
  const before = headBytes.slice(0, range.start);
  const after = headBytes.slice(range.end);
  const tail = blob.slice(HEAD_BYTES);
  const stamped = new Blob([before, replacementBytes, after, tail], {
    type: blob.type,
  });

  emitLog({
    source: "worker",
    message: `Stamped FILE_NAME preprocessor_version: ${ATTRIBUTION}`,
  });

  return stamped;
}
