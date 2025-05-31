// model/video/videoRouters.js

const express = require("express");
const router = express.Router();
const videoUtils = require("./videoUtils");
const bilibiliUtils = require("../bilibili/bilibiliUtils");
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
 * @api {get} /api/video/user-list
 * @description 获取当前用户处理的视频列表
 * @access Protected - 需要用户登录
 */
router.get("/user-list", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const videos = await videoUtils.getUserVideos(userId);
    res.status(200).json({
      code: 200,
      message: "成功获取用户视频列表",
      data: videos,
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message || "获取用户视频列表失败",
      data: null,
    });
  }
});

/**
 * @api {post} /api/video/parse
 * @description 解析B站视频信息（不下载，仅获取视频详情）
 * @access Protected - 需要用户登录和B站账号
 * @body { "url": "视频的URL或BVID", "quality": "清晰度(可选)" }
 */
router.post("/parse", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { url, quality = 80 } = req.body;
    
    if (!url || !url.trim()) {
      return res.status(400).json({
        code: 400,
        message: "请提供有效的视频 URL",
        data: null,
      });
    }

    // 检查用户是否有活跃的B站账号
    const bilibiliAccount = await bilibiliUtils.getActiveBilibiliAccount(userId);
    if (!bilibiliAccount) {
      return res.status(400).json({
        code: 400,
        message: "请先登录B站账号",
        data: null
      });
    }

    console.log(`▶️ 开始解析视频: ${url}`);
    const result = await videoUtils.parseVideoInfo(url, bilibiliAccount.cookie_string, quality);
    console.log(`✅ 视频解析完成: ${result.title}`);
    
    res.status(200).json({
      code: 200,
      message: "视频解析成功",
      data: result,
    });
  } catch (error) {
    console.error(`❌ 解析视频失败:`, error);
    res.status(500).json({
      code: 500,
      message: error.message || "解析视频失败",
      data: null,
    });
  }
});

/**
 * @api {post} /api/video/process
 * @description 处理B站视频（解析、下载、合并、入库）
 * @access Protected - 需要用户登录和B站账号
 * @body { "url": "视频的URL或BVID", "quality": "清晰度(可选)", "downloadMode": "下载模式(可选)" }
 */
router.post("/process", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { url, quality = 80, downloadMode = "auto" } = req.body;
    
    if (!url || !url.trim()) {
      return res.status(400).json({
        code: 400,
        message: "请提供有效的视频 URL",
        data: null,
      });
    }

    // 检查用户是否有活跃的B站账号
    const bilibiliAccount = await bilibiliUtils.getActiveBilibiliAccount(userId);
    if (!bilibiliAccount) {
      return res.status(400).json({
        code: 400,
        message: "请先登录B站账号",
        data: null
      });
    }

    console.log(`▶️ 开始处理视频请求: ${url}`);
    const result = await videoUtils.processVideoRequest({
      url,
      userId,
      cookieString: bilibiliAccount.cookie_string,
      quality,
      downloadMode,
      bilibiliAccountId: bilibiliAccount.id
    });
    console.log(`✅ 视频处理完成: ${result.title}`);
    
    res.status(201).json({
      code: 201,
      message: "视频处理成功并已入库",
      data: result,
    });
  } catch (error) {
    console.error(`❌ 处理视频失败:`, error);
    res.status(500).json({
      code: 500,
      message: error.message || "处理视频时发生未知错误",
      data: null,
    });
  }
});

/**
 * @api {post} /api/video/batch-process
 * @description 批量处理B站视频
 * @access Protected - 需要用户登录和B站账号
 * @body { "urls": ["视频URL数组"], "quality": "清晰度(可选)", "downloadMode": "下载模式(可选)" }
 */
router.post("/batch-process", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { urls, quality = 80, downloadMode = "auto" } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        code: 400,
        message: "请提供有效的视频 URL 数组",
        data: null,
      });
    }

    if (urls.length > 10) {
      return res.status(400).json({
        code: 400,
        message: "批量处理最多支持10个视频",
        data: null,
      });
    }

    // 检查用户是否有活跃的B站账号
    const bilibiliAccount = await bilibiliUtils.getActiveBilibiliAccount(userId);
    if (!bilibiliAccount) {
      return res.status(400).json({
        code: 400,
        message: "请先登录B站账号",
        data: null
      });
    }

    console.log(`▶️ 开始批量处理 ${urls.length} 个视频`);
    const results = await videoUtils.batchProcessVideos({
      urls,
      userId,
      cookieString: bilibiliAccount.cookie_string,
      quality,
      downloadMode,
      bilibiliAccountId: bilibiliAccount.id
    });
    console.log(`✅ 批量处理完成，成功: ${results.success.length}, 失败: ${results.failed.length}`);
    
    res.status(200).json({
      code: 200,
      message: `批量处理完成，成功: ${results.success.length}, 失败: ${results.failed.length}`,
      data: results,
    });
  } catch (error) {
    console.error(`❌ 批量处理视频失败:`, error);
    res.status(500).json({
      code: 500,
      message: error.message || "批量处理视频失败",
      data: null,
    });
  }
});

/**
 * @api {delete} /api/video/:id
 * @description 删除视频记录和文件
 * @access Protected - 需要用户登录
 */
router.delete("/:id", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { id } = req.params;
    const { deleteFile = false } = req.query;
    
    await videoUtils.deleteVideo(id, userId, deleteFile === 'true');
    
    res.status(200).json({
      code: 200,
      message: "视频删除成功",
      data: null,
    });
  } catch (error) {
    console.error(`❌ 删除视频失败:`, error);
    res.status(500).json({
      code: 500,
      message: error.message || "删除视频失败",
      data: null,
    });
  }
});

/**
 * @api {post} /api/video/generate-download-link
 * @description 生成安全下载链接
 * @access Protected - 需要用户登录
 */
router.post("/generate-download-link", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const { fileName } = req.body;
    const userId = req.user.uid || req.user.id;
    
    if (!fileName) {
      return res.status(400).json({
        code: 400,
        message: "文件名不能为空",
        data: null,
      });
    }
    
    // 检查用户是否有权限下载该文件
    const hasPermission = await videoUtils.checkDownloadPermission(fileName, userId);
    if (!hasPermission) {
      return res.status(403).json({
        code: 403,
        message: "无权限下载该文件",
        data: null,
      });
    }
    
    // 生成安全下载链接
    const downloadInfo = videoUtils.generateSecureDownloadLink(fileName, userId);
    
    res.status(200).json({
      code: 200,
      message: "下载链接生成成功",
      data: downloadInfo,
    });
  } catch (error) {
    console.error("生成下载链接失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "生成下载链接失败",
      data: null,
    });
  }
});

/**
 * @api {get} /api/video/secure-download
 * @description 安全文件下载（支持断点续传）
 * @access Public - 通过token验证
 */
router.get("/secure-download", async (req, res) => {
  try {
    const { token, file } = req.query;
    
    if (!token || !file) {
      return res.status(400).json({
        code: 400,
        message: "缺少必要参数",
        data: null,
      });
    }
    
    // 验证token
    const payload = videoUtils.verifyDownloadToken(token);
    if (!payload) {
      return res.status(401).json({
        code: 401,
        message: "下载链接已过期或无效",
        data: null,
      });
    }
    
    // 验证文件名是否匹配
    if (payload.fileName !== file) {
      return res.status(403).json({
        code: 403,
        message: "文件访问权限验证失败",
        data: null,
      });
    }
    
    // 再次检查用户权限
    const hasPermission = await videoUtils.checkDownloadPermission(file, payload.userId);
    if (!hasPermission) {
      return res.status(403).json({
        code: 403,
        message: "无权限下载该文件",
        data: null,
      });
    }
    
    // 处理安全下载
    await videoUtils.handleSecureDownload(file, req, res);
    
  } catch (error) {
    console.error("安全下载失败:", error);
    if (!res.headersSent) {
      res.status(500).json({
        code: 500,
        message: error.message || "下载失败",
        data: null,
      });
    }
  }
});

/**
 * @api {get} /api/video/download/:bvid
 * @description 直接下载视频（兼容旧版本）
 * @access Protected - 需要用户登录
 */
router.get("/download/:bvid", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const { bvid } = req.params;
    const userId = req.user.uid || req.user.id;
    
    // 构造文件名
    const fileName = `${bvid}.mp4`;
    
    // 检查用户是否有权限下载该文件
    const hasPermission = await videoUtils.checkDownloadPermission(fileName, userId);
    if (!hasPermission) {
      return res.status(403).json({
        code: 403,
        message: "无权限下载该文件，请先添加下载权限",
        data: null,
      });
    }
    
    // 处理安全下载
    await videoUtils.handleSecureDownload(fileName, req, res);
    
  } catch (error) {
    console.error("直接下载失败:", error);
    if (!res.headersSent) {
      res.status(500).json({
        code: 500,
        message: error.message || "下载失败",
        data: null,
      });
    }
  }
});

/**
 * @api {get} /api/video/available
 * @description 获取所有可下载的视频列表（公开接口）
 * @access Public
 */
router.get("/available", async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    // 确保参数是有效的数字，避免传递NaN
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);
    const validLimit = Math.max(1, Math.min(100, isNaN(parsedLimit) ? 20 : parsedLimit));
    const validOffset = Math.max(0, isNaN(parsedOffset) ? 0 : parsedOffset);
    
    const result = await videoUtils.getAvailableVideos(
      validLimit, 
      validOffset
    );
    
    res.status(200).json({
      code: 200,
      message: "成功获取可下载视频列表",
      data: result,
    });
  } catch (error) {
    console.error("获取可下载视频列表失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "获取视频列表失败",
      data: null,
    });
  }
});

/**
 * @api {post} /api/video/add-download-permission
 * @description 添加视频下载权限
 * @access Protected - 需要用户登录
 * @body { "bvid": "视频BVID" }
 */
router.post("/add-download-permission", authorize(["1", "2", "3", "4"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { bvid } = req.body;
    
    if (!bvid || !bvid.trim()) {
      return res.status(400).json({
        code: 400,
        message: "请提供有效的视频BVID",
        data: null,
      });
    }
    
    const result = await videoUtils.addVideoDownloader(userId, bvid.trim());
    
    res.status(200).json({
      code: 200,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("添加下载权限失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "添加下载权限失败",
      data: null,
    });
  }
});

/**
 * @api {get} /api/video/my-permissions/:bvid
 * @description 查看用户对特定视频的权限
 * @access Protected - 需要用户登录
 */
router.get("/my-permissions/:bvid", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { bvid } = req.params;
    
    // 检查用户对该视频的权限
    const fileName = `${bvid}.mp4`;
    const hasPermission = await videoUtils.checkDownloadPermission(fileName, userId);
    
    if (hasPermission) {
      // 获取具体的关系类型
      const db = require("../../config/db").promise();
      const [relations] = await db.execute(
        `SELECT uv.relation_type, uv.created_at, v.title 
         FROM user_videos uv 
         INNER JOIN videos v ON uv.video_id = v.id 
         WHERE uv.user_id = ? AND v.bvid = ?`,
        [userId, bvid]
      );
      
      if (relations.length > 0) {
        const relation = relations[0];
        res.status(200).json({
          code: 200,
          message: "有权限访问该视频",
          data: {
            hasPermission: true,
            relationType: relation.relation_type,
            relationDesc: videoUtils.getRelationTypeDesc ? videoUtils.getRelationTypeDesc(relation.relation_type) : relation.relation_type,
            addedAt: relation.created_at,
            videoTitle: relation.title
          },
        });
      } else {
        res.status(200).json({
          code: 200,
          message: "无权限访问该视频",
          data: { hasPermission: false },
        });
      }
    } else {
      res.status(200).json({
        code: 200,
        message: "无权限访问该视频",
        data: { hasPermission: false },
      });
    }
  } catch (error) {
    console.error("查询权限失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "查询权限失败",
      data: null,
    });
  }
});

module.exports = router;
