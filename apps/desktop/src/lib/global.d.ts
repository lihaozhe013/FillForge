import type { DocufillApi } from "./ipc-protocol";

declare global {
  interface Window {
    docufill: DocufillApi;
  }
}
