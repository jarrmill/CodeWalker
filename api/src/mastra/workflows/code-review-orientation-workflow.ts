import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

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

export const orientationInputSchema = z.object({
  diff: z.string().describe('The code change / diff under review.'),
  prDescription: z
    .string()
    .default('')
    .describe('PR description, commit message, or any context about the change.'),
});

const stageResultSchema = gateGradeSchema.extend({
  explanation: z.string().describe("The user's explanation that was accepted for this stage."),
  attempts: z.number().describe('How many attempts the user needed to pass this stage.'),
});

export const orientationStateSchema = z.object({
  diff: z.string(),
  prDescription: z.string(),
  notes: z.array(z.string()),
  stages: z.object({
    selectTask: stageResultSchema.optional(),
    understandContext: stageResultSchema.optional(),
    understandRationale: stageResultSchema.optional(),
  }),
  readyForAnalysis: z.boolean(),
});

type OrientationState = z.infer<typeof orientationStateSchema>;

// Payload handed to the UI while a stage is paused for input.
const gateSuspendSchema = z.object({
  stage: z.string(),
  question: z.string(),
  attempt: z.number(),
  previousFeedback: z.string().optional(),
  previousScore: z.number().optional(),
  scoreHistory: z.array(z.number()).optional(),
  missingPoints: z.array(z.string()).optional(),
});

// What the UI sends back when resuming a paused stage.
const gateResumeSchema = z.object({
  explanation: z.string().describe("The user's explanation of this stage."),
  giveUp: z
    .boolean()
    .default(false)
    .describe('Set true to stop trying this stage and advance with the latest grade.'),
});

const initStep = createStep({
  id: 'init',
  inputSchema: orientationInputSchema,
  outputSchema: orientationStateSchema,
  execute: async ({ inputData }) =>
    ({
      diff: inputData.diff,
      prDescription: inputData.prDescription,
      notes: [],
      stages: {},
      readyForAnalysis: false,
    }) satisfies OrientationState,
});

function buildGradePrompt(state: OrientationState, question: string, explanation: string): string {
  const known = state.notes.length ? `\n\nEstablished so far:\n${state.notes.join('\n')}` : '';
  return `Stage question the user was answering:\n${question}${known}

PR description:
${state.prDescription || '(none provided)'}

Diff:
${state.diff}

The user's explanation to grade:
${explanation || '(the user left this blank)'}

Grade ONLY whether the user's explanation demonstrates understanding for this stage. Do not grade the change itself.`;
}

function createOrientationGate(opts: {
  id: string;
  agentName: string;
  stageKey: keyof OrientationState['stages'];
  question: string;
  isFinal?: boolean;
}) {
  return createStep({
    id: opts.id,
    inputSchema: orientationStateSchema,
    outputSchema: orientationStateSchema,
    resumeSchema: gateResumeSchema,
    suspendSchema: gateSuspendSchema,
    execute: async ({ inputData, resumeData, suspend, suspendData, mastra, runId }) => {
      const attempt = (suspendData?.attempt ?? 0) + 1;

      // First entry into the stage: pause and ask the user to explain it.
      if (!resumeData) {
        return await suspend({ stage: opts.id, question: opts.question, attempt });
      }

      const { explanation, giveUp } = resumeData;
      const logger = mastra!.getLogger();

      // PII-safe: log the size of the explanation, never its contents.
      logger.info('[orientation] explanation submitted for grading', {
        runId,
        stage: opts.id,
        attempt,
        giveUp,
        explanationChars: explanation.length,
      });

      const agent = mastra!.getAgent(opts.agentName);
      const { object: grade } = await agent.generate(
        buildGradePrompt(inputData, opts.question, explanation),
        { structuredOutput: { schema: gateGradeSchema } },
      );

      // PII-safe: log the verdict and how many points were missed, not their text.
      logger.info('[orientation] grade received', {
        runId,
        stage: opts.id,
        attempt,
        understood: grade.understood,
        score: grade.score,
        missingPointsCount: grade.missingPoints.length,
      });

      // Not there yet and the user wants another go: pause again with coaching.
      if (!grade.understood && !giveUp) {
        const scoreHistory = [...(suspendData?.scoreHistory ?? []), grade.score];
        return await suspend({
          stage: opts.id,
          question: opts.question,
          attempt: attempt + 1,
          previousFeedback: grade.feedback,
          previousScore: grade.score,
          scoreHistory,
          missingPoints: grade.missingPoints,
        });
      }

      const stages = {
        ...inputData.stages,
        [opts.stageKey]: { ...grade, explanation, attempts: attempt },
      };

      const readyForAnalysis = opts.isFinal
        ? Boolean(
            stages.selectTask?.understood &&
              stages.understandContext?.understood &&
              stages.understandRationale?.understood,
          )
        : false;

      return {
        ...inputData,
        notes: [...inputData.notes, ...grade.notes],
        stages,
        readyForAnalysis,
      } satisfies OrientationState;
    },
  });
}

const selectTaskStep = createOrientationGate({
  id: 'select-task',
  agentName: 'selectTaskAgent',
  stageKey: 'selectTask',
  question:
    'In your own words, what is this change and is its scope clear enough to start reviewing? Which files or components does it touch?',
});

const understandContextStep = createOrientationGate({
  id: 'understand-context',
  agentName: 'understandContextAgent',
  stageKey: 'understandContext',
  question:
    'Explain the context of this change: who authored it and in what repository, the language(s) involved, and what type of change it is (feature, fix, refactor, docs, chore, ...).',
});

const understandRationaleStep = createOrientationGate({
  id: 'understand-rationale',
  agentName: 'understandRationaleAgent',
  stageKey: 'understandRationale',
  question:
    'Explain the rationale of this change: what is it trying to do, and why is it being made?',
  isFinal: true,
});

export const codeReviewOrientationWorkflow = createWorkflow({
  id: 'code-review-orientation-workflow',
  inputSchema: orientationInputSchema,
  outputSchema: orientationStateSchema,
})
  .then(initStep)
  .then(selectTaskStep)
  .then(understandContextStep)
  .then(understandRationaleStep);

codeReviewOrientationWorkflow.commit();
