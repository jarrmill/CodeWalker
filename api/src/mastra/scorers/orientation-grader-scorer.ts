import { z } from 'zod';
import { createScorer } from '@mastra/core/evals';
import { gateGradeSchema } from '../agents/orientation-grader';

/**
 * Supervised accuracy scorer for the orientation grader.
 *
 * Scores a single grade against its labelled expectation: 1 when the grader's
 * `understood` verdict matches `groundTruth.expectedUnderstood`, else 0.
 * Deterministic (no LLM judge) — the judgment being measured is the grader's,
 * not the scorer's. Aggregated over the labelled dataset, the mean score is
 * classification accuracy; the eval runner derives precision/recall/F1 from the
 * per-case results.
 */

// The grading request that produced the verdict — carried for readable reasons.
const gradeRequestSchema = z.object({
  stage: z.string(),
  explanation: z.string(),
});

export const orientationGradeAccuracyScorer = createScorer({
  id: 'orientation-grade-accuracy',
  name: 'Orientation Grade Accuracy',
  description:
    "Checks whether the grader's understood verdict matches the labelled expectation. Mean over a dataset = classification accuracy.",
  type: { input: gradeRequestSchema, output: gateGradeSchema },
})
  .generateScore(({ run }) => {
    const expected = (run.groundTruth as { expectedUnderstood?: boolean } | undefined)
      ?.expectedUnderstood;
    if (typeof expected !== 'boolean') {
      throw new Error(
        'orientationGradeAccuracyScorer requires groundTruth.expectedUnderstood (boolean).',
      );
    }
    return run.output?.understood === expected ? 1 : 0;
  })
  .generateReason(({ run, score }) => {
    const expected = (run.groundTruth as { expectedUnderstood?: boolean } | undefined)
      ?.expectedUnderstood;
    const actual = run.output?.understood;
    const verdict = score === 1 ? 'correct' : 'MISCLASSIFIED';
    return `[${run.input?.stage}] ${verdict}: grader understood=${actual}, expected=${expected}.`;
  });
