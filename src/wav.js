/**
 * Linear gain used both for playback and for the saved file.
 * @param {Float32Array} samples
 * @param {number} gain 0..1
 */
export function applyGain(samples, gain) {
  const g = Math.max(0, Math.min(1, gain));
  if (g === 1) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] * g;
    out[i] = v < -1 ? -1 : v > 1 ? 1 : v;
  }
  return out;
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

/** 16-bit PCM WAV so a normal player matches the page. */
export function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const pcm = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    view.setInt16(offset, Math.max(-0x8000, Math.min(0x7fff, pcm)), true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
