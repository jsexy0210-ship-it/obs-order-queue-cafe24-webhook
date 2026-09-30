"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_REWARD_SETTINGS,
  type RewardGradeSetting,
  type RewardSettings,
} from "@/lib/rewardSettings";
import GlobalLoadingOverlay from "@/app/GlobalLoadingOverlay";
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
  nativeRewardsDisabled: boolean;
  groupNameSync?: { updated: string[]; pending: string[] };
};

type Cafe24Group = { group_no: number | string; group_name: string };
const formatAmount = (value: number) => value.toLocaleString("ko-KR");

export default function RewardSettingsPanel() {
  const [settings, setSettings] = useState<RewardSettings>(DEFAULT_REWARD_SETTINGS);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Cafe24Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

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
        setOauthConfigured(data.oauth.configured);
        setOauthConnected(data.oauth.connected);
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

  useEffect(() => {
    if (!oauthConnected) return;
    let active = true;
    fetch("/api/cafe24/groups", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load failed");
        return response.json() as Promise<{ groups?: Cafe24Group[] }>;
      })
      .then((data) => {
        if (active) setGroups(data.groups ?? []);
      })
      .catch(() => {
        if (active) setError("카페24 등급 목록을 불러오지 못했습니다. 저장된 등급번호는 유지됩니다.");
      });
    return () => { active = false; };
  }, [oauthConnected]);

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
      const data = await response.json() as ApiResponse & {
        error?: string;
        cafe24AutoUpdateSync?: { updated: boolean; pending: boolean };
      };
      if (!response.ok) throw new Error(data.error ?? "save failed");
      setSettings(data.settings);
      setOauthConfigured(data.oauth.configured);
      setOauthConnected(data.oauth.connected);
      if (data.cafe24AutoUpdateSync?.pending) {
        setMessage("적립금 정책은 저장됐습니다. 카페24 재연결 후 회원등급 자동변경 기준을 반영합니다.");
      } else if (data.groupNameSync?.pending.length) {
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
    return <GlobalLoadingOverlay />;
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

      <div className={styles.oauthActions}>
        {oauthConfigured ? (
          <a className={styles.oauthConnectButton} href="/api/cafe24/oauth/start">
            {oauthConnected ? "카페24 재연결" : "카페24 연결"}
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
                      type="text"
                      inputMode="numeric"
                      value={formatAmount(grade.minimumPurchaseAmount ?? 0)}
                      onChange={(event) => updateGrade(grade.id, {
                        minimumPurchaseAmount: Math.min(Number.MAX_SAFE_INTEGER, Number(event.target.value.replace(/[^0-9]/g, "") || 0)),
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
                    {grade.cafe24GroupNo && !groups.some((group) => String(group.group_no) === grade.cafe24GroupNo) && (
                      <option value={grade.cafe24GroupNo}>저장된 등급번호 ({grade.cafe24GroupNo})</option>
                    )}
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
        <button type="button" className={styles.rewardSaveButton} onClick={() => setConfirmSave(true)} disabled={saving}>
          {saving ? "저장 중..." : "저장 및 반영"}
        </button>
      </div>

      {confirmSave && (
        <div className={styles.bonusConfirmBackdrop} role="presentation">
          <section
            className={styles.bonusConfirmDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reward-save-confirm-title"
            aria-describedby="reward-save-confirm-description"
          >
            <p className={styles.bonusConfirmEyebrow}>저장 전 최종 확인</p>
            <h3 id="reward-save-confirm-title">적립금 설정을 저장 및 반영하시겠습니까?</h3>
            <p className={styles.bonusConfirmAmount}>
              전체 설정 {settings.enabled ? "ON" : "OFF"} · 적립 시점 {settings.issueTrigger === "paid" ? "결제완료 즉시" : "배송완료 후"} · 카페24 등급번호 {settings.grades.filter((grade) => grade.cafe24GroupNo).length}개
            </p>
            <div id="reward-save-confirm-description" className={styles.bonusConfirmWarning}>
              <strong>카페24 자체 적립이 켜져 있으면 이중 지급 위험이 있습니다.</strong>
              <span>운영 안전 검증을 마치기 전에는 주문 자동 적립금 실지급이 차단됩니다.</span>
            </div>
            <div className={styles.bonusConfirmActions}>
              <button type="button" onClick={() => setConfirmSave(false)}>취소</button>
              <button type="button" className={styles.bonusConfirmProceed} onClick={() => { setConfirmSave(false); void save(); }}>저장 및 반영</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
