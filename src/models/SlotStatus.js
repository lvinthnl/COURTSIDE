const mongoose = require('mongoose');

const slotStatusSchema = new mongoose.Schema(
  {
    court: { type: mongoose.Schema.Types.ObjectId, ref: 'Court', required: true },
    dateKey: { type: String, required: true }, // YYYY-MM-DD
    hour: { type: Number, required: true }, // 7..20
    status: { type: String, required: true, enum: ['A','R','M'], default: 'A' },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  },
  { timestamps: true }
);

slotStatusSchema.index({ court: 1, dateKey: 1, hour: 1 }, { unique: true });

module.exports = mongoose.model('SlotStatus', slotStatusSchema);
