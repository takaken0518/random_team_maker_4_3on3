/**
 * draft-engine.js - チーム枠生成・ドラフト順序キュー・抽選ロジック
 */

import { store } from './state.js';
import { computeTeamSizes } from './participants.js';

const TEAM_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * チームごとのアクセントカラー（ランク戦の部隊カラーをイメージ）
 */
export const TEAM_COLORS = [
  '#00e5ff', '#3dffa8', '#ff4d6d', '#ffc23d', '#b17dff', '#4d8dff',
  '#ff8a3d', '#7dffe1', '#ff5ec4', '#c6ff3d', '#5ee0ff', '#ffd95e',
];

export function getTeamLetter(index) {
  if (index < 26) return TEAM_LETTERS[index];
  const first = Math.floor(index / 26) - 1;
  return `${TEAM_LETTERS[first]}${TEAM_LETTERS[index % 26]}`;
}

export function getTeamName(index) {
  return `TEAM ${getTeamLetter(index)}`;
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * ドラフトを初期化
 * @param {Array} players
 * @param {number} teamCount
 * @param {'round'|'team'} mode
 */
export function initializeDraft(players, teamCount, mode = 'round') {
  const sizes = computeTeamSizes(players.length, teamCount);
  if (sizes.length === 0) return false;

  const teams = sizes.map((size, t) => ({
    id: `team_${t}`,
    name: getTeamName(t),
    letter: getTeamLetter(t),
    color: TEAM_COLORS[t % TEAM_COLORS.length],
    slots: Array.from({ length: size }, (_, s) => ({
      slotNumber: s + 1,
      label: ordinal(s + 1),
      player: null,
    })),
  }));

  const draftQueue = [];
  const pushStep = (t, s) => draftQueue.push({
    stepIndex: draftQueue.length,
    teamIndex: t,
    slotIndex: s,
    teamName: teams[t].name,
    slotLabel: teams[t].slots[s].label,
  });

  const maxSize = Math.max(...sizes);
  if (mode === 'round') {
    // 全チームの1人目 → 2人目 → ...（人数の少ないチームは最後の巡をスキップ）
    for (let s = 0; s < maxSize; s++) {
      for (let t = 0; t < teams.length; t++) {
        if (s < sizes[t]) pushStep(t, s);
      }
    }
  } else {
    // チーム完結順
    for (let t = 0; t < teams.length; t++) {
      for (let s = 0; s < sizes[t]; s++) pushStep(t, s);
    }
  }

  const state = store.getState();
  store.setState({
    players: [...players],
    teams,
    draftOrderMode: mode,
    draftQueue,
    currentStepIndex: 0,
    undrawnPlayerIds: players.map(p => p.id),
    isSpinning: false,
    history: [],
    settings: { ...state.settings, teamCount },
  });
  return true;
}

export function getCurrentStep() {
  const state = store.getState();
  if (state.currentStepIndex >= state.draftQueue.length) return null;
  return state.draftQueue[state.currentStepIndex];
}

function secureRandomIndex(max) {
  if (max <= 1) return 0;
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : (typeof crypto !== 'undefined' ? crypto : null);
  if (cryptoObj && cryptoObj.getRandomValues) {
    const array = new Uint32Array(1);
    cryptoObj.getRandomValues(array);
    return array[0] % max;
  }
  return Math.floor(Math.random() * max);
}

/**
 * 次の当選者を決める（まだ状態には反映しない）
 */
export function selectNextWinner() {
  const state = store.getState();
  const step = getCurrentStep();
  if (!step || state.undrawnPlayerIds.length === 0) return null;
  const winnerId = state.undrawnPlayerIds[secureRandomIndex(state.undrawnPlayerIds.length)];
  return { step, winner: state.players.find(p => p.id === winnerId) };
}

/**
 * 当選者を確定して状態に反映
 * isSpinning の解除は呼び出し側（演出終了後）で行う
 * @returns {{ step, teamCompleted: boolean, draftCompleted: boolean } | null}
 */
export function commitWinner(winner) {
  const state = store.getState();
  const step = getCurrentStep();
  if (!step || !winner) return null;

  store.pushHistory();

  const teams = JSON.parse(JSON.stringify(state.teams));
  const slot = teams[step.teamIndex].slots[step.slotIndex];
  slot.player = winner;
  slot.confirmedAt = Date.now();

  const nextIndex = state.currentStepIndex + 1;
  store.setState({
    teams,
    undrawnPlayerIds: state.undrawnPlayerIds.filter(id => id !== winner.id),
    currentStepIndex: nextIndex,
  });

  return {
    step,
    teamCompleted: teams[step.teamIndex].slots.every(s => s.player),
    draftCompleted: nextIndex >= state.draftQueue.length,
  };
}

export function undoStep() {
  const state = store.getState();
  if (state.isSpinning) return false;
  return store.popHistory();
}

/**
 * チーム名を後から変更（空文字の場合はデフォルトの TEAM A 等に戻す）
 * @param {number} teamIndex
 * @param {string} newName
 */
export function renameTeam(teamIndex, newName) {
  const state = store.getState();
  if (!state.teams || !state.teams[teamIndex]) return null;
  const trimmed = String(newName ?? '').trim();
  const finalName = trimmed || getTeamName(teamIndex);

  const teams = state.teams.map((t, i) => (i === teamIndex ? { ...t, name: finalName } : t));
  const draftQueue = (state.draftQueue || []).map(step => (
    step.teamIndex === teamIndex ? { ...step, teamName: finalName } : step
  ));
  const history = (state.history || []).map(snap => ({
    ...snap,
    teams: (snap.teams || []).map((t, i) => (i === teamIndex ? { ...t, name: finalName } : t)),
  }));

  store.setState({ teams, draftQueue, history });
  return finalName;
}
