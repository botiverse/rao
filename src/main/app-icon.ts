import { join } from "node:path";
import { app } from "electron";

export function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(app.getAppPath(), "build/icon.png");
}
