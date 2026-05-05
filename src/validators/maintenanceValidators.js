const Joi = require("joi");

const maintenanceSchema = Joi.object({
  courtId: Joi.string().required(),
  startTime: Joi.date()
    .required()
    .custom((value, helpers) => {
      const now = new Date();
      if (value > now) {
        return helpers.error("date.max");
      }
      return value;
    })
    .messages({
      "date.max": "Start time cannot be in the future",
    }),
  endTime: Joi.date()
    .greater(Joi.ref("startTime"))
    .required()
    .custom((value, helpers) => {
      const now = new Date();
      if (value > now) {
        return helpers.error("date.max");
      }
      return value;
    })
    .messages({
      "date.greater": "End time must be after start time",
      "date.max": "End time cannot be in the future",
    }),
  remarks: Joi.string().max(250).allow("", null),
  status: Joi.string().valid("scheduled", "in_progress", "completed").default("scheduled"),
});

module.exports = { maintenanceSchema };

