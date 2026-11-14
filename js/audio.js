/**
 * audio.js - ElevenLabs 生成効果音 (MP3) 再生エンジン (Web Audio API)
 */

import { store } from './state.js';

const SOUND_FILES = {
  tickFast: './audio/tickFast.mp3',
  tickHeavy: './audio/tickHeavy.mp3',
  decodeBlip: './audio/decodeBlip.mp3',
  lockOn: './audio/lockOn.mp3',
  impact: './audio/impact.mp3',
  formation: './audio/formation.mp3',
  fanfare: './audio/fanfare.mp3',
};

class SoundPlayer {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.limiter = null;
    this.buffers = {};
    this.initialized = false;
    this.loadingPromise = null;
  }

  /**
   * ユーザー操作時に AudioContext を初期化し、効果音 MP3 を一括ロード
   */
  init() {
    if (this.initialized && this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.setValueAtTime(-1.5, this.ctx.currentTime);
      this.limiter.knee.setValueAtTime(3.0, this.ctx.currentTime);
      this.limiter.ratio.setValueAtTime(20, this.ctx.currentTime);
      this.limiter.attack.setValueAtTime(0.001, this.ctx.currentTime);
      this.limiter.release.setValueAtTime(0.08, this.ctx.currentTime);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.92, this.ctx.currentTime);

      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);

      this.initialized = true;
      this.preloadAll();
    } catch (e) {
      console.warn('Web Audio API not supported:', e);
    }
  }

  /**
   * audio/*.mp3 を並列で fetch & decode してキャッシュ
   */
  preloadAll() {
    if (this.loadingPromise || !this.ctx) return this.loadingPromise;

    this.loadingPromise = Promise.allSettled(
      Object.entries(SOUND_FILES).map(async ([key, url]) => {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (!res.ok) return;
          const arrayBuf = await res.arrayBuffer();
          this.buffers[key] = await this.ctx.decodeAudioData(arrayBuf);
        } catch (e) {
          console.warn(`Failed to load sound "${key}":`, e);
        }
      })
    );

    return this.loadingPromise;
  }

  isEnabled() {
    const state = store.getState();
    return state.settings.seEnabled && this.ctx;
  }

  playBuffer(key, { rate = 1.0, gain = 1.0 } = {}) {
    if (!this.isEnabled()) return;
    const buffer = this.buffers[key];
    if (!buffer) return;

    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;

      const g = this.ctx.createGain();
      g.gain.value = gain;

      src.connect(g);
      g.connect(this.masterGain);
      src.start();
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  playTick(progress = 0) {
    this.init();
    const isHeavy = typeof progress === 'number' && progress > 0.65;
    this.playBuffer(isHeavy ? 'tickHeavy' : 'tickFast', {
      rate: 0.97 + Math.random() * 0.06,
      gain: isHeavy ? 0.85 : 0.65,
    });
  }

  playDecodeBlip() {
    this.init();
    this.playBuffer('decodeBlip', {
      rate: 0.95 + Math.random() * 0.1,
      gain: 0.7,
    });
  }

  playLockOn() {
    this.init();
    this.playBuffer('lockOn', { rate: 1.0, gain: 0.9 });
  }

  playImpact() {
    this.init();
    this.playBuffer('impact', { rate: 1.0, gain: 1.0 });
  }

  playFormation() {
    this.init();
    this.playBuffer('formation', { rate: 1.0, gain: 0.95 });
  }

  playFanfare() {
    this.init();
    this.playBuffer('fanfare', { rate: 1.0, gain: 1.0 });
  }
}

export const sound = new SoundPlayer();

