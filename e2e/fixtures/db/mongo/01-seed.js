// t69 e2e seed for `test-mongo` (mongo:7). Runs once via
// /docker-entrypoint-initdb.d as the root user (MONGO_INITDB_ROOT_*),
// with `db` bound to MONGO_INITDB_DATABASE (testdb).
//
// Seeds: testdb.people (5 docs, nested address, index city_1) and a
// `testuser` login (readWrite on testdb + read on admin so the app can
// list databases when authenticating against authSource=admin).

const testDb = db.getSiblingDB("testdb");

testDb.people.drop();
testDb.people.insertMany([
  {
    name: "Ada",
    city: "London",
    age: 36,
    address: { street: "1 Analytical Way", zip: "N1" },
    tags: ["math", "engines"],
  },
  {
    name: "Grace",
    city: "Arlington",
    age: 85,
    address: { street: "2 Cobol Ct", zip: "22201" },
    tags: ["navy", "compilers"],
  },
  {
    name: "Linus",
    city: "Helsinki",
    age: 54,
    address: { street: "3 Kernel St", zip: "00100" },
    tags: ["kernel"],
  },
  {
    name: "Margaret",
    city: "London",
    age: 88,
    address: { street: "4 Apollo Rd", zip: "SE1" },
    tags: ["software"],
  },
  {
    name: "Dennis",
    city: "New York",
    age: 70,
    address: { street: "5 Unix Ave", zip: "10001" },
    tags: ["c", "unix"],
  },
]);
testDb.people.createIndex({ city: 1 }, { name: "city_1" });

const adminDb = db.getSiblingDB("admin");
const user = process.env.MONGO_USER || "testuser";
const pwd = process.env.MONGO_PASSWORD || "testpass";

try {
  adminDb.dropUser(user);
} catch (e) {
  // user did not exist yet — fine
}
adminDb.createUser({
  user,
  pwd,
  roles: [
    { role: "readWrite", db: "testdb" },
    { role: "read", db: "admin" },
    { role: "clusterMonitor", db: "admin" },
  ],
});

print(`[seed] testdb.people=${testDb.people.countDocuments()} user=${user}`);
