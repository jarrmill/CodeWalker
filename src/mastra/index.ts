
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStore } from '@mastra/pg';
import { MastraAuthSupabase } from '@mastra/auth-supabase';
import { VercelDeployer } from '@mastra/deployer-vercel';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { shortcutAgent } from './agents/shortcut-agent';
import { githubAgent } from './agents/github-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import { shortcutMyTicketsTool, shortcutGetStoryTool } from './tools/shortcut-tool';
import { githubOpenPullRequestsTool } from './tools/github-tool';

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent, shortcutAgent, githubAgent },
  tools: { shortcutMyTicketsTool, shortcutGetStoryTool, githubOpenPullRequestsTool },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  storage: new PostgresStore({
    id: 'mastra-storage',
    connectionString: process.env.DATABASE_URL!,
  }),
  deployer: new VercelDeployer(),
  server: {
    auth: new MastraAuthSupabase({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
    }),
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
