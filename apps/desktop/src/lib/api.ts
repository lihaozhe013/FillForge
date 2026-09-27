import { invoke } from '@tauri-apps/api/core';
import type { FillForgeApi, IpcResult } from './ipc-protocol';
import type { AppErrorDtoLike } from './ipc-protocol';

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

async function call<T>(command: string, input?: unknown): Promise<T> {
  try {
    const result = await invoke<IpcResult<T>>(command, input === undefined ? undefined : { input });
    if (!result.ok) throw new IpcError(result.error);
    return result.data;
  } catch (error) {
    if (error instanceof IpcError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new IpcError({ code: 'internal_error', message });
  }
}

const api: FillForgeApi = {
  templates: {
    list: () => call('templates_list'),
    import: () => call('templates_import'),
    load: (id) => call('templates_load', { id }),
    saveSchema: (id, schema) => call('templates_save_schema', { id, schema }),
    inspect: (id) => call('templates_inspect', { id }),
    syncPlaceholders: (id, schema) => call('templates_sync_placeholders', schema === undefined ? { id } : { id, schema }),
    duplicate: (id) => call('templates_duplicate', { id }),
    delete: (id) => call('templates_delete', { id }),
    promptPreview: (id) => call('templates_prompt_preview', { id }),
  },
  settings: {
    load: () => call('settings_load'),
    save: (input) => call('settings_save', input),
  },
  runs: {
    create: (input) => call('runs_create', input),
    list: () => call('runs_list'),
    load: (id) => call('runs_load', { id }),
    generatePrompt: (id) => call('runs_generate_prompt', { id }),
    importExtraction: (id, raw) => call('runs_import_extraction', { id, raw }),
    saveReview: (id, finalValues) => call('runs_save_review', { id, finalValues }),
    normalize: (id) => call('runs_normalize', { id }),
    render: (id) => call('runs_render', { id }),
    attachFiles: (id) => call('runs_attach_files', { id }),
  },
  system: {
    openPath: (path) => call('system_open_path', { path }),
    showItemInFolder: (path) => call('system_show_item_in_folder', { path }),
    exportCopy: (path) => call('system_export_copy', { path }),
  },
};

export function installApi(): void {
  window.fillforge = api;
}
