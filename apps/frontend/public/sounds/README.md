# sounds/

ゲームの効果音・BGM の置き場（Vite がそのまま `/sounds/...` で配信する）。
**音源ファイルはリポジトリに含めていない。** 各ディレクトリの README に書かれたファイル名で mp3 を置くと鳴る。
未配置の音源は起動時にコンソールへ 1 回だけ警告が出て無音になる（ゲームは普通に動く）。

- 定義: 共通音は `src/sound/common.ts`、ゲーム固有は `src/games/<type>/sound.ts`
- 再生: `src/sound/SoundDriver.ts`（Web Audio）、配線は `src/sound/useGameSound.ts`
- 音量設定: 画面右上のスピーカーアイコン（`src/store/sound.ts` が localStorage に保存）
