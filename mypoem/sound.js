(() => {
  "use strict";
  const reader = document.querySelector(".poem-reader");
  if (!reader) return;
  const rowReader = document.createElement("div");
  rowReader.className = "poem-row-reader";
  rowReader.setAttribute("aria-hidden", "true");
  document.body.append(rowReader);
  rowReader.hidden = true;
  const panel = document.querySelector(".poem-sound");
  if (!panel) return;
  // 按用户截图中的滑块位置估算；保留在代码中，页面只显示声音开关。
  const defaults = Object.freeze({
    tempo: 42,
    volume: .95,
    "strings-level": .7,
    "whisper-level": .42,
    "bell-level": .32,
    breath: .65,
    shape: .55,
    tone: .72,
    saturation: .28,
    space: .26,
  });
  const value = name => defaults[name];
  const button = panel.querySelector("button");
  // 进入页面默认静音、闭嘴，点击嘴唇后才开启声音。
  let muted = true;
  let audio, master, mix, drumBus, stringBus, melodyBus, bellBus, liveGate, duck, cutoff, saturator, space, noise, wave;
  let playing = false, nextTime = 0, stepNumber = 0, barScore, previousDegree = 2;
  let barDuration = 240 / 42, stepDuration = barDuration / 16;
  let wasInk = false, lastSampleTime = -Infinity;
  let melodyDegree = 2, lastBellTime = -Infinity;
  let contactInk = false, contactBar = -1, lastHitTime = -Infinity;
  let seenCharacters = new Set(), pendingCharacters = [], nextWhisperTime = 0;
  let lastWhisperText = "", activeWhispers = 0, whisperGeneration = 0;
  let bars = [], lines = [], scanAnimation, frame, generation = 0;
  const sources = new Set();
  const whisperVoices = new Set();
  const midiFrequency = midi => 440 * 2 ** ((midi - 69) / 12);
  const scheduleTarget = (param, target, time, constant = .08) => param.setTargetAtTime(target, time, constant);

  function createAudio() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error("Web Audio unavailable");
    audio = new Audio();
    master = audio.createGain(); master.gain.value = 0;
    mix = audio.createGain();
    drumBus = audio.createGain(); drumBus.gain.value = .65;
    stringBus = audio.createGain(); stringBus.gain.value = value("whisper-level");
    melodyBus = audio.createGain(); melodyBus.gain.value = value("strings-level");
    bellBus = audio.createGain(); bellBus.gain.value = value("bell-level");
    duck = audio.createGain();
    drumBus.connect(mix);
    liveGate = audio.createGain(); liveGate.gain.value = 0;
    stringBus.connect(liveGate).connect(duck).connect(mix);
    melodyBus.connect(liveGate);
    bellBus.connect(mix);
    saturator = audio.createWaveShaper(); saturator.oversample = "2x";
    const highpass = audio.createBiquadFilter(); highpass.type = "highpass"; highpass.frequency.value = 35;
    cutoff = audio.createBiquadFilter(); cutoff.type = "lowpass"; cutoff.Q.value = .5;
    const shelf = audio.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 1800; shelf.gain.value = -5;
    const compressor = audio.createDynamicsCompressor();
    compressor.threshold.value = -18; compressor.knee.value = 18; compressor.ratio.value = 3;
    compressor.attack.value = .008; compressor.release.value = .2;
    mix.connect(saturator).connect(highpass).connect(cutoff).connect(shelf).connect(compressor).connect(master).connect(audio.destination);
    // 低电平、暗色混响；先混回滤波器，避免空间尾音引入尖锐高频。
    const reverb = audio.createConvolver();
    const impulse = audio.createBuffer(2, Math.ceil(audio.sampleRate * 1.5), audio.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < data.length; i += 1) {
        smooth = smooth * .65 + (Math.random() * 2 - 1) * .35;
        data[i] = smooth * (1 - i / data.length) ** 2.5;
      }
    }
    reverb.buffer = impulse;
    space = audio.createGain();
    liveGate.connect(reverb).connect(space).connect(cutoff);
    bellBus.connect(reverb);
    noise = audio.createBuffer(1, Math.ceil(audio.sampleRate * .8), audio.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const real = new Float32Array(13), imag = new Float32Array(13);
    for (let n = 1; n < imag.length; n += 1) imag[n] = 1 / n ** 1.7;
    wave = audio.createPeriodicWave(real, imag);
    applyEffects();
  }

  function applyEffects() {
    if (!audio) return;
    const now = audio.currentTime;
    scheduleTarget(master.gain, playing && !muted && !document.hidden ? value("volume") : 0, now, .025);
    scheduleTarget(stringBus.gain, value("whisper-level"), now);
    scheduleTarget(melodyBus.gain, value("strings-level"), now);
    scheduleTarget(bellBus.gain, value("bell-level"), now);
    scheduleTarget(cutoff.frequency, 950 + value("tone") * 1850, now, .15);
    scheduleTarget(space.gain, value("space"), now);
    const drive = 1 + value("saturation") * 2;
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i += 1) {
      const x = i / (curve.length - 1) * 2 - 1;
      curve[i] = Math.tanh(x * drive) / drive;
    }
    saturator.curve = curve;
  }

  function trackedSource(source, nodes, time, duration) {
    sources.add(source);
    source.start(time); source.stop(time + duration);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
      nodes.forEach(node => node.disconnect());
    };
  }

  function drum(time, velocity) {
    // 每一击同时触发：短噪声的干燥触点 + 向下扫频的低沉鼓身。
    const clickAmp = audio.createGain();
    clickAmp.gain.setValueAtTime(0, time);
    clickAmp.gain.linearRampToValueAtTime(velocity * .18, time + .0015);
    clickAmp.gain.exponentialRampToValueAtTime(.0001, time + .038);
    clickAmp.connect(drumBus);
    const click = audio.createBufferSource(); click.buffer = noise;
    const filter = audio.createBiquadFilter(); filter.type = "bandpass";
    filter.frequency.value = 1100; filter.Q.value = .65;
    click.connect(filter).connect(clickAmp);
    trackedSource(click, [filter, clickAmp], time, .055);
    const bass = audio.createOscillator(); bass.type = "sine";
    bass.frequency.setValueAtTime(112, time);
    bass.frequency.exponentialRampToValueAtTime(49, time + .085);
    const bassAmp = audio.createGain();
    bassAmp.gain.setValueAtTime(0, time);
    bassAmp.gain.linearRampToValueAtTime(velocity * .38, time + .006);
    bassAmp.gain.exponentialRampToValueAtTime(.0001, time + .3);
    bass.connect(bassAmp).connect(drumBus);
    trackedSource(bass, [bassAmp], time, .33);
  }

  // 恢复原先的柔和双振荡器旋律，作为独立底层；呢喃不替代它。
  function sing(time, note, warmth) {
    const duration = note.steps * stepDuration;
    const envelope = audio.createGain();
    const body = audio.createBiquadFilter(); body.type = "lowpass"; body.Q.value = .45;
    body.frequency.setValueAtTime(1100 + warmth * 350, time);
    const peak = note.velocity * (.085 + warmth * .012);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(peak, time + .1);
    envelope.gain.setValueAtTime(peak * .82, time + Math.max(.12, duration - .07));
    envelope.gain.linearRampToValueAtTime(0, time + duration + .22);
    body.connect(envelope).connect(melodyBus);
    let remaining = 2;
    for (const detune of [-2.5, 2.5]) {
      const osc = audio.createOscillator(); osc.setPeriodicWave(wave);
      osc.frequency.value = midiFrequency(note.midi); osc.detune.value = detune;
      osc.connect(body); sources.add(osc);
      osc.start(time); osc.stop(time + duration + .24);
      osc.onended = () => {
        sources.delete(osc); osc.disconnect(); remaining -= 1;
        if (!remaining) { body.disconnect(); envelope.disconnect(); }
      };
    }
  }

  function chime(time, midi, velocity) {
    if (time - lastBellTime < .16) return;
    lastBellTime = time;
    const frequency = midiFrequency(Math.min(81, midi + 12));
    // 钟音用柔和的纯音泛音，轻快起音、自然衰减；不增加刺耳噪声。
    for (const [ratio, level, decay] of [[1, .085, .65], [2, .028, .35], [3.01, .009, .2]]) {
      const osc = audio.createOscillator(); osc.type = "sine"; osc.frequency.value = frequency * ratio;
      const amp = audio.createGain(); amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(level * velocity, time + .005);
      amp.gain.exponentialRampToValueAtTime(.0001, time + decay);
      osc.connect(amp).connect(bellBus);
      trackedSource(osc, [amp], time, decay + .03);
    }
  }

  function murmur(time, note) {
    const duration = note.duration;
    const envelope = audio.createGain();
    const pan = audio.createStereoPanner(); pan.pan.value = note.pan;
    const peak = note.velocity * .12 / Math.sqrt(1 + activeWhispers * .5);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(peak, time + .035);
    envelope.gain.linearRampToValueAtTime(peak * .7, time + duration * .55);
    envelope.gain.exponentialRampToValueAtTime(.0001, time + duration + .14);
    envelope.connect(pan).connect(stringBus);
    const osc = audio.createOscillator(); osc.setPeriodicWave(wave);
    const voiceHeight = globalThis.poemInteraction?.voice ?? .5;
    const baseFrequency = midiFrequency(note.midi) * 2 ** ((voiceHeight * 10 - 7) / 12);
    osc.frequency.setValueAtTime(baseFrequency * .985, time);
    osc.frequency.exponentialRampToValueAtTime(baseFrequency, time + .06);
    osc.detune.value = (note.thickness - .5) * 4;
    const voiced = audio.createGain(); voiced.gain.value = .65;
    osc.connect(voiced).connect(envelope);
    // 三个轻柔共鸣峰模拟口腔形状，不把笔画数量直接变成刺耳高频。
    const filters = [], resonanceGains = [];
    note.formants.forEach((frequency, index) => {
      const formant = audio.createBiquadFilter(); formant.type = "bandpass";
      formant.frequency.value = frequency * (.76 + voiceHeight * .52); formant.Q.value = 2.2;
      const weight = audio.createGain(); weight.gain.value = [.5, .22, .09][index];
      osc.connect(formant).connect(weight).connect(envelope);
      filters.push(formant); resonanceGains.push(weight);
    });
    const air = audio.createBufferSource(); air.buffer = noise; air.loop = true;
    const airFilter = audio.createBiquadFilter(); airFilter.type = "bandpass";
    airFilter.frequency.value = 1350; airFilter.Q.value = .5;
    const airGain = audio.createGain(); airGain.gain.value = value("breath") * (note.breath + .12);
    air.connect(airFilter).connect(airGain).connect(envelope);
    const voice = { osc, midi: note.midi, filters, formants: note.formants };
    whisperVoices.add(voice);
    const token = whisperGeneration;
    activeWhispers += 1;
    sources.add(osc); sources.add(air);
    osc.start(time); air.start(time);
    osc.stop(time + duration + .17); air.stop(time + duration + .17);
    let remaining = 2;
    const ended = source => {
      sources.delete(source); source.disconnect(); remaining -= 1;
      if (!remaining) {
        whisperVoices.delete(voice);
        if (token === whisperGeneration) activeWhispers = Math.max(0, activeWhispers - 1);
        [envelope, pan, voiced, airFilter, airGain, ...filters, ...resonanceGains].forEach(node => node.disconnect());
      }
    };
    osc.onended = () => ended(osc); air.onended = () => ended(air);
  }

  function readCharacters(active, feature, now, step) {
    if (contactBar !== active.index) {
      contactBar = active.index; contactInk = false;
      seenCharacters = new Set(); pendingCharacters = [];
      nextWhisperTime = now; lastWhisperText = "";
    }
    for (const character of feature.contacts || []) {
      if (seenCharacters.has(character.id)) continue;
      seenCharacters.add(character.id);
      pendingCharacters.push({ ...character, overlap: feature.overlap });
    }
    // 单条旋律逐字发声，最多三个短音轻叠，避免重叠文字引发声音堆积。
    if (pendingCharacters.length && now >= nextWhisperTime && activeWhispers < 3) {
      const character = pendingCharacters.shift();
      const note = globalThis.poemScore.whisperEvent(character, previousDegree, character.overlap);
      previousDegree = note.lastDegree;
      if (note.rest) {
        lastWhisperText = "（呼吸）";
        nextWhisperTime = now + note.rest;
      } else {
        murmur(now + .008, note);
        if ((character.text.codePointAt(0) || 0) % 3 === 0) {
          chime(now + .012, note.midi, note.velocity * .6);
        }
        lastWhisperText = character.text;
        active.score.notes.push({ step, midi: note.midi });
        nextWhisperTime = now + Math.max(.13, Math.min(.25, stepDuration * .5));
      }
    }
  }

  function windowFor(bar, phase) {
    const rect = lines[bar.lineIndex].getBoundingClientRect();
    const height = parseFloat(getComputedStyle(lines[bar.lineIndex]).fontSize) || 18;
    const readerRect = reader.getBoundingClientRect();
    const css = getComputedStyle(reader);
    const width = parseFloat(css.getPropertyValue("--reader-width")) || 18;
    const travel = parseFloat(css.getPropertyValue("--reader-travel")) || 0;
    return { left: readerRect.left + Math.max(0, Math.min(1, phase)) * travel,
      top: rect.top + (rect.height - height) / 2, width, height };
  }

  function readWindow(bar, phase) {
    const area = windowFor(bar, phase);
    return globalThis.poemImage.sampleRegion(area.left, area.top, area.width, area.height);
  }

  function beginBar(time, barIndex) {
    const lineIndex = barIndex % lines.length;
    barDuration = 240 / value("tempo"); stepDuration = barDuration / 16;
    barScore = { notes: [], drums: [], events: [], warmth: 0 };
    wasInk = false;
    bars.push({ start: time, duration: barDuration, index: barIndex, lineIndex, score: barScore });
  }

  function scheduler() {
    if (!playing || document.hidden || audio.state !== "running") return;
    const now = audio.currentTime;
    if (nextTime < now - .25) {
      stepNumber = Math.ceil(stepNumber / 16) * 16;
      nextTime = now + .05;
    }
    while (nextTime < now + .045) {
      const step = stepNumber % 16;
      if (step === 0) beginBar(nextTime, Math.floor(stepNumber / 16));
      // 每个四分音符轻微下压，再恢复弦乐；Shaper 控制深度，不做生硬门控。
      if (step % 4 === 0) {
        duck.gain.setValueAtTime(1, nextTime);
        duck.gain.linearRampToValueAtTime(1 - value("shape"), nextTime + .012);
        duck.gain.linearRampToValueAtTime(1, nextTime + stepDuration * 1.6);
      }
      const bar = bars.at(-1);
      // 只提前约 45ms 读即将到达的实际窗口，移动字与拖影均参加。
      const feature = readWindow(bar, step / 16);
      const event = globalThis.poemScore.scanEvent(feature, step, melodyDegree, wasInk);
      melodyDegree = event.lastDegree;
      wasInk = event.ink;
      barScore.events.push({ step, ...feature });
      if (event.drum) {
        lastHitTime = nextTime;
        drum(nextTime, event.drum.velocity);
        barScore.drums.push({ step, ...event.drum });
      }
      if (event.note) {
        sing(nextTime, event.note, event.warmth);
        barScore.notes.push(event.note);
        chime(nextTime, event.note.midi, event.note.velocity * .7);
      }
      nextTime += stepDuration;
      stepNumber += 1;
    }
  }

  function drawTransport() {
    if (!playing) return;
    const now = audio.currentTime;
    const voiceHeight = globalThis.poemInteraction?.voice ?? .5;
    for (const voice of whisperVoices) {
      voice.osc.frequency.setTargetAtTime(midiFrequency(voice.midi) * 2 ** ((voiceHeight * 10 - 7) / 12), now, .12);
      voice.filters.forEach((filter, i) => filter.frequency.setTargetAtTime(voice.formants[i] * (.76 + voiceHeight * .52), now, .12));
    }
    const active = bars.filter(bar => bar.start <= now).at(-1);
    if (active) {
      lastAudioVisual = performance.now();
      visualEpoch = lastAudioVisual - (active.index * active.duration + now - active.start) * 1000;
      bars = bars.filter(bar => bar === active || bar.start > now);
      reader.style.setProperty("--reader-duration", `${active.duration}s`);
      if (scanAnimation) scanAnimation.currentTime = Math.max(0, now - active.start) * 1000;
      const step = Math.min(15, Math.floor((now - active.start) / active.duration * 16));
      const area = windowFor(active, (now - active.start) / active.duration);
      rowReader.hidden = false;
      rowReader.style.top = `${area.top + window.scrollY}px`;
      rowReader.style.height = `${area.height}px`;
      if (now - lastSampleTime >= .05) {
        const feature = readWindow(active, (now - active.start) / active.duration);
        active.liveFeature = feature;
        readCharacters(active, feature, now, step);
        const inkNow = feature.density > .006;
        if (inkNow && !contactInk && now - lastHitTime > .20) {
          const event = globalThis.poemScore.scanEvent(feature, step, melodyDegree, false);
          if (event.drum) drum(now + .005, event.drum.velocity * .55);
          if (event.note) {
            sing(now + .005, event.note, event.warmth);
            melodyDegree = event.lastDegree;
            active.score.notes.push({ ...event.note, step });
            chime(now + .008, event.note.midi, event.note.velocity * .5);
          }
          lastHitTime = now;
        }
        contactInk = inkNow;
        // 空白淡出，遇字淡入；高频始终受明亮度上限约束。
        liveGate.gain.setTargetAtTime(feature.density > .006 || activeWhispers > 0 ? 1 : 0, now, .06);
        lastSampleTime = now;
      }

    }
    frame = requestAnimationFrame(drawTransport);
  }

  function stopSources() {
    if (!audio) return;
    for (const source of sources) {
      try { source.stop(audio.currentTime + .03); } catch { /* 已结束的声部 */ }
    }
    whisperVoices.clear();
    whisperGeneration += 1; activeWhispers = 0; pendingCharacters = [];
    duck.gain.cancelScheduledValues(audio.currentTime);
    duck.gain.setValueAtTime(1, audio.currentTime);
  }

  function startTransport() {
    lines = [...document.querySelectorAll(".poem-line")].filter(line => line.textContent.trim());
    if (!lines.length) throw new Error("No poem lines");
    stopSources(); bars = []; previousDegree = 2; melodyDegree = 2; lastBellTime = -Infinity; stepNumber = 0; lastSampleTime = -Infinity;
    contactInk = false; contactBar = -1; lastHitTime = -Infinity;
    seenCharacters = new Set(); pendingCharacters = []; nextWhisperTime = 0; lastWhisperText = "";
    liveGate.gain.cancelScheduledValues(audio.currentTime); liveGate.gain.setValueAtTime(0, audio.currentTime);
    nextTime = audio.currentTime + .1;
    reader.style.setProperty("--reader-duration", `${240 / value("tempo")}s`);
    scanAnimation = reader.getAnimations({ subtree: true }).find(animation => animation.animationName === "poem-reader-scan");
    if (scanAnimation) { scanAnimation.pause(); scanAnimation.currentTime = 0; }
    scheduler();
    cancelAnimationFrame(frame); frame = requestAnimationFrame(drawTransport);
  }

  let visualEpoch = performance.now(), lastAudioVisual = -Infinity;
  function updateSoundButton() {
    const state = muted ? "muted" : audio?.state === "running" && playing ? "playing" : "waiting";
    panel.dataset.audioState = state;
    button.setAttribute("aria-pressed", String(!muted));
    button.setAttribute("aria-label", muted ? "播放声音" : "静音");
    button.setAttribute("title", muted ? "播放声音" : state === "waiting"
      ? "声音已开启，浏览器等待页面交互授权；点击嘴唇静音" : "静音");
  }
  function startWhenReady() {
    // 不修改用户的开关选择：迟到的 resume/statechange 不能撤销静音。
    if (muted || audio?.state !== "running") {
      if (audio) applyEffects();
      updateSoundButton();
      return;
    }
    if (!playing) { playing = true; startTransport(); }
    applyEffects();
    updateSoundButton();
  }
  function requestPlayback() {
    if (muted) { updateSoundButton(); return; }
    try {
      if (!audio) {
        createAudio();
        audio.addEventListener("statechange", () => {
          if (audio.state === "running") startWhenReady();
          else updateSoundButton();
        });
      }
      if (audio.state === "running") startWhenReady();
      else audio.resume().then(startWhenReady).catch(error => {
        panel.dataset.audioState = "waiting";
        updateSoundButton();
        console.info("浏览器尚未允许自动播放，等待用户交互。", error);
      });
    } catch (error) { updateSoundButton(); console.error(error); }
  }
  function unlockSound(event) {
    // 点击嘴唇只切换开关；页面其他位置的交互用于解锁浏览器音频。
    if (event.target instanceof Element && event.target.closest(".poem-sound")) return;
    if (!muted) requestPlayback();
  }
  button.addEventListener("click", () => {
    muted = !muted;
    if (muted) {
      if (audio) applyEffects();
      updateSoundButton();
    } else requestPlayback();
  });
  document.addEventListener("pointerdown", unlockSound, true);
  document.addEventListener("click", unlockSound, true);
  document.addEventListener("keydown", unlockSound, true);
  function updateScanVisuals() {
    // 音频未解锁或暂停时，用独立画面时钟推进横、竖两条线。
    // 音频开始输出后由 drawTransport 接管，不会把横条锁在第一行。
    const timestamp = performance.now();
    if (!playing || audio?.state !== "running" || timestamp - lastAudioVisual > 250) {
      if (!lines.length) lines = [...document.querySelectorAll(".poem-line")].filter(line => line.textContent.trim());
      if (lines.length) {
        const duration = 240 / value("tempo");
        const elapsed = Math.max(0, (timestamp - visualEpoch) / 1000);
        const index = Math.floor(elapsed / duration) % lines.length;
        const line = lines[index];
        const rect = line.getBoundingClientRect();
        const height = parseFloat(getComputedStyle(line).fontSize) || 18;
        rowReader.style.top = `${rect.top + window.scrollY + (rect.height - height) / 2}px`;
        rowReader.style.height = `${height}px`;
        rowReader.hidden = false;
        reader.style.setProperty("--reader-duration", `${duration}s`);
        if (!scanAnimation) scanAnimation = reader.getAnimations({ subtree: true }).find(animation => animation.animationName === "poem-reader-scan");
        if (scanAnimation) {
          scanAnimation.pause();
          scanAnimation.currentTime = elapsed % duration * 1000;
        }
      }
    }
    // 保持标题处的纵向位置，整组左边缘对齐纵向绿条的固定起点。
    const heading = document.querySelector(".poem-title");
    if (heading) {
      const titleRect = heading.getBoundingClientRect();
      const readerRect = reader.getBoundingClientRect();
      panel.style.left = `${readerRect.left + window.scrollX}px`;
      panel.style.top = `${titleRect.top + window.scrollY + titleRect.height / 2}px`;
    }
    requestAnimationFrame(updateScanVisuals);
  }
  updateSoundButton();
  document.fonts.ready.then(() => {
    if (!muted) requestPlayback();
    requestAnimationFrame(updateScanVisuals);
  });
  document.addEventListener("visibilitychange", async () => {
    if (!audio || !playing) return;
    try {
      if (document.hidden) await audio.suspend();
      else { await audio.resume(); scheduler(); }
    } catch (error) { console.error(error); }
  });
  setInterval(scheduler, 25);
})();
