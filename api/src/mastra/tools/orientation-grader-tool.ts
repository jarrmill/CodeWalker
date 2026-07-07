import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  gateGradeSchema,
  gradeOrientationStage,
  orientationStages,
} from '../agents/orientation-grader';

/**
 * Thin wrapper that lets the code-review chat agent gate a stage by calling the
 * standalone grader. Keeping the judgment in `gradeOrientationStage` (not in the
 * chat agent's prompt) means the same code path the user hits in conversation is
 * the one the eval harness measures against a labelled dataset.
 */
export const gradeOrientationStageTool = createTool({
  id: 'grade-orientation-stage',
  description:
    "Grade whether the developer's latest explanation demonstrates understanding of the current orientation stage. Call this once the developer has explained a stage, before deciding whether to advance. It judges ONLY the explanation, never the change itself, and returns a structured verdict.",
  inputSchema: z.object({
    stage: z
      .enum(orientationStages)
      .describe(
        'Which orientation stage to grade: select-task, understand-context, or understand-rationale.',
      ),
    explanation: z
      .string()
      .describe("The developer's explanation for this stage, in their own words."),
    diff: z.string().describe('The unified diff under review.'),
    prDescription: z
      .string()
      .default('')
      .describe('The PR description or commit message, if available.'),
    priorNotes: z
      .array(z.string())
      .default([])
      .describe('Facts confirmed in earlier stages, carried forward into this grade.'),
  }),
  outputSchema: gateGradeSchema,
  execute: async ({ stage, explanation, diff, prDescription, priorNotes }) => {
    return await gradeOrientationStage({ stage, explanation, diff, prDescription, priorNotes });
  },
});
