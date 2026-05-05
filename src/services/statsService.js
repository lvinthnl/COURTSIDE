const { startOfWeek, subWeeks } = require("date-fns");
const { Booking, Maintenance, WeeklyStats } = require("../models");
const { SOCKET_EVENTS, emitEvent } = require("../utils/socketEvents");

const SPORTS = ["basketball", "volleyball", "badminton", "tennis", "pickleball"];

const generateWeeklyStats = async (referenceDate = new Date()) => {
  const weekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(weekStart.getDate() + 7);

  const statsPromises = SPORTS.map(async (sport) => {
    // Aggregate booked reservations (excluding cancelled)
    const bookings = await Booking.aggregate([
      {
        $match: {
          bookingDate: { $gte: weekStart, $lt: nextWeekStart },
          status: { $ne: "cancelled" },
        },
      },
      {
        $lookup: {
          from: "courts",
          localField: "court",
          foreignField: "_id",
          as: "court",
        },
      },
      {
        $unwind: "$court",
      },
      {
        $match: { "court.courtType": sport },
      },
      {
        $group: {
          _id: "$court._id",
          usageHours: { $sum: "$totalHours" },
          bookingCount: { $sum: 1 },
        },
      },
    ]);

    const maintenance = await Maintenance.aggregate([
      {
        $match: {
          startTime: { $gte: weekStart, $lt: nextWeekStart },
        },
      },
      {
        $lookup: {
          from: "courts",
          localField: "court",
          foreignField: "_id",
          as: "court",
        },
      },
      {
        $unwind: "$court",
      },
      { $match: { "court.courtType": sport } },
      {
        $group: {
          _id: "$court._id",
          maintenanceCount: { $sum: 1 },
        },
      },
    ]);

    const courtStats = bookings.map((item) => ({
      court: item._id,
      usageHours: item.usageHours,
      bookingCount: item.bookingCount,
      maintenanceCount:
        maintenance.find((maint) => maint._id.toString() === item._id.toString())?.maintenanceCount || 0,
    }));

    const totalBookings = courtStats.reduce((sum, stat) => sum + stat.bookingCount, 0);
    const totalHours = courtStats.reduce((sum, stat) => sum + stat.usageHours, 0);

    const trends = await WeeklyStats.findOne({
      weekStart: subWeeks(weekStart, 1),
      sport,
    }).lean();

    return WeeklyStats.findOneAndUpdate(
      { weekStart, sport },
      {
        weekStart,
        sport,
        courtStats,
        totalBookings,
        totalHours,
        trends: trends ? { previousTotalBookings: trends.totalBookings, previousTotalHours: trends.totalHours } : {},
      },
      { upsert: true, new: true }
    );
  });

  const results = await Promise.all(statsPromises);
  emitEvent(SOCKET_EVENTS.DASHBOARD_REFRESH, {});
  return results;
};

module.exports = { generateWeeklyStats };

