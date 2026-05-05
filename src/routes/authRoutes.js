const express = require("express");
const { signup, login, logout, profile, listCustomers } = require("../controllers/authController");
const { authenticate, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", authenticate, logout);
router.get("/profile", authenticate, profile);
router.get("/customers", authenticate, authorize("admin", "staff"), listCustomers);

module.exports = router;
