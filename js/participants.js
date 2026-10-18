/**
 * participants.js - 参加者管理・CSV読み込み・チーム編成バリデーション
 */

let idCounter = 0;

/**
 * プレイヤーオブジェクトを生成
 */
export function createPlayer(name, fighter = '') {
  idCounter++;
  return {
    id: `p_${Date.now().toString(36)}_${idCounter}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(name).trim(),
    fighter: String(fighter || '').trim(),
  };
}

/**
 * CSVの1行を「名前,キャラ」に分解（ダブルクォート囲みにも対応）
 */
function splitCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

const HEADER_NAMES = ['名前', 'name', 'プレイヤー名', 'プレイヤー', 'player'];

/**
 * CSVテキスト（名前,キャラ）を解析
 * @returns {{ players: Array<{name:string, fighter:string}>, skipped: number }}
 */
export function parseCsvText(text) {
  if (!text) return { players: [], skipped: 0 };
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/);
  const players = [];
  let skipped = 0;

  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    const [name = '', fighter = ''] = splitCsvLine(line);
    // 1行目がヘッダーならスキップ
    if (idx === 0 && HEADER_NAMES.includes(name.toLowerCase())) return;
    if (!name) { skipped++; return; }
    players.push({ name, fighter });
  });

  return { players, skipped };
}

/**
 * CSVファイルを読み込む（UTF-8 → Shift_JIS の順に判定）
 */
export async function readCsvFile(file) {
  const buffer = await file.arrayBuffer();
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Excelで保存したCSVはShift_JISのことが多い
    text = new TextDecoder('shift_jis').decode(buffer);
  }
  return parseCsvText(text);
}

/**
 * 参加者数とチーム数から各チームの人数を算出（均等割り）
 * 例: 20人・6チーム → [4,4,3,3,3,3]
 */
export function computeTeamSizes(playerCount, teamCount) {
  if (teamCount < 1 || playerCount < teamCount) return [];
  const base = Math.floor(playerCount / teamCount);
  const extra = playerCount % teamCount;
  return Array.from({ length: teamCount }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * 3人編成を基準にしたおすすめチーム数
 */
export function recommendedTeamCount(playerCount) {
  return Math.max(1, Math.floor(playerCount / 3));
}

/**
 * チーム編成のバリデーション
 */
export function validateTeamConfig(playerCount, teamCount) {
  if (playerCount === 0) {
    return { isValid: false, sizes: [], message: '参加者が登録されていません。' };
  }
  if (teamCount < 1) {
    return { isValid: false, sizes: [], message: 'チーム数は1以上にしてください。' };
  }
  if (playerCount < teamCount) {
    return { isValid: false, sizes: [], message: `参加者 ${playerCount} 名ではチーム数 ${teamCount} を埋められません（各チーム最低1名）。` };
  }
  const sizes = computeTeamSizes(playerCount, teamCount);
  const max = Math.max(...sizes);
  const min = Math.min(...sizes);
  let breakdown;
  if (max === min) {
    breakdown = `${max}人 × ${teamCount}チーム`;
  } else {
    const maxCount = sizes.filter(s => s === max).length;
    breakdown = `${max}人 × ${maxCount}チーム / ${min}人 × ${teamCount - maxCount}チーム`;
  }
  return {
    isValid: true,
    sizes,
    message: `${playerCount} 名 → ${breakdown}`,
  };
}

/**
 * 動作確認用サンプル（24名）
 */
export const SAMPLE_PLAYERS = [
  ['あcola', 'スティーブ'], ['ミーヤー', 'Mr.ゲーム&ウォッチ'], ['ザクレイ', 'ピット'],
  ['Shuton', 'ピクミン&オリマー'], ['Tea', 'パックマン'], ['Asimo', 'リュウ'],
  ['KEN', 'ソニック'], ['Kameme', 'ソラ'], ['Gackt', 'ネス'],
  ['Yoshidora', 'ヨッシー'], ['Tarik', 'ゲッコウガ'], ['Rizeasu', 'マルス'],
  ['Hero', 'バンジョー&カズーイ'], ['Jagaimo', 'パルテナ'], ['Neo', 'コリン'],
  ['Hurt', 'スネーク'], ['DIO', 'スネーク'], ['Senra', 'プリン'],
  ['Yamanaction', 'ルイージ'], ['Kome', 'シュルク'], ['Etsuji', 'ディディーコング'],
  ['Taikei', 'ソニック'], ['Nao', 'マリオ'], ['Munekin', 'リュカ'],
];
