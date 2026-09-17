import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type AppContext, createContext } from './context.ts';
import { extractFields } from './extract-fields.ts';
import { inspectTemplate } from './inspect-template.ts';
import { renderDocument } from './render-document.ts';
import { validateFields } from './validate-fields.ts';

const HELP = `FillForge CLI

Usage: pnpm tsx packages/tools/src/index.ts <command> [args]

Commands:
  inspect-template <templateId>            List DOCX placeholders and configuration gaps
  extract-fields <templateId>              Print the deterministic extraction prompt
  validate-fields <templateId> <file.json> Validate an extraction JSON against a template
  render-document <runId>                  Render a run's reviewed values to DOCX

Environment:
  FILLFORGE_HOME    Override the data home (default: the user's home directory)
`;

type Command = (context: AppContext, args: string[]) => Promise<string>;

const commands: Record<string, Command> = {
  'inspect-template': (context, args) => {
    const [templateId] = args;
    if (!templateId) {
      throw new Error('inspect-template requires a template id');
    }
    return inspectTemplate(context, templateId);
  },
  'extract-fields': (context, args) => {
    const [templateId] = args;
    if (!templateId) {
      throw new Error('extract-fields requires a template id');
    }
    return extractFields(context, templateId);
  },
  'validate-fields': (context, args) => {
    const [templateId, file] = args;
    if (!templateId || !file) {
      throw new Error('validate-fields requires a template id and a JSON file');
    }
    return validateFields(context, templateId, file, { normalize: true });
  },
  'render-document': (context, args) => {
    const [runId] = args;
    if (!runId) {
      throw new Error('render-document requires a run id');
    }
    return renderDocument(context, runId);
  }
};

export async function main(argv: string[]): Promise<string> {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help') {
    return HELP;
  }
  const run = commands[command];
  if (!run) {
    throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
  const context = await createContext();
  return run(context, args);
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(path.resolve(entryPath)).href) {
  main(process.argv.slice(2))
    .then((output) => {
      console.log(output);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
