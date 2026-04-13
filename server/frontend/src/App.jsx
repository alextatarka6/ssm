import { useEffect, useMemo, useState } from "react";
import {
  createUser,
  getAssetCandles,
  getAssets,
  getUserAccountBalances,
  getUserPortfolio,
  placeOrder,
} from "./api";
import HeikinAshiChart from "./components/HeikinAshiChart";
import { supabase } from "./utils/supabase";

function formatCurrency(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents || 0) / 100);
}

function formatPriceInput(cents) {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) {
    return "";
  }

  return (cents / 100).toFixed(2);
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

function getAssetIssuerName(asset, options = {}) {
  if (!asset) {
    return null;
  }

  if (asset.issuer_username) {
    return asset.issuer_username;
  }

  if (
    options.sessionUserId &&
    options.sessionUsername &&
    asset.issuer_user_id === options.sessionUserId
  ) {
    return options.sessionUsername;
  }

  return asset.issuer_user_id || asset.asset_id || null;
}

function formatAssetDisplayName(asset, options = {}) {
  const issuerName = getAssetIssuerName(asset, options);
  if (!issuerName) {
    return asset?.asset_id || "Unknown Stock";
  }

  return `${issuerName}'s Stock`;
}

export default function App() {
  const [authMode, setAuthMode] = useState("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
  const [tradingNotice, setTradingNotice] = useState(null);
  const [tradingError, setTradingError] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [isLoadingCandles, setIsLoadingCandles] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [orderSide, setOrderSide] = useState("BUY");
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [orderLimitPrice, setOrderLimitPrice] = useState("");

  const holdingAssets = useMemo(() => {
    if (!portfolio) {
      return [];
    }
    return portfolio.holdings || [];
  }, [portfolio]);

  const assetsById = useMemo(
    () => new Map(assets.map((asset) => [asset.asset_id, asset])),
    [assets],
  );

  const activeAsset = useMemo(
    () => (activeAssetId ? assetsById.get(activeAssetId) || null : null),
    [activeAssetId, assetsById],
  );

  const activeHolding = useMemo(
    () => holdingAssets.find((holding) => holding.asset_id === activeAssetId) || null,
    [activeAssetId, holdingAssets],
  );

  const holdingAssetIds = useMemo(
    () => new Set(holdingAssets.map((holding) => holding.asset_id)),
    [holdingAssets],
  );

  const otherAssets = useMemo(
    () => assets.filter((asset) => !holdingAssetIds.has(asset.asset_id)),
    [assets, holdingAssetIds],
  );

  const orderQuantityValue = useMemo(() => {
    const parsedQuantity = Number.parseInt(orderQuantity, 10);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      return null;
    }
    return parsedQuantity;
  }, [orderQuantity]);

  const orderLimitPriceCents = useMemo(() => {
    const parsedPrice = Number(orderLimitPrice);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      return null;
    }
    return Math.round(parsedPrice * 100);
  }, [orderLimitPrice]);

  const availableCashCents = portfolio?.cash_cents ?? 0;
  const availableShares = Math.max(
    (activeHolding?.shares || 0) - (activeHolding?.reserved_shares || 0),
    0,
  );
  const isActiveAssetIssuedByUser = activeAsset?.issuer_user_id === sessionUserId;
  const estimatedOrderValueCents =
    orderQuantityValue && orderLimitPriceCents
      ? orderQuantityValue * orderLimitPriceCents
      : null;
  const hasInsufficientCash =
    orderSide === "BUY" &&
    estimatedOrderValueCents !== null &&
    estimatedOrderValueCents > availableCashCents;
  const hasInsufficientShares =
    orderSide === "SELL" && orderQuantityValue !== null && orderQuantityValue > availableShares;

  function resetDashboardState() {
    setSessionUserId(null);
    setSessionUsername(null);
    setSessionEmail(null);
    setPortfolio(null);
    setAssets([]);
    setCandles(null);
    setActiveAssetId(null);
    setPageError(null);
    setTradingNotice(null);
    setTradingError(null);
    setOrderSide("BUY");
    setOrderQuantity("1");
    setOrderLimitPrice("");
  }

  function getAssetDisplayName(assetId) {
    const asset = assetsById.get(assetId);
    if (!asset) {
      return assetId;
    }

    return formatAssetDisplayName(asset, { sessionUserId, sessionUsername });
  }

  async function loadDashboard(nextUserId, options = {}) {
    try {
      const [portfolioResult, assetsResult, accountBalances] = await Promise.all([
        getUserPortfolio(nextUserId),
        getAssets(),
        getUserAccountBalances(nextUserId).catch(() => null),
      ]);

      const preferredAssetId = options.preferredAssetId ?? activeAssetId;
      const preferredAssetExists =
        typeof preferredAssetId === "string" &&
        (assetsResult.some((asset) => asset.asset_id === preferredAssetId) ||
          (portfolioResult.holdings || []).some((holding) => holding.asset_id === preferredAssetId));

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
        (preferredAssetExists ? preferredAssetId : null) ||
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

  async function refreshDashboard(options = {}) {
    if (!sessionUserId) {
      return;
    }

    await loadDashboard(sessionUserId, {
      createIfMissing: false,
      preferredAssetId: options.preferredAssetId ?? activeAssetId,
    });
  }

  async function handleTradeSubmit(event) {
    event.preventDefault();

    if (!sessionUserId || !activeAssetId || !activeAsset) {
      setTradingError("Select a stock before placing an order.");
      return;
    }

    if (!orderQuantityValue) {
      setTradingError("Enter a whole number of shares to trade.");
      return;
    }

    if (!orderLimitPriceCents) {
      setTradingError("Enter a valid limit price in dollars.");
      return;
    }

    if (orderSide === "BUY" && isActiveAssetIssuedByUser) {
      setTradingError("You can't buy your own stock.");
      return;
    }

    if (orderSide === "SELL" && orderQuantityValue > availableShares) {
      setTradingError(`You only have ${availableShares} share${availableShares === 1 ? "" : "s"} available to sell.`);
      return;
    }

    if (orderSide === "BUY" && estimatedOrderValueCents !== null && estimatedOrderValueCents > availableCashCents) {
      setTradingError("This order costs more cash than is currently available in the account.");
      return;
    }

    try {
      setIsSubmittingOrder(true);
      setTradingError(null);
      setTradingNotice(null);

      const response = await placeOrder({
        user_id: sessionUserId,
        asset_id: activeAssetId,
        side: orderSide,
        qty: orderQuantityValue,
        limit_price_cents: orderLimitPriceCents,
      });

      const tradeCount = response.trades?.length || 0;
      const tradeSummary =
        tradeCount > 0
          ? `${tradeCount} trade${tradeCount === 1 ? "" : "s"} executed immediately.`
          : "The order is now resting on the book.";

      setTradingNotice(
        `${orderSide === "BUY" ? "Buy" : "Sell"} order placed for ${orderQuantityValue} share${orderQuantityValue === 1 ? "" : "s"} of ${getAssetDisplayName(activeAssetId)} at ${formatCurrency(orderLimitPriceCents)} per share. ${tradeSummary}`,
      );

      await refreshDashboard({ preferredAssetId: activeAssetId });
    } catch (err) {
      setTradingError(err.message || "Unable to place this order.");
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  useEffect(() => {
    if (!activeAsset) {
      setOrderSide("BUY");
      setOrderQuantity("1");
      setOrderLimitPrice("");
      setTradingNotice(null);
      setTradingError(null);
      return;
    }

    const nextSide = isActiveAssetIssuedByUser && availableShares > 0 ? "SELL" : "BUY";
    setOrderSide(nextSide);
    setOrderQuantity("1");
    setOrderLimitPrice(formatPriceInput(activeAsset.last_price_cents));
    setTradingNotice(null);
    setTradingError(null);
  }, [activeAssetId]);

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
        if (err.status !== 404) {
          setPageError(err.message || "Unable to load candles.");
        }
      } finally {
        setIsLoadingCandles(false);
      }
    }

    loadCandles();
  }, [activeAssetId, sessionUserId]);

  const activeAssetDisplayName = activeAsset
    ? formatAssetDisplayName(activeAsset, { sessionUserId, sessionUsername })
    : null;
  const activeAssetIssuerName = getAssetIssuerName(activeAsset, { sessionUserId, sessionUsername });
  const isTradeSubmitDisabled =
    isSubmittingOrder ||
    !activeAsset ||
    !orderQuantityValue ||
    !orderLimitPriceCents ||
    (orderSide === "BUY" && isActiveAssetIssuedByUser) ||
    hasInsufficientCash ||
    hasInsufficientShares;

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
        <div className="login-wordmark" aria-label="Section Stock Market">
          section stock market
        </div>

        <section className="auth-layout">
          <div className="login-visual" aria-hidden="true">
            <div className="login-visual-overlay" />
          </div>

          <section className="login-card auth-card">
            <div className="auth-panel">
              <div className="auth-panel-header">
                {authMode === "login" ? <p className="eyebrow">Welcome back</p> : null}
                <h2>{authMode === "login" ? "Sign in to your account" : "Create your account"}</h2>
                <p className="helper-copy">Use your email and password below.</p>
              </div>

              <div className="auth-toggle" aria-label="Authentication mode">
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
              </div>

              <form className="login-form" onSubmit={handleAuthSubmit}>
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="dpeppa67@nd.edu"
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
                      placeholder="trader-midass"
                      autoComplete="username"
                    />
                  </>
                ) : null}

                <label htmlFor="password">Password</label>
                <div className="password-field">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((currentValue) => !currentValue)}
                    aria-pressed={showPassword}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <span className="sr-only">{showPassword ? "Hide password" : "Show password"}</span>
                    <svg
                      className="password-toggle-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
                      <circle cx="12" cy="12" r="3.2" />
                      {showPassword ? <path d="M4 4l16 16" /> : null}
                    </svg>
                  </button>
                </div>

                <button className="auth-submit-button" type="submit" disabled={isAuthenticating}>
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
                  className="ghost-button auth-secondary-action"
                  onClick={handleResendVerification}
                  disabled={isResendingVerification || isAuthenticating}
                >
                  {isResendingVerification ? "Sending verification..." : "Resend verification email"}
                </button>
              ) : null}
            </div>
          </section>
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
                    <h3>{getAssetDisplayName(holding.asset_id)}</h3>
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
              <h2>{activeAssetDisplayName ? `${activeAssetDisplayName} Heikin Ashi Chart` : "Asset Chart"}</h2>
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

        <section className="panel trade-panel">
          <div className="panel-header">
            <div>
              <h2>Trade Selected Stock</h2>
              <p className="panel-copy">Place a limit buy or sell order on the asset you currently have selected.</p>
            </div>
          </div>

          <div className="trade-panel-body">
            {activeAsset ? (
              <>
                <div className="trade-asset-summary">
                  <div>
                    <p className="eyebrow">Selected Stock</p>
                    <h3>{activeAssetDisplayName}</h3>
                    <p className="helper-copy">Issuer: {activeAssetIssuerName}</p>
                  </div>

                  <div className="trade-stat-grid">
                    <div className="trade-stat-card">
                      <span>Last price</span>
                      <strong>{formatCurrency(activeAsset.last_price_cents || 0)}</strong>
                    </div>
                    <div className="trade-stat-card">
                      <span>Cash ready</span>
                      <strong>{formatCurrency(availableCashCents)}</strong>
                    </div>
                    <div className="trade-stat-card">
                      <span>Sellable shares</span>
                      <strong>{availableShares}</strong>
                    </div>
                  </div>
                </div>

                <div className="trade-toggle" aria-label="Order side">
                  <button
                    type="button"
                    className={orderSide === "BUY" ? "active" : ""}
                    onClick={() => setOrderSide("BUY")}
                    disabled={isActiveAssetIssuedByUser}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    className={orderSide === "SELL" ? "active" : ""}
                    onClick={() => setOrderSide("SELL")}
                    disabled={availableShares === 0}
                  >
                    Sell
                  </button>
                </div>

                <form className="trade-form" onSubmit={handleTradeSubmit}>
                  <label htmlFor="trade-quantity">Quantity</label>
                  <input
                    id="trade-quantity"
                    type="number"
                    min="1"
                    step="1"
                    value={orderQuantity}
                    onChange={(event) => setOrderQuantity(event.target.value)}
                    placeholder="10"
                  />

                  <label htmlFor="trade-limit-price">Limit Price Per Share</label>
                  <input
                    id="trade-limit-price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={orderLimitPrice}
                    onChange={(event) => setOrderLimitPrice(event.target.value)}
                    placeholder="12.50"
                  />

                  {estimatedOrderValueCents !== null ? (
                    <p className="helper-copy">
                      Estimated order value: {formatCurrency(estimatedOrderValueCents)}
                    </p>
                  ) : null}

                  {orderSide === "BUY" && isActiveAssetIssuedByUser ? (
                    <div className="helper-banner">
                      Buying your own stock is blocked, but you can place sell orders for shares you hold.
                    </div>
                  ) : null}

                  {orderSide === "BUY" && hasInsufficientCash ? (
                    <div className="helper-banner">
                      This buy order is larger than the cash currently available in the account.
                    </div>
                  ) : null}

                  {orderSide === "SELL" && availableShares === 0 ? (
                    <div className="helper-banner">
                      There are no unreserved shares of this stock available to sell right now.
                    </div>
                  ) : null}

                  {orderSide === "SELL" && hasInsufficientShares ? (
                    <div className="helper-banner">
                      The order quantity is higher than the number of shares available to sell.
                    </div>
                  ) : null}

                  {tradingNotice ? <div className="helper-banner">{tradingNotice}</div> : null}
                  {tradingError ? <div className="error-banner trade-message">{tradingError}</div> : null}

                  <button className="auth-submit-button" type="submit" disabled={isTradeSubmitDisabled}>
                    {isSubmittingOrder
                      ? "Submitting Order..."
                      : `Place ${orderSide === "BUY" ? "Buy" : "Sell"} Order`}
                  </button>
                </form>
              </>
            ) : (
              <div className="empty-state">Select a market stock to place a trade.</div>
            )}
          </div>
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
                      <h3>{formatAssetDisplayName(asset, { sessionUserId, sessionUsername })}</h3>
                      {issuedByUser ? <span className="card-badge">Your Asset</span> : null}
                      {owned ? <span className="card-badge">Owned</span> : null}
                    </div>
                    <p>Issuer: {getAssetIssuerName(asset, { sessionUserId, sessionUsername })}</p>
                    <p>Ticker: {asset.asset_id}</p>
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
