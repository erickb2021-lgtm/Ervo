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
  // Every visit starts at 10%, so it's audible without blasting anyone. Changes last
  // until the page is closed or reloaded (nothing is saved between visits).
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
  // music.mp3 is 0:20 to 1:20 of the song (one minute), so it matches the 1-minute video.
  // The song's spot always comes from the video's time, so seeking or rewinding keeps them in step.
  const musicTime = () => Math.min(elapsed / 1000, music.duration ? music.duration - 0.05 : elapsed / 1000);
  function syncMusic(force) {
    if (!music.duration) {
      music.addEventListener("loadedmetadata", () => syncMusic(true), { once: true });
      return;
    }
    const want = musicTime();
    const off = Math.abs(music.currentTime - want);
    // Small drift is left alone so the sound doesn't stutter; near the loop point the gap looks big but isn't
    if (force || (off > 0.25 && off < music.duration - 0.25)) music.currentTime = want;
    if (playing && music.paused) music.play().catch(() => {});
  }

  function sceneAt(ms) {
    let i = 0;
    while (i < scenes.length - 1 && ms >= starts[i + 1]) i++;
    return i;
  }

  // Show scene i with its animations at `into` ms, so jumping into the middle of a scene
  // shows it exactly as it looks at that moment instead of starting it over
  function setScene(i, into) {
    if (i === current) return;
    current = i;
    scenes.forEach((s, j) => {
      s.classList.remove("active");
      if (j === i) {
        void s.offsetWidth; // restart this scene's CSS animations
        s.classList.add("active");
        if (into > 0 && s.getAnimations) {
          s.getAnimations({ subtree: true }).forEach((a) => {
            try { a.currentTime = into; } catch (e) { /* older browsers: the scene starts from its beginning */ }
          });
        }
      }
    });
  }

  function render() {
    const pct = (elapsed / total) * 100;
    fill.style.width = pct + "%";
    bar.setAttribute("aria-valuenow", Math.round(pct));
    timeEl.textContent = `${fmt(elapsed)} / ${fmt(total)}`;
    const i = sceneAt(elapsed);
    setScene(i, elapsed - starts[i]);
  }

  function tick(now) {
    if (!playing) return;
    // Follow the music by running a little faster or slower, never by stepping back:
    // stepping back made scenes flash in and out right at a scene change
    let dt = now - last;
    if (!music.paused && music.readyState >= 2) {
      const diff = music.currentTime * 1000 - elapsed;
      if (Math.abs(diff) < 1500) dt *= Math.min(1.25, Math.max(0.75, 1 + diff / 800));
    }
    elapsed += dt;
    last = now;
    const left = total - elapsed;
    if (left < 1500 && !music.muted) music.volume = toVolume(vol.value) * Math.max(0, left / 1500);
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
    syncMusic(true);
    // Play right away at the slider's level (10% to start), no fade from silence
    if (total - elapsed > 1500) music.volume = toVolume(vol.value);
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
    if (total - elapsed > 1500) music.volume = toVolume(vol.value); // undo the end fade after rewinding
    current = -1; // force the scene to restart its animations
    render();
    syncMusic(true);
  }

  bigPlay.addEventListener("click", play);
  toggle.addEventListener("click", () => (playing ? pause() : play()));
  document.getElementById("restart").addEventListener("click", () => { seek(0); play(); });
  stage.addEventListener("click", (e) => {
    if (e.target.closest("a, .big-play")) return;
    playing ? pause() : play();
  });

  // Scrub: press and hold on the bar, then drag left to rewind or right to skip ahead.
  // The picture follows the finger or mouse live; the music jumps to the spot on release.
  let scrubbing = false, wasPlaying = false;
  const msAt = (x) => {
    const r = bar.getBoundingClientRect();
    if (!r.width) return elapsed;
    return Math.max(0, Math.min(1, (x - r.left) / r.width)) * total;
  };
  function scrubTo(x) {
    elapsed = Math.max(0, Math.min(total - 1, msAt(x)));
    current = -1;
    render();
  }
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    scrubbing = true;
    wasPlaying = playing;
    if (playing) pause();
    bar.setPointerCapture(e.pointerId);
    player.classList.add("scrubbing");
    scrubTo(e.clientX);
  });
  bar.addEventListener("pointermove", (e) => { if (scrubbing) scrubTo(e.clientX); });
  function endScrub(e) {
    if (!scrubbing) return;
    scrubbing = false;
    player.classList.remove("scrubbing");
    if (e.type === "pointerup") seek(msAt(e.clientX));
    else seek(elapsed);
    if (wasPlaying) play();
  }
  bar.addEventListener("pointerup", endScrub);
  bar.addEventListener("pointercancel", endScrub);
  bar.addEventListener("lostpointercapture", endScrub);
  bar.addEventListener("keydown", (e) => {
    const i = sceneAt(elapsed);
    if (e.key === "ArrowRight") seek(starts[Math.min(scenes.length - 1, i + 1)]);
    else if (e.key === "ArrowLeft") seek(starts[Math.max(0, i - 1)]);
    else if (e.key === "Home") seek(0);
    else if (e.key === "End") seek(total - 1);
    else return;
    e.preventDefault();
  });

  // Start on the first frame, paused, with the song at its first second too
  elapsed = 0;
  if (music.readyState >= 1) music.currentTime = 0;
  else music.addEventListener("loadedmetadata", () => { if (!playing) music.currentTime = 0; }, { once: true });
  // Start on the first frame, paused
  stage.classList.add("paused");
  render();
})();
