const express = require("express");
const { dashboardSummary, publicWeeklyStats } = require("../controllers/dashboardController");
const { authenticate, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/weekly", publicWeeklyStats);
router.get("/", authenticate, authorize("admin", "staff"), dashboardSummary);

module.exports = router;

