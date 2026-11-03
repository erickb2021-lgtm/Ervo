// Light/dark mode. Follows the visitor's system setting until they choose one
// with the header switch; their choice is remembered on this device.
// Images with data-dark="..." swap to that file in dark mode.
(function () {
  const KEY = "ervo-theme";
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function apply(theme) {
    root.dataset.theme = theme;
    document.querySelectorAll("img[data-dark]").forEach((img) => {
      if (!img.dataset.light) img.dataset.light = img.getAttribute("src");
      img.src = theme === "dark" ? img.dataset.dark : img.dataset.light;
    });
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }

  // Privacy and Terms are always dark
  if (root.dataset.forceTheme) { apply(root.dataset.forceTheme); return; }

  apply(stored() || (system.matches ? "dark" : "light"));

  system.addEventListener("change", (e) => {
    if (!stored()) apply(e.matches ? "dark" : "light");
  });

  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
      apply(next);
    });
  }
})();
