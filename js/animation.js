/**
 * animation.js - ルーレット / デコード確定 / 衝撃波 / 部隊結成カード / フィナーレ演出
 * テーマ: ランク戦風のサイバーHUD
 */

import { sound } from './audio.js';

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&@<>/\\アイウエオカキクケコサシスセソ';

function easeOutQuint(x) {
  return 1 - Math.pow(1 - x, 5);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class AnimationManager {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.finaleRunning = false;
    this.rafId = null;
    this.formationSkip = null;
  }

  initCanvas(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /**
   * ルーレット → デコード → ロックオン衝撃波
   * @returns {Promise<void>} 演出完了で解決
   */
  async startRoulette({ candidatePlayers, winner, durationSec = 3.5, nameEl, fighterEl, stageEl }) {
    stageEl.classList.remove('is-locked', 'impact');
    stageEl.classList.add('is-spinning');

    if (candidatePlayers.length > 1) {
      await this.runSpin({ candidatePlayers, durationSec, nameEl, fighterEl });
    }
    await this.runDecode({ winner, nameEl, fighterEl, stageEl });
    await this.runImpact({ stageEl });
  }

  /**
   * 候補者を高速で切り替えながら減速
   */
  runSpin({ candidatePlayers, durationSec, nameEl, fighterEl }) {
    return new Promise(resolve => {
      const start = performance.now();
      const total = durationSec * 1000;
      let lastTick = 0;
      let lastIndex = -1;
      let count = 0;

      const frame = (now) => {
        const progress = Math.min((now - start) / total, 1);
        const interval = 40 + easeOutQuint(progress) * 380;

        if (now - lastTick >= interval) {
          lastTick = now;
          count++;
          // 同じ人が連続しないようにする
          let idx;
          do { idx = Math.floor(Math.random() * candidatePlayers.length); } while (idx === lastIndex);
          lastIndex = idx;
          const p = candidatePlayers[idx];
          nameEl.textContent = p.name;
          fighterEl.textContent = p.fighter || '';
          nameEl.classList.remove('flicker');
          void nameEl.offsetWidth;
          // メカニカルクリック / 終盤の重厚パルス
          sound.playTick(progress);
        }

        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /**
   * 文字がランダムに変化しながら左から順に確定する
   */
  runDecode({ winner, nameEl, fighterEl, stageEl }) {
    return new Promise(resolve => {
      stageEl.classList.remove('is-spinning');
      stageEl.classList.add('is-decoding');
      nameEl.classList.remove('flicker');

      const target = Array.from(winner.name);
      const fighterTarget = winner.fighter || '';
      const duration = 650;
      const start = performance.now();
      let lastBlip = 0;

      const frame = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const revealed = Math.floor(progress * target.length);
        nameEl.textContent = target
          .map((ch, i) => (i < revealed || ch === ' ' ? ch : randomGlyph()))
          .join('');
        fighterEl.textContent = progress > 0.5 ? fighterTarget : '';

        if (now - lastBlip > 45) {
          lastBlip = now;
          sound.playDecodeBlip();
        }

        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          nameEl.textContent = winner.name;
          fighterEl.textContent = fighterTarget;
          stageEl.classList.remove('is-decoding');
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  /**
   * ロックオン → 六角形の衝撃波 → 画面シェイク
   */
  async runImpact({ stageEl }) {
    stageEl.classList.add('is-locked');
    sound.playLockOn();
    await wait(160);

    sound.playImpact();
    stageEl.classList.add('impact');

    // 六角形の衝撃波リングを2重に出す
    [0, 120].forEach(delay => {
      setTimeout(() => {
        const ring = document.createElement('div');
        ring.className = 'hex-shockwave';
        stageEl.appendChild(ring);
        setTimeout(() => ring.remove(), 900);
      }, delay);
    });

    const app = document.getElementById('app-container');
    app.classList.add('screen-shake');
    await wait(550);
    app.classList.remove('screen-shake');
    stageEl.classList.remove('impact');
    await wait(150);
  }

  /**
   * 部隊結成カード演出 (ユーザーの操作があるまで表示を維持)
   * @returns {Promise<void>} ユーザーのクリックまたはSpaceキーで解決
   */
  showFormation(team, overlayEl) {
    const members = team.slots.map((s, i) => `
      <li class="formation-member" style="--i:${i}">
        <span class="fm-index">${String(i + 1).padStart(2, '0')}</span>
        <span class="fm-name">${escapeHtml(s.player?.name ?? '')}</span>
        <span class="fm-fighter">${escapeHtml(s.player?.fighter ?? '')}</span>
      </li>`).join('');

    overlayEl.style.setProperty('--team-color', team.color);
    overlayEl.innerHTML = `
      <div class="formation-card">
        <div class="formation-bar formation-bar-top"></div>
        <div class="formation-content">
          <div class="formation-emblem-wrap">
            <svg class="formation-emblem" viewBox="0 0 120 120" aria-hidden="true">
              <polygon class="emblem-outer" points="60,4 108,32 108,88 60,116 12,88 12,32" />
              <polygon class="emblem-inner" points="60,18 96,39 96,81 60,102 24,81 24,39" />
              <line class="emblem-line" x1="12" y1="60" x2="30" y2="60" />
              <line class="emblem-line" x1="90" y1="60" x2="108" y2="60" />
              <text class="emblem-letter" x="60" y="62">${escapeHtml(team.letter)}</text>
            </svg>
          </div>
          <div class="formation-info">
            <div class="formation-label">UNIT FORMED // 部隊結成</div>
            <div class="formation-team-name">${escapeHtml(team.name)}</div>
            <ul class="formation-members">${members}</ul>
          </div>
        </div>
        <div class="formation-bar formation-bar-bottom"></div>
        <div class="formation-controls">
          <button type="button" class="btn btn-primary btn-formation-next" id="btn-formation-next">
            <span>次へ進む</span>
            <span class="shortcut-hint">Space / クリック</span>
          </button>
        </div>
      </div>`;

    overlayEl.classList.add('is-active');
    sound.playFormation();

    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        overlayEl.removeEventListener('click', finish);
        this.formationSkip = null;
        overlayEl.classList.add('is-leaving');
        setTimeout(() => {
          overlayEl.classList.remove('is-active', 'is-leaving');
          overlayEl.innerHTML = '';
          resolve();
        }, 350);
      };

      // 自動タイマーは設置せず、ユーザーの明示的な操作（クリックまたはSpaceキー）があるまで待機
      overlayEl.addEventListener('click', finish);
      this.formationSkip = finish;
    });
  }

  /**
   * 部隊結成演出をスキップ/進行（Spaceキーまたは操作用）
   */
  skipFormation() {
    if (this.formationSkip) {
      this.formationSkip();
      return true;
    }
    return false;
  }

  /**
   * フィナーレ：六角形の破片が舞う
   */
  startFinale() {
    if (!this.canvas) return;
    this.finaleRunning = true;
    const colors = ['#00e5ff', '#3dffa8', '#ffffff', '#7dffe1', '#ffc23d'];
    this.particles = Array.from({ length: 160 }, () => ({
      x: Math.random() * this.canvas.width,
      y: -20 - Math.random() * this.canvas.height * 0.6,
      r: 4 + Math.random() * 9,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 1.6,
      vy: 1.5 + Math.random() * 3.5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.08,
      filled: Math.random() < 0.45,
    }));

    sound.playFanfare();

    const drawHex = (p) => {
      const c = this.ctx;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = Math.cos(a) * p.r;
        const py = Math.sin(a) * p.r;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.closePath();
      c.shadowColor = p.color;
      c.shadowBlur = 8;
      if (p.filled) { c.fillStyle = p.color; c.globalAlpha = 0.75; c.fill(); }
      else { c.strokeStyle = p.color; c.lineWidth = 1.6; c.stroke(); }
      c.restore();
    };

    const render = () => {
      if (!this.finaleRunning) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      for (const p of this.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y > this.canvas.height + 20) {
          p.y = -20;
          p.x = Math.random() * this.canvas.width;
        }
        drawHex(p);
      }
      this.rafId = requestAnimationFrame(render);
    };

    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(render);
  }

  stopFinale() {
    this.finaleRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export const animation = new AnimationManager();
