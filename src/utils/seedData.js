const { Court } = require("../models");

const defaultCourts = [
  { courtName: "Basketball Court 1", courtType: "basketball", location: "Main Hall", hourlyRate: 150 },
  { courtName: "Basketball Court 2", courtType: "basketball", location: "Main Hall", hourlyRate: 150 },
  { courtName: "Basketball Court 3", courtType: "basketball", location: "Main Hall", hourlyRate: 150 },
  { courtName: "Volleyball Court 1", courtType: "volleyball", location: "Annex", hourlyRate: 150 },
  { courtName: "Volleyball Court 2", courtType: "volleyball", location: "Annex", hourlyRate: 150 },
  { courtName: "Volleyball Court 3", courtType: "volleyball", location: "Annex", hourlyRate: 150 },
  { courtName: "Badminton Court 1", courtType: "badminton", location: "Wing 1", hourlyRate: 150 },
  { courtName: "Badminton Court 2", courtType: "badminton", location: "Wing 1", hourlyRate: 150 },
  { courtName: "Badminton Court 3", courtType: "badminton", location: "Wing 2", hourlyRate: 150 },
  { courtName: "Tennis Court 1", courtType: "tennis", location: "Outdoor", hourlyRate: 150 },
  { courtName: "Tennis Court 2", courtType: "tennis", location: "Outdoor", hourlyRate: 150 },
  { courtName: "Tennis Court 3", courtType: "tennis", location: "Outdoor", hourlyRate: 150 },
  { courtName: "Pickleball Court 1", courtType: "pickleball", location: "Annex", hourlyRate: 150 },
  { courtName: "Pickleball Court 2", courtType: "pickleball", location: "Annex", hourlyRate: 150 },
  { courtName: "Pickleball Court 3", courtType: "pickleball", location: "Annex", hourlyRate: 150 },
];

const seedCourts = async () => {
  const count = await Court.countDocuments();
  if (count > 0) {
    return;
  }

  await Court.insertMany(defaultCourts);
  console.log("Seeded default courts");
};

module.exports = { seedCourts };

