/**
 * Format a byte count as a human-readable string ("524.3 MB", "1.2 GB").
 * Uses decimal (SI) units — same basis as Intl.NumberFormat's "unit" style
 * and what macOS/most web surfaces display.
 */
export function formatBytes(bytes: number): string {
  let unit: "byte" | "kilobyte" | "megabyte" | "gigabyte";
  let value: number;
  
  if (bytes >= 1e9) {
    unit = "gigabyte";
    value = bytes / 1e9;
  } else if (bytes >= 1e6) {
    unit = "megabyte";
    value = bytes / 1e6;
  } else if (bytes >= 1e3) {
    unit = "kilobyte";
    value = bytes / 1e3;
  } else {
    unit = "byte";
    value = bytes;
  }
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: unit === "byte" ? 0 : 1,
  }).format(value);
}
