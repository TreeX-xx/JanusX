// A drifting particle field gathers into the capsule once, then idles with brief eye gestures. Scroll expands the card into the real workspace.
(() => {
  'use strict';
  const hero = document.getElementById('hero');
  const stage = document.getElementById('zoom-stage');
  const canvas = document.getElementById('hero-particles');
  const workspace = hero?.querySelector('.hero-workspace');
  const scene = hero?.querySelector('.hero-scene');
  const preview = document.getElementById('workspace-preview');
  const controls = hero?.querySelector('.workspace-controls');
  const caption = document.getElementById('workspace-caption');
  const views = {
    overview: ['JanusX 黑色工作区：四个 CLI 终端与 CPA 管理页、Markdown 文档预览组成六个分区', '终端与工具独立分屏，让执行、账号管理与文档阅读并排展开。'],
    terminals: ['Claude、Codex、OpenCode 与 Pi 在黑色工作区中组成四格终端分屏', '四个 CLI，各自保留上下文。拖动标签拆分，按任务调整比例。'],
    cpa: ['四终端旁嵌入真实的黑色 CPA 管理页，展示本地空实例', 'Janus 工具箱内嵌 CPA。这里展示本地空实例，未添加账号或发起请求。'],
    documents: ['四终端旁嵌入 Markdown 源码编辑与发布清单预览', 'Markdown 编辑与预览并排，发布清单和笔记始终在手边。']
  };
  if (workspace && preview && controls && caption) {
    workspace.inert = false;
    workspace.setAttribute('aria-hidden', 'false');
    controls.hidden = false;
    let selection = 0;
    controls.addEventListener('click', async event => {
      const button = event.target.closest('[data-workspace]');
      const name = button?.dataset.workspace;
      if (!views[name]) return;
      const current = ++selection;
      const src = `assets/workspace/${name}.png`;
      const next = new Image();
      next.src = src;
      workspace.setAttribute('aria-busy', 'true');
      try {
        await next.decode();
        if (current !== selection) return;
        preview.src = src;
        preview.alt = views[name][0];
        caption.textContent = views[name][1];
        workspace.querySelectorAll('.workspace-image, .workspace-original').forEach(link => { link.href = src; });
        controls.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      } catch {
        if (current === selection) caption.textContent = '这张预览暂时无法加载，请重试或查看原图。';
      } finally {
        if (current === selection) workspace.removeAttribute('aria-busy');
      }
    });
  }
  const context = canvas?.getContext('2d');
  if (!hero || !stage || !context || !workspace) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-width: 855px), (max-height: 768px)');
  const mouse = matchMedia('(hover: hover) and (pointer: fine)');
  const mask = document.createElement('canvas');
  mask.width = 520;
  mask.height = 300;
  const ink = mask.getContext('2d', { willReadFrequently: true });
  if (!ink) return;
  ink.strokeStyle = 'rgba(255,255,255,.65)';
  ink.lineWidth = 7;
  ink.beginPath();
  ink.roundRect(65, 55, 390, 190, 95);
  ink.stroke();
  ink.fillStyle = '#fff';
  for (const x of [201, 287]) {
    ink.beginPath();
    ink.roundRect(x, 109, 32, 82, 16);
    ink.fill();
  }
  const pixels = ink.getImageData(0, 0, 520, 300).data;
  // Entrance choreography (ms): a warm-corner wave reveals a drifting dust
  // field across the whole card, then gathers it along swirl arcs into the
  // capsule; the eyes arrive last in their closed-lid shape and wake open.
  const REVEAL_SPAN = 220, REVEAL_DUR = 320, REVEAL_JITTER = 120;
  const GATHER_START = 560, GATHER_SPAN = 520, GATHER_JITTER = 80;
  const FLY_BASE = 480, FLY_DIST = .42, FLY_DIST_CAP = 850, FLY_JITTER = 110;
  const EYE_DELAY = 1560, EYE_JITTER = 100, EYE_DUR = 480, EYE_DUR_JITTER = 50;
  const WAKE_AT = 2220, WAKE_DUR = 520, SETTLE_AT = 2800;
  let rng = 0x2f6e2b1;
  const rand = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  // Low-discrepancy scatter keeps the opening field evenly spread over the card.
  const halton = (index, base) => {
    let f = 1, r = 0, i = index;
    while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
    return r;
  };
  // Figure-space window onto the card; shared with measure() so the field and
  // the drawn figure always agree on framing.
  function fitFrame(w, h) {
    const fit = Math.min(w * .74 / 520, h * .60 / 300, 1.4) || 1;
    return { fit, offsetX: w / 2 - 260 * fit, offsetY: h * .40 - 150 * fit };
  }
  const bounds0 = scene.getBoundingClientRect();
  const frame0 = fitFrame(bounds0.width, bounds0.height);
  const fieldX = bounds0.width / frame0.fit;
  const fieldY = bounds0.height / frame0.fit;
  const fieldLeft = -frame0.offsetX / frame0.fit;
  const fieldTop = -frame0.offsetY / frame0.fit;
  // The reveal and the gather share one clockwise wave from the red-glass side.
  const sweepOf = (nx, ny) => (((Math.atan2(ny - .5, nx - .5) + Math.PI / 4) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
  // Most paths bend with the vortex; a few counter-bend so the flow stays organic.
  const arcOf = (sx, sy, tx, ty, seed) => {
    const dx = tx - sx, dy = ty - sy;
    const swirl = rand() < .78 ? .12 + seed * .22 : -(.04 + seed * .08);
    return [(sx + tx) / 2 + dy * swirl - dx * .06, (sy + ty) / 2 - dx * swirl - dy * .06];
  };
  const particles = [];
  const cx = 260, cy = 150;
  for (let y = 0; y < 300; y += 3) {
    for (let x = 0; x < 520; x += 3) {
      const alpha = pixels[(y * 520 + x) * 4 + 3];
      if (alpha < 50) continue;
      const seed = rand();
      const eye = alpha > 220;
      const ecx = x < 260 ? 217 : 303;
      const nx = halton(particles.length + 1, 2);
      const ny = halton(particles.length + 1, 3);
      const sx = fieldLeft + (nx + (seed - .5) * .03) * fieldX;
      const sy = fieldTop + (ny + (rand() - .5) * .03) * fieldY;
      const sweep = sweepOf(nx, ny);
      const [mx, my] = arcOf(sx, sy, x, y, seed);
      const dist = Math.hypot(x - sx, y - sy);
      const delay = eye ? EYE_DELAY + seed * EYE_JITTER
        : GATHER_START + sweep * GATHER_SPAN + seed * GATHER_JITTER;
      const dur = eye ? EYE_DUR + seed * EYE_DUR_JITTER
        : FLY_BASE + Math.min(dist, FLY_DIST_CAP) * FLY_DIST + seed * FLY_JITTER;
      particles.push({ tx: x, ty: y, sx, sy, mx, my, x: sx, y: sy, px: sx, py: sy, seed, eye, delay, dur,
        reveal: sweep * REVEAL_SPAN + rand() * REVEAL_JITTER,
        bx: ecx + (x - ecx) * 1.18, by: 150 + (y - 150) * .12,
        color: eye ? '#f5f5f5' : (seed > .65 ? '#c6c6c6' : '#777777'),
        hot: eye ? '#fbf3ef' : (seed > .65 ? '#ecc8bc' : '#d29a8b'),
        size: eye ? 1.7 : 1.25 });
    }
  }
  // Extra motes fill the field fuller and dissolve into the figure as it forms.
  const motes = [];
  const moteTotal = particles.length;
  for (let i = 0; i < moteTotal; i++) {
    const seed = rand();
    const nx = halton(i + 1, 5);
    const ny = halton(i + 1, 7);
    const sx = fieldLeft + (nx + (seed - .5) * .04) * fieldX;
    const sy = fieldTop + (ny + (rand() - .5) * .04) * fieldY;
    const tx = cx + (rand() - .5) * 420;
    const ty = cy + (rand() - .5) * 190;
    const sweep = sweepOf(nx, ny);
    const [mx, my] = arcOf(sx, sy, tx, ty, seed);
    const dist = Math.hypot(tx - sx, ty - sy);
    motes.push({ sx, sy, mx, my, tx, ty, x: sx, y: sy, px: sx, py: sy, seed,
      delay: GATHER_START + sweep * GATHER_SPAN + seed * GATHER_JITTER,
      dur: FLY_BASE + Math.min(dist, FLY_DIST_CAP) * FLY_DIST + seed * FLY_JITTER,
      reveal: sweep * REVEAL_SPAN + rand() * REVEAL_JITTER,
      hot: '#d29a8b', color: seed > .6 ? '#9a9a9a' : '#6e6e6e',
      size: 1 + seed * .6 });
  }

  let width = 1, height = 1, scale = 1, offsetX = 0, offsetY = 0;
  let stageTop = 0, travel = 1, progress = 0, target = 0;
  let frame = 0, previousTime = 0, born = null, settled = false;
  let visible = false, desktop = false, pointer = null;
  let idleTimer = 0, gesture = null;

  function requestFrame() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  }

  // Idle gestures wake the canvas only while they run, then it sleeps again.
  const smooth = v => v * v * (3 - 2 * v);
  // Softer than smoothstep: both ends land at rest, so nothing snaps into place.
  const smoother = k => k * k * k * (k * (k * 6 - 15) + 10);

  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = 0;
    if (reduced.matches || document.hidden) return;
    idleTimer = setTimeout(startGesture, 3200 + Math.random() * 4200);
  }

  function startGesture() {
    idleTimer = 0;
    if (!settled || reduced.matches || document.hidden || !visible || (desktop && target > .9)) {
      scheduleIdle();
      return;
    }
    const roll = Math.random();
    if (roll < .26) {
      gesture = { kind: 'glance', start: performance.now(), duration: 1500, dir: Math.random() < .5 ? -1 : 1 };
    } else if (roll < .42) {
      gesture = { kind: 'blink', start: performance.now(), duration: 520, again: true };
    } else {
      gesture = { kind: 'blink', start: performance.now(), duration: 300, again: false };
    }
    requestFrame();
  }

  function measure() {
    const bounds = scene.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const frame = fitFrame(width, height);
    scale = frame.fit;
    offsetX = frame.offsetX;
    offsetY = frame.offsetY;
    pointer = null;
    requestFrame();
  }

  function readScroll() {
    target = desktop ? Math.min(1, Math.max(0, (scrollY - stageTop + 16) / travel)) : 0;
    requestFrame();
  }

  function layout() {
    desktop = !reduced.matches && !compact.matches;
    document.documentElement.classList.toggle('hero-motion', desktop);
    stageTop = stage.getBoundingClientRect().top + scrollY;
    travel = Math.max(1, parseFloat(getComputedStyle(stage).getPropertyValue('--hero-travel')) * innerHeight / 100);
    if (!desktop) {
      progress = target = 0;
    }
    if (reduced.matches) settled = true;
    if (reduced.matches) {
      clearTimeout(idleTimer);
      idleTimer = 0;
      gesture = null;
    } else if (!idleTimer && !gesture) {
      scheduleIdle();
    }
    readScroll();
    measure();
  }

  function draw(now, dt) {
    const animate = !reduced.matches && !settled;
    if (born === null) born = now;
    const age = now - born;
    let lid = 0, glance = 0;
    if (gesture) {
      const t = (now - gesture.start) / gesture.duration;
      if (t >= 1) {
        gesture = null;
        scheduleIdle();
      } else if (gesture.kind === 'blink') {
        const phase = gesture.again ? (t % .5) * 2 : t;
        lid = phase < .5 ? smooth(phase * 2) : smooth((1 - phase) * 2);
      } else {
        glance = Math.sin(t * Math.PI) * gesture.dir * 11;
      }
    }
    // Eyes gather shut, then wake open once the body has settled.
    const wake = reduced.matches ? 1 : smooth(Math.min(1, Math.max(0, (age - WAKE_AT) / WAKE_DUR)));
    const attraction = 1 - Math.exp(-dt / 38);
    const dprX = canvas.width / width;
    const dprY = canvas.height / height;
    context.setTransform(dprX, 0, 0, dprY, 0, 0);
    context.clearRect(0, 0, width, height);
    context.translate(offsetX, offsetY);
    context.scale(scale, scale);
    let moving = false;
    // Motes only exist in the opening field; they dissolve as the figure forms.
    if (animate) {
      context.lineCap = 'round';
      for (const mote of motes) {
        const k = Math.min(1, Math.max(0, (age - mote.delay) / mote.dur));
        if (k >= 1) continue;
        const e = smoother(k), u = 1 - e, wob = (1 - k) * (1 - k);
        const x = u * u * mote.sx + 2 * u * e * mote.mx + e * e * mote.tx
          + Math.sin(age * .0012 + mote.seed * 6.283) * 3.4 * wob;
        const y = u * u * mote.sy + 2 * u * e * mote.my + e * e * mote.ty
          + Math.cos(age * .00095 + mote.seed * 9.42) * 2.8 * wob;
        const appear = smooth(Math.min(1, Math.max(0, (age - mote.reveal) / REVEAL_DUR)));
        const speed = Math.hypot(x - mote.px, y - mote.py);
        if (speed > 2.4) {
          context.globalAlpha = Math.min(.4, (speed - 2.4) * .04) * (1 - k) * appear;
          context.strokeStyle = mote.hot;
          context.lineWidth = mote.size * 1.1;
          context.beginPath();
          context.moveTo(mote.px, mote.py);
          context.lineTo(x, y);
          context.stroke();
        }
        mote.px = x;
        mote.py = y;
        context.globalAlpha = appear * .5 * (1 - k * k);
        context.fillStyle = mote.color;
        const s = mote.size * (1 + .5 * (1 - k));
        context.fillRect(x - s / 2, y - s / 2, s, s);
        moving = true;
      }
    }
    for (const particle of particles) {
      const openness = particle.eye ? wake * (1 - lid) : 1;
      const tx = particle.bx + (particle.tx - particle.bx) * openness;
      const ty = particle.by + (particle.ty - particle.by) * openness;
      let k = 1, x, y;
      if (animate) {
        k = Math.min(1, Math.max(0, (age - particle.delay) / particle.dur));
        const e = k >= 1 ? 1 : smoother(k);
        const u = 1 - e, wob = (1 - k) * (1 - k);
        x = u * u * particle.sx + 2 * u * e * particle.mx + e * e * tx
          + Math.sin(age * .0012 + particle.seed * 6.283) * 3.4 * wob;
        y = u * u * particle.sy + 2 * u * e * particle.my + e * e * ty
          + Math.cos(age * .00095 + particle.seed * 9.42) * 2.8 * wob;
      } else {
        x = tx;
        y = ty;
      }
      if (particle.eye && glance) x += glance;
      if (pointer) {
        const dx = particle.tx - pointer.x, dy = particle.ty - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance > .01 && distance < 85) {
          const push = (1 - distance / 85) ** 2 * 32;
          x += dx / distance * push;
          y += dy / distance * push;
        }
      }
      if (!desktop) {
        particle.x = x;
        particle.y = y;
      } else {
        particle.x += (x - particle.x) * attraction;
        particle.y += (y - particle.y) * attraction;
      }
      if (k < 1 || Math.abs(x - particle.x) + Math.abs(y - particle.y) > .025) moving = true;
      // Fast flight leaves a short warm streak that cools on landing.
      if (animate) {
        const speed = Math.hypot(x - particle.px, y - particle.py);
        if (speed > 2.4) {
          context.globalAlpha = Math.min(.4, (speed - 2.4) * .04) * (1 - k * .55);
          context.strokeStyle = particle.hot;
          context.lineWidth = particle.size * 1.15;
          context.beginPath();
          context.moveTo(particle.px, particle.py);
          context.lineTo(x, y);
          context.stroke();
        }
        particle.px = x;
        particle.py = y;
      }
      // Focus pull: soft and large in flight, crisp on landing.
      const appear = animate ? smooth(Math.min(1, Math.max(0, (age - particle.reveal) / REVEAL_DUR))) : 1;
      const s = particle.size * (1 + .8 * (1 - k));
      context.globalAlpha = appear * (.3 + .7 * Math.min(1, k * 1.6));
      context.fillStyle = particle.color;
      context.fillRect(particle.x - (s - particle.size) / 2, particle.y - (s - particle.size) / 2, s, s);
    }
    context.globalAlpha = 1;
    if (age >= SETTLE_AT) settled = true;
    hero.classList.add('hero-canvas-ready');
    return moving || gesture !== null || (!reduced.matches && age < SETTLE_AT);
  }

  function tick(now) {
    frame = 0;
    const dt = previousTime ? Math.min(64, now - previousTime) : 16;
    previousTime = now;
    const difference = target - progress;
    progress = Math.abs(difference) < .0005 || !visible ? target : progress + difference * (1 - Math.exp(-dt / 80));
    const p = progress * progress * (3 - 2 * progress);
    const reveal = desktop ? Math.min(1, Math.max(0, (p - .52) / .38)) : 1;
    hero.style.setProperty('--p', p.toFixed(5));
    hero.style.setProperty('--bleed', (Math.max(0, document.documentElement.clientWidth - stage.clientWidth) * p).toFixed(2) + 'px');
    hero.style.setProperty('--workspace', reveal.toFixed(4));
    workspace.classList.toggle('is-visible', reveal > 0);
    workspace.inert = reveal < .95;
    workspace.setAttribute('aria-hidden', String(reveal < .95));
    scene.setAttribute('aria-hidden', String(desktop && reveal >= .95));
    const moving = visible && (!desktop || reveal < 1) ? draw(now, dt) : false;
    if (!moving && gesture && !(visible && (!desktop || reveal < 1))) {
      gesture = null;
      scheduleIdle();
    }
    if (Math.abs(target - progress) > .0005 || moving) requestFrame();
  }

  hero.addEventListener('pointermove', event => {
    if (!desktop || !mouse.matches || event.pointerType !== 'mouse') return;
    const bounds = hero.getBoundingClientRect();
    pointer = { x: (event.clientX - bounds.left - offsetX) / scale, y: (event.clientY - bounds.top - offsetY) / scale };
    requestFrame();
  });
  hero.addEventListener('pointerleave', () => { pointer = null; requestFrame(); });
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', layout);
  reduced.addEventListener('change', layout);
  compact.addEventListener('change', layout);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(idleTimer);
      idleTimer = 0;
      gesture = null;
    } else {
      previousTime = 0;
      readScroll();
      scheduleIdle();
    }
  });
  new ResizeObserver(measure).observe(scene);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    previousTime = 0;
    if (visible) {
      requestFrame();
      scheduleIdle();
    } else {
      gesture = null;
    }
  }).observe(hero);
  layout();
  document.fonts.ready.then(layout);
})();
