// The Ervo Tester Confidentiality Agreement, shared by nda.html and nda-admin.html.
// If you change any wording, also change VERSION, so every signature records
// exactly which text the tester saw (its SHA-256 is saved with the signature).
(function () {
  const VERSION = "2026-11-08";

  const P = "https://erickb2021-lgtm.github.io/Ervo/";
  // Each section: h = heading, then blocks in order: p (paragraph), ul / ol (lists)
  const SECTIONS = [
    { h: "1. Who this agreement is between", blocks: [
      { p: 'This agreement is between <b>Erick S. Bardales, doing business as Ervo</b> ("Ervo"), and the person who signs below ("you" or the "Tester"). If Ervo forms a company, such as an LLC, Ervo may transfer this agreement to that company, and it will keep the same rights.' },
    ] },
    { h: "2. What is confidential", blocks: [
      { p: '"Confidential Information" means anything about Ervo that is not public and that you see, hear or receive because you are a tester, including:' },
      { ul: [
        "The Ervo app, website and test builds (including APK files and test links), and how they look and work",
        "Ervo's AI behavior, answers, prompts and the tools it uses",
        "Features, designs, screens, the Ervo owl characters and logos that are not yet released",
        "Hardware designs, including the Ervo speaker models",
        "Plans, release dates, prices, business partners, user numbers and costs",
        "Bugs, security problems and anything else you learn while testing",
      ] },
    ] },
    { h: "3. What is not confidential", blocks: [
      { p: "This agreement does not cover information that:" },
      { ul: [
        "Is already public, or becomes public, without you breaking this agreement",
        "You knew before Ervo shared it, and can show that you did",
        "You get from someone else who was allowed to share it",
        "You must share because a law, court or government agency requires it. If so, tell Ervo first when the law allows, and share only what is required.",
      ] },
    ] },
    { h: "4. What you agree to", blocks: [
      { p: "While testing and afterward, you will:" },
      { ol: [
        "Use Confidential Information only to test Ervo and give feedback.",
        "Not share it with anyone, including friends, family, coworkers or online.",
        "Not post screenshots, screen recordings, videos, photos or descriptions of Ervo on social media, forums, app stores or anywhere else, unless Ervo says yes in writing.",
        "Not give, forward or upload any test build, install file, test link, invite or login to anyone.",
        "Not copy, take apart, reverse engineer or try to get Ervo's source code, AI prompts or server details.",
        "Not try to break into, overload or get around Ervo's security or limits. Report any security problem you find only to Ervo.",
        "Keep your phone and accounts locked with a passcode or similar protection.",
        "Tell Ervo right away if you think Confidential Information was shared by mistake.",
      ] },
    ] },
    { h: "5. Invitation-only access", blocks: [
      { ul: [
        "Only people Ervo personally invites in writing (by email or text) may test Ervo. Signing this agreement alone does not make you a tester.",
        "Your invitation is for you alone. You may not transfer it, share it or let anyone else use your access.",
        "Ervo may add or remove testers, and end your access, at any time and for any reason, without notice.",
        "When your access ends, or if Ervo asks, delete every test build, file and screenshot of Ervo you have. Your duties in this agreement still continue.",
      ] },
    ] },
    { h: "6. Your feedback", blocks: [
      { p: 'Ervo welcomes your ideas, bug reports and suggestions ("Feedback"). You give Ervo the right to use, change and build on your Feedback in any way, forever, without paying you or naming you. Don\'t send anything you don\'t have the right to share, such as someone else\'s private information or work.' },
    ] },
    { h: "7. Test software comes as-is", blocks: [
      { p: 'Ervo is unfinished. It may have bugs, give wrong answers, lose data or stop working, and its AI can make mistakes. Ervo provides test builds "as is", with no promises or warranties of any kind, to the extent the law allows. Don\'t rely on Ervo for anything important, such as health, money, safety or emergencies. Ervo never calls emergency services and never buys anything for you. To the extent the law allows, Ervo is not responsible for any loss or damage from testing, and its total responsibility to you is limited to $100.' },
    ] },
    { h: "8. Your privacy", blocks: [
      { p: `Ervo handles your personal information as described in its <a href="${P}privacy.html">Privacy Policy</a>. Ervo may look at how you use the test app, including your messages to Ervo, only to find and fix problems and improve Ervo. Test data may be reset or deleted at any time. You can ask Ervo to delete your data.` },
    ] },
    { h: "9. How long this lasts", blocks: [
      { p: "This agreement starts when you sign it. Your duties to keep information confidential last for <b>3 years after your testing ends</b>. For trade secrets, they last as long as the information stays a trade secret under the law." },
    ] },
    { h: "10. If this agreement is broken", blocks: [
      { p: "Sharing Confidential Information could cause Ervo harm that money can't fully fix. If you break, or are about to break, this agreement, Ervo may ask a court to order you to stop, in addition to any other rights Ervo has. Ervo may also end your access right away." },
    ] },
    { h: "11. Age", blocks: [
      { p: "You must be at least 18 to sign this agreement. A tester under 18 needs a parent or legal guardian to sign it too, and that parent or guardian agrees to make sure the tester follows it." },
    ] },
    { h: "12. Electronic signatures", blocks: [
      { p: "You agree to sign this agreement and receive related notices electronically. Your electronic signature (for example, typing your name, drawing it, or clicking to sign) has the same effect as signing on paper, under the U.S. Electronic Signatures in Global and National Commerce Act (ESIGN) and the Texas Uniform Electronic Transactions Act. You can ask for a paper copy at any time, free. Ervo will send you a signed copy for your records. You can take back your consent to electronic signing for future documents by emailing Ervo; that doesn't undo anything you've already signed." },
    ] },
    { h: "13. General terms", blocks: [
      { ul: [
        "<b>Law and courts.</b> Texas law governs this agreement. Any dispute goes to the state or federal courts in Travis County, Texas.",
        "<b>Whole agreement.</b> This is the full agreement about testing confidentiality. Changes count only if both sides agree in writing, which can be electronic.",
        "<b>If part is invalid.</b> If a court finds any part can't be enforced, the rest still applies, and that part is enforced as far as the law allows.",
        "<b>No transfer.</b> You may not transfer this agreement. Ervo may transfer it as described in section 1.",
        "<b>Not a job or partnership.</b> Testing is voluntary and unpaid unless Ervo agrees otherwise in writing. This agreement doesn't make you an employee, contractor or partner.",
        "<b>Your legal rights.</b> Nothing here stops you from reporting a possible violation of law to a government agency. Under the federal Defend Trade Secrets Act, you can't be held liable for sharing a trade secret in confidence with a government official or a lawyer only to report or investigate a suspected violation of law, or in a sealed court filing.",
        `<b>Contact.</b> Questions or notices go to Ervo through the <a href="${P}contact.html">contact page</a>.`,
      ] },
    ] },
  ];

  const TITLE = "Ervo Tester Confidentiality Agreement";

  function html() {
    return SECTIONS.map((s) => {
      const body = s.blocks.map((b) => {
        if (b.p) return `<p>${b.p}</p>`;
        const tag = b.ul ? "ul" : "ol";
        return `<${tag}>${(b.ul || b.ol).map((i) => `<li>${i}</li>`).join("")}</${tag}>`;
      }).join("");
      return `<h2>${s.h}</h2>${body}`;
    }).join("");
  }

  // The exact words, without markup, for the fingerprint saved with each signature
  function plain() {
    const strip = (t) => t.replace(/<[^>]+>/g, "");
    const lines = [TITLE, "Version " + VERSION];
    for (const s of SECTIONS) {
      lines.push(s.h);
      for (const b of s.blocks) {
        if (b.p) lines.push(strip(b.p));
        else (b.ul || b.ol).forEach((i, n) => lines.push((b.ol ? n + 1 + ". " : "- ") + strip(i)));
      }
    }
    return lines.join("\n");
  }

  async function hash() {
    const data = new TextEncoder().encode(plain());
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function when(iso, tz) {
    try {
      return new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "long", timeZone: tz || undefined });
    } catch (e) {
      return new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "long" });
    }
  }

  // The signature page and record shown after signing (and on the admin page)
  function signedHtml(r, withAudit) {
    const guardian = r.minor ? `
      <div class="sig-party">
        <h3>Parent or guardian</h3>
        <p class="sig-typed">${esc(r.guardianSignature)}</p>
        <p>${esc(r.guardianName)}</p>
      </div>` : "";
    const audit = withAudit ? `<li>IP address: ${esc(r.ip)}</li><li>Browser: ${esc(r.userAgent)}</li>` : "";
    return `
      <h2>Signatures</h2>
      <div class="sig-grid">
        <div class="sig-party">
          <h3>Tester</h3>
          <img class="sig-drawn" src="${esc(r.drawing)}" alt="Drawn signature of ${esc(r.name)}">
          <p class="sig-typed">${esc(r.typedSignature)}</p>
          <p><b>${esc(r.name)}</b><br>${esc(r.email)}<br>Signed ${esc(when(r.signedAt, r.timeZone))}</p>
        </div>
        <div class="sig-party">
          <h3>Ervo</h3>
          <p class="sig-typed">${esc(r.ervo.name)}</p>
          <p><b>${esc(r.ervo.name)}</b><br>${esc(r.ervo.title)}<br>Signed ${esc(when(r.ervo.signedAt, r.timeZone))}</p>
        </div>
        ${guardian}
      </div>
      <div class="sig-record">
        <h3>Signature record</h3>
        <ul>
          <li>Signature ID: ${esc(r.id)}</li>
          <li>Agreement version: ${esc(r.version)}</li>
          <li>Agreement fingerprint (SHA-256): <span class="mono">${esc(r.textHash)}</span></li>
          <li>Agreed to sign electronically: yes</li>
          <li>Recorded by Ervo's server at ${esc(new Date(r.signedAt).toISOString())}</li>
          ${audit}
        </ul>
      </div>`;
  }

  // ---------- PDF (needs jsPDF loaded on the page) ----------
  // record = a signed record, or null for a blank copy with empty signature lines.
  // withAudit adds the IP address and browser (Erick's copy only).
  function pdf(record, withAudit) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 60;
    const TW = W - M * 2;
    let y = M;
    const strip = (t) => String(t).replace(/<[^>]+>/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...");

    function room(h) {
      if (y + h > H - M) { doc.addPage(); y = M; }
    }
    function text(t, opts) {
      const o = Object.assign({ size: 10.5, style: "normal", indent: 0, hang: "", gap: 6, font: "helvetica", lead: 1.4 }, opts);
      doc.setFont(o.font, o.style);
      doc.setFontSize(o.size);
      const lines = doc.splitTextToSize(strip(t), TW - o.indent);
      const lh = o.size * o.lead;
      lines.forEach((line, i) => {
        room(lh);
        if (i === 0 && o.hang) doc.text(o.hang, M + o.indent - 14, y + o.size);
        doc.text(line, M + o.indent, y + o.size);
        y += lh;
      });
      y += o.gap;
    }

    // Footer on every page is added at the end
    text(TITLE, { size: 18, style: "bold", gap: 2 });
    text("Version " + VERSION + " · For invited testers only", { size: 9.5, gap: 14 });
    for (const s of SECTIONS) {
      room(40);
      y += 4;
      text(s.h, { size: 12.5, style: "bold", gap: 4 });
      for (const b of s.blocks) {
        if (b.p) text(b.p);
        else (b.ul || b.ol).forEach((item, n) => text(item, { indent: 18, hang: b.ol ? n + 1 + "." : "•", gap: 3 }));
        y += 3;
      }
    }

    // Signatures
    doc.addPage();
    y = M;
    text("Signatures", { size: 15, style: "bold", gap: 8 });
    text("By signing, the Tester confirms that Ervo invited them, that they read this agreement, and that they agree to it.", { gap: 14 });
    const colW = (TW - 20) / 2;
    const top = y;

    function party(x, label, img, typed, lines, signedText) {
      let yy = top;
      doc.setFont("helvetica", "bold"); doc.setFontSize(11.5);
      doc.text(label, x, yy + 11); yy += 22;
      if (img) {
        try { doc.addImage(img, "PNG", x, yy, colW, colW * 0.27); } catch (e) { /* skip a bad image */ }
        yy += colW * 0.27 + 4;
      } else { yy += 40; }
      if (typed) { doc.setFont("times", "italic"); doc.setFontSize(18); doc.text(strip(typed), x, yy + 16); }
      yy += 24;
      doc.setDrawColor(120); doc.line(x, yy, x + colW, yy); yy += 14;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      lines.forEach((l) => { doc.text(doc.splitTextToSize(strip(l), colW), x, yy); yy += 14; });
      if (signedText) { doc.text(doc.splitTextToSize(strip(signedText), colW), x, yy); yy += 28; }
      return yy;
    }
    const r = record;
    const day = (iso) => { try { return new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "long", timeZone: (r && r.timeZone) || undefined }); } catch (e) { return new Date(iso).toLocaleString("en-US"); } };
    const left = party(M, "Tester", r ? r.drawing : null, r ? r.typedSignature : "",
      r ? [r.name, r.email] : ["Name: ______________________________", "Email: ______________________________"],
      r ? "Signed " + day(r.signedAt) : "Date: ______________________");
    const right = party(M + colW + 20, "Ervo", null, r ? r.ervo.name : "",
      ["Erick S. Bardales", "Founder, Ervo"], r ? "Signed " + day(r.ervo.signedAt) : "Date: ______________________");
    y = Math.max(left, right) + 10;

    if (!r || r.minor) {
      room(120);
      text("Parent or guardian, if the Tester is under 18", { size: 11.5, style: "bold", gap: 10 });
      if (r) {
        text(r.guardianSignature, { font: "times", style: "italic", size: 18, gap: 2 });
        text(r.guardianName, { gap: 14 });
      } else {
        text("Signature: ______________________________   Name: ______________________________", { gap: 14 });
      }
    }

    if (r) {
      room(140);
      text("Signature record", { size: 11.5, style: "bold", gap: 6 });
      const rec = [
        "Signature ID: " + r.id,
        "Agreement version: " + r.version,
        "Agreement fingerprint (SHA-256): " + r.textHash,
        "Agreed to sign electronically: yes",
        "Recorded by Ervo's server at " + new Date(r.signedAt).toISOString(),
      ];
      if (withAudit) rec.push("IP address: " + r.ip, "Browser: " + r.userAgent);
      rec.forEach((l) => text(l, { size: 9.5, gap: 2 }));
    } else {
      y += 10;
      text("To sign online, use the personal invite link Ervo sent you.", { size: 9.5 });
    }

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(110);
      doc.text(TITLE + (r ? " · Signed by " + strip(r.name) : "") + " · Page " + i + " of " + pages, M, H - 30);
      doc.setTextColor(0);
    }
    return doc;
  }

  function pdfName(record) {
    if (!record) return "Ervo-Tester-Agreement-" + VERSION + ".pdf";
    const who = String(record.name).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "Tester";
    return "Ervo-Tester-Agreement-Signed-" + who + "-" + record.signedAt.slice(0, 10) + ".pdf";
  }

  window.ErvoNda = { VERSION, TITLE, html, plain, hash, signedHtml, esc, pdf, pdfName };
})();
