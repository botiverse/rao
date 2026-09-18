import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type IpcChannel, type RaoApi } from "@shared/ipc";

function subscribe<T>(channel: IpcChannel, listener: (message: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, message: T): void => {
    listener(message);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.off(channel, wrapped);
  };
}

const api: RaoApi = {
  projects: {
    importFile: async () => ipcRenderer.invoke(IPC.projectsImportFile),
    export: async (legacy) => ipcRenderer.invoke(IPC.projectsExport, legacy),
    list: async () => ipcRenderer.invoke(IPC.projectsList),
    save: async (id, details) => ipcRenderer.invoke(IPC.projectsSave, id, details),
    importLegacy: async (text) => ipcRenderer.invoke(IPC.projectsImportLegacy, text),
  },
  runtimes: {
    list: async () => ipcRenderer.invoke(IPC.runtimesList),
    skills: async (runtime, cwd) => ipcRenderer.invoke(IPC.runtimesSkills, runtime, cwd),
    mcpServers: async (runtime, cwd) => ipcRenderer.invoke(IPC.runtimesMcpServers, runtime, cwd),
    tools: async (runtime, cwd) => ipcRenderer.invoke(IPC.runtimesTools, runtime, cwd),
    accountUsage: async (runtime) => ipcRenderer.invoke(IPC.runtimesAccountUsage, runtime),
    listModels: async (runtime) => ipcRenderer.invoke(IPC.runtimesListModels, runtime),
  },
  sessions: {
    diagnostics: async () => ipcRenderer.invoke(IPC.sessionDiagnostics),
    open: async (request) => ipcRenderer.invoke(IPC.sessionOpen, request),
    resume: async (handle) => ipcRenderer.invoke(IPC.sessionResume, handle),
    list: async () => ipcRenderer.invoke(IPC.sessionList),
    events: async (handle) => ipcRenderer.invoke(IPC.sessionEvents, handle),
    prompt: async (handle, input) => ipcRenderer.invoke(IPC.sessionPrompt, handle, input),
    steerOrQueue: async (handle, input) =>
      ipcRenderer.invoke(IPC.sessionSteerOrQueue, handle, input),
    abort: async (handle) => ipcRenderer.invoke(IPC.sessionAbort, handle),
    dispose: async (handle) => ipcRenderer.invoke(IPC.sessionDispose, handle),
    delete: async (handle) => ipcRenderer.invoke(IPC.sessionDelete, handle),
    onEvent: (listener) => subscribe(IPC.sessionEvent, listener),
    onStatus: (listener) => subscribe(IPC.sessionStatus, listener),
    onClosed: (listener) => subscribe(IPC.sessionClosed, listener),
  },
  dialog: {
    pickDirectory: async () => ipcRenderer.invoke(IPC.dialogPickDirectory),
  },
  app: {
    versions: async () => ipcRenderer.invoke(IPC.appVersions),
  },
};

contextBridge.exposeInMainWorld("rao", api);
