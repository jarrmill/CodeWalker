export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  future: { compatibilityVersion: 4 },

  modules: ['@nuxt/ui', '@nuxtjs/supabase'],

  supabase: {
    // Redirect unauthenticated users to /login
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/login'],
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
