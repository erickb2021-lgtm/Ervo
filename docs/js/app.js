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

// Hero: "your AI ___" cycles through Ervo's jobs, personal and business.
// The next word rises in while the old one leaves, so the slot is never empty; the width eases between them.
(function () {
  const rot = document.getElementById("rot");
  if (!rot) return;
  const words = ["assistant 💬", "planner 📅", "business partner 🤝", "shopper 🛍️", "customer support 🎧", "chef 🍳", "travel buddy ✈️",
    "fitness coach 🏋️", "study buddy 📚", "money saver 💰", "party planner 🎉", "team manager 👥"];
  let item = rot.querySelector(".rot-item");
  let i = 0, busy = false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  setInterval(() => {
    if (busy || document.hidden) return;
    busy = true;
    const next = document.createElement("span");
    next.className = "rot-item enter";
    next.textContent = words[(i + 1) % words.length];
    rot.style.width = item.offsetWidth + "px";   // hold the current width
    item.classList.add("leave");                  // the old word floats above the slot as it leaves
    rot.appendChild(next);
    const w = next.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => { rot.style.width = w + "px"; next.classList.remove("enter"); }));
    setTimeout(() => { item.remove(); item = next; i = (i + 1) % words.length; rot.style.width = ""; busy = false; }, 650);
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
  const src = (id) => `assets/sm/ervo-${id}.webp`; // small copies; the full-size art stays in assets/

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

// Mock result cards under each example answer. Pictures are 3D icons used as fake photos;
// the buttons and switches only react on screen, nothing is sent or saved.
const CMP_PIC = (name, alt) => {
  const f = name.toLowerCase().replace(/ /g, "_");
  return `<img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/${encodeURIComponent(name)}/3D/${f}_3d.png" alt="${alt}" loading="lazy">`;
};
const CMP_CARDS = {
  nap: () => `<div class="mc mc-alarm"><div class="mc-pic" style="--g1:#ffd36e;--g2:#ff9f43">${CMP_PIC("Alarm clock", "Alarm clock")}</div>
    <div class="mc-main"><b class="mc-big">2:30 <small>PM</small></b><span>Nap · rings in 30 minutes</span></div>
    <button type="button" class="mc-switch on" aria-pressed="true" aria-label="Alarm on"></button></div>
    <div class="mc-actions"><button type="button" class="mc-btn">Snooze 5 min</button><button type="button" class="mc-btn main">Keep it</button></div>`,
  dentist: () => `<div class="mc mc-event"><span class="mc-bar"></span><div class="mc-main"><b>Dentist</b><span>Thursday · 4:00 to 5:00 PM</span><span class="mc-sub">Bright Smile Dental · 12 min away</span></div>
    <div class="mc-pic" style="--g1:#c7f0ff;--g2:#7cc8ff">${CMP_PIC("Tooth", "Tooth")}</div></div>
    <div class="mc-week">${["M","T","W","T","F","S","S"].map((d, i) => `<span class="${i === 3 ? "on" : ""}">${d}<i>${10 + i}</i></span>`).join("")}</div>`,
  lights: () => `<div class="mc-shop">${[
      ["Flashlight", "#fde68a", "#f59e0b", "Field LED 200W", "$89", "4.7"],
      ["Light bulb", "#dbeafe", "#60a5fa", "Solar flood pair", "$129", "4.5"],
      ["Battery", "#d1fae5", "#34d399", "Battery stadium light", "$149", "4.8"],
    ].map(([n, a, b, t, p, r]) => `<div class="mc-item"><div class="mc-photo" style="--g1:${a};--g2:${b}">${CMP_PIC(n, t)}</div>
      <b>${t}</b><span>${p} · ★ ${r}</span><div class="mc-actions tight"><button type="button" class="mc-btn">View</button><button type="button" class="mc-btn main">Add to cart</button></div></div>`).join("")}</div>
    <p class="mc-note">Ervo always asks before you buy.</p>`,
  call: () => `<div class="mc mc-call"><div class="mc-avatar" style="--g1:#fbcfe8;--g2:#f472b6">M</div><div class="mc-main"><b>Mom</b><span>Mobile · calling in <em class="mc-count">3</em></span></div></div>
    <div class="mc-actions"><button type="button" class="mc-btn danger">Cancel</button><button type="button" class="mc-btn main">Call now</button></div>`,
  meet: () => `<div class="mc mc-meet"><div class="mc-pic" style="--g1:#bbf7d0;--g2:#22c55e">${CMP_PIC("Video camera", "Video camera")}</div>
    <div class="mc-main"><b>Catch-up with Zephyr</b><span>Friday · 3:00 to 3:30 PM</span><span class="mc-link">meet.google.com/abc-defg-hij</span></div></div>
    <div class="mc-actions"><button type="button" class="mc-btn">Copy link</button><button type="button" class="mc-btn main">Save in Google Calendar</button></div>`,
  birthday: () => `<div class="mc-gifts">${[
      ["Wrapped gift", "#fecdd3", "#fb7185", "Photo book", "$45"],
      ["Bouquet", "#fce7f3", "#f9a8d4", "Flower delivery", "$38"],
      ["Candle", "#fef3c7", "#fbbf24", "Candle set", "$32"],
    ].map(([n, a, b, t, p]) => `<button type="button" class="mc-gift" aria-pressed="false"><span class="mc-photo" style="--g1:${a};--g2:${b}">${CMP_PIC(n, t)}</span><b>${t}</b><span>${p}</span></button>`).join("")}</div>
    <div class="mc mc-event slim"><span class="mc-bar pink"></span><div class="mc-main"><b>Jordan's birthday dinner</b><span>Saturday · 7:00 PM · 4 people</span></div></div>`,
  refund: () => `<div class="mc mc-receipt"><div class="mc-row head"><b>Order #4821</b><span class="mc-pill ok">Refund sent</span></div>
    <div class="mc-row"><span>Charge · Nov 2</span><b>$49.00</b></div>
    <div class="mc-row struck"><span>Duplicate charge · Nov 2</span><b>$49.00</b></div>
    <div class="mc-row total"><span>Back to the customer</span><b>$49.00</b></div>
    <div class="mc-track"><i></i></div><span class="mc-sub">Arrives in 3 to 5 business days</span></div>`,
  employee: () => `<div class="mc mc-id"><div class="mc-pic round" style="--g1:#e0e7ff;--g2:#818cf8">${CMP_PIC("Bust in silhouette", "Employee photo")}</div>
    <div class="mc-main"><span class="mc-sub">Employee ID</span><b class="mc-code">ERVO-7F3K-92QX-4MNB</b><span>New employee · Support team</span></div></div>
    <div class="mc-actions"><button type="button" class="mc-btn">Copy ID</button><button type="button" class="mc-btn main">Share</button></div>`,
  coowner: () => `<div class="mc mc-invite"><div class="mc-pic" style="--g1:#fde68a;--g2:#f59e0b">${CMP_PIC("Crown", "Crown")}</div>
    <div class="mc-main"><b>Co-owner invite</b><span>Can do everything you can</span><span class="mc-sub">Except remove co-owners or you</span></div></div>
    <ul class="mc-checks"><li>Sees every team chat</li><li>Manages billing and refunds</li><li>Adds and removes employees</li></ul>
    <div class="mc-actions"><button type="button" class="mc-btn">Copy link</button><button type="button" class="mc-btn main">Send invite</button></div>`,
  bills: () => `<div class="mc mc-bills">${[
      ["Software renewals (3)", "$186", "Nov 12"],
      ["Supplier invoice", "$1,240", "Nov 18"],
      ["Quarterly taxes", "Estimate", "Nov 15"],
    ].map(([t, a, d]) => `<div class="mc-row"><div><b>${t}</b><span class="mc-sub">Due ${d}</span></div><span class="mc-amt">${a}</span><button type="button" class="mc-switch" aria-pressed="false" aria-label="Remind me about ${t}"></button></div>`).join("")}
    <span class="mc-sub">Turn on a switch to get a reminder.</span></div>`,
  policy: () => `<div class="mc mc-doc"><div class="mc-page"><span class="mc-url">yourstore.com/returns</span><i></i><i></i><i class="short"></i><i></i><i class="short"></i></div>
    <div class="mc-main"><span class="mc-pill ok">Learned</span><ul class="mc-checks"><li>30-day returns with a receipt</li><li>Store credit after 30 days</li><li>Free return shipping</li></ul></div></div>`,
  handoff: () => `<div class="mc mc-ticket"><div class="mc-row head"><b>Ticket #2190</b><span class="mc-pill warn">High priority</span></div>
    <div class="mc-who"><div class="mc-pic round" style="--g1:#ccfbf1;--g2:#2dd4bf">${CMP_PIC("Headphone", "Support employee")}</div><div><b>Support employee</b><span class="mc-sub">Assigned just now</span></div></div>
    <p class="mc-summary">Summary: the customer's package says delivered, but it never arrived. They'd like a replacement by Friday.</p>
    <div class="mc-actions"><button type="button" class="mc-btn">View chat</button><button type="button" class="mc-btn main">Open ticket</button></div>`,
};
function showCard(panel, key, show) {
  const slot = panel.querySelector(".cmp-card");
  if (!slot) return;
  clearInterval(slot._count);
  if (!show || !CMP_CARDS[key]) { slot.hidden = true; slot.innerHTML = ""; return; }
  slot.innerHTML = CMP_CARDS[key]();
  slot.hidden = false;
  slot.classList.remove("pop"); void slot.offsetWidth; slot.classList.add("pop");
  slot.querySelectorAll("img").forEach((img) => { img.onerror = () => img.remove(); });
  const count = slot.querySelector(".mc-count");
  if (count) {
    let n = 3;
    slot._count = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(slot._count); count.parentElement.textContent = "Mobile · calling…"; return; }
      count.textContent = n;
    }, 1000);
  }
}
document.addEventListener("click", (e) => {
  const sw = e.target.closest(".cmp-card .mc-switch, .cmp-card .mc-gift");
  if (sw) {
    const on = sw.getAttribute("aria-pressed") !== "true";
    sw.setAttribute("aria-pressed", String(on));
    sw.classList.toggle("on", on);
    return;
  }
  const btn = e.target.closest(".cmp-card .mc-btn");
  if (!btn || btn.dataset.busy) return;
  const label = btn.textContent;
  btn.dataset.busy = "1";
  btn.textContent = "Done ✓";
  btn.classList.add("done");
  setTimeout(() => { btn.textContent = label; btn.classList.remove("done"); delete btn.dataset.busy; }, 1400);
});

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
        showCard(p, "", false);
        typing.hidden = false;
        const doing = b.dataset.doing || "thinking";
        typing.querySelector("em").textContent = doing.charAt(0).toUpperCase() + doing.slice(1);
        me.classList.remove("pop"); void me.offsetWidth; me.classList.add("pop");
        timer = setTimeout(() => {
          typing.hidden = true;
          them.textContent = b.dataset.a;
          them.hidden = false;
          them.classList.remove("pop"); void them.offsetWidth; them.classList.add("pop");
          showCard(p, b.dataset.card, true);
        }, 900);
      });
    });
  });
  panels.forEach((p) => { const first = p.querySelector(".try"); if (first) showCard(p, first.dataset.card, true); });
  select("personal");
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

// The version line always comes from the app's own version.json, so the website shows the right
// version automatically every time the app is updated (no hand edit needed here).
fetch("app/version.json", { cache: "no-store" }).then((r) => r.json()).then((v) => {
  if (!v || !v.version) return;
  document.querySelectorAll(".dl-note").forEach((n) => { n.textContent = `Free preview, version ${v.version}. Not on the App Store or Google Play yet.`; });
}).catch(() => {});

// Hero phone: leans a few degrees toward the pointer, eased each frame so it feels weighted, not stuck to the cursor.
// Only for a fine pointer; touch devices and reduced-motion users see it still.
(function () {
  const tilt = document.getElementById("ph-tilt");
  const spot = tilt && tilt.closest(".spot");
  if (!spot || !matchMedia("(hover: hover) and (pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  function frame() {
    cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
    tilt.style.transform = `perspective(1200px) rotateX(${(4 + cy).toFixed(2)}deg) rotateY(${(-9 + cx).toFixed(2)}deg) translateZ(0)`;
    raf = (Math.abs(tx - cx) > 0.01 || Math.abs(ty - cy) > 0.01) ? requestAnimationFrame(frame) : 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  spot.addEventListener("pointermove", (e) => {
    const r = spot.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 10;
    ty = ((e.clientY - r.top) / r.height - 0.5) * -6;
    kick();
  });
  spot.addEventListener("pointerleave", () => { tx = 0; ty = 0; kick(); });
})();
