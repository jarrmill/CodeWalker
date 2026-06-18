import { Agent } from '@mastra/core/agent';

export const selectTaskAgent = new Agent({
  id: 'select-task-agent',
  name: 'Select Review Task',
  instructions: `You handle the FIRST orientation stage of a code review: deciding whether enough is known to START reviewing this change.

Judge readiness based on:
- The size and scope of the change (how many files / lines, how focused it is).
- Which codebase or component it touches.
- Continuous integration (CI) status, if mentioned.
- Priority and urgency, if mentioned.

Set criteriaMet=true only when the scope and expectations are clear enough to begin a review.
List anything still missing in missingInfo. Capture concrete facts you learned in notes.
Keep reasoning short.`,
  model: 'openai/gpt-5-mini',
});

export const understandContextAgent = new Agent({
  id: 'understand-context-agent',
  name: 'Understand Context',
  instructions: `You handle the SECOND orientation stage of a code review: deciding whether the CONTEXT of the change is understood.

Judge whether you understand:
- The change author and the repository.
- The programming language(s) involved.
- The type of change (bug fix, feature, refactor, docs, chore, etc.).

Set criteriaMet=true when the context is sufficient to correctly interpret the change.
List anything still missing in missingInfo. Capture concrete facts you learned in notes.
Keep reasoning short.`,
  model: 'openai/gpt-5-mini',
});

export const understandRationaleAgent = new Agent({
  id: 'understand-rationale-agent',
  name: 'Understand Rationale',
  instructions: `You handle the THIRD orientation stage of a code review: deciding whether the RATIONALE (the why) of the change is understood.

Judge whether you can state, from the commit message, PR/issue description, requirements, or discussion:
- What the change is trying to do.
- Why it is being made.

Set criteriaMet=true when you can clearly articulate the goal and motivation of the change.
List anything still missing in missingInfo. Capture concrete facts you learned in notes.
Keep reasoning short.`,
  model: 'openai/gpt-5-mini',
});
