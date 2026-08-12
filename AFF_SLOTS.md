# アフィリエイトスロット一覧（GTO Coach / shoubu-lab.com）

> **制約**: このドメインはギャンブル隔離ドメイン。掲載できるのは**書籍・学習コンテンツのみ**。
> オンラインカジノ・賭博サービスへのリンクは絶対に設置しない。

## スロット（index.html #books セクション内、`data-aff` 属性で特定）

| スロットID | 商品 | リンク先 | 状態 |
|---|---|---|---|
| RAKUTEN_GTO_BOOK1 | ポーカーの直感的ゲーム理論（パンローリング） | 楽天ブックス item 18091638 | 楽天アフィリ実リンク済 |
| RAKUTEN_GTO_BOOK2 | ポーカーとゲーム理論（パンローリング） | 楽天ブックス item 16618322 | 楽天アフィリ実リンク済 |
| RAKUTEN_GTO_BOOK3 | ポーカーエリートの「公然の秘密」頻度ベース戦略 | 楽天ブックス item 15712137 | 楽天アフィリ実リンク済 |
| NOTE_CTA | note攻略記事への導線 | `<div id="note-cta" hidden>`（`<!-- note導線プレースホルダ -->` 直下） | 未使用（位置のみ確保） |

## 運用メモ

- リンク差し替え時は `data-aff="スロットID"` でgrepして該当 `<a>` の href のみ更新
- 全リンクに `target="_blank" rel="nofollow sponsored noopener"` を維持
- セクション冒頭の「広告・PR」バッジと末尾の楽天アフィリ開示文は削除しない
- **編集後は必ず `index.html` → `deploy/index.html` にコピー**（Cloudflare Pages は deploy/ を配信）
