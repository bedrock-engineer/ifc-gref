/**
 * Levels of Georeferencing (LoGeoRef) — defined by the Geonovum
 * "Georefereren GeoBIM Praktijkrichtlijn", chapter 03.
 *
 * The guide distinguishes six levels (10–60). For deciding which UI paths
 * are available we collapse them to three buckets, since the file shapes
 * we can read from web-ifc don't let us cleanly distinguish 20 vs 30 vs 40,
 * and the available survey modes are the same across that range:
 *
 *   - 'le10'  ≤ LoGeoRef 10  — no usable geo info
 *                              (no IfcSite RefLat/RefLon, no IfcMapConversion)
 *   - 'l20'   LoGeoRef 20–40 — partial info: IfcSite RefLat/RefLon present
 *                              but no IfcMapConversion
 *   - 'l50'   LoGeoRef 50    — IfcMapConversion present
 *
 * LoGeoRef 60 is "LoGeoRef 50 + surveyed control points". IFC has no
 * standardised way to record the surveyed points themselves, so we can't
 * detect 60 from a file — we treat 50+points as "you are at 50, your
 * workflow is producing a 60 transform".
 */


/** Levels of Georeferencing */
export type LoGeoref = "le10" | "l20" | "l50";
