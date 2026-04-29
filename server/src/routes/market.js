const express = require("express");

const controller = require("../controllers/marketController");

const router = express.Router();

router.get("/leaderboard", controller.getLeaderboard);

module.exports = router;
