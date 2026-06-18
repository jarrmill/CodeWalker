import { createTool } from '@mastra/core/tools';
import {
  orientationInputSchema,
  orientationStateSchema,
} from '../workflows/code-review-orientation-workflow';

export const runCodeReviewOrientationTool = createTool({
  id: 'run-code-review-orientation',
  description:
    'Run the 3-stage code review orientation phase (select task, understand context, understand rationale) on a code change. Returns per-stage verdicts and accumulated notes.',
  inputSchema: orientationInputSchema,
  outputSchema: orientationStateSchema,
  execute: async (input, { mastra }) => {
    if (!mastra) {
      throw new Error('Mastra instance is not available in the tool execution context.');
    }

    const run = await mastra.getWorkflow('codeReviewOrientationWorkflow').createRun();
    const result = await run.start({ inputData: input });

    if (result.status !== 'success') {
      throw new Error(`Orientation workflow did not complete successfully (status: ${result.status}).`);
    }

    return result.result;
  },
});
