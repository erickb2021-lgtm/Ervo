// Ervo's private AI server (a Cloudflare Worker).
// The app sends the conversation here; this server adds Ervo's instructions and
// the secret API key, asks Claude, and sends back the reply. The key lives only
// in Cloudflare's secret storage, never in the app or this repo.
import Anthropic from "@anthropic-ai/sdk";

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS?: string; // comma-separated; defaults below
  LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const MODEL = "claude-opus-5-5";
const DEFAULT_ORIGINS = [
  "https://erickb2021-lgtm.github.io", // iPhone web app
  "https://appassets.androidplatform.net", // Android app
  "http://localhost:5173", // testing on this computer
];
const MAX_MESSAGES = 16;
const MAX_CHARS = 2000;

type ChatTurn = { role: "user" | "assistant"; text: string };
type ChatRequest = {
  plan: "personal" | "business";
  name?: string;
  messages: ChatTurn[];
  task?: "news";
  context?: {
    now?: string;
    timezone?: string;
    location?: { city?: string; region?: string; country?: string } | null;
  };
};

const BASE_PROMPT = `You are Ervo, a friendly AI helper (the mascot is a purple owl) inside a phone app. People text you like they'd text a friend.

How you work:
1. Before answering, work out what the person actually wants: the task, plus the key details (what, who, when, where, how many, budget). Use the date, time and location given below to make sense of words like "tonight", "next Friday" or "near me".
2. If a detail you truly need is missing, ask one short question instead of guessing. If nothing is missing, just answer.
3. Keep replies short, like a text message: usually 1 to 4 sentences. Plain text only, no markdown headings or bold. Simple bullets (•) are fine for short lists.
4. Be warm, clear and practical. These are everyday tasks, not research projects.
5. Use web search for anything current: news, weather, opening hours, prices, events. Mention where the information came from in a few words.

Be honest about what you can do. You can't place orders, make payments, make phone calls or book reservations yourself yet. The app can open Google Calendar, Amazon, maps and email for the person, after they allow it. Never say you've done something you haven't. Always ask before anything that spends money or shares someone's information.`;

const PERSONAL_RULES = `This person uses Ervo Personal. It's for personal life only: planning, reminders, shopping, their own returns, meals, travel, health habits and everyday questions. If they ask for business work (their customers, employees, company tickets, invoices), kindly say Ervo Personal is for personal use only and that Ervo for Business handles that.`;

const BUSINESS_RULES = `This person uses Ervo for Business, on behalf of their company. It's for business work only: customer support replies, refunds by company policy, scheduling, team hand-offs and business questions. Write customer-facing text in a friendly, professional voice. If they ask for something personal (their own shopping, gym, family plans), kindly say Ervo for Business only handles business tasks and that Ervo Personal can help with that.`;

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()) : DEFAULT_ORIGINS;
  const ok = origin !== null && allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });
}

// The API wants turns to alternate and start with the person, so tidy the history
function toMessages(turns: ChatTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const turn of turns.slice(-MAX_MESSAGES)) {
    if (turn.role !== "user" && turn.role !== "assistant") continue;
    const text = String(turn.text ?? "").slice(0, MAX_CHARS).trim();
    if (!text) continue;
    if (out.length === 0 && turn.role === "assistant") continue;
    const last = out[out.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${text}`;
    else out.push({ role: turn.role, content: text });
  }
  return out;
}

function contextNote(req: ChatRequest): string {
  const c = req.context ?? {};
  const loc = c.location && (c.location.city || c.location.region) ? [c.location.city, c.location.region, c.location.country].filter(Boolean).join(", ") : "unknown (they haven't shared it)";
  return `Right now: ${c.now ?? new Date().toISOString()} (time zone ${c.timezone ?? "unknown"}).\nTheir location: ${loc}.\nCall them: ${req.name ?? "friend"}.`;
}

async function askClaude(env: Env, req: ChatRequest): Promise<string> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const loc = req.context?.location;
  const country = loc?.country && /^[A-Z]{2}$/.test(loc.country) ? loc.country : undefined;

  const messages: Anthropic.Beta.BetaMessageParam[] = req.task === "news"
    ? [{ role: "user", content: `What are today's top 3 news stories${loc?.city ? ` for ${loc.city}${loc.region ? ", " + loc.region : ""}` : ""}? One short line each, starting with •. Start with a short friendly lead-in.` }]
    : toMessages(req.messages ?? []);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return "What can I help you with?";

  const tools: Anthropic.Beta.BetaToolUnion[] = [{
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 3,
    ...(loc?.city || country ? { user_location: { type: "approximate" as const, city: loc?.city || undefined, region: loc?.region || undefined, country, timezone: req.context?.timezone } } : {}),
  }];

  // Server-side searches can pause a long turn; continue it a couple of times
  for (let round = 0; round < 3; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Everyday tasks: low effort keeps answers quick and inexpensive
      output_config: { effort: "low" },
      system: [
        { type: "text", text: `${BASE_PROMPT}\n\n${req.plan === "business" ? BUSINESS_RULES : PERSONAL_RULES}` },
        { type: "text", text: contextNote(req) },
      ],
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") return "Sorry, I can't help with that one. Is there something else I can do?";
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || "Sorry, I didn't get that. Could you say it another way?";
  }
  return "That one's taking me a while. Could you ask again in a simpler way?";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request.headers.get("Origin"), env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET" && url.pathname === "/") return json({ ok: true, name: "Ervo AI server" }, 200, cors);
    if (request.method !== "POST" || url.pathname !== "/chat") return json({ error: "not found" }, 404, cors);

    // Only Ervo's own app may use this server
    if (cors["Access-Control-Allow-Origin"] !== request.headers.get("Origin")) return json({ error: "forbidden" }, 403, cors);

    // Keeps one phone from running up the bill
    if (env.LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json({ reply: "You're sending messages really fast. Give me a minute and try again." }, 429, cors);
    }

    let body: ChatRequest;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad json" }, 400, cors);
    }
    if (body.plan !== "personal" && body.plan !== "business") return json({ error: "bad plan" }, 400, cors);

    try {
      return json({ reply: await askClaude(env, body) }, 200, cors);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return json({ reply: "I'm a bit busy right now. Try again in a minute." }, 200, cors);
      if (err instanceof Anthropic.AuthenticationError) console.error("The Anthropic API key is missing or wrong.");
      else if (err instanceof Anthropic.APIError) console.error(`Anthropic API error ${err.status}: ${err.message}`);
      else console.error(err);
      return json({ reply: "I couldn't reach my AI service just now. Try again in a moment." }, 200, cors);
    }
  },
};
