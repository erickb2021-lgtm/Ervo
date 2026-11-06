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
  // Pop-up mode: "Hey Ervo" or the assistant button, drawn over other apps (Android)
  const OVERLAY = /[?&]overlay=1\b/.test(location.search);
  if (OVERLAY) document.documentElement.classList.add("overlay");
  const $ = (id) => document.getElementById(id);

  // ---------- storage ----------
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const drop = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- theme: always follows the phone's light/dark setting ----------
  // (Apple and Samsung both say not to add an app-only appearance switch.)
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  drop(THEME_KEY); // 0.2.9: the old sun/moon choice is gone; follow the phone again
  function applyTheme(t) {
    root.dataset.theme = t;
    document.querySelectorAll("img[data-dark]").forEach((img) => {
      if (!img.dataset.light) img.dataset.light = img.getAttribute("src");
      img.src = t === "dark" ? img.dataset.dark : img.dataset.light;
    });
    syncBars();
  }
  system.addEventListener("change", (e) => applyTheme(e.matches ? "dark" : "light"));

  // ---------- text size: follows the phone, up to twice the normal size ----------
  // iPhone: read the Dynamic Type body size (17px at the default setting).
  // Android: the app's WebView already scales text with the phone's font size.
  const IOS = /iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent) || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
  function fitTextSize() {
    if (!IOS || !CSS.supports("font", "-apple-system-body")) return;
    const probe = document.createElement("span");
    probe.style.cssText = "font:-apple-system-body;position:absolute;visibility:hidden";
    probe.textContent = "x";
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).fontSize) || 17;
    probe.remove();
    // 17px is the normal size; keep small phones a touch smaller, and cap at 2x
    const narrow = Math.min(1, Math.max(0.88, window.innerWidth / 400));
    root.style.fontSize = Math.min(34, Math.max(14, px * narrow)) + "px";
  }
  fitTextSize();
  window.addEventListener("resize", fitTextSize);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) fitTextSize(); });

  // ---------- haptics (Android): light, only for clear cause and effect ----------
  // Uses the phone's own haptic feedback, so it follows the phone's touch-feedback setting.
  function buzz(kind) { try { if (native && native.haptic) native.haptic(kind); } catch (e) { /* older app */ } }

  // Android: color the phone's top and bottom bars to match the screen
  function syncBars() {
    if (!native || !native.setBars) return;
    const css = getComputedStyle(root);
    const v = (name) => css.getPropertyValue(name).trim();
    const screen = document.querySelector(".screen.active");
    const id = screen ? screen.id : "";
    const grouped = ["stats", "activity", "library", "psyche", "ideas"].includes(id);
    const sky = id === "stats" ? getComputedStyle(screen).getPropertyValue("--sky-1").trim() : "";
    const top = id === "chat" ? v("--surface") : sky || (grouped ? v("--group") : v("--bg"));
    const bottom = sky ? getComputedStyle(screen).getPropertyValue("--sky-3").trim() : grouped ? v("--group") : v("--bg");
    if (sky) { native.setBars(top, bottom, true); return; }
    if (id === "chat") { const g = getComputedStyle(screen).getPropertyValue("--chat-bg").trim(); if (g) { native.setBars(g, g, root.dataset.theme === "dark"); return; } }
    native.setBars(top, bottom, root.dataset.theme === "dark");
  }

  // ---------- screens ----------
  // How deep each screen sits, so moving in slides from the right and going back slides away
  // to the right, like every iPhone app (Apple: navigation is a stack you push and pop)
  const DEPTH = { splash: 0, welcome: 0, chat: 0, stats: 1, psyche: 1, ideas: 1, library: 1, activity: 2 };
  function show(id) {
    const chatWas = $("chat").classList.contains("active");
    if (chatWas && id !== "chat") savedScroll = $("thread").scrollTop;
    const from = document.querySelector(".screen.active");
    const to = $(id);
    if (from && from !== to && !root.classList.contains("first")) {
      const d = (DEPTH[id] || 0) - (DEPTH[from.id] || 0);
      document.querySelectorAll(".screen.push-in, .screen.pop-out, .screen.under").forEach((s) => s.classList.remove("push-in", "pop-out", "under"));
      if (d > 0) { to.classList.add("push-in"); from.classList.add("under"); }
      else if (d < 0) { from.classList.add("pop-out"); to.classList.add("under"); }
      if (d) setTimeout(() => { from.classList.remove("pop-out", "under"); to.classList.remove("push-in", "under"); }, 420);
    }
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    if (to && to.classList.contains("stats")) syncTitle(to);
    if (id === "chat" && !chatWas && savedScroll !== null) { const keep = savedScroll; savedScroll = null; requestAnimationFrame(() => { if (!stuck) $("thread").scrollTop = keep; else $("thread").scrollTop = $("thread").scrollHeight; }); }
    syncBars();
    syncDock();
  }

  // ---------- Personal vs Business ----------
  const PLAN = {
    personal: {
      label: "Personal", avatar: "img/ervo-classic.png",
      hint: "Personal use only: planning, shopping, your own returns and more.",
      question: "What should Ervo call you?", nameLabel: "Your name", placeholder: "Alex", nameError: "Enter your name.",
      chips: ["Book a table for 4 tonight", "Gym Friday at 6pm", "Buy paper towels", "What's coming up?", "Weather"],
      apps: ["phonecal", "calendar", "contacts", "clock", "meet", "zoom", "teams", "amazon", "health", "location"],
    },
    business: {
      label: "Business", avatar: "img/ervo-business.png",
      hint: "Business use only: customer support, refunds by your policy, scheduling and more.",
      question: "What's your company called?", nameLabel: "Company name", placeholder: "Acme Coffee Co.", nameError: "Enter your company's name.",
      chips: ["Refund order #5512", "Summarize today's tickets", "Call with Northwind Thursday at 2pm", "Draft a reply to an upset customer"],
      apps: ["phonecal", "calendar", "contacts", "clock", "meet", "zoom", "teams", "mail", "location"],
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
  const DEFAULT_PREFS = { nickname: "", time: false, date: true, weather: true, news: false, stepsGoal: 8000 };
  const prefs = () => Object.assign({}, DEFAULT_PREFS, load(PREFS_KEY) || {});
  // 0.2.7: the calendar choice starts over once, so Ervo asks and can use one of the phone's own calendars
  if (!load("ervo-cal-reset-027")) {
    const p0 = load(PREFS_KEY);
    if (p0 && p0.calendar) { delete p0.calendar; delete p0.calId; delete p0.calName; save(PREFS_KEY, p0); }
    save("ervo-cal-reset-027", 1);
  }
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
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M5 3.5 2.5 6M19 3.5 21.5 6"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/></svg>',
    plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 13.5 3 11l1.5-1.5 7.5 1L17 5.5a2 2 0 0 1 3 3l-5 5 1 7.5L14.5 22 12 14.5"/><path d="M7 17l-3 1 1-3"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7v8.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19.5z"/><path d="M10 21v-6h4v6"/></svg>',
    ball: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="m12 7.5 4 3-1.5 4.5h-5L8 10.5zM12 3.5v4M20 10l-4 .5M17 19l-2.5-4M7 19l2.5-4M4 10l4 .5"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
    tooth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 3.5c-2.5 0-4 2-4 4.5 0 3 1.5 4.5 2 7 .5 3 1 5.5 2.5 5.5s1.5-4 4-4 2.5 4 4 4 2-2.5 2.5-5.5c.5-2.5 2-4 2-7 0-2.5-1.5-4.5-4-4.5-2 0-3 1-4.5 1s-2.5-1-4.5-1z"/></svg>',
    doctor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/></svg>',
    money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v5M18 9.5v5"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
    car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V11l2-5h10l2 5v5"/><path d="M3.5 16h17v3h-17zM5 11h14"/><circle cx="7.5" cy="13.5" r=".6"/><circle cx="16.5" cy="13.5" r=".6"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 5.5 5.5"/></svg>',
    brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M8.5 4.5A3.5 3.5 0 0 0 5 8a3.5 3.5 0 0 0-1 6.5A3.5 3.5 0 0 0 8.5 20M15.5 4.5A3.5 3.5 0 0 1 19 8a3.5 3.5 0 0 1 1 6.5 3.5 3.5 0 0 1-4.5 5.5"/></svg>',
  };

  // Apps Ervo can work with. Allow opens the app (or its sign-in page if you're signed out).
  const CONNECTORS = {
    phonecal: {
      name: "Phone calendar", ico: "calendar",
      does: ["Open your calendar app with events Ervo plans for you", "You pick which calendar it goes on, then tap Save"],
      note: "Works with your phone's own calendar app. Ervo can't see your other events.",
    },
    calendar: {
      name: "Google Calendar", ico: "calendar", login: "https://calendar.google.com/calendar/",
      does: ["Add events and reservations Ervo plans for you", "You pick which Google calendar and tap Save"],
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
    contacts: {
      name: "Contacts & calls", ico: "phone",
      does: ["Find people in your contacts when you ask Ervo to call them", "Start the call you pick", "Ervo never calls emergency services"],
      note: "Your phone will ask you one more time. Your contacts stay on your phone.",
    },
    meet: {
      name: "Google Meet", ico: "open", login: "https://meet.google.com/",
      does: ["Set up Google Meet video calls you ask for", "Adds the Meet link through Google Calendar"],
      note: "Ervo opens Google Meet (or Google's sign-in page). Ervo never sees your password.",
    },
    zoom: {
      name: "Zoom", ico: "open", login: "https://zoom.us/signin",
      does: ["Start or schedule Zoom meetings you ask for"],
      note: "Ervo opens Zoom (or its sign-in page). Ervo never sees your password.",
    },
    teams: {
      name: "Microsoft Teams", ico: "open", login: "https://teams.live.com/",
      does: ["Start or schedule Teams meetings you ask for", "Skype moved to Teams in 2025"],
      note: "Ervo opens Teams (or Microsoft's sign-in page). Ervo never sees your password.",
    },
    clock: {
      name: "Clock", ico: "clock",
      does: ["Set timers and alarms in your phone's Clock app", "Show your alarms"],
      note: "Uses your phone's own Clock app. You can change or delete them there anytime.",
    },
    mail: {
      name: "Email", ico: "mail",
      does: ["Open replies Ervo drafts in your email app", "You review and send each one yourself"],
      note: "Ervo opens your email app with the draft filled in.",
    },
  };

  // Stores and delivery apps. Their links open the store's own app when it's installed,
  // or its website when it isn't. Ervo never checks out or pays.
  const STORES = {
    amazon: { name: "Amazon", search: (q) => `https://www.amazon.com/s?k=${q}` },
    heb: { name: "H-E-B", search: (q) => `https://www.heb.com/search/?q=${q}` },
    sprouts: { name: "Sprouts", search: (q) => `https://shop.sprouts.com/search?search_term=${q}` },
    walmart: { name: "Walmart", search: (q) => `https://www.walmart.com/search?q=${q}` },
    target: { name: "Target", search: (q) => `https://www.target.com/s?searchTerm=${q}` },
    instacart: { name: "Instacart", search: (q) => `https://www.instacart.com/store/s?k=${q}` },
    doordash: { name: "DoorDash", search: (q) => `https://www.doordash.com/search/store/${q}/` },
    grubhub: { name: "Grubhub", search: (q) => `https://www.grubhub.com/search?queryText=${q}` },
    ubereats: { name: "Uber Eats", search: (q) => `https://www.ubereats.com/search?q=${q}` },
  };
  Object.keys(STORES).forEach((key) => {
    if (CONNECTORS[key]) return;
    const name = STORES[key].name;
    CONNECTORS[key] = {
      name, ico: "shop",
      does: [`Open ${name} to search for things you ask Ervo to find`, "Ervo never buys anything or checks out for you"],
      note: `Opens the ${name} app if you have it, or its website.`,
    };
  });
  const STORE_WORDS = [
    ["heb", /\bh-?e-?b\b/], ["sprouts", /\bsprouts\b/], ["walmart", /\bwalmart\b/], ["target", /\b(at|from|on) target\b/],
    ["instacart", /\binstacart\b/], ["doordash", /\bdoor ?dash\b/], ["grubhub", /\bgrub ?hub\b/], ["ubereats", /\buber ?eats\b/], ["amazon", /\bamazon\b/],
  ];
  const storeIn = (t) => { const hit = STORE_WORDS.find((w) => w[1].test(t)); return hit ? hit[0] : null; };

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
    // "something on my calendar tomorrow to go to the store" → "Go to the store"
    if ((m = raw.match(/\b(?:calendar|schedule|reminder|something|an event)\b.*?\b(?:to|so i can|i need to|i have to)\s+((?:go|pick|call|buy|get|do|see|meet|visit|take|pay|finish|clean|work|watch|study|cook|walk|run|drop|bring|fix|send|check|wash|start|book)\b.+)$/i))) {
      const purpose = tidy(m[1]).replace(/\s+(for|on|at|in|to)$/i, "");
      if (purpose) return cap(purpose);
    }
    let s = raw.replace(/^(please |can you |could you |ervo,? )*(schedule|add|put|plan|set up|book|make|create|block( off)?|fit)( me)?( an?| the| my)?\s*/i, "");
    s = s.replace(/^(something|an event|a reminder|an appointment|it)\s+/i, "");
    s = s.replace(/\b(to|on|in|into) (my )?(\w+ )?(calendar|schedule)\b/gi, "");
    s = tidy(s).replace(/^(for|to|on|at)\s+|\s+(for|to|on|at|in)$/gi, "").trim();
    return s ? cap(s) : "New event";
  }

  // "can you find me some insoles to buy" → "insoles"
  function shopItem(raw) {
    let s = raw.replace(/^(please |can you |could you |ervo,? |i need to |i want to |i'd like to |help me )*(buy|order|purchase|get( me)?|shop for|find( me)?|add|look(ing)? for|reorder|recommend( me)?|search( for)?)\s+(me\s+)?(some |a |an |the |more |new |good |a good |some good )?/i, "");
    s = s.replace(/^(i need|we need|i want) (some |a |an |more |new )?/i, "");
    s = s.replace(/\s+(to|that i can|i can) (buy|purchase|order|get)\b.*$/i, "");
    s = s.replace(/\b(on|from|off|at|in|through|with|using) (amazon|h-?e-?b|sprouts|walmart|target|instacart|door ?dash|grub ?hub|uber ?eats)\b|\bto (my )?cart\b|\bonline\b|\bfor me\b|\bplease\b/gi, "");
    return tidy(s).replace(/^(some|a|an|the)\s+/i, "");
  }
  // "insoles for long work hours", "best headphones under $100": worth researching, not just searching
  const wantsAdvice = (item, t) => /\b(for|best|recommend|good|top|under \$?\d|that|which|comfortable|durable|cheap|budget)\b/.test(`${item} ${t}`);

  // Settings you can change just by asking: nickname, light/dark, greeting, which calendar
  function parseSettings(raw, t) {
    let m = raw.match(/\b(?:change|set|update|switch|make|rename)\s+(?:my\s+)?(?:nick ?name|name)\s+(?:to|as|into|=)\s*["“']?(.+?)["”']?\s*[.!]*$/i)
      || raw.match(/^(?:please\s+)?(?:call me|my (?:nick ?name|name) is|i go by)\s+["“']?(.+?)["”']?\s*[.!]*$/i)
      || raw.match(/\b(?:nick ?name)\s+(?:to|=|should be)\s*["“']?(.+?)["”']?\s*[.!]*$/i);
    if (m && m[1].trim().length <= 30) return { kind: "nickname", value: m[1].trim() };
    if (/\b(dark|night) (mode|theme)\b/.test(t)) return { kind: "theme", value: /\b(off|disable|stop)\b/.test(t) ? "light" : "dark" };
    if (/\blight (mode|theme)\b/.test(t)) return { kind: "theme", value: "light" };
    const items = ["weather", "news", "time", "date"].filter((w) => new RegExp(`\\b${w}\\b`).test(t));
    if (items.length && /\b(greeting|greet me|when i open|turn (on|off)|show|hide|stop (showing|telling)|add|remove)\b/.test(t) && !/\bwhat'?s\b/.test(t)) {
      return { kind: "greeting", items, on: !/\b(off|remove|hide|stop|don'?t|no more)\b/.test(t) };
    }
    if (/\bcalendar\b/.test(t) && /\b(use|switch|instead|change|prefer|rather|default|from now on|do it|put it|move it)\b/.test(t) && !/\b(remind|schedule|appointment|meeting)\b/.test(t)) {
      if (/\b(phone|samsung|apple|iphone|ios|my own|default|regular|normal|built.?in)\b/.test(t) || /calendar app/.test(t)) return { kind: "calendar", value: "phone" };
      if (/\bgoogle\b/.test(t)) return { kind: "calendar", value: "google" };
    }
    return null;
  }

  // Ervo follows the phone's look, so point to where it's changed
  function themeHelp(want) {
    const already = root.dataset.theme === want;
    if (native && native.openDisplaySettings) {
      return ervoSays(already ? `Your phone is already in ${want} mode, and Ervo follows it.` : `Ervo follows your phone's look. Turn ${want === "dark" ? "on" : "off"} Dark mode in your phone's Display settings.`,
        already ? {} : { acts: [{ label: "Open Display settings", icon: "sun", onClick: () => native.openDisplaySettings() }] });
    }
    const where = IOS ? `go to Settings > Display & Brightness and choose ${want === "dark" ? "Dark" : "Light"}` : `turn Dark mode ${want === "dark" ? "on" : "off"} in your phone's display settings`;
    return ervoSays(already ? `Your phone is already in ${want} mode, and Ervo follows it.` : `Ervo follows your phone's look. To switch, ${where}.`);
  }

  async function applySettings(s) {
    const p = prefs();
    if (s.kind === "nickname") {
      p.nickname = s.value;
      save(PREFS_KEY, p);
      return ervoSays(`Done ✅ I'll call you ${s.value} from now on.`, { status: ["✏️", "Updating your nickname"] });
    }
    if (s.kind === "theme") return themeHelp(s.value);
    if (s.kind === "greeting") {
      if (s.on && s.items.some((i) => i === "weather" || i === "news") && !allowed("location")) {
        if (!(await ensure("location", "Show the weather and local news in your greeting"))) return ervoSays("Okay, I'll leave your greeting as it is.");
        getPlace().catch(() => { /* the phone said no */ });
      }
      s.items.forEach((i) => { p[i] = s.on; });
      save(PREFS_KEY, p);
      return ervoSays(`Done ✅ ${s.on ? "I'll include" : "I'll leave out"} the ${listJoin(s.items)} when I greet you.`);
    }
    if (s.kind === "calendar") return switchCalendar(s.value);
  }

  // ---------- understanding: what does the person want? ----------
  const BUSINESS_WORDS = /\b(customer|customers|ticket|tickets|employee|employees|staff|invoice|invoices|client|clients|sales team|my team|payroll|vendor|vendors)\b/i;
  const PERSONAL_WORDS = /\b(buy me|for me to eat|groceries|snacks|gym|workout|my birthday|my headphones|vacation|date night|my mom|my dad|my kids|dentist|haircut)\b/i;

  // Common typos, so "calander" and "tmrw" still make sense
  const fixSpelling = (s) => s
    .replace(/\bcal[aeiou]n?d[aeiou]?r+s?\b/gi, "calendar")
    .replace(/\b(tmrw|tmr|tmrow|tommorow|tomorow|tommorrow|tomm?orrow)\b/gi, "tomorrow")
    .replace(/\b(nick name|nickanme|nicname)\b/gi, "nickname")
    .replace(/\b(resturant|restraunt|restaraunt)\b/gi, "restaurant");

  function understand(text) {
    const raw = fixSpelling(text.trim());
    const t = raw.toLowerCase().replace(/[’‘]/g, "'");
    const evening = /\b(dinner|tonight|evening|drinks|supper)\b/.test(t);
    const when = parseWhen(t, new Date(), evening);
    const d = { raw, t, when, party: parseParty(t), intent: "unknown" };
    const is = (re) => re.test(t);
    const biz = account.plan === "business";

    d.settings = parseSettings(raw, t);
    if (d.settings) d.intent = "settings";
    else if (is(/^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|sounds good|please do|book it|add it|confirm|let'?s do it|correct|perfect)\b/)) d.intent = "yes";
    else if (is(/^(no|nope|nah|not now|stop|never ?mind|don'?t)\b|^cancel( it| that| this)?[.!]?$/)) d.intent = "no";
    else if (is(/\bhey ervo\b.*\b(on|off|settings?|set ?up|work)\b|\b(turn on|turn off|enable|disable|set up|setup)\b.*\b(hey ervo|wake word|hands.?free|voice activation)\b/)) { d.intent = "wake"; d.wakeTurn = /\b(off|disable)\b/.test(t) ? false : /\b(on|enable)\b/.test(t) ? true : undefined; }
    else if (is(/\b(timer|countdown)\b/) && !is(/\b(cancel|stop|delete)\b/)) { d.intent = "timer"; d.seconds = parseDuration(t); const lb = t.match(/\b(?:for|called|named) (?:the |my )?([a-z][a-z ]{1,25})$/); d.label = lb && !parseDuration(lb[1]) ? cap(lb[1].trim()) : ""; }
    else if (is(/\balarms?\b/) && is(/\b(cancel|delete|remove|turn off|switch off|clear|get rid of|dismiss|disable|stop)\b/)) { d.intent = "alarmOff"; d.alarm = parseAlarm(t.replace(/\b(all|every)\b/g, "")); if (is(/\b(all|every|my alarms)\b/)) d.alarm.h = null; }
    else if (is(/\balarm\b/) && is(/\b(change|move|reset|re-set|push|switch|update|make)\b.*\bto\b/)) d.intent = "alarmChange";
    else if (is(/\b(google meet|meet link|zoom|ms teams|microsoft teams|teams (meeting|call)|skype|video (call|meeting|chat))\b/) && !is(/\b(remove|delete|cancel)\b/)) { d.intent = "meeting"; d.meeting = parseMeeting(d); }
    // Calendar edits only; "rename my screenshots" or "rename this file" goes to the AI
    else if (!is(/\b(files?|screenshots?|photos?|pictures?|pics?|images?|documents?|docs?|folders?|songs?|playlists?|pdfs?|wi-?fi|contacts?)\b/) && (is(/\b(rename|re-name|retitle|reschedule|change the (name|title) of)\b/) || (is(/\b(change|move|push|shift|update|bump)\b/) && is(/\bto\b/) && !is(/\b(nickname|name to|theme|mode|calendar to|greeting|alarm|timer)\b/) && (is(/\b(event|meeting|appointment|reservation|dinner|lunch|breakfast|gym|call|dentist|doctor|class|practice)\b/) || parseWhen(t.split(/\bto\b/).pop(), new Date(), false).time)))) d.intent = "edit";
    else if (is(/\balarms?\b|\bwake me\b/)) { d.intent = is(/\b(show|see|what|list|check)\b.*\balarms\b/) ? "alarms" : "alarm"; d.alarm = parseAlarm(t); }
    else if (is(/^(?:\s*(?:please|can you|could you|would you|hey|ok|okay|ervo|hey ervo)[,!]?\s+)*(?:call|phone|ring|dial|facetime|give)\b/) && !is(/\b(call|phone) with\b|\bschedule\b|\bset up\b|\bbook\b|\bcalled\b/) && !(is(/^give\b/) && !is(/\ba call\b/))) { d.intent = "call"; d.callee = callName(raw); }
    else if (EMERGENCY_RE.test(t) && is(/\b(call|phone|dial|text|contact|get|send)\b/)) d.intent = "emergency";
    else if (is(/what can you do|how do you work|what do you do|^help\b|^menu$/)) d.intent = "help";
    else if (is(/^(thanks|thank you|thx|ty|appreciate it|cool|great|awesome|nice)\b/) && t.length < 30) d.intent = "thanks";
    else if (is(/^(hi|hey|hello|yo|sup|hiya|good (morning|afternoon|evening)|what'?s up)\b/) && t.length < 25) d.intent = "hello";
    else if (is(/\b(delete|remove|cancel|scrap|drop) (it|that|this( one)?)\b|\b(got|was|has been|is|been) (cancell?ed|called off)\b/) && !is(/\b(order|subscription|cart|membership|account|photo|file|alarms?|timers?)\b/)) { d.intent = "remove"; d.removeLast = true; }
    else if (is(/\b(remove|delete|cancel|take off|clear|get rid of)\b/) && (is(/\b(calendar|events?|appointments?|meetings?|reservations?|plans?|reminders?)\b|\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/) || is(/^(please |can you |could you |ervo,? )*(cancel|remove|delete) (my |the )/) ) && !is(/\b(order|subscription|membership|account|cart|amazon|package|photo|photos|file|files|email|message|alarms?|timers?)\b/)) d.intent = "remove";
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
      else if (is(/\b(buy|purchase|shop|add to (my )?cart|get me|amazon|reorder|find me|look(ing)? for|recommend|shopping for)\b|^order\b|^(i need|we need|we'?re out of|i'?m out of) |\bbest [a-z ]+ (for|under)\b/) || (storeIn(t) && /\b(get|order|find|search|want|need|some)\b/.test(t))) d.intent = "shop";
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
    if (d.intent === "shop") { tk.item = shopItem(d.raw); tk.store = storeIn(d.t); }
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

  function askForMissing(tk) {
    const miss = missing(tk);
    const opts = {};
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
    const opts = { chips: ["Yes", "No"] };
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
    if (tk.intent === "shop") return ervoSays(`Want me to find ${tk.item} on ${STORES[tk.store || "amazon"].name}? 🛍️`, opts);
  }

  // ---------- calendars: the phone's own calendar app, or Google Calendar ----------
  // An event is { title, start: Date, end: Date, allDay, notes }.
  const pad2 = (n) => String(n).padStart(2, "0");
  const stamp = (x, withTime) => `${x.getFullYear()}${pad2(x.getMonth() + 1)}${pad2(x.getDate())}` + (withTime ? `T${pad2(x.getHours())}${pad2(x.getMinutes())}00` : "");
  const CAL_NAMES = { phone: "your phone's calendar", google: "Google Calendar" };
  let lastEvent = null;

  function eventFromTask(tk, title, minutes) {
    const allDay = !!(tk.allDay || !tk.time);
    const start = allDay ? startOfDay(tk.date) : at(tk);
    const end = allDay ? addDays(start, 1) : new Date(start.getTime() + minutes * 60000);
    return { title, start, end, allDay, notes: "Planned with Ervo" };
  }

  function googleLink(ev) {
    const dates = ev.allDay ? `${stamp(ev.start)}/${stamp(ev.end)}` : `${stamp(ev.start, true)}/${stamp(ev.end, true)}`;
    const q = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates, details: ev.notes || "Planned with Ervo", ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || "" });
    return `https://calendar.google.com/calendar/render?${q}`;
  }

  // iPhone (and computers): a calendar file. iPhone shows "Add to Calendar", where you pick the calendar.
  function openIcs(ev) {
    const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
    const utc = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const when = (d) => (ev.allDay ? `;VALUE=DATE:${stamp(d)}` : `:${stamp(d, true)}`);
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ervo//Ervo app//EN", "BEGIN:VEVENT",
      `UID:${Date.now().toString(36)}@ervo.app`, `DTSTAMP:${utc}`, `DTSTART${when(ev.start)}`, `DTEND${when(ev.end)}`,
      `SUMMARY:${esc(ev.title)}`, `DESCRIPTION:${esc(ev.notes || "Planned with Ervo")}`, "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const url = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) { location.href = url; return; }
    const a = document.createElement("a");
    a.href = url;
    a.download = "ervo-event.ics";
    document.body.append(a);
    a.click();
    a.remove();
  }

  // Asks where new events go: one of the phone's calendars (each Google account synced to the
  // phone shows up here), or the Google Calendar website. Ervo keeps using it until you change it.
  let calResolve = null;
  let calsWaiter = null;
  window.ervoCalendars = (json) => { const r = calsWaiter; calsWaiter = null; if (r) { try { r(JSON.parse(json)); } catch (e) { r({ status: "error" }); } } };
  async function pickCalendar() {
    const list = $("cal-list");
    list.innerHTML = "";
    $("cal-phone").hidden = false;
    if (native && native.listCalendars) {
      const r = await nativeCall((f) => { calsWaiter = f; }, () => native.listCalendars(), 30000);
      if (r.status === "ready" && r.calendars && r.calendars.length) {
        $("cal-phone").hidden = true;
        r.calendars.forEach((c) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "choice";
          b.innerHTML = '<span class="cal-dot"></span><span class="txt"><b></b><small></small></span>';
          b.querySelector(".cal-dot").style.background = c.color || "#1a73e8";
          b.querySelector("b").textContent = c.name;
          b.querySelector("small").textContent = c.account && c.account !== c.name ? `${c.account}${c.google ? " · Google" : ""}` : c.google ? "Google, synced to this phone" : "On this phone";
          if (prefs().calId === c.id) b.classList.add("current");
          const label = c.account && c.account.includes("@") ? (c.name === c.account ? c.account : `${c.name} (${c.account})`) : c.name;
          b.addEventListener("click", () => answerCalendar({ which: "phone", id: c.id, name: label }));
          list.append(b);
        });
      } else if (r.status === "denied") {
        const p = document.createElement("p");
        p.className = "muted cal-note";
        p.textContent = "Allow calendar access to pick one of your phone's calendars.";
        list.append(p);
      }
    }
    $("calpick").hidden = false;
    return new Promise((resolve) => { calResolve = resolve; });
  }
  function answerCalendar(choice) {
    $("calpick").hidden = true;
    const r = calResolve;
    calResolve = null;
    if (r) r(choice);
  }
  $("cal-phone").addEventListener("click", () => answerCalendar({ which: "phone" }));
  $("cal-google").addEventListener("click", () => answerCalendar({ which: "google", name: "Google Calendar" }));
  $("cal-cancel").addEventListener("click", () => answerCalendar(null));
  $("calpick").addEventListener("click", (e) => { if (e.target === $("calpick")) answerCalendar(null); });
  // ---------- removing events ----------
  // Android reads and removes events in the phone's calendar (Google calendars synced to the
  // phone included). Ervo shows them in a day card; the user taps the ones to remove, then
  // can Undo. iPhone web apps can't read the calendar, so there Ervo opens the calendar.
  let eventsWaiter = null;
  window.ervoEvents = (json) => { const r = eventsWaiter; eventsWaiter = null; if (r) { try { r(JSON.parse(json)); } catch (e) { r({ status: "error" }); } } };
  let deleteWaiter = null;
  window.ervoEventDeleted = (json) => { const r = deleteWaiter; deleteWaiter = null; if (r) { try { r(JSON.parse(json)); } catch (e) { r({ ok: false }); } } };
  let restoreWaiter = null;
  window.ervoEventRestored = (json) => { const r = restoreWaiter; restoreWaiter = null; if (r) { try { r(JSON.parse(json)); } catch (e) { r({ ok: false }); } } };
  let removeAsk = null; // Ervo asked "when is it?" and is waiting for a day

  function forgetPlanned(title, start) {
    const t = String(title || "").toLowerCase();
    save(ACTIVITY_KEY, activity().filter((a) => !(a.when && a.title.toLowerCase() === t && (!start || Math.abs(new Date(a.when) - start) < 60000))));
  }

  // Words that describe the request, not the event's name
  const REMOVE_STOP = new Set(("hi hey hello yo ervo please pls plz can could would will you u ya me i i'd i'm id im want wanna need to " +
    "remove delete cancel clear take off get rid of erase drop the my a an that this these those next upcoming first last both all every " +
    "everything event events appointment appointments plan plans reservation reservations reminder reminders thing things stuff from " +
    "on in at for calendar calendars today tonight tomorrow week weeks month months day days and set are is it its it's them they " +
    "scheduled schedule there one two three four five six seven eight nine ten couple of up coming soon thanks thank " +
    "monday tuesday wednesday thursday friday saturday sunday").split(" "));
  const cleanTitle = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}'&\s-]/gu, " ").split(/\s+/)
    .filter((w) => w && !REMOVE_STOP.has(w) && !/^\d+(st|nd|rd|th|am|pm)?$/.test(w)).join(" ");

  const NUM = { one: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const dayRange = (date) => ({ from: startOfDay(date), to: addDays(startOfDay(date), 1), label: sameDay(date, new Date()) ? "today" : sameDay(date, addDays(new Date(), 1)) ? "tomorrow" : `on ${fmtDate(date)}` });
  const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
  function weekRange(next) {
    const today = startOfDay(new Date());
    const monday = addDays(today, ((8 - today.getDay()) % 7) || 7); // the coming Monday
    return next ? { from: monday, to: addDays(monday, 7), label: "next week" } : { from: today, to: monday, label: "this week" };
  }
  function monthRange() {
    const today = startOfDay(new Date());
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return { from: today, to: end - today < 7 * 864e5 ? addDays(today, 14) : end, label: end - today < 7 * 864e5 ? "in the next two weeks" : "this month" };
  }
  const upcomingRange = () => ({ from: new Date(), to: addDays(new Date(), 90), label: "coming up" });

  // "remove the next two events from my calendar" -> { count: 2 }; "cancel the dentist friday" -> { title, range }
  function parseRemove(d) {
    const t = d.t;
    const m = t.match(/\b(?:next|first|upcoming)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|couple)\b/) ||
      t.match(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:next|upcoming)\b/);
    let count = m ? (NUM[m[1]] || +m[1] || 0) : /\b(next|upcoming) (event|appointment|meeting|thing|plan)\b/.test(t) ? 1 : 0;
    if (!count && /\bboth\b/.test(t)) count = 2;
    let range = null;
    if (/\bthis week\b/.test(t)) range = weekRange(false);
    else if (/\bnext week\b/.test(t)) range = weekRange(true);
    else if (/\b(this|the) month\b/.test(t)) range = monthRange();
    else if (d.when.date) range = dayRange(d.when.date);
    return { title: cleanTitle(t), count: Math.min(count, 10), all: /\b(all|everything|every)\b/.test(t), range };
  }

  // Quick day buttons, so nobody has to type
  function rangeButtons(q, skip) {
    return [["Today", () => dayRange(new Date())], ["Tomorrow", () => dayRange(addDays(new Date(), 1))], ["This week", () => weekRange(false)], ["Next week", () => weekRange(true)], ["This month", monthRange]]
      .filter(([label]) => label.toLowerCase() !== skip)
      .map(([label, make]) => ({ label, icon: "calendar", onClick: (e) => { e.currentTarget.closest(".acts").remove(); bubble(label, "me"); history.push({ role: "user", text: label }); removeEvents(Object.assign({}, q, { range: make() })); } }));
  }

  function readCalendar(title, range) {
    return new Promise((resolve) => {
      eventsWaiter = resolve;
      native.findEvents(title || "", range.from.getTime(), range.to.getTime());
      setTimeout(() => { if (eventsWaiter === resolve) { eventsWaiter = null; resolve({ status: "error" }); } }, 10000);
    });
  }

  async function removeEvents(q) {
    q = Object.assign({ title: "", count: 0, all: false, range: null }, q);
    q.title = cleanTitle(q.title);
    removeAsk = null;
    if (!(native && native.findEvents)) return removeOnWeb(q);
    if (!(await ensure("phonecal", "Find and remove events on your calendar"))) return ervoSays("Okay, I won't touch your calendar.");
    // No day and no name: ask with buttons instead of guessing
    if (!q.title && !q.range && !q.count) {
      removeAsk = q;
      return ervoSays("Sure 🗓️ When is it?", { acts: rangeButtons(q) });
    }
    const range = q.range || (q.count ? upcomingRange() : { from: startOfDay(new Date()), to: addDays(startOfDay(new Date()), 180), label: "in the next 6 months" });
    showTyping("checking your calendar");
    setStatus("📅", "Checking your calendar");
    const found = await readCalendar(q.title, range);
    if (found.status === "denied") return ervoSays("I need permission to see your calendar. You can allow it in Settings → Apps → Ervo → Permissions → Calendar.");
    if (found.status !== "ready") return ervoSays("I couldn't read your calendar just now. Try again in a moment.");
    let events = found.events;
    let shown = range;
    let lead = "";
    if (!events.length && q.title) {
      // Nothing by that name, so show what's there and let them pick
      shown = q.range || monthRange();
      const all = await readCalendar("", shown);
      events = all.status === "ready" ? all.events : [];
      if (events.length) lead = `I couldn't find "${q.title}", but here's what's on ${shown.label === "today" || shown.label === "tomorrow" ? shown.label : `your calendar ${shown.label}`} 👇`;
    }
    if (!events.length) {
      const cals = found.calendars || [];
      const google = cals.filter((c) => c.google).map((c) => c.account);
      const help = !cals.length ? "I can't see any calendars on this phone. Add your Google account in Settings → Accounts, and turn on Calendar sync."
        : !google.length ? `The only calendars I can see are on ${listJoin(cals.map((c) => c.account))}. To use Google Calendar, turn on Calendar sync in Settings → Accounts → Google.`
        : `I'm looking at ${listJoin(google)}. If an event is missing, check that Calendar sync is on in Settings → Accounts → Google.`;
      return ervoSays(`I don't see anything on your calendar ${shown.label} 🤔 ${help}`,
        { acts: rangeButtons(Object.assign({}, q, { title: "" }), shown.label) });
    }
    let picked = [];
    if (q.count) picked = events.slice(0, q.count).map((_, i) => i);
    else if (q.all || (q.title && !lead && events.length === 1)) picked = events.map((_, i) => i);
    if (!lead) {
      const where = shown.label === "today" || shown.label === "tomorrow" ? shown.label : `what's ${shown.label}`;
      lead = q.count && q.range ? `Here's ${where} 📅 I picked ${q.count === 1 ? "one" : `${Math.min(q.count, events.length)}`}, so tap to change or just hit Remove.`
        : q.count ? `Here ${q.count === 1 ? "is your next event" : `are your next ${Math.min(q.count, events.length)}`} 📅 I've picked ${q.count === 1 ? "it" : "them"}, so just tap Remove.`
        : picked.length ? `Found ${picked.length === 1 ? "it" : "them"} 📅 Tap Remove to delete.`
        : `Here's ${shown.label === "today" || shown.label === "tomorrow" ? shown.label : `what's ${shown.label}`} 📅 Tap the ones you want gone.`;
    }
    await ervoSays(lead);
    showEventPicker(events, picked);
  }

  // A day card like a calendar: tap events to pick them, then Remove
  const dayName = (d) => sameDay(d, new Date()) ? "Today" : sameDay(d, addDays(new Date(), 1)) ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  function showEventPicker(events, chosen) {
    const card = document.createElement("div");
    card.className = "daycard";
    const picked = new Set(chosen);
    const rows = [];
    let lastDay = "";
    const list = events.slice(0, 40);
    list.forEach((ev, i) => {
      const start = new Date(ev.start);
      const day = dayName(start);
      if (day !== lastDay) {
        const h = document.createElement("h3");
        h.textContent = day;
        card.append(h);
        lastDay = day;
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "dayrow";
      const time = document.createElement("span");
      time.className = "dt";
      time.textContent = ev.allDay ? "All day" : fmtTime({ h: start.getHours(), m: start.getMinutes() });
      const name = document.createElement("span");
      name.className = "dn";
      name.textContent = ev.title || "(No title)";
      if (ev.repeats || ev.calendar) {
        const sub = document.createElement("small");
        sub.textContent = [ev.repeats ? "Repeats, removes this day only" : "", ev.calendar].filter(Boolean).join(" · ");
        name.append(sub);
      }
      const tick = document.createElement("span");
      tick.className = "tick";
      tick.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      row.append(time, name, tick);
      row.addEventListener("click", () => {
        if (card.classList.contains("busy") || row.classList.contains("gone")) return;
        picked.has(i) ? picked.delete(i) : picked.add(i);
        update();
      });
      rows.push(row);
      card.append(row);
    });
    if (events.length > list.length) {
      const more = document.createElement("p");
      more.className = "daycard-note";
      more.textContent = `Showing the first ${list.length} of ${events.length}.`;
      card.append(more);
    }
    const go = document.createElement("button");
    go.type = "button";
    go.className = "pill danger";
    card.append(go);
    function update() {
      rows.forEach((r, i) => r.setAttribute("aria-pressed", String(picked.has(i))));
      const n = [...picked].filter((i) => !rows[i].classList.contains("gone")).length;
      go.disabled = !n;
      go.textContent = n ? `Remove ${n} ${n === 1 ? "event" : "events"}` : "Tap the events to remove";
    }
    update();
    go.addEventListener("click", async () => {
      const todo = [...picked].filter((i) => !rows[i].classList.contains("gone")).sort((a, b) => a - b);
      if (!todo.length) return;
      card.classList.add("busy");
      go.disabled = true;
      showTyping(todo.length === 1 ? "removing it" : `removing ${todo.length} events`);
      setStatus("🗑️", "Removing from your calendar");
      const done = [];
      for (const i of todo) {
        const ev = list[i];
        const r = await new Promise((resolve) => {
          deleteWaiter = resolve;
          native.deleteEvent(String(ev.id), Number(ev.rawBegin || ev.start), !!ev.repeats);
          setTimeout(() => { if (deleteWaiter === resolve) { deleteWaiter = null; resolve({ ok: false }); } }, 8000);
        });
        if (!r.ok) continue;
        rows[i].classList.add("gone");
        picked.delete(i);
        const start = new Date(ev.start);
        forgetPlanned(ev.title, start);
        const logId = `rm-${ev.id}-${ev.start}`;
        logActivity({ id: logId, kind: "remove", ico: "calendar", title: `Removed ${ev.title || "an event"}`, detail: `${fmtDate(start)}${ev.allDay ? ", all day" : ` at ${fmtTime({ h: start.getHours(), m: start.getMinutes() })}`}` });
        done.push({ i, token: r.undo, logId, ev });
      }
      card.classList.remove("busy");
      update();
      const failed = todo.length - done.length;
      if (!done.length) return ervoSays("I couldn't remove that. Try deleting it in your calendar app.");
      const what = done.length === 1 ? `"${done[0].ev.title || "That event"}" is` : `${done.length} events are`;
      return ervoSays(`Done ✅ ${what} off your calendar.${failed ? ` I couldn't remove ${failed} of them.` : ""}`, {
        acts: [{ label: "Undo", icon: "undo", onClick: (e) => undoRemove(done, rows, e.currentTarget, update) }],
      });
    });
    thread.append(card);
    toBottom();
  }

  async function undoRemove(done, rows, btn, update) {
    if (btn.disabled) return;
    btn.disabled = true;
    showTyping(done.length === 1 ? "putting it back" : "putting them back");
    setStatus("↩️", "Putting it back");
    let back = 0;
    for (const d of done) {
      const r = await new Promise((resolve) => {
        restoreWaiter = resolve;
        native.restoreEvent(String(d.token || ""));
        setTimeout(() => { if (restoreWaiter === resolve) { restoreWaiter = null; resolve({ ok: false }); } }, 8000);
      });
      if (!r.ok) continue;
      back++;
      rows[d.i].classList.remove("gone");
      save(ACTIVITY_KEY, activity().filter((a) => a.id !== d.logId));
    }
    btn.closest(".acts").remove();
    update();
    if (!back) return ervoSays("Sorry, I couldn't put it back 😕 You may need to add it again in your calendar app.");
    return ervoSays(back === done.length ? `Undone ↩️ ${back === 1 ? "It's" : "They're"} back on your calendar.` : `I put back ${back} of ${done.length}.`);
  }

  // iPhone and computers: take it off Ervo's list, then open the calendar to delete it there
  function removeOnWeb(q) {
    const t = q.title;
    const day = q.range && q.range.to - q.range.from <= 864e5 ? q.range.from : null;
    const mine = activity().filter((a) => a.when && (!t || a.title.toLowerCase().includes(t)) && (!day || sameDay(new Date(a.when), day)));
    mine.forEach((a) => forgetPlanned(a.title, new Date(a.when)));
    const google = prefs().calendar === "google";
    const acts = [google
      ? { label: "Open Google Calendar", icon: "calendar", href: t ? `https://calendar.google.com/calendar/r/search?q=${encodeURIComponent(t)}` : "https://calendar.google.com/calendar/r" }
      : { label: "Open Calendar", icon: "calendar", href: /iPhone|iPad/.test(navigator.userAgent) ? "calshow:" : "https://calendar.google.com/calendar/r" }];
    return ervoSays(`${mine.length ? "Removed it from your Ervo Stats ✅ " : ""}I can't delete events from here on this phone, so tap below, open ${t ? `"${t}"` : "the event"} and choose Delete Event.`, { acts });
  }

  // Android: no calendar app on the phone, so offer Google Calendar instead
  window.ervoCalendarError = () => {
    if (!lastEvent) return;
    const ev = lastEvent;
    ervoSays("I couldn't find a calendar app on your phone. Want to use Google Calendar instead?", { acts: [{ label: "Use Google Calendar", icon: "calendar", onClick: () => switchCalendar("google").then(() => ev) }] });
  };
  // choice: "phone" | "google" | { which, id, name } from the picker
  function setCalendarChoice(choice) {
    const c = typeof choice === "string" ? { which: choice } : choice;
    const p = prefs();
    p.calendar = c.which;
    if (c.which === "phone" && c.id) { p.calId = c.id; p.calName = c.name || ""; } else { delete p.calId; delete p.calName; }
    if (c.which === "google") p.calName = "Google Calendar";
    save(PREFS_KEY, p);
    // Using one calendar means it's allowed; the other one isn't used for new events anymore
    setConnection(c.which === "phone" ? "phonecal" : "calendar", "allowed");
  }
  const calChoiceName = () => { const p = prefs(); return p.calendar === "google" ? "Google Calendar" : p.calendar === "phone" ? p.calName || "your phone's calendar" : ""; };
  async function changeCalendar() {
    const c = await pickCalendar();
    if (!c) return null;
    setCalendarChoice(c);
    if ($("stats").classList.contains("active")) renderApps();
    return c;
  }

  let lastAdded = null; // { ev, calendar, undo } when Ervo added it straight to the phone's calendar
  // Returns which calendar it used, false if they said no, or null if they backed out
  async function addToCalendar(ev, which) {
    which = which || prefs().calendar;
    if (!which) {
      const c = await changeCalendar();
      if (!c) return null;
      which = c.which;
    }
    const key = which === "phone" ? "phonecal" : "calendar";
    if (!(await ensure(key, `Add "${ev.title}" to your calendar`))) return false;
    setStatus("📅", "Adding to calendar");
    lastEvent = ev;
    lastAdded = null;
    if (which === "google") openOutside(googleLink(ev));
    else if (native && native.insertEvent) {
      const calId = prefs().calId;
      const args = [ev.title, ev.start.getTime(), ev.end.getTime(), !!ev.allDay, ev.notes || "Planned with Ervo", ev.location || ""];
      let r = await nativeCall((f) => { addedWaiter = f; }, () => (calId && native.insertEventIn ? native.insertEventIn(String(calId), ...args) : native.insertEvent(...args)), 30000);
      // That calendar is gone (account removed): ask again
      if (!r.ok && r.reason === "no-calendar" && calId) {
        const c = await changeCalendar();
        if (!c) return null;
        if (c.which === "google") { openOutside(googleLink(ev)); return "google"; }
        r = await nativeCall((f) => { addedWaiter = f; }, () => (c.id && native.insertEventIn ? native.insertEventIn(String(c.id), ...args) : native.insertEvent(...args)), 30000);
      }
      if (r.ok) { lastAdded = { ev, calendar: r.calendar, undo: r.undo }; return which; }
      if (r.reason === "denied") return "denied";
      native.addCalendarEvent(ev.title, ev.start.getTime(), ev.end.getTime(), !!ev.allDay, ev.notes || "Planned with Ervo"); // no calendar to write to: open the app
    }
    else if (native && native.addCalendarEvent) native.addCalendarEvent(ev.title, ev.start.getTime(), ev.end.getTime(), !!ev.allDay, ev.notes || "Planned with Ervo");
    else openIcs(ev);
    return which;
  }

  async function runTask(tk) {
    confirming = false;
    task = null;
    if (tk.intent === "reserve" || tk.intent === "event") {
      const reserve = tk.intent === "reserve";
      const title = reserve ? `${meal(tk.time)} for ${tk.party}${tk.place ? ` at ${tk.place}` : ""}` : tk.title;
      const ev = eventFromTask(tk, title, tk.minutes || (reserve ? 90 : 60));
      const acts = [];
      if (reserve) {
        const q = `${tk.cuisine ? tk.cuisine + " " : ""}restaurants${tk.place ? " " + tk.place : ""} near me`;
        acts.push({ label: "Find a table", icon: "food", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` });
      }
      logActivity({ kind: tk.intent, ico: reserve ? "food" : "calendar", title, detail: reserve ? `${tk.party} ${tk.party === 1 ? "person" : "people"}` : "", when: ev.start.toISOString(), allDay: ev.allDay, link: googleLink(ev) });
      return finishCalendar(ev, await addToCalendar(ev), acts, reserve ? "\n\nI can't call restaurants myself yet, so tap Find a table to pick a place." : "");
    }
    if (tk.intent === "shop") {
      const key = tk.store && STORES[tk.store] ? tk.store : "amazon";
      const store = STORES[key];
      const url = store.search(encodeURIComponent(tk.item));
      const ok = await ensure(key, `Look up "${tk.item}"`);
      if (!ok) return ervoSays(`Okay, I won't open ${store.name}.`);
      logActivity({ kind: "shop", ico: "shop", title: `Looked up ${tk.item}`, detail: store.name, link: url });
      const topic = topicOf(tk.item) || tk.item;
      setStatus("🔍", `Searching for ${topic}`);
      openOutside(url);
      return ervoSays(`Opened ${store.name} with "${tk.item}" 🛒`, { status: ["🔍", `Searching for ${topic}`], acts: [{ label: `Open ${store.name} again`, icon: "shop", href: url }] });
    }
  }

  function finishCalendar(ev, which, acts, extra) {
    acts = acts || [];
    const when = `${fmtDate(ev.start)}${ev.allDay ? "" : ` at ${fmtTime({ h: ev.start.getHours(), m: ev.start.getMinutes() })}`}`;
    if (which === "denied") return ervoSays("I need permission to use your calendar 📅 Ask me again and tap Allow, or turn it on in Settings → Apps → Ervo → Permissions → Calendar.", { acts });
    if (which === "phone" && lastAdded && lastAdded.ev === ev) {
      const added = lastAdded;
      acts.push({ label: "Undo", icon: "undo", onClick: async (e) => {
        e.currentTarget.disabled = true;
        const u = await nativeCall((f) => { restoreWaiter = f; }, () => native.restoreEvent(String(added.undo)));
        if (u.ok) forgetPlanned(ev.title, ev.start);
        ervoSays(u.ok ? `Undone ↩️ "${ev.title}" is off your calendar.` : "Sorry, I couldn't undo that 😕");
      } });
      acts.push({ label: "Change calendar", icon: "calendar", onClick: () => switchCalendar("phone") });
      return ervoSays(`Added ✅ "${ev.title}", ${when}${added.calendar ? ` · ${added.calendar}` : ""}${extra || ""}`, { acts });
    }
    if (which === "phone" || which === "google") {
      acts.push({ label: which === "google" ? "Open Google Calendar again" : "Open calendar again", icon: "calendar", onClick: () => addToCalendar(ev, which) });
      acts.push({ label: "Change calendar", icon: "calendar", onClick: () => switchCalendar("phone") });
      return ervoSays(`"${ev.title}", ${when}. Tap Save in ${CAL_NAMES[which]} to finish 📅${extra || ""}`, { acts });
    }
    if (which === null) return ervoSays(`Okay. "${ev.title}" is saved in your Ervo Stats, and I didn't add it to a calendar.`, { acts });
    return ervoSays(`No problem, I won't open your calendar. "${ev.title}" is saved in your Ervo Stats under Upcoming.`, { acts });
  }

  // Pick a different calendar. If Ervo just added an event, it moves there too.
  async function switchCalendar(which) {
    const before = lastAdded;
    if (which === "phone" && native && native.listCalendars) { if (!(await changeCalendar())) return; }
    else setCalendarChoice(which);
    const name = calChoiceName();
    if (!before) return ervoSays(`Got it. New events go to ${name} from now on 📅`);
    const ev = before.ev;
    if (before.undo && native && native.restoreEvent) await nativeCall((f) => { restoreWaiter = f; }, () => native.restoreEvent(String(before.undo)));
    return finishCalendar(ev, await addToCalendar(ev), [], `\nNew events go here from now on.`);
  }

  // ---------- chat ----------
  const thread = $("thread");

  // Scrolling: stays at the newest message unless you scroll up; then it stays where you left it
  let stuck = true;
  let savedScroll = null;
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "to-latest";
  newBtn.hidden = true;
  newBtn.setAttribute("aria-label", "Go to the newest message");
  newBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
  newBtn.addEventListener("click", () => toBottom(true));
  thread.after(newBtn);
  let lastH = 0;
  thread.addEventListener("scroll", () => {
    if (!$("chat").classList.contains("active")) return;
    // The keyboard opened or the screen changed size: that's not you scrolling
    if (thread.clientHeight !== lastH) { lastH = thread.clientHeight; keepPlace(); return; }
    stuck = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48;
    if (stuck) newBtn.hidden = true;
  }, { passive: true });
  function toBottom(force) {
    if (force || stuck) {
      thread.scrollTop = thread.scrollHeight;
      stuck = true;
      newBtn.hidden = true;
    } else {
      newBtn.hidden = false;
    }
  }
  // The window or keyboard changed size: keep the newest message in view, or your spot
  function keepPlace() { lastH = thread.clientHeight; if (stuck) { thread.scrollTop = thread.scrollHeight; requestAnimationFrame(() => { if (stuck) thread.scrollTop = thread.scrollHeight; }); } }
  window.addEventListener("resize", keepPlace);
  let account = null;
  let history = []; // the conversation, for the AI server
  let pending = null; // business sample flows waiting for a yes/no

  // Web addresses in Ervo's messages become links you can tap
  const URL_RE = /(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g;

  // ---------- the saved chat: it keeps going like a text thread; New chat files it away ----------
  const CHAT_KEY = "ervo-chat"; // the main chat: it never resets
  const ARCHIVE_KEY = "ervo-chats"; // 0.2.7's filed-away chats; they become side chats
  const SIDES_KEY = "ervo-sides"; // side chats: branches off the main chat you want to keep apart
  const ACTIVE_KEY = "ervo-active"; // "main" or a side chat's id
  const GREETED_KEY = "ervo-greeted";
  const newChatRecord = () => ({ id: Date.now().toString(36), started: new Date().toISOString(), items: [] });
  let restoring = false; // true while old messages are drawn again (nothing is saved twice)
  let lastDay = "";
  function sides() {
    let list = load(SIDES_KEY);
    if (!Array.isArray(list)) {
      // 0.2.7 kept old chats in an archive; they live on as side chats
      list = (load(ARCHIVE_KEY) || []).map((c) => ({ id: c.id || Date.now().toString(36), title: c.title || "Earlier chat", started: c.started, items: c.items || [] }));
      save(SIDES_KEY, list);
      drop(ARCHIVE_KEY);
    }
    return list;
  }
  function activeId() {
    if (OVERLAY) return "main"; // "Hey Ervo" always talks in the main chat
    const id = load(ACTIVE_KEY);
    return id && id !== "main" && sides().some((c) => c.id === id) ? id : "main";
  }
  function loadChat(id) {
    if (id === "main") return load(CHAT_KEY);
    return sides().find((c) => c.id === id) || null;
  }
  function storeChat(id, c) {
    const write = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } };
    const slim = (x) => { x.items = x.items.filter((it, i) => it.t !== "photo" || i > x.items.length - 6); };
    if (id === "main") {
      if (!write(CHAT_KEY, c)) { slim(c); write(CHAT_KEY, c); }
      return;
    }
    const list = sides();
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list[i] = c; else list.unshift(c);
    if (!write(SIDES_KEY, list)) { slim(c); write(SIDES_KEY, list); }
  }
  function record(item) {
    if (restoring || !account) return;
    // Read it fresh: the "Hey Ervo" pop-up may have added to it
    const id = activeId();
    const c = loadChat(id) || Object.assign(newChatRecord(), id === "main" ? {} : { id });
    c.items.push(Object.assign({ at: new Date().toISOString() }, item));
    if (c.items.length > 400) c.items.splice(0, c.items.length - 400);
    // A side chat is named after the first thing you say in it
    if (id !== "main" && c.auto !== false && item.t === "msg" && item.who === "me" && !c.items.slice(0, -1).some((x) => x.t === "msg" && x.who === "me")) {
      c.title = String(item.text).slice(0, 48);
      $("chat-name").textContent = c.title;
    }
    c.updated = new Date().toISOString();
    storeChat(id, c);
    refreshDock();
  }
  // "Today", "Yesterday" or the date, between messages from different days
  function dayMark(when) {
    const d = new Date(when || Date.now());
    const key = d.toDateString();
    if (key === lastDay) return;
    lastDay = key;
    const p = document.createElement("p");
    p.className = "day-sep";
    const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 864e5);
    p.textContent = days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    thread.append(p);
  }
  // Draws a saved chat again
  function drawChat(c) {
    restoring = true;
    lastDay = "";
    c.items.forEach((x) => {
      dayMark(x.at);
      if (x.t === "msg") bubble(x.text, x.who);
      else if (x.t === "products") showProducts(x.products);
      else if (x.t === "links") showActs(x.acts.map((a) => ({ label: a.label, icon: a.icon, href: a.href })));
      else if (x.t === "photo") photoBubble(x.src);
      else if (x.t === "link") linkBubble(x.url);
      else if (x.t === "choices") showChoices(x.options || [], x.picked || "");
    });
    thread.querySelectorAll(".msg, .products, .acts, .choices").forEach((el) => el.classList.add("old"));
    restoring = false;
  }
  // The conversation the AI sees: the last messages of the saved chat, product picks included
  function historyFrom(c) {
    const out = Array.isArray(c.seed) ? c.seed.map((h) => ({ role: h.role, text: h.text })) : [];
    c.items.forEach((x) => {
      if (x.t === "msg") out.push({ role: x.who === "me" ? "user" : "assistant", text: x.text });
      else if (x.t === "products" && out.length) out[out.length - 1].text += `\n[Showed product cards: ${x.products.map((p) => [p.name, p.price].filter(Boolean).join(" ")).join("; ")}]`;
      else if (x.t === "link") out.push({ role: "user", text: `(shared a link: ${x.url})` });
      else if (x.t === "photo") out.push({ role: "user", text: "(sent a photo)" });
    });
    return out.slice(-24);
  }

  function bubble(text, who) {
    if (!restoring) dayMark();
    record({ t: "msg", who, text: String(text) });
    const el = document.createElement("div");
    el.className = `msg ${who}`;
    el.dir = "auto"; // Arabic or Hebrew lines up right-to-left inside the bubble
    if (who === "them" && URL_RE.test(text)) {
      URL_RE.lastIndex = 0;
      String(text).split(URL_RE).forEach((part, i) => {
        if (i % 2 === 0) { if (part) el.append(part); return; }
        const a = document.createElement("a");
        a.href = part;
        a.className = "inline-link";
        let host = part;
        try { host = new URL(part).hostname.replace(/^www\./, ""); } catch (e) { /* keep the whole address */ }
        a.textContent = host;
        a.addEventListener("click", (ev) => { ev.preventDefault(); openOutside(part); });
        el.append(a);
      });
    } else {
      el.textContent = text;
    }
    thread.append(el);
    toBottom();
    return el;
  }

  // Product picks from Ervo's research: name, price, rating, why it fits, and buttons
  const asinOf = (url) => { const m = String(url || "").match(/amazon\.[a-z.]+\/(?:[^/]+\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})/i); return m ? m[1].toUpperCase() : null; };
  // A picture for each pick: the one Ervo found, else Amazon's picture for that product number
  const amazonPic = (asin) => `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX400_.jpg`;
  function productPic(p, asin, open) {
    const tries = [p.image, asin && amazonPic(asin)].filter((u) => u && /^https:\/\//.test(u));
    const box = document.createElement("button");
    box.type = "button";
    box.className = "product-pic";
    box.setAttribute("aria-label", `See ${p.name}`);
    box.addEventListener("click", open);
    if (!tries.length) { box.classList.add("none"); box.innerHTML = ICON.shop; return box; }
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    let i = 0;
    img.src = tries[0];
    // Amazon sends back a 1-pixel image when it has no picture; treat that as missing too
    img.onload = () => { if (img.naturalWidth < 20) img.onerror(); };
    img.onerror = () => { i += 1; if (i < tries.length) img.src = tries[i]; else { img.remove(); box.classList.add("none"); box.innerHTML = ICON.shop; } };
    box.append(img);
    return box;
  }
  function showProducts(products) {
    record({ t: "products", products: products.slice(0, 5).map((p) => ({ name: p.name, price: p.price, rating: p.rating, why: p.why, url: p.url, image: p.image })) });
    const row = document.createElement("div");
    row.className = "products";
    products.slice(0, 5).forEach((p) => {
      const card = document.createElement("div");
      card.className = "product";
      const name = document.createElement("b");
      name.textContent = p.name;
      const meta = document.createElement("small");
      meta.textContent = [p.price, p.rating].filter(Boolean).join(" · ");
      const why = document.createElement("p");
      why.textContent = p.why || "";
      const btns = document.createElement("div");
      btns.className = "product-btns";
      const asin = asinOf(p.url);
      const search = `https://www.amazon.com/s?k=${encodeURIComponent(p.name)}`;
      const view = document.createElement("button");
      view.type = "button";
      view.className = "act";
      view.textContent = "View";
      view.addEventListener("click", () => openShop(p.url && /^https:\/\//.test(p.url) ? p.url : search, `Look at ${p.name}`));
      const cart = document.createElement("button");
      cart.type = "button";
      cart.className = "act primary";
      cart.innerHTML = ICON.shop;
      cart.append(asin ? "Add to cart" : "Find on Amazon");
      cart.addEventListener("click", () => addToCart(p, asin, search));
      btns.append(view, cart);
      card.append(productPic(p, asin, () => view.click()), name);
      if (meta.textContent) card.append(meta);
      if (why.textContent) card.append(why);
      card.append(btns);
      row.append(card);
    });
    thread.append(row);
  }
  async function openShop(url, reason) {
    if (!(await ensure("amazon", reason))) return ervoSays("Okay, I won't open Amazon.");
    openOutside(url);
  }
  // Amazon's own "add to cart" page: you see the item and confirm. You check out yourself.
  async function addToCart(p, asin, search) {
    if (!(await ensure("amazon", `Add ${p.name} to your Amazon cart`))) return ervoSays("Okay, I won't open Amazon.");
    if (!asin) {
      openOutside(search);
      return ervoSays(`I opened Amazon with "${p.name}". Tap Add to Cart on the one you want.`);
    }
    setStatus("🛒", "Adding to cart");
    openOutside(`https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${asin}&Quantity.1=1`);
    logActivity({ kind: "cart", ico: "shop", title: `Added ${p.name} to cart`, detail: [p.price, "Amazon"].filter(Boolean).join(" · "), link: "https://www.amazon.com/gp/cart/view.html" });
    return ervoSays(`Amazon will ask you to confirm adding ${p.name} to your cart. When you're ready, check out there with your saved card. I'll never pay for anything myself.`, {
      status: ["🛒", "Adding to cart"],
      acts: [{ label: "Open my cart", icon: "shop", href: "https://www.amazon.com/gp/cart/view.html" }],
    });
  }

  // Tap-to-answer options under Ervo's question (the one you pick gets a check)
  function showChoices(options, picked) {
    if (!restoring) record({ t: "choices", options, picked: null });
    const box = document.createElement("div");
    box.className = "choices";
    box.setAttribute("role", "group");
    options.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "choice-opt";
      b.textContent = o;
      if (picked !== undefined) { b.disabled = true; if (o === picked) b.classList.add("picked"); }
      b.addEventListener("click", () => {
        box.querySelectorAll("button").forEach((x) => { x.disabled = true; });
        b.classList.add("picked");
        buzz("tick");
        markPicked(o);
        send(o);
      });
      box.append(b);
    });
    thread.append(box);
    toBottom();
  }
  function markPicked(o) {
    const id = activeId();
    const c = loadChat(id);
    if (!c) return;
    const it = [...c.items].reverse().find((x) => x.t === "choices" && !x.picked);
    if (it) { it.picked = o; storeChat(id, c); }
  }

  function showActs(acts) {
    const links = acts.filter((a) => a.href);
    if (links.length) record({ t: "links", acts: links.map((a) => ({ label: a.label, icon: a.icon, href: a.href })) });
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

  // ---------- status pill: what Ervo is doing right now ----------
  function setStatus(ico, text) {
    if (liveTyping && text && !/^typing/i.test(text)) showTyping(text);
    $("status-ico").textContent = ico || "";
    $("status-text").textContent = text;
    $("status").classList.add("busy");
  }
  function idleStatus() {
    $("status-ico").textContent = "";
    $("status-text").textContent = account ? PLAN[account.plan].label : "";
    $("status").classList.remove("busy");
  }

  // The messages scroll behind the see-through header and bottom bar
  if ("ResizeObserver" in window) {
    const head = document.querySelector(".chat-header");
    const ro = new ResizeObserver(() => {
      $("chat").style.setProperty("--head-h", `${head.offsetHeight}px`);
      $("chat").style.setProperty("--dock-h", `${$("dock").offsetHeight}px`);
      keepPlace();
    });
    ro.observe(head);
    ro.observe($("dock"));
    ro.observe(thread);
  }
  if (window.visualViewport) window.visualViewport.addEventListener("resize", keepPlace);
  // Typing: show the newest messages above the keyboard
  $("message").addEventListener("focus", () => { setTimeout(() => toBottom(true), 50); setTimeout(() => toBottom(true), 350); });

  // While Ervo works: its picture, name and what it's doing ("checking your calendar")
  let liveTyping = null;
  function showTyping(words) {
    if (!liveTyping) {
      liveTyping = document.createElement("div");
      liveTyping.className = "typing";
      liveTyping.setAttribute("role", "status");
      liveTyping.innerHTML = '<img src="img/ervo-classic.png" alt=""><span class="typing-body"><b>Ervo</b><small><span class="spin"></span><span class="dots"><i></i><i></i><i></i></span><em></em></small></span>';
    }
    if (words) {
      const w = String(words).replace(/[….]+$/, "");
      liveTyping.classList.toggle("is-typing", /^typing$/i.test(w));
      liveTyping.querySelector("em").textContent = w.charAt(0).toLowerCase() + w.slice(1);
    }
    thread.append(liveTyping); // keep it last
    toBottom();
    return liveTyping;
  }
  function hideTyping() { if (liveTyping) liveTyping.remove(); liveTyping = null; }

  // Ervo "types", then answers. `text` can be a promise (weather, AI server).
  // opts.status: [emoji, words] for the status pill while Ervo works on it.
  let lastWasVoice = false;
  async function ervoSays(text, opts) {
    opts = opts || {};
    showTyping(opts.status ? opts.status[1] : liveTyping ? null : "typing");
    if (opts.status) setStatus(opts.status[0], opts.status[1]);
    else setStatus("", "Typing…");
    const speakIt = lastWasVoice;
    lastWasVoice = false;
    let said;
    try { said = await Promise.resolve(text); } catch (e) { said = "I ran into a problem answering that. Ask again in a moment."; }
    if (said && typeof said === "object") {
      opts = Object.assign({}, opts, { products: said.products, chips: said.chips || opts.chips, acts: said.acts || opts.acts, choices: said.choices || opts.choices });
      said = said.text;
    }
    said = plain(said);
    await delay(500 + Math.min(String(said).length * 8, 900));
    hideTyping();
    idleStatus();
    bubble(said, "them");
    // A done or failed action gets the matching haptic (Android); plain answers get none
    if (/^(Done|Undone|All set)\b/.test(String(said))) buzz("confirm");
    else if (/^I couldn't\b/.test(String(said))) buzz("reject");
    // The AI remembers what it showed, so "the second one" or "those lights" still make sense later
    const shown = opts.products && opts.products.length ? `\n[Showed product cards: ${opts.products.map((p) => [p.name, p.price].filter(Boolean).join(" ")).join("; ")}]` : "";
    history.push({ role: "assistant", text: said + shown });
    if (opts.products && opts.products.length) showProducts(opts.products);
    if (opts.acts && opts.acts.length) showActs(opts.acts);
    const choosing = opts.choices && opts.choices.length;
    if (choosing) showChoices(opts.choices);
    setChips(choosing ? [] : opts.chips || PLAN[account.plan].chips);
    toBottom();
    if (speakIt) speak(said);
    if (OVERLAY && !voice.hidden && !listening) { voice.classList.remove("thinking"); $("voice-status").textContent = "Tap the mic or type to ask more"; }
    return said;
  }

  // ---------- speaking answers out loud ----------
  function speak(text) {
    return; // Spoken replies are off for now
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
    $("menu-who").textContent = `${acc.name} · Ervo ${acc.plan === "business" ? "for Business" : "Personal"}`;
    thread.innerHTML = "";
    lastDay = "";
    stuck = true;
    newBtn.hidden = true;
    idleStatus();
    task = null;
    confirming = false;
    pending = null;
    // The chat picks up where it left off, like a text thread
    const id = activeId();
    const saved = loadChat(id);
    history = saved ? historyFrom(saved) : [];
    show("chat");
    syncChatName(id, saved);
    if (OVERLAY) { setChips(p.chips); return; } // the pop-up starts clean, but still knows the conversation
    if (id !== "main") sideBanner(saved);
    if (saved && saved.items.length) drawChat(saved);
    requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
    if (id !== "main") { setChips(p.chips); return; }
    // One greeting a day in the main chat: the first time Ervo opens that day
    const today = new Date().toDateString();
    if (fresh || load(GREETED_KEY) !== today) {
      save(GREETED_KEY, today);
      setTimeout(() => greet(fresh), fresh ? 250 : 0);
    } else {
      setChips(p.chips);
    }
  }

  // ---------- greeting: short and simple: hi, name, date, weather, how can I help ----------
  function greetingText(firstTime) {
    const p = prefs();
    const name = p.nickname || account.name;
    const now = new Date();
    const h = now.getHours();
    const hello = firstTime ? "Hi" : h < 5 ? "Hi" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    const lines = [firstTime ? `${hello} ${name}, I'm Ervo.` : `${hello}, ${name}.`];
    const date = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (p.date && p.time) lines.push(`It's ${date}, ${time}.`);
    else if (p.date) lines.push(`It's ${date}.`);
    else if (p.time) lines.push(`It's ${time}.`);
    return { lines, firstTime, p };
  }

  async function greet(firstTime) {
    const g = greetingText(firstTime);
    const build = (async () => {
      const lines = g.lines.slice();
      if (g.p.weather && allowed("location")) {
        const w = await Promise.race([weatherNow(), delay(5000).then(() => null)]).catch(() => null);
        if (w) {
          const weather = `${w.temp}°${w.unit} and ${w.kind}${w.city ? ` in ${w.city}` : ""} ${w.emoji}`;
          // "It's Thursday, November 5, 60°F and clear in Austin 🌙"
          if (lines.length > 1) lines[lines.length - 1] = lines[lines.length - 1].replace(/\.$/, `, ${weather}`);
          else lines.push(`It's ${weather}`);
        }
      }
      lines.push(g.firstTime ? "What do you need?" : "How can I help?");
      return lines.join(" ");
    })();
    await ervoSays(build);
    if (g.p.news && allowed("location")) newsBubble();
  }

  // ---------- side chats: branches off the main chat ----------
  // The main chat never resets. A side chat starts from where the main chat is (it knows
  // the last few messages) and keeps its own thread, for things you want to keep apart.
  function newSideChat(title) {
    const main = load(CHAT_KEY);
    const c = Object.assign(newChatRecord(), { title: title || "New side chat", from: "main", seed: main ? historyFrom(main).slice(-10) : [] });
    storeChat(c.id, c);
    switchChat(c.id);
    ervoSays("Side chat started. Your main chat is right where you left it. What's this one for?");
  }
  function switchChat(id) {
    closeChats();
    toggleMenu(false);
    save(ACTIVE_KEY, id);
    openChat(account, false);
    if (docked()) renderChats();
  }
  function deleteSide(id) {
    save(SIDES_KEY, sides().filter((c) => c.id !== id));
    if (load(ACTIVE_KEY) === id) switchChat("main");
    else renderChats();
  }
  function syncChatName(id, c) {
    const side = id !== "main";
    $("chat-name").textContent = side ? (c && c.title) || "Side chat" : "";
    $("chat-name").hidden = !side;
  }
  function sideBanner(c) {
    const el = document.createElement("div");
    el.className = "side-banner";
    const t = document.createElement("span");
    t.textContent = "Side chat · branched from your main chat";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Main chat";
    b.addEventListener("click", () => switchChat("main"));
    el.append(t, b);
    thread.append(el);
  }
  // The chats panel: Main chat on top, side chats under it (like folders of one conversation)
  function openChats() {
    toggleMenu(false);
    renderChats();
    if (docked()) return;
    $("chats-panel").hidden = false;
    requestAnimationFrame(() => $("chats-panel").classList.add("open"));
  }
  function closeChats() {
    const w = $("chats-panel");
    if (w.hidden || docked()) return;
    w.classList.remove("open");
    setTimeout(() => { w.hidden = true; }, 200);
  }
  // Wide screens (Galaxy Z Fold open, tablets): keep the Chats list open beside the chat,
  // instead of sliding over it (Samsung: show menus together with content at 840dp and up)
  const WIDE = window.matchMedia("(min-width: 840px)");
  const docked = () => root.classList.contains("docked");
  function syncDock() {
    const on = WIDE.matches && !OVERLAY && !!account && $("chat").classList.contains("active");
    if (on === docked()) return;
    const w = $("chats-panel");
    root.classList.toggle("docked", on);
    w.classList.toggle("open", on);
    w.hidden = !on;
    if (on) renderChats();
  }
  WIDE.addEventListener("change", syncDock);
  let dockTimer = 0;
  const refreshDock = () => { if (!docked()) return; clearTimeout(dockTimer); dockTimer = setTimeout(renderChats, 400); };
  function renderChats() {
    const id = activeId();
    const box = $("chats-list");
    box.innerHTML = "";
    const item = (title, sub, cid) => {
      const r = document.createElement("div");
      r.className = "chat-item" + (cid === id ? " current" : "");
      const go = document.createElement("button");
      go.type = "button";
      go.className = "chat-go";
      const b = document.createElement("b");
      b.textContent = title;
      go.append(b);
      if (sub) { const s2 = document.createElement("small"); s2.textContent = sub; go.append(s2); }
      go.addEventListener("click", () => switchChat(cid));
      r.append(go);
      if (cid !== "main") {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "chat-x";
        x.setAttribute("aria-label", `Delete ${title}`);
        x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
        x.addEventListener("click", () => {
          if (x.classList.contains("sure")) { deleteSide(cid); return; }
          x.classList.add("sure");
          x.textContent = "Delete";
          setTimeout(() => { if (x.isConnected) { x.classList.remove("sure"); x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'; } }, 3000);
        });
        r.append(x);
      }
      return r;
    };
    const main = load(CHAT_KEY);
    const lastMsg = main && [...main.items].reverse().find((x) => x.t === "msg");
    box.append(item("Main chat", lastMsg ? String(lastMsg.text).slice(0, 40) : "", "main"));
    const head = document.createElement("div");
    head.className = "chats-head";
    head.innerHTML = "<span>Side chats</span>";
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "chats-plus";
    plus.setAttribute("aria-label", "New side chat");
    plus.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    plus.addEventListener("click", () => newSideChat());
    head.append(plus);
    box.append(head);
    const list = sides().slice().sort((a, b) => new Date(b.updated || b.started) - new Date(a.updated || a.started));
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "chats-empty";
      p.textContent = "Start a side chat for something you want to keep apart, like a trip or a project. Your main chat keeps going.";
      box.append(p);
    }
    list.forEach((c) => box.append(item(c.title || "Side chat", "", c.id)));
  }

  // ---------- location, weather and news ----------
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error("no-geo")); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(err),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 3 * 60 * 60 * 1000 }
      );
    });
  }

  // City-level location, kept for 3 hours so the phone's location dot rarely shows.
  // Rounded so it's never an exact address.
  async function getPlace() {
    const cached = load(PLACE_KEY);
    if (cached && Date.now() - cached.at < 3 * 60 * 60 * 1000) return cached;
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
      daily: "temperature_2m_max,temperature_2m_min,sunrise,sunset", timezone: "auto", forecast_days: "1",
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
    const sun = (k) => (j.daily[k] && j.daily[k][0] ? new Date(j.daily[k][0]) : null);
    const w = { temp, hi, lo, kind: kind[1], emoji, city: place.city, unit: fahrenheit ? "F" : "C", sunrise: sun("sunrise"), sunset: sun("sunset") };
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
      const text = askServer({ task: "news" }).then((j) => j.reply).catch(() => null);
      const said = await ervoSays(text.then((x) => x || `Here's today's news${area ? ` for ${place.city}` : ""}.`), { acts: [{ label: "More news", icon: "open", href: newsUrl }] });
      return said;
    }
    return ervoSays(`Here's today's news${area ? ` for ${place.city}` : ""}. Tap to read it.`, { acts: [{ label: "Today's news", icon: "open", href: newsUrl }] });
  }

  // ---------- Ervo's private AI server (optional; its code is kept private) ----------
  async function askServer(extra) {
    let place = null;
    try { place = allowed("location") ? load(PLACE_KEY) : null; } catch (e) { /* ignore */ }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 75000); // research with web search can take a bit
    try {
      const r = await fetch(`${AI_URL}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify(Object.assign({
          plan: account.plan,
          name: prefs().nickname || account.name,
          messages: history.slice(-16),
          psyche: psycheForServer(),
          memory: memory(),
          context: {
            now: new Date().toString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            location: place ? { city: place.city, region: place.region, country: place.country } : null,
          },
        }, extra || {})),
      });
      if (!r.ok && r.status !== 429) throw new Error(`server ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- Psyche: who you are to Ervo, and how you like it to talk ----------
  // Ervo learns it from the chat. You change it only by telling Ervo ("I'm not allergic to that anymore").
  const MEMORY_KEY = "ervo-memory"; // before 0.2.8: plain facts
  const PSYCHE_KEY = "ervo-psyche";
  const STYLE_NAMES = { tone: "Tone", length: "Length", emojis: "Emojis", humor: "Humor", language: "Language", other: "Also" };
  const KIND_NAMES = { health: "Health", food: "Food", goal: "Goals", likes: "Likes", dislikes: "Dislikes", people: "People", places: "Places", work: "Work", routine: "Routine", money: "Money", other: "Other" };
  const KIND_ICON = { health: "health", food: "food", goal: "star", likes: "heart", dislikes: "brain", people: "people", places: "location", work: "clock", routine: "clock", money: "money", other: "brain" };
  function psyche() {
    let p = load(PSYCHE_KEY);
    if (!p || !Array.isArray(p.facts)) {
      p = { style: {}, facts: [], lessons: [], next: 1, learned: 0, since: new Date().toISOString() };
      (load(MEMORY_KEY) || []).forEach((f) => { if (typeof f === "string" && f.trim()) p.facts.push({ id: `f${p.next++}`, text: f.trim().slice(0, 200), kind: "other", at: new Date().toISOString() }); });
      p.learned = p.facts.length;
      save(PSYCHE_KEY, p);
      drop(MEMORY_KEY);
    }
    p.style = p.style || {};
    p.lessons = p.lessons || [];
    return p;
  }
  // One update from Ervo's AI: style changes, new facts, facts that are wrong now, a lesson
  function learn(u) {
    if (!u || typeof u !== "object") return 0;
    const p = psyche();
    let n = 0;
    if (u.style && typeof u.style === "object") Object.keys(STYLE_NAMES).forEach((k) => {
      const v = String(u.style[k] || "").trim().slice(0, 120);
      if (v && p.style[k] !== v) { p.style[k] = v; n++; }
    });
    if (Array.isArray(u.remove)) {
      const before = p.facts.length;
      p.facts = p.facts.filter((f) => !u.remove.includes(f.id));
      n += before - p.facts.length;
    }
    if (Array.isArray(u.add)) u.add.forEach((a) => {
      const text = String((a && (a.fact || a.text)) || "").trim().slice(0, 200);
      if (!text || p.facts.some((f) => f.text.toLowerCase() === text.toLowerCase())) return;
      p.facts.push({ id: `f${p.next++}`, text, kind: KIND_NAMES[a.kind] ? a.kind : "other", at: new Date().toISOString() });
      n++;
    });
    if (typeof u.lesson === "string" && u.lesson.trim()) {
      const l = u.lesson.trim().slice(0, 200);
      if (!p.lessons.includes(l)) { p.lessons.push(l); n++; }
    }
    p.facts = p.facts.slice(-150);
    p.lessons = p.lessons.slice(-40);
    if (n) {
      p.learned = (p.learned || 0) + n;
      p.updated = new Date().toISOString();
      save(PSYCHE_KEY, p);
      if ($("psyche").classList.contains("active")) renderPsyche();
    }
    return n;
  }
  const remember = (facts) => learn({ add: facts.map((f) => ({ fact: f, kind: "other" })) });
  const memory = () => psyche().facts.map((f) => f.text);
  const psycheForServer = () => { const p = psyche(); return { style: p.style, facts: p.facts.map((f) => ({ id: f.id, text: f.text, kind: f.kind })), lessons: p.lessons }; };

  // Plain by default: no emojis until you tell Ervo you like them
  const emojiOK = () => ["some", "lots"].includes(psyche().style.emojis);
  const EMOJI_RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*/gu;
  function plain(t) {
    if (emojiOK()) return t;
    return String(t).replace(EMOJI_RE, "").replace(/️/g, "").replace(/[ \t]+([.,!?:;)])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();
  }

  // A short topic for the status pill, like "lights for a soccer field", never the whole message
  function topicOf(s) {
    const words = String(s || "").replace(/[^\p{L}\p{N}'$&\s-]/gu, " ").split(/\s+/).filter(Boolean);
    const STOP = /^(and|but|so|because|since|when|while|that|which|who|where|if|i|we|it|is|are|was|were|need|want|can|could|will|would)$/i;
    const SOFT = /^(the|my|our|your|this|these|those)$/i;
    const PREP = /^(for|to|on|at|in|of|with|from|under|near|by)$/i;
    const out = [];
    for (const w of words) {
      if (STOP.test(w)) break;
      if (SOFT.test(w) && out.length && !PREP.test(out[out.length - 1])) break;
      out.push(w);
      if (out.length >= 5) break;
    }
    while (out.length > 1 && (PREP.test(out[out.length - 1]) || /^(a|an|the|some|my|your)$/i.test(out[out.length - 1]))) out.pop();
    return out.join(" ");
  }

  // What the status pill says while the AI works on it
  function guessStatus(d) {
    if (d.intent === "photo") return ["📷", "Looking at your photo"];
    if (d.intent === "shop") {
      const item = topicOf(shopItem(d.raw)) || "that";
      return wantsAdvice(item, d.t) ? ["🔍", `Researching ${item}`] : ["🔍", `Looking for ${item}`];
    }
    if (d.intent === "event" || d.intent === "reserve") return ["📅", "Planning it"];
    if (/\b(how|what|why|when|where|who|which|best|recommend|compare)\b/.test(d.t)) return ["🔎", "Looking it up"];
    return ["💭", "Thinking"];
  }

  // Sends the message to Ervo's AI, then does what it asked for: show products,
  // offer to add an event, search Amazon, or change a setting. Anything that
  // opens another app still waits for your yes and your Allow.
  // These show their own message in the app (Added ✅, the alarm card...), so the AI's words would only repeat it
  const SELF_REPORTING = new Set(["add_calendar_event", "set_timer", "set_alarm", "dismiss_alarm", "edit_calendar_event", "remove_calendar_event", "call_contact", "plan_meeting"]);
  async function askAI(d, extra) {
    const status = guessStatus(d);
    showTyping(status[1]);
    setStatus(status[0], status[1]);
    const result = askServer(extra).then((j) => {
      // Learn first, so "use emojis" already shows in this reply
      if (Array.isArray(j.psyche) && j.psyche.length) j.psyche.forEach(learn);
      else if (j.memories && j.memories.length) remember(j.memories);
      const out = { text: j.reply || "Done.", products: [], chips: null };
      out.quiet = (j.actions || []).some((a) => SELF_REPORTING.has(a.type));
      (j.actions || []).forEach((a) => {
        if (a.type === "offer_choices" && Array.isArray(a.options)) {
          out.choices = a.options.map((o) => String(o).trim().slice(0, 80)).filter(Boolean).slice(0, 4);
        } else if (a.type === "show_products" && Array.isArray(a.products)) {
          out.products = a.products;
          logActivity({ kind: "research", ico: "shop", title: `Found picks for ${a.query || "you"}`, detail: `${a.products.length} options` });
        } else if (a.type === "add_calendar_event" && a.title && a.start) {
          const m = String(a.start).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
          if (!m) return;
          const date = new Date(+m[1], +m[2] - 1, +m[3]);
          const time = m[4] && !a.all_day ? { h: +m[4], m: +m[5] } : null;
          let minutes = 60;
          const e = String(a.end || "").match(/(\d{2}):(\d{2})(?::\d{2})?$/);
          if (time && e) minutes = Math.max(15, (+e[1] * 60 + +e[2]) - (time.h * 60 + time.m)) || 60;
          // Added right away (with Undo), no extra Yes/No
          const tk = { intent: "event", title: String(a.title).slice(0, 80), date, time, allDay: !time, minutes };
          out.after = () => runTask(tk);
        } else if ((a.type === "amazon_search" || a.type === "shop_search") && a.query) {
          task = { intent: "shop", item: String(a.query).slice(0, 80), store: STORES[a.store] ? a.store : "amazon" };
          confirming = true;
          out.chips = ["Yes", "No"];
        } else if (a.type === "show_links" && Array.isArray(a.links)) {
          out.acts = a.links.filter((l) => l && /^https:\/\//.test(String(l.url))).slice(0, 4)
            .map((l) => ({ label: String(l.title || "Open").slice(0, 60), icon: "open", href: String(l.url) }));
        } else if (a.type === "set_timer" && a.seconds) {
          out.after = () => doTimer(Math.round(Number(a.seconds)), String(a.label || ""));
        } else if (a.type === "set_alarm" && a.hour !== undefined) {
          out.after = () => doAlarm({ h: Number(a.hour), m: Number(a.minute || 0), label: String(a.label || ""), days: Array.isArray(a.days) ? a.days.map(Number).filter((x) => x >= 1 && x <= 7) : [] });
        } else if (a.type === "dismiss_alarm") {
          out.after = () => alarmsOff({ h: a.hour === undefined || a.hour === null ? null : Number(a.hour), m: Number(a.minute || 0) });
        } else if (a.type === "edit_calendar_event" && a.title) {
          const dm = String(a.new_date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
          const tm = String(a.new_time || "").match(/^(\d{1,2}):(\d{2})/);
          const when = dm || tm ? { date: dm ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : null, time: tm ? { h: +tm[1], m: +tm[2] } : null } : null;
          out.after = () => editEvents({ target: String(a.title), newTitle: a.new_title ? String(a.new_title) : "", when });
        } else if (a.type === "plan_meeting") {
          const dm = String(a.date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
          const tm = String(a.time || "").match(/^(\d{1,2}):(\d{2})/);
          out.after = () => planMeeting({ app: ["meet", "zoom", "teams", "skype"].includes(a.platform) ? a.platform : "meet", who: String(a.with || ""), now: !!a.now, when: { date: dm ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : null, time: tm ? { h: +tm[1], m: +tm[2] } : null } });
        } else if (a.type === "call_contact" && a.name) {
          out.after = () => doCall(String(a.name));
        } else if (a.type === "remove_calendar_event") {
          const m = String(a.date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
          const asked = parseRemove(d);
          out.after = () => removeEvents({ title: String(a.title || ""), count: asked.count, all: asked.all, range: m ? dayRange(new Date(+m[1], +m[2] - 1, +m[3])) : asked.range });
        } else if (a.type === "update_settings") {
          const p = prefs();
          if (a.nickname) p.nickname = String(a.nickname).slice(0, 30);
          ["weather", "news", "time", "date"].forEach((k) => { if (typeof a[k] === "boolean") p[k] = a[k]; });
          if (a.calendar === "phone" || a.calendar === "google") p.calendar = a.calendar;
          save(PREFS_KEY, p);
          if (a.theme === "dark" || a.theme === "light") themeHelp(a.theme);
        }
      });
      return out;
    }).catch(() => navigator.onLine === false
      ? "Your phone is offline. Connect to Wi-Fi or mobile data, then ask again."
      : "I couldn't reach my AI service just now. Ask again in a moment.");
    const r = await result;
    if (r && r.quiet && r.after) {
      hideTyping();
      idleStatus();
      return r.after();
    }
    await ervoSays(r, { status });
    if (r && r.after) return r.after();
  }

  // ---------- phone: timers, alarms, calls and "Hey Ervo" (Android) ----------
  const waiters = {};
  const waitFor = (name, ms) => new Promise((resolve) => {
    waiters[name] = resolve;
    setTimeout(() => { if (waiters[name] === resolve) { delete waiters[name]; resolve({ status: "timeout", ok: false }); } }, ms);
  });
  ["ervoContacts", "ervoCall", "ervoClock"].forEach((fn) => {
    window[fn] = (json) => {
      const r = waiters[fn];
      delete waiters[fn];
      let v;
      try { v = JSON.parse(json); } catch (e) { v = { status: "error", ok: false }; }
      if (r) r(v); else if (fn === "ervoCall") afterCall(v);
    };
  });

  const DUR_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "forty five": 45, forty: 40, fifty: 50, sixty: 60, ninety: 90, "half an": 0.5, "half a": 0.5 };
  function parseDuration(t) {
    const re = /(\d+(?:\.\d+)?|half an?|forty five|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety)[\s-]*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(\s+and a half)?/g;
    let secs = 0;
    let m;
    while ((m = re.exec(t))) {
      const n = /^\d/.test(m[1]) ? parseFloat(m[1]) : DUR_WORDS[m[1]];
      const unit = /^h/.test(m[2]) ? 3600 : /^m/.test(m[2]) ? 60 : 1;
      secs += (n + (m[3] ? 0.5 : 0)) * unit;
    }
    return Math.round(secs);
  }
  const durText = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return [h && `${h} hour${h > 1 ? "s" : ""}`, m && `${m} minute${m > 1 ? "s" : ""}`, x && `${x} second${x > 1 ? "s" : ""}`].filter(Boolean).join(" ");
  };

  // "wake me up at 6:30", "alarm for 7am every weekday", "alarm in 20 minutes"
  function parseAlarm(t) {
    let h = null, mi = 0;
    if (/\bnoon\b/.test(t)) h = 12;
    else if (/\bmidnight\b/.test(t)) h = 0;
    const m = t.match(/\b(?:at|for|to)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\s|$|[,.!?])/) ;
    // "in 5 minutes", "for 1 minute from now", "an hour later": counts from now, at least 1 minute
    const rel = /\b(from now|later|in\s+(?:\d|an?\b|one|two|three|four|five|ten|fifteen|twenty|thirty|half))/.test(t) || /\b(?:for|after)\s+(?:\d+|an?|one|two|three|four|five|ten|fifteen|twenty|thirty|half an?)\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/.test(t);
    const inDur = rel ? parseDuration(t) : 0;
    if (inDur) {
      const at = new Date(Date.now() + Math.max(60, inDur) * 1000);
      if (at.getSeconds() > 0) at.setMinutes(at.getMinutes() + 1, 0, 0); // round up to the next whole minute
      h = at.getHours(); mi = at.getMinutes();
    } else if (h === null && m && +m[1] <= 23) {
      h = +m[1]; mi = m[2] ? +m[2] : 0;
      const pm = m[3] && /p/.test(m[3]);
      const am = m[3] && /a/.test(m[3]);
      if (pm && h < 12) h += 12;
      else if (am && h === 12) h = 0;
      else if (!m[3] && h < 12 && /\b(tonight|evening|pm|afternoon)\b/.test(t)) h += 12;
    }
    let days = [];
    if (/\b(every ?day|daily)\b/.test(t)) days = [1, 2, 3, 4, 5, 6, 7];
    else if (/\bweekdays?\b/.test(t)) days = [2, 3, 4, 5, 6];
    else if (/\bweekends?\b/.test(t)) days = [1, 7];
    else if (/\bevery\b/.test(t)) DAY_NAMES.forEach((n, i) => { if (new RegExp(`\\b${n}s?\\b`).test(t)) days.push(i + 1); });
    const lab = t.match(/\bto ((?:go|get|take|leave|call|pick|start|finish|feed|walk)\b[a-z' ]{2,40})/);
    return { h, m: mi, days, label: lab ? cap(lab[1].trim()) : "" };
  }

  let clockAsk = null; // waiting for an alarm time
  async function doTimer(seconds, label) {
    if (!(native && native.setTimer)) return ervoSays("I can set timers in the Ervo Android app ⏲️ On iPhone, ask Siri or use the Clock app.");
    if (!seconds) return ervoSays("How long should the timer be? ⏲️", { chips: ["1 minute", "5 minutes", "10 minutes", "30 minutes"] }).then(() => { clockAsk = { kind: "timer", label }; });
    if (!(await ensure("clock", "Set timers and alarms in your Clock app"))) return ervoSays("Okay, I won't touch your Clock app.");
    setStatus("⏲️", "Setting a timer");
    native.setTimer(seconds, label || "");
    const r = await waitFor("ervoClock", 6000);
    if (!r.ok) return ervoSays("I couldn't find a Clock app that takes timers 😕");
    logActivity({ kind: "timer", ico: "clock", title: `Timer for ${durText(seconds)}`, detail: label || "Clock app" });
    return ervoSays(`⏲️ Timer set for ${durText(seconds)}${label ? ` (${label})` : ""}.`);
  }
  async function doAlarm(a) {
    if (!(native && native.setAlarm)) return ervoSays("I can set alarms in the Ervo Android app ⏰ On iPhone, ask Siri or use the Clock app.");
    if (a.h === null || a.h === undefined) {
      clockAsk = { kind: "alarm", days: a.days, label: a.label };
      return ervoSays("What time should I set it for? ⏰", { chips: ["6:00 AM", "6:30 AM", "7:00 AM", "8:00 AM"] });
    }
    if (!(await ensure("clock", "Set timers and alarms in your Clock app"))) return ervoSays("Okay, I won't touch your Clock app.");
    setStatus("⏰", "Setting an alarm");
    native.setAlarm(a.h, a.m, a.label || "", a.days.join(","));
    const r = await waitFor("ervoClock", 6000);
    if (!r.ok) return ervoSays("I couldn't find a Clock app that takes alarms 😕");
    const time = fmtTime({ h: a.h, m: a.m });
    const when = a.days.length === 7 ? " every day" : a.days.join() === "2,3,4,5,6" ? " on weekdays" : a.days.join() === "1,7" ? " on weekends" : a.days.length ? ` every ${a.days.map((d) => cap(DAY_NAMES[d - 1])).join(", ")}` : "";
    logActivity({ kind: "alarm", ico: "clock", title: `Alarm for ${time}${when}`, detail: a.label || "Clock app" });
    return ervoSays(`⏰ Alarm set for ${time}${when}.`, { acts: [{ label: "See my alarms", icon: "clock", onClick: () => native.showAlarms() }] });
  }

  // Calls: Ervo never calls emergency services. It points you to the dialer instead.
  const EMERGENCY_RE = /\b(911|9-1-1|112|999|988|emergency|police|cops|ambulance|paramedics?|fire ?(department|fighters?|station)|poison control)\b/;
  function emergencyReply() {
    const acts = native && native.dialNumber
      ? [{ label: "Open dialer with 911", icon: "phone", onClick: () => native.dialNumber("911") }]
      : [{ label: "Call 911", icon: "phone", href: "tel:911" }];
    return ervoSays("I can't call emergency services for you. If you or someone else is in danger, call 911 yourself right now 🚨", { acts });
  }
  const callName = (raw) => raw
    .replace(/^(?:\s*(?:please|can you|could you|would you|hey|ok|okay|ervo|hey ervo)[,!]?\s+)*(?:call|phone|ring|dial|facetime|give)\s+/i, "")
    .replace(/\b(a call|for me|please|right now|now|real quick|quickly|on speaker(?: ?phone)?|back|up|on (?:the|my) phone)\b/gi, "")
    .replace(/^\s*(my|the)\s+/i, "").replace(/[.,!?]+$/g, "").replace(/\s+/g, " ").trim();

  let lastCallName = "";
  async function doCall(name) {
    name = String(name || "").trim();
    if (!name) return ervoSays("Who should I call? 📞");
    const digits = name.replace(/[^\d+]/g, "");
    if (EMERGENCY_RE.test(name.toLowerCase()) || /^(\+?1)?(911|112|999|988)$/.test(digits)) return emergencyReply();
    if (!(native && native.findContacts)) {
      if (digits.length >= 7) return ervoSays(`Tap to call ${name} 📞`, { acts: [{ label: `Call ${name}`, icon: "phone", href: `tel:${digits}` }] });
      return ervoSays("I can call people in your contacts in the Ervo Android app 📞");
    }
    if (!(await ensure("contacts", `Call ${name}`))) return ervoSays("Okay, I won't look at your contacts.");
    const voiceMode = lastWasVoice;
    if (digits.length >= 7 && digits.length >= name.replace(/\s/g, "").length - 2) {
      return confirmCall([{ name: digits, number: digits, label: "" }], voiceMode);
    }
    showTyping("looking in your contacts");
    setStatus("📇", "Looking in your contacts");
    native.findContacts(name);
    const r = await waitFor("ervoContacts", 8000);
    if (r.status === "denied") return ervoSays("I need permission to see your contacts to call someone. You can allow it in Settings → Apps → Ervo → Permissions → Contacts.");
    if (r.status !== "ready") return ervoSays("I couldn't read your contacts just now. Try again in a moment.");
    if (!r.contacts.length) return ervoSays(`I couldn't find "${name}" in your contacts 🤔 Try their name the way it's saved.`);
    return confirmCall(r.contacts, voiceMode);
  }

  // One match by voice: call after a short countdown you can cancel. Otherwise, tap who to call.
  async function confirmCall(list, voiceMode) {
    const card = document.createElement("div");
    card.className = "daycard";
    if (list.length === 1 && voiceMode) {
      const c = list[0];
      await ervoSays(`Calling ${c.name} 📞`);
      const row = document.createElement("div");
      row.className = "callrow";
      row.innerHTML = '<span class="callring"></span>';
      const who = document.createElement("span");
      who.className = "dn";
      who.textContent = c.name;
      const sub = document.createElement("small");
      sub.textContent = [c.label, c.number].filter(Boolean).join(" · ");
      who.append(sub);
      row.append(who);
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "pill ghost";
      let left = 3;
      cancel.textContent = `Cancel (${left})`;
      card.append(row, cancel);
      thread.append(card);
      toBottom();
      const tick = setInterval(() => {
        left -= 1;
        if (left > 0) { cancel.textContent = `Cancel (${left})`; return; }
        clearInterval(tick);
        cancel.remove();
        lastCallName = c.name;
        native.callNumber(c.number);
      }, 1000);
      cancel.addEventListener("click", () => { clearInterval(tick); card.classList.add("busy"); cancel.remove(); ervoSays("Okay, I won't call 👍"); });
      return;
    }
    await ervoSays(list.length === 1 ? `Found ${list[0].name} 📞 Tap to call.` : `Who should I call? 📞`);
    list.slice(0, 8).forEach((c) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "dayrow";
      const ini = document.createElement("span");
      ini.className = "initial";
      ini.textContent = (c.name || "?").trim().charAt(0).toUpperCase();
      const who = document.createElement("span");
      who.className = "dn";
      who.textContent = c.name;
      const sub = document.createElement("small");
      sub.textContent = [c.label, c.number].filter(Boolean).join(" · ");
      who.append(sub);
      const ico = document.createElement("span");
      ico.className = "callico";
      ico.innerHTML = ICON.phone;
      row.append(ini, who, ico);
      row.addEventListener("click", () => {
        if (card.classList.contains("busy")) return;
        card.classList.add("busy");
        row.setAttribute("aria-pressed", "true");
        lastCallName = c.name;
        native.callNumber(c.number);
      });
      card.append(row);
    });
    thread.append(card);
    toBottom();
  }
  function afterCall(r) {
    if (r.status === "emergency") return emergencyReply();
    if (r.status === "calling" || r.status === "dialing") {
      logActivity({ kind: "call", ico: "phone", title: `Called ${lastCallName || "someone"}`, detail: r.status === "calling" ? "Phone call" : "Opened the dialer" });
      if (r.status === "dialing") ervoSays("I opened your dialer with the number in. Tap Call when you're ready 📞");
      return;
    }
    ervoSays("I couldn't start the call 😕 Try again from your Phone app.");
  }

  // "Hey Ervo": listens for Ervo's name while it's on, then opens Ervo
  let wakeWanted = false;
  const wakeState = () => { try { return JSON.parse(native.wakeStatus()); } catch (e) { return { on: false }; } };
  function wakeActs(s) {
    return [
      !s.assistant ? { label: "Make Ervo my phone's assistant", icon: "open", onClick: () => native.openAssistantSettings() } : null,
      s.on ? { label: "Turn off Hey Ervo", icon: "mic", onClick: () => { wakeWanted = false; native.setWake(false); } }
        : { label: "Turn on Hey Ervo", icon: "mic", onClick: () => { wakeWanted = true; native.setWake(true); } },
      s.on && !s.overlay ? { label: "Let Ervo pop up over apps", icon: "open", onClick: () => native.openOverlaySettings() } : null,
    ].filter(Boolean);
  }
  function heyErvo(turn) {
    if (!(native && native.setWake)) return ervoSays("\"Hey Ervo\" works in the Ervo Android app. On iPhone, tap the mic to talk to me.");
    if (turn === true) { wakeWanted = true; native.setWake(true); return; }
    if (turn === false) { wakeWanted = false; native.setWake(false); return; }
    const s = wakeState();
    return ervoSays(s.on
      ? "Hey Ervo is on. Android shows a mic dot and a small notification while it's on. You can turn it off anytime."
      : "For hands-free without an always-on mic, make Ervo your phone's assistant: hold the power or home button and I open, ready to listen. Hey Ervo also works, but Android shows a mic dot the whole time it's on.",
    { acts: wakeActs(s) });
  }
  window.ervoWakeState = (json) => {
    let s;
    try { s = JSON.parse(json); } catch (e) { return; }
    if (s.on) return ervoSays(`Hey Ervo is on. Say "Hey Ervo" and what you need.${s.overlay ? "" : " To let me pop up over other apps, turn on \"Display over other apps\"."}`, { acts: wakeActs(s) });
    if (wakeWanted && !s.mic) return ervoSays("I need the microphone to hear my name. You can allow it in Settings, Apps, Ervo, Permissions, Microphone.");
    if (wakeWanted) return ervoSays("Android didn't let me start listening. Open Ervo and try again.");
    return ervoSays("Hey Ervo is off. I'm not listening anymore.");
  };

  // Opened by "Hey Ervo" (or as the phone's assistant): the owl pops up and listens, or does what you said
  function handleWake(w) {
    if (!account) return;
    toggleMenu(false);
    show("chat");
    const cmd = String((w && w.command) || "").trim();
    if (!cmd) return startVoice();
    openVoice();
    finishVoice(cmd);
    if (native && native.resumeWake) native.resumeWake();
  }
  window.ervoWake = (json) => { try { handleWake(JSON.parse(json)); } catch (e) { /* ignore */ } };

  // ---------- changing events: rename or move them (Android) ----------
  let addedWaiter = null;
  window.ervoEventAdded = (json) => { const r = addedWaiter; addedWaiter = null; if (r) { try { r(JSON.parse(json)); } catch (e) { r({ ok: false }); } } };
  let updatedWaiter = null;
  window.ervoEventUpdated = (json) => { const r = updatedWaiter; updatedWaiter = null; if (r) { try { r(JSON.parse(json)); } catch (e) { r({ ok: false }); } } };
  const nativeCall = (set, call, ms) => new Promise((resolve) => {
    set(resolve);
    call();
    setTimeout(() => resolve({ ok: false, reason: "timeout" }), ms || 8000);
  });

  // "rename my dentist to Dentist checkup", "move gym friday to 7pm", "push lunch with Sam to tomorrow"
  function parseEdit(d) {
    const raw = d.raw.replace(/[.!?]+$/, "");
    let m = raw.match(/\b(?:rename|re-name|change the (?:name|title) of|retitle)\s+(?:my |the )?(.+?)\s+(?:event\s+)?(?:to|as)\s+(.+)$/i);
    if (m) return { target: m[1], newTitle: cap(m[2].replace(/^["']|["']$/g, "").trim()) };
    m = raw.match(/\b(?:change|move|reschedule|push|shift|update|re-?set|bump)\s+(?:back\s+)?(?:my |the )?(.+?)\s+(?:to|until|till|for)\s+(.+)$/i);
    if (!m) return null;
    const when = parseWhen(m[2].toLowerCase(), new Date(), /\b(dinner|tonight|evening)\b/i.test(m[2]));
    if (!when.date && !when.time) return { target: m[1], newTitle: cap(m[2].trim()) }; // "change gym to Yoga"
    return { target: m[1], when };
  }

  async function editEvents(q) {
    const targetWhen = parseWhen(q.target.toLowerCase(), new Date(), false);
    const title = cleanTitle(q.target);
    if (!(native && native.updateEvent)) {
      return ervoSays("I can change events right from here in the Ervo Android app 📅 On iPhone, open your calendar and tap the event to edit it.",
        { acts: [{ label: "Open Calendar", icon: "calendar", href: /iPhone|iPad/.test(navigator.userAgent) ? "calshow:" : "https://calendar.google.com/calendar/r" }] });
    }
    if (!(await ensure("phonecal", "Find and change events on your calendar"))) return ervoSays("Okay, I won't touch your calendar.");
    const range = targetWhen.date ? dayRange(targetWhen.date) : { from: startOfDay(new Date()), to: addDays(startOfDay(new Date()), 180), label: "in the next 6 months" };
    showTyping("checking your calendar");
    setStatus("📅", "Checking your calendar");
    const found = await readCalendar(title, range);
    if (found.status === "denied") return ervoSays("I need permission to see your calendar. You can allow it in Settings → Apps → Ervo → Permissions → Calendar.");
    if (found.status !== "ready") return ervoSays("I couldn't read your calendar just now. Try again in a moment.");
    if (!found.events.length) return ervoSays(`I couldn't find ${title ? `"${title}"` : "that event"} ${range.label} 🤔`);
    const plan = (ev) => {
      const start = new Date(ev.start);
      let next = null;
      if (q.when) {
        next = new Date(q.when.date ? startOfDay(q.when.date) : startOfDay(start));
        if (q.when.time) next.setHours(q.when.time.h, q.when.time.m, 0, 0);
        else next.setHours(start.getHours(), start.getMinutes(), 0, 0);
      }
      return { ev, start, next, newTitle: q.newTitle || "" };
    };
    const describe = (p) => p.newTitle ? `"${p.ev.title}" → "${p.newTitle}"` : `"${p.ev.title}" → ${fmtDate(p.next)}${p.ev.allDay && !q.when.time ? "" : ` at ${fmtTime({ h: p.next.getHours(), m: p.next.getMinutes() })}`}`;
    const list = found.events.slice(0, 8).map(plan);
    await ervoSays(list.length === 1 ? `Here's the change 📅 ${describe(list[0])}. Tap Save.` : "Which one should I change? 📅 Tap it, then Save.");
    const card = document.createElement("div");
    card.className = "daycard";
    let chosen = list.length === 1 ? 0 : -1;
    const rows = list.map((p, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "dayrow";
      const time = document.createElement("span");
      time.className = "dt";
      time.textContent = p.ev.allDay ? "All day" : fmtTime({ h: p.start.getHours(), m: p.start.getMinutes() });
      const name = document.createElement("span");
      name.className = "dn";
      name.textContent = p.ev.title || "(No title)";
      const sub = document.createElement("small");
      sub.textContent = `${dayName(p.start)} → ${p.newTitle ? `"${p.newTitle}"` : `${dayName(p.next)}${p.ev.allDay && !q.when.time ? "" : `, ${fmtTime({ h: p.next.getHours(), m: p.next.getMinutes() })}`}`}`;
      name.append(sub);
      const tick = document.createElement("span");
      tick.className = "tick";
      tick.innerHTML = ICON.done;
      row.append(time, name, tick);
      row.addEventListener("click", () => { if (!card.classList.contains("busy")) { chosen = i; update(); } });
      card.append(row);
      return row;
    });
    const go = document.createElement("button");
    go.type = "button";
    go.className = "pill";
    card.append(go);
    function update() {
      rows.forEach((r, i) => r.setAttribute("aria-pressed", String(i === chosen)));
      go.disabled = chosen < 0;
      go.textContent = chosen < 0 ? "Tap the event to change" : "Save change";
    }
    update();
    go.addEventListener("click", async () => {
      const p = list[chosen];
      if (!p) return;
      card.classList.add("busy");
      showTyping("updating your calendar");
      setStatus("📅", "Updating your calendar");
      const r = await nativeCall((f) => { updatedWaiter = f; }, () => native.updateEvent(String(p.ev.id), p.newTitle, p.next ? p.next.getTime() : -1));
      if (!r.ok) {
        card.classList.remove("busy");
        return ervoSays(r.reason === "repeats" ? "That one repeats, so change its time in your calendar app to pick this day or all of them 📅" : "I couldn't change it 😕 Try editing it in your calendar app.");
      }
      rows[chosen].classList.add("gone");
      logActivity({ kind: "edit", ico: "calendar", title: p.newTitle ? `Renamed ${p.ev.title} to ${p.newTitle}` : `Moved ${p.ev.title}`, detail: describe(p) });
      return ervoSays(`Updated ✅ ${describe(p)}.`, { acts: [{ label: "Undo", icon: "undo", onClick: async (e) => {
        e.currentTarget.disabled = true;
        const u = await nativeCall((f) => { restoreWaiter = f; }, () => native.restoreEvent(String(r.undo)));
        e.target.closest(".acts") && e.target.closest(".acts").remove();
        ervoSays(u.ok ? "Undone ↩️ It's back the way it was." : "Sorry, I couldn't undo that 😕");
      } }] });
    });
    thread.append(card);
    toBottom();
  }

  // ---------- turning off alarms ----------
  async function alarmsOff(a) {
    if (!(native && native.dismissAlarm)) return ervoSays("I can turn off alarms in the Ervo Android app ⏰ On iPhone, open the Clock app.");
    if (!(await ensure("clock", "Turn off alarms in your Clock app"))) return ervoSays("Okay, I won't touch your Clock app.");
    setStatus("⏰", "Opening your alarms");
    native.dismissAlarm(a && a.h !== null ? "time" : "all", a && a.h !== null ? a.h : 0, a && a.h !== null ? a.m : 0);
    const r = await waitFor("ervoClock", 6000);
    if (a && a.h !== null) return ervoSays(r.ok ? `Turned off your ${fmtTime({ h: a.h, m: a.m })} alarm ⏰ Your Clock app may ask you to confirm.` : "I opened your alarms. Tap the switch to turn it off, or hold it to delete ⏰");
    return ervoSays(r.ok ? "Your Clock app is asking which alarms to turn off ⏰ Pick them there." : "I opened your alarms. Tap the switches to turn them off, or hold one to delete it ⏰");
  }
  // "change my 6:30 alarm to 7" = turn off the old one, set the new one
  async function alarmChange(t) {
    const m = t.match(/^(.*?)\bto\b(.*)$/);
    if (!m) return doAlarm(parseAlarm(t));
    const from = parseAlarm(m[1]);
    const to = parseAlarm(m[2]);
    if (to.h === null) return doAlarm(to);
    if (from.h !== null && native && native.dismissAlarm) { native.dismissAlarm("time", from.h, from.m); await waitFor("ervoClock", 6000); }
    return doAlarm(Object.assign(to, { days: to.days.length ? to.days : from.days }));
  }

  // ---------- video meetings: Google Meet, Zoom, Microsoft Teams ----------
  const MEET_APPS = { meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams" };
  function parseMeeting(d) {
    const t = d.t;
    const app = /\bzoom\b/.test(t) ? "zoom" : /\bteams\b/.test(t) ? "teams" : /\bskype\b/.test(t) ? "skype" : "meet";
    const w = t.match(/\bwith ([a-z][\w'-]*(?: [a-z][\w'-]*)?)/);
    const who = w && !/^(the|my|a|an|google|zoom|teams|skype)$/.test(w[1].split(" ")[0]) ? w[1].replace(/\s+(on|at|for|next|this|tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/, "") : "";
    const now = /\b(now|right now|instant|quick)\b/.test(t) && !d.when.date;
    return { app, who: who ? who.split(" ").map(cap).join(" ") : "", when: d.when, now };
  }
  async function planMeeting(m) {
    if (m.app === "skype") {
      return ervoSays("Skype shut down in May 2025, and Microsoft moved it to Teams 💬 Want a Teams meeting instead?", { acts: [{ label: "Use Microsoft Teams", icon: "open", onClick: () => planMeeting(Object.assign({}, m, { app: "teams" })) }] });
    }
    const name = MEET_APPS[m.app];
    const title = `${name === "Google Meet" ? "Meeting" : `${name} meeting`}${m.who ? ` with ${m.who}` : ""}`;
    if (!(await ensure(m.app, `Set up a ${name} meeting`))) return ervoSays(`Okay, I won't open ${name}.`);
    if (m.now || !m.when.date) {
      if (m.now || !m.when.time) {
        const url = { meet: "https://meet.google.com/new", zoom: "https://zoom.us/start/videomeeting", teams: "https://teams.live.com/v2/" }[m.app];
        openOutside(url);
        logActivity({ kind: "meeting", ico: "open", title: `Started a ${name} meeting`, link: url });
        return ervoSays(`Opening ${name} for a meeting now 🎥 Share the link with ${m.who || "whoever's joining"}.`, { acts: [{ label: `Open ${name} again`, icon: "open", href: url }] });
      }
      m.when.date = new Date();
    }
    const start = new Date(startOfDay(m.when.date));
    const time = m.when.time || { h: 9, m: 0 };
    start.setHours(time.h, time.m, 0, 0);
    const end = new Date(start.getTime() + 30 * 60000);
    const ev = { title, start, end, allDay: false, notes: `${name} meeting planned with Ervo` };
    let url;
    if (m.app === "meet") url = googleLink(ev) + "&vcon=meet"; // Google Calendar adds a Meet link
    else if (m.app === "teams") url = `https://teams.microsoft.com/l/meeting/new?${new URLSearchParams({ subject: title, startTime: start.toISOString(), endTime: end.toISOString() })}`;
    else url = "https://zoom.us/meeting/schedule";
    openOutside(url);
    logActivity({ kind: "meeting", ico: "calendar", title, detail: name, when: start.toISOString(), link: url });
    const when = `${fmtDate(start)} at ${fmtTime(time)}`;
    const how = m.app === "meet" ? "Google Calendar opened with a Meet link added, so tap Save"
      : m.app === "teams" ? "Teams opened with it filled in, so sign in if it asks and tap Save"
      : "Zoom opened its scheduler, so sign in if it asks and set it for that time";
    return ervoSays(`${title}, ${when} 🎥 ${how}.`, {
      acts: [{ label: `Open ${name} again`, icon: "open", href: url }].concat(m.app === "zoom" ? [{ label: "Add to my calendar", icon: "calendar", onClick: async () => finishCalendar(ev, await addToCalendar(ev)) }] : []),
    });
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
    // "Make an alarm... actually never mind": drop it
    const nevermind = /(?:^|[\s,.!])(?:actually|wait|oh|no)?[\s,]*(never ?mind|cancel (?:that|it|this)|forget (?:it|that|about it)|scratch that|don'?t (?:do|worry about) (?:it|that)|cancel)[.! ]*$/.exec(d.t);
    if (nevermind && d.t.slice(0, nevermind.index).trim().split(/\s+/).filter(Boolean).length >= 2) {
      task = null; confirming = false; clockAsk = null; removeAsk = null;
      return ervoSays("Okay, cancelled 👍 I won't do that.");
    }
    if (task && d.removeLast) {
      task = null; confirming = false;
      return ervoSays("No problem, I dropped it 👍 Nothing was added to your calendar.");
    }
    // Waiting for a timer length or alarm time
    if (clockAsk) {
      const c = clockAsk;
      clockAsk = null;
      if (c.kind === "timer" && parseDuration(d.t)) return doTimer(parseDuration(d.t), c.label);
      if (c.kind === "alarm") { const a = parseAlarm(d.t); if (a.h !== null) return doAlarm(Object.assign(a, { days: a.days.length ? a.days : c.days, label: a.label || c.label })); }
    }
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

    if (d.intent === "remove") {
      task = null; confirming = false;
      if (d.removeLast && lastEvent) return removeEvents({ title: lastEvent.title, range: dayRange(lastEvent.start) });
      return removeEvents(parseRemove(d));
    }
    if (d.intent === "timer") { task = null; confirming = false; return doTimer(d.seconds, d.label); }
    if (d.intent === "alarm") { task = null; confirming = false; return doAlarm(d.alarm); }
    if (d.intent === "alarmOff") { task = null; confirming = false; return alarmsOff(d.alarm); }
    if (d.intent === "alarmChange") { task = null; confirming = false; return alarmChange(d.t); }
    if (d.intent === "meeting") { task = null; confirming = false; return planMeeting(d.meeting); }
    if (d.intent === "edit") {
      task = null; confirming = false;
      const q = parseEdit(d);
      if (q) return editEvents(q);
      return ervoSays("What should I change it to? 📅 Say something like \"move gym to 7pm\" or \"rename dentist to checkup\".");
    }
    if (d.intent === "alarms") return native && native.showAlarms ? (native.showAlarms(), ervoSays("Here are your alarms ⏰")) : ervoSays("I can show your alarms in the Ervo Android app ⏰");
    if (d.intent === "call") { task = null; confirming = false; return doCall(d.callee); }
    if (d.intent === "emergency") return emergencyReply();
    if (d.intent === "wake") return heyErvo(d.wakeTurn);
    // Ervo asked "when is it?": a day or "this week" answers it
    if (removeAsk) {
      const q = removeAsk;
      removeAsk = null;
      const r = parseRemove(d);
      if (r.range || r.count || (d.intent === "unknown" && r.title && d.t.split(/\s+/).length <= 4)) return removeEvents(Object.assign({}, q, r, { title: r.title || q.title }));
    }
    if (AI_URL && ["unknown", "event", "reserve", "shop"].includes(d.intent)) return askAI(d);

    switch (d.intent) {
      case "settings": return applySettings(d.settings);
      case "reserve": case "event": case "shop": {
        task = newTask(d);
        if (biz && d.intent === "event" && task.title === "New event") task.title = "Meeting";
        return missing(task).length ? askForMissing(task) : propose(task);
      }
      case "hello": return ervoSays(`Hi ${prefs().nickname || account.name}! What can I do for you?`);
      case "thanks": return ervoSays("Anytime! 😊");
      case "help": return ervoSays(biz
        ? "Here's what I can do:\n• Answer customers and summarize tickets\n• Refunds by your policy\n• Book meetings on your calendar\n• Draft replies for your email\n\nJust tell me in your own words, like \"Call with Northwind Thursday at 2pm\"."
        : "Here's what I can do:\n• Plan reservations and events and put them on your calendar\n• Find things on Amazon, start returns and track orders\n• Set, change and turn off alarms and timers, and call people in your contacts\n• Add, move, rename and remove calendar events, with Undo\n• Set up Google Meet, Zoom or Teams meetings\n• Look at photos: meals (calories), receipts, labels, flyers\n• Learn you over time: see your Psyche in the menu\n• Ideas picked for you, and side chats for things you want to keep apart\n• Show your steps, plans and recent activity in Ervo Stats\n• Weather and news in your greeting\n\nJust say it your way, like \"dinner for 4 in two weeks at 7\".");
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
        return ervoSays("Order #5512: a blender that arrived cracked, $64.00, delivered 4 days ago.\nYour policy: damaged on arrival → full refund ✓\n\nShould I issue the refund and reply to the customer?", { chips: ["Yes, refund it", "Send to my team"] });
      case "tickets":
        return ervoSays("Today so far (sample):\n• 42 customer tickets\n• 38 resolved by me, average 41 seconds\n• 4 sent to your team (2 bulk orders, 1 billing question, 1 upset customer)", {  });
      case "email": {
        const body = "Hi Jordan,\n\nI'm really sorry your order arrived late. I've refunded your shipping and added a 15% credit to your account. If there's anything else I can do, just reply here.\n\nThanks for your patience.";
        const mail = `mailto:?subject=${encodeURIComponent("About your order")}&body=${encodeURIComponent(body)}`;
        return ervoSays(`Here's a draft:\n\n"${body}"\n\nWant to send it from your email?`, {
          acts: [{ label: "Open in email", icon: "mail", onClick: () => ensure("mail", "Open this draft in your email").then((ok) => { if (ok) { logActivity({ kind: "email", ico: "mail", title: "Drafted a customer reply" }); openOutside(mail); } }) }],
        });
      }
      default:
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
    thread.querySelectorAll(".choices button:not(:disabled)").forEach((b) => { b.disabled = true; });
    bubble(v, "me");
    buzz("tap");
    toBottom(true);
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
    if (side === "›") el.append(chevron());
    else if (side) { const sd = document.createElement("span"); sd.className = "side"; sd.textContent = side; el.append(sd); }
    return el;
  }
  // The disclosure chevron on rows that open another screen (Apple lists)
  function chevron() {
    const c = document.createElement("span");
    c.className = "chev";
    c.setAttribute("aria-hidden", "true");
    c.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
    return c;
  }
  const icoClass = (ico) => (ico === "food" ? "calendar" : ico);
  function empty(text) { const p = document.createElement("p"); p.className = "empty"; p.textContent = text; return p; }

  function renderStats() {
    const now = new Date();
    $("stats-date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    $("stats-title").textContent = `${prefs().nickname || account.name}'s Ervo Stats`;
    setSky(null);
    $("sky-now").hidden = true;
    if (allowed("location")) {
      weatherNow().then((w) => {
        $("sky-emoji").textContent = w.emoji;
        $("sky-temp").textContent = `${w.temp}°`;
        $("sky-cond").textContent = `${cap(w.kind)}${w.city ? ` in ${w.city}` : ""}`;
        $("sky-hilo").textContent = `H ${w.hi}°  L ${w.lo}°`;
        $("sky-now").hidden = false;
        setSky(w);
      }).catch(() => { /* the sky still follows the clock */ });
    }

    // Upcoming: your phone's calendar for the next two weeks, plus what Ervo planned
    const items = activity();
    // Same title on the same day counts as one event
    const dayKey = (title, start) => `${String(title || "").trim().toLowerCase()}|${startOfDay(new Date(start)).getTime()}`;
    const planKeys = new Set();
    const planned = items.filter((a) => a.when && new Date(a.when) > now)
      .map((a) => ({ title: a.title, start: new Date(a.when), allDay: a.allDay, ico: a.ico, detail: a.detail, link: a.link }))
      .sort((a, b) => (a.allDay ? 1 : 0) - (b.allDay ? 1 : 0))
      .filter((p) => { const k = dayKey(p.title, p.start); if (planKeys.has(k)) return false; planKeys.add(k); return true; });
    drawUpcoming(planned);
    if (native && native.findEvents && native.calendarAllowed && native.calendarAllowed()) {
      readCalendar("", { from: now, to: addDays(startOfDay(now), 15) }).then((r) => {
        if (r.status !== "ready" || !$("stats").classList.contains("active")) return;
        const seen = new Set(r.events.map((e) => dayKey(e.title, e.start)));
        const mine = planned.filter((p) => !seen.has(dayKey(p.title, p.start)));
        drawUpcoming(mine.concat(r.events.map((e) => ({ title: e.title || "(No title)", start: new Date(e.start), allDay: e.allDay, ico: "calendar", detail: e.calendar }))));
      });
    }
    renderMemories();

    // Most recent events: everything Ervo did, newest first
    $("recent").innerHTML = "";
    if (!items.length) $("recent").append(empty("When Ervo does something for you, it shows up here."));
    items.slice(0, 3).forEach((a) => $("recent").append(activityRow(a)));
    if (items.length > 3) {
      const all = document.createElement("button");
      all.type = "button";
      all.className = "row see-all";
      all.innerHTML = `<span class="txt"><b>See all activity</b><small>${items.length} things Ervo has done for you</small></span>`;
      all.append(chevron());
      all.addEventListener("click", openActivity);
      $("recent").append(all);
    }

    renderApps();
    if (native && native.stepsStatus) { $("steps-note").textContent = "Checking Health Connect…"; native.stepsStatus(); }
    else renderSteps({ status: "web" });
  }

  function drawUpcoming(list) {
    const box = $("upcoming");
    box.innerHTML = "";
    list.sort((a, b) => a.start - b.start);
    const next = list[0];
    $("sky-next").hidden = !next;
    if (next) $("sky-next").textContent = `📅 ${next.title} · ${untilText(next.start)}`;
    if (!list.length) { box.append(empty("Nothing coming up in the next two weeks.")); return; }
    list.slice(0, 8).forEach((a) => {
      const when = `${fmtDate(a.start)}${a.allDay ? "" : ` at ${a.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}`;
      const r = row(icoClass(a.ico), a.title, `${when}${a.detail ? " · " + a.detail : ""}`, untilText(a.start), a.link);
      r.querySelector(".app-ico").innerHTML = ICON[a.ico] || ICON.calendar;
      box.append(r);
    });
  }

  // Ervo Stats shows a short Psyche summary; the full Psyche has its own screen
  function renderMemories() {
    const box = $("memories");
    box.innerHTML = "";
    const p = psyche();
    const styled = Object.keys(STYLE_NAMES).filter((k) => p.style[k]).length;
    const sub = p.facts.length || styled ? `${p.facts.length} thing${p.facts.length === 1 ? "" : "s"} Ervo knows · ${styled ? "knows how you like to talk" : "still learning how you talk"}` : "Ervo is just getting to know you";
    const r = row("brain", "Your Psyche", sub, "›");
    r.classList.add("compact", "tap");
    r.addEventListener("click", () => openPsyche());
    box.append(r);
  }

  // ---------- the Psyche screen: what Ervo knows and how it talks to you ----------
  function openPsyche() {
    toggleMenu(false);
    renderPsyche();
    show("psyche");
    $("psyche").querySelector(".stats-body").scrollTop = 0;
  }
  function renderPsyche() {
    const p = psyche();
    const box = $("psyche-list");
    box.innerHTML = "";
    $("psyche-sub").textContent = p.facts.length
      ? `Ervo knows ${p.facts.length} thing${p.facts.length === 1 ? "" : "s"} about you and keeps learning as you chat.`
      : "Ervo is just getting to know you. It learns as you chat.";
    const section = (title, card) => { const h = document.createElement("h2"); h.textContent = title; box.append(h, card); };
    const card = () => { const c = document.createElement("div"); c.className = "card list"; return c; };

    const style = card();
    const keys = Object.keys(STYLE_NAMES).filter((k) => p.style[k]);
    if (!keys.length) style.append(empty("Plain and simple for now. Ervo picks up how you write and matches it."));
    keys.forEach((k) => {
      const r = row(k === "language" ? "chat" : k === "emojis" ? "star" : "chat", STYLE_NAMES[k], "", p.style[k]);
      r.classList.add("compact", "style-row");
      style.append(r);
    });
    section("How Ervo talks to you", style);

    const byKind = {};
    p.facts.forEach((f) => { (byKind[f.kind] = byKind[f.kind] || []).push(f); });
    if (!p.facts.length) section("What Ervo knows", (() => { const c = card(); c.append(empty("Things you mention, like an allergy, your team or your favorite store, show up here.")); return c; })());
    Object.keys(KIND_NAMES).forEach((k) => {
      if (!byKind[k]) return;
      const c = card();
      byKind[k].slice().reverse().forEach((f) => {
        const r = row(KIND_ICON[k] || "brain", f.text, "");
        r.classList.add("compact", "memory");
        c.append(r);
      });
      section(KIND_NAMES[k], c);
    });

    if (p.lessons.length) {
      const c = card();
      p.lessons.slice().reverse().forEach((l) => { const r = row("done", l, ""); r.classList.add("compact", "memory"); c.append(r); });
      section("What Ervo has learned about helping you", c);
    }
  }

  // ---------- Ideas: things Ervo can do for you, tied to who you are ----------
  const IDEAS_KEY = "ervo-ideas";
  const IDEA_ICONS = ["calendar", "map", "plane", "heart", "food", "shop", "home", "ball", "book", "tooth", "doctor", "money", "star", "camera", "music", "car", "sun", "people"];
  const DEFAULT_IDEAS = { groups: [
    { title: "For you", ideas: [
      { icon: "star", title: "Tell me a goal. I'll make a plan and keep you on it.", detail: "Run a 5K, save for a trip, read more. I break it into steps and check in.", prompt: "Help me set a goal" },
      { icon: "camera", title: "Snap your meal. I'll count the calories.", detail: "Send a photo of your plate and I'll estimate calories and protein for each part.", prompt: "I want to track calories with photos of my meals" },
      { icon: "map", title: "Free this weekend? I'll find what's on near you.", detail: "Events, games, markets and shows in your area, with links to go.", prompt: "What's happening near me this weekend?" },
    ] },
    { title: "Health & fitness", ideas: [
      { icon: "tooth", title: "Book the checkup you keep putting off.", detail: "I find a dentist or doctor near you, the number to call, and add it to your calendar.", prompt: "Help me book a dentist checkup" },
      { icon: "ball", title: "A workout built around the time you have.", detail: "Tell me your time and gear. I'll build the session and plan your week.", prompt: "Make me a 30 minute workout I can do at home" },
      { icon: "heart", title: "Name a habit to break. I'll nudge you before it hits.", detail: "We find what sets it off, then I set reminders at the right moments.", prompt: "Help me break a habit" },
    ] },
    { title: "Food", ideas: [
      { icon: "food", title: "Tell me what's in your fridge. I'll plan dinner.", detail: "Quick recipes from what you already have, with your diet in mind.", prompt: "What can I make for dinner with what's in my fridge?" },
      { icon: "shop", title: "A week of meals and the grocery list to match.", detail: "I plan it around your taste and budget, then list what to buy.", prompt: "Plan my meals for the week and make a grocery list" },
    ] },
    { title: "Shopping", ideas: [
      { icon: "shop", title: "Name the item. I'll find the best-reviewed one for the price.", detail: "I read real reviews and show the top picks with pictures and prices.", prompt: "Find the best-reviewed headphones under $100" },
      { icon: "star", title: "Can't decide? I'll compare them side by side.", detail: "The specs and prices that matter, so the choice is easy.", prompt: "Compare the top 3 robot vacuums" },
    ] },
    { title: "Home & errands", ideas: [
      { icon: "car", title: "Never miss an oil change or renewal again.", detail: "I set reminders for the things that sneak up on you.", prompt: "Remind me to change my car's oil every 3 months" },
      { icon: "home", title: "A cleaning routine that fits your week.", detail: "Small tasks on the right days, so the weekend stays free.", prompt: "Make me a weekly cleaning plan" },
    ] },
    { title: "Plans & places", ideas: [
      { icon: "plane", title: "A day trip within two hours of home.", detail: "Where to go, what to see, where to eat, and the drive.", prompt: "Plan a day trip near me" },
      { icon: "people", title: "Find a new hobby or game to join nearby.", detail: "Pickup games, classes and clubs that fit your schedule.", prompt: "Find a pickup soccer game near me" },
    ] },
  ] };
  function openIdeas() {
    toggleMenu(false);
    renderIdeas(false);
    show("ideas");
  }
  function ideaRow(it) {
    const ico = IDEA_ICONS.includes(it.icon) ? it.icon : "star";
    const r = row(ico, it.title, it.detail || "");
    r.classList.add("idea", "tap");
    r.setAttribute("role", "button");
    r.tabIndex = 0;
    const go = () => { show("chat"); send(it.prompt || it.title); };
    r.addEventListener("click", go);
    r.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    return r;
  }
  function drawIdeas(data) {
    const box = $("ideas-list");
    box.innerHTML = "";
    const groups = data && Array.isArray(data.groups) ? data.groups : DEFAULT_IDEAS.groups;
    groups.forEach((g) => {
      if (!g || !Array.isArray(g.ideas) || !g.ideas.length) return;
      const h = document.createElement("h2");
      h.textContent = g.title;
      const c = document.createElement("div");
      c.className = "card list";
      g.ideas.slice(0, 5).forEach((it) => { if (it && it.title) c.append(ideaRow(it)); });
      box.append(h, c);
    });
  }
  async function renderIdeas(force) {
    // Your goals first (from your Psyche)
    const goals = psyche().facts.filter((f) => f.kind === "goal");
    const gbox = $("goals");
    gbox.innerHTML = "";
    if (!goals.length) gbox.append(empty("Tell Ervo a goal, like \"I want to run a 5K by spring\" or \"save $500 this month\", and it shows up here."));
    goals.slice().reverse().forEach((f) => gbox.append(ideaRow({ icon: "star", title: f.text, detail: "Tap to plan your next step", prompt: `Help me with my goal: ${f.text}` })));

    const cached = load(IDEAS_KEY);
    const learned = psyche().learned || 0;
    const fresh = cached && cached.day === new Date().toDateString() && learned - (cached.learned || 0) < 5;
    if (cached && cached.data) drawIdeas(cached.data); else drawIdeas(null);
    if (!AI_URL || (fresh && !force)) return;
    $("ideas-sub").textContent = "Finding ideas for you…";
    $("ideas-refresh").disabled = true;
    try {
      const j = await askServer({ task: "ideas", messages: [] });
      if (j && j.ideas && Array.isArray(j.ideas.groups) && j.ideas.groups.length) {
        save(IDEAS_KEY, { day: new Date().toDateString(), learned, data: j.ideas });
        if ($("ideas").classList.contains("active")) drawIdeas(j.ideas);
      }
    } catch (e) { /* the starter ideas stay */ }
    $("ideas-sub").textContent = "Picked for you. Tap one and Ervo starts on it.";
    $("ideas-refresh").disabled = false;
  }

  // The sky behind Ervo Stats follows the time of day where you are (and the clouds or rain)
  function setSky(w) {
    const now = new Date();
    let part;
    if (w && w.sunrise && w.sunset) {
      const t = now.getTime(), rise = w.sunrise.getTime(), set = w.sunset.getTime(), hr = 3600000;
      part = t < rise - 0.6 * hr || t > set + 0.75 * hr ? "night" : t < rise + hr ? "dawn" : t > set - hr ? "dusk" : "day";
    } else {
      const h = now.getHours();
      part = h < 5 || h >= 20 ? "night" : h < 8 ? "dawn" : h >= 17 ? "dusk" : "day";
    }
    const kind = w ? w.kind : "";
    const weather = /rain|drizz|storm|snow/.test(kind) ? "wet" : /cloudy|fog/.test(kind) && kind !== "partly cloudy" ? "cloudy" : "";
    const s = $("stats");
    s.dataset.sky = part;
    s.dataset.weather = weather;
    syncBars();
  }

  function activityRow(a) {
    const sub = a.when ? `For ${whenText(a)}` : a.detail || "Done by Ervo";
    const r = row(icoClass(a.ico), a.title, sub, ago(a.at), a.link);
    r.querySelector(".app-ico").innerHTML = ICON[a.ico] || ICON.done;
    return r;
  }

  // ---------- All activity: everything Ervo did, filtered by year and month ----------
  const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: "long" }));
  function openActivity() {
    const items = activity();
    const years = [...new Set(items.map((a) => new Date(a.at).getFullYear()))].sort((x, y) => y - x);
    const fy = $("f-year"), fm = $("f-month");
    fy.innerHTML = '<option value="">All years</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join("");
    fm.innerHTML = '<option value="">All months</option>' + MONTH_NAMES.map((m, i) => `<option value="${i}">${m}</option>`).join("");
    renderActivity();
    show("activity");
    $("activity-body").scrollTop = 0;
  }
  function renderActivity() {
    const y = $("f-year").value, m = $("f-month").value;
    const list = activity().filter((a) => {
      const d = new Date(a.at);
      return (!y || d.getFullYear() === +y) && (m === "" || d.getMonth() === +m);
    });
    const box = $("activity-list");
    box.innerHTML = "";
    $("activity-count").textContent = list.length === 1 ? "1 thing" : `${list.length} things`;
    if (!list.length) { const c = document.createElement("div"); c.className = "card list"; c.append(empty("Nothing here for that time.")); box.append(c); return; }
    let day = "", card = null;
    list.forEach((a) => {
      const label = new Date(a.at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      if (label !== day) {
        day = label;
        const h = document.createElement("h2");
        h.className = "day";
        h.textContent = label;
        card = document.createElement("div");
        card.className = "card list";
        box.append(h, card);
      }
      card.append(activityRow(a));
    });
  }
  $("f-year").addEventListener("change", renderActivity);
  $("f-month").addEventListener("change", renderActivity);
  $("activity-back").addEventListener("click", () => { renderStats(); show("stats"); });

  // Connected apps: one short row each, with a switch. Calendar has one row that says where new events go.
  function renderApps() {
    const box = $("apps");
    box.innerHTML = "";
    const used = Object.keys(STORES).filter((k) => k !== "amazon" && connections()[k]);
    const keys = PLAN[account.plan].apps.concat(account.plan === "personal" ? used : []).filter((k) => k !== "calendar" && k !== "phonecal");

    // Calendar: where new events go, with Change
    const calOn = allowed("phonecal") || allowed("calendar");
    const cal = row("calendar", "Calendar", calOn && prefs().calendar ? `New events go to ${calChoiceName()}` : "Ervo asks where new events go");
    cal.classList.add("compact");
    const ch = document.createElement("button");
    ch.type = "button";
    ch.className = "link-btn";
    ch.textContent = prefs().calendar ? "Change" : "Pick";
    ch.addEventListener("click", changeCalendar);
    cal.append(ch, appSwitch(calOn, () => toggleApp(prefs().calendar === "google" ? "calendar" : "phonecal", calOn)));
    box.append(cal);

    keys.forEach((key) => {
      const c = CONNECTORS[key];
      if (key === "health" && !(native && native.stepsStatus)) return; // phones without the Android app can't share steps yet
      const state = connections()[key];
      const on = !!(state && state.status === "allowed");
      const sub = on ? "On" : state && state.status === "denied" ? "Not allowed" : "Off";
      const r = row(c.ico, c.name, sub);
      r.classList.add("compact");
      r.append(appSwitch(on, () => toggleApp(key, on)));
      box.append(r);
    });

    if (native && native.openAppSettings) {
      // Android's own switches (calendar, contacts, microphone...) live in Settings
      const r = row("open", "Phone permissions", "Android's settings for Ervo");
      r.classList.add("compact", "tap");
      r.append(chevron());
      r.addEventListener("click", () => native.openAppSettings());
      box.append(r);
    }
  }
  function appSwitch(on, onChange) {
    const l = document.createElement("label");
    l.className = "toggle mini";
    const i = document.createElement("input");
    i.type = "checkbox";
    i.checked = on;
    i.setAttribute("aria-label", on ? "Turn off" : "Turn on");
    i.addEventListener("change", () => { i.checked = on; onChange(); });
    l.append(i, document.createElement("i"));
    return l;
  }

  async function toggleApp(key, on) {
    const c = CONNECTORS[key];
    if (on) {
      setConnection(key, "off");
      logActivity({ kind: "disconnect", ico: c.ico, title: `Turned off ${c.name}` });
      // Turning off the calendar: stop using it, and ask where events go next time
      if (key === "phonecal" || key === "calendar") {
        setConnection(key === "phonecal" ? "calendar" : "phonecal", "off");
        const pr = prefs();
        delete pr.calendar; delete pr.calId; delete pr.calName;
        save(PREFS_KEY, pr);
      }
      if (key === "location") drop(PLACE_KEY);
      renderStats();
      return;
    }
    if (key === "phonecal" || key === "calendar") { await changeCalendar(); renderStats(); return; }
    const ok = await askPermission(key);
    if (!ok) { setConnection(key, "denied"); renderApps(); return; }
    setConnection(key, "allowed");
    logActivity({ kind: "connect", ico: c.ico, title: `Connected ${c.name}` });
    if (key === "health" && native && native.requestSteps) native.requestSteps();
    else if (key === "phonecal") { /* nothing to sign in to */ }
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
    $("sky-steps").querySelector("span").textContent = s.status === "ready" ? `${s.today.toLocaleString()} steps` : "Steps --";
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
    setTimeout(() => checkForUpdate(false), 1500);
    // Back from "Allow from this source": carry on installing the update
    if (update && update.state === "needs_permission" && !$("update").hidden && native && native.installUpdate) {
      update.state = "waiting";
      native.installUpdate();
    }
  };

  // ---------- updates: Ervo tells you when a new version is ready ----------
  // Android downloads the new Ervo.apk from GitHub Releases and opens the installer.
  // On iPhone the files come straight from the website, so updating is a quick refresh.
  const APP_VERSION = "0.3.0"; // keep in step with version.json and the Android versionName
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
    if (OVERLAY) return;
    const last = Number(load(UPDATE_CHECK_KEY)) || 0;
    if (!manual && Date.now() - last < 20 * 60 * 1000) return;
    if (!manual && update && !$("update").hidden) return;
    save(UPDATE_CHECK_KEY, Date.now());
    let found = null;
    try { found = await findUpdate(); } catch (e) {
      if (manual) ervoSays("I couldn't check for updates right now. Check your connection and try again.");
      return;
    }
    if (found && !manual && dismissedUpdate === found.version) return;
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

  let dismissedUpdate = null; // "Later" hides it until Ervo is opened fresh
  $("update-later").addEventListener("click", () => { $("update").hidden = true; if (update) dismissedUpdate = update.version; });
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
    reader.onload = async () => {
      const src = await shrinkPhoto(reader.result);
      const caption = message.value.trim();
      if (caption) { message.value = ""; syncComposer(); }
      dayMark();
      photoBubble(src);
      record({ t: "photo", src });
      if (caption) bubble(caption, "me");
      $("chips").innerHTML = "";
      thread.querySelectorAll(".choices button:not(:disabled)").forEach((b) => { b.disabled = true; });
      history.push({ role: "user", text: caption ? `(sent a photo) ${caption}` : "(sent a photo)" });
      // Ervo looks at it: a meal (calories), a receipt, a label, a flyer, a product...
      if (AI_URL) return askAI({ intent: "photo", raw: caption, t: caption.toLowerCase() }, { image: src });
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
    dayMark();
    const host = linkBubble(url.href);
    record({ t: "link", url: url.href });
    $("chips").innerHTML = "";
    history.push({ role: "user", text: `(shared a link: ${url.href})` });
    if (/amazon\./i.test(url.hostname) && account.plan === "personal") {
      return ervoSays(`That's an Amazon link. Want me to keep it in your plans so you remember it?`, { acts: [{ label: "Save it", icon: "shop", onClick: () => { logActivity({ kind: "link", ico: "shop", title: "Saved an Amazon link", detail: host, link: url.href }); ervoSays("Saved ✅ It's in Ervo Stats under Most recent events."); } }] });
    }
    ervoSays(`Got it 🔗 It's saved in Chats & media under Links.`);
  });

  // A photo or link you sent, as a message
  function photoBubble(src) {
    const el = document.createElement("div");
    el.className = "msg me photo";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Photo you sent";
    img.onload = () => { toBottom(); };
    el.append(img);
    thread.append(el);
    toBottom();
  }
  function linkBubble(href) {
    let host = href;
    try { host = new URL(href).hostname.replace(/^www\./, ""); } catch (e) { /* keep it whole */ }
    const el = document.createElement("div");
    el.className = "msg me link";
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.addEventListener("click", (ev) => { ev.preventDefault(); openOutside(href); });
    const b = document.createElement("b");
    b.textContent = host;
    const s = document.createElement("small");
    s.textContent = href.length > 48 ? href.slice(0, 45) + "…" : href;
    a.append(b, s);
    el.innerHTML = '<div class="link-top"></div>';
    el.append(a);
    thread.append(el);
    toBottom();
    return host;
  }
  // Photos are made smaller before they're saved, so the chat fits on the phone
  function shrinkPhoto(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 720 / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        try { resolve(cv.toDataURL("image/jpeg", 0.72)); } catch (e) { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // ---------- Chats & media: photos, links and earlier chats ----------
  let libTab = "photos";
  function allChats() {
    const main = load(CHAT_KEY);
    return (main ? [Object.assign({ main: true }, main)] : []).concat(sides());
  }
  function openLibrary(tab) {
    toggleMenu(false);
    libTab = tab || libTab;
    renderLibrary();
    show("library");
  }
  function renderLibrary() {
    document.querySelectorAll("#lib-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === libTab)));
    const box = $("lib-list");
    box.innerHTML = "";
    const chats = allChats();
    const when = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (libTab === "photos") {
      const pics = [];
      chats.forEach((c) => c.items.forEach((x) => {
        if (x.t === "photo") pics.push({ src: x.src, at: x.at });
        if (x.t === "products") x.products.forEach((p) => { const asin = asinOf(p.url); if (p.image || asin) pics.push({ src: p.image || amazonPic(asin), alt: amazonPic(asin), at: x.at, href: p.url, name: p.name }); });
      }));
      if (!pics.length) { box.append(libEmpty("Photos you send and products Ervo finds show up here.")); return; }
      const grid = document.createElement("div");
      grid.className = "lib-grid";
      const shown = new Set();
      pics.sort((a, b) => new Date(b.at) - new Date(a.at)).filter((p) => { const k = p.href || p.src; if (shown.has(k)) return false; shown.add(k); return true; }).forEach((p) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lib-pic";
        b.setAttribute("aria-label", p.name || "Photo");
        const img = document.createElement("img");
        img.src = p.src;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.onerror = () => { if (p.alt && img.src !== p.alt) img.src = p.alt; else b.remove(); };
        img.onload = () => { if (img.naturalWidth < 20) img.onerror(); };
        b.append(img);
        b.addEventListener("click", () => { if (p.href) openOutside(p.href); else viewPhoto(p.src); });
        grid.append(b);
      });
      box.append(grid);
      return;
    }
    if (libTab === "links") {
      const links = [];
      const seen = new Set();
      const add = (title, href, at) => { if (!href || seen.has(href)) return; seen.add(href); links.push({ title, href, at }); };
      chats.forEach((c) => c.items.forEach((x) => {
        if (x.t === "link") add("", x.url, x.at);
        if (x.t === "links") x.acts.forEach((a) => add(a.label, a.href, x.at));
        if (x.t === "products") x.products.forEach((p) => p.url && add(p.name, p.url, x.at));
        if (x.t === "msg") (String(x.text).match(URL_RE) || []).forEach((u) => add("", u, x.at));
      }));
      if (!links.length) { box.append(libEmpty("Links you share and links Ervo sends show up here.")); return; }
      const card = document.createElement("div");
      card.className = "card list";
      links.sort((a, b) => new Date(b.at) - new Date(a.at)).forEach((l) => {
        let host = l.href;
        try { host = new URL(l.href).hostname.replace(/^www\./, ""); } catch (e) { /* keep it whole */ }
        card.append(row("open", l.title || host, l.title ? host : l.href, when(l.at), l.href));
      });
      box.append(card);
      return;
    }
    // Chats: the main chat and your side chats
    const card = document.createElement("div");
    card.className = "card list";
    chats.forEach((c) => {
      const msgs = c.items.filter((x) => x.t === "msg");
      const last = msgs[msgs.length - 1];
      const r = row("chat", c.main ? "Main chat" : c.title || "Side chat", last ? String(last.text).slice(0, 60) : "No messages yet", when(c.updated || (c.items[c.items.length - 1] || {}).at || c.started));
      r.classList.add("tap");
      r.addEventListener("click", () => switchChat(c.main ? "main" : c.id));
      card.append(r);
    });
    if (!card.children.length) { box.append(libEmpty("Your main chat and side chats show up here.")); return; }
    box.append(card);
    const nb = document.createElement("button");
    nb.type = "button";
    nb.className = "pill lib-new";
    nb.textContent = "New side chat";
    nb.addEventListener("click", () => newSideChat());
    box.append(nb);
  }
  function libEmpty(text) { const c = document.createElement("div"); c.className = "card list"; c.append(empty(text)); return c; }
  function viewPhoto(src) {
    const w = document.createElement("div");
    w.className = "photo-view";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Photo";
    // The standard Close button, so it's clear how to get out (Apple: going full screen)
    const x = document.createElement("button");
    x.type = "button";
    x.className = "photo-x";
    x.setAttribute("aria-label", "Close");
    x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    w.setAttribute("role", "dialog");
    w.setAttribute("aria-label", "Photo");
    w.append(img, x);
    w.addEventListener("click", () => w.remove());
    setTimeout(() => x.focus(), 50);
    document.body.append(w);
  }
  document.querySelectorAll("#lib-tabs button").forEach((b) => b.addEventListener("click", () => { libTab = b.dataset.tab; renderLibrary(); }));
  $("library-back").addEventListener("click", () => show("chat"));

  // ---------- voice: glowing edges, a small owl and an "Ask Ervo" bar ----------
  // In the app it sits over the chat. As a pop-up ("Hey Ervo" or the assistant button) it sits
  // over whatever app is open, and Ervo's answers show right above the bar.
  const voice = $("voice");
  const voiceInput = $("voice-text");
  let recognizer = null;
  let heard = "";
  let listening = false;

  function openVoice() {
    stopSpeaking();
    voice.hidden = false;
    voice.classList.remove("thinking");
    $("voice-owl").src = PLAN[(account || { plan: "personal" }).plan].avatar;
  }
  function setListening(on) {
    listening = on;
    voice.classList.toggle("listening", on);
    $("voice-done").setAttribute("aria-label", on ? "Done talking" : "Talk");
    if (on) { heard = ""; voiceInput.value = ""; $("voice-status").textContent = "Listening…"; voiceInput.placeholder = "Ask Ervo"; }
  }
  function closeVoice() {
    setListening(false);
    if (recognizer) { try { recognizer.abort(); } catch (e) { /* ignore */ } recognizer = null; }
    if (OVERLAY) { if (native && native.closeOverlay) native.closeOverlay(); return; }
    voice.hidden = true;
  }
  // Something was said (or typed in the bar): send it to Ervo
  function finishVoice(text) {
    setListening(false);
    const said = (text || "").trim();
    if (!said) {
      $("voice-status").textContent = "I didn't catch that. Tap the mic or type.";
      return;
    }
    voiceInput.value = "";
    voice.classList.add("thinking");
    $("voice-status").textContent = "On it…";
    if (OVERLAY) { send(said, true); return; }
    setTimeout(() => { voice.hidden = true; voice.classList.remove("thinking"); send(said, true); }, 350);
  }

  // Android: the phone's speech recognizer; words show up in the bar as you talk
  window.ervoVoiceResult = (text) => finishVoice(text);
  window.ervoVoicePartial = (text) => { if (!voice.hidden && listening && text) { heard = text; voiceInput.value = text; } };
  window.ervoVoiceError = (msg) => {
    if (voice.hidden) return;
    setListening(false);
    $("voice-status").textContent = msg || "Voice isn't available. Type instead.";
  };

  $("mic-btn").addEventListener("click", () => startVoice());
  function startVoice() {
    openVoice();
    setListening(true);
    if (native && native.startListening) {
      native.startListening();
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { window.ervoVoiceError("This device doesn't support voice. Type in the bar instead."); return; }
    recognizer = new SR();
    recognizer.lang = navigator.language || "en-US";
    recognizer.interimResults = true;
    recognizer.continuous = false; // stops on its own when you finish your sentence
    recognizer.onresult = (e) => {
      heard = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      voiceInput.value = heard;
    };
    recognizer.onerror = (e) => {
      if (e.error === "no-speech") return;
      window.ervoVoiceError(e.error === "not-allowed" ? "Ervo needs microphone access to hear you." : "Something went wrong. Try again.");
    };
    recognizer.onend = () => { recognizer = null; if (!voice.hidden && listening) finishVoice(heard); };
    recognizer.start();
  }
  // Mic button: stop and send while listening; listen again when not
  $("voice-done").addEventListener("click", () => {
    if (!listening) { startVoice(); return; }
    if (recognizer) recognizer.stop(); // onend sends what was heard
    else if (native && native.stopListening) native.stopListening();
  });
  $("voice-cancel").addEventListener("click", () => {
    if (listening) { if (native && native.cancelListening) native.cancelListening(); else if (native && native.stopListening) native.stopListening(); }
    closeVoice();
  });
  // Typing in the "Ask Ervo" bar works too
  $("voice-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (listening && native && native.cancelListening) native.cancelListening();
    if (recognizer) { try { recognizer.abort(); } catch (err) { /* ignore */ } recognizer = null; }
    finishVoice(voiceInput.value);
  });
  voiceInput.addEventListener("focus", () => {
    if (!listening) return;
    if (native && native.cancelListening) native.cancelListening();
    if (recognizer) { try { recognizer.abort(); } catch (err) { /* ignore */ } recognizer = null; }
    setListening(false);
    $("voice-status").textContent = "Type your question";
  });
  // Pop-up: tapping the see-through part closes it
  voice.addEventListener("click", (e) => { if (OVERLAY && e.target === voice) closeVoice(); });
  thread.addEventListener("click", (e) => { if (OVERLAY && e.target === thread) closeVoice(); });

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
  $("open-wake").addEventListener("click", () => { toggleMenu(false); heyErvo(); });
  $("open-chats").addEventListener("click", openChats);
  $("open-ideas").addEventListener("click", openIdeas);
  $("open-psyche").addEventListener("click", openPsyche);
  $("chats-panel").addEventListener("click", (e) => { if (e.target === $("chats-panel")) closeChats(); });
  $("chats-btn").addEventListener("click", openChats);
  $("psyche-back").addEventListener("click", () => show("chat"));
  $("ideas-back").addEventListener("click", () => show("chat"));
  $("ideas-refresh").addEventListener("click", () => renderIdeas(true));
  $("psyche-tell").addEventListener("click", () => { show("chat"); setTimeout(() => $("message").focus(), 100); });
  $("open-library").addEventListener("click", () => openLibrary());
  // Signing out clears everything on this phone, so ask first (Apple: confirm destructive actions)
  $("sign-out").addEventListener("click", () => {
    toggleMenu(false);
    $("confirm").hidden = false;
    setTimeout(() => $("confirm-cancel").focus(), 50);
  });
  $("confirm-cancel").addEventListener("click", () => { $("confirm").hidden = true; });
  $("confirm-ok").addEventListener("click", () => {
    $("confirm").hidden = true;
    buzz("reject");
    if (realAuth && session()) freshToken().then((t) => t && auth("logout", null, "POST", t)).catch(() => { /* signed out on this phone anyway */ });
    [ACCOUNT_KEY, PREFS_KEY, CONN_KEY, ACTIVITY_KEY, PLACE_KEY, SESSION_KEY, "ervo-memory", CHAT_KEY, ARCHIVE_KEY, SIDES_KEY, ACTIVE_KEY, GREETED_KEY, PSYCHE_KEY, IDEAS_KEY].forEach(drop);
    account = null;
    ["contact", "code", "name"].forEach((id) => { $(id).value = ""; });
    setPlan("personal");
    step("contact");
    show("welcome");
  });

  // Android back button: close whatever is open first, then go back to the chat
  window.ervoBack = function () {
    if (OVERLAY) { closeVoice(); return true; }
    if (document.querySelector(".msg-menu")) { closeMsgMenu(); return true; }
    if (!$("confirm").hidden) { $("confirm").hidden = true; return true; }
    if (!$("perm").hidden) { answerPermission(false); return true; }
    if (!$("update").hidden) { $("update").hidden = true; return true; }
    if (!$("greet").hidden) { $("greet").hidden = true; return true; }
    if (!voice.hidden) { $("voice-cancel").click(); return true; }
    if (!menu.hidden) { toggleMenu(false); return true; }
    if ($("activity").classList.contains("active")) { renderStats(); show("stats"); return true; }
    if ($("stats").classList.contains("active")) { show("chat"); return true; }
    if (!$("chats-panel").hidden && !docked()) { closeChats(); return true; }
    if ($("psyche").classList.contains("active") || $("ideas").classList.contains("active")) { show("chat"); return true; }
    if (document.querySelector(".photo-view")) { document.querySelector(".photo-view").remove(); return true; }
    if (!$("calpick").hidden) { answerCalendar(null); return true; }
    if ($("library").classList.contains("active")) { show("chat"); return true; }
    if (!$("attach-sheet").hidden) { closeAttach(); return true; }
    if (!$("link-row").hidden) { $("link-row").hidden = true; return true; }
    const active = document.querySelector(".step.active");
    if ($("welcome").classList.contains("active") && active && active.dataset.step !== "contact") {
      step(active.dataset.step === "name" ? "code" : "contact");
      return true;
    }
    return false;
  };

  // ---------- small notices ("Copied") ----------
  // One line, gone after a couple of seconds; only for minor things (Samsung toasts)
  let toastTimer = 0;
  function toast(text) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
    t.textContent = text;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), 2200);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const a = document.createElement("textarea");
      a.value = text; a.setAttribute("readonly", ""); a.style.cssText = "position:fixed;opacity:0";
      document.body.append(a); a.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { /* not allowed */ }
      a.remove(); return ok;
    }
  }

  // ---------- touch and hold one of Ervo's replies: Copy, Ask again ----------
  // (Apple: let people copy and retry AI results; One UI: touch and hold opens a menu)
  function closeMsgMenu() {
    const m = document.querySelector(".msg-menu");
    if (m) m.remove();
    $("chat").classList.remove("ctx");
    thread.querySelectorAll(".msg.held").forEach((x) => x.classList.remove("held"));
  }
  function msgMenu(el) {
    closeMsgMenu();
    buzz("long");
    el.classList.add("held");
    $("chat").classList.add("ctx"); // the rest of the chat blurs behind the menu (Apple context menus)
    const menu = document.createElement("div");
    menu.className = "msg-menu";
    menu.setAttribute("role", "menu");
    const item = (label, icon, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.innerHTML = icon;
      b.append(label);
      b.addEventListener("click", () => { closeMsgMenu(); fn(); });
      menu.append(b);
    };
    item("Copy", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
      () => copyText(el.innerText).then((ok) => toast(ok ? "Copied" : "Couldn't copy that. Try again.")));
    // The question this reply answered
    let q = el.previousElementSibling;
    while (q && !(q.classList.contains("msg") && q.classList.contains("me") && !q.classList.contains("photo") && !q.classList.contains("link"))) q = q.previousElementSibling;
    if (q && account) {
      const tag = q.querySelector(".voice-tag");
      const asked = (tag ? q.innerText.replace(tag.innerText, "") : q.innerText).trim();
      if (asked) item("Ask again", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>', () => send(asked));
    }
    document.body.append(menu);
    const r = el.getBoundingClientRect();
    const mh = menu.offsetHeight, mw = menu.offsetWidth;
    const below = r.bottom + 8 + mh < window.innerHeight - 90;
    menu.style.top = Math.max(60, below ? r.bottom + 8 : r.top - mh - 8) + "px";
    menu.style.left = Math.min(Math.max(12, r.left), window.innerWidth - mw - 12) + "px";
  }
  {
    let holdTimer = 0, startX = 0, startY = 0;
    const cancel = () => clearTimeout(holdTimer);
    thread.addEventListener("pointerdown", (e) => {
      const el = e.target.closest(".msg.them");
      if (!el || e.target.closest("a")) return;
      startX = e.clientX; startY = e.clientY;
      cancel();
      holdTimer = setTimeout(() => msgMenu(el), 480);
    });
    thread.addEventListener("pointermove", (e) => { if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) cancel(); });
    ["pointerup", "pointercancel"].forEach((n) => thread.addEventListener(n, cancel));
    // Right-click or a keyboard's menu key does the same
    thread.addEventListener("contextmenu", (e) => { const el = e.target.closest(".msg.them"); if (el) { e.preventDefault(); cancel(); msgMenu(el); } });
    document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".msg-menu")) closeMsgMenu(); }, true);
    thread.addEventListener("scroll", () => { cancel(); closeMsgMenu(); }, { passive: true });
  }

  // ---------- sheets: a grabber, swipe down or tap outside to close (Apple sheets) ----------
  const SHEET_CLOSE = { perm: "perm-deny", calpick: "cal-cancel", update: "update-later", greet: "greet-cancel", confirm: "confirm-cancel" };
  document.querySelectorAll(".sheet-wrap").forEach((wrap) => {
    const sheet = wrap.querySelector(".sheet");
    const close = () => { const b = $(SHEET_CLOSE[wrap.id]); if (b && !b.disabled) b.click(); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    let y0 = null, dy = 0;
    sheet.addEventListener("touchstart", (e) => {
      // Only when the sheet is scrolled to the top, and not while typing
      if (sheet.scrollTop > 0 || e.target.closest("input, select, textarea")) { y0 = null; return; }
      y0 = e.touches[0].clientY; dy = 0;
    }, { passive: true });
    sheet.addEventListener("touchmove", (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      sheet.style.transition = "none";
      sheet.style.transform = dy ? `translateY(${dy}px)` : "";
    }, { passive: true });
    sheet.addEventListener("touchend", () => {
      if (y0 === null) return;
      y0 = null;
      sheet.style.transition = "";
      sheet.style.transform = "";
      if (dy > Math.min(140, sheet.offsetHeight * 0.3)) close();
    });
  });

  // ---------- iPhone: swipe in from the left edge to go back ----------
  // (Android has its own back gesture, so this is for the home-screen iPhone app only)
  if (IOS && !native) {
    let sx = null, sy = 0;
    document.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      sx = t.clientX < 24 && !$("chat").classList.contains("active") ? t.clientX : null;
      sy = t.clientY;
    }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (sx === null) return;
      const t = e.changedTouches[0];
      if (t.clientX - sx > 70 && Math.abs(t.clientY - sy) < 60 && window.ervoBack) window.ervoBack();
      sx = null;
    }, { passive: true });
  }

  // ---------- large titles (Apple): the big title scrolls away and a small one fades into the bar ----------
  function syncTitle(screen) {
    const body = screen.querySelector(".stats-body");
    const h1 = screen.querySelector(".stats-body h1");
    const head = screen.querySelector(".stats-header");
    if (!body || !h1 || !head) return;
    head.querySelector(".nav-title").textContent = h1.textContent;
    head.classList.toggle("scrolled", body.scrollTop > h1.offsetTop + h1.offsetHeight - head.offsetHeight);
    head.classList.toggle("edge", body.scrollTop > 4);
  }
  document.querySelectorAll(".screen.stats").forEach((s) => {
    const body = s.querySelector(".stats-body");
    if (body) body.addEventListener("scroll", () => syncTitle(s), { passive: true });
  });

  // ---------- keyboard: Escape closes whatever is open, like the back button ----------
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (window.ervoBack && window.ervoBack()) e.preventDefault();
  });

  // ---------- app shortcuts: touch and hold Ervo's icon (Android) ----------
  function ervoShortcut(what) {
    if (!account) return;
    if (what === "talk") startVoice();
    else if (what === "side") { show("chat"); newSideChat(); }
    else if (what === "ideas") openIdeas();
    else if (what === "psyche") openPsyche();
  }
  window.ervoShortcut = ervoShortcut;

  // ---------- offline support for the home-screen (iPhone) version ----------
  // The Android app bundles its files already, so it doesn't need this.
  if ("serviceWorker" in navigator && !native && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* still works online */ });
  }

  // ---------- start: always opens straight to the chat ----------
  applyTheme(system.matches ? "dark" : "light");
  setPlan("personal");
  // Opens straight to where you were, with no logo screen to wait through (Apple: launch fast,
  // and make the first frame look like the first screen)
  root.classList.add("first"); // the first screen appears without fading in
  setTimeout(() => root.classList.remove("first"), 600);
  {
    const saved = load(ACCOUNT_KEY);
    if (saved && saved.plan && saved.name) openChat(saved, false);
    else if (OVERLAY && native && native.openFullApp) native.openFullApp(); // sign in first, in the full app
    else show("welcome");
  }
  setTimeout(() => checkForUpdate(false), 3000);
  // iPhone / web: check again when Ervo comes back to the screen
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !native) checkForUpdate(false); });
  // Opened by "Hey Ervo" or the assistant button
  setTimeout(() => {
    const w = native && native.takeWake ? native.takeWake() : "";
    if (w) { try { handleWake(JSON.parse(w)); } catch (e) { /* ignore */ } }
    else if (OVERLAY && account) startVoice();
    else if (native && native.takeShortcut) { const s = native.takeShortcut(); if (s) ervoShortcut(s); }
  }, OVERLAY ? 150 : 400);
})();
