import React, { Suspense, lazy } from 'react';
import { Spin } from 'antd';

const GeoMapViewImpl = lazy(() => import('./GeoMapViewImpl'));

export interface GeoMapPoint {
  position: [number, number];
  title?: string;
  fields?: Array<{ label: string; value: string }>;
}

export function parsePoint(v?: string): [number, number] | null {
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

export default function GeoMapView({
  points,
  height = 600,
}: {
  points: GeoMapPoint[];
  height?: number | string;
}) {
  if (typeof window === 'undefined') return null;
  return (
    <Suspense fallback={<Spin style={{ display: 'block', margin: '40px auto' }} />}>
      <GeoMapViewImpl points={points} height={height} />
    </Suspense>
  );
}
