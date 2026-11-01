(() => {
  "use strict";

  // 每半秒开始一轮；tab 按四个空格计算。飞行的平均速度为每半秒一个 tab。
  const rootStyle = getComputedStyle(document.documentElement);
  const roundInterval = parseFloat(rootStyle.getPropertyValue("--round-interval")) || 500;
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
    const visit = (node, emphasis = false) => {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const character of Array.from(node.textContent)) {
          if (character === "\n") { nextLine(); continue; }
          const span = document.createElement("span");
          span.className = "poem-character" + (emphasis ? " emphasis" : "");
          span.textContent = character;
          line.append(span);
          // 保留缩进和内部空格，但每轮只移动一个可见字（含标点）。
          if (!/\s/u.test(character)) characters.push(span);
        }
      } else {
        for (const child of node.childNodes) {
          visit(child, emphasis || node.classList?.contains("emphasis"));
        }
      }
    };
    for (const child of paragraph.childNodes) visit(child);
    paragraph.replaceChildren(fragment);
  }

  const layer = document.createElement("div");
  layer.className = "poem-copies";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  let timer;
  let animations = [];

  function start() {
    clearTimeout(timer);
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
    const margin = parseFloat(getComputedStyle(document.body).marginRight) || 24;
    const destinationLeft = Math.max(left, document.documentElement.clientWidth - margin - poemWidth);
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
    const duration = Math.max(500, Math.abs(shift) / tabWidth * 500);
    const rounds = Math.max(...activeLines.map(item => item.characters.length));
    let round = 0;

    function launchRound() {
      for (const { characters } of activeLines) {
        const original = characters[round];
        if (!original) continue;
        const rect = original.getBoundingClientRect();
        const style = getComputedStyle(original);
        const copy = document.createElement("span");
        copy.className = "poem-copy";
        copy.textContent = original.textContent;
        Object.assign(copy.style, {
          left: `${rect.left + window.scrollX}px`, top: `${rect.top + window.scrollY}px`,
          font: style.font, color: style.color, lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
        });
        layer.append(copy);
        animations.push(copy.animate([
          { transform: "translateX(0)" },
          { transform: `translateX(${shift}px)` },
        ], {
          duration,
          // 明显的加速：起步缓慢，随后持续加速，抵达后停留。
          easing: "cubic-bezier(0.55, 0, 1, 0.45)",
          fill: "forwards",
        }));
      }
      round += 1;
      if (round < rounds) timer = setTimeout(launchRound, roundInterval);
    }
    timer = setTimeout(launchRound, roundInterval);
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(start, 200);
  });
  document.fonts.ready.then(start);
})();
