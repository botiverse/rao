import { join } from "node:path";
import { app, BrowserWindow, session } from "electron";
import { AgentHost } from "./agents/host";
import { SessionStore } from "./sessions/store";
import { registerIpc } from "./ipc/register";
import { createMainWindow } from "./window";
import { IPC } from "@shared/ipc";

// One instance: agent subprocesses belong to exactly one app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const store = new SessionStore(join(app.getPath("userData"), "sessions"));
const host = new AgentHost(
  {
    event: (message) => mainWindow?.webContents.send(IPC.sessionEvent, message),
    status: (message) => mainWindow?.webContents.send(IPC.sessionStatus, message),
    closed: (message) => mainWindow?.webContents.send(IPC.sessionClosed, message),
  },
  store,
);

function openWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("second-instance", () => {
  if (mainWindow !== null) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

async function main(): Promise<void> {
  await app.whenReady();

  // The renderer needs no browser permissions (camera, notifications, ...).
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  registerIpc(host, () => mainWindow);
  openWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openWindow();
    }
  });
}

void main();

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Release every runtime process and flush the store before the app exits.
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) {
    return;
  }
  quitting = true;
  event.preventDefault();
  void host.disposeAll().finally(() => {
    try {
      store.dispose();
    } catch (error) {
      console.error("session store flush failed", error);
    }
    // Cleanup is done; exit directly. In testing, a second app.quit() here
    // emitted `quit` but left main plus the gpu/utility helpers running
    // indefinitely (cause not pinned down); app.exit() terminates reliably.
    app.exit(0);
  });
});

// A terminal signal (electron-vite restart, Ctrl-C) must quit, not just close windows.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    app.quit();
  });
}
