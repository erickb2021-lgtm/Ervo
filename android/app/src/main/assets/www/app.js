// Ervo app (preview). Everything runs on the phone: the account is kept in
// local storage and Ervo's replies are samples until a real AI backend is connected.
(function () {
  const ACCOUNT_KEY = "ervo-account";
  const THEME_KEY = "ervo-theme";
  const $ = (id) => document.getElementById(id);

  // ---------- storage ----------
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const drop = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

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
  }
  const storedTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } };
  applyTheme(storedTheme() || (system.matches ? "dark" : "light"));
  system.addEventListener("change", (e) => { if (!storedTheme()) applyTheme(e.matches ? "dark" : "light"); });
  $("theme-toggle").addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    applyTheme(next);
  });

  // ---------- screens ----------
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  }

  // ---------- Personal vs Business ----------
  const PLAN = {
    personal: {
      label: "Personal", avatar: "img/ervo-classic.png",
      hint: "Personal use only: planning, shopping, your own returns and more.",
      question: "What should Ervo call you?", nameLabel: "Your name", placeholder: "Alex", nameError: "Enter your name.",
      chips: ["Book a table for 4 tonight", "Fit the gym into Friday", "Return my headphones", "Order snacks for the kids"],
    },
    business: {
      label: "Business", avatar: "img/ervo-business.png",
      hint: "Business use only: customer support, refunds by your policy, scheduling and more.",
      question: "What's your company called?", nameLabel: "Company name", placeholder: "Acme Coffee Co.", nameError: "Enter your company's name.",
      chips: ["Refund order #5512", "Summarize today's tickets", "Set up a call with Northwind", "Draft a reply to an upset customer"],
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

  document.querySelector('[data-step="contact"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("contact").value.trim();
    if (!v) { $("contact-error").textContent = "Enter your mobile number or email."; return; }
    if (!isEmail(v) && !isPhone(v)) { $("contact-error").textContent = "That doesn't look like a valid number or email. Try again."; return; }
    contact = v;
    $("sent-to").textContent = v;
    step("code");
  });

  $("code").addEventListener("input", () => { $("code").value = $("code").value.replace(/\D/g, "").slice(0, 6); });
  document.querySelector('[data-step="code"]').addEventListener("submit", (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test($("code").value)) { $("code-error").textContent = "Enter all 6 digits."; return; }
    step("name");
  });
  document.querySelector("[data-back]").addEventListener("click", () => { $("code").value = ""; step("contact"); });

  document.querySelector('[data-step="name"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("name").value.trim();
    if (v.length < 2) { $("name-error").textContent = PLAN[plan].nameError; return; }
    const account = { plan, name: v, contact, createdAt: new Date().toISOString() };
    save(ACCOUNT_KEY, account);
    openChat(account, true);
  });

  // ---------- chat ----------
  const thread = $("thread");
  let account = null;
  let pending = null; // what Ervo is waiting for a yes/no on

  function bubble(text, who) {
    const el = document.createElement("div");
    el.className = `msg ${who}`;
    el.textContent = text;
    thread.append(el);
    thread.scrollTop = thread.scrollHeight;
  }

  function ervoSays(text, chips) {
    const t = document.createElement("div");
    t.className = "typing";
    t.setAttribute("aria-label", "Ervo is typing");
    t.innerHTML = "<i></i><i></i><i></i>";
    thread.append(t);
    thread.scrollTop = thread.scrollHeight;
    setTimeout(() => {
      t.remove();
      bubble(text, "them");
      setChips(chips || PLAN[account.plan].chips);
    }, 700 + Math.min(text.length * 12, 1300));
  }

  function setChips(list) {
    const box = $("chips");
    box.innerHTML = "";
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
    $("mode-badge").classList.toggle("biz", acc.plan === "business");
    $("menu-who").textContent = `${acc.name} · Ervo ${acc.plan === "business" ? "for Business" : "Personal"}`;
    thread.innerHTML = "";
    show("chat");
    const hello = acc.plan === "business"
      ? `Hi ${acc.name}! I'm Ervo for Business. I can answer your customers, handle refunds by your policy and keep your team's schedule on track. What do you need?`
      : `Hi ${acc.name}! I'm Ervo, your AI helper. I can plan your week, book things, shop and handle returns. What can I do for you?`;
    setTimeout(() => ervoSays(hello), fresh ? 300 : 0);
  }

  // Sample replies. Personal and Business stay strictly separate.
  const BUSINESS_WORDS = /\b(customer|customers|ticket|tickets|employee|staff|invoice|client|clients|sales team|my team)\b/i;
  const PERSONAL_WORDS = /\b(buy me|for me to eat|groceries|snacks|gym|workout|dinner|birthday|my headphones|vacation|date night)\b/i;

  function reply(text) {
    const t = text.toLowerCase();
    if (pending) {
      const p = pending;
      pending = null;
      if (/^(yes|yeah|yep|sure|ok|okay|do it|book it|please)/.test(t)) return ervoSays(p.yes);
      if (/^(no|nope|not now|cancel|find another)/.test(t)) return ervoSays(p.no);
    }

    if (account.plan === "personal") {
      if (BUSINESS_WORDS.test(t)) {
        return ervoSays("That sounds like a business task. Ervo Personal is for personal use only, so I can't help with customers or company work. Ervo for Business is built for that.");
      }
      if (/table|restaurant|dinner|reserv/.test(t)) {
        pending = { yes: "Booked ✅ Luna Trattoria, tonight at 7:30 PM for 4. It's on your calendar.", no: "No problem. Want me to look for something else nearby?" };
        return ervoSays("Found one! Luna Trattoria has a table for 4 at 7:30 PM tonight, 10 minutes from you. ★ 4.8\n\nWant me to book it?", ["Yes, book it", "Find another"]);
      }
      if (/gym|workout|calendar|schedule|plan|friday|week/.test(t)) {
        pending = { yes: "Done! Gym is on your calendar for Friday at 6 PM. I'll remind you an hour before.", no: "Okay, I won't add it. Want a different time?" };
        return ervoSays("Friday looks busy: standup at 9, lunch with Sam at 12:30 and a call at 4:30. You're free at 6 PM.\n\nShould I add the gym then?", ["Yes", "Not now"]);
      }
      if (/return|refund|headphone/.test(t)) {
        pending = { yes: "Return started ✅ The drop-off label is in your email. Your $89.99 refund will follow once the box is scanned.", no: "Okay, I'll leave the order as is." };
        return ervoSays("I found your wireless headphones from last Tuesday ($89.99). They're still inside the 30-day return window.\n\nWant me to start the return?", ["Yes, return them", "No"]);
      }
      if (/buy|shop|order|snack|grocer/.test(t)) {
        pending = { yes: "Ordered ✅ $12.23 total. It arrives tomorrow morning.", no: "Got it, I won't buy anything. I'll keep the cart saved." };
        return ervoSays("Here's a cart for you:\n🍎 Apple slices $3.75\n🥨 Pretzel bites $2.99\n🧃 Juice boxes $5.49\nTotal: $12.23\n\nI always ask before buying. Want me to place the order?", ["Yes, order it", "No"]);
      }
    } else {
      if (PERSONAL_WORDS.test(t)) {
        return ervoSays("That sounds personal. Ervo for Business only handles business tasks, like customer support, refunds and scheduling. Ervo Personal can help with that one.");
      }
      if (/refund|charged|order #?\d+|return/.test(t)) {
        pending = { yes: "Refund sent ✅ $64.00 back to the customer's card, and I emailed them a return label. Ticket closed.", no: "Okay, I've left it for your team to review." };
        return ervoSays("Order #5512: a blender that arrived cracked, $64.00, delivered 4 days ago.\nYour policy: damaged on arrival → full refund ✓\n\nShould I issue the refund and reply to the customer?", ["Yes, refund it", "Send to my team"]);
      }
      if (/ticket|summar|today|inbox|queue/.test(t)) {
        return ervoSays("Today so far:\n• 42 customer tickets\n• 38 resolved by me, average 41 seconds\n• 4 sent to your team (2 bulk orders, 1 billing question, 1 upset customer)\n\nWant me to draft replies for the 4 that are waiting?", ["Yes, draft them", "Not now"]);
      }
      if (/call|meeting|schedule|northwind|proposal/.test(t)) {
        pending = { yes: "Done ✅ Thursday at 2 PM with Northwind, and the Q3 proposal is in their inbox.", no: "Okay. Want me to suggest another time?" };
        return ervoSays("Everyone on your team is free Thursday at 2 PM, and so is Northwind.\n\nShould I book the call and send them the Q3 proposal?", ["Yes, book it", "Other times"]);
      }
      if (/upset|angry|complain|draft|reply/.test(t)) {
        return ervoSays("Here's a draft:\n\n\"Hi Jordan, I'm really sorry your order arrived late. I've refunded your shipping and added a 15% credit to your account. If there's anything else I can do, just reply here.\"\n\nWant me to send it, or edit it first?", ["Send it", "Edit first"]);
      }
    }
    return ervoSays("Got it! In the full version I'll take care of that for you. For now, try one of the suggestions below to see how I work.");
  }

  function send(text) {
    const v = text.trim();
    if (!v || !account) return;
    bubble(v, "me");
    $("chips").innerHTML = "";
    reply(v);
  }

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("message");
    send(input.value);
    input.value = "";
  });

  // ---------- menu ----------
  const menu = $("menu");
  function toggleMenu(open) {
    menu.hidden = !open;
    $("menu-btn").setAttribute("aria-expanded", String(open));
  }
  $("menu-btn").addEventListener("click", () => toggleMenu(menu.hidden));
  $("clear-chat").addEventListener("click", () => { toggleMenu(false); pending = null; openChat(account, false); });
  $("sign-out").addEventListener("click", () => {
    toggleMenu(false);
    drop(ACCOUNT_KEY);
    account = null;
    ["contact", "code", "name"].forEach((id) => { $(id).value = ""; });
    setPlan("personal");
    step("contact");
    show("welcome");
  });

  // Android back button: close the menu or go back a sign-up step first
  window.ervoBack = function () {
    if (!menu.hidden) { toggleMenu(false); return true; }
    const active = document.querySelector(".step.active");
    if ($("welcome").classList.contains("active") && active && active.dataset.step !== "contact") {
      step(active.dataset.step === "name" ? "code" : "contact");
      return true;
    }
    return false;
  };

  // ---------- start ----------
  setPlan("personal");
  setTimeout(() => {
    const saved = load(ACCOUNT_KEY);
    if (saved && saved.plan && saved.name) openChat(saved, true);
    else show("welcome");
  }, 1300);
})();
