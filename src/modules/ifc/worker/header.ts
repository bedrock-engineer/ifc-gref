/**
 * Post-save HEADER stamping. Overwrites FILE_NAME's `preprocessor_version`
 * slot (index 4 per ISO 10303-21) in the serialised STEP bytes, leaving
 * every other slot byte-identical so the original authoring tool stamp and
 * any vendor-specific escaping are preserved.
 *
 * Why not web-ifc: `wasmModule.WriteHeaderLine` *appends* a second
 * FILE_NAME line (probed 2026-05; see scripts/probe-write-header-line.mjs)
 * and its serialiser also rewrites backslashes, so even a
 * GetHeaderLine → reserialise round-trip would silently mutate unchanged
 * slots. We splice bytes instead. The STEP HEADER lives at the file start
 * and is tiny — 16 KB is plenty.
 */

const HEAD_BYTES = 16 * 1024;

interface ArgumentRange {
  start: number;
  end: number;
}

/**
 * Yields the byte range of each top-level argument inside a STEP entity's
 * `(...)` call, starting at `from` (just past the opening paren) and
 * stopping at the matching close paren. Handles STEP string literals
 * (`'...'` with `''` as escaped quote) and nested parens (the list args
 * `author` / `organization` in FILE_NAME).
 */
function* splitTopLevelArguments(
  s: string,
  from: number,
): Generator<ArgumentRange> {
  let start = from;
  let depth = 0;
  let inString = false;

  for (let index = from; index < s.length; index++) {
    const c = s.charAt(index);
    if (inString) {
      if (c === "'") {
        if (s.charAt(index + 1) === "'") {
          index++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (c === "'") {
      inString = true;
      continue;
    }
    if (c === "(") {
      depth++;
      continue;
    }
    if (c === ")") {
      if (depth === 0) {
        yield { start, end: index };
        return;
      }
      depth--;
      continue;
    }
    if (c === "," && depth === 0) {
      yield { start, end: index };
      start = index + 1;
    }
  }
}

function trimWhitespace(s: string, range: ArgumentRange): ArgumentRange {
  let { start, end } = range;
  while (start < end && /\s/.test(s.charAt(start))) {
    start++;
  }
  while (end > start && /\s/.test(s.charAt(end - 1))) {
    end--;
  }
  return { start, end };
}

function findPreprocessorRange(head: string): ArgumentRange | null {
  const match = /FILE_NAME\s*\(/i.exec(head);
  if (!match) {
    return null;
  }
  const argumentsStart = match.index + match[0].length;
  const arguments_ = [...splitTopLevelArguments(head, argumentsStart)];
  return arguments_[4] ? trimWhitespace(head, arguments_[4]) : null;
}

const ATTRIBUTION =
  "IFC Georeferencer by Bedrock.engineer for buildingSMART Netherlands";

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
  if (!range) {
    return blob;
  }

  const escaped = ATTRIBUTION.replaceAll("'", "''");
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

  return stamped;
}
