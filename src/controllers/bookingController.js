const { Booking, Payment, Staff, Hold, Court, User, SlotStatus } = require("../models");
const { bookingSchema, bookingStatusSchema, partialCancelSchema, extendSchema } = require("../validators/bookingValidators");
const { createBooking, calculateTotals, hasConflict } = require("../services/bookingService");
const { formatDateKey } = require("../utils/date");
const { SOCKET_EVENTS, emitEvent } = require("../utils/socketEvents");

const TERMINAL_STATUSES = ["cancelled", "completed"];
const CANCELLATION_ROLES = ["customer", "admin", "staff"];

const listBookings = async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role === "customer") {
      filter.customer = req.user.id;
    }

    const bookings = await Booking.find(filter)
      .populate("court")
      .populate("customer", "fullName email phoneNumber")
      .populate("staff", "fullName")
      .populate("paymentStatus")
      .lean();
    res.status(200).json(bookings);
  } catch (err) {
    next(err);
  }
};

const createReservation = async (req, res, next) => {
  try {
    const { value, error } = bookingSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    // BUG-11 fix: customers always get 'web' source regardless of what they send
    const source = req.user.role === "customer" ? "web" : (value.source || "walk_in");

    let customerId = req.user.role === "customer" ? req.user.id : value.customerId;
    let walkInName = null;
    if (req.user.role !== "customer") {
      if (source === "walk_in") {
        walkInName = (value.walkInName || value.walkinName || "").trim();
        if (!walkInName && !customerId) {
          return res.status(400).json({ message: "walkInName or customerId is required for walk-in reservations" });
        }
      } else if (!customerId) {
        return res.status(400).json({ message: "customerId is required for web reservations" });
      }
    }

    // BUG-08 fix: validate that the provided customerId is a real user
    if (req.user.role !== "customer" && customerId) {
      const customerUser = await User.findById(customerId).lean();
      if (!customerUser) {
        return res.status(404).json({ message: "Customer not found — verify the customer ID" });
      }
      walkInName = null;
    }

    // BUG-10 fix: require a matching Staff record for non-customer users
    let staffId;
    if (req.user.role !== "customer") {
      const staffRecord = await Staff.findOne({ userAccount: req.user.id });
      if (!staffRecord) {
        return res.status(400).json({ message: "No staff record linked to this user account" });
      }
      staffId = staffRecord._id;
    }

    const booking = await createBooking({
      customerId,
      walkInName,
      courtId: value.courtId,
      staffId,
      startTime: value.startTime,
      endTime: value.endTime,
      notes: value.notes,
      source,
    });

    const payment = await Payment.create({
      booking: booking._id,
      amount: booking.estimatedCost,
      status: "unpaid",
      paymentMethod: "face_to_face",
    });

    booking.paymentStatus = payment._id;
    await booking.save();

    const populated = await Booking.findById(booking._id)
      .populate("court")
      .populate("customer", "fullName email phoneNumber")
      .populate("paymentStatus")
      .lean();

    // Clean up any holds that now overlap this booking
    try {
      await Hold.deleteMany({
        court: booking.court,
        startTime: { $lt: booking.endTime },
        endTime: { $gt: booking.startTime },
      });
    } catch (err) {
      console.warn("Failed to cleanup holds:", err.message);
    }

    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

const holdReservation = async (req, res, next) => {
  try {
    const { courtId, startTime, endTime, ttlMinutes = 5 } = req.body;
    if (!courtId || !startTime || !endTime) {
      return res.status(400).json({ message: "courtId, startTime and endTime are required" });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    const expiresAt = new Date(Date.now() + Number(ttlMinutes) * 60 * 1000);

    if (await hasConflict({ courtId, startTime: start, endTime: end })) {
      return res.status(409).json({ message: "Slot no longer available" });
    }

    const hold = await Hold.create({
      court: courtId,
      startTime: start,
      endTime: end,
      expiresAt,
      createdBy: req.user ? req.user.id : undefined,
    });

    res.status(201).json(hold);
  } catch (err) {
    next(err);
  }
};

const releaseHold = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "Hold id required" });
    const hold = await Hold.findById(id);
    if (!hold) return res.status(404).json({ message: "Hold not found" });
    if (req.user && req.user.role === "customer" && String(hold.createdBy) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    await Hold.deleteOne({ _id: id });
    res.status(200).json({ message: "Hold released" });
  } catch (err) {
    next(err);
  }
};

const updateReservationStatus = async (req, res, next) => {
  try {
    const { value, error } = bookingStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    booking.status = value.status;
    if (value.status === "checked_in") {
      booking.checkedInAt = new Date();
    }
    if (value.status === "completed") {
      booking.checkedOutAt = new Date();
    }

    await booking.save();
    emitEvent(SOCKET_EVENTS.RESERVATION_UPDATED, { bookingId: booking._id });

    const populated = await Booking.findById(booking._id)
      .populate("court")
      .populate("customer", "fullName email phoneNumber")
      .populate("paymentStatus")
      .lean();

    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

const cancelReservation = async (req, res, next) => {
  try {
    if (!CANCELLATION_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // BUG-01 fix: guard against cancelling already-terminal bookings
    if (booking.status === "cancelled") {
      return res.status(409).json({ message: "Booking is already cancelled" });
    }
    if (booking.status === "completed") {
      return res.status(409).json({ message: "Cannot cancel a completed booking" });
    }

    if (req.user.role === "customer" && (!booking.customer || booking.customer.toString() !== req.user.id.toString())) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const dateKey = formatDateKey(booking.startTime);
    const startHr = new Date(booking.startTime).getHours();
    const endHr = new Date(booking.endTime).getHours();
    try {
      await Hold.deleteMany({
        court: booking.court,
        startTime: { $lt: booking.endTime },
        endTime: { $gt: booking.startTime },
      });
      // Delete by booking ID so we never accidentally wipe another booking's slots
      await SlotStatus.deleteMany({ booking: booking._id });
      // Fallback: also sweep by range in case SlotStatus pre-dates the booking-ID field
      await SlotStatus.deleteMany({
        court: booking.court,
        dateKey,
        hour: { $gte: startHr, $lt: endHr },
        status: "R",
        booking: { $exists: false },
      });
    } catch (err) {
      console.error("SlotStatus cleanup failed for booking", booking._id, ":", err.message || err);
    }

    await Payment.deleteMany({ booking: booking._id });
    await Booking.deleteOne({ _id: booking._id });

    emitEvent(SOCKET_EVENTS.RESERVATION_UPDATED, { bookingId: booking._id });
    emitEvent(SOCKET_EVENTS.DASHBOARD_REFRESH, {});

    res.status(200).json({ message: "Booking deleted" });
  } catch (err) {
    next(err);
  }
};

// Partial cancellation: remove specific hours from an existing booking
const partialCancelReservation = async (req, res, next) => {
  try {
    const { value, error } = partialCancelSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.message });

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.status === "cancelled") {
      return res.status(409).json({ message: "Booking is already cancelled" });
    }
    if (booking.status === "completed") {
      return res.status(409).json({ message: "Cannot modify a completed booking" });
    }
    if (req.user.role === "customer" && (!booking.customer || booking.customer.toString() !== req.user.id.toString())) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const startHour = new Date(booking.startTime).getHours();
    const endHour = new Date(booking.endTime).getHours();
    const allBookingHours = [];
    for (let h = startHour; h < endHour; h++) allBookingHours.push(h);

    const alreadyCancelled = booking.cancelledHours || [];
    const toCancel = value.hours;

    for (const h of toCancel) {
      if (!allBookingHours.includes(h)) {
        return res.status(400).json({ message: `Hour ${h}:00 is not part of this booking (${startHour}:00–${endHour}:00)` });
      }
      if (alreadyCancelled.includes(h)) {
        return res.status(400).json({ message: `Hour ${h}:00 is already cancelled` });
      }
    }

    const newCancelledHours = [...alreadyCancelled, ...toCancel];
    const remainingHours = allBookingHours.filter((h) => !newCancelledHours.includes(h));

    booking.cancelledHours = newCancelledHours;
    booking.totalHours = remainingHours.length;

    const court = await Court.findById(booking.court);
    const hourlyRate = court?.hourlyRate || 150;
    booking.estimatedCost = remainingHours.length * hourlyRate;

    // Free the SlotStatus records for the cancelled hours
    const dateKey = formatDateKey(booking.startTime);
    await SlotStatus.deleteMany({ court: booking.court, dateKey, hour: { $in: toCancel } });

    if (remainingHours.length === 0) {
      await Payment.deleteMany({ booking: booking._id });
      await Booking.deleteOne({ _id: booking._id });
      emitEvent(SOCKET_EVENTS.RESERVATION_UPDATED, { bookingId: booking._id });
      emitEvent(SOCKET_EVENTS.DASHBOARD_REFRESH, {});
      return res.status(200).json({
        message: "All hours removed. Reservation deleted.",
        deleted: true,
      });
    }

    await booking.save();

    // Update payment amount to reflect new cost
    const payment = await Payment.findOne({ booking: booking._id });
    if (payment && payment.status !== "paid") {
      payment.amount = booking.estimatedCost;
      await payment.save();
    }

    emitEvent(SOCKET_EVENTS.RESERVATION_UPDATED, { bookingId: booking._id });
    emitEvent(SOCKET_EVENTS.DASHBOARD_REFRESH, {});

    res.status(200).json({
      message:
        `${toCancel.length} hour(s) removed. ${remainingHours.length} hour(s) remain.`,
      cancelledHours: newCancelledHours,
      remainingHours,
      totalHours: remainingHours.length,
      estimatedCost: booking.estimatedCost,
      status: booking.status,
      deleted: false,
    });
  } catch (err) {
    next(err);
  }
};

// Extend reservation end time by adding consecutive hours (admin/staff only)
const extendReservation = async (req, res, next) => {
  try {
    const { value, error } = extendSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.message });

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (TERMINAL_STATUSES.includes(booking.status)) {
      return res.status(409).json({ message: `Cannot extend a ${booking.status} booking` });
    }

    const currentEndHour = new Date(booking.endTime).getHours();
    const newEndHour = value.extendToHour;

    if (newEndHour <= currentEndHour) {
      return res.status(400).json({
        message: `New end time (${newEndHour}:00) must be later than current end time (${currentEndHour}:00)`,
      });
    }

    // Build the new end datetime on the same booking day
    const newEndTime = new Date(booking.endTime);
    newEndTime.setHours(newEndHour, 0, 0, 0);

    // Conflict-check the extension window only
    const extensionConflict = await hasConflict({
      courtId: booking.court,
      startTime: booking.endTime,
      endTime: newEndTime,
    });
    if (extensionConflict) {
      return res.status(409).json({
        message: `Time slot ${currentEndHour}:00–${newEndHour}:00 is not available for extension`,
      });
    }

    const court = await Court.findById(booking.court);
    const hourlyRate = court?.hourlyRate || 150;
    const addedHours = newEndHour - currentEndHour;

    booking.endTime = newEndTime;
    booking.totalHours = booking.totalHours + addedHours;
    booking.estimatedCost = booking.estimatedCost + addedHours * hourlyRate;
    await booking.save();

    // Create SlotStatus records for the new hours
    const dateKey = formatDateKey(booking.startTime);
    const ops = [];
    for (let h = currentEndHour; h < newEndHour; h++) {
      ops.push({
        updateOne: {
          filter: { court: booking.court, dateKey, hour: h },
          update: { $set: { court: booking.court, dateKey, hour: h, status: "R", booking: booking._id } },
          upsert: true,
        },
      });
    }
    if (ops.length > 0) await SlotStatus.bulkWrite(ops);

    // Reflect updated cost on the payment record
    const payment = await Payment.findOne({ booking: booking._id });
    if (payment && payment.status !== "paid") {
      payment.amount = booking.estimatedCost;
      await payment.save();
    }

    emitEvent(SOCKET_EVENTS.RESERVATION_UPDATED, { bookingId: booking._id });
    emitEvent(SOCKET_EVENTS.DASHBOARD_REFRESH, {});

    const populated = await Booking.findById(booking._id)
      .populate("court")
      .populate("customer", "fullName email phoneNumber")
      .populate("paymentStatus")
      .lean();

    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

const calculateEstimate = async (req, res, next) => {
  try {
    const { startTime, endTime, hourlyRate } = req.body;
    if (!startTime || !endTime) {
      return res.status(400).json({ message: "startTime and endTime are required" });
    }

    const totals = calculateTotals(startTime, endTime, hourlyRate);
    res.status(200).json(totals);
  } catch (err) {
    next(err);
  }
};

const markReservationPaid = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.status === "cancelled") {
      return res.status(409).json({ message: "Cannot mark a cancelled booking as paid" });
    }

    let payment = await Payment.findOne({ booking: booking._id });
    if (!payment) {
      payment = await Payment.create({
        booking: booking._id,
        amount: booking.estimatedCost || 0,
        status: "unpaid",
        paymentMethod: "face_to_face",
      });
    }

    payment.status = "paid";
    payment.confirmationDate = new Date();
    await payment.save();

    if (["pending", "confirmed", "checked_in"].includes(booking.status)) {
      booking.status = "completed";
      booking.checkedOutAt = booking.checkedOutAt || new Date();
      await booking.save();
    }

    emitEvent(SOCKET_EVENTS.RESERVATION_UPDATED, { bookingId: booking._id });
    emitEvent(SOCKET_EVENTS.DASHBOARD_REFRESH, {});

    const populated = await Booking.findById(booking._id)
      .populate("court")
      .populate("customer", "fullName email phoneNumber")
      .populate("paymentStatus")
      .lean();

    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listBookings,
  createReservation,
  holdReservation,
  releaseHold,
  updateReservationStatus,
  cancelReservation,
  partialCancelReservation,
  extendReservation,
  calculateEstimate,
  markReservationPaid,
};
