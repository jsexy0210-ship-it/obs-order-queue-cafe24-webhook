"use client";

import { FormEvent, useState } from "react";
import GlobalLoadingOverlay from "@/app/GlobalLoadingOverlay";
import styles from "../admin.module.css";

export default function AdminLoginPage() {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "아이디 또는 비밀번호가 올바르지 않습니다.");
        return;
      }

      window.location.href = "/admin";
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={`${styles.page} ${styles.loginPage}`}>
      {loading && <GlobalLoadingOverlay />}
      <div className={styles.loginBox}>
        <div className={styles.loginBrandMark} aria-hidden="true">M</div>
        <div className={styles.loginEyebrow}>MANGO TCG · LIVE OPERATIONS</div>
        <h1>관리자 로그인</h1>
        <p className={styles.loginDescription}>
          실시간 주문과 카드브레이크 방송을 관리하세요.
        </p>
        <form className={styles.loginForm} onSubmit={handleSubmit}>
          <label className={styles.loginField} htmlFor="admin-username">
            <span>아이디</span>
            <input
              id="admin-username"
              name="username"
              type="text"
              placeholder="관리자 아이디"
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>
          <label className={styles.loginField} htmlFor="admin-password">
            <span>비밀번호</span>
            <input
              id="admin-password"
              name="password"
              type="password"
              placeholder="관리자 비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? "확인 중..." : "로그인"}
          </button>
        </form>
        {error && <p className={styles.loginError}>{error}</p>}
        <p className={styles.loginSecurity}>승인된 관리자 계정만 접근할 수 있습니다.</p>
      </div>
    </main>
  );
}
