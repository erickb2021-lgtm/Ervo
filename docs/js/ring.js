// The closing dive: a Spline scene (assets/ervo-ring.splinecode) fills the screen behind the page's last line.
// The section holds still while the page scrolls (css/depth.css, 5h2), and that scrolling drives the scene's own
// animation: its camera goes down into the spiral of discs. The scene is shown as it was made; nothing in it is
// moved or recoloured, except that its ground takes the page's ground colour so it has no edge.
// A still picture of its first frame is there first. "Reduce motion", "save data", small-memory phones and
// devices without a graphics card keep that picture, and for them the section is one ordinary screen.
(() => {
  const stage = document.getElementById("ring-stage");
  if (!stage) return;
  const section = stage.closest("section");
  const canvas = stage.querySelector("canvas");
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const smallMemory = !!navigator.deviceMemory && navigator.deviceMemory < 4;
  const RUNTIME = "https://cdn.jsdelivr.net/npm/@splinetool/runtime@2.0.159/build/runtime.js";
  const SCENE = "assets/ervo-ring.splinecode?v=2";
  let app = null, loading = false, failed = false, visible = false;

  // A software renderer would draw the scene on the processor and slow the page, so it keeps the picture.
  function hardwareGL() {
    if (/force3d/.test(location.search)) return true;
    try {
      const c = document.createElement("canvas"), gl = c.getContext("webgl2");
      if (!gl) return false;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
      const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
      return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (e) { return false; }
  }
  if (saveData || smallMemory || !hardwareGL()) return;

  // The class makes the section tall and holds its screen still. It is set now, before the page is first laid
  // out this far down, so nothing jumps later.
  const dive = (on) => root.classList.toggle("ring-dive", on);
  dive(!reduce.matches);

  // The scene's ground follows the page. Dark mode shows the scene with its tones turned over (CSS), so there
  // its ground is white, which turns over to the page's black.
  function paint() {
    if (!app) return;
    try { app.setBackgroundColor(root.dataset.theme === "dark" ? "#ffffff" : "#f7f5f2"); app.requestRender(); } catch (e) { /* keeps its own colour */ }
  }

  // The scene's scroll animation was set to start 600px down a page and last 1800px.
  // Here it starts where the section takes hold of the screen and ends where it lets go.
  function anchor() {
    if (!app) return;
    try {
      const top = Math.round(section.getBoundingClientRect().top + scrollY);
      const length = Math.max(1, section.offsetHeight - innerHeight);
      for (const list of app._eventManager.handlers.Scroll.scrollEventsPerObject.values()) for (const ev of list) {
        if (ev.data.startFrom === "page" && ev.data.startOffset === top && ev.data.endAfter === length) continue;
        Object.assign(ev.data, { startFrom: "page", startOffset: top, endAfter: length });
        ev.handleResize();
      }
    } catch (e) { /* the scene keeps its own timing */ }
  }

  // Resolves once the page has been still for a moment: starting a 3D scene costs a few slow frames.
  let moved = 0;
  addEventListener("scroll", () => { moved = performance.now(); }, { passive: true });
  const settled = () => new Promise((done) => { const check = () => (performance.now() - moved > 350 ? done() : setTimeout(check, 120)); check(); });

  function run() {
    if (!app) return;
    if (visible && !reduce.matches && !document.hidden) app.play(); else app.stop();
  }

  async function load() {
    if (app || loading || failed || reduce.matches) return;
    loading = true;
    try {
      const { Application } = await import(RUNTIME);
      await settled();
      app = new Application(canvas);
      await app.load(SCENE);
      paint();
      anchor();
      run();
      dispatchEvent(new Event("scroll"));
      // Two frames so the first picture is on the canvas before the still fades out.
      requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add("is-live")));
    } catch (e) {
      failed = true;
      stage.classList.remove("is-live");
      dive(false);
      try { if (app) app.dispose(); } catch (err) { /* fine */ }
      app = null;
    }
    loading = false;
  }

  // Starts loading a few screens before the section arrives; draws only while it is on screen.
  new IntersectionObserver((entries) => { if (entries[0].isIntersecting) load(); }, { rootMargin: "3000px 0px" }).observe(section);
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; run(); }).observe(section);
  document.addEventListener("visibilitychange", run);
  // The section's place on the page changes when the window does, or when anything above it changes height.
  let sized = 0;
  const resized = () => { cancelAnimationFrame(sized); sized = requestAnimationFrame(anchor); };
  addEventListener("resize", resized);
  if ("ResizeObserver" in window) new ResizeObserver(resized).observe(document.body);
  reduce.addEventListener("change", () => {
    dive(!reduce.matches && !failed);
    stage.classList.toggle("is-live", !!app && !reduce.matches);
    run();
    if (!reduce.matches) { resized(); if (!app) load(); }
  });
  new MutationObserver(paint).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
})();
