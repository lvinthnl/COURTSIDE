const mongoose = require("mongoose");

const courtStatSchema = new mongoose.Schema(
  {
    court: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Court",
      required: true,
    },
    usageHours: {
      type: Number,
      default: 0,
    },
    maintenanceCount: {
      type: Number,
      default: 0,
    },
    bookingCount: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const weeklyStatsSchema = new mongoose.Schema(
  {
    weekStart: {
      type: Date,
      required: true,
    },
    sport: {
      type: String,
      enum: ["basketball", "volleyball", "badminton", "tennis", "pickleball"],
      required: true,
    },
    totalBookings: {
      type: Number,
      default: 0,
    },
    totalHours: {
      type: Number,
      default: 0,
    },
    courtStats: [courtStatSchema],
    trends: {
      type: Object,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

weeklyStatsSchema.index({ weekStart: 1, sport: 1 }, { unique: true });

module.exports = mongoose.model("WeeklyStats", weeklyStatsSchema);

