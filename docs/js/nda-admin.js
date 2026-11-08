// Erick's tester invite page: make invite links, turn invites off, see and print signed copies.
(function () {
  const N = window.ErvoNda;
  const $ = (id) => document.getElementById(id);
  const esc = N.esc;
  const q = new URLSearchParams(location.search);
  const apiParam = q.get("api") || "";
  const LOCAL = /^http:\/\/localhost(:\d+)?$/.test(apiParam);
  const API = LOCAL ? apiParam : "https://ervo-ai.ervo-ai.workers.dev";
  let key = "";
  try { key = sessionStorage.getItem("ervo-nda-key") || ""; } catch (e) { /* ignore */ }
  let signedBy = {};

  async function call(path, body) {
    const res = await fetch(API + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* ignore */ }
    return { status: res.status, data };
  }

  function when(iso) {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  }

  async function load() {
    const r = await call("/nda/admin/list");
    if (r.status === 401) return "That key isn't right.";
    if (r.status === 503) return "Signing isn't set up on the server yet (the NDA storage or NDA_ADMIN_KEY is missing).";
    if (!r.data.ok) return "Couldn't load testers. Try again.";
    signedBy = {};
    r.data.signed.forEach((s) => { signedBy[s.email] = s; });
    const emails = new Set([...r.data.invites.map((i) => i.email), ...Object.keys(signedBy)]);
    const invites = {};
    r.data.invites.forEach((i) => { invites[i.email] = i; });
    const rows = [...emails].sort().map((email) => {
      const s = signedBy[email];
      const inv = invites[email] || {};
      let status = `Invited ${inv.createdAt ? esc(when(inv.createdAt)) : ""}`;
      if (s) status = `<span class="tag signed">Signed</span> ${esc(when(s.signedAt))}<br>${esc(s.name)}`;
      if (inv.revoked) status += ` <span class="tag revoked">Turned off</span>`;
      const actions = [
        s ? `<button class="small-btn" data-view="${esc(email)}">View signed copy</button>` : `<button class="small-btn" data-link="${esc(email)}">Get link</button>`,
        inv.revoked ? `<button class="small-btn" data-undo="${esc(email)}">Turn back on</button>` : `<button class="small-btn" data-revoke="${esc(email)}">Turn off</button>`,
      ].join("");
      return `<tr><td>${esc(email)}</td><td>${status}</td><td>${actions}</td></tr>`;
    });
    $("people").innerHTML = rows.join("") || `<tr><td colspan="3">No testers yet. Invite someone above.</td></tr>`;
    const signedCount = Object.keys(signedBy).length;
    $("count").textContent = `${emails.size} invited · ${signedCount} signed`;
    return "";
  }

  async function open() {
    const msg = await load();
    if (msg) { $("key-error").textContent = msg; return; }
    try { sessionStorage.setItem("ervo-nda-key", key); } catch (e) { /* ignore */ }
    $("key-error").textContent = "";
    $("key-form").hidden = true;
    $("panel").hidden = false;
  }

  $("key-form").addEventListener("submit", (e) => {
    e.preventDefault();
    key = $("key").value.trim();
    if (key) open().catch(() => { $("key-error").textContent = "Couldn't reach Ervo's server."; });
  });

  function showInvite(d) {
    const subject = "Your invite to test Ervo";
    const body = `Hi! You're invited to test Ervo before it's public.\n\nFirst, please read and sign the tester agreement here (it only works for your email):\n${d.link}\n\nAfter you sign, I'll send you the app.\n\nThanks!\nErick`;
    $("inv-out").hidden = false;
    $("inv-out").innerHTML = `
      <div class="invite-out"><b>Invite link for ${esc(d.email)}</b><br><span id="inv-link">${esc(d.link)}</span></div>
      <div class="actions">
        <button class="btn btn-primary" type="button" id="inv-copy">Copy link</button>
        <a class="btn btn-ghost" href="mailto:${encodeURIComponent(d.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">Email it</a>
        <a class="btn btn-ghost" href="sms:?&body=${encodeURIComponent("You're invited to test Ervo! Sign the tester agreement first: " + d.link)}">Text it</a>
      </div>`;
    $("inv-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(d.link); $("inv-copy").textContent = "Copied"; } catch (e) { /* ignore */ }
    });
  }

  async function invite(email) {
    const site = LOCAL ? location.origin + location.pathname.replace(/nda-admin\.html$/, "nda.html") : undefined;
    const r = await call("/nda/admin/invite", { email, site });
    if (!r.data.ok) { $("inv-error").textContent = r.data.error === "bad_email" ? "That email doesn't look right." : "Couldn't make the invite. Try again."; return; }
    $("inv-error").textContent = "";
    if (LOCAL) r.data.link += "&api=" + encodeURIComponent(API);
    showInvite(r.data);
    await load();
  }

  $("invite-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("inv-email").value.trim();
    if (!email) { $("inv-error").textContent = "Type their email first."; return; }
    invite(email).catch(() => { $("inv-error").textContent = "Couldn't reach Ervo's server."; });
  });

  $("people").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.link) { $("inv-email").value = b.dataset.link; await invite(b.dataset.link); window.scrollTo(0, 0); }
    if (b.dataset.revoke) {
      if (!confirm(`Turn off the invite for ${b.dataset.revoke}? Their link will stop working. A signed agreement stays on file.`)) return;
      await call("/nda/admin/revoke", { email: b.dataset.revoke });
      await load();
    }
    if (b.dataset.undo) { await call("/nda/admin/revoke", { email: b.dataset.undo, undo: true }); await load(); }
    if (b.dataset.view) {
      const s = signedBy[b.dataset.view];
      viewing = s;
      $("copy-msg").textContent = "";
      $("copy-version").textContent = "Version " + s.version + (s.version !== N.VERSION ? " (the wording on this page is version " + N.VERSION + ")" : "");
      $("copy-text").innerHTML = N.html();
      $("copy-block").innerHTML = N.signedHtml(s, true);
      $("copy").showModal();
    }
  });
  let viewing = null;
  $("copy-pdf").addEventListener("click", () => {
    if (!viewing || !window.jspdf) return;
    N.pdf(viewing, true).save(N.pdfName(viewing));
  });
  $("copy-email").addEventListener("click", async () => {
    if (!viewing || !window.jspdf) return;
    const msg = $("copy-msg");
    msg.textContent = "Sending…";
    const data = N.pdf(viewing, true).output("datauristring").split(",")[1];
    const r = await call("/nda/admin/send-copy", { email: viewing.email, pdf: data, filename: N.pdfName(viewing) });
    msg.textContent = r.data.ok ? "Sent to your email." : r.data.error === "email_not_set_up" ? "Email isn't set up on the server yet (RESEND_API_KEY)." : "Couldn't send it. Try again.";
  });
  $("copy-close").addEventListener("click", () => $("copy").close());
  $("copy-print").addEventListener("click", () => window.print());

  if (key) open().catch(() => { /* show the key form */ });
})();
