// Tester NDA signing page. Works only with an invite link made on nda-admin.html:
// nda.html?e=<email>&c=<code>. Ervo's server checks the code and saves the signature.
(function () {
  const N = window.ErvoNda;
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  // Testing on this computer can point at a local server; anything else uses Ervo's
  const apiParam = q.get("api") || "";
  const API = /^http:\/\/localhost(:\d+)?$/.test(apiParam) ? apiParam : "https://ervo-ai.ervo-ai.workers.dev";
  const email = (q.get("e") || "").trim().toLowerCase();
  const code = (q.get("c") || "").trim().toUpperCase();

  $("version-line").textContent = "Version " + N.VERSION + " · For invited testers only";

  async function call(path, body) {
    const res = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch (e) { /* ignore */ }
    return { status: res.status, data };
  }

  function showState(title, text) {
    $("state").hidden = false;
    $("state").innerHTML = `<h2>${N.esc(title)}</h2><p>${text}</p>`;
  }
  const NOT_INVITED = 'This page is only for people Ervo invited to test. If you were invited, open the exact link from your invite, or <a href="contact.html">contact Ervo</a> for a new one.';

  function showSigned(record) {
    $("state").hidden = true;
    $("agreement").hidden = true;
    $("signed").hidden = false;
    $("signed-text").innerHTML = N.html();
    $("signed-block").innerHTML = N.signedHtml(record, false);
    document.title = "Signed: Tester Agreement · Ervo";
    window.scrollTo(0, 0);
  }

  async function start() {
    if (!email || !code) { showState("Invite needed", NOT_INVITED); return; }
    let r;
    try {
      r = await call("/nda/check", { email, code });
    } catch (e) {
      showState("Can't reach Ervo", "Check your internet connection and reload this page.");
      return;
    }
    if (r.status === 503) { showState("Not open yet", "Signing isn't open yet. Try again later."); return; }
    if (r.status === 429) { showState("Too many tries", "Wait a minute, then reload this page."); return; }
    if (r.data.error === "revoked") { showState("Invite no longer active", 'This invite was turned off. <a href="contact.html">Contact Ervo</a> if you think that\'s a mistake.'); return; }
    if (!r.data.ok) { showState("Invite needed", NOT_INVITED); return; }
    if (r.data.signed) { showSigned(r.data.signed); return; }

    $("state").hidden = true;
    $("agreement").hidden = false;
    $("nda-text").innerHTML = N.html();
    $("f-email").value = email;
  }

  // ---------- signature pad ----------
  const pad = $("pad");
  const ctx = pad.getContext("2d");
  let drawn = false;
  let drawing = false;
  let last = null;

  function sizePad() {
    const ratio = window.devicePixelRatio || 1;
    const rect = pad.getBoundingClientRect();
    const keep = drawn ? pad.toDataURL("image/png") : null;
    pad.width = Math.max(1, Math.round(rect.width * ratio));
    pad.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1030";
    if (keep) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = keep;
    }
  }
  function point(e) {
    const rect = pad.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    drawing = true;
    last = point(e);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = "#1a1030";
    ctx.fill();
    drawn = true;
  });
  pad.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });
  const stop = () => { drawing = false; };
  pad.addEventListener("pointerup", stop);
  pad.addEventListener("pointercancel", stop);
  $("pad-clear").addEventListener("click", () => {
    ctx.clearRect(0, 0, pad.width, pad.height);
    drawn = false;
  });
  window.addEventListener("resize", () => { if (!$("agreement").hidden) sizePad(); });

  // Signature as a white-background PNG, trimmed to keep it small
  function drawingPng() {
    const out = document.createElement("canvas");
    out.width = pad.width;
    out.height = pad.height;
    const o = out.getContext("2d");
    o.fillStyle = "#ffffff";
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(pad, 0, 0);
    if (out.width > 900) {
      const small = document.createElement("canvas");
      small.width = 900;
      small.height = Math.round(out.height * (900 / out.width));
      small.getContext("2d").drawImage(out, 0, 0, small.width, small.height);
      return small.toDataURL("image/png");
    }
    return out.toDataURL("image/png");
  }

  // ---------- form ----------
  $("f-typed").addEventListener("input", (e) => { $("typed-preview").textContent = e.target.value; });
  $("f-minor").addEventListener("change", (e) => { $("guardian").hidden = !e.target.checked; });
  $("print-btn").addEventListener("click", () => window.print());

  $("sign-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("form-error");
    const name = $("f-name").value.trim();
    const typed = $("f-typed").value.trim();
    const minor = $("f-minor").checked;
    const problems = [];
    if (name.length < 2) problems.push("your full name");
    if (typed.length < 2) problems.push("your typed signature");
    if (!drawn) problems.push("your drawn signature");
    if (minor && ($("f-gname").value.trim().length < 2 || $("f-gsig").value.trim().length < 2)) problems.push("the parent or guardian's name and signature");
    if (!$("f-esign").checked) problems.push("agreeing to sign electronically");
    if (!$("f-agree").checked) problems.push("agreeing to the agreement");
    if (problems.length) {
      err.textContent = "Still needed: " + problems.join(", ") + ".";
      return;
    }
    err.textContent = "";
    const btn = $("sign-btn");
    btn.disabled = true;
    btn.textContent = "Signing…";
    try {
      const r = await call("/nda/sign", {
        email, code, name, typedSignature: typed, drawing: drawingPng(), minor,
        guardianName: $("f-gname").value.trim(), guardianSignature: $("f-gsig").value.trim(),
        consentEsign: true, agreed: true, version: N.VERSION, textHash: await N.hash(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (r.data.ok && r.data.signed) { showSigned(r.data.signed); return; }
      err.textContent = r.status === 403 ? "This invite isn't active anymore. Contact Ervo for help." : r.status === 429 ? "Too many tries. Wait a minute and try again." : "Something went wrong. Check every field and try again.";
    } catch (ex) {
      err.textContent = "Couldn't reach Ervo. Check your internet connection and try again.";
    }
    btn.disabled = false;
    btn.textContent = "Sign agreement";
  });

  start().then(() => { if (!$("agreement").hidden) sizePad(); });
})();
