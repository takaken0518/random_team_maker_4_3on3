/**
 * app.js - メインコントローラー（UI描画・参加者管理・ドラフト進行）
 */

import { store } from './state.js';
import {
  createPlayer, readCsvFile, validateTeamConfig, recommendedTeamCount, SAMPLE_PLAYERS,
} from './participants.js';
import {
  initializeDraft, getCurrentStep, selectNextWinner, commitWinner, undoStep, renameTeam, swapTeamSlots, TEAM_COLORS,
} from './draft-engine.js';
import {
  generateAndSaveTournament, updateMatchResult, resetTournamentResults, swapTournamentSlots,
} from './tournament-engine.js';
import {
  renderTournamentBracket, encodeTournamentSnapshot,
  captureBracketAnimationSnapshot, applyBracketProgressionAnimations, renderBracketConnectors,
} from './bracket-renderer.js';
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
  btnToggleFighter: $('btn-toggle-fighter'),
  fighterModeLabel: $('fighter-mode-label'),
  btnToggleBg: $('btn-toggle-bg'),
  bgModeLabel: $('bg-mode-label'),
  btnReset: $('btn-reset'),
  formationOverlay: $('formation-overlay'),
  // ビュー切替 & トーナメント
  tabViewDraft: $('tab-view-draft'),
  tabViewTournament: $('tab-view-tournament'),
  draftViewContainer: $('draft-view-container'),
  tournamentViewContainer: $('tournament-view-container'),
  stageTournamentCta: $('stage-tournament-cta'),
  btnStageCreateTournament: $('btn-stage-create-tournament'),
  btnOpenTournament: $('btn-open-tournament'),
  btnShuffleTournament: $('btn-shuffle-tournament'),
  btnResetTournamentScores: $('btn-reset-tournament-scores'),
  linkObsBracket: $('link-obs-bracket'),
  btnBackToDraft: $('btn-back-to-draft'),
  tournamentMetaBadge: $('tournament-meta-badge'),
  tournamentBracketMount: $('tournament-bracket-mount'),
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
  checkboxShowFighter: $('checkbox-show-fighter'),
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
// ダイアログを開く前のフォーカス要素（E2-05: 閉じた後に元の操作位置へ戻す）
let lastFocusedBeforeModal = null;
// 現在のメイン表示モード ('draft' | 'tournament')
let activeView = 'draft';
// トーナメント進行差分検知用スナップショット
let lastBracketSnapshot = null;

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

function getActiveModal() {
  if (dom.modalParticipants.classList.contains('is-active')) return dom.modalParticipants;
  if (dom.modalReset.classList.contains('is-active')) return dom.modalReset;
  return null;
}

function isModalOpen() {
  return getActiveModal() !== null;
}

/**
 * モーダル内のフォーカストラップ（E2-02）
 */
function trapModalFocus(e) {
  if (e.key !== 'Tab') return;
  const modal = getActiveModal();
  if (!modal) return;
  const focusables = Array.from(
    modal.querySelectorAll('button:not(:disabled):not(.is-hidden), input:not(:disabled):not([hidden]), [tabindex]:not([tabindex="-1"])')
  ).filter(el => el.offsetParent !== null);
  if (focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ==========================================================================
   描画
   ========================================================================== */

function setStageSystemLabel(label, subLabel = '') {
  dom.stagePlayerName.textContent = label;
  dom.stagePlayerName.classList.add('is-system-label');
  dom.stageFighterName.textContent = subLabel;
  dom.stageFighterName.classList.toggle('is-system-sublabel', Boolean(subLabel));
}

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
    setStageSystemLabel('NO DATA', '参加者を登録してください');
    if (dom.stageTournamentCta) dom.stageTournamentCta.classList.add('is-hidden');
  } else if (!step) {
    setStageTarget(null);
    dom.stageStatus.textContent = 'COMPLETE';
    if (!state.isSpinning) {
      setStageSystemLabel('ALL UNITS READY', '全チーム確定');
    }
    if (dom.stageTournamentCta) {
      dom.stageTournamentCta.classList.toggle('is-hidden', state.isSpinning || state.teams.length < 2);
      if (dom.btnStageCreateTournament) {
        dom.btnStageCreateTournament.textContent = state.tournament
          ? '🏆 ダブルイリミネーション・トーナメント表を開く'
          : '🏆 ダブルイリミネーション・トーナメントをランダム作成';
      }
    }
  } else {
    setStageTarget(step, state.teams[step.teamIndex]);
    dom.stageStatus.textContent = state.isSpinning ? 'SCANNING' : 'STANDBY';
    if (!state.isSpinning && done === 0) {
      setStageSystemLabel('READY', 'Space で抽選開始');
    }
    if (dom.stageTournamentCta) dom.stageTournamentCta.classList.add('is-hidden');
  }

  if (dom.btnOpenTournament) {
    dom.btnOpenTournament.disabled = state.isSpinning || state.teams.length < 2;
    dom.btnOpenTournament.innerHTML = state.tournament
      ? '<span>🏆 トーナメント表</span>'
      : '<span>🏆 トーナメント作成</span>';
  }

  const showFighter = state.settings.showFighter !== false;
  document.body.className = `bg-${state.settings.bgMode}${showFighter ? '' : ' hide-fighter'}`;
  const bgNames = { dark: 'ダーク', transparent: 'OBS透過', stage: 'ステージ' };
  dom.bgModeLabel.textContent = bgNames[state.settings.bgMode] || state.settings.bgMode;
  if (dom.fighterModeLabel) {
    dom.fighterModeLabel.textContent = showFighter ? '表示' : '非表示';
  }
  if (dom.btnToggleFighter) {
    dom.btnToggleFighter.setAttribute('aria-pressed', String(showFighter));
  }

  renderTeamsGrid(state, step);
  renderTournamentSection(state);
}

function switchView(view) {
  activeView = view === 'tournament' ? 'tournament' : 'draft';
  const isTournament = activeView === 'tournament';

  if (dom.draftViewContainer) dom.draftViewContainer.classList.toggle('is-hidden', isTournament);
  if (dom.tournamentViewContainer) dom.tournamentViewContainer.classList.toggle('is-hidden', !isTournament);

  if (dom.tabViewDraft) {
    dom.tabViewDraft.classList.toggle('is-active', !isTournament);
    dom.tabViewDraft.setAttribute('aria-selected', String(!isTournament));
  }
  if (dom.tabViewTournament) {
    dom.tabViewTournament.classList.toggle('is-active', isTournament);
    dom.tabViewTournament.setAttribute('aria-selected', String(isTournament));
  }

  if (isTournament && dom.tournamentBracketMount) {
    const state = store.getState();
    requestAnimationFrame(() => {
      renderBracketConnectors(dom.tournamentBracketMount, state.tournament, state.teams, null);
    });
  }
}

function renderTournamentSection(state) {
  if (!dom.tournamentBracketMount) return;
  const t = state.tournament;
  if (dom.tournamentMetaBadge) {
    if (t) {
      const byeCount = t.bracketSize - t.teamCount;
      dom.tournamentMetaBadge.textContent = byeCount > 0
        ? `${t.teamCount} TEAMS (${t.bracketSize}-BRACKET / ${byeCount} BYE)`
        : `${t.teamCount} TEAMS (${t.bracketSize}-BRACKET)`;
    } else {
      dom.tournamentMetaBadge.textContent = `${state.teams.length} TEAMS`;
    }
  }
  if (dom.linkObsBracket) {
    const snap = encodeTournamentSnapshot(state);
    dom.linkObsBracket.href = snap ? `bracket.html?data=${encodeURIComponent(snap)}` : 'bracket.html';
  }
  const prevSnap = lastBracketSnapshot;
  dom.tournamentBracketMount.innerHTML = renderTournamentBracket(t, state.teams, { interactive: true });
  if (t && prevSnap && prevSnap.createdAt === t.createdAt) {
    applyBracketProgressionAnimations(dom.tournamentBracketMount, prevSnap, t);
  }
  renderBracketConnectors(dom.tournamentBracketMount, t, state.teams, prevSnap);
  lastBracketSnapshot = captureBracketAnimationSnapshot(t);
}

function handleOpenOrCreateTournament({ forceShuffle = false } = {}) {
  const state = store.getState();
  if (state.isSpinning) return;
  if (state.teams.length < 2) {
    showToast('トーナメントを作成するには2チーム以上必要です');
    return;
  }

  const isCreatingNew = !state.tournament || forceShuffle;
  if (isCreatingNew) {
    sound.init();
    sound.playFormation();
    lastBracketSnapshot = null;
    generateAndSaveTournament({ shuffle: true });
    showToast(`${state.teams.length}チームをランダムに振り分けてトーナメント表を生成しました！`);
  }
  switchView('tournament');
  if (isCreatingNew && dom.tournamentBracketMount) {
    const latestState = store.getState();
    lastBracketSnapshot = captureBracketAnimationSnapshot(latestState.tournament);
    animation.playTournamentCreation(dom.tournamentBracketMount, latestState.teams);
  }
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

function buildTeamObsUrl(team) {
  const minimal = {
    name: team.name,
    letter: team.letter,
    color: team.color,
    slots: team.slots.map(s => ({
      label: s.label,
      player: s.player ? { name: s.player.name, fighter: s.player.fighter || '' } : null,
    })),
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(minimal))));
  return `team.html?team=${encodeURIComponent(team.letter)}&data=${encodeURIComponent(encoded)}`;
}

function renderTeamsGrid(state, step) {
  const html = state.teams.map((team, t) => {
    const isTarget = step && step.teamIndex === t;
    const filled = team.slots.filter(s => s.player).length;
    const isComplete = filled === team.slots.length;
    const statusText = isComplete ? 'FORMED' : isTarget ? `TARGET · ${filled}/${team.slots.length}` : `${filled}/${team.slots.length}`;
    const obsHref = `team.html?team=${encodeURIComponent(team.letter)}`;

    const slots = team.slots.map((slot, s) => {
      const isActive = isTarget && step.slotIndex === s && !slot.player;
      const justIn = lastConfirmed && lastConfirmed.teamIndex === t && lastConfirmed.slotIndex === s;
      const canDrag = Boolean(slot.player) && !state.isSpinning;
      const cls = [
        'slot-item',
        slot.player ? 'is-filled' : '',
        canDrag ? 'is-draggable-slot' : '',
        isActive ? 'is-active-drawing' : '',
        justIn ? 'is-just-confirmed' : '',
      ].filter(Boolean).join(' ');
      const body = slot.player
        ? `<span class="slot-player-name" title="${escapeHtml(slot.player.name)}（ドラッグで他の枠と入れ替え可）"><span class="slot-drag-handle" aria-hidden="true">⠿</span>${escapeHtml(slot.player.name)}</span>
           ${slot.player.fighter ? `<span class="slot-fighter-name" title="${escapeHtml(slot.player.fighter)}">${escapeHtml(slot.player.fighter)}</span>` : '<span></span>'}`
        : `<span class="slot-waiting-text">${isActive ? '▶ NEXT DRAW' : 'VACANT'}</span>`;
      return `<li class="${cls}" data-team-index="${t}" data-slot-index="${s}" ${canDrag ? 'draggable="true"' : ''}><span class="slot-label">${slot.label}</span>${body}</li>`;
    }).join('');

    return `
      <article class="team-card panel ${isTarget ? 'is-current-target' : ''} ${isComplete ? 'is-complete' : ''}"
        style="--team-color:${team.color}"
        data-team-index="${t}"
        ${isComplete ? `tabindex="0" role="button" aria-label="${escapeHtml(team.name)}の拡大カードを表示"` : ''}>
        <div class="team-header">
          <div class="team-emblem-mini">${escapeHtml(team.letter)}</div>
          <div class="team-title-wrap">
            <div class="team-title" title="${escapeHtml(team.name)}">${escapeHtml(team.name)}</div>
            <button type="button" class="team-rename-btn" data-rename-team="${t}" title="チーム名を変更" aria-label="${escapeHtml(team.name)}のチーム名を変更">✎</button>
          </div>
          <div class="team-status-tag">${statusText}</div>
          ${isComplete ? '<span class="team-zoom-hint" aria-hidden="true">⤢ 拡大</span>' : ''}
          <a href="${obsHref}" target="_blank" rel="noopener" class="team-obs-link" title="${escapeHtml(team.name)}のOBS用単体カードページを開く" aria-label="${escapeHtml(team.name)}のOBS用単体カードページを開く">OBS</a>
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
  dom.stagePlayerName.classList.remove('is-system-label');
  dom.stageFighterName.classList.remove('is-system-sublabel');
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
    const teamIdx = commit.step.teamIndex;
    const team = store.getState().teams[teamIdx];
    await animation.showFormation(team, dom.formationOverlay, {
      obsUrl: buildTeamObsUrl(team),
      onRename: (newName) => {
        const updated = renameTeam(teamIdx, newName);
        if (updated) showToast(`チーム名を「${updated}」に変更しました`);
        return updated;
      },
    });
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
    setStageSystemLabel('UNDO', '直前の抽選を取り消しました');
    showToast('直前の抽選を取り消しました');
  }
}

function handleToggleBg() {
  const modes = ['dark', 'transparent', 'stage'];
  const state = store.getState();
  const next = modes[(modes.indexOf(state.settings.bgMode) + 1) % modes.length];
  store.setState({ settings: { ...state.settings, bgMode: next } });
}

function handleToggleFighter() {
  const state = store.getState();
  const next = state.settings.showFighter === false;
  store.setState({ settings: { ...state.settings, showFighter: next } });
}

/* ==========================================================================
   参加者・チーム設定モーダル
   ========================================================================== */

function openParticipantsModal() {
  lastFocusedBeforeModal = document.activeElement;
  const state = store.getState();
  editingPlayers = state.players.map(p => ({ ...p }));
  editingId = null;
  teamCountTouched = state.teams.length > 0;

  dom.inputTeamCount.value = state.teams.length || state.settings.teamCount || recommendedTeamCount(editingPlayers.length);

  const orderRadio = document.querySelector(`input[name="draft-order"][value="${state.draftOrderMode}"]`);
  if (orderRadio) orderRadio.checked = true;
  const speedRadio = document.querySelector(`input[name="spin-speed"][value="${state.settings.spinDurationSec}"]`);
  if (speedRadio) speedRadio.checked = true;
  if (dom.checkboxShowFighter) dom.checkboxShowFighter.checked = state.settings.showFighter !== false;
  dom.checkboxSound.checked = state.settings.seEnabled;

  dom.applyWarning.textContent = state.currentStepIndex > 0
    ? `※ 適用すると、現在の抽選結果（${state.currentStepIndex}名分）は消えます。`
    : '';

  resetPlayerForm();
  renderPlayerList();
  dom.modalParticipants.classList.add('is-active');
  dom.modalParticipants.setAttribute('aria-hidden', 'false');
  setTimeout(() => dom.inputName.focus(), 50);
}

function closeParticipantsModal() {
  dom.modalParticipants.classList.remove('is-active');
  dom.modalParticipants.setAttribute('aria-hidden', 'true');
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
    lastFocusedBeforeModal.focus();
  }
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
          <button type="button" class="btn btn-secondary btn-icon" data-action="edit" aria-label="${escapeHtml(p.name)}を編集">編集</button>
          <button type="button" class="btn btn-danger btn-icon" data-action="delete" aria-label="${escapeHtml(p.name)}を削除">削除</button>
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

  const wasEditing = Boolean(editingId);
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
  if (!wasEditing) {
    dom.playerList.scrollTop = dom.playerList.scrollHeight;
  }
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
    settings: {
      ...state.settings,
      spinDurationSec: speed,
      showFighter: dom.checkboxShowFighter ? dom.checkboxShowFighter.checked : true,
      seEnabled: dom.checkboxSound.checked,
    },
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

  window.addEventListener('resize', () => {
    if (activeView === 'tournament' && dom.tournamentBracketMount) {
      const st = store.getState();
      renderBracketConnectors(dom.tournamentBracketMount, st.tournament, st.teams, null);
    }
  });

  // 操作バー
  dom.btnDrawNext.addEventListener('click', () => {
    sound.init();
    if (activeView === 'tournament') switchView('draft');
    handleDrawNext();
  });
  // 抽選中にステージをクリックするとスキップ（時短）
  dom.stageCard.addEventListener('click', (e) => {
    if (e.target.closest('#stage-tournament-cta')) return;
    animation.skipRoulette();
  });
  dom.btnUndo.addEventListener('click', handleUndo);
  if (dom.btnToggleFighter) dom.btnToggleFighter.addEventListener('click', handleToggleFighter);
  dom.btnToggleBg.addEventListener('click', handleToggleBg);
  dom.btnOpenParticipants.addEventListener('click', openParticipantsModal);

  // ビュー切替 & トーナメント操作
  if (dom.tabViewDraft) {
    dom.tabViewDraft.addEventListener('click', () => switchView('draft'));
  }
  if (dom.tabViewTournament) {
    dom.tabViewTournament.addEventListener('click', () => {
      const state = store.getState();
      if (!state.tournament && state.teams.length >= 2) {
        handleOpenOrCreateTournament({ forceShuffle: true });
      } else {
        switchView('tournament');
      }
    });
  }
  if (dom.btnOpenTournament) {
    dom.btnOpenTournament.addEventListener('click', () => {
      if (activeView === 'tournament') {
        switchView('draft');
      } else {
        handleOpenOrCreateTournament({ forceShuffle: false });
      }
    });
  }
  if (dom.btnStageCreateTournament) {
    dom.btnStageCreateTournament.addEventListener('click', (e) => {
      e.stopPropagation();
      handleOpenOrCreateTournament({ forceShuffle: false });
    });
  }
  if (dom.btnShuffleTournament) {
    dom.btnShuffleTournament.addEventListener('click', () => {
      const state = store.getState();
      if (!state.teams || state.teams.length < 2) return;
      const hasProgress = state.tournament && Object.values(state.tournament.matches || {}).some(
        m => !m.isAutoResolved && m.status === 'completed'
      );
      if (hasProgress && !confirm('進行中の試合結果があります。再シャッフルすると試合結果がリセットされますがよろしいですか？')) {
        return;
      }
      handleOpenOrCreateTournament({ forceShuffle: true });
    });
  }
  if (dom.btnResetTournamentScores) {
    dom.btnResetTournamentScores.addEventListener('click', () => {
      const state = store.getState();
      if (!state.tournament) return;
      if (!confirm('現在のトーナメント配置のまま、すべての勝敗とスコアを初期状態に戻しますか？')) return;
      resetTournamentResults();
      showToast('トーナメントの試合結果をリセットしました');
    });
  }
  if (dom.btnBackToDraft) {
    dom.btnBackToDraft.addEventListener('click', () => switchView('draft'));
  }

  // トーナメント表内のクリック操作（勝者選択・スコア増減・勝敗取消）
  if (dom.tournamentBracketMount) {
    dom.tournamentBracketMount.addEventListener('click', (e) => {
      // スコア増減ボタン
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

      // 勝敗取消ボタン
      const clearBtn = e.target.closest('.b-match-clear');
      if (clearBtn) {
        e.stopPropagation();
        const matchId = clearBtn.dataset.clearMatch;
        updateMatchResult(matchId, { winnerSlot: null });
        showToast('試合の勝敗を取り消しました');
        return;
      }

      // チーム行クリックで勝者確定
      const winSlotEl = e.target.closest('.b-slot.is-clickable[data-win-slot]');
      if (winSlotEl) {
        const matchId = winSlotEl.dataset.matchId;
        const winSlot = winSlotEl.dataset.winSlot;
        const prevTournament = store.getState().tournament;
        const prevChamp = prevTournament?.championTeamIndex;
        const prevNeedsReset = prevTournament?.needsReset;
        sound.init();
        sound.playLockOn();
        const updated = updateMatchResult(matchId, { winnerSlot: winSlot });
        if (updated) {
          if (updated.needsReset && !prevNeedsReset) {
            sound.playImpact();
            showToast('⚡ GRAND FINALS RESET 発動！最終決戦 (GF2) が解放されました！', 3800);
          } else if (updated.championTeamIndex !== null && updated.championTeamIndex !== prevChamp) {
            const champTeam = store.getState().teams[updated.championTeamIndex];
            sound.playFanfare();
            animation.playChampionCelebration(champTeam);
            showToast(`🏆 優勝は「${champTeam?.name || 'TEAM'}」に決定しました！`, 4500);
          } else {
            sound.playDecodeBlip();
          }
        }
      }
    });

    dom.tournamentBracketMount.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.code === 'Space') {
        const winSlotEl = e.target.closest('.b-slot.is-clickable[data-win-slot]');
        if (winSlotEl && !e.target.closest('.b-score-btn')) {
          e.preventDefault();
          winSlotEl.click();
        }
      }
    });

    // トーナメント表内でのドラッグ＆ドロップによるチーム配置入れ替え
    let draggedBracketSlot = null;
    dom.tournamentBracketMount.addEventListener('dragstart', (e) => {
      const slotEl = e.target.closest('.b-slot[draggable="true"][data-swap-match]');
      if (!slotEl) {
        e.preventDefault();
        return;
      }
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
    dom.tournamentBracketMount.addEventListener('dragend', () => {
      draggedBracketSlot = null;
      dom.tournamentBracketMount.querySelectorAll('.is-dragging, .is-drag-over').forEach(el => {
        el.classList.remove('is-dragging', 'is-drag-over');
      });
    });
    dom.tournamentBracketMount.addEventListener('dragover', (e) => {
      if (!draggedBracketSlot) return;
      const targetEl = e.target.closest('.b-slot.is-drop-target[data-swap-match]');
      if (!targetEl) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      dom.tournamentBracketMount.querySelectorAll('.is-drag-over').forEach(el => {
        if (el !== targetEl) el.classList.remove('is-drag-over');
      });
      targetEl.classList.add('is-drag-over');
    });
    dom.tournamentBracketMount.addEventListener('dragleave', (e) => {
      const targetEl = e.target.closest('.b-slot.is-drop-target');
      if (targetEl && !targetEl.contains(e.relatedTarget)) {
        targetEl.classList.remove('is-drag-over');
      }
    });
    dom.tournamentBracketMount.addEventListener('drop', (e) => {
      if (!draggedBracketSlot) return;
      const targetEl = e.target.closest('.b-slot.is-drop-target[data-swap-match]');
      dom.tournamentBracketMount.querySelectorAll('.is-dragging, .is-drag-over').forEach(el => {
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
        sound.init();
        sound.playDecodeBlip();
        showToast('トーナメントのチーム配置を入れ替えました');
      }
    });
  }

  // チームカード上でのインラインチーム名編集
  const startCardTeamRename = (teamIdx, cardEl) => {
    const state = store.getState();
    const team = state.teams[teamIdx];
    if (!team || !cardEl) return;
    const titleWrap = cardEl.querySelector('.team-title-wrap');
    if (!titleWrap || titleWrap.querySelector('.team-rename-input')) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'team-rename-input';
    input.value = team.name;
    input.maxLength = 32;
    input.setAttribute('aria-label', '新しいチーム名');

    titleWrap.innerHTML = '';
    titleWrap.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) {
        const nextName = input.value.trim();
        if (nextName && nextName !== team.name) {
          const updated = renameTeam(teamIdx, nextName);
          if (updated) showToast(`チーム名を「${updated}」に変更しました`);
          return;
        } else if (!nextName) {
          const updated = renameTeam(teamIdx, '');
          if (updated && updated !== team.name) showToast(`チーム名を「${updated}」に戻しました`);
          return;
        }
      }
      renderUI(store.getState());
    };

    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  };

  // 確定済みチームカードのクリック・Enterで拡大表示
  const openCompletedTeamCard = (cardEl) => {
    if (!cardEl) return;
    const state = store.getState();
    if (state.isSpinning) return;
    const idx = parseInt(cardEl.dataset.teamIndex, 10);
    const team = state.teams[idx];
    if (!team || !team.slots.every(s => s.player)) return;
    sound.init();
    animation.showFormation(team, dom.formationOverlay, {
      buttonLabel: '閉じる',
      obsUrl: buildTeamObsUrl(team),
      onRename: (newName) => {
        const updated = renameTeam(idx, newName);
        if (updated) {
          showToast(`チーム名を「${updated}」に変更しました`);
          const link = dom.formationOverlay.querySelector('#formation-obs-link');
          const updatedTeam = store.getState().teams[idx];
          if (link && updatedTeam) link.href = buildTeamObsUrl(updatedTeam);
        }
        return updated;
      },
    });
  };
  dom.teamsGrid.addEventListener('click', (e) => {
    if (e.target.closest('.team-obs-link') || e.target.closest('.team-rename-input')) return;
    const renameBtn = e.target.closest('.team-rename-btn');
    if (renameBtn) {
      e.stopPropagation();
      const idx = parseInt(renameBtn.dataset.renameTeam, 10);
      startCardTeamRename(idx, renameBtn.closest('.team-card'));
      return;
    }
    const card = e.target.closest('.team-card.is-complete');
    if (card) openCompletedTeamCard(card);
  });
  dom.teamsGrid.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.code === 'Space') {
      const card = e.target.closest('.team-card.is-complete');
      if (card) {
        e.preventDefault();
        e.stopPropagation();
        openCompletedTeamCard(card);
      }
    }
  });

  // チームカード間のメンバー入れ替え（ドラッグ＆ドロップ）
  let draggedTeamSlot = null;
  dom.teamsGrid.addEventListener('dragstart', (e) => {
    const slotEl = e.target.closest('.slot-item[draggable="true"]');
    if (!slotEl || store.getState().isSpinning) {
      e.preventDefault();
      return;
    }
    draggedTeamSlot = {
      teamIndex: parseInt(slotEl.dataset.teamIndex, 10),
      slotIndex: parseInt(slotEl.dataset.slotIndex, 10),
    };
    slotEl.classList.add('is-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify(draggedTeamSlot));
    }
  });
  dom.teamsGrid.addEventListener('dragend', () => {
    draggedTeamSlot = null;
    dom.teamsGrid.querySelectorAll('.is-dragging, .is-drag-over').forEach(el => {
      el.classList.remove('is-dragging', 'is-drag-over');
    });
  });
  dom.teamsGrid.addEventListener('dragover', (e) => {
    if (!draggedTeamSlot) return;
    const targetSlot = e.target.closest('.slot-item[data-team-index][data-slot-index]');
    if (!targetSlot) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dom.teamsGrid.querySelectorAll('.is-drag-over').forEach(el => {
      if (el !== targetSlot) el.classList.remove('is-drag-over');
    });
    targetSlot.classList.add('is-drag-over');
  });
  dom.teamsGrid.addEventListener('dragleave', (e) => {
    const targetSlot = e.target.closest('.slot-item');
    if (targetSlot && !targetSlot.contains(e.relatedTarget)) {
      targetSlot.classList.remove('is-drag-over');
    }
  });
  dom.teamsGrid.addEventListener('drop', (e) => {
    if (!draggedTeamSlot) return;
    const targetSlot = e.target.closest('.slot-item[data-team-index][data-slot-index]');
    dom.teamsGrid.querySelectorAll('.is-dragging, .is-drag-over').forEach(el => {
      el.classList.remove('is-dragging', 'is-drag-over');
    });
    if (!targetSlot) return;
    e.preventDefault();
    e.stopPropagation();

    const to = {
      teamIndex: parseInt(targetSlot.dataset.teamIndex, 10),
      slotIndex: parseInt(targetSlot.dataset.slotIndex, 10),
    };
    const from = draggedTeamSlot;
    draggedTeamSlot = null;

    if (from.teamIndex === to.teamIndex && from.slotIndex === to.slotIndex) return;
    if (swapTeamSlots(from, to)) {
      sound.init();
      sound.playDecodeBlip();
      showToast('メンバーの配置を入れ替えました（Zキーで戻せます）');
    }
  });

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
  const openReset = () => {
    if (store.getState().isSpinning) return;
    lastFocusedBeforeModal = document.activeElement;
    dom.modalReset.classList.add('is-active');
    dom.modalReset.setAttribute('aria-hidden', 'false');
    setTimeout(() => dom.btnCancelReset.focus(), 50);
  };
  const closeReset = () => {
    dom.modalReset.classList.remove('is-active');
    dom.modalReset.setAttribute('aria-hidden', 'true');
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
      lastFocusedBeforeModal.focus();
    }
  };
  dom.btnReset.addEventListener('click', openReset);
  dom.btnCancelReset.addEventListener('click', closeReset);
  dom.btnCloseReset.addEventListener('click', closeReset);
  dom.btnConfirmReset.addEventListener('click', () => {
    animation.stopFinale();
    lastConfirmed = null;
    const state = store.getState();
    initializeDraft(state.players, state.teams.length, state.draftOrderMode);
    dom.stageCard.classList.remove('is-locked', 'impact');
    setStageSystemLabel('READY', 'Space で抽選開始');
    closeReset();
    showToast('抽選結果をリセットしました');
  });

  // キーボード
  window.addEventListener('keydown', (e) => {
    if (isModalOpen()) {
      if (e.key === 'Escape') {
        if (dom.modalParticipants.classList.contains('is-active')) closeParticipantsModal();
        if (dom.modalReset.classList.contains('is-active')) closeReset();
        return;
      }
      trapModalFocus(e);
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
      // トーナメント画面表示中はSpaceでの誤抽選を防ぐ
      if (activeView === 'tournament') return;
      // ボタン等にフォーカスがある状態でEnter/Spaceを押した時の二重発火を防止
      if (document.activeElement && document.activeElement !== document.body && document.activeElement !== dom.btnDrawNext) {
        if (e.code === 'Enter') return;
      }
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
