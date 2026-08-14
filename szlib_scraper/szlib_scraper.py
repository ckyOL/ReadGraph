import json
import math
import os
import time
import traceback
import urllib.parse

import requests


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
    all_records = []

    # 初始页码和总页数（在获取到第一页后更新）
    page = 1
    total_pages = 1

    print(f"开始抓取，抓取完成后数据将合并保存至: {output_file}")

    while page <= total_pages:
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

        response = None
        try:
            # 打印请求信息但不含 URL——URL 的 query 携带借书证号（cardno），
            # 终端/日志不得泄漏（L14）。
            print(f"第 {page}/{total_pages} 页 请求 {base_url}?{service_path}（借书证号已隐藏）")

            # 发送 GET 请求
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()

            # 解析 JSON 响应
            data = response.json()

            # 如果是第一页，先计算总页数
            if page == 1:
                totalno = int(data.get("totalno", 0))
                # 每页 10 条数据，向上取整计算总页数
                total_pages = math.ceil(totalno / 10)
                print(f"API 报告总记录数: {totalno}, 计算得出预计总页数: {total_pages}")

                if totalno == 0:
                    print("没有查询到任何记录。")
                    break

            # 提取当前页记录
            records = data.get("record", [])
            print(f"正在获取第 {page}/{total_pages} 页, 提取到 {len(records)} 条记录")

            # 使用 extend 方法将当前页的记录数组合并到总数组中
            if records:
                all_records.extend(records)

        except requests.exceptions.RequestException as e:
            print(f"第 {page} 页 HTTP 请求失败: {type(e).__name__}: {e}")
            if hasattr(e, "response") and e.response is not None:
                print(f"  响应状态码: {e.response.status_code}")
                print(f"  响应内容: {e.response.text[:500]}")
            break
        except ValueError as e:
            print(f"第 {page} 页 JSON 解析失败: {type(e).__name__}: {e}")
            if response is not None:
                print(f"  原始响应内容: {response.text[:500]}")
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
    # 正常完成（page 越界退出）；失败时丢弃已抓部分并显式提示（L14）。
    completed = page > total_pages
    if all_records and completed:
        with open(output_file, "w", encoding="utf-8") as f:
            # 使用 json.dump 输出格式化的 JSON（indent=4），ensure_ascii=False 保证中文正常显示
            json.dump(all_records, f, ensure_ascii=False, indent=4)
        print(f"\n抓取完成！共抓取 {len(all_records)} 条记录，已保存至 {output_file}。")
    elif all_records:
        print(
            f"\n分页中途失败：已抓取 {len(all_records)} 条记录，未写入输出文件"
            "（部分数据不得冒充完整导出，请重跑或检查网络）。"
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
