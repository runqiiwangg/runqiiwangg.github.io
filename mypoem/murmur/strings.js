(() => {
  "use strict";
  const cache = new Map();
  const characterIds = new WeakMap();
  let nextCharacterId = 0;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  function glyph(character, rect) {
    const style = getComputedStyle(character);
    const key = `${style.font}|${character.textContent}|${Math.ceil(rect.width)}|${Math.ceil(rect.height)}`;
    if (cache.has(key)) return cache.get(key);
    const w = Math.max(1, Math.ceil(rect.width)), h = Math.max(1, Math.ceil(rect.height));
    canvas.width = w + 8; canvas.height = h;
    ctx.font = style.font; ctx.fillStyle = "black"; ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText(character.textContent);
    const size = parseFloat(style.fontSize) || 18;
    const ascent = metrics.fontBoundingBoxAscent || size * .85;
    const descent = metrics.fontBoundingBoxDescent || size * .15;
    ctx.fillText(character.textContent, 4, (h - ascent - descent) / 2 + ascent);
    const result = { w: w + 8, h, pixels: ctx.getImageData(0, 0, w + 8, h).data };
    let ink = 0, crossings = 0;
    for (let x = 0; x < result.w; x += 1) {
      let previous = false;
      for (let y = 0; y < result.h; y += 1) {
        const current = result.pixels[(y * result.w + x) * 4 + 3] > 64;
        if (current) ink += 1;
        if (current && !previous) crossings += 1;
        previous = current;
      }
    }
    result.density = ink / (result.w * result.h);
    result.crossings = crossings / result.w;
    cache.set(key, result);
    return result;
  }
  const hasInk = (g, x, y) => x >= 0 && x < g.w && y >= 0 && y < g.h
    && g.pixels[(y * g.w + x) * 4 + 3] > 64;

  // 只读取绿条和当前水平条的交叉窗口，不缩放或预先拉伸原诗图像。
  function sampleRegion(left, top, width, height) {
    const w = Math.max(1, Math.ceil(width)), h = Math.max(1, Math.ceil(height));
    const counts = new Uint16Array(w * h);
    const contacts = [];
    let punctuation = false;
    if (!ctx) return { density: 0, crossings: 0, overlap: 0, pause: false, contacts };
    for (const character of document.querySelectorAll(".poem-character, .poem-copy")) {
      if (!character.textContent.trim()) continue;
      const rect = character.getBoundingClientRect();
      if (rect.right + 4 <= left || rect.left - 4 >= left + width
        || rect.bottom <= top || rect.top >= top + height) continue;
      const g = glyph(character, rect);
      let contributed = false;
      for (let y = 0; y < h; y += 1) {
        const sy = Math.floor(top + y - rect.top);
        if (sy < 0 || sy >= g.h) continue;
        for (let x = 0; x < w; x += 1) {
          const sx = Math.floor(left + x - rect.left + 4);
          if (hasInk(g, sx, sy)) { counts[y * w + x] += 1; contributed = true; }
        }
      }
      if (contributed) {
        if (!characterIds.has(character)) characterIds.set(character, ++nextCharacterId);
        contacts.push({ id: character.dataset.poemGlyph || `instance:${characterIds.get(character)}`,
          text: character.textContent, x: rect.left,
          density: g.density, crossings: g.crossings });
        if (/[，。；：！？,.!?;:]/u.test(character.textContent)) punctuation = true;
      }
    }
    const graphics = globalThis.poemVisualInput?.sample(counts, left, top, w, h)
      || { graphicalPixels: 0, approximations: 0 };
    let occupied = 0, extra = 0, crossings = 0;
    for (let x = 0; x < w; x += 1) {
      let previous = false;
      for (let y = 0; y < h; y += 1) {
        const count = counts[y * w + x];
        if (count) { occupied += 1; extra += count - 1; }
        if (count && !previous) crossings += 1;
        previous = count > 0;
      }
    }
    return { density: occupied / (w * h), crossings: crossings / w,
      overlap: occupied ? extra / occupied : 0, pause: punctuation,
      graphicalPixels: graphics.graphicalPixels, approximations: graphics.approximations,
      contacts: contacts.sort((a, b) => a.x - b.x) };
  }
  globalThis.poemImage = { sampleRegion };
})();
