// Motion for the home page: a hero entrance, heading and section reveals and one scroll-linked piece (GSAP).
// Scrolling itself is the browser's own, so the page never trails the wheel. Everything here is an extra: the page is complete and readable without it.
// With "reduce motion" on, none of the libraries are even downloaded.
(() => {
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const wide = () => window.innerWidth >= 760;
  const $ = (id) => document.getElementById(id);

  // The demo's music is not downloaded with the page. It is fetched once the visitor has scrolled and the
  // player is near the screen. Pressing play before that fetches it too.
  const music = $("music"), player = $("player");
  if (music && player && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      music.preload = "auto"; // the browser starts the download by itself; calling load() too would fetch it twice
    }, { rootMargin: "300px 0px" });
    addEventListener("scroll", () => io.observe(player), { once: true, passive: true });
  }

  if (reduce) return;

  const CDN = "https://cdn.jsdelivr.net/npm/";
  const LIBS = [
    "gsap@3.15.1/dist/gsap.min.js",
    "gsap@3.15.1/dist/ScrollTrigger.min.js",
    "gsap@3.15.1/dist/SplitText.min.js",
  ];

  function loadAll() {
    return Promise.all(LIBS.map((path) => new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = CDN + path;
      s.async = false; // keeps the order: GSAP first, then its plugins
      s.onload = ok; s.onerror = fail;
      document.head.appendChild(s);
    })));
  }

  // Computers get the motion right away (the hero cards are waiting for it). Phones get it in a quiet moment
  // after the page has finished loading, so it never slows the first view.
  const begin = () => loadAll().then(init).catch(() => root.classList.add("motion-on"));
  const quiet = () => (window.requestIdleCallback ? requestIdleCallback(begin, { timeout: 2000 }) : setTimeout(begin, 300));
  if (fine) begin();
  else if (document.readyState === "complete") setTimeout(quiet, 300);
  else addEventListener("load", () => setTimeout(quiet, 300), { once: true });

  // The set-up runs in short steps with a breath between them, so the page stays responsive while it happens.
  const breath = () => new Promise((done) => setTimeout(done, 0));

  async function init() {
    const { gsap, ScrollTrigger, SplitText } = window;
    if (!gsap || !ScrollTrigger) { root.classList.add("motion-on"); return; }
    gsap.registerPlugin(ScrollTrigger);
    if (SplitText) gsap.registerPlugin(SplitText);
    gsap.defaults({ ease: "power3.out", duration: 0.8 });

    // ---- hero: one entrance, for the cards floating around the owl ----
    const cards = gsap.utils.toArray("#owl-stage .os-in");
    const late = performance.now() > 2800; // the cards have already shown themselves; leave them be
    root.classList.add("motion-on");
    if (cards.length && !late && window.innerWidth >= 1040) {
      gsap.timeline({ defaults: { ease: "expo.out" } })
        .from(cards, { opacity: 0, y: 30, scale: 0.94, duration: 1, stagger: 0.13, clearProps: "transform,opacity" }, 0.1);
    }

    const below = (el) => el.getBoundingClientRect().top > window.innerHeight * 0.92;

    // ---- section headings rise line by line ----
    const splitHeadings = async () => {
      if (!SplitText) return;
      const heads = [...document.querySelectorAll("main section:not(.hero) h2")].filter(below);
      for (const h of heads) {
        await breath();
        SplitText.create(h, {
          type: "lines", mask: "lines", autoSplit: true, linesClass: "split-line",
          onSplit(self) {
            return gsap.from(self.lines, {
              yPercent: 108, duration: 0.9, ease: "expo.out", stagger: 0.09,
              scrollTrigger: { trigger: h, start: "top 88%", once: true },
            });
          },
        });
      }
    };

    // ---- section reveals ----
    // Every reveal is listed first; then everything is measured, and only then changed, so the page is laid out
    // once. One watcher starts them as they scroll into view. Its top edge reaches far above the screen, so a
    // jump down the page (a link, the End key, a fast fling) still shows everything it passed.
    const jobs = [];
    const reveal = (sel, from, stagger) => jobs.push({ els: gsap.utils.toArray(sel), from, stagger: stagger || 0.1 });
    const up = { opacity: 0, y: 34 };
    reveal("#how .section-head > p, #choose .section-head > p, #compare .section-head > p, #learn .section-head > p", { opacity: 0, y: 16 });
    reveal("#choose .plan-card", { opacity: 0, y: 46, rotationX: 9, transformPerspective: 1100, transformOrigin: "50% 100%" }, 0.14);
    reveal("#choose .both, #choose .same-ask", up);
    reveal("#compare .cmp", { opacity: 0, y: 40 });
    reveal("#learn .feature", { opacity: 0, y: 44, rotationX: 10, transformPerspective: 1100, transformOrigin: "50% 100%" }, 0.12);
    // The words beside each picture rise; the pictures themselves stand at an angle (CSS), so they only fade or rise whole.
    reveal(gsap.utils.toArray(".split > .reveal").filter((el) => el.classList.length === 1), { opacity: 0, y: 28 });
    reveal(".phone-stand, .ideas", { opacity: 0, y: 54 });
    reveal(".split .perm-mock", { opacity: 0 });
    reveal(".apps", { opacity: 0 });
    reveal(".apps .app", { y: 26, scale: 0.78 }, 0.045);
    reveal(".closing .closing-line, .closing .closing-sub", up, 0.12);
    reveal(".cta .hello-owl, .cta .stack", { opacity: 0, y: 24 }, 0.1);

    await breath();
    if ("IntersectionObserver" in window) {
      jobs.forEach((job) => { job.els = job.els.filter(below); });
      const watcher = new IntersectionObserver((entries) => {
        const seen = new Set(entries.filter((e) => e.isIntersecting).map((e) => e.target));
        if (!seen.size) return;
        jobs.forEach((job) => {
          const batch = job.els.filter((el) => seen.has(el));
          if (!batch.length) return;
          job.els = job.els.filter((el) => !seen.has(el));
          batch.forEach((el) => watcher.unobserve(el));
          gsap.to(batch, { ...job.rest, onComplete: () => batch.forEach((el) => el.classList.remove("gs-anim")) });
        });
      }, { rootMargin: "99999px 0px -12% 0px" });
      jobs.forEach((job) => {
        if (!job.els.length) return;
        const from = job.from;
        // Back to rest: only the properties this reveal moved, so a tile that is meant to be half see-through stays so.
        job.rest = { duration: 0.9, stagger: job.stagger, overwrite: true, clearProps: "transform" + ("opacity" in from ? ",opacity" : "") };
        Object.keys(from).forEach((k) => { if (!k.startsWith("transform")) job.rest[k] = k === "opacity" || k === "scale" ? 1 : 0; });
        // While GSAP moves an element, its own CSS transition must not ease the same property a second time.
        job.els.forEach((el) => el.classList.add("gs-anim"));
        gsap.set(job.els, from);
        job.els.forEach((el) => watcher.observe(el));
      });
    }

    await breath();
    await (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve());
    await splitHeadings();
    await breath();

    // ---- the one scroll-linked piece: the demo player tips up from the table as it arrives ----
    const mm = gsap.matchMedia();
    mm.add("(min-width: 760px)", () => {
      const player = $("player");
      if (!player || !below(player)) return;
      gsap.fromTo(player,
        { rotationX: 16, scale: 0.86, y: 30, transformPerspective: 1500, transformOrigin: "50% 100%" },
        { rotationX: 0, scale: 1, y: 0, ease: "none", scrollTrigger: { trigger: player, start: "top 96%", end: "top 30%", scrub: 0.6 } });
    });

    // ---- pointer extras, only where there is a real pointer ----
    if (fine) {
      // Plan cards lean toward the pointer, with a soft glare that follows it.
      document.querySelectorAll(".plan-card").forEach((card) => {
        const glare = document.createElement("i");
        glare.className = "tilt-glare"; glare.setAttribute("aria-hidden", "true");
        card.appendChild(glare);
        card.classList.add("tilt");
        card.addEventListener("pointerenter", () => gsap.set(card, { transformPerspective: 1000 }));
        const rx = gsap.quickTo(card, "rotationX", { duration: 0.5, ease: "power3.out" });
        const ry = gsap.quickTo(card, "rotationY", { duration: 0.5, ease: "power3.out" });
        card.addEventListener("pointermove", (e) => {
          if (e.pointerType === "touch" || !wide()) return;
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
          ry((px - 0.5) * 7); rx((0.5 - py) * 6);
          glare.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
          glare.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
          card.classList.add("tilting");
        }, { passive: true });
        card.addEventListener("pointerleave", () => { rx(0); ry(0); card.classList.remove("tilting"); });
      });

      // Glass cards catch the light where the pointer is.
      document.querySelectorAll(".ideas-card, .perm-mock, .ask-card, .feature, .cmp-panel, .only").forEach((card) => {
        const glow = document.createElement("i");
        glow.className = "spot-glow"; glow.setAttribute("aria-hidden", "true");
        card.classList.add("has-spot");
        card.appendChild(glow);
        card.addEventListener("pointermove", (e) => {
          if (e.pointerType === "touch") return;
          const r = card.getBoundingClientRect();
          glow.style.setProperty("--gx", (e.clientX - r.left).toFixed(0) + "px");
          glow.style.setProperty("--gy", (e.clientY - r.top).toFixed(0) + "px");
        }, { passive: true });
      });

      // The two main buttons pull a little toward the pointer.
      document.querySelectorAll("#dl-trigger, .cta .btn-primary").forEach((btn) => {
        const pos = { x: 0, y: 0 };
        const paint = () => { btn.style.translate = `${pos.x.toFixed(2)}px ${pos.y.toFixed(2)}px`; };
        btn.addEventListener("pointermove", (e) => {
          if (e.pointerType === "touch") return;
          const r = btn.getBoundingClientRect();
          gsap.to(pos, { x: (e.clientX - (r.left + r.width / 2)) * 0.22, y: (e.clientY - (r.top + r.height / 2)) * 0.3, duration: 0.4, ease: "power3.out", overwrite: true, onUpdate: paint });
        }, { passive: true });
        btn.addEventListener("pointerleave", () => gsap.to(pos, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.45)", overwrite: true, onUpdate: paint }));
      });
    }

    // Pictures and fonts that arrive late change the page height; measure again once they are in.
    if (document.readyState === "complete") ScrollTrigger.refresh();
    else addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
  }
})();
