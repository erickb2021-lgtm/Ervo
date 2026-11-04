// Ervo app settings. This file is public, so only public values go here.
window.ERVO_CONFIG = {
  // Ervo's private AI server (see server/README.md). Empty = built-in answers.
  aiUrl: "https://ervo-ai.ervo-ai.workers.dev",

  // Supabase sign-in (see server/README.md, "Real accounts").
  // Use the Project URL and the publishable (anon) key. NEVER the secret / service_role key.
  // Empty = preview sign-in (any 6 digits work).
  supabaseUrl: "",
  supabaseKey: "",
};
