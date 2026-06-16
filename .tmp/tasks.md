# dennoh タスク (Stage 3: Tasks) — v0.1

> **対象**: v0.1（MVP）
> **作成日**: 2026-06-12
> **依存**: `.tmp/requirements.md`
> **形式**: 機能単位のチェックボックス。各タスクに「検証方法」を併記。

凡例:
- [ ] = 未着手
- 検証: そのタスクが完了したと判断するための具体的な確認手段（テスト or 動作確認）

---

## T0. プロジェクト基盤

- [x] T0.1 Bun プロジェクト初期化（`bun init`、`package.json` 整備、`bin: dennoh` 宣言）
  - 検証: `bun --version` で対応版確認、`bun run` でエントリ起動できる
- [x] T0.2 TypeScript 設定（`tsconfig.json`、strict、`any`/`unknown` 禁止に合うルール）
  - 検証: `tsc --noEmit` がエラーなしで通る
- [x] T0.3 ディレクトリ構成確定（`src/core`, `src/cli`, `src/mcp`, `src/db`, `src/git`, `src/i18n`, `src/watch`, `tests/`）
  - 検証: 空モジュールが import 可能
- [x] T0.4 Lint/Format（Biome 採用）
  - 検証: `bun run lint` / `bun run format` がエラーなしで通る
- [x] T0.5 テストランナー設定（`bun test`）
  - 検証: ダミー 1 ケースが green
- [x] T0.6 ロガー（stdout を MCP 専用、ログは stderr に固定する薄いラッパ）
  - 検証: ユニットテストで stdout/stderr 出力先を確認

---

## T1. 設定 / 初期化 (F-5)

- [x] T1.1 グローバル設定ファイル読み書き（`~/Library/Application Support/dennoh/config.json`）
  - 検証: 書き込み→再起動で読み戻し、`vaultPath`/`lang` が一致
- [x] T1.2 設定スキーマ（`vaultPath: string`, `lang: 'ja' | 'en'`）と型定義
  - 検証: 不正値読み込みで型エラー or 既定値フォールバック（後者は要件範囲外なら例外）
- [x] T1.3 `dennoh config get/set/list` 実装
  - 検証: `dennoh config set lang en && dennoh config get lang` が `en` を返す
- [x] T1.4 `dennoh init` 実装（保存フォルダ選択、`.dennoh/` 作成、`git init`、初期 config 書き込み）
  - 検証: クリーン環境で `dennoh init` 実行後、保存フォルダ・`.dennoh/`・`.git/`・`config.json` が揃う
- [x] T1.5 `DENNOH_LANG` 環境変数による上書き
  - 検証: `DENNOH_LANG=en dennoh config get lang` で `en` が返る（設定ファイル値より優先）

---

## T2. データモデル / Markdown 永続化 (F-1.4, F-1.5, F-3, 5.2, 5.3)

- [x] T2.1 UUID v7 生成ユーティリティ
  - 検証: 連続生成した UUID が時間ソート可能（昇順）
- [x] T2.2 ファイルパス解決（`<vault>/<YYYY>/<MM>/<DD>/<UUID>.md`）
  - 検証: 日付境界でディレクトリが正しく分かれる単体テスト
- [x] T2.3 frontmatter シリアライザ（`createdAt`, `updatedAt`, `source`, `title`, `projects`, `tags`、`id` は含めない）
  - 検証: シリアライズ→パースで構造が一致するラウンドトリップテスト
- [x] T2.4 frontmatter パーサ（既存 Markdown の YAML 読み込み）
  - 検証: 不正 YAML で例外、欠損フィールドは既定値
- [x] T2.5 アトミック書き込み（temp ファイル → rename）
  - 検証: 書き込み中プロセス kill で元ファイルが破壊されないユニットテスト
- [x] T2.6 ファイル名 UUID とパスから ID を取得するロジック
  - 検証: `id = parseIdFromPath(path)` が UUID を返す
- [x] T2.7 `<vault>/.dennoh/` 作成と `.gitignore` 自動追加（`.dennoh/` を Git 管理対象から除外）
  - 検証: `dennoh init` 後、`.gitignore` に `.dennoh/` が含まれる

---

## T3. `#` / `@` 抽出 (F-1.6)

- [x] T3.1 正規表現実装（`#([\p{L}\p{N}_-]+)` / `@([\p{L}\p{N}_-]+)`、Unicode フラグ）
  - 検証: 日本語タグ `#日記` `@仕事` を抽出できるテスト
- [x] T3.2 誤抽出回避: URL 内 `#fragment` を除外
  - 検証: `https://example.com#foo` から `#foo` を抽出しないテスト
- [x] T3.3 誤抽出回避: Markdown 見出し `# H1` を除外（行頭 `#` + スペース）
  - 検証: `# 見出し` から `#見出し` を抽出しないテスト
- [x] T3.4 誤抽出回避: メールアドレス `user@example.com` の `@example` を除外
  - 検証: 該当テスト
- [x] T3.5 抽出結果を frontmatter `projects` / `tags` に反映（重複除去・順序保持）
  - 検証: 本文に `#a #b #a` で `projects: [a, b]`

---

## T4. SQLite / FTS インデックス (F-6)

- [x] T4.1 SQLite 接続層（`<vault>/.dennoh/index.db`、Bun の `bun:sqlite` 利用）
  - 検証: 接続→クエリ→クローズの単体テスト
- [x] T4.2 スキーマ（`notes(id PK, path, created_at, updated_at, source, title, projects_json, tags_json)`、`notes_fts` FTS5 仮想テーブル）
  - 検証: マイグレーション後にテーブル/仮想テーブルが存在
- [x] T4.3 スキーマバージョン管理（`schema_version` テーブル + マイグレーション）
  - 検証: 初回起動でバージョン記録、二度目はスキップ
- [x] T4.4 ノート insert / update / delete を反映する書き込み層
  - 検証: 3操作後に `notes` と `notes_fts` が同期している
- [x] T4.5 全件再インデックス（`dennoh reindex` の中核ロジック）
  - 検証: DB を消した後 reindex で行数が一致
- [x] T4.6 起動時の差分スキャン（ファイル mtime と DB updated_at の比較）
  - 検証: 1ファイルを外部で書き換え→起動→DB の更新時刻が反映

---

## T5. メモ CRUD コア (F-1.1〜F-1.3, F-1.7, F-1.8)

- [x] T5.1 `saveMemory(content, source?)` 実装（UUID 生成→frontmatter 付与→書き込み→DB 反映→Git commit）
  - 検証: 呼び出し後、ファイル・DB 行・Git コミットの3点が揃う統合テスト
- [x] T5.2 `updateMemory(id, content)` 実装（既存 frontmatter 維持、`updatedAt` 更新、再抽出、再インデックス、再 commit）
  - 検証: 更新前後で `createdAt` 不変、`updatedAt` 更新、`projects`/`tags` 再抽出
- [x] T5.3 `deleteMemory(id)` 実装（ファイル削除、DB 行削除、Git commit）
  - 検証: 削除後 `getNote(id)` が null、DB に行なし、ログに commit
- [x] T5.4 `getNote(id)` 実装（ID から path を逆引き→読み込み）
  - 検証: 保存→取得で content が一致
- [x] T5.5 `listRecent(limit?)` 実装（`updated_at DESC` で取得）
  - 検証: 連続保存後 limit=3 で最新3件が返る

---

## T6. 検索 (F-2)

- [x] T6.1 `searchMemory(query, filters?, limit?)` 実装（FTS MATCH ベース）
  - 検証: 「FTS テスト」を本文に含むノートを `query: "FTS"` で取得
- [x] T6.2 フィルタ `project` 対応（`projects_json` に該当値が含まれるノートに絞る）
  - 検証: `#denno` のメモのみ返す統合テスト
- [x] T6.3 フィルタ `tag` 対応
  - 検証: `@mcp` のメモのみ返す
- [x] T6.4 フィルタ `date range`（`updated_at` 範囲）
  - 検証: 日付外のノートが返らない
- [x] T6.5 フィルタ `source` 対応
  - 検証: `source: 'note'` で絞れる（v0.1 は note のみだが将来拡張点として実装）
- [x] T6.6 スニペット生成（FTS の `snippet()` 関数活用、前後 N 文字）
  - 検証: ヒット箇所がスニペットに含まれる
- [x] T6.7 検索結果に必要フィールド（id, path, title, snippet, createdAt, updatedAt, source, projects, tags）を含める
  - 検証: 戻り値スキーマのテスト

---

## T7. ファイル監視 / 外部編集反映 (F-3.5, F-4.2)

- [x] T7.1 ファイル監視機構（Bun の `fs.watch` または chokidar 相当を採用、保存フォルダを再帰監視）
  - 検証: 外部からファイル追加→イベント受信
- [x] T7.2 自分自身の書き込みを無視するロジック（書き込み直後の通知をスキップ）
  - 検証: 内部 save 後に二重インデックスが起きないテスト
- [x] T7.3 変更検知 → 差分インデックス更新
  - 検証: 外部編集後、検索結果に新内容が反映される
- [x] T7.4 削除検知 → DB から削除
  - 検証: 外部から `rm` 後、`searchMemory` でヒットしない
- [x] T7.5 隠しファイル除外（`.DS_Store`、`.git`、`.obsidian`、`.dennoh` 等）
  - 検証: これらのパスがインデックスに入らない

---

## T8. Git 自動管理 (F-4.5)

- [x] T8.1 Git ラッパ（外部 `git` コマンドまたは `isomorphic-git`、Stage 2 で決まらない場合は外部 `git` で実装）
  - 検証: 単体テストで init / add / commit / log の動作確認
- [x] T8.2 既存 Git リポジトリ判定（`.git` の有無）と `dennoh init` 内での `git init` 分岐
  - 検証: 既存リポでは init せず利用、新規ではディレクトリ作成
- [x] T8.3 保存ごとの自動 commit（メッセージ: `add <id>` / `update <id>` / `delete <id>`）
  - 検証: 3操作後の git log にそれぞれのコミットが並ぶ
- [x] T8.4 `dennoh history <id>` 実装（該当ファイルの git log を整形表示）
  - 検証: 更新3回後に `history` で3件返る
- [x] T8.5 `dennoh restore <id> <commit>` 実装（指定 commit のファイル内容を書き戻し）
  - 検証: 過去 commit に restore 後、現在のファイル内容が一致

---

## T9. 同期共存 (F-4.1, F-4.3, F-4.4, F-4.6)

- [ ] T9.1 競合ファイル名パターン検知（`*.conflict.md`, `* (.* conflicted copy).md` 等）
  - 検証: ダミー競合ファイルを置いて `dennoh status` がそれを報告
- [ ] T9.2 競合ファイルはインデックス対象外
  - 検証: 競合ファイルは `searchMemory` でヒットしない
- [ ] T9.3 `dennoh init` 時、保存フォルダが iCloud Drive / Dropbox / OneDrive 配下である場合に `.git` 同期除外の案内メッセージを表示
  - 検証: `~/Library/Mobile Documents` 配下を渡したテストで案内メッセージが出る
- [ ] T9.4 iCloud Drive 配下に保存フォルダを置いた状態で T5/T6 のテストを通す
  - 検証: 統合テストで CRUD + 検索が動作

---

## T10. MCP サーバー (F-7)

- [x] T10.1 MCP SDK 採用（`@modelcontextprotocol/sdk`、Bun 互換性確認）
  - 検証: 最小サーバーが立ち上がる
- [x] T10.2 stdio トランスポート起動（`dennoh serve`）
  - 検証: stdin に initialize リクエストを流して initialize レスポンスを得る
- [x] T10.3 stdout 汚染防止: ログ・診断は stderr に固定（T0.6 のロガーで保証）
  - 検証: stdout を JSON 行のみに保つテスト
- [x] T10.4 `save_memory(content, source?)` ツール登録
  - 検証: ツール呼び出しでファイルが生成される統合テスト
- [x] T10.5 `update_memory(id, content)` ツール登録
  - 検証: 既存ノートが更新される
- [x] T10.6 `delete_memory(id)` ツール登録
  - 検証: ノートが削除される
- [x] T10.7 `search_memory(query, filters?, limit?)` ツール登録
  - 検証: クエリで検索結果が返る
- [x] T10.8 `list_recent(limit?)` ツール登録
  - 検証: 最近のノート一覧が返る
- [x] T10.9 `get_note(id)` ツール登録
  - 検証: ID 指定でノートが返る
- [x] T10.10 `status()` ツール登録（インデックス状態・キュー残数・最新エラー）
  - 検証: 戻り値スキーマのテスト
- [x] T10.11 Claude Desktop 実機接続テスト（設定例ドキュメント込み）
  - 検証: Claude Desktop の MCP 設定に登録して `save_memory` が呼べる

---

## T11. CLI (F-8)

- [x] T11.1 CLI フレームワーク選定と導入（自前ディスパッチャを `src/cli/main.ts` に実装）
  - 検証: `dennoh --help` が表示される（バイリンガル対応）
- [x] T11.2 `dennoh init` 統合（T1.4 を CLI から呼ぶ）
- [x] T11.3 `dennoh serve` 統合（T10.2）
- [x] T11.4 `dennoh add "<text>"` 実装（stdin パイプ対応）
  - 検証: `echo hello | dennoh add` でメモが保存される
  - 補足: パイプ判定は `process.stdin.isTTY !== true`（実パイプでは `isTTY` が `undefined` で `=== false` では拾えないため）
- [x] T11.5 `dennoh update <id> "<text>"` 実装（stdin パイプ対応）
  - 検証: 既存ノートが更新
- [x] T11.6 `dennoh delete <id>` 実装
- [x] T11.7 `dennoh search "<query>" [--project X] [--tag Y] [--limit N] [--json]`
  - 検証: 1行1件の一覧表示と JSON 両方で結果が出る
- [x] T11.8 `dennoh get <id> [--json]`
- [x] T11.9 `dennoh recent [--limit N] [--json]`
- [x] T11.10 `dennoh status` 実装
- [x] T11.11 `dennoh reindex` 実装（T4.5 を CLI から）
- [x] T11.12 `dennoh history <id>` / `dennoh restore <id> <commit>` 統合
- [x] T11.13 `dennoh config get/set/list` 統合
- [x] T11.14 終了コード規約（成功 0、ユーザーエラー 1、内部エラー 2）
  - 検証: 不正引数・ID不存在・バリデーションで 1、DB接続失敗・予期しない例外で 2（`src/cli/types.ts` に `EXIT_SUCCESS`/`EXIT_USER_ERROR`/`EXIT_INTERNAL_ERROR` を定義し全コマンドに適用）
- [x] T11.15 `--help` / コマンド別ヘルプの i18n 対応
  - 検証: `DENNOH_LANG=en dennoh --help` で英語表示

---

## T12. i18n (4.7)

> **現状メモ**: CLI のメッセージは `status.ts` 由来の「各コマンドファイル内 `MESSAGES: Record<Lang, {...}>`」方式で日英対応済み（add/update/delete/get/search/recent/reindex + main の usage/不明コマンド）。集中辞書（`src/i18n/ja.ts`/`en.ts`）方式は未導入のため T12.1/T12.3 は別途リファクタが必要。history/restore/serve/config は英語のまま（未 localize）。

- [ ] T12.1 メッセージ辞書（`src/i18n/ja.ts`, `src/i18n/en.ts`、フラットキー構造）
  - 検証: ja/en 両方が同じキー集合を持つ単体テスト
  - 注: 現状は集中辞書ではなくコマンド単位の `MESSAGES` 定数で実装（要件の辞書方式は未着手）
- [x] T12.2 言語解決ロジック（環境変数 > 設定ファイル > 既定 `ja`）
  - 検証: 優先度のテスト（`src/config` の `resolveLang()`: `DENNOH_LANG` > config.lang > 既定 `ja`）
- [ ] T12.3 CLI 全コマンドが辞書経由でメッセージ出力
  - 検証: ハードコード文字列が無いことを grep で検出するテスト
  - 注: 新規 7 コマンド + main は日英対応済みだが、集中辞書経由ではなく、また history/restore/serve/config は未 localize
- [ ] T12.4 MCP ツール description が辞書経由
  - 検証: T10.11 と同じ

---

## T13. ビルド / 配布 (8章)

- [ ] T13.1 `bun build --compile` で macOS 用 stand-alone バイナリ生成
  - 検証: 生成バイナリが Bun 未インストール環境で起動する
- [ ] T13.2 npm パッケージとして公開できる形態（`bunx dennoh` を想定）
  - 検証: `bunx <local-tarball>` で起動する
- [ ] T13.3 バージョン埋め込み（`dennoh --version`）
  - 検証: `package.json` の version と一致
- [ ] T13.4 CI（GitHub Actions、macOS ランナーで lint/test/build）
  - 検証: PR で全ジョブが green

---

## T14. ドキュメント

- [ ] T14.1 README（インストール手順、Claude Desktop への登録例、基本 CLI 例）
  - 検証: README に従って未経験者がインストールから検索まで完了できる
- [ ] T14.2 設定ファイル仕様の記載
- [ ] T14.3 トラブルシュート（iCloud + Git の `.git` 同期除外手順）

---

## T15. 受け入れ基準の検証（要件 7章）

最後に、要件 7章 の11項目を1つずつ実機で確認する。

- [ ] T15.1 (要件 7-1) Claude Desktop から `save_memory` 呼び出し → ファイル生成 → 再起動後復元
- [ ] T15.2 (要件 7-2) `dennoh add` でメモ保存、stdin パイプ動作
- [ ] T15.3 (要件 7-3) `search_memory` / `dennoh search` で FTS 検索ヒット
- [ ] T15.4 (要件 7-4) `#denno @mcp` を含む本文を保存 → `--project denno` でヒット
- [ ] T15.5 (要件 7-5) frontmatter に `id` が無く、ファイル名 UUID と一致
- [ ] T15.6 (要件 7-6) 外部エディタで編集 → 再インデックス → 検索結果反映
- [ ] T15.7 (要件 7-7) iCloud Drive 配下で CRUD/検索が動作、`.git` 同期除外案内が表示される
- [ ] T15.8 (要件 7-8) 複数更新後 `dennoh history` で履歴表示、`dennoh restore` で巻き戻し
- [ ] T15.9 (要件 7-9) `dennoh reindex` でインデックス削除→再構築→検索結果復元
- [ ] T15.10 (要件 7-10) CLI 全コマンド（init/serve/add/update/delete/search/get/recent/status/config/reindex/history/restore）動作
- [ ] T15.11 (要件 7-11) macOS でビルド・起動・基本機能の動作完了

---

## 実装順序の推奨

依存関係を踏まえた推奨順序:

1. **T0** プロジェクト基盤
2. **T1** 設定 / 初期化
3. **T2** Markdown 永続化
4. **T3** `#/@` 抽出
5. **T4** SQLite + FTS
6. **T5** メモ CRUD コア
7. **T6** 検索
8. **T8** Git 自動管理（T5 完了後）
9. **T7** ファイル監視
10. **T9** 同期共存
11. **T10** MCP サーバー
12. **T11** CLI
13. **T12** i18n（T10/T11 と並行）
14. **T13** ビルド / 配布
15. **T14** ドキュメント
16. **T15** 受け入れ基準検証
