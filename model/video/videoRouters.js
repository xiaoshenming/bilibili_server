// model/video/videoRouters.js

const express = require("express");
const router = express.Router();
const videoUtils = require("./videoUtils");
const authorize = require("../auth/authUtils"); // 导入授权中间件

/**
 * @api {get} /api/video/list
 * @description 获取所有已处理的视频列表
 * @access Public
 */
router.get("/list", async (req, res) => {
  try {
    const videos = await videoUtils.listAllVideos();
    res.status(200).json({
      code: 200,
      message: "成功获取视频列表",
      data: videos,
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message || "获取视频列表失败",
      data: null,
    });
  }
});

/**
 * @api {post} /api/video/process
 * @description 提交一个 Bilibili 视频 URL 进行处理（爬取、下载、合并、入库）
 * @access Protected - 需要用户登录
 * @body { "url": "视频的URL或BVID" }
 */
router.post("/process", authorize(["1", "2", "3"]), async (req, res) => {
  const { url } = req.body;
  if (!url || !url.trim()) {
    return res.status(400).json({
      code: 400,
      message: "请提供有效的视频 URL",
      data: null,
    });
  }

  try {
    // processVideoRequest 是一个长时任务，但我们在这里等待它完成
    // 对于生产环境，可以考虑使用任务队列（如 BullMQ）来处理，并立即返回一个任务ID
    console.log(`▶️ 开始处理视频请求: ${url}`);
    const result = await videoUtils.processVideoRequest(url);
    console.log(`✅ 视频处理完成: ${result.title}`);
    res.status(201).json({
      code: 201,
      message: "视频处理成功并已入库",
      data: result,
    });
  } catch (error) {
    console.error(`❌ 处理视频 ${url} 时发生致命错误:`, error);
    res.status(500).json({
      code: 500,
      message: error.message || "处理视频时发生未知错误",
      data: null,
    });
  }
});

module.exports = router;
