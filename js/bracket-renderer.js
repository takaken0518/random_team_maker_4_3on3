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
      data-slot-key="${slotKey}"
      data-team-index="${slot.teamIndex}"
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
          <div class="b-tree-grid" data-tree-section="winners">
            <svg class="b-connectors-svg" aria-hidden="true"></svg>
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
          <div class="b-tree-grid is-losers-grid" data-tree-section="losers">
            <svg class="b-connectors-svg" aria-hidden="true"></svg>
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

/**
 * トーナメント進行差分アニメーション用：更新前の各マッチ・スロット状態をキャプチャ
 * @param {Object|null} tournament
 * @returns {Object|null}
 */
export function captureBracketAnimationSnapshot(tournament) {
  if (!tournament || !tournament.matches) return null;
  const matches = {};
  for (const [id, m] of Object.entries(tournament.matches)) {
    matches[id] = {
      status: m.status,
      winnerTeamIndex: m.winnerTeamIndex,
      loserTeamIndex: m.loserTeamIndex,
      teamA: m.teamA?.state === 'TEAM' ? m.teamA.teamIndex : null,
      teamB: m.teamB?.state === 'TEAM' ? m.teamB.teamIndex : null,
      scoreA: m.scoreA ?? 0,
      scoreB: m.scoreB ?? 0,
    };
  }
  return {
    createdAt: tournament.createdAt,
    championTeamIndex: tournament.championTeamIndex,
    needsReset: tournament.needsReset,
    matches,
  };
}

/**
 * 更新前スナップショットと更新後のトーナメント状態を比較し、
 * 変化のあったマッチ・スロット要素に進行アニメーション用クラスを付与する
 * @param {HTMLElement} mountEl
 * @param {Object|null} prevSnap
 * @param {Object|null} nextTournament
 */
export function applyBracketProgressionAnimations(mountEl, prevSnap, nextTournament) {
  if (!mountEl || !prevSnap || !nextTournament || !nextTournament.matches) return;
  if (prevSnap.createdAt !== nextTournament.createdAt) return;

  for (const [id, m] of Object.entries(nextTournament.matches)) {
    const prev = prevSnap.matches[id];
    if (!prev) continue;

    const matchEl = mountEl.querySelector(`.b-match[data-match-id="${id}"]`);
    if (!matchEl) continue;

    const slotAEl = matchEl.querySelector('.b-slot[data-slot-key="A"]');
    const slotBEl = matchEl.querySelector('.b-slot[data-slot-key="B"]');

    // 1. 勝敗が新たに確定したマッチ
    if (m.status === 'completed' && (prev.status !== 'completed' || prev.winnerTeamIndex !== m.winnerTeamIndex)) {
      matchEl.classList.add('is-just-completed');
      const winSlotEl = matchEl.querySelector('.b-slot.is-winner');
      const loseSlotEl = matchEl.querySelector('.b-slot.is-loser');
      if (winSlotEl) winSlotEl.classList.add('is-just-won');
      if (loseSlotEl) loseSlotEl.classList.add('is-just-lost');
    }

    // 2. 次ラウンドや Losers Bracket へチームが新規進出したスロット
    const nextTeamA = m.teamA?.state === 'TEAM' ? m.teamA.teamIndex : null;
    const nextTeamB = m.teamB?.state === 'TEAM' ? m.teamB.teamIndex : null;

    if (nextTeamA !== null && nextTeamA !== prev.teamA && slotAEl) {
      slotAEl.classList.add(m.bracket === 'losers' ? 'is-just-dropped-loser' : 'is-just-advanced');
    }
    if (nextTeamB !== null && nextTeamB !== prev.teamB && slotBEl) {
      slotBEl.classList.add(m.bracket === 'losers' ? 'is-just-dropped-loser' : 'is-just-advanced');
    }

    // 3. 両チームが揃って対戦可能 (READY) になったマッチ
    if (m.status === 'ready' && prev.status !== 'ready') {
      matchEl.classList.add('is-just-ready');
    }

    // 4. スコアが増減したスロット
    if ((m.scoreA ?? 0) !== prev.scoreA && slotAEl) {
      const scoreVal = slotAEl.querySelector('.b-score-val, .b-score-static');
      if (scoreVal) scoreVal.classList.add('is-score-pop');
    }
    if ((m.scoreB ?? 0) !== prev.scoreB && slotBEl) {
      const scoreVal = slotBEl.querySelector('.b-score-val, .b-score-static');
      if (scoreVal) scoreVal.classList.add('is-score-pop');
    }
  }

  // 5. Grand Finals Reset (GF-M2) が発動したとき
  if (nextTournament.needsReset && !prevSnap.needsReset) {
    const gf2El = mountEl.querySelector('.b-match[data-match-id="GF-M2"]');
    if (gf2El) gf2El.classList.add('is-just-reset-activated');
  }
}

/**
 * トーナメントツリー内の各マッチ間を線で結び、勝利確定箇所は線が伸びるアニメーションを描画する
 * @param {HTMLElement} mountEl - トーナメント表のマウント要素
 * @param {Object|null} tournament - state.tournament
 * @param {Array} teams - state.teams
 * @param {Object|null} prevSnap - 直前のスナップショット（新規確定したラインのみ伸長アニメーションを再生）
 */
export function renderBracketConnectors(mountEl, tournament, teams = [], prevSnap = null) {
  if (!mountEl || !tournament || !tournament.matches) return;

  const isSameTournament = prevSnap && prevSnap.createdAt === tournament.createdAt;
  const grids = mountEl.querySelectorAll('.b-tree-grid');

  grids.forEach((gridEl) => {
    const svgEl = gridEl.querySelector('.b-connectors-svg');
    if (!svgEl) return;

    const gridW = gridEl.scrollWidth || gridEl.offsetWidth;
    const gridH = gridEl.scrollHeight || gridEl.offsetHeight;
    if (gridW === 0 || gridH === 0) return;

    svgEl.setAttribute('viewBox', `0 0 ${gridW} ${gridH}`);
    svgEl.setAttribute('width', String(gridW));
    svgEl.setAttribute('height', String(gridH));

    const gridRect = gridEl.getBoundingClientRect();
    const isLosersGrid = gridEl.classList.contains('is-losers-grid');
    const basePaths = [];
    const activePaths = [];

    for (const [targetId, targetMatch] of Object.entries(tournament.matches)) {
      const targetMatchEl = gridEl.querySelector(`.b-match[data-match-id="${targetId}"]`);
      if (!targetMatchEl) continue;

      const checkAndBuildConnector = (sourceDef, slotKey) => {
        if (!sourceDef || (sourceDef.type !== 'WINNER_OF' && sourceDef.type !== 'LOSER_OF')) return;
        const srcId = sourceDef.matchId;
        const srcMatch = tournament.matches[srcId];
        if (!srcMatch) return;

        // 同じグリッドセクション内にソースのマッチカードがある場合のみ接続線を描画
        const srcMatchEl = gridEl.querySelector(`.b-match[data-match-id="${srcId}"]`);
        if (!srcMatchEl) return;

        // スタート座標: ソースマッチが勝利確定している場合は勝利スロットの右端中央、未確定ならマッチカードの右端中央
        let startAnchorEl = srcMatchEl;
        const srcWinSlotEl = srcMatchEl.querySelector('.b-slot.is-winner');
        if (srcWinSlotEl && sourceDef.type === 'WINNER_OF') {
          startAnchorEl = srcWinSlotEl;
        }
        const srcRect = startAnchorEl.getBoundingClientRect();
        const x1 = Math.round((srcRect.right - gridRect.left) * 10) / 10;
        const y1 = Math.round((srcRect.top + srcRect.height / 2 - gridRect.top) * 10) / 10;

        // エンド座標: ターゲットマッチの該当スロット (A or B) の左端中央
        const targetSlotEl = targetMatchEl.querySelector(`.b-slot[data-slot-key="${slotKey}"]`) || targetMatchEl;
        const dstRect = targetSlotEl.getBoundingClientRect();
        const x2 = Math.round((dstRect.left - gridRect.left) * 10) / 10;
        const y2 = Math.round((dstRect.top + dstRect.height / 2 - gridRect.top) * 10) / 10;

        if (x2 <= x1) return;

        // 直角折れ線（コーナーを少し面取りしたサイバーHUD風オルソゴナルパス）
        const midX = Math.round(((x1 + x2) / 2) * 10) / 10;
        const dy = y2 - y1;
        const absDy = Math.abs(dy);
        const r = Math.min(6, Math.floor((x2 - x1) / 4), Math.floor(absDy / 2));

        let d;
        if (absDy < 1.5 || r <= 1) {
          d = `M ${x1} ${y1} L ${x2} ${y2}`;
        } else {
          const dirY = dy > 0 ? 1 : -1;
          d = [
            `M ${x1} ${y1}`,
            `L ${midX - r} ${y1}`,
            `Q ${midX} ${y1} ${midX} ${y1 + dirY * r}`,
            `L ${midX} ${y2 - dirY * r}`,
            `Q ${midX} ${y2} ${midX + r} ${y2}`,
            `L ${x2} ${y2}`,
          ].join(' ');
        }

        const isInactiveTarget = targetMatch.status === 'inactive';
        basePaths.push(
          `<path class="b-conn-base ${isLosersGrid ? 'is-losers' : ''} ${isInactiveTarget ? 'is-inactive' : ''}" d="${d}" />`
        );

        // ソースの試合が決着しており、チームが次枠へ進出しているか判定
        let advancedTeamIndex = null;
        if (sourceDef.type === 'WINNER_OF' && (srcMatch.status === 'completed' || srcMatch.status === 'bye')) {
          advancedTeamIndex = srcMatch.winnerTeamIndex;
        } else if (sourceDef.type === 'LOSER_OF' && srcMatch.status === 'completed') {
          advancedTeamIndex = srcMatch.loserTeamIndex;
        }

        // Grand Finals Reset (GF-M2) が inactive の場合はアクティブ線を描かない
        if (isInactiveTarget) {
          advancedTeamIndex = null;
        }

        if (advancedTeamIndex !== null && advancedTeamIndex !== undefined) {
          const team = teams[advancedTeamIndex];
          const color = team?.color || (isLosersGrid ? 'var(--amber)' : 'var(--green)');
          const isAutoBye = srcMatch.status === 'bye' && srcMatch.isAutoResolved;

          // 直前のスナップショットと比較して「今まさに勝敗が決まって進出したライン」かどうか判定
          let isJustAdvanced = false;
          if (isSameTournament && prevSnap.matches[srcId]) {
            const prevSrc = prevSnap.matches[srcId];
            if (sourceDef.type === 'WINNER_OF') {
              isJustAdvanced = prevSrc.status !== 'completed' || prevSrc.winnerTeamIndex !== advancedTeamIndex;
            } else if (sourceDef.type === 'LOSER_OF') {
              isJustAdvanced = prevSrc.status !== 'completed' || prevSrc.loserTeamIndex !== advancedTeamIndex;
            }
          }

          const cls = [
            'b-conn-active',
            isAutoBye ? 'is-bye-advance' : '',
            isJustAdvanced ? 'is-just-advanced-line' : '',
          ].filter(Boolean).join(' ');

          // pathLength="100" を指定することで、実ピクセル長に依存せず stroke-dasharray: 100 で0%→100%伸長アニメーションを実現
          activePaths.push(`
            <path class="${cls}" d="${d}" pathLength="100" style="--conn-color:${color}" />
            <circle class="b-conn-dot ${isJustAdvanced ? 'is-just-advanced-dot' : ''}" cx="${x2}" cy="${y2}" r="3.2" style="--conn-color:${color}" />
          `);
        }
      };

      checkAndBuildConnector(targetMatch.sourceA, 'A');
      checkAndBuildConnector(targetMatch.sourceB, 'B');
    }

    svgEl.innerHTML = basePaths.join('') + activePaths.join('');
  });
}
