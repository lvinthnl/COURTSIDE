const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["paid", "unpaid"],
      default: "unpaid",
    },
    confirmationDate: Date,
    paymentMethod: {
      type: String,
      enum: ["cash", "face_to_face"],
      default: "cash",
    },
  },
  { timestamps: true }
);

paymentSchema.index({ status: 1 });

module.exports = mongoose.model("Payment", paymentSchema);

