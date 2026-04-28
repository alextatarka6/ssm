const express = require("express");

const usersRoutes = require("./users");
const assetsRoutes = require("./assets");
const ordersRoutes = require("./orders");
const marketRoutes = require("./market");
const suggestionsRoutes = require("./suggestions");

const router = express.Router();

router.use("/users", usersRoutes);
router.use("/assets", assetsRoutes);
router.use("/orders", ordersRoutes);
router.use("/market", marketRoutes);
router.use("/suggestions", suggestionsRoutes);

module.exports = router;
