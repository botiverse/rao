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
  runtimes: {
    list: async () => ipcRenderer.invoke(IPC.runtimesList),
    listModels: async (runtime) => ipcRenderer.invoke(IPC.runtimesListModels, runtime),
  },
  sessions: {
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
