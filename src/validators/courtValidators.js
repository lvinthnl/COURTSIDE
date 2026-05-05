const Joi = require("joi");

const courtSchema = Joi.object({
  courtName: Joi.string().max(100).required(),
  courtType: Joi.string().valid("basketball", "volleyball", "badminton", "tennis", "pickleball").required(),
  location: Joi.string().max(100).required(),
  hourlyRate: Joi.number().min(0).default(150),
  status: Joi.string().valid("available", "under_maintenance", "reserved").default("available"),
  notes: Joi.string().max(250).allow("", null),
});

module.exports = { courtSchema };

