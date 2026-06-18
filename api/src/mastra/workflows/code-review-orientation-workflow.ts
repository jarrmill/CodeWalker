import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export const gateDecisionSchema = z.object({
  criteriaMet: z
    .boolean()
    .describe('Whether enough is known to consider this stage satisfied and advance.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence (0-1) in the criteriaMet judgment.'),
  missingInfo: z
    .array(z.string())
    .describe('Specific pieces of information still needed to fully satisfy this stage.'),
  notes: z
    .array(z.string())
    .describe('Facts learned during this stage, contributing to the overall review story.'),
  reasoning: z.string().describe('Short explanation for the criteriaMet judgment.'),
});

export const orientationInputSchema = z.object({
  diff: z.string().describe('The code change / diff under review.'),
  prDescription: z
    .string()
    .default('')
    .describe('PR description, commit message, or any context about the change.'),
});

export const orientationStateSchema = z.object({
  diff: z.string(),
  prDescription: z.string(),
  notes: z.array(z.string()),
  stages: z.object({
    selectTask: gateDecisionSchema.optional(),
    understandContext: gateDecisionSchema.optional(),
    understandRationale: gateDecisionSchema.optional(),
  }),
  readyForAnalysis: z.boolean(),
});

type OrientationState = z.infer<typeof orientationStateSchema>;

function buildPrompt(state: { diff: string; prDescription: string; notes: string[] }): string {
  const known = state.notes.length ? `\n\nKnown so far:\n${state.notes.join('\n')}` : '';
  return `PR description:\n${state.prDescription || '(none provided)'}${known}\n\nDiff:\n${state.diff}`;
}

const selectTaskStep = createStep({
  id: 'select-task',
  description: 'Decide whether enough is known to start reviewing this change.',
  inputSchema: orientationInputSchema,
  outputSchema: orientationStateSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra!.getAgent('selectTaskAgent');
    const { object } = await agent.generate(buildPrompt({ ...inputData, notes: [] }), {
      structuredOutput: { schema: gateDecisionSchema },
    });

    return {
      diff: inputData.diff,
      prDescription: inputData.prDescription,
      notes: object.notes,
      stages: { selectTask: object },
      readyForAnalysis: false,
    } satisfies OrientationState;
  },
});

const understandContextStep = createStep({
  id: 'understand-context',
  description: 'Decide whether the context of the change is understood.',
  inputSchema: orientationStateSchema,
  outputSchema: orientationStateSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra!.getAgent('understandContextAgent');
    const { object } = await agent.generate(buildPrompt(inputData), {
      structuredOutput: { schema: gateDecisionSchema },
    });

    return {
      ...inputData,
      notes: [...inputData.notes, ...object.notes],
      stages: { ...inputData.stages, understandContext: object },
      readyForAnalysis: false,
    } satisfies OrientationState;
  },
});

const understandRationaleStep = createStep({
  id: 'understand-rationale',
  description: 'Decide whether the rationale (the why) of the change is understood.',
  inputSchema: orientationStateSchema,
  outputSchema: orientationStateSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra!.getAgent('understandRationaleAgent');
    const { object } = await agent.generate(buildPrompt(inputData), {
      structuredOutput: { schema: gateDecisionSchema },
    });

    const stages = { ...inputData.stages, understandRationale: object };
    const readyForAnalysis = Boolean(
      stages.selectTask?.criteriaMet &&
        stages.understandContext?.criteriaMet &&
        stages.understandRationale?.criteriaMet,
    );

    return {
      ...inputData,
      notes: [...inputData.notes, ...object.notes],
      stages,
      readyForAnalysis,
    } satisfies OrientationState;
  },
});

export const codeReviewOrientationWorkflow = createWorkflow({
  id: 'code-review-orientation-workflow',
  inputSchema: orientationInputSchema,
  outputSchema: orientationStateSchema,
})
  .then(selectTaskStep)
  .then(understandContextStep)
  .then(understandRationaleStep);

codeReviewOrientationWorkflow.commit();
