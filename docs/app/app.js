// Ervo app (preview). Everything runs on the phone: the account, settings and
// Ervo's activity are kept in local storage. Ervo reads each message first
// (what you want, when, how many people, what item), asks about anything
// missing, and only then answers. Other apps are opened only after you tap Allow.
// If an AI server is set in config.js, open questions go to it; otherwise
// Ervo uses its built-in answers.
(function () {
  const ACCOUNT_KEY = "ervo-account";
  const THEME_KEY = "ervo-theme";
  const PREFS_KEY = "ervo-prefs";
  const CONN_KEY = "ervo-connections";
  const ACTIVITY_KEY = "ervo-activity";
  const PLACE_KEY = "ervo-place";
  const AI_URL = ((window.ERVO_CONFIG || {}).aiUrl || "").replace(/\/+$/, "");
  const native = window.ErvoNative || null;
  const $ = (id) => document.getElementById(id);

  // ---------- storage ----------
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const drop = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- theme: follows the phone until the user picks one ----------
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme(t) {
    root.dataset.theme = t;
    document.querySelectorAll("img[data-dark]").forEach((img) => {
      if (!img.dataset.light) img.dataset.light = img.getAttribute("src");
      img.src = t === "dark" ? img.dataset.dark : img.dataset.light;
    });
    $("theme-toggle").setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
    syncBars();
  }
  const storedTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } };
  system.addEventListener("change", (e) => { if (!storedTheme()) applyTheme(e.matches ? "dark" : "light"); });
  $("theme-toggle").addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    applyTheme(next);
  });

  // Android: color the phone's top and bottom bars to match the screen
  function syncBars() {
    if (!native || !native.setBars) return;
    const css = getComputedStyle(root);
    const v = (name) => css.getPropertyValue(name).trim();
    const screen = document.querySelector(".screen.active");
    const id = screen ? screen.id : "";
    const top = id === "chat" ? v("--surface") : id === "stats" ? v("--group") : v("--bg");
    const bottom = id === "stats" ? v("--group") : v("--bg");
    native.setBars(top, bottom, root.dataset.theme === "dark");
  }

  // ---------- screens ----------
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    syncBars();
  }

  // ---------- Personal vs Business ----------
  const PLAN = {
    personal: {
      label: "Personal", avatar: "img/ervo-classic.png",
      hint: "Personal use only: planning, shopping, your own returns and more.",
      question: "What should Ervo call you?", nameLabel: "Your name", placeholder: "Alex", nameError: "Enter your name.",
      chips: ["Book a table for 4 tonight", "Gym Friday at 6pm", "Buy paper towels", "What's coming up?", "Weather"],
      apps: ["calendar", "amazon", "health", "location"],
    },
    business: {
      label: "Business", avatar: "img/ervo-business.png",
      hint: "Business use only: customer support, refunds by your policy, scheduling and more.",
      question: "What's your company called?", nameLabel: "Company name", placeholder: "Acme Coffee Co.", nameError: "Enter your company's name.",
      chips: ["Refund order #5512", "Summarize today's tickets", "Call with Northwind Thursday at 2pm", "Draft a reply to an upset customer"],
      apps: ["calendar", "mail", "location"],
    },
  };
  let plan = "personal";
  let contact = "";

  function setPlan(p) {
    plan = p;
    document.querySelectorAll('input[name="plan"]').forEach((r) => { r.checked = r.value === p; });
    $("plan-hint").textContent = PLAN[p].hint;
    $("welcome-avatar").src = PLAN[p].avatar;
    $("name-question").textContent = PLAN[p].question;
    $("name-label").textContent = PLAN[p].nameLabel;
    $("name").placeholder = PLAN[p].placeholder;
  }
  document.querySelectorAll('input[name="plan"]').forEach((r) => r.addEventListener("change", () => setPlan(r.value)));

  // ---------- sign-up steps ----------
  const steps = document.querySelectorAll(".step");
  function step(name) {
    steps.forEach((s) => s.classList.toggle("active", s.dataset.step === name));
    const input = document.querySelector(`.step[data-step="${name}"] input:not([type="radio"])`);
    if (input) setTimeout(() => input.focus(), 50);
  }
  const clearOnType = (input, err) => input.addEventListener("input", () => { $(err).textContent = ""; });
  clearOnType($("contact"), "contact-error");
  clearOnType($("code"), "code-error");
  clearOnType($("name"), "name-error");

  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const isPhone = (v) => /^[\d\s().+-]+$/.test(v) && /^\d{7,15}$/.test(v.replace(/[\s().+-]/g, ""));

  // ---------- real sign-in with Supabase (email codes), when config.js has the keys ----------
  const CFG = window.ERVO_CONFIG || {};
  const SB_URL = (CFG.supabaseUrl || "").replace(/\/+$/, "");
  const SB_KEY = CFG.supabaseKey || "";
  const SESSION_KEY = "ervo-session";
  const realAuth = !!(SB_URL && SB_KEY);

  async function auth(path, body, method, token) {
    const r = await fetch(`${SB_URL}/auth/v1/${path}`, {
      method: method || "POST",
      headers: { apikey: SB_KEY, "content-type": "application/json", Authorization: `Bearer ${token || SB_KEY}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(j.msg || j.error_description || j.message || `auth ${r.status}`); err.status = r.status; throw err; }
    return j;
  }
  const session = () => load(SESSION_KEY);
  // Keeps the sign-in fresh (Supabase sign-ins last an hour, then renew)
  async function freshToken() {
    const s = session();
    if (!s) return null;
    if (Date.now() < s.expiresAt - 60000) return s.access_token;
    try {
      const j = await auth("token?grant_type=refresh_token", { refresh_token: s.refresh_token });
      save(SESSION_KEY, { access_token: j.access_token, refresh_token: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000 });
      return j.access_token;
    } catch (e) { return null; }
  }
  function friendlyAuthError(e) {
    if (e.status === 429) return "Too many tries. Wait a minute, then try again.";
    if (/expired|invalid/i.test(e.message)) return "That code didn't work or has expired. Check it, or go back and get a new one.";
    return "Couldn't reach Ervo's sign-in. Check your connection and try again.";
  }
  if (realAuth) {
    document.querySelector(".demo").textContent = "Check your inbox (and spam folder) for a 6-digit code from Ervo.";
    $("contact").placeholder = "Your email";
  }

  document.querySelector('[data-step="contact"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("contact").value.trim();
    if (!v) { $("contact-error").textContent = realAuth ? "Enter your email." : "Enter your mobile number or email."; return; }
    if (!isEmail(v) && !isPhone(v)) { $("contact-error").textContent = "That doesn't look like a valid number or email. Try again."; return; }
    if (realAuth) {
      if (!isEmail(v)) { $("contact-error").textContent = "For now, sign in with your email. Text message codes are coming soon."; return; }
      const btn = e.submitter || document.querySelector('[data-step="contact"] .btn');
      btn.disabled = true;
      try { await auth("otp", { email: v, create_user: true }); } catch (err) { $("contact-error").textContent = friendlyAuthError(err); btn.disabled = false; return; }
      btn.disabled = false;
    }
    contact = v;
    $("sent-to").textContent = v;
    step("code");
  });

  $("code").addEventListener("input", () => { $("code").value = $("code").value.replace(/\D/g, "").slice(0, 6); });
  document.querySelector('[data-step="code"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test($("code").value)) { $("code-error").textContent = "Enter all 6 digits."; return; }
    if (realAuth) {
      let j;
      try { j = await auth("verify", { type: "email", email: contact, token: $("code").value }); } catch (err) { $("code-error").textContent = friendlyAuthError(err); return; }
      save(SESSION_KEY, { access_token: j.access_token, refresh_token: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000 });
      // Coming back? Pick up their name and Personal/Business choice from their account
      const meta = (j.user && j.user.user_metadata) || {};
      if (meta.name && PLAN[meta.plan]) {
        const acc = { plan: meta.plan, name: meta.name, contact, id: j.user.id, createdAt: j.user.created_at };
        save(ACCOUNT_KEY, acc);
        openChat(acc, false);
        return;
      }
    }
    step("name");
  });
  document.querySelector("[data-back]").addEventListener("click", () => { $("code").value = ""; step("contact"); });

  document.querySelector('[data-step="name"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("name").value.trim();
    if (v.length < 2) { $("name-error").textContent = PLAN[plan].nameError; return; }
    const acc = { plan, name: v, contact, createdAt: new Date().toISOString() };
    if (realAuth) {
      try {
        const u = await auth("user", { data: { name: v, plan } }, "PUT", await freshToken());
        acc.id = u.id;
      } catch (err) { $("name-error").textContent = friendlyAuthError(err); return; }
    }
    save(ACCOUNT_KEY, acc);
    openChat(acc, true);
  });

  // ---------- settings, connected apps and Ervo's activity ----------
  const DEFAULT_PREFS = { nickname: "", time: true, date: true, weather: false, news: false, stepsGoal: 8000 };
  const prefs = () => Object.assign({}, DEFAULT_PREFS, load(PREFS_KEY) || {});
  const connections = () => load(CONN_KEY) || {};
  const allowed = (key) => (connections()[key] || {}).status === "allowed";
  function setConnection(key, status) {
    const c = connections();
    c[key] = { status, at: new Date().toISOString() };
    save(CONN_KEY, c);
  }
  const activity = () => load(ACTIVITY_KEY) || [];
  function logActivity(item) {
    const list = activity();
    list.unshift(Object.assign({ id: Date.now().toString(36), at: new Date().toISOString() }, item));
    save(ACTIVITY_KEY, list.slice(0, 100));
  }

  // ---------- icons (plain shapes, not real brand logos) ----------
  const ICON = {
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.2 11a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
    health: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
    location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M4 7l8 6 8-6"/></svg>',
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5a2 2 0 0 0 4 0V3M17 21V3c-2 1-3 4-3 7h3"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
  };

  // Apps Ervo can work with. Allow opens the app (or its sign-in page if you're signed out).
  const CONNECTORS = {
    calendar: {
      name: "Google Calendar", ico: "calendar", login: "https://calendar.google.com/calendar/",
      does: ["Add events and reservations Ervo plans for you", "You save each one yourself, in Google Calendar"],
      note: "Ervo opens Google Calendar (or its sign-in page). Ervo never sees your password.",
    },
    amazon: {
      name: "Amazon", ico: "shop", login: "https://www.amazon.com/gp/css/homepage.html",
      does: ["Search for things you ask Ervo to find", "Open your orders for returns and tracking", "Ervo never buys anything without your OK"],
      note: "Ervo opens Amazon (or its sign-in page). Ervo never sees your password or card.",
    },
    health: {
      name: "Health", ico: "health",
      does: ["Read your step count for Ervo Stats", "Nothing is shared or sent anywhere"],
      note: "Your phone will ask you one more time. You can turn it off anytime.",
    },
    location: {
      name: "Location", ico: "location",
      does: ["Show the weather in your greeting", "Find local news and places near you", "Only your city is used, never your exact address"],
      note: "Your phone will ask you one more time. You can turn it off anytime.",
    },
    mail: {
      name: "Email", ico: "mail",
      does: ["Open replies Ervo drafts in your email app", "You review and send each one yourself"],
      note: "Ervo opens your email app with the draft filled in.",
    },
  };

  // Opens a website or app outside Ervo (the matching app opens if it's installed)
  function openOutside(url) {
    if (native && native.openUrl) native.openUrl(url);
    else window.open(url, "_blank", "noopener");
  }

  // ---------- Allow / Deny ----------
  let permResolve = null;
  function askPermission(key, reason) {
    const c = CONNECTORS[key];
    $("perm-ico").className = `app-ico big ${c.ico}`;
    $("perm-ico").innerHTML = ICON[c.ico];
    $("perm-title").textContent = `Allow Ervo to use ${c.name}?`;
    $("perm-list").innerHTML = "";
    [reason].concat(c.does).filter((line, i, all) => line && all.indexOf(line) === i).forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      $("perm-list").append(li);
    });
    $("perm-note").textContent = c.note;
    $("perm").hidden = false;
    $("perm-allow").focus();
    return new Promise((resolve) => { permResolve = resolve; });
  }
  function answerPermission(ok) {
    $("perm").hidden = true;
    const r = permResolve;
    permResolve = null;
    if (r) r(ok);
  }
  $("perm-allow").addEventListener("click", () => answerPermission(true));
  $("perm-deny").addEventListener("click", () => answerPermission(false));
  $("perm").addEventListener("click", (e) => { if (e.target === $("perm")) answerPermission(false); });

  // Asks once; remembers Allow. Returns true if Ervo may use the app.
  async function ensure(key, reason) {
    if (allowed(key)) return true;
    const ok = await askPermission(key, reason);
    setConnection(key, ok ? "allowed" : "denied");
    if (ok) logActivity({ kind: "connect", ico: CONNECTORS[key].ico, title: `Connected ${CONNECTORS[key].name}` });
    return ok;
  }

  // ---------- reading dates, times, people and items ----------
  const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, "a couple of": 2, few: 3, "a few": 3 };
  const toNum = (w) => (/^\d+$/.test(w) ? parseInt(w, 10) : WORD_NUM[w]);
  const NUM_RE = "(\\d{1,2}|a couple of|a few|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  // Finds a day and a time in a message, like "next Friday at 7", "in two weeks" or "11/17 8pm"
  function parseWhen(t, now, evening) {
    const today = startOfDay(now);
    let date = null;
    let time = null;
    let m;

    if (/\b(tonight|this evening)\b/.test(t)) { date = today; evening = true; }
    else if (/\bday after tomorrow\b/.test(t)) date = addDays(today, 2);
    else if (/\b(tomorrow|tmrw|tmr)\b/.test(t)) date = addDays(today, 1);
    else if (/\btoday\b/.test(t)) date = today;

    if (!date && (m = t.match(new RegExp(`\\bin ${NUM_RE} (day|week|month)s?\\b`)))) {
      const n = toNum(m[1]);
      if (m[2] === "day") date = addDays(today, n);
      else if (m[2] === "week") date = addDays(today, 7 * n);
      else { date = new Date(today); date.setMonth(date.getMonth() + n); }
    }
    if (!date && (m = t.match(new RegExp(`\\b${MONTH_RE}\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
      date = new Date(today.getFullYear(), MONTHS.indexOf(m[1].slice(0, 3)), parseInt(m[2], 10));
      if (date < today) date.setFullYear(date.getFullYear() + 1);
    }
    if (!date && (m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MONTH_RE}\\b`)))) {
      date = new Date(today.getFullYear(), MONTHS.indexOf(m[2].slice(0, 3)), parseInt(m[1], 10));
      if (date < today) date.setFullYear(date.getFullYear() + 1);
    }
    if (!date && (m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : today.getFullYear();
      date = new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
      if (!m[3] && date < today) date.setFullYear(date.getFullYear() + 1);
    }
    if (!date && (m = t.match(/\b(?:(next|this|on) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/))) {
      let diff = (DAY_NAMES.indexOf(m[2]) - today.getDay() + 7) % 7;
      if (diff === 0 && m[1] === "next") diff = 7;
      date = addDays(today, diff);
    }
    if (!date && /\b(this )?weekend\b/.test(t)) date = addDays(today, (6 - today.getDay() + 7) % 7);
    if (!date && /\bnext week\b/.test(t)) date = addDays(today, 7);
    if (!date && /\bnext month\b/.test(t)) { date = new Date(today); date.setMonth(date.getMonth() + 1); }
    if (!date && (m = t.match(/\bthe (\d{1,2})(?:st|nd|rd|th)\b/))) {
      date = new Date(today.getFullYear(), today.getMonth(), parseInt(m[1], 10));
      if (date < today) date.setMonth(date.getMonth() + 1);
    }

    if ((m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)/))) {
      let h = parseInt(m[1], 10) % 12;
      if (m[3][0] === "p") h += 12;
      time = { h, m: m[2] ? parseInt(m[2], 10) : 0 };
    } else if ((m = t.match(/\b(?:at|around|by|@) ?(\d{1,2})(?::(\d{2}))?(?! ?(?:day|week|month|people|person|guest|of us|min|hour|year))\b/)) || (m = t.match(/\b(\d{1,2}):(\d{2})\b/))) {
      time = guessMeridiem(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, evening);
    } else if (/\bnoon\b|\blunch ?time\b/.test(t)) time = { h: 12, m: 0 };
    else if (/\bmidnight\b/.test(t)) time = { h: 23, m: 59 };
    else if (/\bmorning\b/.test(t)) time = { h: 9, m: 0 };
    else if (/\bafternoon\b/.test(t)) time = { h: 15, m: 0 };
    else if (/\b(evening|tonight)\b/.test(t)) time = null; // "tonight" alone still needs a time
    if (time && (time.h > 23 || time.m > 59)) time = null;

    return { date, time, allDay: /\ball[ -]day\b/.test(t) };
  }
  // "at 7" for dinner means 7 PM; "at 3" almost always means the afternoon
  function guessMeridiem(h, min, evening) {
    if (h === 0 || h > 12) return { h: h % 24, m: min };
    if (h === 12) return { h: 12, m: min };
    if (h <= 6 || (evening && h <= 11)) return { h: h + 12, m: min };
    return { h, m: min };
  }

  function parseParty(t) {
    let m = t.match(new RegExp(`\\b(?:table for|party of|for)\\s+${NUM_RE}\\b(?!\\s*(?:day|week|month|hour|min|year|am|pm|a\\.m|p\\.m|:|o'?clock|dollars|bucks))`));
    if (!m) m = t.match(new RegExp(`\\b${NUM_RE}\\s+(?:people|persons|guests|adults|of us)\\b`));
    if (m) { const n = toNum(m[1]); if (n >= 1 && n <= 20) return n; }
    if (/\b(just me|by myself|for one)\b/.test(t)) return 1;
    if (/\b(me and (my )?\w+|for us two|date night|for two)\b/.test(t)) return 2;
    return null;
  }

  const CUISINES = ["italian", "mexican", "sushi", "japanese", "chinese", "thai", "indian", "pizza", "steak", "seafood", "bbq", "korean", "vietnamese", "burgers", "greek", "french", "mediterranean", "ramen", "tacos", "brunch"];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Words about time, people and politeness, removed when Ervo pulls out a title or item
  // (Longest phrases first, so "in 2 weeks" goes as a whole.)
  const FILLER = new RegExp([
    `\\bin ${NUM_RE} (day|week|month)s?\\b`, "\\b(next|this) (week|month)\\b",
    `\\b(on |by )?${MONTH_RE}\\.? \\d{1,2}(st|nd|rd|th)?\\b`,
    "\\b((at|around|by) )?\\d{1,2}(:\\d{2})?\\s*(am|pm|a\\.m\\.|p\\.m\\.)", "\\b(at|around|by) \\d{1,2}(:\\d{2})?\\b", "\\b(on )?\\d{1,2}/\\d{1,2}(/\\d{2,4})?\\b",
    "\\b(please|pls|can you|could you|would you|will you|ervo|for me|thanks|thank you|i need to|i want to|i'd like to|help me)\\b",
    "\\b(this|next|on|at|around|by|in|the|every) (?=sunday|monday|tuesday|wednesday|thursday|friday|saturday|week|month|weekend|morning|afternoon|evening|noon)",
    "\\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekend|morning|afternoon|evening|noon|midnight|tonight|today|tomorrow)s?\\b",
  ].join("|"), "gi");
  const tidy = (s) => s.replace(FILLER, " ").replace(/\s+([,.!?])/g, "$1").replace(/[,.!?]+$/g, "").replace(/\s{2,}/g, " ").trim();

  function eventTitle(raw, t) {
    let m;
    if ((m = raw.match(/remind me to (.+)/i))) return cap(tidy(m[1])) || "Reminder";
    if ((m = raw.match(/\b(meeting|call|lunch|dinner|coffee|drinks|brunch|zoom|video call) with ([A-Za-z][\w'-]*)( [A-Z][\w'-]*)?/i))) {
      const last = m[3] && /^ [A-Z]/.test(m[3]) && !/^ (Next|This|On|At|In|Today|Tomorrow|Tonight|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|June?|July?|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)$/i.test(m[3]) ? m[3] : "";
      return `${cap(m[1].toLowerCase())} with ${cap(m[2])}${last}`;
    }
    if (/\b(gym|workout|work out|lift|run)\b/.test(t)) return "Gym";
    if ((m = t.match(/\b(dentist|doctor|haircut|vet|eye doctor|therapy|massage|oil change|car service)\b/))) return cap(m[1]) + (/(haircut|massage|oil change|car service)/.test(m[1]) ? "" : " appointment");
    if (/\bstandup\b/.test(t)) return "Team standup";
    if (/\b(interview)\b/.test(t)) return "Interview";
    if (/\b(demo)\b/.test(t)) return "Demo";
    let s = raw.replace(/^(please |can you |could you |ervo,? )*(schedule|add|put|plan|set up|book|make|create|block( off)?|fit)( me)?( an?| the| my)?\s*/i, "");
    s = s.replace(/\b(to|on|in|into) (my )?(calendar|schedule)\b/gi, "");
    s = tidy(s);
    return s ? cap(s) : "New event";
  }

  function shopItem(raw) {
    let s = raw.replace(/^(please |can you |could you |ervo,? |i need to |i want to |i'd like to )*(buy|order|purchase|get( me)?|shop for|find( me)?|add|look for|reorder)\s+(me\s+)?(some |a |an |the |more |new )?/i, "");
    s = s.replace(/^i need (some |a |an |more |new )?/i, "");
    s = s.replace(/\b(on|from|off) amazon\b|\bto (my )?cart\b|\bonline\b/gi, "");
    return tidy(s);
  }

  // ---------- understanding: what does the person want? ----------
  const BUSINESS_WORDS = /\b(customer|customers|ticket|tickets|employee|employees|staff|invoice|invoices|client|clients|sales team|my team|payroll|vendor|vendors)\b/i;
  const PERSONAL_WORDS = /\b(buy me|for me to eat|groceries|snacks|gym|workout|my birthday|my headphones|vacation|date night|my mom|my dad|my kids|dentist|haircut)\b/i;

  function understand(text) {
    const raw = text.trim();
    const t = raw.toLowerCase().replace(/[’‘]/g, "'");
    const evening = /\b(dinner|tonight|evening|drinks|supper)\b/.test(t);
    const when = parseWhen(t, new Date(), evening);
    const d = { raw, t, when, party: parseParty(t), intent: "unknown" };
    const is = (re) => re.test(t);
    const biz = account.plan === "business";

    if (is(/^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|sounds good|please do|book it|add it|confirm|let'?s do it|correct|perfect)\b/)) d.intent = "yes";
    else if (is(/^(no|nope|nah|not now|cancel|stop|never ?mind|don'?t)\b/)) d.intent = "no";
    else if (is(/what can you do|how do you work|what do you do|^help\b|^menu$/)) d.intent = "help";
    else if (is(/^(thanks|thank you|thx|ty|appreciate it|cool|great|awesome|nice)\b/) && t.length < 30) d.intent = "thanks";
    else if (is(/^(hi|hey|hello|yo|sup|hiya|good (morning|afternoon|evening)|what'?s up)\b/) && t.length < 25) d.intent = "hello";
    else if (is(/what time is it|what'?s the time|current time|time is it/)) d.intent = "time";
    else if (is(/what'?s (the |today'?s )?date|what day is (it|today)|today'?s date/)) d.intent = "date";
    else if (is(/\bweather\b|temperature|forecast|\brain(ing)?\b|\bsnow|umbrella|how (hot|cold)/)) d.intent = "weather";
    else if (is(/\bnews\b|headlines|what'?s happening/)) d.intent = "news";
    else if (is(/ervo stats|what (have|did) you (done|do)|recent (activity|events)|upcoming|coming up|what'?s (on )?my (schedule|calendar|plans|week)|my plans/)) d.intent = "stats";
    else if (!biz && is(/\bsteps\b|walked|how much .*walk|calories|\bhealth\b|fitness|activity/)) d.intent = "steps";
    else if (biz) {
      if (is(/refund|charged|order #?\d+|\breturn|chargeback/)) d.intent = "refund";
      else if (is(/ticket|summar|inbox|queue|support (load|volume)/)) d.intent = "tickets";
      else if (is(/upset|angry|complain|(draft|write|reply|respond|email).*(customer|client|reply|email|message)/)) d.intent = "email";
      else if (is(/schedule|meeting|\bcall\b|\bmeet\b|calendar|\bbook\b|set up|appointment|demo|interview|standup|remind/) || when.date) d.intent = "event";
    } else {
      if (is(/where'?s my (order|package)|track (my )?(order|package)|has my .*(shipped|arrived)|order status/)) d.intent = "track";
      else if (is(/\b(return|refund|send back|exchange)\b/)) d.intent = "return";
      else if (is(/\b(table|reservation|reserve|restaurant)\b|(book|get|find) (us |me )?(a )?(spot|place) (for|to eat)|(book|get) (us |me )?(a )?(dinner|lunch|brunch)\b|\b(dinner|lunch|brunch) for (\d|two|three|four|five|six)/)) d.intent = "reserve";
      else if (is(/\b(buy|purchase|shop|add to (my )?cart|get me|amazon|reorder)\b|^order\b|^(i need|we need|we'?re out of|i'?m out of) /)) d.intent = "shop";
      else if (is(/schedule|calendar|remind|appointment|meeting|meet with|call with|\bbook\b|\bplan\b|set up|gym|workout|dentist|doctor|haircut|lunch with|coffee with|dinner with|\bfit\b|block (off|out)|\badd\b/) || when.date) d.intent = "event";
    }
    if (d.intent === "reserve") d.cuisine = CUISINES.find((c) => new RegExp(`\\b${c}\\b`).test(t)) || null;
    if (d.intent === "reserve") { const m = raw.match(/\bat ([A-Z][\w'&]*(?: [A-Z][\w'&]*)*)/); d.place = m ? m[1] : null; }
    return d;
  }

  // ---------- tasks: Ervo fills in the details, asks for what's missing, then confirms ----------
  let task = null;       // what Ervo is working on
  let confirming = false; // waiting for a yes or no

  const fmtDate = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (t) => new Date(2000, 0, 1, t.h, t.m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const fmtWhen = (task) => `${fmtDate(task.date)}${task.allDay ? ", all day" : task.time ? ` at ${fmtTime(task.time)}` : ""}`;
  const at = (task) => { const x = new Date(task.date); if (task.time) x.setHours(task.time.h, task.time.m); return x; };
  const meal = (time) => (!time ? "Dinner" : time.h < 11 ? "Breakfast" : time.h < 16 ? "Lunch" : "Dinner");

  function newTask(d) {
    const tk = { intent: d.intent, date: d.when.date, time: d.when.time, allDay: d.when.allDay };
    if (d.intent === "reserve") Object.assign(tk, { party: d.party, cuisine: d.cuisine, place: d.place });
    if (d.intent === "event") tk.title = eventTitle(d.raw, d.t);
    if (d.intent === "shop") tk.item = shopItem(d.raw);
    return tk;
  }

  // Use a follow-up message ("4 people", "8pm", "Saturday") to fill in what's missing
  function fillTask(tk, d) {
    let changed = false;
    const bare = d.t.match(/^(\d{1,2})(?::(\d{2}))?$/);
    // "change the time" / "different day" / "change how many people": ask again
    const redo = d.t.match(/\b(change|different|another|new)\b.*\b(time|day|date|people|party|guests)\b/);
    if (redo) {
      if (/time/.test(redo[2])) { tk.time = null; tk.allDay = false; }
      else if (/day|date/.test(redo[2])) tk.date = null;
      else tk.party = null;
      return true;
    }
    if (d.when.date) { tk.date = d.when.date; changed = true; }
    if (d.when.time) { tk.time = d.when.time; tk.allDay = false; changed = true; }
    if (d.when.allDay) { tk.allDay = true; changed = true; }
    if (tk.intent === "reserve") {
      if (d.party) { tk.party = d.party; changed = true; }
      const c = CUISINES.find((x) => new RegExp(`\\b${x}\\b`).test(d.t));
      if (c) { tk.cuisine = c; changed = true; }
      if (bare && !tk.party && !bare[2]) { tk.party = parseInt(bare[1], 10); changed = true; }
      else if (bare && !d.when.time) { tk.time = guessMeridiem(parseInt(bare[1], 10), bare[2] ? parseInt(bare[2], 10) : 0, true); changed = true; }
    } else if (bare && !d.when.time) {
      tk.time = guessMeridiem(parseInt(bare[1], 10), bare[2] ? parseInt(bare[2], 10) : 0, false);
      changed = true;
    }
    if (tk.intent === "shop" && !tk.item && d.raw.length > 1) { tk.item = shopItem(d.raw) || d.raw; changed = true; }
    if (tk.intent === "event" && /^(call it|name it|title)\b/.test(d.t)) { tk.title = cap(d.raw.replace(/^(call it|name it|title:?)\s*/i, "")); changed = true; }
    return changed;
  }

  // True when a message only gives details ("Saturday at 8", "make it 6 people", "italian")
  // instead of asking for something new
  function onlyDetails(d) {
    const left = tidy(d.t
      .replace(/\b(make it|change it to|change|instead|actually|how about|what about|let'?s do|let'?s say|and|for|people|persons|guests|of us|at|on|it|to|yes|no|ok|okay|all day|a table)\b/g, " ")
      .replace(new RegExp(`\\b(${CUISINES.join("|")})\\b`, "g"), " ")
      .replace(new RegExp(`\\b${NUM_RE}\\b`, "g"), " "));
    return left.replace(/[^a-z]/g, "").length < 3;
  }

  function missing(tk) {
    const m = [];
    if (tk.intent === "reserve") { if (!tk.party) m.push("party"); if (!tk.date) m.push("date"); if (!tk.time) m.push("time"); }
    if (tk.intent === "event") { if (!tk.date) m.push("date"); if (!tk.time && !tk.allDay) m.push("time"); }
    if (tk.intent === "shop" && !tk.item) m.push("item");
    return m;
  }

  // The little "Understood:" line Ervo shows before answering
  function understoodTags(tk) {
    const tags = [];
    const miss = missing(tk);
    if (tk.intent === "reserve") {
      tags.push("Reservation");
      if (tk.party) tags.push(`${tk.party} ${tk.party === 1 ? "person" : "people"}`);
      if (tk.cuisine) tags.push(cap(tk.cuisine));
      if (tk.place) tags.push(tk.place);
    }
    if (tk.intent === "event") {
      const kind = account.plan === "business" ? "Meeting" : "Event";
      tags.push(kind);
      if (tk.title !== kind) tags.push(tk.title);
    }
    if (tk.intent === "shop") { tags.push("Shopping"); if (tk.item) tags.push(tk.item); }
    if (tk.date) tags.push(fmtDate(tk.date));
    if (tk.allDay) tags.push("All day");
    else if (tk.time) tags.push(fmtTime(tk.time));
    return { tags, miss: miss.map((k) => ({ party: "how many?", date: "what day?", time: "what time?", item: "what item?" })[k]) };
  }

  function askForMissing(tk) {
    const miss = missing(tk);
    const opts = { understood: understoodTags(tk) };
    if (tk.intent === "reserve") {
      const parts = [];
      if (miss.includes("party")) parts.push("how many people");
      if (miss.includes("date")) parts.push("what day");
      if (miss.includes("time")) parts.push("what time");
      opts.chips = miss[0] === "party" ? ["2 people", "4 people", "6 people"] : miss[0] === "date" ? ["Tonight", "Tomorrow", "Saturday"] : ["6pm", "7pm", "8pm"];
      return ervoSays(`Sure! ${cap(listJoin(parts))}?`, opts);
    }
    if (tk.intent === "event") {
      if (miss.includes("date")) { opts.chips = ["Today", "Tomorrow", "Next week"]; return ervoSays(`Got it: "${tk.title}". What day${miss.includes("time") ? " and time" : ""}?`, opts); }
      opts.chips = ["9am", "Noon", "6pm", "All day"];
      return ervoSays(`What time on ${fmtDate(tk.date)}?`, opts);
    }
    if (tk.intent === "shop") { opts.chips = ["Paper towels", "Phone charger", "Coffee"]; return ervoSays("Sure! What should I look for?", opts); }
  }
  const listJoin = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

  function propose(tk) {
    confirming = true;
    const opts = { understood: understoodTags(tk), chips: ["Yes", "No"] };
    if (tk.date && startOfDay(tk.date) < startOfDay(new Date())) {
      confirming = false;
      tk.date = null;
      return ervoSays("That day has already passed. What day did you mean?", Object.assign(opts, { chips: ["Today", "Tomorrow"] }));
    }
    if (tk.intent === "reserve") {
      const what = `${meal(tk.time)} for ${tk.party}${tk.cuisine ? ` (${cap(tk.cuisine)})` : ""}${tk.place ? ` at ${tk.place}` : ""}`;
      return ervoSays(`${what}, ${fmtWhen(tk)}.\n\nWant me to save it to your plans and add it to your calendar? I'll also show you places with open tables.`, opts);
    }
    if (tk.intent === "event") return ervoSays(`"${tk.title}" on ${fmtWhen(tk)}.\n\nShould I add it to your calendar?`, opts);
    if (tk.intent === "shop") return ervoSays(`I'll look up "${tk.item}" on Amazon for you. I never buy anything without your OK.\n\nOpen Amazon now?`, opts);
  }

  function calendarLink(title, tk, minutes) {
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = (x, withTime) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}` + (withTime ? `T${pad(x.getHours())}${pad(x.getMinutes())}00` : "");
    let dates;
    if (tk.allDay || !tk.time) dates = `${stamp(tk.date)}/${stamp(addDays(tk.date, 1))}`;
    else { const s = at(tk); dates = `${stamp(s, true)}/${stamp(new Date(s.getTime() + minutes * 60000), true)}`; }
    const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates, details: "Planned with Ervo", ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || "" });
    return `https://calendar.google.com/calendar/render?${q}`;
  }

  async function runTask(tk) {
    confirming = false;
    task = null;
    if (tk.intent === "reserve" || tk.intent === "event") {
      const reserve = tk.intent === "reserve";
      const title = reserve ? `${meal(tk.time)} for ${tk.party}${tk.place ? ` at ${tk.place}` : ""}` : tk.title;
      const link = calendarLink(title, tk, reserve ? 90 : 60);
      const acts = [];
      if (reserve) {
        const q = `${tk.cuisine ? tk.cuisine + " " : ""}restaurants${tk.place ? " " + tk.place : ""} near me`;
        acts.push({ label: "Find a table", icon: "food", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` });
      }
      logActivity({ kind: tk.intent, ico: reserve ? "food" : "calendar", title, detail: reserve ? `${tk.party} ${tk.party === 1 ? "person" : "people"}` : "", when: at(tk).toISOString(), allDay: !!(tk.allDay || !tk.time), link });
      const ok = await ensure("calendar", `Add "${title}" to your calendar`);
      if (ok) {
        openOutside(link);
        acts.unshift({ label: "Open in Google Calendar", icon: "calendar", href: link });
        return ervoSays(`Done ✅ "${title}", ${fmtWhen(tk)}. It's in your Ervo Stats, and I opened Google Calendar so you can save it there too.${reserve ? "\n\nI can't call restaurants myself yet, so tap Find a table to pick a place." : ""}`, { acts });
      }
      return ervoSays(`No problem, I won't use Google Calendar. "${title}" is saved in your Ervo Stats under Upcoming.`, { acts });
    }
    if (tk.intent === "shop") {
      const url = `https://www.amazon.com/s?k=${encodeURIComponent(tk.item)}`;
      const ok = await ensure("amazon", `Look up "${tk.item}"`);
      if (!ok) return ervoSays("Okay, I won't open Amazon. You can allow it anytime from Connected apps in the menu.");
      logActivity({ kind: "shop", ico: "shop", title: `Looked up ${tk.item}`, detail: "Amazon", link: url });
      openOutside(url);
      return ervoSays(`Opened Amazon with results for "${tk.item}". Pick the one you like. I'll never check out for you without asking.`, { acts: [{ label: "Open Amazon again", icon: "shop", href: url }] });
    }
  }

  // ---------- chat ----------
  const thread = $("thread");
  let account = null;
  let history = []; // the conversation, for the AI server
  let pending = null; // business sample flows waiting for a yes/no

  function bubble(text, who) {
    const el = document.createElement("div");
    el.className = `msg ${who}`;
    el.textContent = text;
    thread.append(el);
    thread.scrollTop = thread.scrollHeight;
    return el;
  }

  function showUnderstood(u) {
    if (!u || (!u.tags.length && !u.miss.length)) return;
    const el = document.createElement("div");
    el.className = "understood";
    el.append("Understood:");
    u.tags.forEach((x) => { const s = document.createElement("span"); s.className = "tag"; s.textContent = x; el.append(s); });
    u.miss.forEach((x) => { const s = document.createElement("span"); s.className = "tag missing"; s.textContent = x; el.append(s); });
    thread.append(el);
  }

  function showActs(acts) {
    const row = document.createElement("div");
    row.className = "acts";
    acts.forEach((a) => {
      const el = document.createElement(a.href ? "a" : "button");
      el.className = "act";
      if (a.href) {
        el.href = a.href;
        el.target = "_blank";
        el.rel = "noopener";
        el.addEventListener("click", (e) => { e.preventDefault(); openOutside(a.href); });
      } else {
        el.type = "button";
        el.addEventListener("click", a.onClick);
      }
      el.innerHTML = ICON[a.icon] || "";
      el.append(a.label);
      row.append(el);
    });
    thread.append(row);
  }

  // Ervo "types", then answers. `text` can be a promise (weather, AI server).
  let lastWasVoice = false;
  async function ervoSays(text, opts) {
    opts = opts || {};
    if (opts.understood) showUnderstood(opts.understood);
    const t = document.createElement("div");
    t.className = "typing";
    t.setAttribute("aria-label", "Ervo is typing");
    t.innerHTML = "<i></i><i></i><i></i>";
    thread.append(t);
    thread.scrollTop = thread.scrollHeight;
    const speakIt = lastWasVoice;
    lastWasVoice = false;
    let said;
    try { said = await Promise.resolve(text); } catch (e) { said = "Sorry, something went wrong. Try again in a moment."; }
    await delay(500 + Math.min(String(said).length * 8, 900));
    t.remove();
    bubble(said, "them");
    history.push({ role: "assistant", text: said });
    if (opts.acts && opts.acts.length) showActs(opts.acts);
    setChips(opts.chips || PLAN[account.plan].chips);
    thread.scrollTop = thread.scrollHeight;
    if (speakIt) speak(said);
    return said;
  }

  // ---------- speaking answers out loud ----------
  function speak(text) {
    const clean = text.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, "").replace(/[•★]/g, "");
    if (native && native.speak) { native.speak(clean); return; }
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(clean));
    }
  }
  function stopSpeaking() {
    if (native && native.stopSpeaking) native.stopSpeaking();
    else if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  function setChips(list) {
    const box = $("chips");
    box.innerHTML = "";
    box.scrollLeft = 0;
    list.forEach((label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = label;
      b.addEventListener("click", () => send(label));
      box.append(b);
    });
  }

  function openChat(acc, fresh) {
    account = acc;
    const p = PLAN[acc.plan];
    $("chat-avatar").src = p.avatar;
    $("mode-badge").textContent = p.label;
    $("menu-who").textContent = `${acc.name} · Ervo ${acc.plan === "business" ? "for Business" : "Personal"}`;
    thread.innerHTML = "";
    history = [];
    task = null;
    confirming = false;
    pending = null;
    show("chat");
    setTimeout(() => greet(fresh), fresh ? 250 : 0);
  }

  // ---------- greeting: nickname, time, date, weather, news ----------
  function greetingText(firstTime) {
    const p = prefs();
    const name = p.nickname || account.name;
    const now = new Date();
    const h = now.getHours();
    const hello = h < 5 ? "Hi" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    const lines = [`${hello}, ${name}!`];
    const date = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (p.date && p.time) lines.push(`It's ${date}, ${time}.`);
    else if (p.date) lines.push(`It's ${date}.`);
    else if (p.time) lines.push(`It's ${time}.`);
    return { lines, firstTime, p };
  }

  async function greet(firstTime) {
    const g = greetingText(firstTime);
    const intro = account.plan === "business"
      ? "I'm Ervo for Business. I can answer your customers, handle refunds by your policy and keep your team's schedule on track."
      : "I'm Ervo, your AI helper. I can plan your week, book things, shop and keep track of it all in Ervo Stats.";
    const build = (async () => {
      let lines = g.lines.slice();
      if (g.p.weather && allowed("location")) {
        const w = await Promise.race([weatherNow(), delay(5000).then(() => null)]).catch(() => null);
        if (w) lines.push(w.sentence);
      }
      lines.push(g.firstTime ? intro : "What can I do for you?");
      if (g.firstTime) lines.push("What can I do for you?");
      return lines.join(" ");
    })();
    await ervoSays(build);
    if (g.p.news && allowed("location")) newsBubble();
  }

  // ---------- location, weather and news ----------
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error("no-geo")); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(err),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 30 * 60 * 1000 }
      );
    });
  }

  // City-level location, kept for an hour. Rounded so it's never an exact address.
  async function getPlace() {
    const cached = load(PLACE_KEY);
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached;
    const pos = await getPosition();
    const place = { lat: Math.round(pos.lat * 100) / 100, lon: Math.round(pos.lon * 100) / 100, city: "", region: "", country: "", at: Date.now() };
    try {
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${place.lat}&longitude=${place.lon}&localityLanguage=en`);
      const j = await r.json();
      place.city = j.city || j.locality || "";
      place.region = j.principalSubdivision || "";
      place.country = j.countryCode || "";
    } catch (e) { /* weather still works without the city name */ }
    save(PLACE_KEY, place);
    return place;
  }

  const WEATHER = [
    [[0], "clear", "☀️"], [[1], "mostly clear", "🌤️"], [[2], "partly cloudy", "⛅"], [[3], "cloudy", "☁️"],
    [[45, 48], "foggy", "🌫️"], [[51, 53, 55, 56, 57], "drizzly", "🌦️"], [[61, 63, 65, 66, 67, 80, 81, 82], "rainy", "🌧️"],
    [[71, 73, 75, 77, 85, 86], "snowy", "🌨️"], [[95, 96, 99], "stormy", "⛈️"],
  ];
  async function weatherNow() {
    const place = await getPlace();
    const fahrenheit = place.country ? ["US", "LR", "MM", "BS", "BZ", "KY", "PW"].includes(place.country) : /-US$/.test(navigator.language || "");
    const q = new URLSearchParams({
      latitude: place.lat, longitude: place.lon, current: "temperature_2m,weather_code,is_day",
      daily: "temperature_2m_max,temperature_2m_min", timezone: "auto", forecast_days: "1",
      temperature_unit: fahrenheit ? "fahrenheit" : "celsius",
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!r.ok) throw new Error("weather");
    const j = await r.json();
    const code = j.current.weather_code;
    const kind = WEATHER.find((w) => w[0].includes(code)) || [[], "", ""];
    let emoji = kind[2];
    if (code <= 1 && !j.current.is_day) emoji = "🌙";
    const temp = Math.round(j.current.temperature_2m);
    const hi = Math.round(j.daily.temperature_2m_max[0]);
    const lo = Math.round(j.daily.temperature_2m_min[0]);
    const where = place.city ? ` in ${place.city}` : "";
    const w = { temp, hi, lo, kind: kind[1], emoji, city: place.city, unit: fahrenheit ? "F" : "C" };
    w.sentence = `It's ${temp}°${w.unit} and ${kind[1]}${where} ${emoji}`.trim() + ".";
    w.short = `${emoji} ${temp}°${w.unit}, ${kind[1]}${where} · H ${hi}° L ${lo}°`;
    return w;
  }

  async function newsBubble() {
    let place = null;
    try { place = await getPlace(); } catch (e) { /* no location */ }
    const area = place && place.city ? `${place.city}${place.region ? " " + place.region : ""}` : "";
    const lang = (navigator.language || "en-US");
    const gl = (place && place.country) || (lang.split("-")[1] || "US");
    const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(area || "local news")}&hl=${lang}&gl=${gl}&ceid=${gl}:${lang.split("-")[0]}`;
    if (AI_URL) {
      const text = askServer({ task: "news" }).catch(() => null);
      const said = await ervoSays(text.then((x) => x || `Here's today's news${area ? ` for ${place.city}` : ""}.`), { acts: [{ label: "More news", icon: "open", href: newsUrl }] });
      return said;
    }
    return ervoSays(`Here's today's news${area ? ` for ${place.city}` : ""}. Tap to read it.`, { acts: [{ label: "Today's news", icon: "open", href: newsUrl }] });
  }

  // ---------- Ervo's private AI server (optional, see server/README.md) ----------
  async function askServer(extra) {
    let place = null;
    try { place = allowed("location") ? load(PLACE_KEY) : null; } catch (e) { /* ignore */ }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const r = await fetch(`${AI_URL}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify(Object.assign({
          plan: account.plan,
          name: prefs().nickname || account.name,
          messages: history.slice(-16),
          context: {
            now: new Date().toString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            location: place ? { city: place.city, region: place.region, country: place.country } : null,
          },
        }, extra || {})),
      });
      if (!r.ok) throw new Error(`server ${r.status}`);
      const j = await r.json();
      return j.reply;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- answering ----------
  function reply(text) {
    const d = understand(text);
    const biz = account.plan === "business";

    // Personal and Business stay strictly separate
    if (!biz && BUSINESS_WORDS.test(d.t) && d.intent !== "event") {
      task = null; confirming = false;
      return ervoSays("That sounds like a business task. Ervo Personal is for personal use only, so I can't help with customers or company work. Ervo for Business is built for that.");
    }
    if (biz && PERSONAL_WORDS.test(d.t)) {
      task = null; confirming = false;
      return ervoSays("That sounds personal. Ervo for Business only handles business tasks, like customer support, refunds and scheduling. Ervo Personal can help with that one.");
    }

    // Business sample flows waiting for a yes/no
    if (pending) {
      const p = pending;
      pending = null;
      if (d.intent === "yes") { if (p.log) logActivity(p.log); return ervoSays(p.yes, { acts: p.acts }); }
      if (d.intent === "no") return ervoSays(p.no);
    }

    // Working on something: a yes/no, a change ("make it 8pm"), or a missing detail
    if (task) {
      const newRequest = !["unknown", "yes", "no", "thanks"].includes(d.intent) && !onlyDetails(d);
      if (!newRequest) {
        if (confirming && d.intent === "yes") return runTask(task);
        const changed = fillTask(task, d);
        if (d.intent === "no" && /that'?s (all|it)|never ?mind|forget (it|about it)/.test(d.t)) {
          task = null;
          confirming = false;
          return ervoSays("No problem, I've dropped it.");
        }
        if (confirming && d.intent === "no" && !changed) {
          confirming = false;
          // Keep the details for a moment, so "make it 7pm" still works
          if (task.intent === "shop") { task = null; return ervoSays("Okay, I won't open Amazon."); }
          return ervoSays("Okay, I won't. Want to change something, like the day or time?", { chips: ["Change the time", "No, that's all"] });
        }
        if (changed || !confirming) {
          if (!changed && !confirming && d.intent === "no") { task = null; return ervoSays("No problem, I've dropped it."); }
          return missing(task).length ? askForMissing(task) : propose(task);
        }
      }
      task = null;
      confirming = false;
    }

    switch (d.intent) {
      case "reserve": case "event": case "shop": {
        task = newTask(d);
        if (biz && d.intent === "event" && task.title === "New event") task.title = "Meeting";
        return missing(task).length ? askForMissing(task) : propose(task);
      }
      case "hello": return ervoSays(`Hi ${prefs().nickname || account.name}! What can I do for you?`);
      case "thanks": return ervoSays("Anytime! 😊");
      case "help": return ervoSays(biz
        ? "Here's what I can do:\n• Answer customers and summarize tickets\n• Refunds by your policy\n• Book meetings on your calendar\n• Draft replies for your email\n\nJust tell me in your own words, like \"Call with Northwind Thursday at 2pm\"."
        : "Here's what I can do:\n• Plan reservations and events and put them on your calendar\n• Find things on Amazon, start returns and track orders\n• Show your steps, plans and recent activity in Ervo Stats\n• Weather and news in your greeting\n\nJust say it your way, like \"dinner for 4 in two weeks at 7\".");
      case "time": return ervoSays(`It's ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`);
      case "date": return ervoSays(`Today is ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`);
      case "weather": return weatherReply();
      case "news": return allowed("location") || AI_URL ? newsBubble() : ensure("location", "Find news for your area").then((ok) => (ok ? newsBubble() : ervoSays("Okay. Here's the top news instead.", { acts: [{ label: "Today's news", icon: "open", href: "https://news.google.com/" }] })));
      case "stats": return statsReply();
      case "steps": return stepsReply();
      case "track": case "return": {
        const url = "https://www.amazon.com/gp/css/order-history";
        const what = d.intent === "track" ? "track your order" : "start your return";
        return ensure("amazon", d.intent === "track" ? "Open your orders to track a package" : "Open your orders to start a return").then((ok) => {
          if (!ok) return ervoSays("Okay, I won't open Amazon.");
          logActivity({ kind: d.intent, ico: "shop", title: d.intent === "track" ? "Checked an order" : "Started a return", detail: "Amazon", link: url });
          openOutside(url);
          return ervoSays(`I opened your Amazon orders so you can ${what}. ${d.intent === "return" ? "Pick the item and choose Return or replace." : "Tap Track package on the order."}`, { acts: [{ label: "Your orders", icon: "shop", href: url }] });
        });
      }
      case "refund":
        pending = {
          yes: "Refund sent ✅ $64.00 back to the customer's card, and I emailed them a return label. Ticket closed.", no: "Okay, I've left it for your team to review.",
          log: { kind: "refund", ico: "done", title: "Refunded order #5512", detail: "$64.00 · damaged on arrival" },
        };
        return ervoSays("Order #5512: a blender that arrived cracked, $64.00, delivered 4 days ago.\nYour policy: damaged on arrival → full refund ✓\n\nShould I issue the refund and reply to the customer?", { understood: { tags: ["Refund", "Order #5512"], miss: [] }, chips: ["Yes, refund it", "Send to my team"] });
      case "tickets":
        return ervoSays("Today so far (sample):\n• 42 customer tickets\n• 38 resolved by me, average 41 seconds\n• 4 sent to your team (2 bulk orders, 1 billing question, 1 upset customer)", { understood: { tags: ["Ticket summary", "Today"], miss: [] } });
      case "email": {
        const body = "Hi Jordan,\n\nI'm really sorry your order arrived late. I've refunded your shipping and added a 15% credit to your account. If there's anything else I can do, just reply here.\n\nThanks for your patience.";
        const mail = `mailto:?subject=${encodeURIComponent("About your order")}&body=${encodeURIComponent(body)}`;
        return ervoSays(`Here's a draft:\n\n"${body}"\n\nWant to send it from your email?`, {
          understood: { tags: ["Customer reply", "Apologize + make it right"], miss: [] },
          acts: [{ label: "Open in email", icon: "mail", onClick: () => ensure("mail", "Open this draft in your email").then((ok) => { if (ok) { logActivity({ kind: "email", ico: "mail", title: "Drafted a customer reply" }); openOutside(mail); } }) }],
        });
      }
      default:
        if (AI_URL) return ervoSays(askServer().catch(() => "I couldn't reach my AI service just now. Try again in a moment."));
        return ervoSays(biz
          ? "I want to make sure I get this right. Is it about a customer, a refund, or a meeting?"
          : "I want to make sure I get this right. Should I plan something, add it to your calendar, or find something to buy?",
        { chips: biz ? ["A customer", "A refund", "A meeting"] : ["Plan dinner", "Add to my calendar", "Buy something"] });
    }
  }

  async function weatherReply() {
    if (!(await ensure("location", "Check the weather where you are"))) return ervoSays("Okay. I won't use your location.");
    return ervoSays(weatherNow().then((w) => `${w.sentence} Today's high is ${w.hi}° and the low is ${w.lo}°.`).catch(() => "I couldn't get your location. Check that location is turned on for Ervo, then try again."));
  }

  function statsReply() {
    const now = Date.now();
    const up = activity().filter((a) => a.when && new Date(a.when).getTime() > now).sort((a, b) => new Date(a.when) - new Date(b.when));
    const open = { label: "Open Ervo Stats", icon: "stats", onClick: () => openStats() };
    if (!up.length) return ervoSays("Nothing coming up yet. Want me to plan something?", { acts: [open], chips: ["Book a table for 4 tonight", "Gym Friday at 6pm"] });
    const lines = up.slice(0, 4).map((a) => `• ${a.title}, ${whenText(a)}`);
    return ervoSays(`Coming up:\n${lines.join("\n")}`, { acts: [open] });
  }

  // Android steps come from Health Connect through the native bridge
  let stepsWaiters = [];
  let lastSteps = null;
  window.ervoSteps = (json) => {
    let s;
    try { s = JSON.parse(json); } catch (e) { s = { status: "error" }; }
    lastSteps = s;
    if (s.status === "ready") setConnection("health", "allowed");
    renderSteps(s);
    stepsWaiters.forEach((r) => r(s));
    stepsWaiters = [];
  };
  function readSteps() {
    return new Promise((resolve) => {
      if (!native || !native.stepsStatus) { resolve({ status: "web" }); return; }
      stepsWaiters.push(resolve);
      native.stepsStatus();
      setTimeout(() => resolve(lastSteps || { status: "error" }), 6000);
    });
  }
  async function stepsReply() {
    const open = { label: "Open Ervo Stats", icon: "stats", onClick: () => openStats() };
    const s = await readSteps();
    if (s.status === "ready") {
      const goal = prefs().stepsGoal;
      const left = goal - s.today;
      return ervoSays(`You've taken ${s.today.toLocaleString()} steps today. ${left > 0 ? `${left.toLocaleString()} more to reach your ${goal.toLocaleString()} goal 💪` : "You hit your goal! 🎉"}`, { acts: [open] });
    }
    if (s.status === "web") return ervoSays("Steps work in the Android app right now. On iPhone they'll come with the App Store version, because Apple only shares Health data with installed apps.", { acts: [open] });
    return ervoSays("I need permission to read your steps first. Open Ervo Stats and tap Connect Health.", { acts: [open] });
  }

  function send(text, byVoice) {
    const v = text.trim();
    if (!v || !account) return;
    bubble(v, "me");
    history.push({ role: "user", text: v });
    $("chips").innerHTML = "";
    lastWasVoice = !!byVoice;
    reply(v);
  }

  // Composer: mic when empty, blue send arrow once you type (like text messages)
  const message = $("message");
  function syncComposer() {
    const has = message.value.trim().length > 0;
    $("send-btn").hidden = !has;
    $("mic-btn").hidden = has;
  }
  message.addEventListener("input", syncComposer);
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    send(message.value);
    message.value = "";
    syncComposer();
  });

  // ---------- Ervo Stats ----------
  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "Just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
    const days = Math.floor(s / 86400);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    const w = Math.floor(days / 7);
    return w === 1 ? "1 week ago" : w < 5 ? `${w} weeks ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function untilText(iso) {
    const days = Math.round((startOfDay(new Date(iso)) - startOfDay(new Date())) / 86400000);
    if (days <= 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days < 7) return `In ${days} days`;
    const w = Math.round(days / 7);
    return w === 1 ? "In 1 week" : `In ${w} weeks`;
  }
  function whenText(a) {
    const d = new Date(a.when);
    return `${fmtDate(d)}${a.allDay ? "" : ` at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}`;
  }

  function row(ico, title, sub, side, href) {
    const el = document.createElement(href ? "a" : "div");
    el.className = "row";
    if (href) {
      el.href = href;
      el.addEventListener("click", (e) => { e.preventDefault(); openOutside(href); });
    }
    const i = document.createElement("span");
    i.className = `app-ico ${ico}`;
    i.innerHTML = ICON[ico] || ICON.done;
    const txt = document.createElement("span");
    txt.className = "txt";
    const b = document.createElement("b");
    b.textContent = title;
    const s = document.createElement("small");
    s.textContent = sub;
    txt.append(b, s);
    el.append(i, txt);
    if (side) { const sd = document.createElement("span"); sd.className = "side"; sd.textContent = side; el.append(sd); }
    return el;
  }
  const icoClass = (ico) => (ico === "food" ? "calendar" : ico);
  function empty(text) { const p = document.createElement("p"); p.className = "empty"; p.textContent = text; return p; }

  function renderStats() {
    const now = new Date();
    $("stats-date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    $("stats-title").textContent = `${prefs().nickname || account.name}'s Ervo Stats`;
    if (allowed("location")) {
      weatherNow().then((w) => { $("stats-weather").textContent = w.short; $("stats-weather").hidden = false; }).catch(() => { $("stats-weather").hidden = true; });
    } else {
      $("stats-weather").hidden = true;
    }

    // Upcoming: things Ervo planned that haven't happened yet
    const items = activity();
    const up = items.filter((a) => a.when && new Date(a.when) > now).sort((a, b) => new Date(a.when) - new Date(b.when));
    $("upcoming").innerHTML = "";
    if (!up.length) $("upcoming").append(empty("Nothing planned yet. Ask Ervo to book or schedule something."));
    up.slice(0, 8).forEach((a) => {
      const r = row(icoClass(a.ico), a.title, `${whenText(a)}${a.detail ? " · " + a.detail : ""}`, untilText(a.when), a.link);
      r.querySelector(".app-ico").innerHTML = ICON[a.ico] || ICON.done;
      $("upcoming").append(r);
    });

    // Most recent events: everything Ervo did, newest first
    $("recent").innerHTML = "";
    if (!items.length) $("recent").append(empty("When Ervo does something for you, it shows up here."));
    items.slice(0, 10).forEach((a) => {
      const sub = a.when ? `For ${whenText(a)}` : a.detail || "Done by Ervo";
      const r = row(icoClass(a.ico), a.title, sub, ago(a.at), a.link);
      r.querySelector(".app-ico").innerHTML = ICON[a.ico] || ICON.done;
      $("recent").append(r);
    });

    renderApps();
    if (native && native.stepsStatus) { $("steps-note").textContent = "Checking Health Connect…"; native.stepsStatus(); }
    else renderSteps({ status: "web" });
  }

  function renderApps() {
    $("apps").innerHTML = "";
    PLAN[account.plan].apps.forEach((key) => {
      const c = CONNECTORS[key];
      if (key === "health" && !(native && native.stepsStatus)) return; // phones without the Android app can't share steps yet
      const state = connections()[key];
      const on = state && state.status === "allowed";
      const sub = on ? `Allowed ${ago(state.at).toLowerCase()}` : state && state.status === "denied" ? "Not allowed" : "Not connected";
      const r = row(c.ico, c.name, sub);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `switch${on ? " on" : ""}`;
      btn.textContent = on ? "Turn off" : "Connect";
      btn.addEventListener("click", () => toggleApp(key, on));
      r.append(btn);
      $("apps").append(r);
    });
  }

  async function toggleApp(key, on) {
    const c = CONNECTORS[key];
    if (on) {
      setConnection(key, "off");
      logActivity({ kind: "disconnect", ico: c.ico, title: `Turned off ${c.name}` });
      if (key === "location") drop(PLACE_KEY);
      renderStats();
      return;
    }
    const ok = await askPermission(key);
    if (!ok) { setConnection(key, "denied"); renderApps(); return; }
    setConnection(key, "allowed");
    logActivity({ kind: "connect", ico: c.ico, title: `Connected ${c.name}` });
    if (key === "health" && native && native.requestSteps) native.requestSteps();
    else if (key === "location") getPlace().catch(() => { /* the phone said no */ }).then(renderStats);
    else if (c.login) openOutside(c.login); // signs in, or opens the app if you're signed in already
    renderStats();
  }

  function renderSteps(s) {
    const goal = prefs().stepsGoal;
    const btn = $("steps-btn");
    const ring = $("ring-fg");
    btn.hidden = true;
    $("steps-week").innerHTML = "";
    $("steps-extra").innerHTML = "";
    $("steps-goal").textContent = `Goal ${goal.toLocaleString()}`;
    if (s.status === "ready") {
      $("steps-today").textContent = s.today.toLocaleString();
      ring.style.strokeDashoffset = String(314.16 * (1 - Math.min(s.today / goal, 1)));
      $("steps-note").textContent = s.today >= goal ? "You hit your goal today! 🎉" : `${(goal - s.today).toLocaleString()} steps to go.`;
      const max = Math.max(goal, ...s.week.map((d) => d.steps));
      s.week.forEach((d, i) => {
        const col = document.createElement("div");
        col.className = `bar-col${i === s.week.length - 1 ? " today" : ""}`;
        const bar = document.createElement("i");
        bar.style.height = `${Math.max(4, (d.steps / max) * 60)}px`;
        bar.title = `${d.steps.toLocaleString()} steps`;
        const lbl = document.createElement("span");
        lbl.textContent = new Date(d.date + "T12:00").toLocaleDateString(undefined, { weekday: "narrow" });
        col.append(bar, lbl);
        $("steps-week").append(col);
      });
      const us = (load(PLACE_KEY) || {}).country === "US" || /-US$/.test(navigator.language || "");
      const meters = s.today * 0.762;
      const dist = us ? `${(meters / 1609.34).toFixed(1)} mi` : `${(meters / 1000).toFixed(1)} km`;
      $("steps-extra").innerHTML = `<div><small>Distance (est.)</small><b>${dist}</b></div><div><small>Calories (est.)</small><b>${Math.round(s.today * 0.04)}</b></div>`;
      return;
    }
    $("steps-today").textContent = "--";
    ring.style.strokeDashoffset = "314.16";
    const NOTES = {
      web: "Steps work in the Ervo app for Android. On iPhone they'll come with the App Store version, because Apple only shares Health data with installed apps.",
      needs_permission: "Allow Ervo to read your steps from Health Connect.",
      denied: "Ervo doesn't have permission to read your steps.",
      needs_update: "Install or update Health Connect from the Play Store, then come back.",
      unavailable: "This phone doesn't support Health Connect, so Ervo can't read steps.",
      error: "Couldn't read your steps right now. Try again in a moment.",
    };
    $("steps-note").textContent = NOTES[s.status] || NOTES.error;
    if (["needs_permission", "denied"].includes(s.status)) { btn.hidden = false; btn.textContent = "Connect Health"; }
    if (s.status === "needs_update") { btn.hidden = false; btn.textContent = "Get Health Connect"; }
  }
  $("steps-btn").addEventListener("click", async () => {
    if (!(await ensure("health", "Show your steps in Ervo Stats"))) return;
    if (native && native.requestSteps) native.requestSteps();
  });

  function openStats(scrollToApps) {
    toggleMenu(false);
    renderStats();
    show("stats");
    $("stats-body").scrollTop = 0;
    if (scrollToApps) setTimeout(() => $("apps-heading").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  $("stats-back").addEventListener("click", () => show("chat"));
  window.ervoResume = () => {
    if ($("stats").classList.contains("active")) renderStats();
    // Back from "Allow from this source": carry on installing the update
    if (update && update.state === "needs_permission" && !$("update").hidden && native && native.installUpdate) {
      update.state = "waiting";
      native.installUpdate();
    }
  };

  // ---------- updates: Ervo tells you when a new version is ready ----------
  // Android downloads the new Ervo.apk from GitHub Releases and opens the installer.
  // On iPhone the files come straight from the website, so updating is a quick refresh.
  const APP_VERSION = "0.2.1"; // keep in step with version.json and the Android versionName
  const UPDATE_CHECK_KEY = "ervo-update-checked";
  const RELEASES_API = "https://api.github.com/repos/erickb2021-lgtm/Ervo/releases/latest";
  const currentVersion = () => (native && native.appVersion ? native.appVersion() : APP_VERSION);
  let update = null; // { version, notes, apkUrl }

  function newer(a, b) {
    const pa = String(a).replace(/^v/, "").split(".").map(Number);
    const pb = String(b).replace(/^v/, "").split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  }

  async function findUpdate() {
    if (native && native.downloadUpdate) {
      const r = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (!r.ok) throw new Error("releases");
      const rel = await r.json();
      const apk = (rel.assets || []).find((a) => a.name === "Ervo.apk");
      if (!apk || !newer(rel.tag_name, currentVersion())) return null;
      const notes = String(rel.body || "").split("\n").filter((l) => /^\s*[-*•]\s+/.test(l)).map((l) => l.replace(/^\s*[-*•]\s+/, "").replace(/\*\*/g, ""));
      return { version: rel.tag_name.replace(/^v/, ""), notes, apkUrl: apk.browser_download_url };
    }
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error("version");
    const v = await r.json();
    return newer(v.version, APP_VERSION) ? { version: v.version, notes: v.notes || [] } : null;
  }

  // Quietly checks a few times a day; from the menu it always checks and says if you're up to date
  async function checkForUpdate(manual) {
    const last = Number(load(UPDATE_CHECK_KEY)) || 0;
    if (!manual && Date.now() - last < 6 * 60 * 60 * 1000) return;
    save(UPDATE_CHECK_KEY, Date.now());
    let found = null;
    try { found = await findUpdate(); } catch (e) {
      if (manual) ervoSays("I couldn't check for updates right now. Check your connection and try again.");
      return;
    }
    if (found) showUpdate(found);
    else if (manual) ervoSays(`You're up to date ✅ This is Ervo ${currentVersion()}, the newest version.`);
  }

  function showUpdate(found) {
    update = found;
    $("update-title").textContent = "Update available";
    $("update-sub").textContent = `Ervo ${found.version} is ready. You have ${currentVersion()}.`;
    $("update-notes").innerHTML = "";
    found.notes.slice(0, 5).forEach((n) => { const li = document.createElement("li"); li.textContent = n; $("update-notes").append(li); });
    $("update-progress").hidden = true;
    $("update-note").textContent = native ? "Ervo downloads the update, then Android asks you to install it. Your chats and settings stay." : "Takes a second. Your chats and settings stay.";
    $("update-now").textContent = "Update now";
    $("update-now").disabled = false;
    $("update-later").hidden = false;
    $("update").hidden = false;
  }

  $("update-later").addEventListener("click", () => { $("update").hidden = true; });
  $("update-now").addEventListener("click", async () => {
    if (!update) return;
    if (native && native.downloadUpdate) {
      if (update.state === "needs_permission" || update.state === "ready") { update.state = "asked"; native.installUpdate(); return; }
      $("update-now").disabled = true;
      $("update-progress").hidden = false;
      $("update-progress").classList.add("busy");
      $("update-note").textContent = "Downloading…";
      native.downloadUpdate(update.apkUrl);
      return;
    }
    // iPhone / web: clear the saved copy and load the new files
    $("update-now").disabled = true;
    $("update-note").textContent = "Updating…";
    try {
      if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) await reg.update();
    } catch (e) { /* a plain reload still gets the new files */ }
    location.reload();
  });

  // Progress and results from the Android download
  window.ervoUpdate = (json) => {
    let s;
    try { s = JSON.parse(json); } catch (e) { return; }
    if (!update) return;
    const before = update.state;
    update.state = s.status;
    const bar = $("update-progress");
    if (s.status === "downloading") {
      bar.hidden = false;
      if (s.percent >= 0) { bar.classList.remove("busy"); $("update-bar").style.width = `${s.percent}%`; $("update-note").textContent = `Downloading… ${s.percent}%`; }
    } else if (s.status === "needs_permission") {
      bar.hidden = true;
      $("update-note").textContent = "One-time step: turn on \"Allow from this source\" for Ervo, then come back here.";
      $("update-now").textContent = "Install";
      $("update-now").disabled = false;
      // Open the switch right away, except when they just came back without turning it on
      if (before !== "waiting") native.openInstallSettings();
    } else if (s.status === "installing") {
      bar.hidden = true;
      $("update-note").textContent = "Tap Update on the next screen to finish. Ervo will restart.";
      $("update-now").textContent = "Install again";
      update.state = "ready"; // the button reopens the installer if they closed it
      $("update-now").disabled = false;
    } else {
      bar.hidden = true;
      $("update-note").textContent = "The download didn't finish. Check your connection and try again.";
      $("update-now").textContent = "Try again";
      $("update-now").disabled = false;
      update.state = null;
    }
  };

  $("check-update").addEventListener("click", () => { toggleMenu(false); checkForUpdate(true); });
  $("menu-version").textContent = `Ervo version ${currentVersion()} (preview)`;

  // ---------- greeting settings ----------
  function openGreeting() {
    toggleMenu(false);
    const p = prefs();
    $("nickname").value = p.nickname;
    $("nickname").placeholder = account.name;
    $("g-time").checked = p.time;
    $("g-date").checked = p.date;
    $("g-weather").checked = p.weather && allowed("location");
    $("g-news").checked = p.news && allowed("location");
    $("greet").hidden = false;
  }
  $("greet-cancel").addEventListener("click", () => { $("greet").hidden = true; });
  $("greet").addEventListener("click", (e) => { if (e.target === $("greet")) $("greet").hidden = true; });
  $("greet-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = prefs();
    p.nickname = $("nickname").value.trim().slice(0, 30);
    p.time = $("g-time").checked;
    p.date = $("g-date").checked;
    p.weather = $("g-weather").checked;
    p.news = $("g-news").checked;
    $("greet").hidden = true;
    if ((p.weather || p.news) && !allowed("location")) {
      const ok = await ensure("location", p.weather ? "Show the weather in your greeting" : "Find news for your area");
      if (!ok) { p.weather = false; p.news = false; }
      else await getPlace().catch(() => { /* the phone said no; Ervo will try again next time */ });
    }
    save(PREFS_KEY, p);
    const g = greetingText(false);
    ervoSays(`Saved! Here's how I'll greet you: "${g.lines.join(" ")}${p.weather ? " (plus the weather)" : ""}${p.news ? " (plus today's news)" : ""}"`);
  });

  // ---------- attachments: photos and links ----------
  function closeAttach() {
    $("attach-sheet").hidden = true;
    $("attach-btn").setAttribute("aria-expanded", "false");
  }
  $("attach-btn").addEventListener("click", () => {
    const open = $("attach-sheet").hidden;
    $("link-row").hidden = true;
    $("attach-sheet").hidden = !open;
    $("attach-btn").setAttribute("aria-expanded", String(open));
  });

  $("attach-photo").addEventListener("click", () => { closeAttach(); $("photo-input").click(); });
  $("photo-input").addEventListener("change", () => {
    const file = $("photo-input").files[0];
    $("photo-input").value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const el = document.createElement("div");
      el.className = "msg me photo";
      const img = document.createElement("img");
      img.src = reader.result;
      img.alt = "Photo you sent";
      img.onload = () => { thread.scrollTop = thread.scrollHeight; };
      el.append(img);
      thread.append(el);
      $("chips").innerHTML = "";
      ervoSays(account.plan === "business"
        ? "Got the photo! Soon I'll read it, like a receipt or a damaged product, and match it to the right order or ticket."
        : "Got your photo! Soon I'll look at it for you, like reading a receipt, a flyer or a product label, and take care of the next step.");
    };
    reader.readAsDataURL(file);
  });

  $("attach-link").addEventListener("click", () => {
    closeAttach();
    $("link-row").hidden = false;
    $("link-input").value = "";
    $("link-error").textContent = "";
    setTimeout(() => $("link-input").focus(), 50);
  });
  $("link-cancel").addEventListener("click", () => { $("link-row").hidden = true; });
  $("link-input").addEventListener("input", () => { $("link-error").textContent = ""; });
  $("link-row").addEventListener("submit", (e) => {
    e.preventDefault();
    let v = $("link-input").value.trim();
    if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
    let url;
    try { url = new URL(v); } catch (err) { url = null; }
    if (!url || !/\.[a-z]{2,}$/i.test(url.hostname)) { $("link-error").textContent = "That doesn't look like a link. Try something like example.com."; return; }
    $("link-row").hidden = true;
    const el = document.createElement("div");
    el.className = "msg me link";
    const a = document.createElement("a");
    a.href = url.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.addEventListener("click", (ev) => { ev.preventDefault(); openOutside(url.href); });
    const b = document.createElement("b");
    b.textContent = url.hostname.replace(/^www\./, "");
    const s = document.createElement("small");
    s.textContent = url.href.length > 48 ? url.href.slice(0, 45) + "…" : url.href;
    a.append(b, s);
    el.innerHTML = '<div class="link-top"></div>';
    el.append(a);
    thread.append(el);
    thread.scrollTop = thread.scrollHeight;
    $("chips").innerHTML = "";
    history.push({ role: "user", text: `(shared a link: ${url.href})` });
    if (/amazon\./i.test(url.hostname) && account.plan === "personal") {
      return ervoSays(`That's an Amazon link. Want me to keep it in your plans so you remember it?`, { acts: [{ label: "Save it", icon: "shop", onClick: () => { logActivity({ kind: "link", ico: "shop", title: "Saved an Amazon link", detail: b.textContent, link: url.href }); ervoSays("Saved ✅ It's in Ervo Stats under Most recent events."); } }] });
    }
    ervoSays(`Thanks! Soon I'll open ${b.textContent}, read it and tell you what matters, or use it to finish your task.`);
  });

  // ---------- voice: Ervo waits until you finish talking, then answers ----------
  const voice = $("voice");
  let recognizer = null;
  let heard = "";

  function openVoice() {
    stopSpeaking();
    heard = "";
    voice.classList.remove("thinking");
    $("voice-owl").src = PLAN[account.plan].avatar;
    $("voice-status").textContent = "Listening…";
    $("voice-text").textContent = "Say what you need. I'll wait until you're done.";
    $("voice-done").hidden = false;
    voice.hidden = false;
  }
  function closeVoice() {
    voice.hidden = true;
    if (recognizer) { try { recognizer.abort(); } catch (e) { /* ignore */ } recognizer = null; }
  }
  function finishVoice(text) {
    const said = (text || "").trim();
    if (!said) {
      $("voice-status").textContent = "I didn't catch that";
      $("voice-text").textContent = "Tap the mic and try again.";
      $("voice-done").hidden = true;
      return;
    }
    voice.classList.add("thinking");
    $("voice-status").textContent = "Got it";
    $("voice-text").textContent = `"${said}"`;
    setTimeout(() => { closeVoice(); send(said, true); }, 700);
  }

  // Android: the phone's own speech recognizer listens until you stop talking
  window.ervoVoiceResult = (text) => finishVoice(text);
  window.ervoVoiceError = (msg) => {
    if (voice.hidden) return;
    $("voice-status").textContent = "Voice isn't available";
    $("voice-text").textContent = msg || "Try typing your message instead.";
    $("voice-done").hidden = true;
  };

  $("mic-btn").addEventListener("click", () => {
    openVoice();
    if (native && native.startListening) {
      native.startListening();
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { window.ervoVoiceError("This device doesn't support voice. Try typing instead."); return; }
    recognizer = new SR();
    recognizer.lang = navigator.language || "en-US";
    recognizer.interimResults = true;
    recognizer.continuous = false; // stops on its own when you finish your sentence
    recognizer.onresult = (e) => {
      heard = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      $("voice-text").textContent = heard;
    };
    recognizer.onerror = (e) => {
      if (e.error === "no-speech") return;
      window.ervoVoiceError(e.error === "not-allowed" ? "Ervo needs microphone access to hear you." : "Something went wrong. Try again.");
    };
    recognizer.onend = () => { recognizer = null; if (!voice.hidden) finishVoice(heard); };
    recognizer.start();
  });
  $("voice-done").addEventListener("click", () => {
    if (recognizer) recognizer.stop(); // onend sends what was heard
    else if (native && native.stopListening) native.stopListening();
  });
  $("voice-cancel").addEventListener("click", () => {
    if (native && native.stopListening) native.stopListening();
    closeVoice();
  });

  // ---------- menu ----------
  const menu = $("menu");
  function toggleMenu(open) {
    menu.hidden = !open;
    $("menu-btn").setAttribute("aria-expanded", String(open));
  }
  $("menu-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(menu.hidden); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) toggleMenu(false); });
  $("open-stats").addEventListener("click", () => openStats(false));
  $("open-apps").addEventListener("click", () => openStats(true));
  $("open-greeting").addEventListener("click", openGreeting);
  $("clear-chat").addEventListener("click", () => { toggleMenu(false); openChat(account, false); });
  $("sign-out").addEventListener("click", () => {
    toggleMenu(false);
    if (realAuth && session()) freshToken().then((t) => t && auth("logout", null, "POST", t)).catch(() => { /* signed out on this phone anyway */ });
    [ACCOUNT_KEY, PREFS_KEY, CONN_KEY, ACTIVITY_KEY, PLACE_KEY, SESSION_KEY].forEach(drop);
    account = null;
    ["contact", "code", "name"].forEach((id) => { $(id).value = ""; });
    setPlan("personal");
    step("contact");
    show("welcome");
  });

  // Android back button: close whatever is open first, then go back to the chat
  window.ervoBack = function () {
    if (!$("perm").hidden) { answerPermission(false); return true; }
    if (!$("update").hidden) { $("update").hidden = true; return true; }
    if (!$("greet").hidden) { $("greet").hidden = true; return true; }
    if (!voice.hidden) { $("voice-cancel").click(); return true; }
    if (!menu.hidden) { toggleMenu(false); return true; }
    if ($("stats").classList.contains("active")) { show("chat"); return true; }
    if (!$("attach-sheet").hidden) { closeAttach(); return true; }
    if (!$("link-row").hidden) { $("link-row").hidden = true; return true; }
    const active = document.querySelector(".step.active");
    if ($("welcome").classList.contains("active") && active && active.dataset.step !== "contact") {
      step(active.dataset.step === "name" ? "code" : "contact");
      return true;
    }
    return false;
  };

  // ---------- offline support for the home-screen (iPhone) version ----------
  // The Android app bundles its files already, so it doesn't need this.
  if ("serviceWorker" in navigator && !native && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* still works online */ });
  }

  // ---------- start: always opens straight to the chat ----------
  applyTheme(storedTheme() || (system.matches ? "dark" : "light"));
  setPlan("personal");
  setTimeout(() => {
    const saved = load(ACCOUNT_KEY);
    if (saved && saved.plan && saved.name) openChat(saved, false);
    else show("welcome");
  }, 1100);
  setTimeout(() => checkForUpdate(false), 4000);
})();
