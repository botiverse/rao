import type { RaoApi } from "@shared/ipc";

declare global {
  interface Window {
    readonly rao: RaoApi;
  }
}
