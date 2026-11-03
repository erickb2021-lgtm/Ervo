// Demo sign-up flow. Nothing is sent to a server yet: the account is kept in
// this browser's localStorage until a real backend is connected.
(function () {
  const STORE_KEY = "ervo-demo-account";
  const auth = document.getElementById("auth");
  if (!auth) return;

  const steps = auth.querySelectorAll(".auth-step");
  const state = { contact: "", plan: "personal" };

  // Personal and Business are separate accounts with separate wording
  const PLAN_TEXT = {
    personal: { question: "What should Ervo call you?", label: "Your name", placeholder: "Alex", error: "Enter your name.", note: "Ervo Personal is ready. Tell it what you need." },
    business: { question: "What's your company called?", label: "Company name", placeholder: "Acme Coffee Co.", error: "Enter your company's name.", note: "Ervo for Business is ready. Next, add your help docs and policies." },
  };
  const planRadios = auth.querySelectorAll('input[name="plan"]');
  function setPlan(plan) {
    state.plan = plan;
    planRadios.forEach((r) => { r.checked = r.value === plan; });
    const t = PLAN_TEXT[plan];
    document.getElementById("name-question").textContent = t.question;
    document.getElementById("name-label").textContent = t.label;
    document.getElementById("company").placeholder = t.placeholder;
  }
  planRadios.forEach((r) => r.addEventListener("change", () => setPlan(r.value)));

  function show(name) {
    steps.forEach((s) => s.classList.toggle("active", s.dataset.step === name));
    const input = auth.querySelector(`[data-step="${name}"] input`);
    if (input) input.focus({ preventScroll: true });
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; }
  }
  function save(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
  }

  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function isPhone(v) {
    const digits = v.replace(/[\s().+-]/g, "");
    return /^\d{7,15}$/.test(digits) && /^[\d\s().+-]+$/.test(v);
  }

  function bindError(input, errorEl) {
    input.addEventListener("input", () => { errorEl.textContent = ""; });
  }

  // Step 1
  const contactForm = auth.querySelector('[data-step="contact"]');
  const contact = document.getElementById("contact");
  const contactError = document.getElementById("contact-error");
  bindError(contact, contactError);
  contactForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = contact.value.trim();
    if (!v) { contactError.textContent = "Enter your mobile number or email."; return; }
    if (!isEmail(v) && !isPhone(v)) { contactError.textContent = "That doesn't look like a valid number or email. Try again."; return; }
    state.contact = v;
    document.getElementById("sent-to").textContent = v;
    show("code");
  });

  // Step 2
  const codeForm = auth.querySelector('[data-step="code"]');
  const code = document.getElementById("code");
  const codeError = document.getElementById("code-error");
  bindError(code, codeError);
  code.addEventListener("input", () => { code.value = code.value.replace(/\D/g, "").slice(0, 6); });
  codeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.value)) { codeError.textContent = "Enter all 6 digits."; return; }
    const existing = load();
    if (existing && existing.contact === state.contact && existing.company) {
      finish(existing);
    } else {
      show("workspace");
    }
  });
  codeForm.querySelector("[data-back]").addEventListener("click", () => {
    code.value = "";
    show("contact");
  });

  // Step 3
  const wsForm = auth.querySelector('[data-step="workspace"]');
  const company = document.getElementById("company");
  const companyError = document.getElementById("company-error");
  bindError(company, companyError);
  wsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = company.value.trim();
    if (v.length < 2) { companyError.textContent = PLAN_TEXT[state.plan].error; return; }
    const account = { contact: state.contact, plan: state.plan, company: v, createdAt: new Date().toISOString() };
    save(account);
    finish(account);
  });

  function finish(account) {
    document.getElementById("welcome-name").textContent = account.company;
    document.getElementById("welcome-note").textContent = PLAN_TEXT[account.plan || "personal"].note;
    show("done");
  }

  auth.querySelector("[data-reset]").addEventListener("click", () => {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    contact.value = ""; code.value = ""; company.value = "";
    show("contact");
  });

  // Already signed in on this device
  const existing = load();
  if (existing && existing.company) {
    document.getElementById("welcome-name").textContent = existing.company;
    document.getElementById("welcome-note").textContent = PLAN_TEXT[existing.plan || "personal"].note;
    steps.forEach((s) => s.classList.toggle("active", s.dataset.step === "done"));
  }

  // "Create an account" at the bottom jumps back up to the form
  document.querySelectorAll("[data-focus-auth]").forEach((a) => {
    a.addEventListener("click", () => setTimeout(() => contact.focus({ preventScroll: true }), 500));
  });

  // "Get Ervo Personal / for Business" buttons preselect that account type
  document.querySelectorAll("[data-plan]").forEach((a) => {
    a.addEventListener("click", () => {
      setPlan(a.dataset.plan);
      setTimeout(() => contact.focus({ preventScroll: true }), 500);
    });
  });
})();

// Hero: "your AI ___" cycles through Ervo's jobs, personal and business
(function () {
  const rot = document.getElementById("rot");
  if (!rot) return;
  const words = ["assistant 💬", "planner 📅", "business partner 🤝", "shopper 🛍️", "customer support 🎧", "chef 🍳", "travel buddy ✈️"];
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

// Headline avatar: click to swap to the next Ervo outfit
(function () {
  const btn = document.getElementById("avatar");
  if (!btn) return;
  const img = btn.querySelector("img");
  const looks = [
    ["classic", "Classic Ervo"], ["scholar", "Scholar Ervo"], ["business", "Business Ervo"],
    ["gamer", "Gamer Ervo"], ["tech", "Tech Ervo"], ["space", "Space Ervo"],
    ["creative", "Creative Ervo"], ["explorer", "Explorer Ervo"], ["winter", "Winter Ervo"], ["builder", "Builder Ervo"],
  ];
  // Preload so the swap never flashes empty
  looks.forEach(([n]) => { new Image().src = `assets/ervo-${n}.png`; });
  let i = 0;
  let busy = false;

  btn.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    i = (i + 1) % looks.length;
    img.classList.add("out");
    setTimeout(() => {
      img.src = `assets/ervo-${looks[i][0]}.png`;
      img.alt = looks[i][1];
      img.classList.remove("out");
      img.classList.add("in");
      void img.offsetWidth;
      img.classList.remove("in");
      setTimeout(() => { busy = false; }, 280);
    }, 280);
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
