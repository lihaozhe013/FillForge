import { contextBridge, ipcRenderer } from 'electron';
import type { AppErrorDtoLike, FillForgeApi, IpcResult } from '../src/lib/ipc-protocol';
import { IPC } from '../src/lib/ipc-protocol';

export class IpcError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(dto: AppErrorDtoLike) {
    super(dto.message);
    this.name = 'IpcError';
    this.code = dto.code;
    this.details = dto.details;
  }
}

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>;
  if (!result.ok) {
    throw new IpcError(result.error);
  }
  return result.data;
}

const api: FillForgeApi = {
  templates: {
    list: () => invoke(IPC.templatesList),
    import: () => invoke(IPC.templatesImport),
    load: (id) => invoke(IPC.templatesLoad, { id }),
    saveSchema: (id, schema) => invoke(IPC.templatesSaveSchema, { id, schema }),
    inspect: (id) => invoke(IPC.templatesInspect, { id }),
    duplicate: (id) => invoke(IPC.templatesDuplicate, { id }),
    delete: (id) => invoke(IPC.templatesDelete, { id }),
    promptPreview: (id) => invoke(IPC.templatesPromptPreview, { id })
  },
  runs: {
    create: (input) => invoke(IPC.runsCreate, input),
    list: () => invoke(IPC.runsList),
    load: (id) => invoke(IPC.runsLoad, { id }),
    generatePrompt: (id) => invoke(IPC.runsGeneratePrompt, { id }),
    importExtraction: (id, raw) => invoke(IPC.runsImportExtraction, { id, raw }),
    saveReview: (id, finalValues) => invoke(IPC.runsSaveReview, { id, finalValues }),
    normalize: (id) => invoke(IPC.runsNormalize, { id }),
    render: (id) => invoke(IPC.runsRender, { id }),
    attachFiles: (id) => invoke(IPC.runsAttachFiles, { id })
  },
  system: {
    openPath: (filePath) => invoke(IPC.systemOpenPath, { path: filePath }),
    showItemInFolder: (filePath) => invoke(IPC.systemShowItemInFolder, { path: filePath }),
    exportCopy: (filePath) => invoke(IPC.systemExportCopy, { path: filePath })
  }
};

contextBridge.exposeInMainWorld('fillforge', api);
