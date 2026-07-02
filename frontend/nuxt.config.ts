export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  future: { compatibilityVersion: 4 },

  modules: ['@nuxt/ui', '@nuxtjs/supabase'],

  css: ['~/assets/css/main.css'],

  supabase: {
    // Redirect unauthenticated users to /login
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/login'],
    },
    // The session is stored in a cookie; its maxAge caps how long the
    // session is remembered. The module default is only 8 hours, which
    // causes sessions to silently disappear. Keep it in line with the
    // Supabase refresh-token lifetime.
    cookieOptions: {
      maxAge: 60 * 60 * 24 * 7, // 7 days
      sameSite: 'lax',
      secure: true,
    },
  },

  runtimeConfig: {
    public: {
      // URL of the deployed Mastra API (Vercel) or local dev server
      mastraUrl: process.env.NUXT_PUBLIC_MASTRA_URL ?? 'http://localhost:4111',
    },
  },

  devtools: { enabled: true },
})
