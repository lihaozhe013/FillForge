import fs from 'node:fs/promises';
import path from 'node:path';
import {
  copyFile,
  isPathInside,
  pathExists,
  toAppErrorDto,
  ValidationError
} from '@fillforge/core';
import { buildExtractionPrompt } from '@fillforge/extraction';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { z } from 'zod';
import type { AppErrorDtoLike, IpcResult } from '../../src/lib/ipc-protocol';
import { IPC } from '../../src/lib/ipc-protocol';
import { logAppEvent, logDebug } from '../logger';
import type { AppServices } from '../services';
import {
  emptyPayloadSchema,
  runsCreateSchema,
  runsImportExtractionSchema,
  runsLoadSchema,
  runsSaveReviewSchema,
  settingsSaveSchema,
  systemPathSchema,
  templatesLoadSchema,
  templatesPromptPreviewSchema,
  templatesSaveSchemaSchema
} from './schemas';

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

async function showOpenDialog(options: Electron.OpenDialogOptions): Promise<string[] | null> {
  const window = focusedWindow();
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths;
}

function handle<T>(
  channel: string,
  schema: z.ZodType<T>,
  fn: (payload: T) => Promise<unknown>
): void {
  ipcMain.handle(channel, async (_event, rawPayload): Promise<IpcResult<unknown>> => {
    try {
      const parsed = schema.safeParse(rawPayload);
      if (!parsed.success) {
        throw new ValidationError('Invalid request payload.', parsed.error.issues);
      }
      const data = await fn(parsed.data);
      return { ok: true, data: data ?? null };
    } catch (error) {
      const dto: AppErrorDtoLike = toAppErrorDto(error);
      logAppEvent('error', `${channel} failed: ${dto.code} ${dto.message}`);
      logDebug('ipc', `${channel} failed: ${dto.code} ${dto.message}`);
      return { ok: false, error: dto };
    }
  });
}

async function requireExistingFile(filePath: string): Promise<void> {
  if (!(await pathExists(filePath))) {
    throw new ValidationError('File not found.', { path: filePath });
  }
}

async function requireDataFile(target: string, dataDir: string, action: string): Promise<string> {
  const resolved = path.resolve(target);
  if (!isPathInside(dataDir, resolved)) {
    throw new ValidationError(`Only files inside the FillForge data directory can be ${action}.`, {
      path: target
    });
  }
  await requireExistingFile(resolved);
  const [realDataDir, realTarget] = await Promise.all([
    fs.realpath(dataDir),
    fs.realpath(resolved)
  ]);
  if (!isPathInside(realDataDir, realTarget)) {
    throw new ValidationError(`Only files inside the FillForge data directory can be ${action}.`, {
      path: target
    });
  }
  const stats = await fs.stat(realTarget);
  if (!stats.isFile()) {
    throw new ValidationError('The selected path is not a file.', { path: target });
  }
  return resolved;
}

export function registerIpcHandlers(services: AppServices): void {
  const { templateService, runService, paths, configRepository } = services;

  handle(IPC.templatesList, emptyPayloadSchema, () => templateService.listTemplates());

  handle(IPC.templatesImport, emptyPayloadSchema, async () => {
    const filePaths = await showOpenDialog({
      title: 'Import DOCX template',
      filters: [{ name: 'Word Documents', extensions: ['docx'] }],
      properties: ['openFile']
    });
    if (!filePaths) {
      return null;
    }
    const documentPath = filePaths[0];
    if (!documentPath) {
      return null;
    }
    const name = path.basename(documentPath, path.extname(documentPath));
    const template = await templateService.importTemplate({ name, documentPath });
    const all = await templateService.listTemplates();
    return all.find((summary) => summary.id === template.id) ?? null;
  });

  handle(IPC.templatesLoad, templatesLoadSchema, ({ id }) => templateService.loadTemplate(id));

  handle(IPC.templatesSaveSchema, templatesSaveSchemaSchema, ({ id, schema }) =>
    templateService.saveSchema(id, schema).then(() => null)
  );

  handle(IPC.templatesInspect, templatesLoadSchema, ({ id }) =>
    templateService.inspectTemplate(id)
  );

  handle(IPC.templatesDuplicate, templatesLoadSchema, async ({ id }) => {
    const copy = await templateService.duplicateTemplate(id);
    const all = await templateService.listTemplates();
    return all.find((summary) => summary.id === copy.id) ?? null;
  });

  handle(IPC.templatesDelete, templatesLoadSchema, ({ id }) =>
    templateService.deleteTemplate(id).then(() => null)
  );

  handle(IPC.templatesPromptPreview, templatesPromptPreviewSchema, async ({ id }) => {
    const template = await templateService.loadTemplate(id);
    const config = await configRepository.loadResolved();
    try {
      return buildExtractionPrompt(template, config.promptVersion);
    } catch {
      // Templates without configured fields have no prompt to preview.
      return null;
    }
  });

  handle(IPC.settingsLoad, emptyPayloadSchema, () => configRepository.loadResolved());

  handle(IPC.settingsSave, settingsSaveSchema, async (input) => {
    await configRepository.save({
      schema_version: 1,
      ui: { theme: input.theme },
      editor: { show_advanced_fields: input.showAdvancedFields },
      extraction: { prompt_version: input.promptVersion }
    });
    const config = await configRepository.loadResolved();
    runService.setPromptVersion(config.promptVersion);
    return config;
  });

  handle(IPC.runsCreate, runsCreateSchema, ({ templateId }) =>
    runService.createRun({ templateId })
  );

  handle(IPC.runsList, emptyPayloadSchema, () => runService.listRuns());

  handle(IPC.runsLoad, runsLoadSchema, ({ id }) => runService.getRun(id));

  handle(IPC.runsGeneratePrompt, runsLoadSchema, ({ id }) => runService.generatePrompt(id));

  handle(IPC.runsImportExtraction, runsImportExtractionSchema, async ({ id, raw }) => {
    const { result, issues } = await runService.importExtraction(id, raw);
    return { result, issues };
  });

  handle(IPC.runsSaveReview, runsSaveReviewSchema, async ({ id, finalValues }) => {
    return runService.saveReviewWithIssues(id, finalValues);
  });

  handle(IPC.runsNormalize, runsLoadSchema, ({ id }) => runService.buildNormalized(id));

  handle(IPC.runsRender, runsLoadSchema, ({ id }) => runService.renderRun(id));

  handle(IPC.runsAttachFiles, runsLoadSchema, async ({ id }) => {
    const filePaths = await showOpenDialog({
      title: 'Attach source material',
      filters: [
        {
          name: 'Evidence',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'txt', 'md']
        }
      ],
      properties: ['openFile', 'multiSelections']
    });
    if (!filePaths) {
      return null;
    }
    const added = [];
    for (const filePath of filePaths) {
      added.push(await runService.addAttachment(id, filePath, path.basename(filePath)));
    }
    return added;
  });

  handle(IPC.systemOpenPath, systemPathSchema, async ({ path: target }) => {
    const safeTarget = await requireDataFile(target, paths.dataDir, 'opened');
    const error = await shell.openPath(safeTarget);
    if (error) {
      throw new ValidationError('The file could not be opened.', { path: safeTarget, error });
    }
    return true;
  });

  handle(IPC.systemShowItemInFolder, systemPathSchema, async ({ path: target }) => {
    const safeTarget = await requireDataFile(target, paths.dataDir, 'revealed');
    shell.showItemInFolder(safeTarget);
    return null;
  });

  handle(IPC.systemExportCopy, systemPathSchema, async ({ path: source }) => {
    const safeSource = await requireDataFile(source, paths.dataDir, 'exported');
    const defaultPath = path.join(paths.exportsDir, path.basename(safeSource));
    const window = focusedWindow();
    const result = window
      ? await dialog.showSaveDialog(window, {
          defaultPath,
          filters: [{ name: 'Word Documents', extensions: ['docx'] }]
        })
      : await dialog.showSaveDialog({
          defaultPath,
          filters: [{ name: 'Word Documents', extensions: ['docx'] }]
        });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await copyFile(safeSource, result.filePath);
    return result.filePath;
  });
}
