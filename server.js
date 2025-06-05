// server.js
require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

/* ─────────────────────────────
   1.  MIDDLEWARE
   ──────────────────────────── */
app.use(express.json());

// Very simple CORS – OK for dev / demos
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* ─────────────────────────────
   2.  STATIC FILES (public/)
   ──────────────────────────── */
app.use(express.static(path.join(__dirname, "public")));

/* ─────────────────────────────
   3.  LOAD RATE TABLE
   ──────────────────────────── */
const rates = JSON.parse(
  fs.readFileSync(path.join(__dirname, "investmentrates.json"))
);

/* ─────────────────────────────
   4.  HELPERS
   ──────────────────────────── */

// Linear interpolation within the "twoYears" tier table
function getInterpolatedRate(amount) {
  const table = rates.twoYears;
  if (!table) return null;

  const tiers = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);

  if (amount <= tiers[0]) return table[tiers[0]];
  if (amount >= tiers.at(-1)) return table[tiers.at(-1)];

  for (let i = 0; i < tiers.length - 1; i++) {
    const low = tiers[i],
      high = tiers[i + 1];
    if (amount >= low && amount <= high) {
      const rLow = table[low],
        rHigh = table[high];
      const r = ((amount - low) * (rHigh - rLow)) / (high - low) + rLow;
      return parseFloat(r.toFixed(2));
    }
  }
  return null; // should never happen
}

// For timestamp → "5/29/2025, 4:23:01 PM" in Philippine Time
function formatPHT(dateMs) {
  return new Date(dateMs).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

/* ─────────────────────────────
   5.  POST  /generate-dates
   ──────────────────────────── */
app.post("/generate-dates", (req, res) => {
  try {
    const {
      currentMoney,
      amount,
      startDate, // "YYYY-MM-DD" from the <input type="date">
      logMinutes = 10, // OPTIONAL: how many minutes of log lines to pre-build
    } = req.body;

    /* 5.1  Validation */
    const moneyNum = Number(currentMoney);
    const amountNum = Number(amount);

    if (!Number.isFinite(moneyNum) || moneyNum < 0)
      return res
        .status(400)
        .json({ error: '"currentMoney" must be a non-negative number.' });

    if (!Number.isFinite(amountNum) || amountNum <= 0)
      return res
        .status(400)
        .json({ error: '"amount" must be a positive number.' });

    if (amountNum > moneyNum)
      return res
        .status(400)
        .json({ error: "Deposit amount cannot exceed current money." });

    // Use the supplied date (at midnight) plus "now"'s hh:mm:ss as the deposit moment.
    // If no startDate provided, just take "now" in PHT.
    const now = new Date();
    const phtOptions = {
      timeZone: "Asia/Manila",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    };
    const [h, m, s] = now.toLocaleTimeString("en-PH", phtOptions).split(":");
    const depositDate = startDate
      ? new Date(`${startDate}T${h}:${m}:${s}`)
      : new Date(); // default: this instant
    if (isNaN(depositDate))
      return res
        .status(400)
        .json({ error: 'Invalid "startDate". Use YYYY-MM-DD.' });

    /* 5.2  Rate lookup */
    const interestRate = getInterpolatedRate(amountNum);
    if (interestRate === null)
      return res
        .status(400)
        .json({ error: "No interest rate found for that amount." });

    /* 5.3  Derived constants */
    const TERM_MINUTES = 262_080; // ≈ 6 months
    const ratePerMinute =
      Math.pow(1 + interestRate / 100, 1 / TERM_MINUTES) - 1;

    /* 5.4  Build the log lines the client asked to see */
    const logs = [];
    let previousAmount = amountNum;
    let totalUnxfer = 0;

    for (let min = 0; min <= logMinutes; min++) {
      const ts = depositDate.getTime() + min * 60_000; // +N minutes
      if (min === 0) {
        logs.push(
          `Minute 0: ${formatPHT(ts)} — Initial deposit ₱${amountNum.toFixed(
            2
          )} — Interest Rate: ${interestRate.toFixed(2)}%`
        );
      } else {
        const currentAmount = amountNum * Math.pow(1 + ratePerMinute, min);
        const earnedThisMinute = currentAmount - previousAmount;
        totalUnxfer += earnedThisMinute;
        previousAmount = currentAmount;

        logs.push(
          `Minute ${min}: ${formatPHT(
            ts
          )} — Earned this minute: ₱${earnedThisMinute.toFixed(
            6
          )} — Total Untransferred Earnings: ₱${totalUnxfer.toFixed(6)}`
        );
      }
    }

    /* 5.5  Respond */
    return res.json({
      availableBalance: parseFloat((moneyNum - amountNum).toFixed(2)),
      interestRate, // annual (%)
      termMinutes: TERM_MINUTES,
      ratePerMinute, // decimal
      depositTimestamp: depositDate.getTime(),
      logs, // <-- what you wanted
    });
  } catch (err) {
    console.error("[POST /generate-dates]", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ─────────────────────────────
   6.  TEN MINUTE COMPOUND ENDPOINTS
   ──────────────────────────── */

// Constants for ten minute compound
const TEN_MIN_CONSTANTS = {
  ANNUAL_RATE: 0.14, // 14% annual
  TOTAL_SECONDS: 720, // 12 minutes = 720 seconds
  TAX_RATE: 0.20, // 20% tax on profits
};

app.post("/ten-minute-compound/start", (req, res) => {
  try {
    const { initialDeposit } = req.body;

    if (!initialDeposit || initialDeposit <= 0) {
      return res.status(400).json({
        error: "Please provide a valid initial deposit amount greater than 0"
      });
    }

    // Calculate initial values
    const targetGrowth = initialDeposit * TEN_MIN_CONSTANTS.ANNUAL_RATE;
    const growthPerSecond = targetGrowth / TEN_MIN_CONSTANTS.TOTAL_SECONDS;
    const netGrowthPerSecond = growthPerSecond * (1 - TEN_MIN_CONSTANTS.TAX_RATE);

    res.json({
      success: true,
      initialDeposit,
      targetGrowth,
      growthPerSecond,
      netGrowthPerSecond,
      constants: TEN_MIN_CONSTANTS
    });
  } catch (err) {
    console.error("[POST /ten-minute-compound/start]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/ten-minute-compound/calculate", (req, res) => {
  try {
    const { 
      initialDeposit,
      elapsedMinutes,
      elapsedSeconds
    } = req.body;

    if (!initialDeposit || !elapsedMinutes || elapsedSeconds === undefined) {
      return res.status(400).json({
        error: "Please provide initialDeposit, elapsedMinutes, and elapsedSeconds"
      });
    }

    // Calculate current value and growth
    const totalElapsedSeconds = (elapsedMinutes * 60) + elapsedSeconds;
    const targetGrowth = initialDeposit * TEN_MIN_CONSTANTS.ANNUAL_RATE;
    const growthPerSecond = targetGrowth / TEN_MIN_CONSTANTS.TOTAL_SECONDS;
    // const totalGrowth = targetGrowth * (totalElapsedSeconds / TEN_MIN_CONSTANTS.TOTAL_SECONDS);
    const totalGrowth =  growthPerSecond * totalElapsedSeconds;
    const currentValue = initialDeposit + (totalGrowth * (1 - TEN_MIN_CONSTANTS.TAX_RATE));

    // Calculate time equivalent
    const time = {
      year: Math.floor(elapsedMinutes / 12),
      month: elapsedMinutes % 12,
      day: Math.floor(elapsedSeconds / 5),
      hour: Math.floor((elapsedSeconds % 5) * 4.8),
      minute: Math.floor(((elapsedSeconds % 5) * 4.8 % 1) * 60)
    };

    res.json({
      success: true,
      currentValue,
      totalGrowth,
      taxAmount: totalGrowth * TEN_MIN_CONSTANTS.TAX_RATE,
      netGrowth: totalGrowth * (1 - TEN_MIN_CONSTANTS.TAX_RATE),
      time
    });
  } catch (err) {
    console.error("[POST /ten-minute-compound/calculate]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─────────────────────────────
   7.  START SERVER
   ──────────────────────────── */
app.listen(PORT, () => {
  console.log(`➜  Server running  →  ${BASE_URL}`);
});
