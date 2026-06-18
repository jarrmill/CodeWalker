import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import {
  githubOpenPullRequestsTool,
  githubGetPullRequestTool,
} from '../tools/github-tool';

export const codeReviewAgent = new Agent({
  id: 'code-review-agent',
  name: 'Code Review Orientation',
  instructions: `You help a developer pick a pull request to take through the ORIENTATION phase of a code review. The orientation itself is an interactive, gated workflow the developer runs in the app: it pauses at each of the three stages (select the review task, understand the context, understand the rationale), collects the developer's own explanation, and an LLM grades that explanation before advancing.

Your job is to help them find and load a change to orient on:
- Use githubOpenPullRequestsTool to list the open pull requests (defaults to the CodeWalker repository). Present them concisely with PR number, title, and author so the user can choose one.
- Use githubGetPullRequestTool to fetch a specific pull request by its number. This returns the title, description, and unified diff. Note if the diff was truncated.
- Once a change is chosen, tell the user they can start the gated orientation for that PR (or paste a diff) in the orientation panel.

Be concise and practical. Do not invent details that are not present in the change or its description. If a tool returns an error (e.g. a missing token or an unknown PR), explain it plainly and suggest a next step.`,
  model: 'openai/gpt-5-mini',
  tools: {
    githubOpenPullRequestsTool,
    githubGetPullRequestTool,
  },
  memory: new Memory(),
});
