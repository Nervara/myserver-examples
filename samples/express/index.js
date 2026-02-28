const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Hello from Express on myserver!');
});

app.listen(port, () => {
  console.log(`Express app listening at http://localhost:${port}`);
});
