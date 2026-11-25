/**
 * bracket-renderer.js - ダブルイリミネーション・トーナメント表のHTML描画とインタラクション補助
 */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * チームメンバーの簡易文字列（例: "あcola / ミーヤー / ザクレイ"）
 */
function formatTeamMembers(team) {
  if (!team || !team.slots) return '';
  const names = team.slots.map(s => s.player?.name).filter(Boolean);
  return names.length > 0 ? names.join(' / ') : 'メンバー未確定';
}

/**
 * そのスロットが初期シード入れ替え（ドラッグ＆ドロップ）可能か判定
 */
function canSwapSeedSlot(match, slotKey, matches) {
  if (!match) return false;
  if (match.bracket === 'winners' && match.round === 1) return true;
  // W-R2 でも、親の W-R1 が BYE 自動進出だった枠なら入れ替え可能にする
  const src = slotKey === 'A' ? match.sourceA : match.sourceB;
  if (src && src.type === 'WINNER_OF' && matches) {
    const parent = matches[src.matchId];
    if (parent && parent.bracket === 'winners' && parent.round === 1 && parent.status === 'bye') {
      return true;
    }
  }
  return false;
}

/**
 * 1つのスロット行（上段 A または 下段 B）を描画
 */
function renderMatchSlot(match, slotKey, teams, interactive, matches) {
  const slot = slotKey === 'A' ? match.teamA : match.teamB;
  const score = slotKey === 'A' ? (match.scoreA ?? 0) : (match.scoreB ?? 0);
  const isReadyOrCompleted = match.status === 'ready' || match.status === 'completed';
  const canInteract = interactive && !match.isAutoResolved && match.status !== 'inactive' && isReadyOrCompleted;
  const isSwappable = interactive && canSwapSeedSlot(match, slotKey, matches);
  const swapAttrs = isSwappable
    ? `data-swap-match="${match.id}" data-swap-slot="${slotKey}"`
    : '';

  if (!slot || slot.state === 'TBD') {
    return `
      <div class="b-slot is-tbd">
        <span class="b-slot-badge">TBD</span>
        <span class="b-slot-name">${escapeHtml(slot?.label || '未定')}</span>
      </div>`;
  }

  if (slot.state === 'BYE') {
    return `
      <div class="b-slot is-bye ${isSwappable ? 'is-drop-target' : ''}" ${swapAttrs}>
        <span class="b-slot-badge">BYE</span>
        <span class="b-slot-name">不戦勝枠 (BYE)${isSwappable ? ' — ドロップで移動可' : ''}</span>
      </div>`;
  }

  const team = teams[slot.teamIndex];
  if (!team) {
    return `
      <div class="b-slot is-tbd">
        <span class="b-slot-badge">?</span>
        <span class="b-slot-name">TEAM #${slot.teamIndex + 1}</span>
      </div>`;
  }

  const isWinner = (match.status === 'completed' || match.status === 'bye') && match.winnerTeamIndex === slot.teamIndex;
  const isLoser = match.status === 'completed' && match.loserTeamIndex === slot.teamIndex;
  const membersText = formatTeamMembers(team);

  const cls = [
    'b-slot',
    'is-team',
    isWinner ? 'is-winner' : '',
    isLoser ? 'is-loser' : '',
    canInteract ? 'is-clickable' : '',
    isSwappable ? 'is-draggable-seed is-drop-target' : '',
  ].filter(Boolean).join(' ');

  const scoreControls = canInteract ? `
    <div class="b-score-box" data-stop-win="true">
      <button type="button" class="b-score-btn" data-match-id="${match.id}" data-slot="${slotKey}" data-score-delta="-1" title="スコア -1" aria-label="${escapeHtml(team.name)}のスコアを減らす">−</button>
      <span class="b-score-val">${score}</span>
      <button type="button" class="b-score-btn" data-match-id="${match.id}" data-slot="${slotKey}" data-score-delta="1" title="スコア +1" aria-label="${escapeHtml(team.name)}のスコアを増やす">＋</button>
    </div>` : (match.status === 'completed' || match.status === 'ready' ? `<span class="b-score-static">${score}</span>` : '');

  const winIndicator = isWinner
    ? `<span class="b-win-tag">${match.status === 'bye' ? 'AUTO' : 'WIN'}</span>`
    : (canInteract ? `<span class="b-win-hint">WIN</span>` : '');

  const dragHandle = isSwappable
    ? `<span class="b-drag-handle" title="ドラッグして他の枠とチームを入れ替え" aria-hidden="true">⠿</span>`
    : '';

  return `
    <div class="${cls}"
      style="--team-color:${team.color}"
      ${isSwappable ? 'draggable="true"' : ''}
      ${swapAttrs}
      ${canInteract ? `data-match-id="${match.id}" data-win-slot="${slotKey}" role="button" tabindex="0" title="クリックで「${escapeHtml(team.name)}」の勝利として記録 / ドラッグで配置入れ替え"` : (isSwappable ? `title="ドラッグで「${escapeHtml(team.name)}」の配置を入れ替え"` : '')}>
      ${dragHandle}
      <span class="b-slot-emblem">${escapeHtml(team.letter)}</span>
      <div class="b-slot-info">
        <div class="b-slot-title-row">
          <span class="b-slot-name" title="${escapeHtml(team.name)}">${escapeHtml(team.name)}</span>
          ${winIndicator}
        </div>
        <div class="b-slot-members" title="${escapeHtml(membersText)}">${escapeHtml(membersText)}</div>
      </div>
      ${scoreControls}
    </div>`;
}

/**
 * 1試合のカードを描画
 */
function renderMatchCard(match, teams, interactive, matches) {
  if (!match) return '';

  // 両方 BYE の空枠カードは控えめな表示にする
  if (match.status === 'bye' && match.teamA?.state === 'BYE' && match.teamB?.state === 'BYE') {
    return `
      <article class="b-match is-empty-bye" data-match-id="${match.id}">
        <div class="b-match-meta">
          <span class="b-match-code">${escapeHtml(match.code)}</span>
          <span class="b-match-status">BYE</span>
        </div>
      </article>`;
  }

  const statusLabels = {
    pending: 'WAITING',
    ready: 'READY',
    completed: 'FINISHED',
    bye: 'BYE ADVANCE',
    inactive: 'OPTIONAL',
  };

  const cls = [
    'b-match',
    `status-${match.status}`,
    `bracket-${match.bracket}`,
  ].join(' ');

  const canClear = interactive && !match.isAutoResolved && match.status === 'completed';

  return `
    <article class="${cls}" data-match-id="${match.id}">
      <div class="b-match-meta">
        <span class="b-match-code">${escapeHtml(match.code)}</span>
        <span class="b-match-status">${statusLabels[match.status] || match.status}</span>
        ${canClear ? `<button type="button" class="b-match-clear" data-clear-match="${match.id}" title="勝敗を取り消す">↺ 取消</button>` : ''}
      </div>
      <div class="b-match-slots">
        ${renderMatchSlot(match, 'A', teams, interactive, matches)}
        ${renderMatchSlot(match, 'B', teams, interactive, matches)}
      </div>
    </article>`;
}

/**
 * ラウンド列を描画
 */
function renderRoundColumn(roundObj, matches, teams, interactive) {
  // 両方BYEのみの不要な見かけ上のカードをフィルタするかそのまま出してツリー高さを揃える
  const cardsHtml = roundObj.matchIds.map(id => {
    const m = matches[id];
    return `<div class="b-match-cell">${renderMatchCard(m, teams, interactive, matches)}</div>`;
  }).join('');

  return `
    <div class="b-round-col" data-round="${roundObj.round}">
      <div class="b-round-header">${escapeHtml(roundObj.title)}</div>
      <div class="b-round-matches">
        ${cardsHtml}
      </div>
    </div>`;
}

/**
 * 優勝チームバナーを描画
 */
function renderChampionBanner(tournament, teams) {
  if (tournament.championTeamIndex === null || tournament.championTeamIndex === undefined) {
    return '';
  }
  const champ = teams[tournament.championTeamIndex];
  if (!champ) return '';
  const members = formatTeamMembers(champ);

  return `
    <div class="b-champion-banner panel" style="--team-color:${champ.color}">
      <div class="b-champ-crown">🏆 GRAND CHAMPION</div>
      <div class="b-champ-main">
        <span class="b-champ-emblem">${escapeHtml(champ.letter)}</span>
        <div class="b-champ-text">
          <div class="b-champ-name">${escapeHtml(champ.name)}</div>
          <div class="b-champ-members">${escapeHtml(members)}</div>
        </div>
      </div>
    </div>`;
}

/**
 * トーナメント全体を描画
 * @param {Object} tournament
 * @param {Array} teams
 * @param {{ interactive?: boolean, filter?: 'all'|'winners'|'losers' }} options
 */
export function renderTournamentBracket(tournament, teams, { interactive = true, filter = 'all' } = {}) {
  if (!tournament || !teams || teams.length < 2) {
    return `
      <div class="b-empty-state panel">
        <div class="b-empty-title">NO BRACKET DATA</div>
        <p class="b-empty-desc">2チーム以上編成されている状態で「🎲 ランダム振り分けで生成」を押すと、ダブルイリミネーションのトーナメント表が作成されます。</p>
      </div>`;
  }

  const { matches, winnersRounds, losersRounds, finalsRounds } = tournament;

  const winnersCols = winnersRounds.map(r => renderRoundColumn(r, matches, teams, interactive)).join('');

  // Grand Finals 列（Reset が inactive でも、リセットルールが分かるように表示。不要時はコンパクトに）
  const activeFinalsRounds = finalsRounds.filter(r => {
    if (r.round === 2) {
      const gf2 = matches['GF-M2'];
      return gf2 && (gf2.status !== 'inactive' || tournament.championTeamIndex === null);
    }
    return true;
  });
  const finalsCols = activeFinalsRounds.map(r => renderRoundColumn(r, matches, teams, interactive)).join('');

  const losersCols = losersRounds.map(r => renderRoundColumn(r, matches, teams, interactive)).join('');

  const showWinners = filter === 'all' || filter === 'winners';
  const showLosers = (filter === 'all' || filter === 'losers') && losersRounds.length > 0;

  return `
    ${renderChampionBanner(tournament, teams)}
    <div class="b-sections-wrap">
      ${showWinners ? `
      <section class="b-section b-section-winners panel" aria-label="Winners Bracket & Grand Finals">
        <div class="b-section-header">
          <span class="b-section-tag winners-tag">UPPER BRACKET</span>
          <h2 class="b-section-title">WINNERS BRACKET &amp; GRAND FINALS</h2>
          <span class="b-section-hint">${interactive ? '⠿ ドラッグ＆ドロップで1回戦のチーム配置を入れ替え ／ クリックで勝者進出' : 'LIVE TOURNAMENT BRACKET'}</span>
        </div>
        <div class="b-tree-scroll">
          <div class="b-tree-grid">
            ${winnersCols}
            ${finalsCols}
          </div>
        </div>
      </section>` : ''}

      ${showLosers ? `
      <section class="b-section b-section-losers panel" aria-label="Losers Bracket">
        <div class="b-section-header">
          <span class="b-section-tag losers-tag">LOWER BRACKET</span>
          <h2 class="b-section-title">LOSERS BRACKET</h2>
          <span class="b-section-hint">Winnersの各ラウンド敗者が交差合流・ここで敗北すると敗退（2敗失格）</span>
        </div>
        <div class="b-tree-scroll">
          <div class="b-tree-grid is-losers-grid">
            ${losersCols}
          </div>
        </div>
      </section>` : ''}
    </div>`;
}

/**
 * URL共有・OBS単体画面向けに軽量化したスナップショットをBase64エンコード
 */
export function encodeTournamentSnapshot(state) {
  if (!state || !state.tournament) return '';
  const payload = {
    teams: (state.teams || []).map(t => ({
      name: t.name,
      letter: t.letter,
      color: t.color,
      slots: (t.slots || []).map(s => ({
        label: s.label,
        player: s.player ? { name: s.player.name, fighter: s.player.fighter || '' } : null,
      })),
    })),
    tournament: state.tournament,
  };
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  } catch (e) {
    console.warn('Failed to encode tournament snapshot:', e);
    return '';
  }
}

export function decodeTournamentSnapshot(dataParam) {
  if (!dataParam) return null;
  try {
    const json = decodeURIComponent(escape(atob(dataParam)));
    return JSON.parse(json);
  } catch (e) {
    console.warn('Failed to decode tournament snapshot:', e);
    return null;
  }
}
