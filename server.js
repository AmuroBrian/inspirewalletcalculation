const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.post('/generate-dates', (req, res) => {
  try {
    const { currentMoney, amount, date, interest } = req.body;

    if (currentMoney === undefined || isNaN(currentMoney) || currentMoney < 0) {
      return res.status(400).send({ error: 'Valid current money amount is required.' });
    }

    if (!date || isNaN(new Date(date).getTime())) {
      return res.status(400).send({ error: 'Valid date is required.' });
    }

    const currentMoneyNum = parseFloat(currentMoney);
    const amountNum = parseFloat(amount);
    const interestNum = parseFloat(interest);

    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).send({ error: 'Valid deposit amount is required.' });
    }

    if (amountNum > currentMoneyNum) {
      return res.status(400).send({ error: 'Deposit amount cannot be more than money you currently have.' });
    }

    if (isNaN(interestNum) || interestNum < 0) {
      return res.status(400).send({ error: 'Valid interest rate is required.' });
    }

    const availableBalance = currentMoneyNum - amountNum;

    res.send({ availableBalance });
  } catch (err) {
    console.error('Error in /generate-dates:', err);
    res.status(500).send({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

