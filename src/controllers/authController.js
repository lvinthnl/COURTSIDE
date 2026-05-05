const bcrypt = require("bcryptjs");
const { User, Staff } = require("../models");
const { generateToken } = require("../utils/token");
const { signupSchema, loginSchema } = require("../validators/authValidators");

const signup = async (req, res, next) => {
  try {
    const { value, error } = signupSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const { fullName, phoneNumber, email, password } = value;

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      fullName,
      phoneNumber,
      email,
      passwordHash,
      role: "customer",
    });

    const token = generateToken({ userId: user._id, role: user.role });
    res
      .cookie("token", token, { httpOnly: true, sameSite: "lax" })
      .status(201)
      .json({ message: "Signup successful", user: { id: user._id, fullName, email, phoneNumber, role: user.role } });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { value, error } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const { email, password } = value;
    const user = await User.findOne({ email }).select("+passwordHash");

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = generateToken({ userId: user._id, role: user.role });
    res
      .cookie("token", token, { httpOnly: true, sameSite: "lax" })
      .status(200)
      .json({
        message: "Login successful",
        user: { id: user._id, fullName: user.fullName, email: user.email, phoneNumber: user.phoneNumber, role: user.role },
      });
  } catch (err) {
    next(err);
  }
};

const logout = (_req, res) => {
  res.clearCookie("token").status(200).json({ message: "Logged out" });
};

const profile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
    });
  } catch (err) {
    next(err);
  }
};

// Customer lookup for walk-in reservation form (admin/staff only)
const listCustomers = async (req, res, next) => {
  try {
    const { phone, name } = req.query;
    const filter = { role: "customer", isActive: true };
    if (phone) filter.phoneNumber = { $regex: phone.replace(/[^0-9]/g, ""), $options: "i" };
    if (name) filter.fullName = { $regex: name, $options: "i" };

    const customers = await User.find(filter)
      .select("fullName email phoneNumber")
      .limit(20)
      .lean();

    res.status(200).json(customers);
  } catch (err) {
    next(err);
  }
};

const seedDefaultAdmin = async () => {
  const adminEmail = "admin@courtside.com";
  const existing = await User.findOne({ email: adminEmail });
  if (existing) {
    return;
  }

  const passwordHash = await bcrypt.hash("Courtside2025!", 10);
  const adminUser = await User.create({
    fullName: "Courtside Admin",
    phoneNumber: "0000000000",
    email: adminEmail,
    passwordHash,
    role: "admin",
  });

  await Staff.create({
    fullName: adminUser.fullName,
    role: "admin",
    contactNumber: adminUser.phoneNumber,
    email: adminEmail,
    userAccount: adminUser._id,
  });

  console.log("Seeded default admin credentials: admin@courtside.com / Courtside2025!");
};

module.exports = { signup, login, logout, profile, listCustomers, seedDefaultAdmin };

