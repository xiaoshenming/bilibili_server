// model/video/videoUtils.js

const db = require("../../config/db").promise(); // 【复用】导入并使用 promise 版本的数据库连接池
const axios = require("axios");
const fs = require("fs").promises; // 使用 promise 版本的 fs 模块
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");

// 从环境变量中获取配置
const FFMPEG_PATH = process.env.FFMPEG_PATH;
const FLASK_API_BASE_URL =
  process.env.FLASK_API_BASE_URL || "http://127.0.0.1:7893"; // 建议将 Flask 地址也放入 .env
const SERVER_HOST = process.env.SERVER_HOST || "10.3.36.36"; // 服务器公网 IP 或域名
const PORT = process.env.PORT || 3000;

// 设置 ffmpeg 路径
if (FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(FFMPEG_PATH);
} else {
  console.warn(
    "⚠️ 未在 .env 文件中配置 FFmpeg_PATH 路径，合并功能可能无法使用。"
  );
}

const downloadDir = path.join(__dirname, "..", "..", "download"); // 临时下载文件夹
const videoDir = path.join(__dirname, "..", "..", "video"); // 最终视频输出文件夹

/**
 * @description 调用 Flask API 爬取 Bilibili 视频的详细信息。
 * @param {string} url - Bilibili 视频的 URL 或 BVID。
 * @returns {Promise<object>} - 包含视频详细信息的对象。
 */
async function scrapeBilibiliVideo(url) {
  try {
    console.log(`[1/4] 正在从 Flask API 爬取视频信息: ${url}`);
    const response = await axios.get(`${FLASK_API_BASE_URL}/parse_videos`, {
      params: { input: url },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      },
    });

    if (response.status !== 200 || !response.data) {
      throw new Error(`Flask API 响应异常，状态码：${response.status}`);
    }

    console.log(`[1/4] ✔️ 视频信息爬取成功: ${response.data.title}`);
    return response.data;
  } catch (error) {
    console.error("❌ 爬取 Bilibili 视频信息失败:", error.message);
    throw new Error("爬取视频信息失败，请检查视频链接或稍后再试。");
  }
}

/**
 * @description 调用 Flask API 下载视频和音频文件到临时目录。
 * @param {string} bvid - 视频的 BVID。
 * @param {string} cid - 视频的 CID。
 * @returns {Promise<{videoFilePath: string, audioFilePath: string}>} - 包含视频和音频文件路径的对象。
 */
async function downloadFiles(bvid, cid) {
  try {
    console.log(`[2/4] 正在请求 Flask API 下载视频和音频... (BVID: ${bvid})`);
    // 确保临时目录和最终目录存在
    await fs.mkdir(downloadDir, { recursive: true });
    await fs.mkdir(videoDir, { recursive: true });

    const response = await axios.get(`${FLASK_API_BASE_URL}/download`, {
      params: { bvid, cid, quality: 80 }, // quality 可以作为参数传递
    });

    const { video_file, audio_file, message } = response.data;
    if (message !== "下载成功" || !video_file || !audio_file) {
      throw new Error(`Flask API 下载失败: ${message}`);
    }

    // 注意：这里的逻辑假设 Flask 将文件下载到了 Node.js 可以访问的共享目录 `downloadDir` 中
    const videoFilePath = path.join(downloadDir, video_file);
    const audioFilePath = path.join(downloadDir, audio_file);

    // 检查文件是否真的存在
    await fs.access(videoFilePath);
    await fs.access(audioFilePath);

    console.log(`[2/4] ✔️ 文件下载成功: ${video_file}, ${audio_file}`);
    return { videoFilePath, audioFilePath };
  } catch (error) {
    console.error("❌ 调用 Flask API 下载文件失败:", error.message);
    throw new Error("下载视频源文件失败，可能是后端服务异常。");
  }
}

/**
 * @description 使用 FFmpeg 合并视频和音频文件。
 * @param {string} videoFilePath - 视频文件路径。
 * @param {string} audioFilePath - 音频文件路径。
 * @param {string} outputFilePath - 合并后的输出文件路径。
 * @returns {Promise<void>}
 */
function mergeVideoAndAudio(videoFilePath, audioFilePath, outputFilePath) {
  return new Promise((resolve, reject) => {
    console.log(`[3/4] 正在使用 FFmpeg 合并文件...`);
    ffmpeg()
      .input(videoFilePath)
      .input(audioFilePath)
      .videoCodec("h264_nvenc") // 使用 NVIDIA GPU 硬编码，如果服务器没有 GPU，请改为 'libx264'
      .audioCodec("aac")
      .on("end", () => {
        console.log(`[3/4] ✔️ 文件合并成功: ${outputFilePath}`);
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ FFmpeg 合并失败:", err);
        reject(new Error("视频文件合并失败，请检查服务器 FFmpeg 配置。"));
      })
      .save(outputFilePath);
  });
}

/**
 * @description 将视频的元数据存入或更新到数据库。
 * @param {object} videoData - 从 `scrapeBilibiliVideo` 获取的视频数据。
 * @param {boolean} exists - 视频是否已存在于数据库中。
 * @returns {Promise<object>} - 整理后的、包含下载链接的视频数据。
 */
async function saveOrUpdateVideoInDb(videoData, exists) {
  console.log(`[4/4] 正在将视频信息 ${exists ? "更新" : "写入"} 数据库...`);

  const downloadLink = `http://${SERVER_HOST}:${PORT}/${videoData.bvid}.mp4`;

  const record = {
    bvid: videoData.bvid,
    aid: videoData.aid,
    cid: videoData.cid,
    tname: videoData.tname,
    pic: videoData.pic,
    title: videoData.title,
    desc: videoData.desc,
    duration: videoData.duration,
    pubdate: videoData.pubdate,
    name: videoData.name,
    face: videoData.face,
    view: videoData.view,
    danmaku: videoData.danmaku,
    reply: videoData.reply,
    favorite: videoData.favorite,
    coin: videoData.coin,
    share: videoData.share,
    like: videoData.like,
    download_link: downloadLink,
  };

  try {
    if (exists) {
      const [updateResult] = await db.query(
        "UPDATE videos SET ? WHERE bvid = ?",
        [record, videoData.bvid]
      );
      if (updateResult.affectedRows === 0)
        throw new Error("更新数据库失败，未找到对应记录。");
    } else {
      const [insertResult] = await db.query("INSERT INTO videos SET ?", record);
      if (insertResult.affectedRows === 0) throw new Error("插入数据库失败。");
    }
    console.log(`[4/4] ✔️ 数据库操作成功!`);
    return record;
  } catch (error) {
    console.error("❌ 数据库操作失败:", error);
    throw new Error("数据库操作失败，请检查数据库连接或表结构。");
  }
}

/**
 * @description 获取数据库中所有视频的列表。
 * @returns {Promise<Array>} - 视频信息数组。
 */
async function listAllVideos() {
  try {
    const [rows] = await db.query("SELECT * FROM videos ORDER BY id DESC");
    return rows;
  } catch (error) {
    console.error("❌ 查询视频列表失败:", error);
    throw new Error("获取视频列表失败。");
  }
}

/**
 * @description 主流程函数：处理单个视频的下载和入库请求。
 * @param {string} url - 视频 URL。
 * @returns {Promise<object>} - 处理完成后的视频数据。
 */
async function processVideoRequest(url) {
  const videoData = await scrapeBilibiliVideo(url);
  const { bvid, cid } = videoData;

  const [rows] = await db.query("SELECT * FROM videos WHERE bvid = ?", [bvid]);
  const videoExists = rows.length > 0;

  // 无论视频是否存在，我们都更新/插入最新的信息。
  // 如果视频文件不存在，则执行下载和合并。
  const outputFilePath = path.join(videoDir, `${bvid}.mp4`);
  let fileExists = false;
  try {
    await fs.access(outputFilePath);
    fileExists = true;
    console.log(`ℹ️ 视频文件 ${bvid}.mp4 已存在，跳过下载和合并步骤。`);
  } catch (error) {
    // 文件不存在，执行下载和合并
  }

  if (!fileExists) {
    const { videoFilePath, audioFilePath } = await downloadFiles(bvid, cid);
    await mergeVideoAndAudio(videoFilePath, audioFilePath, outputFilePath);

    // 清理临时文件
    try {
      await fs.unlink(videoFilePath);
      await fs.unlink(audioFilePath);
      console.log(`🧹 临时文件已清理。`);
    } catch (cleanError) {
      console.warn(`⚠️ 清理临时文件失败: ${cleanError.message}`);
    }
  }

  const finalData = await saveOrUpdateVideoInDb(videoData, videoExists);
  return finalData;
}

module.exports = {
  listAllVideos,
  processVideoRequest,
};
