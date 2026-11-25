/**
 * tournament-engine.js - ダブルイリミネーション・トーナメント生成＆進行管理エンジン
 *
 * - 任意のチーム数（2チーム以上）に対応し、2のべき乗（4, 8, 16, 32...）サイズに自動拡張してBYE（不戦勝）を均等配置
 * - ランダムシャッフル配置（Web Crypto API による偏りのない Fisher-Yates シャッフル）
 * - Winners Bracket / Losers Bracket / Grand Finals (+ Reset Match) の完全構築
 * - Losers Bracket の交差シード配置（同じ山から落ちてきたチーム同士の早期再戦を防止）
 * - BYE（不戦勝）の自動消化と、勝敗・スコア更新時の下流マッチへの自動伝播（再計算エンジン）
 */

import { store } from './state.js';

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
 * 配列をランダムシャッフルして新しい配列を返す
 */
export function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * 2のべき乗の標準シード順（1 vs N, ... で BYE が均等に分散する順序）を返す
 * 例: size=8 -> [1, 8, 4, 5, 2, 7, 3, 6]
 */
export function generateSeedOrder(size) {
  let rounds = Math.round(Math.log2(size));
  let seeds = [1, 2];
  for (let r = 1; r < rounds; r++) {
    const next = [];
    const sum = seeds.length * 2 + 1;
    for (const s of seeds) {
      next.push(s, sum - s);
    }
    seeds = next;
  }
  return seeds;
}

/**
 * 次の2のべき乗を返す（最小2）
 */
export function nextPowerOfTwo(n) {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/**
 * Losers Bracket へ落ちてくる Winners 敗者の配置順を決定（早期再戦防止の交差配置）
 */
function buildLoserDropOrder(count, roundIndex) {
  const indices = Array.from({ length: count }, (_, i) => i);
  if (count <= 1) return indices;
  const mode = roundIndex % 3;
  if (mode === 1) {
    // 逆順
    return indices.reverse();
  }
  if (mode === 2 && count >= 4) {
    // 前半と後半を入れ替え
    const half = count / 2;
    return [...indices.slice(half), ...indices.slice(0, half)];
  }
  // ペアごとに反転して逆順
  return indices.reverse();
}

/**
 * チーム一覧からダブルイリミネーション・ブラケット構造を構築する
 * @param {Array} teams - state.teams
 * @param {{ shuffle?: boolean, seedTeamIndices?: Array<number> }} options
 */
export function createDoubleEliminationTournament(teams, { shuffle = true, seedTeamIndices = null } = {}) {
  const count = teams ? teams.length : 0;
  if (count < 2) return null;

  const size = nextPowerOfTwo(count);
  const k = Math.round(Math.log2(size)); // Winners ラウンド数

  // 参加チームの並び順（ランダムまたは指定順）
  let orderedIndices = seedTeamIndices && seedTeamIndices.length === count
    ? [...seedTeamIndices]
    : Array.from({ length: count }, (_, i) => i);
  if (shuffle && !seedTeamIndices) {
    orderedIndices = shuffleArray(orderedIndices);
  }

  // 標準シード枠に配置（seedNum <= count なら実チーム、それ以外は BYE）
  const seedOrder = generateSeedOrder(size);
  const initialSlots = seedOrder.map((seedNum) => {
    if (seedNum <= count) {
      const teamIndex = orderedIndices[seedNum - 1];
      return { type: 'TEAM', teamIndex, seed: seedNum };
    }
    return { type: 'BYE', teamIndex: null, seed: null };
  });

  const matches = {};
  const winnersRounds = [];
  const losersRounds = [];
  let matchNumber = 1;

  // --- 1. Winners Bracket 構築 ---
  for (let r = 1; r <= k; r++) {
    const matchCount = size / Math.pow(2, r);
    const roundMatchIds = [];
    const roundTitle = r === k
      ? 'Winners Final'
      : r === k - 1 && k >= 3
        ? 'Winners Semi-Final'
        : `Winners Round ${r}`;

    for (let m = 0; m < matchCount; m++) {
      const id = `W-R${r}-M${m + 1}`;
      const match = {
        id,
        code: `W${matchNumber}`,
        number: matchNumber++,
        bracket: 'winners',
        round: r,
        roundTitle,
        indexInRound: m,
        sourceA: r === 1
          ? { type: initialSlots[m * 2].type, teamIndex: initialSlots[m * 2].teamIndex, seed: initialSlots[m * 2].seed }
          : { type: 'WINNER_OF', matchId: `W-R${r - 1}-M${m * 2 + 1}` },
        sourceB: r === 1
          ? { type: initialSlots[m * 2 + 1].type, teamIndex: initialSlots[m * 2 + 1].teamIndex, seed: initialSlots[m * 2 + 1].seed }
          : { type: 'WINNER_OF', matchId: `W-R${r - 1}-M${m * 2 + 2}` },
        teamA: null,
        teamB: null,
        scoreA: 0,
        scoreB: 0,
        manualWinnerSlot: null, // 'A' | 'B' | null
        winnerTeamIndex: null,
        loserTeamIndex: null,
        status: 'pending', // 'pending' | 'ready' | 'completed' | 'bye' | 'inactive'
        isAutoResolved: false,
      };
      matches[id] = match;
      roundMatchIds.push(id);
    }
    winnersRounds.push({
      round: r,
      title: roundTitle,
      matchIds: roundMatchIds,
    });
  }

  // --- 2. Losers Bracket 構築 (k >= 2 のとき 2*(k-1) ラウンド) ---
  if (k >= 2) {
    const totalLoserRounds = 2 * (k - 1);
    for (let lr = 1; lr <= totalLoserRounds; lr++) {
      const pairIdx = Math.ceil(lr / 2); // 1 .. k-1
      const matchCount = size / Math.pow(2, pairIdx + 1);
      const isMinor = lr % 2 === 1; // 奇数ラウンド: 同ラウンド内で対決、偶数ラウンド: Winners敗者が合流
      const roundMatchIds = [];

      const roundTitle = lr === totalLoserRounds
        ? 'Losers Final'
        : lr === totalLoserRounds - 1 && totalLoserRounds >= 3
          ? 'Losers Semi-Final'
          : `Losers Round ${lr}`;

      // 偶数ラウンドで落ちてくる Winners Round (pairIdx + 1) の敗者リスト順（交差配置）
      const dropOrder = !isMinor ? buildLoserDropOrder(matchCount, pairIdx) : [];

      for (let m = 0; m < matchCount; m++) {
        const id = `L-R${lr}-M${m + 1}`;
        let sourceA;
        let sourceB;

        if (lr === 1) {
          // Losers Round 1: Winners Round 1 の敗者同士
          sourceA = { type: 'LOSER_OF', matchId: `W-R1-M${m * 2 + 1}` };
          sourceB = { type: 'LOSER_OF', matchId: `W-R1-M${m * 2 + 2}` };
        } else if (!isMinor) {
          // 偶数ラウンド (LR2, LR4...): Winners Round (pairIdx+1) の敗者 vs 直前Losersラウンドの勝者
          const wMatchIdx = dropOrder[m] + 1;
          sourceA = { type: 'LOSER_OF', matchId: `W-R${pairIdx + 1}-M${wMatchIdx}` };
          sourceB = { type: 'WINNER_OF', matchId: `L-R${lr - 1}-M${m + 1}` };
        } else {
          // 奇数ラウンド (LR3, LR5...): 直前Losersラウンドの勝者同士
          sourceA = { type: 'WINNER_OF', matchId: `L-R${lr - 1}-M${m * 2 + 1}` };
          sourceB = { type: 'WINNER_OF', matchId: `L-R${lr - 1}-M${m * 2 + 2}` };
        }

        const match = {
          id,
          code: `L${lr}-${m + 1}`,
          number: matchNumber++,
          bracket: 'losers',
          round: lr,
          roundTitle,
          indexInRound: m,
          sourceA,
          sourceB,
          teamA: null,
          teamB: null,
          scoreA: 0,
          scoreB: 0,
          manualWinnerSlot: null,
          winnerTeamIndex: null,
          loserTeamIndex: null,
          status: 'pending',
          isAutoResolved: false,
        };
        matches[id] = match;
        roundMatchIds.push(id);
      }

      losersRounds.push({
        round: lr,
        title: roundTitle,
        matchIds: roundMatchIds,
      });
    }
  }

  // --- 3. Grand Finals & Reset Match ---
  const wfMatchId = `W-R${k}-M1`;
  const lfMatchId = k >= 2 ? `L-R${2 * (k - 1)}-M1` : `W-R1-M1`;

  const gfMatch = {
    id: 'GF-M1',
    code: 'GF',
    number: matchNumber++,
    bracket: 'finals',
    round: 1,
    roundTitle: 'Grand Finals',
    indexInRound: 0,
    sourceA: { type: 'WINNER_OF', matchId: wfMatchId },
    sourceB: k >= 2
      ? { type: 'WINNER_OF', matchId: lfMatchId }
      : { type: 'LOSER_OF', matchId: wfMatchId },
    teamA: null,
    teamB: null,
    scoreA: 0,
    scoreB: 0,
    manualWinnerSlot: null,
    winnerTeamIndex: null,
    loserTeamIndex: null,
    status: 'pending',
    isAutoResolved: false,
  };
  matches[gfMatch.id] = gfMatch;

  const gfResetMatch = {
    id: 'GF-M2',
    code: 'GF2',
    number: matchNumber++,
    bracket: 'finals',
    round: 2,
    roundTitle: 'Grand Finals Reset',
    indexInRound: 0,
    sourceA: { type: 'WINNER_OF', matchId: 'GF-M1' },
    sourceB: { type: 'LOSER_OF', matchId: 'GF-M1' },
    teamA: null,
    teamB: null,
    scoreA: 0,
    scoreB: 0,
    manualWinnerSlot: null,
    winnerTeamIndex: null,
    loserTeamIndex: null,
    status: 'inactive',
    isAutoResolved: false,
  };
  matches[gfResetMatch.id] = gfResetMatch;

  const finalsRounds = [
    { round: 1, title: 'Grand Finals', matchIds: ['GF-M1'] },
    { round: 2, title: 'Grand Finals Reset', matchIds: ['GF-M2'] },
  ];

  const tournament = {
    createdAt: Date.now(),
    teamCount: count,
    bracketSize: size,
    seedTeamIndices: orderedIndices,
    winnersRounds,
    losersRounds,
    finalsRounds,
    matches,
    championTeamIndex: null,
    needsReset: false,
  };

  recalculateTournament(tournament);
  return tournament;
}

/**
 * ソース定義（TEAM / BYE / WINNER_OF / LOSER_OF）からスロットの状態を解決する
 * @returns {{ state: 'TEAM'|'BYE'|'TBD', teamIndex: number|null, label: string }}
 */
function resolveSlotSource(source, matches) {
  if (!source) return { state: 'TBD', teamIndex: null, label: 'TBD' };

  if (source.type === 'TEAM') {
    return { state: 'TEAM', teamIndex: source.teamIndex, seed: source.seed || null, label: '' };
  }
  if (source.type === 'BYE') {
    return { state: 'BYE', teamIndex: null, seed: null, label: 'BYE' };
  }

  const refMatch = matches[source.matchId];
  if (!refMatch) return { state: 'TBD', teamIndex: null, label: 'TBD' };

  if (source.type === 'WINNER_OF') {
    if (refMatch.status === 'completed' || refMatch.status === 'bye') {
      if (refMatch.winnerTeamIndex !== null && refMatch.winnerTeamIndex !== undefined) {
        return { state: 'TEAM', teamIndex: refMatch.winnerTeamIndex, label: '' };
      }
      return { state: 'BYE', teamIndex: null, label: 'BYE' };
    }
    return { state: 'TBD', teamIndex: null, label: `${refMatch.code} 勝者` };
  }

  if (source.type === 'LOSER_OF') {
    if (refMatch.status === 'completed' || refMatch.status === 'bye') {
      if (refMatch.loserTeamIndex !== null && refMatch.loserTeamIndex !== undefined) {
        return { state: 'TEAM', teamIndex: refMatch.loserTeamIndex, label: '' };
      }
      // 親マッチが BYE（不戦勝）または片方不在だった場合、敗者枠も BYE となる
      return { state: 'BYE', teamIndex: null, label: 'BYE' };
    }
    return { state: 'TBD', teamIndex: null, label: `${refMatch.code} 敗者` };
  }

  return { state: 'TBD', teamIndex: null, label: 'TBD' };
}

/**
 * トーナメント全体の進行状態・BYE自動進出・勝敗伝播を再計算する
 */
export function recalculateTournament(tournament) {
  if (!tournament || !tournament.matches) return tournament;

  const { matches, winnersRounds, losersRounds } = tournament;

  // トポロジカル順序（Winners 全ラウンド → Losers 全ラウンド → Grand Finals）
  const orderedIds = [];
  for (const r of winnersRounds) orderedIds.push(...r.matchIds);
  for (const r of losersRounds) orderedIds.push(...r.matchIds);
  orderedIds.push('GF-M1');

  for (const id of orderedIds) {
    const m = matches[id];
    if (!m) continue;

    const prevTeamA = m.teamA?.teamIndex ?? null;
    const prevTeamB = m.teamB?.teamIndex ?? null;

    const slotA = resolveSlotSource(m.sourceA, matches);
    const slotB = resolveSlotSource(m.sourceB, matches);

    m.teamA = slotA;
    m.teamB = slotB;

    // 対戦カードが変わった場合は手動勝敗とスコアをリセット
    if (prevTeamA !== slotA.teamIndex || prevTeamB !== slotB.teamIndex) {
      if (prevTeamA !== null || prevTeamB !== null) {
        m.manualWinnerSlot = null;
        m.scoreA = 0;
        m.scoreB = 0;
      }
    }

    // 1. 両方 BYE の場合
    if (slotA.state === 'BYE' && slotB.state === 'BYE') {
      m.status = 'bye';
      m.isAutoResolved = true;
      m.winnerTeamIndex = null;
      m.loserTeamIndex = null;
      m.manualWinnerSlot = null;
      continue;
    }

    // 2. 片方が TEAM で、もう片方が BYE の場合 → 即座に不戦勝確定
    if (slotA.state === 'TEAM' && slotB.state === 'BYE') {
      m.status = 'bye';
      m.isAutoResolved = true;
      m.winnerTeamIndex = slotA.teamIndex;
      m.loserTeamIndex = null;
      m.manualWinnerSlot = 'A';
      continue;
    }
    if (slotB.state === 'TEAM' && slotA.state === 'BYE') {
      m.status = 'bye';
      m.isAutoResolved = true;
      m.winnerTeamIndex = slotB.teamIndex;
      m.loserTeamIndex = null;
      m.manualWinnerSlot = 'B';
      continue;
    }

    // 3. 両方 TEAM が揃っている場合
    if (slotA.state === 'TEAM' && slotB.state === 'TEAM') {
      m.isAutoResolved = false;
      if (m.manualWinnerSlot === 'A') {
        m.status = 'completed';
        m.winnerTeamIndex = slotA.teamIndex;
        m.loserTeamIndex = slotB.teamIndex;
      } else if (m.manualWinnerSlot === 'B') {
        m.status = 'completed';
        m.winnerTeamIndex = slotB.teamIndex;
        m.loserTeamIndex = slotA.teamIndex;
      } else {
        m.status = 'ready';
        m.winnerTeamIndex = null;
        m.loserTeamIndex = null;
      }
      continue;
    }

    // 4. まだ TBD が残っている場合
    m.isAutoResolved = false;
    m.status = 'pending';
    m.winnerTeamIndex = null;
    m.loserTeamIndex = null;
    m.manualWinnerSlot = null;
  }

  // --- Grand Finals Reset (GF-M2) の特別処理 ---
  const gf1 = matches['GF-M1'];
  const gf2 = matches['GF-M2'];
  tournament.championTeamIndex = null;
  tournament.needsReset = false;

  if (gf1 && gf2) {
    if (gf1.status === 'completed') {
      if (gf1.manualWinnerSlot === 'A') {
        // Winners側 (slot A) が勝利 → リセットなしで優勝決定
        tournament.championTeamIndex = gf1.winnerTeamIndex;
        tournament.needsReset = false;
        gf2.status = 'inactive';
        gf2.teamA = { state: 'TBD', teamIndex: null, label: 'リセット不要' };
        gf2.teamB = { state: 'TBD', teamIndex: null, label: 'リセット不要' };
        gf2.manualWinnerSlot = null;
        gf2.winnerTeamIndex = null;
        gf2.loserTeamIndex = null;
        gf2.scoreA = 0;
        gf2.scoreB = 0;
      } else if (gf1.manualWinnerSlot === 'B') {
        // Losers側 (slot B) が勝利 → ブラケットリセット発動 (GF-M2 へ)
        tournament.needsReset = true;
        const prevA = gf2.teamA?.teamIndex ?? null;
        const prevB = gf2.teamB?.teamIndex ?? null;
        gf2.teamA = { state: 'TEAM', teamIndex: gf1.teamA.teamIndex, label: 'W側代表' };
        gf2.teamB = { state: 'TEAM', teamIndex: gf1.teamB.teamIndex, label: 'L側代表' };
        if (prevA !== gf2.teamA.teamIndex || prevB !== gf2.teamB.teamIndex) {
          gf2.manualWinnerSlot = null;
          gf2.scoreA = 0;
          gf2.scoreB = 0;
        }
        if (gf2.manualWinnerSlot === 'A') {
          gf2.status = 'completed';
          gf2.winnerTeamIndex = gf2.teamA.teamIndex;
          gf2.loserTeamIndex = gf2.teamB.teamIndex;
          tournament.championTeamIndex = gf2.winnerTeamIndex;
        } else if (gf2.manualWinnerSlot === 'B') {
          gf2.status = 'completed';
          gf2.winnerTeamIndex = gf2.teamB.teamIndex;
          gf2.loserTeamIndex = gf2.teamA.teamIndex;
          tournament.championTeamIndex = gf2.winnerTeamIndex;
        } else {
          gf2.status = 'ready';
          gf2.winnerTeamIndex = null;
          gf2.loserTeamIndex = null;
        }
      }
    } else {
      gf2.status = 'inactive';
      gf2.teamA = { state: 'TBD', teamIndex: null, label: 'GF1でL側勝利時のみ' };
      gf2.teamB = { state: 'TBD', teamIndex: null, label: 'GF1でL側勝利時のみ' };
      gf2.manualWinnerSlot = null;
      gf2.winnerTeamIndex = null;
      gf2.loserTeamIndex = null;
      gf2.scoreA = 0;
      gf2.scoreB = 0;
    }
  }

  return tournament;
}

/**
 * ストアに新しいダブルイリミネーション・トーナメントを生成・保存する
 */
export function generateAndSaveTournament({ shuffle = true } = {}) {
  const state = store.getState();
  if (!state.teams || state.teams.length < 2) return null;
  const tournament = createDoubleEliminationTournament(state.teams, { shuffle });
  store.setState({ tournament });
  return tournament;
}

/**
 * 試合結果を記録または更新する
 * @param {string} matchId
 * @param {{ winnerSlot?: 'A'|'B'|null, scoreA?: number, scoreB?: number }} payload
 */
export function updateMatchResult(matchId, { winnerSlot, scoreA, scoreB }) {
  const state = store.getState();
  const tournament = state.tournament;
  if (!tournament || !tournament.matches || !tournament.matches[matchId]) return null;

  const match = tournament.matches[matchId];
  if (match.isAutoResolved || match.status === 'inactive') return null;
  if (match.teamA?.state !== 'TEAM' || match.teamB?.state !== 'TEAM') return null;

  if (typeof scoreA === 'number' && !Number.isNaN(scoreA)) {
    match.scoreA = Math.max(0, Math.min(99, Math.floor(scoreA)));
  }
  if (typeof scoreB === 'number' && !Number.isNaN(scoreB)) {
    match.scoreB = Math.max(0, Math.min(99, Math.floor(scoreB)));
  }
  if (winnerSlot !== undefined) {
    match.manualWinnerSlot = winnerSlot;
  }

  recalculateTournament(tournament);
  store.setState({ tournament });
  return tournament;
}

/**
 * 進行中の試合結果をすべてクリアし、現在の配置のまま初期状態に戻す
 */
export function resetTournamentResults() {
  const state = store.getState();
  const t = state.tournament;
  if (!t || !state.teams || state.teams.length < 2) return null;
  const fresh = createDoubleEliminationTournament(state.teams, {
    shuffle: false,
    seedTeamIndices: t.seedTeamIndices,
  });
  store.setState({ tournament: fresh });
  return fresh;
}

/**
 * トーナメント表の2つのスロット間でチームの初期シード配置を入れ替える
 * - Winners Round 1 の直接スロット（TEAM または BYE）はもちろん、
 *   Winners Round 2 で不戦勝自動進出したチーム枠からのドラッグにも対応（元の W-R1 枠を自動特定してスワップ）
 * @param {{ matchId: string, slot: 'A'|'B' }} from
 * @param {{ matchId: string, slot: 'A'|'B' }} to
 * @returns {Object|null} 更新後の tournament
 */
export function swapTournamentSlots(from, to) {
  const state = store.getState();
  const tournament = state.tournament;
  if (!tournament || !tournament.matches) return null;
  if (!from || !to) return null;
  if (from.matchId === to.matchId && from.slot === to.slot) return null;

  // スロットから Winners Round 1 のシードソース参照 (match.sourceA または match.sourceB) を解決する
  const resolveRootSourceRef = ({ matchId, slot }) => {
    const m = tournament.matches[matchId];
    if (!m) return null;
    if (m.bracket === 'winners' && m.round === 1) {
      return { match: m, key: slot === 'A' ? 'sourceA' : 'sourceB' };
    }
    // W-R2 で、親の W-R1 が BYE 自動決着だった場合、その親の TEAM 側ソースを辿れるようにする
    const src = slot === 'A' ? m.sourceA : m.sourceB;
    if (src && src.type === 'WINNER_OF') {
      const parent = tournament.matches[src.matchId];
      if (parent && parent.bracket === 'winners' && parent.round === 1 && parent.status === 'bye') {
        if (parent.sourceA?.type === 'TEAM') return { match: parent, key: 'sourceA' };
        if (parent.sourceB?.type === 'TEAM') return { match: parent, key: 'sourceB' };
      }
    }
    return null;
  };

  const refA = resolveRootSourceRef(from);
  const refB = resolveRootSourceRef(to);
  if (!refA || !refB) return null;
  if (refA.match.id === refB.match.id && refA.key === refB.key) return null;

  const srcA = { ...refA.match[refA.key] };
  const srcB = { ...refB.match[refB.key] };

  // 両方 BYE の入れ替えは無意味なのでスキップ
  if (srcA.type === 'BYE' && srcB.type === 'BYE') return null;

  refA.match[refA.key] = srcB;
  refB.match[refB.key] = srcA;

  // seedTeamIndices も現在の W-R1 配置に合わせて同期更新
  const nextSeeds = [];
  for (const r1Id of (tournament.winnersRounds[0]?.matchIds || [])) {
    const m = tournament.matches[r1Id];
    if (m?.sourceA?.type === 'TEAM') nextSeeds.push(m.sourceA.teamIndex);
    if (m?.sourceB?.type === 'TEAM') nextSeeds.push(m.sourceB.teamIndex);
  }
  if (nextSeeds.length === tournament.teamCount) {
    tournament.seedTeamIndices = nextSeeds;
  }

  recalculateTournament(tournament);
  store.setState({ tournament });
  return tournament;
}

