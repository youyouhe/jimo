import React, { Suspense, lazy } from 'react';

const GeoFieldImpl = lazy(() => import('./GeoFieldImpl'));

export interface GeoFieldProps {
  value?: string;
  onChange?: (v: string) => void;
  mode: 'picker' | 'preview';
  height?: number;
  disabled?: boolean;
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

export default function GeoField(props: GeoFieldProps) {
  if (typeof window === 'undefined') return null;
  return (
    <Suspense fallback={null}>
      <GeoFieldImpl {...props} />
    </Suspense>
  );
}
