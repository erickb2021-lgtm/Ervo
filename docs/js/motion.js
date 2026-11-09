// Motion for the home page: smooth scrolling (Lenis), a hero entrance, heading and section reveals and one
// scroll-linked piece (GSAP). Everything here is an extra: the page is complete and readable without it.
// With "reduce motion" on, none of the libraries are even downloaded.
(() => {
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const wide = () => window.innerWidth >= 760;
  const $ = (id) => document.getElementById(id);

  // Scroll areas that keep their own wheel and touch scrolling inside the smooth page.
  ["download", "look-picker", "ct-panel"].forEach((id) => { const el = $(id); if (el) el.setAttribute("data-lenis-prevent", ""); });
  document.querySelectorAll("textarea, .cmp-chat").forEach((el) => el.setAttribute("data-lenis-prevent", ""));

  // The demo's music is not downloaded with the page. Fetch it when the player comes near.
  const music = $("music"), how = $("how");
  if (music && how && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      music.preload = "auto";
      try { music.load(); } catch (e) {}
    }, { rootMargin: "600px 0px" });
    io.observe(how);
  }

  if (reduce) return;

  const CDN = "https://cdn.jsdelivr.net/npm/";
  const LIBS = [
    "gsap@3.15.1/dist/gsap.min.js",
    "gsap@3.15.1/dist/ScrollTrigger.min.js",
    "gsap@3.15.1/dist/SplitText.min.js",
  ];
  if (fine) LIBS.push("lenis@1.3.27/dist/lenis.min.js"); // touch screens keep their own native scrolling

  function loadAll() {
    return Promise.all(LIBS.map((path) => new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = CDN + path;
      s.async = false; // keeps the order: GSAP first, then its plugins
      s.onload = ok; s.onerror = fail;
      document.head.appendChild(s);
    })));
  }

  // Computers get the motion right away (the hero cards are waiting for it). Phones get it once the page has
  // finished loading, so it never slows the first view.
  const begin = () => loadAll().then(init).catch(() => root.classList.add("motion-on"));
  if (fine) begin();
  else if (document.readyState === "complete") setTimeout(begin, 300);
  else addEventListener("load", () => setTimeout(begin, 300), { once: true });

  function init() {
    const { gsap, ScrollTrigger, SplitText, Lenis } = window;
    if (!gsap || !ScrollTrigger) { root.classList.add("motion-on"); return; }
    gsap.registerPlugin(ScrollTrigger);
    if (SplitText) gsap.registerPlugin(SplitText);
    gsap.defaults({ ease: "power3.out", duration: 0.8 });

    // ---- smooth scrolling ----
    let lenis = null;
    if (Lenis && fine) {
      lenis = new Lenis({
        autoRaf: false, lerp: 0.115, wheelMultiplier: 1, allowNestedScroll: true, stopInertiaOnNavigate: true,
        // The contact panel is built after this script runs, so it is matched here rather than tagged above.
        prevent: (node) => node.id === "ct-panel" || node.tagName === "TEXTAREA",
      });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
      window.ervoLenis = lenis;
    }

    // Links to a place on this page ("See how it works", "Create an account") glide there and stop below the header.
    const header = document.querySelector(".site-header");
    document.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || !lenis) return;
      const hash = a.getAttribute("href");
      const el = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
      if (!el && hash !== "#" && hash !== "#top") return;
      e.preventDefault();
      if (!el) { lenis.scrollTo(0); return; }
      const own = parseFloat(getComputedStyle(el).scrollMarginTop) || 0; // Lenis already honours scroll-margin
      lenis.scrollTo(el, { offset: own ? 0 : -(header ? header.offsetHeight : 0) });
      if (history.replaceState) history.replaceState(null, "", hash);
    });

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
    const splitHeadings = () => {
      if (!SplitText) return;
      document.querySelectorAll("main section:not(.hero) h2").forEach((h) => {
        if (!below(h)) return;
        SplitText.create(h, {
          type: "lines", mask: "lines", autoSplit: true, linesClass: "split-line",
          onSplit(self) {
            return gsap.from(self.lines, {
              yPercent: 108, duration: 0.9, ease: "expo.out", stagger: 0.09,
              scrollTrigger: { trigger: h, start: "top 88%", once: true },
            });
          },
        });
      });
    };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(splitHeadings);

    // ---- section reveals ----
    const reveal = (sel, from, stagger) => {
      const els = gsap.utils.toArray(sel).filter(below);
      if (!els.length) return;
      // Back to rest: only the properties this reveal moved, so a tile that is meant to be half see-through stays so.
      const rest = { duration: 0.9, stagger: stagger || 0.1, overwrite: true, clearProps: "transform" + ("opacity" in from ? ",opacity" : "") };
      Object.keys(from).forEach((k) => { if (!k.startsWith("transform")) rest[k] = k === "opacity" || k === "scale" ? 1 : 0; });
      // While GSAP moves an element, its own CSS transition must not ease the same property a second time.
      els.forEach((el) => el.classList.add("gs-anim"));
      gsap.set(els, from);
      ScrollTrigger.batch(els, { start: "top 88%", once: true, onEnter: (batch) => gsap.to(batch, { ...rest, onComplete: () => batch.forEach((el) => el.classList.remove("gs-anim")) }) });
    };
    const up = { opacity: 0, y: 34 };
    reveal("#how .section-head > p, #choose .section-head > p, #compare .section-head > p, #learn .section-head > p", { opacity: 0, y: 16 });
    reveal("#choose .plan-card", { opacity: 0, y: 46, rotationX: 9, transformPerspective: 1100, transformOrigin: "50% 100%" }, 0.14);
    reveal("#choose .both, #choose .same-ask", up);
    reveal("#compare .cmp", { opacity: 0, y: 40, scale: 0.975 });
    reveal("#learn .feature", { opacity: 0, y: 44, rotationX: 10, transformPerspective: 1100, transformOrigin: "50% 100%" }, 0.12);
    // The words beside each picture rise; the pictures themselves stand at an angle (CSS), so they only fade or rise whole.
    reveal(gsap.utils.toArray(".split > .reveal").filter((el) => el.classList.length === 1), { opacity: 0, y: 28 });
    reveal(".phone-stand, .ideas", { opacity: 0, y: 54 });
    reveal(".split .perm-mock", { opacity: 0 });
    reveal(".apps", { opacity: 0 });
    reveal(".apps .app", { y: 26, scale: 0.78 }, 0.045);
    reveal(".closing .closing-line, .closing .closing-sub", up, 0.12);
    reveal(".cta .hello-owl, .cta .stack", { opacity: 0, y: 24 }, 0.1);

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
    addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
  }
})();
