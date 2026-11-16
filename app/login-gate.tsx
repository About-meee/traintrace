"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Workspace = {
  revision: number;
  draft: Record<string, unknown> | null;
  customExercises: Array<Record<string, unknown>>;
  updatedAt?: string | null;
};

type Bootstrap = {
  token: string;
  ownerKey: string;
  sessionEpoch?: string;
  expiresAt?: string;
  shell: string;
  workspace: Workspace;
  records: Array<Record<string, unknown>>;
};

declare global {
  interface Window {
    TRAINTRACE_BOOTSTRAP?: Bootstrap;
    TRAINTRACE_EXIT?: () => Promise<void>;
    TRAINTRACE_LOCK?: (reason?: string) => void;
    TRAINTRACE_SIGNOUT_HREF?: string;
  }
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clockParts(date: Date) {
  return {
    time: new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date),
    date: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}   ${new Intl.DateTimeFormat("en", { weekday: "short" }).format(date).toUpperCase()}`,
  };
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const result = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message =
      typeof result?.message === "string"
        ? result.message
        : typeof result?.error === "string"
          ? result.error
          : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return result as T;
}

export default function LoginGate({
  authenticated,
  signInHref,
  signOutHref,
}: {
  authenticated: boolean;
  signInHref: string;
  signOutHref: string;
}) {
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [noticeCanClose, setNoticeCanClose] = useState(false);
  const noticeCanCloseRef = useRef(false);
  const noticeDialogRef = useRef<HTMLDialogElement>(null);
  const handleLocked = useCallback((reason = "expired") => {
    document.documentElement.dataset.traintraceLocked = "false";
    setBootstrap(null);
    setError(reason === "replaced"
      ? "当前页面已被另一处登录接管，未同步草稿已保留在此设备。"
      : "登录状态已失效，请再次进入练迹；未同步草稿已保留在此设备。");
  }, []);

  useEffect(() => {
    if (noticeDismissed) return;
    const dialog = noticeDialogRef.current;
    if (!dialog) return;

    if (dialog.open) dialog.close();
    dialog.showModal();
    dialog.focus();

    let timer = 0;
    let firstFrame = 0;
    let secondFrame = 0;

    const clearWait = () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      timer = 0;
      firstFrame = 0;
      secondFrame = 0;
    };

    const waitUntilVisible = () => {
      clearWait();
      noticeCanCloseRef.current = false;
      setNoticeCanClose(false);
      if (document.visibilityState !== "visible") return;

      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          timer = window.setTimeout(() => {
            timer = 0;
            if (document.visibilityState === "visible") {
              noticeCanCloseRef.current = true;
              setNoticeCanClose(true);
            }
          }, 2_000);
        });
      });
    };

    document.addEventListener("visibilitychange", waitUntilVisible);
    waitUntilVisible();
    return () => {
      clearWait();
      document.removeEventListener("visibilitychange", waitUntilVisible);
    };
  }, [noticeDismissed]);

  useEffect(() => {
    if (noticeDismissed) {
      document.getElementById("chatgpt-login")?.focus();
    }
  }, [noticeDismissed]);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const lockReason = currentUrl.searchParams.get("session");
    if (lockReason === "replaced") {
      setError("当前页面已被另一处登录接管，未同步草稿已保留在此设备。");
    } else if (lockReason === "expired") {
      setError("登录状态已失效，请再次进入练迹；未同步草稿已保留在此设备。");
    }
    if (currentUrl.searchParams.has("session")) {
      currentUrl.searchParams.delete("session");
      window.history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    }
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    const onPageHide = () => {
      const active = window.TRAINTRACE_BOOTSTRAP;
      const token = active?.token;
      window.dispatchEvent(new Event("traintrace:lock-memory"));
      document.documentElement.dataset.traintraceLocked = "true";
      if (token) {
        void fetch("/api/session", {
          method: "DELETE",
          headers: { "X-Traintrace-Session": token },
          credentials: "same-origin",
          cache: "no-store",
          keepalive: true,
        });
      }
      if (active) active.token = "";
      window.TRAINTRACE_BOOTSTRAP = undefined;
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.replace("/");
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  async function enterTraining() {
    if (!noticeDismissed) return;
    setBusy(true);
    setError("");
    let token = "";
    try {
      const session = await jsonResponse<{
        token: string;
        ownerKey: string;
        expiresAt?: string;
      }>(
        await fetch("/api/session", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
        }),
      );
      token = session.token;
      if (!token || !session.ownerKey) {
        throw new Error("登录状态无效，请重新验证");
      }

      const sessionEpoch = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        const channel = new BroadcastChannel("traintrace-session-v1");
        channel.postMessage({ type: "takeover", ownerKey: session.ownerKey, sessionEpoch });
        channel.close();
      } catch {
        // The localStorage signal below covers browsers without BroadcastChannel.
      }
      try {
        localStorage.setItem(`traintrace:${session.ownerKey}:active-session-signal:v1`, sessionEpoch);
      } catch {
        // Server-side session fencing remains authoritative when storage is unavailable.
      }

      const headers = { "X-Traintrace-Session": token };
      const [workspace, records, shellResponse] = await Promise.all([
        fetch("/api/workspace", {
          headers,
          credentials: "same-origin",
          cache: "no-store",
        }).then(jsonResponse<Workspace>),
        fetch(`/api/records?date=${encodeURIComponent(localDateKey(new Date()))}`, {
          headers,
          credentials: "same-origin",
          cache: "no-store",
        }).then(jsonResponse<{ records: Array<Record<string, unknown>> }>),
        fetch("/api/ui-shell", {
          headers,
          credentials: "same-origin",
          cache: "no-store",
        }),
      ]);
      if (!shellResponse.ok) {
        throw new Error("无法载入训练页面，请重试");
      }
      const shell = await shellResponse.text();
      if (!shell.includes('id="app"') || shell.includes("api/records")) {
        throw new Error("训练页面校验失败");
      }

      setBootstrap({
        token,
        ownerKey: session.ownerKey,
        sessionEpoch,
        expiresAt: session.expiresAt,
        shell,
        workspace,
        records: Array.isArray(records.records) ? records.records : [],
      });
      setBusy(false);
    } catch (cause) {
      if (token) {
        void fetch("/api/session", {
          method: "DELETE",
          headers: { "X-Traintrace-Session": token },
          credentials: "same-origin",
          cache: "no-store",
          keepalive: true,
        });
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "暂时无法打开练迹，请检查连接后重试",
      );
      setBusy(false);
    }
  }

  const clock = clockParts(now);

  if (bootstrap) {
    return (
      <TrainingView
        bootstrap={bootstrap}
        signOutHref={signOutHref}
        onLocked={handleLocked}
      />
    );
  }

  function dismissExerciseNotice() {
    if (!noticeCanCloseRef.current) return;
    noticeDialogRef.current?.close();
    setNoticeDismissed(true);
  }

  return (
    <>
      <div className="atmosphere" aria-hidden="true" />
      <header className="site-bar" inert={!noticeDismissed}>
        <a className="brand" href="/" aria-label="练迹 TRAINTRACE 首页">
          <span className="brand-mark" aria-hidden="true">
            ＋
          </span>
          <span>
            练迹<small>TRAINTRACE</small>
          </span>
        </a>
      </header>
      <main id="app" tabIndex={-1} inert={!noticeDismissed}>
        <section className="view home-view" aria-labelledby="brand-title">
          <div className="home-scene">
            <div className="home-time" aria-label="本地时间">
              <strong>{clock.time}</strong>
              <span>{clock.date}</span>
            </div>
            <div className="scene-title">
              <span className="corner corner-tl" aria-hidden="true" />
              <span className="corner corner-br" aria-hidden="true" />
              <h1 id="brand-title">练迹</h1>
              <small lang="en">TRAINTRACE</small>
            </div>
            <div className="scene-crosshair" aria-hidden="true" />
            <svg className="scene-path" viewBox="0 0 520 220" aria-hidden="true">
              <path d="M0 181 C 82 160, 91 112, 158 126 S 245 199, 292 148 S 370 60, 520 43" />
            </svg>
            <div className="home-actions">
              {authenticated ? (
                <button
                  className="feature-link"
                  id="chatgpt-login"
                  type="button"
                  onClick={enterTraining}
                  disabled={busy || !noticeDismissed}
                  aria-describedby="login-message"
                >
                  <span className="feature-icon" aria-hidden="true">
                    <svg viewBox="0 0 28 28">
                      <rect x="5" y="12" width="18" height="13" rx="1" />
                      <path d="M9 12V8a5 5 0 0 1 10 0v4m-5 5v3" />
                    </svg>
                  </span>
                  <span>
                    {busy ? "正在打开练迹…" : "进入练迹"}
                    <small lang="en">{busy ? "LOADING" : "OPEN TRAINTRACE"}</small>
                  </span>
                  <b aria-hidden="true">→</b>
                </button>
              ) : (
                <a
                  className="feature-link feature-link-anchor"
                  id="chatgpt-login"
                  href={noticeDismissed ? signInHref : undefined}
                  target="_top"
                  rel="nofollow"
                  aria-describedby="login-message"
                >
                  <span className="feature-icon" aria-hidden="true">
                    <svg viewBox="0 0 28 28">
                      <rect x="5" y="12" width="18" height="13" rx="1" />
                      <path d="M9 12V8a5 5 0 0 1 10 0v4m-5 5v3" />
                    </svg>
                  </span>
                  <span>
                    使用 ChatGPT 登录<small lang="en">SIGN IN WITH CHATGPT</small>
                  </span>
                  <b aria-hidden="true">→</b>
                </a>
              )}
              <p className="login-message" role="status" aria-live="polite">
                {error || "使用 ChatGPT 账号验证后，记录只对本人开放。"}
              </p>
              <p id="login-message" className="home-tagline">
                <span>每一次训练，都有迹可循。</span>
                <small lang="en">PERSONAL TRAINING JOURNAL</small>
              </p>
            </div>
          </div>
          <div className="home-foot mono">LOCAL TIME&nbsp; · &nbsp;PRIVATE LOG</div>
        </section>
      </main>
      <dialog
        className="modal confirm-modal"
        id="exercise-notice"
        ref={noticeDialogRef}
        open={!noticeDismissed}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="exercise-notice-title"
        aria-describedby="exercise-notice-copy"
        onCancel={(event) => event.preventDefault()}
      >
        <div className="modal-scrim" aria-hidden="true" />
        <section className="confirm-panel">
          <span className="confirm-mark" aria-hidden="true">i</span>
          <h2 id="exercise-notice-title">动作图说明</h2>
          <p id="exercise-notice-copy">
            动作图仅用于展示动画效果，并非真实训练动作的指导。相关训练请遵循专业人士的指导。
          </p>
          <div className="confirm-actions">
            <button
              className="primary-button"
              id="exercise-notice-dismiss"
              type="button"
              onClick={dismissExerciseNotice}
              disabled={!noticeCanClose}
            >
              {noticeCanClose ? "我已了解" : "请阅读提示"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      </dialog>
    </>
  );
}

function TrainingView({
  bootstrap,
  signOutHref,
  onLocked,
}: {
  bootstrap: Bootstrap;
  signOutHref: string;
  onLocked: (reason?: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    const token = bootstrap.token;
    const lockHandler = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      window.TRAINTRACE_LOCK?.(reason);
    };

    async function mountTraining() {
      const html = bootstrap.shell;
      if (!html.includes('id="app"')) throw new Error("训练页面格式无效");

      if (cancelled || !mountRef.current) return;
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const appShell = document.createElement("div");
      appShell.id = "traintrace-private-app";
      appShell.replaceChildren(...Array.from(parsed.body.childNodes));
      mountRef.current.replaceChildren(appShell);

      window.TRAINTRACE_BOOTSTRAP = bootstrap;
      window.TRAINTRACE_SIGNOUT_HREF = signOutHref;
      window.TRAINTRACE_LOCK = (reason = "expired") => {
        if (cancelled) return;
        cancelled = true;
        window.dispatchEvent(new Event("traintrace:lock-memory"));
        const active = window.TRAINTRACE_BOOTSTRAP;
        if (active) active.token = "";
        window.TRAINTRACE_BOOTSTRAP = undefined;
        document.documentElement.dataset.traintraceLocked = "true";
        window.location.replace(`/?session=${reason === "replaced" ? "replaced" : "expired"}`);
      };
      window.addEventListener("traintrace:lock", lockHandler, { once: true });

      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.type = "module";
        script.src = "/app.js";
        script.dataset.traintraceApp = "true";
        script.onload = () => resolve();
        script.onerror = () => {
          script.remove();
          reject(new Error("无法载入训练页面脚本，请重试"));
        };
        document.body.appendChild(script);
      });
      loaded = true;
      document.documentElement.dataset.traintraceLocked = "false";
    }

    void mountTraining().catch((cause) => {
      if (!cancelled) {
        onLocked("expired");
        console.error(
          "Could not load TRAINTRACE:",
          cause instanceof Error ? cause.message : "unknown error",
        );
      }
    });

    return () => {
      cancelled = true;
      window.removeEventListener("traintrace:lock", lockHandler);
      window.TRAINTRACE_LOCK = undefined;
      window.TRAINTRACE_SIGNOUT_HREF = undefined;
      if (!loaded) window.TRAINTRACE_BOOTSTRAP = undefined;
    };
  }, [bootstrap, onLocked, signOutHref]);

  return (
    <main id="traintrace-mounted" aria-live="polite">
      <div ref={mountRef}>
        <p className="traintrace-loading">正在打开个人训练记录…</p>
      </div>
    </main>
  );
}
