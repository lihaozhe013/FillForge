import path from 'node:path';
import { copyFile, pathExists, toAppErrorDto, ValidationError } from '@docufill/core';
import { buildExtractionPrompt } from '@docufill/extraction';
import { mediaTypeForFilename } from '@docufill/runs';
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
  systemPathSchema,
  templatesLoadSchema,
  templatesPromptPreviewSchema,
  templatesSaveSchemaSchema
} from './schemas';

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

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

export function registerIpcHandlers(services: AppServices): void {
  const { templateService, runService, paths } = services;

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
    try {
      return buildExtractionPrompt(template);
    } catch {
      // Templates without configured fields have no prompt to preview.
      return null;
    }
  });

  handle(IPC.runsCreate, runsCreateSchema, ({ templateId, attachmentPaths }) =>
    runService.createRun({
      templateId,
      attachments: attachmentPaths.map((filePath) => ({
        path: filePath,
        originalFilename: path.basename(filePath),
        mediaType: mediaTypeForFilename(filePath)
      }))
    })
  );

  handle(IPC.runsList, emptyPayloadSchema, () => runService.listRuns());

  handle(IPC.runsLoad, runsLoadSchema, ({ id }) => runService.getRun(id));

  handle(IPC.runsGeneratePrompt, runsLoadSchema, ({ id }) => runService.generatePrompt(id));

  handle(IPC.runsImportExtraction, runsImportExtractionSchema, async ({ id, raw }) => {
    const { result, issues } = await runService.importExtraction(id, raw);
    return { result, issues };
  });

  handle(IPC.runsSaveReview, runsSaveReviewSchema, async ({ id, finalValues }) => {
    const review = await runService.saveReview(id, finalValues);
    return { review, issues: [] };
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
    await requireExistingFile(target);
    if (!isInside(paths.dataDir, target)) {
      throw new ValidationError('Only files inside the Docufill data directory can be opened.', {
        path: target
      });
    }
    return shell.openPath(target);
  });

  handle(IPC.systemShowItemInFolder, systemPathSchema, async ({ path: target }) => {
    if (!isInside(paths.dataDir, target)) {
      throw new ValidationError('Only files inside the Docufill data directory can be revealed.', {
        path: target
      });
    }
    shell.showItemInFolder(target);
    return null;
  });

  handle(IPC.systemExportCopy, systemPathSchema, async ({ path: source }) => {
    await requireExistingFile(source);
    if (!isInside(paths.dataDir, source)) {
      throw new ValidationError('Only files inside the Docufill data directory can be exported.', {
        path: source
      });
    }
    const window = focusedWindow();
    const result = window
      ? await dialog.showSaveDialog(window, { defaultPath: path.basename(source) })
      : await dialog.showSaveDialog({ defaultPath: path.basename(source) });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await copyFile(source, result.filePath);
    return result.filePath;
  });
}
