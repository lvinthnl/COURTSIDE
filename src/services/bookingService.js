const { startOfDay, addDays } = require("date-fns");
const { Booking, Maintenance, Court, Hold, SlotStatus } = require("../models");
const { SOCKET_EVENTS, emitEvent } = require("../utils/socketEvents");
const { formatDateKey } = require("../utils/date");

const RATE_PER_HOUR = 150;

const getAvailability = async ({ courtType, date, rangeDays = 1 }) => {
  const startOfSelectedDay = startOfDay(new Date(date));
  const availabilityStart = new Date(startOfSelectedDay);
  availabilityStart.setHours(7, 0, 0, 0);
  const availabilityEnd = addDays(startOfSelectedDay, rangeDays);
  availabilityEnd.setHours(21, 0, 0, 0);

  const courts = await Court.find({ courtType, isActive: true }).lean();
  const courtIds = courts.map((court) => court._id);

  const bookings = await Booking.find({
    court: { $in: courtIds },
    startTime: { $lt: availabilityEnd },
    endTime: { $gt: availabilityStart },
    status: { $in: ["pending", "confirmed", "checked_in"] },
  }).lean();

  const maintenance = await Maintenance.find({
    court: { $in: courtIds },
    startTime: { $lt: availabilityEnd },
    endTime: { $gt: availabilityStart },
    status: { $ne: "completed" },
  }).lean();

  // active holds (not expired) that overlap the availability window
  const now = new Date();
  const holds = await Hold.find({
    court: { $in: courtIds },
    expiresAt: { $gt: now },
    startTime: { $lt: availabilityEnd },
    endTime: { $gt: availabilityStart },
  }).lean();

  // slot statuses (R = reserved) for the window
  const dateKeys = [];
  for (let offset = 0; offset < rangeDays; offset++) {
    dateKeys.push(formatDateKey(addDays(startOfSelectedDay, offset)));
  }

  const slotStatuses = await SlotStatus.find({
    court: { $in: courtIds },
    dateKey: { $in: dateKeys },
  }).lean();

  // Compute per-court, per-day available hours (7..20) based on bookings and maintenance
  // We'll return `availableHoursByDate` for each court (keyed by YYYY-MM-DD)
  for (const court of courts) {
    const availableHoursByDate = {};
    for (let dayIndex = 0; dayIndex < rangeDays; dayIndex++) {
      const day = addDays(startOfSelectedDay, dayIndex);
      const key = formatDateKey(day);
      const hours = [];
      for (let hour = 7; hour < 21; hour++) {
        const slotStart = new Date(day);
        slotStart.setHours(hour, 0, 0, 0);
        const slotEnd = new Date(day);
        slotEnd.setHours(hour + 1, 0, 0, 0);

        const isBooked = bookings.some((booking) => {
          const bookingCourtId = booking.court && booking.court._id ? String(booking.court._id) : String(booking.court);
          if (String(court._id) !== bookingCourtId) return false;
          const start = new Date(booking.startTime);
          const end = new Date(booking.endTime);
          return start < slotEnd && end > slotStart;
        });

        const isSlotMarkedR = slotStatuses.some((s) => {
          const sCourtId = s.court && s.court._id ? String(s.court._id) : String(s.court);
          if (String(court._id) !== sCourtId) return false;
          if (s.dateKey !== key) return false;
          return s.hour === hour && s.status === 'R';
        });

        const isHold = holds.some((h) => {
          const holdCourtId = h.court && h.court._id ? String(h.court._id) : String(h.court);
          if (String(court._id) !== holdCourtId) return false;
          const start = new Date(h.startTime);
          const end = new Date(h.endTime);
          return start < slotEnd && end > slotStart;
        });

        const isMaintenance = maintenance.some((record) => {
          const recordCourtId = record.court && record.court._id ? String(record.court._id) : String(record.court);
          if (String(court._id) !== recordCourtId) return false;
          const start = new Date(record.startTime);
          const end = new Date(record.endTime);
          return start < slotEnd && end > slotStart;
        });

        const isPast = slotStart < new Date();
        if (!isBooked && !isHold && !isMaintenance && !isSlotMarkedR && !isPast) {
          hours.push(hour);
        }
      }
      availableHoursByDate[key] = hours;
    }
    // convenience: availableHours for the requested start date
    court.availableHoursByDate = availableHoursByDate;
    court.availableHours = availableHoursByDate[formatDateKey(startOfSelectedDay)] || [];
  }

  return { courts, bookings, maintenance };
};

const hasConflict = async ({ courtId, startTime, endTime, excludeHoldCreatedBy = null }) => {
  const conflict = await Booking.exists({
    court: courtId,
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
    status: { $in: ["pending", "confirmed", "checked_in"] },
  });

  if (conflict) return true;

  const maintenanceConflict = await Maintenance.exists({
    court: courtId,
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
    status: { $in: ["scheduled", "in_progress"] },
  });

  if (maintenanceConflict) return true;

  // consider active holds as conflicts
  const now = new Date();
  const holdQuery = {
    court: courtId,
    expiresAt: { $gt: now },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  };
  if (excludeHoldCreatedBy) {
    holdQuery.createdBy = { $ne: excludeHoldCreatedBy };
  }
  const holdConflict = await Hold.exists(holdQuery);

  if (holdConflict) return true;

  // check SlotStatus 'R' conflicts for overlapping hours
  const startDateKey = formatDateKey(startTime);
  // build hour ranges between start and end (assumes same day or contiguous whole hours)
  const startHour = startTime.getHours();
  const endHour = endTime.getHours();
  const conditions = [];
  for (let h = startHour; h < endHour; h++) {
    conditions.push({ court: courtId, dateKey: startDateKey, hour: h, status: 'R' });
  }
  if (conditions.length > 0) {
    const slotConflict = await SlotStatus.exists({ $or: conditions });
    if (slotConflict) return true;
  }

  return false;
};

const calculateTotals = (startTime, endTime, hourlyRate = RATE_PER_HOUR) => {
  const ms = new Date(endTime) - new Date(startTime);
  const hours = Math.round(ms / (1000 * 60 * 60));
  return {
    totalHours: hours,
    totalCost: hours * hourlyRate,
  };
};

const createBooking = async ({ customerId, walkInName, courtId, staffId, startTime, endTime, notes, source }) => {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const court = await Court.findById(courtId);

  if (!court) {
    throw new Error("Court not found");
  }

  if (start >= end) {
    throw new Error("End time must be after start time");
  }

  if (start.getHours() < 7 || end.getHours() > 21) {
    throw new Error("Bookings are allowed between 07:00 and 21:00 only");
  }

  // Block bookings for past calendar days (allow current-day walk-ins)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bookingDay = new Date(start);
  bookingDay.setHours(0, 0, 0, 0);
  if (bookingDay < today) {
    throw new Error("Cannot create a booking for a past date");
  }

  if (await hasConflict({ courtId, startTime: start, endTime: end, excludeHoldCreatedBy: customerId })) {
    throw new Error("Selected time slot is no longer available");
  }

  const { totalHours, totalCost } = calculateTotals(start, end, court.hourlyRate);

  const booking = await Booking.create({
    customer: customerId,
    walkInName,
    court: courtId,
    staff: staffId,
    bookingDate: start,
    startTime: start,
    endTime: end,
    totalHours,
    estimatedCost: totalCost,
    notes,
    source,
    status: source === "web" ? "pending" : "confirmed",
  });

  // Mark per-hour SlotStatus records as 'R' (reserved), linked to this booking
  try {
    const dateKey = formatDateKey(start);
    if (start.getHours() < end.getHours()) {
      const ops = [];
      for (let h = start.getHours(); h < end.getHours(); h++) {
        ops.push({
          updateOne: {
            filter: { court: courtId, dateKey, hour: h },
            update: { $set: { court: courtId, dateKey, hour: h, status: 'R', booking: booking._id } },
            upsert: true,
          },
        });
      }
      await SlotStatus.bulkWrite(ops);
    }
  } catch (err) {
    console.warn('Failed to write SlotStatus records:', err.message || err);
  }

  emitEvent(SOCKET_EVENTS.RESERVATION_UPDATED, { bookingId: booking._id });
  emitEvent(SOCKET_EVENTS.DASHBOARD_REFRESH, {});

  return booking;
};

module.exports = {
  getAvailability,
  hasConflict,
  calculateTotals,
  createBooking,
};

