/**
 * User-supplied XYZ raster basemap: validation, identity, persistence.
 *
 * Validation is intentionally minimal — we can't actually fetch a tile
 * here without burning real network and CORS budget, so we check the
 * shape of the template and let MapLibre surface tile-fetch failures
 * via the console. The error kinds match what the popover renders, so
 * keep them user-friendly.
 */

import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

export const CustomBasemapSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string(),
});

export const CustomBasemapsSchema = z.array(CustomBasemapSchema);

export type CustomBasemap = z.infer<typeof CustomBasemapSchema>;

export const CUSTOM_BASEMAPS_STORAGE_KEY = "ifcgref:custom-basemaps:v1";

export type CustomBasemapUrlError =
  | { kind: "empty" }
  | { kind: "not-url" }
  | { kind: "not-http" }
  | {
      kind: "missing-placeholders";
      missing: ReadonlyArray<"{z}" | "{x}" | "{y}">;
    };

const REQUIRED_PLACEHOLDERS = ["{z}", "{x}", "{y}"] as const;

export function parseCustomBasemapUrl(
  input: string,
): Result<string, CustomBasemapUrlError> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return err({ kind: "empty" });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return err({ kind: "not-url" });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return err({ kind: "not-http" });
  }

  const missing = REQUIRED_PLACEHOLDERS.filter((p) => !trimmed.includes(p));
  if (missing.length > 0) {
    return err({ kind: "missing-placeholders", missing });
  }

  return ok(trimmed);
}

export function describeCustomBasemapUrlError(
  error: CustomBasemapUrlError,
): string {
  switch (error.kind) {
    case "empty": {
      return "Enter a tile URL.";
    }
    case "not-url": {
      return "Not a valid URL.";
    }
    case "not-http": {
      return "URL must start with http:// or https://.";
    }
    case "missing-placeholders": {
      return `Missing placeholder${error.missing.length === 1 ? "" : "s"}: ${error.missing.join(", ")}. XYZ tiles need {z}, {x} and {y}.`;
    }
  }
}
