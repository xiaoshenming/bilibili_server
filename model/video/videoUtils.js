// model/video/videoUtils.js

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const db = require("../../config/db").promise();
const bilibiliUtils = require("../bilibili/bilibiliUtils");

// 配置路径
const DOWNLOAD_DIR = path.join(__dirname, "../../downloads"); // 下载目录
const FFMPEG_PATH = "ffmpeg"; // FFmpeg 可执行文件路径，确保已安装并在 PATH 中

// 确保下载目录存在
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  console.log(`📁 创建下载目录: ${DOWNLOAD_DIR}`);
}

// 视频质量映射
const QUALITY_MAP = {
  120: "4K 超清",
  116: "1080P60 高清",
  112: "1080P+ 高清",
  80: "1080P 高清",
  74: "720P60 高清",
  64: "720P 高清",
  32: "480P 清晰",
  16: "360P 流畅"
};

/**
 * 提取BVID从URL
 * @param {string} url - 视频URL或BVID
 * @returns {string} BVID
 */
function extractBVID(url) {
  if (url.startsWith('BV')) {
    return url;
  }
  const bvidMatch = url.match(/BV[a-zA-Z0-9]+/);
  if (bvidMatch) {
    return bvidMatch[0];
  }
  throw new Error('无法从URL中提取BVID');
}

/**
 * 解析B站视频信息（使用B站账号Cookie）
 * @param {string} url - 视频URL或BVID
 * @param {string} cookieString - B站账号Cookie
 * @param {number} quality - 视频质量
 * @returns {Promise<Object>} 视频信息
 */
async function parseVideoInfo(url, cookieString, quality = 80) {
  try {
    const bvid = extractBVID(url);
    console.log(`🔍 正在解析视频信息: ${bvid}`);
    
    // 获取视频基本信息
    const videoInfo = await bilibiliUtils.getBilibiliVideoInfo(bvid, cookieString);
    
    // 获取播放信息（包含下载链接）
    const playInfo = await bilibiliUtils.getBilibiliPlayInfo(bvid, cookieString, quality);
    
    const result = {
      bvid: videoInfo.bvid,
      aid: videoInfo.aid,
      title: videoInfo.title,
      description: videoInfo.desc,
      duration: videoInfo.duration,
      view: videoInfo.stat.view,
      like: videoInfo.stat.like,
      coin: videoInfo.stat.coin,
      share: videoInfo.stat.share,
      reply: videoInfo.stat.reply,
      favorite: videoInfo.stat.favorite,
      owner: {
        mid: videoInfo.owner.mid,
        name: videoInfo.owner.name,
        face: videoInfo.owner.face
      },
      pubdate: videoInfo.pubdate,
      pic: videoInfo.pic,
      pages: videoInfo.pages,
      quality: quality,
      qualityDesc: QUALITY_MAP[quality] || '未知画质',
      downloadUrls: playInfo.downloadUrls,
      videoUrl: playInfo.videoUrl,
      audioUrl: playInfo.audioUrl,
      fileSize: playInfo.fileSize
    };
    
    console.log(`✅ 视频信息解析完成: ${result.title}`);
    return result;
  } catch (error) {
    console.error(`❌ 解析视频信息失败:`, error.message);
    throw new Error(`解析视频信息失败: ${error.message}`);
  }
}

/**
 * 下载文件（支持进度回调）
 * @param {string} url - 下载链接
 * @param {string} filePath - 保存路径
 * @param {string} cookieString - B站Cookie
 * @param {Function} progressCallback - 进度回调函数
 * @returns {Promise<void>}
 */
async function downloadFile(url, filePath, cookieString, progressCallback) {
  try {
    console.log(`⬇️ 开始下载文件: ${path.basename(filePath)}`);
    
    const response = await axios({
      method: "GET",
      url: url,
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.bilibili.com/",
        "Cookie": cookieString,
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      },
      timeout: 30000
    });

    const totalLength = parseInt(response.headers['content-length'], 10);
    let downloadedLength = 0;

    const writer = fs.createWriteStream(filePath);
    
    response.data.on('data', (chunk) => {
      downloadedLength += chunk.length;
      if (progressCallback && totalLength) {
        const progress = (downloadedLength / totalLength * 100).toFixed(2);
        progressCallback(progress, downloadedLength, totalLength);
      }
    });
    
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        console.log(`✅ 文件下载完成: ${path.basename(filePath)}`);
        resolve();
      });
      writer.on("error", (error) => {
        console.error(`❌ 文件下载失败: ${path.basename(filePath)}`, error);
        reject(error);
      });
    });
  } catch (error) {
    console.error(`❌ 下载文件失败: ${path.basename(filePath)}`, error.message);
    throw error;
  }
}

/**
 * 使用 FFmpeg 合并视频和音频（支持进度回调）
 * @param {string} videoPath - 视频文件路径
 * @param {string} audioPath - 音频文件路径
 * @param {string} outputPath - 输出文件路径
 * @param {Function} progressCallback - 进度回调函数
 * @returns {Promise<void>}
 */
function mergeVideoAndAudio(videoPath, audioPath, outputPath, progressCallback) {
  return new Promise((resolve, reject) => {
    console.log(`🔧 开始合并视频和音频: ${path.basename(outputPath)}`);

    const ffmpeg = spawn(FFMPEG_PATH, [
      "-i", videoPath,
      "-i", audioPath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-strict", "experimental",
      "-y", // 覆盖输出文件
      outputPath,
    ]);

    let duration = null;
    
    ffmpeg.stderr.on("data", (data) => {
      const output = data.toString();
      
      // 提取总时长
      if (!duration) {
        const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (durationMatch) {
          const hours = parseInt(durationMatch[1]);
          const minutes = parseInt(durationMatch[2]);
          const seconds = parseInt(durationMatch[3]);
          duration = hours * 3600 + minutes * 60 + seconds;
        }
      }
      
      // 提取当前进度
      if (duration && progressCallback) {
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseInt(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          const progress = (currentTime / duration * 100).toFixed(2);
          progressCallback(progress, currentTime, duration);
        }
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ 视频合并完成: ${path.basename(outputPath)}`);
        resolve();
      } else {
        console.error(`❌ FFmpeg 进程退出，代码: ${code}`);
        reject(new Error(`FFmpeg 合并失败，退出代码: ${code}`));
      }
    });

    ffmpeg.on("error", (error) => {
      console.error(`❌ FFmpeg 启动失败:`, error);
      reject(error);
    });
  });
}

/**
 * 将视频信息保存到数据库
 * @param {Object} videoInfo - 视频信息
 * @param {string} filePath - 文件路径
 * @param {number} userId - 用户ID
 * @param {number} bilibiliAccountId - B站账号ID
 * @returns {Promise<Object>} 数据库记录
 */
async function saveOrUpdateVideoInDb(videoInfo, filePath, userId, bilibiliAccountId) {
  try {
    console.log(`💾 保存视频信息到数据库: ${videoInfo.title}`);

    // 检查视频是否已存在（同一用户的同一视频）
    const [existingVideos] = await db.execute(
      "SELECT * FROM videos WHERE bvid = ? AND user_id = ?",
      [videoInfo.bvid, userId]
    );

    const videoData = {
      bvid: videoInfo.bvid,
      aid: videoInfo.aid,
      title: videoInfo.title,
      description: videoInfo.description || "",
      duration: videoInfo.duration || 0,
      view_count: videoInfo.view || 0,
      like_count: videoInfo.like || 0,
      coin_count: videoInfo.coin || 0,
      share_count: videoInfo.share || 0,
      reply_count: videoInfo.reply || 0,
      favorite_count: videoInfo.favorite || 0,
      author: videoInfo.owner?.name || "未知",
      author_mid: videoInfo.owner?.mid || 0,
      author_face: videoInfo.owner?.face || "",
      publish_time: videoInfo.pubdate ? new Date(videoInfo.pubdate * 1000) : new Date(),
      file_path: filePath,
      file_size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
      thumbnail_url: videoInfo.pic || "",
      quality: videoInfo.quality || 80,
      quality_desc: videoInfo.qualityDesc || "未知画质",
      user_id: userId,
      bilibili_account_id: bilibiliAccountId,
      updated_at: new Date(),
    };

    if (existingVideos.length > 0) {
      // 更新现有记录
      await db.execute(
        `UPDATE videos SET 
         title = ?, description = ?, duration = ?, view_count = ?, like_count = ?, 
         coin_count = ?, share_count = ?, reply_count = ?, favorite_count = ?, 
         author = ?, author_mid = ?, author_face = ?, publish_time = ?, 
         file_path = ?, file_size = ?, thumbnail_url = ?, quality = ?, quality_desc = ?,
         bilibili_account_id = ?, updated_at = ?
         WHERE bvid = ? AND user_id = ?`,
        [
          videoData.title, videoData.description, videoData.duration,
          videoData.view_count, videoData.like_count, videoData.coin_count,
          videoData.share_count, videoData.reply_count, videoData.favorite_count,
          videoData.author, videoData.author_mid, videoData.author_face,
          videoData.publish_time, videoData.file_path, videoData.file_size,
          videoData.thumbnail_url, videoData.quality, videoData.quality_desc,
          videoData.bilibili_account_id, videoData.updated_at,
          videoData.bvid, videoData.user_id
        ]
      );
      console.log(`✅ 更新视频记录: ${videoInfo.title}`);
      return { ...existingVideos[0], ...videoData };
    } else {
      // 插入新记录
      const [result] = await db.execute(
        `INSERT INTO videos 
         (bvid, aid, title, description, duration, view_count, like_count, coin_count, 
          share_count, reply_count, favorite_count, author, author_mid, author_face, 
          publish_time, file_path, file_size, thumbnail_url, quality, quality_desc,
          user_id, bilibili_account_id, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          videoData.bvid, videoData.aid, videoData.title, videoData.description,
          videoData.duration, videoData.view_count, videoData.like_count,
          videoData.coin_count, videoData.share_count, videoData.reply_count,
          videoData.favorite_count, videoData.author, videoData.author_mid,
          videoData.author_face, videoData.publish_time, videoData.file_path,
          videoData.file_size, videoData.thumbnail_url, videoData.quality,
          videoData.quality_desc, videoData.user_id, videoData.bilibili_account_id,
          videoData.updated_at
        ]
      );
      console.log(`✅ 新增视频记录: ${videoInfo.title}`);
      return { id: result.insertId, ...videoData };
    }
  } catch (error) {
    console.error(`❌ 保存视频信息到数据库失败:`, error);
    throw error;
  }
}

/**
 * 获取所有视频列表
 * @returns {Promise<Array>} 视频列表
 */
async function listAllVideos() {
  try {
    const [videos] = await db.execute(
      `SELECT v.*, u.username, ba.nickname as bilibili_nickname 
       FROM videos v 
       LEFT JOIN users u ON v.user_id = u.id 
       LEFT JOIN bilibili_accounts ba ON v.bilibili_account_id = ba.id 
       ORDER BY v.created_at DESC`
    );
    return videos;
  } catch (error) {
    console.error(`❌ 获取视频列表失败:`, error);
    throw error;
  }
}

/**
 * 获取用户的视频列表
 * @param {number} userId - 用户ID
 * @returns {Promise<Array>} 用户视频列表
 */
async function getUserVideos(userId) {
  try {
    const [videos] = await db.execute(
      `SELECT v.*, ba.nickname as bilibili_nickname 
       FROM videos v 
       LEFT JOIN bilibili_accounts ba ON v.bilibili_account_id = ba.id 
       WHERE v.user_id = ? 
       ORDER BY v.created_at DESC`,
      [userId]
    );
    return videos;
  } catch (error) {
    console.error(`❌ 获取用户视频列表失败:`, error);
    throw error;
  }
}

/**
 * 删除视频记录和文件
 * @param {number} videoId - 视频ID
 * @param {number} userId - 用户ID
 * @param {boolean} deleteFile - 是否删除文件
 * @returns {Promise<void>}
 */
async function deleteVideo(videoId, userId, deleteFile = false) {
  try {
    // 获取视频信息
    const [videos] = await db.execute(
      "SELECT * FROM videos WHERE id = ? AND user_id = ?",
      [videoId, userId]
    );
    
    if (videos.length === 0) {
      throw new Error('视频不存在或无权限删除');
    }
    
    const video = videos[0];
    
    // 删除数据库记录
    await db.execute("DELETE FROM videos WHERE id = ? AND user_id = ?", [videoId, userId]);
    
    // 删除文件
    if (deleteFile && video.file_path && fs.existsSync(video.file_path)) {
      fs.unlinkSync(video.file_path);
      console.log(`🗑️ 删除视频文件: ${video.file_path}`);
    }
    
    console.log(`✅ 删除视频记录: ${video.title}`);
  } catch (error) {
    console.error(`❌ 删除视频失败:`, error);
    throw error;
  }
}

/**
 * 处理视频请求的主函数
 * @param {Object} options - 处理选项
 * @returns {Promise<Object>} 处理结果
 */
async function processVideoRequest(options) {
  const {
    url,
    userId,
    cookieString,
    quality = 80,
    downloadMode = "auto",
    bilibiliAccountId
  } = options;
  
  try {
    // 1. 解析视频信息
    const videoInfo = await parseVideoInfo(url, cookieString, quality);

    // 2. 创建文件名和路径
    const sanitizedTitle = videoInfo.title
      .replace(/[<>:"/\\|?*]/g, "_")
      .substring(0, 100); // 限制文件名长度
    
    const uniqueId = uuidv4().substring(0, 8);
    const videoFileName = `${videoInfo.bvid}_${uniqueId}_video.mp4`;
    const audioFileName = `${videoInfo.bvid}_${uniqueId}_audio.mp3`;
    const outputFileName = `${videoInfo.bvid}_${sanitizedTitle}_${uniqueId}.mp4`;

    const videoPath = path.join(DOWNLOAD_DIR, videoFileName);
    const audioPath = path.join(DOWNLOAD_DIR, audioFileName);
    const outputPath = path.join(DOWNLOAD_DIR, outputFileName);

    // 3. 下载视频和音频
    console.log(`📥 开始下载视频和音频...`);
    
    const downloadPromises = [];
    
    if (downloadMode === "video" || downloadMode === "auto") {
      downloadPromises.push(
        downloadFile(videoInfo.videoUrl, videoPath, cookieString, (progress) => {
          console.log(`📹 视频下载进度: ${progress}%`);
        })
      );
    }
    
    if (downloadMode === "audio" || downloadMode === "auto") {
      downloadPromises.push(
        downloadFile(videoInfo.audioUrl, audioPath, cookieString, (progress) => {
          console.log(`🎵 音频下载进度: ${progress}%`);
        })
      );
    }
    
    await Promise.all(downloadPromises);

    // 4. 合并视频和音频（如果都下载了）
    let finalPath = outputPath;
    if (downloadMode === "auto" && fs.existsSync(videoPath) && fs.existsSync(audioPath)) {
      await mergeVideoAndAudio(videoPath, audioPath, outputPath, (progress) => {
        console.log(`🔧 合并进度: ${progress}%`);
      });
      
      // 清理临时文件
      try {
        fs.unlinkSync(videoPath);
        fs.unlinkSync(audioPath);
        console.log(`🗑️ 清理临时文件完成`);
      } catch (cleanupError) {
        console.warn(`⚠️ 清理临时文件失败:`, cleanupError.message);
      }
    } else if (downloadMode === "video" && fs.existsSync(videoPath)) {
      finalPath = videoPath;
    } else if (downloadMode === "audio" && fs.existsSync(audioPath)) {
      finalPath = audioPath;
    }

    // 5. 保存到数据库
    const dbRecord = await saveOrUpdateVideoInDb(videoInfo, finalPath, userId, bilibiliAccountId);

    return {
      ...dbRecord,
      message: "视频处理完成",
      downloadMode,
      qualityDesc: videoInfo.qualityDesc
    };
  } catch (error) {
    console.error(`❌ 处理视频请求失败:`, error);
    throw error;
  }
}

/**
 * 批量处理视频
 * @param {Object} options - 批量处理选项
 * @returns {Promise<Object>} 批量处理结果
 */
async function batchProcessVideos(options) {
  const {
    urls,
    userId,
    cookieString,
    quality = 80,
    downloadMode = "auto",
    bilibiliAccountId
  } = options;
  
  const results = {
    success: [],
    failed: [],
    total: urls.length
  };
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      console.log(`📦 批量处理进度: ${i + 1}/${urls.length} - ${url}`);
      
      const result = await processVideoRequest({
        url,
        userId,
        cookieString,
        quality,
        downloadMode,
        bilibiliAccountId
      });
      
      results.success.push({
        url,
        result,
        index: i + 1
      });
      
      // 添加延迟避免请求过于频繁
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
    } catch (error) {
      console.error(`❌ 批量处理第 ${i + 1} 个视频失败:`, error.message);
      results.failed.push({
        url,
        error: error.message,
        index: i + 1
      });
    }
  }
  
  return results;
}

module.exports = {
  parseVideoInfo,
  downloadFile,
  mergeVideoAndAudio,
  saveOrUpdateVideoInDb,
  listAllVideos,
  getUserVideos,
  deleteVideo,
  processVideoRequest,
  batchProcessVideos,
  extractBVID,
  QUALITY_MAP
};
