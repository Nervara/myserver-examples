const express = require('express');
const redis = require('redis');
const app = express();
const port = 8080;

const client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', err => console.log('Redis Client Error', err));

app.get('/', async (req, res) => {
    try {
        await client.connect();
        await client.incr('hits');
        const hits = await client.get('hits');
        await client.disconnect();
        res.send(`Hello from Docker Compose! Redis hits: ${hits}`);
    } catch (err) {
        res.status(500).send(`Error: ${err.message}`);
    }
});

app.listen(port, () => {
    console.log(`Compose app listening at http://localhost:${port}`);
});
