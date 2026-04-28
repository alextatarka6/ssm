import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelOrder,
  createUser,
  deleteCurrentProfile,
  getAssetCandles,
  getAssets,
  getLeaderboard,
  getUserAccountBalances,
  getUserOrders,
  getUserPortfolio,
  placeOrder,
  setMarketPaused,
  submitSuggestion,
  updateAsset,
  updateUser,
} from "./api";
import StockChart from "./components/StockChart";
import { getFrontendConfig, getFrontendConfigError } from "./config";
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

function isAllowedRegistrationEmail(email) {
  return typeof email === "string" && email.includes("@");
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

function getAvatarUrlFromUser(user) {
  const candidate = user?.user_metadata?.avatar_url;
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmedCandidate = candidate.trim();
  return trimmedCandidate || null;
}

function getInitials(value) {
  if (typeof value !== "string") {
    return "?";
  }

  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function getEmailRedirectTo() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
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
  const customName = typeof asset?.name === "string" ? asset.name.trim() : "";
  if (customName) {
    if (customName.includes("'s ")) {
      return customName;
    }
    const issuerName = getAssetIssuerName(asset, options);
    if (issuerName) {
      return `${issuerName}'s ${customName}`;
    }
    return customName;
  }

  const issuerName = getAssetIssuerName(asset, options);
  if (!issuerName) {
    return asset?.asset_id || "Unknown Stock";
  }

  return `${issuerName}'s Stock`;
}

function getEditableAssetLabel(asset) {
  const customName = typeof asset?.name === "string" ? asset.name.trim() : "";
  if (!customName) {
    return "Stock";
  }

  const possessiveIndex = customName.indexOf("'s ");
  if (possessiveIndex >= 0) {
    return customName.slice(possessiveIndex + 3).trim() || "Stock";
  }

  return customName;
}

function AvatarBadge({ imageUrl, label, className = "" }) {
  const avatarClassName = ["avatar-badge", className].filter(Boolean).join(" ");

  if (imageUrl) {
    return <img className={avatarClassName} src={imageUrl} alt={label ? `${label} profile picture` : "Profile picture"} />;
  }

  return (
    <span className={avatarClassName} aria-hidden="true">
      {getInitials(label)}
    </span>
  );
}

function AssetTitle({ asset, sessionUserId, sessionUsername, sessionAvatarUrl, className = "", heading = "span" }) {
  const HeadingTag = heading;
  const issuerName = getAssetIssuerName(asset, { sessionUserId, sessionUsername }) || "User";
  const titleClassName = ["asset-title", className].filter(Boolean).join(" ");
  const isCurrentUser = sessionUserId && asset?.issuer_user_id === sessionUserId;
  const avatarUrl = asset?.issuer_avatar_url || (isCurrentUser ? sessionAvatarUrl : null) || null;

  return (
    <div className={titleClassName}>
      <AvatarBadge imageUrl={avatarUrl} label={issuerName} className="asset-title-avatar" />
      <HeadingTag className="asset-title-text">
        {formatAssetDisplayName(asset, { sessionUserId, sessionUsername })}
      </HeadingTag>
    </div>
  );
}

function RibbonLabel({ as: Tag = "div", text, textAs: TextTag = "span", className = "" }) {
  const containerClassName = ["ribbon-label", className].filter(Boolean).join(" ");

  return (
    <Tag className={containerClassName}>
      <TextTag className="ribbon-label-text">{text}</TextTag>
    </Tag>
  );
}

export default function App() {
  const frontendConfigError = getFrontendConfigError();
  const { adminUserId } = getFrontendConfig();
  const [authMode, setAuthMode] = useState("register");
  const [currentView, setCurrentView] = useState("dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [sessionUserId, setSessionUserId] = useState(null);
  const [sessionUsername, setSessionUsername] = useState(null);
  const [sessionEmail, setSessionEmail] = useState(null);
  const [sessionAvatarUrl, setSessionAvatarUrl] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [assets, setAssets] = useState([]);
  const [leaderboard, setLeaderboard] = useState(null);
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
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileStockLabel, setProfileStockLabel] = useState("Stock");
  const [profileAvatarFile, setProfileAvatarFile] = useState(null);
  const [profileAvatarPreviewUrl, setProfileAvatarPreviewUrl] = useState(null);
  const [profileNotice, setProfileNotice] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isDeleteProfileDialogOpen, setIsDeleteProfileDialogOpen] = useState(false);
  const [isDeletingProfile, setIsDeletingProfile] = useState(false);
  const [orderSide, setOrderSide] = useState("BUY");
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [orderLimitPrice, setOrderLimitPrice] = useState("");
  const [userOrders, setUserOrders] = useState([]);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [orderHistoryError, setOrderHistoryError] = useState(null);
  const [orderHistoryExpanded, setOrderHistoryExpanded] = useState(false);
  const [marketSearch, setMarketSearch] = useState("");
  const [isSuggestionDialogOpen, setIsSuggestionDialogOpen] = useState(false);
  const [suggestionText, setSuggestionText] = useState("");
  const [isSuggestionSubmitting, setIsSuggestionSubmitting] = useState(false);
  const [suggestionSuccess, setSuggestionSuccess] = useState(false);
  const [suggestionError, setSuggestionError] = useState(null);
  const [isUpdateLogOpen, setIsUpdateLogOpen] = useState(false);
  const [marketPaused, setMarketPaused] = useState(false);
  const [isTogglingPause, setIsTogglingPause] = useState(false);
  const profileMenuRef = useRef(null);
  const profileAvatarInputRef = useRef(null);

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

  const filteredMarketAssets = useMemo(() => {
    const trimmed = marketSearch.trim().toLowerCase();
    if (!trimmed) return assets;
    return assets.filter((asset) => {
      const issuerName = getAssetIssuerName(asset, { sessionUserId, sessionUsername }) || "";
      return issuerName.toLowerCase().includes(trimmed);
    });
  }, [assets, marketSearch, sessionUserId, sessionUsername]);

  const issuedAsset = useMemo(
    () => assets.find((asset) => asset.issuer_user_id === sessionUserId) || null,
    [assets, sessionUserId],
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
  const buyableShares = (activeAsset?.sell_order_shares || 0) + (activeAsset?.treasury_available_shares || 0);
  const ownStockMaxShares = isActiveAssetIssuedByUser
    ? Math.floor((activeAsset?.total_supply || 0) * 0.1)
    : null;
  const ownStockBuyableShares = ownStockMaxShares !== null
    ? Math.max(0, ownStockMaxShares - (activeHolding?.shares || 0))
    : null;
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
    setSessionAvatarUrl(null);
    setPortfolio(null);
    setAssets([]);
    setCandles(null);
    setActiveAssetId(null);
    setPageError(null);
    setTradingNotice(null);
    setTradingError(null);
    setProfileUsername("");
    setProfileEmail("");
    setProfilePassword("");
    setProfileStockLabel("Stock");
    setProfileAvatarFile(null);
    setProfileAvatarPreviewUrl(null);
    setProfileNotice(null);
    setProfileError(null);
    setIsDeleteProfileDialogOpen(false);
    setIsDeletingProfile(false);
    setOrderSide("BUY");
    setOrderQuantity("1");
    setOrderLimitPrice("");
    setUserOrders([]);
    setCancellingOrderId(null);
    setOrderHistoryError(null);
  }

  function getAssetDisplayName(assetId) {
    const asset = assetsById.get(assetId);
    if (!asset) {
      return assetId;
    }

    return formatAssetDisplayName(asset, { sessionUserId, sessionUsername });
  }

  async function loadDashboard(nextUserId, options = {}) {
    // On auth hydration (username present), upsert the market user so username/avatar
    // are always current and a stock is issued if one was never created.
    if (options.username !== undefined) {
      await createUser(nextUserId, {
        username: options.username,
        email: options.email,
        avatarUrl: options.avatarUrl,
      });
    }

    const preferredAssetId = options.preferredAssetId ?? activeAssetId;

    const [portfolioResult, assetsResult, accountBalances, ordersResult, leaderboardResult] = await Promise.all([
      getUserPortfolio(nextUserId),
      getAssets(),
      getUserAccountBalances(nextUserId).catch(() => null),
      getUserOrders(nextUserId).catch(() => null),
      getLeaderboard().catch(() => null),
    ]);

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
    setUserOrders(ordersResult?.orders ?? []);
    setLeaderboard(leaderboardResult);
    setMarketPaused(leaderboardResult?.paused === true);

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
      setSessionAvatarUrl(getAvatarUrlFromUser(user));
      await loadDashboard(authUserId, { username: nextUsername, email: user.email ?? null, avatarUrl: getAvatarUrlFromUser(user) });
    } catch (err) {
      resetDashboardState();
      setAuthError(err.message || "Unable to load your dashboard.");
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    if (!supabase) {
      setAuthError(frontendConfigError || "Authentication is not configured for this deployment.");
      return;
    }

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

    if (authMode === "register" && !isAllowedRegistrationEmail(trimmedEmail)) {
      setAuthError("Enter a valid email address to register.");
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
    if (!supabase) {
      setAuthError(frontendConfigError || "Authentication is not configured for this deployment.");
      return;
    }

    const trimmedEmail = normalizeEmail(email);
    if (!trimmedEmail) {
      setAuthError("Enter your email first so we know where to resend the verification link.");
      return;
    }

    if (!isAllowedRegistrationEmail(trimmedEmail)) {
      setAuthError("Enter a valid email address.");
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
    if (!supabase) {
      setAuthError(frontendConfigError || "Authentication is not configured for this deployment.");
      return;
    }

    try {
      setIsAuthenticating(true);
      setAuthError(null);
      setAuthNotice(null);
      setIsProfileMenuOpen(false);
      setCurrentView("dashboard");
      setAuthMode("login");
      await supabase.auth.signOut();
    } catch (err) {
      setAuthError(err.message || "Unable to sign out right now.");
    } finally {
      setEmail("");
      setPassword("");
      setShowPassword(false);
      setUsername("");
      resetDashboardState();
      setIsAuthenticating(false);
    }
  }

  function handleOpenProfileView() {
    setCurrentView("profile");
    setIsProfileMenuOpen(false);
    setProfileNotice(null);
    setProfileError(null);
    setProfileAvatarFile(null);
    setProfileAvatarPreviewUrl(sessionAvatarUrl);

    if (profileAvatarInputRef.current) {
      profileAvatarInputRef.current.value = "";
    }
  }

  function handleReturnToDashboard() {
    setCurrentView("dashboard");
  }

  function handleOpenDeleteProfileDialog() {
    setProfileNotice(null);
    setProfileError(null);
    setIsDeleteProfileDialogOpen(true);
  }

  function handleCloseDeleteProfileDialog() {
    if (isDeletingProfile) {
      return;
    }

    setIsDeleteProfileDialogOpen(false);
  }

  function handleProfileAvatarChange(event) {
    const nextFile = event.target.files?.[0] || null;
    setProfileNotice(null);
    setProfileError(null);

    if (!nextFile) {
      setProfileAvatarFile(null);
      setProfileAvatarPreviewUrl(sessionAvatarUrl);
      return;
    }

    const normalizedType = nextFile.type.toLowerCase();
    if (!normalizedType.startsWith("image/")) {
      setProfileAvatarFile(null);
      setProfileError("Choose an image file for your profile picture.");
      event.target.value = "";
      return;
    }

    if (nextFile.size > 5 * 1024 * 1024) {
      setProfileAvatarFile(null);
      setProfileError("Profile pictures must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }

    setProfileAvatarFile(nextFile);
    setProfileAvatarPreviewUrl(URL.createObjectURL(nextFile));
  }

  function handleRemoveProfileAvatar() {
    setProfileAvatarFile(null);
    setProfileAvatarPreviewUrl(null);
    setProfileNotice(null);
    setProfileError(null);

    if (profileAvatarInputRef.current) {
      profileAvatarInputRef.current.value = "";
    }
  }

  async function uploadProfileAvatar(userId, file) {
    if (!supabase) {
      throw new Error(frontendConfigError || "Authentication is not configured for this deployment.");
    }

    const sanitizedExtension = (file.name.split(".").pop() || "png").replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
    const storagePath = `${userId}/avatar.${sanitizedExtension}`;
    const { error: uploadError } = await supabase.storage.from("profile-pictures").upload(storagePath, file, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("profile-pictures").getPublicUrl(storagePath);

    return publicUrl || null;
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();

    if (!supabase) {
      setProfileError(frontendConfigError || "Authentication is not configured for this deployment.");
      return;
    }

    if (!sessionUserId) {
      setProfileError("You need to be signed in to update your profile.");
      return;
    }

    const trimmedProfileUsername = profileUsername.trim();
    const normalizedProfileEmail = normalizeEmail(profileEmail);
    const trimmedStockLabel = profileStockLabel.trim();
    const previousUsername = sessionUsername || "";
    const previousEmail = sessionEmail || "";
    const previousAvatarUrl = sessionAvatarUrl || null;

    if (!trimmedProfileUsername) {
      setProfileError("Choose a username before saving your profile.");
      return;
    }

    if (!normalizedProfileEmail) {
      setProfileError("Enter an email address before saving your profile.");
      return;
    }

    if (!isAllowedRegistrationEmail(normalizedProfileEmail)) {
      setProfileError("Enter a valid email address.");
      return;
    }

    if (issuedAsset && !trimmedStockLabel) {
      setProfileError("Choose a stock label for your issued stock.");
      return;
    }

    const authUpdates = {};
    let nextAvatarUrl = previousAvatarUrl;
    if (normalizedProfileEmail !== previousEmail) {
      authUpdates.email = normalizedProfileEmail;
    }
    if (profilePassword) {
      authUpdates.password = profilePassword;
    }

    try {
      setIsSavingProfile(true);
      setProfileError(null);
      setProfileNotice(null);

      if (profileAvatarFile) {
        nextAvatarUrl = await uploadProfileAvatar(sessionUserId, profileAvatarFile);
      } else if (!profileAvatarPreviewUrl) {
        nextAvatarUrl = null;
      }

      if (trimmedProfileUsername !== previousUsername || nextAvatarUrl !== previousAvatarUrl) {
        authUpdates.data = {
          username: trimmedProfileUsername,
          avatar_url: nextAvatarUrl,
        };
      }

      if (Object.keys(authUpdates).length > 0) {
        const { data, error } = await supabase.auth.updateUser(authUpdates);
        if (error) {
          throw error;
        }

        if (trimmedProfileUsername !== previousUsername || nextAvatarUrl !== previousAvatarUrl) {
          const { error: profileUpdateError } = await supabase
            .from("profiles")
            .update({
              username: trimmedProfileUsername,
              avatar_url: nextAvatarUrl,
            })
            .eq("id", sessionUserId);

          if (profileUpdateError) {
            throw profileUpdateError;
          }

          await updateUser(sessionUserId, { username: trimmedProfileUsername, avatarUrl: nextAvatarUrl });
        }

        const updatedUser = data.user;
        setSessionUsername(getUsernameFromUser(updatedUser) || trimmedProfileUsername);
        setSessionEmail(updatedUser?.email || normalizedProfileEmail);
        setSessionAvatarUrl(getAvatarUrlFromUser(updatedUser) || nextAvatarUrl);
      }

      if (issuedAsset && trimmedStockLabel !== getEditableAssetLabel(issuedAsset)) {
        await updateAsset(issuedAsset.asset_id, {
          issuer_user_id: sessionUserId,
          name: trimmedStockLabel,
        });
      }

      setProfilePassword("");
      setProfileAvatarFile(null);
      if (profileAvatarInputRef.current) {
        profileAvatarInputRef.current.value = "";
      }
      await refreshDashboard({ preferredAssetId: activeAssetId });
      setProfileNotice(
        normalizedProfileEmail !== previousEmail
          ? "Profile saved. Check your inbox if Supabase asks you to confirm the new email address."
          : "Profile saved.",
      );
    } catch (err) {
      setProfileError(err.message || "Unable to save your profile right now.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleDeleteProfile() {
    if (!supabase) {
      setProfileError(frontendConfigError || "Authentication is not configured for this deployment.");
      setIsDeleteProfileDialogOpen(false);
      return;
    }

    if (!sessionUserId) {
      setProfileError("You need to be signed in to delete your profile.");
      setIsDeleteProfileDialogOpen(false);
      return;
    }

    try {
      setIsDeletingProfile(true);
      setProfileError(null);
      setProfileNotice(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Sign in again to delete your profile.");
      }

      await deleteCurrentProfile(session.access_token);
      await supabase.auth.signOut();
      resetDashboardState();
      setCurrentView("dashboard");
      setAuthMode("login");
      setAuthNotice("Your profile has been deleted.");
      setEmail("");
      setPassword("");
      setShowPassword(false);
      setUsername("");
      setIsProfileMenuOpen(false);
      setIsDeleteProfileDialogOpen(false);
    } catch (err) {
      setProfileError(err.message || "Unable to delete your profile right now.");
    } finally {
      setIsDeletingProfile(false);
    }
  }

  async function refreshDashboard(options = {}) {
    if (!sessionUserId) {
      return;
    }

    await loadDashboard(sessionUserId, {
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

  async function handleCancelOrder(orderId) {
    if (cancellingOrderId !== null) {
      return;
    }

    try {
      setCancellingOrderId(orderId);
      setOrderHistoryError(null);
      await cancelOrder(orderId);
      await refreshDashboard({ preferredAssetId: activeAssetId });
    } catch (err) {
      setOrderHistoryError(err.message || "Unable to cancel this order.");
    } finally {
      setCancellingOrderId(null);
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

    const nextSide = "BUY";
    setOrderSide(nextSide);
    setOrderQuantity("1");
    setOrderLimitPrice(formatPriceInput(activeAsset.last_price_cents));
    setTradingNotice(null);
    setTradingError(null);
  }, [activeAssetId]);

  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      if (!supabase) {
        resetDashboardState();
        setAuthError(frontendConfigError || "Authentication is not configured for this deployment.");
        setIsAuthReady(true);
        return;
      }

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

    if (!supabase) {
      return () => { isMounted = false; };
    }

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

  const sessionUserIdRef = useRef(sessionUserId);
  const activeAssetIdRef = useRef(activeAssetId);
  useEffect(() => { sessionUserIdRef.current = sessionUserId; }, [sessionUserId]);
  useEffect(() => { activeAssetIdRef.current = activeAssetId; }, [activeAssetId]);

  useEffect(() => {
    if (!sessionUserId) return undefined;

    const interval = setInterval(() => {
      const currentUserId = sessionUserIdRef.current;
      const currentAssetId = activeAssetIdRef.current;
      if (!currentUserId) return;
      void loadDashboard(currentUserId, { createIfMissing: false, preferredAssetId: currentAssetId });
    }, 30000);

    return () => clearInterval(interval);
  }, [sessionUserId]);

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

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return undefined;
    }

    function handleDocumentPointerDown(event) {
      if (profileMenuRef.current?.contains(event.target)) {
        return;
      }

      setIsProfileMenuOpen(false);
    }

    function handleDocumentKeyDown(event) {
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (!isDeleteProfileDialogOpen) {
      return undefined;
    }

    function handleDocumentKeyDown(event) {
      if (event.key === "Escape") {
        handleCloseDeleteProfileDialog();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [isDeleteProfileDialogOpen, isDeletingProfile]);

  useEffect(() => {
    setProfileUsername(sessionUsername || "");
    setProfileEmail(sessionEmail || "");
    setProfilePassword("");
    setProfileStockLabel(getEditableAssetLabel(issuedAsset));
    setProfileAvatarFile(null);
    setProfileAvatarPreviewUrl(sessionAvatarUrl);

    if (profileAvatarInputRef.current) {
      profileAvatarInputRef.current.value = "";
    }
  }, [issuedAsset, sessionAvatarUrl, sessionEmail, sessionUsername]);

  useEffect(() => {
    if (!profileAvatarPreviewUrl || !profileAvatarPreviewUrl.startsWith("blob:")) {
      return undefined;
    }

    return () => {
      URL.revokeObjectURL(profileAvatarPreviewUrl);
    };
  }, [profileAvatarPreviewUrl]);

  const activeAssetDisplayName = activeAsset
    ? formatAssetDisplayName(activeAsset, { sessionUserId, sessionUsername })
    : null;
  const activeAssetIssuerName = getAssetIssuerName(activeAsset, { sessionUserId, sessionUsername });
  const isTradeSubmitDisabled =
    isSubmittingOrder ||
    !activeAsset ||
    !orderQuantityValue ||
    !orderLimitPriceCents ||
    hasInsufficientCash ||
    hasInsufficientShares;
  const topbarTitle = currentView === "profile" ? "Edit Profile" : "Section Stock Market";
  const topbarEyebrow = currentView === "profile" ? "Cast Update" : "Now Presenting";
  const topbarSubtitle =
    currentView === "profile"
      ? "Tune your account details and the name on your issued stock certificate."
      : null;

  async function handleTogglePause() {
    setIsTogglingPause(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated.");
      const result = await setMarketPaused(!marketPaused, session.access_token);
      setMarketPaused(result.paused);
    } catch (err) {
      setPageError(err.message || "Failed to toggle market pause.");
    } finally {
      setIsTogglingPause(false);
    }
  }

  function handleOpenSuggestionDialog() {
    setSuggestionText("");
    setSuggestionSuccess(false);
    setSuggestionError(null);
    setIsSuggestionDialogOpen(true);
  }

  function handleCloseSuggestionDialog() {
    setIsSuggestionDialogOpen(false);
  }

  async function handleSubmitSuggestion() {
    if (!suggestionText.trim()) return;
    setIsSuggestionSubmitting(true);
    setSuggestionError(null);
    try {
      await submitSuggestion({ userId: sessionUserId, username: sessionUsername, text: suggestionText });
      setSuggestionSuccess(true);
    } catch (err) {
      setSuggestionError(err.message || "Failed to submit suggestion.");
    } finally {
      setIsSuggestionSubmitting(false);
    }
  }

  if (!isAuthReady) {
    return (
      <div className="login-shell">
        <section className="login-card session-status-card">
          <p className="eyebrow">Section Stock Market</p>
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
                <p className="helper-copy">
                  {authMode === "login"
                    ? "Use your email and password below."
                    : "Enter your email and password below."}
                </p>
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
                  disabled={isResendingVerification || isAuthenticating || !supabase}
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
      <button type="button" className="update-log-link" onClick={() => setIsUpdateLogOpen(true)}>
        Update Log
      </button>
      <header className="topbar">
        <div className="topbar-accent topbar-accent-left" aria-hidden="true" />
        <div className="topbar-accent topbar-accent-right" aria-hidden="true" />
        <div className="topbar-wrapper">
          <div className="topbar-stage">
            <p className="eyebrow topbar-kicker">{topbarEyebrow}</p>
            <RibbonLabel className="topbar-brand" text={topbarTitle} textAs="h1" />
            {topbarSubtitle ? <p className="topbar-subtitle">{topbarSubtitle}</p> : null}
          </div>
        </div>
      </header>
      <div className="topbar-actions">
        <div className="profile-menu" ref={profileMenuRef}>
          <button
            className="profile-menu-button"
            type="button"
            aria-label="Open profile menu"
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
            onClick={() => setIsProfileMenuOpen((currentValue) => !currentValue)}
          >
            <AvatarBadge
              imageUrl={sessionAvatarUrl}
              label={sessionUsername || sessionEmail || "Your profile"}
              className="profile-menu-avatar"
            />
          </button>

          {isProfileMenuOpen ? (
            <div className="profile-menu-popover" role="menu" aria-label="Profile options">
              <button
                className="profile-menu-item"
                type="button"
                role="menuitem"
                onClick={handleOpenProfileView}
              >
                Edit Profile
              </button>
              {adminUserId && sessionUserId === adminUserId ? (
                <button
                  className={`profile-menu-item admin-pause-item ${marketPaused ? "admin-pause-resume" : "admin-pause-pause"}`}
                  type="button"
                  role="menuitem"
                  disabled={isTogglingPause}
                  onClick={handleTogglePause}
                >
                  {isTogglingPause ? "Updating..." : marketPaused ? "Resume Trading" : "Pause Trading"}
                </button>
              ) : null}
              <button
                className="profile-menu-item logout"
                type="button"
                role="menuitem"
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {pageError ? <div className="error-banner">{pageError}</div> : null}

      {marketPaused ? (
        <div className="market-pause-banner" role="alert">
          Trading is paused — no new orders can be placed right now.
        </div>
      ) : null}

      <main className={currentView === "profile" ? "profile-view" : "content-grid"}>
        {currentView === "profile" ? (
          <section className="panel profile-panel">
            <div className="panel-header profile-panel-header">
              <div>
                <h2>Edit Your Profile</h2>
                <p className="panel-copy">Update your username, email, password, and the label for your issued stock.</p>
              </div>
              <button className="ghost-button" type="button" onClick={handleReturnToDashboard}>
                Back to Dashboard
              </button>
            </div>

            <form className="profile-form" onSubmit={handleProfileSubmit}>
              <label htmlFor="profile-username">Username</label>
              <input
                id="profile-username"
                type="text"
                value={profileUsername}
                onChange={(event) => setProfileUsername(event.target.value)}
                autoComplete="username"
                placeholder="trader-midass"
              />

              <label htmlFor="profile-email">Email</label>
                <input
                  id="profile-email"
                  type="email"
                  value={profileEmail}
                  onChange={(event) => setProfileEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />

              <label htmlFor="profile-password">New Password</label>
              <input
                id="profile-password"
                type="password"
                value={profilePassword}
                onChange={(event) => setProfilePassword(event.target.value)}
                autoComplete="new-password"
                placeholder="Leave blank to keep your current password"
              />

              <div className="profile-avatar-editor">
                <div className="profile-avatar-preview-panel">
                  <span className="profile-avatar-label">Profile Picture</span>
                  <div className="profile-avatar-preview-row">
                    <AvatarBadge
                      imageUrl={profileAvatarPreviewUrl}
                      label={profileUsername || sessionUsername || sessionEmail || "Your profile"}
                      className="profile-avatar-preview"
                    />
                    <div>
                      <p className="helper-copy profile-avatar-copy">
                        Upload a square photo, logo, or headshot to represent your stock across the market.
                      </p>
                      <p className="helper-copy profile-avatar-copy">PNG, JPG, GIF, and WebP up to 5 MB.</p>
                    </div>
                  </div>
                </div>

                <div className="profile-avatar-controls">
                  <label className="ghost-button profile-avatar-upload" htmlFor="profile-avatar">
                    {profileAvatarFile ? "Choose a Different Image" : "Upload Profile Picture"}
                  </label>
                  <input
                    ref={profileAvatarInputRef}
                    id="profile-avatar"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleProfileAvatarChange}
                  />
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={handleRemoveProfileAvatar}
                    disabled={!profileAvatarPreviewUrl && !profileAvatarFile}
                  >
                    Remove Picture
                  </button>
                </div>
              </div>

              {issuedAsset ? (
                <>
                  <label htmlFor="profile-stock-label">Stock Label</label>
                  <input
                    id="profile-stock-label"
                    type="text"
                    value={profileStockLabel}
                    onChange={(event) => setProfileStockLabel(event.target.value)}
                    placeholder="Stock"
                  />
                  <p className="helper-copy">
                    This updates the second half of {sessionUsername || "your"}&apos;s stock name.
                  </p>
                </>
              ) : (
                <div className="helper-banner">A stock label will appear here once this account has an issued stock.</div>
              )}

              <div className="profile-summary-grid">
                <div className="profile-summary-card">
                  <span>Current display name</span>
                  <strong>{sessionUsername || "Not set yet"}</strong>
                </div>
                <div className="profile-summary-card">
                  <span>Issued stock</span>
                  {issuedAsset ? (
                    <AssetTitle
                      asset={issuedAsset}
                      sessionUserId={sessionUserId}
                      sessionUsername={sessionUsername}
                      sessionAvatarUrl={sessionAvatarUrl}
                      className="profile-issued-stock-title"
                      heading="strong"
                    />
                  ) : (
                    <strong>None yet</strong>
                  )}
                </div>
              </div>

              {profileNotice ? <div className="helper-banner profile-wip-banner">{profileNotice}</div> : null}
              {profileError ? <div className="error-banner">{profileError}</div> : null}

              <div className="profile-form-actions">
                <button className="auth-submit-button profile-save-button" type="submit" disabled={isSavingProfile}>
                  {isSavingProfile ? "Saving..." : "Save Profile"}
                </button>

                <button
                  className="ghost-button profile-delete-button"
                  type="button"
                  onClick={handleOpenDeleteProfileDialog}
                  disabled={isSavingProfile || isDeletingProfile}
                >
                  Delete Profile
                </button>
              </div>

              <p className="helper-copy profile-delete-copy">
                Deleting your profile permanently removes this account and its market history.
              </p>
            </form>
          </section>
        ) : (
          <>
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
                  <div>
                    <strong>Net Worth</strong>
                    <div>{formatCurrency(
                      (portfolio?.cash_cents ?? 0) +
                      holdingAssets.reduce((sum, h) => sum + (h.market_value_cents ?? 0), 0)
                    )}</div>
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

            <div className="stock-detail-stack">
              <section className="panel panel-wide stock-chart-panel">
                <div className="panel-header">
                  <div>
                    {activeAsset ? (
                      <AssetTitle
                        asset={activeAsset}
                        sessionUserId={sessionUserId}
                        sessionUsername={sessionUsername}
                        sessionAvatarUrl={sessionAvatarUrl}
                        className="panel-asset-title"
                        heading="h2"
                      />
                    ) : (
                      <h2>Selected Stock</h2>
                    )}
                    <p className="panel-copy">Select one of your holdings or any market asset to inspect it.</p>
                  </div>
                </div>

                {candles ? (
                  <StockChart bars={candles} />
                ) : (
                  <div className="loading">
                    {isLoadingCandles ? "Loading chart..." : "No chart data is available for this asset yet."}
                  </div>
                )}
              </section>

              <section className="panel trade-panel trade-panel-attached">
                <div className="panel-header">
                  <div>
                    <h2>Trade Selected Stock</h2>
                    <p className="panel-copy">
                      Place a limit buy or sell order on the asset you currently have selected.
                    </p>
                  </div>
                </div>

                <div className="trade-panel-body">
                  {activeAsset ? (
                    <>
                      <div className="trade-asset-summary">
                        <div>
                          <p className="eyebrow">Selected Stock</p>
                          <AssetTitle
                            asset={activeAsset}
                            sessionUserId={sessionUserId}
                            sessionUsername={sessionUsername}
                            sessionAvatarUrl={sessionAvatarUrl}
                            className="trade-asset-title"
                            heading="h3"
                          />
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
                            <span>Buyable shares</span>
                            <strong>{buyableShares}</strong>
                          </div>
                          <div className="trade-stat-card">
                            <span>Sellable shares</span>
                            <strong>{availableShares}</strong>
                          </div>
                          {ownStockBuyableShares !== null ? (
                            <div className="trade-stat-card">
                              <span>Own stock cap</span>
                              <strong>{ownStockBuyableShares} of {ownStockMaxShares} left</strong>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="trade-toggle" aria-label="Order side">
                        <button
                          type="button"
                          className={orderSide === "BUY" ? "active" : ""}
                          onClick={() => setOrderSide("BUY")}
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
            </div>

            <section className="panel market-panel">
              <div className="panel-header">
                <div>
                  <h2>Market</h2>
                  <p className="panel-copy">
                    Other stocks available in the system, including ones this user does not own.
                  </p>
                </div>
                <div className="market-panel-controls">
                  <div className="leaderboard-stats">
                    <div className="leaderboard-stat">
                      <span>Top Cash</span>
                      <strong>{leaderboard?.top_cash ? `${leaderboard.top_cash.username} — ${formatCurrency(leaderboard.top_cash.cash_cents)}` : "—"}</strong>
                    </div>
                    <div className="leaderboard-stat">
                      <span>Top Net Worth</span>
                      <strong>{leaderboard?.top_net_worth ? `${leaderboard.top_net_worth.username} — ${formatCurrency(leaderboard.top_net_worth.net_worth_cents)}` : "—"}</strong>
                    </div>
                  </div>
                  <input
                    className="market-search-input"
                    type="search"
                    placeholder="Search by username"
                    value={marketSearch}
                    onChange={(event) => setMarketSearch(event.target.value)}
                    aria-label="Search market by username"
                  />
                </div>
              </div>

              <div className="positions">
                {assets.length === 0 ? (
                  <div className="empty-state">No market assets are available yet.</div>
                ) : filteredMarketAssets.length === 0 ? (
                  <div className="empty-state">No stocks match that username.</div>
                ) : (
                  filteredMarketAssets.map((asset) => {
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
                        <p>Buyable shares: {(asset.sell_order_shares || 0) + (asset.treasury_available_shares || 0)}</p>
                        <p>Last price: {formatCurrency(asset.last_price_cents || 0)}</p>
                      </article>
                    );
                  })
                )}
              </div>

              {otherAssets.length === 0 && assets.length > 0 ? (
                <p className="helper-copy">This user currently owns every listed stock.</p>
              ) : null}
            </section>

            <section className="panel order-history-panel">
              <div className="panel-header">
                <div>
                  <h2>Order History</h2>
                  <p className="panel-copy">All orders placed by this account, newest first.</p>
                </div>
              </div>

              {orderHistoryError ? <div className="error-banner">{orderHistoryError}</div> : null}

              <div className="order-history-list">
                {userOrders.length > 0 ? (
                  <>
                    {(orderHistoryExpanded ? userOrders : userOrders.slice(0, 3)).map((order) => {
                      const isResting = order.status === "OPEN" || order.status === "PARTIALLY_FILLED";
                      const isCancellingThis = cancellingOrderId === order.id;

                      let statusLabel = order.status;
                      let statusClass = "order-status-default";
                      if (isResting) {
                        statusLabel = order.status === "PARTIALLY_FILLED" ? "Partial" : "Resting";
                        statusClass = "order-status-resting";
                      } else if (order.status === "FILLED") {
                        statusLabel = "Fulfilled";
                        statusClass = "order-status-fulfilled";
                      } else if (order.status === "CANCELED" || order.status === "REJECTED") {
                        statusLabel = order.status === "CANCELED" ? "Cancelled" : "Rejected";
                        statusClass = "order-status-cancelled";
                      }

                      return (
                        <article key={order.id} className="order-history-row">
                          <div className="order-history-main">
                            <div className="order-history-meta">
                              <span className={`order-status-badge ${statusClass}`}>{statusLabel}</span>
                              <span className="order-side-badge" data-side={order.side}>
                                {order.side === "BUY" ? "Buy" : "Sell"}
                              </span>
                              <span className="order-history-name">{getAssetDisplayName(order.asset_id)}</span>
                            </div>
                            <div className="order-history-details">
                              <span>{order.qty} share{order.qty === 1 ? "" : "s"}</span>
                              <span className="order-history-sep">·</span>
                              <span>Limit {formatCurrency(order.limit_price_cents)}</span>
                              {order.avg_fill_price_cents != null ? (
                                <>
                                  <span className="order-history-sep">·</span>
                                  <span>Filled @ {formatCurrency(order.avg_fill_price_cents)}</span>
                                </>
                              ) : null}
                              {order.status === "PARTIALLY_FILLED" ? (
                                <>
                                  <span className="order-history-sep">·</span>
                                  <span>{order.qty - order.remaining_qty} filled, {order.remaining_qty} remaining</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          {isResting ? (
                            <button
                              className="ghost-button order-cancel-button"
                              type="button"
                              disabled={cancellingOrderId !== null}
                              onClick={() => handleCancelOrder(order.id)}
                            >
                              {isCancellingThis ? "Cancelling..." : "Cancel"}
                            </button>
                          ) : null}
                        </article>
                      );
                    })}
                    {userOrders.length > 3 ? (
                      <button
                        type="button"
                        className="ghost-button order-history-toggle"
                        onClick={() => setOrderHistoryExpanded((e) => !e)}
                      >
                        {orderHistoryExpanded ? "Show less" : `Show ${userOrders.length - 3} more`}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="empty-state">No orders have been placed yet.</div>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="site-footer">
        <button type="button" className="footer-link" onClick={handleOpenSuggestionDialog}>
          Suggestions
        </button>
      </footer>

      {isDeleteProfileDialogOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseDeleteProfileDialog();
            }
          }}
        >
          <section
            className="dialog-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-profile-title"
            aria-describedby="delete-profile-description"
          >
            <div className="dialog-copy">
              <p className="eyebrow">Are you sure?</p>
              <h2 id="delete-profile-title">Delete your profile?</h2>
              <p id="delete-profile-description" className="panel-copy">
                This permanently deletes your account, profile, and connected trading data. This action cannot be undone.
              </p>
            </div>

            <div className="dialog-actions">
              <button className="ghost-button" type="button" onClick={handleCloseDeleteProfileDialog} disabled={isDeletingProfile}>
                Cancel
              </button>
              <button className="auth-submit-button profile-delete-confirm-button" type="button" onClick={handleDeleteProfile} disabled={isDeletingProfile}>
                {isDeletingProfile ? "Deleting..." : "Yes, Delete Profile"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isSuggestionDialogOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) handleCloseSuggestionDialog();
          }}
        >
          <section
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="suggestion-dialog-title"
          >
            <div className="dialog-copy">
              <p className="eyebrow">Have an idea?</p>
              <h2 id="suggestion-dialog-title">Leave a suggestion</h2>
              <p className="panel-copy">One suggestion per day. We read every one.</p>
            </div>

            {suggestionSuccess ? (
              <p className="suggestion-success">Thanks! Your suggestion was submitted.</p>
            ) : (
              <form
                className="suggestion-form"
                onSubmit={(e) => { e.preventDefault(); handleSubmitSuggestion(); }}
              >
                <textarea
                  className="suggestion-textarea"
                  placeholder="What would make Section Stock Market better?"
                  maxLength={500}
                  rows={4}
                  value={suggestionText}
                  onChange={(e) => setSuggestionText(e.target.value)}
                  disabled={isSuggestionSubmitting}
                />
                <div className="suggestion-meta">
                  <span className="suggestion-char-count">{suggestionText.length}/500</span>
                  {suggestionError ? <p className="suggestion-error">{suggestionError}</p> : null}
                </div>
              </form>
            )}

            <div className="dialog-actions">
              <button className="ghost-button" type="button" onClick={handleCloseSuggestionDialog}>
                {suggestionSuccess ? "Close" : "Cancel"}
              </button>
              {!suggestionSuccess ? (
                <button
                  className="auth-submit-button"
                  type="button"
                  disabled={isSuggestionSubmitting || !suggestionText.trim()}
                  onClick={handleSubmitSuggestion}
                >
                  {isSuggestionSubmitting ? "Submitting..." : "Submit"}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {isUpdateLogOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsUpdateLogOpen(false);
          }}
        >
          <section
            className="dialog-card update-log-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-log-title"
          >
            <div className="dialog-copy">
              <p className="eyebrow">What's new</p>
              <h2 id="update-log-title">Update Log</h2>
            </div>

            <ul className="update-log-list">
              <li>
                <span className="update-log-date">Apr 27, 2026</span>
                <span className="update-log-text">Everyone got a <strong>$10,000 top-up</strong> — new players now start with $15,000</span>
              </li>
              <li>
                <span className="update-log-date">Apr 27, 2026</span>
                <span className="update-log-text"><strong>Fairer pricing</strong> — stock prices now only move when real users trade each other, not when the bank steps in</span>
              </li>
              <li>
                <span className="update-log-date">Apr 27, 2026</span>
                <span className="update-log-text"><strong>Duplicate order protection</strong> — placing the same order twice in quick succession now only creates one</span>
              </li>
              <li>
                <span className="update-log-date">Apr 27, 2026</span>
                <span className="update-log-text"><strong>Suggestions</strong> — use the link at the bottom of the page to send us feedback (one per day)</span>
              </li>
              <li>
                <span className="update-log-date">Apr 27, 2026</span>
                <span className="update-log-text"><strong>Request throttling</strong> — added to keep the market running smoothly for everyone</span>
              </li>
            </ul>

            <div className="dialog-actions">
              <button className="ghost-button" type="button" onClick={() => setIsUpdateLogOpen(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
