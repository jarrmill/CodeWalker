
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStore } from '@mastra/pg';
import { MastraAuthSupabase } from '@mastra/auth-supabase';
import { VercelDeployer } from '@mastra/deployer-vercel';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { chatRoute } from '@mastra/ai-sdk';
import { weatherWorkflow } from './workflows/weather-workflow';
import { codeReviewOrientationWorkflow } from './workflows/code-review-orientation-workflow';
import { weatherAgent } from './agents/weather-agent';
import { shortcutAgent } from './agents/shortcut-agent';
import { githubAgent } from './agents/github-agent';
import {
  selectTaskAgent,
  understandContextAgent,
  understandRationaleAgent,
} from './agents/code-review-gates';
import { codeReviewAgent } from './agents/code-review-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import { shortcutMyTicketsTool, shortcutGetStoryTool } from './tools/shortcut-tool';
import { githubOpenPullRequestsTool, githubGetPullRequestTool } from './tools/github-tool';
import { runCodeReviewOrientationTool } from './tools/code-review-tool';

export const mastra = new Mastra({
  workflows: { weatherWorkflow, codeReviewOrientationWorkflow },
  agents: {
    weatherAgent,
    shortcutAgent,
    githubAgent,
    selectTaskAgent,
    understandContextAgent,
    understandRationaleAgent,
    codeReviewAgent,
  },
  tools: {
    shortcutMyTicketsTool,
    shortcutGetStoryTool,
    githubOpenPullRequestsTool,
    githubGetPullRequestTool,
    runCodeReviewOrientationTool,
  },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  storage: new PostgresStore({
    id: 'mastra-storage',
    connectionString: process.env.DATABASE_URL!,
    // Supabase's pooler serves a cert Node doesn't have in its trust store,
    // which fails the default verify-full check. Encrypt without chain verification.
    ssl: { rejectUnauthorized: false },
  }),
  deployer: new VercelDeployer(),
  server: {
    auth: new MastraAuthSupabase({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
    }),
    apiRoutes: [
      chatRoute({ path: '/chat', agent: 'githubAgent', version: 'v6' }),
      chatRoute({ path: '/code-review-chat', agent: 'codeReviewAgent', version: 'v6' }),
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
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
