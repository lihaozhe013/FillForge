import type { ExtractionIssue } from '@fillforge/extraction';
import type { RenderedArtifact } from '@fillforge/runs';
import type {
  AttachmentMetadata,
  ExtractionResult,
  PlaceholderReport,
  ResolvedAppConfig,
  ReviewedRecord,
  RunMetadata,
  RunSummary,
  TemplateSchema,
  TemplateSummary
} from '@fillforge/schema';

export interface PromptPreview {
  prompt: string;
  expectedJson: string;
}

export const IPC = {
  templatesList: 'templates:list',
  templatesImport: 'templates:import',
  templatesLoad: 'templates:load',
  templatesSaveSchema: 'templates:update-schema',
  templatesInspect: 'templates:inspect',
  templatesDuplicate: 'templates:duplicate',
  templatesDelete: 'templates:delete',
  templatesPromptPreview: 'templates:prompt-preview',

  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',

  runsCreate: 'runs:create',
  runsList: 'runs:list',
  runsLoad: 'runs:load',
  runsGeneratePrompt: 'runs:generate-prompt',
  runsImportExtraction: 'runs:import-extraction',
  runsSaveReview: 'runs:save-review',
  runsNormalize: 'runs:normalize',
  runsRender: 'runs:render',
  runsAttachFiles: 'runs:attach-files',

  systemOpenPath: 'system:open-path',
  systemShowItemInFolder: 'system:show-item-in-folder',
  systemExportCopy: 'system:export-copy'
} as const;

export interface RunDetailsDto {
  metadata: RunMetadata;
  prompt: string | null;
  expectedJson: string | null;
  extraction: ExtractionResult | null;
  review: ReviewedRecord | null;
  normalized: Record<string, unknown> | null;
  outputs: RunOutputDto[];
}

export interface RunOutputDto {
  filename: string;
  path: string;
}

export interface CreateRunDto {
  templateId: string;
}

export interface SettingsUpdateDto {
  theme: ResolvedAppConfig['theme'];
  showAdvancedFields: boolean;
  promptVersion: string;
}

export interface ImportExtractionResultDto {
  result: ExtractionResult;
  issues: ExtractionIssue[];
}

export interface ReviewSaveResultDto {
  review: ReviewedRecord;
  issues: ExtractionIssue[];
}

export interface FillForgeApi {
  templates: {
    list(): Promise<TemplateSummary[]>;
    import(): Promise<TemplateSummary | null>;
    load(id: string): Promise<TemplateSchema>;
    saveSchema(id: string, schema: TemplateSchema): Promise<void>;
    inspect(id: string): Promise<PlaceholderReport>;
    duplicate(id: string): Promise<TemplateSummary>;
    delete(id: string): Promise<void>;
    promptPreview(id: string): Promise<PromptPreview | null>;
  };
  settings: {
    load(): Promise<ResolvedAppConfig>;
    save(input: SettingsUpdateDto): Promise<ResolvedAppConfig>;
  };
  runs: {
    create(input: CreateRunDto): Promise<RunMetadata>;
    list(): Promise<RunSummary[]>;
    load(id: string): Promise<RunDetailsDto>;
    generatePrompt(id: string): Promise<string>;
    importExtraction(id: string, raw: string): Promise<ImportExtractionResultDto>;
    saveReview(id: string, finalValues: Record<string, unknown>): Promise<ReviewSaveResultDto>;
    normalize(id: string): Promise<Record<string, unknown>>;
    render(id: string): Promise<RenderedArtifact>;
    attachFiles(id: string): Promise<AttachmentMetadata[] | null>;
  };
  system: {
    openPath(path: string): Promise<boolean>;
    showItemInFolder(path: string): Promise<void>;
    exportCopy(path: string): Promise<string | null>;
  };
}

export interface AppErrorDtoLike {
  code: string;
  message: string;
  details?: unknown;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorDtoLike };
