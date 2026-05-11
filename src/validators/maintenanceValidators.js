const Joi = require("joi");

const maintenanceSchema = Joi.object({
  courtId: Joi.string().required(),
  startTime: Joi.date()
    .required()
    .custom((value, helpers) => {
      const now = new Date();
      if (value < now) {
        return helpers.error("date.min");
      }
      return value;
    })
    .messages({
      "date.min": "Start time cannot be in the past",
    }),
  endTime: Joi.date()
    .greater(Joi.ref("startTime"))
    .required()
    .messages({
      "date.greater": "End time must be after start time",
    }),
  remarks: Joi.string().max(250).allow("", null),
  status: Joi.string().valid("scheduled", "in_progress", "completed").default("scheduled"),
});

module.exports = { maintenanceSchema };
