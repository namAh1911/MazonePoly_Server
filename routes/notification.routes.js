const express = require("express");
const router = express.Router();
const authMiddleware  = require("../middleware/authMiddleware");
const notificationController = require("../controllers/notification.controller");

router.get("/my-notifications", authMiddleware,notificationController.getMyNotifications);
router.put("/mark-all-read", authMiddleware, notificationController.markAllRead);

module.exports = router;
