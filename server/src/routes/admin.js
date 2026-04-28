const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { pauseMarket, unpauseMarket, resetMarket, resetUser } = require("../controllers/adminController");

const router = express.Router();

router.post("/market/pause", asyncHandler(pauseMarket));
router.post("/market/unpause", asyncHandler(unpauseMarket));
router.post("/market/reset", asyncHandler(resetMarket));
router.post("/users/:userId/reset", asyncHandler(resetUser));

module.exports = router;
