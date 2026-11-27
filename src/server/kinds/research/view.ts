import type {
  ApproachMark,
  ApproachPayload,
  ResearchStatus,
} from "../../../contracts/research";
import type { Database } from "../../db/connection";
import { inReadTransaction } from "../../db/transaction";
import {
  findResearchReportView,
  listResearchTopicRows,
  listResearchWeeks,
} from "../../repositories/research";
import { NexusError } from "../../shared/errors";

// 課題の一覧と週報のデータ（DD-01 M33。DD-02 FN-026、FN-027。CR-020）。読むだけで、データを変えない。
// 週報は2つ以上の文で同じ時点の値を読むので、読むためのトランザクション（`BEGIN`）で読む（DD-05 1章）。

// `openapi.yaml` の `ResearchTopicSummary`。
export interface ResearchTopicSummary {
  topicId: string;
  title: string;
  status: ResearchStatus;
  lastWeek: number;
  lastReceivedAt: string;
  latestContentId: number;
  hasUnread: boolean;
}

// `openapi.yaml` の `ResearchTopicList`。
export interface ResearchTopicList {
  topics: ResearchTopicSummary[];
}

// `openapi.yaml` の `Approach`。
export interface Approach {
  title: string;
  howToMd: string;
  sourceUrls: string[];
  // 出典の URL の数（Q-088 の答え。数は残さない。DD-02 FN-027 手順 4）。
  sourceCount: number;
  marks: ApproachMark[];
  counterMd: string | null;
}

// `openapi.yaml` の `ResearchReportDetail`。
export interface ResearchReportDetail {
  contentId: number;
  topicId: string;
  topicTitle: string;
  week: number;
  sentOn: string;
  status: ResearchStatus;
  answerMd: string;
  approaches: Approach[];
  unknownsMd: string;
  changesMd: string;
  receivedAt: string;
  state: {
    contentId: number;
    isNew: boolean;
    isRead: boolean;
    isSaved: boolean;
    savedAt: string | null;
  };
  // 同じ課題の週の一覧。週の大きい順。
  weeks: { contentId: number; week: number; sentOn: string; isRead: boolean }[];
}

export interface ResearchView {
  // 課題の一覧（FN-026 手順 2、3）。最後に届いた日時の新しい順。
  listTopics(): ResearchTopicList;
  // 週報と同じ課題の週の一覧（FN-027 手順 2〜4）。
  // 内容が無いか週報でなければ NOT_FOUND（MSG-048）を投げる。
  getReport(contentId: number): ResearchReportDetail;
}

// 残した方法（BD-06 IF-005 3.2 の名前のまま）に出典の数を添える。反対の意見が無ければ null。
function toApproach(approach: ApproachPayload): Approach {
  return {
    title: approach.title,
    howToMd: approach.howToMd,
    sourceUrls: approach.sourceUrls,
    sourceCount: approach.sourceUrls.length,
    marks: approach.marks,
    counterMd: approach.counterMd ?? null,
  };
}

export function createResearchView(deps: { db: Database }): ResearchView {
  const { db } = deps;

  return {
    listTopics() {
      const topics = inReadTransaction(db, () => listResearchTopicRows(db));
      return {
        topics: topics.map((row) => ({
          topicId: row.topicKey,
          title: row.title,
          status: row.status as ResearchStatus,
          lastWeek: row.lastWeek,
          lastReceivedAt: row.lastReceivedAt,
          latestContentId: row.latestContentId,
          hasUnread: row.hasUnread,
        })),
      };
    },

    getReport(contentId) {
      return inReadTransaction(db, () => {
        const row = findResearchReportView(db, contentId);
        if (row === null) {
          throw new NexusError("NOT_FOUND", "週報が無い", { msg: "MSG-048" });
        }
        const approaches = (
          JSON.parse(row.approachesJson) as ApproachPayload[]
        ).map(toApproach);
        return {
          contentId: row.contentId,
          topicId: row.topicKey,
          topicTitle: row.topicTitle,
          week: row.week,
          sentOn: row.sentOn,
          status: row.status as ResearchStatus,
          answerMd: row.answerMd,
          approaches,
          unknownsMd: row.unknownsMd,
          changesMd: row.changesMd,
          receivedAt: row.receivedAt,
          state: {
            contentId: row.contentId,
            isNew: row.openedAt === null,
            isRead: row.isRead,
            isSaved: row.isSaved,
            savedAt: row.savedAt,
          },
          weeks: listResearchWeeks(db, row.topicId),
        };
      });
    },
  };
}
