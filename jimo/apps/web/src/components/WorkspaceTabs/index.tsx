import { useEffect, useRef } from 'react';
import { Spin } from 'antd';
import { useLocation, useAppData } from '@umijs/max';
import { useTabsStore } from '@/stores/tabs';
import {
  populateRegistry,
  getRegisteredPaths,
} from './routeRegistry';
import { resolveRouteMeta } from './resolveMeta';
import TabBar from './TabBar';
import KeepAliveOutlet from './KeepAliveOutlet';

/** Paths that must never become tabs (redirect target / out-of-layout login). */
const SKIP_TAB = new Set(['/', '/login']);

/**
 * Workspace with a multi-tab strip + KeepAlive content area.
 *
 * Renders into the Umi layout via the `childrenRender` hook in `src/app.tsx`.
 * Route changes (menu clicks, history navigation) are turned into tab
 * open/activate operations; each opened page stays mounted (hidden when
 * inactive) so its state survives tab switches.
 *
 * Page components are sourced from Umi's `useAppData()` (routes + routeComponents),
 * since Umi forbids importing the generated `.umi` module directly and the patched
 * route tree carries no `.component`.
 */
export default function WorkspaceTabs() {
  const location = useLocation();
  // useAppData() exposes the route config (`routes`) and the id → lazy component
  // map (`routeComponents`). Both are available synchronously on first render.
  const appData = useAppData() as {
    routes?: Record<string, any>;
    routeComponents?: Record<string, any>;
  };

  const openTab = useTabsStore((s) => s.openTab);
  const activeKey = useTabsStore((s) => s.activeKey);
  const sanitize = useTabsStore((s) => s.sanitize);

  // Populate the path → component registry once, synchronously during render,
  // so KeepAliveOutlet can render pages on the very first paint. Idempotent.
  const populated = useRef(false);
  if (!populated.current && appData?.routeComponents) {
    populateRegistry(appData.routes || {}, appData.routeComponents);
    populated.current = true;
  }
  const ready = populated.current;

  // After first populate, drop persisted tabs that no longer resolve to a
  // registered page (e.g. after a role/menu change).
  useEffect(() => {
    if (ready) sanitize(getRegisteredPaths());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Route → tab: every navigation opens (or activates) a tab for the path.
  useEffect(() => {
    const path = location.pathname;
    if (SKIP_TAB.has(path)) return;
    const meta = resolveRouteMeta(path);
    openTab({ path, title: meta.title, icon: meta.icon });
  }, [location.pathname, openTab]);

  // When the active tab changes, the previously-hidden page becomes visible.
  // antd Table / ProTable compute column widths from the container size, so a
  // page that was `display:none` needs a resize nudge to re-measure on reveal.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(raf);
  }, [activeKey]);

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TabBar />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#f5f5f5' }}>
        <KeepAliveOutlet />
      </div>
    </div>
  );
}
