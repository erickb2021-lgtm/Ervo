// "See Ervo in action" player. Each scene is HTML/CSS animation; this script
// sequences them like a video timeline (data-dur = scene length in ms).
(function () {
  const player = document.getElementById("player");
  if (!player) return;
  const stage = document.getElementById("stage");
  const scenes = Array.from(stage.querySelectorAll(".scene"));
  const fill = document.getElementById("fill");
  const bar = document.getElementById("bar");
  const timeEl = document.getElementById("time");
  const bigPlay = document.getElementById("big-play");
  const toggle = document.getElementById("toggle");
  const music = document.getElementById("music");
  const muteBtn = document.getElementById("mute");
  const vol = document.getElementById("vol");

  const starts = [];
  let total = 0;
  scenes.forEach((s) => { starts.push(total); total += Number(s.dataset.dur) || 4000; });

  let elapsed = 0;
  let playing = false;
  let last = 0;
  let current = -1;

  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // Confetti for the finale
  const confetti = stage.querySelector(".confetti");
  if (confetti) {
    const colors = ["#6b2fd0", "#ffb38f", "#ef9f27", "#5dcaa5", "#b79bf0", "#2a1650", "#d4537e"];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement("i");
      c.style.left = Math.random() * 100 + "%";
      c.style.background = colors[i % colors.length];
      c.style.setProperty("--d", (Math.random() * 1.6).toFixed(2) + "s");
      c.style.setProperty("--t", (2.2 + Math.random() * 2).toFixed(2) + "s");
      c.style.setProperty("--r", Math.round(360 + Math.random() * 720) + "deg");
      confetti.append(c);
    }
  }

  // Music: plays in sync with the timeline; silent if assets/music.mp3 is missing
  // Every visit starts at 10% so nobody gets blasted. Changes last until the
  // page is closed or reloaded (nothing is saved between visits).
  const START_VOLUME = 10;
  const toVolume = (v) => v / 100;
  vol.value = START_VOLUME;
  music.volume = toVolume(START_VOLUME);
  function setMuted(m) {
    music.muted = m;
    player.classList.toggle("muted", m);
    muteBtn.setAttribute("aria-label", m ? "Unmute" : "Mute");
  }
  muteBtn.addEventListener("click", () => setMuted(!music.muted));
  vol.addEventListener("input", () => {
    music.volume = toVolume(vol.value);
    setMuted(vol.value === "0");
  });
  // music.mp3 is already trimmed to begin 20 seconds into the original song
  const MUSIC_START = 0;
  function syncMusic() {
    const t = MUSIC_START + elapsed / 1000;
    if (music.duration) music.currentTime = Math.min(t, music.duration);
    else music.addEventListener("loadedmetadata", () => { music.currentTime = MUSIC_START + elapsed / 1000; }, { once: true });
  }

  function sceneAt(ms) {
    let i = 0;
    while (i < scenes.length - 1 && ms >= starts[i + 1]) i++;
    return i;
  }

  function setScene(i) {
    if (i === current) return;
    current = i;
    scenes.forEach((s, j) => {
      s.classList.remove("active");
      if (j === i) {
        void s.offsetWidth; // restart this scene's CSS animations
        s.classList.add("active");
      }
    });
  }

  function render() {
    const pct = (elapsed / total) * 100;
    fill.style.width = pct + "%";
    bar.setAttribute("aria-valuenow", Math.round(pct));
    timeEl.textContent = `${fmt(elapsed)} / ${fmt(total)}`;
    setScene(sceneAt(elapsed));
  }

  function tick(now) {
    if (!playing) return;
    elapsed += now - last;
    last = now;
    if (elapsed >= total) {
      elapsed = total - 1;
      render();
      pause();
      return;
    }
    render();
    requestAnimationFrame(tick);
  }

  function play() {
    if (elapsed >= total - 1) seek(0);
    playing = true;
    bigPlay.hidden = true;
    player.classList.add("playing");
    stage.classList.remove("paused");
    toggle.setAttribute("aria-label", "Pause");
    syncMusic();
    music.play().catch(() => {});
    last = performance.now();
    requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    player.classList.remove("playing");
    stage.classList.add("paused");
    toggle.setAttribute("aria-label", "Play");
    music.pause();
  }

  function seek(ms) {
    elapsed = Math.max(0, Math.min(total - 1, ms));
    current = -1; // force the scene to restart its animations
    render();
    syncMusic();
  }

  bigPlay.addEventListener("click", play);
  toggle.addEventListener("click", () => (playing ? pause() : play()));
  document.getElementById("restart").addEventListener("click", () => { seek(0); play(); });
  stage.addEventListener("click", (e) => {
    if (e.target.closest("a, .big-play")) return;
    playing ? pause() : play();
  });

  bar.addEventListener("click", (e) => {
    const r = bar.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * total);
  });
  bar.addEventListener("keydown", (e) => {
    const i = sceneAt(elapsed);
    if (e.key === "ArrowRight") seek(starts[Math.min(scenes.length - 1, i + 1)]);
    else if (e.key === "ArrowLeft") seek(starts[Math.max(0, i - 1)]);
    else return;
    e.preventDefault();
  });

  // Start on the first frame, paused
  stage.classList.add("paused");
  render();
})();
