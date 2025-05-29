from flask import Flask, jsonify, send_file, render_template, request,Response
from flask_cors import CORS
import requests
import qrcode
import threading
import time
from datetime import datetime
from io import BytesIO
import os
import csv
app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

# 全局变量存储二维码状态
qrcode_data = {}

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
    'Accept-Encoding': 'gzip, deflate',
    'Referer': 'https://www.bilibili.com/read/cv34766197/',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Priority': 'u=1',
    'TE': 'trailers'
}

# 全局变量保存当前登录状态
current_login = {"dedeuserid": None, "bili_jct": None, "cookie_string": None, "is_logged_in": False}


def load_last_login():
    """
    启动时加载上一次保存的登录数据
    """
    if os.path.exists(csv_file):
        with open(csv_file, "r", encoding="utf-8") as file:
            reader = csv.reader(file)
            for row in reader:
                dedeuserid, bili_jct, cookie_string, status, login_time = row
                if status == "1":  # 表示未退出
                    current_login.update({
                        "dedeuserid": dedeuserid,
                        "bili_jct": bili_jct,
                        "cookie_string": cookie_string,
                        "is_logged_in": True
                    })
                    print(f"恢复登录状态: {current_login}")
                    break


@app.route('/logout', methods=['POST'])
def logout():
    """
    退出登录，清除状态
    """
    current_login.update({"dedeuserid": None, "bili_jct": None, "cookie_string": None, "is_logged_in": False})
    save_login_data("Unknown", "Unknown", "Unknown", "0", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    return jsonify({"message": "已退出登录"}), 200


@app.route('/check_login_status', methods=['GET'])
def check_login_status():
    """
    检查当前登录状态
    """
    if current_login.get("is_logged_in"):
        return jsonify({
            "is_logged_in": True,
            "message": "已登录",
            "dedeuserid": current_login.get("dedeuserid"),
        })
    return jsonify({"is_logged_in": False, "message": "未登录"})


def get_url(url, params=None, session=None):
    """
    使用提供的 session 发送请求，如果没有提供 session，则创建新的 session。
    """
    try:
        print(f"请求地址: {url}, 参数: {params}")  # 调试打印
        if session is None:
            session = requests.Session()

        # 如果当前登录，使用保存的登录信息
        if current_login.get("is_logged_in"):
            # 将登录时的 cookies 加入到 session 中
            session.cookies.set('DedeUserID', current_login.get("dedeuserid"))
            session.cookies.set('bili_jct', current_login.get("bili_jct"))
            if current_login.get("cookie_string"):
                cookies = {k: v for k, v in (cookie.split('=') for cookie in current_login["cookie_string"].split('; '))}
                session.cookies.update(cookies)

        response = session.get(url, params=params, headers=HEADERS, allow_redirects=True)
        print(f"请求 URL: {url}")
        print(f"响应状态码: {response.status_code}")  # 调试打印
        if response.status_code == 200:
            try:
                data = response.json()
                # print(f"响应数据(JSON): {data}")  # 调试打印
                return data, session.cookies.get_dict()
            except ValueError:
                # print(f"响应数据(文本): {response.text}")  # 调试打印
                return response.text, session.cookies.get_dict()
        return None, None
    except Exception as e:
        print(f"请求出错: {e}")  # 调试打印
        return None, None



@app.route('/')
def home():
    print("访问主页")  # 调试打印
    return render_template('index.html')
# 保存登录数据的文件名
csv_file = "login_data.csv"
def save_login_data(dedeuserid, bili_jct, cookie_string, status, login_time):
    """
    保存登录数据到文件
    """
    with open(csv_file, "a", encoding="utf-8") as file:
        file.write(f"{dedeuserid},{bili_jct},{cookie_string},{status},{login_time}\n")
@app.route('/generate_qrcode', methods=['GET'])
def generate_qrcode():
    """
    生成二维码接口。如果已经登录，则直接返回当前登录状态。
    """
    if current_login.get("is_logged_in"):
        # 已登录，直接返回状态
        return jsonify({
            "is_logged_in": True,
            "message": "已登录",
            "dedeuserid": current_login.get("dedeuserid")
        })

    # 未登录，生成二维码
    print("开始生成二维码")  # 调试打印
    url = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main_web'
    response, _ = get_url(url)
    if response:
        qrcode_url = response['data']['url']  # 使用返回的 URL
        qrcode_key = response['data']['qrcode_key']
        print(f"二维码 URL: {qrcode_url}")  # 调试打印
        print(f"二维码 Key: {qrcode_key}")  # 调试打印

        # 初始化状态
        qrcode_data[qrcode_key] = {"status": "waiting"}
        print(f"初始化二维码状态: {qrcode_data[qrcode_key]}")  # 调试打印

        # 启动轮询线程
        threading.Thread(target=poll_qrcode_status, args=(qrcode_key,)).start()

        return jsonify({
            "is_logged_in": False,
            "qrcode_key": qrcode_key,
            "qrcode_url": f"/get_qrcode_image?qrcode_key={qrcode_key}"
        })

    print("二维码生成失败")  # 调试打印
    return jsonify({"error": "二维码生成失败"}), 500



@app.route('/get_qrcode_image', methods=['GET'])
def get_qrcode_image():
    """
    返回二维码图片
    """
    qrcode_key = request.args.get('qrcode_key')
    print(f"获取二维码图片，Key: {qrcode_key}")  # 调试打印
    if qrcode_key in qrcode_data:
        # 使用接口返回的 URL 作为二维码内容
        qrcode_url = f"https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key={qrcode_key}"
        print(f"生成二维码的内容: {qrcode_url}")  # 调试打印

        # 生成二维码图片
        img = qrcode.make(qrcode_url)
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png')
    print("二维码状态不存在")  # 调试打印
    return jsonify({"error": "二维码状态不存在"}), 404


@app.route('/get_status', methods=['GET'])
def get_status():
    """
    返回二维码状态
    """
    qrcode_key = request.args.get('qrcode_key')
    print(f"获取二维码状态，Key: {qrcode_key}")  # 调试打印
    if qrcode_key in qrcode_data:
        status = qrcode_data[qrcode_key]
        print(f"二维码状态: {status}")  # 调试打印
        return jsonify({
            "status": status.get("status", "unknown"),
            "message": status.get("message", "未知状态")
        })
    print("二维码状态不存在")  # 调试打印
    return jsonify({"status": "error", "message": "二维码状态不存在"}), 404


def poll_qrcode_status(qrcode_key):
    """
    轮询二维码状态
    """
    print(f"开始轮询二维码状态，Key: {qrcode_key}")  # 调试打印
    session = requests.Session()
    while True:
        poll_url = f"https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key={qrcode_key}&source=navUserCenterLogin"
        print(f"轮询请求地址: {poll_url}")  # 调试打印
        response, cookies = get_url(poll_url, session=session)

        if response and 'data' in response and response['data'].get('url'):
            print(f"二维码扫描成功: {response['data']['url']}")  # 调试打印

            login_url = response['data']['url']
            login_response, login_cookies = get_url(login_url, session=session)

            print("登录请求 URL:", login_url)
            print("登录 Cookies:", login_cookies)

            if login_response and login_cookies:
                cookie_string = '; '.join([f"{k}={v}" for k, v in login_cookies.items()])
                dedeuserid = login_cookies.get("DedeUserID", "Unknown")
                bili_jct = login_cookies.get("bili_jct", "Unknown")
                login_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

                # 更新登录状态
                current_login.update({
                    "dedeuserid": dedeuserid,
                    "bili_jct": bili_jct,
                    "cookie_string": cookie_string,
                    "is_logged_in": True
                })

                save_login_data(dedeuserid, bili_jct, cookie_string, "1", login_time)
                qrcode_data[qrcode_key]["status"] = "success"
                qrcode_data[qrcode_key]["message"] = "登录成功"

                # 登录成功后清除二维码状态
                # qrcode_data.pop(qrcode_key, None)
                return

            else:
                print(f"登录响应错误: {login_response}")
                qrcode_data[qrcode_key]["status"] = "error"
                qrcode_data[qrcode_key]["message"] = "登录失败"
                return

        if response and response.get('code') == 86038:
            print(f"二维码已过期: {response}")  # 调试打印
            qrcode_data[qrcode_key] = {"status": "expired", "message": "二维码已过期"}
            return

        if response and response.get('code') in [86101, 86090]:
            print(f"二维码等待扫码或确认: {response}")  # 调试打印
            qrcode_data[qrcode_key] = {"status": "pending", "message": "等待扫码或确认"}
        else:
            print(f"轮询响应未知状态: {response}")  # 调试打印
            qrcode_data[qrcode_key] = {"status": "unknown", "message": "未知状态"}

        print("轮询未完成，继续等待...")  # 调试打印
        time.sleep(5)



@app.route('/parse_video', methods=['GET'])
def parse_video():
    """
    根据用户输入解析视频信息，支持不同的输入格式（URL、BVID）
    """
    user_input = request.args.get('input', '').strip()
    if not user_input:
        return jsonify({"error": "输入不能为空"}), 400

    # 提取 BVID (支持 URL、BVID 字符串、简短格式)
    bvid = extract_bvid(user_input)
    if not bvid:
        return jsonify({"error": "无法解析 BVID"}), 400

    # 获取视频信息
    video_info = get_video_info(bvid)
    print(video_info['title'])
    if not video_info:
        return jsonify({"error": "未能解析视频信息"}), 400

    # 获取播放信息
    play_info = get_play_info(bvid, video_info['cid'])
    if not play_info:
        return jsonify({"error": "无法获取播放信息"}), 500

    # return jsonify(video_info)
 # 返回视频的基本信息和下载地址
    return jsonify({
        "bvid": user_input,
        "cid": video_info['cid'],
        "title": video_info['title'],
        "desc": video_info['desc'],
        "type": video_info.get('tname'),
        "play_info": play_info
    })


@app.route('/parse_videos', methods=['GET'])
def parse_videos():
    """
    根据用户输入解析视频信息，支持不同的输入格式（URL、BVID）
    """
    user_input = request.args.get('input', '').strip()
    if not user_input:
        return jsonify({"error": "输入不能为空"}), 400

    # 提取 BVID (支持 URL、BVID 字符串、简短格式)
    bvid = extract_bvid(user_input)
    if not bvid:
        return jsonify({"error": "无法解析 BVID"}), 400

    # 获取视频信息
    video_info = get_video_info(bvid)
    print(video_info['title'])
    if not video_info:
        return jsonify({"error": "未能解析视频信息"}), 400

    # 获取播放信息
    play_info = get_play_info(bvid, video_info['cid'])
    if not play_info:
        return jsonify({"error": "无法获取播放信息"}), 500

    return jsonify({
        "videoUrl":play_info['dash']['video'][0]['backupUrl'][0],
        "audioUrl":play_info['dash']['audio'][0]['backupUrl'][0],
        "bvid":video_info['bvid'],
        "aid":video_info['aid'],
        "cid":video_info['cid'],
        "tname":video_info['tname'],
        "pic":video_info['pic'],
        "title":video_info['title'],
        "desc":video_info['desc'],
        "duration":video_info['duration'],
        "pubdate":video_info['pubdate'],
        "name":video_info['owner']['name'],
        "face":video_info['owner']['face'],
        "view":video_info['stat']['view'],
        "danmaku":video_info['stat']['danmaku'],
        "reply":video_info['stat']['reply'],
        "favorite":video_info['stat']['favorite'],
        "coin":video_info['stat']['coin'],
        "share":video_info['stat']['share'],
        "like":video_info['stat']['like'],
    })

def extract_bvid(user_input):
    """
    提取视频中的 BVID（支持 URL 和 BVID 格式）
    """
    if user_input.startswith("https://www.bilibili.com/video/"):
        # 完整 URL 格式： https://www.bilibili.com/video/BV1QDURYKEYK
        start_idx = user_input.find("BV")
        end_idx = user_input.find("?", start_idx)
        if end_idx == -1:
            end_idx = len(user_input)
        return user_input[start_idx:end_idx]

    elif user_input.startswith("BV"):
        # 简单的 BVID 格式： BV1QDURYKEYK
        return user_input

    return None

def get_video_info(bvid):
    """
    根据 BVID 获取视频信息（包括 cid）
    """
    url = "https://api.bilibili.com/x/web-interface/view"
    params = {"bvid": bvid}
    response, _ = get_url(url, params)
    if response and response.get("code") == 0:
        return response.get("data")
    return None

def get_play_info(bvid, cid):
    """
    根据 BVID 和 CID 获取视频播放信息
    """
    url = "https://api.bilibili.com/x/player/playurl"
    params = {
        "bvid": bvid,
        "cid": cid,
        "fnval": 4048,
        "fnver": 0,
        "fourk": 1,
    }

    response, _ = get_url(url, params)
    if response and response.get("code") == 0:
        return response.get("data")
    return None

@app.route('/download', methods=['GET'])
def download():
    """
    接收 bvid、cid 和清晰度参数，后端解析并下载视频和音频
    """
    bvid = request.args.get('bvid')
    cid = request.args.get('cid')
    # quality = request.args.get('quality', 80)  # 默认清晰度为 80（标清）
    quality = int(request.args.get('quality', 80))  # 默认清晰度为 80
    if not bvid or not cid:
        return jsonify({"error": "缺少必要参数 bvid 或 cid"}), 400

    try:
        # 获取视频播放信息
        play_info = get_play_info(bvid, cid)
        if not play_info:
            return jsonify({"error": "无法获取播放信息"}), 500



        # video_url = play_info.get('dash', {}).get('video', [{}])[0].get('baseUrl')
        video_url = None
        audio_url = play_info.get('dash', {}).get('audio', [{}])[0].get('baseUrl')

        # 遍历视频清晰度，找到匹配的 ID
        for video in play_info.get('dash', {}).get('video', []):
            if video.get('id') == quality:
                print(video.get('id'))
                video_url = video.get('baseUrl')
                break  # 找到目标清晰度直接退出循环

        # 如果未找到匹配的清晰度，使用默认的第一个视频 URL
        if not video_url:
            video_url = play_info.get('dash', {}).get('video', [{}])[0].get('baseUrl')

        if not video_url or not audio_url:
            return jsonify({"error": "未找到视频或音频下载地址"}), 500

        # 下载视频和音频
        video_content = requests.get(url=video_url, headers=HEADERS).content
        audio_content = requests.get(url=audio_url, headers=HEADERS).content

        # 创建 video 文件夹（如果不存在）
        os.makedirs('download', exist_ok=True)

        # 保存视频和音频
        # timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        # video_file_path = os.path.join('video', f'{bvid}_{timestamp}.mp4')
        # audio_file_path = os.path.join('video', f'{bvid}_{timestamp}.mp3')
        video_file_path = os.path.join('download', f'{bvid}.mp4')
        audio_file_path = os.path.join('download', f'{bvid}.mp3')

        with open(video_file_path, mode='wb') as v:
            v.write(video_content)
        with open(audio_file_path, mode='wb') as a:
            a.write(audio_content)

        return jsonify({
            "message": "下载成功",
            "video_file": video_file_path,
            "audio_file": audio_file_path,
        })

    except Exception as e:
        print(f"下载时发生错误: {e}")
        return jsonify({"error": "下载失败"}), 500

if __name__ == "__main__":
    print("启动 Flask 应用")  # 调试打印
    load_last_login()  # 启动时加载登录信息
    app.run(host="0.0.0.0", port=7893, debug=True)
