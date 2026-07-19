/**
 * Per-thread store of the change currently under review — its diff and
 * description. Populated when a pull request is fetched or a raw diff is pasted,
 * and read by the orientation grader tool.
 *
 * Why this exists: a diff can be tens of thousands of tokens. Routing it through
 * the chat model as grade-tool arguments made the model re-emit the whole diff
 * on every grade turn — slow, expensive, and error-prone (it sometimes sent an
 * empty diff, grading blind). Keeping the diff server-side, keyed by the memory
 * thread, means it travels through the model exactly once (when the change is
 * loaded) and the grader reads it directly.
 *
 * Where it lives: on the memory thread's `metadata`, under a dedicated key that
 * is deliberately NOT Mastra's reserved `workingMemory` metadata key (whose
 * contents get folded into the system prompt). So the diff persists in the same
 * Postgres store as the conversation — surviving restarts and, on serverless,
 * routing across instances — without ever re-entering the model's context. If
 * the thread or its review context is missing, the grader tool surfaces a clear
 * error and the agent reloads the change.
 */
import type { MastraMemory } from '@mastra/core/memory';

// The thread-metadata key our review context lives under. Deliberately distinct
// from Mastra's reserved `workingMemory` key, whose contents are injected into
// the model's context — the whole point here is to keep the diff OUT of it.
const REVIEW_CONTEXT_METADATA_KEY = 'codeReviewContext';

export interface ReviewContext {
  diff: string;
  prDescription: string;
}

/**
 * The slice of a tool's execution context these helpers need to reach the
 * memory thread. Kept structural (rather than importing the heavily-generic
 * ToolExecutionContext) so it stays stable across @mastra/core versions and so
 * the generic `getAgentById` signature doesn't leak into every call site.
 */
export interface ReviewToolContext {
  mastra?: {
    getAgentById: (id: string) => { getMemory: () => Promise<MastraMemory | undefined> } | undefined;
  };
  agent?: {
    agentId?: string;
    threadId?: string;
    resourceId?: string;
  };
}

/**
 * Resolve the Memory belonging to the agent that is currently executing — the
 * one Mastra wired to the shared Postgres store. Returns undefined if we can't
 * get there (no agent id, no memory), so callers can degrade gracefully rather
 * than throw mid-tool.
 */
async function resolveMemory(context: ReviewToolContext): Promise<MastraMemory | undefined> {
  const agentId = context.agent?.agentId;
  if (!agentId) {
    return undefined;
  }
  const agent = context.mastra?.getAgentById(agentId);
  return agent ? await agent.getMemory() : undefined;
}

/**
 * Record the change under review on its memory thread. No-ops without a
 * threadId (nothing to key on) or when memory is unavailable, rather than
 * throwing from inside a tool.
 */
export async function setReviewContext(
  context: ReviewToolContext,
  review: ReviewContext,
): Promise<void> {
  const threadId = context.agent?.threadId;
  if (!threadId) {
    return;
  }
  const memory = await resolveMemory(context);
  if (!memory) {
    return;
  }

  const existing = await memory.getThreadById({ threadId });
  // Merge into any existing metadata so we don't clobber other keys stored
  // there (e.g. Mastra's own thread bookkeeping).
  const metadata = { ...(existing?.metadata ?? {}), [REVIEW_CONTEXT_METADATA_KEY]: review };

  if (existing) {
    await memory.updateThread({ id: threadId, title: existing.title ?? '', metadata });
    return;
  }

  // No thread persisted yet (e.g. a tool invoked before the first message was
  // saved). Create it so the review context has somewhere to live. Creating a
  // thread requires a resourceId; without one there's nothing we can key on.
  const resourceId = context.agent?.resourceId;
  if (!resourceId) {
    return;
  }
  const now = new Date();
  await memory.saveThread({
    thread: { id: threadId, resourceId, metadata, createdAt: now, updatedAt: now },
  });
}

/** Read the change under review for this thread, or undefined if none is loaded. */
export async function getReviewContext(
  context: ReviewToolContext,
): Promise<ReviewContext | undefined> {
  const threadId = context.agent?.threadId;
  if (!threadId) {
    return undefined;
  }
  const memory = await resolveMemory(context);
  if (!memory) {
    return undefined;
  }

  const thread = await memory.getThreadById({ threadId });
  const stored = thread?.metadata?.[REVIEW_CONTEXT_METADATA_KEY] as ReviewContext | undefined;
  if (!stored) {
    return undefined;
  }
  return { diff: stored.diff, prDescription: stored.prDescription };
}
