const express = require("express");

const controller = require("../controllers/marketController");
const asyncHandler = require("../utils/asyncHandler");
const {
  validateAssetIdParam,
  validateMarketTradePayload,
} = require("../middleware/validators");
const { Side } = require("../engine/constants");

const router = express.Router();

router.post("/buy", validateMarketTradePayload(Side.BUY), asyncHandler(controller.buyStock));
router.post("/sell", validateMarketTradePayload(Side.SELL), asyncHandler(controller.sellStock));
router.post("/process-orders", asyncHandler(controller.processOrders));
router.get("/order-book/:assetId", validateAssetIdParam, controller.getOrderBook);
router.get("/leaderboard", controller.getLeaderboard);

module.exports = router;
