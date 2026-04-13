import { ok, err, type Result } from 'neverthrow'
import type { UnitError } from './types'

/**
 * Length unit conversion. Maps IFC unit name strings to their conversion
 * factor in metres. Mirrors the unit_mapping table from the Flask app
 * (app.py:191-220) but as a hand-rolled lookup instead of pulling in pint.
 *
 * Both upper and lower case are accepted because real IFC files use both.
 */
const UNIT_TO_METRES: Record<string, number> = {
  METRE: 1,
  METER: 1,
  CENTIMETRE: 0.01,
  CENTIMETER: 0.01,
  MILLIMETRE: 0.001,
  MILLIMETER: 0.001,
  INCH: 0.0254,
  FOOT: 0.3048,
  YARD: 0.9144,
  MILE: 1609.344,
  NAUTICAL_MILE: 1852,
}

export function unitToMetres(name: string): Result<number, UnitError> {
  const value = UNIT_TO_METRES[name.toUpperCase()]
  if (value === undefined) {
    return err({ kind: 'unknown-unit', name })
  }
  return ok(value)
}
