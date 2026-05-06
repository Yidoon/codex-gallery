# Codex Gallery

言語: [English](./README.md) | [简体中文](./README.zh-CN.md) | 日本語

Codex Gallery は、Codex が生成した画像を閲覧するためのローカルファーストなデスクトップギャラリーです。ローカルの Codex データディレクトリをスキャンし、画像を会話ごとに整理し、利用可能な場合はセッションタイトルを表示します。元の Codex ファイルを変更せずに、お気に入り、プレビュー、メタデータ確認、エクスポートができます。

これは Codex の非公式コンパニオンアプリです。

## なぜ作るのか

Codex が生成した画像はローカルに保存されます。

```text
~/.codex/generated_images
```

ただし、Codex では現在、生成画像は主に作成された会話内でしか確認できません。複数の会話で画像を生成していくと、次のような問題が起きます。

- Codex が生成したすべての画像を一か所で見づらい。
- 画像がどの会話から来たものか分かりづらい。
- 以前生成した画像を見つけて、追加制作に使いづらい。
- 他のプラットフォームで使うために画像を書き出しづらい。

Codex Gallery は、これらのローカル画像をシンプルな写真ライブラリのように扱えるようにします。

## 機能

- **タイムライン**: Codex 生成画像を更新日時ごとに閲覧。
- **セッション**: Codex の conversation/thread id ごとに画像を分類。
- **セッションタイトル**: 可能な場合は Codex のローカル SQLite 状態から会話タイトルを読み取り。
- **Missing Session**: 元のセッションメタデータがなくても画像を表示。
- **お気に入り**: Codex Gallery 独自のローカル SQLite データベースに保存。
- **大きなプレビュー**: 画像を中央に大きく表示し、前後の画像に移動可能。
- **メタデータ**: ファイル名、サイズ、形式、パス、セッション id、プロジェクトディレクトリ、更新日時などを確認。
- **エクスポート**: 選択した画像を元のファイル名のまま Downloads にコピー。元画像は移動しません。
- **自動更新**: Codex の画像ディレクトリを監視し、新しい画像が追加されたら更新。
- **遅延サムネイル**: スキャン時は軽量なメタデータだけを返し、サムネイルは必要に応じて読み込み、ローカルにキャッシュ。
- **空状態**: Codex データ、生成画像、セッションメタデータがない場合に分かりやすく表示。

## スクリーンショット

スクリーンショットはまだ含まれていません。追加するとよいもの:

- Timeline 画面
- Sessions 画面
- 大きな画像プレビュー
- Metadata サイドパネル

## データソース

デフォルトでは次の場所を読み取ります。

```text
~/.codex/generated_images
~/.codex/state_5.sqlite
```

Codex の生成画像は通常、次の構造で保存されます。

```text
~/.codex/generated_images/{thread_id}/{image_file}
```

Codex Gallery は `{thread_id}` を画像のセッション id として扱い、次の場所で対応するスレッドを探します。

```text
~/.codex/state_5.sqlite -> threads.id
```

セッションタイトルは次の順序で表示されます。

1. `threads.title`
2. `threads.first_user_message`
3. 短い session id

画像フォルダは存在するが `state_5.sqlite` に対応するスレッドがない場合、それらの画像は **Missing Session** に分類されます。

## プライバシーと安全性

Codex Gallery はローカルファーストです。

- 画像をアップロードしません。
- 会話メタデータをアップロードしません。
- `~/.codex` を変更しません。
- Codex の `state_5.sqlite` は読み取り専用で開きます。
- お気に入りはアプリ独自の `codex-gallery.db` に保存されます。
- サムネイルは必要に応じて生成され、アプリのデータディレクトリにキャッシュされます。
- 画像の読み取り、エクスポート、Finder での表示は `~/.codex/generated_images` 以下に制限されます。
- エクスポートはファイルを Downloads にコピーするだけで、元画像を移動または削除しません。

## 必要条件

- v1 は macOS 優先です。
- Node.js と pnpm。
- `PATH` 上で利用可能な Rust ツールチェーン、`rustc`、`cargo`。
- ローカルの Codex データディレクトリ、特に `~/.codex/generated_images`。

Tauri 自体は Windows と Linux にも対応できますが、このプロジェクトは現在 macOS を優先して開発・検証しています。

## はじめ方

リポジトリをクローンします。

```sh
git clone https://github.com/Yidoon/codex-gallery.git
cd codex-gallery
```

依存関係をインストールします。

```sh
pnpm install
```

デスクトップアプリを起動します。

```sh
pnpm tauri:dev
```

Vite のシェルだけを起動することもできます。

```sh
pnpm dev
```

通常のブラウザページだけではローカルの Codex ファイルをスキャンできません。完全なデスクトップ体験には `pnpm tauri:dev` を使ってください。

## コマンド

```sh
pnpm dev              # Vite web shell を起動
pnpm tauri:dev        # Tauri デスクトップアプリを起動
pnpm build            # TypeScript チェックとフロントエンドビルド
pnpm lint             # ESLint を実行
pnpm tauri:build      # macOS .app バンドルをビルド
pnpm tauri:build:dmg  # ローカル環境が対応している場合に DMG をビルド
pnpm icons            # アプリアイコンを再生成
```

Rust 側のチェック:

```sh
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

## ビルド出力

デフォルトの app-only ビルドは次の場所に出力されます。

```text
src-tauri/target/release/bundle/macos/Codex Gallery.app
```

DMG をビルドする場合:

```sh
pnpm tauri:build:dmg
```

DMG の作成は、ローカルの macOS パッケージング環境、コード署名、notarization の設定に依存する場合があります。

## Release ワークフロー

GitHub Actions はバージョン tag が push されたときだけ macOS DMG Release をビルドします。`main` ブランチへの通常の push では Release は公開されません。

Release tag を作成する前に、次のバージョンが一致していることを確認してください。

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

バージョン tag を作成して push します。

```sh
git tag v1.0.0
git push origin v1.0.0
```

workflow はフロントエンドと Rust バックエンドを検証したあと、Apple Silicon と Intel 用の macOS DMG を GitHub Release にアップロードします。現在のビルドはまだ notarization されていないため、macOS で unidentified developer の警告が表示される場合があります。

## プロジェクト構成

```text
.
├── src/                    # React + TypeScript フロントエンド
│   ├── App.tsx             # メイン UI の状態とビュー構成
│   ├── api.ts              # Tauri command ラッパー
│   ├── components/         # 再利用可能な UI コンポーネント
│   └── types.ts            # フロントエンド共有型
├── src-tauri/              # Rust/Tauri バックエンド
│   ├── src/lib.rs          # スキャン、SQLite 読み取り、watcher、エクスポート、画像コマンド
│   ├── capabilities/       # Tauri 権限設定
│   └── tauri.conf.json     # Tauri アプリ設定
├── scripts/                # ユーティリティスクリプト
└── public/                 # 静的アセット
```

## データモデル

Codex Gallery は 2 種類のローカルデータを組み合わせます。

- 画像ファイル: `~/.codex/generated_images/{thread_id}`
- セッションメタデータ: `~/.codex/state_5.sqlite`

スキャン時には軽量な画像メタデータだけを返します。サムネイルと元画像データは、専用の Tauri command を通じて後から読み込まれます。

## 現在の制限

- v1 は macOS-first です。
- デフォルトの Codex データディレクトリは `~/.codex` 固定です。
- エクスポート先は現在 Downloads がデフォルトです。
- エクスポート時のファイル名は現在、元のファイル名を保持します。
- 正式な release pipeline はまだありません。
- スクリーンショットとプロジェクトロゴはまだ追加されていません。

## Roadmap

- Codex データディレクトリのカスタマイズ。
- Windows 対応。
- より柔軟なエクスポート命名テンプレート。
- 複数選択操作の改善。
- サムネイルキャッシュのクリーンアップ。
- 署名済み release workflow。
- スキャン、Missing Session、エクスポート挙動のテスト追加。

## コントリビュート

Issue と pull request を歓迎します。

Pull request を開く前に、次を実行してください。

```sh
pnpm lint
pnpm build
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

貢献時の方針:

- ローカルファーストを維持する。
- `~/.codex` に書き込まない。
- ファイルアクセス範囲をできるだけ狭くする。
- UI はシンプルで控えめ、分かりやすく保つ。
- スキャンやエクスポートの挙動を変更する場合はテストを追加する。

## License

このプロジェクトは MIT License で公開されています。詳しくは [LICENSE](./LICENSE) を参照してください。

## 免責事項

Codex Gallery は OpenAI と提携しておらず、OpenAI による公式の保守・承認を受けたものではありません。ローカルで生成された Codex 画像を閲覧するための独立したコンパニオンアプリです。
