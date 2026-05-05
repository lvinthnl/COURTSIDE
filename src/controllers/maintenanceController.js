const { Maintenance, Court } = require("../models");
const { maintenanceSchema } = require("../validators/maintenanceValidators");
const { SOCKET_EVENTS, emitEvent } = require("../utils/socketEvents");

const listMaintenance = async (_req, res, next) => {
  try {
    const records = await Maintenance.find()
      .populate("court")
      .populate("createdBy", "fullName")
      .lean();
    res.status(200).json(records);
  } catch (err) {
    next(err);
  }
};

const createMaintenance = async (req, res, next) => {
  try {
    const { value, error } = maintenanceSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const record = await Maintenance.create({
      ...value,
      court: value.courtId,
      createdBy: req.user.id,
    });

    await Court.findByIdAndUpdate(value.courtId, { status: "under_maintenance" });
    emitEvent(SOCKET_EVENTS.MAINTENANCE_UPDATED, { maintenanceId: record._id });
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
};

const updateMaintenance = async (req, res, next) => {
  try {
    const { value, error } = maintenanceSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const record = await Maintenance.findByIdAndUpdate(
      req.params.id,
      { ...value, court: value.courtId },
      { new: true }
    );

    if (!record) {
      return res.status(404).json({ message: "Maintenance record not found" });
    }

    if (value.status === "completed") {
      await Court.findByIdAndUpdate(value.courtId, { status: "available" });
    }

    emitEvent(SOCKET_EVENTS.MAINTENANCE_UPDATED, { maintenanceId: record._id });
    res.status(200).json(record);
  } catch (err) {
    next(err);
  }
};

const getTomorrowMaintenance = async (_req, res, next) => {
  try {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(tomorrow.getDate() + 1);
    
    const records = await Maintenance.find({
      startTime: { $gte: tomorrow, $lt: dayAfterTomorrow },
      status: { $ne: "completed" }
    })
      .populate("court")
      .populate("createdBy", "fullName")
      .lean();
    
    res.status(200).json(records);
  } catch (err) {
    next(err);
  }
};

module.exports = { listMaintenance, createMaintenance, updateMaintenance, getTomorrowMaintenance };

