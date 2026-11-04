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
  memory?: string[]; // facts Ervo learned about this person earlier
  task?: "news";
  context?: {
    now?: string;
    timezone?: string;
    location?: { city?: string; region?: string; country?: string } | null;
  };
};

const BASE_PROMPT = `You are Ervo, a friendly AI helper (the mascot is a purple owl) inside a phone app. People text you like they'd text a friend.

How you work:
1. Before answering, work out what the person actually wants: the task, plus the key details (what, who, when, where, how many, budget). People type fast and misspell things; read past typos to what they mean. Use the date, time and location given below to make sense of words like "tonight", "next Friday" or "near me".
2. If a detail you truly need is missing, ask one short question instead of guessing. If nothing is missing, just do it.
3. Keep replies short, like a text message: usually 1 to 4 sentences. Plain text only, no markdown headings, bold or links. Simple bullets (•) are fine for short lists.
4. Be warm, clear and practical.
5. Use web search for anything current: news, weather, opening hours, prices, events, products.
6. Use the app's tools to actually do things, instead of only describing them:
   • add_calendar_event to put something on their calendar (the app asks them to confirm and which calendar).
   • update_settings when they want to change their nickname, light or dark mode, what's in their greeting, or their default calendar. Then confirm it in a few words.
   • remember when they tell you something lasting that will help later (sizes, job hours, diet, budget, favorite stores). Don't announce it.

Shopping:
• If they just name an item ("insoles", "paper towels"), use amazon_search with only the item itself, never extra words like "to buy". Ask if they'd like you to find it, or ask one quick question that would help you pick (what it's for, budget).
• If they say what it's for or what matters ("insoles for long work hours", "headphones under $100"), research it with web search: reviews, and what people and experts recommend. Then call show_products with the 2 to 4 best fits, each with a one-line reason. Use real Amazon product links (amazon.com/dp/...) when you find them, so the app can offer Add to cart.
• You can help add things to their Amazon cart, but you can never pay or check out. They always check out themselves on Amazon with their own card.

Be honest about what you can do. You can't place orders, make payments, make phone calls or book reservations yourself. Never say you've done something you haven't. Always ask before anything that spends money or shares someone's information.`;

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
  const facts = (req.memory ?? []).filter((f) => typeof f === "string").slice(-40).map((f) => `• ${f.slice(0, 200)}`);
  const loc = c.location && (c.location.city || c.location.region) ? [c.location.city, c.location.region, c.location.country].filter(Boolean).join(", ") : "unknown (they haven't shared it)";
  return `Right now: ${c.now ?? new Date().toISOString()} (time zone ${c.timezone ?? "unknown"}).\nTheir location: ${loc}.\nCall them: ${req.name ?? "friend"}.${facts.length ? `\nThings they've told you before:\n${facts.join("\n")}` : ""}`;
}

// Tools the app carries out on the phone. Ervo's server never acts on its own:
// the app shows each one to the person, who confirms and allows it.
const APP_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "show_products",
    description: "Show researched product picks as cards in the app, each with View and Add to cart buttons. Use after researching with web search when the person gave needs or preferences. 2 to 4 picks.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The plain item, like 'insoles'." },
        products: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Product name, short." },
              price: { type: "string", description: "Typical price, like '$39.99'." },
              rating: { type: "string", description: "Like '4.6★ (12k reviews)'." },
              why: { type: "string", description: "One short line on why it fits what they asked." },
              url: { type: "string", description: "Product page, ideally https://www.amazon.com/dp/ASIN." },
            },
            required: ["name", "why"],
          },
        },
      },
      required: ["query", "products"],
    },
  },
  {
    name: "amazon_search",
    description: "Offer to open Amazon search results. The query must be only the item, like 'insoles', never 'insoles to buy'. The app asks the person to confirm.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "add_calendar_event",
    description: "Offer to put an event on the person's calendar. The app asks them to confirm and which calendar (phone or Google). End your reply by asking if they want it added. Use local time, format YYYY-MM-DDTHH:MM.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, like 'Go to the store' or 'Dentist appointment'." },
        start: { type: "string", description: "YYYY-MM-DDTHH:MM, or YYYY-MM-DD for all day." },
        end: { type: "string", description: "YYYY-MM-DDTHH:MM. Optional." },
        all_day: { type: "boolean" },
      },
      required: ["title", "start"],
    },
  },
  {
    name: "update_settings",
    description: "Change Ervo's settings on the phone. Only include what the person asked to change.",
    input_schema: {
      type: "object",
      properties: {
        nickname: { type: "string", description: "What Ervo calls them, exactly as they wrote it." },
        theme: { type: "string", enum: ["light", "dark"] },
        weather: { type: "boolean", description: "Weather in the greeting." },
        news: { type: "boolean", description: "Local news in the greeting." },
        time: { type: "boolean", description: "Time in the greeting." },
        date: { type: "boolean", description: "Date in the greeting." },
        calendar: { type: "string", enum: ["phone", "google"], description: "Where new events go." },
      },
    },
  },
  {
    name: "remember",
    description: "Save one short, lasting fact about the person that will help later, like 'Works 12-hour shifts on their feet' or 'Shoe size 10'.",
    input_schema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] },
  },
];

// What each app tool did, so Claude's reply matches what the person sees
const TOOL_RESULTS: Record<string, string> = {
  remember: "Saved.",
  update_settings: "Changed on their phone already. Confirm it in a few words.",
  show_products: "The picks are on their screen as cards with prices, ratings, reasons, View and Add to cart buttons. Don't repeat or describe the cards; reply in 1 or 2 sentences, and maybe ask one helpful follow-up question.",
  amazon_search: "Their screen shows Yes and No buttons to open the search. Ask in one short sentence if they want you to open it.",
  add_calendar_event: "Their screen shows Yes and No buttons; if they tap Yes, the app asks which calendar. Ask in one short sentence if they want it added.",
};

type Action = { type: string } & Record<string, unknown>;
type ClaudeResult = { reply: string; actions: Action[]; memories: string[] };

async function askClaude(env: Env, req: ChatRequest): Promise<ClaudeResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const loc = req.context?.location;
  const country = loc?.country && /^[A-Z]{2}$/.test(loc.country) ? loc.country : undefined;

  const messages: Anthropic.Beta.BetaMessageParam[] = req.task === "news"
    ? [{ role: "user", content: `What are today's top 3 news stories${loc?.city ? ` for ${loc.city}${loc.region ? ", " + loc.region : ""}` : ""}? One short line each, starting with •. Start with a short friendly lead-in.` }]
    : toMessages(req.messages ?? []);
  const actions: Action[] = [];
  const memories: string[] = [];
  const done = (reply: string): ClaudeResult => ({ reply, actions, memories });
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return done("What can I help you with?");

  const tools: Anthropic.Beta.BetaToolUnion[] = [{
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 5,
    ...(loc?.city || country ? { user_location: { type: "approximate" as const, city: loc?.city || undefined, region: loc?.region || undefined, country, timezone: req.context?.timezone } } : {}),
  }];

  if (req.task !== "news") tools.push(...APP_TOOLS);
  let earlierText = "";

  // Searches can pause a long turn, and app tools need a reply; keep going a few rounds
  for (let round = 0; round < 5; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Medium: good research for product picks, still quick for everyday chat
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: `${BASE_PROMPT}\n\n${req.plan === "business" ? BUSINESS_RULES : PERSONAL_RULES}` },
        { type: "text", text: contextNote(req) },
      ],
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") return done("Sorry, I can't help with that one. Is there something else I can do?");
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // App tools: collect them for the phone, tell Claude they're on screen, and get its reply
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason === "tool_use" && uses.length) {
      for (const use of uses) {
        const input = (use.input ?? {}) as Record<string, unknown>;
        if (use.name === "remember") {
          if (typeof input.fact === "string") memories.push(input.fact.slice(0, 200));
        } else {
          actions.push({ ...input, type: use.name });
        }
      }
      if (text) earlierText = text;
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: uses.map((use) => ({
          type: "tool_result" as const,
          tool_use_id: use.id,
          content: TOOL_RESULTS[use.name] ?? "Done. Now write your short reply to them.",
        })),
      });
      continue;
    }
    return done(text || earlierText || "Sorry, I didn't get that. Could you say it another way?");
  }
  return done(earlierText || "That one's taking me a while. Could you ask again in a simpler way?");
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
      return json(await askClaude(env, body), 200, cors);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return json({ reply: "I'm a bit busy right now. Try again in a minute." }, 200, cors);
      if (err instanceof Anthropic.AuthenticationError) console.error("The Anthropic API key is missing or wrong.");
      else if (err instanceof Anthropic.APIError) console.error(`Anthropic API error ${err.status}: ${err.message}`);
      else console.error(err);
      return json({ reply: "I couldn't reach my AI service just now. Try again in a moment." }, 200, cors);
    }
  },
};
