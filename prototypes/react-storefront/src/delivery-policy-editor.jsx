import React from "react";
import { shippingPolicy } from "./delivery-policy";
import { archiveDisplay } from "./display-history";
const prefixList = (value) => [
  ...new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

export function DeliveryPolicyEditor({ db, run }) {
  const policy = shippingPolicy(db);
  return (
    <details className="ops-box">
      <summary>배송 권역·운임 정책 v{policy.version}</summary>
      <form
        key={policy.version}
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          run(
            "warehouse",
            "배송 정책 변경",
            "배송 정책",
            f.reason,
            (current) => {
              const before = shippingPolicy(current);
              if (before.version !== policy.version)
                throw Error(
                  "다른 담당자가 먼저 변경했습니다. 최신 정책을 확인하세요.",
                );
              const next = {
                version: before.version + 1,
                baseFare: Number(f.baseFare),
                islandFare: Number(f.islandFare),
                islandPrefixes: prefixList(f.islands),
                blockedPrefixes: prefixList(f.blocked),
                cutoff: f.cutoff,
              };
              if (next.islandFare < next.baseFare)
                throw Error(
                  "도서산간 운임은 일반 운임 이상으로 입력해 주세요.",
                );
              if (
                [...next.islandPrefixes, ...next.blockedPrefixes].some(
                  (p) => !/^\d{1,5}$/.test(p),
                )
              )
                throw Error("우편번호 앞자리를 숫자 1~5자리로 입력해 주세요.");
              const at = current.clock || new Date().toISOString();
              let archived = current;
              for (const p of current.products.filter(
                (p) => p.active !== false,
              ))
                archived = archiveDisplay(archived, p, at, before);
              return { ...archived, shippingPolicy: next };
            },
          );
        }}
      >
        <p>
          저장 후 새 견적에 적용됩니다. 배송 불가 우편번호가 먼저 적용됩니다.
        </p>
        {[
          ["baseFare", "일반 운임(원)", policy.baseFare],
          ["islandFare", "도서산간 운임(원)", policy.islandFare],
        ].map(([name, label, v]) => (
          <label key={name}>
            {label}
            <input
              type="number"
              min={0}
              max={1000000}
              required
              name={name}
              defaultValue={v}
            />
          </label>
        ))}
        <label>
          도서산간 우편번호 앞자리 (쉼표 구분)
          <input
            name="islands"
            defaultValue={policy.islandPrefixes.join(",")}
          />
        </label>
        <label>
          배송 불가 우편번호 앞자리 (쉼표 구분)
          <input
            name="blocked"
            defaultValue={policy.blockedPrefixes.join(",")}
          />
        </label>
        <label>
          택배 마감 시각 (한국 시간)
          <input
            name="cutoff"
            type="time"
            required
            defaultValue={policy.cutoff}
          />
        </label>
        <label>
          변경 사유
          <input name="reason" required pattern=".*\S.*" />
        </label>
        <button>새 배송 정책 적용</button>
      </form>
    </details>
  );
}
