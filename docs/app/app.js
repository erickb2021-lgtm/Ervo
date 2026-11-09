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
  // Testing on this computer: ?ai=http://localhost:8787 talks to a server running here (wrangler dev)
  const AI_URL = ((/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get("ai")) || (window.ERVO_CONFIG || {}).aiUrl || "").replace(/\/+$/, "");
  const native = window.ErvoNative || null;
  // Pop-up mode: "Hey Ervo" or the assistant button, drawn over other apps (Android)
  const OVERLAY = /[?&]overlay=1\b/.test(location.search);
  if (OVERLAY) document.documentElement.classList.add("overlay");
  const $ = (id) => document.getElementById(id);

  // ---------- storage ----------
  // One email can have both an Ervo Personal and an Ervo for Business. They keep separate chats, Psyche,
  // activity, settings, usage and team data: Business is stored under a "biz:" prefix. A few things are
  // shared by both (the sign-in itself, the list of profiles, the theme, update checks, your city).
  const PROFILES_KEY = "ervo-profiles";
  const ICON_PROFILE_KEY = "ervo-icon-profile"; // "personal" or "business": whose look is the home-screen icon
  const KEEP_KEY = "ervo-keep"; // stay signed in (default on)
  const BIO_KEY = "ervo-bio"; // unlock with fingerprint or face
  const LEFT_KEY = "ervo-left"; // the app was put away while "keep me logged in" was off
  const DEVICE_KEY = "ervo-device";
  const TEST_PLAN_KEY = "ervo-test-plan"; // the owner trying a plan out (free, plus, pro)
  const OWNER_KEY = "ervo-owner"; // the server said this account is the owner
  const SHARED_KEYS = new Set([ACCOUNT_KEY, PROFILES_KEY, ICON_PROFILE_KEY, KEEP_KEY, BIO_KEY, LEFT_KEY, DEVICE_KEY, TEST_PLAN_KEY, OWNER_KEY, "ervo-session", THEME_KEY, PLACE_KEY, "ervo-seen-version", "ervo-intro", "ervo-update-checked", "ervo-cal-reset-027"]);
  // Business data lives per company: "biz:<companyId>:", or "biz:" before a company is set up
  const nsFor = (plan, companyId) => (plan === "business" ? (companyId ? `biz:${companyId}:` : "biz:") : "");
  let NS = (() => { try { const a = JSON.parse(localStorage.getItem(ACCOUNT_KEY)); return a ? nsFor(a.plan, a.team && a.team.companyId) : ""; } catch (e) { return ""; } })();
  const setNS = (plan, companyId) => { NS = nsFor(plan, companyId); };
  // Chats and Psyche saved before companies had their own space move into the first company once
  function migrateLegacyBiz(companyId) {
    try {
      if (!companyId || localStorage.getItem(`biz:${companyId}:${PREFS_KEY}`) !== null || localStorage.getItem(`biz:${CHAT_KEY}`) === null) return;
      const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("biz:") && !/^biz:[a-z0-9]{6,}:/.test(k)) keys.push(k); }
      keys.forEach((k) => { localStorage.setItem(`biz:${companyId}:${k.slice(4)}`, localStorage.getItem(k)); localStorage.removeItem(k); });
    } catch (e) { /* fine */ }
  }
  const nsKey = (k) => (NS && !SHARED_KEYS.has(k) ? NS + k : k);
  const load = (k) => { try { return JSON.parse(localStorage.getItem(nsKey(k))); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(nsKey(k), JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const drop = (k) => { try { localStorage.removeItem(nsKey(k)); } catch (e) { /* ignore */ } };
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
  const DEPTH = { splash: 0, welcome: 0, lock: 0, chat: 0, ideas: 0, goalpage: 0, team: 0, library: 0, settings: 1, stats: 2, psyche: 2, teamchat: 2, appsPage: 2, bizpage: 2, activity: 3 };
  // The four tabs at the bottom, and which screen each one shows (Business owners get Team where Goals is)
  const TAB_OF = { chat: "tab-chat", ideas: "open-ideas", goalpage: "tab-goals", team: "tab-goals", library: "open-library" };
  // Back goes to where you came from: Settings when you opened it there, else the chat
  const openedFrom = {};
  const backTo = (id) => (openedFrom[id] === "settings" ? "settings" : "chat");
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
    if (from && from !== to) openedFrom[id] = from.id;
    $("tabbar").hidden = !TAB_OF[id];
    document.body.classList.toggle("tabs-on", !!TAB_OF[id]);
    document.querySelectorAll("#tabbar button").forEach((b) => { if (TAB_OF[id] === b.id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
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
      apps: ["phonecal", "calendar", "contacts", "clock", "meet", "zoom", "teams", "amazon", "orders", "health", "location"],
    },
    business: {
      label: "Business", avatar: "img/ervo-business.png",
      hint: "Business use only: customer support, refunds by your policy, scheduling and more.",
      question: "What's your name?", nameLabel: "Your name", placeholder: "Alex", nameError: "Enter your name.",
      chips: ["Refund order #5512", "Summarize today's tickets", "Call with Northwind Thursday at 2pm", "Draft a reply to an upset customer"],
      apps: ["phonecal", "calendar", "contacts", "clock", "meet", "zoom", "teams", "mail", "orders", "location"],
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
    if (name === "team" || name === "name") syncCancel(); // a way back when this is a switch, not a first sign-in
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
  const PREVIEW_HERE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]preview=1\b/.test(location.search);
  const realAuth = !!(SB_URL && SB_KEY) && !PREVIEW_HERE;

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
    const demoEl = document.querySelector(".demo"); if (demoEl) demoEl.textContent = "Check your inbox (and spam folder) for a code from Ervo.";
  }

  // After signing in: open the Ervo they picked, or ask for a name if this email hasn't set it up yet
  function afterSignIn(j, email) {
    save(SESSION_KEY, { access_token: j.access_token, refresh_token: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 });
    userMeta = (j.user && j.user.user_metadata) || {};
    contact = email || (j.user && j.user.email) || "";
    drop(LEFT_KEY);
    const prof = (userMeta.profiles && userMeta.profiles[plan]) || (userMeta.plan === plan && userMeta.name ? { name: userMeta.name } : null);
    if (prof && prof.name) {
      const acc = { plan, name: prof.name, contact, id: j.user && j.user.id, createdAt: j.user && j.user.created_at };
      setNS(plan);
      save(ACCOUNT_KEY, acc);
      openChat(acc, false);
      return;
    }
    step("name");
  }
  let wrongTries = 0;
  let lockedAcc = null; // the account waiting behind the fingerprint lock
  let bioArming = false; // turning fingerprint unlock on: waiting for the phone's confirmation
  const mark = (ids, bad) => ids.forEach((id) => $(id).classList.toggle("bad", bad));
  document.querySelectorAll(".pw-eye").forEach((b) => b.addEventListener("click", () => { const i = $(b.dataset.eye); i.type = i.type === "password" ? "text" : "password"; b.setAttribute("aria-label", i.type === "password" ? "Show password" : "Hide password"); }));
  document.querySelector('[data-step="contact"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("contact").value.trim();
    const pw = $("password").value;
    if (!v) { $("contact-error").textContent = "Enter your email."; return; }
    if (!isEmail(v)) { $("contact-error").textContent = "That doesn't look like an email. Try again."; return; }
    if (!realAuth) { contact = v; step("name"); return; } // preview: no password needed
    if (!pw) { $("contact-error").textContent = "Enter your password."; mark(["password"], true); return; }
    const btn = e.submitter || document.querySelector('[data-step="contact"] .btn');
    btn.disabled = true;
    try {
      const j = await auth("token?grant_type=password", { email: v, password: pw });
      btn.disabled = false;
      wrongTries = 0;
      mark(["password"], false);
      afterSignIn(j, v);
    } catch (err) {
      btn.disabled = false;
      if (err.status === 400 || /invalid/i.test(err.message)) {
        wrongTries += 1;
        mark(["password"], true);
        $("contact-error").textContent = wrongTries >= 3
          ? "Three tries. Tap Forgot password and Ervo will email you a link to set a new one."
          : `That password doesn't match this email${wrongTries === 2 ? " (one more try before I suggest a reset)" : ""}. New here? Tap Sign up.`;
        $("go-forgot").classList.toggle("attention", wrongTries >= 3);
      } else $("contact-error").textContent = friendlyAuthError(err);
    }
  });
  $("go-signup").addEventListener("click", () => { $("su-email").value = $("contact").value.trim(); $("su-error").textContent = ""; step("signup"); });
  $("go-forgot").addEventListener("click", () => { $("fg-email").value = $("contact").value.trim(); $("fg-error").textContent = ""; step("forgot"); });
  $("su-back").addEventListener("click", () => step("contact"));
  $("fg-back").addEventListener("click", () => step("contact"));
  clearOnType($("password"), "contact-error");
  ["su-email", "su-pass", "su-pass2"].forEach((id) => clearOnType($(id), "su-error"));
  clearOnType($("fg-email"), "fg-error");
  ["rs-pass", "rs-pass2"].forEach((id) => clearOnType($(id), "rs-error"));
  const passwordsOk = (a, b, errId, ids) => {
    if (a.length < 8) { $(errId).textContent = "Use at least 8 characters."; mark([ids[0]], true); return false; }
    if (a !== b) { $(errId).textContent = "Passwords don't match."; mark(ids, true); return false; }
    mark(ids, false);
    return true;
  };
  // Sign up: email, password, confirm
  document.querySelector('[data-step="signup"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("su-email").value.trim(), pw = $("su-pass").value, pw2 = $("su-pass2").value;
    if (!isEmail(v)) { $("su-error").textContent = "Enter your email."; mark(["su-email"], true); return; }
    mark(["su-email"], false);
    if (!passwordsOk(pw, pw2, "su-error", ["su-pass", "su-pass2"])) return;
    if (!realAuth) { contact = v; step("name"); return; }
    const btn = e.submitter || document.querySelector('[data-step="signup"] .btn');
    btn.disabled = true;
    try {
      const j = await auth("signup", { email: v, password: pw, data: { plan } });
      btn.disabled = false;
      if (j.access_token) afterSignIn(j, v);
      else { $("su-error").textContent = "Account created. Check your email to confirm it, then sign in."; step("contact"); $("contact").value = v; }
    } catch (err) {
      btn.disabled = false;
      $("su-error").textContent = /registered|exists|already/i.test(err.message) ? "This email already has an Ervo account. Sign in, or use Forgot password." : friendlyAuthError(err);
    }
  });
  // Forgot: a reset link by email that opens Ervo on the new-password page
  document.querySelector('[data-step="forgot"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("fg-email").value.trim();
    if (!isEmail(v)) { $("fg-error").textContent = "Enter your email."; return; }
    if (!realAuth) { $("fg-error").textContent = "Preview mode: nothing is sent."; return; }
    const btn = e.submitter || document.querySelector('[data-step="forgot"] .btn');
    btn.disabled = true;
    try {
      await auth(`recover?redirect_to=${encodeURIComponent("https://ervo.company/app/")}`, { email: v });
      $("fg-error").textContent = "";
      $("contact-error").textContent = `Check ${v} for a link from Ervo. Open it on this phone to set your new password.`;
      $("contact").value = v;
      step("contact");
    } catch (err) { $("fg-error").textContent = friendlyAuthError(err); }
    btn.disabled = false;
  });
  // New password, from the email link (the link carries a short-lived sign-in in the URL)
  document.querySelector('[data-step="reset"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("rs-pass").value, pw2 = $("rs-pass2").value;
    if (!passwordsOk(pw, pw2, "rs-error", ["rs-pass", "rs-pass2"])) return;
    const btn = e.submitter || document.querySelector('[data-step="reset"] .btn');
    btn.disabled = true;
    try {
      const token = await freshToken();
      const u = await auth("user", { password: pw }, "PUT", token);
      btn.disabled = false;
      $("rs-pass").value = ""; $("rs-pass2").value = "";
      toast("New password saved");
      const s = session();
      afterSignIn({ access_token: s.access_token, refresh_token: s.refresh_token, expires_in: Math.max(60, Math.round((s.expiresAt - Date.now()) / 1000)), user: u }, u.email);
    } catch (err) { btn.disabled = false; $("rs-error").textContent = friendlyAuthError(err); }
  });
  // The email link lands here with #access_token=...&type=recovery. When it opened in the phone's
  // browser instead of the Ervo app, the page offers to hand the sign-in to the app (#recover=<token>).
  function takeRecoveryHash() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    const handoff = h.get("recover");
    if (!handoff && (h.get("type") !== "recovery" || !h.get("access_token"))) return false;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* fine */ }
    show("welcome");
    step("reset");
    $("rs-error").textContent = "";
    $("rs-open-app").hidden = true;
    if (handoff) {
      // The app got a refresh token from the website's button: trade it for a sign-in
      $("rs-email").textContent = "your account";
      auth("token?grant_type=refresh_token", { refresh_token: handoff }).then((j) => {
        save(SESSION_KEY, { access_token: j.access_token, refresh_token: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 });
        $("rs-email").textContent = (j.user && j.user.email) || "your account";
      }).catch(() => { $("rs-error").textContent = "That link was already used or has expired. Tap Forgot password to get a new one."; });
      return true;
    }
    save(SESSION_KEY, { access_token: h.get("access_token"), refresh_token: h.get("refresh_token") || "", expiresAt: Date.now() + (Number(h.get("expires_in")) || 3600) * 1000 });
    auth("user", null, "GET", h.get("access_token")).then((u) => { $("rs-email").textContent = u.email || ""; }).catch(() => {});
    // In Android's browser (not inside Ervo): one tap opens the installed app on this same page
    if (!native && /Android/i.test(navigator.userAgent) && h.get("refresh_token")) {
      $("rs-open-app").hidden = false;
      $("rs-open-app").onclick = () => {
        location.href = `intent://ervo.company/app/?recover=${encodeURIComponent(h.get("refresh_token"))}#Intent;scheme=https;package=app.ervo;S.browser_fallback_url=${encodeURIComponent("https://ervo.company/app/")};end`;
      };
    }
    return true;
  }
  window.ervoHash = () => { takeRecoveryHash(); };

  $("code").addEventListener("input", () => { $("code").value = $("code").value.replace(/\D/g, "").slice(0, 8); });
  document.querySelector('[data-step="code"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!/^\d{6,8}$/.test($("code").value)) { $("code-error").textContent = "Enter the whole code from the email."; return; }
    if (realAuth) {
      let j;
      try { j = await auth("verify", { type: "email", email: contact, token: $("code").value }); } catch (err) { $("code-error").textContent = friendlyAuthError(err); return; }
      save(SESSION_KEY, { access_token: j.access_token, refresh_token: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000 });
      // Coming back? This email may already have the Ervo they picked (Personal or Business); open that one
      userMeta = (j.user && j.user.user_metadata) || {};
      const prof = (userMeta.profiles && userMeta.profiles[plan]) || (userMeta.plan === plan && userMeta.name ? { name: userMeta.name } : null);
      if (prof && prof.name) {
        const acc = { plan, name: prof.name, contact, id: j.user.id, createdAt: j.user.created_at };
        setNS(plan);
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
        const profiles = Object.assign({}, userMeta.profiles || {}, { [plan]: { name: v } });
        const u = await auth("user", { data: { name: v, plan, profiles } }, "PUT", await freshToken());
        acc.id = u.id;
        userMeta = (u && u.user_metadata) || Object.assign({}, userMeta, { profiles });
      } catch (err) { $("name-error").textContent = friendlyAuthError(err); return; }
    }
    setNS(plan);
    if (plan === "business" && realAuth) { pendingAcc = acc; setTeamRole("owner"); step("team"); return; }
    save(ACCOUNT_KEY, acc);
    if (switching) { switching = false; curtain(acc.plan, () => switchInto(acc, true)); return; }
    openChat(acc, true);
  });
  let userMeta = {};

  // ---------- one email, two Ervos: switching between Personal and Business ----------
  let switching = false;
  // The curtain: "Switching to Business" with that Ervo's look, quick, then the app reloads behind it
  function curtain(to, then) {
    const c = $("switching");
    $("switching-owl").src = lookFile(lookOf(to)) || PLAN[to].avatar;
    $("switching-text").textContent = `Switching to ${to === "business" ? "Business" : "Personal"}`;
    c.classList.remove("out");
    c.hidden = false;
    setTimeout(then, 420);
  }
  // Moves the app into the other Ervo without reloading: storage switches namespace, memory is reset,
  // the chat reopens, and the curtain lifts once it's drawn
  function switchInto(acc, fresh) {
    setNS(acc.plan, acc.team && acc.team.companyId);
    save(ACCOUNT_KEY, acc);
    hideTyping();
    task = null; confirming = false; pending = null; history = []; lastErvoText = "";
    $("chips").innerHTML = "";
    try { closeChats(); } catch (e) { /* drawer wasn't open */ }
    calCache = {};
    teamChatMember = null;
    stopInbox();
    openChat(acc, !!fresh);
    const c = $("switching");
    setTimeout(() => { c.classList.add("out"); setTimeout(() => { c.hidden = true; c.classList.remove("out"); }, 320); }, 520);
  }
  // After the reload: keep the curtain up for a beat, then lift it
  (function liftCurtain() {
    let to = null;
    try { to = sessionStorage.getItem("ervo-switching"); sessionStorage.removeItem("ervo-switching"); } catch (e) { /* fine */ }
    if (!to) return;
    const c = $("switching");
    // This runs before the looks code exists, so read the saved look straight from storage
    let look = "";
    try { look = (JSON.parse(localStorage.getItem(`${to === "business" ? "biz:" : ""}${PREFS_KEY}`) || "{}").look || ""); } catch (e) { /* none */ }
    $("switching-owl").src = /^[a-z]{2,24}$/.test(look) ? `img/ervo-${look}.png` : (PLAN[to] ? PLAN[to].avatar : "img/ervo-classic.png");
    $("switching-text").textContent = `Switching to ${to === "business" ? "Business" : "Personal"}`;
    c.hidden = false;
    setTimeout(() => { c.classList.add("out"); setTimeout(() => { c.hidden = true; }, 320); }, 380);
  })();
  function switchProfile() {
    toggleMenu(false);
    const to = account.plan === "business" ? "personal" : "business";
    const prof = load(PROFILES_KEY) || {};
    prof[account.plan] = Object.assign({}, prof[account.plan] || {}, { plan: account.plan, name: account.name, contact: account.contact, id: account.id, createdAt: account.createdAt, team: account.team || null });
    save(PROFILES_KEY, prof);
    const other = prof[to] || ((userMeta.profiles && userMeta.profiles[to]) ? { plan: to, name: userMeta.profiles[to].name, contact: account.contact, id: account.id } : null);
    if (other && other.name) {
      if (to === "business" && other.team && other.team.companyId) migrateLegacyBiz(other.team.companyId);
      curtain(to, () => switchInto(other, false)); // one curtain, no reload
      return;
    }
    if (!realAuth || !session()) { ervoSays(`To add Ervo ${to === "business" ? "for Business" : "Personal"} to this email, sign out and sign in again choosing ${to === "business" ? "Business" : "Personal"}.`); return; }
    // Same sign-in, new profile: just the name (and for Business, the company)
    switching = true;
    contact = account.contact || "";
    setPlan(to);
    $("name").value = "";
    show("welcome");
    step("name");
  }
  // (the Switch row's click is wired in the menu block, once the Settings rows exist)

  // ---------- Business: run a company, or join one with an employee ID ----------
  let pendingAcc = null;
  let teamRole = "owner";
  function setTeamRole(r) {
    teamRole = r;
    document.querySelectorAll('input[name="teamrole"]').forEach((x) => { x.checked = x.value === r; });
    $("team-code").hidden = r !== "employee";
    $("team-names").hidden = r !== "owner";
    const a0 = pendingAcc || account || {};
    if (!$("team-first").value && a0.name) $("team-first").value = String(a0.name).split(" ")[0];
    $("team-hint").textContent = r === "owner"
      ? "You run the company. Your name and the company's location keep it apart from any other company with the same name. You'll create employee IDs so your team can join."
      : "Your company gave you an employee ID. Enter the company's name and location exactly as the owner set them, and the ID. Your chats with Ervo here are visible to the owner.";
    $("team-go").textContent = r === "owner" ? "Create my company" : "Join my company";
  }
  document.querySelectorAll('input[name="teamrole"]').forEach((x) => x.addEventListener("change", () => setTeamRole(x.value)));
  // Switching to Business (or adding a company) can be cancelled: back to the Ervo that was open,
  // or to the other profile on this sign-in. A first sign-in has nowhere to go back to, so no button.
  function backTarget() {
    if (account && (account.plan === "personal" || (account.team && account.team.companyId))) return account;
    const prof = load(PROFILES_KEY) || {};
    if (prof.personal && prof.personal.name) return prof.personal;
    if (userMeta && userMeta.profiles && userMeta.profiles.personal && userMeta.profiles.personal.name) return { plan: "personal", name: userMeta.profiles.personal.name, contact: contact || (account && account.contact) || "", id: account && account.id };
    return null;
  }
  function syncCancel() {
    const t = backTarget();
    ["team-cancel", "name-cancel"].forEach((id) => { const b = $(id); b.hidden = !t; if (t) b.textContent = `Back to Ervo ${t.plan === "business" ? "for Business" : "Personal"}`; });
  }
  function cancelSetup() {
    const t = backTarget();
    if (!t) return;
    switching = false;
    pendingAcc = null;
    $("team-error").textContent = ""; $("name-error").textContent = "";
    setPlan(t.plan);
    if (account && account.plan === t.plan && account.name === t.name) { setNS(t.plan, t.team && t.team.companyId); show("chat"); return; }
    curtain(t.plan, () => switchInto(t, false));
  }
  $("team-cancel").addEventListener("click", cancelSetup);
  $("name-cancel").addEventListener("click", cancelSetup);
  clearOnType($("team-company"), "team-error");
  clearOnType($("team-code"), "team-error");
  document.querySelector('[data-step="team"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const acc = pendingAcc || load(ACCOUNT_KEY);
    if (!acc) { step("contact"); return; }
    const company = $("team-company").value.trim();
    const location = $("team-location").value.trim();
    const first = $("team-first").value.trim(), last = $("team-last").value.trim();
    const code = $("team-code").value.trim().toUpperCase();
    if (company.length < 2) { $("team-error").textContent = "Enter the company's name."; return; }
    if (location.length < 2) { $("team-error").textContent = "Enter where the company is, like Austin, TX."; return; }
    if (teamRole === "owner" && (!first || !last)) { $("team-error").textContent = "Enter your first and last name."; return; }
    if (teamRole === "employee" && !/^ERVO(-[A-Z0-9]{4}){2,3}$/.test(code)) { $("team-error").textContent = "Enter the employee ID your company gave you, like ERVO-7F3K-92QX-4MNB."; return; }
    const btn = $("team-go");
    btn.disabled = true;
    try {
      const v = teamRole === "owner" ? await teamApi("company/create", { name: company, location, firstName: first, lastName: last }) : await teamApi("join", { company, location, code, name: acc.name });
      acc.team = teamFromView(v);
      if (teamRole === "owner") acc.name = first;
    } catch (err) {
      $("team-error").textContent = err.message || "Couldn't reach Ervo. Check your connection and try again.";
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
    pendingAcc = null;
    switching = false;
    curtain(acc.plan, () => switchInto(acc, true)); // the new company gets its own space
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
    if (item.kind !== "milestone") { const c = counts(); c.done += 1; save(COUNT_KEY, c); setTimeout(() => checkMilestones(false), 1800); }
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

  // Big emoji show as 3D pictures (Microsoft's Fluent emoji, MIT). Offline, the plain emoji shows instead.
  const E3D = {
    "☀️": "Sun", "☁️": "Cloud", "⛅": "Sun behind cloud", "⛈️": "Cloud with lightning and rain", "✅": "Check mark button", "✈️": "Airplane",
    "✏️": "Pencil", "🌙": "Crescent moon", "🌤️": "Sun behind small cloud", "🌦️": "Sun behind rain cloud", "🌧️": "Cloud with rain",
    "🌨️": "Cloud with snow", "🌫️": "Fog", "🍳": "Cooking", "🍽️": "Fork and knife with plate", "🎁": "Wrapped gift", "🎵": "Musical note",
    "💪": "Flexed biceps*", "💭": "Thought balloon", "📅": "Calendar", "📇": "Card index", "📍": "Round pushpin", "📷": "Camera",
    "🔍": "Magnifying glass tilted left", "🔎": "Magnifying glass tilted right", "🗑️": "Wastebasket", "🗓️": "Spiral calendar", "🛒": "Shopping cart",
    "🥗": "Green salad", "🧳": "Luggage", "⏰": "Alarm clock", "⏱️": "Stopwatch", "↩️": "Right arrow curving left", "🧠": "Brain",
    "💡": "Light bulb", "🎯": "Bullseye", "✨": "Sparkles", "🔒": "Locked", "🦉": "Owl", "⚠️": "Warning", "📝": "Memo", "⏳": "Hourglass not done",
    "🛍️": "Shopping bags", "🫀": "Anatomical heart", "✉️": "Envelope", "🔗": "Link", "📞": "Telephone receiver", "🎙️": "Studio microphone", "📊": "Bar chart",
    "💬": "Speech balloon", "🗺️": "World map", "❤️": "Red heart", "🏠": "House", "⚽": "Soccer ball", "📚": "Books", "🦷": "Tooth", "🩺": "Stethoscope",
    "💵": "Dollar banknote", "⭐": "Star", "🚗": "Automobile", "👥": "Busts in silhouette", "🏆": "Trophy", "🎉": "Party popper", "🔥": "Fire", "🌟": "Glowing star",
    "💯": "Hundred points", "💎": "Gem stone", "🚀": "Rocket", "🏅": "Sports medal", "☔": "Umbrella with rain drops", "❄️": "Snowflake", "🍂": "Fallen leaf",
    "📦": "Package", "🚚": "Delivery truck", "🧾": "Receipt", "🎯": "Bullseye", "🧶": "Yarn", "👗": "Dress", "👟": "Running shoe", "👔": "Necktie", "👚": "Womans clothes",
    "👕": "T-shirt", "👖": "Jeans", "🧘": "Person in lotus position*", "👜": "Handbag", "🍔": "Hamburger", "🍱": "Bento box", "🥡": "Takeout box", "🥕": "Carrot",
    "🛵": "Motor scooter", "🥦": "Broccoli", "🍕": "Pizza", "☕": "Hot beverage", "🌯": "Burrito", "🍟": "French fries", "🍗": "Poultry leg", "🥘": "Shallow pan of food",
    "💊": "Pill", "📱": "Mobile phone", "💄": "Lipstick", "🪑": "Chair", "🛋️": "Couch and lamp", "🐾": "Paw prints", "🔨": "Hammer", "🔧": "Wrench", "🏷️": "Label",
    "✂️": "Scissors", "🧹": "Broom", "🎬": "Clapper board", "🎂": "Birthday cake", "🔎": "Magnifying glass tilted right", "😎": "Smiling face with sunglasses",
  };
  function e3d(ch) {
    const key = String(ch || "").trim();
    const name = E3D[key] || E3D[key.replace(/\uFE0F/g, "")] || E3D[`${key}\uFE0F`];
    if (!name) return key;
    const skin = name.endsWith("*");
    const n = name.replace(/\*$/, "");
    const file = n.toLowerCase().replace(/ /g, "_");
    const src = `https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/${encodeURIComponent(n)}/${skin ? "Default/" : ""}3D/${file}_3d${skin ? "_default" : ""}.png`;
    return `<img class="e3d" src="${src}" alt="${key}" onerror="this.replaceWith(document.createTextNode(this.alt))">`;
  }
  const setIco = (el, ch) => { el.innerHTML = ch ? e3d(ch) : ""; };
  document.querySelectorAll(".intro-ico").forEach((el) => { el.innerHTML = e3d(el.textContent); });

  const ICON_3D = {
    calendar: "📅", shop: "🛍️", health: "🫀", location: "📍", mail: "✉️", done: "✅", food: "🍽️", undo: "↩️", open: "🔗", phone: "📞", clock: "⏰",
    mic: "🎙️", stats: "📊", chat: "💬", map: "🗺️", plane: "✈️", heart: "❤️", home: "🏠", ball: "⚽", book: "📚", tooth: "🦷", doctor: "🩺", money: "💵",
    star: "⭐", camera: "📷", music: "🎵", car: "🚗", sun: "☀️", people: "👥", brain: "🧠", look: "😎", gem: "💎",
  };
  // A row's icon: the 3D picture when we have one (and it loads), else the flat coloured square
  function setRowIcon(el, ico) {
    const i = el.classList && el.classList.contains("app-ico") ? el : el.querySelector(".app-ico");
    if (!i) return;
    i.innerHTML = ICON[ico] || ICON.done;
    i.classList.remove("e3dico");
    const html = ICON_3D[ico] ? e3d(ICON_3D[ico]) : "";
    if (!/^<img/.test(html)) return;
    const w = document.createElement("span");
    w.innerHTML = html;
    const img = w.firstChild;
    img.removeAttribute("onerror");
    img.onerror = () => { i.classList.remove("e3dico"); i.innerHTML = ICON[ico] || ICON.done; };
    i.classList.add("e3dico");
    i.innerHTML = "";
    i.append(img);
  }
  // ---------- Settings page: compact rows grouped like the phone's Settings ----------
  const SETTINGS = [
    ["", [
      ["open-switch", "undo", "#5e5ce6", "Switch to Ervo for Business", "Same email, separate chats and settings"],
    ]],
    ["Ervo", [
      ["open-look", "look", "#7a4be0", "Ervo's Look", "Pick an outfit"],
      ["open-wake", "mic", "#30d158", "Hey Ervo", "Hands-free"],
    ]],
    ["Work", [
      ["open-team", "people", "#0a84ff", "Team", "Employees, their chats and employee IDs"],
      ["open-hours", "clock", "#ff9f0a", "Office Hours", "When you're working"],
      ["open-biz", "home", "#30d158", "My Businesses", "Switch, add, verify or delete"],
    ]],
    ["You", [
      ["open-psyche", "brain", "#bf5af2", "Psyche", "What Ervo knows about you"],
      ["open-stats", "stats", "#ff375f", "Ervo Stats", "Steps, upcoming, activity"],
      ["open-apps", "open", "#5e5ce6", "Connected Apps", "Calendar, Health, Location, stores"],
      ["open-plans", "gem", "#ffd60a", "Plans", "Free, Plus and Pro"],
      ["open-chats", "chat", "#64d2ff", "Chats", "Side chats"],
    ]],
    ["Sign-in", [
      ["open-keep", "done", "#30d158", "Keep me logged in", "On: you stay signed in until you sign out"],
      ["open-bio", "star", "#0a84ff", "Unlock with fingerprint or face", "Off"],
    ]],
    ["Testing", [
      ["open-testplan", "star", "#ff9f0a", "Try a plan", "Owner: no limits"],
    ]],
    ["About", [
      ["open-intro", "book", "#8e8e93", "How Ervo Works"],
      ["check-update", "done", "#34c759", "Check for Updates"],
    ]],
    ["", [
      ["reset-ervo", "undo", "#ff9f0a", "Reset Ervo…"],
      ["sign-out", "open", "#ff453a", "Sign Out…", "", "danger"],
    ]],
  ];
  (function buildSettings() {
    const box = $("settings-list");
    SETTINGS.forEach(([name, rows]) => {
      if (name) { const hd = document.createElement("h2"); hd.textContent = name; hd.dataset.group = name; box.append(hd); }
      const card = document.createElement("div");
      card.className = "card list compact";
      card.dataset.group = name;
      rows.forEach(([id, ico, color, label, sub, cls]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.id = id;
        b.className = `row compact${cls ? ` ${cls}` : ""}`;
        const i = document.createElement("span");
        i.className = `app-ico ${ico}`;
        i.style.setProperty("--ico-bg", color);
        setRowIcon(i, ico);
        const t = document.createElement("span");
        t.className = "txt";
        const bb = document.createElement("b");
        bb.textContent = label;
        t.append(bb);
        if (sub) { const s = document.createElement("small"); s.textContent = sub; t.append(s); }
        b.append(i, t, chevron());
        card.append(b);
      });
      box.append(card);
    });
  })();

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
    orders: {
      name: "Order tracking", ico: "shop",
      does: ["Keep a card for each order, return and refund you tell Ervo about, with a progress bar", "Look up tracking numbers you share and remind you the day before and the day it should arrive", "Stores don't let Ervo see inside your account, so Ervo tracks what you share"],
      note: "Everything stays in Ervo. Nothing opens unless you tap a card's button.",
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
  async function ensure(key, reason, quiet) {
    if (allowed(key)) return true;
    const ok = await askPermission(key, reason);
    setConnection(key, ok ? "allowed" : "denied");
    if (ok) logActivity({ kind: "connect", ico: CONNECTORS[key].ico, title: `Connected ${CONNECTORS[key].name}` });
    else if (!quiet) {
      const c = CONNECTORS[key];
      hideTyping();
      idleStatus();
      ervoSays(`No problem, I won't use ${c.name}. If you change your mind, tap Allow, or turn it on later in Settings under Connected Apps.`, {
        instant: true,
        acts: [{ label: `Allow ${c.name}`, icon: c.ico, onClick: async () => {
          const yes = await askPermission(key, reason);
          setConnection(key, yes ? "allowed" : "denied");
          if (yes) { logActivity({ kind: "connect", ico: c.ico, title: `Connected ${c.name}` }); ervoSays(`${c.name} is connected ✅ Ask me again and I'll use it.`); }
        } }],
      });
    }
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
      if (m[1] === "next" && (diff === 0 || today.getDay() + diff <= 6)) diff += 7; // the one in next week
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
  // Business work is about YOUR customers, staff and clients. "A ticket to the concert", "my mom works in
  // customer service" or "the staff at the restaurant" are personal.
  const BUSINESS_WORDS = /\b(payroll|(my|our) (employees?|staff|clients?|customers?|vendors?|sales team|support team|invoices)(?! (badge|id|card|discount|parking|room|lounge|entrance|meal|uniform|shirt)s?\b)|customers?'s?|(a|an|the|this|that|upset|angry|unhappy) (customer|client)s? (wants?|asked|asks|is|says|said|needs?|called|emailed|complained|left|wrote)|(reply|respond|answer|write) to (an? |the |my |our )?(upset |angry )?(customer|client)s?|(support|customer|help ?desk|open) tickets|tickets? (queue|backlog)|invoice (a|my|our|the) client)\b/i;
  const PERSONAL_WORDS = /\b(buy me|for me to eat|groceries|snacks|gym|workout|my birthday|my headphones|vacation|date night|my mom|my dad|my kids|dentist|haircut|pizza|my weekend|running shoes|for dinner|cook|my (son|daughter|girlfriend|boyfriend|wife|husband|partner)\b|movie|netflix|date night)\b/i;
  const BUSINESS_CONTEXT = /\b(customers?|clients?|refunds?|orders?|tickets?|employees?|staff|members?|membership)\b/i;

  // Common typos, so "calander" and "tmrw" still make sense
  const fixSpelling = (s) => s
    .replace(/\bcal[aeiou]n?d[aeiou]?r+s?\b/gi, "calendar")
    .replace(/\b(tmrw|tmr|tmrow|tommorow|tomorow|tommorrow|tomm?orrow)\b/gi, "tomorrow")
    .replace(/\b(nick name|nickanme|nicname)\b/gi, "nickname")
    .replace(/\b(resturant|restraunt|restaraunt)\b/gi, "restaurant")
    .replace(/\b(alram|alarn|alrm|alaram|allarm|alarma|alrams|alarns)\b/gi, (w) => (/s$/i.test(w) ? "alarms" : "alarm"))
    .replace(/\b(tiemr|timr|timmer|tmer|temporizador)\b/gi, "timer")
    .replace(/\b(wether|weahter|wheather|waether|weathr)\b/gi, "weather")
    .replace(/\b(pon|ponme|pone) (una|un) /gi, "set an ")
    .replace(/\ba las (\d{1,2})\b/gi, "at $1")
    .replace(/\bmañana\b/gi, "tomorrow");
  // "quarter past 7", "half past six", "seven thirty am", "630" and "6 30 am" become 7:15, 6:30, 7:30 am...
  const HOUR_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const HW = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  const hourOf = (w) => (/^\d/.test(w) ? +w : HOUR_WORDS[w.toLowerCase()]);
  const MIN_WORDS = { "oh five": 5, ten: 10, fifteen: 15, twenty: 20, "twenty five": 25, thirty: 30, "thirty five": 35, forty: 40, "forty five": 45, fifty: 50, "fifty five": 55 };
  const pad2 = (n) => String(n).padStart(2, "0");
  function spokenTimes(s) {
    s = s
      .replace(new RegExp(`\\bquarter (past|after) ${HW}\\b`, "gi"), (_, p, h) => `${hourOf(h)}:15`)
      .replace(new RegExp(`\\bhalf (past|after) ${HW}\\b`, "gi"), (_, p, h) => `${hourOf(h)}:30`)
      .replace(new RegExp(`\\bquarter (to|till|til|before) ${HW}\\b`, "gi"), (_, p, h) => `${(hourOf(h) + 10) % 12 + 1}:45`)
      .replace(new RegExp(`\\b${HW}[ -](oh five|twenty five|thirty five|forty[ -]five|fifty five|fifteen|thirty|forty|fifty|ten|twenty)\\b(?!\\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?|people|dollars|bucks|percent))`, "gi"), (all, h, mm) => {
        if (/^\d/.test(h) && /^(ten|twenty|thirty|forty|fifty)$/i.test(mm)) return all; // "5 ten" is too unclear
        return `${hourOf(h)}:${pad2(MIN_WORDS[mm.toLowerCase().replace("-", " ")])}`;
      })
      .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(\s*(?:o'?clock)?\s*)(am|pm|a\.m\.|p\.m\.|o'?clock)\b/gi, (_, h, sp, ap) => `${hourOf(h)}${/clock/i.test(ap) ? "" : " " + ap}`)
      .replace(/\b(\d{1,2}) ([0-5]\d)\s*(am|pm|a\.m\.|p\.m\.)/gi, "$1:$2 $3")
      .replace(/\b(\d{1,2}) y media\b/gi, "$1:30").replace(/\b(\d{1,2}) y cuarto\b/gi, "$1:15")
      .replace(/\b(\d{1,2}) menos cuarto\b/gi, (_, h) => `${(+h + 10) % 12 + 1}:45`)
      .replace(/\bnine[- ]one[- ]one\b/gi, "911").replace(/\bnine[- ]eight[- ]eight\b/gi, "988");
    // Texting style, only around alarms and wake-ups: "alarm 630", "wake me 7 30", "alarm 4 7am" (4 = for)
    if (/\b(alarms?|wake me|wake up)\b/i.test(s)) {
      s = s
        .replace(/\b(1[0-2]|[1-9])([0-5]\d)\b(?!\s*(minutes?|mins?|hours?|people|dollars))/g, "$1:$2")
        .replace(/\b(alarms?|wake me( up)?) (\d{1,2}) ([0-5]\d)\b/gi, "$1 $3:$4")
        .replace(/\b4 (?=\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?\b)/gi, "for ");
    }
    return s;
  }

  function understand(text) {
    const raw = spokenTimes(fixSpelling(text.trim()));
    const t = raw.toLowerCase().replace(/[’‘]/g, "'");
    const evening = /\b(dinner|tonight|evening|drinks|supper)\b/.test(t);
    const when = parseWhen(t, new Date(), evening);
    const d = { raw, t, when, party: parseParty(t), intent: "unknown" };
    const is = (re) => re.test(t);
    const biz = account.plan === "business";

    // Quoted text ("my friend sent me this: '...delete every event...'") is something to explain, never a command
    const quoted = raw.match(/["“]([^"”]{10,})["”]|(?:^|[\s:])['‘]([^'’]{10,})['’](?=[\s?.!,]|$)/);
    const outside = quoted ? t.replace(quoted[0].toLowerCase().replace(/[’‘]/g, "'"), " ") : t;
    const explainQuote = quoted && /\b(mean|meaning|translate|sent me|says?|said|is this|is that|what'?s this|real|scam|legit)\b/.test(outside);
    // Telling Ervo about yourself ("quick intro: I'm a night shift nurse...") is for learning, not a calendar search
    const aboutMe = /^(hey!?,? |hi!?,? |hello!?,? |so,? |ok,? )?(quick intro|intro|about me|fyi|a bit about me|some things about me|let me introduce|i'?m a |i am a |i work (as|at|in|nights|days)|i'?m an? )/.test(t)
      && !/\b(remind|set|add|schedule|book|remove|delete|cancel|move|change)\b/.test(t.replace(/^.*?\b(and )?(can you|could you|please)\b/, ""));
    d.settings = explainQuote || aboutMe ? null : parseSettings(raw, t);
    if (explainQuote || aboutMe) d.intent = "unknown";
    else if (d.settings) d.intent = "settings";
    else if (is(/\b(change|switch|pick|choose|edit|customi[sz]e|new|different)\b.*\b(your|ervo'?s|the owl'?s|his)\b.*\b(look|looks|avatar|outfit|costume|picture|pic)\b|\bwhat (other )?(looks|outfits|avatars)\b/)) d.intent = "look";
    else if (is(/\b(warn|alert|notify|tell|ping|text|let) me( know)?\b.*\b(weather|rain|snow|storms?|umbrella|jacket|cold|heat)\b|\b(weather|rain|storm)\b.*\b(before i (leave|head out|go)|when i leave|heads.?up|alerts?|notifications?)\b/)) d.intent = "leaveAlert";
    else if (is(/^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|sounds good|please do|book it|add it|confirm|let'?s do it|correct|perfect)\b/)) d.intent = "yes";
    else if (is(/^(no|nope|nah|not now|skip|stop|never ?mind|don'?t)\b|^cancel( it| that| this)?[.!]?$/) && !is(/\b(alarms?|timers?|music|reminders?|calls?|calendar)\b/)) d.intent = "no";
    else if (is(/\bhey ervo\b.*\b(on|off|settings?|set ?up|work)\b|\b(turn on|turn off|enable|disable|set up|setup)\b.*\b(hey ervo|wake word|hands.?free|voice activation)\b/)) { d.intent = "wake"; d.wakeTurn = /\b(off|disable)\b/.test(t) ? false : /\b(on|enable)\b/.test(t) ? true : undefined; }
    else if (is(/\b(timer|countdown)\b/) && !is(/\b(cancel|stop|delete)\b/) && !(is(/\b(buy|purchase|recommend\w*|best|good|app|apps|which|review\w*|shop\w*|amazon)\b/) && !parseDuration(t))) { d.intent = "timer"; d.seconds = parseDuration(t) || ((m) => (m ? +m[1] * 60 : 0))(t.match(/\b(?:timer|countdown)(?: for)? (\d{1,3})$/)); const lb = t.match(/\b(?:for|called|named) (?:the |my )?([a-z][a-z ]{1,25})$/); d.label = lb && !parseDuration(lb[1]) ? cap(lb[1].trim()) : ""; }
    else if (is(/\balarms?\b/) && is(/\b(cancel|delete|remove|turn off|switch off|clear|get rid of|dismiss|disable|stop)\b/)) { d.intent = "alarmOff"; d.alarm = parseAlarm(t.replace(/\b(all|every)\b/g, "")); if (is(/\b(all|every|my alarms)\b/)) d.alarm.h = null; }
    else if (is(/\balarm\b/) && is(/\b(change|move|reset|re-set|push|switch|update|make)\b.*\bto\b/)) d.intent = "alarmChange";
    else if (is(/\b(google meet|meet link|zoom|ms teams|microsoft teams|teams (meeting|call)|skype|video (call|meeting|chat))\b/) && !is(/\b(remove|delete|cancel)\b/) && !is(/\b(alarms?|timers?|wake me|remind me)\b/) && !is(/\bwhat time\b|\btime (is )?(that|it) (for|in|be)\b|\b(her|his|their|your) time\b|\btime ?zones?\b|\bfor me\?/)) { d.intent = "meeting"; d.meeting = parseMeeting(d); }
    // Calendar edits only; "rename my screenshots" or "rename this file" goes to the AI
    else if (!is(/\b(night|day|morning|evening|late|early|double|graveyard|swing|work) shifts?\b/) && !is(/\b(files?|screenshots?|photos?|pictures?|pics?|images?|documents?|docs?|folders?|songs?|playlists?|pdfs?|wi-?fi|contacts?)\b/) && (is(/\b(rename|re-name|retitle|reschedule|change the (name|title) of)\b/) || (is(/\b(change|move|push|shift|update|bump)\b/) && is(/\bto\b/) && !is(/\b(nickname|name to|theme|mode|calendar to|greeting|alarm|timer)\b/) && (is(/\b(event|meeting|appointment|reservation|dinner|lunch|breakfast|gym|call|dentist|doctor|class|practice)\b/) || parseWhen(t.split(/\bto\b/).pop(), new Date(), false).time)))) d.intent = "edit";
    else if (is(/\balarms?\b|\bwake me\b/) && !is(/\b(car|smoke|fire|carbon monoxide|co|house|home|security|burglar|door|motion) alarms?\b|\balarm (system|company|companies|panel)s?\b/) && !(is(/\b(buy|purchase|recommend\w*|best|good|review\w*|shop\w*|amazon|clocks?)\b/) && !parseWhen(t, new Date(), false).time)) { d.intent = is(/\b(show|see|what|list|check)\b.*\balarms\b/) ? "alarms" : "alarm"; d.alarm = parseAlarm(t); }
    else if (EMERGENCY_RE.test(t) && (is(/\b(call|phone|dial|ring|text|contact|get|send|need|now|help)\b/) || t.split(/\s+/).length <= 3) && !is(/\b(what|why|how|when|is|are|does|number for|should)\b.*\?$/)) { d.intent = "emergency"; d.crisis = is(/\b(988|suicid\w*|crisis|self.?harm|kill myself)\b/); }
    else if (is(/^(?:\s*(?:please|can you|could you|would you|hey|ok|okay|ervo|hey ervo)[,!]?\s+)*(?:call|phone|ring|dial|facetime|give)\b/) && !is(/\b(call|phone) with\b|\bschedule\b|\bset up\b|\bbook\b|\bcalled\b|\bcall of\b|\bcall (it|that) a\b/) && !(is(/^give\b/) && !is(/\ba call\b/))) { d.intent = "call"; d.callee = callName(raw); }
    else if (is(/what can you do|how do you work|what do you do|^help[.!?]*$|^help me[.!?]*$|^menu$/)) d.intent = "help";
    else if (!biz && PLAN_RE.test(t)) d.intent = "plan";
    else if (is(/^(thanks|thank you|thx|ty|appreciate it|cool|great|awesome|nice)\b/) && t.length < 30) d.intent = "thanks";
    else if (is(/^(hi|hey|hello|yo|sup|hiya|good (morning|afternoon|evening)|what'?s up)\b/) && t.length < 25) d.intent = "hello";
    else if (is(/\b(delete|remove|cancel|scrap|drop) (it|that|this( one)?)\b|\b(got|was|has been|is|been) (cancell?ed|called off)\b/) && !is(/\b(order|subscription|cart|membership|account|photo|file|alarms?|timers?)\b/)) { d.intent = "remove"; d.removeLast = true; }
    else if (is(/\b(remove|delete|cancel|take off|clear|get rid of)\b|\btake\b.+\boff (of )?(my |the )?calendar\b/) && (is(/\b(calendar|events?|appointments?|meetings?|reservations?|plans?|reminders?)\b|\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/) || is(/^(please |can you |could you |ervo,? )*(cancel|remove|delete|take off|get rid of|clear|erase) (my |the )?[a-z]/) || is(/\btake\b.+\boff (of )?(my |the )?calendar\b/) ) && !is(/\b(order|subscription|membership|account|cart|amazon|package|photo|photos|file|files|email|message|alarms?|timers?)\b/)) d.intent = "remove";
    else if (is(/what time is it|what'?s the time|current time|time is it/) && !is(/\b(in|at) (?!the\b|my\b|here\b)[a-z]{3,}/)) d.intent = "time";
    else if (is(/what'?s (the |today'?s )?date|what day is (it|today)|today'?s date/)) d.intent = "date";
    else if (is(/\bweather\b|temperature|forecast|\brain(ing)?\b|\bsnow|umbrella|how (hot|cold)|\b(cold|hot|warm|chilly|nice|windy) (out|outside)\b|like outside|\bwear an? (jacket|coat|sweater|hoodie)\b|\bneed an? (jacket|coat|sweater)\b/)) d.intent = "weather";
    else if (is(/\bnews\b|headlines|what'?s happening/)) d.intent = "news";
    else if (is(/ervo stats|what (have|did) you (done|do)|recent (activity|events)|upcoming|coming up|what'?s (on )?my (schedule|calendar|plans|week)|my plans/)) d.intent = "stats";
    else if (!biz && is(/^(how many |how much |what('s| are) my |show (me )?my |check my )?steps\b|\bsteps (today|so far|count)\b|\bmy steps\b|how (far|much) (have i|did i) walk|how many steps|calories (have i|i'?ve|did i) burn|calories burned|activity rings?/) && !is(/\b(plan|workout|routine|goal weight|meal|diet|schedule)\b/)) d.intent = "steps";
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
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december " +
    "jan feb mar apr jun jul aug sep sept oct nov dec").split(" "));
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
      setStatus("🔍", `Searching ${store.name}`);
      openOutside(url);
      return ervoSays(`Opened ${store.name} with "${tk.item}" 🛒`, { status: ["🔍", `Searching ${store.name}`], acts: [{ label: `Open ${store.name} again`, icon: "shop", href: url }] });
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
    const write = (key, val) => { try { localStorage.setItem(nsKey(key), JSON.stringify(val)); return true; } catch (e) { return false; } };
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
    const stamped = Object.assign({ at: new Date().toISOString() }, item);
    c.items.push(stamped);
    if (c.items.length > 400) c.items.splice(0, c.items.length - 400);
    if (item.t === "msg" && account.team && account.team.role === "employee") queueMirror({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, role: item.who === "me" ? "user" : "assistant", text: String(item.text), at: stamped.at });
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
      else if (x.t === "picture") pictureBubble(x.src, x.prompt);
      else if (x.t === "link") linkBubble(x.url);
      else if (x.t === "choices") showChoices(x.options || [], x.picked || "");
      else if (x.t === "list" && x.list) showList(x.list);
      else if (x.t === "tracker") { const tr = trackers().find((y) => y.id === x.id); if (tr) showTracker(tr); }
      else if (x.t === "calcard" && x.date) showCalendarCard(new Date(x.date), x.events || []);
    });
    thread.querySelectorAll(".msg, .products, .acts, .choices, .listcard, .tracker, .calcard").forEach((el) => el.classList.add("old"));
    restoring = false;
  }
  // The conversation the AI sees: the last messages of the saved chat, product picks included
  function historyFrom(c) {
    const out = Array.isArray(c.seed) ? c.seed.map((h) => ({ role: h.role, text: h.text })) : [];
    c.items.forEach((x) => {
      if (x.t === "msg") out.push({ role: x.who === "me" ? "user" : "assistant", text: x.text });
      else if (x.t === "products" && out.length) out[out.length - 1].text += `\n[Showed product cards: ${x.products.map((p) => [p.name, p.price].filter(Boolean).join(" ")).join("; ")}]`;
      else if (x.t === "list" && x.list && out.length) out[out.length - 1].text += `\n[Showed a ${x.list.kind} list "${x.list.title}": ${x.list.items.map((i) => `${i.time ? i.time + " " : ""}${i.text}${i.on ? (x.list.kind === "plan" ? " (picked)" : " (got it)") : ""}`).join("; ")}${x.list.store ? `; store: ${storeName(x.list.store)}` : ""}${x.list.added ? "; added to calendar" : ""}]`;
      else if (x.t === "link") out.push({ role: "user", text: `(shared a link: ${x.url})` });
      else if (x.t === "photo") out.push({ role: "user", text: "(sent a photo)" });
      else if (x.t === "tracker" && out.length) { const tr = trackers().find((y) => y.id === x.id); if (tr) out[out.length - 1].text += `\n[Showed a ${tr.kind} card: ${tr.title} (${tr.storeName}), step "${tr.steps[tr.step]}"${tr.eta ? `, ${tr.eta}` : ""}]`; }
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
    // Last try: a picture search for the product's name, so a card never shows just a bag icon
    const bing = p.name ? `https://tse1.mm.bing.net/th?q=${encodeURIComponent(String(p.name).slice(0, 90))}&w=400&h=400&c=7&rs=1&p=0` : null;
    const tries = [p.image, asin && amazonPic(asin), bing].filter((u) => u && /^https:\/\//.test(u));
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

  // ---------- interactive lists: a plan for a day, a grocery list, to-dos ----------
  // Apple: toggle buttons outside lists show a clear change (a checkmark and a fill), not color
  // alone, and pickers appear in context. Ticks are saved with the chat, so they stay after a restart.
  const TICK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>';
  const GROCERY_STORES = ["heb", "walmart", "target", "sprouts", "instacart", "amazon"];
  function cleanList(a) {
    const kind = ["plan", "grocery", "todo", "packing"].includes(a.kind) ? a.kind : "todo";
    const items = (Array.isArray(a.items) ? a.items : []).slice(0, 30).map((x) => {
      const it = typeof x === "string" ? { text: x } : x || {};
      const tm = String(it.time || "").match(/^(\d{1,2}):(\d{2})/);
      return {
        text: String(it.text || "").trim().slice(0, 90),
        detail: String(it.detail || "").trim().slice(0, 80),
        time: tm && +tm[1] < 24 ? `${tm[1].padStart(2, "0")}:${tm[2]}` : "",
        minutes: Math.min(600, Math.max(10, Number(it.minutes) || 60)),
        icon: ICON[it.icon] ? it.icon : "",
        on: kind === "plan", // a plan starts all picked; a shopping list starts with nothing ticked off
      };
    }).filter((x) => x.text);
    if (kind === "plan") items.sort((x, y) => (x.time || "99").localeCompare(y.time || "99"));
    const dm = String(a.date || "").match(/^\d{4}-\d{2}-\d{2}$/);
    return { id: `l${Date.now().toString(36)}`, kind, title: String(a.title || (kind === "grocery" ? "Shopping list" : "Your list")).slice(0, 60), date: dm ? dm[0] : "", store: STORES[a.store] ? a.store : "", items, added: false };
  }
  // Saves ticks and the picked store back into the chat
  function saveList(l) {
    if (restoring) return;
    const id = activeId();
    const c = loadChat(id);
    if (!c) return;
    const it = c.items.find((x) => x.t === "list" && x.list && x.list.id === l.id);
    if (it) { it.list = l; storeChat(id, c); }
  }
  const listText = (l, onlyLeft) => l.items.filter((x) => !onlyLeft || !x.on).map((x) => `• ${x.text}`).join("\n");

  function showList(l) {
    if (!restoring) record({ t: "list", list: l });
    const card = document.createElement("div");
    card.className = `daycard listcard ${l.kind}`;
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", l.title);
    const head = document.createElement("div");
    head.className = "list-head";
    const h = document.createElement("h3");
    h.textContent = l.title;
    const count = document.createElement("span");
    count.className = "list-count";
    head.append(h, count);
    card.append(head);

    const rows = l.items.map((x) => {
      const wrap = document.createElement("div");
      wrap.className = "listrow";
      const row = document.createElement("button");
      row.type = "button";
      row.className = "dayrow";
      if (x.time) {
        const t = document.createElement("span");
        t.className = "dt";
        const [hh, mm] = x.time.split(":").map(Number);
        t.textContent = fmtTime({ h: hh, m: mm });
        row.append(t);
      }
      const name = document.createElement("span");
      name.className = "dn";
      name.textContent = x.text;
      if (x.detail) { const sm = document.createElement("small"); sm.textContent = x.detail; name.append(sm); }
      const tick = document.createElement("span");
      tick.className = "tick";
      tick.innerHTML = TICK_SVG;
      row.append(name, tick);
      row.addEventListener("click", () => {
        if (card.classList.contains("busy")) return;
        x.on = !x.on;
        buzz("tick");
        update();
        saveList(l);
      });
      wrap.append(row);
      if (l.kind === "grocery") {
        const find = document.createElement("button");
        find.type = "button";
        find.className = "list-find";
        find.innerHTML = SEARCH_SVG;
        find.addEventListener("click", () => openItemAt(l, x));
        wrap.append(find);
      }
      card.append(wrap);
      return { x, row, wrap };
    });

    const note = document.createElement("p");
    note.className = "daycard-note";
    let main = null;
    if (l.kind === "plan") {
      main = document.createElement("button");
      main.type = "button";
      main.className = "pill";
      main.addEventListener("click", () => addPlanToCalendar(l, card, update));
      card.append(main, note);
    } else if (l.kind === "grocery") {
      card.append(storePicker(l, update), note);
    } else {
      main = document.createElement("button");
      main.type = "button";
      main.className = "pill ghost";
      main.textContent = "Copy List";
      main.addEventListener("click", async () => { if (await copyText(`${l.title}\n${listText(l)}`)) toast("List copied"); });
      card.append(main);
    }

    function update() {
      const on = l.items.filter((x) => x.on).length;
      rows.forEach(({ x, row, wrap }) => {
        row.setAttribute("aria-pressed", String(x.on));
        wrap.classList.toggle("done", l.kind !== "plan" && x.on);
        wrap.classList.toggle("has-store", !!l.store);
      });
      if (l.kind === "plan") {
        count.textContent = `${on} of ${l.items.length} picked`;
        main.textContent = l.added ? "Added to Calendar" : on ? `Add ${on} to Calendar` : "Pick Something to Add";
        main.disabled = l.added || !on;
        note.textContent = l.added ? "" : "Tap to pick what you want to do.";
      } else {
        count.textContent = `${on} of ${l.items.length}`;
        if (l.kind === "grocery") note.textContent = !l.store ? "Pick a store to search each item there." : on === l.items.length ? "All done. Nice." : "Tap an item when it's in your cart. The magnifying glass searches for it.";
      }
    }
    update();
    thread.append(card);
    toBottom();
  }

  // Grocery list: the stores you use, plus "Other store near me" (an inline field, not a new screen)
  function storePicker(l, update) {
    const box = document.createElement("div");
    box.className = "store-pick";
    const label = document.createElement("p");
    label.className = "store-label";
    label.textContent = "Shop at";
    const seg = document.createElement("div");
    seg.className = "store-chips";
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", "Store");
    const fav = prefs().store;
    const keys = [l.store, fav].concat(GROCERY_STORES).filter((k, i, a) => k && a.indexOf(k) === i && (STORES[k] || /^other:/.test(k))).slice(0, 6);
    const other = document.createElement("form");
    other.className = "store-other";
    other.hidden = true;
    const draw = () => {
      seg.innerHTML = "";
      keys.forEach((k) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "store-chip";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(l.store === k));
        b.textContent = storeName(k);
        b.addEventListener("click", () => pickStore(k));
        seg.append(b);
      });
      const more = document.createElement("button");
      more.type = "button";
      more.className = "store-chip more";
      more.setAttribute("aria-expanded", String(!other.hidden));
      more.innerHTML = `${ICON.location || ""}Other Store Near Me`;
      more.addEventListener("click", () => { other.hidden = !other.hidden; draw(); if (!other.hidden) other.querySelector("input").focus(); });
      seg.append(more);
    };
    other.innerHTML = '<div class="field-clear"><input type="text" enterkeyhint="go" autocomplete="off" autocapitalize="words" placeholder="Store name, like Kroger" aria-label="Store name"><button type="button" class="clear-x" aria-label="Clear" hidden>×</button></div><button type="submit" class="pill">Use</button><button type="button" class="pill ghost near">Find Stores Near Me</button>';
    const input = other.querySelector("input");
    const clear = other.querySelector(".clear-x");
    input.addEventListener("input", () => { clear.hidden = !input.value; });
    clear.addEventListener("click", () => { input.value = ""; clear.hidden = true; input.focus(); });
    other.querySelector(".near").addEventListener("click", () => openOutside("https://www.google.com/maps/search/grocery+stores+near+me"));
    other.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim().slice(0, 40);
      if (!v) { input.focus(); return; }
      const known = storeIn(` at ${v.toLowerCase()} `);
      const k = known || `other:${v}`;
      if (!keys.includes(k)) keys.unshift(k);
      other.hidden = true;
      pickStore(k);
    });
    async function pickStore(k) {
      l.store = k;
      const p = load(PREFS_KEY) || {};
      p.store = k;
      save(PREFS_KEY, p);
      draw();
      update();
      saveList(l);
      buzz("tick");
      // The whole list goes with you: copied, so you can paste it into the store's list
      const copied = await copyText(`${l.title}\n${listText(l, true)}`);
      toast(copied ? `List copied. Paste it in ${storeName(k)}` : `Shopping at ${storeName(k)}`);
      const first = l.items.find((x) => !x.on);
      if (first) openItemAt(l, first);
    }
    draw();
    box.append(label, seg, other);
    return box;
  }
  const storeName = (k) => (STORES[k] ? STORES[k].name : String(k || "").replace(/^other:/, ""));
  function storeSearchUrl(k, q) {
    if (STORES[k]) return STORES[k].search(encodeURIComponent(q));
    return `https://www.google.com/search?q=${encodeURIComponent(`${storeName(k)} ${q}`)}`;
  }
  async function openItemAt(l, x) {
    if (!l.store) { toast("Pick a store first"); return; }
    const q = x.text.replace(/,.*$/, "").replace(/\(.*?\)/g, "").trim();
    if (STORES[l.store] && !(await ensure(l.store, `Look up "${q}"`))) return;
    logActivity({ kind: "shop", ico: "shop", title: `Looked up ${q}`, detail: storeName(l.store), link: storeSearchUrl(l.store, q) });
    openOutside(storeSearchUrl(l.store, q));
  }

  // Repeating events ("every Wednesday until December"): every date is added, with one Undo
  async function addRepeating(list) {
    const evs = [];
    list.forEach(({ tk, every, until }) => {
      let d = new Date(tk.date);
      for (let i = 0; i < 120 && d <= until; i++) {
        const t = Object.assign({}, tk, { date: new Date(d) });
        evs.push(eventFromTask(t, tk.title, tk.minutes || 60));
        if (every === "daily") d = addDays(d, 1);
        else if (every === "every_2_weeks") d = addDays(d, 14);
        else if (every === "monthly") { d = new Date(d); d.setMonth(d.getMonth() + 1); }
        else d = addDays(d, 7);
      }
    });
    if (!evs.length) return ervoSays("That end date has already passed. Until when should it repeat?");
    evs.sort((x, y) => x.start - y.start);
    const first = evs[0], last = evs[evs.length - 1];
    const span = `${fmtDate(first.start)} to ${fmtDate(last.start)}`;
    const at = first.allDay ? "" : ` at ${fmtTime({ h: first.start.getHours(), m: first.start.getMinutes() })}`;
    const undos = [];
    let which = null;
    if (!native && evs.length > 1) {
      if (!(await ensure("calendar", `Add ${evs.length} events to your calendar`))) return ervoSays("Okay, I won't add them.");
      openIcsMany(evs);
      which = "file";
    } else {
      setStatus("📅", `Adding ${evs.length} events`);
      for (const ev of evs) {
        which = await addToCalendar(ev, undos.length ? prefs().calendar : undefined);
        if (!which || which === "denied") break;
        if (which === "phone" && lastAdded && lastAdded.ev === ev && lastAdded.undo) undos.push(lastAdded.undo);
        if (which === "google") break; // the website adds one at a time, so stop after the first
      }
      idleStatus();
    }
    if (which === "denied") return ervoSays("I need permission to use your calendar. Ask me again and tap Allow.");
    if (!which) return;
    evs.forEach((ev) => logActivity({ kind: "event", ico: "calendar", title: ev.title, when: ev.start.toISOString(), allDay: ev.allDay, link: googleLink(ev) }));
    const days = [...new Set(evs.map((e) => e.start.toLocaleDateString(undefined, { weekday: "long" })))];
    const acts = [];
    if (undos.length) acts.push({ label: "Undo", icon: "undo", onClick: async (e) => {
      e.currentTarget.disabled = true;
      let ok = 0;
      for (const id of undos) {
        const u = await nativeCall((f) => { restoreWaiter = f; }, () => native.restoreEvent(String(id)));
        if (u.ok) ok++;
      }
      evs.forEach((ev) => forgetPlanned(ev.title, ev.start));
      ervoSays(ok ? `Undone. Removed ${ok} events from your calendar.` : "Sorry, I couldn't undo that.");
    } });
    if (which === "google") return ervoSays(`Google Calendar opened with the first one, ${fmtDate(first.start)}${at}. The website adds one at a time, so switch to your phone's calendar in Change calendar to add all ${evs.length} at once.`, { acts: [{ label: "Change calendar", icon: "calendar", onClick: () => switchCalendar("phone") }] });
    if (which === "file") return ervoSays(`Your calendar opened with ${evs.length} events, every ${days.join(" and ")}${at}, ${span}. Tap Add to save them.`);
    buzz("confirm");
    return ervoSays(`Added ${evs.length} events ✅ "${first.title}", every ${days.join(" and ")}${at}, ${span}.`, { acts });
  }

  // Plan: add the picked items to the calendar in one go
  async function addPlanToCalendar(l, card, update) {
    const base = l.date ? new Date(`${l.date}T00:00:00`) : addDays(startOfDay(new Date()), 1);
    const evs = l.items.filter((x) => x.on).map((x) => {
      const start = new Date(base);
      if (x.time) { const [hh, mm] = x.time.split(":").map(Number); start.setHours(hh, mm, 0, 0); }
      const end = new Date(start.getTime() + (x.time ? x.minutes : 1440) * 60000);
      return { title: x.text, start, end, allDay: !x.time, notes: x.detail ? `${x.detail} · Planned with Ervo` : "Planned with Ervo" };
    });
    if (!evs.length) return;
    card.classList.add("busy");
    let which = null;
    if (!native && evs.length > 1) {
      // iPhone and computers: one calendar file with every event
      if (!(await ensure("calendar", `Add ${evs.length} events to your calendar`))) { card.classList.remove("busy"); return; }
      openIcsMany(evs);
      which = "file";
    } else {
      for (const ev of evs) {
        which = await addToCalendar(ev);
        if (!which || which === "denied") break;
      }
    }
    card.classList.remove("busy");
    if (which === "denied") return ervoSays("I need permission to use your calendar. Ask me again and tap Allow.");
    if (!which) return;
    evs.forEach((ev) => logActivity({ kind: "event", ico: "calendar", title: ev.title, when: ev.start.toISOString(), allDay: ev.allDay, link: googleLink(ev) }));
    l.added = true;
    update();
    saveList(l);
    buzz("confirm");
    ervoSays(which === "file" ? `Your calendar opened with ${evs.length} events. Tap Add to save them.` : `Added ${evs.length === 1 ? `"${evs[0].title}"` : `${evs.length} things`} to your calendar for ${dayName(base).toLowerCase() === "tomorrow" ? "tomorrow" : dayName(base)}.`);
  }
  function openIcsMany(evs) {
    const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
    const utc = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ervo//Ervo app//EN"];
    evs.forEach((ev, i) => {
      const when = (d) => (ev.allDay ? `;VALUE=DATE:${stamp(d)}` : `:${stamp(d, true)}`);
      lines.push("BEGIN:VEVENT", `UID:${Date.now().toString(36)}-${i}@ervo.app`, `DTSTAMP:${utc}`, `DTSTART${when(ev.start)}`, `DTEND${when(ev.end)}`, `SUMMARY:${esc(ev.title)}`, `DESCRIPTION:${esc(ev.notes)}`, "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    const url = `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) { location.href = url; return; }
    const a = document.createElement("a");
    a.href = url;
    a.download = "ervo-plan.ics";
    document.body.append(a);
    a.click();
    a.remove();
  }

  // A plan Ervo can make without its AI (offline, or before it knows you): a varied day,
  // bent toward what your Psyche already says
  function localPlan(day) {
    const d = day || addDays(startOfDay(new Date()), 1);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const facts = psyche().facts;
    const find = (k) => facts.filter((f) => f.kind === k).map((f) => f.text);
    const items = weekend ? [
      { time: "09:00", text: "Slow breakfast or coffee somewhere new", minutes: 60 },
      { time: "10:30", text: "Get outside: a park, trail or market", minutes: 90 },
      { time: "13:00", text: "Lunch with a friend", minutes: 60 },
      { time: "15:00", text: "Groceries for the week", minutes: 60 },
      { time: "19:00", text: "Movie, game or something fun", minutes: 120 },
    ] : [
      { time: "07:30", text: "Breakfast and look over the day", minutes: 30 },
      { time: "12:30", text: "Lunch, then a 15-minute walk", minutes: 45 },
      { time: "17:30", text: "Workout or a walk outside", minutes: 60 },
      { time: "19:00", text: "Cook dinner at home", minutes: 60 },
      { time: "21:30", text: "Wind down, screens off by 10:30", minutes: 60 },
    ];
    const goal = find("goal")[0];
    if (goal) items.splice(2, 0, { time: weekend ? "11:30" : "16:00", text: `Work on it: ${short(goal.replace(/^(my goal( is)?( to)?|wants? to|would like to|trying to|plans? to)\s+/i, ""), 40)}`, minutes: 45 });
    const music = find("music")[0];
    if (music) items.push({ time: weekend ? "17:00" : "20:30", text: "Make a playlist for the week", detail: short(music, 40), minutes: 20 });
    return cleanList({ kind: "plan", title: `${dayName(d)}, ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, items: items.slice(0, 6) });
  }
  const PLAN_RE = /\b(plan (my |the |out )?(day|tomorrow|today|weekend|saturday|sunday)|plan tomorrow|what (should|could|can) i do|things (to|i could) do|i'?m bored|ideas for (tomorrow|today|the weekend))\b/;

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
  const capFirst = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);
  // An emoji for what Ervo is doing, when the caller didn't pick one
  function statusIcon(w) {
    return /calendar|event|planning it/i.test(w) ? "📅" : /contact/i.test(w) ? "📇" : /remov/i.test(w) ? "🗑️"
      : /putting (it|them) back/i.test(w) ? "↩️" : /alarm/i.test(w) ? "⏰" : /timer/i.test(w) ? "⏱️" : /weather/i.test(w) ? "🌤️" : "💭";
  }
  function setStatus(ico, text) {
    text = capFirst(String(text || "").replace(/[….]+$/, ""));
    ico = ico || (text && !/^typing$/i.test(text) ? statusIcon(text) : "");
    setIco($("status-ico"), ico);
    $("status-text").textContent = text;
    $("status").classList.add("busy");
    if (liveTyping && text && !/^typing$/i.test(text)) showTyping(text, ico);
  }
  function idleStatus() {
    setIco($("status-ico"), "");
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
  function syncKeyboard() {
    const vv = window.visualViewport;
    const phone = /Android|iPhone|iPad/i.test(navigator.userAgent);
    const up = vv && phone ? vv.height < window.screen.height * 0.72 && window.screen.height - vv.height > 180 : false;
    document.body.classList.toggle("kbd", up);
  }
  if (window.visualViewport) window.visualViewport.addEventListener("resize", syncKeyboard);

  // While Ervo works: its picture, name and what it's doing ("checking your calendar")
  let liveTyping = null;
  let lastErvoText = "";
  function showTyping(words, ico) {
    if (!liveTyping) {
      liveTyping = document.createElement("div");
      liveTyping.className = "typing";
      liveTyping.setAttribute("role", "status");
      liveTyping.innerHTML = '<img src="' + lookSrc() + '" alt=""><span class="typing-body"><b>Ervo</b><small><span class="spin"></span><span class="dots"><i></i><i></i><i></i></span><em></em></small></span>';
    }
    if (words) {
      const w = capFirst(String(words).replace(/[….]+$/, ""));
      const typing = /^typing$/i.test(w);
      liveTyping.classList.add("is-typing"); // always the dots; the words stay in the status at the top
      if (!typing) {
        // Same words and emoji as the status at the top
        const i = ico || statusIcon(w);
        liveTyping.querySelector("em").textContent = `${i} ${w}`;
        if ($("status-text").textContent !== w) { setIco($("status-ico"), i); $("status-text").textContent = w; $("status").classList.add("busy"); }
      } else liveTyping.querySelector("em").textContent = w;
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
    if (!opts.instant) showTyping(opts.status ? opts.status[1] : liveTyping ? null : "typing");
    if (opts.status) setStatus(opts.status[0], opts.status[1]);
    else setStatus("", "Typing…");
    const speakIt = lastWasVoice;
    lastWasVoice = false;
    let said;
    try { said = await Promise.resolve(text); } catch (e) { said = "I ran into a problem answering that. Ask again in a moment."; }
    if (said && typeof said === "object") {
      opts = Object.assign({}, opts, { products: said.products, chips: said.chips || opts.chips, acts: said.acts || opts.acts, choices: said.choices || opts.choices, list: said.list || opts.list, trackers: said.trackers || opts.trackers, calendar: said.calendar || opts.calendar, picture: said.picture, prompt: said.prompt, model: said.model });
      said = said.text;
    }
    said = plain(said);
    if (!opts.instant) await delay(250 + Math.min(String(said).length * 3, 400)); // a short beat, so it still feels like a reply
    hideTyping();
    idleStatus();
    if (opts.replace) opts.replace.remove();
    bubble(said, "them");
    lastErvoText = said;
    if (opts.picture) pictureBubble(opts.picture, opts.prompt);
    if (opts.model && testPlan()) modelTag(opts.model);
    thread.querySelectorAll(".fb").forEach((x) => x.remove());
    // A done or failed action gets the matching haptic (Android); plain answers get none
    if (/^(Done|Undone|All set)\b/.test(String(said))) buzz("confirm");
    else if (/^I couldn't\b/.test(String(said))) buzz("reject");
    // The AI remembers what it showed, so "the second one" or "those lights" still make sense later
    const shown = opts.products && opts.products.length ? `\n[Showed product cards: ${opts.products.map((p) => [p.name, p.price].filter(Boolean).join(" ")).join("; ")}]` : "";
    const listed = opts.list ? `\n[Showed a ${opts.list.kind} list "${opts.list.title}": ${opts.list.items.map((i) => `${i.time ? i.time + " " : ""}${i.text}`).join("; ")}]` : "";
    history.push({ role: "assistant", text: said + shown + listed + (opts.picture ? `\n[Drew a picture: ${String(opts.prompt || "").slice(0, 120)}]` : "") });
    if (opts.products && opts.products.length) showProducts(opts.products);
    if (opts.list && opts.list.items.length) showList(opts.list);
    if (opts.trackers && opts.trackers.length) opts.trackers.forEach((tr) => { showTracker(tr); record({ t: "tracker", id: tr.id }); });
    if (opts.calendar) showCalendarCard(opts.calendar.date, opts.calendar.events, true);
    if (opts.acts && opts.acts.length) showActs(opts.acts);
    const choosing = opts.choices && opts.choices.length;
    if (choosing) showChoices(opts.choices);
    setChips(choosing ? [] : opts.chips || null);
    if (opts.ai && said) feedbackRow(opts.asked || "", said);
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

  // ---------- quick suggestions: picked for you from your Psyche, not a fixed list ----------
  // Apple: suggestions should be relevant to the person and the moment, and few. Ervo mixes
  // your goals, what it knows about you (Psyche), today's ideas from Ervo's AI, what's coming
  // up on your calendar and the time of day. Things you just asked are left out. A new user
  // with an empty Psyche gets simple starters until Ervo learns more.
  const SPARK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" opacity=".7"/></svg>';
  const short = (s, n) => { s = String(s).replace(/\s+/g, " ").trim().replace(/[.!]$/, ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
  function suggestChips() {
    const biz = account && account.plan === "business";
    const p = psyche();
    const out = [];
    const seen = new Set();
    // What you've asked lately: don't suggest it again right away
    const asked = [...thread.querySelectorAll(".msg.me")].slice(-8).map((m) => m.textContent.toLowerCase());
    const add = (label, prompt, mine) => {
      const k = String(prompt || label).toLowerCase();
      if (!label || seen.has(k) || asked.some((a) => a === k || (a.length > 12 && (a.includes(k) || k.includes(a))))) return;
      seen.add(k);
      out.push({ label, prompt: prompt || label, mine: !!mine });
    };
    const now = new Date(), h = now.getHours(), day = now.getDay();
    // Steady for the hour, so the bar doesn't reshuffle after every reply
    const seed = Math.floor(now.getTime() / 3600000);
    const pick = (arr) => arr.slice().sort((a, b) => ((seed * 31 + a.length) % 7) - ((seed * 31 + b.length) % 7));

    // 1. Coming up in the next day
    const soon = activity().filter((a) => a.when && new Date(a.when) > now && new Date(a.when) - now < 26 * 3600000).sort((a, b) => new Date(a.when) - new Date(b.when))[0];
    if (soon) add(`Remind me about ${short(soon.title, 22)}`, `Remind me about ${soon.title} an hour before`, true);
    // 2. Your goals
    // "Wants to run a 5K by spring" -> "Next step: run a 5K by spring"
    const goalText = (t) => String(t).trim().replace(/^(my goal( is)?( to)?|goal:|i('d| would)? (really )?(want|like|hope|plan) to|wants? to|would like to|hopes? to|plans? to|trying to|is trying to)\s+/i, "").replace(/^./, (c) => c.toLowerCase());
    pick(p.facts.filter((f) => f.kind === "goal")).slice(0, 1).forEach((f) => add(`Next step: ${short(goalText(f.text), 26)}`, `Help me with my goal to ${goalText(f.text).replace(/[.!]+$/, "")}`, true));
    // 3. Today's ideas from Ervo's AI (made from your Psyche)
    const cached = load(IDEAS_KEY);
    const ideaList = cached && cached.data && Array.isArray(cached.data.groups) ? cached.data.groups.flatMap((g) => (g && Array.isArray(g.ideas) ? g.ideas : [])) : [];
    pick(ideaList.filter((it) => it && it.prompt && it.prompt.length <= 48)).slice(0, 2).forEach((it) => add(short(it.prompt, 34), it.prompt, true));
    // 4. What Ervo knows about you
    const kinds = {};
    p.facts.forEach((f) => { kinds[f.kind] = f; });
    if (kinds.health) add("Plan a workout for me", "Plan a workout that fits my health and schedule", true);
    if (kinds.food) add("Dinner ideas for me", "Give me dinner ideas that fit what I eat", true);
    if (kinds.music) add("Concerts near me", "Find concerts near me for music I like", true);
    if (kinds.routine) add("Plan my day", "Plan my day around my routine", true);
    if (kinds.places) add("What's on near me?", "What's happening near me this week?", true);
    if (kinds.money) add("Check my budget plan", "Help me stay on my budget this week", true);
    if (kinds.people) add("Plan time with friends", "Help me plan something with the people I care about", true);
    // At most 2 from what Ervo knows, so there's always something new in the bar too
    out.splice(2);
    if (biz) {
      if (h < 12) add("Summarize today's tickets"); else add("What's left today?", "What's still open today?");
      pick(PLAN.business.chips).forEach((c) => add(c));
      return out.slice(0, 4);
    }
    // 5. The rest come from Ervo's library of about 1,000 everyday suggestions: ones that fit
    // the time of day, the day of the week, the season and your city, shuffled for you.
    // Every person (and every Reset) gets a different mix, and it changes every few hours.
    const want = 3 + Math.floor(rand(suggestSeed(2))() * 3); // 3 to 5
    librarySuggestions(want + 4).forEach((x) => { if (out.length < want) add(x.label, x.prompt); });
    return out.slice(0, want);
  }

  // A random number generator that gives the same numbers for the same seed
  function rand(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const SUGGEST_KEY = "ervo-suggest-salt";
  // Your own shuffle: made once per person (and again after Reset), changes every 4 hours
  function suggestSeed(extra) {
    let salt = load(SUGGEST_KEY);
    if (!salt) { salt = Math.floor(Math.random() * 2147483647); save(SUGGEST_KEY, salt); }
    const block = Math.floor(Date.now() / (4 * 3600000));
    let x = (salt ^ Math.imul(block, 2654435761) ^ Math.imul(extra || 1, 40503)) >>> 0;
    String(account ? account.name : "").split("").forEach((c) => { x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; });
    return x;
  }
  function librarySuggestions(n) {
    const lib = window.ERVO_SUGGESTIONS || [];
    const now = new Date(), h = now.getHours(), day = now.getDay(), mon = now.getMonth();
    const part = h >= 5 && h < 11 ? "m" : h >= 11 && h < 17 ? "a" : h >= 17 && h < 22 ? "e" : "n";
    const weekend = day === 0 || day === 6 || (day === 5 && h >= 17);
    const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const season = ["win", "win", "spr", "spr", "spr", "sum", "sum", "sum", "fal", "fal", "fal", "win"][mon];
    let city = "";
    try { const pl = allowed("location") ? load(PLACE_KEY) : null; city = (pl && pl.city) || ""; } catch (e) { /* no city */ }
    const fits = (tags) => {
      if (!tags) return true;
      const t = tags.split(" ");
      if (t.includes("city") && !city) return false;
      const times = t.filter((x) => "maen".includes(x) && x.length === 1);
      if (times.length && !times.includes(part)) return false;
      if (t.includes("we") && !weekend) return false;
      if (t.includes("wd") && weekend) return false;
      const months = t.filter((x) => MONTHS.includes(x));
      const seasons = t.filter((x) => ["win", "spr", "sum", "fal"].includes(x));
      if ((months.length || seasons.length) && !months.includes(MONTHS[mon]) && !seasons.includes(season)) return false;
      return true;
    };
    // Things that fit right now come first; any-time ones fill in
    const r = rand(suggestSeed(1));
    const pool = lib.filter((e) => fits(e[2])).map((e) => ({ e, k: r() - (e[2] ? 0.35 : 0) })).sort((a, b) => a.k - b.k).map((x) => x.e);
    const groups = new Set();
    const picked = [];
    for (const e of pool) {
      if (picked.length >= n) break;
      if (groups.has(e[3])) continue; // one per topic, so the bar feels varied
      groups.add(e[3]);
      const fill = (x) => String(x).replace(/\{city\}/g, city);
      picked.push({ label: fill(e[0]), prompt: fill(e[1] || e[0]) });
    }
    return picked;
  }
  // Ideas from Ervo's AI, fetched quietly once a day once Ervo knows a few things about you
  let ideasFetching = null;
  function fetchIdeas() {
    if (!AI_URL) return Promise.resolve(null);
    if (ideasFetching) return ideasFetching;
    const learned = psyche().learned || 0;
    ideasFetching = askServer({ task: "ideas", messages: [] }).then((j) => {
      if (j && j.ideas && Array.isArray(j.ideas.groups) && j.ideas.groups.length) {
        save(IDEAS_KEY, { day: new Date().toDateString(), learned, data: j.ideas });
        return j.ideas;
      }
      return null;
    }).catch(() => null).finally(() => { ideasFetching = null; });
    return ideasFetching;
  }
  function freshenSuggestions() {
    const cached = load(IDEAS_KEY);
    const p = psyche();
    if (OVERLAY || !AI_URL || p.facts.length < 3) return;
    if (cached && cached.day === new Date().toDateString() && (p.learned || 0) - (cached.learned || 0) < 5) return;
    fetchIdeas().then((d) => {
      // Only swap the bar if it's still showing suggestions (not an answer's own options)
      if (d && $("chips").dataset.kind === "suggest") setChips(null);
    });
  }

  // list: an answer's own options (strings), or null for suggestions picked for you.
  // Old ones fade away, new ones rise in one after another (Apple: motion that explains change).
  let chipsTimer = 0;
  const HIDDEN_CHIPS_KEY = "ervo-chips-hidden";
  function setChips(list) {
    const box = $("chips");
    const hidden = load(HIDDEN_CHIPS_KEY) || [];
    const items = list ? list.map((label) => ({ label, prompt: label })) : (account ? suggestChips().filter((x) => !hidden.includes(x.label)) : []);
    const same = box.dataset.sig === JSON.stringify(items.map((i) => i.label));
    if (same) return;
    box.dataset.sig = JSON.stringify(items.map((i) => i.label));
    box.dataset.kind = list ? "answer" : "suggest";
    clearTimeout(chipsTimer);
    const fill = () => {
      box.innerHTML = "";
      box.classList.remove("leaving");
      box.scrollLeft = 0;
      items.forEach((it, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip" + (it.mine ? " mine" : "");
        b.style.setProperty("--i", i);
        if (it.mine) { b.innerHTML = SPARK; b.title = "Suggested from your Psyche"; }
        b.append(it.label);
        b.addEventListener("click", () => { buzz("tick"); send(it.prompt); });
        // Touch and hold a suggestion to stop seeing it (Microsoft AI guideline 8: easy to dismiss)
        if (!list) b.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          buzz("long");
          const h = load(HIDDEN_CHIPS_KEY) || [];
          if (!h.includes(it.label)) save(HIDDEN_CHIPS_KEY, h.concat(it.label).slice(-100));
          b.remove();
          toast(`I won't suggest "${it.label}" again`);
        });
        box.append(b);
      });
      box.setAttribute("aria-label", list ? "Answers" : "Suggestions for you");
    };
    if (box.children.length && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      box.classList.add("leaving");
      chipsTimer = setTimeout(fill, 160);
    } else fill();
  }

  function openChat(acc, fresh) {
    account = acc;
    const prof = load(PROFILES_KEY) || {};
    prof[acc.plan] = { plan: acc.plan, name: acc.name, contact: acc.contact, id: acc.id, createdAt: acc.createdAt, team: acc.team || null };
    save(PROFILES_KEY, prof);
    $("open-switch").querySelector("b").textContent = acc.plan === "business" ? "Switch to Ervo Personal" : "Switch to Ervo for Business";
    $("open-switch").querySelector("small").textContent = acc.plan === "business" ? "Your own chats, Psyche and settings, kept apart from work" : "Your work Ervo, with its own chats and team";
    const p = PLAN[acc.plan];
    $("chat-avatar").src = lookSrc();
    $("menu-who").textContent = `${acc.name} · Ervo ${acc.plan === "business" ? "for Business" : "Personal"}${acc.team ? ` · ${acc.team.companyName}` : ""}`;
    applyTeamUI();
    if (acc.plan === "business" && realAuth) setTimeout(syncTeam, 800);
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
    if (OVERLAY) { setChips(null); return; } // the pop-up starts clean, but still knows the conversation
    if (id !== "main") sideBanner(saved);
    if (saved && saved.items.length) drawChat(saved);
    requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
    setTimeout(freshenSuggestions, 4000);
    if (id !== "main") { setChips(null); return; }
    // One greeting a day in the main chat: the first time Ervo opens that day
    const today = new Date().toDateString();
    if (fresh || load(GREETED_KEY) !== today) {
      save(GREETED_KEY, today);
      setTimeout(() => greet(fresh), fresh ? 250 : 0);
    } else {
      setChips(null);
    }
  }

  // ---------- greeting: short and simple: hi, name, date, weather, how can I help ----------
  function greetingText(firstTime) {
    const p = prefs();
    const name = p.nickname || account.name;
    const now = new Date();
    const h = now.getHours();
    void now; void h;
    const lines = [firstTime ? `Hi ${name}, I'm Ervo.` : `Hi ${name}, what can I help you with today?`];
    return { lines, firstTime, p };
  }

  const biz = () => account && account.plan === "business";
  async function greet(firstTime) {
    if (!load(INTRO_KEY)) showIntro();
    const g = greetingText(firstTime);
    const build = (async () => {
      const lines = g.lines.slice();
      if (g.firstTime && !biz()) {
        lines.push("I get to know you as we talk. What can I help you with today?");
        return { text: lines.join(" "), choices: ["Planning my days", "Food and groceries", "Shopping", "Skip for now"] };
      }
      if (biz()) {
        const co = account.team ? account.team.companyName : "your business";
        const known = psyche().facts.length;
        if (g.firstTime || known < 3) {
          return { text: `${g.firstTime ? lines[0] + " " : ""}Let's start with ${co}: what does the business do, and who are your customers? The more I know, the more I can take off your plate.`.replace(/^Hi (\w+), what can I help you with today\?\s*/, ""),
            chips: ["We're a restaurant", "We sell products online", "We offer a service", "Something else"] };
        }
        if (known < 8) return `Hi ${g.p.nickname || account.name}, what's happening at ${co} today? I still have a few things to learn about the business, so tell me as we go.`;
      }
      if (g.firstTime) lines.push("What can I help you with today?");
      return lines.join(" ");
    })();
    await ervoSays(build);
    if (g.p.news && allowed("location")) newsBubble();
    whatsNew(firstTime);
    checkMilestones(true);
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
  // Android keeps the city for the weather notice that comes after you close Ervo
  function pushPlace(place) {
    if (!(native && native.setPlace) || !place || !place.lat) return;
    const f = place.country ? ["US", "LR", "MM", "BS", "BZ", "KY", "PW"].includes(place.country) : /-US$/.test(navigator.language || "");
    try { native.setPlace(place.lat, place.lon, place.city || "", f); } catch (e) { /* older app */ }
  }
  async function getPlace() {
    const cached = load(PLACE_KEY);
    if (cached && Date.now() - cached.at < 3 * 60 * 60 * 1000) { pushPlace(cached); return cached; }
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
    pushPlace(place);
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
  const NEAR_RE = /\b(near me|nearby|near here|around me|around here|close to me|closest|nearest|in my (area|city|town)|local|near my (house|home|place))\b/;
  // Your city, fresh if it's allowed (waits a few seconds at most, then uses the last one)
  async function placeForAI() {
    if (!allowed("location")) return null;
    const cached = load(PLACE_KEY);
    if (cached && cached.city && Date.now() - cached.at < 3 * 60 * 60 * 1000) return cached;
    try { return await Promise.race([getPlace(), new Promise((r) => setTimeout(() => r(null), 5000))]) || cached || null; }
    catch (e) { return cached || null; }
  }
  async function askServer(extra, onText) {
    let place = null;
    try { place = await placeForAI(); } catch (e) { /* ignore */ }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 75000); // research with web search can take a bit
    try {
      const token = await freshToken();
      const r = await fetch(`${AI_URL}/chat`, {
        method: "POST",
        headers: Object.assign({ "content-type": "application/json" }, token ? { Authorization: `Bearer ${token}` } : {}),
        signal: ctrl.signal,
        body: JSON.stringify(Object.assign({
          plan: account.plan,
          name: prefs().nickname || account.name,
          team: teamForAI(),
          deviceId: deviceId(),
          testPlan: testPlan() || undefined,
          messages: history.slice(-16),
          psyche: psycheForServer(),
          memory: memory(),
          stream: !!onText,
          context: {
            now: new Date().toString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            location: place ? { city: place.city, region: place.region, country: place.country } : null,
          },
        }, extra || {})),
      });
      if (!r.ok && r.status !== 429) throw new Error(`server ${r.status}`);
      // Streaming (server 0.3.4+): {"t":"text","d":"..."} lines while Claude writes, then {"t":"done",...}
      if (onText && r.body && /ndjson/.test(r.headers.get("content-type") || "")) {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "", all = "", final = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            let ev;
            try { ev = JSON.parse(line); } catch (e) { continue; }
            if (ev.t === "text" && ev.d) { all += ev.d; try { onText(all); } catch (e) { /* keep reading */ } }
            else if (ev.t === "done") final = ev;
          }
        }
        if (!final) throw new Error("stream ended early");
        delete final.t;
        return final;
      }
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
  const KIND_NAMES = { health: "Health", food: "Food", goal: "Goals", likes: "Likes", dislikes: "Dislikes", people: "People", places: "Places", work: "Work", routine: "Routine", money: "Money", music: "Music", other: "Other",
    company: "Company", product: "Products & services", policy: "Policies", customers: "Customers", finance: "Finance", tools: "Tools", schedule: "Schedule", team: "Team" };
  const KIND_ICON = { health: "health", food: "food", goal: "star", likes: "heart", dislikes: "brain", people: "people", places: "location", work: "clock", routine: "clock", money: "money", music: "music", other: "brain",
    company: "home", product: "shop", policy: "book", customers: "people", finance: "money", tools: "open", schedule: "clock", team: "people" };
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

  // The AI writes plain sentences, but just in case: no **bold**, __underline__, # headings or `code` marks
  function plainText(x) {
    return String(x || "")
      .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1")
      .replace(/(^|\n)\s*[*-] (?=\S)/g, "$1• ")
      .replace(/(^|\s)#{1,6}\s+/g, "$1")
      .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
      .replace(/\*\*|__|##+/g, "")
      .replace(/[ \t]{2,}/g, " ").trim();
  }

  const PICTURE_RE = /\b(draw|sketch|paint|generate|make|create|design|render)\b.{0,40}\b(picture|image|drawing|logo|wallpaper|poster|illustration|art|icon)\b|\b(picture|image|drawing|logo|illustration) of\b/i;
  // What the status pill says while the AI works on it
  function guessStatus(d) {
    const t = d.t || "";
    if (d.intent === "photo") return ["📷", "Looking at your photo"];
    if (PICTURE_RE.test(t)) return ["🎨", "Drawing your picture"];
    if (/\b(meal plan|diet|lose weight|calories|macros|protein|eat healthier|eating plan)\b/.test(t)) return ["🥗", "Making your meal plan"];
    if (/\b(workout|work out|training plan|exercise|running plan|marathon|5k|10k|lift)\b/.test(t)) return ["💪", "Making your workout plan"];
    if (/\b(recipe|cook|bake|what should i (make|eat)|for dinner|for lunch|for breakfast)\b/.test(t)) return ["🍳", "Finding recipes"];
    if (/\b(grocer(y|ies)|shopping list)\b/.test(t)) return ["🛒", "Making your grocery list"];
    if (/\b(trip|travel|flight|hotel|vacation|itinerary)\b/.test(t)) return ["✈️", "Planning your trip"];
    if (/\b(packing)\b/.test(t)) return ["🧳", "Making your packing list"];
    if (/\b(song|songs|music|playlist|album|concert|artist)\b/.test(t)) return ["🎵", "Finding music"];
    if (/\b(gift|present)s?\b/.test(t)) return ["🎁", "Finding gift ideas"];
    if (d.intent === "plan") return ["🗓️", "Planning your day"];
    if (/\b(reserv\w*|book (a )?table|table for|appointment)\b/.test(t) || d.intent === "reserve") return ["🍽️", "Planning your reservation"];
    if (/\b(email|e-mail|text message|draft|reply|message to|write (a|an|the))\b/.test(t)) return ["✏️", "Writing a draft"];
    if (/\b(weather|forecast|rain|umbrella)\b/.test(t)) return ["🌤️", "Checking the weather"];
    if (/\b(order|package|delivery|deliver|shipped|shipping|tracking|refund|return)\b/.test(t)) return ["📦", "Tracking your order"];
    if (/\b(remind|reminder|alarm|timer)\b/.test(t)) return ["⏰", "Setting a reminder"];
    if (/\b(invoice|payment|bill|tax|bookkeeping|budget)\b/.test(t)) return ["💵", "Working on the numbers"];
    if (/\b(schedule|calendar|meeting|plan (my|the|a) (week|month))\b/.test(t) || d.intent === "event") return ["📅", "Planning"];
    if (NEAR_RE.test(t)) return ["📍", "Looking near you"];
    if (d.intent === "shop") return wantsAdvice(shopItem(d.raw) || "", d.t) ? ["🔍", "Researching options"] : ["🛍️", "Finding options"];
    if (/\b(how|what|why|when|where|who|which|best|recommend|compare)\b/.test(d.t)) return ["🔎", "Looking it up"];
    return ["💭", "Thinking"];
  }

  // Sends the message to Ervo's AI, then does what it asked for: show products,
  // offer to add an event, search Amazon, or change a setting. Anything that
  // opens another app still waits for your yes and your Allow.
  // These show their own message in the app (Added ✅, the alarm card...), so the AI's words would only repeat it
  const SELF_REPORTING = new Set(["add_calendar_event", "set_timer", "set_alarm", "dismiss_alarm", "edit_calendar_event", "remove_calendar_event", "call_contact", "plan_meeting"]);
  async function askAI(d, extra) {
    // "Find a pickup soccer game near me": ask once for location instead of asking for a city or zip
    if (!extra && d && NEAR_RE.test(d.t || "") && !allowed("location") && (connections().location || {}).status !== "denied") {
      await ensure("location", "Find things near you");
    }
    const status = guessStatus(d);
    showTyping(status[1], status[0]);
    setStatus(status[0], status[1]);
    // The answer appears word by word; the status at the top keeps saying what Ervo is doing
    let live = null;
    const onText = (all) => {
      const txt = plainText(all);
      if (!txt) return;
      if (!live) {
        hideTyping();
        live = document.createElement("div");
        live.className = "msg them streaming";
        live.dir = "auto";
        live.setAttribute("aria-live", "polite");
        thread.append(live);
      }
      live.textContent = txt;
      toBottom();
    };
    const result = askServer(extra, extra ? null : onText).then(async (j) => {
      if (j.usage) noteUsage(j.usage);
      if (j.limit) {
        return { text: plainText(j.reply), acts: [{ label: "See plans", icon: "star", onClick: openPlans }], limit: j.limit, model: j.model };
      }
      if (j.picture) return { text: plainText(j.reply), picture: j.picture, prompt: j.prompt || "", model: j.model };
      // Order cards need one yes (inside Ervo; nothing opens): Allow Order tracking
      if ((j.actions || []).some((a) => a.type === "track_order") && !allowed("orders")) {
        const ok = await ensure("orders", "Keep a card for this order, with a progress bar", true);
        if (!ok) j.actions = j.actions.filter((a) => a.type !== "track_order" && a.type !== "update_tracker");
      }
      // Learn first, so "use emojis" already shows in this reply
      // Learning can be turned off in Psyche (guideline 17); asked-for style changes ("use emojis") still apply
      const learning = prefs().learn !== false;
      const before = new Set(psyche().facts.map((f) => f.id));
      if (Array.isArray(j.psyche) && j.psyche.length) j.psyche.forEach((u) => learn(learning ? u : { style: u && u.style }));
      else if (learning && j.memories && j.memories.length) remember(j.memories);
      const learnedNow = psyche().facts.filter((f) => !before.has(f.id));
      const said = plainText(j.reply);
      const out = { text: said, products: [], chips: null, model: j.model };
      const afters = [];
      out.learned = learnedNow;
      out.quiet = (j.actions || []).some((a) => SELF_REPORTING.has(a.type));
      (j.actions || []).forEach((a) => {
        if (a.type === "send_to_teammate" && a.to && a.text) {
          afters.push(() => teamSend(String(a.to), String(a.text)));
        } else if (a.type === "track_order") {
          const tr = upsertTracker(a);
          if (tr) (out.trackers = out.trackers || []).push(tr);
        } else if (a.type === "update_tracker") {
          const tr = updateTracker(a);
          if (tr) (out.trackers = out.trackers || []).push(tr);
        } else if (a.type === "make_list") {
          const l = cleanList(a);
          if (l.items.length) out.list = l;
        } else if (a.type === "offer_choices" && Array.isArray(a.options)) {
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
          const um = String(a.repeat_until || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (["weekly", "every_2_weeks", "daily", "monthly"].includes(a.repeat)) {
            const until = um ? new Date(+um[1], +um[2] - 1, +um[3], 23, 59) : addDays(date, 91);
            if (!out.repeats) { out.repeats = []; afters.push(() => addRepeating(out.repeats)); }
            out.repeats.push({ tk, every: a.repeat, until });
          } else afters.push(() => runTask(tk));
        } else if ((a.type === "amazon_search" || a.type === "shop_search") && a.query) {
          task = { intent: "shop", item: String(a.query).slice(0, 80), store: STORES[a.store] ? a.store : "amazon" };
          confirming = true;
          out.chips = ["Yes", "No"];
        } else if (a.type === "show_links" && Array.isArray(a.links)) {
          out.acts = a.links.filter((l) => l && /^https:\/\//.test(String(l.url))).slice(0, 4)
            .map((l) => ({ label: String(l.title || "Open").slice(0, 60), icon: "open", href: String(l.url) }));
        } else if (a.type === "set_timer" && !(Number(a.seconds) >= 1 && Number(a.seconds) <= 86400)) {
          // a bad length (negative, zero, more than a day) never reaches the phone
        } else if (a.type === "set_alarm" && !(Number.isInteger(Number(a.hour)) && Number(a.hour) >= 0 && Number(a.hour) <= 23 && Number.isInteger(Number(a.minute || 0)) && Number(a.minute || 0) >= 0 && Number(a.minute || 0) <= 59)) {
          // a time that doesn't exist (hour 25, minute 75) never reaches the phone
        } else if (a.type === "set_timer" && a.seconds) {
          afters.push(() => doTimer(Math.round(Number(a.seconds)), String(a.label || "")));
        } else if (a.type === "set_alarm" && a.hour !== undefined) {
          afters.push(() => doAlarm({ h: Number(a.hour), m: Number(a.minute || 0), label: String(a.label || ""), days: Array.isArray(a.days) ? a.days.map(Number).filter((x) => x >= 1 && x <= 7) : [] }));
        } else if (a.type === "dismiss_alarm") {
          afters.push(() => alarmsOff({ h: a.hour === undefined || a.hour === null ? null : Number(a.hour), m: Number(a.minute || 0) }));
        } else if (a.type === "edit_calendar_event" && a.title) {
          const dm = String(a.new_date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
          const tm = String(a.new_time || "").match(/^(\d{1,2}):(\d{2})/);
          const when = dm || tm ? { date: dm ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : null, time: tm ? { h: +tm[1], m: +tm[2] } : null } : null;
          afters.push(() => editEvents({ target: String(a.title), newTitle: a.new_title ? String(a.new_title) : "", when }));
        } else if (a.type === "plan_meeting") {
          const dm = String(a.date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
          const tm = String(a.time || "").match(/^(\d{1,2}):(\d{2})/);
          afters.push(() => planMeeting({ app: ["meet", "zoom", "teams", "skype"].includes(a.platform) ? a.platform : "meet", who: String(a.with || ""), now: !!a.now, when: { date: dm ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : null, time: tm ? { h: +tm[1], m: +tm[2] } : null } }));
        } else if (a.type === "call_contact" && a.name) {
          afters.push(() => doCall(String(a.name)));
        } else if (a.type === "remove_calendar_event") {
          const m = String(a.date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
          const asked = parseRemove(d);
          afters.push(() => removeEvents({ title: String(a.title || ""), count: asked.count, all: asked.all, range: m ? dayRange(new Date(+m[1], +m[2] - 1, +m[3])) : asked.range }));
        } else if (a.type === "update_settings") {
          const p = prefs();
          if (a.nickname) p.nickname = String(a.nickname).slice(0, 30);
          ["weather", "news", "time", "date"].forEach((k) => { if (typeof a[k] === "boolean") p[k] = a[k]; });
          if (a.calendar === "phone" || a.calendar === "google") p.calendar = a.calendar;
          save(PREFS_KEY, p);
          if (a.theme === "dark" || a.theme === "light") themeHelp(a.theme);
        }
      });
      if (afters.length) out.after = async () => { for (const f of afters) await f(); };
      if (!out.text) {
        out.text = out.after ? "Done." : out.products.length || out.list || out.acts || out.choices ? "Here you go."
          : "Sorry, I didn't get an answer that time. Could you ask me again?";
      }
      // Long answers (meal plans, packing lists, how-tos) get a Share button: Notes, Keep, Messages, email...
      if (out.text.length > 380 || out.list) {
        const title = out.list ? out.list.title : (d.raw || "From Ervo").slice(0, 60);
        const body = out.list ? `${out.text}\n\n${listText(out.list)}` : out.text;
        out.acts = (out.acts || []).concat({ label: "Share", icon: "open", onClick: () => shareText(title, body) });
      }
      return out;
    }).catch(() => d.intent === "plan"
      ? { text: "I can't reach my AI right now, so here's a simple plan to start from. Tap what you want, then add it to your calendar.", list: localPlan(planDay(d)) }
      : navigator.onLine === false
      ? "Your phone is offline. Connect to Wi-Fi or mobile data, then ask again."
      : "I couldn't reach my AI service just now. Ask again in a moment.");
    const r = await result;
    if (r && r.quiet && r.after) {
      if (live) live.remove();
      hideTyping();
      idleStatus();
      return r.after();
    }
    // The streamed words become the real message (same text, no extra wait)
    if (live && (typeof r === "string" || !r || !r.text)) { live.remove(); live = null; }
    await ervoSays(r, { status, instant: !!live, replace: live, ai: typeof r === "object" && !!r, asked: d && d.raw });
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
    const re = /\b(\d+(?:\.\d+)?|half an?|forty five|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety)[\s-]*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(\s+and a half)?/g;
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
    const lab = t.match(/\b(?:to|so i can|so i) (?!(?:\d|wake\b|ring\b|go off\b|be\b|for\b|at\b|me\b))([a-z][a-z' ]{1,40})/);
    const label = lab ? lab[1].replace(/\s+((at|by|around|on|in|for|every)\s+(\d|noon|midnight|tomorrow|today|tonight|the (morning|evening|afternoon)|(sun|mon|tues|wednes|thurs|fri|satur)day|an? (hour|minute))|tomorrow|today|tonight|every|this|next|please|pls)\b.*$/, "").trim() : "";
    return { h, m: mi, days, label: label.length > 1 ? cap(label) : "" };
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
  const EMERGENCY_RE = /\b(911|9-1-1|112|999|988|emergency|police|cops|ambulance|paramedics?|fire ?(department|dept|fighters?|station)|poison control|suicide (hotline|line|prevention)|crisis (line|hotline))\b/;
  function emergencyReply(crisis) {
    if (crisis) {
      const acts = native && native.dialNumber
        ? [{ label: "Open dialer with 988", icon: "phone", onClick: () => native.dialNumber("988") }]
        : [{ label: "Call 988", icon: "phone", href: "tel:988" }];
      return ervoSays("I'm really glad you reached out. I can't call emergency services or crisis lines for you, but you can call or text 988 right now to talk with someone at the Suicide & Crisis Lifeline, any time of day. If you're in danger, call 911 💙", { acts: acts.concat([{ label: "Text 988", icon: "open", href: "sms:988" }]) });
    }
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
    const two = String(text).match(/^(.*\b(?:alarm|timer|wake me)\b.*?)\s*(?:,\s*)?\b(?:and|then|also|plus)\s+(?:(?:set|start|make|add)\s+)?((?:an?\s+|the\s+|another\s+)?(?:alarm|timer)\b.+)$/i);
    if (two && !task && !clockAsk && parseDuration(two[2]) + (parseWhen(two[2].toLowerCase(), new Date(), false).time ? 1 : 0) > 0) {
      return Promise.resolve(reply(two[1])).then(() => reply(/^set\b/i.test(two[2]) ? two[2] : `set ${two[2]}`));
    }
    const mixed = String(text).match(/^(.{8,}?)\s*,?\s+(?:and|then|also|plus)\s+(?:can you\s+|please\s+)?(?:set|start|make)\s+(?:me\s+)?(?:an?|the|another)\s+(?:\d+\s*\w+\s+)?(?:alarm|timer)\b/i);
    if (mixed && AI_URL && !task && !/\b(alarm|timer|wake me)\b/i.test(mixed[1])) return askAI(understand(text));
    { const nick = String(text).trim().match(/^(?:please |hey ervo,? )?(?:you can )?(?:call me|my nickname is|nickname me) ([a-z][\w'-]{1,20})[.!]?$/i);
      if (nick) { const p = prefs(); p.nickname = nick[1]; save(PREFS_KEY, p); logActivity({ kind: "settings", ico: "star", title: `Now calls you ${nick[1]}` }); return ervoSays(`Got it, ${nick[1]} it is 😊`, { instant: true }); } }
    if (account.team) { const ts = matchTeamSend(text); if (ts) return teamSend(ts.to, ts.text); }
    { const on = String(text).trim().match(/^(\d{3}-\d{7}-\d{7})$/); if (on) return orderNumberReply(on[1]); }
    { const tn = String(text).trim().replace(/\s+/g, ""); const car = tn.length >= 10 && !/\s/.test(tn) ? carrierFor(tn) : null; if (car && !/[a-z]{4,}/i.test(tn.replace(/^TBA|^JD/i, ""))) return trackNumberReply(tn, car); }
    const d = understand(text);
    if (calendarAsk(d.t) && !/(stats|activity|what (have|did) you|add|put|schedule|set up|create|book|make|move|remove|delete|cancel|remind|alarm|timer)/i.test(d.t.replace(/\bwhat'?s? (on|planned|scheduled)\b/, "x"))) return calendarReply(d);
    const biz = account.plan === "business";
    if (account.team && account.team.role === "employee" && ["steps", "shop"].includes(d.intent)) {
      return ervoSays(`This Ervo is set up for work at ${account.team.companyName}, so I keep to work things here. A Personal account can help with that.`);
    }

    // Personal and Business stay strictly separate
    if (!biz && BUSINESS_WORDS.test(d.t) && d.intent !== "event") {
      task = null; confirming = false;
      return ervoSays("That sounds like a business task. Ervo Personal is for personal use only, so I can't help with customers or company work. Ervo for Business is built for that.");
    }
    if (biz && PERSONAL_WORDS.test(d.t) && !BUSINESS_CONTEXT.test(d.t)) {
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
    if (d.intent === "emergency") return emergencyReply(d.crisis);
    if (d.intent === "wake") return heyErvo(d.wakeTurn);
    if (d.intent === "look") return openLook();
    if (d.intent === "leaveAlert") return openLeave(d.when.time);
    // Ervo asked "when is it?": a day or "this week" answers it
    if (removeAsk) {
      const q = removeAsk;
      removeAsk = null;
      const r = parseRemove(d);
      if (r.range || r.count || (d.intent === "unknown" && r.title && d.t.split(/\s+/).length <= 4)) return removeEvents(Object.assign({}, q, r, { title: r.title || q.title }));
    }
    if (AI_URL && ["unknown", "event", "reserve", "shop", "plan", "yes", "no"].includes(d.intent)) return askAI(d);

    switch (d.intent) {
      case "settings": return applySettings(d.settings);
      case "reserve": case "event": case "shop": {
        task = newTask(d);
        if (biz && d.intent === "event" && task.title === "New event") task.title = "Meeting";
        return missing(task).length ? askForMissing(task) : propose(task);
      }
      case "plan": return ervoSays({ text: "Here's an idea for the day. Tap what you want, then add it to your calendar.", list: localPlan(planDay(d)) });
      case "yes": return ervoSays("Okay. What should I do?");
      case "no": return ervoSays("No problem.");
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
        // Nothing opens: Ervo makes the card here (after one Allow), and the card's own buttons go to the store
        if (AI_URL) return ensure("orders", d.intent === "track" ? "Keep a card for this order, with a progress bar" : "Keep a card for this return").then((ok) => (ok ? askAI(d) : null));
        const url = "https://www.amazon.com/gp/css/order-history";
        return ervoSays(`I can't reach my AI right now. Your Amazon orders page has the live ${d.intent === "track" ? "tracking" : "return options"}.`, { acts: [{ label: "Your orders", icon: "shop", href: url }] });
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
          : "I'm not sure what you mean yet. Could you say it another way?",
        { chips: biz ? ["A customer", "A refund", "A meeting"] : null });
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
    const cal = { label: "Calendar", icon: "calendar", onClick: () => openCalendar(new Date()) };
    if (!up.length) return ervoSays("Nothing coming up yet. Want me to plan something?", { acts: [cal, open], chips: ["Plan tomorrow", "Plan my week"] });
    const lines = up.slice(0, 4).map((a) => `• ${a.title}, ${whenText(a)}`);
    return ervoSays(`Coming up:\n${lines.join("\n")}`, { acts: [cal, open] });
  }

  // ---------- "What do I have Friday?": the day as a card, like the one in the video ----------
  const calendarAsk = (t) => /\b(my (calendar|schedule|agenda|day|week|plans)|what (do|did|have) i (have|got)( going on| planned)?|what('?s| is) (on|planned|scheduled|happening)( for| on)? (today|tomorrow|tonight|this (week|weekend)|(mon|tues|wednes|thurs|fri|satur|sun)day)|(anything|something) (on|planned|scheduled|going on)|am i (free|busy)|do i have (anything|something|plans)|show (me )?(my )?calendar|open (my |the )?calendar)\b/i.test(String(t || ""));
  const EVENT_EMOJI = [
    [/gym|workout|lift|run\b|yoga|training|practice/i, "💪"], [/soccer|match|game\b/i, "⚽"], [/call|meeting|zoom|teams|standup|sync|interview/i, "📞"],
    [/lunch|dinner|breakfast|brunch|coffee|reservation|table/i, "🍽️"], [/doctor|checkup|clinic|physical/i, "🩺"], [/dentist|teeth|cleaning/i, "🦷"],
    [/flight|airport|fly\b/i, "✈️"], [/birthday|party|celebrat/i, "🎉"], [/class|lecture|school|exam|study/i, "📚"], [/concert|show|music|festival/i, "🎵"],
    [/haircut|salon|barber|nails/i, "✂️"], [/pay|rent|bill|invoice|tax/i, "💵"], [/groceries|shopping|store|pick ?up/i, "🛒"], [/oil change|car|mechanic|dmv/i, "🚗"],
    [/clean|laundry|chores|room/i, "🧹"], [/movie|film|cinema/i, "🎬"], [/date night|anniversary/i, "❤️"], [/vet|dog|cat|pet/i, "🐾"],
  ];
  const eventEmoji = (title) => (EVENT_EMOJI.find(([re]) => re.test(String(title || ""))) || [null, "📅"])[1];
  async function eventsOn(day) {
    const from = startOfDay(day), to = addDays(from, 1);
    const seen = new Set();
    const list = [];
    const push = (title, start, allDay, source) => { const k = `${String(title).trim().toLowerCase()}|${allDay ? "all" : new Date(start).getTime()}`; if (seen.has(k)) return; seen.add(k); list.push({ title, start: new Date(start), allDay, source }); };
    activity().filter((a) => a.when && new Date(a.when) >= from && new Date(a.when) < to).forEach((a) => push(a.title, a.when, a.allDay, "Ervo"));
    if (native && native.findEvents && native.calendarAllowed && native.calendarAllowed()) {
      try { const r = await readCalendar("", { from, to }); if (r.status === "ready") r.events.forEach((e) => push(e.title || "(No title)", e.start, e.allDay, e.calendar || "Calendar")); } catch (e) { /* phone calendar unavailable */ }
    }
    list.sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || a.start - b.start);
    return list;
  }
  async function calendarReply(d) {
    const day = d.when && d.when.date ? d.when.date : new Date();
    const events = await eventsOn(day);
    const name = sameDay(day, new Date()) ? "today" : sameDay(day, addDays(new Date(), 1)) ? "tomorrow" : `on ${dayName(day)}`;
    const text = events.length ? `Here's ${name}: ${events.length} thing${events.length === 1 ? "" : "s"}.` : `Nothing on your calendar ${name}. Want me to plan something?`;
    return ervoSays(text, { calendar: { date: day, events }, chips: events.length ? null : ["Plan tomorrow", "Plan my week"] });
  }
  function showCalendarCard(date, events, save) {
    const day = new Date(date);
    const card = document.createElement("div");
    card.className = "calcard glass";
    const head = document.createElement("div");
    head.className = "cc-head";
    head.innerHTML = `<span class="cc-ico">${e3d("📅")}</span><b>${sameDay(day, new Date()) ? "Today" : dayName(day)}</b><small>${day.toLocaleDateString(undefined, { month: "long", day: "numeric" })}</small>`;
    card.append(head);
    if (sameDay(day, new Date()) && allowed("location")) {
      const w = document.createElement("span"); w.className = "cc-weather"; head.append(w);
      weatherNow().then((x) => { w.innerHTML = `${e3d(x.emoji)} <b>${x.temp}°</b>`; }).catch(() => w.remove());
    }
    const list = document.createElement("div");
    list.className = "cc-list";
    if (!events.length) { const p = document.createElement("p"); p.className = "cc-empty"; p.textContent = "Nothing planned."; list.append(p); }
    events.slice(0, 8).forEach((ev) => {
      const row = document.createElement("div");
      row.className = "cc-row";
      const t = ev.allDay ? "All day" : new Date(ev.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      row.innerHTML = `<span class="cc-emoji">${e3d(eventEmoji(ev.title))}</span><span class="cc-time">${t}</span><span class="cc-title"></span><small class="cc-src"></small>`;
      row.querySelector(".cc-title").textContent = ev.title;
      row.querySelector(".cc-src").textContent = ev.source === "Ervo" ? "Ervo" : "";
      list.append(row);
    });
    card.append(list);
    const foot = document.createElement("div");
    foot.className = "cc-foot";
    const open = document.createElement("button"); open.type = "button"; open.className = "pill ghost"; open.textContent = "Open calendar"; open.addEventListener("click", () => openCalendar(day));
    const plan = document.createElement("button"); plan.type = "button"; plan.className = "pill"; plan.textContent = "Plan this day"; plan.addEventListener("click", () => send(`Plan ${sameDay(day, new Date()) ? "today" : sameDay(day, addDays(new Date(), 1)) ? "tomorrow" : dayName(day)}`));
    foot.append(open, plan);
    card.append(foot);
    thread.append(card);
    if (save) record({ t: "calcard", date: day.toISOString(), events: events.map((e) => ({ title: e.title, start: new Date(e.start).toISOString(), allDay: !!e.allDay, source: e.source })) });
    toBottom();
    return card;
  }

  // ---------- Calendar pop-up: a month, with dots on busy days, and the day's events with 3D icons ----------
  let calMonth = new Date();
  let calDay = new Date();
  let calCache = {}; // "YYYY-M" -> events
  async function monthEvents(month) {
    const key = `${month.getFullYear()}-${month.getMonth()}`;
    if (calCache[key]) return calCache[key];
    const from = new Date(month.getFullYear(), month.getMonth(), 1), to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const list = activity().filter((a) => a.when && new Date(a.when) >= from && new Date(a.when) < to).map((a) => ({ title: a.title, start: new Date(a.when), allDay: a.allDay, source: "Ervo" }));
    if (native && native.findEvents && native.calendarAllowed && native.calendarAllowed()) {
      try { const r = await readCalendar("", { from, to }); if (r.status === "ready") r.events.forEach((e) => list.push({ title: e.title || "(No title)", start: new Date(e.start), allDay: e.allDay, source: e.calendar || "Calendar" })); } catch (e) { /* fine */ }
    }
    calCache[key] = list;
    return list;
  }
  async function openCalendar(day) {
    toggleMenu(false);
    calDay = new Date(day || new Date());
    calMonth = new Date(calDay.getFullYear(), calDay.getMonth(), 1);
    calCache = {};
    $("calsheet").hidden = false;
    await renderCalendar();
  }
  async function renderCalendar() {
    $("cal-title").textContent = calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const grid = $("cal-grid");
    grid.innerHTML = "";
    ["S", "M", "T", "W", "T", "F", "S"].forEach((d) => { const h = document.createElement("span"); h.className = "cal-dow"; h.textContent = d; grid.append(h); });
    const events = await monthEvents(calMonth);
    const busy = new Set(events.map((e) => startOfDay(e.start).getTime()));
    const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
    for (let i = 0; i < first.getDay(); i++) { const s = document.createElement("span"); grid.append(s); }
    const days = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
    for (let n = 1; n <= days; n++) {
      const d = new Date(calMonth.getFullYear(), calMonth.getMonth(), n);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `cal-day${sameDay(d, new Date()) ? " today" : ""}${sameDay(d, calDay) ? " picked" : ""}${busy.has(d.getTime()) ? " busy" : ""}`;
      b.setAttribute("role", "gridcell");
      b.setAttribute("aria-label", d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
      b.innerHTML = `<span>${n}</span><i></i>`;
      b.addEventListener("click", () => { calDay = d; renderCalendar(); buzz("tick"); });
      grid.append(b);
    }
    $("cal-day-title").textContent = `${sameDay(calDay, new Date()) ? "Today, " : ""}${calDay.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`;
    const box = $("cal-events");
    box.innerHTML = "";
    const todays = events.filter((e) => sameDay(e.start, calDay)).sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || a.start - b.start);
    if (!todays.length) { const p = document.createElement("p"); p.className = "cc-empty"; p.textContent = "Nothing planned. Tell Ervo and it goes here."; box.append(p); }
    todays.forEach((ev) => {
      const row = document.createElement("div");
      row.className = "cc-row";
      const t = ev.allDay ? "All day" : ev.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      row.innerHTML = `<span class="cc-emoji">${e3d(eventEmoji(ev.title))}</span><span class="cc-time">${t}</span><span class="cc-title"></span><small class="cc-src"></small>`;
      row.querySelector(".cc-title").textContent = ev.title;
      row.querySelector(".cc-src").textContent = ev.source === "Ervo" ? "Ervo" : "";
      box.append(row);
    });
  }
  $("cal-prev").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); });
  $("cal-next").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); });
  $("cal-done").addEventListener("click", () => { $("calsheet").hidden = true; });
  $("calsheet").addEventListener("click", (e) => { if (e.target === $("calsheet")) $("calsheet").hidden = true; });
  $("cal-open-app").addEventListener("click", () => {
    const ms = new Date(calDay.getFullYear(), calDay.getMonth(), calDay.getDate(), 9).getTime();
    if (native && native.openUrl) openOutside(`content://com.android.calendar/time/${ms}`);
    else openOutside(`https://calendar.google.com/calendar/u/0/r/day/${calDay.getFullYear()}/${calDay.getMonth() + 1}/${calDay.getDate()}`);
  });

  // ---------- Orders, returns and refunds: cards with a progress bar, like the video ----------
  // Ervo can't read anyone's orders out of a store's app; it tracks what you tell it or paste,
  // and takes you to the store's own page or the carrier for the live details.
  const TRACK_KEY = "ervo-trackers";
  const STORES_DIR = window.ERVO_STORES || {};
  const CARRIERS = window.ERVO_CARRIERS || [];
  const STEPS = { order: ["Ordered", "Shipped", "Out for delivery", "Delivered"], return: ["Requested", "Label sent", "Dropped off", "Refunded"], refund: ["Requested", "Approved", "Refunded"] };
  const trackers = () => load(TRACK_KEY) || [];
  const saveTrackers = (list) => save(TRACK_KEY, list.slice(-60));
  function storeKey(name) {
    const n = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!n) return "";
    if (STORES_DIR[n]) return n;
    const hit = Object.keys(STORES_DIR).find((k) => STORES_DIR[k].name.toLowerCase().replace(/[^a-z0-9]/g, "") === n || n.includes(k));
    return hit || "";
  }
  function carrierFor(num) {
    const n = String(num || "").replace(/\s+/g, "");
    if (!n) return null;
    return CARRIERS.find((c) => c.key !== "any" && c.test.test(n)) || null;
  }
  function stepIndex(kind, status) {
    const steps = STEPS[kind] || STEPS.order;
    const s = String(status || "").toLowerCase();
    if (!s) return 0;
    const i = steps.findIndex((x) => x.toLowerCase() === s);
    if (i >= 0) return i;
    if (/deliver(ed)?$|arrived|received|complete/.test(s) && kind === "order") return 3;
    if (/out for|on (its|the) way|arriving today|driver/.test(s)) return 2;
    if (/ship|transit|label created|on the way|left/.test(s)) return 1;
    if (/refund(ed)?$|money back|credited/.test(s)) return steps.length - 1;
    if (/approved|accepted/.test(s)) return kind === "refund" ? 1 : 2;
    if (/dropped|drop(ped)? off|handed|scanned/.test(s)) return 2;
    if (/label/.test(s)) return 1;
    return 0;
  }
  function upsertTracker(a) {
    const kind = ["order", "return", "refund"].includes(a.kind) ? a.kind : "order";
    const key = storeKey(a.store);
    const list = trackers();
    const title = String(a.title || a.items && a.items[0] || "Order").slice(0, 80);
    const tracking = String(a.tracking || "").replace(/\s+/g, "").slice(0, 40);
    const car = a.carrier ? CARRIERS.find((c) => c.name.toLowerCase().startsWith(String(a.carrier).toLowerCase().slice(0, 4))) : carrierFor(tracking);
    let t = list.find((x) => !x.done && ((tracking && x.tracking === tracking) || (x.kind === kind && x.title.toLowerCase() === title.toLowerCase())));
    if (!t) { t = { id: `tr${Date.now().toString(36)}`, kind, createdAt: new Date().toISOString() }; list.push(t); }
    Object.assign(t, {
      kind, store: key, storeName: key ? STORES_DIR[key].name : String(a.store || "").slice(0, 30), title, price: String(a.price || t.price || "").slice(0, 20),
      items: Array.isArray(a.items) ? a.items.slice(0, 8).map((x) => String(x).slice(0, 60)) : t.items || [],
      steps: STEPS[kind], step: Math.max(stepIndex(kind, a.status), t.step || 0), eta: String(a.eta || t.eta || "").slice(0, 60), etaDate: dateOnly(a.eta_date) || t.etaDate || "",
      tracking: tracking || t.tracking || "", carrier: car ? car.key : t.carrier || "", orderNo: String(a.order_number || t.orderNo || "").replace(/\s+/g, "").slice(0, 40),
      note: cleanNote(a.note) || t.note || "", source: SOURCES.includes(a.source) ? a.source : t.source || "you", checkedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    t.done = t.step >= t.steps.length - 1;
    saveTrackers(list);
    scheduleTrackerNotices(t);
    logActivity({ kind: "track", ico: "shop", title: `${kind === "order" ? "Tracking" : kind === "return" ? "Return" : "Refund"}: ${t.title}`, detail: `${t.storeName || ""} · ${t.steps[t.step]}` });
    return t;
  }
  const SOURCES = ["you", "store", "carrier"];
  const dateOnly = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
  // Notes that only repeat the card's buttons aren't notes
  const cleanNote = (v) => { const n = String(v || "").trim().slice(0, 160); return !n || /\b(tap|press|click)\b.*\b(open|track|button)\b/i.test(n) ? "" : n; };
  // The day it should arrive: the exact date when Ervo has one, else what "Thursday" or "Nov 13" means
  function etaDateOf(t) {
    if (t.etaDate) { const d = new Date(`${t.etaDate}T12:00`); if (!isNaN(d)) return d; }
    if (t.eta && !/\d+\s*(to|-)\s*\d+\s*days?/i.test(t.eta)) { try { const w = parseWhen(String(t.eta).toLowerCase(), new Date(), false); if (w && w.date) return w.date; } catch (e) { /* not a date */ } }
    return null;
  }
  // Phone reminders: the evening before and the morning it should arrive; or a check-in two days after it shipped
  function scheduleTrackerNotices(t) {
    if (!native || !native.scheduleNotice) return;
    ["eve", "day", "way"].forEach((k) => native.cancelNotice(`${t.id}-${k}`));
    if (t.done || t.kind !== "order") return;
    const now = Date.now();
    const at = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.getTime(); };
    const eta = etaDateOf(t);
    const where = t.storeName ? ` from ${t.storeName}` : "";
    if (eta) {
      const eve = at(addDays(eta, -1), 18), day = at(eta, 9);
      if (eve > now) native.scheduleNotice(`${t.id}-eve`, eve, `${t.title} arrives tomorrow`, `Your order${where} is on the way. Tap to see the card.`);
      if (day > now) native.scheduleNotice(`${t.id}-day`, day, `${t.title} should arrive today`, "Tell me when it lands and I'll mark it delivered.");
    } else if (t.step >= 1) {
      native.scheduleNotice(`${t.id}-way`, at(addDays(new Date(), 2), 10), `${t.title} is on the way`, "Has it arrived? Tell me and I'll update the card.");
    }
  }
  // An Amazon order number on its own: the card is made right away and saved in Files
  function orderNumberReply(num) {
    const run = () => {
      const t = upsertTracker({ kind: "order", store: "Amazon", title: "Amazon order", order_number: num, status: "ordered", source: "you" });
      return ervoSays("Saved. That looks like an Amazon order number, so I made a card for it; you'll find it under Files too. What's in the order, and when does Amazon say it arrives? I'll fill it in and remind you the day before.", { trackers: [t], instant: true });
    };
    return ensure("orders", "Keep a card for your orders, returns and refunds").then((ok) => (ok ? run() : null));
  }
  function updateTracker(a) {
    const list = trackers();
    const want = String(a.match || a.title || a.store || "").toLowerCase();
    let t = list.filter((x) => !x.done).reverse().find((x) => !want || x.title.toLowerCase().includes(want) || (x.storeName || "").toLowerCase().includes(want) || x.id === want);
    if (!t) t = list.filter((x) => !x.done).pop();
    if (!t) return null;
    if (a.status) t.step = Math.max(t.step, stepIndex(t.kind, a.status));
    if (a.eta) t.eta = String(a.eta).slice(0, 60);
    if (dateOnly(a.eta_date)) t.etaDate = a.eta_date;
    if (a.order_number) t.orderNo = String(a.order_number).replace(/\s+/g, "").slice(0, 40);
    if (a.note !== undefined) t.note = cleanNote(a.note);
    if (a.tracking) { t.tracking = String(a.tracking).replace(/\s+/g, "").slice(0, 40); const c = carrierFor(t.tracking); if (c) t.carrier = c.key; }
    if (a.done === true) t.step = t.steps.length - 1;
    if (SOURCES.includes(a.source)) t.source = a.source;
    t.checkedAt = new Date().toISOString();
    t.done = t.step >= t.steps.length - 1;
    t.updatedAt = new Date().toISOString();
    saveTrackers(list);
    scheduleTrackerNotices(t);
    return t;
  }
  function advanceTracker(id) {
    const list = trackers();
    const t = list.find((x) => x.id === id);
    if (!t || t.done) return;
    t.step = Math.min(t.steps.length - 1, t.step + 1);
    t.done = t.step >= t.steps.length - 1;
    t.source = "you";
    t.checkedAt = new Date().toISOString();
    t.updatedAt = new Date().toISOString();
    saveTrackers(list);
    scheduleTrackerNotices(t);
    document.querySelectorAll(`.tracker[data-id="${id}"]`).forEach((el) => el.replaceWith(trackerEl(t)));
    if (t.done) { buzz("confirm"); ervoSays(t.kind === "order" ? `${t.title} is delivered 🎉` : `${t.title}: refund done ✅`, { instant: true }); }
  }
  function removeTracker(id) {
    saveTrackers(trackers().filter((x) => x.id !== id));
    document.querySelectorAll(`.tracker[data-id="${id}"]`).forEach((el) => el.remove());
    toast("Removed");
  }
  function trackNumberReply(num, car) {
    const run = () => {
      const t = upsertTracker({ kind: "order", title: "Package", tracking: num, carrier: car.name, status: "shipped", source: "you" });
      return ervoSays(`That's a ${car.name} tracking number. I made a card for it (it's under Files too); tap Track package for ${car.name}'s live details, or tell me what's in it and I'll name the card.`, { trackers: [t], instant: true });
    };
    return ensure("orders", "Keep a card for your orders, returns and refunds").then((ok) => (ok ? run() : null));
  }
  function trackerEl(t) {
    const store = STORES_DIR[t.store];
    const car = CARRIERS.find((c) => c.key === t.carrier);
    const el = document.createElement("div");
    el.className = `tracker glass${t.done ? " done" : ""}`;
    el.dataset.id = t.id;
    const badge = store ? `<span class="tk-badge">${e3d(store.e)}</span>` : `<span class="tk-badge letter" style="--c:${(car && car.color) || "var(--tint)"}">${(t.storeName || (car && car.name) || "P").slice(0, 1).toUpperCase()}</span>`;
    const chipText = t.done ? t.steps[t.steps.length - 1] : t.steps[t.step];
    const kindText = t.kind === "order" ? "Order" : t.kind === "return" ? "Return" : "Refund";
    el.innerHTML = `
      <div class="tk-head">${badge}<div class="tk-text"><b></b><small></small></div><span class="tk-chip ${t.done ? "ok" : ""}"></span></div>
      <div class="tk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${t.steps.length - 1}" aria-valuenow="${t.step}"><div class="tk-fill" style="--p:${(t.step / (t.steps.length - 1)) * 100}%"></div>${t.steps.map((s, i) => `<i class="tk-dot${i <= t.step ? " on" : ""}${i === t.step && !t.done ? " now" : ""}" style="left:${(i / (t.steps.length - 1)) * 100}%"></i>`).join("")}</div>
      <div class="tk-steps">${t.steps.map((s, i) => `<span class="${i === t.step ? "now" : ""}">${s}</span>`).join("")}</div>
      <p class="tk-source"></p>
      <div class="tk-rows"></div>
      <div class="tk-acts"></div>`;
    el.querySelector(".tk-text b").textContent = t.title;
    el.querySelector(".tk-text small").textContent = [t.storeName || (car && car.name), kindText, t.price].filter(Boolean).join(" · ");
    el.querySelector(".tk-chip").textContent = chipText;
    // Honest about what's live: a card from their words is an estimate, not a tracking update
    const src = el.querySelector(".tk-source");
    const when = t.checkedAt ? new Date(t.checkedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    if (t.done) src.textContent = `Marked ${t.steps[t.steps.length - 1].toLowerCase()} ${when}`;
    else if (t.source === "carrier") { src.textContent = `${car ? car.name : "Carrier"} update · ${when}`; src.classList.add("live"); }
    else if (t.source === "store") src.textContent = `From your ${t.storeName || "store"} order details · ${when}`;
    else src.textContent = "From what you told Ervo · not a live update";
    const rows = el.querySelector(".tk-rows");
    const row = (emoji, label, value) => { const r = document.createElement("div"); r.className = "tk-row"; r.innerHTML = `<span class="tk-remoji">${e3d(emoji)}</span><span class="tk-rlabel"></span><span class="tk-rvalue"></span>`; r.querySelector(".tk-rlabel").textContent = label; r.querySelector(".tk-rvalue").textContent = value; rows.append(r); return r; };
    if (t.eta) row(t.kind === "order" ? "🚚" : "💵", t.kind === "order" ? (t.done ? "Delivered" : "Arrives") : "Refund", t.eta);
    if (t.orderNo) { const r = row("🧾", "Order #", t.orderNo); r.classList.add("tap"); r.title = "Copy"; r.addEventListener("click", async () => { toast((await copyText(t.orderNo)) ? "Order number copied" : "Couldn't copy"); }); }
    if (t.tracking) { const r = row("🔎", car ? car.name : "Tracking", t.tracking); r.classList.add("tap"); r.title = "Copy"; r.addEventListener("click", async () => { toast((await copyText(t.tracking)) ? "Tracking number copied" : "Couldn't copy"); }); }
    if (t.items && t.items.length > 1) row("🧾", "Items", t.items.join(", "));
    if (t.note) row("📝", "Note", t.note);
    const acts = el.querySelector(".tk-acts");
    const act = (label, cls, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = `pill ${cls || "ghost"}`; b.textContent = label; b.addEventListener("click", fn); acts.append(b); };
    if (store) act(`Open ${store.name}`, "ghost", () => { logActivity({ kind: "track", ico: "shop", title: `Opened ${store.name} orders` }); openOutside(t.kind === "order" ? store.orders : store.returns); });
    if (t.tracking && car) act("Track package", "ghost", () => openOutside(car.url(t.tracking)));
    if (!t.done) act("Check status", "ghost", () => send(`Check the status of my ${t.storeName || ""} ${t.kind}: ${t.title}${t.tracking ? ` (tracking ${t.tracking})` : ""}`.replace(/\s+/g, " ")));
    if (!t.done) act(t.step >= t.steps.length - 2 ? (t.kind === "order" ? "It arrived" : "Refund received") : "Next step", "", () => advanceTracker(t.id));
    if (t.done) act("Remove", "ghost", () => removeTracker(t.id));
    return el;
  }
  function showTracker(t) {
    const el = trackerEl(t);
    thread.append(el);
    toBottom();
    return el;
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
    const s = await readSteps();
    if (s.status === "ready") {
      const goal = prefs().stepsGoal;
      const left = goal - s.today;
      return ervoSays(`You've taken ${s.today.toLocaleString()} steps today. ${left > 0 ? `${left.toLocaleString()} more to reach your ${goal.toLocaleString()} goal 💪` : "You hit your goal! 🎉"}`);
    }
    if (s.status === "web") return ervoSays("Steps work in the Android app right now. On iPhone they'll come with the App Store version, because Apple only shares Health data with installed apps.");
    const acts = native && native.requestSteps ? [{ label: "Connect Health", icon: "health", onClick: async () => { if (await ensure("health", "Read your steps from Health Connect")) native.requestSteps(); } }] : null;
    return ervoSays("I need permission to read your steps from Health Connect first.", { acts });
  }

  // The day a plan request is about: today, tomorrow (the default) or this weekend
  function planDay(d) {
    const today = startOfDay(new Date());
    if (/\btoday\b|\btonight\b/.test(d.t)) return today;
    if (/\bweekend\b|\bsaturday\b/.test(d.t)) { const n = (6 - today.getDay() + 7) % 7; return addDays(today, n); }
    if (d.when && d.when.date && d.when.date > today) return startOfDay(d.when.date);
    return addDays(today, 1);
  }

  function send(text, byVoice) {
    const v = text.trim();
    if (!v || !account) return;
    thread.querySelectorAll(".choices button:not(:disabled)").forEach((b) => { b.disabled = true; });
    bubble(v, "me");
    buzz("tap");
    toBottom(true);
    history.push({ role: "user", text: v });
    $("chips").innerHTML = ""; $("chips").dataset.sig = "";
    lastWasVoice = !!byVoice;
    bumpUsage();
    setTimeout(() => checkMilestones(false), 2500);
    // Feedback on the last answer goes to the AI as a lesson, then a corrected answer
    if (feedbackFor !== null) {
      const about = feedbackFor;
      feedbackFor = null;
      $("message").placeholder = "Message Ervo";
      return askAI(understand(`Feedback on your last answer${about ? ` to "${about.slice(0, 120)}"` : ""}: ${v}. Save a short lesson with update_psyche so it doesn't happen again, say in one sentence what you'll do differently, then give the corrected answer.`));
    }
    reply(v);
  }
  let feedbackFor = null;

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
    setRowIcon(i, ico);
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
    fetchUsage();
    const now = new Date();
    $("stats-date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    $("stats-title").textContent = `${prefs().nickname || account.name}'s Ervo Stats`;
    setSky(null);
    $("sky-now").hidden = true;
    if (allowed("location")) {
      weatherNow().then((w) => {
        setIco($("sky-emoji"), w.emoji);
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
    renderUsage();
    renderBadges();
    if (native && native.findEvents && native.calendarAllowed && native.calendarAllowed()) {
      readCalendar("", { from: now, to: addDays(startOfDay(now), 15) }).then((r) => {
        if (r.status !== "ready" || !$("stats").classList.contains("active")) return;
        const seen = new Set(r.events.map((e) => dayKey(e.title, e.start)));
        const mine = planned.filter((p) => !seen.has(dayKey(p.title, p.start)));
        drawUpcoming(mine.concat(r.events.map((e) => ({ title: e.title || "(No title)", start: new Date(e.start), allDay: e.allDay, ico: "calendar", detail: e.calendar }))));
      });
    }
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
  }

  // ----- Usage: messages today against the plan's daily allowance (shown here; the server has no hard cap yet) -----
  const USAGE_KEY = "ervo-usage";
  const DAILY = { personal: 150, business: 400 };
  const dayKeyOf = (d) => { const x = d || new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const usage = () => Object.assign({ total: 0, days: {} }, load(USAGE_KEY) || {});
  function bumpUsage() {
    const u = usage();
    const k = dayKeyOf();
    u.days[k] = (u.days[k] || 0) + 1;
    u.total += 1;
    Object.keys(u.days).sort().slice(0, -90).forEach((d) => delete u.days[d]); // keep about 3 months
    save(USAGE_KEY, u);
  }
  // Days in a row with at least one message (today or yesterday keeps it alive)
  function streakDays() {
    const u = usage();
    let d = new Date(), n = 0;
    if (!u.days[dayKeyOf(d)]) d = addDays(d, -1);
    while (u.days[dayKeyOf(d)]) { n++; d = addDays(d, -1); }
    return n;
  }
  const SERVER_USAGE_KEY = "ervo-usage-server";
  const PLAN_NAMES = { free: "Free", plus: "Plus", pro: "Pro", starter: "Business Starter", growth: "Business Growth", owner: "Owner" };
  function renderUsage() {
    const u = usage();
    const sv = load(SERVER_USAGE_KEY);
    const week = Object.entries(u.days).filter(([d]) => new Date(`${d}T12:00`) > addDays(new Date(), -7)).reduce((a, [, n]) => a + n, 0);
    if (sv && sv.chatsLimit) {
      // Numbers from the server (the ones that count)
      const stale = sv.resetsAt && new Date(sv.resetsAt) < new Date();
      const mStale = sv.monthResetsAt && new Date(sv.monthResetsAt) < new Date();
      const left = stale ? sv.chatsLimit : sv.chatsLeft;
      const rLeft = mStale ? sv.researchLimit : sv.researchLeft;
      const pLeft = mStale ? sv.picturesLimit || 0 : sv.picturesLeft || 0;
      const owner = sv.plan === "owner";
      const name = PLAN_NAMES[sv.plan] || sv.plan;
      $("usage-today").textContent = owner ? "∞" : left.toLocaleString();
      $("usage-of").textContent = owner ? "no limits · Owner" : `chats left ${sv.chatsPer === "day" ? "today" : "this month"} · ${name}`;
      $("usage-ring").style.strokeDashoffset = String(owner ? 0 : 314.16 * (1 - Math.min(left / sv.chatsLimit, 1)));
      $("usage-extra").innerHTML = `<div><small>Research left</small><b>${owner ? "∞" : rLeft.toLocaleString()}</b></div><div><small>Pictures left</small><b>${owner ? "∞" : pLeft.toLocaleString()}</b></div><div><small>Day streak</small><b>${streakDays()} 🔥</b></div>`;
      $("usage-note").textContent = owner
        ? "Your account has no limits. Try a plan in Settings to feel each one."
        : `${name}: ${sv.chatsLimit.toLocaleString()} chats ${sv.chatsPer === "day" ? "a day" : "a month"}, ${sv.researchLimit.toLocaleString()} research questions and ${(sv.picturesLimit || 0).toLocaleString()} pictures a month. Research is when Ervo searches the web.`;
      return;
    }
    const limit = DAILY[(account || { plan: "personal" }).plan] || DAILY.personal;
    const today = u.days[dayKeyOf()] || 0;
    const left = Math.max(0, limit - today);
    $("usage-today").textContent = left.toLocaleString();
    $("usage-of").textContent = "chats left today";
    $("usage-ring").style.strokeDashoffset = String(314.16 * (1 - Math.min(left / limit, 1)));
    $("usage-extra").innerHTML = `<div><small>This week</small><b>${week.toLocaleString()}</b></div><div><small>Day streak</small><b>${streakDays()} 🔥</b></div>`;
    $("usage-note").textContent = "Your plan's exact numbers show after your next chat.";
  }
  // Plans: what each one gives (no payments yet; they arrive with Google Play Billing and Stripe)
  const PLAN_ROWS = {
    personal: [["free", "Free", "Free", "10 chats a day · 3 research and 3 pictures a month"], ["plus", "Plus", "$9.99/mo", "25 chats a day · 15 research and 30 pictures a month"], ["pro", "Pro", "$19.99/mo", "40 chats a day · 40 research and 100 pictures a month"]],
    business: [["starter", "Business Starter", "", "1,000 customer chats a month for the whole team"], ["growth", "Business Growth", "", "5,000 customer chats a month"]],
  };
  function openPlans() {
    const cur = (load(SERVER_USAGE_KEY) || {}).plan;
    const box = $("plans-list");
    box.innerHTML = "";
    PLAN_ROWS[account && account.plan === "business" ? "business" : "personal"].forEach(([key, name, price, sub]) => {
      const r = row("star", name, sub, key === cur ? "Current" : price || "Coming soon");
      if (key === cur) r.classList.add("current"); else if (price) r.querySelector(".side").classList.add("plan-price");
      box.append(r);
    });
    $("plans").hidden = false;
  }
  $("plans-done").addEventListener("click", () => { $("plans").hidden = true; });
  $("plans").addEventListener("click", (e) => { if (e.target === $("plans")) $("plans").hidden = true; });
  $("plans-upgrade").addEventListener("click", () => { toast("Upgrading opens with the app stores. Your limits reset on their own until then."); });
  // The owner can try each plan: the server then answers with that plan's model and limits
  const testPlan = () => { const p = load(TEST_PLAN_KEY); return ["free", "plus", "pro"].includes(p) ? p : ""; };
  const isOwner = () => !!load(OWNER_KEY);
  function syncTestPlanRow() {
    document.querySelectorAll('[data-group="Testing"]').forEach((el) => { el.hidden = !isOwner(); });
    const tp = testPlan();
    $("open-testplan").querySelector("small").textContent = tp ? `Trying ${PLAN_NAMES[tp]}: its model, limits and replies` : "Owner: no limits";
    $("open-testplan").classList.toggle("on", !!tp);
  }
  function openTestPlan() {
    const box = $("testplan-list");
    box.innerHTML = "";
    const tp = testPlan();
    [["", "Off", "Owner account, no limits (Sonnet answers)"], ["free", "Free", "Haiku answers · 10 chats a day"], ["plus", "Plus", "Sonnet answers · 25 chats a day"], ["pro", "Pro", "Sonnet answers · 40 chats a day"]].forEach(([key, name, sub]) => {
      const r = row("star", name, sub, key === tp ? "Current" : "");
      r.classList.add("tap");
      if (key === tp) r.classList.add("current");
      r.addEventListener("click", () => {
        if (key) save(TEST_PLAN_KEY, key); else drop(TEST_PLAN_KEY);
        $("testplan").hidden = true;
        syncTestPlanRow();
        fetchUsage(true);
        toast(key ? `Trying ${name}. Each reply shows which model wrote it.` : "Back to your own account");
      });
      box.append(r);
    });
    $("testplan").hidden = false;
  }
  $("open-testplan").addEventListener("click", openTestPlan);
  $("testplan-done").addEventListener("click", () => { $("testplan").hidden = true; });
  $("testplan").addEventListener("click", (e) => { if (e.target === $("testplan")) $("testplan").hidden = true; });
  function noteUsage(u) {
    save(SERVER_USAGE_KEY, Object.assign({ at: new Date().toISOString() }, u));
    if (u.plan === "owner") save(OWNER_KEY, true);
    syncTestPlanRow();
  }
  let usageFetchAt = 0;
  async function fetchUsage(force) {
    if (!AI_URL || !account || (!force && Date.now() - usageFetchAt < 20000)) return;
    usageFetchAt = Date.now();
    try {
      const token = await freshToken();
      const r = await fetch(`${AI_URL}/usage`, {
        method: "POST",
        headers: Object.assign({ "content-type": "application/json" }, token ? { Authorization: `Bearer ${token}` } : {}),
        body: JSON.stringify({ plan: account.plan, team: teamForAI(), deviceId: deviceId(), testPlan: testPlan() || undefined, messages: [] }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (j.usage) { noteUsage(j.usage); if ($("stats").classList.contains("active")) renderUsage(); }
    } catch (e) { /* offline */ }
  }
  function deviceId() {
    let id = load(DEVICE_KEY);
    if (!id) { id = `dv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; save(DEVICE_KEY, id); }
    return id;
  }

  // ----- Milestones: little wins, and Ervo says so in the chat when you reach one -----
  const MILESTONE_KEY = "ervo-milestones";
  const COUNT_KEY = "ervo-counts";
  const MILESTONES = [
    { id: "first", e: "🎉", title: "First thing done", need: 1, of: "done" },
    { id: "ten", e: "⭐", title: "10 things done", need: 10, of: "done" },
    { id: "fifty", e: "🏆", title: "50 things done", need: 50, of: "done" },
    { id: "hundred", e: "💯", title: "100 things done", need: 100, of: "done" },
    { id: "goal1", e: "🎯", title: "First goal set", need: 1, of: "goals" },
    { id: "goal3", e: "🚀", title: "3 goals going", need: 3, of: "goals" },
    { id: "streak3", e: "🔥", title: "3 days in a row", need: 3, of: "streak" },
    { id: "streak7", e: "🏅", title: "A full week", need: 7, of: "streak" },
    { id: "streak30", e: "💎", title: "30 days in a row", need: 30, of: "streak" },
    { id: "msgs100", e: "💬", title: "100 messages", need: 100, of: "messages" },
    { id: "looks3", e: "🦉", title: "Tried 3 looks", need: 3, of: "looks" },
  ];
  const counts = () => Object.assign({ done: 0 }, load(COUNT_KEY) || {});
  function milestoneNumbers() {
    return { done: Math.max(counts().done, activity().length), goals: goalFacts().length, streak: streakDays(), messages: usage().total, looks: (prefs().looksTried || []).length };
  }
  function checkMilestones(silent) {
    if (!account) return;
    const got = load(MILESTONE_KEY);
    const have = got || {};
    const n = milestoneNumbers();
    const fresh = [];
    MILESTONES.forEach((m) => { if (!have[m.id] && n[m.of] >= m.need) { have[m.id] = new Date().toISOString(); fresh.push(m); } });
    save(MILESTONE_KEY, have);
    if (!got || silent) return; // first run: what's already done counts quietly
    fresh.forEach((m) => {
      logActivity({ kind: "milestone", ico: "star", title: `Milestone: ${m.title}` });
      ervoSays(`${m.e} Milestone: ${m.title}! ${m.of === "streak" ? "Nice habit." : m.of === "goals" ? "I'll keep you moving on it." : "Thanks for letting me help."}`, { acts: [{ label: "See Milestones", icon: "stats", onClick: () => openStats() }] });
    });
  }
  function renderBadges() {
    const box = $("badges");
    box.innerHTML = "";
    const have = load(MILESTONE_KEY) || {};
    const n = milestoneNumbers();
    const order = MILESTONES.slice().sort((a, b) => (have[b.id] ? 1 : 0) - (have[a.id] ? 1 : 0));
    order.forEach((m) => {
      const b = document.createElement("div");
      b.className = `badge${have[m.id] ? " got" : ""}`;
      b.setAttribute("role", "listitem");
      const pct = Math.min(1, (n[m.of] || 0) / m.need);
      b.innerHTML = `<span class="badge-ico">${e3d(m.e)}</span><b>${m.title}</b><small>${have[m.id] ? new Date(have[m.id]).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : `${Math.min(n[m.of] || 0, m.need)} of ${m.need}`}</small>`;
      if (!have[m.id]) b.style.setProperty("--p", String(pct));
      box.append(b);
    });
    const got = MILESTONES.filter((m) => have[m.id]).length;
    const next = order.find((m) => !have[m.id]);
    $("badge-next").textContent = `${got} of ${MILESTONES.length} reached.${next ? ` Next: ${next.title}, ${Math.max(0, next.need - (n[next.of] || 0))} to go.` : " You've got them all!"}`;
  }

  // ----- Busy meter: how full each of the next 7 days is -----
  function drawBusy(list) {
    const box = $("busy");
    box.innerHTML = "";
    const today = startOfDay(new Date());
    const per = Array.from({ length: 7 }, () => 0);
    list.forEach((a) => { const d = Math.round((startOfDay(a.start) - today) / 86400000); if (d >= 0 && d < 7) per[d] += a.allDay ? 1 : 1.5; });
    const max = Math.max(4, ...per);
    const busyDays = per.filter((x) => x > 0).length;
    per.forEach((v, i) => {
      const day = addDays(today, i);
      const col = document.createElement("div");
      col.className = `bar-col${i === 0 ? " today" : ""}${v >= 3 ? " full" : ""}`;
      const bar = document.createElement("i");
      bar.style.height = `${Math.max(6, (v / max) * 60)}px`;
      const lbl = document.createElement("span");
      lbl.textContent = i === 0 ? "Today" : day.toLocaleDateString(undefined, { weekday: "narrow" });
      col.append(bar, lbl);
      box.append(col);
    });
    $("busy-title").textContent = busyDays === 0 ? "The next 7 days are wide open" : busyDays >= 6 ? "A full week ahead" : `${busyDays} of the next 7 days have plans`;
  }

  function drawUpcoming(list) {
    const box = $("upcoming");
    box.innerHTML = "";
    list.sort((a, b) => a.start - b.start);
    drawBusy(list);
    const next = list[0];
    $("sky-next").hidden = !next;
    if (next) $("sky-next").textContent = `📅 ${next.title} · ${untilText(next.start)}`;
    if (!list.length) { box.append(empty("Nothing coming up in the next two weeks.")); return; }
    list.slice(0, 8).forEach((a) => {
      const when = `${fmtDate(a.start)}${a.allDay ? "" : ` at ${a.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}`;
      const r = row(icoClass(a.ico), a.title, `${when}${a.detail ? " · " + a.detail : ""}`, untilText(a.start), a.link);
      setRowIcon(r, ICON[a.ico] ? a.ico : "calendar");
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
    const biz = account && account.plan === "business";
    const co = biz && account.team ? account.team.companyName : "your business";
    $("psyche-title").textContent = biz ? "Business Psyche" : "Psyche";
    $("psyche-sub").textContent = biz
      ? (p.facts.length ? `What Ervo knows about ${co}: ${p.facts.length} thing${p.facts.length === 1 ? "" : "s"}, from your chats. Nothing personal lives here.` : `Ervo is getting to know ${co}. Tell it what the company does, its hours and policies, and it remembers.`)
      : (p.facts.length ? `Ervo knows ${p.facts.length} thing${p.facts.length === 1 ? "" : "s"} about you and keeps learning as you chat.` : "Ervo is just getting to know you. It learns as you chat.");
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
  const DEFAULT_IDEAS_BUSINESS = { groups: [
    { title: "For your business", ideas: [
      { icon: "home", title: "Tell me what your business does. I'll tailor everything to it.", detail: "Your hours, policies, products and tools go in the Business Psyche, so every answer fits.", prompt: "Let me tell you about my business" },
      { icon: "book", title: "Give me your refund policy. I'll answer customers by it.", detail: "I draft replies to refund and return requests that follow your exact policy.", prompt: "Here's our refund policy, use it when I ask you to reply to customers" },
      { icon: "clock", title: "Set your hours and I'll plan around them.", detail: "Appointments, follow-ups and reminders land inside your working hours.", prompt: "Set up my business hours" },
    ] },
    { title: "Customers", ideas: [
      { icon: "mail", title: "Upset customer? I'll draft a calm, professional reply.", detail: "Paste their message and I'll write a response in your company's voice, ready to send.", prompt: "Help me reply to an upset customer" },
      { icon: "star", title: "I'll write replies to your latest reviews.", detail: "A thank-you for the good ones and a careful answer for the bad ones.", prompt: "Help me reply to customer reviews" },
      { icon: "people", title: "Follow up with customers you haven't heard from.", detail: "A short check-in message and a reminder list for this week.", prompt: "Draft a follow-up message for customers who went quiet" },
    ] },
    { title: "Billing & taxes", ideas: [
      { icon: "money", title: "Who still owes you? I'll draft the payment reminders.", detail: "Polite nudges for overdue invoices, firmer the longer they're late.", prompt: "Write payment reminders for overdue invoices" },
      { icon: "calendar", title: "Tax deadlines coming up. I'll put them on your calendar.", detail: "Quarterly estimates, sales tax and filing dates for your state, with reminders.", prompt: "Add this year's tax deadlines to my calendar" },
      { icon: "book", title: "Month-end bookkeeping checklist, ready to tick off.", detail: "Receipts, reconciliations, payroll and reports in one list.", prompt: "Make me a month-end bookkeeping checklist" },
    ] },
    { title: "Organization", ideas: [
      { icon: "done", title: "Plan this week's priorities in 5 minutes.", detail: "Tell me what's on your plate and I'll order it into a day-by-day plan.", prompt: "Help me plan my work week" },
      { icon: "open", title: "Renewals you'd forget: license, domain, insurance.", detail: "One list of what expires this year and reminders a month ahead.", prompt: "List my business renewals and remind me before they expire" },
      { icon: "people", title: "Hand work to your team through Ervo.", detail: "Say \"send this to Maria\" and it lands in her Ervo.", prompt: "How do I send tasks to my team?" },
    ] },
  ] };
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
    const groups = data && Array.isArray(data.groups) ? data.groups : (account && account.plan === "business" ? DEFAULT_IDEAS_BUSINESS : DEFAULT_IDEAS).groups;
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
  // Goals tab: what you're working toward, from your Psyche
  const GOAL_RE = /^(wants? to|is trying to|trying to|is working on|working on|aims? to|hopes? to|plans? to|goal:)/i;
  const goalFacts = () => psyche().facts.filter((f) => f.kind === "goal" || GOAL_RE.test(f.text));
  function renderGoals() {
    const goals = goalFacts();
    const gbox = $("goals");
    gbox.innerHTML = "";
    if (!goals.length) gbox.append(empty("Tell Ervo a goal, like \"I want to run a 5K by spring\" or \"save $500 this month\", and it shows up here."));
    goals.slice().reverse().forEach((f) => gbox.append(ideaRow({ icon: "star", title: f.text, detail: "Tap to plan your next step", prompt: `Help me with my goal to ${goalText(f.text).replace(/[.!]+$/, "")}` })));
  }
  function openGoals() { renderGoals(); show("goalpage"); }
  async function renderIdeas(force) {
    const cached = load(IDEAS_KEY);
    const learned = psyche().learned || 0;
    const fresh = cached && cached.day === new Date().toDateString() && learned - (cached.learned || 0) < 5;
    if (cached && cached.data) drawIdeas(cached.data); else drawIdeas(null);
    if (!AI_URL || (fresh && !force)) return;
    $("ideas-sub").textContent = "Finding ideas for you…";
    $("ideas-refresh").disabled = true;
    const d = await fetchIdeas(); // the starter ideas stay if this fails
    if (d && $("ideas").classList.contains("active")) drawIdeas(d);
    if (d && $("chips").dataset.kind === "suggest") setChips(null); // the suggestions follow the new ideas
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
    // One word the scene understands: clear, partly, cloudy, fog, drizzle, wet, storm or snow ("" until we know)
    const weather = !kind ? "" : /storm/.test(kind) ? "storm" : /snow|sleet|flurr/.test(kind) ? "snow" : /drizz/.test(kind) ? "drizzle"
      : /rain|shower/.test(kind) ? "wet" : /fog|mist|haz/.test(kind) ? "fog" : /partly|mostly cloudy/.test(kind) ? "partly" : /cloud|overcast/.test(kind) ? "cloudy" : "clear";
    const s = $("stats");
    s.dataset.sky = part;
    s.dataset.weather = weather;
    // Season from the month (southern hemisphere flips when we know where you are)
    const south = ((load(PLACE_KEY) || {}).lat || 0) < 0;
    let mo = now.getMonth() + (south ? 6 : 0);
    mo %= 12;
    s.dataset.season = mo >= 2 && mo <= 4 ? "spring" : mo >= 5 && mo <= 7 ? "summer" : mo >= 8 && mo <= 10 ? "fall" : "winter";
    if (w && w.temp !== undefined && ((w.unit === "F" && w.temp <= 36) || (w.unit === "C" && w.temp <= 2))) s.dataset.season = "winter";
    syncBars();
  }

  function activityRow(a) {
    const sub = a.when ? `For ${whenText(a)}` : a.detail || "Done by Ervo";
    const r = row(icoClass(a.ico), a.title, sub, ago(a.at), a.link);
    setRowIcon(r, ICON[a.ico] ? a.ico : "done");
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
    if (!$("steps-card")) return; // steps left Ervo Stats in 0.3.7; the chat still answers step questions
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

  function openStats(scrollToApps) {
    toggleMenu(false);
    renderStats();
    show("stats");
    $("stats-body").scrollTop = 0;
    if (scrollToApps) openApps();
  }
  $("stats-back").addEventListener("click", () => show(backTo("stats")));
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
  const APP_VERSION = "0.5.8"; // keep in step with version.json and the Android versionName
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
    if (found && !manual) { markUpdate(found); return; }
    if (found) showUpdate(found);
    else if (manual) ervoSays(`You're up to date ✅ This is Ervo ${currentVersion()}, the newest version.`);
  }

  // Apple: don't show an alert when an app starts. A found update waits quietly behind •••
  function markUpdate(found) {
    update = found;
    $("menu-btn").classList.add("has-update");
    $("menu-btn").setAttribute("aria-label", `Menu, Ervo ${found.version} is ready`);
    const b = $("check-update");
    b.classList.add("ready");
    b.lastChild.textContent = `Update to ${found.version}`;
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
      $("chips").innerHTML = ""; $("chips").dataset.sig = "";
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
    $("chips").innerHTML = ""; $("chips").dataset.sig = "";
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
  // A picture Ervo drew: tap to see it big, Save keeps it in your Photos
  function pictureBubble(src, prompt) {
    const el = document.createElement("div");
    el.className = "msg them picture";
    const img = document.createElement("img");
    img.src = src;
    img.alt = prompt || "Picture Ervo made";
    img.onload = () => { toBottom(); };
    img.addEventListener("click", () => viewPhoto(src));
    const save = document.createElement("button");
    save.type = "button";
    save.className = "pic-save";
    save.textContent = "Save";
    save.addEventListener("click", () => savePicture(src, prompt));
    el.append(img, save);
    thread.append(el);
    record({ t: "picture", src, prompt: String(prompt || "").slice(0, 200) });
    toBottom();
    return el;
  }
  async function savePicture(src, prompt) {
    const name = `Ervo ${String(prompt || "").replace(/[^a-z0-9 ]/gi, "").trim().slice(0, 30) || "picture"}.jpg`;
    if (native && native.saveImage) { const ok = native.saveImage(String(src).split(",")[1] || "", name); toast(ok ? "Saved to your Photos" : "Couldn't save that one"); return; }
    try {
      if (navigator.canShare) {
        const blob = await (await fetch(src)).blob();
        const file = new File([blob], name, { type: blob.type || "image/jpeg" });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Picture from Ervo" }); return; }
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = src;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
  }
  // While trying a plan out: which model wrote the reply
  function modelTag(tag) {
    const p = document.createElement("p");
    p.className = "model-tag";
    p.textContent = tag;
    thread.append(p);
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
    if (libTab === "orders") {
      const list = trackers().slice().reverse();
      if (!list.length) { box.append(libEmpty("Tell Ervo about an order, return or refund, or paste a tracking number, and it shows up here with its progress.")); return; }
      const wrap = document.createElement("div");
      wrap.className = "lib-trackers";
      list.forEach((t) => wrap.append(trackerEl(t)));
      box.append(wrap);
      return;
    }
    if (libTab === "photos") {
      const pics = [];
      chats.forEach((c) => c.items.forEach((x) => {
        if (x.t === "photo") pics.push({ src: x.src, at: x.at });
        if (x.t === "picture") pics.push({ src: x.src, at: x.at, name: x.prompt || "Picture Ervo made" });
        if (x.t === "products") x.products.forEach((p) => { const asin = asinOf(p.url); if (p.image || asin) pics.push({ src: p.image || amazonPic(asin), alt: amazonPic(asin), at: x.at, href: p.url, name: p.name }); });
      }));
      if (!pics.length) { box.append(libEmpty("Photos you send, pictures Ervo draws and products Ervo finds show up here.")); return; }
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
    $("voice-owl").src = lookSrc();
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
  const menu = { get hidden() { return !$("settings").classList.contains("active"); } };
  function syncSignInRows() {
    const keep = load(KEEP_KEY) !== false;
    $("open-keep").querySelector("small").textContent = keep ? "On: you stay signed in until you sign out" : "Off: Ervo asks for your password next time";
    $("open-keep").classList.toggle("on", keep);
    const bioOk = !!(native && native.biometricAvailable && native.biometricAvailable());
    $("open-bio").hidden = !bioOk;
    const bio = !!load(BIO_KEY);
    $("open-bio").querySelector("small").textContent = bio ? "On: Ervo opens with your fingerprint, face or screen lock" : "Off";
    $("open-bio").classList.toggle("on", bio);
  }
  $("open-keep").addEventListener("click", () => { const keep = load(KEEP_KEY) !== false; save(KEEP_KEY, !keep); syncSignInRows(); toast(!keep ? "You'll stay signed in" : "Ervo will ask for your password next time"); });
  $("open-bio").addEventListener("click", () => {
    if (load(BIO_KEY)) { save(BIO_KEY, false); syncSignInRows(); toast("Fingerprint unlock is off"); return; }
    bioArming = true;
    if (native && native.biometricAuth) native.biometricAuth("Confirm it's you");
  });
  function openSettings() {
    syncTestPlanRow(); $("set-owl").src = lookSrc(); syncSignInRows(); show("settings"); }
  // Warm the settings icons once the app is idle, so the first open doesn't wait on 16 downloads
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 1500)))(() => {
    document.querySelectorAll("#settings-list .app-ico img").forEach((img) => { if (!img.complete) { const i = new Image(); i.decoding = "async"; i.src = img.src; } });
    // ...and the milestone badges, so Ervo Stats opens without a dozen downloads
    MILESTONES.forEach((m) => { const html = e3d(m.e); const src = (html.match(/src="([^"]+)"/) || [])[1]; if (src) { const i = new Image(); i.decoding = "async"; i.src = src; } });
  });
  function toggleMenu(open) { if (open) openSettings(); } // closing is Back
  $("menu-btn").addEventListener("click", openSettings);
  $("open-switch").addEventListener("click", switchProfile);
  $("settings-back").addEventListener("click", () => show("chat"));
  $("set-hero").addEventListener("click", () => openLook());
  // Bottom tabs
  $("tab-chat").addEventListener("click", () => show("chat"));
  $("tab-goals").addEventListener("click", () => (account && account.team && isAdminRole(account.team.role) ? openTeam() : openGoals()));
  $("goals-back").addEventListener("click", () => show("chat"));
  $("goal-add").addEventListener("click", () => {
    show("chat");
    ervoSays("What's a goal you're working toward? Tell me, like \"run a 5K by spring\" or \"save $500 this month\", and I'll keep it in your Psyche and help you get there.");
    setTimeout(() => $("message").focus(), 300);
  });
  $("open-stats").addEventListener("click", () => openStats(false));
  $("open-plans").addEventListener("click", () => { fetchUsage(); openPlans(); });
  function openApps() { toggleMenu(false); renderApps(); show("appsPage"); }
  $("open-apps").addEventListener("click", openApps);
  $("apps-back").addEventListener("click", () => show(backTo("appsPage")));
  if ($("open-greeting")) $("open-greeting").addEventListener("click", openGreeting);
  $("open-wake").addEventListener("click", () => { toggleMenu(false); heyErvo(); });
  $("open-chats").addEventListener("click", openChats);
  $("open-ideas").addEventListener("click", openIdeas);
  $("open-psyche").addEventListener("click", openPsyche);
  $("chats-panel").addEventListener("click", (e) => { if (e.target === $("chats-panel")) closeChats(); });
  $("chats-btn").addEventListener("click", openChats);
  $("psyche-back").addEventListener("click", () => show(backTo("psyche")));
  $("ideas-back").addEventListener("click", () => show("chat"));
  $("ideas-refresh").addEventListener("click", () => renderIdeas(true));
  $("psyche-tell").addEventListener("click", () => { show("chat"); setTimeout(() => $("message").focus(), 100); });
  $("open-library").addEventListener("click", () => openLibrary());
  // Signing out clears everything on this phone, so ask first (Apple: confirm destructive actions)
  let confirmDo = null;
  function askConfirm(title, text, ok, run) {
    toggleMenu(false);
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    $("confirm-ok").textContent = ok;
    confirmDo = run;
    $("confirm").hidden = false;
    setTimeout(() => $("confirm-cancel").focus(), 50);
  }
  $("sign-out").addEventListener("click", () => askConfirm("Sign out of Ervo?", "Your chats, Psyche and activity will be removed from this phone.", "Sign Out", signOut));
  // For testing Ervo like a new person: everything Ervo learned and every chat goes, your account stays
  $("reset-ervo").addEventListener("click", () => askConfirm("Reset Ervo?", `Ervo forgets everything it learned ${account && account.plan === "business" ? "about your business" : "about you"} and clears your chats, ideas, activity and settings here. You stay signed in, and Ervo starts over like the first time.`, "Continue",
    () => setTimeout(() => askConfirm("Really reset?", "This can't be undone. Your chats and Psyche on this phone are gone for good.", "Reset Ervo", resetErvo), 250)));
  $("confirm-cancel").addEventListener("click", () => { $("confirm").hidden = true; confirmDo = null; });
  $("confirm-ok").addEventListener("click", () => {
    $("confirm").hidden = true;
    const run = confirmDo;
    confirmDo = null;
    if (run) run();
  });
  function resetErvo() {
    buzz("reject");
    [PREFS_KEY, CONN_KEY, ACTIVITY_KEY, PLACE_KEY, "ervo-memory", CHAT_KEY, ARCHIVE_KEY, SIDES_KEY, ACTIVE_KEY, GREETED_KEY, PSYCHE_KEY, IDEAS_KEY, "ervo-suggest-salt", "ervo-intro", HIDDEN_CHIPS_KEY, "ervo-seen-version", USAGE_KEY, MILESTONE_KEY, COUNT_KEY, MIRROR_KEY, TRACK_KEY].forEach(drop);
    history = [];
    closeChats();
    openChat(account, true);
    toast("Ervo was reset");
  }
  function signOut() {
    buzz("reject");
    if (realAuth && session()) freshToken().then((t) => t && auth("logout", null, "POST", t)).catch(() => { /* signed out on this phone anyway */ });
    const mine = [PREFS_KEY, CONN_KEY, ACTIVITY_KEY, "ervo-memory", CHAT_KEY, ARCHIVE_KEY, SIDES_KEY, ACTIVE_KEY, GREETED_KEY, PSYCHE_KEY, IDEAS_KEY, "ervo-suggest-salt", HIDDEN_CHIPS_KEY, USAGE_KEY, MILESTONE_KEY, COUNT_KEY, MIRROR_KEY, TRACK_KEY];
    mine.forEach((k) => { try { localStorage.removeItem(k); localStorage.removeItem(`biz:${k}`); } catch (e) { /* ignore */ } });
    [ACCOUNT_KEY, PROFILES_KEY, PLACE_KEY, SESSION_KEY, "ervo-intro", "ervo-seen-version"].forEach(drop);
    setNS("personal");
    account = null;
    ["contact", "password", "code", "name", "su-email", "su-pass", "su-pass2", "fg-email"].forEach((id) => { if ($(id)) $(id).value = ""; });
    wrongTries = 0;
    $("go-forgot").classList.remove("attention");
    setPlan("personal");
    step("contact");
    show("welcome");
  }

  // Android back button: close whatever is open first, then go back to the chat
  window.ervoBack = function () {
    if (OVERLAY) { closeVoice(); return true; }
    // Setting up a switch to Business (or a new company): back returns to the Ervo that was open
    if ($("welcome").classList.contains("active") && document.querySelector('.step.active[data-step="team"], .step.active[data-step="name"]') && !$("team-cancel").hidden) { cancelSetup(); return true; }
    if (document.querySelector(".msg-menu")) { closeMsgMenu(); return true; }
    if (!$("confirm").hidden) { $("confirm").hidden = true; return true; }
    if (!$("perm").hidden) { answerPermission(false); return true; }
    if (!$("update").hidden) { $("update").hidden = true; return true; }
    if (!$("greet").hidden) { $("greet").hidden = true; return true; }
    if (!voice.hidden) { $("voice-cancel").click(); return true; }
    if ($("activity").classList.contains("active")) { renderStats(); show("stats"); return true; }
    if ($("stats").classList.contains("active")) { show(backTo("stats")); return true; }
    if ($("lock").classList.contains("active")) return false;
    if ($("appsPage").classList.contains("active")) { show(backTo("appsPage")); return true; }
    if ($("bizpage").classList.contains("active")) { show(backTo("bizpage")); return true; }
    if (!$("verify").hidden) { $("verify").hidden = true; return true; }
    if (!$("bizdel").hidden) { $("bizdel").hidden = true; return true; }
    if ($("settings").classList.contains("active")) { show("chat"); return true; }
    if (!$("chats-panel").hidden && !docked()) { closeChats(); return true; }
    if ($("psyche").classList.contains("active")) { show(backTo("psyche")); return true; }
    if ($("teamchat").classList.contains("active")) { show("team"); return true; }
    if (!$("newid").hidden) { $("newid").hidden = true; return true; }
    if (!$("calsheet").hidden) { $("calsheet").hidden = true; return true; }
    if (!$("plans").hidden) { $("plans").hidden = true; return true; }
    if (!$("testplan").hidden) { $("testplan").hidden = true; return true; }
    if (!$("hours").hidden) { $("hours").hidden = true; return true; }
    if (!$("company").hidden) { $("company").hidden = true; return true; }
    if ($("ideas").classList.contains("active") || $("goalpage").classList.contains("active") || $("team").classList.contains("active")) { show("chat"); return true; }
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

  // ---------- Ervo's look: tap Ervo at the top to pick an outfit ----------
  // The list of looks lives in img/looks.json: {id, name, file}. Add a picture (PNG, or an animated GIF/WebP)
  // and a line there, and it shows up in the picker. This built-in list is the fallback when the file can't load.
  let LOOKS = [["classic", "Classic"], ["business", "Business"], ["king", "Royal"], ["detective", "Detective"], ["explorer", "Explorer"], ["scientist", "Scientist"],
    ["wizard", "Wizard"], ["ninja", "Ninja"], ["samurai", "Samurai"], ["pirate", "Pirate"], ["pilot", "Pilot"], ["athlete", "Athlete"], ["soccer", "Soccer"],
    ["musician", "Musician"], ["chef", "Chef"], ["creative", "Artist"], ["gamer", "Gamer"], ["space", "Space"], ["scholar", "Scholar"], ["tech", "Tech"],
    ["builder", "Builder"], ["winter", "Winter"], ["holiday", "Holiday"]];
  fetch("img/looks.json", { cache: "no-store" }).then((r) => r.json()).then((list) => {
    if (Array.isArray(list) && list.length) { LOOKS = list.filter((x) => x && x.id && x.name).map((x) => [x.id, x.name, x.file || `ervo-${x.id}.png`]); applyLook(); }
  }).catch(() => { /* keep the built-in list */ });
  // A look's picture. Unknown ids still map to img/ervo-<id>.png, so a saved look shows at once, before looks.json loads
  const lookFile = (id) => { const l = LOOKS.find((x) => x[0] === id); if (l) return `img/${l[2] || `ervo-${id}.png`}`; return /^[a-z]{2,24}$/.test(String(id || "")) ? `img/ervo-${id}.png` : null; };
  function lookSrc() {
    const l = prefs().look;
    const f = l && lookFile(l);
    if (f) return f;
    return PLAN[(account || { plan: "personal" }).plan].avatar;
  }
  function applyLook() {
    const src = lookSrc();
    // iPhone: the icon used when Ervo is added to the home screen follows the owning profile's look
    const touch = document.querySelector('link[rel="apple-touch-icon"]');
    const own = lookOf(iconOwner());
    if (touch) touch.href = lookFile(own) ? `img/touch-${own}.png` : "img/apple-touch-icon.png";
    $("chat-avatar").src = src;
    $("voice-owl").src = src;
    $("set-owl").src = src;
    if ($("intro-owl")) $("intro-owl").src = src;
    if (liveTyping) liveTyping.querySelector("img").src = src;
  }
  function openLook() {
    toggleMenu(false);
    const grid = $("look-grid");
    grid.innerHTML = "";
    const now = lookSrc();
    LOOKS.forEach(([id, name]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(now === lookFile(id)));
      b.innerHTML = `<img src="${lookFile(id)}" alt="" loading="lazy" decoding="async">`;
      b.append(`${name}`);
      b.setAttribute("aria-label", `${name} Ervo`);
      b.addEventListener("click", () => {
        const p = prefs();
        p.look = id;
        p.looksTried = Array.from(new Set((p.looksTried || []).concat(id)));
        save(PREFS_KEY, p);
        grid.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        applyLook();
        buzz("tick");
        logActivity({ kind: "settings", ico: "star", title: `Changed Ervo's look to ${name} Ervo` });
        if (iconOwner() === account.plan) { syncAppIcon(); if (native && native.setAppIcon) toast(`${name} Ervo will be your home-screen icon`); }
      });
      grid.append(b);
    });
    $("look-icon").checked = iconOwner() === account.plan;
    $("look-icon-sub").textContent = iconOwner() === account.plan
      ? `Your home screen shows this Ervo's look. Turn off to use your ${account.plan === "business" ? "Personal" : "Business"} Ervo instead.`
      : `Your ${account.plan === "business" ? "Personal" : "Business"} Ervo is the icon right now. Turn on to use this one.`;
    $("look").hidden = false;
    setTimeout(() => { const c = grid.querySelector('[aria-checked="true"]'); if (c) c.focus(); }, 50);
  }
  // One home-screen icon for both Ervos: the look of whichever profile owns it
  const iconOwner = () => load(ICON_PROFILE_KEY) || "personal";
  function lookOf(plan) {
    try { const p = JSON.parse(localStorage.getItem(`${plan === "business" ? "biz:" : ""}${PREFS_KEY}`)) || {}; if (p.look && /^[a-z]{2,24}$/.test(p.look)) return p.look; } catch (e) { /* none */ }
    return plan === "business" ? "business" : "classic";
  }
  function syncAppIcon() {
    const look = lookOf(iconOwner());
    if (native && native.setAppIcon) native.setAppIcon(look);
    const touch = document.querySelector('link[rel="apple-touch-icon"]');
    if (touch) touch.href = lookFile(look) ? `img/touch-${look}.png` : "img/apple-touch-icon.png";
  }
  $("look-icon").addEventListener("change", () => {
    const other = account.plan === "business" ? "personal" : "business";
    save(ICON_PROFILE_KEY, $("look-icon").checked ? account.plan : other);
    syncAppIcon();
    $("look-icon-sub").textContent = $("look-icon").checked
      ? `Your home screen shows this Ervo's look. Turn off to use your ${other === "business" ? "Business" : "Personal"} Ervo instead.`
      : `Your ${other === "business" ? "Business" : "Personal"} Ervo is the icon right now. Turn on to use this one.`;
    toast($("look-icon").checked ? "This Ervo is your home-screen icon" : `Your ${other === "business" ? "Business" : "Personal"} Ervo is the icon`);
  });
  $("avatar-btn").addEventListener("click", () => { if (account) openLook(); });
  $("avatar-btn").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && account) { e.preventDefault(); openLook(); } });
  $("look-done").addEventListener("click", () => { $("look").hidden = true; });
  $("look").addEventListener("click", (e) => { if (e.target === $("look")) $("look").hidden = true; });
  $("open-look").addEventListener("click", openLook);

  // ---------- weather before you leave (Android): one heads-up, only when it matters ----------
  const DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
  const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let leaveAsk = false;
  function leaveDaysText(days) {
    const d = String(days);
    if (d === "23456") return "weekdays";
    if (d.length === 7) return "every day";
    if (d === "17") return "weekends";
    return listJoin(d.split("").map((x) => DAY_FULL[+x - 1] + "s"));
  }
  function openLeave(time) {
    toggleMenu(false);
    if (!(native && native.setWeatherAlert)) return ervoSays("Weather heads-ups before you leave work in the Ervo Android app. On iPhone, the Weather app can send rain alerts.");
    let st = {};
    try { st = JSON.parse(native.weatherAlertStatus()); } catch (e) { /* first time */ }
    const h = time ? time.h : st.hour ?? 8, m = time ? time.m : st.minute ?? 0;
    $("leave-on").checked = time ? true : !!st.on;
    $("leave-time").value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const days = String(st.days || "23456");
    const box = $("leave-days");
    box.innerHTML = "";
    DAY_SHORT.forEach((x, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = x;
      b.dataset.d = String(i + 1);
      b.setAttribute("aria-label", DAY_FULL[i]);
      b.setAttribute("aria-pressed", String(days.includes(String(i + 1))));
      b.addEventListener("click", () => { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); buzz("tick"); });
      box.append(b);
    });
    $("leave").hidden = false;
    if (time) ervoSays(`I can check the weather before you leave at ${fmtTime(time)} and tell you only if you'll need an umbrella, a jacket or extra time. Pick your days, then tap Save.`);
  }
  async function leaveSettings(on) {
    const [hh, mm] = ($("leave-time").value || "08:00").split(":").map(Number);
    const days = [...$("leave-days").querySelectorAll("button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.d).join("") || "23456";
    const s = { on, hour: hh || 0, minute: mm || 0, days };
    if (on) {
      if (!(await ensure("location", "Check the weather where you live before you leave"))) return null;
      let place = null;
      try { place = await getPlace(); } catch (e) { /* no location */ }
      if (!place) { ervoSays("I couldn't get your location, so I can't check your weather yet. Make sure Location is on for Ervo, then try again."); return null; }
      Object.assign(s, { lat: place.lat, lon: place.lon, city: place.city || "", fahrenheit: place.country ? ["US", "LR", "MM", "BS", "BZ", "KY", "PW"].includes(place.country) : /-US$/.test(navigator.language || "") });
    }
    return s;
  }
  $("leave-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("leave").hidden = true;
    const on = $("leave-on").checked;
    const s = await leaveSettings(on);
    if (!s) return;
    const p = prefs();
    p.leave = { on, hour: s.hour, minute: s.minute, days: s.days };
    save(PREFS_KEY, p);
    leaveAsk = true;
    native.setWeatherAlert(JSON.stringify(s));
  });
  $("leave-test").addEventListener("click", async () => {
    const s = await leaveSettings(true);
    if (!s) return;
    s.on = $("leave-on").checked; // a sample doesn't turn it on by itself
    s.ask = true; // but it does ask for notifications, so the sample can show
    native.setWeatherAlert(JSON.stringify(s));
    native.testWeatherAlert();
    toast("Sample sent. Check your notifications.");
  });
  $("leave-cancel").addEventListener("click", () => { $("leave").hidden = true; });
  $("leave").addEventListener("click", (e) => { if (e.target === $("leave")) $("leave").hidden = true; });
  if ($("open-leave")) $("open-leave").addEventListener("click", () => openLeave(null));
  window.ervoWeatherAlert = (json) => {
    if (!leaveAsk) return;
    leaveAsk = false;
    let st = {};
    try { st = JSON.parse(json); } catch (e) { return; }
    const at = fmtTime({ h: st.hour, m: st.minute });
    if (st.on && !st.notify) {
      return ervoSays("Notifications are off for Ervo, so the heads-up can't show. Turn them on in Settings, then you're all set.", { acts: [{ label: "Open Settings", icon: "open", onClick: () => native.openAppSettings() }] });
    }
    if (!st.on) { logActivity({ kind: "settings", ico: "sun", title: "Turned off weather before you leave" }); return ervoSays("Okay, weather heads-ups are off."); }
    logActivity({ kind: "settings", ico: "sun", title: `Weather heads-up before ${at}`, detail: leaveDaysText(st.days) });
    return ervoSays(`Done ✅ About 20 minutes before ${at} on ${leaveDaysText(st.days)}, I'll check the weather${st.city ? ` in ${st.city}` : ""} and send a heads-up only if you'll need an umbrella, a jacket or extra time.`, {
      acts: [{ label: "Send a Sample", icon: "sun", onClick: () => { native.testWeatherAlert(); toast("Sample sent. Check your notifications."); } }],
    });
  };

  // ---------- share text with any app (Notes, Keep, Messages, email) ----------
  async function shareText(title, text) {
    if (native && native.shareText) return native.shareText(String(title || ""), String(text || ""));
    if (navigator.share) { try { await navigator.share({ title, text }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    const ok = await copyText(text);
    toast(ok ? "Copied. Paste it into Notes or any app." : "Couldn't share that. Try again.");
  }

  // ---------- a few things to know (guidelines 1, 2 and 17) ----------
  const INTRO_KEY = "ervo-intro";
  const INTRO_PERSONAL = [
    ["✨", "What I can do", "Plan your days, add and change calendar events, set alarms and timers, research things to buy, find places near you, and give you ideas tied to your goals."],
    ["🦉", "I can make mistakes", "I'm an AI, so double-check things that matter, like prices, health info and dates. I never buy anything or call anyone for you."],
    ["🔒", "You're in control", "I ask before using your calendar, location or other apps. See and change what I've learned in Psyche, turn learning off, or reset me anytime."],
  ];
  const INTRO_BUSINESS = [
    ["💼", "What I do for your business", "Customer replies in your company's voice, refunds by your policy, scheduling inside your hours, invoices and payment reminders, bookkeeping checklists, suppliers, reviews and hand-offs to your team."],
    ["🦉", "I can make mistakes", "I'm an AI. Check anything that goes to a customer or involves money, taxes or legal terms before you send it. I never pay, file or sign for you."],
    ["🔒", "Your company's Psyche", "What I learn here is about the business, not anyone's private life, and it stays separate from Ervo Personal. The owner and co-owners can read employees' chats with me."],
  ];
  function showIntro() {
    toggleMenu(false);
    const biz = account && account.plan === "business";
    const items = biz ? INTRO_BUSINESS : INTRO_PERSONAL;
    const list = document.querySelector("#intro .intro-list");
    list.innerHTML = "";
    items.forEach(([e, b, s]) => {
      const li = document.createElement("li");
      const ico = document.createElement("span"); ico.className = "intro-ico"; ico.setAttribute("aria-hidden", "true"); ico.innerHTML = e3d(e);
      const txt = document.createElement("span"); const bb = document.createElement("b"); bb.textContent = b; const sm = document.createElement("small"); sm.textContent = s; txt.append(bb, sm);
      li.append(ico, txt); list.append(li);
    });
    $("intro-title").textContent = biz ? "Ervo for Business" : "A few things to know";
    if ($("intro-owl")) $("intro-owl").src = lookSrc();
    $("intro").hidden = false;
    setTimeout(() => $("intro-ok").focus(), 50);
  }
  $("intro-ok").addEventListener("click", () => { $("intro").hidden = true; save(INTRO_KEY, 1); });
  $("open-intro").addEventListener("click", showIntro);

  // ---------- what's new after an update (guideline 18), as a chat message, never a pop-up ----------
  async function whatsNew(firstTime) {
    const seen = load("ervo-seen-version");
    save("ervo-seen-version", APP_VERSION);
    if (firstTime || seen === APP_VERSION) return;
    let notes = [];
    try { const r = await fetch("version.json", { cache: "no-store" }); const v = await r.json(); notes = (v.highlights && v.highlights.length ? v.highlights : v.notes || []).slice(0, 3); } catch (e) { /* offline */ }
    if (!notes.length) return;
    await ervoSays(`I was just updated to version ${APP_VERSION}. What's new:\n${notes.map((n) => `• ${n}`).join("\n")}`);
  }

  // ---------- was that helpful? (guidelines 15 and 16) ----------
  function feedbackRow(asked, said) {
    const row = document.createElement("div");
    row.className = "fb";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Was this helpful?");
    const btn = (txt, label, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = txt; b.setAttribute("aria-label", label); b.addEventListener("click", fn); return b; };
    const thanks = (msg) => { row.innerHTML = ""; row.append(msg); setTimeout(() => row.remove(), 4000); };
    const up = btn("👍", "Good answer", () => { buzz("tick"); thanks("Thanks! Glad that helped."); });
    const down = btn("👎", "Not helpful", () => {
      buzz("tick");
      row.innerHTML = "";
      const why = document.createElement("div");
      why.className = "fb-why";
      const back = btn("‹", "Back", () => { row.innerHTML = ""; row.append(up, down); });
      back.className = "fb-back";
      why.append(back);
      const topic = String(asked).slice(0, 80);
      [
        ["Wrong info", () => { learn({ lesson: `Double-check facts carefully; an answer about "${topic}" had wrong info` }); return ["Thanks for telling me. I'll double-check facts like that more carefully.", true]; }],
        ["Not what I asked", () => { learn({ lesson: `Read the question closely; "${topic}" was misunderstood` }); return ["Sorry about that. I'll read questions more carefully.", true]; }],
        ["Too long", () => { learn({ style: { length: "short and to the point" } }); return ["Got it. I'll keep my answers shorter from now on. You'll see it in Psyche.", false]; }],
        ["Too short", () => { learn({ style: { length: "more detail when it helps" } }); return ["Got it. I'll give more detail from now on. You'll see it in Psyche.", false]; }],
      ].forEach(([label, fn]) => why.append(btn(label, label, () => {
        const [msg, retry] = fn();
        row.remove();
        ervoSays(msg, { acts: retry && asked ? [{ label: "Try Again", icon: "undo", onClick: () => send(asked) }] : null });
      })));
      // Say it in your own words: Ervo learns from it and answers again
      const tell = btn("Tell Ervo…", "Tell Ervo what was off", () => {
        row.remove();
        feedbackFor = asked || "";
        $("message").placeholder = "What was off? I'll learn from it";
        $("message").focus();
      });
      tell.className = "fb-tell";
      why.append(tell);
      row.append(why);
    });
    row.append(up, down);
    thread.append(row);
  }

  // ---------- "Added to your Psyche: ..." with Undo (guideline 16) ----------
  function showLearned(facts) {
    const row = document.createElement("div");
    row.className = "learned";
    row.setAttribute("role", "status");
    const txt = document.createElement("span");
    txt.insertAdjacentHTML("beforeend", `${e3d("🧠")} Added to your Psyche: `);
    const b = document.createElement("b");
    b.textContent = listJoin(facts.slice(0, 3).map((f) => f.text)) + (facts.length > 3 ? ` and ${facts.length - 3} more` : "");
    txt.append(b);
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = "Undo";
    undo.addEventListener("click", () => {
      learn({ remove: facts.map((f) => f.id) });
      row.innerHTML = "";
      row.append("Removed. I won't use that.");
      setTimeout(() => row.remove(), 3000);
    });
    const see = document.createElement("button");
    see.type = "button";
    see.textContent = "See Psyche";
    see.addEventListener("click", () => $("open-psyche").click());
    row.append(txt, undo, see);
    thread.append(row);
    toBottom();
  }

  // ---------- learning on or off (guideline 17) ----------
  $("learn-on").checked = prefs().learn !== false;
  $("learn-on").addEventListener("change", () => {
    const p = prefs();
    p.learn = $("learn-on").checked;
    save(PREFS_KEY, p);
    toast(p.learn ? "Ervo will keep learning from your chats" : "Learning is off. Ervo won't add anything new.");
    logActivity({ kind: "settings", ico: "brain", title: p.learn ? "Turned learning on" : "Turned learning off" });
  });

  // ---------- Ervo for Business teams ----------
  // The server (team.ts) is the source of truth; account.team is a copy for the screens.
  const MIRROR_KEY = "ervo-mirror-queue";
  async function teamApi(path, body) {
    const token = await freshToken();
    if (!AI_URL) throw new Error("Ervo's server isn't set up.");
    if (!token) { const e = new Error("Please sign in again."); e.status = 401; throw e; }
    let r;
    const payload = Object.assign({ companyId: account && account.team ? account.team.companyId : undefined }, body || {});
    try {
      r = await fetch(`${AI_URL}/team/${path}`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    } catch (e) { throw new Error("Couldn't reach Ervo. Check your connection and try again."); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `Ervo's server said ${r.status}.`); e.status = r.status; e.none = !!j.none; e.removed = j.removed || null; throw e; }
    return j;
  }
  const teamFromView = (v) => ({
    role: v.member.role, memberId: v.member.id, myName: v.member.name, hours: v.member.hours || null,
    companyId: v.company.id, companyName: v.company.name, location: v.company.location || "", verified: !!v.company.verified, website: v.company.website || "", owner: v.company.owner || "", peer: !!v.company.peerMessages,
    members: v.members || [], pendingCodes: v.pendingCodes || [], companies: v.companies || [], unread: v.unread || 0,
  });
  function teamForAI() {
    const t = account && account.team;
    if (!t) return undefined;
    return { companyId: t.companyId, company: t.companyName, location: t.location, verified: t.verified, role: t.role, myName: t.myName, hours: t.hours, members: t.members.filter((m) => m.id !== t.memberId).map((m) => m.name), peerMessages: t.peer };
  }
  // Fresh team picture from the server (and the first place a returning Business user is sent to pick Company or Employee)
  async function syncTeam() {
    if (!account || account.plan !== "business" || !realAuth) return;
    try {
      const v = await teamApi("me");
      const before = account.team ? account.team.companyId : null;
      account.team = teamFromView(v);
      save(ACCOUNT_KEY, account);
      if (account.team.companyId !== before) { migrateLegacyBiz(account.team.companyId); switchInto(account, false); return; }
      applyTeamUI();
      pollInbox();
    } catch (e) {
      if (e.none) {
        pendingAcc = account;
        show("welcome");
        setTeamRole(e.removed ? "employee" : "owner");
        step("team");
        if (e.removed) $("team-error").textContent = e.removed.closed ? `${e.removed.company} closed its Ervo workspace. You can start your own company here or join another with an employee ID.` : `Your access to ${e.removed.company} on Ervo was removed by the company. To rejoin, ask them for a new employee ID.`;
      }
      else if (e.status === 401) { /* signed out elsewhere: the next action asks to sign in */ }
    }
  }
  const isAdminRole = (r) => r === "owner" || r === "coowner";
  function applyTeamUI() {
    const t = account && account.team;
    const owner = !!(t && isAdminRole(t.role));
    $("open-team").hidden = !owner;
    $("open-hours").hidden = !t;
    $("open-biz").hidden = !t;
    document.querySelectorAll('#settings-list [data-group="Work"]').forEach((el) => { el.hidden = !t; });
    const tab = $("tab-goals");
    tab.querySelector("span").textContent = owner ? "Team" : "Goals";
    tab.querySelector("svg").innerHTML = owner
      ? '<circle cx="9" cy="8" r="3.4"/><path d="M3 19a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 19H21a5 5 0 0 0-3-4.6"/>'
      : '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>';
    if (t) startInbox(); else stopInbox();
  }

  // Employees' chats, mirrored for the owner (queued, sent in small batches)
  let mirrorTimer = null;
  function queueMirror(item) {
    const q = load(MIRROR_KEY) || [];
    q.push(item);
    save(MIRROR_KEY, q.slice(-200));
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(flushMirror, 2500);
  }
  async function flushMirror() {
    const q = load(MIRROR_KEY) || [];
    if (!q.length || !account || !account.team) return;
    const batch = q.slice(0, 60);
    try {
      await teamApi("mirror", { items: batch });
      const left = (load(MIRROR_KEY) || []).filter((x) => !batch.some((b) => b.id === x.id));
      save(MIRROR_KEY, left);
      if (left.length) mirrorTimer = setTimeout(flushMirror, 1500);
    } catch (e) { mirrorTimer = setTimeout(flushMirror, 30000); }
  }

  // Notes from teammates arrive in the chat
  let inboxTimer = null;
  function startInbox() { stopInbox(); inboxTimer = setInterval(() => { if (!document.hidden) pollInbox(); }, 60000); }
  function stopInbox() { clearInterval(inboxTimer); inboxTimer = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && account && account.team) { pollInbox(); flushMirror(); } });
  async function pollInbox() {
    if (!account || !account.team) return;
    let j;
    try { j = await teamApi("inbox"); } catch (e) { return; }
    (j.notes || []).forEach((n) => {
      ervoSays(`📨 From ${n.from_name}: ${n.text}`, { instant: true, acts: [{ label: `Reply to ${n.from_name}`, icon: "chat", onClick: () => { $("message").value = `Tell ${n.from_name}: `; $("message").focus(); syncComposer(); } }] });
      logActivity({ kind: "team", ico: "chat", title: `Message from ${n.from_name}`, detail: String(n.text).slice(0, 80) });
    });
  }
  // "Send this to Maria", "forward that to the owner", "tell Sam: the shipment is late"
  function teamNames() {
    const t = account && account.team;
    if (!t) return [];
    return t.members.filter((m) => m.id !== t.memberId).map((m) => m.name);
  }
  function resolveTeammate(raw) {
    const want = String(raw || "").trim().replace(/^(the |my )?(owner|boss|manager)$/i, "owner").replace(/[.!,]+$/, "").toLowerCase();
    if (!want) return null;
    if (want === "owner") return isAdminRole(account.team.role) && account.team.role === "owner" ? null : "owner";
    const names = teamNames();
    return names.find((n) => n.toLowerCase() === want) || names.find((n) => n.toLowerCase().split(" ")[0] === want) || names.find((n) => n.toLowerCase().startsWith(want)) || null;
  }
  function matchTeamSend(text) {
    const t = String(text).trim();
    let m = t.match(/^(?:send|forward|share|pass) (?:this|that|it|the last (?:message|answer|reply|one))(?: along| over)? to (.+)$/i);
    if (m) { const to = resolveTeammate(m[1]); return to && lastErvoText ? { to, text: lastErvoText } : null; }
    m = t.match(/^(?:tell|message|text|send to|send) ([a-z][\w' -]{0,30}?)[:,] (.+)$/i) || t.match(/^tell ([a-z][\w'-]*) (?:that |to )?(.{3,})$/i);
    if (m) { const to = resolveTeammate(m[1]); return to ? { to, text: m[2].trim() } : null; }
    return null;
  }
  async function teamSend(to, text) {
    if (!account.team) return ervoSays("Sending to teammates works once you're part of a company on Ervo for Business.");
    setStatus("📨", "Sending");
    try {
      const r = await teamApi("send", { to, text });
      logActivity({ kind: "team", ico: "chat", title: `Sent a message to ${r.to.name}`, detail: String(text).slice(0, 80) });
      return ervoSays(`Sent to ${r.to.name} ✅ It'll show up in their Ervo.`, { instant: true });
    } catch (e) {
      return ervoSays(e.message || "I couldn't send that right now.", { instant: true });
    }
  }

  // ----- Team screen (owner) -----
  async function openTeam() {
    toggleMenu(false);
    if (!account.team) return;
    renderTeam();
    show("team");
    try { account.team = teamFromView(await teamApi("me")); save(ACCOUNT_KEY, account); renderTeam(); } catch (e) { /* show what we have */ }
  }
  function hoursText(h) {
    if (!h || !h.start) return "No office hours set";
    const t = (s) => fmtTime({ h: +s.split(":")[0], m: +s.split(":")[1] });
    return `${t(h.start)} to ${t(h.end)}, ${leaveDaysText(h.days || "23456")}`;
  }
  function renderTeam() {
    const t = account.team;
    $("team-title").textContent = t.companyName;
    const staff = t.members.filter((m) => m.id !== t.memberId);
    const n = staff.filter((m) => m.role === "employee").length;
    $("team-sub").textContent = `${t.location ? `${t.location} · ` : ""}${t.verified ? "Verified ✓ · " : ""}${n} employee${n === 1 ? "" : "s"} · you're ${t.role === "owner" ? "the owner" : "a co-owner"}`;
    const mbox = $("team-members");
    mbox.innerHTML = "";
    if (!staff.length) mbox.append(empty("No one else yet. Add an employee ID below and give it to them."));
    staff.forEach((m) => {
      const tag = m.role === "owner" ? "Owner · " : m.role === "coowner" ? "Co-owner · " : "";
      const r = row(isAdminRole(m.role) ? "star" : "people", m.name, `${tag}${hoursText(m.hours)}`, m.lastAt ? ago(m.lastAt) : "›");
      r.classList.add("tap");
      r.setAttribute("role", "button");
      r.tabIndex = 0;
      r.addEventListener("click", () => openTeamChat(m));
      mbox.append(r);
    });
    const cbox = $("team-codes");
    cbox.innerHTML = "";
    if (!t.pendingCodes.length) cbox.append(empty("No open IDs. Each ID lets one person join; it stops working once they do."));
    t.pendingCodes.forEach((c) => {
      const r = row("star", c.code, `${c.label ? `For ${c.label}` : "Not used yet"}${c.role === "coowner" ? " · co-owner" : ""}`, "");
      r.querySelector("b").classList.add("mono");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "switch on";
      b.textContent = "Revoke";
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        try { account.team = teamFromView(await teamApi("ids/revoke", { code: c.code })); save(ACCOUNT_KEY, account); renderTeam(); toast("ID revoked"); } catch (err) { toast(err.message); }
      });
      r.append(b);
      cbox.append(r);
    });
    $("team-peer").checked = !!t.peer;
  }
  $("team-back").addEventListener("click", () => show("chat"));
  $("open-team").addEventListener("click", openTeam);
  $("team-peer").addEventListener("change", async () => {
    try { account.team = teamFromView(await teamApi("settings", { peerMessages: $("team-peer").checked })); save(ACCOUNT_KEY, account); toast($("team-peer").checked ? "Employees can message each other" : "Employees can message only you"); }
    catch (e) { $("team-peer").checked = !!account.team.peer; toast(e.message); }
  });
  // New employee ID
  let newCode = "";
  $("team-add").addEventListener("click", () => {
    $("newid-ask").hidden = false; $("newid-show").hidden = true; $("newid-label").value = "";
    $("newid-roles").hidden = account.team.role !== "owner"; // only the owner can invite co-owners
    document.querySelector('input[name="newidrole"][value="employee"]').checked = true;
    $("newid").hidden = false; setTimeout(() => $("newid-label").focus(), 60);
  });
  $("newid-cancel").addEventListener("click", () => { $("newid").hidden = true; });
  $("newid-done").addEventListener("click", () => { $("newid").hidden = true; });
  $("newid").addEventListener("click", (e) => { if (e.target === $("newid")) $("newid").hidden = true; });
  $("newid-create").addEventListener("click", async () => {
    const label = $("newid-label").value.trim();
    const role = (document.querySelector('input[name="newidrole"]:checked') || {}).value === "coowner" && account.team.role === "owner" ? "coowner" : "employee";
    $("newid-create").disabled = true;
    try {
      const r = await teamApi("ids/create", { label, role });
      newCode = r.code;
      $("newid-for").textContent = `${label ? `For ${label}` : "For your next teammate"}${role === "coowner" ? " · joins as co-owner" : ""}`;
      $("newid-note").textContent = role === "coowner"
        ? "Give it to them in person or by text. They pick Business, then Employee, enter your company name and this ID, and join as a co-owner. It works once and is never reused."
        : "Give it to them in person or by text. They pick Business, then Employee, and enter your company name and this ID. It works once, it's never reused, and you can revoke it until they join.";
      $("newid-code").textContent = r.code;
      $("newid-ask").hidden = true;
      $("newid-show").hidden = false;
      logActivity({ kind: "team", ico: "people", title: `Created an employee ID${label ? ` for ${label}` : ""}` });
      account.team = teamFromView(await teamApi("me"));
      save(ACCOUNT_KEY, account);
      renderTeam();
    } catch (e) { toast(e.message); }
    $("newid-create").disabled = false;
  });
  const idMessage = () => `Join ${account.team.companyName} on Ervo for Business:\n1. Get Ervo and sign in\n2. Pick Business, then Employee\n3. Company: ${account.team.companyName}\n4. Employee ID: ${newCode}`;
  $("newid-copy").addEventListener("click", async () => { toast((await copyText(newCode)) ? "ID copied" : "Couldn't copy"); });
  $("newid-share").addEventListener("click", () => shareText("Your Ervo employee ID", idMessage()));

  // ----- One employee's chat (owner, read-only) -----
  let teamChatMember = null;
  async function openTeamChat(m) {
    teamChatMember = m;
    const me = account.team;
    $("teamchat-title").textContent = m.name;
    $("teamchat-sub").textContent = `${m.role === "owner" ? "Owner · " : m.role === "coowner" ? "Co-owner · " : ""}${hoursText(m.hours)}${m.lastAt ? ` · last active ${ago(m.lastAt)}` : ""}`;
    // Only the owner makes co-owners; nobody removes the owner; only the owner removes a co-owner
    $("teamchat-role").hidden = !(me.role === "owner" && m.role !== "owner");
    $("teamchat-role").textContent = m.role === "coowner" ? "Remove co-owner role" : "Make co-owner";
    $("teamchat-remove").hidden = m.role === "owner" || (m.role === "coowner" && me.role !== "owner");
    const box = $("teamchat-list");
    box.innerHTML = "";
    box.append(empty("Loading…"));
    show("teamchat");
    try {
      const r = await teamApi("chat", { memberId: m.id });
      box.innerHTML = "";
      if (!r.messages.length) box.append(empty(`${m.name} hasn't chatted with Ervo yet.`));
      let day = "";
      r.messages.forEach((x) => {
        const d = new Date(x.at);
        const key = d.toDateString();
        if (key !== day) { day = key; const h = document.createElement("p"); h.className = "tc-day"; h.textContent = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); box.append(h); }
        const el = document.createElement("div");
        el.className = `tc-msg ${x.role === "user" ? "them-user" : "ervo"}`;
        el.innerHTML = `<small>${x.role === "user" ? m.name : "Ervo"} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</small>`;
        const t = document.createElement("span");
        t.textContent = x.text;
        el.append(t);
        box.append(el);
      });
    } catch (e) { box.innerHTML = ""; box.append(empty(e.message)); }
  }
  $("teamchat-back").addEventListener("click", () => show("team"));
  $("teamchat-role").addEventListener("click", () => {
    const m = teamChatMember;
    if (!m) return;
    const makeCo = m.role !== "coowner";
    askConfirm(makeCo ? `Make ${m.name} a co-owner?` : `Remove ${m.name}'s co-owner role?`,
      makeCo ? `${m.name} will see every employee's chat, create and revoke employee IDs, change team settings and remove employees. Only you can remove co-owners or make new ones, and only you can delete the company.` : `${m.name} goes back to being an employee: their own chat, no Team tab.`,
      makeCo ? "Make co-owner" : "Remove role", async () => {
        try {
          account.team = teamFromView(await teamApi("member/role", { memberId: m.id, role: makeCo ? "coowner" : "employee" }));
          save(ACCOUNT_KEY, account);
          logActivity({ kind: "team", ico: "star", title: makeCo ? `Made ${m.name} a co-owner` : `${m.name} is an employee again` });
          const fresh = account.team.members.find((x) => x.id === m.id);
          if (fresh) openTeamChat(fresh); else openTeam();
        } catch (e) { toast(e.message); }
      });
  });
  $("teamchat-send").addEventListener("click", () => { if (!teamChatMember) return; show("chat"); $("message").value = `Tell ${teamChatMember.name}: `; setTimeout(() => { $("message").focus(); syncComposer(); }, 300); });
  $("teamchat-remove").addEventListener("click", () => {
    if (!teamChatMember) return;
    const m = teamChatMember;
    askConfirm(`Remove ${m.name}?`, `${m.name} leaves ${account.team.companyName} on Ervo and can't send or receive team messages. Their past chats stay visible to you.`, "Remove", async () => {
      try { account.team = teamFromView(await teamApi("member/remove", { memberId: m.id })); save(ACCOUNT_KEY, account); logActivity({ kind: "team", ico: "people", title: `Removed ${m.name} from ${account.team.companyName}` }); openTeam(); }
      catch (e) { toast(e.message); }
    });
  });

  // ----- Office hours (anyone on a team) -----
  function openHours() {
    toggleMenu(false);
    const h = (account.team && account.team.hours) || { start: "09:00", end: "17:00", days: "23456" };
    $("hours-start").value = h.start || "09:00";
    $("hours-end").value = h.end || "17:00";
    const box = $("hours-days");
    box.innerHTML = "";
    DAY_SHORT.forEach((x, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = x;
      b.dataset.d = String(i + 1);
      b.setAttribute("aria-label", DAY_FULL[i]);
      b.setAttribute("aria-pressed", String(String(h.days || "23456").includes(String(i + 1))));
      b.addEventListener("click", () => { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); buzz("tick"); });
      box.append(b);
    });
    $("hours").hidden = false;
  }
  $("open-hours").addEventListener("click", openHours);
  $("hours-cancel").addEventListener("click", () => { $("hours").hidden = true; });
  $("hours").addEventListener("click", (e) => { if (e.target === $("hours")) $("hours").hidden = true; });
  $("hours-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const days = [...$("hours-days").querySelectorAll("button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.d).join("") || "23456";
    const hours = { start: $("hours-start").value || "09:00", end: $("hours-end").value || "17:00", days };
    $("hours").hidden = true;
    try {
      account.team = teamFromView(await teamApi("member/hours", { hours }));
      save(ACCOUNT_KEY, account);
      logActivity({ kind: "settings", ico: "clock", title: "Set office hours", detail: hoursText(hours) });
      ervoSays(`Office hours saved: ${hoursText(hours)}. I'll plan your work inside them.`);
    } catch (err) { ervoSays(err.message); }
  });

  // ----- My company (employee) -----
  if ($("open-company")) $("open-company").addEventListener("click", () => {
    toggleMenu(false);
    const t = account.team;
    $("company-info").textContent = `${t.companyName}${t.owner ? `, run by ${t.owner}` : ""}. You joined as ${t.myName}. Teammates can ${t.peer ? "message each other and the owner" : "message the owner"} through Ervo.`;
    $("company").hidden = false;
  });
  $("company-done").addEventListener("click", () => { $("company").hidden = true; });
  $("company").addEventListener("click", (e) => { if (e.target === $("company")) $("company").hidden = true; });
  // ----- My Businesses -----
  const DEPTH_BIZ = 2; void DEPTH_BIZ;
  function openBiz() {
    toggleMenu(false);
    renderBiz();
    show("bizpage");
    teamApi("me").then((v) => { account.team = teamFromView(v); save(ACCOUNT_KEY, account); renderBiz(); }).catch(() => { /* show what we have */ });
  }
  function renderBiz() {
    const t = account.team;
    const box = $("biz-list");
    box.innerHTML = "";
    const list = (t && t.companies && t.companies.length) ? t.companies : (t ? [{ id: t.companyId, name: t.companyName, location: t.location, role: t.role, verified: t.verified }] : []);
    list.forEach((c) => {
      const active = t && c.id === t.companyId;
      const r = row(c.role === "employee" ? "people" : "home", c.name, `${c.location || "Location not set"} · ${c.role === "owner" ? "Owner" : c.role === "coowner" ? "Co-owner" : "Employee"}${c.verified ? " · Verified ✓" : ""}`, active ? "Current" : "›");
      r.classList.add("tap");
      if (active) r.classList.add("current");
      r.setAttribute("role", "button");
      r.tabIndex = 0;
      r.addEventListener("click", () => { if (!active) switchCompany(c.id, c.name); });
      box.append(r);
    });
    if (!list.length) box.append(empty("No business yet. Add one below, or join a company with an employee ID."));
    const mine = $("biz-this");
    mine.innerHTML = "";
    if (!t) { $("biz-this-title").hidden = true; return; }
    $("biz-this-title").hidden = false;
    $("biz-this-title").textContent = t.companyName;
    const info = row("location", t.location || "Location not set", t.verified ? `Verified business${t.website ? ` · ${t.website}` : ""}` : "Not verified yet", "");
    info.classList.add("compact");
    mine.append(info);
    const act = (ico, label, sub, fn, danger) => { const b = row(ico, label, sub, "›"); b.classList.add("compact", "tap"); if (danger) b.classList.add("danger"); b.setAttribute("role", "button"); b.tabIndex = 0; b.addEventListener("click", fn); mine.append(b); };
    if (t.role === "owner" && !t.verified) act("done", "Verify this business", "With your company's website and work email", openVerify);
    if (t.role === "owner") act("undo", "Delete this business…", "Removes the team and everything Ervo knows about it", openBizDelete, true);
    else act("open", "Leave this company", "Your chats here stay with the company", () => $("company-leave").click());
  }
  async function switchCompany(id, name) {
    buzz("tick");
    curtain("business", async () => {
      try {
        const v = await teamApi("me", { companyId: id });
        account.team = teamFromView(v);
        save(ACCOUNT_KEY, account);
        migrateLegacyBiz(id);
        switchInto(account, false);
        toast(`Now in ${name || account.team.companyName}`);
      } catch (e) { $("switching").hidden = true; toast(e.message); }
    });
  }
  $("open-biz").addEventListener("click", openBiz);
  $("biz-back").addEventListener("click", () => show(backTo("bizpage")));
  $("biz-add").addEventListener("click", () => { pendingAcc = account; switching = true; show("welcome"); setTeamRole("owner"); $("team-company").value = ""; $("team-location").value = ""; $("team-error").textContent = ""; step("team"); });
  $("biz-join").addEventListener("click", () => { pendingAcc = account; switching = true; show("welcome"); setTeamRole("employee"); $("team-company").value = ""; $("team-location").value = ""; $("team-code").value = ""; $("team-error").textContent = ""; step("team"); });
  // Verify
  function openVerify() { $("verify-site").value = (account.team && account.team.website) || ""; $("verify").hidden = false; setTimeout(() => $("verify-site").focus(), 60); }
  $("verify-cancel").addEventListener("click", () => { $("verify").hidden = true; });
  $("verify").addEventListener("click", (e) => { if (e.target === $("verify")) $("verify").hidden = true; });
  $("verify-go").addEventListener("click", async () => {
    const site = $("verify-site").value.trim();
    if (!site) return;
    $("verify-go").disabled = true;
    try {
      const v = await teamApi("company/verify", { website: site });
      account.team = teamFromView(v);
      save(ACCOUNT_KEY, account);
      $("verify").hidden = true;
      renderBiz();
      if (v.verified) { logActivity({ kind: "team", ico: "done", title: `Verified ${account.team.companyName}` }); ervoSays(`${account.team.companyName} is verified ✅ Nobody else can claim it at ${account.team.location || "your location"} now.`, { instant: true }); }
      else ervoSays(v.reason || "I couldn't verify that yet.", { instant: true });
      if (!v.verified) show("chat");
    } catch (e) { toast(e.message); }
    $("verify-go").disabled = false;
  });
  // Delete
  function openBizDelete() {
    const t = account.team;
    $("bizdel-text").textContent = `${t.companyName}${t.location ? ` in ${t.location}` : ""} will be removed from Ervo: the team, its employee IDs and the chats Ervo kept for it. Employees lose access right away. This can't be undone.`;
    $("bizdel-name").value = "";
    $("bizdel").hidden = false;
    setTimeout(() => $("bizdel-name").focus(), 60);
  }
  $("bizdel-cancel").addEventListener("click", () => { $("bizdel").hidden = true; });
  $("bizdel").addEventListener("click", (e) => { if (e.target === $("bizdel")) $("bizdel").hidden = true; });
  $("bizdel-go").addEventListener("click", async () => {
    const typed = $("bizdel-name").value.trim();
    if (!typed) return;
    $("bizdel-go").disabled = true;
    try {
      const gone = account.team.companyName;
      const r = await teamApi("company/delete", { confirm: typed });
      $("bizdel").hidden = true;
      // Clear this company's space on the phone
      try { const pre = `biz:${account.team.companyId}:`; const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(pre)) ks.push(k); } ks.forEach((k) => localStorage.removeItem(k)); } catch (e) { /* fine */ }
      const next = (r.companies || [])[0];
      if (next) { account.team = null; save(ACCOUNT_KEY, account); switchCompany(next.id, next.name); toast(`${gone} deleted`); }
      else { account.team = null; setNS("business", null); save(ACCOUNT_KEY, account); pendingAcc = account; show("welcome"); setTeamRole("owner"); step("team"); $("team-error").textContent = `${gone} was deleted. Start a new company here, or join one with an employee ID.`; }
    } catch (e) { toast(e.message); }
    $("bizdel-go").disabled = false;
  });
  if ($("company-leave")) $("company-leave").addEventListener("click", () => {
    $("company").hidden = true;
    askConfirm(`Leave ${account.team.companyName}?`, "You'll be signed out of Ervo for Business on this phone. Your company keeps the chats you had with Ervo here.", "Leave", async () => {
      try { await teamApi("leave"); } catch (e) { toast(e.message); return; }
      signOut();
    });
  });

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
    const mine = el.classList.contains("me");
    const text = (() => { const tag = el.querySelector(".voice-tag"); return (tag ? el.innerText.replace(tag.innerText, "") : el.innerText).trim(); })();
    if (mine) {
      item("Copy", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
        () => copyText(text).then((ok) => toast(ok ? "Copied" : "Couldn't copy that. Try again.")));
      item("Send again", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>', () => send(text));
      item("Edit", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M12 6l4 4"/></svg>', () => { $("message").value = text; $("message").focus(); syncComposer(); });
      document.body.append(menu);
      const r0 = el.getBoundingClientRect();
      const mh0 = menu.offsetHeight, mw0 = menu.offsetWidth;
      menu.style.top = Math.max(60, r0.bottom + 8 + mh0 < window.innerHeight - 90 ? r0.bottom + 8 : r0.top - mh0 - 8) + "px";
      menu.style.left = Math.min(Math.max(12, r0.right - mw0), window.innerWidth - mw0 - 12) + "px";
      return;
    }
    item("Copy", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
      () => copyText(el.innerText).then((ok) => toast(ok ? "Copied" : "Couldn't copy that. Try again.")));
    // The question this reply answered
    let q = el.previousElementSibling;
    while (q && !(q.classList.contains("msg") && q.classList.contains("me") && !q.classList.contains("photo") && !q.classList.contains("link"))) q = q.previousElementSibling;
    if (q && account) {
      const tag = q.querySelector(".voice-tag");
      const asked = (tag ? q.innerText.replace(tag.innerText, "") : q.innerText).trim();
      if (asked) item("Ask again", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>', () => send(asked));
      if (asked && AI_URL) item("Why This Answer?", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1v.5M12 16.8v.1"/></svg>',
        () => send("Why did you answer that way? Briefly tell me what you based it on, like what you know about me, my location or the time."));
    }
    {
      item("Share", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
        () => shareText("From Ervo", el.innerText));
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
      const el = e.target.closest(".msg.them, .msg.me");
      if (!el || e.target.closest("a") || el.classList.contains("photo") || el.classList.contains("link")) return;
      startX = e.clientX; startY = e.clientY;
      cancel();
      holdTimer = setTimeout(() => msgMenu(el), 480);
    });
    thread.addEventListener("pointermove", (e) => { if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) cancel(); });
    ["pointerup", "pointercancel"].forEach((n) => thread.addEventListener(n, cancel));
    // Right-click or a keyboard's menu key does the same
    thread.addEventListener("contextmenu", (e) => { const el = e.target.closest(".msg.them, .msg.me"); if (el && !el.classList.contains("photo") && !el.classList.contains("link")) { e.preventDefault(); cancel(); msgMenu(el); } });
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
      if (sheet.classList.contains("no-swipe") || e.target.closest(".look-grid, .cal-events, .tc-thread")) { y0 = null; return; }
      if (sheet.scrollTop > 0 || e.target.closest("input, select, textarea")) { y0 = null; return; }
      const scrolls = sheet.scrollHeight > sheet.clientHeight + 4;
      if (scrolls && e.touches[0].clientY - sheet.getBoundingClientRect().top > 72) { y0 = null; return; }
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
    // From the website's QR code: #signin=<email>&plan=personal|business (the hash is dropped right away)
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const hintEmail = (hash.get("signin") || "").trim().toLowerCase();
    const hintPlan = PLAN[hash.get("plan")] ? hash.get("plan") : "personal";
    const dropHash = () => { try { if (location.hash) history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* fine */ } };
    if (hintEmail) { dropHash(); setTimeout(dropHash, 600); } // some browsers re-apply the fragment after load
    if (takeRecoveryHash()) return;
    // "Keep me logged in" off: a sign-in that was put away asks for the password again
    if (realAuth && session() && load(KEEP_KEY) === false && load(LEFT_KEY)) { const a0 = load(ACCOUNT_KEY); drop(SESSION_KEY); drop(ACCOUNT_KEY); drop(LEFT_KEY); if (a0) { $("contact").value = a0.contact || ""; setPlan(a0.plan); } }
    const saved = load(ACCOUNT_KEY);
    if (saved && saved.plan && saved.name && realAuth && !session()) { drop(ACCOUNT_KEY); show("welcome"); }
    else if (saved && saved.plan && saved.name && load(BIO_KEY) && native && native.biometricAvailable && native.biometricAvailable()) { lockedAcc = saved; $("lock-owl").src = lookSrc(); show("lock"); setTimeout(() => $("lock-go").click(), 350); }
    else if (saved && saved.plan && saved.name) openChat(saved, false);
    else if (OVERLAY && native && native.openFullApp) native.openFullApp(); // sign in first, in the full app
    else show("welcome");
    if (native) $("same-email").hidden = false; // Android can't carry the email through the APK install
    if (hintEmail && !account && !OVERLAY) startFromHint(hintEmail, hintPlan);
  }
  // Signed up on the website: same sign-in if the browser already has it, else the email is filled in
  async function startFromHint(email, plan) {
    setPlan(plan);
    if (session() && (await resumeFromSession(plan, email))) return;
    if (!isEmail(email)) return;
    $("contact").value = email;
    setTimeout(() => $("password").focus(), 300);
  }
  // ----- locked: fingerprint, face or screen lock -----
  $("lock-go").addEventListener("click", () => { if (native && native.biometricAuth) native.biometricAuth("Unlock Ervo"); });
  $("lock-pass").addEventListener("click", () => { lockedAcc = null; drop(SESSION_KEY); const a0 = load(ACCOUNT_KEY); drop(ACCOUNT_KEY); if (a0) { $("contact").value = a0.contact || ""; setPlan(a0.plan); } show("welcome"); step("contact"); });
  window.ervoBiometric = (ok) => {
    const yes = String(ok) === "true";
    if ($("lock").classList.contains("active")) { if (yes && lockedAcc) { const a = lockedAcc; lockedAcc = null; openChat(a, false); } else buzz("reject"); return; }
    if (bioArming) { bioArming = false; if (yes) { save(BIO_KEY, true); toast("Fingerprint or face unlock is on"); } else toast("Couldn't confirm. Fingerprint unlock stays off."); syncSignInRows(); }
  };
  // The app was put away: remember it, for "keep me logged in" off
  document.addEventListener("visibilitychange", () => { if (document.hidden && account) save(LEFT_KEY, true); });
  window.addEventListener("pagehide", () => { if (account) save(LEFT_KEY, true); });
  async function resumeFromSession(plan, email) {
    try {
      const token = await freshToken();
      if (!token) return false;
      const u = await auth("user", null, "GET", token);
      if (!u || !u.id || (email && u.email && u.email.toLowerCase() !== email)) return false;
      userMeta = u.user_metadata || {};
      contact = u.email || email || "";
      const prof = userMeta.profiles && userMeta.profiles[plan];
      if (prof && prof.name) {
        const acc = { plan, name: prof.name, contact, id: u.id, createdAt: u.created_at };
        setNS(plan);
        save(ACCOUNT_KEY, acc);
        openChat(acc, false);
        return true;
      }
      show("welcome");
      step("name"); // Business continues to Company or Employee from here, as usual
      return true;
    } catch (e) { return false; }
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
