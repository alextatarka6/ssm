const express = require("express");

const controller = require("../controllers/ordersController");
const asyncHandler = require("../utils/asyncHandler");
const {
  validateOrderPayload,
  validateOrderIdParam,
} = require("../middleware/validators");

const router = express.Router();

router.post("/", validateOrderPayload, asyncHandler(controller.placeOrder));
router.post("/:orderId/cancel", validateOrderIdParam, asyncHandler(controller.cancelOrder));

module.exports = router;
