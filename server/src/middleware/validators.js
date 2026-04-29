const { ValidationError } = require("../utils/errors");
const { Side } = require("../engine/constants");

function cloneValidated(req) {
  req.validated = req.validated || {};
  return req.validated;
}

function requireTrimmedString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${field} is required.`);
  }

  return value.trim();
}

function requirePositiveInteger(value, field) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer.`);
  }

  return parsed;
}

function requireNonNegativeInteger(value, field) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`${field} must be a non-negative integer.`);
  }

  return parsed;
}

function requireSide(value) {
  if (!Object.values(Side).includes(value)) {
    throw new ValidationError("side must be BUY or SELL.");
  }

  return value;
}

function validateCreateUser(req, _res, next) {
  try {
    const validated = cloneValidated(req);
    validated.body = {
      userId: requireTrimmedString(req.body.user_id, "user_id"),
      initialCashCents:
        req.body.initial_cash_cents === undefined
          ? 1500000
          : requireNonNegativeInteger(req.body.initial_cash_cents, "initial_cash_cents"),
      username:
        typeof req.body.username === "string" && req.body.username.trim()
          ? req.body.username.trim()
          : undefined,
      avatarUrl:
        typeof req.body.avatar_url === "string" && req.body.avatar_url.trim()
          ? req.body.avatar_url.trim()
          : undefined,
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateCreateAsset(req, _res, next) {
  try {
    const validated = cloneValidated(req);
    const issuerPct =
      req.body.issuer_pct === undefined ? 0.1 : Number(req.body.issuer_pct);

    if (!Number.isFinite(issuerPct) || issuerPct <= 0 || issuerPct > 0.1) {
      throw new ValidationError("issuer_pct must be a number between 0 and 0.1.");
    }

    validated.body = {
      issuerUserId: requireTrimmedString(req.body.issuer_user_id, "issuer_user_id"),
      assetId: requireTrimmedString(req.body.asset_id, "asset_id"),
      totalSupply:
        req.body.total_supply === undefined
          ? 1000
          : requirePositiveInteger(req.body.total_supply, "total_supply"),
      issuerPct,
      name:
        req.body.name === undefined || req.body.name === null
          ? undefined
          : requireTrimmedString(req.body.name, "name"),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateUpdateAsset(req, _res, next) {
  try {
    const validated = cloneValidated(req);
    validated.params = {
      assetId: requireTrimmedString(req.params.assetId, "asset_id"),
    };
    validated.body = {
      issuerUserId: requireTrimmedString(req.body.issuer_user_id, "issuer_user_id"),
      name: requireTrimmedString(req.body.name, "name"),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateOrderPayload(req, _res, next) {
  try {
    const validated = cloneValidated(req);
    validated.body = {
      userId: requireTrimmedString(req.body.user_id, "user_id"),
      assetId: requireTrimmedString(req.body.asset_id, "asset_id"),
      side: requireSide(req.body.side),
      qty: requirePositiveInteger(req.body.qty, "qty"),
      limitPriceCents: requirePositiveInteger(
        req.body.limit_price_cents,
        "limit_price_cents",
      ),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateUpdateUser(req, _res, next) {
  try {
    const validated = cloneValidated(req);
    validated.params = {
      userId: requireTrimmedString(req.params.userId, "user_id"),
    };
    validated.body = {};
    if (req.body.username !== undefined) {
      validated.body.username =
        typeof req.body.username === "string" && req.body.username.trim()
          ? req.body.username.trim()
          : null;
    }
    if (req.body.avatar_url !== undefined) {
      validated.body.avatarUrl =
        typeof req.body.avatar_url === "string" && req.body.avatar_url.trim()
          ? req.body.avatar_url.trim()
          : null;
    }
    next();
  } catch (error) {
    next(error);
  }
}

function validateUserIdParam(req, _res, next) {
  try {
    const validated = cloneValidated(req);
    validated.params = {
      userId: requireTrimmedString(req.params.userId, "user_id"),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateAssetIdParam(req, _res, next) {
  try {
    const validated = cloneValidated(req);
    validated.params = {
      assetId: requireTrimmedString(req.params.assetId, "asset_id"),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateOrderIdParam(req, _res, next) {
  try {
    const validated = cloneValidated(req);
    validated.params = {
      orderId: requirePositiveInteger(req.params.orderId, "order_id"),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateTradesQuery(req, _res, next) {
  try {
    const validated = cloneValidated(req);
    validated.params = {
      assetId: requireTrimmedString(req.params.assetId, "asset_id"),
    };
    validated.query = {
      limit:
        req.query.limit === undefined
          ? 100
          : requirePositiveInteger(req.query.limit, "limit"),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateCandlesQuery(req, _res, next) {
  try {
    const validated = cloneValidated(req);
    validated.params = {
      assetId: requireTrimmedString(req.params.assetId, "asset_id"),
    };

    const intervalTrades =
      req.query.interval_trades === undefined
        ? 5
        : requirePositiveInteger(req.query.interval_trades, "interval_trades");
    const limit =
      req.query.limit === undefined
        ? 50
        : requirePositiveInteger(req.query.limit, "limit");

    if (intervalTrades > 50) {
      throw new ValidationError("interval_trades must be 50 or less.");
    }
    if (limit > 200) {
      throw new ValidationError("limit must be 200 or less.");
    }

    validated.query = {
      intervalTrades,
      limit,
    };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateCreateUser,
  validateUpdateUser,
  validateCreateAsset,
  validateUpdateAsset,
  validateOrderPayload,
  validateUserIdParam,
  validateAssetIdParam,
  validateOrderIdParam,
  validateTradesQuery,
  validateCandlesQuery,
};
