/**
 * app.js - メインコントローラー（UI描画・参加者管理・ドラフト進行）
 */

import { store } from './state.js';
import {
  createPlayer, readCsvFile, validateTeamConfig, recommendedTeamCount, SAMPLE_PLAYERS,
} from './participants.js';
import {
  initializeDraft, getCurrentStep, selectNextWinner, commitWinner, undoStep, TEAM_COLORS,
} from './draft-engine.js';
import { animation } from './animation.js';
import { sound } from './audio.js';

const $ = (id) => document.getElementById(id);

const dom = {
  confettiCanvas: $('confetti-canvas'),
  progressCurrent: $('progress-current'),
  progressTotal: $('progress-total'),
  progressBarFill: $('progress-bar-fill'),
  statUnits: $('stat-units'),
  stageCard: $('stage-card'),
  stageTeam: $('stage-team'),
  stageSlot: $('stage-slot'),
  stageStatus: $('stage-status'),
  stageRemaining: $('stage-remaining'),
  stagePlayerName: $('stage-player-name'),
  stageFighterName: $('stage-fighter-name'),
  teamsGrid: $('teams-grid'),
  controlBar: $('control-bar'),
  btnDrawNext: $('btn-draw-next'),
  btnUndo: $('btn-undo'),
  btnOpenParticipants: $('btn-open-participants'),
  btnToggleBg: $('btn-toggle-bg'),
  bgModeLabel: $('bg-mode-label'),
  btnReset: $('btn-reset'),
  formationOverlay: $('formation-overlay'),
  // 参加者モーダル
  modalParticipants: $('modal-participants'),
  playerForm: $('player-form'),
  inputName: $('input-player-name'),
  inputFighter: $('input-player-fighter'),
  btnAddPlayer: $('btn-add-player'),
  btnCancelEdit: $('btn-cancel-edit'),
  inputCsv: $('input-csv-file'),
  btnLoadSample: $('btn-load-sample'),
  btnClearPlayers: $('btn-clear-players'),
  playerList: $('player-list'),
  playerCount: $('player-count'),
  inputTeamCount: $('input-team-count'),
  btnTeamMinus: $('btn-team-minus'),
  btnTeamPlus: $('btn-team-plus'),
  btnTeamAuto: $('btn-team-auto'),
  teamValidation: $('team-validation'),
  teamPreview: $('team-preview'),
  checkboxSound: $('checkbox-sound'),
  applyWarning: $('apply-warning'),
  btnSaveStartDraft: $('btn-save-start-draft'),
  btnCancelParticipants: $('btn-cancel-participants'),
  btnCloseParticipants: $('btn-close-participants'),
  // リセット
  modalReset: $('modal-reset'),
  btnConfirmReset: $('btn-confirm-reset'),
  btnCancelReset: $('btn-cancel-reset'),
  btnCloseReset: $('btn-close-reset'),
  toast: $('toast'),
};

// 演出中の対象ステップ（確定後も演出が終わるまでステージに表示し続ける）
let activeStep = null;
// 直前に確定したスロット（一覧での登場アニメーション用）
let lastConfirmed = null;
// モーダル編集中の参加者リスト（適用するまで本体には反映しない）
let editingPlayers = [];
let editingId = null;
let teamCountTouched = false;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function showToast(message, duration = 2600) {
  dom.toast.textContent = message;
  dom.toast.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-show'), duration);
}

function isModalOpen() {
  return dom.modalParticipants.classList.contains('is-active') || dom.modalReset.classList.contains('is-active');
}

/* ==========================================================================
   描画
   ========================================================================== */

function renderUI(state) {
  const total = state.draftQueue.length;
  const done = state.currentStepIndex;
  const step = activeStep || getCurrentStep();

  dom.progressCurrent.textContent = done;
  dom.progressTotal.textContent = total;
  dom.progressBarFill.style.width = total ? `${(done / total) * 100}%` : '0%';
  dom.statUnits.textContent = state.teams.length;
  dom.stageRemaining.textContent = state.undrawnPlayerIds.length;

  dom.btnDrawNext.disabled = state.isSpinning || done >= total || total === 0;
  dom.btnUndo.disabled = state.isSpinning || state.history.length === 0;

  // ステージ
  if (total === 0) {
    setStageTarget(null);
    dom.stageStatus.textContent = 'NO DATA';
    dom.stagePlayerName.textContent = 'NO DATA';
    dom.stageFighterName.textContent = '参加者を登録してください';
  } else if (!step) {
    setStageTarget(null);
    dom.stageStatus.textContent = 'COMPLETE';
    if (!state.isSpinning) {
      dom.stagePlayerName.textContent = 'ALL UNITS READY';
      dom.stageFighterName.textContent = '全チーム確定';
    }
  } else {
    setStageTarget(step, state.teams[step.teamIndex]);
    dom.stageStatus.textContent = state.isSpinning ? 'SCANNING' : 'STANDBY';
    if (!state.isSpinning && done === 0) {
      dom.stagePlayerName.textContent = 'READY';
      dom.stageFighterName.textContent = 'Space で抽選開始';
    }
  }

  document.body.className = `bg-${state.settings.bgMode}`;
  const bgNames = { dark: 'ダーク', transparent: 'OBS透過', stage: 'ステージ' };
  dom.bgModeLabel.textContent = bgNames[state.settings.bgMode] || state.settings.bgMode;

  renderTeamsGrid(state, step);
}

function setStageTarget(step, team) {
  if (!step || !team) {
    dom.stageTeam.textContent = '----';
    dom.stageSlot.textContent = '';
    dom.stageSlot.style.display = 'none';
    dom.stageCard.style.removeProperty('--team-color');
    return;
  }
  dom.stageTeam.textContent = team.name;
  dom.stageSlot.textContent = step.slotLabel;
  dom.stageSlot.style.display = '';
  dom.stageCard.style.setProperty('--team-color', team.color);
}

function renderTeamsGrid(state, step) {
  const html = state.teams.map((team, t) => {
    const isTarget = step && step.teamIndex === t;
    const filled = team.slots.filter(s => s.player).length;
    const isComplete = filled === team.slots.length;

    const slots = team.slots.map((slot, s) => {
      const isActive = isTarget && step.slotIndex === s && !slot.player;
      const justIn = lastConfirmed && lastConfirmed.teamIndex === t && lastConfirmed.slotIndex === s;
      const cls = ['slot-item', slot.player ? 'is-filled' : '', isActive ? 'is-active-drawing' : '', justIn ? 'is-just-confirmed' : '']
        .filter(Boolean).join(' ');
      const body = slot.player
        ? `<span class="slot-player-name">${escapeHtml(slot.player.name)}</span>
           ${slot.player.fighter ? `<span class="slot-fighter-name">${escapeHtml(slot.player.fighter)}</span>` : ''}`
        : `<span class="slot-waiting-text">${isActive ? '▶ SCANNING...' : 'VACANT'}</span>`;
      return `<li class="${cls}"><span class="slot-label">${slot.label}</span>${body}</li>`;
    }).join('');

    return `
      <article class="team-card panel ${isTarget ? 'is-current-target' : ''} ${isComplete ? 'is-complete' : ''}" style="--team-color:${team.color}">
        <div class="team-header">
          <div class="team-emblem-mini">${escapeHtml(team.letter)}</div>
          <div class="team-title">${escapeHtml(team.name)}</div>
          <div class="team-status-tag">${isComplete ? 'FORMED' : `${filled}/${team.slots.length}`}</div>
        </div>
        <ul class="slot-list">${slots}</ul>
      </article>`;
  }).join('');
  dom.teamsGrid.innerHTML = html;
}

/* ==========================================================================
   ドラフト進行
   ========================================================================== */

async function handleDrawNext() {
  // 部隊結成演出が表示中の場合、演出を閉じる
  if (animation.skipFormation()) {
    return;
  }

  const state = store.getState();
  if (state.isSpinning) {
    animation.skipRoulette();
    return;
  }

  const result = selectNextWinner();
  if (!result || !result.winner) {
    showToast('すべてのチームが確定しています');
    return;
  }

  activeStep = result.step;
  lastConfirmed = null;
  store.setState({ isSpinning: true });

  const candidates = state.players.filter(p => state.undrawnPlayerIds.includes(p.id));
  await animation.startRoulette({
    candidatePlayers: candidates,
    winner: result.winner,
    durationSec: state.settings.spinDurationSec,
    nameEl: dom.stagePlayerName,
    fighterEl: dom.stageFighterName,
    stageEl: dom.stageCard,
  });

  lastConfirmed = { teamIndex: result.step.teamIndex, slotIndex: result.step.slotIndex };
  const commit = commitWinner(result.winner);

  if (commit && commit.teamCompleted) {
    await new Promise(r => setTimeout(r, 450));
    const team = store.getState().teams[commit.step.teamIndex];
    await animation.showFormation(team, dom.formationOverlay);
  }

  activeStep = null;
  dom.stageCard.classList.remove('is-locked');
  store.setState({ isSpinning: false });

  if (commit && commit.draftCompleted) {
    animation.startFinale();
    showToast('全チームのメンバーが確定しました！', 4000);
  }
}

function handleUndo() {
  if (store.getState().isSpinning) return;
  animation.stopFinale();
  lastConfirmed = null;
  if (undoStep()) {
    dom.stageCard.classList.remove('is-locked', 'impact');
    dom.stagePlayerName.textContent = 'UNDO';
    dom.stageFighterName.textContent = '直前の抽選を取り消しました';
    showToast('直前の抽選を取り消しました');
  }
}

function handleToggleBg() {
  const modes = ['dark', 'transparent', 'stage'];
  const state = store.getState();
  const next = modes[(modes.indexOf(state.settings.bgMode) + 1) % modes.length];
  store.setState({ settings: { ...state.settings, bgMode: next } });
}

/* ==========================================================================
   参加者・チーム設定モーダル
   ========================================================================== */

function openParticipantsModal() {
  const state = store.getState();
  editingPlayers = state.players.map(p => ({ ...p }));
  editingId = null;
  teamCountTouched = state.teams.length > 0;

  dom.inputTeamCount.value = state.teams.length || state.settings.teamCount || recommendedTeamCount(editingPlayers.length);

  const orderRadio = document.querySelector(`input[name="draft-order"][value="${state.draftOrderMode}"]`);
  if (orderRadio) orderRadio.checked = true;
  const speedRadio = document.querySelector(`input[name="spin-speed"][value="${state.settings.spinDurationSec}"]`);
  if (speedRadio) speedRadio.checked = true;
  dom.checkboxSound.checked = state.settings.seEnabled;

  dom.applyWarning.textContent = state.currentStepIndex > 0
    ? `※ 適用すると、現在の抽選結果（${state.currentStepIndex}名分）は消えます。`
    : '';

  resetPlayerForm();
  renderPlayerList();
  dom.modalParticipants.classList.add('is-active');
  setTimeout(() => dom.inputName.focus(), 50);
}

function closeParticipantsModal() {
  dom.modalParticipants.classList.remove('is-active');
}

function resetPlayerForm() {
  editingId = null;
  dom.inputName.value = '';
  dom.inputFighter.value = '';
  dom.btnAddPlayer.textContent = '追加';
  dom.btnCancelEdit.classList.add('is-hidden');
}

function renderPlayerList() {
  dom.playerCount.textContent = editingPlayers.length;
  if (editingPlayers.length === 0) {
    dom.playerList.innerHTML = '<li class="player-list-empty">参加者がいません。上の入力欄から追加するか、CSVを読み込んでください。</li>';
  } else {
    dom.playerList.innerHTML = editingPlayers.map(p => `
      <li class="player-row ${p.id === editingId ? 'is-editing' : ''}" data-id="${p.id}">
        <span class="pr-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
        <span class="pr-fighter" title="${escapeHtml(p.fighter)}">${escapeHtml(p.fighter) || '—'}</span>
        <span class="pr-actions">
          <button type="button" class="btn btn-secondary btn-icon" data-action="edit">編集</button>
          <button type="button" class="btn btn-danger btn-icon" data-action="delete">削除</button>
        </span>
      </li>`).join('');
  }
  if (!teamCountTouched) {
    dom.inputTeamCount.value = recommendedTeamCount(editingPlayers.length);
  }
  updateTeamValidation();
}

function getTeamCountInput() {
  return parseInt(dom.inputTeamCount.value, 10) || 0;
}

function updateTeamValidation() {
  const teamCount = getTeamCountInput();
  const result = validateTeamConfig(editingPlayers.length, teamCount);
  dom.teamValidation.textContent = result.message;
  dom.teamValidation.className = `validation-notice ${result.isValid ? 'is-valid' : 'is-invalid'}`;
  dom.teamPreview.innerHTML = result.sizes.map((size, i) => {
    const color = TEAM_COLORS[i % TEAM_COLORS.length];
    const letter = i < 26 ? String.fromCharCode(65 + i) : `${i + 1}`;
    return `<span class="team-chip" style="--chip-color:${color}">${letter}: ${size}人</span>`;
  }).join('');
  dom.btnSaveStartDraft.disabled = !result.isValid;
}

function hasDuplicateName(name, exceptId = null) {
  return editingPlayers.some(p => p.name === name && p.id !== exceptId);
}

function handlePlayerSubmit(e) {
  e.preventDefault();
  const name = dom.inputName.value.trim();
  const fighter = dom.inputFighter.value.trim();
  if (!name) {
    dom.inputName.focus();
    return;
  }
  if (hasDuplicateName(name, editingId)) {
    showToast(`「${name}」はすでに登録されています`);
    dom.inputName.select();
    return;
  }

  if (editingId) {
    const target = editingPlayers.find(p => p.id === editingId);
    if (target) {
      target.name = name;
      target.fighter = fighter;
    }
  } else {
    editingPlayers.push(createPlayer(name, fighter));
  }
  resetPlayerForm();
  renderPlayerList();
  dom.playerList.scrollTop = editingId ? dom.playerList.scrollTop : dom.playerList.scrollHeight;
  dom.inputName.focus();
}

function handlePlayerListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.player-row')?.dataset.id;
  const player = editingPlayers.find(p => p.id === id);
  if (!player) return;

  if (btn.dataset.action === 'delete') {
    editingPlayers = editingPlayers.filter(p => p.id !== id);
    if (editingId === id) resetPlayerForm();
    renderPlayerList();
  } else if (btn.dataset.action === 'edit') {
    editingId = id;
    dom.inputName.value = player.name;
    dom.inputFighter.value = player.fighter;
    dom.btnAddPlayer.textContent = '更新';
    dom.btnCancelEdit.classList.remove('is-hidden');
    renderPlayerList();
    dom.inputName.focus();
    dom.inputName.select();
  }
}

async function handleCsvSelected() {
  const file = dom.inputCsv.files[0];
  dom.inputCsv.value = '';
  if (!file) return;
  try {
    const { players, skipped } = await readCsvFile(file);
    let added = 0;
    let duplicates = 0;
    for (const p of players) {
      if (hasDuplicateName(p.name)) { duplicates++; continue; }
      editingPlayers.push(createPlayer(p.name, p.fighter));
      added++;
    }
    renderPlayerList();
    const notes = [];
    if (duplicates) notes.push(`重複 ${duplicates}名`);
    if (skipped) notes.push(`名前なし ${skipped}行`);
    showToast(`CSVから ${added}名を追加しました${notes.length ? `（スキップ: ${notes.join('・')}）` : ''}`, 3500);
  } catch (err) {
    console.error(err);
    showToast('CSVの読み込みに失敗しました');
  }
}

function setTeamCount(value) {
  const max = Math.max(1, editingPlayers.length);
  const v = Math.min(Math.max(1, value), max);
  dom.inputTeamCount.value = v;
  teamCountTouched = true;
  updateTeamValidation();
}

function handleApply() {
  const teamCount = getTeamCountInput();
  const result = validateTeamConfig(editingPlayers.length, teamCount);
  if (!result.isValid) {
    showToast(result.message);
    return;
  }

  const order = document.querySelector('input[name="draft-order"]:checked')?.value || 'round';
  const speed = parseFloat(document.querySelector('input[name="spin-speed"]:checked')?.value || '3.5');

  animation.stopFinale();
  lastConfirmed = null;
  const state = store.getState();
  store.setState({
    settings: { ...state.settings, spinDurationSec: speed, seEnabled: dom.checkboxSound.checked },
  });

  if (initializeDraft(editingPlayers, teamCount, order)) {
    dom.stageCard.classList.remove('is-locked', 'impact');
    closeParticipantsModal();
    renderUI(store.getState());
    showToast(`${editingPlayers.length}名・${teamCount}チームでドラフトを準備しました`);
  }
}

/* ==========================================================================
   初期化
   ========================================================================== */

function initApp() {
  animation.initCanvas(dom.confettiCanvas);

  const current = store.getState();
  if (current.players.length === 0) {
    const players = SAMPLE_PLAYERS.map(([n, f]) => createPlayer(n, f));
    initializeDraft(players, recommendedTeamCount(players.length), 'round');
  } else if (current.teams.length === 0) {
    // 旧バージョンから移行した直後など
    const teamCount = current.settings.teamCount || recommendedTeamCount(current.players.length);
    if (!initializeDraft(current.players, teamCount, current.draftOrderMode)) {
      initializeDraft(current.players, recommendedTeamCount(current.players.length), current.draftOrderMode);
    }
  }

  store.subscribe(renderUI);
  renderUI(store.getState());

  // 操作バー
  dom.btnDrawNext.addEventListener('click', () => { sound.init(); handleDrawNext(); });
  // 抽選中にステージをクリックするとスキップ（時短）
  dom.stageCard.addEventListener('click', () => animation.skipRoulette());
  dom.btnUndo.addEventListener('click', handleUndo);
  dom.btnToggleBg.addEventListener('click', handleToggleBg);
  dom.btnOpenParticipants.addEventListener('click', openParticipantsModal);

  // 参加者モーダル
  dom.btnCloseParticipants.addEventListener('click', closeParticipantsModal);
  dom.btnCancelParticipants.addEventListener('click', closeParticipantsModal);
  dom.playerForm.addEventListener('submit', handlePlayerSubmit);
  dom.btnCancelEdit.addEventListener('click', () => { resetPlayerForm(); renderPlayerList(); });
  dom.playerList.addEventListener('click', handlePlayerListClick);
  dom.inputCsv.addEventListener('change', handleCsvSelected);
  dom.btnLoadSample.addEventListener('click', () => {
    if (editingPlayers.length > 0 && !confirm('今のリストをサンプル24名に置き換えますか？')) return;
    editingPlayers = SAMPLE_PLAYERS.map(([n, f]) => createPlayer(n, f));
    teamCountTouched = false;
    resetPlayerForm();
    renderPlayerList();
  });
  dom.btnClearPlayers.addEventListener('click', () => {
    if (editingPlayers.length === 0 || !confirm('参加者をすべて削除しますか？')) return;
    editingPlayers = [];
    teamCountTouched = false;
    resetPlayerForm();
    renderPlayerList();
  });
  dom.btnTeamMinus.addEventListener('click', () => setTeamCount(getTeamCountInput() - 1));
  dom.btnTeamPlus.addEventListener('click', () => setTeamCount(getTeamCountInput() + 1));
  dom.btnTeamAuto.addEventListener('click', () => setTeamCount(recommendedTeamCount(editingPlayers.length)));
  dom.inputTeamCount.addEventListener('input', () => { teamCountTouched = true; updateTeamValidation(); });
  dom.btnSaveStartDraft.addEventListener('click', handleApply);

  // リセット
  const closeReset = () => dom.modalReset.classList.remove('is-active');
  dom.btnReset.addEventListener('click', () => {
    if (store.getState().isSpinning) return;
    dom.modalReset.classList.add('is-active');
  });
  dom.btnCancelReset.addEventListener('click', closeReset);
  dom.btnCloseReset.addEventListener('click', closeReset);
  dom.btnConfirmReset.addEventListener('click', () => {
    animation.stopFinale();
    lastConfirmed = null;
    const state = store.getState();
    initializeDraft(state.players, state.teams.length, state.draftOrderMode);
    dom.stageCard.classList.remove('is-locked', 'impact');
    dom.stagePlayerName.textContent = 'READY';
    closeReset();
    showToast('抽選結果をリセットしました');
  });

  // キーボード
  window.addEventListener('keydown', (e) => {
    if (isModalOpen()) {
      if (e.key === 'Escape') {
        closeParticipantsModal();
        closeReset();
      }
      return;
    }
    // 部隊結成演出中なら Space / Enter / Escape で閉じる
    if (e.code === 'Space' || e.code === 'Enter' || e.key === 'Escape') {
      if (animation.skipFormation()) {
        e.preventDefault();
        return;
      }
    }

    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      sound.init();
      handleDrawNext();
    } else if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      handleUndo();
    } else if (e.key === 'h' || e.key === 'H') {
      dom.controlBar.classList.toggle('is-hidden');
    }
  });
}

document.addEventListener('DOMContentLoaded', initApp);
