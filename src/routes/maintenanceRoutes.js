const express = require("express");
const { listMaintenance, createMaintenance, updateMaintenance, getTodayMaintenance } = require("../controllers/maintenanceController");
const { authenticate, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/today", getTodayMaintenance);
router.use(authenticate, authorize("admin", "staff"));
router.get("/", listMaintenance);
router.post("/", createMaintenance);
router.put("/:id", updateMaintenance);

module.exports = router;

