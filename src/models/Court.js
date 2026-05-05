const mongoose = require("mongoose");

const courtSchema = new mongoose.Schema(
  {
    courtName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    courtType: {
      type: String,
      required: true,
      enum: ["basketball", "volleyball", "badminton", "tennis", "pickleball"],
    },
    location: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    hourlyRate: {
      type: Number,
      required: true,
      default: 150,
    },
    status: {
      type: String,
      enum: ["available", "under_maintenance", "reserved"],
      default: "available",
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 250,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

courtSchema.index({ courtType: 1, status: 1 });

module.exports = mongoose.model("Court", courtSchema);

