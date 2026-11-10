// The closing ring: a Spline scene (assets/ervo-ring.splinecode) behind the page's last line.
// A still picture of it is there first. The live scene loads only on computers with a real graphics card,
// only when the visitor gets near the end of the page, and it stops drawing whenever it is off screen.
// Starting a 3D scene costs a few slow frames, so it waits for a pause in scrolling to do that.
// "Reduce motion", "save data", phones and software renderers all keep the still picture.
(() => {
  const stage = document.getElementById("ring-stage");
  if (!stage) return;
  const canvas = stage.querySelector("canvas");
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const RUNTIME = "https://cdn.jsdelivr.net/npm/@splinetool/runtime@2.0.122/build/runtime.js";
  const SCENE = "assets/ervo-ring.splinecode?v=1";
  const END = 0.33;   // how far into the scene's scroll animation the ring gets by the time it leaves the screen
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

  // The scene fades its far side into its own background; both follow the page's light or dark ground.
  function paint() {
    if (!app) return;
    const dark = root.dataset.theme === "dark";
    const bg = dark ? "0,0,0" : "247,245,242";
    try {
      app.setBackgroundColor(dark ? "#000000" : "#f7f5f2");
      const ring = app.findObjectByName("Abstract");
      const layers = ring && ring.material && ring.material.layers;
      const fade = layers && layers.find((l, i) => i > 0 && l.type === "depth" && l.mode === 2);
      if (fade && fade.colors) { fade.colors[0] = `rgba(${bg},0)`; fade.colors[1] = `rgba(${bg},1)`; }
      app.requestRender();
    } catch (e) { /* the scene keeps its own colours */ }
  }

  // The scene's own scroll animation (the camera moving in on the ring) was made for the top of a page.
  // Here it starts when the ring comes into view and reaches END as it leaves the top of the screen.
  function anchor() {
    if (!app) return;
    try {
      const room = innerHeight + stage.offsetHeight;
      const scroll = app._eventManager.handlers.Scroll;
      for (const list of scroll.scrollEventsPerObject.values()) for (const ev of list) {
        Object.assign(ev.data, { startFrom: "enter", enterAnchor: "top", startOffset: 0, endAfter: room / END });
        ev.handleResize();
      }
    } catch (e) { /* the scene keeps its own timing */ }
  }

  // The scene frames its ring high and to the left; this puts it in the middle of the stage.
  function centre() {
    try { const ring = app.findObjectByName("Abstract"); ring.position.x = 0; ring.position.y = -120; } catch (e) { /* stays where it is */ }
  }

  // Resolves once the page has been still for a moment.
  let moved = 0;
  addEventListener("scroll", () => { moved = performance.now(); }, { passive: true });
  const settled = () => new Promise((done) => { const check = () => (performance.now() - moved > 350 ? done() : setTimeout(check, 120)); check(); });

  function run() {
    if (!app) return;
    if (visible && !reduce.matches && !document.hidden) app.play(); else app.stop();
  }

  async function load() {
    if (app || loading || failed || reduce.matches || saveData || !fine) return;
    if (!hardwareGL()) { failed = true; return; }
    loading = true;
    try {
      const { Application } = await import(RUNTIME);
      await settled();
      app = new Application(canvas, { renderMode: "auto" });
      await app.load(SCENE);
      centre();
      anchor();
      paint();
      run();
      // Two frames so the first picture is on the canvas before the still fades out.
      requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add("is-live")));
    } catch (e) {
      failed = true;
      stage.classList.remove("is-live");
      try { if (app) app.dispose(); } catch (err) { /* fine */ }
      app = null;
    }
    loading = false;
  }

  // Starts loading a couple of screens before the section arrives; draws only while it is on screen.
  new IntersectionObserver((entries) => { if (entries[0].isIntersecting) load(); }, { rootMargin: "1600px 0px" }).observe(stage);
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; run(); }).observe(stage);
  document.addEventListener("visibilitychange", run);
  let sized = 0;
  addEventListener("resize", () => { cancelAnimationFrame(sized); sized = requestAnimationFrame(anchor); });
  reduce.addEventListener("change", () => { stage.classList.toggle("is-live", !!app && !reduce.matches); run(); if (!reduce.matches && visible) load(); });
  new MutationObserver(paint).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
})();
