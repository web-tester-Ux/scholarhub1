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
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "VishalRajput2003";

// Ensure directories and DB file exist
[UPLOAD_DIR, DATA_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]), "utf8");

// ----- Database Helpers -----
const readDB = () => {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8") || "[]");
  } catch (e) {
    console.error("Error reading DB:", e);
    return [];
  }
};

const writeDB = (rows) => {
  fs.writeFileSync(DB_FILE, JSON.stringify(rows, null, 2), "utf8");
};

// ----- NanoID Setup -----
const nanoid = customAlphabet("123456789ABCDEFGHJKLMNPQRSTUVWXYZ", 10);

// ----- Fees -----
const FEES = {
  "Research Scholars": { INDIA: { currency: "INR", amount: 1500 }, ASIA: { currency: "USD", amount: 100 }, OTHER: { currency: "USD", amount: 125 } },
  Academia: { INDIA: { currency: "INR", amount: 2000 }, ASIA: { currency: "USD", amount: 150 }, OTHER: { currency: "USD", amount: 175 } },
  "Industry Professionals": { INDIA: { currency: "INR", amount: 2500 }, ASIA: { currency: "USD", amount: 200 }, OTHER: { currency: "USD", amount: 225 } },
  "Listeners / Accompanying": { INDIA: { currency: "INR", amount: 500 }, ASIA: { currency: "USD", amount: 30 }, OTHER: { currency: "USD", amount: 40 } }
};

// ----- Multer Setup -----
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, nanoid() + path.extname(file.originalname || ".pdf"))
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.toLowerCase().includes("pdf")) {
      return cb(new Error("Only PDF uploads are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

// ----- Express Setup -----
const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

// ----- Helper: Admin Password Check -----
const checkAdminPassword = (req) => {
  const pass = (req.query.password || req.headers["x-admin-password"] || "").toString();
  return pass === ADMIN_PASSWORD;
};

// ----- Routes -----
app.get("/", (_req, res) => res.send("✅ Conference Portal API is running"));
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/fees", (_req, res) => res.json(FEES));

// ----- Registration -----
app.post("/api/register", upload.single("paper"), (req, res) => {
  try {
    const { category, region, paperId, name, organization, email, mobile } = req.body;
    if (!category || !region || !name || !email || !mobile)
      return res.status(400).json({ error: "Missing required fields" });
    if (!FEES[category]?.[region]) return res.status(400).json({ error: "Invalid category or region" });

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
      payer_email: null
    };
    rows.push(rec);
    writeDB(rows);

    res.json({ id, currency, amount, file: file ? `/uploads/${file.filename}` : null });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ----- Get Single Registration -----
app.get("/api/registrations/:id", (req, res) => {
  const row = readDB().find(r => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Alias for participant
app.get("/api/participant/:id", (req, res) => {
  const row = readDB().find(r => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// ----- Payment -----
app.post("/api/create-payment/:id", (req, res) => {
  const reg = readDB().find(r => r.id === req.params.id);
  if (!reg) return res.status(404).json({ error: "Not found" });
  res.json({ url: `/mock-pay/${reg.id}`, amount: reg.amount, currency: reg.currency });
});

// Confirm Payment with Email Validation
app.post("/api/confirm-payment/:id", (req, res) => {
  const { transactionId, method, email } = req.body;
  if (!transactionId || !method || !email) {
    return res.status(400).json({ error: "Missing transaction ID, payment method, or email" });
  }

  const rows = readDB();
  const idx = rows.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  if (rows[idx].email.toLowerCase() !== email.toLowerCase()) {
    return res.status(400).json({ error: "Email does not match registration record" });
  }

  rows[idx].paid = 1;
  rows[idx].paid_at = new Date().toISOString();
  rows[idx].transaction_id = transactionId;
  rows[idx].payment_method = method;
  rows[idx].payer_email = email;

  writeDB(rows);
  res.json({ ok: true, paid_at: rows[idx].paid_at, transactionId, method, email });
});

// ----- Admin APIs -----
app.get("/api/admin/registrations", (req, res) => {
  if (!checkAdminPassword(req)) return res.status(401).json({ error: "Unauthorized" });

  const q = (req.query.q || "").toLowerCase();
  let rows = readDB().slice().reverse();
  if (q) rows = rows.filter(r => (r.id + r.name + r.paper_id).toLowerCase().includes(q));

  const withUrls = rows.map(r => ({ ...r, paper_url: r.paper_filename ? `/uploads/${r.paper_filename}` : null }));
  res.json(withUrls);
});

// Export CSV
app.get("/api/admin/export", (req, res) => {
  if (!checkAdminPassword(req)) return res.status(401).send("Unauthorized");

  const rows = readDB().slice().reverse();
  const headers = [
    "id","created_at","category","region","currency","amount","paper_id","name","organization","email","mobile",
    "paper_filename","paper_original","paid","paid_at","transaction_id","payment_method","payer_email"
  ];

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition",'attachment; filename="registrations.csv"');
  res.write(headers.join(",") + "\n");

  rows.forEach(r => {
    const line = headers.map(h => `"${String(r[h] ?? "").replace(/"/g,'""')}"`).join(",");
    res.write(line + "\n");
  });
  res.end();
});

// ----- Admin Dashboard Page -----
app.get("/admin", (req, res) => {
  res.send("🔑 Admin dashboard UI not implemented yet");
});

// ----- Start Server -----
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin (use ?password=yourpass)`);
});
