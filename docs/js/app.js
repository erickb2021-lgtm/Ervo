// Sign up on the website: email only, a code from Ervo's real sign-in (Supabase, the same one the app
// uses), then QR codes to get the app. The app opens already knowing this email (iPhone link) and,
// because the Ervo is set up here, it goes straight in once the person confirms it's them.
(function () {
  const auth = document.getElementById("auth");
  if (!auth) return;
  const $ = (id) => document.getElementById(id);
  const steps = auth.querySelectorAll(".auth-step");
  const CFG = window.ERVO_CONFIG || {};
  const SB_URL = (CFG.supabaseUrl || "").replace(/\/+$/, "");
  const SB_KEY = CFG.supabaseKey || "";
  const real = !!(SB_URL && SB_KEY);
  const SITE_KEY = "ervo-site-signin"; // what this website remembers: {email, plan, name}
  const state = { email: "", plan: "personal", name: "" };

  const HINT = {
    personal: "Personal use only: planning, shopping, your own returns and more.",
    business: "Business use only: customer support, refunds by your policy, your team.",
  };
  const planRadios = auth.querySelectorAll('input[name="plan"]');
  function setPlan(plan) {
    state.plan = plan;
    planRadios.forEach((r) => { r.checked = r.value === plan; });
    $("plan-hint").textContent = HINT[plan];
  }
  planRadios.forEach((r) => r.addEventListener("change", () => setPlan(r.value)));

  function show(name) {
    steps.forEach((s) => s.classList.toggle("active", s.dataset.step === name));
    const input = auth.querySelector(`[data-step="${name}"] input:not([type=radio])`);
    if (input) input.focus({ preventScroll: true });
  }
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
  const drop = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  ["contact", "code", "name"].forEach((id) => $(id).addEventListener("input", () => { $(id + "-error").textContent = ""; }));

  async function sb(path, body, method, token) {
    const r = await fetch(`${SB_URL}/auth/v1/${path}`, {
      method: method || "POST",
      headers: { apikey: SB_KEY, "content-type": "application/json", Authorization: `Bearer ${token || SB_KEY}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(j.msg || j.error_description || j.message || `auth ${r.status}`); err.status = r.status; throw err; }
    return j;
  }
  function friendly(e) {
    if (e.status === 429) return "Too many tries. Wait a minute, then try again.";
    if (/expired|invalid/i.test(e.message)) return "That code didn't work or has expired. Check it, or go back and get a new one.";
    return "Couldn't reach Ervo's sign-in. Check your connection and try again.";
  }
  if (!real) $("code-note").textContent = "Preview: no code is sent. Enter any 6 digits.";

  // 1. Email
  auth.querySelector('[data-step="contact"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("contact").value.trim();
    if (!v) { $("contact-error").textContent = "Enter your email."; return; }
    if (!isEmail(v)) { $("contact-error").textContent = "That doesn't look like an email. Check it and try again."; return; }
    const btn = e.submitter || e.target.querySelector(".btn");
    if (real) {
      btn.disabled = true;
      try { await sb("otp", { email: v, create_user: true }); } catch (err) { $("contact-error").textContent = friendly(err); btn.disabled = false; return; }
      btn.disabled = false;
    }
    state.email = v;
    $("sent-to").textContent = v;
    show("code");
  });

  // 2. Code (Supabase sends 6 to 8 digits)
  let session = null;
  let meta = {};
  $("code").addEventListener("input", () => { $("code").value = $("code").value.replace(/\D/g, "").slice(0, 8); });
  auth.querySelector('[data-step="code"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("code").value;
    if (!/^\d{6,8}$/.test(code)) { $("code-error").textContent = "Enter the whole code from the email."; return; }
    if (real) {
      let j;
      try { j = await sb("verify", { type: "email", email: state.email, token: code }); } catch (err) { $("code-error").textContent = friendly(err); return; }
      session = { access_token: j.access_token, refresh_token: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000 };
      meta = (j.user && j.user.user_metadata) || {};
      state.id = j.user && j.user.id;
      // On this same browser, the web app at /app/ is signed in too (iPhone Safari, Android Chrome)
      save("ervo-session", session);
    }
    const prof = meta.profiles && meta.profiles[state.plan];
    if (prof && prof.name) { state.name = prof.name; finish(true); return; }
    // Business: the company (or employee ID) is set up in the app, so stop here
    if (state.plan === "business") { finish(false); return; }
    show("name");
  });
  auth.querySelector("[data-back]").addEventListener("click", () => { $("code").value = ""; show("contact"); });

  // 3. Name (Personal). Saved to the account, so the app recognizes it and skips this step.
  auth.querySelector('[data-step="name"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("name").value.trim();
    if (v.length < 2) { $("name-error").textContent = "Enter your name."; return; }
    if (real && session) {
      try {
        const profiles = Object.assign({}, meta.profiles || {}, { personal: { name: v } });
        await sb("user", { data: { name: v, plan: "personal", profiles } }, "PUT", session.access_token);
      } catch (err) { $("name-error").textContent = friendly(err); return; }
    }
    state.name = v;
    finish(true);
  });

  // 4. Signed in: QR codes for iPhone and Android
  function finish(ready) {
    save(SITE_KEY, { email: state.email, plan: state.plan, name: state.name });
    if (ready && state.name) save("ervo-account", { plan: state.plan, name: state.name, contact: state.email, id: state.id, createdAt: new Date().toISOString() });
    renderDone(ready);
    show("done");
  }
  const biz = () => state.plan === "business";
  function renderDone(ready) {
    $("done-title").textContent = state.name ? `You're in, ${state.name}!` : "Your email is confirmed!";
    $("done-email").textContent = state.email;
    $("done-plan").textContent = biz() ? "Business" : "Personal";
    $("done-plan").classList.toggle("biz", biz());
    $("done-note").textContent = biz() && !ready
      ? "Open Ervo for Business with this email. It asks you to set up your company, or to join one with your employee ID."
      : "Ervo opens with your email filled in. Confirm it's you, and you're straight in, with no setup again.";
    pick(/Android/i.test(navigator.userAgent) ? "android" : "ios");
  }
  function appLink() {
    // The email rides after # so it never reaches a server
    const u = new URL("app/", location.href);
    u.hash = `signin=${encodeURIComponent(state.email)}&plan=${state.plan}`;
    return u.toString();
  }
  const APK = "https://github.com/erickb2021-lgtm/Ervo/releases/latest/download/Ervo.apk";
  function qr(url, fallback) {
    const box = $("get-qr");
    if (window.qrcode) {
      try {
        const q = window.qrcode(0, "M");
        q.addData(url);
        q.make();
        box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
        box.querySelector("svg").setAttribute("aria-label", "QR code to get Ervo");
        return;
      } catch (e) { /* fall back to the plain download code */ }
    }
    box.innerHTML = `<img src="${fallback}" alt="QR code to get Ervo" width="168" height="168">`;
  }
  const esc = (t) => String(t).replace(/[<>&"]/g, "");
  function pick(os) {
    $("get-ios").setAttribute("aria-selected", String(os === "ios"));
    $("get-android").setAttribute("aria-selected", String(os === "android"));
    const link = $("get-link");
    if (os === "ios") {
      qr(appLink(), "assets/qr-ios.svg");
      $("get-how").innerHTML = "Scan with your iPhone camera. Ervo opens in Safari with your email ready. Then tap <b>Share</b> and <b>Add to Home Screen</b>.";
      link.href = appLink();
      link.textContent = "Open Ervo on this iPhone";
    } else {
      qr(APK, "assets/qr-android.svg");
      $("get-how").innerHTML = `Scan with your Android camera to download Ervo, then tap <b>Install</b>. Sign in with <b>${esc(state.email)}</b> and you're straight in.`;
      link.href = APK;
      link.textContent = "Download for Android";
    }
  }
  $("get-ios").addEventListener("click", () => pick("ios"));
  $("get-android").addEventListener("click", () => pick("android"));

  auth.querySelector("[data-reset]").addEventListener("click", () => {
    [SITE_KEY, "ervo-session", "ervo-account", "ervo-demo-account"].forEach(drop);
    $("contact").value = ""; $("code").value = ""; $("name").value = "";
    Object.assign(state, { email: "", name: "" });
    show("contact");
  });

  // Already signed in on this computer
  const was = load(SITE_KEY);
  if (was && was.email) {
    Object.assign(state, was);
    setPlan(was.plan || "personal");
    renderDone(!!was.name || was.plan !== "business");
    steps.forEach((s) => s.classList.toggle("active", s.dataset.step === "done"));
  }

  // "Create an account" and "Get Ervo ..." buttons jump back up to the form
  document.querySelectorAll("[data-focus-auth]").forEach((a) => {
    a.addEventListener("click", () => setTimeout(() => $("contact").focus({ preventScroll: true }), 500));
  });
  document.querySelectorAll("[data-plan]").forEach((a) => {
    a.addEventListener("click", () => {
      setPlan(a.dataset.plan);
      setTimeout(() => $("contact").focus({ preventScroll: true }), 500);
    });
  });
  window.ervoSetOwl = (src) => { $("done-owl").src = src; };
})();

// Hero: "your AI ___" cycles through Ervo's jobs, personal and business
(function () {
  const rot = document.getElementById("rot");
  if (!rot) return;
  const words = ["assistant 💬", "planner 📅", "business partner 🤝", "shopper 🛍️", "customer support 🎧", "chef 🍳", "travel buddy ✈️",
    "fitness coach 🏋️", "study buddy 📚", "money saver 💰", "party planner 🎉", "team manager 👥"];
  const item = rot.querySelector(".rot-item");
  let i = 0;

  const fit = () => { rot.style.width = item.offsetWidth + "px"; };
  fit();
  window.addEventListener("resize", fit);
  if (document.fonts) document.fonts.ready.then(fit);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  setInterval(() => {
    item.classList.add("leave");
    setTimeout(() => {
      i = (i + 1) % words.length;
      item.textContent = words[i];
      item.classList.remove("leave");
      item.classList.add("enter");
      fit();
      void item.offsetWidth;
      item.classList.remove("enter");
    }, 520);
  }, 3600);
})();

// Headline avatar: tap Ervo to pick any of the app's 23 looks
(function () {
  const btn = document.getElementById("avatar");
  const box = document.getElementById("look-picker");
  const grid = document.getElementById("look-grid");
  if (!btn || !box) return;
  const img = btn.querySelector("img");
  const LOOKS = [
    ["classic", "Classic"], ["business", "Business"], ["king", "Royal"], ["detective", "Detective"], ["explorer", "Explorer"],
    ["scientist", "Scientist"], ["wizard", "Wizard"], ["ninja", "Ninja"], ["samurai", "Samurai"], ["pirate", "Pirate"],
    ["pilot", "Pilot"], ["athlete", "Athlete"], ["soccer", "Soccer"], ["musician", "Musician"], ["chef", "Chef"],
    ["creative", "Artist"], ["gamer", "Gamer"], ["space", "Space"], ["scholar", "Scholar"], ["tech", "Tech"],
    ["builder", "Builder"], ["winter", "Winter"], ["holiday", "Holiday"],
  ];
  const KEY = "ervo-site-look";
  let current = "classic";
  try { current = localStorage.getItem(KEY) || "classic"; } catch (e) { /* fine */ }
  if (!LOOKS.some((l) => l[0] === current)) current = "classic";
  const src = (id) => `assets/ervo-${id}.png`;

  LOOKS.forEach(([id, name]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "look";
    b.dataset.look = id;
    b.innerHTML = `<span><img src="${src(id)}" alt="" loading="lazy"></span><small>${name}</small>`;
    b.setAttribute("aria-label", `${name} Ervo`);
    b.addEventListener("click", () => { set(id, true); setOpen(false); btn.focus(); });
    grid.append(b);
  });

  function set(id, animate) {
    const name = (LOOKS.find((l) => l[0] === id) || LOOKS[0])[1];
    grid.querySelectorAll(".look").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.look === id)));
    try { localStorage.setItem(KEY, id); } catch (e) { /* fine */ }
    if (window.ervoSetOwl) window.ervoSetOwl(src(id));
    if (!animate) { img.src = src(id); img.alt = `${name} Ervo`; return; }
    img.classList.add("out");
    setTimeout(() => {
      img.src = src(id);
      img.alt = `${name} Ervo`;
      img.classList.remove("out");
      img.classList.add("in");
      void img.offsetWidth;
      img.classList.remove("in");
    }, 280);
  }
  function setOpen(open) {
    box.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) (grid.querySelector('[aria-pressed="true"]') || grid.firstChild).focus({ preventScroll: true });
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(box.hidden); });
  document.addEventListener("click", (e) => { if (!box.hidden && !box.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) { setOpen(false); btn.focus(); } });
  set(current, false);
})();

// Personal vs Business: tap a tab, then tap an example to see how that Ervo answers.
// These buttons only show examples; nothing is sent anywhere.
(function () {
  const root = document.getElementById("compare");
  if (!root) return;
  const tabs = root.querySelectorAll(".cmp-tabs [role=tab]");
  const panels = root.querySelectorAll(".cmp-panel");
  function select(which) {
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.side === which)));
    panels.forEach((p) => { p.hidden = p.dataset.side !== which; });
    root.classList.toggle("is-biz", which === "business");
  }
  tabs.forEach((t) => t.addEventListener("click", () => select(t.dataset.side)));
  panels.forEach((p) => {
    const me = p.querySelector(".cmp-me");
    const them = p.querySelector(".cmp-them");
    const typing = p.querySelector(".cmp-typing");
    let timer = 0;
    p.querySelectorAll(".try").forEach((b) => {
      b.addEventListener("click", () => {
        p.querySelectorAll(".try").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        clearTimeout(timer);
        me.textContent = b.dataset.q;
        them.hidden = true;
        typing.hidden = false;
        typing.querySelector("em").textContent = b.dataset.doing || "thinking";
        me.classList.remove("pop"); void me.offsetWidth; me.classList.add("pop");
        timer = setTimeout(() => {
          typing.hidden = true;
          them.textContent = b.dataset.a;
          them.hidden = false;
          them.classList.remove("pop"); void them.offsetWidth; them.classList.add("pop");
        }, 900);
      });
    });
  });
  select("personal");
})();

// Phone example: the same Ervo on iPhone and Android
(function () {
  const phone = document.getElementById("demo-phone");
  if (!phone) return;
  const btns = document.querySelectorAll("[data-device]");
  btns.forEach((b) => b.addEventListener("click", () => {
    btns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    phone.classList.toggle("android", b.dataset.device === "android");
    phone.setAttribute("aria-label", phone.getAttribute("aria-label").replace(/on an? (iPhone|Android phone)/, b.dataset.device === "android" ? "on an Android phone" : "on an iPhone"));
  }));
})();

// Download now: iPhone / Android tabs, starting on the visitor's own phone type
(function () {
  const tabs = document.querySelectorAll(".download .dl-tabs [role=tab]");
  if (!tabs.length) return;
  function select(tab) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      select(next);
      next.focus();
    });
  });
  select(/Android/i.test(navigator.userAgent) ? document.getElementById("tab-android") : document.getElementById("tab-ios"));

  // Header dropdown: opens and closes the Download box
  const trigger = document.getElementById("dl-trigger");
  const box = document.getElementById("download");
  if (!trigger || !box) return;
  function setOpen(open) {
    box.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) box.querySelector('[aria-selected="true"]').focus();
  }
  trigger.addEventListener("click", (e) => { e.stopPropagation(); setOpen(box.hidden); });
  document.addEventListener("click", (e) => { if (!box.hidden && !box.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !box.hidden) { setOpen(false); trigger.focus(); }
  });
})();

// Fade sections in as they scroll into view
(function () {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) { els.forEach((el) => el.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("in"); io.unobserve(entry.target); }
    });
  }, { threshold: 0.15 });
  els.forEach((el) => io.observe(el));
})();
