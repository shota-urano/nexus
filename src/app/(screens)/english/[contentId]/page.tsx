import { EnglishStudyScreen } from "../../../../screens/english/english-study-screen";
import { ENGLISH_MESSAGES } from "../../../../screens/english/messages";
import { EmptyState } from "../../../../ui/empty-state";
import { TopBar } from "../../_frame/top-bar";

// SCR-005 英語の学習の道 `/english/{contentId}`（DD-01 M01）。中身は M04 に任せる。
// 内容ID（`openapi.yaml` の `Id`。1 以上の整数）として読めなければ、教材が無いときと同じく
// MSG-019 を出す（BD-03 4章 URL の直接入力）。

const ID_PATTERN = /^[1-9][0-9]*$/;

export default async function EnglishStudyRoute({
  params,
}: {
  params: Promise<{ contentId: string }>;
}) {
  const { contentId } = await params;
  const id = ID_PATTERN.test(contentId) ? Number(contentId) : NaN;
  return (
    <main>
      <TopBar title="English" />
      {Number.isSafeInteger(id) ? (
        <EnglishStudyScreen contentId={id} />
      ) : (
        <EmptyState message={ENGLISH_MESSAGES["MSG-019"]} />
      )}
    </main>
  );
}
