const Joi = require("joi");

const signupSchema = Joi.object({
  fullName: Joi.string().max(100).required(),
  phoneNumber: Joi.string().max(15).required(),
  email: Joi.string().email().max(100).required(),
  password: Joi.string().min(8).max(64).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

module.exports = { signupSchema, loginSchema };

