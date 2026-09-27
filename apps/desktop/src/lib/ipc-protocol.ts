import type {
  AppErrorDto,
  AppTheme,
  AttachmentMetadata,
  ExtractionIssue,
  ExtractionResult,
  GeneratedPrompt,
  PlaceholderReport,
  RenderedArtifact,
  ResolvedAppConfig,
  ReviewSaveResult,
  ReviewedRecord,
  RunDetails,
  RunMetadata,
  RunSummary,
  TemplateSchema,
  TemplateSummary,
} from './generated-types';

export type PromptPreview = Pick<GeneratedPrompt, 'prompt' | 'expectedJson'>;

export interface CreateRunDto {
  templateId: string;
}

export interface SettingsUpdateDto {
  theme: AppTheme;
  language: ResolvedAppConfig['language'];
  showAdvancedFields: boolean;
  promptVersion: string;
}

export type ImportExtractionResultDto = {
  result: ExtractionResult;
  issues: ExtractionIssue[];
};

export type ReviewSaveResultDto = ReviewSaveResult;
export type RunDetailsDto = RunDetails;
export type RunOutputDto = RunDetails['outputs'][number];

export interface FillForgeApi {
  templates: {
    list(): Promise<TemplateSummary[]>;
    import(): Promise<TemplateSummary | null>;
    load(id: string): Promise<TemplateSchema>;
    saveSchema(id: string, schema: TemplateSchema): Promise<void>;
    inspect(id: string): Promise<PlaceholderReport>;
    syncPlaceholders(id: string, schema?: TemplateSchema): Promise<TemplateSchema>;
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

export type AppErrorDtoLike = Omit<AppErrorDto, 'details'> & { details?: unknown };

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorDtoLike };
