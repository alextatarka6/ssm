const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { pauseMarket, unpauseMarket } = require("../controllers/adminController");

const router = express.Router();

router.post("/market/pause", asyncHandler(pauseMarket));
router.post("/market/unpause", asyncHandler(unpauseMarket));

module.exports = router;
