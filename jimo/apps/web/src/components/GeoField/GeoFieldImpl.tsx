import React, { useState, useEffect } from 'react';
import { Typography } from 'antd';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
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
const DEFAULT_ZOOM = 12;

export interface GeoFieldProps {
  value?: string;
  onChange?: (v: string) => void;
  mode: 'picker' | 'preview';
  height?: number;
  disabled?: boolean;
}

function parsePointLocal(v?: string): [number, number] | null {
  try {
    const g = JSON.parse(v || '');
    if (g?.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
      return [g.coordinates[1], g.coordinates[0]];
    }
  } catch {
    // ignore
  }
  return null;
}

function ClickHandler({ onMapClick }: { onMapClick: (latlng: { lat: number; lng: number }) => void }) {
  useMapEvents({ click: (e: any) => onMapClick(e.latlng) });
  return null;
}

export default function GeoFieldImpl({ value, onChange, mode, height, disabled = false }: GeoFieldProps) {
  const defaultHeight = mode === 'picker' ? 300 : 120;
  const mapHeight = height ?? defaultHeight;
  const [position, setPosition] = useState<[number, number] | null>(() => parsePointLocal(value));

  useEffect(() => {
    setPosition(parsePointLocal(value));
  }, [value]);

  const center: [number, number] = position ?? DEFAULT_CENTER;

  function handleMapClick(latlng: { lat: number; lng: number }) {
    if (disabled) return;
    const newPos: [number, number] = [latlng.lat, latlng.lng];
    setPosition(newPos);
    onChange?.(JSON.stringify({ type: 'Point', coordinates: [latlng.lng, latlng.lat] }));
  }

  function handleDragEnd(e: any) {
    if (disabled) return;
    handleMapClick(e.target.getLatLng());
  }

  if (mode === 'preview') {
    if (!position) {
      return (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          未设置位置
        </Typography.Text>
      );
    }
    return (
      <div style={{ height: mapHeight, width: '100%', borderRadius: 4, overflow: 'hidden' }}>
        <MapContainer
          center={position}
          zoom={DEFAULT_ZOOM}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
          dragging={false}
          zoomControl={false}
          attributionControl={false}
          doubleClickZoom={false}
          keyboard={false}
        >
          <TileLayer url={OSM_TILE} attribution={OSM_ATTRIBUTION} />
          <Marker position={position} />
        </MapContainer>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          height: mapHeight,
          width: '100%',
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid #d9d9d9',
          cursor: disabled ? 'not-allowed' : 'crosshair',
        }}
      >
        <MapContainer
          center={center}
          zoom={DEFAULT_ZOOM}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={!disabled}
        >
          <TileLayer url={OSM_TILE} attribution={OSM_ATTRIBUTION} />
          {!disabled && <ClickHandler onMapClick={handleMapClick} />}
          {position && (
            <Marker
              position={position}
              draggable={!disabled}
              eventHandlers={{ dragend: handleDragEnd }}
            />
          )}
        </MapContainer>
      </div>
      {position && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          {position[0].toFixed(6)}, {position[1].toFixed(6)}
        </Typography.Text>
      )}
    </div>
  );
}
