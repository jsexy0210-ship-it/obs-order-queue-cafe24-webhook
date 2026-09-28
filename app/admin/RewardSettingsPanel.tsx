"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_REWARD_SETTINGS,
  type RewardGradeSetting,
  type RewardSettings,
} from "@/lib/rewardSettings";
import styles from "./admin.module.css";

type ApiResponse = {
  settings: RewardSettings;
  integrationReady: boolean;
  oauth: {
    configured: boolean;
    connected: boolean;
    scopes: string[];
    shopNo: string | null;
  };
  executionMode: "test" | "live";
  executionAllowed: boolean;
  groupNameSync?: { updated: string[]; pending: string[] };
};

type Cafe24Group = { group_no: number | string; group_name: string };
type LedgerRow = {
  id: number;
  external_order_id: string;
  grade_id: string;
  action: "issue" | "recover";
  amount: number;
  processing_mode: "automatic" | "manual";
  status: "pending" | "succeeded" | "failed";
  created_at: string;
  error_message: string | null;
};

export default function RewardSettingsPanel() {
  const [settings, setSettings] = useState<RewardSettings>(DEFAULT_REWARD_SETTINGS);
  const [integrationReady, setIntegrationReady] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(false);
  const [executionMode, setExecutionMode] = useState<"test" | "live">("test");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Cafe24Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [recoveringOrderId, setRecoveringOrderId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/reward-settings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load failed");
        return response.json() as Promise<ApiResponse>;
      })
      .then((data) => {
        if (!active) return;
        setSettings(data.settings);
        setIntegrationReady(data.integrationReady);
        setOauthConfigured(data.oauth.configured);
        setOauthConnected(data.oauth.connected);
        setExecutionMode(data.executionMode);
      })
      .catch(() => {
        if (active) setError("적립금 설정을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function updateGrade(id: string, patch: Partial<RewardGradeSetting>) {
    setMessage(null);
    setSettings((current) => ({
      ...current,
      grades: current.grades.map((grade) => grade.id === id ? { ...grade, ...patch } : grade),
    }));
  }

  async function loadCafe24Groups() {
    setLoadingGroups(true);
    setError(null);
    try {
      const response = await fetch("/api/cafe24/groups", { cache: "no-store" });
      const data = await response.json() as { groups?: Cafe24Group[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "load failed");
      setGroups(data.groups ?? []);
      setMessage("카페24 회원등급 번호를 불러왔습니다. 각 행에서 해당 등급을 선택하세요.");
    } catch {
      setError("카페24 회원등급을 불러오지 못했습니다. OAuth 연결 상태를 확인하세요.");
    } finally {
      setLoadingGroups(false);
    }
  }

  async function loadLedger() {
    const response = await fetch("/api/reward-ledger", { cache: "no-store" });
    const data = await response.json() as { rows?: LedgerRow[] };
    if (response.ok) setLedger(data.rows ?? []);
  }

  async function manuallyRecover(orderId: string) {
    if (!window.confirm(`${orderId} 주문의 적립금을 실제 카페24에서 회수하시겠습니까?`)) return;
    setRecoveringOrderId(orderId);
    setError(null);
    try {
      const response = await fetch("/api/reward-ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await response.json() as { rows?: LedgerRow[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "recover failed");
      setLedger(data.rows ?? []);
      setMessage("적립금 회수 요청을 처리했습니다.");
    } catch {
      setError("적립금 회수에 실패했습니다. 원장 오류 내용을 확인하세요.");
      await loadLedger();
    } finally {
      setRecoveringOrderId(null);
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/reward-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json() as ApiResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "save failed");
      setSettings(data.settings);
      setIntegrationReady(data.integrationReady);
      setOauthConfigured(data.oauth.configured);
      setOauthConnected(data.oauth.connected);
      setExecutionMode(data.executionMode);
      if (data.groupNameSync?.pending.length) {
        setMessage(`적립금 정책을 저장했습니다. ${data.groupNameSync.pending.join(", ")} 등급명은 카페24 연결 후 반영됩니다.`);
      } else if (data.groupNameSync?.updated.length) {
        setMessage(`적립금 정책과 카페24 등급명(${data.groupNameSync.updated.join(", ")})을 저장했습니다.`);
      } else {
        setMessage("적립금 정책을 저장했습니다.");
      }
    } catch {
      setError("적립금 설정 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <section className={styles.rewardPanel}>적립금 설정을 불러오는 중입니다.</section>;
  }

  return (
    <section className={styles.rewardPanel} aria-labelledby="reward-settings-title">
      <div className={styles.rewardHeader}>
        <div>
          <h3 id="reward-settings-title">등급별 적립금 설정</h3>
          <p>카드·무통장 적립률과 취소/환불 회수 방식을 등급별로 관리합니다.</p>
        </div>
        <button
          type="button"
          className={`${styles.rewardMasterToggle} ${settings.enabled ? styles.rewardToggleOn : ""}`}
          aria-pressed={settings.enabled}
          onClick={() => {
            setMessage(null);
            setSettings((current) => ({ ...current, enabled: !current.enabled }));
          }}
        >
          적립금 설정 {settings.enabled ? "ON" : "OFF"}
        </button>
      </div>

      <div className={`${styles.executionMode} ${executionMode === "live" ? styles.executionModeLive : ""}`}>
        <strong>{executionMode === "live" ? "LIVE MODE" : "TEST MODE"}</strong>
        <span>
          {executionMode === "live"
            ? "운영 실행이 허용된 상태입니다."
            : "설정과 처리 결과만 검증하며 실제 적립금은 지급·회수하지 않습니다."}
        </span>
      </div>

      <div className={`${styles.integrationStatus} ${integrationReady ? styles.integrationReady : ""}`}>
        <span aria-hidden="true">{integrationReady ? "●" : "○"}</span>
        {oauthConnected
          ? "카페24 OAuth 연결이 완료되었습니다. 테스트 모드에서는 실거래가 발생하지 않습니다."
          : oauthConfigured
            ? "카페24 OAuth 연결이 필요합니다. 연결 후에도 테스트 모드에서는 실거래가 발생하지 않습니다."
            : "서버 OAuth 환경변수가 설정되지 않아 현재는 적립금 정책만 저장됩니다."}
      </div>

      <div className={styles.oauthActions}>
        {oauthConfigured ? (
          <a className={styles.oauthConnectButton} href="/api/cafe24/oauth/start">
            {oauthConnected ? "카페24 재연결" : "카페24 테스트 연결"}
          </a>
        ) : (
          <span>서버에 OAuth 환경변수를 등록한 뒤 연결할 수 있습니다.</span>
        )}
        {oauthConnected && (
          <button type="button" className={styles.groupLoadButton} onClick={loadCafe24Groups} disabled={loadingGroups}>
            {loadingGroups ? "등급 불러오는 중..." : "카페24 등급 불러오기"}
          </button>
        )}
      </div>

      <div className={styles.rewardNotice}>
        적립 기준은 결제완료 즉시가 기본입니다. 배송완료 후 지급으로 변경할 수 있으며, 전체 지급을 OFF로 바꾸면 신규 지급만 중단됩니다.
      </div>

      <label className={styles.rewardTrigger}>
        <span>적립 시점</span>
        <select
          value={settings.issueTrigger}
          onChange={(event) => setSettings((current) => ({
            ...current,
            issueTrigger: event.target.value === "paid" ? "paid" : "delivered",
          }))}
        >
          <option value="delivered">배송완료 후</option>
          <option value="paid">결제완료 즉시</option>
        </select>
      </label>

      <div className={styles.rewardTableWrap}>
        <table className={styles.rewardTable}>
          <thead>
            <tr>
              <th>등급명</th>
              <th>누적 구매금액 기준</th>
              <th>지급</th>
              <th>카드</th>
              <th>무통장</th>
              <th>취소·환불 회수</th>
              <th>카페24 등급번호</th>
            </tr>
          </thead>
          <tbody>
            {settings.grades.map((grade) => (
              <tr key={grade.id}>
                <td>
                  <input
                    className={styles.gradeNameInput}
                    aria-label={`${grade.name} 등급명`}
                    value={grade.name}
                    maxLength={20}
                    onChange={(event) => updateGrade(grade.id, { name: event.target.value })}
                  />
                </td>
                <td>
                  <label className={styles.thresholdInput}>
                    <input
                      aria-label={`${grade.name} 누적 구매금액 기준`}
                      type="number"
                      min="0"
                      step="10000"
                      value={grade.minimumPurchaseAmount ?? 0}
                      onChange={(event) => updateGrade(grade.id, {
                        minimumPurchaseAmount: Math.max(0, Number(event.target.value || 0)),
                      })}
                    />
                    <span>원 이상</span>
                  </label>
                </td>
                <td>
                  <button
                    type="button"
                    className={`${styles.gradeToggle} ${grade.enabled ? styles.gradeToggleOn : ""}`}
                    aria-label={`${grade.name} 적립금 지급`}
                    aria-pressed={grade.enabled}
                    onClick={() => updateGrade(grade.id, { enabled: !grade.enabled })}
                  >
                    {grade.enabled ? "ON" : "OFF"}
                  </button>
                </td>
                <td>
                  <label className={styles.rateInput}>
                    <input
                      aria-label={`${grade.name} 카드 적립률`}
                      type="number"
                      min="0"
                      max="20"
                      step="0.25"
                      value={grade.cardRate}
                      onChange={(event) => updateGrade(grade.id, { cardRate: Number(event.target.value) })}
                    />
                    <span>%</span>
                  </label>
                </td>
                <td>
                  <label className={styles.rateInput}>
                    <input
                      aria-label={`${grade.name} 무통장 적립률`}
                      type="number"
                      min="0"
                      max="20"
                      step="0.25"
                      value={grade.bankRate}
                      onChange={(event) => updateGrade(grade.id, { bankRate: Number(event.target.value) })}
                    />
                    <span>%</span>
                  </label>
                </td>
                <td>
                  <select
                    aria-label={`${grade.name} 취소 환불 회수 방식`}
                    value={grade.recoveryMode}
                    onChange={(event) => updateGrade(grade.id, {
                      recoveryMode: event.target.value === "automatic" ? "automatic" : "manual",
                    })}
                  >
                    <option value="manual">수동 회수</option>
                    <option value="automatic">자동 회수</option>
                  </select>
                </td>
                <td>
                  <select
                    className={styles.groupNoInput}
                    aria-label={`${grade.name} 카페24 등급번호`}
                    value={grade.cafe24GroupNo ?? ""}
                    onChange={(event) => updateGrade(grade.id, {
                      cafe24GroupNo: event.target.value.trim() || null,
                    })}
                  >
                    <option value="">{groups.length ? "선택" : "미연결"}</option>
                    {groups.map((group) => (
                      <option key={String(group.group_no)} value={String(group.group_no)}>
                        {group.group_name} ({group.group_no})
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.rewardFooter}>
        <div className={styles.rewardFeedback} aria-live="polite">
          {error && <span className={styles.rewardError}>{error}</span>}
          {!error && message && <span className={styles.rewardSuccess}>{message}</span>}
        </div>
        <button type="button" className={styles.rewardSaveButton} onClick={save} disabled={saving}>
          {saving ? "저장 중..." : "저장 및 반영"}
        </button>
      </div>

      <section className={styles.rewardLedger} aria-labelledby="reward-ledger-title">
        <div className={styles.rewardLedgerHeader}>
          <div>
            <h4 id="reward-ledger-title">적립금 처리 원장</h4>
            <p>자동 회수하지 않은 취소·환불 건은 여기서 확인 후 수동 회수합니다.</p>
          </div>
          <button type="button" onClick={() => void loadLedger()}>원장 새로고침</button>
        </div>
        {ledger.length === 0 ? (
          <p className={styles.ledgerEmpty}>표시할 적립금 처리 내역이 없습니다.</p>
        ) : (
          <div className={styles.rewardTableWrap}>
            <table className={styles.rewardTable}>
              <thead><tr><th>주문번호</th><th>등급</th><th>처리</th><th>적립금</th><th>상태</th><th>조치</th></tr></thead>
              <tbody>{ledger.map((row) => (
                <tr key={row.id}>
                  <td>{row.external_order_id}</td><td>{row.grade_id}</td><td>{row.action === "issue" ? "지급" : "회수"} · {row.processing_mode === "automatic" ? "자동" : "수동"}</td>
                  <td>{row.amount.toLocaleString("ko-KR")}원</td><td title={row.error_message ?? ""}>{row.status === "succeeded" ? "완료" : row.status === "failed" ? "실패" : "대기"}</td>
                  <td>{row.action === "issue" && row.status === "succeeded" && (
                    <button type="button" className={styles.manualRecoverButton} onClick={() => void manuallyRecover(row.external_order_id)} disabled={recoveringOrderId === row.external_order_id}>
                      {recoveringOrderId === row.external_order_id ? "처리 중..." : "수동 회수"}
                    </button>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
