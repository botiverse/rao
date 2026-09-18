import { dataDirectory } from "./data-directory";
import { ProjectService } from "./projects/service";
import { ProjectStore } from "./projects/store";
import { join } from "node:path";
import { app, BrowserWindow, session, dialog } from "electron";
import { AgentHost } from "./agents/host";
import { SessionStore } from "./sessions/store";
import { registerIpc } from "./ipc/register";
import { createMainWindow } from "./window";
import { appIconPath } from "./app-icon";
import { inheritShellEnvironment } from "./shell-env";
import { IPC } from "@shared/ipc";

app.setPath("userData", dataDirectory(app.getPath("appData")));
// Do not construct stores or register lifecycle handlers in a rejected instance.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  try {
    start();
  } catch (error) {
    dialog.showErrorBox(
      "Rao could not open project data",
      error instanceof Error ? error.message : String(error),
    );
    app.exit(1);
  }
}

function start(): void {
  // Read the login shell in parallel with app startup; runtime processes are
  // only spawned after the user acts, so awaiting it below is enough.
  const shellEnvironment = inheritShellEnvironment();
  let mainWindow: BrowserWindow | null = null;

  const projects = new ProjectStore(join(app.getPath("userData"), "rao.sqlite"));
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
    await shellEnvironment;

    // Packaged macOS apps use the ICNS; development otherwise shows Electron.
    if (process.platform === "darwin" && !app.isPackaged) {
      app.dock?.setIcon(appIconPath());
    }

    // The renderer needs no browser permissions (camera, notifications, ...).
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    await new ProjectService(host, projects).recover();
    registerIpc(host, () => mainWindow, projects);
    openWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openWindow();
      }
    });
  }

  void main().catch((error: unknown) => {
    dialog.showErrorBox(
      "Rao could not open project data",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });

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
        projects.dispose();
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
}
