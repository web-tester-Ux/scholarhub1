import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { customAlphabet } from "nanoid";

dotenv.config();

// ----- Paths -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const UPLOAD_DIR = path.join(__dirname, process.env.UPLOAD_DIR || "uploads");
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "registrations.json");

// Allowed frontend
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "VishalRajput2003";

// Ensure directories & DB exist
[UPLOAD_DIR, DATA_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([]), "utf8");
}

// ----- Helpers -----
const readDB = () => {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8") || "[]");
  } catch (err) {
    console.error("❌ Error reading DB:", err);
    return [];
  }
};
const writeDB = (rows) => {
  fs.writeFileSync(DB_FILE, JSON.stringify(rows, null, 2), "utf8");
};

const nanoid = customAlphabet("123456789ABCDEFGHJKLMNPQRSTUVWXYZ", 10);

// ----- Fees -----
const FEES = {
  "Research Scholars": {
    INDIA: { currency: "INR", amount: 1500 },
    ASIA: { currency: "USD", amount: 100 },
    OTHER: { currency: "USD", amount: 125 },
  },
  Academia: {
    INDIA: { currency: "INR", amount: 2000 },
    ASIA: { currency: "USD", amount: 150 },
    OTHER: { currency: "USD", amount: 175 },
  },
  "Industry Professionals": {
    INDIA: { currency: "INR", amount: 2500 },
    ASIA: { currency: "USD", amount: 200 },
    OTHER: { currency: "USD", amount: 225 },
  },
  "Listeners / Accompanying": {
    INDIA: { currency: "INR", amount: 500 },
    ASIA: { currency: "USD", amount: 30 },
    OTHER: { currency: "USD", amount: 40 },
  },
};

// ----- Multer Setup -----
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) =>
    cb(null, nanoid() + path.extname(file.originalname || ".pdf")),
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.toLowerCase().includes("pdf")) {
      return cb(new Error("Only PDF uploads are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Multer for payment proof (image/pdf)
const paymentUpload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (
      !file.mimetype?.toLowerCase().includes("image") &&
      !file.mimetype?.toLowerCase().includes("pdf")
    ) {
      return cb(new Error("Only image or PDF uploads are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ----- Express Setup -----
const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

// ----- Admin Password Check -----
const checkAdminPassword = (req) => {
  const pass =
    req.query.password || req.headers["x-admin-password"] || "";
  return pass.toString() === ADMIN_PASSWORD;
};

// ----- Routes -----
app.get("/", (_req, res) =>
  res.send("✅ Conference Portal API is running")
);
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/fees", (_req, res) => res.json(FEES));

// ----- Registration -----
app.post("/api/register", upload.single("paper"), (req, res) => {
  try {
    const { category, region, paperId, name, organization, email, mobile } =
      req.body;

    if (!category || !region || !name || !email || !mobile) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!FEES[category]?.[region]) {
      return res.status(400).json({ error: "Invalid category or region" });
    }

    const { currency, amount } = FEES[category][region];
    const id = nanoid();
    const file = req.file || null;
    const now = new Date().toISOString();

    const rows = readDB();
    const rec = {
      id,
      created_at: now,
      category,
      region,
      currency,
      amount,
      paper_id: paperId || null,
      name,
      organization: organization || null,
      email,
      mobile,
      paper_filename: file?.filename || null,
      paper_original: file?.originalname || null,
      paid: 0,
      paid_at: null,
      transaction_id: null,
      payment_method: null,
      payer_email: null,
      payment_proof_filename: null,
      payment_proof_original: null,
    };

    rows.push(rec);
    writeDB(rows);

    res.json({
      id,
      currency,
      amount,
      file: file ? `/uploads/${file.filename}` : null,
    });
  } catch (err) {
    console.error("❌ Registration error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ----- Payment Confirmation (User) -----
app.post(
  "/api/confirm-payment/:id",
  paymentUpload.single("screenshot"),
  (req, res) => {
    try {
      const { id } = req.params;
      const { transactionId, method, email } = req.body;
      const file = req.file;

      if (!file) {
        return res
          .status(400)
          .json({ error: "Payment proof screenshot is required" });
      }

      const rows = readDB();
      const rec = rows.find((r) => r.id === id);
      if (!rec)
        return res
          .status(404)
          .json({ error: "Registration not found" });

      if (rec.email && rec.email.toLowerCase() !== email.toLowerCase()) {
        return res
          .status(400)
          .json({ error: "Email does not match registration" });
      }

      rec.paid = 1;
      rec.paid_at = new Date().toISOString();
      rec.transaction_id = transactionId;
      rec.payment_method = method;
      rec.payer_email = email;
      rec.payment_proof_filename = file.filename;
      rec.payment_proof_original = file.originalname;

      writeDB(rows);
      res.json({ ok: true, id });
    } catch (err) {
      console.error("❌ Payment error:", err);
      res.status(500).json({ error: "Payment confirmation failed" });
    }
  }
);

// ----- Admin APIs -----
app.get("/api/admin/registrations", (req, res) => {
  if (!checkAdminPassword(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const q = (req.query.q || "").toLowerCase();
  let rows = readDB().slice().reverse();
  if (q) {
    rows = rows.filter((r) =>
      (r.id + r.name + r.paper_id).toLowerCase().includes(q)
    );
  }

  const withUrls = rows.map((r) => ({
    ...r,
    paper_url: r.paper_filename ? `/uploads/${r.paper_filename}` : null,
    payment_proof_url: r.payment_proof_filename
      ? `/uploads/${r.payment_proof_filename}`
      : null,
  }));

  res.json(withUrls);
});

// Export CSV
app.get("/api/admin/export", (req, res) => {
  if (!checkAdminPassword(req)) {
    return res.status(401).send("Unauthorized");
  }

  const rows = readDB().slice().reverse();
  const headers = [
    "id",
    "created_at",
    "category",
    "region",
    "currency",
    "amount",
    "paper_id",
    "name",
    "organization",
    "email",
    "mobile",
    "paper_filename",
    "paper_original",
    "paid",
    "paid_at",
    "transaction_id",
    "payment_method",
    "payer_email",
    "payment_proof_filename",
    "payment_proof_original",
  ];

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="registrations.csv"'
  );
  res.write(headers.join(",") + "\n");

  rows.forEach((r) => {
    const line = headers
      .map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`)
      .join(",");
    res.write(line + "\n");
  });
  res.end();
});

// Mark as Paid / Unpaid (Admin Only)
app.post("/api/admin/mark-paid/:id", (req, res) => {
  if (!checkAdminPassword(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { id } = req.params;
  const { paid } = req.body; // true or false

  const rows = readDB();
  const rec = rows.find((r) => r.id === id);
  if (!rec) return res.status(404).json({ error: "Registration not found" });

  rec.paid = paid ? 1 : 0;
  rec.paid_at = paid ? new Date().toISOString() : null;

  writeDB(rows);
  res.json({ ok: true, registration: rec });
});

// ----- Start Server -----
app.listen(PORT, () => {
  console.log(
    `🚀 Server live on: ${process.env.SERVER_URL || `http://localhost:${PORT}`}`
  );
  console.log(
    `🔑 Admin dashboard: ${
      process.env.SERVER_URL || `http://localhost:${PORT}`
    }/admin (use ?password=${ADMIN_PASSWORD})`
  );
});
