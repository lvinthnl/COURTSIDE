const { startOfDay, endOfDay, startOfWeek } = require("date-fns");
const { Booking, Court, WeeklyStats, Payment } = require("../models");
const { generateWeeklyStats } = require("../services/statsService");

const ensureCurrentWeekStats = async () => {
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const latest = await WeeklyStats.findOne().sort({ weekStart: -1 }).lean();

  if (!latest || new Date(latest.weekStart).getTime() !== currentWeekStart.getTime()) {
    await generateWeeklyStats();
  }
};

const dashboardSummary = async (_req, res, next) => {
  try {
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    await ensureCurrentWeekStats();

    const [todayBookings, courtCounts, latestStats] = await Promise.all([
      Booking.find({
        bookingDate: { $gte: todayStart, $lte: todayEnd },
        status: { $ne: "cancelled" },
      })
        .populate("court")
        .populate("customer", "fullName email phoneNumber")
        .populate("paymentStatus")
        .lean(),
      Court.aggregate([
        {
          $group: {
            _id: "$courtType",
            totalCourts: { $sum: 1 },
            maintenance: {
              $sum: { $cond: [{ $eq: ["$status", "under_maintenance"] }, 1, 0] },
            },
            available: {
              $sum: { $cond: [{ $eq: ["$status", "available"] }, 1, 0] },
            },
          },
        },
      ]),
      WeeklyStats.find().sort({ weekStart: -1 }).limit(5).lean(),
    ]);

    // Ensure 'available' reflects total courts minus maintenance (only maintenance reduces availability)
    const adjustedCourtCounts = (courtCounts || []).map((item) => ({
      _id: item._id,
      totalCourts: item.totalCourts || 0,
      maintenance: item.maintenance || 0,
      available: (item.totalCourts || 0) - (item.maintenance || 0),
    }));

    res.status(200).json({
      todayBookings,
      courtCounts: adjustedCourtCounts,
      weeklyStats: latestStats,
    });
  } catch (err) {
    next(err);
  }
};

const publicWeeklyStats = async (_req, res, next) => {
  try {
    await ensureCurrentWeekStats();
    const latestStats = await WeeklyStats.find().sort({ weekStart: -1 }).limit(5).lean();
    res.status(200).json(latestStats);
  } catch (err) {
    next(err);
  }
};

module.exports = { dashboardSummary, publicWeeklyStats };

