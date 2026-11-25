import type { RelationType } from "../../../contracts/news";

// 関係の種類の名前（BD-09 3章、BD-07 4.2）。コードの値は画面に出さず、名前を出す。
export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  follow_up: "続報",
  background: "背景",
  same_actor: "共通の主体",
  related_topic: "関連する話題",
};
