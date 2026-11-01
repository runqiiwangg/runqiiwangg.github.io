(() => {
  "use strict";
  const REFRESH_MS = 2000;
  const colors = [
    "rgba(198,178,64,.55)", "#80b33988",
    "rgba(149, 162, 52, 0.47)", "rgba(121, 134, 52, 0.47)",
    "rgba(105, 109, 60, 0.67)",
  ];
  const random = (min, max) => min + Math.random() * (max - min);
  const canvas = document.createElement("canvas");
  canvas.className = "grass-field";
  canvas.setAttribute("aria-hidden", "true");
  document.querySelector(".poem-effects").append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  let width = 0;
  let height = 0;
  const padding = 180;

  function gaussian() {
    return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(Math.PI * 2 * Math.random());
  }

  // 只控制生长位置的概率，不裁切草叶。几个重叠的草丛形成松散的高低起伏。
  function sampleGround() {
    const clusters = [
      [.20, .76, .15, .11],
      [.43, .53, .18, .18],
      [.64, .62, .17, .16],
      [.81, .77, .12, .10],
    ];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const [cx, cy, sx, sy] = clusters[Math.floor(random(0, clusters.length))];
      const x = (cx + gaussian() * sx) * width;
      const y = (cy + gaussian() * sy) * height;
      // 留足完整草叶的绘制余量，画布边缘远离主要草丛。
      if (x > -padding + 100 && x < width + padding - 100
        && y > -padding + 150 && y < height + padding - 20) return { x, y };
    }
    return { x: width * .5, y: height * .7 };
  }

  // 平滑随机场代替 p5 noise，让相邻草叶的弯曲有连续感。
  function noiseField() {
    const cells = Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => Math.random()));
    const smooth = t => t * t * (3 - 2 * t);
    return (x, y) => {
      x = Math.abs(x * .01) % 30;
      y = Math.abs(y * .01) % 30;
      const ix = Math.floor(x), iy = Math.floor(y);
      const tx = smooth(x - ix), ty = smooth(y - iy);
      const a = cells[iy][ix] * (1 - tx) + cells[iy][ix + 1] * tx;
      const b = cells[iy + 1][ix] * (1 - tx) + cells[iy + 1][ix + 1] * tx;
      return a * (1 - ty) + b * ty;
    };
  }

  function drawGrass() {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width + padding * 2, height + padding * 2);
    ctx.save();
    ctx.translate(padding, padding);
    const noise = noiseField();
    // 沿用参考中的密度、线宽、步数及向上生长的角度。
    const bladeCount = Math.floor(width * height / 1250);
    for (let i = 0; i < bladeCount; i += 1) {
      let { x, y } = sampleGround();
      ctx.strokeStyle = colors[Math.floor(random(0, colors.length))];
      ctx.lineWidth = random(.6, 1.8);
      let angle = -Math.PI / 2 + random(-.45, .45);
      const stepLength = random(3, 7);
      const steps = Math.floor(random(8, 20));
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let step = 0; step < steps; step += 1) {
        angle += (noise(x + step * 5, y) * .7 - .35) * .15;
        x += Math.cos(angle) * stepLength + random(-.6, .6);
        y += Math.sin(angle) * stepLength;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(105,96,60,.27)";
    for (let i = 0; i < Math.floor(width / 90 * 2); i += 1) {
      let { x, y } = sampleGround();
      y += random(10, 35);
      const length = random(40, 160);
      ctx.lineWidth = random(1, 3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k += 1) {
        x += length / 6 + random(-2, 2);
        ctx.lineTo(x, y + random(-1.5, 1.5));
      }
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(120,110,70,.24)";
    for (let i = 0; i < Math.floor(width * height / 4000); i += 1) {
      const { x, y } = sampleGround();
      ctx.fillRect(x, y + random(0, 30), 1, 1);
    }
    ctx.restore();
  }

  function positionGrass() {
    const anchor = [...document.querySelectorAll(".poem-line")]
      .find(line => line.textContent.includes("草地：你辛苦了。"));
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const firstCharacter = [...anchor.querySelectorAll(".poem-character")]
      .find(character => character.textContent === "草");
    const characterRect = firstCharacter?.getBoundingClientRect() || rect;
    const lineHeight = parseFloat(getComputedStyle(anchor).lineHeight) || 36;
    const viewportWidth = document.documentElement.clientWidth;
    const left = Math.max(16, Math.min(characterRect.left - 65, viewportWidth * .14));
    width = Math.max(1, viewportWidth * .87 - left);
    height = Math.min(lineHeight * 13, Math.max(100, rect.bottom + window.scrollY - 20));
    canvas.style.left = `${left + window.scrollX - padding}px`;
    // 保留原草丛宽高，只把定位基准上移到“趁风还踌躇着”这一行。
    const upperAnchor = [...document.querySelectorAll(".poem-line")]
      .find(line => line.textContent.includes("趁风还踌躇着"));
    const upperRect = upperAnchor?.getBoundingClientRect() || rect;
    // 向下平移六行（约一个半诗节），草丛的生成范围保持不变。
    const downwardOffset = lineHeight * 6;
    canvas.style.top = `${upperRect.bottom + window.scrollY + lineHeight * .9 - height - padding + downwardOffset}px`;
    canvas.style.width = `${width + padding * 2}px`;
    canvas.style.height = `${height + padding * 2}px`;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil((width + padding * 2) * ratio);
    canvas.height = Math.ceil((height + padding * 2) * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawGrass();
  }

  document.fonts.ready.then(() => {
    positionGrass();
    setInterval(drawGrass, REFRESH_MS);
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(positionGrass, 200);
  });
})();
