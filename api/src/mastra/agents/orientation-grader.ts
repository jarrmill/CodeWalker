import { Agent } from '@mastra/core/agent';
import { z } from 'zod';

/**
 * The standalone orientation grader.
 *
 * This module intentionally has no dependency on the chat agent, the tool
 * layer, or a running Mastra server. `gradeOrientationStage` is a near-pure
 * function of (stage, diff, prDescription, explanation) -> verdict, so it can
 * be imported directly by an eval harness and run against a labelled dataset.
 * The chat agent reaches the same function through `gradeOrientationStageTool`.
 */

export const orientationStages = [
  'select-task',
  'understand-context',
  'understand-rationale',
] as const;

export type OrientationStage = (typeof orientationStages)[number];

// The verdict shape. Structured so evals can assert on it deterministically
// (understood / score / missingPoints) instead of parsing prose.
export const gateGradeSchema = z.object({
  understood: z
    .boolean()
    .describe("Whether the user's explanation shows sufficient understanding for this stage."),
  score: z.number().min(0).max(1).describe('How well the user understood this stage (0-1).'),
  feedback: z
    .string()
    .describe(
      'Coaching shown to the user. If not understood, what to reconsider; if understood, a brief confirmation.',
    ),
  missingPoints: z
    .array(z.string())
    .describe('Specific things the user missed or got wrong in their explanation.'),
  notes: z
    .array(z.string())
    .describe('Confirmed facts about the change, contributing to the overall review story.'),
});

export type GateGrade = z.infer<typeof gateGradeSchema>;

interface StageRubric {
  title: string;
  // The bullet list of what the user must demonstrate to be understood=true.
  criteria: string;
}

// One rubric per stage. Extracted from the original per-stage gate agents so a
// single grader can judge any stage — and so the criteria live in one place
// that both the grader and the eval dataset can reference.
export const stageRubrics: Record<OrientationStage, StageRubric> = {
  'select-task': {
    title: 'Select the review task',
    criteria: `- What the change is and how focused or large its scope is.
- Which files or components it touches.
- That the scope and expectations are clear enough to begin a review.`,
  },
  'understand-context': {
    title: 'Understand the context',
    criteria: `- Who authored the change and in what repository.
- The programming language(s) involved.
- The type of change (feature, bug fix, refactor, docs, chore, ...).`,
  },
  'understand-rationale': {
    title: 'Understand the rationale (the "why")',
    criteria: `- What the change is trying to do.
- Why it is being made, supported by the commit message, PR/issue description, requirements, or the diff itself.`,
  },
};

export const orientationGraderAgent = new Agent({
  id: 'orientation-grader-agent',
  name: 'Orientation Grader',
  instructions: `You grade whether a developer's explanation demonstrates understanding of ONE orientation stage of a code review. Orientation is building an understanding of a change before critiquing it.

You are given the stage and its rubric, the diff, the PR description, and the developer's explanation. Judge ONLY the developer's explanation against the stage rubric — never grade, critique, or improve the change itself; that happens later, in the review proper.

- Set understood=true only when the explanation covers the rubric points for this stage. Partial or confidently-wrong explanations are understood=false.
- score is a 0-1 measure of how completely the explanation meets the rubric, independent of understood.
- Put concrete things the developer missed or got wrong in missingPoints.
- Put short, specific, actionable coaching in feedback. If understood, a brief confirmation instead.
- Put confirmed facts the developer got right in notes — these accumulate into the running "story" of the change that later stages rely on.
- Do not invent details that are not present in the diff or its description. If the explanation is blank, understood=false with feedback inviting an attempt.`,
  model: 'openai/gpt-5-mini',
});

export interface GradeOrientationStageInput {
  stage: OrientationStage;
  diff: string;
  explanation: string;
  prDescription?: string;
  // Facts confirmed in earlier stages, carried forward so the grader can build
  // on the running story rather than re-establishing it.
  priorNotes?: string[];
}

function buildGradePrompt(input: GradeOrientationStageInput): string {
  const rubric = stageRubrics[input.stage];
  const known = input.priorNotes?.length
    ? `\n\nEstablished in earlier stages:\n${input.priorNotes.join('\n')}`
    : '';

  return `Stage being graded: ${rubric.title}

To be understood, the explanation must demonstrate:
${rubric.criteria}${known}

PR description:
${input.prDescription || '(none provided)'}

Diff:
${input.diff}

The developer's explanation to grade:
${input.explanation || '(the developer left this blank)'}

Grade ONLY whether the explanation demonstrates understanding for this stage. Do not grade the change itself.`;
}

/**
 * Grade a single orientation stage. This is the unit under eval: feed it fixtures
 * from a labelled dataset and assert on the returned verdict (understood / score /
 * missingPoints). The chat agent calls this via `gradeOrientationStageTool`.
 */
export async function gradeOrientationStage(
  input: GradeOrientationStageInput,
): Promise<GateGrade> {
  const { object } = await orientationGraderAgent.generate(buildGradePrompt(input), {
    structuredOutput: { schema: gateGradeSchema },
  });

  return object;
}
