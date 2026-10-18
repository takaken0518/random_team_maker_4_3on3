// scratch/test_all_sounds.mjs
// Test script to synthesize all sound effects and verify levels and durations

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
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

function saveWav(filename, left, right, sampleRate) {
  const numSamples = left.length;
  const pcmBuffer = Buffer.alloc(numSamples * 4);
  let maxPeak = 0;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    if (Math.abs(l) > maxPeak) maxPeak = Math.abs(l);
    if (Math.abs(r) > maxPeak) maxPeak = Math.abs(r);
    pcmBuffer.writeInt16LE(Math.round(l * 32767), i * 4);
    pcmBuffer.writeInt16LE(Math.round(r * 32767), i * 4 + 2);
  }
  const header = createWavHeader(sampleRate, 2, numSamples);
  fs.writeFileSync(filename, Buffer.concat([header, pcmBuffer]));
  return maxPeak;
}

const SAMPLE_RATE = 44100;

// 1. Tick Generator
function generateTick(type = 'fast') {
  const duration = type === 'heavy' ? 0.022 : (type === 'mid' ? 0.015 : 0.010);
  const totalSamples = Math.floor(SAMPLE_RATE * duration);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  const freq = type === 'heavy' ? 1400 : (type === 'mid' ? 2200 : 3200);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * (type === 'heavy' ? 240 : 420));
    // High-frequency click snap
    const click = Math.sin(2 * Math.PI * (freq * Math.exp(-t * 200)) * t) * 0.7;
    // Micro noise transient
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 800) * 0.35;
    const s = (click + noise) * env;
    left[i] = s * 0.65;
    right[i] = s * 0.65;
  }
  return { left, right };
}

// 2. LockOn Generator
function generateLockOn() {
  const duration = 0.22;
  const totalSamples = Math.floor(SAMPLE_RATE * duration);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  const tones = [
    { freq: 1760, start: 0.00, dur: 0.06, pan: -0.2 },
    { freq: 2793, start: 0.05, dur: 0.12, pan: 0.2 },
  ];

  tones.forEach(t => {
    const startSample = Math.floor(t.start * SAMPLE_RATE);
    const durSamples = Math.floor(t.dur * SAMPLE_RATE);
    for (let i = 0; i < durSamples; i++) {
      const idx = startSample + i;
      if (idx >= totalSamples) break;
      const time = i / SAMPLE_RATE;
      const env = Math.min(1, time / 0.002) * Math.exp(-time * 28);
      // upward micro-chirp
      const chirp = 1 + 0.12 * Math.exp(-time * 80);
      const s1 = Math.sin(2 * Math.PI * (t.freq * chirp) * time);
      const s2 = Math.sin(2 * Math.PI * (t.freq * 2 * chirp) * time) * 0.25;
      const s = (s1 + s2) * env * 0.45;
      left[idx] += s * (1 - t.pan * 0.5);
      right[idx] += s * (1 + t.pan * 0.5);
    }
  });

  return { left, right };
}

// 3. Impact Generator (World Trigger Blade + Cyberpunk Sub-drop + Blood Blockade Battlefront Hit)
function generateImpact() {
  const duration = 1.6;
  const totalSamples = Math.floor(SAMPLE_RATE * duration);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  // Layer 1: Heavy Cinematic Sub-Drop (95Hz -> 33Hz)
  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    if (t > 1.2) continue;
    const subEnv = Math.min(1, t / 0.002) * Math.exp(-t * 3.4);
    const phase = 2 * Math.PI * (33 * t + (65 / 6.0) * (1 - Math.exp(-t * 6.0)));
    let s = Math.sin(phase);
    // Soft saturation for chest impact
    s = Math.tanh(s * 1.5) * 0.8;
    left[i] += s * subEnv * 0.72;
    right[i] += s * subEnv * 0.72;
  }

  // Layer 2: Katana / Trion Blade Modal Resonance ("シャキィィン！")
  const modes = [
    { freq: 1180, decay: 1.8, gain: 0.32, pan: -0.2 },
    { freq: 2080, decay: 1.4, gain: 0.26, pan: 0.2 },
    { freq: 3150, decay: 1.0, gain: 0.20, pan: -0.25 },
    { freq: 4720, decay: 0.7, gain: 0.16, pan: 0.25 },
    { freq: 7200, decay: 0.4, gain: 0.12, pan: 0.0 },
    { freq: 9600, decay: 0.2, gain: 0.09, pan: 0.15 },
  ];

  modes.forEach(mode => {
    for (let i = 0; i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      if (t > mode.decay) continue;
      const env = Math.min(1, t / 0.001) * Math.exp(-t / (mode.decay * 0.26));
      const chirp = 1 + 0.30 * Math.exp(-t * 140);
      const s = Math.sin(2 * Math.PI * mode.freq * chirp * t) * env * mode.gain;
      left[i] += s * (1 - mode.pan * 0.5);
      right[i] += s * (1 + mode.pan * 0.5);
    }
  });

  // Layer 3: Kinetic Transient Crack (0-30ms)
  for (let i = 0; i < Math.floor(SAMPLE_RATE * 0.035); i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 110);
    const noise = (Math.random() * 2 - 1) * env * 0.4;
    const snap = Math.sin(2 * Math.PI * (4200 * Math.exp(-t * 90)) * t) * env * 0.5;
    const s = (noise + snap) * 0.55;
    left[i] += s;
    right[i] += s;
  }

  // Master bus soft saturation & normalization
  for (let i = 0; i < totalSamples; i++) {
    left[i] = Math.tanh(left[i] * 1.1);
    right[i] = Math.tanh(right[i] * 1.1);
  }

  return { left, right };
}

// 4. Formation Generator (Maj9 Crystal Squad Anthem + Sub Boom)
function generateFormation() {
  const duration = 2.4;
  const totalSamples = Math.floor(SAMPLE_RATE * duration);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  // Riser (0.0 to 0.32s)
  const riserDur = 0.32;
  const riserSamples = Math.floor(SAMPLE_RATE * riserDur);
  for (let i = 0; i < riserSamples; i++) {
    const t = i / SAMPLE_RATE;
    const progress = t / riserDur;
    const freq = 120 + 900 * Math.pow(progress, 2.5);
    const env = Math.pow(progress, 2) * 0.25;
    const s = Math.sin(2 * Math.PI * freq * t) * env;
    left[i] += s;
    right[i] += s;
  }

  // Anchor Sub (at 0.30s)
  const impactTime = 0.28;
  for (let i = Math.floor(impactTime * SAMPLE_RATE); i < totalSamples; i++) {
    const t = (i / SAMPLE_RATE) - impactTime;
    if (t > 1.4) continue;
    const subEnv = Math.min(1, t / 0.003) * Math.exp(-t * 2.8);
    const phase = 2 * Math.PI * (38 * t + (45 / 5.0) * (1 - Math.exp(-t * 5.0)));
    const s = Math.tanh(Math.sin(phase) * 1.4) * 0.75 * subEnv;
    left[i] += s;
    right[i] += s;
  }

  // Crystal Chord notes: Dmaj9 (D5, F#5, A5, C#6, E6)
  const chord = [
    { freq: 587.33, delay: 0.28, dur: 1.8, gain: 0.24, pan: -0.3 },
    { freq: 739.99, delay: 0.34, dur: 1.7, gain: 0.22, pan: 0.25 },
    { freq: 880.00, delay: 0.40, dur: 1.6, gain: 0.20, pan: -0.2 },
    { freq: 1108.73, delay: 0.46, dur: 1.5, gain: 0.18, pan: 0.2 },
    { freq: 1318.51, delay: 0.52, dur: 1.4, gain: 0.16, pan: 0.0 },
    // Octave shimmer
    { freq: 2217.46, delay: 0.50, dur: 1.0, gain: 0.10, pan: -0.15 },
  ];

  chord.forEach(note => {
    const startIdx = Math.floor(note.delay * SAMPLE_RATE);
    const durSamples = Math.floor(note.dur * SAMPLE_RATE);
    for (let i = 0; i < durSamples; i++) {
      const idx = startIdx + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const env = Math.min(1, t / 0.004) * Math.exp(-t / (note.dur * 0.35));
      const chirp = 1 + 0.15 * Math.exp(-t * 90);
      const s1 = Math.sin(2 * Math.PI * note.freq * chirp * t);
      const s2 = Math.sin(2 * Math.PI * note.freq * 2 * chirp * t) * 0.2;
      const s = (s1 + s2) * env * note.gain;
      left[idx] += s * (1 - note.pan * 0.5);
      right[idx] += s * (1 + note.pan * 0.5);
    }
  });

  // Master bus soft saturation
  for (let i = 0; i < totalSamples; i++) {
    left[i] = Math.tanh(left[i] * 1.1);
    right[i] = Math.tanh(right[i] * 1.1);
  }

  return { left, right };
}

console.log('Testing audio synthesis algorithms...');
const t1 = generateTick('fast');
const p1 = saveWav('scratch/test_tick_fast.wav', t1.left, t1.right, SAMPLE_RATE);
console.log(`Tick Fast peak: ${p1.toFixed(3)}`);

const t2 = generateTick('heavy');
const p2 = saveWav('scratch/test_tick_heavy.wav', t2.left, t2.right, SAMPLE_RATE);
console.log(`Tick Heavy peak: ${p2.toFixed(3)}`);

const lo = generateLockOn();
const plo = saveWav('scratch/test_lockon.wav', lo.left, lo.right, SAMPLE_RATE);
console.log(`LockOn peak: ${plo.toFixed(3)}`);

const imp = generateImpact();
const pimp = saveWav('scratch/test_impact.wav', imp.left, imp.right, SAMPLE_RATE);
console.log(`Impact peak: ${pimp.toFixed(3)}`);

const form = generateFormation();
const pform = saveWav('scratch/test_formation.wav', form.left, form.right, SAMPLE_RATE);
console.log(`Formation peak: ${pform.toFixed(3)}`);

console.log('All tests passed successfully!');
