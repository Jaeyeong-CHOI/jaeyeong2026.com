/*
 * Christmas 2026 event popup for jaeyeong2026.com
 * A ray-cast ASCII tree rendered into a monospace grid on <canvas>, on a plain black panel.
 * Shown automatically once per session between 2026-11-13 and 2026-12-25 (KST); off from Dec 26.
 * Force it anytime with ?xmas
 */
(() => {
  "use strict";

  const START = Date.parse("2026-11-13T00:00:00+09:00");
  const END = Date.parse("2026-12-26T00:00:00+09:00");
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
  const PITCH = -0.22;          // camera looks slightly down
  const PY = 0.76;              // pivot height
  const Z0 = -6;                // ray origin depth (orthographic)
  const TRUNK_R = 0.07, TRUNK_H = 0.36;
  const STAR_Y = 1.54;
  const FLOOR_R = 1.55;
  const LIGHT_R = 0.021, ORN_R = 0.04;

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

  // four overlapping cones, widest at the bottom
  const TIERS = [
    { y0: 0.30, y1: 0.76, r: 0.80, turns: 2.25, nLights: 34, nOrn: 10, scallop: 20 },
    { y0: 0.58, y1: 1.01, r: 0.63, turns: 2.0, nLights: 26, nOrn: 8, scallop: 16 },
    { y0: 0.85, y1: 1.24, r: 0.47, turns: 1.75, nLights: 19, nOrn: 5, scallop: 12 },
    { y0: 1.10, y1: 1.46, r: 0.31, turns: 1.5, nLights: 12, nOrn: 3, scallop: 9 },
  ];
  const NT = TIERS.length;
  const GIFT_DEFS = [
    // x, z, w, h, d, body, ribbon
    [0.50, 0.20, 0.24, 0.19, 0.22, "red", "gold"],
    [-0.46, 0.30, 0.22, 0.14, 0.22, "white", "red"],
    [0.02, 0.58, 0.18, 0.11, 0.18, "gold", "red"],
    [-0.20, -0.54, 0.22, 0.16, 0.20, "red", "white"],
  ];

  const rng = mulberry32(2026);
  const helixTheta = (T, y) => T.off + TAU * T.turns * (y - T.y0) / (T.y1 - T.y0);
  const LIGHT_COLORS = ["warm", "warm", "warm", "warm", "warm", "gold", "red"];
  const ORN_COLORS = ["red", "gold", "white"];
  let ornIdx = 0;
  for (const T of TIERS) {
    T.h = T.y1 - T.y0; T.k = T.r / T.h; T.k2 = T.k * T.k; T.off = rng() * TAU;
    T.lights = []; T.orns = [];
    for (let j = 0; j < T.nLights; j++) {
      const y = T.y0 + T.h * (0.06 + 0.88 * (j + 0.5) / T.nLights);
      T.lights.push({ y, th: helixTheta(T, y), ph: rng() * TAU, sp: 1.2 + rng() * 2.2,
        c: LIGHT_COLORS[(rng() * LIGHT_COLORS.length) | 0] });
    }
    // baubles sit halfway between garland turns so they never collide with bulbs
    for (let j = 0; j < T.nOrn; j++) {
      const y = T.y0 + T.h * (0.14 + 0.5 * ((j * 0.618034) % 1));
      const th = helixTheta(T, y) + Math.PI + (j / T.nOrn) * TAU;
      T.orns.push({ y, th, c: ORN_COLORS[ornIdx++ % ORN_COLORS.length] });
    }
  }
  const GIFTS = GIFT_DEFS.map(([x, z, w, h, d, body, rib]) => ({
    x, z, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h, body, rib,
  }));

  // tree topper: a small sparkle drawn as a fixed glyph sprite
  const STAR_SPRITE = ["    |    ", "  \\ | /  ", "---=@=---", "  / | \\  "];
  const STAR_MID_ROW = 2, STAR_MID_COL = 4;

  /* ---------------------------------------------------------------- palette */
  const BASE = {
    green: [74, 214, 122], red: [255, 92, 92], gold: [255, 208, 96], white: [238, 243, 250],
    warm: [255, 226, 168], brown: [178, 124, 84], floor: [120, 136, 158],
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
  const RAMP = ".:-=xX%#@";
  const CHAR_CACHE = [];
  const chStr = (code) => CHAR_CACHE[code] || (CHAR_CACHE[code] = String.fromCharCode(code));
  const C = (s) => s.charCodeAt(0);

  /* -------------------------------------------------------------------- DOM */
  let els = null;
  function build() {
    const root = document.createElement("div");
    root.className = "xt-root";
    root.innerHTML = `
      <div class="xt-backdrop" hidden>
        <section class="xt-window" tabindex="-1" role="dialog" aria-modal="true" aria-label="Christmas tree">
          <button type="button" class="xt-close" data-xt-close>Close</button>
          <div class="xt-stage" role="img" aria-label="Rotating ASCII Christmas tree with twinkling lights, ornaments, gifts and falling snow">
            <canvas class="xt-canvas" aria-hidden="true"></canvas>
          </div>
          <footer class="xt-foot">
            <label class="xt-noshow-label"><input type="checkbox" class="xt-noshow"> Don’t show again today</label>
          </footer>
        </section>
      </div>
      <button type="button" class="xt-launcher" hidden><span class="xt-launcher-mark" aria-hidden="true">*</span>Christmas tree</button>`;
    document.body.appendChild(root);
    const q = (s) => root.querySelector(s);
    els = {
      root, backdrop: q(".xt-backdrop"), win: q(".xt-window"), stage: q(".xt-stage"), canvas: q(".xt-canvas"),
      noshow: q(".xt-noshow"), launcher: q(".xt-launcher"),
    };
    els.ctx = els.canvas.getContext("2d", { alpha: true });

    root.querySelectorAll("[data-xt-close]").forEach((b) => b.addEventListener("click", closeTree));
    els.backdrop.addEventListener("pointerdown", (e) => { if (e.target === els.backdrop) closeTree(); });
    els.launcher.addEventListener("click", openTree);
    bindStage();
    new ResizeObserver(() => resize()).observe(els.stage);
  }

  /* ------------------------------------------------------------- rendering */
  const G = { cols: 0, rows: 0, cw: 0, lh: 0, fs: 0, w: 0, h: 0, S: 1, cx: 0, cy: 0 };
  let chars = new Uint16Array(0), cids = new Int16Array(0), glow = new Uint8Array(0);
  let buckets = [];
  let flakes = [];

  function resize() {
    if (!els) return;
    const w = els.stage.clientWidth, h = els.stage.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fs = clamp(Math.floor(Math.min(h / 56, w / 50)), 6, 11);
    const ctx = els.ctx;
    els.canvas.width = Math.round(w * dpr);
    els.canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${fs}px "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cw = ctx.measureText("M").width || fs * 0.6;
    const lh = fs * 1.1;
    const S = Math.min(h * 0.86 / 1.78, w * 0.94 / 1.75);
    Object.assign(G, {
      w, h, fs, cw, lh, S,
      cols: Math.floor(w / cw), rows: Math.floor(h / lh),
      cx: w / 2, cy: h / 2 - 0.02 * S,
    });
    const n = G.cols * G.rows;
    chars = new Uint16Array(n); cids = new Int16Array(n); glow = new Uint8Array(n);
    buckets = COLORS.map(() => []);
    const fr = mulberry32(25);
    flakes = Array.from({ length: Math.round(n / 120) }, () => ({
      x: fr(), y: fr(), vy: 0.022 + fr() * 0.04, ph: fr() * TAU, front: fr() < 0.08,
      ch: C(fr() < 0.82 ? "." : "*"), b: 0.3 + fr() * 0.4,
    }));
    draw();
  }

  let t = 0, yaw = 0.9, boost = 0, paused = reduceMotion;

  function draw() {
    if (!els || !G.cols) return;
    const { cols, rows, cw, lh, S, cx, cy } = G;
    const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    const cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const dx = -cp * syw, dy = sp, dz = cp * cyw;
    const idx = 1 / (Math.abs(dx) < 1e-9 ? 1e-9 : dx), idy = 1 / dy, idz = 1 / (Math.abs(dz) < 1e-9 ? 1e-9 : dz);
    // key light fixed to the camera (upper left, in front), expressed in world space
    let lx = -0.5, ly = 0.62, lz = -0.6;
    { const ln = Math.hypot(lx, ly, lz); lx /= ln; ly /= ln; lz /= ln; }
    const ly1 = ly * cp + lz * sp, lz1 = -ly * sp + lz * cp;
    const Lx = lx * cyw - lz1 * syw, Ly = ly1, Lz = lx * syw + lz1 * cyw;

    // star topper position on the character grid
    const starCol = Math.floor(cx / cw), starRow = Math.floor((cy - (STAR_Y - PY) * cp * S) / lh);
    const starTop = starRow - STAR_MID_ROW, starLeft = starCol - STAR_MID_COL;
    const starPulse = 0.5 + 0.5 * Math.sin(t * 2.4);

    chars.fill(0); cids.fill(-1); glow.fill(0);

    for (let r = 0; r < rows; r++) {
      const py = (r + 0.5) * lh;
      const y = (cy - py) / S;
      const y1 = y * cp + Z0 * sp, z1 = -y * sp + Z0 * cp;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const px = (c + 0.5) * cw;

        // --- star (always on top)
        const sr = r - starTop, sc = c - starLeft;
        if (sr >= 0 && sr < STAR_SPRITE.length && sc >= 0 && sc < 9) {
          const g = STAR_SPRITE[sr].charCodeAt(sc);
          if (g !== 32) {
            const far = Math.max(Math.abs(sc - STAR_MID_COL) / 4, Math.abs(sr - STAR_MID_ROW) / 2);
            chars[i] = g;
            cids[i] = colorId("gold", far < 0.3 ? 1 : (1 - 0.55 * far) * (0.7 + 0.3 * starPulse));
            if (far < 0.6) glow[i] = 1;
            continue;
          }
        }

        const x = (px - cx) / S;
        if (x < -1.7 || x > 1.7) continue;
        const ox = x * cyw - z1 * syw, oy = y1 + PY, oz = x * syw + z1 * cyw;
        let best = Infinity, kind = 0, which = -1, nAxis = 0, hitTh = 0;

        // --- trunk (cylinder)
        {
          const a = dx * dx + dz * dz, b = 2 * (ox * dx + oz * dz), cc = ox * ox + oz * oz - TRUNK_R * TRUNK_R;
          const disc = b * b - 4 * a * cc;
          if (disc >= 0) {
            const tt = (-b - Math.sqrt(disc)) / (2 * a), yy = oy + tt * dy;
            if (tt > 0 && yy >= 0 && yy <= TRUNK_H && tt < best) { best = tt; kind = 1; }
          }
        }
        // --- foliage tiers (stacked cones)
        for (let k = 0; k < NT; k++) {
          const T = TIERS[k];
          const Y = T.y1 - oy;
          const a = dx * dx + dz * dz - T.k2 * dy * dy;
          const b = 2 * (ox * dx + oz * dz + T.k2 * Y * dy);
          const cc = ox * ox + oz * oz - T.k2 * Y * Y;
          const disc = b * b - 4 * a * cc;
          if (disc < 0) continue;
          const tt = (-b - Math.sqrt(disc)) / (2 * a), yy = oy + tt * dy;
          if (!(yy >= T.y0 && yy <= T.y1) || tt <= 0 || tt >= best) continue;
          const th = Math.atan2(oz + tt * dz, ox + tt * dx);
          best = tt; kind = 2; which = k; hitTh = th;
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
          const hx = ox + best * dx, hz = oz + best * dz;
          const b = 0.3 + 0.7 * Math.max(0, (hx * Lx + hz * Lz) / TRUNK_R);
          ch = C("#");
          cid = colorId("brown", b);
        } else if (kind === 2) {
          const T = TIERS[which];
          const hx = ox + best * dx, hy = oy + best * dy, hz = oz + best * dz;
          const th = hitTh;
          const rr = T.k * (T.y1 - hy);
          let nx = hx, ny = T.k2 * (T.y1 - hy), nz = hz;
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          const diff = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
          const facing = Math.max(0, -(nx * dx + ny * dy + nz * dz));
          let b = 0.14 + 0.68 * diff + 0.18 * facing;
          // shadow under the tier above, brighter branch tips at the hem
          if (which < NT - 1) b *= 0.5 + 0.5 * clamp((TIERS[which + 1].y0 - hy) / 0.11, 0, 1);
          b += 0.16 * clamp(1 - (hy - T.y0) / 0.06, 0, 1) * (0.55 + 0.45 * Math.cos(th * T.scallop));
          // soft branch texture that turns with the tree
          b += 0.07 * (Math.sin(th * T.scallop * 0.5 + hy * 30) + Math.sin(th * 5 - hy * 44 + which * 2));
          b = clamp(b, 0, 1);

          let hit = null, hd = LIGHT_R * LIGHT_R;
          for (const L of T.lights) {
            const ds = wrapPi(th - L.th) * rr, dv = hy - L.y, d2 = ds * ds + dv * dv;
            if (d2 < hd) { hd = d2; hit = L; }
          }
          if (hit) {
            const v = 0.5 + 0.5 * Math.sin(t * hit.sp + hit.ph);
            ch = C(v > 0.4 ? "*" : "+");
            cid = colorId(hit.c, 0.4 + 0.6 * v);
            if (v > 0.5) glow[i] = 1;
          } else {
            let orn = null, od = ORN_R * ORN_R;
            for (const O of T.orns) {
              const ds = wrapPi(th - O.th) * rr, dv = (hy - O.y) * 1.15, d2 = ds * ds + dv * dv;
              if (d2 < od) { od = d2; orn = O; }
            }
            if (orn) {
              const q = Math.sqrt(od) / ORN_R;
              ch = C(q < 0.55 ? "@" : "o");
              cid = colorId(orn.c, clamp(0.5 + 0.5 * b + (q < 0.55 ? 0.15 : 0), 0, 1));
            } else {
              const ri = clamp(Math.round(b * (RAMP.length - 1)), 0, RAMP.length - 1);
              ch = RAMP.charCodeAt(ri);
              cid = colorId("green", 0.2 + 0.8 * b);
            }
          }
        } else if (kind === 3) {
          const B = GIFTS[which];
          const hx = ox + best * dx, hz = oz + best * dz;
          const lxp = hx - B.x, lzp = hz - B.z;
          let nx = 0, ny = 0, nz = 0;
          if (nAxis === 0) nx = dx > 0 ? -1 : 1;
          else if (nAxis === 1) ny = 1;
          else nz = dz > 0 ? -1 : 1;
          const b = 0.34 + 0.66 * Math.max(0, nx * Lx + ny * Ly + nz * Lz);
          const rw = 0.62 * cw / S;
          let ribbon = false, bow = false;
          if (nAxis === 1) {
            ribbon = Math.abs(lxp) < rw || Math.abs(lzp) < rw;
            bow = Math.abs(lxp) < rw * 1.8 && Math.abs(lzp) < rw * 1.8;
          } else if (nAxis === 0) ribbon = Math.abs(lzp) < rw;
          else ribbon = Math.abs(lxp) < rw;
          if (bow) { ch = C("@"); cid = colorId(B.rib, 1); }
          else if (ribbon) { ch = C(nAxis === 1 ? "+" : "|"); cid = colorId(B.rib, 0.55 + 0.45 * b); }
          else { ch = C(nAxis === 1 ? "=" : "#"); cid = colorId(B.body, (B.body === "white" ? 0.22 : 0.3) + 0.6 * b); }
        }

        // --- snowy ground: sparse dots fading out from the tree
        if (kind === 0 && sp < 0) {
          const ft = -(y1 + PY) / sp;
          if (ft > 0) {
            const dist = Math.hypot(x, z1 + ft * cp);
            if (dist < FLOOR_R) {
              const fade = 1 - dist / FLOOR_R;
              if (hash2(c * 3 + 11, r * 17 + 3) < 0.3 * fade) {
                ch = C(".");
                cid = colorId("floor", 0.2 + 0.5 * fade);
                kind = 4;
              }
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
        cids[i] = colorId("white", f.front ? 0.85 : f.b);
        glow[i] = 0;
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
      ctx.shadowBlur = G.fs * 1.1;
      for (const i of glowList) {
        const r = (i / cols) | 0, c = i - r * cols;
        ctx.fillStyle = COLORS[cids[i]];
        ctx.shadowColor = COLORS[cids[i]];
        ctx.fillText(chStr(chars[i]), (c + 0.5) * cw, (r + 0.5) * lh);
      }
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------- loop */
  let raf = 0, last = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const elapsed = now - last;
    if (elapsed < 1000 / 30 - 3) return;
    const dt = Math.min(elapsed / 1000, 0.1);
    last = now;
    if (!paused) {
      t += dt;
      yaw += (0.45 + boost) * dt;
      for (const f of flakes) {
        f.y += f.vy * dt; f.x += Math.sin(t * 0.8 + f.ph) * 0.004 * dt;
        if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
      }
    } else {
      yaw += boost * dt;
    }
    boost *= Math.exp(-dt * 1.6);
    draw();
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
      if (e.shiftKey && (document.activeElement === first || document.activeElement === els.win)) { e.preventDefault(); lastEl.focus(); }
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
