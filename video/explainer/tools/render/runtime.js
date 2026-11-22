// In-page timing engine for one mounted scene (our own; no framework code).
//   __render.init(id)  waits for fonts and images, finds the scene timeline and
//                      its timed clips, and parks the scene at t = 0.
//   __render.seek(t)   applies clip visibility for local time t and seeks the
//                      scene's paused GSAP timeline there with callbacks firing.
(function () {
  let tl = null;
  let clips = [];

  function applyVisibility(t) {
    for (const c of clips) {
      const on = t >= c.start && t < c.end;
      // '' (not 'visible') so a clip nested in a hidden clip stays hidden
      const v = on ? '' : 'hidden';
      if (c.el.style.visibility !== v) c.el.style.visibility = v;
    }
  }

  async function init(id) {
    tl = window.__timelines && window.__timelines[id];
    if (!tl) throw new Error('no timeline registered for ' + id);
    const host = document.getElementById(id);
    clips = [];
    for (const el of host.querySelectorAll('.clip[data-start]')) {
      const start = parseFloat(el.getAttribute('data-start'));
      const dur = parseFloat(el.getAttribute('data-duration'));
      if (!Number.isFinite(start)) throw new Error('bad data-start on #' + el.id);
      clips.push({ el, start, end: Number.isFinite(dur) ? start + dur : Infinity });
    }
    // fonts: ask for every face the scenes use, then wait for the set
    const faces = ['400 40px Inter', '700 40px Inter', '900 40px Inter', '400 40px "JetBrains Mono"', '700 40px "JetBrains Mono"'];
    await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null)));
    await document.fonts.ready;
    const missing = faces.filter((f) => !document.fonts.check(f));
    // images: every <img> loaded before the first capture (no img.decode():
    // it waits on a rendered frame and can stall in a background page; the
    // screenshot itself decodes synchronously)
    const imgs = Array.from(document.images);
    const deadline = Date.now() + 30000;
    while (imgs.some((im) => !im.complete) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const broken = imgs.filter((im) => !im.naturalWidth).map((im) => im.getAttribute('src'));
    seek(0);
    return { duration: tl.duration(), clips: clips.length, images: imgs.length, broken, missingFonts: missing };
  }

  function seek(t) {
    applyVisibility(t);
    tl.seek(t, false); // suppressEvents = false: onUpdate & co. fire
    return true;
  }

  window.__render = { init, seek };
})();
