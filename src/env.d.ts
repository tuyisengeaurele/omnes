/// <reference types="vite/client" />

import type { AppApi } from '../shared/ipc';

declare global {
  interface Window {
    omnes: AppApi;
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
