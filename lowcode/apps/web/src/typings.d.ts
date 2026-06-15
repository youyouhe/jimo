// CSS modules
declare module '*.module.css' {
  const styles: Record<string, string>;
  export default styles;
}

declare module '*.module.less' {
  const styles: Record<string, string>;
  export default styles;
}

declare module '*.module.scss' {
  const styles: Record<string, string>;
  export default styles;
}

// Umi 4 / @umijs/max runtime exports (generated into .umi/ at dev/build time)
// These are not available in static type declarations but will be present at runtime.
declare module '@umijs/max' {
  // Re-export everything from umi
  export * from 'umi';

  // Build-time config
  export function defineConfig(config: Record<string, any>): Record<string, any>;

  // React Router v6 hooks available via Umi 4 runtime
  export function useNavigate(): (to: string, options?: { replace?: boolean; state?: any }) => void;
  export function useLocation(): { pathname: string; search: string; hash: string; state: any };
  export function useParams<T extends Record<string, string>>(): T;
  export function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void];

  // Umi runtime history object
  export const history: {
    push: (path: string, state?: any) => void;
    replace: (path: string, state?: any) => void;
    go: (n: number) => void;
    back: () => void;
    forward: () => void;
  };

  // Umi model / initialState hooks
  export function useModel(namespace: string, selector?: (model: any) => any): any;
}
