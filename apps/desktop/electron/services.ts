import { type AppPaths, ensureAppDirectories, getAppPaths } from '@fillforge/core';
import type { DocumentRenderer } from '@fillforge/docx';
import { createDocxtemplaterRenderer } from '@fillforge/docx';
import { FileRunRepository, RunService } from '@fillforge/runs';
import { TemplateService } from '@fillforge/templates';

export interface AppServices {
  paths: AppPaths;
  renderer: DocumentRenderer;
  templateService: TemplateService;
  runService: RunService;
}

export function createAppServices(): AppServices {
  const paths = getAppPaths();
  ensureAppDirectories(paths);
  const renderer = createDocxtemplaterRenderer();
  const templateService = TemplateService.createDefault(paths.templatesDir, renderer);
  const runRepository = new FileRunRepository(paths.runsDir);
  const runService = new RunService(runRepository, templateService, renderer);
  return { paths, renderer, templateService, runService };
}
