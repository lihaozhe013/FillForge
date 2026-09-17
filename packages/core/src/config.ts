import {
  appConfigSchema,
  type AppConfig,
  type ResolvedAppConfig,
  resolveAppConfig
} from '@fillforge/schema';
import { pathExists, readYamlFile, writeYamlFileAtomic } from './filesystem.ts';
import { InvalidConfigError, UnsupportedSchemaVersionError } from './errors.ts';

export interface ConfigRepository {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
}

export class FileConfigRepository implements ConfigRepository {
  readonly configFile: string;

  constructor(configFile: string) {
    this.configFile = configFile;
  }

  async load(): Promise<AppConfig> {
    if (!(await pathExists(this.configFile))) {
      return appConfigSchema.parse({ schema_version: 1 });
    }

    let raw: unknown;
    try {
      raw = await readYamlFile(this.configFile);
    } catch (error) {
      throw new InvalidConfigError('The YAML file could not be parsed.', { cause: error });
    }

    if (
      typeof raw === 'object' &&
      raw !== null &&
      'schema_version' in raw &&
      (raw as { schema_version?: unknown }).schema_version !== 1
    ) {
      throw new UnsupportedSchemaVersionError(
        'config.yaml',
        (raw as { schema_version?: unknown }).schema_version,
        1
      );
    }

    const result = appConfigSchema.safeParse(raw);
    if (!result.success) {
      throw new InvalidConfigError(result.error.issues);
    }
    return result.data;
  }

  async save(config: AppConfig): Promise<void> {
    const result = appConfigSchema.safeParse(config);
    if (!result.success) {
      throw new InvalidConfigError(result.error.issues);
    }
    await writeYamlFileAtomic(this.configFile, result.data);
  }

  async loadResolved(): Promise<ResolvedAppConfig> {
    return resolveAppConfig(await this.load());
  }
}
