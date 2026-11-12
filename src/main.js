import { createPlayer } from "./player.js";
import { applyGain, downloadBlob, encodeWav } from "./wav.js";
import { DEFAULT_VOICE, VOICE_GROUPS } from "./voices.js";

const boot = document.querySelector("#boot");
const bootText = document.querySelector("#boot-text");
const bootBar = document.querySelector("#boot-bar");
const bootFill = document.querySelector("#boot-fill");
const bootPercent = document.querySelector("#boot-percent");
const noticeEl = document.querySelector("#notice");
const errorEl = document.querySelector("#error");
const textEl = document.querySelector("#text");
const voiceEl = document.querySelector("#voice");
const speedEl = document.querySelector("#speed");
const speedValue = document.querySelector("#speed-value");
const volumeEl = document.querySelector("#volume");
const volumeValue = document.querySelector("#volume-value");
const speakBtn = document.querySelector("#speak");
const cancelBtn = document.querySelector("#cancel");
const jobEl = document.querySelector("#job");
const jobBar = document.querySelector("#job-bar");
const jobFill = document.querySelector("#job-fill");
const jobLabel = document.querySelector("#job-label");
const playBtn = document.querySelector("#play");
const seekEl = document.querySelector("#seek");
const timeCurrent = document.querySelector("#time-current");
const timeTotal = document.querySelector("#time-total");
const saveBtn = document.querySelector("#save");
const statusEl = document.querySelector("#status");

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

let modelReady = false;
let jobId = 0;
let busy = false;
let sawDownload = false;
let seeking = false;
/** @type {{ key: string, samples: Float32Array, sampleRate: number } | null} */
let clip = null;
/** @type {{ samples: Float32Array, gapBefore: number, sampleRate: number }[]} */
let parts = [];

const player = createPlayer({
  onTick: renderTime,
  onState: (playing) => {
    playBtn.textContent = playing ? "Пауза" : "Слушать";
  },
});

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function renderTime(current, total) {
  timeCurrent.textContent = formatTime(current);
  timeTotal.textContent = formatTime(total);
  const hasAudio = total > 0;
  playBtn.disabled = !hasAudio;
  seekEl.disabled = !hasAudio;
  saveBtn.disabled = !hasAudio || busy;
  if (!seeking && total > 0) {
    seekEl.value = String(Math.round((current / total) * 1000));
  }
}

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function showNotice(message) {
  noticeEl.hidden = !message;
  noticeEl.textContent = message || "";
}

function setStatus(message) {
  statusEl.textContent = message || "";
}

function setBootPercent(percent) {
  const value = Math.max(0, Math.min(100, percent));
  const unknown = value === 0;
  bootBar.classList.toggle("indeterminate", unknown);
  bootFill.style.width = unknown ? "" : `${value}%`;
  bootBar.setAttribute("aria-valuenow", String(value));
  bootPercent.textContent = `${value}%`;
}

function fillVoices(available) {
  const allowed = available ? new Set(available) : null;
  const previous = voiceEl.value || DEFAULT_VOICE;
  voiceEl.replaceChildren();
  for (const group of VOICE_GROUPS) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const [id, name] of group.voices) {
      if (allowed && !allowed.has(id)) continue;
      const option = document.createElement("option");
      option.value = id;
      option.textContent = name;
      optgroup.appendChild(option);
    }
    if (optgroup.childElementCount) voiceEl.appendChild(optgroup);
  }
  if (allowed) {
    const known = new Set(VOICE_GROUPS.flatMap((group) => group.voices.map(([id]) => id)));
    const extra = [...allowed].filter((id) => !known.has(id));
    if (extra.length) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = "Другие";
      for (const id of extra) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = id;
        optgroup.appendChild(option);
      }
      voiceEl.appendChild(optgroup);
    }
  }
  voiceEl.value = previous;
  if (voiceEl.value !== previous) voiceEl.value = DEFAULT_VOICE;
}

function speed() {
  return (Math.round(Number(speedEl.value) * 10) / 10).toFixed(1);
}

function volumeGain() {
  return Number(volumeEl.value) / 100;
}

function cacheKey() {
  return JSON.stringify({
    text: textEl.value.trim(),
    voice: voiceEl.value,
    speed: speed(),
  });
}

function setBusy(value) {
  busy = value;
  speakBtn.hidden = value;
  cancelBtn.hidden = !value;
  speakBtn.disabled = value || !modelReady;
  textEl.disabled = value;
  voiceEl.disabled = value;
  speedEl.disabled = value;
  saveBtn.disabled = value || !clip;
  jobEl.hidden = !value;
}

function setJobProgress(index, total) {
  const percent = total === 0 ? 0 : Math.round((index / total) * 100);
  jobFill.style.width = `${percent}%`;
  jobBar.setAttribute("aria-valuenow", String(percent));
  const shown = Math.min(total, index + 1);
  jobLabel.textContent = `Фрагмент ${shown} из ${total}`;
}

function assemble(chunks) {
  const sampleRate = chunks[0].sampleRate;
  let length = 0;
  const gaps = chunks.map((chunk, index) => {
    if (index === 0) return 0;
    return Math.round(sampleRate * chunk.gapBefore);
  });
  chunks.forEach((chunk, index) => {
    length += gaps[index] + chunk.samples.length;
  });

  const samples = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk, index) => {
    offset += gaps[index];
    samples.set(chunk.samples, offset);
    offset += chunk.samples.length;
  });
  return { samples, sampleRate };
}

async function useClip(next, { play }) {
  if (!next.samples.length) {
    showError("Модель не вернула звук. Попробуйте другую фразу.");
    return;
  }
  try {
    await player.load(next.samples, next.sampleRate);
  } catch {
    showError("Не хватило памяти для собранного звука. Сократите текст.");
    return;
  }
  clip = next;
  player.setVolume(volumeGain());
  if (play) {
    const state = await player.play();
    if (state !== "running") {
      setStatus("Звук готов. Нажмите «Слушать», если воспроизведение не началось.");
      return;
    }
  }
  setStatus("Готово. Можно слушать и сохранить WAV.");
}

window.__ttsStarted = true;
fillVoices();
setBootPercent(0);
player.setVolume(volumeGain());

speedEl.addEventListener("input", () => {
  speedValue.textContent = `${speed()}×`;
});

volumeEl.addEventListener("input", () => {
  volumeValue.textContent = `${volumeEl.value}%`;
  player.setVolume(volumeGain());
});

speakBtn.addEventListener("click", async () => {
  showError("");
  const text = textEl.value.trim();
  if (!text) {
    showError("Введите текст, который нужно озвучить.");
    textEl.focus();
    return;
  }

  await player.resume();
  const key = cacheKey();
  if (clip && clip.key === key) {
    await player.seek(0, true);
    setStatus("Текст и настройки те же — играю готовый звук.");
    return;
  }

  jobId += 1;
  parts = [];
  setBusy(true);
  setJobProgress(0, 1);
  jobLabel.textContent = "Готовлю фрагменты…";
  if (text.length > 4000) {
    setStatus("Длинный текст озвучивается по частям. Это может занять несколько минут.");
  } else {
    setStatus("");
  }

  worker.postMessage({
    type: "generate",
    id: jobId,
    text,
    voice: voiceEl.value,
    speed: Number(speed()),
  });
});

cancelBtn.addEventListener("click", () => {
  worker.postMessage({ type: "cancel", id: jobId });
  cancelBtn.disabled = true;
  jobLabel.textContent = "Останавливаю после текущего фрагмента…";
});

playBtn.addEventListener("click", () => {
  player.toggle();
});

let resumeAfterSeek = false;

function startSeek() {
  if (seeking) return;
  seeking = true;
  resumeAfterSeek = player.isPlaying();
  if (resumeAfterSeek) player.pause();
}

function scrub() {
  const total = player.duration();
  if (!total) return;
  const time = (Number(seekEl.value) / 1000) * total;
  timeCurrent.textContent = formatTime(time);
  player.seek(time, false);
}

async function finishSeek() {
  if (!seeking) return;
  seeking = false;
  scrub();
  if (resumeAfterSeek) {
    resumeAfterSeek = false;
    await player.play();
  }
}

seekEl.addEventListener("pointerdown", startSeek);
seekEl.addEventListener("pointerup", finishSeek);
seekEl.addEventListener("pointercancel", finishSeek);
seekEl.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
    startSeek();
  }
});
seekEl.addEventListener("keyup", finishSeek);
seekEl.addEventListener("blur", finishSeek);
seekEl.addEventListener("input", scrub);

saveBtn.addEventListener("click", () => {
  if (!clip) return;
  try {
    const scaled = applyGain(clip.samples, volumeGain());
    downloadBlob(encodeWav(scaled, clip.sampleRate), "speech.wav");
  } catch {
    showError("Не хватило памяти, чтобы собрать WAV.");
    return;
  }
  setStatus("Файл speech.wav сохранён с текущей громкостью.");
});

worker.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "downloading") {
    sawDownload = true;
    bootText.textContent = "Модель скачивается один раз";
    return;
  }

  if (data.type === "download") {
    if (data.percent > 0 && data.percent < 100) sawDownload = true;
    setBootPercent(data.percent);
    if (data.percent >= 100) bootText.textContent = "Подготовка модели…";
    else bootText.textContent = "Модель скачивается один раз";
    return;
  }

  if (data.type === "notice") {
    showNotice(data.message);
    return;
  }

  if (data.type === "ready") {
    modelReady = true;
    fillVoices(data.voices);
    speakBtn.disabled = false;
    boot.hidden = true;
    const where = data.device === "webgpu" ? "видеокарте (WebGPU)" : "процессоре (WASM)";
    if (sawDownload) setStatus(`Модель готова и работает на ${where}.`);
    else setStatus(`Модель уже в кэше браузера и работает на ${where}.`);
    return;
  }

  if (data.id && data.id !== jobId) return;

  if (data.type === "job") {
    setJobProgress(data.index, data.total);
    return;
  }

  if (data.type === "chunk") {
    parts.push({
      samples: data.samples,
      gapBefore: data.gapBefore,
      sampleRate: data.sampleRate,
    });
    setJobProgress(data.index + 1, data.total);
    return;
  }

  if (data.type === "done") {
    cancelBtn.disabled = false;
    setBusy(false);
    if (parts.length === 0) {
      showError("Модель не вернула звук. Попробуйте другую фразу.");
      return;
    }
    const audio = assemble(parts);
    parts = [];
    await useClip({ key: cacheKey(), ...audio }, { play: true });
    return;
  }

  if (data.type === "cancelled") {
    parts = [];
    cancelBtn.disabled = false;
    setBusy(false);
    setStatus(clip ? "Озвучка отменена. Прежний звук на месте." : "Озвучка отменена.");
    return;
  }

  if (data.type === "error") {
    parts = [];
    cancelBtn.disabled = false;
    if (data.phase === "load") {
      bootText.textContent = "Модель скачивается один раз";
      showError(data.message);
      return;
    }
    setBusy(false);
    showError(data.message);
  }
});

worker.addEventListener("error", () => {
  showError("Сбой в модуле озвучки. Обновите страницу. Если WebGPU нет, страница сама перейдёт на процессор.");
});

async function detectWebGPU() {
  try {
    if (!navigator.gpu) return false;
    const detected = await Promise.race([
      navigator.gpu.requestAdapter(),
      new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    return !!detected;
  } catch {
    return false;
  }
}

const gpu = await detectWebGPU();
const lowMemory = typeof navigator.deviceMemory === "number" && navigator.deviceMemory < 4;
worker.postMessage({ type: "init", gpu, lowMemory });
