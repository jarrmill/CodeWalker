import { registerApiRoute } from '@mastra/core/server';
import { REALTIME_ORIENTATION_INSTRUCTIONS } from './realtime-instructions';
import { getPullRequest } from '../tools/github-tool';

// The OpenAI Realtime model powering the WebRTC voice experiment. The model is
// baked into the ephemeral token here; the browser never sends it (the SDP
// handshake at /v1/realtime/calls carries no model param).
const REALTIME_MODEL = 'gpt-realtime-2.1-mini';

// Default speaker. Matches the turn-based agent's `alloy` for a consistent voice
// across the A/B variants.
const REALTIME_VOICE = 'alloy';

// The single tool the realtime model may call over the data channel. It mirrors
// githubOpenPullRequestsTool, which takes no arguments — the browser fulfills
// the call by executing that existing Mastra tool and feeding the result back
// into the session. (Fetching a specific PR's diff is seeded up front, not a
// live tool; see the plan.)
const LIST_OPEN_PRS_TOOL = {
  type: 'function',
  name: 'list_open_prs',
  description:
    'List the open pull requests in the CodeWalker repository so the developer can choose one to orient on. Takes no arguments.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
} as const;

/**
 * When the developer picked a PR before connecting, fetch it and fold it into
 * the session instructions so the conversation opens already knowing the
 * change — no live tool round-trip. Returns the base instructions unchanged if
 * no PR was chosen, or a plain note if the fetch fails (better than aborting
 * the whole session over a bad PR number).
 */
async function buildInstructions(pullNumber: number | undefined): Promise<string> {
  if (!pullNumber) return REALTIME_ORIENTATION_INSTRUCTIONS;

  try {
    const pr = await getPullRequest({ pullNumber });
    const truncatedNote = pr.diffTruncated
      ? '\n\n(Note: the diff was truncated — keep that limitation in mind.)'
      : '';
    return `${REALTIME_ORIENTATION_INSTRUCTIONS}

## The change already loaded for this session
The developer has already selected a pull request to orient on, so open the conversation already knowing it: greet them briefly and dive straight into orienting on this change. Do NOT call list_open_prs unless they ask to look at something else.

PR #${pr.number}: ${pr.title}
Author: ${pr.author ?? 'unknown'}
Description:
${pr.description?.trim() || '(no description provided)'}

Unified diff:
${pr.diff}${truncatedNote}`;
  } catch (e: any) {
    // Don't fail the session — let the model recover by listing PRs instead.
    return `${REALTIME_ORIENTATION_INSTRUCTIONS}

## Note
The developer tried to load pull request #${pullNumber}, but fetching it failed (${e?.message ?? 'unknown error'}). Apologize briefly, and offer to list the open pull requests with list_open_prs so they can pick one.`;
  }
}

/**
 * Mints a short-lived ephemeral session for the browser's WebRTC connection to
 * the OpenAI Realtime API. The long-lived OPENAI_API_KEY stays server-side; the
 * browser only ever sees the ephemeral secret (which OpenAI expires in ~60s, so
 * the client requests this right before connecting).
 *
 * The full session config — model, voice, instructions, tools — is set here at
 * mint time, since none of it can be changed from the browser SDP handshake.
 *
 * Inherits the server's Supabase auth (requiresAuth defaults true), so the
 * frontend sends the same Bearer token it uses for chat and /voice/*.
 *
 *   POST /realtime/session -> { value: "ek_...", expires_at, ... }
 */
export const realtimeRoutes = [
  registerApiRoute('/realtime/session', {
    method: 'POST',
    handler: async (c) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return c.json({ error: 'OPENAI_API_KEY is not configured' }, 500);
      }

      // Optional: a PR the developer picked before connecting, seeded into the
      // session instructions up front.
      const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
      const rawPull = (body as { pullNumber?: unknown }).pullNumber;
      const pullNumber = typeof rawPull === 'number' && Number.isFinite(rawPull) ? rawPull : undefined;
      const instructions = await buildInstructions(pullNumber);

      const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model: REALTIME_MODEL,
            instructions,
            audio: {
              // Transcribe the developer's own speech so the UI can show both
              // sides of the conversation. whisper-1 is what this project
              // already uses for the turn-based /voice/transcribe route.
              input: { transcription: { model: 'whisper-1' } },
              output: { voice: REALTIME_VOICE },
            },
            tools: [LIST_OPEN_PRS_TOOL],
          },
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        c.get('mastra')?.getLogger?.()?.error?.('Failed to mint realtime session', {
          status: res.status,
          detail,
        });
        return c.json({ error: 'Failed to mint realtime session', detail }, 502);
      }

      // Pass the ephemeral secret straight back to the browser. `value` holds
      // the ek_... token used as the Bearer for the WebRTC SDP handshake.
      const data = await res.json();
      return c.json(data);
    },
  }),
];
