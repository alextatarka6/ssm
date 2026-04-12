import { useEffect, useMemo, useState } from "react";
import {
  createUser,
  getAssetCandles,
  getAssets,
  getUserAccountBalances,
  getUserPortfolio,
} from "./api";
import HeikinAshiChart from "./components/HeikinAshiChart";
import { supabase } from "./utils/supabase";

function formatCurrency(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents || 0) / 100);
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function getUsernameFromUser(user) {
  const candidates = [
    user?.user_metadata?.username,
    user?.email ? user.email.split("@")[0] : null,
    user?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const trimmedCandidate = candidate.trim();
    if (trimmedCandidate) {
      return trimmedCandidate;
    }
  }

  return null;
}

function getEmailRedirectTo() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return `${window.location.origin}/`;
}

function getAuthErrorMessage(error) {
  const fallbackMessage = error?.message || "Unable to complete authentication.";
  const normalizedMessage = fallbackMessage.toLowerCase();

  if (normalizedMessage.includes("invalid login credentials")) {
    return "We couldn't sign you in with that email and password. If you just created this account, verify your email first or request a new verification email below.";
  }

  if (normalizedMessage.includes("email not confirmed")) {
    return "Your email is not verified yet. Open the verification link from your inbox or request a new one below.";
  }

  return fallbackMessage;
}

export default function App() {
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [sessionUserId, setSessionUserId] = useState(null);
  const [sessionUsername, setSessionUsername] = useState(null);
  const [sessionEmail, setSessionEmail] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [assets, setAssets] = useState([]);
  const [activeAssetId, setActiveAssetId] = useState(null);
  const [candles, setCandles] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authNotice, setAuthNotice] = useState(null);
  const [pageError, setPageError] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [isLoadingCandles, setIsLoadingCandles] = useState(false);

  const holdingAssets = useMemo(() => {
    if (!portfolio) {
      return [];
    }
    return portfolio.holdings || [];
  }, [portfolio]);

  const holdingAssetIds = useMemo(
    () => new Set(holdingAssets.map((holding) => holding.asset_id)),
    [holdingAssets],
  );

  const otherAssets = useMemo(
    () => assets.filter((asset) => !holdingAssetIds.has(asset.asset_id)),
    [assets, holdingAssetIds],
  );

  function resetDashboardState() {
    setSessionUserId(null);
    setSessionUsername(null);
    setSessionEmail(null);
    setPortfolio(null);
    setAssets([]);
    setCandles(null);
    setActiveAssetId(null);
    setPageError(null);
  }

  async function loadDashboard(nextUserId, options = {}) {
    try {
      const [portfolioResult, assetsResult, accountBalances] = await Promise.all([
        getUserPortfolio(nextUserId),
        getAssets(),
        getUserAccountBalances(nextUserId).catch(() => null),
      ]);

      setPortfolio({
        ...portfolioResult,
        cash_cents: accountBalances?.cash_cents ?? portfolioResult.cash_cents,
        reserved_cash_cents:
          accountBalances?.reserved_cash_cents ?? portfolioResult.reserved_cash_cents,
      });
      setAssets(assetsResult);

      const userIssuedAssetId =
        assetsResult.find((asset) => asset.issuer_user_id === nextUserId)?.asset_id || null;
      const defaultAssetId =
        userIssuedAssetId ||
        portfolioResult.holdings?.[0]?.asset_id ||
        assetsResult[0]?.asset_id ||
        null;
      setActiveAssetId(defaultAssetId);
      setSessionUserId(nextUserId);
    } catch (err) {
      if (options.createIfMissing && err.status === 404) {
        await createUser(nextUserId);
        await loadDashboard(nextUserId, { createIfMissing: false });
        return;
      }

      throw err;
    }
  }

  async function hydrateAuthenticatedUser(user) {
    const authUserId = user?.id;
    const nextUsername = getUsernameFromUser(user);

    if (typeof authUserId !== "string" || !authUserId.trim()) {
      resetDashboardState();
      setAuthError("This account is missing a user id.");
      return;
    }

    try {
      setIsAuthenticating(true);
      setAuthError(null);
      setPageError(null);
      setSessionUsername(nextUsername);
      setSessionEmail(user.email || null);
      await loadDashboard(authUserId, { createIfMissing: true });
    } catch (err) {
      resetDashboardState();
      setAuthError(err.message || "Unable to load your dashboard.");
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    const trimmedEmail = normalizeEmail(email);
    const trimmedUsername = username.trim();

    if (!trimmedEmail || !password) {
      setAuthError("Enter your email and password to continue.");
      return;
    }

    if (authMode === "register" && !trimmedUsername) {
      setAuthError("Choose a username to create your account.");
      return;
    }

    try {
      setIsAuthenticating(true);
      setAuthError(null);
      setAuthNotice(null);

      if (authMode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            emailRedirectTo: getEmailRedirectTo(),
            data: {
              username: trimmedUsername,
            },
          },
        });

        if (error) {
          throw error;
        }

        setPassword("");
        if (data.session) {
          setAuthNotice("Account created. Loading your dashboard...");
        } else {
          setAuthMode("login");
          setAuthNotice(
            `Account created for ${trimmedEmail}. Check your inbox for the verification link, then come back here and sign in.`,
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

        if (error) {
          throw error;
        }

        setPassword("");
      }
    } catch (err) {
      setAuthError(getAuthErrorMessage(err));
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleResendVerification() {
    const trimmedEmail = normalizeEmail(email);
    if (!trimmedEmail) {
      setAuthError("Enter your email first so we know where to resend the verification link.");
      return;
    }

    try {
      setIsResendingVerification(true);
      setAuthError(null);
      setAuthNotice(null);

      const { error } = await supabase.auth.resend({
        type: "signup",
        email: trimmedEmail,
        options: {
          emailRedirectTo: getEmailRedirectTo(),
        },
      });

      if (error) {
        throw error;
      }

      setAuthNotice(
        `If ${trimmedEmail} is waiting for verification, a new email has been requested. Check your inbox and spam folder, then come back here and sign in after you open the link.`,
      );
    } catch (err) {
      setAuthError(err.message || "Unable to resend the verification email.");
    } finally {
      setIsResendingVerification(false);
    }
  }

  async function handleLogout() {
    try {
      setIsAuthenticating(true);
      setAuthError(null);
      setAuthNotice(null);
      await supabase.auth.signOut();
    } catch (err) {
      setAuthError(err.message || "Unable to sign out right now.");
    } finally {
      setPassword("");
      resetDashboardState();
      setIsAuthenticating(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (!isMounted) {
          return;
        }

        if (error) {
          throw error;
        }

        if (session?.user) {
          await hydrateAuthenticatedUser(session.user);
        } else {
          resetDashboardState();
        }
      } catch (err) {
        if (!isMounted) {
          return;
        }

        resetDashboardState();
        setAuthError(err.message || "Unable to restore your session.");
      } finally {
        if (isMounted) {
          setIsAuthReady(true);
        }
      }
    }

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
          setAuthNotice(null);
        }
        void hydrateAuthenticatedUser(session.user);
        return;
      }

      if (event === "SIGNED_OUT") {
        setAuthNotice(null);
      }

      resetDashboardState();
      setIsAuthReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!activeAssetId || !sessionUserId) {
      setCandles(null);
      return;
    }

    async function loadCandles() {
      try {
        setIsLoadingCandles(true);
        setPageError(null);
        const result = await getAssetCandles(activeAssetId);
        setCandles(result.bars);
      } catch (err) {
        setCandles(null);
        setPageError(err.message || "Unable to load candles.");
      } finally {
        setIsLoadingCandles(false);
      }
    }

    loadCandles();
  }, [activeAssetId, sessionUserId]);

  if (!isAuthReady) {
    return (
      <div className="login-shell">
        <section className="login-card">
          <p className="eyebrow">SSM Trading</p>
          <h1>Checking your session</h1>
        </section>
      </div>
    );
  }

  if (!sessionUserId) {
    return (
      <div className="login-shell">
        <section className="login-card">
          <p className="eyebrow">SSM Trading</p>
          <h1>{authMode === "login" ? "Sign in with email" : "Create your account"}</h1>

          <div className="auth-toggle" aria-label="Authentication mode">
            <button
              type="button"
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                setAuthError(null);
                setAuthNotice(null);
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={authMode === "register" ? "active" : ""}
              onClick={() => {
                setAuthMode("register");
                setAuthError(null);
                setAuthNotice(null);
              }}
            >
              Register
            </button>
          </div>

          <form className="login-form" onSubmit={handleAuthSubmit}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />

            {authMode === "register" ? (
              <>
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="trader-alice"
                  autoComplete="username"
                />
              </>
            ) : null}

            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
            />

            <button type="submit" disabled={isAuthenticating}>
              {isAuthenticating
                ? "Working..."
                : authMode === "login"
                  ? "Enter Dashboard"
                  : "Create Account"}
            </button>
          </form>

          {authNotice ? <div className="helper-banner">{authNotice}</div> : null}
          {authError ? <div className="error-banner">{authError}</div> : null}

          {authMode === "login" ? (
            <button
              type="button"
              className="ghost-button"
              onClick={handleResendVerification}
              disabled={isResendingVerification || isAuthenticating}
            >
              {isResendingVerification ? "Sending verification..." : "Resend verification email"}
            </button>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Signed in as {sessionUsername || sessionEmail || sessionUserId}</p>
          <h1>SSM Trading Dashboard</h1>
        </div>
        <button className="ghost-button" type="button" onClick={handleLogout}>
          Switch User
        </button>
      </header>

      {pageError ? <div className="error-banner">{pageError}</div> : null}

      <main className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Your Portfolio</h2>
              <p className="panel-copy">Cash balance and stocks currently held by this user.</p>
            </div>
          </div>

          <div className="panel-body">
            <div className="summary-row">
              <div>
                <strong>Cash</strong>
                <div>{formatCurrency(portfolio?.cash_cents)}</div>
              </div>
              <div>
                <strong>Reserved</strong>
                <div>{formatCurrency(portfolio?.reserved_cash_cents)}</div>
              </div>
            </div>

            <div className="positions">
              {holdingAssets.length > 0 ? (
                holdingAssets.map((holding) => (
                  <article
                    key={holding.asset_id}
                    className={holding.asset_id === activeAssetId ? "position-card selected" : "position-card"}
                    onClick={() => setActiveAssetId(holding.asset_id)}
                  >
                    <h3>{holding.asset_id}</h3>
                    <p>{holding.shares} shares</p>
                    <p>Reserved: {holding.reserved_shares}</p>
                    <p>Market value: {formatCurrency(holding.market_value_cents)}</p>
                  </article>
                ))
              ) : (
                <div className="empty-state">This user does not own any stocks yet.</div>
              )}
            </div>
          </div>
        </section>

        <section className="panel panel-wide">
          <div className="panel-header">
            <div>
              <h2>{activeAssetId ? `${activeAssetId} Heikin Ashi Chart` : "Asset Chart"}</h2>
              <p className="panel-copy">Select one of your holdings or any market asset to inspect it.</p>
            </div>
          </div>

          {candles ? (
            <HeikinAshiChart bars={candles} />
          ) : (
            <div className="loading">
              {isLoadingCandles ? "Loading chart..." : "No chart data is available for this asset yet."}
            </div>
          )}
        </section>

        <section className="panel market-panel">
          <div className="panel-header">
            <div>
              <h2>Market</h2>
              <p className="panel-copy">Other stocks available in the system, including ones this user does not own.</p>
            </div>
          </div>

          <div className="positions">
            {assets.length > 0 ? (
              assets.map((asset) => {
                const owned = holdingAssetIds.has(asset.asset_id);
                const issuedByUser = asset.issuer_user_id === sessionUserId;
                return (
                  <article
                    key={asset.asset_id}
                    className={asset.asset_id === activeAssetId ? "position-card selected" : "position-card"}
                    onClick={() => setActiveAssetId(asset.asset_id)}
                  >
                    <div className="card-label-row">
                      <h3>{asset.asset_id}</h3>
                      {issuedByUser ? <span className="card-badge">Your Asset</span> : null}
                      {owned ? <span className="card-badge">Owned</span> : null}
                    </div>
                    <p>Issuer: {asset.issuer_user_id}</p>
                    <p>Total supply: {asset.total_supply}</p>
                    <p>Last price: {formatCurrency(asset.last_price_cents || 0)}</p>
                  </article>
                );
              })
            ) : (
              <div className="empty-state">No market assets are available yet.</div>
            )}
          </div>

          {otherAssets.length === 0 && assets.length > 0 ? (
            <p className="helper-copy">This user currently owns every listed stock.</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
