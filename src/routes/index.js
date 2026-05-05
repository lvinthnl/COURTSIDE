const express = require("express");
const authRoutes = require("./authRoutes");
const courtRoutes = require("./courtRoutes");
const bookingRoutes = require("./bookingRoutes");
const maintenanceRoutes = require("./maintenanceRoutes");
const dashboardRoutes = require("./dashboardRoutes");

const router = express.Router();

// DB status endpoint for quick local checks
router.get("/db-status", (_req, res) => {
	try {
		const mongoose = require("mongoose");
		const state = mongoose.connection.readyState; // 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
		const states = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
		return res.status(200).json({ state, status: states[state] || "unknown" });
	} catch (err) {
		return res.status(500).json({ error: "Unable to determine DB status", details: err.message });
	}
});

router.use("/auth", authRoutes);
router.use("/courts", courtRoutes);
router.use("/reservations", bookingRoutes);
router.use("/maintenance", maintenanceRoutes);
router.use("/dashboard", dashboardRoutes);

module.exports = router;

