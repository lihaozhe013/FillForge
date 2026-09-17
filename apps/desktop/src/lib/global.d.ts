import type { FillForgeApi } from './ipc-protocol';

declare global {
  interface Window {
    fillforge: FillForgeApi;
  }
}
