#!/usr/bin/env node
/**
 * ElevenLabs Sound Effects API を使って効果音 (MP3) を生成するスクリプト
 *
 * 使い方:
 *   node scripts/generate-sfx.mjs              # 未生成の効果音をすべて生成
 *   node scripts/generate-sfx.mjs fanfare      # 指定した効果音のみ生成
 *   node scripts/generate-sfx.mjs --force      # 既存ファイルも上書き生成
 *   node scripts/generate-sfx.mjs --list       # 定義されている効果音一覧を表示
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const AUDIO_DIR = path.join(ROOT_DIR, 'audio');
const ENV_PATH = path.join(ROOT_DIR, '.env');

const API_URL = 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128';

/**
 * js/audio.js の各バッファに対応する効果音定義
 */
const SFX_DEFINITIONS = [
  {
    key: 'tickFast',
    filename: 'tickFast.mp3',
    duration_seconds: 0.5,
    prompt_influence: 0.45,
    description: '高速ルーレット音（キレのあるネオンUIクリック）',
    text: 'Crisp bright neon cyberpunk UI click, sleek high-tech digital roulette tick, clean snappy transient, dry no reverb',
  },
  {
    key: 'tickHeavy',
    filename: 'tickHeavy.mp3',
    duration_seconds: 0.5,
    prompt_influence: 0.45,
    description: '減速時スキャン音（タイトでクールなサイバーパルス）',
    text: 'Punchy neon esports HUD pulse tick, tight electronic bass tap with bright metallic click, stylish futuristic UI',
  },
  {
    key: 'decodeBlip',
    filename: 'decodeBlip.mp3',
    duration_seconds: 0.5,
    prompt_influence: 0.45,
    description: 'デコード音（クリアなホログラム・データパルス）',
    text: 'Clean bright holographic data blip, sleek cybernetic terminal chirp, crisp futuristic UI notification',
  },
  {
    key: 'lockOn',
    filename: 'lockOn.mp3',
    duration_seconds: 0.6,
    prompt_influence: 0.45,
    description: 'ロックオン音（瞬発力のあるサイバーHUD照準音）',
    text: 'Fast sharp cyberpunk HUD target lock-on beep, crisp bright neon synth confirmation chirp, instant attack',
  },
  {
    key: 'impact',
    filename: 'impact.mp3',
    duration_seconds: 1.8,
    prompt_influence: 0.45,
    description: '決定インパクト音（即着弾するネオン・エナジー衝撃波）',
    text: 'Instant punchy cyberpunk energy impact hit, tight sub-bass drop with bright neon synth burst and shimmering metallic tail',
  },
  {
    key: 'formation',
    filename: 'formation.mp3',
    duration_seconds: 1.5,
    prompt_influence: 0.45,
    description: '部隊結成音（スタイリッシュなチーム確定システム音）',
    text: 'Stylish futuristic esports team lock-in sound, crisp cybernetic latch with uplifting neon synth chord and tight bass punch',
  },
  {
    key: 'fanfare',
    filename: 'fanfare.mp3',
    duration_seconds: 1.5,
    prompt_influence: 0.6,
    description: 'READY to FIGHT 効果音（ファンファーレなし・チャキーンと響く金属スラッシュ音）',
    text: 'Sharp anime katana unsheathe shing, crisp bright metallic blade clash and high-speed slash whoosh with clean ringing steel resonance, punchy fighting game title screen impact, no music',
  },
];

/**
 * .env ファイルから環境変数を読み込む（既存の環境変数は上書きしない）
 */
function loadDotEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let val = line.slice(eqIndex + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function generateOne(def, apiKey) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: def.text,
      duration_seconds: def.duration_seconds,
      prompt_influence: def.prompt_influence,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const outPath = path.join(AUDIO_DIR, def.filename);
  fs.writeFileSync(outPath, Buffer.from(arrayBuf));
  return outPath;
}

async function main() {
  loadDotEnv();

  const args = process.argv.slice(2);
  const showList = args.includes('--list');
  const force = args.includes('--force');
  const targets = args.filter((a) => !a.startsWith('--'));

  if (showList) {
    console.log('定義済みの効果音一覧:');
    for (const def of SFX_DEFINITIONS) {
      const exists = fs.existsSync(path.join(AUDIO_DIR, def.filename));
      const status = exists ? '[生成済み]' : '[未生成]  ';
      console.log(`  ${status} ${def.key.padEnd(12)} -> audio/${def.filename} (${def.duration_seconds}s) : ${def.description}`);
    }
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    console.error('エラー: ELEVENLABS_API_KEY が設定されていません。');
    console.error('手順:');
    console.error('  1. .env.example をコピーして .env を作成する');
    console.error('  2. .env 内の ELEVENLABS_API_KEY= に取得したAPIキーを設定する');
    console.error('  3. 再度このコマンドを実行する');
    process.exit(1);
  }

  const selected = targets.length > 0
    ? SFX_DEFINITIONS.filter((d) => targets.includes(d.key))
    : SFX_DEFINITIONS;

  if (selected.length === 0) {
    console.error(`エラー: 指定されたキーが見つかりません: ${targets.join(', ')}`);
    console.error(`有効なキー: ${SFX_DEFINITIONS.map((d) => d.key).join(', ')}`);
    process.exit(1);
  }

  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  for (const def of selected) {
    const outPath = path.join(AUDIO_DIR, def.filename);
    if (fs.existsSync(outPath) && !force) {
      console.log(`[スキップ] audio/${def.filename} は既に存在します（上書きする場合は --force を指定）`);
      continue;
    }

    process.stdout.write(`[生成中] ${def.key} (${def.duration_seconds}s)... `);
    try {
      await generateOne(def, apiKey);
      console.log(`完了 -> audio/${def.filename}`);
    } catch (err) {
      console.log('失敗');
      console.error(`  ${err.message}`);
      process.exitCode = 1;
    }
  }
}

main();

