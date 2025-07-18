require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");

const app = express();
const allowedOrigins = [
  "http://localhost:3000",
  "https://trade-connect-kenya.vercel.app",
];
app.use(helmet());
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.static("docs"));


// Initialize pool with better configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    ca: fs.readFileSync(path.join(__dirname, "supabase-ca.pem")).toString(),
  },
});

// Add event listeners for better debugging
pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
  process.exit(-1);
});

// Test connection on startup
(async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Database connection successful');
    await client.query('SELECT NOW()');
    client.release();
  } catch (err) {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  }
})();

// Helper function to normalize categories
const normalizeCategory = (category) => {
  return category.toLowerCase().trim();
};

// Authentication middleware
function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "Authorization header missing" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Token missing from header" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({
      error: "Invalid token",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}

// Routes
app.get("/health", (req, res) => res.send("OK"));

app.get("/", (req, res) => {
  res.send("API is running ✅");
});

app.get("/env-check", (req, res) => {
  res.json({
    db: process.env.DATABASE_URL ? "OK" : "Missing",
    jwt: process.env.JWT_SECRET ? "OK" : "Missing",
  });
});

// Tradespeople endpoints
app.get("/api/tradespeople", async (req, res) => {
  const { location, specialization } = req.query;

  let query = "SELECT * FROM tradespeople WHERE 1=1";
  const params = [];

  if (location) {
    params.push(`%${location}%`);
    query += ` AND location ILIKE $${params.length}`;
  }

  if (specialization) {
    params.push(specialization);
    query += ` AND specialization = $${params.length}`;
  }

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Failed to fetch tradespeople" });
  }
});

app.get("/api/tradespeople/specializations", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT specialization FROM tradespeople ORDER BY specialization"
    );
    res.json(result.rows.map((row) => row.specialization));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch specializations" });
  }
});

app.get("/api/tradespeople/random", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tradespeople ORDER BY RANDOM() LIMIT 3"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching random tradespeople:", err);
    res.status(500).json({ error: "Failed to fetch tradespeople" });
  }
});
app.get("/test-db", async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT NOW()");
    client.release();
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    console.error("Database connection error:", err);
    res.status(500).json({ error: "Database connection failed" });
  }
});
app.get("/api/tradespeople/count", async (req, res) => {
  try {
    const result = await pool.query("SELECT COUNT(*) FROM tradespeople");
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error("Error counting tradespeople:", err);
    res.status(500).json({ error: "Failed to count tradespeople" });
  }
});

app.get("/api/tradespeople/stats", async (req, res) => {
  try {
    const totalResult = await pool.query("SELECT COUNT(*) FROM tradespeople");
    const todayResult = await pool.query(
      `SELECT COUNT(*), ARRAY_AGG(name) as names 
       FROM tradespeople WHERE created_at >= CURRENT_DATE`
    );
    res.json({
      total: parseInt(totalResult.rows[0].count, 10),
      today: parseInt(todayResult.rows[0].count, 10),
      todayUsers: todayResult.rows[0].names || [],
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Updated /api/jobs endpoint
app.get("/api/jobs", authenticate, async (req, res) => {
  try {
    let query = `
      SELECT 
        j.*, 
        c.name AS client_name,
        a.applied_at,
        CASE 
          WHEN a.id IS NOT NULL THEN true
          ELSE false
        END AS applied
      FROM jobs j
      JOIN clients c ON j.client_id = c.id
      LEFT JOIN job_applications a 
        ON a.job_id = j.id 
        AND a.tradesperson_id = $1
      WHERE j.status = 'open'
    `;

    const params = [req.user.id];
    let paramIndex = 2;

    const specialization =
      req.query.specialization?.trim() ||
      (req.user.type === "tradesperson"
        ? req.user.specialization?.trim()
        : null);

    const location =
      req.query.location?.trim() ||
      (req.user.type === "tradesperson" ? req.user.location?.trim() : null);

    if (specialization) {
      query += ` AND LOWER(j.category) = LOWER($${paramIndex})`;
      params.push(specialization);
      paramIndex++;
    }

    if (location) {
      query += ` AND j.location ILIKE $${paramIndex}`;
      params.push(`%${location}%`);
      paramIndex++;
    }

    query += ` ORDER BY j.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({
      error: "Failed to fetch jobs",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

app.get("/api/client/applications", authenticate, async (req, res) => {
  try {
    // Only allow clients
    if (req.user.type !== "client") {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await pool.query(
      `
      SELECT 
        j.title AS job_title,
        j.id AS job_id,
        a.applied_at,
        t.id AS tradesperson_id,
        t.name AS tradesperson_name,
        t.email,
        t.phone,
        t.specialization,
        t.location,
        t.experience_years,
        t.bio
      FROM job_applications a
      JOIN jobs j ON a.job_id = j.id
      JOIN tradespeople t ON a.tradesperson_id = t.id
      WHERE j.client_id = $1
      ORDER BY a.applied_at DESC
      `,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching applications:", err);
    res.status(500).json({ error: "Failed to fetch applications" });
  }
});

// POST /api/jobs - Create a new job listing
app.post("/api/jobs", authenticate, async (req, res) => {
  // Validate request
  if (req.user.type !== "client") {
    return res.status(403).json({ error: "Only clients can post jobs" });
  }

  // Prepare data
  const jobData = {
    title: req.body.title?.trim(),
    description: req.body.description?.trim(),
    location: req.body.location?.trim(),
    category: req.body.category?.trim(),
    budget: req.body.budget ? parseInt(req.body.budget) : null,
  };

  // Validate required fields
  const requiredFields = ["title", "description", "location", "category"];
  const missingFields = requiredFields.filter((field) => !jobData[field]);

  if (missingFields.length > 0) {
    return res.status(400).json({
      error: "Missing required fields",
      missing: missingFields,
    });
  }

  // Normalize category to Title Case
  jobData.category = jobData.category
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  try {
    const result = await pool.query(
      `INSERT INTO jobs 
       (title, description, location, category, budget, client_id, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', NOW())
       RETURNING *`,
      [
        jobData.title,
        jobData.description,
        jobData.location,
        jobData.category,
        jobData.budget,
        req.user.id,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Job post error:", err);

    let errorResponse = {
      error: "Failed to post job",
    };

    if (process.env.NODE_ENV === "development") {
      errorResponse.details = err.message;
      errorResponse.stack = err.stack;
    }

    if (err.code === "23503") {
      // Foreign key violation
      errorResponse.error = "Invalid client account";
      res.status(400).json(errorResponse);
    } else if (err.code === "23502") {
      // Not null violation
      errorResponse.error = "Missing required field";
      errorResponse.field = err.column;
      res.status(400).json(errorResponse);
    } else {
      res.status(500).json(errorResponse);
    }
  }
});
app.post("/api/jobs/apply", authenticate, async (req, res) => {
  try {
    const { job_id } = req.body;
    const tradesperson_id = req.user.id;

    // Check if application exists
    const existing = await pool.query(
      "SELECT * FROM job_applications WHERE job_id = $1 AND tradesperson_id = $2",
      [job_id, tradesperson_id]
    );

    if (existing.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "You've already applied to this job" });
    }

    // Create application
    const result = await pool.query(
      `INSERT INTO job_applications (job_id, tradesperson_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [job_id, tradesperson_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Application error:", err);
    res.status(500).json({ error: "Failed to submit application" });
  }
});

// Auth endpoints
app.post("/api/login", async (req, res) => {
  const { email, password, userType } = req.body;

  try {
    const table = userType === "client" ? "clients" : "tradespeople";
    const result = await pool.query(`SELECT * FROM ${table} WHERE email = $1`, [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      type: userType,
      name: user.name,
    };

    if (userType === "tradesperson") {
      tokenPayload.specialization = user.specialization;
      tokenPayload.location = user.location;
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    res.json({
      token,
      user: tokenPayload,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/clients/register", async (req, res) => {
  const { name, email, phone, password, confirm_password } = req.body;

  if (password !== confirm_password) {
    return res.status(400).json({ error: "Passwords don't match" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO clients (name, email, phone, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email`,
      [name, email, phone, hashedPassword]
    );

    res.status(201).json({
      user: {
        ...result.rows[0],
        type: "client",
      },
    });
  } catch (err) {
    if (err.code === "23505") {
      res.status(400).json({ error: "Email already exists" });
    } else {
      console.error("Registration error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  }
});

app.post("/api/tradespeople/register", async (req, res) => {
  const {
    name,
    email,
    phone,
    specialization,
    location,
    experience_years,
    bio,
    password,
    confirm_password,
  } = req.body;

  if (password !== confirm_password) {
    return res.status(400).json({ error: "Passwords don't match" });
  }

  if (!specialization || !location) {
    return res
      .status(400)
      .json({ error: "Specialization and location are required" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const initCap = (str) =>
      str
        .toLowerCase()
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

    const normalizedSpecialization = initCap(normalizeCategory(specialization));

    const result = await pool.query(
      `INSERT INTO tradespeople 
       (name, email, phone, specialization, location, experience_years, bio, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, email, specialization, location`,
      [
        name,
        email,
        phone,
        normalizedSpecialization,
        location,
        experience_years,
        bio,
        hashedPassword,
      ]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        type: "tradesperson",
        name: user.name,
        specialization: user.specialization,
        location: user.location,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(201).json({
      token,
      user: {
        ...user,
        type: "tradesperson",
      },
    });
  } catch (err) {
    if (err.code === "23505") {
      res.status(400).json({ error: "Email already exists" });
    } else {
      console.error("Registration error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  }
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0"; // ✅ Add this line

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
