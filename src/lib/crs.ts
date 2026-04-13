import proj4 from 'proj4'
import { ResultAsync, errAsync, okAsync } from 'neverthrow'
import type { CrsError } from './types'

/**
 * proj4js wrapper. Looks up EPSG codes from epsg.io on demand and caches
 * them in memory for the session. Validates that the result is a projected
 * CRS, since proj4js has no `is_projected` equivalent.
 *
 * See CLAUDE.md "CRS Limitations (proj4js vs pyproj)" for the full context.
 */

export type CrsDef = {
  code: number
  proj4: string
  /** Set after the definition is registered with proj4 */
  registered: boolean
}

const cache = new Map<number, CrsDef>()

export function lookupCrs(code: number): ResultAsync<CrsDef, CrsError> {
  const cached = cache.get(code)
  if (cached) return okAsync(cached)

  return ResultAsync.fromPromise(
    fetch(`https://epsg.io/${code}.proj4`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.text()
    }),
    (cause): CrsError => ({ kind: 'fetch-failed', code, cause }),
  ).andThen((proj4Def) => {
    const trimmed = proj4Def.trim()
    if (trimmed.length === 0) {
      return errAsync({ kind: 'not-found', code } as const)
    }
    if (trimmed.includes('+proj=longlat')) {
      return errAsync({ kind: 'not-projected', code } as const)
    }
    try {
      proj4.defs(`EPSG:${code}`, trimmed)
    } catch (_e) {
      return errAsync({ kind: 'invalid-definition', code } as const)
    }
    const def: CrsDef = { code, proj4: trimmed, registered: true }
    cache.set(code, def)
    return okAsync(def)
  })
}

export function transformWgs84ToProjected(
  code: number,
  longitude: number,
  latitude: number,
  elevation: number,
): { x: number; y: number; z: number } {
  const [x, y] = proj4('EPSG:4326', `EPSG:${code}`, [longitude, latitude])
  return { x, y, z: elevation }
}

/**
 * Reverse: projected CRS -> WGS84 lat/lon. The CRS must have been
 * registered first via lookupCrs.
 */
export function transformProjectedToWgs84(
  code: number,
  x: number,
  y: number,
): { longitude: number; latitude: number } {
  const [longitude, latitude] = proj4(`EPSG:${code}`, 'EPSG:4326', [x, y])
  return { longitude, latitude }
}

/**
 * Pulls the numeric EPSG code out of strings like "EPSG:28992", "epsg:4326",
 * or just "28992". Returns null if no integer is found.
 */
export function parseEpsgCode(name: string | null | undefined): number | null {
  if (!name) return null
  const m = name.match(/(\d+)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}
