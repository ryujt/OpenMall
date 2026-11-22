import { pruneDisplayHistory } from "../display-history";
import React, { useState } from "react";
import { input, date, now } from "./shared";

export const roles = {
  product: "상품 담당자",
  stock: "재고 담당자",
  warehouse: "물류 담당자",
  care: "상담 담당자",
  finance: "재무 담당자",
  access: "권한 관리자",
};
export const credentialsKey = "openmall.ops.session";
export function signedIn() {
  try {
    const value = JSON.parse(sessionStorage.getItem(credentialsKey));
    return value && value.expires > Date.now() ? value : null;
  } catch {
    return null;
  }
}
export function record(db, actor, action, ref, reason) {
  return {
    ...db,
    opsAudit: [
      { id: crypto.randomUUID(), at: now(), actor, action, ref, reason },
      ...(db.opsAudit || []),
    ],
  };
}
export function Audit({ db, role }) {
  const rows = (db.opsAudit || []).filter(
    (row) => role === "access" || row.actor.startsWith(roles[role]),
  );
  return (
    <details className="ops-box">
      <summary>업무 처리 이력 ({rows.length})</summary>
      {rows.length ? (
        <ol className="ops-log">
          {rows.map((row) => (
            <li key={row.id}>
              <strong>{row.action}</strong> · {row.ref}
              <br />
              {row.reason}
              <small>
                {date(row.at)} · {row.actor}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p>저장된 작업이 없습니다.</p>
      )}
    </details>
  );
}
export function Gate({ login }) {
  const [role, setRole] = useState("product"),
    [staff, setStaff] = useState("A"),
    [challenge, setChallenge] = useState(""),
    [error, setError] = useState("");
  return (
    <section className="ops-box ops-auth">
      <h2>운영 계정 인증</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!challenge) {
            setError("");
            setChallenge(
              String(
                (crypto.getRandomValues(new Uint32Array(1))[0] % 900000) +
                  100000,
              ),
            );
            return;
          }
          if (input(e.currentTarget).code !== challenge) {
            setError("인증번호를 확인해 주세요.");
            return;
          }
          login(role, staff);
        }}
      >
        <label>
          담당 업무
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setChallenge("");
              setError("");
            }}
          >
            {Object.entries(roles).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          담당자 계정
          <select
            value={staff}
            onChange={(e) => {
              setStaff(e.target.value);
              setChallenge("");
              setError("");
            }}
          >
            <option value="A">김하늘 · A</option>
            <option value="B">이유진 · B</option>
          </select>
        </label>
        {challenge && (
          <>
            <p>
              시험 인증앱 번호 <strong>{challenge}</strong>
            </p>
            <label>
              2차 인증번호
              <input
                inputMode="numeric"
                pattern="[0-9]{6}"
                name="code"
                autoComplete="off"
                required
              />
            </label>
          </>
        )}
        <button className="primary">
          {challenge ? "인증하고 입장" : "인증번호 받기"}
        </button>
        <p role="alert">{error}</p>
      </form>
    </section>
  );
}
export function AccessOps({ db, run }) {
  const reference = db.clock || now();
  function purge(e) {
    e.preventDefault();
    run("access", "보존 만료 정리", "거래기록", "보존 근거 만료 확인", (d) => {
      const cutoff = new Date(d.clock || Date.now());
      const withdrawal = new Set(d.withdrawn || []);
      function expired(at, years) {
        if (!at) return false;
        const until = new Date(at);
        until.setUTCFullYear(until.getUTCFullYear() + years);
        return until <= cutoff;
      }
      const cleared = [],
        orders = d.orders.flatMap((o) => {
          if (!withdrawal.has(o.memberId)) return [o];
          const recent = [
            o.date,
            ...(o.history || []).map((e) => e.at),
            ...(o.claims || []).flatMap((c) =>
              (c.history || []).map((e) => e.at),
            ),
          ]
            .filter(Boolean)
            .sort()
            .at(-1);
          const inquiries = (o.inquiries || []).filter(
            (q) => !expired(q.repliedAt || q.createdAt, 3),
          );
          if (expired(recent, 5) && inquiries.length === 0) {
            cleared.push(o.id);
            return [];
          }
          return [{ ...o, inquiries }];
        });
      return {
        ...pruneDisplayHistory(d, cutoff),
        orders,
        recordAccess: (d.recordAccess || []).filter(
          (r) => !cleared.includes(r.orderId),
        ),
        purgedCount: (d.purgedCount || 0) + cleared.length,
      };
    });
  }
  return (
    <>
      <section className="ops-box">
        <h2>담당자 권한</h2>
        {Object.entries(roles)
          .filter(([k]) => k !== "access")
          .flatMap(([role, label]) =>
            ["A", "B"].map((staff) => [
              role + "." + staff,
              label + " · " + staff,
            ]),
          )
          .map(([id, name]) => (
            <div className="ops-heading" key={id}>
              <span>
                {name} · {db.revokedRoles?.[id] ? "회수됨" : "허용"}
              </span>
              <button
                onClick={() =>
                  run(
                    "access",
                    "업무 권한 변경",
                    name,
                    db.revokedRoles?.[id] ? "권한 복구" : "권한 회수",
                    (d) => ({
                      ...d,
                      revokedRoles: {
                        ...d.revokedRoles,
                        [id]: !d.revokedRoles?.[id],
                      },
                    }),
                  )
                }
              >
                {db.revokedRoles?.[id] ? "권한 복구" : "권한 회수"}
              </button>
            </div>
          ))}
      </section>
      <details className="ops-box">
        <summary>거래기록 보존·만료</summary>
        <p>
          탈퇴 회원 기록{" "}
          {db.orders.filter((o) => db.withdrawn?.includes(o.memberId)).length}건
          · 거래기록 파기 누계 {db.purgedCount || 0}건 · 사본 교부 기록{" "}
          {db.recordAccess?.length || 0}건
        </p>
        <p>
          거래·공급 기록 5년, 소비자 문의 3년. 마지막 처리일을 기준으로 보존
          기간을 계산합니다.
        </p>
        <p>
          이전 표시·광고 노출본은 노출 종료일부터 6개월 동안 보관합니다. 보관 중{" "}
          {(db.displayHistory || []).length}건 · 만료 정리 대상{" "}
          {
            (db.displayHistory || []).filter(
              (r) => Date.parse(r.expiresAt) <= Date.parse(reference),
            ).length
          }
          건 · 파기 누계 {db.purgedDisplays || 0}건
        </p>
        <form onSubmit={purge}>
          <button>만료 기록 정리</button>
        </form>
      </details>
      <details className="ops-box">
        <summary>검토 도구 · 업무 시계와 초기화</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = input(e.currentTarget);
            run(
              "access",
              "업무 시계 설정",
              "시험 달력",
              "시간 및 휴무일 반영",
              (d) => ({
                ...d,
                clock: f.clock
                  ? new Date(f.clock + "+09:00").toISOString()
                  : null,
                holidays: f.holidays
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }),
            );
          }}
        >
          <p>현재 업무 시각 {date(reference)}</p>
          <label>
            시험 시각 (한국 시간)
            <input type="datetime-local" name="clock" />
          </label>
          <label>
            추가 휴무일 (쉼표로 구분)
            <input
              name="holidays"
              placeholder="2026-12-25"
              defaultValue={(db.holidays || []).join(",")}
            />
          </label>
          <button>시계·달력 적용</button>
        </form>
      </details>
    </>
  );
}
