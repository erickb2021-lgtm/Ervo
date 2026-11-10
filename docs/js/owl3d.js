// The Classic Ervo owl as a real 3D model, built in code with three.js (a likeness of assets/ervo-classic.png).
// This file is only fetched when the hero is on screen, the visitor has not asked for reduced motion and WebGL works.
// It follows the pointer, spins when dragged (and coasts back to face you), breathes, blinks and hops when tapped.
// The plush coat is drawn as stacked shells: each part is repeated a few times, a little larger each time,
// and only the strands that reach that height are kept.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function shadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.62)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.22)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// A soft studio to light the owl: violet floor glow, pale sky, bright softboxes for the shine in the eyes.
function studio(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const pos = geo.attributes.position, col = [];
  const top = new THREE.Color(0xfbf6ff), mid = new THREE.Color(0xb3a6c8), low = new THREE.Color(0x5a4486), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0) tmp.copy(mid).lerp(top, Math.pow(y, 0.6)); else tmp.copy(mid).lerp(low, Math.pow(-y, 0.5));
    col.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
  const box = (w, h, x, y, z, power) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); scene.add(m);
  };
  box(5, 5, -5, 6, 6, 4);
  box(6, 2, 0, 7, -4, 2.5);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.03).texture;
  pm.dispose(); geo.dispose();
  return tex;
}

const SHELLS = 10;
const NECK = 0.42; // where the head pivots on the shoulders

function furMaterial(length, density) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
  m.onBeforeCompile = (s) => {
    s.uniforms.uFur = { value: length };
    s.uniforms.uDensity = { value: density };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFur;\nuniform float uFur;\nvarying float vShell;\nvarying vec3 vBase;")
      .replace("#include <begin_vertex>", [
        "float sh = float(gl_InstanceID) / " + (SHELLS - 1).toFixed(1) + ";",
        "vShell = sh;",
        "vBase = position;",
        "vec3 transformed = position + objectNormal * (uFur * aFur * sh) + vec3(0.0, -1.0, 0.0) * (uFur * aFur * sh * sh * 0.3);",
      ].join("\n"));
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", [
        "#include <common>",
        "uniform float uDensity;",
        "varying float vShell;",
        "varying vec3 vBase;",
        "float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }",
      ].join("\n"))
      .replace("#include <clipping_planes_fragment>", [
        "#include <clipping_planes_fragment>",
        "if (vShell > 0.001) {",
        "  vec3 q = (vBase + 0.035 * sin(vBase.yzx * 9.0 + 1.7) + 0.02 * sin(vBase.zxy * 23.0)) * uDensity;",
        "  vec3 cell = floor(q);",
        "  float tall = 0.3 + 0.7 * h3(cell);",
        "  vec3 off = (vec3(h3(cell + 7.1), h3(cell + 13.7), h3(cell + 29.3)) - 0.5) * 0.5;",
        "  float d = length(fract(q) - 0.5 - off) * 2.0;",
        "  if (vShell > tall || d > 1.25 * pow(1.0 - vShell / tall, 0.55)) discard;",
        "}",
      ].join("\n"))
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(0.72, 1.05, pow(vShell, 0.7));");
  };
  return m;
}

function buildOwl() {
  const C = (hex) => new THREE.Color(hex);
  const K = {
    body: C(0x7b3fb4), dark: C(0x6a34a0), inner: C(0x4e2380), face: C(0xfff1f7), belly: C(0xb596e2), scallop: C(0xc6aaee),
    blush: C(0xff9dbb), feet: C(0xffb41c),
  };
  const fur = furMaterial(0.032, 60);
  const M = {
    fur,
    eye: new THREE.MeshPhysicalMaterial({ color: 0x120820, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.55 }),
    iris: new THREE.MeshStandardMaterial({ color: 0x3a1f66, roughness: 0.45 }),
    glint: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    beak: new THREE.MeshPhysicalMaterial({ color: 0xffb01a, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.6 }),
  };
  const sphere = new THREE.SphereGeometry(1, 96, 64);
  const midSphere = new THREE.SphereGeometry(1, 40, 28);
  const lowSphere = new THREE.SphereGeometry(1, 24, 16);
  const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

  const matrix = (p, s, r, q) => {
    const quat = q || new THREE.Quaternion().setFromEuler(new THREE.Euler(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0));
    return new THREE.Matrix4().compose(new THREE.Vector3(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0), quat, new THREE.Vector3(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1));
  };
  // A fur part: the shape is baked (so the coat has the same length everywhere), painted per point, then drawn as shells.
  const out = { c: new THREE.Color(), f: 1 };
  const furPart = (parent, geo, mat4, painter, taper) => {
    const g = geo.clone();
    g.applyMatrix4(mat4);
    const pos = g.attributes.position, n = pos.count;
    const col = new Float32Array(n * 3), len = new Float32Array(n), v = new THREE.Vector3();
    if (taper) {
      const nor = g.attributes.normal, a = new THREE.Vector3(), b = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const w = pear(a.fromBufferAttribute(pos, i), b.fromBufferAttribute(nor, i), taper);
        pos.setXYZ(i, w.p.x, w.p.y, w.p.z);
        nor.setXYZ(i, w.n.x, w.n.y, w.n.z);
      }
    }
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      out.f = 1;
      painter(v, out);
      col[i * 3] = out.c.r; col[i * 3 + 1] = out.c.g; col[i * 3 + 2] = out.c.b;
      len[i] = out.f;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aFur", new THREE.BufferAttribute(len, 1));
    const mesh = new THREE.InstancedMesh(g, fur, SHELLS);
    const id = new THREE.Matrix4();
    for (let i = 0; i < SHELLS; i++) mesh.setMatrixAt(i, id);
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  };
  const plain = (parent, geo, mat, p, s) => {
    const m = new THREE.Mesh(geo, mat);
    if (p) m.position.set(p[0], p[1], p[2]);
    if (s) m.scale.set(s[0], s[1], s[2]);
    parent.add(m);
    return m;
  };
  // The pear: a point at height y is pulled in (above the middle) or pushed out (below it); taper = [how much, half height].
  const pear = (p, n, taper) => {
    const s = 1 - taper[0] * p.y / taper[1], ds = -taper[0] / taper[1];
    return {
      p: new THREE.Vector3(p.x * s, p.y, p.z * s),
      n: new THREE.Vector3(n.x / s, n.y - (p.x * n.x + p.z * n.z) * ds / s, n.z / s).normalize(),
    };
  };
  // A point on an ellipsoid (radii a, b, c) in the direction d, and the surface normal there.
  const onSurface = (radii, d) => {
    const v = new THREE.Vector3(d[0], d[1], d[2]).normalize();
    const p = new THREE.Vector3(v.x * radii[0], v.y * radii[1], v.z * radii[2]);
    const n = new THREE.Vector3(p.x / radii[0] ** 2, p.y / radii[1] ** 2, p.z / radii[2] ** 2).normalize();
    return { p, n };
  };
  // A rounded cone for ears and tufts: wide at the base, soft at the tip.
  const bud = (r, h) => {
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      pts.push(new THREE.Vector2(Math.max(0.0001, r * (0.5 * (1 - t) + 0.5 * Math.pow(Math.cos(t * Math.PI / 2), 0.8))), h * t));
    }
    return new THREE.LatheGeometry(pts, 32);
  };

  const turn = new THREE.Group();

  // ---- body ----
  // A pear, not a ball: narrow shoulders that tuck under the head, widest low down.
  const bodyR = [1.16, 1.12, 1.02], bodyT = [0.26, 1.12];
  const body = new THREE.Group();
  turn.add(body);
  const bodyPaint = (v, o) => {
    const ux = v.x / bodyR[0], uy = v.y / bodyR[1];
    const inBelly = v.z > 0 ? 1 - smooth(0.86, 1.04, Math.hypot(ux / 0.68, (uy + 0.22) / 0.8)) : 0;
    o.c.copy(K.body).lerp(K.belly, inBelly);
    // a little shade where the head rests on the shoulders and at the very bottom
    o.c.multiplyScalar(1 - 0.24 * smooth(0.1, 0.62, v.y) - 0.25 * smooth(-0.8, -1.05, v.y));
  };
  furPart(body, sphere, matrix(null, bodyR), bodyPaint, bodyT);
  // The ruff: a soft collar of plush that fills the fold between head and body, so the two read as one animal.
  furPart(body, midSphere, matrix([0, 0.33, -0.02], [1.1, 0.43, 0.95]), bodyPaint);
  // Belly: three rows of scalloped feathers
  [[0.06, [-0.3, 0, 0.3]], [-0.25, [-0.46, -0.153, 0.153, 0.46]], [-0.56, [-0.31, 0, 0.31]]].forEach(([y, xs]) => {
    xs.forEach((x) => {
      const at = onSurface(bodyR, [x, y, 1]);
      const { p, n } = pear(at.p, at.n, bodyT);
      const q = new THREE.Quaternion().setFromUnitVectors(Z, n);
      furPart(body, lowSphere, matrix([p.x, p.y, p.z], [0.235, 0.2, 0.08], null, q), (v, o) => { o.c.copy(K.scallop); o.f = 0.5; });
    });
  });
  // Wings, tail
  const wings = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.92, 0.42, 0.02);
    furPart(pivot, midSphere, matrix([side * 0.2, -0.6, 0], [0.33, 0.76, 0.6], [0, 0, side * 0.2]), (v, o) => {
      o.c.copy(K.dark).multiplyScalar(1 - 0.18 * smooth(-0.9, -1.3, v.y));
    });
    body.add(pivot);
    return pivot;
  });
  furPart(body, lowSphere, matrix([0, -0.5, -0.9], [0.36, 0.28, 0.3]), (v, o) => { o.c.copy(K.dark); });
  // Feet: a pad and three toes each
  [-1, 1].forEach((side) => {
    furPart(turn, lowSphere, matrix([side * 0.43, -1.0, 0.52], [0.3, 0.13, 0.27]), (v, o) => { o.c.copy(K.feet); o.f = 0.3; });
    [-0.18, 0, 0.18].forEach((dx, i) => {
      furPart(turn, lowSphere, matrix([side * 0.43 + dx, -1.0, 0.74 + (i === 1 ? 0.05 : 0)], [0.12, 0.12, 0.2]), (v, o) => { o.c.copy(K.feet); o.f = 0.3; });
    });
  });

  // ---- head: pivots at the neck so it can turn a little further than the body ----
  const head = new THREE.Group();
  head.position.set(0, NECK, 0);
  turn.add(head);
  const headR = [1.33, 1.02, 1.06], headT = [0.07, 1.02];
  const skull = new THREE.Group();
  skull.position.set(0, 0.5, 0.04);
  head.add(skull);
  const eyeAt = [0.37, 0.03];
  furPart(skull, sphere, matrix(null, headR), (v, o) => {
    const ux = v.x / headR[0], uy = v.y / headR[1];
    let face = 0, nearEye = 0, blush = 0;
    if (v.z > 0) {
      const ax = Math.abs(ux);
      face = 1 - smooth(0.94, 1.02, Math.hypot((ax - 0.43) / 0.47, (uy + 0.03) / 0.6));
      nearEye = 1 - smooth(0.26, 0.4, Math.hypot(ax - eyeAt[0], uy - eyeAt[1]));
      blush = 1 - smooth(0.3, 1.0, Math.hypot((ax - 0.68) / 0.19, (uy + 0.33) / 0.12));
    }
    o.c.copy(K.body).lerp(K.face, face).lerp(K.blush, blush * 0.8 * face);
    o.c.multiplyScalar(1 - 0.22 * smooth(-0.55, -0.95, v.y));
    o.f = 1 - 0.62 * face - 0.3 * nearEye;
  }, headT);
  // Ears: a big rounded point with a darker inside, and a smaller tuft beside it
  [-1, 1].forEach((side) => {
    const ear = new THREE.Group();
    ear.position.set(side * 0.8, 0.54, -0.06);
    ear.rotation.z = -side * 0.42;
    furPart(ear, bud(0.5, 0.92), matrix(null, [1, 1, 0.62]), (v, o) => {
      const inner = v.z > 0.05 ? 1 - smooth(0.55, 0.95, Math.hypot(v.x / (0.26 * (1 - v.y / 1.05)), (v.y - 0.42) / 0.5)) : 0;
      o.c.copy(K.body).lerp(K.inner, inner * 0.9);
    });
    skull.add(ear);
    const tuft = new THREE.Group();
    tuft.position.set(side * 1.1, 0.32, -0.08);
    tuft.rotation.z = -side * 1.12;
    furPart(tuft, bud(0.34, 0.5), matrix(null, [1, 1, 0.62]), (v, o) => { o.c.copy(K.body); });
    skull.add(tuft);
  });
  // Eyes and beak
  const eyes = [];
  [-1, 1].forEach((side) => {
    const eyeOn = onSurface(headR, [side * eyeAt[0] * 1.09, eyeAt[1], 1]);
    const { p, n } = pear(eyeOn.p, eyeOn.n, headT);
    const eye = new THREE.Group();
    eye.position.copy(p).addScaledVector(n, 0.03);
    eye.quaternion.setFromUnitVectors(Z, n);
    plain(eye, midSphere, M.iris, [0, 0, -0.02], [0.33, 0.34, 0.1]);
    plain(eye, midSphere, M.eye, null, [0.295, 0.308, 0.16]);
    plain(eye, lowSphere, M.glint, [-0.09, 0.105, 0.132], [0.085, 0.085, 0.022]);
    plain(eye, lowSphere, M.glint, [0.09, -0.09, 0.136], [0.036, 0.036, 0.012]);
    skull.add(eye);
    eyes.push(eye);
  });
  const beak = new THREE.Group();
  const bkOn = onSurface(headR, [0, -0.19, 1]);
  const bk = pear(bkOn.p, bkOn.n, headT);
  beak.position.copy(bk.p).addScaledVector(bk.n, 0.05);
  beak.quaternion.setFromUnitVectors(Y, new THREE.Vector3(0, -0.8, 0.6).normalize());
  plain(beak, new THREE.ConeGeometry(0.2, 0.34, 32), M.beak, [0, 0.03, 0], [1.08, 1, 0.84]);
  plain(beak, lowSphere, M.beak, [0, -0.14, 0], [0.216, 0.1, 0.168]);
  skull.add(beak);

  return { turn, body, head, eyes, wings, materials: M };
}

// The build is split into short steps with a breath between them, so the page never freezes while the owl arrives.
const breath = () => new Promise((done) => setTimeout(done, 0));
export async function mountOwl(host, opts = {}) {
  const coarse = matchMedia("(pointer: coarse)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  // A software renderer (no graphics card, a remote desktop) would draw the owl on the processor and slow the whole
  // page, so those browsers keep the still picture. ?force3d in the address overrides this for testing.
  try {
    const gl = renderer.getContext(), info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) && !/force3d/.test(location.search)) {
      renderer.dispose(); throw new Error("software renderer: " + name);
    }
  } catch (e) { if (/software renderer/.test(String(e && e.message))) throw e; }
  const maxRatio = coarse ? 1.25 : 1.5;
  let ratio = Math.min(window.devicePixelRatio || 1, maxRatio);
  renderer.setPixelRatio(ratio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  const canvas = renderer.domElement;
  canvas.className = "os-canvas";
  canvas.setAttribute("aria-hidden", "true");

  await breath();
  const scene = new THREE.Scene();
  scene.environment = studio(renderer);
  await breath();
  scene.environmentIntensity = 0.75;
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 40);
  camera.position.set(0, 0.8, 8.3);
  camera.lookAt(0, 0.6, 0);

  const key = new THREE.DirectionalLight(0xfff4ea, 2.1); key.position.set(-3.2, 5, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xe2d2ff, 1.6); rim.position.set(4.5, 3, -5); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xc3a6ff, 1.0); rim2.position.set(-5, 1.5, -4); scene.add(rim2);
  const under = new THREE.PointLight(0xb48cff, 6, 9, 1.6); under.position.set(0, -2.3, 2.6); scene.add(under);

  const owl = buildOwl();
  await breath();
  const root = new THREE.Group();
  root.add(owl.turn);
  scene.add(root);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.9 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.13;
  scene.add(shadow);
  let shadowBase = 1;

  // ---- state ----
  let spin = opts.introSpin ?? -1.9, spinV = 0, spinTarget = opts.hold ? spin : 0;
  let yaw = 0, yawV = 0, yawT = 0, pitch = 0, pitchV = 0, pitchT = 0;
  let hopY = 0, hopV = 0, squash = 0, squashV = 0, wing = 0, wingV = 0;
  let grow = opts.introSpin === undefined ? 0.88 : 1, growV = 0;
  let t = 0, last = 0, raf = 0, visible = true, active = true, dragging = false, moved = false, lastX = 0, lastT = 0, pointerSeen = false;
  let nextBlink = 1.6, blinkAt = -1, blinks = 1;
  // Drawing is the costly part. The owl is drawn at up to 60 pictures a second while something moves, and about
  // 30 while it only breathes and sways. If the page still cannot keep up, the picture gets smaller twice, and
  // if that is not enough the still picture takes over.
  let lastDraw = 0, slow = 0, steps = 0, lastStep = 0;
  let ready = false; // nothing is drawn until the shaders are compiled

  function spring(x, v, target, k, c, dt) { const a = -k * (x - target) - c * v; v += a * dt; return [x + v * dt, v]; }

  function frame(now) {
    raf = 0;
    // The first frame after a pause has no earlier frame to measure from: take one normal step.
    const gap = last ? now - last : 16;
    const dt = Math.max(0.001, Math.min(0.05, gap / 1000)); last = now; t += dt;
    if (!dragging) [spin, spinV] = spring(spin, spinV, spinTarget, 34, 9.4, dt);
    if (!pointerSeen && !opts.hold) { yawT = Math.sin(t * 0.7) * 0.2; pitchT = Math.sin(t * 0.53 + 1) * 0.05; }
    [yaw, yawV] = spring(yaw, yawV, yawT, 120, 21, dt);
    [pitch, pitchV] = spring(pitch, pitchV, pitchT, 120, 21, dt);
    [grow, growV] = spring(grow, growV, 1, 60, 11, dt);
    if (hopY > 0 || hopV > 0) {
      hopV -= 19 * dt; hopY += hopV * dt;
      if (hopY <= 0) { squashV = hopV * 0.11; hopY = 0; hopV = 0; }
    }
    [squash, squashV] = spring(squash, squashV, 0, 260, 15, dt);
    [wing, wingV] = spring(wing, wingV, hopY > 0.02 ? 0.8 : 0, 160, 14, dt);

    const facing = Math.max(0, Math.cos(spin));
    const breath = Math.sin(t * 2.1);
    root.position.y = hopY;
    root.scale.setScalar(grow);
    owl.turn.rotation.y = spin + yaw * 0.5 * facing;
    owl.turn.rotation.x = pitch * 0.35 * facing;
    owl.turn.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
    owl.turn.position.y = squash * 1.1;
    owl.body.scale.set(1 + breath * 0.006, 1 + breath * 0.012, 1 + breath * 0.01);
    owl.head.position.y = NECK + breath * 0.012;
    owl.head.rotation.y = yaw * 0.5 * facing;
    owl.head.rotation.x = pitch * 0.65 * facing;
    owl.head.rotation.z = -yaw * 0.12 * facing;
    owl.wings[0].rotation.z = -wing; owl.wings[1].rotation.z = wing;
    if (t > nextBlink && blinkAt < 0) blinkAt = t;
    let lid = 1;
    if (blinkAt >= 0) {
      const p = (t - blinkAt) / 0.15;
      if (p >= 1) { blinkAt = -1; blinks -= 1; if (blinks > 0) nextBlink = t + 0.09; else { blinks = Math.random() < 0.25 ? 2 : 1; nextBlink = t + 2.4 + Math.random() * 3.6; } }
      else lid = 1 - 0.93 * Math.sin(Math.PI * p);
    }
    owl.eyes[0].scale.y = owl.eyes[1].scale.y = lid;
    const lift = clamp(hopY / 1.2, 0, 1);
    shadow.scale.setScalar(1 - lift * 0.35);
    shadow.material.opacity = (0.9 - lift * 0.45) * shadowBase;
    const busy = dragging || hopY > 0 || blinkAt >= 0 || Math.abs(spinV) > 0.01 || Math.abs(spin - spinTarget) > 0.003
      || Math.abs(squash) > 0.002 || Math.abs(wing) > 0.002 || Math.abs(grow - 1) > 0.002
      || Math.abs(yaw - yawT) > 0.01 || Math.abs(pitch - pitchT) > 0.01 || Math.abs(yawV) > 0.05;
    if (now - lastDraw >= (busy ? 15 : 31)) {
      lastDraw = now;
      renderer.render(scene, camera);
      // Long gaps between frames, kept up for about two seconds, mean the page is struggling.
      slow = slow * 0.94 + (gap > 28 ? 0.06 : 0);
      if (slow > 0.5 && now - lastStep > 2500 && t > 2) {
        lastStep = now; slow = 0; steps += 1;
        if (steps === 1) { ratio = Math.min(ratio, 1); renderer.setPixelRatio(ratio); resize(); }
        else if (steps === 2) { ratio = Math.min(ratio, 0.75); renderer.setPixelRatio(ratio); resize(); }
        else { active = false; if (opts.onFail) opts.onFail(); return; }
      }
    }
    if (visible && active && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function wake() { if (ready && !raf && visible && active && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }

  // The canvas reaches past the owl's square (extra room at both sides and above), so spread wings and a hop are
  // never cut off. The view offset keeps the owl exactly where it stood in the square.
  function resize() {
    const side = host.clientWidth || 1, mx = Math.round(side * 0.34), my = Math.round(side * 0.3);
    renderer.setSize(side + 2 * mx, side + my, false);
    canvas.style.left = -mx + "px"; canvas.style.top = -my + "px";
    canvas.style.width = side + 2 * mx + "px"; canvas.style.height = side + my + "px";
    camera.aspect = 1;
    camera.setViewOffset(side, side, -mx, -my, side + 2 * mx, side + my);
    if (ready && !raf) { lastDraw = performance.now(); renderer.render(scene, camera); }
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  const io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; wake(); }, { rootMargin: "80px" }); io.observe(host);
  const onVis = () => wake();
  document.addEventListener("visibilitychange", onVis);

  // The owl looks toward the pointer wherever it is on the page.
  const onMove = (e) => {
    if (e.pointerType === "touch") return;
    pointerSeen = true;
    const r = host.getBoundingClientRect();
    yawT = clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.5), -1, 1) * 0.62;
    pitchT = clamp((e.clientY - (r.top + r.height * 0.4)) / (window.innerHeight * 0.6), -1, 1) * 0.3;
  };
  window.addEventListener("pointermove", onMove, { passive: true });

  function hop() { if (hopY <= 0.001) { hopV = 4.2; squashV = -1.2; wake(); } }
  host.addEventListener("pointerdown", (e) => {
    if (e.button || !active) return;
    dragging = true; moved = false; lastX = e.clientX; lastT = performance.now(); spinV = 0;
    try { host.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    host.classList.add("grabbing");
    wake();
  });
  host.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const now = performance.now(), dx = e.clientX - lastX, dt = Math.max(1, now - lastT) / 1000;
    if (Math.abs(dx) > 3) moved = true;
    const d = dx * 0.0115;
    spin += d;
    spinV = spinV * 0.5 + (d / dt) * 0.5;
    lastX = e.clientX; lastT = now;
  });
  const release = (tap) => {
    if (!dragging) return;
    dragging = false;
    host.classList.remove("grabbing");
    if (tap && !moved) { hop(); if (opts.onTap) opts.onTap(); }
    if (performance.now() - lastT > 90) spinV = 0;
    spinV = clamp(spinV, -22, 22);
    // Coast to where the flick was heading, then settle on the nearest front-facing turn.
    spinTarget = Math.round((spin + spinV * 0.32) / TAU) * TAU;
    if (moved && opts.onSpin) opts.onSpin();
  };
  host.addEventListener("pointerup", () => release(true));
  host.addEventListener("pointercancel", () => release(false));
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); active = false; if (opts.onFail) opts.onFail(); });

  host.appendChild(canvas);
  await breath();
  // Where the browser can, the shaders are compiled in the background before the first picture is drawn.
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* the first draw compiles them instead */ }
  await breath();
  ready = true;
  resize(); // sizes the canvas and draws the first picture
  wake();

  return {
    canvas,
    hop,
    setActive(v) { active = !!v; wake(); },
    setTheme(dark) { shadowBase = dark ? 1 : 0.5; rim.intensity = dark ? 2.0 : 1.3; under.intensity = dark ? 6 : 2.5; wake(); },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      renderer.dispose(); canvas.remove();
    },
  };
}
