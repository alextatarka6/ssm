import { useEffect, useMemo, useState } from "react";
import { getAssetCandles, getAssets, getUserPortfolio } from "./api";
import HeikinAshiChart from "./components/HeikinAshiChart";

function formatCurrency(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents || 0) / 100);
}

export default function App() {
  const [draftUserId, setDraftUserId] = useState("");
  const [sessionUserId, setSessionUserId] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [assets, setAssets] = useState([]);
  const [activeAssetId, setActiveAssetId] = useState(null);
  const [candles, setCandles] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const [pageError, setPageError] = useState(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
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

  async function loadDashboard(nextUserId) {
    const [portfolioResult, assetsResult] = await Promise.all([
      getUserPortfolio(nextUserId),
      getAssets(),
    ]);

    setPortfolio(portfolioResult);
    setAssets(assetsResult);

    const defaultAssetId = portfolioResult.holdings?.[0]?.asset_id || assetsResult[0]?.asset_id || null;
    setActiveAssetId(defaultAssetId);
    setSessionUserId(nextUserId);
  }

  async function handleLogin(event) {
    event.preventDefault();

    const trimmedUserId = draftUserId.trim();
    if (!trimmedUserId) {
      setLoginError("Enter a user ID to continue.");
      return;
    }

    try {
      setIsSigningIn(true);
      setLoginError(null);
      setPageError(null);
      await loadDashboard(trimmedUserId);
    } catch (err) {
      setLoginError(err.message || "Unable to load that user.");
    } finally {
      setIsSigningIn(false);
    }
  }

  function handleLogout() {
    setSessionUserId(null);
    setDraftUserId("");
    setPortfolio(null);
    setAssets([]);
    setCandles(null);
    setActiveAssetId(null);
    setLoginError(null);
    setPageError(null);
  }

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

  if (!sessionUserId) {
    return (
      <div className="login-shell">
        <section className="login-card">
          <p className="eyebrow">SSM Trading</p>
          <h1>Sign in with your user ID</h1>
          <p className="login-copy">
            Use an existing user for now. Once you sign in, you&apos;ll land on your dashboard with your
            holdings, the rest of the market, and the chart view.
          </p>

          <form className="login-form" onSubmit={handleLogin}>
            <label htmlFor="user-id">User ID</label>
            <input
              id="user-id"
              type="text"
              value={draftUserId}
              onChange={(event) => setDraftUserId(event.target.value)}
              placeholder="alice"
              autoComplete="off"
            />
            <button type="submit" disabled={isSigningIn}>
              {isSigningIn ? "Loading..." : "Enter Dashboard"}
            </button>
          </form>

          {loginError && <div className="error-banner">{loginError}</div>}
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Signed in as {sessionUserId}</p>
          <h1>SSM Trading Dashboard</h1>
          <p>Track your positions, browse the market, and inspect Heikin Ashi price action.</p>
        </div>
        <button className="ghost-button" type="button" onClick={handleLogout}>
          Switch User
        </button>
      </header>

      {pageError && <div className="error-banner">{pageError}</div>}

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
                return (
                  <article
                    key={asset.asset_id}
                    className={asset.asset_id === activeAssetId ? "position-card selected" : "position-card"}
                    onClick={() => setActiveAssetId(asset.asset_id)}
                  >
                    <div className="card-label-row">
                      <h3>{asset.asset_id}</h3>
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
