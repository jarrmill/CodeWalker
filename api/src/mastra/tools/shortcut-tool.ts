import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const SHORTCUT_API_BASE = 'https://api.app.shortcut.com';

interface MemberInfo {
  id: string;
  mention_name: string;
  name: string;
}

interface StorySearchResult {
  id: number;
  name: string;
  app_url: string;
  story_type: string;
  archived: boolean;
  completed: boolean;
  started: boolean;
  blocked: boolean;
  workflow_state_id?: number;
  epic_id?: number | null;
  iteration_id?: number | null;
  estimate?: number | null;
  deadline?: string | null;
  updated_at?: string;
  created_at?: string;
}

interface StorySearchResults {
  total: number;
  data: StorySearchResult[];
  next: string | null;
}

interface Story {
  id: number;
  name: string;
  description?: string;
  app_url: string;
  story_type: string;
  archived: boolean;
  completed: boolean;
  started: boolean;
  blocked: boolean;
  blocker: boolean;
  estimate?: number | null;
  deadline?: string | null;
  workflow_id?: number;
  workflow_state_id?: number;
  epic_id?: number | null;
  iteration_id?: number | null;
  group_id?: string | null;
  requested_by_id?: string;
  owner_ids?: string[];
  label_ids?: number[];
  created_at?: string | null;
  updated_at?: string | null;
}

function getShortcutHeaders(): Record<string, string> {
  const token = process.env.SHORTCUT_TOKEN;
  if (!token) {
    throw new Error('SHORTCUT_TOKEN environment variable is not set.');
  }
  return {
    'Content-Type': 'application/json',
    'Shortcut-Token': token,
  };
}

const storySchema = z.object({
  id: z.number(),
  name: z.string(),
  appUrl: z.string(),
  storyType: z.string(),
  archived: z.boolean(),
  completed: z.boolean(),
  started: z.boolean(),
  blocked: z.boolean(),
  workflowStateId: z.number().nullable(),
  epicId: z.number().nullable(),
  iterationId: z.number().nullable(),
  estimate: z.number().nullable(),
  deadline: z.string().nullable(),
  updatedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});

export const shortcutMyTicketsTool = createTool({
  id: 'get-my-shortcut-tickets',
  description:
    'Fetch all Shortcut stories (tickets) owned by / assigned to the authenticated user. Resolves the current member automatically and paginates through every matching story.',
  inputSchema: z.object({
    includeArchived: z
      .boolean()
      .default(false)
      .describe('When true, include archived stories in the results.'),
    additionalQuery: z
      .string()
      .optional()
      .describe(
        'Optional extra Shortcut search operators to AND with the owner filter, e.g. "state:\\"In Progress\\"" or "!is:done".',
      ),
    detail: z
      .enum(['full', 'slim'])
      .default('slim')
      .describe('Amount of detail returned per story from the Shortcut search API.'),
  }),
  outputSchema: z.object({
    mentionName: z.string(),
    total: z.number(),
    stories: z.array(storySchema),
  }),
  execute: async (inputData) => {
    return await getMyTickets(inputData);
  },
});

const getMyTickets = async ({
  includeArchived,
  additionalQuery,
  detail,
}: {
  includeArchived: boolean;
  additionalQuery?: string;
  detail: 'full' | 'slim';
}) => {
  const headers = getShortcutHeaders();

  const memberResponse = await fetch(`${SHORTCUT_API_BASE}/api/v3/member`, { headers });
  if (!memberResponse.ok) {
    throw new Error(
      `Failed to fetch current member info: ${memberResponse.status} ${memberResponse.statusText}`,
    );
  }
  const member = (await memberResponse.json()) as MemberInfo;
  const mentionName = member.mention_name;

  const queryParts = [`owner:${mentionName}`];
  if (!includeArchived) {
    queryParts.push('!is:archived');
  }
  if (additionalQuery?.trim()) {
    queryParts.push(additionalQuery.trim());
  }
  const query = queryParts.join(' ');

  const stories: StorySearchResult[] = [];
  let total = 0;

  let nextPath: string | null = `/api/v3/search/stories?${new URLSearchParams({
    query,
    page_size: '250',
    detail,
  }).toString()}`;

  while (nextPath) {
    const pageResponse = await fetch(`${SHORTCUT_API_BASE}${nextPath}`, { headers });
    if (!pageResponse.ok) {
      throw new Error(
        `Failed to search stories: ${pageResponse.status} ${pageResponse.statusText}`,
      );
    }
    const page = (await pageResponse.json()) as StorySearchResults;
    total = page.total;
    stories.push(...page.data);
    nextPath = page.next;
  }

  return {
    mentionName,
    total,
    stories: stories.map((story) => ({
      id: story.id,
      name: story.name,
      appUrl: story.app_url,
      storyType: story.story_type,
      archived: story.archived,
      completed: story.completed,
      started: story.started,
      blocked: story.blocked,
      workflowStateId: story.workflow_state_id ?? null,
      epicId: story.epic_id ?? null,
      iterationId: story.iteration_id ?? null,
      estimate: story.estimate ?? null,
      deadline: story.deadline ?? null,
      updatedAt: story.updated_at ?? null,
      createdAt: story.created_at ?? null,
    })),
  };
};

export const shortcutGetStoryTool = createTool({
  id: 'get-shortcut-story',
  description:
    'Fetch a single Shortcut story (ticket) by its numeric public ID, returning its full details.',
  inputSchema: z.object({
    storyId: z.number().int().describe('The numeric public ID of the Shortcut story to fetch.'),
  }),
  outputSchema: z.object({
    id: z.number(),
    name: z.string(),
    description: z.string().nullable(),
    appUrl: z.string(),
    storyType: z.string(),
    archived: z.boolean(),
    completed: z.boolean(),
    started: z.boolean(),
    blocked: z.boolean(),
    blocker: z.boolean(),
    estimate: z.number().nullable(),
    deadline: z.string().nullable(),
    workflowId: z.number().nullable(),
    workflowStateId: z.number().nullable(),
    epicId: z.number().nullable(),
    iterationId: z.number().nullable(),
    groupId: z.string().nullable(),
    requestedById: z.string().nullable(),
    ownerIds: z.array(z.string()),
    labelIds: z.array(z.number()),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  }),
  execute: async (inputData) => {
    return await getStory(inputData.storyId);
  },
});

const getStory = async (storyId: number) => {
  const headers = getShortcutHeaders();

  const response = await fetch(`${SHORTCUT_API_BASE}/api/v3/stories/${storyId}`, { headers });
  if (response.status === 404) {
    throw new Error(`Shortcut story ${storyId} was not found.`);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch story ${storyId}: ${response.status} ${response.statusText}`);
  }

  const story = (await response.json()) as Story;

  return {
    id: story.id,
    name: story.name,
    description: story.description ?? null,
    appUrl: story.app_url,
    storyType: story.story_type,
    archived: story.archived,
    completed: story.completed,
    started: story.started,
    blocked: story.blocked,
    blocker: story.blocker,
    estimate: story.estimate ?? null,
    deadline: story.deadline ?? null,
    workflowId: story.workflow_id ?? null,
    workflowStateId: story.workflow_state_id ?? null,
    epicId: story.epic_id ?? null,
    iterationId: story.iteration_id ?? null,
    groupId: story.group_id ?? null,
    requestedById: story.requested_by_id ?? null,
    ownerIds: story.owner_ids ?? [],
    labelIds: story.label_ids ?? [],
    createdAt: story.created_at ?? null,
    updatedAt: story.updated_at ?? null,
  };
};
