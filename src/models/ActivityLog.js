const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actionType: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "subjectModel",
    },
    subjectModel: {
      type: String,
      required: true,
      enum: ["Booking", "Court", "Maintenance", "Payment", "User"],
    },
    metadata: {
      type: Object,
    },
  },
  { timestamps: true }
);

activityLogSchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);

