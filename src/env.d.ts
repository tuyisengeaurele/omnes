/// <reference types="vite/client" />

import type { AppApi } from '../shared/ipc';

declare global {
  interface Window {
    // Only present when a preload script has run (real Electron windows).
    // Absent in the Vitest/jsdom test environment and in a plain browser tab.
    omnes?: AppApi;
  }
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.png' {
  const src: string;
  export default src;
}

export {};
