(() => {
  "use strict";

  // 每四分之一秒开始一轮；tab 按四个空格计算。飞行的平均速度为每四分之一秒一个 tab。
  const rootStyle = getComputedStyle(document.documentElement);
  const roundInterval = parseFloat(rootStyle.getPropertyValue("--round-interval")) || 250;
  const tabSize = parseFloat(rootStyle.getPropertyValue("--tab-size")) || 4;
  const paragraphs = [...document.querySelectorAll("body > p")];
  const lines = [];

  for (const paragraph of paragraphs) {
    const fragment = document.createDocumentFragment();
    let line;
    let characters;
    const nextLine = () => {
      line = document.createElement("span");
      line.className = "poem-line";
      characters = [];
      lines.push({ element: line, characters });
      fragment.append(line);
    };
    nextLine();
    const visit = (node, emphasis = false, quote = false) => {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const character of Array.from(node.textContent)) {
          if (character === "\n") { nextLine(); continue; }
          const span = document.createElement("span");
          span.className = "poem-character" + (emphasis ? " emphasis" : "") + (quote ? " poem-quote" : "");
          span.textContent = character;
          line.append(span);
          // 保留缩进和内部空格，但每轮只移动一个可见字（含标点）。
          if (!/\s/u.test(character)) characters.push(span);
        }
      } else {
        for (const child of node.childNodes) {
          visit(child, emphasis || node.classList?.contains("emphasis"),
            quote || node.classList?.contains("poem-quote"));
        }
      }
    };
    for (const child of paragraph.childNodes) visit(child);
    paragraph.replaceChildren(fragment);
  }

  lines.forEach((item, index) => {
    item.element.dataset.poemLine = String(index);
    item.characters.forEach((character, glyphIndex) => {
      character.dataset.poemGlyph = `${index}:${glyphIndex}`;
    });
  });

  const layer = document.createElement("div");
  layer.className = "poem-copies";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  const reader = document.createElement("div");
  reader.className = "poem-reader";
  reader.setAttribute("aria-hidden", "true");
  document.body.append(reader);
  let timer;
  let animations = [];
  let trailFrame;
  const trailInterval = 1000;

  // 固定的伪随机值：刷新或调整窗口后，碎片构图仍保持一致。
  function scatter(seed) {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function start() {
    clearTimeout(timer);
    cancelAnimationFrame(trailFrame);
    animations.forEach(animation => animation.cancel());
    animations = [];
    layer.replaceChildren();
    const activeLines = lines.filter(item => item.characters.length);
    if (!activeLines.length) return;

    // 绝对定位图层默认只有视口高；扩展到全文，避免末段副本被裁切。
    layer.style.height = `${Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)}px`;
    const bounds = activeLines.map(item => item.element.getBoundingClientRect());
    const left = Math.min(...bounds.map(rect => rect.left));
    const right = Math.max(...activeLines.map(item => item.characters.at(-1).getBoundingClientRect().right));
    const poemWidth = right - left;
    const originalRight = right + window.scrollX;
    // JS 只提供排版位置；竖条的外观、匀速运动和循环全部由 CSS 控制。
    const chineseCharacter = activeLines.flatMap(item => item.characters)
      .find(character => /[\u3400-\u9fff]/u.test(character.textContent));
    const readerWidth = chineseCharacter?.getBoundingClientRect().width || 18;
    const pageRight = document.documentElement.clientWidth + window.scrollX;
    const readerStart = Math.min(originalRight, Math.max(0, pageRight - readerWidth));
    reader.style.setProperty("--reader-start", `${readerStart}px`);
    reader.style.setProperty("--reader-width", `${readerWidth}px`);
    reader.style.setProperty("--reader-travel", `${Math.max(0, pageRight - readerWidth - readerStart)}px`);
    const updateReaderHeight = () => {
      reader.style.height = `${Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)}px`;
    };
    requestAnimationFrame(updateReaderHeight);
    const movingCopies = [];

    // 每个字越过整首原诗的右边界后，独立计时；静止副本永久留在图层中。
    function leaveTrails(now) {
      for (let index = movingCopies.length - 1; index >= 0; index -= 1) {
        const item = movingCopies[index];
        if (item.animation.playState === "finished" || item.animation.playState === "idle") {
          movingCopies.splice(index, 1);
          continue;
        }
        const position = item.copy.getBoundingClientRect();
        if (position.left + window.scrollX <= originalRight) continue;
        if (item.nextTrail === null) item.nextTrail = now + trailInterval;
        if (now < item.nextTrail) continue;

        const trail = item.copy.cloneNode(true);
        trail.classList.add("poem-trail");
        // cloneNode 不复制 Web Animation，保存当前变换即可冻结当时的位置。
        trail.style.transform = getComputedStyle(item.copy).transform;
        trail.style.willChange = "auto";
        layer.append(trail);
        item.nextTrail = now + trailInterval;
      }
      if (round < rounds || movingCopies.length) {
        trailFrame = requestAnimationFrame(leaveTrails);
      }
    }
    const margin = parseFloat(getComputedStyle(document.body).marginRight) || 24;
    const destinationLeft = Math.max(left, document.documentElement.clientWidth - margin - poemWidth);
    // 将定型文字的左对齐基准共享给标题旁的声音开关。
    reader.style.setProperty("--poem-destination-left", `${destinationLeft + window.scrollX}px`);
    const shift = destinationLeft - left;

    // 使用实际字体测量 tab，避免中英文字体宽度不同造成速度变化。
    const probe = document.createElement("span");
    const sampleStyle = getComputedStyle(activeLines[0].characters[0]);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    probe.style.font = sampleStyle.font;
    probe.textContent = " ".repeat(tabSize);
    document.body.append(probe);
    const tabWidth = probe.getBoundingClientRect().width || 24;
    probe.remove();
    const rounds = Math.max(...activeLines.map(item => item.characters.length));
    let round = 0;

    function launchRound() {
      for (const [lineIndex, { characters }] of activeLines.entries()) {
        const original = characters[round];
        if (!original) continue;
        const rect = original.getBoundingClientRect();
        const style = getComputedStyle(original);
        const copy = document.createElement("span");
        copy.className = "poem-copy";
        copy.dataset.poemLine = original.parentElement.dataset.poemLine;
        copy.dataset.poemGlyph = original.dataset.poemGlyph;
        copy.textContent = original.textContent;
        Object.assign(copy.style, {
          left: `${rect.left + window.scrollX}px`, top: `${rect.top + window.scrollY}px`,
          font: style.font, color: style.color, lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
        });
        layer.append(copy);
        // 以短句为一组错位，再抽出部分单字，形成截图中零碎、重叠的边缘。
        const group = Math.floor(round / 4);
        const seed = (lineIndex + 1) * 97 + group * 13;
        const isolated = scatter((lineIndex + 1) * 71 + round * 19) < 0.32;
        const lineHeight = parseFloat(style.lineHeight) || 36;
        const fontSize = parseFloat(style.fontSize) || 18;
        const offsetX = (scatter(seed) - 0.5) * fontSize * 5;
        const offsetY = (scatter(seed + 1) - 0.5) * lineHeight * 2.4;
        const naturalX = rect.left + window.scrollX + shift;
        const targetX = isolated
          ? destinationLeft + window.scrollX + scatter(seed + round + 2) * poemWidth * 0.18
          : naturalX + offsetX;
        const targetY = rect.top + window.scrollY + offsetY
          + (isolated ? (scatter(seed + round + 5) - 0.5) * lineHeight * 5 : 0);
        // 图层覆盖全文；落点限制在页面内，末段同样完整参与。
        const endX = Math.max(0, Math.min(
          document.documentElement.clientWidth - margin - rect.width + window.scrollX,
          targetX,
        ));
        const endY = Math.max(0, Math.min(parseFloat(layer.style.height) - rect.height, targetY));
        const dx = endX - rect.left - window.scrollX;
        const dy = endY - rect.top - window.scrollY;
        const duration = Math.max(250, Math.abs(dx) / tabWidth * 250)
          * (0.85 + scatter(seed + round + 7) * 0.3);
        const animation = copy.animate([
          { transform: "translate(0, 0)" },
          // 大部分路程沿原行向右，到右侧才逐渐散开。
          { transform: `translate(${dx * 0.72}px, ${dy * 0.12}px)`, offset: 0.72 },
          { transform: `translate(${dx}px, ${dy}px)` },
        ], {
          duration,
          // 明显的加速：起步缓慢，随后持续加速，抵达后停留。
          easing: "cubic-bezier(0.55, 0, 1, 0.45)",
          fill: "forwards",
        });
        animations.push(animation);
        movingCopies.push({ copy, animation, nextTrail: null });
      }
      round += 1;
      if (round < rounds) timer = setTimeout(launchRound, roundInterval);
    }
    timer = setTimeout(launchRound, roundInterval);
    trailFrame = requestAnimationFrame(leaveTrails);
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(start, 200);
  });
  document.fonts.ready.then(start);
})();
