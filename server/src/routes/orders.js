const express = require("express");

const controller = require("../controllers/ordersController");
const asyncHandler = require("../utils/asyncHandler");
const {
  validateOrderPayload,
  validateOrderIdParam,
} = require("../middleware/validators");
const { orderLimiter } = require("../middleware/rateLimiter");
const idempotency = require("../middleware/idempotency");

const router = express.Router();

router.post("/", orderLimiter, idempotency, validateOrderPayload, asyncHandler(controller.placeOrder));
router.post("/:orderId/cancel", validateOrderIdParam, asyncHandler(controller.cancelOrder));

module.exports = router;
