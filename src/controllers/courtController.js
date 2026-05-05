const { Court } = require("../models");
const { courtSchema } = require("../validators/courtValidators");
const { getAvailability } = require("../services/bookingService");
const { SOCKET_EVENTS, emitEvent } = require("../utils/socketEvents");

const listCourts = async (_req, res, next) => {
  try {
    const courts = await Court.find().lean();
    res.status(200).json(courts);
  } catch (err) {
    next(err);
  }
};

const createCourt = async (req, res, next) => {
  try {
    const { value, error } = courtSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const court = await Court.create(value);
    emitEvent(SOCKET_EVENTS.COURT_STATUS_CHANGED, { courtId: court._id });
    res.status(201).json(court);
  } catch (err) {
    next(err);
  }
};

const updateCourt = async (req, res, next) => {
  try {
    const { value, error } = courtSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const court = await Court.findByIdAndUpdate(req.params.id, value, { new: true });
    if (!court) {
      return res.status(404).json({ message: "Court not found" });
    }
    emitEvent(SOCKET_EVENTS.COURT_STATUS_CHANGED, { courtId: court._id });
    res.status(200).json(court);
  } catch (err) {
    next(err);
  }
};

const availability = async (req, res, next) => {
  try {
    const { sport, date, rangeDays } = req.query;
    if (!sport || !date) {
      return res.status(400).json({ message: "sport and date query parameters are required" });
    }

    const payload = await getAvailability({
      courtType: sport,
      date,
      rangeDays: rangeDays ? Number(rangeDays) : 1,
    });
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
};

module.exports = { listCourts, createCourt, updateCourt, availability };

