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
    this.rouletteSkipRequested = false;
    this.roulettePhase = null; // 'spin' | 'decode' | null
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
    this.rouletteSkipRequested = false;

    if (candidatePlayers.length > 1) {
      this.roulettePhase = 'spin';
      await this.runSpin({ candidatePlayers, durationSec, nameEl, fighterEl });
    }
    // スキップはルーレット回転のみ対象。デコード（名前が順に表示される演出）は必ず再生する
    this.rouletteSkipRequested = false;
    this.roulettePhase = 'decode';
    await this.runDecode({ winner, nameEl, fighterEl, stageEl });
    this.roulettePhase = null;
    await this.runImpact({ stageEl });
  }

  /**
   * ルーレット/デコードをスキップして即確定演出へ（時短）
   * @returns {boolean} スキップを受け付けたか
   */
  skipRoulette() {
    if (this.roulettePhase !== 'spin') return false;
    this.rouletteSkipRequested = true;
    return true;
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
        if (this.rouletteSkipRequested) { resolve(); return; }
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
   * @param {Object} team
   * @param {HTMLElement} overlayEl
   * @param {{ buttonLabel?: string, playSound?: boolean, obsUrl?: string, onRename?: (newName: string) => string|null }} [options]
   * @returns {Promise<void>} ユーザーのクリックまたはSpaceキーで解決
   */
  showFormation(team, overlayEl, { buttonLabel = '次へ進む', playSound = true, obsUrl = '', onRename = null } = {}) {
    const members = team.slots.map((s, i) => `
      <li class="formation-member" style="--i:${i}">
        <span class="fm-index">${String(i + 1).padStart(2, '0')}</span>
        <span class="fm-name">${escapeHtml(s.player?.name ?? '')}</span>
        <span class="fm-fighter">${escapeHtml(s.player?.fighter ?? '')}</span>
      </li>`).join('');

    const obsActions = obsUrl ? `
      <div class="formation-obs-actions" data-stop-close="true">
        <a href="${escapeHtml(obsUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" id="formation-obs-link">
          📺 OBS用単体ページを開く
        </a>
      </div>` : '';

    const renameBtn = onRename ? `
      <button type="button" class="formation-rename-btn" id="btn-formation-rename" data-stop-close="true" title="チーム名を変更" aria-label="チーム名を変更">
        ✎ 名前変更
      </button>` : '';

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
            <div class="formation-label-row">
              <div class="formation-label">UNIT FORMED</div>
              ${renameBtn}
            </div>
            <div class="formation-team-name" id="formation-team-name">${escapeHtml(team.name)}</div>
            <ul class="formation-members">${members}</ul>
          </div>
        </div>
        <div class="formation-bar formation-bar-bottom"></div>
        <div class="formation-controls">
          ${obsActions}
          <button type="button" class="btn btn-primary btn-formation-next" id="btn-formation-next">
            <span>${escapeHtml(buttonLabel)}</span>
            <span class="shortcut-hint">Space / クリック</span>
          </button>
        </div>
      </div>`;

    overlayEl.classList.add('is-active');
    if (playSound) sound.playFormation();

    // オーバーレイ上でのチーム名インライン編集
    if (onRename) {
      const btnRename = overlayEl.querySelector('#btn-formation-rename');
      const nameEl = overlayEl.querySelector('#formation-team-name');
      let currentName = team.name;

      const startOverlayRename = (e) => {
        e.stopPropagation();
        if (overlayEl.querySelector('.formation-rename-input')) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'formation-rename-input';
        input.value = currentName;
        input.maxLength = 32;
        input.setAttribute('data-stop-close', 'true');
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        let committed = false;
        const finishEdit = (save) => {
          if (committed) return;
          committed = true;
          if (save) {
            const updated = onRename(input.value);
            if (updated) currentName = updated;
          }
          nameEl.textContent = currentName;
          input.replaceWith(nameEl);
        };

        input.addEventListener('keydown', (ke) => {
          ke.stopPropagation();
          if (ke.key === 'Enter') {
            ke.preventDefault();
            finishEdit(true);
          } else if (ke.key === 'Escape') {
            ke.preventDefault();
            finishEdit(false);
          }
        });
        input.addEventListener('blur', () => finishEdit(true));
      };

      if (btnRename) btnRename.addEventListener('click', startOverlayRename);
      if (nameEl) {
        nameEl.setAttribute('data-stop-close', 'true');
        nameEl.title = 'クリックしてチーム名を変更';
        nameEl.addEventListener('click', startOverlayRename);
      }
    }

    return new Promise(resolve => {
      let done = false;
      const finish = (e) => {
        if (e && e.target && e.target.closest && e.target.closest('[data-stop-close="true"]')) {
          return;
        }
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
   * フィナーレ：スマブラ風「READY to FIGHT!!」バナー演出
   */
  startFinale() {
    this.stopFinale();
    this.finaleRunning = true;
    sound.playFanfare();

    const el = document.createElement('div');
    el.className = 'ready-fight';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <div class="rf-flash"></div>
      <div class="rf-band"></div>
      <div class="rf-text">
        <span class="rf-ready">READY</span>
        <span class="rf-to">to</span>
        <span class="rf-fight">FIGHT!!</span>
      </div>`;
    document.body.appendChild(el);
    this.finaleEl = el;

    this.finaleTimer = setTimeout(() => {
      el.classList.add('is-leaving');
      this.finaleTimer = setTimeout(() => this.stopFinale(), 600);
    }, 3000);
  }

  stopFinale() {
    this.finaleRunning = false;
    clearTimeout(this.finaleTimer);
    this.finaleTimer = null;
    if (this.finaleEl) {
      this.finaleEl.remove();
      this.finaleEl = null;
    }
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export const animation = new AnimationManager();
