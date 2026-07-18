import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  gateGradeSchema,
  gradeOrientationStage,
  orientationStages,
} from '../agents/orientation-grader';
import { getReviewContext, setReviewContext } from './review-context';
import { prepareDiff } from './github-tool';

/**
 * Thin wrapper that lets the code-review chat agent gate a stage by calling the
 * standalone grader. Keeping the judgment in `gradeOrientationStage` (not in the
 * chat agent's prompt) means the same code path the user hits in conversation is
 * the one the eval harness measures against a labelled dataset.
 *
 * The diff and PR description are read from the per-thread review context (set
 * when the change was loaded) rather than passed in by the model, so the large
 * diff isn't re-sent as tool arguments on every grade turn.
 */
export const gradeOrientationStageTool = createTool({
  id: 'grade-orientation-stage',
  description:
    "Grade whether the developer's latest explanation demonstrates understanding of the current orientation stage. Call this once the developer has explained a stage, before deciding whether to advance. It judges ONLY the explanation, never the change itself, and returns a structured verdict. The diff and PR description of the loaded change are supplied automatically — do NOT pass them.",
  inputSchema: z.object({
    stage: z
      .enum(orientationStages)
      .describe(
        'Which orientation stage to grade: select-task, understand-context, or understand-rationale.',
      ),
    explanation: z
      .string()
      .describe("The developer's explanation for this stage, in their own words."),
    priorNotes: z
      .array(z.string())
      .default([])
      .describe('Facts confirmed in earlier stages, carried forward into this grade.'),
  }),
  outputSchema: gateGradeSchema,
  execute: async ({ stage, explanation, priorNotes }, context) => {
    const review = getReviewContext(context?.agent?.threadId);
    if (!review) {
      throw new Error(
        'No change is loaded for this session yet. Load a pull request with ' +
          'githubGetPullRequestTool, or register a pasted diff with loadPastedDiffTool, ' +
          'before grading.',
      );
    }

    return await gradeOrientationStage({
      stage,
      explanation,
      diff: review.diff,
      prDescription: review.prDescription,
      priorNotes,
    });
  },
});

/**
 * Loads a diff the developer pasted directly (rather than choosing a PR) as the
 * session's review context. This is the pasted-diff counterpart to fetching a
 * PR: it puts the diff through the model exactly once, after which grading reads
 * it from the review context like any other change.
 */
export const loadPastedDiffTool = createTool({
  id: 'load-pasted-diff',
  description:
    'Register a unified diff the developer pasted directly (instead of choosing a pull request) as the change under review for this session. Call this once when the developer provides a raw diff; afterwards grade stages normally with gradeOrientationStageTool, which reads the diff automatically.',
  inputSchema: z.object({
    diff: z.string().describe('The unified diff the developer pasted.'),
    prDescription: z
      .string()
      .default('')
      .describe('Any description or context the developer gave for the change.'),
  }),
  outputSchema: z.object({
    loaded: z.boolean(),
    diffTruncated: z
      .boolean()
      .describe('Whether the diff was truncated because it exceeded the size limit.'),
  }),
  execute: async ({ diff, prDescription }, context) => {
    const { diff: prepared, diffTruncated } = prepareDiff(diff);
    setReviewContext(context?.agent?.threadId, { diff: prepared, prDescription });
    return { loaded: true, diffTruncated };
  },
});
