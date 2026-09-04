let audioContext = null;
let lastMarkerSoundTime = 0;

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

export function resumeAudioContext() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

export function playMarkerDetectedSound() {
  const now = performance.now();
  if (now - lastMarkerSoundTime < 900) {
    return;
  }
  lastMarkerSoundTime = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(720, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(980, ctx.currentTime + 0.12);

  gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.36);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.38);
}

export function playPlacementReadySound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const startTime = ctx.currentTime;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(520, startTime);
  oscillator.frequency.exponentialRampToValueAtTime(780, startTime + 0.12);

  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.exponentialRampToValueAtTime(0.16, startTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.28);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + 0.3);
}
