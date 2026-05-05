const express = require("express");
const { listCourts, createCourt, updateCourt, availability } = require("../controllers/courtController");
const { authenticate, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", listCourts);
router.get("/availability", availability);
router.post("/", authenticate, authorize("admin", "staff"), createCourt);
router.put("/:id", authenticate, authorize("admin", "staff"), updateCourt);

module.exports = router;

