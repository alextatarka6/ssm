const express = require("express");

const controller = require("../controllers/usersController");
const asyncHandler = require("../utils/asyncHandler");
const {
  validateCreateUser,
  validateUpdateUser,
  validateUserIdParam,
} = require("../middleware/validators");

const router = express.Router();

router.post("/", validateCreateUser, asyncHandler(controller.createUser));
router.get("/", controller.listUsers);
router.delete("/me", controller.deleteCurrentUser);
router.get("/:userId", validateUserIdParam, controller.getUser);
router.put("/:userId", validateUpdateUser, asyncHandler(controller.updateUser));
router.get("/:userId/balance", validateUserIdParam, controller.getBalance);
router.get("/:userId/portfolio", validateUserIdParam, controller.getPortfolio);
router.get("/:userId/orders", validateUserIdParam, controller.getUserOrders);

module.exports = router;
