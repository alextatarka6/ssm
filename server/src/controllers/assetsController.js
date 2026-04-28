const marketService = require("../services/marketService");

async function createAsset(req, res) {
  const asset = await marketService.mutate((market) =>
    market.createPersonAsset(req.validated.body),
  );

  res.status(201).json({
    ok: true,
    asset,
  });
}

async function updateAsset(req, res) {
  const asset = await marketService.mutate((market) =>
    market.updateAsset(req.validated.params.assetId, req.validated.body),
  );

  res.json({
    ok: true,
    asset,
  });
}

function listAssets(_req, res) {
  res.json(marketService.getMarket().listAssets());
}

function getAsset(req, res) {
  res.json(marketService.getMarket().getAsset(req.validated.params.assetId));
}

function getAssetTrades(req, res) {
  res.json(
    marketService.getMarket().getTrades(
      req.validated.params.assetId,
      req.validated.query.limit,
    ),
  );
}

function getAssetCandles(req, res) {
  res.json(
    marketService.getMarket().getCandles(
      req.validated.params.assetId,
      req.validated.query.intervalTrades,
      req.validated.query.limit,
    ),
  );
}

function getAssetOrderBook(req, res) {
  res.json(marketService.getMarket().getOrderBook(req.validated.params.assetId));
}

module.exports = {
  createAsset,
  updateAsset,
  listAssets,
  getAsset,
  getAssetTrades,
  getAssetCandles,
  getAssetOrderBook,
};
