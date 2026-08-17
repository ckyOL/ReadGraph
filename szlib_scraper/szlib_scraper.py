"""深圳图书馆借阅历史抓取脚本（szlib_scraper）。

分页拉取深圳图书馆移动端 API 的借阅历史，合并后写入 JSON 输出文件。

加固说明（H-4）：
- 每页容量不再硬编码：从第一页响应实际返回的 record 条数推导，
  total_pages = ceil(totalno / page_size)。
- 失败重试：transport 类错误（requests.RequestException）按指数退避有界重试
  （MAX_RETRIES 次，退避 RETRY_BACKOFF_BASE_SECONDS * 2^(n-1)，上限
  MAX_BACKOFF_SECONDS）；JSON 解析与数据结构错误是确定性错误，不重试。
- 断点续传（resume）：每抓成功一页即原子写入 JSON checkpoint 文件
  （{output_dir}/.szlib_{start_date}_{end_date}.checkpoint.json，记录 total_pages
  与各已抓页记录）。中途失败/中断后重跑同一命令，自动跳过已抓页面继续；
  全部完成后写出输出文件并删除 checkpoint。分页失败仍不写输出文件
  （部分数据不得冒充完整导出）。
- 错误归因分类：
  transport（requests.RequestException）→ "HTTP 请求失败"；
  JSON 解析（json.JSONDecodeError）→ "JSON 解析失败"；
  数据结构（AttributeError/KeyError/TypeError/ValueError）→ "响应数据结构异常"。
- 最大页数保护：total_pages 超过 MAX_PAGES 视为异常响应，中止且不写输出。
"""

import json
import math
import os
import time
import traceback
import urllib.parse

import requests

# 有界重试与指数退避参数
MAX_RETRIES = 3
RETRY_BACKOFF_BASE_SECONDS = 2
MAX_BACKOFF_SECONDS = 30

# 最大页数安全上限：total_pages 超过此值视为病态响应，防止无限循环
MAX_PAGES = 1000

TIMEOUT_SECONDS = 10


def _checkpoint_path(output_dir, start_date, end_date):
    """checkpoint 文件路径：与输出文件同目录、隐藏文件、含时间段。"""
    return os.path.join(output_dir, f".szlib_{start_date}_{end_date}.checkpoint.json")


def _load_checkpoint(checkpoint_file):
    """读取断点文件，返回 (total_pages, pages)；不存在或损坏时返回 (None, {})。

    pages 形如 {"1": [records], "2": [records], ...}，键为字符串页码。
    """
    if not os.path.exists(checkpoint_file):
        return None, {}
    try:
        with open(checkpoint_file, "r", encoding="utf-8") as f:
            checkpoint = json.load(f)
        total_pages = checkpoint.get("total_pages")
        raw_pages = checkpoint.get("pages", {})
        pages = {
            str(key): value
            for key, value in raw_pages.items()
            if str(key).isdigit() and isinstance(value, list)
        }
        if total_pages is None or not pages:
            return None, {}
        return int(total_pages), pages
    except (OSError, ValueError):
        print(f"断点文件 {checkpoint_file} 无法读取，将从头抓取。")
        return None, {}


def _save_checkpoint(checkpoint_file, total_pages, pages):
    """原子写入断点文件（先写临时文件再 os.replace，避免留下半截文件）。"""
    tmp_file = checkpoint_file + ".tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump({"total_pages": total_pages, "pages": pages}, f, ensure_ascii=False)
    os.replace(tmp_file, checkpoint_file)


def _request_with_retry(url, headers, timeout=TIMEOUT_SECONDS):
    """GET 请求，transport 类错误按指数退避有界重试；最终失败抛最后一次异常。

    只重试 requests.RequestException（连接/超时/HTTP 状态错误）——这类错误可能
    是暂时性的；JSON 解析与数据结构错误为确定性错误，由调用方按类别处理。
    """
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            return response
        except requests.exceptions.RequestException as e:
            last_error = e
            if attempt < MAX_RETRIES:
                delay = min(
                    RETRY_BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)),
                    MAX_BACKOFF_SECONDS,
                )
                print(
                    f"  第 {attempt}/{MAX_RETRIES} 次尝试失败: {type(e).__name__}: {e}，"
                    f"{delay} 秒后重试"
                )
                time.sleep(delay)
    raise last_error


def fetch_all_records(card_value, start_date, end_date, cookie_str, output_dir):
    # 深圳图书馆移动端API基础地址
    base_url = "https://www.szlib.org.cn/m/proxyBasic.jsp"

    # 构造请求头，包含参数传入的 Cookie 和模拟浏览器的 User-Agent
    headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": "https://www.szlib.org.cn/m/mylibrary/readhistory.html",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": cookie_str,
    }

    # 确保输出文件夹存在
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # 输出文件名包含时间段，并以 szlib 开头，不再包含借书证号
    output_file = os.path.join(output_dir, f"szlib_{start_date}_{end_date}.json")
    checkpoint_file = _checkpoint_path(output_dir, start_date, end_date)

    # 断点续传：读取已成功抓取的页，跳过它们（不重复请求）
    resumed_total_pages, fetched_pages = _load_checkpoint(checkpoint_file)
    all_records = []
    for key in sorted(fetched_pages, key=int):
        all_records.extend(fetched_pages[key])
    if fetched_pages:
        print(
            f"检测到断点文件，已抓取 {len(fetched_pages)} 页"
            f"（共 {len(all_records)} 条记录），将跳过已抓取页面继续。"
        )

    # 初始页码和总页数（第一页成功后更新；断点续传时取 checkpoint 中的值）
    page = 1
    total_pages = 1
    if resumed_total_pages is not None:
        total_pages = resumed_total_pages

    print(f"开始抓取，抓取完成后数据将合并保存至: {output_file}")

    while page <= total_pages:
        # 最大页数保护（覆盖断点续传路径）：异常巨大的总页数直接中止
        if total_pages > MAX_PAGES:
            print(
                f"总页数 {total_pages} 超过安全上限 {MAX_PAGES}，"
                "疑似异常响应，已中止（不写入输出文件）。"
            )
            break

        # 断点续传：该页已成功抓取过，直接跳过（不重复请求）
        if str(page) in fetched_pages:
            page += 1
            continue

        # 构造完整 URL
        # 深圳图书馆 proxy 使用特殊格式：proxyBasic.jsp?<servicePath>?<queryParams>
        # 第一个 ? 后是服务路径（含斜杠），第二个 ? 后是实际请求参数
        service_path = "servicehistory/GetLoanHistory"
        query_string = urllib.parse.urlencode(
            {
                "startDate": start_date,
                "endDate": end_date,
                "v_ServiceAddr": "",
                "CardOrBarcode": "cardno",
                "value": card_value,
                "eventType": "E",
                "curpage": page,
                "_": int(time.time() * 1000),
            }
        )
        url = f"{base_url}?{service_path}?{query_string}"

        # 打印请求信息但不含 URL——URL 的 query 携带借书证号（cardno），
        # 终端/日志不得泄漏（L14）。
        print(f"第 {page}/{total_pages} 页 请求 {base_url}?{service_path}（借书证号已隐藏）")

        response = None
        try:
            # 发送 GET 请求（transport 错误在内部有界重试）
            response = _request_with_retry(url, headers)

            # 解析 JSON 响应
            data = response.json()

            # 提取当前页记录
            records = data.get("record", [])

            # 如果是第一页，先计算总页数
            if page == 1:
                try:
                    totalno = int(data.get("totalno", 0))
                except (TypeError, ValueError) as e:
                    raise ValueError(
                        f"totalno 字段无法解析为整数: {data.get('totalno')!r}"
                    ) from e

                if totalno == 0:
                    print("没有查询到任何记录。")
                    break

                # 每页容量从响应推导（首页实际返回的 record 条数），而非硬编码
                page_size = len(records)
                if page_size <= 0:
                    raise ValueError(
                        "首页未返回任何记录（record 为空），无法从响应推导每页容量"
                    )

                total_pages = math.ceil(totalno / page_size)
                print(
                    f"API 报告总记录数: {totalno}，从响应推导每页 {page_size} 条，"
                    f"预计总页数: {total_pages}"
                )

                # 最大页数保护（首跑路径）：病态 totalno 不得导致无限循环
                if total_pages > MAX_PAGES:
                    print(
                        f"API 报告总页数 {total_pages} 超过安全上限 {MAX_PAGES}，"
                        "疑似异常响应，已中止（不写入输出文件）。"
                    )
                    break

            print(f"正在获取第 {page}/{total_pages} 页, 提取到 {len(records)} 条记录")

            # 使用 extend 方法将当前页的记录数组合并到总数组中
            if records:
                all_records.extend(records)

            # 每抓成功一页即写 checkpoint，中断/失败后重跑可断点续传
            fetched_pages[str(page)] = records
            _save_checkpoint(checkpoint_file, total_pages, fetched_pages)

        except requests.exceptions.RequestException as e:
            # transport 错误：内部已重试 MAX_RETRIES 次，此处为最终失败
            print(
                f"第 {page} 页 HTTP 请求失败（已重试 {MAX_RETRIES} 次）: "
                f"{type(e).__name__}: {e}"
            )
            if hasattr(e, "response") and e.response is not None:
                print(f"  响应状态码: {e.response.status_code}")
                print(f"  响应内容: {e.response.text[:500]}")
            break
        except json.JSONDecodeError as e:
            # JSON 解析错误：响应体不是合法 JSON（如代理返回 HTML 错误页）
            print(f"第 {page} 页 JSON 解析失败: {type(e).__name__}: {e}")
            if response is not None:
                print(f"  原始响应内容: {response.text[:500]}")
            break
        except (AttributeError, KeyError, TypeError, ValueError) as e:
            # 数据结构错误：JSON 合法但字段缺失/类型不符（区别于 JSON 解析失败）
            print(f"第 {page} 页响应数据结构异常: {type(e).__name__}: {e}")
            break
        except Exception as e:
            print(f"发生未知错误: {type(e).__name__}: {e}")
            traceback.print_exc()
            break

        # 递增页码，准备抓取下一页
        page += 1

        # 为了防止请求过快被服务器封禁，增加 1 秒延时（可根据实际情况调整）
        if page <= total_pages:
            time.sleep(1)

    # 抓取循环结束后，将所有记录作为一个完整的 JSON 数组统一写入文件。
    # 分页中途失败（break）时不得写出部分数据冒充完整导出——写文件仅限循环
    # 正常完成（page 越界退出）；失败时丢弃已抓部分并显式提示（L14），
    # 已抓页保留在 checkpoint 中供下次断点续传。
    completed = page > total_pages
    if all_records and completed:
        with open(output_file, "w", encoding="utf-8") as f:
            # 使用 json.dump 输出格式化的 JSON（indent=4），ensure_ascii=False 保证中文正常显示
            json.dump(all_records, f, ensure_ascii=False, indent=4)
        # 完整导出已落盘，删除断点文件
        if os.path.exists(checkpoint_file):
            os.remove(checkpoint_file)
        print(f"\n抓取完成！共抓取 {len(all_records)} 条记录，已保存至 {output_file}。")
    elif all_records:
        print(
            f"\n分页中途失败：已抓取 {len(all_records)} 条记录，未写入输出文件"
            "（部分数据不得冒充完整导出）。"
            f"已保存断点 {checkpoint_file}，重跑同一命令将自动跳过已抓取页面继续。"
        )
    else:
        print("\n未获取到任何记录，未生成输出文件。")

    return all_records


if __name__ == "__main__":
    # 执行测试示例，输出到当前目录下的 output_data 文件夹
    output_folder = "./output_data"
    my_cookie = (
        "SESSIONID=your_session_cookie; another_cookie=value"  # 外部传入的 Cookie
    )
    fetch_all_records(
        card_value="0440050012345",
        start_date="20260527",
        end_date="20260626",
        cookie_str=my_cookie,
        output_dir=output_folder,
    )
