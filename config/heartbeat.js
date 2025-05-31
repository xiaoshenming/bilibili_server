// config/heartbeat.js
require("dotenv").config(); // 确保 .env 文件被读取

// 路径调整：假设 db.js 和 redis.js 在项目根目录，heartbeat.js 在 config/ 目录下
const redis = require("./redis");
const db = require("./db");
function startHeartbeats() {
  // Redis 心跳
  setInterval(async () => {
    try {
      // 确保 redis 客户端实际存在且有 ping 方法
      if (redis && typeof redis.ping === "function") {
        const pong = await redis.ping();
        console.log("Redis 心跳包成功:", pong);
      } else {
        console.warn("Redis 客户端未正确初始化或无 ping 方法。");
      }
    } catch (error) {
      console.error("Redis 心跳包失败:", error);
    }
  }, 300000); // 每 5 分钟

  // MySQL 心跳
  setInterval(() => {
    // 确保 db 对象实际存在且有 query 方法
    if (db && typeof db.query === "function") {
      db.query("SELECT 1 AS mysql_heartbeat", (err, results) => {
        // 添加别名以区分
        if (err) {
          console.error("MySQL 心跳包失败:", err);
        } else {
          console.log("MySQL 心跳包成功", results);
        }
      });
    } else {
      console.warn("MySQL 客户端未正确初始化或无 query 方法。");
    }
  }, 300000); // 每 5 分钟
}

module.exports = { startHeartbeats };
