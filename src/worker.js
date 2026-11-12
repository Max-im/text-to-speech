import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";
import { splitForSpeech } from "./split.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

const wasm = env.backends?.onnx?.wasm;
if (wasm) {
  wasm.numThreads = crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
}

let tts = null;
let activeId = 0;
let cancelId = 0;
let running = false;
let booting = false;
const files = new Map();
let shownPercent = 0;

function post(message, transfer) {
  self.postMessage(message, transfer || []);
}

function friendlyError(error) {
  const raw = String(error?.message || error || "unknown error");
  if (/out of memory|oom|allocation|cannot allocate|not enough memory/i.test(raw)) {
    return "Не хватило памяти. Закройте другие вкладки или сократите текст.";
  }
  if (/phonem|espeak|dictionary/i.test(raw)) {
    return "Не удалось скачать словарь произношения. Проверьте интернет и обновите страницу.";
  }
  if (/failed to fetch|networkerror|network error|net::/i.test(raw)) {
    return "Не удалось скачать модель. Проверьте интернет и обновите страницу.";
  }
  return `Не удалось озвучить текст: ${raw}`;
}

function reportPercent(percent) {
  const next = Math.max(shownPercent, Math.min(100, percent));
  shownPercent = next;
  post({ type: "download", percent: next });
}

function onProgress(info) {
  if (!info || typeof info !== "object") return;

  if (info.status === "progress" && info.file) {
    const loaded = Number(info.loaded) || 0;
    const total = Number(info.total) || 0;
    files.set(info.file, { loaded, total });
    if (total > 0 && loaded < total) post({ type: "downloading" });

    let sumLoaded = 0;
    let sumTotal = 0;
    for (const file of files.values()) {
      sumLoaded += file.loaded;
      if (file.total > 0) sumTotal += file.total;
    }
    if (sumTotal > 0) reportPercent(Math.round((sumLoaded / sumTotal) * 100));
    return;
  }

  if (info.status === "progress_total") {
    const loaded = Number(info.loaded) || 0;
    const total = Number(info.total) || 0;
    if (total > 0) {
      if (loaded < total) post({ type: "downloading" });
      reportPercent(Math.round((loaded / total) * 100));
      return;
    }
    if (typeof info.progress === "number") {
      const value = info.progress <= 1 ? info.progress * 100 : info.progress;
      reportPercent(Math.round(value));
    }
  }
}

function chooseDevice(gpu, lowMemory) {
  if (!gpu) {
    return {
      device: "wasm",
      dtype: "q8",
      notice: "WebGPU недоступен. Модель работает на процессоре (WASM).",
    };
  }
  if (lowMemory) {
    return {
      device: "wasm",
      dtype: "q8",
      notice: "Мало памяти для видеокарты. Модель работает на процессоре (WASM).",
    };
  }
  return { device: "webgpu", dtype: "fp32", notice: "" };
}

async function loadWith(device, dtype) {
  files.clear();
  shownPercent = 0;
  return KokoroTTS.from_pretrained(MODEL_ID, {
    dtype,
    device,
    progress_callback: onProgress,
  });
}

async function boot(gpu, lowMemory) {
  const choice = chooseDevice(gpu, lowMemory);
  if (choice.notice) post({ type: "notice", message: choice.notice });

  try {
    tts = await loadWith(choice.device, choice.dtype);
    post({
      type: "ready",
      device: choice.device,
      voices: Object.keys(tts.voices),
    });
    return;
  } catch (error) {
    if (choice.device !== "webgpu") {
      post({ type: "error", phase: "load", message: friendlyError(error) });
      return;
    }
  }

  post({
    type: "notice",
    message: "WebGPU не запустился. Скачиваю модель для процессора (WASM).",
  });

  try {
    tts = await loadWith("wasm", "q8");
    post({ type: "ready", device: "wasm", voices: Object.keys(tts.voices) });
  } catch (error) {
    post({ type: "error", phase: "load", message: friendlyError(error) });
  }
}

function trimEdges(samples, trimStart, trimEnd) {
  const threshold = 0.008;
  const pad = 480;
  let start = 0;
  let end = samples.length;

  if (trimStart) {
    while (start < end && Math.abs(samples[start]) < threshold) start += 1;
    start = Math.max(0, start - pad);
  }
  if (trimEnd) {
    while (end > start && Math.abs(samples[end - 1]) < threshold) end -= 1;
    end = Math.min(samples.length, end + pad);
  }

  return start === 0 && end === samples.length ? samples : samples.slice(start, end);
}

async function generate(id, text, voice, speed) {
  if (!tts) {
    post({ type: "error", id, message: "Модель ещё не загружена." });
    return;
  }

  const chunks = splitForSpeech(text);
  if (chunks.length === 0) {
    post({ type: "error", id, message: "В тексте нет слов для озвучки." });
    return;
  }

  post({ type: "job", id, index: 0, total: chunks.length });

  for (let i = 0; i < chunks.length; i += 1) {
    if (cancelId === id || activeId !== id) {
      post({ type: "cancelled", id });
      return;
    }

    post({ type: "job", id, index: i, total: chunks.length });

    let audio;
    try {
      audio = await tts.generate(chunks[i].text, { voice, speed });
    } catch (error) {
      post({ type: "error", id, message: friendlyError(error) });
      return;
    }

    if (cancelId === id || activeId !== id) {
      post({ type: "cancelled", id });
      return;
    }

    const samples = trimEdges(new Float32Array(audio.audio), i > 0, i < chunks.length - 1);

    post({
      type: "chunk",
      id,
      index: i,
      total: chunks.length,
      gapBefore: chunks[i].gapBefore,
      sampleRate: audio.sampling_rate,
      samples,
    }, [samples.buffer]);
  }

  if (cancelId === id || activeId !== id) {
    post({ type: "cancelled", id });
    return;
  }

  post({ type: "done", id });
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "init") {
    if (booting) return;
    booting = true;
    boot(data.gpu, data.lowMemory);
    return;
  }

  if (data.type === "cancel") {
    cancelId = data.id;
    return;
  }

  if (data.type === "generate") {
    if (running) return;
    running = true;
    activeId = data.id;
    generate(data.id, data.text, data.voice, Number(data.speed)).finally(() => {
      running = false;
    });
  }
});
