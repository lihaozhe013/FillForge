import {
  type AppPaths,
  FileConfigRepository,
  ensureAppDirectories,
  getAppPaths
} from '@fillforge/core';
import type { DocumentRenderer } from '@fillforge/docx';
import { createDocxtemplaterRenderer } from '@fillforge/docx';
import { FileRunRepository, RunService } from '@fillforge/runs';
import { TemplateService } from '@fillforge/templates';

export interface AppServices {
  paths: AppPaths;
  configRepository: FileConfigRepository;
  config: Awaited<ReturnType<FileConfigRepository['loadResolved']>>;
  renderer: DocumentRenderer;
  templateService: TemplateService;
  runService: RunService;
}

export async function createAppServices(): Promise<AppServices> {
  const paths = getAppPaths();
  await ensureAppDirectories(paths);
  const configRepository = new FileConfigRepository(paths.configFile);
  const config = await configRepository.loadResolved();
  const renderer = createDocxtemplaterRenderer();
  const templateService = TemplateService.createDefault(paths.templatesDir, renderer);
  const runRepository = new FileRunRepository(paths.runsDir);
  const runService = new RunService(runRepository, templateService, renderer, config.promptVersion);
  return { paths, configRepository, config, renderer, templateService, runService };
}
