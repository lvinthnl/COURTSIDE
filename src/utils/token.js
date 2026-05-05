const jwt = require("jsonwebtoken");

const generateToken = ({ userId, role }) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("Missing JWT_SECRET");
  }

  const payload = {
    sub: userId,
    role,
  };

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "12h" });
};

module.exports = { generateToken };

