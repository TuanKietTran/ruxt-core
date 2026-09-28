// Shared Nuxt layer for the source editor and sandboxed CV preview.
// It owns no routes, persistence, or application-specific authentication.
export default defineNuxtConfig({
   compatibilityDate: "2025-07-15",
   vite: {
      resolve: {
         dedupe: ["vue", "@codemirror/state", "@codemirror/view", "@codemirror/language"],
      },
   },
});
