// config/db.js (或者您实际的路径)
const mysql = require("mysql2"); // 引入 mysql2 库
require("dotenv").config(); // 加载环境变量

// 从环境变量中获取数据库配置
const HOST = process.env.MYSQL_HOST;
const PORT = process.env.MYSQL_PORT;
const PASSWORD = process.env.MYSQL_PASSWORD;
const USER = process.env.MYSQL_USER;
const DATABASE = process.env.MYSQL_DATABASE;

// 创建 MySQL 连接池
const pool = mysql.createPool({
  host: HOST,
  user: USER,
  port: PORT,
  password: PASSWORD,
  database: DATABASE,
  charset: "utf8mb4", // 推荐使用 utf8mb4 以支持更广泛的字符集
  waitForConnections: true, // 当连接池满时，新的请求会等待而不是立即失败
  connectionLimit: 10, // 连接池中允许的最大连接数
  queueLimit: 0, // 等待队列的最大长度（0表示不限制，但不推荐）
});

// 可选：添加事件监听器来监控连接池状态
pool.on("acquire", function (connection) {
  console.log("数据库连接池：连接 %d 已获取", connection.threadId);
});

pool.on("release", function (connection) {
  console.log("数据库连接池：连接 %d 已释放", connection.threadId);
});

// 尝试获取一个连接以验证连接池配置是否正确 (可选, 但推荐用于启动时检查)
pool.getConnection((err, connection) => {
  if (err) {
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      console.error("数据库连接丢失。");
    } else if (err.code === "ER_CON_COUNT_ERROR") {
      console.error("数据库连接数过多。");
    } else if (err.code === "ECONNREFUSED") {
      console.error("数据库连接被拒绝。");
    } else {
      console.error("连接数据库连接池时出错:", err);
    }
  }
  if (connection) {
    console.log("数据库连接池初始化成功！");
    connection.release(); // 释放测试连接
  }
});

// 导出连接池实例
module.exports = pool;
