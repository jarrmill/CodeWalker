
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStore } from '@mastra/pg';
import { MastraAuthSupabase } from '@mastra/auth-supabase';
import { VercelDeployer } from '@mastra/deployer-vercel';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { BraintrustExporter } from '@mastra/braintrust';
import { chatRoute } from '@mastra/ai-sdk';
import { voiceRoutes } from './server/voice-routes';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { shortcutAgent } from './agents/shortcut-agent';
import { githubAgent } from './agents/github-agent';
import { orientationGraderAgent } from './agents/orientation-grader';
import { codeReviewAgent } from './agents/code-review-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import { orientationGradeAccuracyScorer } from './scorers/orientation-grader-scorer';
import { shortcutMyTicketsTool, shortcutGetStoryTool } from './tools/shortcut-tool';
import { githubOpenPullRequestsTool, githubGetPullRequestTool } from './tools/github-tool';
import { gradeOrientationStageTool } from './tools/orientation-grader-tool';

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: {
    weatherAgent,
    shortcutAgent,
    githubAgent,
    orientationGraderAgent,
    codeReviewAgent,
  },
  tools: {
    shortcutMyTicketsTool,
    shortcutGetStoryTool,
    githubOpenPullRequestsTool,
    githubGetPullRequestTool,
    gradeOrientationStageTool,
  },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer, orientationGradeAccuracyScorer },
  storage: new PostgresStore({
    id: 'mastra-storage',
    connectionString: process.env.DATABASE_URL!,
    // Supabase's pooler serves a cert Node doesn't have in its trust store,
    // which fails the default verify-full check. Encrypt without chain verification.
    ssl: { rejectUnauthorized: false },
  }),
  deployer: new VercelDeployer(),
  server: {
    // Only guard the server in production. Locally, `mastra dev` runs with
    // NODE_ENV unset/development so Studio (the playground UI) loads without a
    // Supabase token. In production the frontend supplies a Bearer token.
    auth:
      process.env.NODE_ENV === 'production'
        ? new MastraAuthSupabase({
            url: process.env.SUPABASE_URL,
            anonKey: process.env.SUPABASE_ANON_KEY,
          })
        : undefined,
    apiRoutes: [
      chatRoute({ path: '/chat', agent: 'githubAgent', version: 'v6' }),
      chatRoute({ path: '/code-review-chat', agent: 'codeReviewAgent', version: 'v6' }),
      ...voiceRoutes,
    ],
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
          // Sends traces to Braintrust for observability (only when BRAINTRUST_API_KEY is set)
          ...(process.env.BRAINTRUST_API_KEY
            ? [
                new BraintrustExporter({
                  apiKey: process.env.BRAINTRUST_API_KEY,
                  projectName: process.env.BRAINTRUST_PROJECT_NAME ?? 'codewalker',
                }),
              ]
            : []),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
