# 深圳图书馆借阅历史抓取工具

抓取深圳图书馆（szlib）移动端 API 的借阅历史记录，输出 JSON 文件。

## 安装

### 前提

- Python >= 3.10
- uv（推荐，比 pip 快一个数量级）

### 方式一：uv（推荐）

```bash
cd szlib_scraper
uv venv
source .venv/bin/activate
uv pip sync requirements.txt
```

### 方式二：标准 pip

```bash
cd szlib_scraper
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 用法

### 修改配置

打开 `szlib_scraper.py` 末尾的 `__main__` 块，填入你的借书证号和 Cookie：

```python
my_cookie = "SESSIONID=your_session_cookie; another_cookie=value"
fetch_all_records(
    card_value="0440050012345",
    start_date="20260527",
    end_date="20260626",
    cookie_str=my_cookie,
    output_dir="./output_data",
)
```

### 取 Cookie

1. 在浏览器中登录 https://www.szlib.org.cn
2. 打开开发者工具（F12）→ Network 标签
3. 随便点一个请求，复制 Request Headers 中的 `Cookie` 值

### 运行

```bash
cd szlib_scraper
source .venv/bin/activate
python szlib_scraper.py
```

输出文件保存在 `output_data/szlib_{start_date}_{end_date}.json`。

### 直接运行（不手动激活 venv）

```bash
cd szlib_scraper
uv run szlib_scraper.py
```

## 输出格式

一个 JSON 数组，每条记录包含书籍信息、借阅日期等字段。使用 UTF-8 编码，中文正常显示。
