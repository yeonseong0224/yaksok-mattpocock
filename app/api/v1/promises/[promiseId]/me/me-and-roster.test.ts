import { describe, expect, it } from "vitest";
import { createTestClient } from "@/test/http";
import { cancelParticipant, passDeadline } from "@/test/db";
import {
  createCollectingPromise,
  createDraftPromise,
  getMe,
  getPromise,
  getRoster,
  registerParticipant,
} from "@/test/flows";

// MEMBER-API-05 내 정보, MEMBER-API-06 참여자 명단

const KST_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/;

describe("내 정보", () => {
  it("방장은 약속을 관리할 수 있고, 모집 중에는 가능 시간을 입력할 수 있다", async () => {
    const host = createTestClient();
    const { promiseId } = await createCollectingPromise(host);

    const res = await getMe(host, promiseId);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toMatchObject({
      nickname: "승주",
      role: "host",
      status: "active",
      availabilitySubmittedAt: null,
      promiseStatus: "collecting",
      deadlinePassed: false,
      permissions: {
        canEditAvailability: true,
        canSubmit: true,
        canManagePromise: true,
        canLeave: true,
      },
    });
    expect(body.sessionExpiresAt).toMatch(KST_ISO);
  });

  it("멤버는 약속을 관리할 수 없고, 마감이 지나면 가능 시간을 고칠 수 없다", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    const member = createTestClient();
    await registerParticipant(member, promiseId);
    await passDeadline(promiseId);

    const res = await getMe(member, promiseId);

    expect(res.body).toMatchObject({
      role: "member",
      promiseStatus: "closed",
      deadlinePassed: true,
      permissions: { canEditAvailability: false, canSubmit: false, canManagePromise: false },
    });
  });

  it("로그인하지 않으면 401이고, 약속 상태만 볼 수 있다", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    const stranger = createTestClient();

    const me = await getMe(stranger, promiseId);
    const promise = await getPromise(stranger, promiseId);

    expect(me.status).toBe(401);
    expect(promise.body).toEqual({ promiseId, promiseStatus: "collecting" });
  });
});

describe("참여자 명단", () => {
  it("등록순으로 active 참여자의 닉네임, 방장 표시, 내 표시를 보여준다", async () => {
    const host = createTestClient();
    const { promiseId } = await createCollectingPromise(host);
    const hyeseung = createTestClient();
    await registerParticipant(hyeseung, promiseId, { nickname: "혜승", pin: "1357" });
    await registerParticipant(createTestClient(), promiseId, { nickname: "철수", pin: "2468" });
    await registerParticipant(createTestClient(), promiseId, { nickname: "탈퇴자", pin: "1111" });
    await cancelParticipant(promiseId, "탈퇴자");

    const res = await getRoster(hyeseung, promiseId);

    expect(res.status).toBe(200);
    const body = res.body as {
      participantLimit: number;
      currentParticipantCount: number;
      participants: { nickname: string; role: string; isMe: boolean }[];
    };
    expect(body.participantLimit).toBe(4);
    expect(body.currentParticipantCount).toBe(3);
    expect(body.participants.map(({ nickname, role, isMe }) => ({ nickname, role, isMe }))).toEqual(
      [
        { nickname: "승주", role: "host", isMe: false },
        { nickname: "혜승", role: "member", isMe: true },
        { nickname: "철수", role: "member", isMe: false },
      ],
    );
    // 제출 여부는 명단에 없다(MEMBER-08-02).
    expect(JSON.stringify(body)).not.toContain("availability");
  });

  it("등록하지 않은 사람은 명단을 볼 수 없다(401)", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());

    const res = await getRoster(createTestClient(), promiseId);

    expect(res.status).toBe(401);
  });

  it("설정 중(draft)에는 방장만 명단을 본다", async () => {
    const host = createTestClient();
    const { promiseId } = await createDraftPromise(host);

    const res = await getRoster(host, promiseId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentParticipantCount: 1 });
  });
});
