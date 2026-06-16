import React from 'react';
import { Spin, Result, Button } from 'antd';
import { useTabsStore } from '@/stores/tabs';
import { getRouteComponent } from './routeRegistry';

/**
 * Per-page error boundary — a throw in one cached page must not take down the
 * whole workspace (and must not break the other live tabs).
 */
class PageErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    // When the page is refreshed (resetKey changes), clear the error state.
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="页面渲染出错"
          extra={
            <Button type="primary" onClick={() => this.setState({ hasError: false })}>
              重试
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Renders EVERY opened tab's page simultaneously. The inactive ones are hidden
 * via `display: none` (NOT unmounted), so each page keeps its React instance and
 * internal state (table scroll, filters, draft forms) across tab switches.
 *
 * The wrapper `key` is `path + refreshCounter` — switching tabs does not change
 * it (instance preserved); only `refreshTab(path)` bumps the counter and remounts
 * that single page.
 */
export default function KeepAliveOutlet() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeKey = useTabsStore((s) => s.activeKey);
  const refreshKeys = useTabsStore((s) => s.refreshKeys);

  return (
    <>
      {tabs.map((tab) => {
        const Comp = getRouteComponent(tab.path);
        const active = tab.path === activeKey;
        const refreshCounter = refreshKeys[tab.path] ?? 0;
        return (
          <div
            key={`${tab.path}__${refreshCounter}`}
            style={{
              display: active ? 'block' : 'none',
              height: '100%',
            }}
          >
            <PageErrorBoundary resetKey={`${tab.path}__${refreshCounter}`}>
              {Comp ? (
                <React.Suspense
                  fallback={
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
                      <Spin size="large" />
                    </div>
                  }
                >
                  <Comp />
                </React.Suspense>
              ) : (
                <Result status="404" title="页面未找到" subTitle={`未注册的路由：${tab.path}`} />
              )}
            </PageErrorBoundary>
          </div>
        );
      })}
    </>
  );
}
