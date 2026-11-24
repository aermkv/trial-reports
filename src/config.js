// Same Supabase project as the Load Diagram Tool (see its src/supabase-client.js).
// The anon key is public by design: every tr_* table is locked down by
// row-level security. Never put the service_role key in this app.
export const SUPABASE_URL = "https://ptjzayeynuesvcjrtunb.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0anpheWV5bnVlc3ZjanJ0dW5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3MjU2MTksImV4cCI6MjEwMjMwMTYxOX0.XlTMDB3nDentT_ZPgeFNN7vCSg9i7lpkLtmE9W8AsBg";

// Link shown in the menu so people can jump between the two tools.
export const LOAD_DIAGRAM_TOOL_URL = "https://aermkv.github.io/load-diagram-tool/";
