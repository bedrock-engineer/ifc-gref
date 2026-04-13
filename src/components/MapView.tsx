import { useEffect, useRef } from 'react'
import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

/**
 * Plain maplibre-gl map component. Manages its own map instance in a ref,
 * tears it down on unmount, and reacts to `referencePoint` / `footprint`
 * changes by updating a marker and a GeoJSON polygon layer.
 *
 * The basemap is PDOK BRT-Achtergrondkaart raster tiles, the default Dutch
 * topographic basemap. Swap the source for OSM if working outside NL.
 */

export type MapViewProps = {
  referencePoint: { latitude: number; longitude: number } | null
  /** Convex-hull building footprint in [lng, lat] pairs (WGS84). */
  footprint: [number, number][] | null
}

const PDOK_BRT_TILES =
  'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png'

const FOOTPRINT_SOURCE_ID = 'ifc-footprint'
const FOOTPRINT_FILL_LAYER_ID = 'ifc-footprint-fill'
const FOOTPRINT_LINE_LAYER_ID = 'ifc-footprint-line'
const ACCENT_COLOR = '#0f766e' // teal, matches the marker

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'pdok-brt': {
      type: 'raster',
      tiles: [PDOK_BRT_TILES],
      tileSize: 256,
      attribution:
        'Kaartgegevens © <a href="https://www.kadaster.nl/">Kadaster</a>',
    },
  },
  layers: [
    {
      id: 'pdok-brt',
      type: 'raster',
      source: 'pdok-brt',
    },
  ],
}

export function MapView({ referencePoint, footprint }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markerRef = useRef<Marker | null>(null)

  // Initialize the map once.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: [5.291, 52.132], // Centre of the Netherlands
      zoom: 6,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    mapRef.current = map
    return () => {
      markerRef.current?.remove()
      markerRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // React to referencePoint / footprint changes. We defer work until the
  // style is loaded — calling addSource / flyTo before that races against
  // style load and the update can get dropped.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      // ----- marker -----
      if (referencePoint) {
        const lngLat: [number, number] = [
          referencePoint.longitude,
          referencePoint.latitude,
        ]
        if (markerRef.current) {
          markerRef.current.setLngLat(lngLat)
        } else {
          markerRef.current = new maplibregl.Marker({ color: ACCENT_COLOR })
            .setLngLat(lngLat)
            .addTo(map)
        }
      } else if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }

      // ----- footprint polygon -----
      const hasFootprint = footprint && footprint.length >= 3
      const existing = map.getSource(FOOTPRINT_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined

      if (hasFootprint) {
        // Close the ring for GeoJSON if needed.
        const ring = [...footprint]
        const [fx, fy] = ring[0]
        const [lx, ly] = ring[ring.length - 1]
        if (fx !== lx || fy !== ly) ring.push([fx, fy])

        const data: GeoJSON.Feature<GeoJSON.Polygon> = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [ring] },
        }

        if (existing) {
          existing.setData(data)
        } else {
          map.addSource(FOOTPRINT_SOURCE_ID, { type: 'geojson', data })
          map.addLayer({
            id: FOOTPRINT_FILL_LAYER_ID,
            type: 'fill',
            source: FOOTPRINT_SOURCE_ID,
            paint: {
              'fill-color': ACCENT_COLOR,
              'fill-opacity': 0.2,
            },
          })
          map.addLayer({
            id: FOOTPRINT_LINE_LAYER_ID,
            type: 'line',
            source: FOOTPRINT_SOURCE_ID,
            paint: {
              'line-color': ACCENT_COLOR,
              'line-width': 2,
            },
          })
        }
      } else if (existing) {
        if (map.getLayer(FOOTPRINT_FILL_LAYER_ID))
          map.removeLayer(FOOTPRINT_FILL_LAYER_ID)
        if (map.getLayer(FOOTPRINT_LINE_LAYER_ID))
          map.removeLayer(FOOTPRINT_LINE_LAYER_ID)
        map.removeSource(FOOTPRINT_SOURCE_ID)
      }

      // ----- camera -----
      if (hasFootprint) {
        const bounds = footprint.reduce(
          (b, pt) => b.extend(pt),
          new maplibregl.LngLatBounds(footprint[0], footprint[0]),
        )
        map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 19 })
      } else if (referencePoint) {
        map.jumpTo({
          center: [referencePoint.longitude, referencePoint.latitude],
          zoom: 17,
        })
      }
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
  }, [referencePoint, footprint])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
    />
  )
}
