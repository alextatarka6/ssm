const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { postSuggestion } = require("../controllers/suggestionsController");

const router = express.Router();

router.post("/", asyncHandler(postSuggestion));

module.exports = router;
