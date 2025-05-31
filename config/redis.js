// redis.js
const Redis = require('ioredis');
require("dotenv").config();
const HOST = process.env.Redis_HOST;
const PORT = process.env.Redis_PORT;
const PASSWORD = process.env.Redis_PASSWORD;

// 创建 Redis 连接
const redis = new Redis({
  host: HOST,
  port: PORT,
  password: PASSWORD,
  db: 0,
});

// 测试 Redis 连接
redis.on('connect', () => {
    console.log('Redis 连接成功');
});

redis.on('error', (err) => {
    console.error('Redis 连接失败:', err);
});

module.exports = redis;
