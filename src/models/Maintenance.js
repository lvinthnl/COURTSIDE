const mongoose = require("mongoose");

const maintenanceSchema = new mongoose.Schema(
  {
    court: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Court",
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
    remarks: {
      type: String,
      trim: true,
      maxlength: 250,
    },
    status: {
      type: String,
      enum: ["scheduled", "in_progress", "completed"],
      default: "scheduled",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
    },
  },
  { timestamps: true }
);

maintenanceSchema.index({ court: 1, startTime: 1, endTime: 1 });

module.exports = mongoose.model("Maintenance", maintenanceSchema);

