(() => {
  "use strict";
  const scale = [57, 60, 62, 64, 67, 69]; // A3–A4，A 小调五声音阶
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function scanEvent(feature, step, previousDegree = 2, wasInk = false) {
    const ink = feature.density > .006;
    if (!ink) return { lastDegree: previousDegree, ink: false, note: null, drum: null, warmth: 0 };
    const target = clamp(Math.round(Math.log2(1 + feature.crossings) * 2), 0, scale.length - 1);
    const degree = previousDegree + clamp(target - previousDegree, -2, 2);
    const warmth = clamp(feature.overlap, 0, 2) / 2;
    const velocity = .32 + Math.min(.48, feature.density * .75);
    const strike = step % 2 === 0 || !wasInk || feature.density > .35;
    return { ink: true, lastDegree: degree, warmth,
      drum: strike ? { velocity: velocity * (step % 4 === 0 ? 1 : .65) } : null,
      note: (!feature.pause && (step % 2 === 0 || !wasInk))
        ? { step, midi: scale[degree], velocity, steps: feature.density > .3 ? 1.7 : 2.8 } : null };
  }
  function whisperEvent(character, previousDegree = 2, overlap = 0) {
    if (/^[\s，。；：！？,.!?;:“”"—]+$/u.test(character.text)) {
      return { rest: /[。！？.!?]/u.test(character.text) ? .32 : .16, lastDegree: previousDegree };
    }
    const code = character.text.codePointAt(0) || 0;
    // 字形复杂度决定走向，字符身份决定细微的元音与时值；音程保持靠近。
    const target = clamp(Math.round(Math.log2(1 + character.crossings) * 1.6) + code % 3 - 1, 0, 4);
    const degree = previousDegree + clamp(target - previousDegree, -1, 1);
    const vowels = [[420, 1050, 1950], [560, 1250, 2100], [330, 1450, 2200], [460, 900, 1800], [370, 1150, 2050]];
    return { text: character.text, midi: scale[degree], lastDegree: degree,
      duration: .22 + clamp(character.density, 0, 1) * .24 + (code % 4) * .025,
      velocity: .55 + clamp(character.density, 0, .35) * .6,
      formants: vowels[code % vowels.length], breath: .16 + (code % 5) * .025,
      thickness: clamp(overlap, 0, 2) / 2, pan: ((code % 7) - 3) * .035 };
  }
  globalThis.poemScore = { scanEvent, whisperEvent, scale };
})();
