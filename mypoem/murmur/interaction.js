(() => {
  "use strict";
  const reader = document.querySelector(".poem-reader");
  if (!reader) return;
  const state = { voice: .5, inside: false };
  globalThis.poemInteraction = state;

  // 仅保留鼠标高度控制呢喃声线，不创建绘图画布。
  document.addEventListener("pointermove", event => {
    const region = reader.getBoundingClientRect();
    const y = event.clientY + window.scrollY;
    const height = Math.max(window.innerHeight, document.documentElement.scrollHeight);
    const overControls = event.target instanceof Element && event.target.closest(".poem-sound");
    state.inside = !overControls && event.clientX >= region.left && event.clientX <= region.right
      && y >= 0 && y <= height;
    if (state.inside) state.voice = Math.max(0, Math.min(1, 1 - y / height));
  }, { passive: true });
  document.addEventListener("pointerleave", () => { state.inside = false; });
  window.addEventListener("blur", () => { state.inside = false; });
})();
