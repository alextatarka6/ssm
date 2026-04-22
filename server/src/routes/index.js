const express = require("express");

const usersRoutes = require("./users");
const assetsRoutes = require("./assets");
const ordersRoutes = require("./orders");
const marketRoutes = require("./market");

const router = express.Router();

router.use("/users", usersRoutes);
router.use("/assets", assetsRoutes);
router.use("/orders", ordersRoutes);
router.use("/market", marketRoutes);

module.exports = router;
