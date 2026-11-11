/* Ervo Shopping page script (0.5.16). Injected into the store's website inside Ervo's own window.
   It reads the page as a short list of things Ervo can tap or type into, and carries out one action
   at a time. Password fields and card fields are never read: those parts are the person's own. */
(function () {
  if (window.__ervo && window.__ervo.v === 1) return;
  var SECRET = /passw|pwd|card.?num|cc-?num|cvv|cvc|csc|security.?code|expir|routing|account.?num|ssn|social/i;
  var CARDISH = /card number|cvv|cvc|security code|expiration|exp\.? date|name on card/i;

  function text(el) {
    var t = el.getAttribute("aria-label") || "";
    if (!t) {
      var id = el.getAttribute("aria-labelledby");
      if (id) { var lab = document.getElementById(id.split(" ")[0]); if (lab) t = lab.textContent || ""; }
    }
    if (!t && el.id) { var l2 = document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]'); if (l2) t = l2.textContent || ""; }
    if (!t) t = el.innerText || el.textContent || "";
    if (!t) t = el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || "";
    if (!t) { var img = el.querySelector && el.querySelector("img[alt]"); if (img) t = img.getAttribute("alt") || ""; }
    return String(t).replace(/\s+/g, " ").trim().slice(0, 90);
  }
  function visible(el) {
    if (!el.getClientRects || !el.getClientRects().length) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0" || cs.pointerEvents === "none" && el.tagName !== "LABEL") return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    var r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.bottom > -800 && r.top < window.innerHeight + 1600;
  }
  function kind(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "input") { var ty = (el.getAttribute("type") || "text").toLowerCase(); if (ty === "hidden") return ""; if (ty === "submit" || ty === "button" || ty === "image") return "button"; if (ty === "checkbox" || ty === "radio") return ty; return "input"; }
    if (tag === "textarea") return "input";
    if (tag === "select") return "select";
    if (tag === "button") return "button";
    if (tag === "a" && el.getAttribute("href")) return "link";
    var role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "button" || role === "menuitem" || role === "tab" || role === "option") return "button";
    if (role === "link") return "link";
    if (role === "checkbox" || role === "radio" || role === "switch") return role;
    if (role === "textbox" || role === "searchbox" || role === "combobox") return "input";
    if (el.hasAttribute("onclick") || (el.getAttribute("tabindex") || "-1") !== "-1") return "button";
    return "";
  }
  function secret(el) {
    var ty = (el.getAttribute("type") || "").toLowerCase();
    if (ty === "password") return true;
    var hint = [el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("autocomplete"), el.getAttribute("placeholder"), el.getAttribute("aria-label")].join(" ");
    return SECRET.test(hint);
  }
  function snap(max) {
    max = max || 120;
    var all = document.querySelectorAll("a[href], button, input, select, textarea, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=menuitem], [role=tab], [role=option], [role=textbox], [role=searchbox], [role=combobox], [onclick], [tabindex]");
    var out = [], seen = 0, sensitive = "";
    for (var i = 0; i < all.length; i++) {
      var el = all[i], k = kind(el);
      if (!k || !visible(el)) continue;
      var r = el.getBoundingClientRect();
      var e = { r: 0, k: k, t: text(el), in: r.bottom > 0 && r.top < window.innerHeight, y: Math.round(r.top + window.scrollY), x: Math.round(r.left) };
      if (k === "input" || k === "select") {
        if (secret(el)) { e.secret = true; sensitive = sensitive || (/passw|pwd/i.test([el.getAttribute("type"), el.getAttribute("name"), el.getAttribute("autocomplete")].join(" ")) ? "sign-in" : "payment"); }
        else {
          var v = String(el.value || "").slice(0, 60);
          if (v) e.v = v;
          var ph = el.getAttribute("placeholder"); if (ph && ph !== e.t) e.ph = ph.slice(0, 50);
          var ty2 = (el.getAttribute("type") || "").toLowerCase(); if (ty2 && ty2 !== "text") e.ty = ty2;
        }
      }
      if (k === "checkbox" || k === "radio") e.on = !!el.checked || el.getAttribute("aria-checked") === "true";
      if (el.disabled || el.getAttribute("aria-disabled") === "true") e.off = true;
      if (k === "link") { var h = el.getAttribute("href") || ""; if (/^https?:/.test(h) || h.charAt(0) === "/") e.h = h.slice(0, 80); }
      if (!e.t && !e.ph && !e.v && k !== "input") continue;
      out.push({ el: el, e: e });
    }
    // The viewport first, then top to bottom; refs are handed out after the sort so low numbers are on screen
    out.sort(function (a, b) { return (b.e.in - a.e.in) || (a.e.y - b.e.y) || (a.e.x - b.e.x); });
    out = out.slice(0, max);
    var els = [];
    for (var j = 0; j < out.length; j++) { seen = j + 1; out[j].el.setAttribute("data-ervo", String(seen)); out[j].e.r = seen; els.push(out[j].e); }
    // Words on the page that matter: headings, prices, cart counts, messages
    var words = [];
    var hs = document.querySelectorAll("h1, h2, h3, [role=alert], [role=status], [aria-live], [class*=cart-count], [class*=badge], [class*=price], [data-testid*=price], [class*=error], [class*=toast]");
    for (var m = 0; m < hs.length && words.length < 40; m++) { if (!visible(hs[m])) continue; var w = text(hs[m]); if (w && words.indexOf(w) < 0) words.push(w); }
    var body = (document.body && document.body.innerText || "").replace(/\s+/g, " ").trim();
    if (!sensitive && CARDISH.test(body.slice(0, 20000))) sensitive = "payment";
    var captcha = /verify you are human|are you a robot|press and hold|access denied|unusual traffic/i.test(body.slice(0, 4000)) ? "captcha" : "";
    return {
      url: location.href.slice(0, 300), title: (document.title || "").slice(0, 120),
      els: els, words: words, text: body.slice(0, 1200),
      scroll: { y: Math.round(window.scrollY), h: Math.round(document.documentElement.scrollHeight), vh: window.innerHeight },
      sensitive: sensitive || captcha, cart: cartCount(),
    };
  }
  function cartCount() {
    var c = document.querySelector('[class*=cart-count], [class*=cartCount], [data-testid*=cart-count], [aria-label*="cart" i] [class*=count], [class*=cart] [class*=badge], a[href*="cart"] span');
    var t = c ? (c.textContent || "").trim() : "";
    return /^\d{1,3}$/.test(t) ? Number(t) : null;
  }
  function byRef(r) { return document.querySelector('[data-ervo="' + String(r) + '"]'); }
  function fire(el, type, init) { try { el.dispatchEvent(new (type.indexOf("key") === 0 ? KeyboardEvent : type.indexOf("pointer") === 0 ? PointerEvent : MouseEvent)(type, Object.assign({ bubbles: true, cancelable: true, view: window }, init || {}))); } catch (e) { try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e2) { /* fine */ } } }
  function setValue(el, value) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    fire(el, "input"); fire(el, "change");
  }
  function act(cmd) {
    cmd = cmd || {};
    var el = cmd.r ? byRef(cmd.r) : null;
    if ((cmd.a === "tap" || cmd.a === "type" || cmd.a === "select") && !el) return { ok: false, note: "that ref is gone; read the page again" };
    if (el && secret(el)) return { ok: false, note: "that field is theirs to fill (sign-in or payment)" };
    if (cmd.a === "tap") {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      var init = { clientX: x, clientY: y, button: 0 };
      fire(el, "pointerdown", init); fire(el, "mousedown", init); try { el.focus(); } catch (e) { /* fine */ }
      fire(el, "pointerup", init); fire(el, "mouseup", init);
      try { el.click(); } catch (e2) { fire(el, "click", init); }
      return { ok: true, note: "tapped " + text(el) };
    }
    if (cmd.a === "type") {
      el.scrollIntoView({ block: "center" });
      try { el.focus(); } catch (e3) { /* fine */ }
      setValue(el, "");
      setValue(el, String(cmd.text || ""));
      if (cmd.enter) {
        var kb = { key: "Enter", code: "Enter", keyCode: 13, which: 13 };
        fire(el, "keydown", kb); fire(el, "keypress", kb); fire(el, "keyup", kb);
        var form = el.form || el.closest("form");
        if (form) { try { if (form.requestSubmit) form.requestSubmit(); else form.submit(); } catch (e4) { /* the site handled Enter itself */ } }
      }
      return { ok: true, note: "typed into " + (text(el) || el.getAttribute("placeholder") || "the field") };
    }
    if (cmd.a === "select") {
      var want = String(cmd.value || "").toLowerCase();
      for (var i = 0; i < el.options.length; i++) { var o = el.options[i]; if (o.value.toLowerCase() === want || (o.textContent || "").trim().toLowerCase() === want || (o.textContent || "").toLowerCase().indexOf(want) >= 0) { setValue(el, o.value); return { ok: true, note: "chose " + (o.textContent || "").trim() }; } }
      return { ok: false, note: "no option like " + cmd.value };
    }
    if (cmd.a === "scroll") {
      if (cmd.to === "top") window.scrollTo(0, 0); else if (cmd.to === "bottom") window.scrollTo(0, document.documentElement.scrollHeight); else window.scrollBy(0, Number(cmd.dy) || Math.round(window.innerHeight * 0.8));
      return { ok: true, note: "scrolled" };
    }
    if (cmd.a === "go") { location.href = String(cmd.url || ""); return { ok: true, note: "going to " + cmd.url }; }
    if (cmd.a === "back") { history.back(); return { ok: true, note: "went back" }; }
    return { ok: false, note: "unknown action" };
  }
  window.__ervo = { v: 1, snap: snap, act: act };
})();
