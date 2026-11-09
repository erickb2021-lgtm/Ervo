// The hero stage. Classic Ervo stands on the podium as a still picture first; the 3D owl loads after the
// page is ready and fades in over it. No WebGL, a failed download, or "reduce motion" all keep the picture.
(() => {
  const stage = document.getElementById("owl-stage");
  const host = document.getElementById("os-owl");
  const poster = document.getElementById("os-poster");
  if (!stage || !host || !poster) return;

  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = matchMedia("(pointer: coarse)").matches;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  let api = null, loading = false, failed = false, hinted = false, started = false;

  const lookOf = (src) => (/ervo-([a-z0-9-]+)\.(?:webp|png)/.exec(src || "") || [])[1] || "classic";
  const chip = document.querySelector("#avatar img");
  let look = lookOf(chip && chip.getAttribute("src"));

  function sync() {
    const on = !!api && !failed && look === "classic" && !reduce.matches;
    stage.classList.toggle("is-3d", on);
    if (api) api.setActive(on);
    if (on && !hinted) { hinted = true; stage.classList.add("hint-on"); setTimeout(hideHint, 7000); }
    if (!on) hideHint();
  }
  function hideHint() { stage.classList.remove("hint-on"); }

  function showLook() {
    stage.dataset.look = look;
    const src = look === "classic" ? "assets/ervo-classic.webp" : `assets/ervo-${look}.png`;
    if (poster.getAttribute("src") !== src) poster.src = src;
    sync();
  }

  // Only asks whether the browser has WebGL 2 at all. Making a test canvas here would cost as much as the real one;
  // if the real one cannot start, mountOwl throws and the picture stays.
  function canWebGL() { return "WebGL2RenderingContext" in window; }

  async function load() {
    if (api || loading || failed || reduce.matches || saveData || look !== "classic") return;
    if (!canWebGL()) { failed = true; return; }
    loading = true;
    try {
      const mod = await import("./owl3d.js?v=3");
      api = await mod.mountOwl(host, { onTap: hideHint, onSpin: hideHint, onFail: () => { failed = true; sync(); } });
      api.setTheme(root.dataset.theme === "dark");
      // Two frames so the first picture is on the canvas before the still fades out.
      requestAnimationFrame(() => requestAnimationFrame(sync));
    } catch (e) {
      failed = true;
    }
    loading = false;
  }

  // The look picker in the headline also changes who stands on the stage. Only Classic has a 3D body;
  // every other look shows its own artwork.
  const before = window.ervoSetOwl;
  window.ervoSetOwl = (src) => {
    if (before) before(src);
    look = lookOf(src);
    showLook();
    if (look === "classic" && started) load();
  };
  showLook();

  // Dark and light mode light the owl differently.
  new MutationObserver(() => { if (api) api.setTheme(root.dataset.theme === "dark"); })
    .observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  reduce.addEventListener("change", () => { sync(); if (!reduce.matches && started) load(); });

  // Load the 3D after the page has finished, at the first sign of the visitor (a pointer move, touch, scroll
  // or key) or a few seconds in, so it never competes with the page itself.
  function start() {
    if (started) return;
    started = true;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    idle(() => load(), { timeout: 1500 });
  }
  function arm() {
    const signs = ["pointermove", "pointerdown", "scroll", "keydown"];
    const once = () => { signs.forEach((type) => removeEventListener(type, once)); start(); };
    signs.forEach((type) => addEventListener(type, once, { passive: true }));
    setTimeout(once, 3500);
  }
  if (document.readyState === "complete") arm(); else addEventListener("load", arm, { once: true });

  // The floating cards drift a little against the pointer, the nearer ones more: depth you can feel.
  const cards = [...stage.querySelectorAll(".os-card")];
  if (cards.length && !coarse && matchMedia("(hover: hover)").matches) {
    const depth = [14, 22, 30];
    let tx = 0, ty = 0, x = 0, y = 0, vx = 0, vy = 0, raf = 0, last = 0;
    const step = (now) => {
      const dt = last ? Math.max(0.001, Math.min(0.05, (now - last) / 1000)) : 0.016; last = now;
      vx += (-90 * (x - tx) - 17 * vx) * dt; x += vx * dt;
      vy += (-90 * (y - ty) - 17 * vy) * dt; y += vy * dt;
      cards.forEach((c, i) => { c.style.translate = `${(-x * depth[i % 3]).toFixed(2)}px ${(-y * depth[i % 3] * 0.6).toFixed(2)}px`; });
      const still = Math.abs(x - tx) < 0.001 && Math.abs(y - ty) < 0.001 && Math.abs(vx) < 0.001 && Math.abs(vy) < 0.001;
      raf = still ? 0 : requestAnimationFrame(step);
    };
    const kick = () => { if (!raf && !reduce.matches) { last = 0; raf = requestAnimationFrame(step); } };
    const hero = stage.closest(".hero") || stage;
    hero.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = stage.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
      ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
      kick();
    }, { passive: true });
    hero.addEventListener("pointerleave", () => { tx = 0; ty = 0; kick(); });
  }
})();
