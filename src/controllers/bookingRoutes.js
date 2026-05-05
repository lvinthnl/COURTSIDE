const express = require("express");
const {
  listBookings,
  createReservation,
  updateReservationStatus,
  cancelReservation,
  calculateEstimate,
  holdReservation,
  releaseHold,
  markReservationPaid,
} = require("../controllers/bookingController");
const { authenticate, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate);
router.get("/", listBookings);
router.post("/", createReservation);
router.post("/estimate", calculateEstimate);
router.post("/hold", holdReservation);
router.delete("/hold/:id", releaseHold);
router.patch("/:id/status", authorize("admin", "staff"), updateReservationStatus);
router.post("/:id/pay", authorize("admin", "staff"), markReservationPaid);
router.delete("/:id", cancelReservation);

module.exports = router;

