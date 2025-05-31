# 视频存储和播放方案

## 文件存储结构

### 目录说明
- `downloads/` - 临时下载目录，存放下载过程中的临时文件
- `videos/` - 最终视频存储目录，存放处理完成的视频文件

### 文件命名规则
- 临时文件：`{BVID}_{uniqueId}_{type}.{ext}`
  - 例如：`BV1Rs7VzsE5t_6c4b05a3_video.mp4`
  - 例如：`BV1Rs7VzsE5t_6c4b05a3_audio.mp3`
- 最终文件：`{BVID}.mp4`
  - 例如：`BV1Rs7VzsE5t.mp4`

## 播放方案

### 静态文件服务
服务器通过Express静态文件中间件提供视频文件访问：
```javascript
app.use("/api/videos", express.static(videoDir), serveIndex(videoDir, { icons: true }));
```

### 播放地址格式
```
http://{HOST}:{PORT}/api/videos/{BVID}.mp4
```

示例：
```
http://localhost:3000/api/videos/BV1Rs7VzsE5t.mp4
```

### 数据库存储
视频信息存储在 `videos` 表中，包含以下关键字段：
- `bvid` - B站视频ID
- `title` - 视频标题
- `download_link` - 播放地址
- 其他视频元数据（观看数、点赞数、UP主信息等）

## 前端集成

### 获取视频列表
```javascript
fetch('/api/video/list')
  .then(response => response.json())
  .then(data => {
    // data.data 包含视频列表
    // 每个视频对象包含 download_link 字段
  });
```

### 播放视频
```html
<video controls>
  <source src="{download_link}" type="video/mp4">
  您的浏览器不支持视频播放。
</video>
```

## 优势

1. **简洁的文件命名**：最终文件只保留BVID，便于管理
2. **清晰的目录结构**：临时文件和最终文件分离
3. **标准化的播放地址**：统一的URL格式，便于前端调用
4. **完整的元数据存储**：数据库中保存所有视频信息
5. **支持分离部署**：前端可以通过HTTP请求获取视频资源

## 注意事项

1. 确保 `videos` 目录有足够的存储空间
2. 定期清理 `downloads` 目录中的临时文件
3. 考虑添加视频文件的压缩和转码功能
4. 可以考虑添加CDN支持以提高播放性能