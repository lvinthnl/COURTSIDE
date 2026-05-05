const Joi = require("joi");

const bookingSchema = Joi.object({
  courtId: Joi.string().required(),
  bookingDate: Joi.date().required(),
  startTime: Joi.date().required(),
  endTime: Joi.date().greater(Joi.ref("startTime")).required(),
  source: Joi.string().valid("web", "walk_in").default("web"),
  customerId: Joi.string().optional(),
  walkInName: Joi.string().max(100).allow("", null),
  walkinName: Joi.string().max(100).allow("", null),
  notes: Joi.string().max(250).allow("", null),
}).unknown(true);

const bookingStatusSchema = Joi.object({
  status: Joi.string().valid("pending", "confirmed", "checked_in", "completed", "cancelled").required(),
});

const partialCancelSchema = Joi.object({
  hours: Joi.array()
    .items(Joi.number().integer().min(7).max(20))
    .min(1)
    .required()
    .messages({ "array.min": "At least one hour must be selected for cancellation" }),
});

const extendSchema = Joi.object({
  extendToHour: Joi.number().integer().min(8).max(21).required().messages({
    "number.min": "Extension must be at least 1 hour",
    "number.max": "Court closes at 21:00",
  }),
});

module.exports = { bookingSchema, bookingStatusSchema, partialCancelSchema, extendSchema };

