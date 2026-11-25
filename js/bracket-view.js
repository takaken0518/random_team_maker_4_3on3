/**
 * bracket-view.js - OBSブラウザソース用のダブルイリミネーション・トーナメント単体ページ
 *
 * クエリパラメータ:
 *   ?filter=all    : 'all'（全体） | 'winners'（Winners & GFのみ） | 'losers'（Losersのみ）
 *   ?bg=transparent: 'transparent'（OBS透過・既定） | 'dark' | 'stage'
 *   ?hud=0         : '0' を指定すると下部のヘルパーバーを初期状態で非表示（OBS取り込み用）
 *   ?data=...      : 別環境（OBSの独立CEF等）でも同じトーナメント状態を再現するBase64スナップショット
 */

import { store } from './state.js';
import { createPlayer, SAMPLE_PLAYERS, recommendedTeamCount } from './participants.js';
import { initializeDraft } from './draft-engine.js';
import { generateAndSaveTournament, updateMatchResult, swapTournamentSlots } from './tournament-engine.js';
import {
  renderTournamentBracket, encodeTournamentSnapshot, decodeTournamentSnapshot,
} from './bracket-renderer.js';

const $ = (id) => document.getElementById(id);

const dom = {
  mount: $('obs-bracket-mount'),
  helperBar: $('obs-helper-bar'),
  filterTabs: $('obs-filter-tabs'),
  btnShuffle: $('btn-obs-shuffle'),
  btnInteractive: $('btn-obs-interactive'),
  interactiveLabel: $('obs-interactive-label'),
  btnBg: $('btn-obs-bg'),
  bgLabel: $('obs-bg-label'),
  btnCopyUrl: $('btn-obs-copy-url'),
  btnHideBar: $('btn-obs-hide-bar'),
  toast: $('toast'),
};

let toastTimer = null;
function showToast(message, duration = 2600) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-show'), duration);
}

const params = new URLSearchParams(window.location.search);
let filterMode = ['all', 'winners', 'losers'].includes(params.get('filter')) ? params.get('filter') : 'all';
let bgMode = ['transparent', 'dark', 'stage'].includes(params.get('bg')) ? params.get('bg') : 'transparent';
let isInteractive = params.get('hud') !== '0';
const hideHudParam = params.get('hud') === '0' || Boolean(window.obsstudio);

const embeddedSnapshot = decodeTournamentSnapshot(params.get('data'));

function resolveTournamentData(state) {
  if (state.tournament && state.teams && state.teams.length >= 2) {
    return { tournament: state.tournament, teams: state.teams };
  }
  if (embeddedSnapshot && embeddedSnapshot.tournament && embeddedSnapshot.teams) {
    return { tournament: embeddedSnapshot.tournament, teams: embeddedSnapshot.teams };
  }
  return { tournament: state.tournament, teams: state.teams || [] };
}

function syncUrlParams() {
  const url = new URL(window.location.href);
  url.searchParams.set('filter', filterMode);
  url.searchParams.set('bg', bgMode);
  const snap = encodeTournamentSnapshot(store.getState());
  if (snap) {
    url.searchParams.set('data', snap);
  }
  window.history.replaceState(null, '', url.toString());
}

function buildObsUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('filter', filterMode);
  url.searchParams.set('bg', bgMode);
  url.searchParams.set('hud', '0');
  const snap = encodeTournamentSnapshot(store.getState());
  if (snap) {
    url.searchParams.set('data', snap);
  }
  return url.toString();
}

function render() {
  const state = store.getState();
  const { tournament, teams } = resolveTournamentData(state);

  document.body.className = `obs-bracket-page bg-${bgMode}`;

  const bgNames = { transparent: 'OBS透過', dark: 'ダーク', stage: 'ステージ' };
  if (dom.bgLabel) dom.bgLabel.textContent = bgNames[bgMode] || bgMode;
  if (dom.interactiveLabel) dom.interactiveLabel.textContent = isInteractive ? '有効' : '閲覧のみ';

  if (dom.filterTabs) {
    dom.filterTabs.querySelectorAll('.obs-team-tab').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.filter === filterMode);
    });
  }

  dom.mount.innerHTML = renderTournamentBracket(tournament, teams, {
    interactive: isInteractive,
    filter: filterMode,
  });
}

function init() {
  const current = store.getState();
  if (current.players.length === 0 && !embeddedSnapshot) {
    const players = SAMPLE_PLAYERS.map(([n, f]) => createPlayer(n, f));
    initializeDraft(players, recommendedTeamCount(players.length), 'round');
  }
  if (!store.getState().tournament && !embeddedSnapshot && store.getState().teams.length >= 2) {
    generateAndSaveTournament({ shuffle: true });
  }

  if (hideHudParam) {
    dom.helperBar.classList.add('is-hidden');
  }

  store.subscribe(() => {
    syncUrlParams();
    render();
  });
  render();

  dom.filterTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.obs-team-tab');
    if (!btn) return;
    filterMode = btn.dataset.filter;
    syncUrlParams();
    render();
  });

  dom.btnShuffle.addEventListener('click', () => {
    const state = store.getState();
    if (!state.teams || state.teams.length < 2) return;
    const hasProgress = state.tournament && Object.values(state.tournament.matches || {}).some(
      m => !m.isAutoResolved && m.status === 'completed'
    );
    if (hasProgress && !confirm('進行中の試合結果があります。再シャッフルするとリセットされますがよろしいですか？')) {
      return;
    }
    generateAndSaveTournament({ shuffle: true });
    syncUrlParams();
    render();
    showToast('トーナメントをランダム再振り分けしました');
  });

  dom.btnInteractive.addEventListener('click', () => {
    isInteractive = !isInteractive;
    render();
  });

  dom.btnBg.addEventListener('click', () => {
    const modes = ['transparent', 'dark', 'stage'];
    bgMode = modes[(modes.indexOf(bgMode) + 1) % modes.length];
    syncUrlParams();
    render();
  });

  dom.btnCopyUrl.addEventListener('click', async () => {
    const obsUrl = buildObsUrl();
    try {
      await navigator.clipboard.writeText(obsUrl);
      showToast('OBSブラウザソース用URLをコピーしました！');
    } catch {
      prompt('OBSブラウザソースに貼り付けるURL:', obsUrl);
    }
  });

  dom.btnHideBar.addEventListener('click', () => {
    dom.helperBar.classList.add('is-hidden');
    showToast('ヘルパーバーを隠しました（Hキーで再表示）', 2200);
  });

  // トーナメント表内の勝敗・スコア操作
  dom.mount.addEventListener('click', (e) => {
    if (!isInteractive) return;

    const scoreBtn = e.target.closest('.b-score-btn');
    if (scoreBtn) {
      e.stopPropagation();
      const matchId = scoreBtn.dataset.matchId;
      const slot = scoreBtn.dataset.slot;
      const delta = parseInt(scoreBtn.dataset.scoreDelta, 10) || 0;
      const m = store.getState().tournament?.matches?.[matchId];
      if (!m) return;
      if (slot === 'A') {
        updateMatchResult(matchId, { scoreA: (m.scoreA || 0) + delta });
      } else {
        updateMatchResult(matchId, { scoreB: (m.scoreB || 0) + delta });
      }
      return;
    }

    const clearBtn = e.target.closest('.b-match-clear');
    if (clearBtn) {
      e.stopPropagation();
      updateMatchResult(clearBtn.dataset.clearMatch, { winnerSlot: null });
      showToast('試合の勝敗を取り消しました');
      return;
    }

    const winSlotEl = e.target.closest('.b-slot.is-clickable[data-win-slot]');
    if (winSlotEl) {
      updateMatchResult(winSlotEl.dataset.matchId, { winnerSlot: winSlotEl.dataset.winSlot });
    }
  });

  // OBSプレビュー画面上でのドラッグ＆ドロップ入れ替え
  let draggedBracketSlot = null;
  dom.mount.addEventListener('dragstart', (e) => {
    if (!isInteractive) { e.preventDefault(); return; }
    const slotEl = e.target.closest('.b-slot[draggable="true"][data-swap-match]');
    if (!slotEl) { e.preventDefault(); return; }
    draggedBracketSlot = {
      matchId: slotEl.dataset.swapMatch,
      slot: slotEl.dataset.swapSlot,
    };
    slotEl.classList.add('is-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify(draggedBracketSlot));
    }
  });
  dom.mount.addEventListener('dragend', () => {
    draggedBracketSlot = null;
    dom.mount.querySelectorAll('.is-dragging, .is-drag-over').forEach(el => {
      el.classList.remove('is-dragging', 'is-drag-over');
    });
  });
  dom.mount.addEventListener('dragover', (e) => {
    if (!draggedBracketSlot || !isInteractive) return;
    const targetEl = e.target.closest('.b-slot.is-drop-target[data-swap-match]');
    if (!targetEl) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dom.mount.querySelectorAll('.is-drag-over').forEach(el => {
      if (el !== targetEl) el.classList.remove('is-drag-over');
    });
    targetEl.classList.add('is-drag-over');
  });
  dom.mount.addEventListener('dragleave', (e) => {
    const targetEl = e.target.closest('.b-slot.is-drop-target');
    if (targetEl && !targetEl.contains(e.relatedTarget)) {
      targetEl.classList.remove('is-drag-over');
    }
  });
  dom.mount.addEventListener('drop', (e) => {
    if (!draggedBracketSlot || !isInteractive) return;
    const targetEl = e.target.closest('.b-slot.is-drop-target[data-swap-match]');
    dom.mount.querySelectorAll('.is-dragging, .is-drag-over').forEach(el => {
      el.classList.remove('is-dragging', 'is-drag-over');
    });
    if (!targetEl) return;
    e.preventDefault();
    e.stopPropagation();

    const to = {
      matchId: targetEl.dataset.swapMatch,
      slot: targetEl.dataset.swapSlot,
    };
    const from = draggedBracketSlot;
    draggedBracketSlot = null;

    if (from.matchId === to.matchId && from.slot === to.slot) return;
    if (swapTournamentSlots(from, to)) {
      syncUrlParams();
      render();
      showToast('トーナメントのチーム配置を入れ替えました');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') {
      dom.helperBar.classList.toggle('is-hidden');
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
