(() => {
  "use strict";
  const scratch = document.createElement("canvas");
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  const svgCache = new WeakMap();
  const backgroundCache = new Map();
  const ignored = ".poem-sound, .poem-reader, .poem-row-reader, [data-music-ignore]";
  const poemText = ".poem-line, .poem-character, .poem-copy, .poem-copies";
  function reset(w, h) {
    // 调整尺寸同时清除可能由跨域素材留下的画布污染。
    scratch.width = w; scratch.height = h;
  }
  function colorIsVisible(color) {
    if (!color || color === "transparent" || /rgba\([^)]*,\s*0\s*\)/.test(color)) return false;
    return true;
  }
  function addPixels(counts, pixels, opacity) {
    let marked = 0;
    for (let i = 0; i < counts.length; i += 1) {
      const offset = i * 4;
      const alpha = pixels[offset + 3] / 255 * opacity;
      const darkness = 1 - (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 765;
      // 绿色、低饱和草叶及细线均可进入；白底与透明区域不触发。
      if (alpha * darkness > .018) { counts[i] += 1; marked += 1; }
    }
    return marked;
  }
  function addBox(counts, area, rect, strength = 1) {
    if (strength < .02) return 0;
    let marked = 0;
    for (let y = 0; y < area.h; y += 1) {
      if (area.top + y < rect.top || area.top + y >= rect.bottom) continue;
      for (let x = 0; x < area.w; x += 1) {
        if (area.left + x < rect.left || area.left + x >= rect.right) continue;
        counts[y * area.w + x] += 1; marked += 1;
      }
    }
    return marked;
  }
  function svgSource(element) {
    const signature = element.outerHTML;
    let entry = svgCache.get(element);
    if (entry?.signature === signature) return entry.ready ? entry.image : null;
    const clone = element.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // 把样式表中的填色与描边带进独立 SVG 图像。
    const originals = [element, ...element.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    originals.forEach((node, i) => {
      const style = getComputedStyle(node);
      for (const key of ["fill", "stroke", "stroke-width", "opacity"]) copies[i].style.setProperty(key, style.getPropertyValue(key));
    });
    const image = new Image();
    entry = { signature, image, ready: false };
    image.onload = () => { entry.ready = true; };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
    svgCache.set(element, entry);
    return null;
  }
  function fittedRect(source, rect, style) {
    const iw = source.videoWidth || source.naturalWidth || source.width;
    const ih = source.videoHeight || source.naturalHeight || source.height;
    if (!iw || !ih || !["contain", "cover", "none", "scale-down"].includes(style.objectFit)) return rect;
    let scale = style.objectFit === "cover" ? Math.max(rect.width / iw, rect.height / ih)
      : Math.min(rect.width / iw, rect.height / ih);
    if (style.objectFit === "none") scale = 1;
    if (style.objectFit === "scale-down") scale = Math.min(1, scale);
    const parts = (style.objectPosition || "50% 50%").split(" ");
    const position = (part, extra) => part?.endsWith("%") ? parseFloat(part) / 100 * extra : parseFloat(part) || extra / 2;
    return { left: rect.left + position(parts[0], rect.width - iw * scale),
      top: rect.top + position(parts[1], rect.height - ih * scale), width: iw * scale, height: ih * scale };
  }

  function sample(counts, left, top, w, h) {
    if (!ctx) return { graphicalPixels: 0, approximations: 0 };
    const area = { left, top, w, h };
    let graphicalPixels = 0, approximations = 0;
    for (const element of document.body.querySelectorAll("*")) {
      if (element.closest(ignored) || element.matches(poemText) || element.closest("svg") !== null && element.tagName.toLowerCase() !== "svg") continue;
      if (["SCRIPT", "STYLE", "LINK", "BR", "SOURCE"].includes(element.tagName)) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.right <= left || rect.left >= left + w || rect.bottom <= top || rect.top >= top + h) continue;
      const style = getComputedStyle(element);
      let opacity = Number(style.opacity || 1);
      if (style.display === "none" || style.visibility === "hidden" || !opacity) continue;
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        opacity *= Number(parentStyle.opacity || 1);
      }
      let source = null, isMedia = false;
      const tag = element.tagName.toLowerCase();
      if (tag === "canvas") { source = element; isMedia = true; }
      else if (tag === "img") { source = element.complete && element.naturalWidth ? element : null; isMedia = true; }
      else if (tag === "video") { source = element.readyState >= 2 ? element : null; isMedia = true; }
      else if (tag === "svg") { source = svgSource(element); isMedia = true; }
      if (source) {
        try {
          reset(w, h);
          const fitted = tag === "img" || tag === "video" ? fittedRect(source, rect, style) : rect;
          ctx.save(); ctx.beginPath(); ctx.rect(rect.left - left, rect.top - top, rect.width, rect.height); ctx.clip();
          ctx.drawImage(source, fitted.left - left, fitted.top - top, fitted.width, fitted.height);
          ctx.restore();
          graphicalPixels += addPixels(counts, ctx.getImageData(0, 0, w, h).data, opacity);
        } catch {
          reset(w, h);
          graphicalPixels += addBox(counts, area, rect, opacity);
          approximations += 1;
        }
      } else if (["iframe", "object", "embed"].includes(tag)) {
        graphicalPixels += addBox(counts, area, rect, opacity);
        approximations += 1;
      }
      // CSS 图形、背景和边框也可以参与，以后加普通 DOM 内容无需登记。
      if (!isMedia && (colorIsVisible(style.backgroundColor) || style.backgroundImage !== "none"
        || parseFloat(style.borderTopWidth) || parseFloat(style.borderLeftWidth))) {
        reset(w, h);
        if (colorIsVisible(style.backgroundColor)) {
          ctx.fillStyle = style.backgroundColor;
          ctx.fillRect(rect.left - left, rect.top - top, rect.width, rect.height);
        }
        const background = style.backgroundImage?.match(/^url\(["']?(.*?)["']?\)$/);
        if (background) {
          let image = backgroundCache.get(background[1]);
          if (!image) { image = new Image(); image.src = background[1]; backgroundCache.set(background[1], image); }
          if (image.complete && image.naturalWidth) ctx.drawImage(image, rect.left - left, rect.top - top, rect.width, rect.height);
        } else if (style.backgroundImage && style.backgroundImage !== "none") {
          // 任意渐变等复杂 CSS 以局部覆盖近似，始终纳入而不阻断声音。
          graphicalPixels += addBox(counts, area, rect, opacity); approximations += 1;
        }
        for (const [side, x, y, width, height] of [
          ["Top", rect.left, rect.top, rect.width, parseFloat(style.borderTopWidth)],
          ["Bottom", rect.left, rect.bottom - parseFloat(style.borderBottomWidth), rect.width, parseFloat(style.borderBottomWidth)],
          ["Left", rect.left, rect.top, parseFloat(style.borderLeftWidth), rect.height],
          ["Right", rect.right - parseFloat(style.borderRightWidth), rect.top, parseFloat(style.borderRightWidth), rect.height],
        ]) {
          if (width && height) { ctx.fillStyle = style[`border${side}Color`]; ctx.fillRect(x - left, y - top, width, height); }
        }
        try { graphicalPixels += addPixels(counts, ctx.getImageData(0, 0, w, h).data, opacity); }
        catch { reset(w, h); graphicalPixels += addBox(counts, area, rect, opacity); approximations += 1; }
      }
      // 新增的普通文本：用 Range 获取每个字的实际排版位置。
      if (!isMedia && !element.closest(poemText) && !["HTML", "BODY"].includes(element.tagName)) {
        for (const node of element.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const range = document.createRange();
          let offset = 0;
          for (const text of Array.from(node.textContent)) {
            range.setStart(node, offset); offset += text.length; range.setEnd(node, offset);
            if (!text.trim()) continue;
            const r = range.getBoundingClientRect();
            if (r.right <= left || r.left >= left + w || r.bottom <= top || r.top >= top + h) continue;
            reset(w, h); ctx.font = style.font; ctx.fillStyle = style.color; ctx.textBaseline = "alphabetic";
            const metrics = ctx.measureText(text), size = parseFloat(style.fontSize) || 18;
            const ascent = metrics.fontBoundingBoxAscent || size * .85;
            const descent = metrics.fontBoundingBoxDescent || size * .15;
            ctx.fillText(text, r.left - left, r.top - top + (r.height - ascent - descent) / 2 + ascent);
            graphicalPixels += addPixels(counts, ctx.getImageData(0, 0, w, h).data, opacity);
          }
        }
      }
    }
    return { graphicalPixels, approximations };
  }
  globalThis.poemVisualInput = { sample };
})();
