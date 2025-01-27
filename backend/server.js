const express = require('express');
const app = express();

const PORT = process.env.PORT || 4000;

app.get('/', (req, res) => {
    res.send('Hello, Express Backend!');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
