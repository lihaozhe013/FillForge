import { type AppPaths, ensureAppDirectories, getAppPaths } from '@docufill/core';
import type { DocumentRenderer } from '@docufill/docx';
import { createDocxtemplaterRenderer } from '@docufill/docx';
import { FileRunRepository, RunService } from '@docufill/runs';
import { TemplateService } from '@docufill/templates';

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
