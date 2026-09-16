import type { AppContext } from "./context.ts";

/**
 * Render a run's reviewed values into a DOCX under runs/<id>/output/.
 */
export async function renderDocument(context: AppContext, runId: string): Promise<string> {
  const artifact = await context.runService.renderRun(runId);
  return `Rendered ${artifact.filename}\nPath: ${artifact.path}`;
}
