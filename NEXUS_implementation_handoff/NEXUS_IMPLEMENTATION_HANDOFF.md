# NEXUS — 別リポジトリ実装用ハンドオフ仕様

更新日: 2026-11-23 / 状態: 構想・UIモック検証済み、プロダクション実装未着手

> この文書は実装担当AIへの入力として使うことを想定する。**確定事項**と**提案・未決定**を区別すること。既存のHTMLモックはUIリファレンスであり、そのJavaScript構造・データ構造をそのまま本番採用する必要はない。

## 0. 最初に実装担当へ伝える指示

NEXUSを、AIから配信される多様な情報を一元的に受信・閲覧・探索・保存し、**表示中のコンテンツを文脈としてAIに質問できる**個人向け情報・学習プラットフォームとして実装する。iPad / AndroidのPWAから利用し、Mac mini上でホストしてTailscale越しに接続する。

- まず既存モックと本仕様を確認し、要件未確定事項をリストアップする。
- Phase 1ではローカルのサンプルデータでUIを高忠実度に再現し、画面操作・ページ遷移・レスポンシブ挙動を検証する。
- その後API・DB・コンテンツ受信・AI Runnerの順に結合する。初期段階からCLIに無制限のツール実行権限を与えない。
- モックには画像と文章のダミーデータがある。架空情報を実ニュースとして扱わない。
- 仕様にない認証方式・課金方式・コンテンツ生成頻度・AIモデル名などを勝手に確定しない。

## 1. プロダクトの目的と対象

### 確定

- 名称: **NEXUS**（UI仮称として採用してデザインを作成）
- AIエージェントから送られてくる情報の集約先。単なる受信箱ではなく、蓄積情報の検索・探索・学習もする。
- **双方向**: 閲覧ページ内のチャットからAIへ質問、深掘り、追加説明、再生成などを依頼する。
- 情報の種類は今後増える。ニュース・英語学習は代表モジュールにすぎない。
- 主な利用端末: Androidスマホ、iPad。フロントはPWA。
- Mac miniをサーバ・バックエンドにし、端末からTailscaleでプライベートアクセスする。

### 設計原則

1. 共通基盤（受信、検索、既読、保存、履歴、会話）はコンテンツ種別から分離。
2. 表示UIはコンテンツ種別・表示方式ごとにRendererを切り替える。
3. AIチャットUIは共通、渡すコンテキストは現在開いているコンテンツ単位で動的に切り替える。
4. コンテンツ本体・ページ上のユーザー選択・AI会話履歴を分離して管理。
5. 画面のアニメーションは重要だが、操作性・可読性・タップターゲットを損なわない。

## 2. ビジュアル・UX（重要）

### 共通トーン（確定）

- Sci-Fi HUD / futuristic cockpit / dark glassmorphism。暗色ベース、アンバー・オレンジ発光、補助にブルー／パープル／グリーン。
- ソフトグロー、円形オービット、薄い接続線、わずかな浮遊と奥行き感、選択した要素の強調。
- ロゴ: 中央にN、周囲を周回する発光軌道、文字は必要最低限の「NEXUS」。透過PNGを同梱。
- **ホームのスマホデザインは縦積みではない。左に円形HUD、右に3D風カードを横並びに配置する。** 一度縦積みにしたがユーザーは横並びを選好した。狭い画面でもカードの本文や操作対象が隠れないようにする。
- iPadも左HUD＋右カードが基本。広いスペースに合わせてサイズ・情報密度を増やす。

### ホーム（NEXUS cockpit）

- 主要機能を円形6セグメント前後で表示: News Galaxy / English / Inbox / Explore / Library / AI Chat。追加機能はカードや別画面へ。
- 中心のAIエンブレムは共通AIチャットの起点。
- 周囲のセグメント選択で発光し、右側の「機能カード」スタックが立体的に切り替わる。選択カードは前面、ほかは奥に薄く配置。
- カードをタップすると該当モジュールへ。選択と遷移を別操作にするかはUX検証で決定。
- サブ情報: 新着数、未読、学習の続き、AIタスク状況、今日のピックアップ等。データがないものは0や空状態を表示。モックの件数は架空。
- アニメーションの想定: セグメントのグロー→カードのスライド/回転/奥行き→展開してページ遷移。`prefers-reduced-motion` 対応。
- 過度な被りは不可。HUDと右側カードの**視覚的重なりは演出として許容**するが、カード文字や押す場所がHUDに隠れてはいけない。

### News Galaxy（ニュース専用モジュール）

- AIが生成するニュース要約は1記事数百文字、配信頻度は1日約10件。
- 記事間で関連があるもの**だけ**接続。関連のない記事は独立ノードのまま。
- 「今日のニュース」のようなダミー中心ノードを置かない。**ユーザーが選択した記事**がフォーカスされ、周囲の関連記事が変化する。
- ダークな星座/銀河グラフ、ニュース画像付きノード、細い発光線、タップで中心移動、カメラ/ノードの滑らかな移動。
- 選択記事の数百文字要約は下部Bottom Sheetで表示。ドラッグ/展開で読みやすさを確保。
- 関係性には可能な限り関係タイプを保持（続報、背景、共通主体、関連トピック等）。AI推定による因果関係を事実として見せない。
- 初期表示は当日の10件程度、過去記事は必要に応じてロード。1年分を同時描画しない。

### English Lesson（英語教材専用モジュール）

- 現状、AIが**毎回HTMLを生成**し、長文教材（例: be動詞がテーマ）を配信している。
- 対象の単語・語句をタップすると、あらかじめHTML内に埋め込んだ文法説明が現れる。**クリック時にAIを呼んでいるわけではない**。
- 初期実装では既存HTMLを安全な隔離環境で表示し、インライン解説の動作を維持する。
- 別途、プラットフォーム共通チャットから「このamの使い方は？」などの追加質問をできるようにする。
- 将来的には長文・注釈範囲・解説などを構造化JSONとして保存し、共通Rendererに移す選択肢もある。**移行は未決定**。

### 画面共通のAIチャット

- 各ページから呼び出し可能。スマホはBottom Sheet / 全画面に拡張、iPadは右ペインも候補。
- 質問対象がページ全体、ニュース1記事、教材中の語句、またはノード等であることを明示できる。
- 会話を開くと現在のページ・選択箇所がAI側に渡る。ユーザーが文面を貼り直す必要はない。
- 応答をストリーミング表示。過去の発言を保存し、同じコンテンツで再訪した際に続きから話せる。
- Chatで「追加調査」等のタスクを起こした場合、処理中・完了・失敗の状態を明示。

## 3. 技術構成

### 確定

- フロント: Next.js + Reactを使ったPWA、モバイルファースト
- サーバ: Mac mini
- ネットワーク: Tailscaleのプライベート接続
- AI実行: `claude -p` が第一候補。**採用可否・認証・ランニングコスト・SDK代替は実装前に確認する**。

### 推奨（未確定）

- TypeScript、Tailwind CSS、Motionによる画面アニメーション。グラフはSVG + Motionを優先検討、React Flowも比較。
- Next.jsのRoute Handlers/BFF + 独立AI Runner（同一Mac mini上の別プロセス）。
- DB PostgreSQL（JSONB）、HTMLや大きなアセットはファイルストレージ／オブジェクトストレージ相当。
- AI応答はSSEストリーミングを第一候補に。ジョブ実行はシンプルなDBキューまたはワーカーを検討。
- Tailscale Serve経由のHTTPS。実際の設定はTailscale環境と互換性を確認する。
- Docker Composeでフロント/BFF/DB等を管理可能。ただしホスト上のClaude CLI実行方法は、権限分離と認証方式から選択する。

## 4. データモデル（提案）

| エンティティ | 主な項目 | 目的 |
|---|---|---|
| Channel | id, name, description, icon, default_renderer | ニュース／英語など配信チャンネル |
| Collection | id, channel_id, title, published_at, metadata | ある日のニュース10件、教材セット等 |
| Content | id, channel_id, collection_id?, type, renderer, title, summary?, body_json?, html_path?, source, created_at | 個々の閲覧内容 |
| ContentRelation | id, from_id, to_id, relation_type, confidence?, evidence? | 記事間の意味的関係 |
| Delivery | id, collection_id?, content_id?, delivered_at, source_run_id? | 配信の記録と重複排除 |
| UserContentState | user_id, content_id, read_at?, saved_at?, progress_json? | 既読、保存、進捗 |
| Conversation | id, user_id, content_id?, title, status | コンテンツ起点の会話 |
| Message | id, conversation_id, role, content, context_snapshot, created_at | 会話履歴 |
| AIRun | id, conversation_id?, task_type, status, started_at, finished_at, error | CLI実行・非同期処理の追跡 |

`type`（ニュース/英語など）と`renderer`（news_graph/html/reading/defaultなど）は分離する。記事ID等をUI内の表示位置に依存させない。

## 5. API案（未確定、あくまで叩き台）

```text
GET    /api/v1/home
GET    /api/v1/channels
GET    /api/v1/collections?channel=news&date=YYYY-MM-DD
GET    /api/v1/contents/:id
GET    /api/v1/contents/:id/relations
POST   /api/v1/deliveries             # AIからコンテンツ送信
PATCH  /api/v1/contents/:id/state     # 既読・保存・学習進捗
GET    /api/v1/search?q=...
GET    /api/v1/conversations?content_id=...
POST   /api/v1/conversations/:id/messages
GET    /api/v1/ai-runs/:id            # 長時間タスク状態
GET    /api/v1/ai-runs/:id/events     # SSE候補
```

受信APIは認証（共有秘密鍵よりも可能ならスコープ付きトークン）、スキーマ検証、入力上限、`idempotency_key`による重複排除を持たせる。端末の認証とAIからの配信認証を分離する。

## 6. AI Context Builder

### 入力例

```json
{
  "conversation_id": "conv-123",
  "content_id": "lesson-004",
  "selection": {
    "kind": "text_span",
    "anchor_id": "grammar-am-2",
    "text": "am",
    "sentence": "I am a student."
  },
  "user_message": "なぜisじゃないの？"
}
```

- `content_id`をもとに**サーバー側から信頼できる保存済みデータ**を引く。クライアントが送る文章だけを信頼しない。
- content種別ごとにコンテキスト構築を分ける。英語: 学習テーマ、対象文、既存注釈。ニュース: 選択記事、出典、必要な関連記事。
- 直近の対話、必要な要約、ユーザー質問を付加。全文や過去会話の無制限投入はしない。
- 会話はプラットフォームDBを正本とし、CLIセッションIDには依存し切らない。
- 入力トークン数・推論コストと外部情報取得の許可条件を制限する。

## 7. Claude Runner

- CLIは**Mac miniサーバー上**で実行。ブラウザから直接起動しない。
- プロセス起動はshell文字列連結ではなく引数配列・標準入力等を使い、プロンプトのコマンドインジェクションを回避。
- チャット用RunnerではBash/ファイル編集/リポジトリアクセスなどを原則無効化または厳格に許可制にする。
- 作業ディレクトリ、環境変数、実行ユーザー、ファイルシステム、ネットワーク権限を制限。
- タイムアウト、キャンセル、同時実行上限、再試行方針、監査ログ、API資格情報の保護を実装。
- 外部のニュース内容・AI生成HTML・チャット入力はプロンプトインジェクション源として扱う。
- `claude -p` の使用条件・認証形態・非対話モードの現行オプションは導入時に公式仕様を再確認。単純チャットならClaude Messages API/Agent SDK等への差し替え可能な`AIProvider`抽象を置く。

## 8. HTML教材の安全な表示

- 生成されたHTMLを`dangerouslySetInnerHTML`でアプリのDOMへ無制限に埋め込まない。
- 専用隔離オリジンのiframe、必要最小限の`sandbox`権限、CSPを検討。
- `allow-scripts` と `allow-same-origin` を同一オリジンで安易に併用しない。
- 子iframeから親UIへ選択語句を伝える場合は`postMessage`を利用し、`origin`・メッセージ種類・スキーマ・IDを検証する。
- 既存HTMLのクリックによる事前生成解説は残す。チャット送信用には選択情報を別途連携する。

## 9. PWA / ネットワーク / 運用

- HTTPSの同一オリジンからPWA manifest, icons, service workerを配信。
- iPad/Androidのホーム画面追加と起動・表示モードを検証。
- オフライン時はホームのキャッシュや「接続なし」を表示してもよいが、AIチャットと最新データ取得は原則Mac miniオンライン必須。
- Mac miniのスリープ、再起動後のサービス自動復帰、Tailscale Serve、DBバックアップ、ログローテーションを設計。
- Tailscaleはネットワーク境界であり、アプリの認証・認可を不要にするものではない。
- `prefers-reduced-motion`対応、タップ領域、可読な文字サイズ、スクロール、画面回転への耐性。

## 10. Phase分割と受け入れ基準

### Phase 1 — UIを固める

- NEXUS cockpitホーム: **モバイルでも左HUD＋右スタック**。360/375/390/430pxおよびiPad幅でレイアウト確認。
- 円形セグメント選択→対象カード前面移動→押下でモジュール遷移。
- News Galaxyの関連グラフ（ハードコードしたサンプルデータ10件）。「今日」という中央ハブなし。
- English HTMLをiframe内に表示し、語句タップで事前埋込解説が出る。
- 各画面で共通チャットを開閉し、コンテンツ選択状態がUI上で反映される（回答はモック）。
- 主要遷移で文字やクリック領域が見えなくならない。利用者の意図しない水平スクロールなし。

### Phase 2 — コンテンツ基盤

- DB、コンテンツAPI、Collection/Content、配信API、既読/保存、検索、過去情報閲覧。
- サンプルJSONと生成HTMLの受信→保存→表示のE2Eが動作。

### Phase 3 — AIとの双方向連携

- Chat API、Context Builder、AI Provider、Claude Runner接続。
- 対象教材の「am」を選んで質問した際に教材テーマ・対象文・事前解説を渡せる。
- ニュース選択→質問時に当該ニュースと必要な出典情報を渡せる。
- 会話履歴を保存、SSEまたは同等のストリーミング、エラー/再試行/キャンセル。

### Phase 4 — 高度化

- AIへの追加調査・教材生成依頼をジョブ化し、完了コンテンツとして格納。
- 横断的関係性・学習進捗・検索高度化など。いずれも未確定の優先順位。

## 11. 未決定で、実装前に合意が必要な事項

- DBをPostgreSQLにするか、軽量構成で開始するか。データ保持・バックアップ方針。
- 複数ユーザー対応の要否、端末の認証方式。
- AI配信元の種類、外部AIへのコンテンツ投入方式、共有秘密情報の管理。
- Claude CLI vs API / Agent SDK。ライセンス、認証、コストと実行権限。
- HTML生成物の改修範囲、独立オリジンの用意方法。
- News Galaxyの関連性判定の方法（配信側で生成するかサーバで後処理するか）。
- チャットから新規資料生成を即時/非同期どちらにするか、生成物への承認フロー。
- 通知の方式（PWAのPush通知は端末・OS別の制約確認が必要）。

## 12. 同梱の参照ファイル

- `references/nexus-home-mock-v3-handoff.html`: 横並びHUDモックの実装用参照。元のv2モックに横並びスタイルを反映したファイルで、本番コードではない。
- `references/news-galaxy-mock.html`: ニュースグラフのUI/アニメーション参照。
- `references/nexus-home-reference.png`: NEXUSホームのデザイン画像。
- `references/news-galaxy-reference.png`: News Galaxyのデザイン画像。
- `references/nexus-logo-transparent.png`: 透過PNGロゴ（作成済み）。
- `references/original-hud-inspiration.jpg`: 元のHUDスタイル参照画像。特定の既存サービスの画面をそのまま複製するのではなく、デザインの方向性として使用。

### 実装担当に求める初回アウトプット

1. `docs/architecture.md`（技術と責務の分離、未決事項の整理）
2. `docs/ui-spec.md`（ホーム・ニュース・英語・チャットの画面状態と動作）
3. `docs/phase-plan.md`（小さなPR単位にした実装計画と検証項目）
4. Phase 1動作モックをNext.jsで作成し、Android/iPad幅の画面キャプチャを添付する。

