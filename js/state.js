/**
 * state.js - アプリケーション状態管理 & LocalStorage永続化 & Undoスタック
 */

const STORAGE_KEY = 'smash_3on3_draft_v1';
const STATE_VERSION = '2.0.0';
const CHANNEL_NAME = 'smash_3on3_draft_sync';

/**
 * 初期状態を生成
 */
export function createInitialState() {
  return {
    version: STATE_VERSION,
    players: [],
    teams: [],
    draftOrderMode: 'round', // 'round': A1->B1->... / 'team': A1,2,3->B1,2,3
    draftQueue: [],          // [{ teamIndex, slotIndex, stepIndex }]
    currentStepIndex: 0,
    undrawnPlayerIds: [],
    isSpinning: false,
    history: [],             // Undoスタック
    settings: {
      seEnabled: true,
      showFighter: true,     // 使用ファイター表示のON/OFF
      bgMode: 'dark',        // 'dark' | 'transparent' | 'stage'
      spinDurationSec: 3.5,
      teamCount: 0,          // 0 = 未設定（参加者数÷3を使う）
    }
  };
}

class StateStore {
  constructor() {
    this.state = this.load() || createInitialState();
    this.listeners = new Set();
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;

    // 別タブ / OBS用チームカード画面とのリアルタイム同期
    if (this.channel) {
      this.channel.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'STATE_SYNC' && e.data.state) {
          this.state = e.data.state;
          this.notify();
        }
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY && e.newValue) {
          const loaded = this.load();
          if (loaded) {
            this.state = loaded;
            this.notify();
          }
        }
      });
    }
  }

  /**
   * 現在の状態のディープコピーを取得
   */
  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * 状態を更新してリスナーに通知・自動保存
   */
  setState(updater) {
    if (typeof updater === 'function') {
      const next = updater(this.state);
      if (next) this.state = next;
    } else {
      this.state = { ...this.state, ...updater };
    }
    this.save();
    this.notify();
  }

  /**
   * 変更通知のリスナー登録
   */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Undo用スナップショットをスタックに保存
   */
  pushHistory() {
    const snapshot = {
      currentStepIndex: this.state.currentStepIndex,
      teams: JSON.parse(JSON.stringify(this.state.teams)),
      undrawnPlayerIds: [...this.state.undrawnPlayerIds]
    };
    this.state.history.push(snapshot);
  }

  /**
   * Undoを実行
   */
  popHistory() {
    if (this.state.history.length === 0) return false;
    const prev = this.state.history.pop();
    this.state.currentStepIndex = prev.currentStepIndex;
    this.state.teams = prev.teams;
    this.state.undrawnPlayerIds = prev.undrawnPlayerIds;
    this.save();
    this.notify();
    return true;
  }

  /**
   * LocalStorageに保存
   */
  save() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      if (this.channel) {
        this.channel.postMessage({ type: 'STATE_SYNC', state: this.state });
      }
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
  }

  /**
   * LocalStorageから読み込み
   */
  load() {
    if (typeof localStorage === 'undefined') return null;
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data);
      // 旧バージョンのデータは参加者と設定だけ引き継ぐ（チーム構造が変わったため）
      if (parsed.version !== STATE_VERSION) {
        const migrated = createInitialState();
        migrated.players = (parsed.players || []).map(p => ({ id: p.id, name: p.name, fighter: p.fighter || '' }));
        migrated.settings = { ...migrated.settings, ...(parsed.settings || {}) };
        delete migrated.settings.autoAdvance;
        migrated.draftOrderMode = parsed.draftOrderMode || 'round';
        return migrated;
      }
      // isSpinningなどの一時フラグは解除し、後から追加されたsettings項目の既定値を補完して復元
      parsed.isSpinning = false;
      parsed.settings = { ...createInitialState().settings, ...(parsed.settings || {}) };
      return parsed;
    } catch (e) {
      console.warn('LocalStorage load error:', e);
      return null;
    }
  }

  /**
   * 状態を初期化
   */
  resetAll(keepPlayers = true) {
    const players = keepPlayers ? [...this.state.players] : [];
    const settings = { ...this.state.settings };
    this.state = createInitialState();
    this.state.players = players;
    this.state.settings = settings;
    this.save();
    this.notify();
  }
}

export const store = new StateStore();
