/// <reference types="vite/client" />

import type { AppInfo } from '../../shared/types';

declare global {
  interface Window {
    kataribe: {
      getAppInfo: () => Promise<AppInfo>;
      ready: () => void;
    };
  }
}

export {};
