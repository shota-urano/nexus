import { type OpenedAiJobs, openAiJobs } from "../../../server/ai-jobs";
import { createDeviceKeyVerifier } from "../../../server/auth/device-key";
import { createDevices, type Devices } from "../../../server/auth/devices";
import {
  createSenderKeys,
  type SenderKeys,
} from "../../../server/auth/sender-key";
import { type Chat, createChat } from "../../../server/chat";
import { createContents, type Contents } from "../../../server/contents";
import { createHomeView, type HomeView } from "../../../server/home";
import { createIngest, type Ingest } from "../../../server/ingest";
import { createNewsView, type NewsView } from "../../../server/kinds/news/view";
import {
  createResearchView,
  type ResearchView,
} from "../../../server/kinds/research/view";
import {
  createEnglishLearning,
  type EnglishLearning,
} from "../../../server/kinds/english/learning";
import {
  createEnglishForSender,
  type EnglishForSender,
} from "../../../server/kinds/english/provide";
import { type Clock, systemClock } from "../../../server/shared/clock";
import { loadConfig } from "../../../server/shared/config";
import { NexusError } from "../../../server/shared/errors";
import { createLogger, type Logger } from "../../../server/shared/logger";
import { createDeviceApiContext, type DeviceApiContext } from "./device-api";

// Web サーバのプロセスが使う部品（DD-01 M11）。設定を環境変数から読み（DD-09 2.3）、
// NEXUS_DATA_DIR の DB を開く。
// 起動のとき（src/instrumentation.ts）に作り、まだ当てていないマイグレーションを全て当ててから
// 要求を受け付ける（DD-03 5章、DD-09 2.1）。あとの要求は同じものを使う。
// 設定が読めないか、マイグレーションを当てられなければ（DD-06 E17、E08）作らずに投げ、
// 次の要求でもう一度作る。

type Env = Readonly<Record<string, string | undefined>>;

export interface WebContext {
  logger: Logger;
  devices: Devices;
  aiJobs: OpenedAiJobs;
  senderKeys: SenderKeys;
  ingest: Ingest;
  englishForSender: EnglishForSender;
  // 端末の API の入口（DD-02 3章 P01）が使うもの。
  deviceApi: DeviceApiContext;
  contents: Contents;
  // 記事の図と案内（M15。FN-003、FN-004）。
  news: NewsView;
  // 英語の教材の一覧、教材、完了（DD-01 M16）。
  english: EnglishLearning;
  // 会話（DD-01 M18）。
  chat: Chat;
  // ホームの表示（DD-01 M19。FN-020）。
  home: HomeView;
  // 課題の一覧と週報（DD-01 M33。FN-026、FN-027。CR-020）。
  research: ResearchView;
  clock: Clock;
}

let context: WebContext | null = null;

export function webContext(): WebContext {
  if (context === null) context = createWebContext(process.env);
  return context;
}

// 部品を作る。DB を1つだけ開き（DD-01 2.1 M21 の接続はプロセスごとに1つ）、マイグレーションを当ててから
// （DD-03 5章）、端末の部品、配信元の鍵の部品、受け取りの部品、sharpen に返す読み取りも同じ接続を使う。
// 端末の API の入口と内容の状態と英語の教材も同じ接続を使う。
// 端末の API の入口と内容の状態と会話も同じ接続を使う。
// 失敗したら、ログに出せるときはログに出し（DD-06 E17 は致命的）、開いた DB を閉じて投げる。
export function createWebContext(
  env: Env,
  clock: Clock = systemClock,
): WebContext {
  const config = loadConfig(env);
  const logger = createLogger({ process: "web", clock, dir: config.logDir });
  let aiJobs: OpenedAiJobs | null = null;
  try {
    aiJobs = openAiJobs({ dataDir: config.dataDir, clock, startup: "migrate" });
    const { db } = aiJobs;
    const devices = createDevices({ db, clock });
    const senderKeys = createSenderKeys({ db, clock });
    const ingest = createIngest({ db, clock, logger });
    const englishForSender = createEnglishForSender({ db });
    const deviceApi = createDeviceApiContext({
      clock,
      logger,
      origin: config.origin,
      deviceKeys: createDeviceKeyVerifier({ db, clock }),
    });
    const contents = createContents({ db, clock });
    const news = createNewsView({ db });
    const english = createEnglishLearning({ db, clock });
    const chat = createChat({ db, clock });
    const home = createHomeView({ db, clock });
    const research = createResearchView({ db, clock });
    return {
      logger,
      devices,
      aiJobs,
      senderKeys,
      ingest,
      englishForSender,
      deviceApi,
      contents,
      news,
      english,
      chat,
      home,
      research,
      clock,
    };
  } catch (error) {
    aiJobs?.close();
    const code = error instanceof NexusError ? error.code : "INTERNAL";
    logger.log({
      level: error instanceof NexusError ? error.level : "error",
      code,
      detail: "Web サーバを起動できない",
      error,
    });
    throw error;
  }
}
