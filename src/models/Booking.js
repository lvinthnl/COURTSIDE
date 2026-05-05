const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    walkInName: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    court: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Court",
      required: true,
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
    },
    bookingDate: {
      type: Date,
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    totalHours: {
      type: Number,
      required: true,
      min: 1,
    },
    estimatedCost: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "checked_in", "completed", "cancelled"],
      default: "pending",
    },
    paymentStatus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 250,
    },
    source: {
      type: String,
      enum: ["web", "walk_in"],
      default: "web",
    },
    checkedInAt: Date,
    checkedOutAt: Date,
    cancelledHours: {
      type: [Number],
      default: [],
    },
  },
  { timestamps: true }
);

bookingSchema.index({ court: 1, startTime: 1, endTime: 1 });
bookingSchema.index({ customer: 1, bookingDate: -1 });

module.exports = mongoose.model("Booking", bookingSchema);

