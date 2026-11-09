import { PageShell } from "@/app/_components/ui";
import { LinkEntry } from "./link-entry";

// 초대 링크 진입 페이지. 링크 상태에 따라 다른 화면을 보여준다(스펙 「화면」).
export default async function InvitePage({ params }: PageProps<"/i/[inviteToken]">) {
  const { inviteToken } = await params;
  return (
    <PageShell>
      <LinkEntry inviteToken={inviteToken} />
    </PageShell>
  );
}
