import React, { useEffect, useState } from "react";
import { initial, restore, go } from "./model";
import { CatalogOps } from "./ops/catalog";
import { ShippingOps } from "./ops/shipping";
import { CaseRow, Inquiries, Notifications } from "./ops/cases";
import { Settlement, Exceptions } from "./ops/finance";
import {
  roles,
  credentialsKey,
  signedIn,
  record,
  Gate,
  Audit,
  AccessOps,
} from "./ops/access";

import "./ops.css";
const routes = {
  catalog: "상품·재고 관리",
  shipments: "출고 관리",
  claims: "고객상담·환불",
};
const rights = {
  catalog: ["product", "stock"],
  shipments: ["warehouse"],
  claims: ["care", "finance"],
};
export function Admin({ page, db, update }) {
  const [actor, setActor] = useState(signedIn),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("cases");
  const role = actor?.role;
  function login(role, staff) {
    const session = { role, staff, expires: Date.now() + 30 * 60000 };
    sessionStorage.setItem(credentialsKey, JSON.stringify(session));
    setActor(session);
    setMessage("");
    if (role !== "access") {
      const first = Object.keys(rights).find((p) => rights[p].includes(role));
      if (!rights[page]?.includes(role)) go("/admin/" + first);
    }
  }
  const staffName = role
    ? roles[role] + " · " + (actor.staff || "A")
    : "인증 만료";
  function revoked(current, session) {
    return (
      current.revokedRoles?.[session.role] ||
      current.revokedRoles?.[session.role + "." + (session.staff || "A")]
    );
  }
  function logout() {
    sessionStorage.removeItem(credentialsKey);
    setActor(null);
    setMessage("");
  }
  useEffect(() => {
    if (!actor) return;
    const handle = setTimeout(logout, Math.max(0, actor.expires - Date.now()));
    return () => clearTimeout(handle);
  }, [actor]);
  async function run(needed, action, ref, reason, mutate, done, more) {
    try {
      const current = restore();
      const valid = signedIn();
      if (!valid || valid.role !== needed || revoked(current, valid)) {
        await update(
          record(
            current,
            staffName,
            "실행 거절",
            ref,
            action + " · 업무 권한 재확인",
          ),
        );
        throw Error(
          "업무 권한 또는 인증이 만료되었습니다. 담당 계정을 다시 확인하세요.",
        );
      }
      const next = mutate(current);
      if (next !== current)
        await update(
          record(
            next,
            staffName,
            action,
            ref,
            [reason, more].filter(Boolean).join(" · "),
          ),
        );
      setMessage(action + " · " + ref);
      done?.();
    } catch (error) {
      setMessage(error.message);
    }
  }
  const allowed =
    roles[role] && !revoked(db, actor) && rights[page]?.includes(role);
  return (
    <div className="ops">
      <div className="ops-heading">
        <div>
          <small>OPENMALL OPERATIONS</small>
          <h1>{role === "access" ? "운영 권한·보존 관리" : routes[page]}</h1>
        </div>
        {role && <button onClick={logout}>{staffName} · 계정 전환</button>}
      </div>
      {!actor ? (
        <Gate login={login} />
      ) : (
        <>
          <nav className="tabs">
            {Object.entries(routes).map(([r, title]) => (
              <a
                key={r}
                aria-current={page === r ? "page" : undefined}
                href={"#/admin/" + r}
              >
                {title}
              </a>
            ))}
          </nav>
          <p className="ops-message" role="status">
            {message}
          </p>
          {role === "access" ? (
            <AccessOps db={db} run={run} />
          ) : !allowed ? (
            <section className="ops-box">
              <h2>업무 권한이 필요합니다</h2>
              <p>이 메뉴 담당 계정으로 인증해 주세요.</p>
              <button onClick={logout}>운영 계정 선택</button>
            </section>
          ) : page === "catalog" ? (
            <CatalogOps db={db} role={role} run={run} />
          ) : page === "shipments" ? (
            <ShippingOps db={db} run={run} />
          ) : (
            <>
              <div className="actions">
                {[
                  ["cases", "신청 처리"],
                  ["exceptions", "운영 예외"],
                  ...(role === "care"
                    ? [
                        ["inquiries", "고객 문의"],
                        ["notifications", "발송 확인"],
                      ]
                    : [["settlement", "정산 대사"]]),
                ].map(([id, t]) => (
                  <button
                    key={id}
                    aria-pressed={tab === id}
                    onClick={() => setTab(id)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {tab === "cases" ? (
                <>
                  <h2>품목별 신청 내역</h2>
                  {db.orders.every((o) => !o.claims?.length) && (
                    <p className="ops-box">접수된 신청이 없습니다.</p>
                  )}
                  {db.orders.flatMap((o) =>
                    (o.claims || []).map((c) => (
                      <CaseRow key={c.id} o={o} c={c} role={role} run={run} />
                    )),
                  )}
                </>
              ) : tab === "exceptions" ? (
                <Exceptions db={db} role={role} run={run} />
              ) : tab === "inquiries" && role === "care" ? (
                <Inquiries db={db} run={run} />
              ) : tab === "notifications" && role === "care" ? (
                <Notifications db={db} run={run} />
              ) : role === "finance" ? (
                <Settlement db={db} run={run} />
              ) : null}
            </>
          )}
          {(allowed || role === "access") && <Audit db={db} role={role} />}
        </>
      )}
      <details className="ops-tools">
        <summary>체험 데이터 관리</summary>
        <p>현재 브라우저에 저장된 모든 주문과 운영 이력을 초기화합니다.</p>
        <button
          onClick={async () => {
            if (confirm("모든 OpenMall 체험 데이터를 초기화할까요?")) {
              try {
                await update({ ...initial(), revision: restore().revision });
                logout();
                go("/");
              } catch (error) {
                setMessage(error.message);
              }
            }
          }}
        >
          체험 데이터 초기화
        </button>
      </details>
    </div>
  );
}
