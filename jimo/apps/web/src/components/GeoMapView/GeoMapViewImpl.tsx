import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// eslint-disable-next-line @typescript-eslint/no-var-requires
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const OSM_TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const DEFAULT_CENTER: [number, number] = [39.9093, 116.3974];
const DEFAULT_ZOOM = 10;

export interface GeoMapPoint {
  position: [number, number];
  title?: string;
  fields?: Array<{ label: string; value: string }>;
}

function BoundsUpdater({ points }: { points: GeoMapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0].position, 14);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => p.position));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, points]);
  return null;
}

export default function GeoMapViewImpl({
  points,
  height = 600,
}: {
  points: GeoMapPoint[];
  height?: number | string;
}) {
  return (
    <MapContainer
      center={points[0]?.position ?? DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      style={{ height, width: '100%' }}
      scrollWheelZoom
    >
      <TileLayer url={OSM_TILE} attribution={OSM_ATTRIBUTION} />
      <BoundsUpdater points={points} />
      {points.map((p, i) => (
        <Marker key={i} position={p.position}>
          {(p.title || (p.fields && p.fields.length > 0)) && (
            <Popup>
              <div style={{ minWidth: 160 }}>
                {p.title && (
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{p.title}</div>
                )}
                {p.fields?.map((f) => (
                  <div key={f.label} style={{ fontSize: 12, marginBottom: 2 }}>
                    <span style={{ color: '#666' }}>{f.label}：</span>
                    <span>{f.value}</span>
                  </div>
                ))}
              </div>
            </Popup>
          )}
        </Marker>
      ))}
    </MapContainer>
  );
}
