/**
 * audio.js - プロシージャルDSP音響エンジン (Web Audio API)
 *
 * 設計方針:
 * - 単純な生オシレーター（単一Sine波や基本FM）によるチープな音を完全撤廃。
 * - 32bit Float PCMステレオ AudioBuffer による物理モデリングDSP合成キャッシュ方式。
 * - ワールドトリガー（トリガー起動／孤月・スコーピオン抜刀／シールド展開音）
 * - 血界戦線・サイバーパンク（重力サブドロップ／非線形サチュレーション／打撃クラック音）
 * - 劇伴・音響監督クオリティの重厚・鋭利・硬質なサウンドデザイン
 */

import { store } from './state.js';

function saturate(x, drive = 1.4) {
  return Math.tanh(x * drive);
}

class CrispCyberSoundSynthesizer {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.limiter = null;
    this.initialized = false;
    this.buffers = {};
  }

  /**
   * ユーザー操作時にAudioContextおよびDSPバッファキャッシュを初期化
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

      // 1. マスターリミッター（全ヘッドホン／スピーカーでの歪み・クリッピングをゼロ化）
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.setValueAtTime(-1.5, this.ctx.currentTime);
      this.limiter.knee.setValueAtTime(3.0, this.ctx.currentTime);
      this.limiter.ratio.setValueAtTime(20, this.ctx.currentTime);
      this.limiter.attack.setValueAtTime(0.001, this.ctx.currentTime);
      this.limiter.release.setValueAtTime(0.08, this.ctx.currentTime);

      // 2. マスターゲイン
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.92, this.ctx.currentTime);

      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);

      // 3. DSPプロシージャル・オーディオバッファの事前生成（約15〜25msで一括生成）
      this.generateAllBuffers();

      this.initialized = true;
    } catch (e) {
      console.warn('Web Audio API not supported:', e);
    }
  }

  isEnabled() {
    const state = store.getState();
    return state.settings.seEnabled && this.ctx;
  }

  /**
   * 事前生成バッファの即時再生（0msレイテンシ）
   */
  playBuffer(buffer, { rate = 1.0, gain = 1.0 } = {}) {
    if (!this.isEnabled() || !buffer || !this.ctx) return;
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

  /**
   * 全DSPオーディオバッファの合成とキャッシュ
   */
  generateAllBuffers() {
    const sr = this.ctx.sampleRate || 44100;
    this.buffers.impact = this.buildImpactBuffer(sr);
    this.buffers.lockOn = this.buildLockOnBuffer(sr);
    this.buffers.tickFast = this.buildTickFastBuffer(sr);
    this.buffers.tickHeavy = this.buildTickHeavyBuffer(sr);
    this.buffers.decodeBlip = this.buildDecodeBlipBuffer(sr);
    this.buffers.formation = this.buildFormationBuffer(sr);
    this.buffers.fanfare = this.buildFanfareBuffer(sr);
  }

  /**
   * 簡易ワンポールLPF（in-place）
   */
  lowpass(arr, cutoff, sr) {
    const a = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
    let y = 0;
    for (let i = 0; i < arr.length; i++) {
      y += a * (arr[i] - y);
      arr[i] = y;
    }
  }

  /**
   * 暗く広い空間リバーブ（コムフィルタ並列 ＋ LPFフィードバック, in-place）
   */
  reverb(L, R, sr, { mix = 0.35, decay = 0.78, damp = 2400 } = {}) {
    const len = L.length;
    const delaysL = [0.0297, 0.0371, 0.0411, 0.0437];
    const delaysR = [0.0313, 0.0389, 0.0429, 0.0461];
    const damper = Math.exp(-2 * Math.PI * damp / sr);
    const run = (src, delays) => {
      const out = new Float32Array(len);
      for (const d of delays) {
        const n = Math.floor(d * sr);
        const buf = new Float32Array(len);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const fb = i >= n ? buf[i - n] : 0;
          lp = fb * (1 - damper) + lp * damper;
          buf[i] = src[i] + lp * decay;
          out[i] += buf[i] * 0.25;
        }
      }
      return out;
    };
    const wetL = run(L, delaysL);
    const wetR = run(R, delaysR);
    for (let i = 0; i < len; i++) {
      L[i] = L[i] * (1 - mix * 0.5) + wetL[i] * mix;
      R[i] = R[i] * (1 - mix * 0.5) + wetR[i] * mix;
    }
  }

  /**
   * 仕上げ：ソフトサチュレーション ＋ 端フェード
   */
  finalize(L, R, sr, drive = 1.1, level = 0.85) {
    const len = L.length;
    const fade = Math.floor(sr * 0.04);
    for (let i = 0; i < len; i++) {
      let f = 1;
      if (i > len - fade) f = (len - i) / fade;
      L[i] = saturate(L[i], drive) * level * f;
      R[i] = saturate(R[i], drive) * level * f;
    }
  }

  /**
   * 1. 決定インパクト音
   * 逆再生風ライザー → 重力サブドロップ → 暗い非整数倍音のメタルベル → 広大な残響
   */
  buildImpactBuffer(sr) {
    const duration = 3.0;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const hit = 0.38; // 衝突タイミング

    const bellModes = [
      { r: 1.0, decay: 1.8, amp: 0.50 },
      { r: 2.01, decay: 1.4, amp: 0.30 },
      { r: 2.76, decay: 1.2, amp: 0.28 },
      { r: 5.40, decay: 0.8, amp: 0.14 },
      { r: 8.93, decay: 0.45, amp: 0.06 },
    ];
    const base = 164.8; // E3

    const noise = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (t < hit) {
        // ライザー：フィルタ付きノイズが徐々に膨らむ
        noise[i] = (Math.random() * 2 - 1) * Math.pow(t / hit, 3) * 0.9;
      } else {
        // 衝突後の低域ランブル
        noise[i] = (Math.random() * 2 - 1) * Math.exp(-(t - hit) / 0.9) * 0.8;
      }
    }
    this.lowpass(noise, 520, sr);
    this.lowpass(noise, 700, sr);

    for (let i = 0; i < len; i++) {
      const t = i / sr;

      // ライザー下降するドローン
      let riser = 0;
      if (t < hit) {
        const p = t / hit;
        riser = Math.sin(2 * Math.PI * (55 + 70 * p * p) * t) * p * p * 0.5;
      }

      let sub = 0;
      let bellL = 0;
      let bellR = 0;
      if (t >= hit) {
        const dt = t - hit;
        // サブドロップ（110Hz → 32Hz）
        const subEnv = Math.exp(-dt / 0.95) * Math.min(1, dt / 0.004);
        const phase = 2 * Math.PI * (32 * dt + 78 * (1 - Math.exp(-dt * 7)) / 7);
        sub = saturate(Math.sin(phase) * subEnv * 1.1, 1.8);

        // 暗いメタルベル
        const atk = Math.min(1, dt / 0.006);
        bellModes.forEach((m, k) => {
          const env = Math.exp(-dt / m.decay) * atk;
          const f = base * m.r;
          const v = Math.sin(2 * Math.PI * f * dt) * env * m.amp;
          const v2 = Math.sin(2 * Math.PI * f * 1.004 * dt) * env * m.amp * 0.6;
          bellL += v * (k % 2 ? 0.7 : 1.0) + v2 * 0.4;
          bellR += v * (k % 2 ? 1.0 : 0.7) + v2 * 0.9;
        });
      }

      // ベル(カーン)成分は使用しない：ライザー＋ノイズ＋サブドロップのみ
      L[i] = riser + noise[i] * 0.7 + sub * 0.85;
      R[i] = riser + noise[i] * 0.7 + sub * 0.85;
    }
    this.reverb(L, R, sr, { mix: 0.3, decay: 0.8, damp: 1500 });
    this.finalize(L, R, sr, 1.15, 0.86);
    return buf;
  }

  /**
   * 2. ロックオン音 — 深海ソナーのような低いピング ＋ 反響エコー
   */
  buildLockOnBuffer(sr) {
    const duration = 1.3;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // 音程のあるピングを廃し、低く短いサッド（下降ピッチ）のみ
      const thump = Math.sin(2 * Math.PI * (150 - 300 * Math.min(t, 0.1)) * t) * Math.exp(-t * 14) * Math.min(1, t / 0.002);
      const v = saturate(thump * 0.9, 1.3) * 0.7;
      L[i] = v;
      R[i] = v;
    }
    // 左右にずれる反響エコー
    const dL = Math.floor(sr * 0.22);
    const dR = Math.floor(sr * 0.31);
    for (let i = len - 1; i >= 0; i--) {
      if (i >= dL) L[i] += L[i - dL] * 0.35;
      if (i >= dR) R[i] += R[i - dR] * 0.35;
    }
    this.reverb(L, R, sr, { mix: 0.4, decay: 0.8, damp: 2000 });
    this.finalize(L, R, sr, 1.1, 0.8);
    return buf;
  }

  /**
   * 3. 高速ルーレット音 — 柔らかく重い機械的な低域パルス
   */
  buildTickFastBuffer(sr) {
    const duration = 0.07;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const n = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      n[i] = (Math.random() * 2 - 1) * Math.exp(-t * 180);
    }
    this.lowpass(n, 1800, sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const body = Math.sin(2 * Math.PI * (130 - 400 * t) * t) * Math.exp(-t * 75);
      const v = saturate(body * 0.9 + n[i] * 0.5, 1.3) * 0.55;
      L[i] = v;
      R[i] = v;
    }
    this.finalize(L, R, sr, 1.0, 0.9);
    return buf;
  }

  /**
   * 4. 減速時スキャン音 — より深く不穏な低域ヒット
   */
  buildTickHeavyBuffer(sr) {
    const duration = 0.22;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const body = Math.sin(2 * Math.PI * (95 - 180 * t) * t) * Math.exp(-t * 22);
      const tone = Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t * 14) * 0.3
        + Math.sin(2 * Math.PI * 607 * t) * Math.exp(-t * 20) * 0.12;
      const v = saturate(body * 1.0 + tone, 1.4) * 0.65;
      L[i] = v;
      R[i] = v;
    }
    this.reverb(L, R, sr, { mix: 0.25, decay: 0.7, damp: 1800 });
    this.finalize(L, R, sr, 1.0, 0.9);
    return buf;
  }

  /**
   * 5. デコード音 — 抑えた低めのデータパルス
   */
  buildDecodeBlipBuffer(sr) {
    const duration = 0.05;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 85) * Math.min(1, t / 0.002);
      const v = (Math.sin(2 * Math.PI * 740 * t) + 0.4 * Math.sin(2 * Math.PI * 1110 * t)) * env * 0.2;
      L[i] = v;
      R[i] = v;
    }
    this.finalize(L, R, sr, 1.0, 0.9);
    return buf;
  }

  /**
   * 6. チーム決定音 — 中音域の長調アルペジオ ＋ やや厚いキック（暗すぎず明るすぎない）
   */
  buildFormationBuffer(sr) {
    const duration = 2.2;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);

    // 中間の明るさ：A3 / C#4 / E4 / F#4 / A4 の上昇フレーズ（Aメジャー＋6度）
    // 最後の A4 を少し長めに響かせて前向きな着地感を出す
    const notes = [
      { f: 220.0, t: 0.00, pan: -0.3 },
      { f: 277.18, t: 0.11, pan: 0.3 },
      { f: 329.63, t: 0.22, pan: -0.2 },
      { f: 369.99, t: 0.33, pan: 0.2 },
      { f: 440.0, t: 0.46, pan: 0.0 },
    ];

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let vL = 0;
      let vR = 0;
      for (const n of notes) {
        const dt = t - n.t;
        if (dt < 0) continue;
        const env = Math.exp(-dt / 0.45) * Math.min(1, dt / 0.004);
        const v = (Math.sin(2 * Math.PI * n.f * dt) + 0.2 * Math.sin(2 * Math.PI * n.f * 2 * dt) * Math.exp(-dt * 6)) * env * 0.32;
        vL += v * (1 - n.pan);
        vR += v * (1 + n.pan);
      }
      // やや厚いキック
      const kick = Math.sin(2 * Math.PI * (90 - 180 * Math.min(t, 0.1)) * t) * Math.exp(-t * 9) * Math.min(1, t / 0.002) * 0.7;
      L[i] = vL + kick;
      R[i] = vR + kick;
    }
    this.reverb(L, R, sr, { mix: 0.3, decay: 0.78, damp: 2800 });
    this.finalize(L, R, sr, 1.0, 0.85);
    return buf;
  }

  /**
   * （旧）部隊結成音 — 低く唸るマイナードローン ＋ 暗いベル ＋ サブアンカー。現在は未使用
   */
  buildFormationBufferDark(sr) {
    const duration = 3.4;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);

    // D2 / A2 / D3 / F3 / A3 の暗いマイナー・オープンボイシング
    const drone = [73.42, 110.0, 146.83, 174.61, 220.0];
    const bells = [
      { f: 293.66, t: 0.55, pan: -0.4 },
      { f: 349.23, t: 0.80, pan: 0.4 },
      { f: 440.0, t: 1.05, pan: -0.15 },
    ];

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // スウェル → 緩やかな減衰
      const swell = Math.pow(Math.min(1, t / 0.9), 1.8) * Math.exp(-Math.max(0, t - 1.0) / 1.5);
      let dL = 0;
      let dR = 0;
      drone.forEach((f, k) => {
        const det = 1 + (k % 2 ? 0.0035 : -0.0035);
        const lfo = 1 + 0.25 * Math.sin(2 * Math.PI * (0.35 + k * 0.07) * t);
        const a = Math.sin(2 * Math.PI * f * t);
        const b = Math.sin(2 * Math.PI * f * det * t + k);
        // 奇数倍音を足して中空感のある音色に
        const c = Math.sin(2 * Math.PI * f * 3 * t) * 0.12;
        const v = (a + b + c) * lfo * (k === 0 ? 0.55 : 0.28);
        dL += v * (k % 2 ? 0.8 : 1.0);
        dR += v * (k % 2 ? 1.0 : 0.8);
      });
      dL *= swell;
      dR *= swell;

      let sub = 0;
      const st = t - 0.45;
      if (st >= 0) {
        sub = saturate(Math.sin(2 * Math.PI * (36 * st + 50 * (1 - Math.exp(-st * 6)) / 6)) * Math.exp(-st / 1.0) * Math.min(1, st / 0.005), 1.6) * 0.9;
      }

      let bL = 0;
      let bR = 0;
      for (const b of bells) {
        const dt = t - b.t;
        if (dt >= 0) {
          const env = Math.exp(-dt / 1.2) * Math.min(1, dt / 0.005);
          const v = (Math.sin(2 * Math.PI * b.f * dt) + 0.45 * Math.sin(2 * Math.PI * b.f * 2.76 * dt) * Math.exp(-dt * 2)) * env * 0.22;
          bL += v * (1 - b.pan);
          bR += v * (1 + b.pan);
        }
      }

      L[i] = dL * 0.5 + sub * 0.8 + bL;
      R[i] = dR * 0.5 + sub * 0.8 + bR;
    }
    this.reverb(L, R, sr, { mix: 0.5, decay: 0.86, damp: 2000 });
    this.finalize(L, R, sr, 1.1, 0.84);
    return buf;
  }

  /**
   * 7. READY to FIGHT 効果音 — スマブラ風
   * 風切りのライザー → 斬撃（シュパッ）→ オーケストラヒット風の重い一撃（ドンッ＋ブラス和音）＋金属の短い輝き
   * ※ 実際のゲーム音源ではなく、雰囲気を寄せた合成音
   */
  buildFanfareBuffer(sr) {
    const duration = 2.2;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const hit = 0.5; // 衝撃のタイミング（FIGHT!! の着地に合わせる）

    // 風切り＋斬撃ノイズ：ライザー(0〜hit) → 斬撃の高域バースト → 短い余波
    const air = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let env;
      if (t < hit) env = Math.pow(t / hit, 2.2) * 0.9;
      else env = Math.exp(-(t - hit) / 0.16) * 1.0;
      air[i] = (Math.random() * 2 - 1) * env;
    }
    // 帯域：ライザーは中域、斬撃は高域。ローパスで中低域を引いて高域だけ残す
    const mid = Float32Array.from(air);
    this.lowpass(mid, 1800, sr);
    const hi = Float32Array.from(air);
    this.lowpass(hi, 4200, sr);
    for (let i = 0; i < len; i++) hi[i] = air[i] - hi[i];

    // ブラス風の和音（D5 パワーコード：D4/A4/D5/F#5）— ノコギリ波を倍音加算で近似
    const brass = [293.66, 440.0, 587.33, 739.99];
    const saw = (f, t) => {
      let s = 0;
      for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * t) / h;
      return s * 0.5;
    };

    // 金属の輝き（短く減衰）
    const shine = [
      { f: 3150, decay: 0.14, amp: 0.25 },
      { f: 4820, decay: 0.10, amp: 0.16 },
    ];

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let v = mid[i] * 0.35 + hi[i] * (t < hit ? 0.5 : 0.8);

      if (t >= hit) {
        const dt = t - hit;
        const atk = Math.min(1, dt / 0.004);

        // ドン：低域の一撃（ピッチ下降）
        const boom = Math.sin(2 * Math.PI * (120 - 260 * Math.min(dt, 0.12)) * dt) * Math.exp(-dt / 0.28) * 0.9;

        // オーケストラヒット：ブラス和音の短いスタブ
        const stabEnv = Math.exp(-dt / 0.38) * atk;
        let stab = 0;
        for (const f of brass) stab += saw(f, dt);
        stab *= stabEnv * 0.2;

        // 金属の輝き
        let ring = 0;
        for (const m of shine) ring += Math.sin(2 * Math.PI * m.f * dt) * Math.exp(-dt / m.decay) * m.amp;

        v += boom + stab + ring;
      }
      L[i] = v;
      R[i] = v;
    }
    // 少しだけ空間の広がり
    this.reverb(L, R, sr, { mix: 0.22, decay: 0.72, damp: 4500 });
    this.finalize(L, R, sr, 1.2, 0.85);
    return buf;
  }

  /**
   * （旧）READY to FIGHT 効果音 — 抜刀音（バットウ音）。現在は未使用
   * 鞘走り（金属が擦れる「シャリリ…」）→ 刀身が抜け切る短い「チャキッ」。
   * 余韻は伸ばさず、すぐに切れる。
   */
  buildFanfareBufferDraw(sr) {
    const duration = 1.3;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const hit = 0.55; // 抜け切るタイミング（FIGHT!! の着地に合わせる）
    const scrapeStart = 0.12;

    // 鞘走り：ノイズを帯域制限し、細かな振動（ガリガリ感）で変調
    const scrape = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (t < scrapeStart || t > hit + 0.02) continue;
      const p = (t - scrapeStart) / (hit - scrapeStart);
      // 速度が上がるように音量・明るさが増し、抜け切る直前でピーク
      const env = Math.pow(Math.min(1, p), 1.3) * (t > hit ? Math.max(0, 1 - (t - hit) / 0.02) : 1);
      const rattle = 0.6 + 0.4 * Math.sin(2 * Math.PI * (70 + 90 * p) * t);
      scrape[i] = (Math.random() * 2 - 1) * env * rattle;
    }
    const lowA = Float32Array.from(scrape);
    this.lowpass(lowA, 2200, sr);
    for (let i = 0; i < len; i++) scrape[i] -= lowA[i]; // 2.2kHz以上のみ
    this.lowpass(scrape, 9000, sr);

    // 刀身の共鳴（短く減衰）。キーンと伸びないよう decay を極短にする
    const modes = [
      { f: 2350, decay: 0.09, amp: 0.45 },
      { f: 3720, decay: 0.07, amp: 0.30 },
      { f: 5410, decay: 0.05, amp: 0.18 },
    ];

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let ring = 0;
      let click = 0;
      let thunk = 0;
      if (t >= hit) {
        const dt = t - hit;
        const atk = Math.min(1, dt / 0.0006);
        modes.forEach((m) => {
          ring += Math.sin(2 * Math.PI * m.f * dt) * Math.exp(-dt / m.decay) * m.amp * atk;
        });
        // 「チャキッ」の打撃クリック
        click = (Math.random() * 2 - 1) * Math.exp(-dt / 0.012) * 0.7;
        // 納刀的な軽い芯（金属の当たり）
        thunk = Math.sin(2 * Math.PI * (520 - 600 * Math.min(dt, 0.05)) * dt) * Math.exp(-dt / 0.045) * 0.35;
      }
      const v = scrape[i] * 0.9 + ring * 0.55 + click * 0.4 + thunk;
      L[i] = v;
      R[i] = v * 0.95 + scrape[i] * 0.05;
    }
    this.reverb(L, R, sr, { mix: 0.1, decay: 0.55, damp: 5000 });
    this.finalize(L, R, sr, 1.15, 0.85);
    return buf;
  }


  /**
   * （旧）全ドラフト完了フィナーレ音 — 柔らかい長調のベル・アルペジオ。現在は未使用
   */
  buildFanfareBufferChord(sr) {
    const duration = 4.0;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);

    // C4 E4 G4 C5 E5 G5 → 最後に C5/E5/G5 の和音で明るく着地
    const seq = [
      { f: 261.63, t: 0.00, pan: -0.4 },
      { f: 329.63, t: 0.14, pan: 0.4 },
      { f: 392.0, t: 0.28, pan: -0.3 },
      { f: 523.25, t: 0.42, pan: 0.3 },
      { f: 659.25, t: 0.60, pan: -0.2 },
      { f: 783.99, t: 0.78, pan: 0.2 },
      { f: 523.25, t: 1.05, pan: -0.3 },
      { f: 659.25, t: 1.05, pan: 0.0 },
      { f: 783.99, t: 1.05, pan: 0.3 },
    ];

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let vL = 0;
      let vR = 0;
      for (const n of seq) {
        const dt = t - n.t;
        if (dt < 0) continue;
        const env = Math.exp(-dt / 0.7) * Math.min(1, dt / 0.008);
        const v = (Math.sin(2 * Math.PI * n.f * dt)
          + 0.18 * Math.sin(2 * Math.PI * n.f * 2 * dt) * Math.exp(-dt * 5)) * env * 0.2;
        vL += v * (1 - n.pan);
        vR += v * (1 + n.pan);
      }
      L[i] = vL;
      R[i] = vR;
    }
    this.reverb(L, R, sr, { mix: 0.3, decay: 0.75, damp: 3500 });
    this.finalize(L, R, sr, 1.0, 0.8);
    return buf;
  }

  /**
   * （旧）全ドラフト完了フィナーレ音 — 巨大構造物が起動するような荘厳なドローン。現在は未使用
   */
  buildFanfareBufferDark(sr) {
    const duration = 5.0;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);

    const chord = [55.0, 82.41, 110.0, 130.81, 164.81, 196.0]; // Am(add b6系) 暗い和音
    const bellSeq = [
      { f: 220.0, t: 0.9 },
      { f: 261.63, t: 1.35 },
      { f: 329.63, t: 1.8 },
      { f: 392.0, t: 2.3 },
      { f: 523.25, t: 2.9 },
    ];

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const swell = Math.pow(Math.min(1, t / 1.6), 2.0) * Math.exp(-Math.max(0, t - 2.2) / 1.5);
      let dL = 0;
      let dR = 0;
      chord.forEach((f, k) => {
        const lfo = 1 + 0.2 * Math.sin(2 * Math.PI * (0.22 + k * 0.05) * t + k);
        const a = Math.sin(2 * Math.PI * f * t);
        const b = Math.sin(2 * Math.PI * f * (1 + 0.003 * (k % 2 ? 1 : -1)) * t);
        const c = Math.sin(2 * Math.PI * f * 2 * t) * 0.18;
        const v = (a + b + c) * lfo * (k < 2 ? 0.45 : 0.22);
        dL += v * (k % 2 ? 0.75 : 1.0);
        dR += v * (k % 2 ? 1.0 : 0.75);
      });
      dL *= swell;
      dR *= swell;

      let sub = 0;
      const st = t - 0.9;
      if (st >= 0) {
        sub = saturate(Math.sin(2 * Math.PI * (30 * st + 45 * (1 - Math.exp(-st * 5)) / 5)) * Math.exp(-st / 1.5) * Math.min(1, st / 0.006), 1.7) * 0.9;
      }

      let bL = 0;
      let bR = 0;
      bellSeq.forEach((b, k) => {
        const dt = t - b.t;
        if (dt >= 0) {
          const env = Math.exp(-dt / 1.6) * Math.min(1, dt / 0.006);
          const v = (Math.sin(2 * Math.PI * b.f * dt) + 0.4 * Math.sin(2 * Math.PI * b.f * 2.76 * dt) * Math.exp(-dt * 2.2) + 0.2 * Math.sin(2 * Math.PI * b.f * 5.4 * dt) * Math.exp(-dt * 4)) * env * 0.2;
          const pan = k % 2 ? 0.4 : -0.4;
          bL += v * (1 - pan);
          bR += v * (1 + pan);
        }
      });

      L[i] = dL * 0.55 + sub * 0.8 + bL;
      R[i] = dR * 0.55 + sub * 0.8 + bR;
    }
    this.reverb(L, R, sr, { mix: 0.55, decay: 0.88, damp: 1900 });
    this.finalize(L, R, sr, 1.1, 0.84);
    return buf;
  }

  // --- 再生API ---

  /**
   * 1. ルーレット回転音 (高速時は軽快なクリック、終盤は重いパルス)
   */
  playTick(progress = 0) {
    if (!this.isEnabled()) return;
    this.init();

    const isHeavy = (typeof progress === 'number' && progress > 0.65);
    const buf = isHeavy ? this.buffers.tickHeavy : this.buffers.tickFast;
    this.playBuffer(buf, {
      rate: 0.96 + Math.random() * 0.08,
      gain: isHeavy ? 0.85 : 0.60
    });
  }

  /**
   * 2. デコード音
   */
  playDecodeBlip() {
    if (!this.isEnabled()) return;
    this.init();
    this.playBuffer(this.buffers.decodeBlip, {
      rate: 0.92 + Math.random() * 0.16,
      gain: 0.70
    });
  }

  /**
   * 3. ロックオン音 (高精度照準)
   */
  playLockOn() {
    if (!this.isEnabled()) return;
    this.init();
    this.playBuffer(this.buffers.lockOn, { rate: 1.0, gain: 0.95 });
  }

  /**
   * 4. 決定インパクト音 (抜刀・トリガー起動・重力サブドロップ)
   */
  playImpact() {
    if (!this.isEnabled()) return;
    this.init();
    this.playBuffer(this.buffers.impact, { rate: 1.0, gain: 1.0 });
  }

  /**
   * 5. 部隊結成音
   */
  playFormation() {
    if (!this.isEnabled()) return;
    this.init();
    this.playBuffer(this.buffers.formation, { rate: 1.0, gain: 1.0 });
  }

  /**
   * 6. フィナーレ・ファンファーレ
   */
  playFanfare() {
    if (!this.isEnabled()) return;
    this.init();
    this.playBuffer(this.buffers.fanfare, { rate: 1.0, gain: 1.0 });
  }
}

export const sound = new CrispCyberSoundSynthesizer();
