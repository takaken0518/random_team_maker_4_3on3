/**
 * team-view.js - OBSブラウザソース用の1チーム単独カード表示ページ
 *
 * クエリパラメータ:
 *   ?team=A        : 表示するチーム（A, B, C... または 1, 2, 3...）
 *   ?style=compact : 'compact'（通常カード） | 'banner'（部隊結成大型カード）
 *   ?bg=transparent: 'transparent'（OBS透過・既定） | 'dark' | 'stage'
 *   ?fighter=1     : '1'（表示） | '0'（非表示） ※未指定時は本体設定に連動
 *   ?hud=0         : '0' を指定すると下部のヘルパーバーを初期状態で非表示（OBS取り込み用）
 *   ?data=...      : 別環境（OBSの独立CEF等）でも同じチーム構成を再現するためのBase64データ
 */

import { store } from './state.js';
import { createPlayer, SAMPLE_PLAYERS, recommendedTeamCount } from './participants.js';
import { initializeDraft, getCurrentStep, renameTeam } from './draft-engine.js';

const $ = (id) => document.getElementById(id);

const dom = {
  mount: $('obs-team-mount'),
  helperBar: $('obs-helper-bar'),
  teamTabs: $('obs-team-tabs'),
  btnRename: $('btn-obs-rename'),
  btnStyle: $('btn-obs-style'),
  styleLabel: $('obs-style-label'),
  btnFighter: $('btn-obs-fighter'),
  fighterLabel: $('obs-fighter-label'),
  btnBg: $('btn-obs-bg'),
  bgLabel: $('obs-bg-label'),
  btnCopyUrl: $('btn-obs-copy-url'),
  btnHideBar: $('btn-obs-hide-bar'),
  toast: $('toast'),
};

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function showToast(message, duration = 2600) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-show'), duration);
}

/**
 * URLパラメータから設定を取得
 */
const params = new URLSearchParams(window.location.search);
let selectedTeamKey = (params.get('team') || 'A').toUpperCase();
let cardStyle = params.get('style') === 'banner' ? 'banner' : 'compact';
let bgMode = ['transparent', 'dark', 'stage'].includes(params.get('bg')) ? params.get('bg') : 'transparent';
let fighterOverride = params.has('fighter') ? params.get('fighter') !== '0' : null;
const hideHudParam = params.get('hud') === '0' || Boolean(window.obsstudio);

/**
 * URLの ?data= パラメータに埋め込まれた単一チームスナップショット（OBSの独立ストレージ対策）
 */
function decodeEmbeddedTeam(dataParam) {
  if (!dataParam) return null;
  try {
    const json = decodeURIComponent(escape(atob(dataParam)));
    return JSON.parse(json);
  } catch (e) {
    console.warn('Failed to decode embedded team data:', e);
    return null;
  }
}

function encodeTeamSnapshot(team) {
  if (!team) return '';
  const minimal = {
    name: team.name,
    letter: team.letter,
    color: team.color,
    slots: team.slots.map(s => ({
      label: s.label,
      player: s.player ? { name: s.player.name, fighter: s.player.fighter || '' } : null,
    })),
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(minimal))));
}

const embeddedTeam = decodeEmbeddedTeam(params.get('data'));

function resolveTeam(state) {
  const teams = state.teams || [];
  if (teams.length === 0) return { team: embeddedTeam, index: 0 };

  // 1. レター一致 (A, B, C...)
  let idx = teams.findIndex(t => t.letter.toUpperCase() === selectedTeamKey);
  // 2. チーム名一致 (TEAM A...)
  if (idx === -1) {
    idx = teams.findIndex(t => t.name.toUpperCase() === selectedTeamKey);
  }
  // 3. 1始まりの番号 (1, 2, 3...)
  if (idx === -1 && /^\d+$/.test(selectedTeamKey)) {
    const num = parseInt(selectedTeamKey, 10) - 1;
    if (num >= 0 && num < teams.length) idx = num;
  }
  if (idx === -1) idx = 0;

  return { team: teams[idx], index: idx };
}

function syncUrlParams(team) {
  const url = new URL(window.location.href);
  url.searchParams.set('team', selectedTeamKey);
  url.searchParams.set('style', cardStyle);
  url.searchParams.set('bg', bgMode);
  if (fighterOverride !== null) {
    url.searchParams.set('fighter', fighterOverride ? '1' : '0');
  } else {
    url.searchParams.delete('fighter');
  }
  if (team) {
    url.searchParams.set('data', encodeTeamSnapshot(team));
  }
  window.history.replaceState(null, '', url.toString());
}

function buildObsUrl(team) {
  const url = new URL(window.location.href);
  url.searchParams.set('team', selectedTeamKey);
  url.searchParams.set('style', cardStyle);
  url.searchParams.set('bg', bgMode);
  url.searchParams.set('hud', '0');
  const showFighter = fighterOverride !== null ? fighterOverride : (store.getState().settings.showFighter !== false);
  url.searchParams.set('fighter', showFighter ? '1' : '0');
  if (team) {
    url.searchParams.set('data', encodeTeamSnapshot(team));
  }
  return url.toString();
}

function renderCompactCard(team, isTarget, step) {
  const filled = team.slots.filter(s => s.player).length;
  const isComplete = filled === team.slots.length;
  const statusText = isComplete ? 'FORMED' : isTarget ? `TARGET · ${filled}/${team.slots.length}` : `${filled}/${team.slots.length}`;

  const slots = team.slots.map((slot, s) => {
    const isActive = isTarget && step && step.slotIndex === s && !slot.player;
    const cls = ['slot-item', slot.player ? 'is-filled' : '', isActive ? 'is-active-drawing' : '']
      .filter(Boolean).join(' ');
    const body = slot.player
      ? `<span class="slot-player-name" title="${escapeHtml(slot.player.name)}">${escapeHtml(slot.player.name)}</span>
         ${slot.player.fighter ? `<span class="slot-fighter-name" title="${escapeHtml(slot.player.fighter)}">${escapeHtml(slot.player.fighter)}</span>` : '<span></span>'}`
      : `<span class="slot-waiting-text">${isActive ? '▶ NEXT DRAW' : 'VACANT'}</span>`;
    return `<li class="${cls}"><span class="slot-label">${escapeHtml(slot.label)}</span>${body}</li>`;
  }).join('');

  return `
    <article class="team-card panel obs-single-compact ${isTarget ? 'is-current-target' : ''} ${isComplete ? 'is-complete' : ''}" style="--team-color:${team.color}">
      <div class="team-header">
        <div class="team-emblem-mini">${escapeHtml(team.letter)}</div>
        <div class="team-title">${escapeHtml(team.name)}</div>
        <div class="team-status-tag">${statusText}</div>
      </div>
      <ul class="slot-list">${slots}</ul>
    </article>`;
}

function renderBannerCard(team) {
  const members = team.slots.map((s, i) => `
    <li class="formation-member obs-static-member" style="--i:${i}">
      <span class="fm-index">${String(i + 1).padStart(2, '0')}</span>
      ${s.player
        ? `<span class="fm-name">${escapeHtml(s.player.name)}</span>
           <span class="fm-fighter">${escapeHtml(s.player.fighter ?? '')}</span>`
        : `<span class="fm-name is-vacant">VACANT</span>`
      }
    </li>`).join('');

  return `
    <div class="formation-card obs-single-banner" style="--team-color:${team.color}">
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
          <div class="formation-team-name">${escapeHtml(team.name)}</div>
          <ul class="formation-members">${members}</ul>
        </div>
      </div>
      <div class="formation-bar formation-bar-bottom"></div>
    </div>`;
}

function render() {
  const state = store.getState();
  const { team, index } = resolveTeam(state);
  const step = getCurrentStep();
  const isTarget = Boolean(step && step.teamIndex === index);

  const showFighter = fighterOverride !== null
    ? fighterOverride
    : (state.settings.showFighter !== false);

  document.body.className = `obs-team-page bg-${bgMode}${showFighter ? '' : ' hide-fighter'}`;

  const bgNames = { transparent: 'OBS透過', dark: 'ダーク', stage: 'ステージ' };
  dom.bgLabel.textContent = bgNames[bgMode] || bgMode;
  dom.styleLabel.textContent = cardStyle === 'banner' ? '大型バナー' : 'コンパクト';
  dom.fighterLabel.textContent = showFighter ? '表示' : '非表示';

  if (!team) {
    dom.mount.innerHTML = `<div class="panel" style="padding:24px;text-align:center;">チームデータがありません。メイン画面でドラフトを初期化してください。</div>`;
    return;
  }

  selectedTeamKey = team.letter.toUpperCase();
  document.title = `${team.name} | OBS TEAM CARD`;

  dom.mount.innerHTML = cardStyle === 'banner'
    ? renderBannerCard(team)
    : renderCompactCard(team, isTarget, step);

  // タブ一覧
  if (state.teams && state.teams.length > 0) {
    dom.teamTabs.innerHTML = state.teams.map((t) => {
      const active = t.letter.toUpperCase() === selectedTeamKey;
      return `<button type="button" class="obs-team-tab ${active ? 'is-active' : ''}" data-letter="${escapeHtml(t.letter)}" style="--team-color:${t.color}">${escapeHtml(t.name)}</button>`;
    }).join('');
  }
}

function init() {
  const current = store.getState();
  if (current.players.length === 0 && !embeddedTeam) {
    const players = SAMPLE_PLAYERS.map(([n, f]) => createPlayer(n, f));
    initializeDraft(players, recommendedTeamCount(players.length), 'round');
  }

  if (hideHudParam) {
    dom.helperBar.classList.add('is-hidden');
  }

  store.subscribe(render);
  render();

  dom.teamTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.obs-team-tab');
    if (!btn) return;
    selectedTeamKey = btn.dataset.letter.toUpperCase();
    const { team } = resolveTeam(store.getState());
    syncUrlParams(team);
    render();
  });

  if (dom.btnRename) {
    dom.btnRename.addEventListener('click', () => {
      const state = store.getState();
      const { team, index } = resolveTeam(state);
      if (!team) return;
      const input = prompt(`「${team.name}」の新しいチーム名を入力してください（空欄で初期名に戻ります）:`, team.name);
      if (input === null) return;
      if (state.teams && state.teams[index]) {
        const updated = renameTeam(index, input);
        const nextTeam = store.getState().teams[index];
        syncUrlParams(nextTeam);
        render();
        if (updated) showToast(`チーム名を「${updated}」に変更しました`);
      } else if (embeddedTeam) {
        embeddedTeam.name = input.trim() || `TEAM ${embeddedTeam.letter}`;
        syncUrlParams(embeddedTeam);
        render();
        showToast(`チーム名を「${embeddedTeam.name}」に変更しました`);
      }
    });
  }

  dom.btnStyle.addEventListener('click', () => {
    cardStyle = cardStyle === 'compact' ? 'banner' : 'compact';
    const { team } = resolveTeam(store.getState());
    syncUrlParams(team);
    render();
  });

  dom.btnFighter.addEventListener('click', () => {
    const currentShow = fighterOverride !== null
      ? fighterOverride
      : (store.getState().settings.showFighter !== false);
    fighterOverride = !currentShow;
    const { team } = resolveTeam(store.getState());
    syncUrlParams(team);
    render();
  });

  dom.btnBg.addEventListener('click', () => {
    const modes = ['transparent', 'dark', 'stage'];
    bgMode = modes[(modes.indexOf(bgMode) + 1) % modes.length];
    const { team } = resolveTeam(store.getState());
    syncUrlParams(team);
    render();
  });

  dom.btnCopyUrl.addEventListener('click', async () => {
    const { team } = resolveTeam(store.getState());
    const obsUrl = buildObsUrl(team);
    try {
      await navigator.clipboard.writeText(obsUrl);
      showToast(`${team ? team.name : 'TEAM'} のOBS用URLをコピーしました！`);
    } catch {
      prompt('OBSブラウザソースに貼り付けるURL:', obsUrl);
    }
  });

  dom.btnHideBar.addEventListener('click', () => {
    dom.helperBar.classList.add('is-hidden');
    showToast('ヘルパーバーを隠しました（Hキーで再表示）', 2200);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') {
      dom.helperBar.classList.toggle('is-hidden');
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const teams = store.getState().teams || [];
      if (teams.length === 0) return;
      const { index } = resolveTeam(store.getState());
      const nextIdx = (index + (e.key === 'ArrowRight' ? 1 : -1) + teams.length) % teams.length;
      selectedTeamKey = teams[nextIdx].letter.toUpperCase();
      syncUrlParams(teams[nextIdx]);
      render();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
