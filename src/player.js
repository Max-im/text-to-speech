/**
 * Playback through Web Audio so volume can change live and a long
 * generation can still start without a second click.
 */
export function createPlayer({ onTick, onState }) {
  let ctx = null;
  let gain = null;
  let source = null;
  let buffer = null;
  let playing = false;
  let offset = 0;
  let startedAt = 0;
  let volume = 1;
  let frame = 0;
  let chain = Promise.resolve();

  function run(task) {
    const next = chain.then(task, task);
    chain = next.then(() => {}, () => {});
    return next;
  }

  function emit() {
    onTick(currentTime(), duration());
    onState(playing);
  }

  function loop() {
    emit();
    if (playing) frame = requestAnimationFrame(loop);
  }

  function ensureGraph() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
      gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
    }
    return ctx;
  }

  function stopSource() {
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source.disconnect();
    source = null;
  }

  function duration() {
    return buffer ? buffer.duration : 0;
  }

  function currentTime() {
    if (!buffer) return 0;
    if (!playing || !ctx) return Math.min(offset, buffer.duration);
    const elapsed = offset + (ctx.currentTime - startedAt);
    return Math.min(Math.max(0, elapsed), buffer.duration);
  }

  async function resumeNow() {
    const audio = ensureGraph();
    if (audio.state !== "running") await audio.resume();
    return audio.state;
  }

  async function startNow() {
    const state = await resumeNow();
    if (!buffer || buffer.length === 0) return state;
    if (offset >= buffer.duration - 0.02) offset = 0;

    stopSource();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const startOffset = offset;
    source.onended = () => {
      if (!playing) return;
      playing = false;
      offset = buffer.duration;
      source = null;
      cancelAnimationFrame(frame);
      emit();
    };
    source.start(0, startOffset);
    startedAt = ctx.currentTime;
    playing = true;
    cancelAnimationFrame(frame);
    loop();
    return state;
  }

  function pauseNow() {
    if (!playing) return;
    offset = currentTime();
    playing = false;
    stopSource();
    cancelAnimationFrame(frame);
    emit();
  }

  function setVolume(value) {
    volume = Math.max(0, Math.min(1, value));
    if (gain) gain.gain.value = volume;
  }

  function load(samples, sampleRate) {
    return run(async () => {
      const audio = ensureGraph();
      playing = false;
      stopSource();
      cancelAnimationFrame(frame);
      buffer = audio.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      offset = 0;
      emit();
    });
  }

  function play() {
    return run(() => startNow());
  }

  function pause() {
    return run(() => pauseNow());
  }

  function seek(time, keepPlaying) {
    return run(async () => {
      if (!buffer) return;
      const wasPlaying = keepPlaying ?? playing;
      offset = Math.min(Math.max(0, time), buffer.duration);
      playing = false;
      stopSource();
      cancelAnimationFrame(frame);
      if (wasPlaying && offset < buffer.duration - 0.02) await startNow();
      else emit();
    });
  }

  function toggle() {
    return playing ? pause() : play();
  }

  return {
    resume: () => run(() => resumeNow()),
    setVolume,
    load,
    play,
    pause,
    seek,
    toggle,
    currentTime,
    duration: () => duration(),
    isPlaying: () => playing,
  };
}
