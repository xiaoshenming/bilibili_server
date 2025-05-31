// app.js
const express = require("express");
const cors = require("cors");
const http = require("http");
require("dotenv").config();

const { startHeartbeats } = require("./config/heartbeat");
const userRouter = require("./model/user/userRouters");
const videoRouter = require("./model/video/videoRouters"); // 【新增】导入视频路由

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// --- 中间件 ---
app.use(cors()); // 启用 CORS
app.use(express.json()); // 解析 JSON 请求体

// --- 静态文件服务 ---
// 如果您仍需要提供视频文件的直接访问，可以保留这部分
const path = require("path");
const serveIndex = require("serve-index");
const videoDir = path.join(__dirname, "video");
app.use("/video", express.static(videoDir), serveIndex(videoDir, { icons: true }));

// --- 路由 ---
app.use("/api", userRouter); // 挂载用户路由，建议添加前缀 /user
app.use("/api/video", videoRouter); // 【新增】挂载视频路由，统一前缀 /video

// --- 启动服务 ---
startHeartbeats(); // 启动数据库和 Redis 的心跳检测

server.listen(port, "0.0.0.0", () => {
  console.log(`✅ 服务器已成功启动，正在监听端口：http://0.0.0.0:${port}`);
});
