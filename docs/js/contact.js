// Contact panel: a small form in the bottom-right corner of every page. Visitors write to
// Ervo without leaving the site; the message is emailed straight to the founder's inbox
// by FormSubmit (formsubmit.co), a form-to-email service. Nothing is stored on the site.
(function () {
  const TO = "erickb2021@gmail.com";
  const ENDPOINT = "https://formsubmit.co/ajax/" + TO;
  const TOPICS = [
    { id: "issue", icon: "💬", label: "Concern or issue", hint: "Something broke, felt off or could be better" },
    { id: "business", icon: "🤝", label: "Business", hint: "Partnerships, Ervo for Business, press" },
    { id: "privacy", icon: "🔒", label: "Privacy request", hint: "See, download, correct or delete your data" },
    { id: "other", icon: "✨", label: "Something else", hint: "Ideas, feedback, or just saying hi" },
  ];
  const REQUESTS = ["See my data", "Download my data", "Correct my data", "Delete my account and data"];
  const PLACEHOLDER = {
    issue: "What happened, and was it in Ervo Personal or Ervo for Business?",
    business: "Tell us about your company and what you have in mind.",
    privacy: "Which email or phone number do you use in Ervo? Anything else we should know?",
    other: "Write your message…",
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const root = document.createElement("div");
  root.className = "ct";
  root.innerHTML = `
    <button class="ct-fab" id="ct-fab" type="button" aria-expanded="false" aria-controls="ct-panel">
      <img src="assets/sm/ervo-classic.webp" alt=""><span>Contact</span>
    </button>
    <section class="ct-panel" id="ct-panel" role="dialog" aria-modal="false" aria-labelledby="ct-title" hidden>
      <header class="ct-head">
        <img src="assets/sm/ervo-classic.webp" alt="">
        <div><b id="ct-title">Write to Ervo</b><small>Straight to the founder's inbox · replies within 2 business days</small></div>
        <button class="ct-close" type="button" aria-label="Close">&times;</button>
      </header>
      <form class="ct-form" novalidate>
        <p class="ct-label">What's it about?</p>
        <div class="ct-topics" role="radiogroup" aria-label="Topic">
          ${TOPICS.map((t) => `<button class="ct-topic" type="button" role="radio" aria-checked="false" data-topic="${t.id}"><span class="ct-ico" aria-hidden="true">${t.icon}</span><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></button>`).join("")}
        </div>
        <div class="ct-req" hidden>
          <p class="ct-label">What would you like us to do?</p>
          <div class="ct-chips" role="radiogroup" aria-label="Request">
            ${REQUESTS.map((r) => `<button class="ct-chip" type="button" role="radio" aria-checked="false" data-req="${esc(r)}">${esc(r)}</button>`).join("")}
          </div>
          <p class="ct-note">We'll confirm it's really you before we change or share anything, then finish within 30 days, usually much sooner.</p>
        </div>
        <div class="ct-row">
          <label><span class="sr">Your name</span><input class="ct-field" name="name" type="text" autocomplete="name" placeholder="Your name" maxlength="80"></label>
          <label><span class="sr">Your email</span><input class="ct-field" name="email" type="email" inputmode="email" autocomplete="email" placeholder="Your email" maxlength="120"></label>
        </div>
        <label><span class="sr">Message</span><textarea class="ct-field ct-msg" name="message" rows="4" placeholder="Write your message…" maxlength="4000"></textarea></label>
        <input class="ct-honey" type="text" name="_honey" tabindex="-1" autocomplete="off" aria-hidden="true">
        <p class="ct-err" role="alert" hidden></p>
        <button class="ct-send" type="submit"><span class="ct-send-text">Send message</span><span class="ct-spin" aria-hidden="true"></span></button>
        <p class="ct-fine">Your name, email and message are emailed to Ervo and used only to reply. <a href="privacy.html">Privacy Policy</a></p>
      </form>
      <div class="ct-done" hidden>
        <div class="ct-check" aria-hidden="true">✓</div>
        <b>Sent!</b>
        <p>Thanks for writing. Your message is in the founder's inbox, and you'll hear back within 2 business days.</p>
        <button class="ct-again btn btn-ghost" type="button">Send another</button>
      </div>
    </section>`;
  document.body.append(root);

  const fab = root.querySelector("#ct-fab");
  const panel = root.querySelector("#ct-panel");
  const form = root.querySelector(".ct-form");
  const done = root.querySelector(".ct-done");
  const req = root.querySelector(".ct-req");
  const err = root.querySelector(".ct-err");
  const send = root.querySelector(".ct-send");
  const msg = form.elements.message;
  let topic = "", request = "";

  function setTopic(id) {
    topic = id;
    root.querySelectorAll(".ct-topic").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.topic === id)));
    req.hidden = id !== "privacy";
    msg.placeholder = PLACEHOLDER[id] || PLACEHOLDER.other;
    hideErr();
  }
  function setRequest(r) {
    request = r;
    root.querySelectorAll(".ct-chip").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.req === r)));
    hideErr();
  }
  function showErr(text) { err.textContent = ""; err.append(text); err.hidden = false; }
  function hideErr() { err.hidden = true; }

  function open(withTopic) {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => root.classList.add("open"));
    if (withTopic) setTopic(withTopic);
    const first = withTopic ? form.elements.name : root.querySelector(".ct-topic");
    setTimeout(() => first && first.focus(), 60);
  }
  function close() {
    root.classList.remove("open");
    fab.setAttribute("aria-expanded", "false");
    setTimeout(() => { panel.hidden = true; }, 180);
    fab.focus();
  }

  fab.addEventListener("click", () => (panel.hidden ? open() : close()));
  root.querySelector(".ct-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) close(); });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !root.contains(e.target) && !e.target.closest("[data-contact]")) close();
  });
  // Buttons anywhere on the page can open the panel with a topic picked: <button data-contact="business">
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-contact]");
    if (!b) return;
    e.preventDefault();
    open(b.dataset.contact);
  });
  root.querySelectorAll(".ct-topic").forEach((b) => b.addEventListener("click", () => setTopic(b.dataset.topic)));
  root.querySelectorAll(".ct-chip").forEach((b) => b.addEventListener("click", () => setRequest(b.dataset.req)));
  root.querySelector(".ct-again").addEventListener("click", () => {
    form.reset(); setTopic(""); setRequest("");
    done.hidden = true; form.hidden = false;
    root.querySelector(".ct-topic").focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const text = msg.value.trim();
    if (!topic) return showErr("Pick what your message is about.");
    if (topic === "privacy" && !request) return showErr("Pick what you'd like us to do with your data.");
    if (!name) return showErr("Tell us your name so we know who to reply to.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr("Enter a valid email so we can reply.");
    if (text.length < 5) return showErr("Add a few words about what you need.");
    if (form.elements._honey.value) return; // a bot filled the hidden field
    hideErr();
    send.disabled = true; root.classList.add("sending");
    const label = TOPICS.find((t) => t.id === topic).label;
    const payload = {
      _subject: `Ervo website · ${label}${request ? ": " + request : ""} · from ${name}`,
      _replyto: email,
      _template: "table",
      Topic: label,
      Request: request || "—",
      Name: name,
      Email: email,
      Message: text,
      Page: location.pathname.split("/").pop() || "index.html",
    };
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || String(data.success) === "false") throw new Error(data.message || "send failed");
      form.hidden = true; done.hidden = false;
      root.querySelector(".ct-again").focus();
    } catch (ex) {
      const a = document.createElement("a");
      a.href = `mailto:${TO}?subject=${encodeURIComponent(payload._subject)}&body=${encodeURIComponent(text + "\n\n— " + name + " (" + email + ")")}`;
      a.textContent = "open your email app instead";
      showErr("It didn't go through. Check your connection and try again, or ");
      err.append(a, ".");
    } finally {
      send.disabled = false; root.classList.remove("sending");
    }
  });
})();
