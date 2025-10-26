import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();
app.use(cors());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('connected to server');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});