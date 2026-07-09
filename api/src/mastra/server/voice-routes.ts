import { registerApiRoute } from '@mastra/core/server';
import { Readable } from 'node:stream';

// The agent whose configured voice these routes use. Its OpenAIVoice provides
// both speech-to-text (listen) and text-to-speech (speak).
const VOICE_AGENT = 'codeReviewAgent';

// Cap TTS input so a runaway assistant reply can't rack up synthesis cost or
// hang the request. Longer text is truncated before synthesis.
const MAX_SPEAK_CHARS = 4000;

// Map an inbound audio content-type to a filetype OpenAI's transcription
// accepts. The browser's MediaRecorder typically produces audio/webm.
function filetypeFromContentType(contentType: string | undefined) {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('webm')) return 'webm' as const;
  if (type.includes('mp4') || type.includes('m4a')) return 'mp4' as const;
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3' as const;
  if (type.includes('wav')) return 'wav' as const;
  return 'webm' as const;
}

// Collect a Node Readable (what OpenAIVoice.speak returns) into a single Buffer.
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

/**
 * Custom API routes that expose the code-review agent's turn-based voice:
 *  - POST /voice/transcribe : raw audio body -> { text }
 *  - POST /voice/speak      : { text }       -> audio/mpeg bytes
 *
 * Both inherit the server's Supabase auth (requiresAuth defaults to true), so
 * the frontend must send the same Bearer token it uses for chat.
 */
export const voiceRoutes = [
  registerApiRoute('/voice/transcribe', {
    method: 'POST',
    handler: async (c) => {
      const mastra = c.get('mastra');
      const agent = mastra.getAgent(VOICE_AGENT);
      const voice = await agent.getVoice();

      const audio = Buffer.from(await c.req.arrayBuffer());
      if (audio.length === 0) {
        return c.json({ error: 'Empty audio body' }, 400);
      }

      const filetype = filetypeFromContentType(c.req.header('content-type'));
      const text = await voice.listen(Readable.from(audio), { filetype });

      return c.json({ text: typeof text === 'string' ? text : '' });
    },
  }),

  registerApiRoute('/voice/speak', {
    method: 'POST',
    handler: async (c) => {
      const mastra = c.get('mastra');
      const agent = mastra.getAgent(VOICE_AGENT);
      const voice = await agent.getVoice();

      const body = await c.req.json().catch(() => ({}));
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (!text) {
        return c.json({ error: 'Missing text' }, 400);
      }

      const audioStream = await voice.speak(text.slice(0, MAX_SPEAK_CHARS));
      if (!audioStream) {
        return c.json({ error: 'Speech synthesis returned no audio' }, 502);
      }

      const audio = await streamToBuffer(audioStream);
      // Copy into a fresh ArrayBuffer-backed Uint8Array for Hono's body.
      const audioBody = new Uint8Array(audio);
      return c.body(audioBody, 200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      });
    },
  }),
];
