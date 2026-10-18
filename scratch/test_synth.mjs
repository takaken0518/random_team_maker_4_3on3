// scratch/test_synth.mjs
// Node.js script to simulate the DSP synthesis of playImpact and generate a WAV file for inspection

import fs from 'fs';
import path from 'path';

function createWavHeader(sampleRate, numChannels, numSamples) {
  const buffer = Buffer.alloc(44);
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = numSamples * numChannels * 2;

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // BitsPerSample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

const SAMPLE_RATE = 44100;
const DURATION = 1.6; // 1.6 seconds
const totalSamples = Math.floor(SAMPLE_RATE * DURATION);

const left = new Float32Array(totalSamples);
const right = new Float32Array(totalSamples);

// 1. LAYER 1: Deep Cinematic Sub-Drop (血界戦線・サイバーパンクの重量級サブドロップ)
// Pitch drops from 105Hz down to 34Hz
for (let i = 0; i < totalSamples; i++) {
  const t = i / SAMPLE_RATE;
  if (t > 1.2) continue;

  // Pitch envelope: fast drop in first 0.15s, then slow glide
  const freq = 34 + 71 * Math.exp(-t * 6.5);
  // Phase integration
  // Instant attack, punchy sustain, smooth exponential decay
  const subEnv = Math.min(1, t / 0.003) * Math.exp(-t * 3.2);

  // Sub sine
  const phase = 2 * Math.PI * (34 * t + (71 / 6.5) * (1 - Math.exp(-t * 6.5)));
  let subSample = Math.sin(phase);

  // Warm saturation (analog warmth / 2nd harmonic)
  subSample = Math.tanh(subSample * 1.4) * 0.75;

  const amp = subSample * subEnv * 0.7;
  left[i] += amp;
  right[i] += amp;
}

// 2. LAYER 2: Physical Metallic Katana / Trion Blade Modal Resonance (ワールドトリガー「シャキィィン！」)
// Modes of a struck metallic bar / blade: f0 = 1200Hz
const modes = [
  { freq: 1180, decay: 1.8, gain: 0.28, pan: -0.15 },
  { freq: 2080, decay: 1.4, gain: 0.22, pan: 0.15 },
  { freq: 3150, decay: 0.9, gain: 0.18, pan: -0.25 },
  { freq: 4720, decay: 0.6, gain: 0.14, pan: 0.25 },
  { freq: 7200, decay: 0.35, gain: 0.10, pan: 0.0 },
  { freq: 9600, decay: 0.18, gain: 0.08, pan: 0.1 },
];

modes.forEach(mode => {
  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    if (t > mode.decay) continue;
    const env = Math.min(1, t / 0.001) * Math.exp(-t / (mode.decay * 0.28));
    // slight FM chirp at onset (first 20ms) for blade edge sharpness
    const chirp = 1 + 0.35 * Math.exp(-t * 120);
    const phase = 2 * Math.PI * mode.freq * chirp * t;
    const s = Math.sin(phase) * env * mode.gain;

    left[i] += s * (1 - mode.pan * 0.5);
    right[i] += s * (1 + mode.pan * 0.5);
  }
});

// 3. LAYER 3: High-Energy Transient Crack / Cyber Arc (ガシッ！バシッ！)
// Initial 25ms shaped noise crack with resonance
for (let i = 0; i < Math.floor(SAMPLE_RATE * 0.04); i++) {
  const t = i / SAMPLE_RATE;
  const env = Math.exp(-t * 90);
  const noise = (Math.random() * 2 - 1) * env * 0.35;
  // Bandpass flavor
  const snap = Math.sin(2 * Math.PI * (3500 * Math.exp(-t * 60)) * t) * env * 0.45;
  left[i] += (noise + snap) * 0.7;
  right[i] += (noise + snap) * 0.7;
}

// 4. Soft limiter / master bus
let maxPeak = 0;
for (let i = 0; i < totalSamples; i++) {
  // Soft saturation
  left[i] = Math.tanh(left[i] * 1.15);
  right[i] = Math.tanh(right[i] * 1.15);
  if (Math.abs(left[i]) > maxPeak) maxPeak = Math.abs(left[i]);
  if (Math.abs(right[i]) > maxPeak) maxPeak = Math.abs(right[i]);
}

console.log(`Max peak level: ${maxPeak.toFixed(3)}`);

// Write 16-bit PCM WAV
const pcmBuffer = Buffer.alloc(totalSamples * 4);
for (let i = 0; i < totalSamples; i++) {
  const l = Math.max(-1, Math.min(1, left[i])) * 32767;
  const r = Math.max(-1, Math.min(1, right[i])) * 32767;
  pcmBuffer.writeInt16LE(Math.round(l), i * 4);
  pcmBuffer.writeInt16LE(Math.round(r), i * 4 + 2);
}

const header = createWavHeader(SAMPLE_RATE, 2, totalSamples);
const wavPath = path.resolve('scratch/test_impact.wav');
if (!fs.existsSync('scratch')) fs.mkdirSync('scratch');
fs.writeFileSync(wavPath, Buffer.concat([header, pcmBuffer]));
console.log(`WAV generated at ${wavPath}, size: ${fs.statSync(wavPath).size} bytes`);
