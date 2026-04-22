const express = require("express");

const controller = require("../controllers/assetsController");
const asyncHandler = require("../utils/asyncHandler");
const {
  validateCreateAsset,
  validateUpdateAsset,
  validateAssetIdParam,
  validateTradesQuery,
  validateCandlesQuery,
} = require("../middleware/validators");

const router = express.Router();

router.post("/", validateCreateAsset, asyncHandler(controller.createAsset));
router.get("/", controller.listAssets);
router.get("/:assetId", validateAssetIdParam, controller.getAsset);
router.put("/:assetId", validateUpdateAsset, asyncHandler(controller.updateAsset));
router.get("/:assetId/trades", validateTradesQuery, controller.getAssetTrades);
router.get("/:assetId/candles", validateCandlesQuery, controller.getAssetCandles);

module.exports = router;
