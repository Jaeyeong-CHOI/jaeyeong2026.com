/*
 * christmas_tree.py (well, .js) — Christmas 2026 event popup for jaeyeong2026.com
 * A ray-cast ASCII tree rendered into a monospace grid on <canvas>.
 * Shown automatically once per session between 2026-11-13 and 2026-12-31 (KST).
 * Force it anytime with ?xmas
 */
(() => {
  "use strict";

  const START = Date.parse("2026-11-13T00:00:00+09:00");
  const END = Date.parse("2027-01-01T00:00:00+09:00");
  const forced = new URLSearchParams(location.search).has("xmas");
  const nowMs = Date.now();
  if (!forced && (nowMs < START || nowMs >= END)) return;

  const HIDE_KEY = "jy:xmas2026:hide-date";
  const SEEN_KEY = "jy:xmas2026:seen";
  const kstDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const sget = (s, k) => { try { return s.getItem(k); } catch { return null; } };
  const sset = (s, k, v) => { try { s.setItem(k, v); } catch { /* storage blocked */ } };
  const reduceMotion = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ scene */
  const TAU = Math.PI * 2;
  const PITCH = -0.24;          // camera looks slightly down
  const PY = 0.64;              // pivot height
  const Z0 = -6;                // ray origin depth (orthographic)
  const TRUNK_R = 0.09, TRUNK_H = 0.3;
  const STAR_Y = 1.34, STAR_R = 0.085;
  const FLOOR_R = 2.5;
  const LIGHT_R = 0.024, ORN_R = 0.042, STRAND_W = 0.011;

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash2 = (a, b) => {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const wrapPi = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const TIERS = [
    { y0: 0.16, y1: 0.68, r: 0.82, turns: 2.3, nLights: 44, nOrn: 14 },
    { y0: 0.50, y1: 1.00, r: 0.63, turns: 2.0, nLights: 34, nOrn: 10 },
    { y0: 0.83, y1: 1.28, r: 0.44, turns: 1.7, nLights: 26, nOrn: 7 },
  ];
  const GIFT_DEFS = [
    // x, z, w, h, d, body, ribbon
    [0.66, 0.32, 0.30, 0.22, 0.26, "red", "gold"],
    [-0.58, 0.44, 0.25, 0.17, 0.24, "green", "red"],
    [0.12, 0.80, 0.22, 0.14, 0.20, "gold", "red"],
    [-0.32, -0.68, 0.30, 0.20, 0.24, "blue", "silver"],
    [0.58, -0.52, 0.20, 0.27, 0.20, "red", "silver"],
    [-0.86, -0.12, 0.20, 0.12, 0.28, "gold", "green"],
  ];

  const rng = mulberry32(2026);
  const helixTheta = (T, y) => T.off + TAU * T.turns * (y - T.y0) / (T.y1 - T.y0);
  const LIGHT_COLORS = ["warm", "warm", "warm", "warm", "red", "gold", "blue", "silver"];
  const ORN_COLORS = ["red", "gold", "silver", "red", "blue", "gold"];
  let lightCount = 0, ornCount = 0;
  for (const T of TIERS) {
    T.h = T.y1 - T.y0; T.k = T.r / T.h; T.k2 = T.k * T.k; T.off = rng() * TAU;
    T.lights = []; T.orns = [];
    for (let j = 0; j < T.nLights; j++) {
      const y = T.y0 + T.h * (j + 0.5) / T.nLights;
      T.lights.push({ y, th: helixTheta(T, y), ph: rng() * TAU, sp: 1.4 + rng() * 2.8,
        c: LIGHT_COLORS[(rng() * LIGHT_COLORS.length) | 0] });
    }
    for (let j = 0; j < T.nOrn; j++) {
      const u = Math.sqrt(rng());
      const y = T.y1 - T.h * (0.18 + 0.74 * u);
      let th = rng() * TAU;
      // keep baubles off the garland
      const d = wrapPi(th - helixTheta(T, y));
      if (Math.abs(d) < 0.35) th += 0.6;
      T.orns.push({ y, th, c: ORN_COLORS[(j + T.nOrn) % ORN_COLORS.length] });
    }
    lightCount += T.nLights; ornCount += T.nOrn;
  }
  const GIFTS = GIFT_DEFS.map(([x, z, w, h, d, body, rib]) => ({
    x, z, hw: w / 2, hh: h, hd: d / 2, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h, body, rib,
  }));

  // 10-vertex star polygon (unit, pointing up)
  const STAR_POLY = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? 0.42 : 1;
    STAR_POLY.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  const inStar = (u, v) => {
    let inside = false;
    for (let i = 0, j = 9; i < 10; j = i++) {
      const [xi, yi] = STAR_POLY[i], [xj, yj] = STAR_POLY[j];
      if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  /* ---------------------------------------------------------------- palette */
  const BASE = {
    green: [80, 226, 118], red: [255, 88, 88], gold: [255, 206, 84], silver: [216, 228, 242],
    blue: [112, 184, 255], brown: [168, 110, 66], white: [236, 242, 250], warm: [255, 218, 150],
    dim: [150, 162, 182], floor: [104, 118, 140],
  };
  const LV = 16;
  const PAL = {};
  const COLORS = [];
  Object.keys(BASE).forEach((name, i) => {
    PAL[name] = i * LV;
    const [r, g, b] = BASE[name];
    for (let l = 0; l < LV; l++) {
      const f = (l + 1) / LV;
      COLORS.push(`rgb(${(r * f) | 0},${(g * f) | 0},${(b * f) | 0})`);
    }
  });
  const colorId = (name, b) => PAL[name] + clamp((b * LV) | 0, 0, LV - 1);
  const RAMP = ".:-=+xvo*%&#W@";
  const CHAR_CACHE = [];
  const chStr = (code) => CHAR_CACHE[code] || (CHAR_CACHE[code] = String.fromCharCode(code));
  const C = (s) => s.charCodeAt(0);

  /* -------------------------------------------------------------- the code */
  const CODE = [
    "# christmas_tree.py — jaeyeong2026.com holiday build",
    "import numpy as np",
    "from ascii3d import Canvas, Camera, ray_cone, ray_box",
    "",
    "RED, GOLD, GREEN = (1.0, 0.34, 0.34), (1.0, 0.81, 0.33), (0.31, 0.89, 0.46)",
    "TIERS = [(0.16, 0.68, 0.82), (0.50, 1.00, 0.63), (0.83, 1.28, 0.44)]",
    "RAMP = \".:-=+xvo*%&#W@\"",
    "rng = np.random.default_rng(seed=2026)",
    "",
    "def shade(n, light, ambient=0.28):",
    "    return ambient + (1 - ambient) * max(n @ light, 0.0)",
    "",
    "# garland: one helix per tier, 104 bulbs total",
    "lights = []",
    "for (y0, y1, r), n in zip(TIERS, [44, 34, 26]):",
    "    ys = np.linspace(y0, y1, n)",
    "    lights += helix(ys, turns=2.0, phase=rng.random(n) * TAU)",
    "",
    "# ornaments: red / gold / silver baubles, gifts with crossed ribbons",
    "bulbs = scatter(TIERS, k=31, avoid=lights, radius=0.042)",
    "gifts = [box(0.66, 0.32, RED, ribbon=GOLD), box(-0.58, 0.44, GREEN, ribbon=RED)]",
    "",
    "cam = Camera(pitch=-0.24, ortho=True)",
    "canvas = Canvas(font=\"mono\", fps=30)",
    "",
    "while True:",
    "    t = canvas.clock()",
    "    cam.yaw = t * 0.55",
    "    for row, col in canvas.cells():",
    "        o, d = cam.ray(row, col)",
    "        hit = nearest(ray_cone(o, d, *TIERS), ray_box(o, d, gifts), floor)",
    "        if hit is None:",
    "            canvas.put(row, col, snow(t, row, col))",
    "            continue",
    "        b = shade(hit.normal, cam.light)",
    "        ch = RAMP[int(b * (len(RAMP) - 1))]",
    "        canvas.put(row, col, ch, color=hit.color * b)",
    "    twinkle(lights, t)  # sin(t * speed + phase) > 0.25",
    "    canvas.flush()",
    "    if today() == \"12-25\":",
    "        print(\"Merry Christmas & Happy New Year 2027!\")",
  ];
  const KW = new Set("import from as def return for in if else elif while True False None and or not continue break is lambda".split(" "));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const span = (c, s) => `<span class="xt-${c}">${esc(s)}</span>`;
  function highlight(line) {
    const re = /(#.*$)|("[^"]*"|'[^']*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|([\s\S])/g;
    let out = "", m;
    while ((m = re.exec(line))) {
      if (m[1]) out += span("c", m[1]);
      else if (m[2]) out += span("s", m[2]);
      else if (m[3]) out += span("n", m[3]);
      else if (m[4]) {
        const w = m[4], next = line[re.lastIndex];
        if (KW.has(w)) out += span("k", w);
        else if (next === "(") out += span("f", w);
        else if (/^[A-Z][A-Z_0-9]+$/.test(w)) out += span("v", w);
        else out += esc(w);
      } else out += esc(m[5]);
    }
    return out;
  }

  const GREETING = [
    { pre: "$ ", preCls: "xt-p", text: "python3 christmas_tree.py --fps 30" },
    { pre: "", text: `[ok] ${lightCount} lights · ${ornCount} ornaments · ${GIFTS.length} gifts`, cls: "xt-dimln" },
    { pre: ">>> ", preCls: "xt-p", text: "Merry Christmas & Happy New Year 2027!", cls: "xt-hl" },
    { pre: "    ", text: "— Jae Y. Choi", cls: "xt-dimln" },
  ];
  const GREETING_TOTAL = GREETING.reduce((n, l) => n + l.text.length, 0);

  /* -------------------------------------------------------------------- DOM */
  let els = null;
  function build() {
    const root = document.createElement("div");
    root.className = "xt-root";
    root.innerHTML = `
      <div class="xt-backdrop" hidden>
        <section class="xt-window" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="xt-title" aria-describedby="xt-desc">
          <header class="xt-titlebar">
            <div class="xt-lights">
              <button type="button" class="xt-light is-close" data-xt-close aria-label="Close Christmas tree"></button>
              <span class="xt-light is-min" aria-hidden="true"></span>
              <span class="xt-light is-max" aria-hidden="true"></span>
            </div>
            <div class="xt-tabs">
              <span class="xt-tab is-active" id="xt-title">christmas_tree<span class="xt-ext">.py</span></span>
              <span class="xt-tab" aria-hidden="true">snow.glsl</span>
              <span class="xt-tab" aria-hidden="true">README.md</span>
            </div>
            <span class="xt-spacer"></span>
            <button type="button" class="xt-close" data-xt-close>esc ✕</button>
          </header>
          <div class="xt-stage" role="img" aria-label="Animated ASCII Christmas tree with twinkling lights, ornaments, gifts and falling snow">
            <canvas class="xt-canvas" aria-hidden="true"></canvas>
            <div class="xt-hud xt-hud-tl xt-greet" aria-hidden="true"></div>
            <div class="xt-hud xt-hud-tr" aria-hidden="true"></div>
            <div class="xt-hud xt-hud-bl" aria-hidden="true"></div>
            <div class="xt-hud xt-hud-br" aria-hidden="true"></div>
          </div>
          <p id="xt-desc" class="xt-sr">Merry Christmas and Happy New Year 2027 from Jae Y. Choi.</p>
          <div class="xt-editor" aria-hidden="true">
            <div class="xt-editor-head">
              <span>christmas_tree.py</span><span class="xt-spacer"></span>
              <span class="xt-run">running</span><span class="xt-fps">30 fps</span>
            </div>
            <pre class="xt-code"></pre>
          </div>
          <footer class="xt-status">
            <span class="xt-branch">⎇ main</span>
            <span>python 3.13 · utf-8</span>
            <span class="xt-spacer"></span>
            <span class="xt-hint-keys">drag: spin · space: pause · esc: close</span>
            <label><input type="checkbox" class="xt-noshow"> --no-show-today</label>
          </footer>
        </section>
      </div>
      <button type="button" class="xt-launcher" hidden aria-label="Open Christmas tree"><span class="xt-p">$</span> ./christmas_tree.py</button>`;
    document.body.appendChild(root);
    const q = (s) => root.querySelector(s);
    els = {
      root, backdrop: q(".xt-backdrop"), win: q(".xt-window"), stage: q(".xt-stage"), canvas: q(".xt-canvas"),
      greet: q(".xt-hud-tl"), tr: q(".xt-hud-tr"), bl: q(".xt-hud-bl"), br: q(".xt-hud-br"),
      code: q(".xt-code"), run: q(".xt-run"), fps: q(".xt-fps"), noshow: q(".xt-noshow"),
      launcher: q(".xt-launcher"), closeBtn: q(".xt-close"),
    };
    els.code.innerHTML = CODE.map((l, i) => `<span class="xt-ln"><i>${i + 1}</i>${highlight(l) || " "}</span>`).join("");
    els.lines = [...els.code.children];
    els.ctx = els.canvas.getContext("2d", { alpha: true });

    root.querySelectorAll("[data-xt-close]").forEach((b) => b.addEventListener("click", closeTree));
    els.backdrop.addEventListener("pointerdown", (e) => { if (e.target === els.backdrop) closeTree(); });
    els.launcher.addEventListener("click", openTree);
    bindStage();
    new ResizeObserver(() => resize()).observe(els.stage);
  }

  /* ------------------------------------------------------------- rendering */
  const G = { cols: 0, rows: 0, cw: 0, lh: 0, fs: 0, w: 0, h: 0, S: 1, cx: 0, cy: 0, dpr: 1 };
  let chars = new Uint16Array(0), cids = new Int16Array(0), glow = new Uint8Array(0);
  let buckets = [];
  let flakes = [];

  function resize() {
    if (!els) return;
    const w = els.stage.clientWidth, h = els.stage.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fs = clamp(Math.floor(Math.min(h / 50, w / 52)), 6, 12);
    const ctx = els.ctx;
    els.canvas.width = Math.round(w * dpr);
    els.canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${fs}px "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cw = ctx.measureText("M").width || fs * 0.6;
    const lh = fs * 1.12;
    Object.assign(G, {
      w, h, dpr, fs, cw, lh,
      cols: Math.floor(w / cw), rows: Math.floor(h / lh),
      S: Math.min(h * 0.84 / 1.5, w * 0.98 / 2.05),
      cx: w / 2, cy: h * 0.53,
    });
    const n = G.cols * G.rows;
    chars = new Uint16Array(n); cids = new Int16Array(n); glow = new Uint8Array(n);
    buckets = COLORS.map(() => []);
    const fr = mulberry32(25);
    flakes = Array.from({ length: Math.round(n / 70) }, () => ({
      x: fr(), y: fr(), vy: 0.025 + fr() * 0.05, ph: fr() * TAU, front: fr() < 0.12,
      ch: C(fr() < 0.7 ? "." : fr() < 0.6 ? "*" : "+"),
    }));
    draw();
  }

  let t = 0, yaw = 0.9, boost = 0, paused = reduceMotion, letters = 0;

  function draw() {
    if (!els || !G.cols) return;
    const { cols, rows, cw, lh, S, cx, cy } = G;
    const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    const cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const dx = -cp * syw, dy = sp, dz = cp * cyw;
    const idx = 1 / (Math.abs(dx) < 1e-9 ? 1e-9 : dx), idy = 1 / dy, idz = 1 / (Math.abs(dz) < 1e-9 ? 1e-9 : dz);
    // light (camera space) -> world
    let lx = -0.45, ly = 0.66, lz = -0.6;
    { const ln = Math.hypot(lx, ly, lz); lx /= ln; ly /= ln; lz /= ln; }
    const ly1 = ly * cp + lz * sp, lz1 = -ly * sp + lz * cp;
    const Lx = lx * cyw - lz1 * syw, Ly = ly1, Lz = lx * syw + lz1 * cyw;

    // star in screen space
    const starSX = cx, starSY = cy - (STAR_Y - PY) * cp * S;
    const starR = STAR_R * S;
    const starXs = Math.max(0.14, Math.abs(Math.cos(yaw * 1.0)));
    const starCol = Math.floor(starSX / cw), starRow = Math.floor(starSY / lh);
    const rayC = Math.round((starR * 2.6) / cw), rayR = Math.round((starR * 2.0) / lh);
    const tw = t;

    chars.fill(0); cids.fill(-1); glow.fill(0);
    letters = 0;

    for (let r = 0; r < rows; r++) {
      const py = (r + 0.5) * lh;
      const y = (cy - py) / S;
      const y1 = y * cp + Z0 * sp, z1 = -y * sp + Z0 * cp;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const px = (c + 0.5) * cw;

        // --- star (always on top)
        const su = (px - starSX) / (starR * starXs), sv = (starSY - py) / starR;
        if (su > -1.05 && su < 1.05 && sv > -1.05 && sv < 1.05 && inStar(su, sv)) {
          const rho = Math.hypot(su * starXs, sv);
          chars[i] = C(rho < 0.38 ? "@" : rho < 0.7 ? "*" : "+");
          cids[i] = colorId("gold", 0.86 + 0.14 * Math.sin(tw * 3.1));
          glow[i] = 1;
          continue;
        }

        const x = (px - cx) / S;
        const ox = x * cyw - z1 * syw, oy = y1 + PY, oz = x * syw + z1 * cyw;
        let best = Infinity, kind = 0, which = -1, nAxis = 0;

        // --- trunk (cylinder)
        {
          const a = dx * dx + dz * dz, b = 2 * (ox * dx + oz * dz), cc = ox * ox + oz * oz - TRUNK_R * TRUNK_R;
          const disc = b * b - 4 * a * cc;
          if (disc >= 0) {
            const tt = (-b - Math.sqrt(disc)) / (2 * a), yy = oy + tt * dy;
            if (tt > 0 && yy >= 0 && yy <= TRUNK_H && tt < best) { best = tt; kind = 1; }
          }
        }
        // --- foliage tiers (cones)
        for (let k = 0; k < 3; k++) {
          const T = TIERS[k];
          const Y = T.y1 - oy;
          const a = dx * dx + dz * dz - T.k2 * dy * dy;
          const b = 2 * (ox * dx + oz * dz + T.k2 * Y * dy);
          const cc = ox * ox + oz * oz - T.k2 * Y * Y;
          const disc = b * b - 4 * a * cc;
          if (disc < 0) continue;
          const sq = Math.sqrt(disc);
          let tt = (-b - sq) / (2 * a), yy = oy + tt * dy;
          if (!(yy >= T.y0 && yy <= T.y1)) {
            tt = (-b + sq) / (2 * a); yy = oy + tt * dy;
            if (!(yy >= T.y0 && yy <= T.y1)) continue;
          }
          if (tt <= 0 || tt >= best) continue;
          // ragged silhouette + skirt
          const hx = ox + tt * dx, hz = oz + tt * dz;
          const th = Math.atan2(hz, hx);
          const jitter = hash2(((th + Math.PI) * 26) | 0, ((yy * 70) | 0) + k * 991);
          const rr = T.k * (T.y1 - yy);
          let nx = hx, ny = T.k2 * (T.y1 - yy), nz = hz;
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          const facing = -(nx * dx + ny * dy + nz * dz);
          if (facing < 0.16 && jitter < 0.55) continue;
          if (yy - T.y0 < 0.035 && jitter < 0.4) continue;
          if (rr < 0.012 && k < 2) continue;
          best = tt; kind = 2; which = k;
        }
        // --- gifts (boxes)
        for (let g = 0; g < GIFTS.length; g++) {
          const B = GIFTS[g];
          let t1 = (B.x0 - ox) * idx, t2 = (B.x1 - ox) * idx;
          let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), ax = 0;
          t1 = (0 - oy) * idy; t2 = (B.h - oy) * idy;
          let a1 = Math.min(t1, t2), a2 = Math.max(t1, t2);
          if (a1 > tmin) { tmin = a1; ax = 1; }
          if (a2 < tmax) tmax = a2;
          t1 = (B.z0 - oz) * idz; t2 = (B.z1 - oz) * idz;
          a1 = Math.min(t1, t2); a2 = Math.max(t1, t2);
          if (a1 > tmin) { tmin = a1; ax = 2; }
          if (a2 < tmax) tmax = a2;
          if (tmax >= tmin && tmin > 0 && tmin < best) { best = tmin; kind = 3; which = g; nAxis = ax; }
        }

        let ch = 0, cid = -1;
        if (kind === 1) {
          const hx = ox + best * dx, hz = oz + best * dz, hy = oy + best * dy;
          const b = 0.25 + 0.75 * Math.max(0, (hx * Lx + hz * Lz) / TRUNK_R);
          ch = C("|#H|"[(hash2((Math.atan2(hz, hx) * 8) | 0, (hy * 40) | 0) * 4) | 0]);
          cid = colorId("brown", b * 0.85);
        } else if (kind === 2) {
          const T = TIERS[which];
          const hx = ox + best * dx, hy = oy + best * dy, hz = oz + best * dz;
          const th = Math.atan2(hz, hx);
          const rr = T.k * (T.y1 - hy);
          let nx = hx, ny = T.k2 * (T.y1 - hy), nz = hz;
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          const diff = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
          const facing = Math.max(0, -(nx * dx + ny * dy + nz * dz));
          const b = 0.2 + 0.62 * diff + 0.18 * facing;
          // lights
          let hit = null, hd = LIGHT_R * LIGHT_R;
          for (const L of T.lights) {
            const ds = wrapPi(th - L.th) * rr, dv = hy - L.y, d2 = ds * ds + dv * dv;
            if (d2 < hd) { hd = d2; hit = L; }
          }
          if (hit) {
            const v = 0.5 + 0.5 * Math.sin(tw * hit.sp + hit.ph);
            const on = v > 0.25;
            ch = C(v > 0.78 ? "*" : on ? "+" : ".");
            cid = colorId(hit.c, on ? 0.55 + 0.45 * v : 0.3);
            if (v > 0.6) glow[i] = 1;
          } else {
            let orn = null, od = ORN_R * ORN_R;
            for (const O of T.orns) {
              const ds = wrapPi(th - O.th) * rr, dv = (hy - O.y) * 1.1, d2 = ds * ds + dv * dv;
              if (d2 < od) { od = d2; orn = O; }
            }
            if (orn) {
              const q = Math.sqrt(od) / ORN_R;
              ch = C(q < 0.35 ? "@" : q < 0.7 ? "O" : "o");
              cid = colorId(orn.c, clamp(0.45 + 0.55 * b + (q < 0.35 ? 0.2 : 0), 0, 1));
            } else if (Math.abs(wrapPi(th - helixTheta(T, hy)) * rr) < STRAND_W) {
              ch = C("~");
              cid = colorId("gold", 0.35 + 0.4 * b);
            } else {
              const qa = ((th + Math.PI) * 18) | 0, qb = ((hy * 60) | 0) + which * 1000;
              const j = hash2(qa, qb);
              if (j > 0.965 && ny > 0.4) {
                ch = C(j > 0.99 ? "*" : ":");
                cid = colorId("white", 0.45 + 0.4 * b);
              } else {
                const ri = clamp(Math.round(b * (RAMP.length - 1) + (j - 0.5) * 4), 0, RAMP.length - 1);
                ch = RAMP.charCodeAt(ri);
                cid = colorId("green", 0.18 + 0.82 * b);
              }
            }
          }
        } else if (kind === 3) {
          const B = GIFTS[which];
          const hx = ox + best * dx, hy = oy + best * dy, hz = oz + best * dz;
          const lxp = hx - B.x, lzp = hz - B.z;
          let nx = 0, ny = 0, nz = 0;
          if (nAxis === 0) nx = dx > 0 ? -1 : 1;
          else if (nAxis === 1) ny = 1;
          else nz = dz > 0 ? -1 : 1;
          const b = 0.3 + 0.7 * Math.max(0, nx * Lx + ny * Ly + nz * Lz);
          const rw = 0.022;
          let ribbon = false, bow = false;
          if (nAxis === 1) {
            ribbon = Math.abs(lxp) < rw || Math.abs(lzp) < rw;
            bow = Math.abs(lxp) < rw * 2.4 && Math.abs(lzp) < rw * 2.4;
          } else if (nAxis === 0) ribbon = Math.abs(lzp) < rw;
          else ribbon = Math.abs(lxp) < rw;
          if (bow) { ch = C("&"); cid = colorId(B.rib, 1); }
          else if (ribbon) { ch = C(nAxis === 1 ? "+" : "|"); cid = colorId(B.rib, 0.5 + 0.5 * b); }
          else {
            ch = C(nAxis === 1 ? "=" : (hash2((lxp * 50 + lzp * 50) | 0, (hy * 50) | 0) < 0.5 ? "#" : "%"));
            cid = colorId(B.body, 0.3 + 0.7 * b);
          }
        }

        // --- floor (static, pitch-only frame)
        if (kind === 0 && sp < 0) {
          const ft = -(y1 + PY) / sp;
          if (ft > 0) {
            const fx = x, fz = z1 + ft * cp;
            const dist = Math.hypot(fx, fz);
            if (dist < FLOOR_R) {
              const hv = hash2(Math.round(fx * 15), Math.round(fz * 15));
              const fade = 1 - dist / FLOOR_R;
              const shadow = 0.55 + 0.45 * clamp((dist - 0.25) / 0.8, 0, 1);
              if (hv < 0.42) {
                ch = C(hv < 0.03 ? "*" : hv < 0.1 ? ":" : ".");
                cid = colorId(hv < 0.03 ? "white" : "floor", (0.2 + 0.55 * fade) * shadow);
                kind = 4;
              }
            }
          }
        }

        if (kind === 0) {
          // star glints around the tree topper
          if ((r === starRow && Math.abs(c - starCol) <= rayC) || (c === starCol && Math.abs(r - starRow) <= rayR)) {
            const far = r === starRow ? Math.abs(c - starCol) / rayC : Math.abs(r - starRow) / rayR;
            const v = 0.5 + 0.5 * Math.sin(tw * 4 + far * 6);
            ch = C(r === starRow ? "-" : "|");
            cid = colorId("gold", (1 - far) * (0.35 + 0.4 * v));
          } else {
            const hs = hash2(c * 7 + 1, r * 13 + 5);
            if (hs < 0.011) {
              const v = 0.5 + 0.5 * Math.sin(tw * 1.7 + hs * 900);
              ch = C(hs < 0.0035 ? "+" : ".");
              cid = colorId("dim", 0.18 + 0.4 * v);
            }
          }
        }

        if (ch) { chars[i] = ch; cids[i] = cid; }
      }
    }

    // --- snow
    for (const f of flakes) {
      const c = Math.floor(f.x * cols), r = Math.floor(f.y * rows);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const i = r * cols + c;
      if (f.front || cids[i] < 0 || cids[i] >= PAL.floor) {
        chars[i] = f.ch;
        cids[i] = colorId("white", f.front ? 0.8 : 0.45 + 0.25 * Math.sin(f.ph));
      }
    }

    // --- paint
    const ctx = els.ctx;
    ctx.clearRect(0, 0, G.w, G.h);
    for (const b of buckets) b.length = 0;
    const glowList = [];
    const n = cols * rows;
    for (let i = 0; i < n; i++) {
      if (cids[i] < 0) continue;
      letters++;
      if (glow[i]) glowList.push(i); else buckets[cids[i]].push(i);
    }
    for (let id = 0; id < buckets.length; id++) {
      const list = buckets[id];
      if (!list.length) continue;
      ctx.fillStyle = COLORS[id];
      for (const i of list) {
        const r = (i / cols) | 0, c = i - r * cols;
        ctx.fillText(chStr(chars[i]), (c + 0.5) * cw, (r + 0.5) * lh);
      }
    }
    if (glowList.length) {
      ctx.save();
      ctx.shadowBlur = G.fs * 0.9;
      for (const i of glowList) {
        const r = (i / cols) | 0, c = i - r * cols;
        ctx.fillStyle = COLORS[cids[i]];
        ctx.shadowColor = COLORS[cids[i]];
        ctx.fillText(chStr(chars[i]), (c + 0.5) * cw, (r + 0.5) * lh);
      }
      ctx.restore();
    }
  }

  /* --------------------------------------------------------------- loop/HUD */
  let raf = 0, last = 0, openedAt = 0, fpsAvg = 30, codeLine = -1, codeTimer = 0, greetShown = -1;
  const loopStart = CODE.indexOf("while True:");

  function stepCode(dt) {
    if (reduceMotion) { if (codeLine < 0) setCodeLine(loopStart); return; }
    codeTimer -= dt;
    if (codeTimer > 0) return;
    let next = codeLine + 1;
    while (next < CODE.length && !CODE[next].trim()) next++;
    if (next >= CODE.length) next = loopStart + 1;
    setCodeLine(next);
    codeTimer = next > loopStart ? 0.16 : 0.24;
  }
  function setCodeLine(n) {
    if (codeLine >= 0) els.lines[codeLine]?.classList.remove("is-cur");
    codeLine = n;
    const el = els.lines[n];
    if (!el) return;
    el.classList.add("is-cur");
    els.code.scrollTop = el.offsetTop - els.code.clientHeight / 2 + el.offsetHeight / 2;
  }
  function renderGreeting(now) {
    const shown = reduceMotion ? GREETING_TOTAL : clamp(Math.floor((now - openedAt - 500) / 1000 * 34), 0, GREETING_TOTAL);
    if (shown === greetShown) return;
    greetShown = shown;
    let left = shown, html = "";
    for (const line of GREETING) {
      if (left <= 0 && html) break;
      const part = line.text.slice(0, Math.max(0, left));
      left -= line.text.length;
      let body = esc(part);
      if (line.cls === "xt-hl") body = body.replace("Merry Christmas", "<b>Merry Christmas</b>");
      html += `<div class="${line.cls || ""}">${line.pre ? `<span class="${line.preCls || ""}">${esc(line.pre)}</span>` : ""}${body}${left < 0 || (left === 0 && shown === GREETING_TOTAL) ? '<span class="xt-cursor"></span>' : ""}</div>`;
      if (left < 0) break;
    }
    els.greet.innerHTML = html;
  }
  function hud() {
    const deg = (((yaw * 180) / Math.PI) % 360 + 360) % 360;
    els.tr.textContent = `t ${t.toFixed(2)}s`;
    els.bl.textContent = `@jaeyeong2026.ascii\nrotation ${deg.toFixed(2)}°   lights ${lightCount}\nletters ${letters.toLocaleString("en-US")}`;
    els.br.textContent = `${G.cols}×${G.rows} cells`;
    els.run.textContent = paused ? "paused" : "running";
    els.run.classList.toggle("is-paused", paused);
    els.fps.textContent = `${Math.round(fpsAvg)} fps`;
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const elapsed = now - last;
    if (elapsed < 1000 / 30 - 3) return;
    const dt = Math.min(elapsed / 1000, 0.1);
    last = now;
    fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.1;
    if (!paused) {
      t += dt;
      yaw += (0.55 + boost) * dt;
      for (const f of flakes) {
        f.y += f.vy * dt; f.x += Math.sin(t * 0.8 + f.ph) * 0.004 * dt;
        if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
      }
      stepCode(dt);
    } else {
      yaw += boost * dt;
    }
    boost *= Math.exp(-dt * 1.6);
    draw();
    renderGreeting(now);
    hud();
  }

  /* ----------------------------------------------------------- interaction */
  function bindStage() {
    let dragging = false, lastX = 0;
    els.stage.addEventListener("pointerdown", (e) => {
      dragging = true; lastX = e.clientX;
      els.stage.setPointerCapture?.(e.pointerId);
    });
    els.stage.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const d = e.clientX - lastX; lastX = e.clientX;
      yaw += d * 0.012;
      boost = clamp(boost * 0.5 + d * 0.25, -7, 7);
    });
    const end = () => { dragging = false; };
    els.stage.addEventListener("pointerup", end);
    els.stage.addEventListener("pointercancel", end);
  }

  let prevFocus = null, prevOverflow = "";
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); closeTree(); return; }
    const tag = (e.target?.tagName || "").toLowerCase();
    if (e.key === " " && tag !== "button" && tag !== "input") { e.preventDefault(); paused = !paused; return; }
    if (e.key === "ArrowLeft") { boost = clamp(boost - 1.5, -7, 7); return; }
    if (e.key === "ArrowRight") { boost = clamp(boost + 1.5, -7, 7); return; }
    if (e.key === "Tab") {
      const f = [...els.win.querySelectorAll("button, input")].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], lastEl = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
    }
  }

  function openTree() {
    if (!els) build();
    if (!els.backdrop.hidden) return;
    prevFocus = document.activeElement;
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    els.backdrop.hidden = false;
    els.launcher.hidden = true;
    openedAt = performance.now();
    greetShown = -1;
    resize();
    document.addEventListener("keydown", onKey, true);
    els.win.focus({ preventScroll: true });
    last = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function closeTree() {
    if (!els || els.backdrop.hidden) return;
    els.backdrop.hidden = true;
    els.launcher.hidden = false;
    document.documentElement.style.overflow = prevOverflow;
    document.removeEventListener("keydown", onKey, true);
    cancelAnimationFrame(raf);
    sset(sessionStorage, SEEN_KEY, "1");
    if (els.noshow.checked) sset(localStorage, HIDE_KEY, kstDay());
    if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus({ preventScroll: true });
  }

  function init() {
    const hiddenToday = sget(localStorage, HIDE_KEY) === kstDay();
    const seen = sget(sessionStorage, SEEN_KEY) === "1";
    build();
    if (forced || (!hiddenToday && !seen)) setTimeout(openTree, forced ? 0 : 900);
    else els.launcher.hidden = false;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
