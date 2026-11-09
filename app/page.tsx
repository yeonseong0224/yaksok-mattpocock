import { Card, CardText, CardTitle, PageShell } from "./_components/ui";
import { CreatePromiseButton } from "./create-promise-button";

export default function Home() {
  return (
    <PageShell>
      <Card>
        <CardTitle>링크 하나로 약속 잡기</CardTitle>
        <CardText>
          초대 링크를 만들어 단톡방에 공유하세요. 모두가 가능한 시간을 고르면 겹치는 시간을
          찾아드려요.
        </CardText>
        <div className="mt-6">
          <CreatePromiseButton />
        </div>
      </Card>
    </PageShell>
  );
}
