// model/video/videoUtils.js

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const db = require("../../config/db").promise();
const bilibiliUtils = require("../bilibili/bilibiliUtils");

// 配置路径
const DOWNLOAD_DIR = path.join(__dirname, "../../downloads"); // 临时下载目录
const VIDEO_DIR = path.join(__dirname, "../../videos"); // 最终视频存储目录
const FFMPEG_PATH = "ffmpeg"; // FFmpeg 可执行文件路径，确保已安装并在 PATH 中

// 确保目录存在
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  console.log(`📁 创建临时下载目录: ${DOWNLOAD_DIR}`);
}

if (!fs.existsSync(VIDEO_DIR)) {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  console.log(`📁 创建视频存储目录: ${VIDEO_DIR}`);
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
    
    // 获取视频信息和下载链接
    const videoInfo = await bilibiliUtils.getBilibiliVideoInfo(bvid, cookieString);
    
    const result = {
      bvid: bvid,
      aid: videoInfo.aid || null,
      title: videoInfo.title,
      description: videoInfo.description,
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
        face: videoInfo.owner.face || null
      },
      pubdate: videoInfo.pubdate || null,
      pic: videoInfo.pic,
      pages: videoInfo.pages || [],
      quality: quality,
      qualityDesc: QUALITY_MAP[quality] || '未知画质',
      downloadUrls: videoInfo.downloadUrls,
      videoUrl: videoInfo.downloadUrls.video,
      audioUrl: videoInfo.downloadUrls.audio,
      fileSize: null // 文件大小需要在下载时获取
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
 * @param {string} playUrl - 播放地址
 * @param {number} userId - 用户ID
 * @param {number} bilibiliAccountId - B站账号ID
 * @returns {Promise<Object>} 数据库记录
 */
async function saveOrUpdateVideoInDb(videoInfo, filePath, playUrl, userId, bilibiliAccountId) {
  try {
    console.log(`💾 保存视频信息到数据库: ${videoInfo.title}`);

    // 检查视频是否已存在（根据bvid）
    const [existingVideos] = await db.execute(
      "SELECT * FROM videos WHERE bvid = ?",
      [videoInfo.bvid]
    );

    if (existingVideos.length > 0) {
      // 更新现有记录
      await db.execute(
        `UPDATE videos SET 
         title = ?, pic = ?, view = ?, danmaku = ?, \`like\` = ?, 
         coin = ?, favorite = ?, share = ?, reply = ?, 
         name = ?, face = ?, pubdate = ?, 
         quality = ?, \`desc\` = ?, duration = ?, aid = ?, download_link = ?
         WHERE bvid = ?`,
        [
          videoInfo.title,
          videoInfo.pic || "",
          videoInfo.view || 0,
          videoInfo.stat?.danmaku || 0,
          videoInfo.like || 0,
          videoInfo.coin || 0,
          videoInfo.favorite || 0,
          videoInfo.share || 0,
          videoInfo.reply || 0,
          videoInfo.owner?.name || "未知",
          videoInfo.owner?.face || "",
          videoInfo.pubdate || "",
          videoInfo.quality || 80,
          videoInfo.description || "",
          videoInfo.duration || 0,
          videoInfo.aid || "",
          playUrl,
          videoInfo.bvid
        ]
      );
      
      console.log(`✅ 视频信息已更新: ${videoInfo.title}`);
      return { 
        id: existingVideos[0].id, 
        updated: true,
        title: videoInfo.title,
        bvid: videoInfo.bvid,
        filePath: filePath,
        playUrl: playUrl
      };
    } else {
      // 插入新记录
      const [result] = await db.execute(
        `INSERT INTO videos (
          bvid, aid, title, pic, view, danmaku, \`like\`, coin, favorite, share, reply,
          name, face, pubdate, quality, \`desc\`, duration, download_link
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          videoInfo.bvid,
          videoInfo.aid || "",
          videoInfo.title,
          videoInfo.pic || "",
          videoInfo.view || 0,
          videoInfo.stat?.danmaku || 0,
          videoInfo.like || 0,
          videoInfo.coin || 0,
          videoInfo.favorite || 0,
          videoInfo.share || 0,
          videoInfo.reply || 0,
          videoInfo.owner?.name || "未知",
          videoInfo.owner?.face || "",
          videoInfo.pubdate || "",
          videoInfo.quality || 80,
          videoInfo.description || "",
          videoInfo.duration || 0,
          playUrl
        ]
      );
      
      console.log(`✅ 视频信息已保存: ${videoInfo.title}`);
      return { 
        id: result.insertId, 
        updated: false,
        title: videoInfo.title,
        bvid: videoInfo.bvid,
        filePath: filePath,
        playUrl: playUrl
      };
    }
  } catch (error) {
    console.error('❌ 保存视频信息到数据库失败:', error);
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
      `SELECT * FROM videos ORDER BY id DESC`
    );
    return videos;
  } catch (error) {
    console.error(`❌ 获取视频列表失败:`, error);
    throw error;
  }
}

/**
 * 获取用户的视频列表
 * @param {number} userId - 用户ID（暂时不使用，返回所有视频）
 * @returns {Promise<Array>} 用户视频列表
 */
async function getUserVideos(userId) {
  try {
    // 由于当前表结构没有user_id字段，暂时返回所有视频
    const [videos] = await db.execute(
      `SELECT * FROM videos ORDER BY id DESC`
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
 * @param {number} userId - 用户ID（暂时不使用）
 * @param {boolean} deleteFile - 是否删除文件
 * @returns {Promise<void>}
 */
async function deleteVideo(videoId, userId, deleteFile = false) {
  try {
    // 获取视频信息
    const [videos] = await db.execute(
      "SELECT * FROM videos WHERE id = ?",
      [videoId]
    );
    
    if (videos.length === 0) {
      throw new Error('视频不存在');
    }
    
    const video = videos[0];
    
    // 删除数据库记录
    await db.execute("DELETE FROM videos WHERE id = ?", [videoId]);
    
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
    const uniqueId = uuidv4().substring(0, 8);
    const tempVideoFileName = `${videoInfo.bvid}_${uniqueId}_video.mp4`;
    const tempAudioFileName = `${videoInfo.bvid}_${uniqueId}_audio.mp3`;
    const tempOutputFileName = `${videoInfo.bvid}_${uniqueId}_temp.mp4`;
    const finalFileName = `${videoInfo.bvid}.mp4`; // 最终文件名只保留BVID

    const tempVideoPath = path.join(DOWNLOAD_DIR, tempVideoFileName);
    const tempAudioPath = path.join(DOWNLOAD_DIR, tempAudioFileName);
    const tempOutputPath = path.join(DOWNLOAD_DIR, tempOutputFileName);
    const finalVideoPath = path.join(VIDEO_DIR, finalFileName);

    // 3. 下载视频和音频
    console.log(`📥 开始下载视频和音频...`);
    
    const downloadPromises = [];
    
    if (downloadMode === "video" || downloadMode === "auto") {
      downloadPromises.push(
        downloadFile(videoInfo.videoUrl, tempVideoPath, cookieString, (progress) => {
          console.log(`📹 视频下载进度: ${progress}%`);
        })
      );
    }
    
    if (downloadMode === "audio" || downloadMode === "auto") {
      downloadPromises.push(
        downloadFile(videoInfo.audioUrl, tempAudioPath, cookieString, (progress) => {
          console.log(`🎵 音频下载进度: ${progress}%`);
        })
      );
    }
    
    await Promise.all(downloadPromises);

    // 4. 合并视频和音频（如果都下载了）
    let tempFinalPath = tempOutputPath;
    if (downloadMode === "auto" && fs.existsSync(tempVideoPath) && fs.existsSync(tempAudioPath)) {
      console.log(`🔧 开始合并视频和音频: ${finalFileName}`);
      await mergeVideoAndAudio(tempVideoPath, tempAudioPath, tempOutputPath, (progress) => {
        console.log(`🔧 合并进度: ${progress}%`);
      });
      
      // 清理临时文件
      try {
        fs.unlinkSync(tempVideoPath);
        fs.unlinkSync(tempAudioPath);
        console.log(`🗑️ 清理临时文件完成`);
      } catch (cleanupError) {
        console.warn(`⚠️ 清理临时文件失败:`, cleanupError.message);
      }
    } else if (downloadMode === "video" && fs.existsSync(tempVideoPath)) {
      tempFinalPath = tempVideoPath;
    } else if (downloadMode === "audio" && fs.existsSync(tempAudioPath)) {
      tempFinalPath = tempAudioPath;
    }

    // 5. 移动文件到最终目录
    if (fs.existsSync(tempFinalPath)) {
      // 如果最终文件已存在，先删除
      if (fs.existsSync(finalVideoPath)) {
        fs.unlinkSync(finalVideoPath);
        console.log(`🗑️ 删除已存在的文件: ${finalFileName}`);
      }
      
      fs.renameSync(tempFinalPath, finalVideoPath);
      console.log(`📁 文件已移动到: ${finalVideoPath}`);
    } else {
      throw new Error('处理后的视频文件不存在');
    }

    // 6. 生成播放地址
    const serverPort = process.env.PORT || 3000;
    const serverHost = process.env.HOST || 'localhost';
    const playUrl = `http://${serverHost}:${serverPort}/api/videos/${finalFileName}`;

    // 7. 保存到数据库
    const dbRecord = await saveOrUpdateVideoInDb(videoInfo, finalVideoPath, playUrl, userId, bilibiliAccountId);

    return {
      ...dbRecord,
      message: "视频处理完成",
      downloadMode,
      qualityDesc: videoInfo.qualityDesc,
      playUrl: playUrl
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
