import { useEffect, useRef } from 'react';
import { MiniMap } from '@logicflow/extension';
import type LogicFlow from '@logicflow/core';

/**
 * Minimap plugin wrapper. Mounts the LogicFlow MiniMap into a dedicated div
 * positioned at bottom-right of the canvas area.
 */
interface MinimapProps {
  lf: LogicFlow | null;
  visible?: boolean;
}

export default function DesignerMinimap({ lf, visible = true }: MinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<MiniMap | null>(null);

  useEffect(() => {
    if (!lf || !visible) return;

    const miniMap = new MiniMap({
      lf,
      LogicFlow: (lf.constructor as typeof LogicFlow),
      options: {
        width: 200,
        height: 150,
        showEdge: false,
        isShowHeader: true,
        isShowCloseIcon: true,
        headerTitle: 'MiniMap',
        rightPosition: 16,
        bottomPosition: 16,
      },
    });
    minimapRef.current = miniMap;

    if (containerRef.current) {
      miniMap.render(lf, containerRef.current);
      miniMap.show();
    }

    return () => {
      try { miniMap.destroy(); } catch { /* ignore */ }
      minimapRef.current = null;
    };
  }, [lf, visible]);

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        zIndex: 10,
        pointerEvents: 'auto',
      }}
    />
  );
}
