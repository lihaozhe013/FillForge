import { ensureAppDirectories, getAppPaths } from '@fillforge/core';
import { createDocxtemplaterRenderer, type DocumentRenderer } from '@fillforge/docx';
import { FileRunRepository, RunService } from '@fillforge/runs';
import { TemplateService } from '@fillforge/templates';

export interface AppContext {
  templateService: TemplateService;
  runService: RunService;
  renderer: DocumentRenderer;
}

/**
 * Assemble application services the same way the desktop app does. The
 * FILLFORGE_HOME environment variable overrides the home directory, so CLI
 * commands and tests can operate on an isolated data root.
 */
export async function createContext(): Promise<AppContext> {
  const paths = getAppPaths();
  await ensureAppDirectories(paths);
  const renderer = createDocxtemplaterRenderer();
  const templateService = TemplateService.createDefault(paths.templatesDir, renderer);
  const runRepository = new FileRunRepository(paths.runsDir);
  const runService = new RunService(runRepository, templateService, renderer);
  return { templateService, runService, renderer };
}
