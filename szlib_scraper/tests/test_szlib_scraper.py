"""szlib_scraper 加固测试：requests 全 mock，不触碰真实站点。

覆盖：页容量从响应推导、失败重试（指数退避）与断点续传、错误归因分类、
最大页数保护。
"""

import json
import urllib.parse

import pytest
import requests

import szlib_scraper


class FakeResponse:
    """最小可用的 requests.Response 替身。"""

    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(
                f"{self.status_code} Server Error", response=self
            )

    def json(self):
        return json.loads(self.text)


def make_payload(totalno, page, page_size=10):
    """构造第 page 页的响应负载；末页条数按余数截断。"""
    first = (page - 1) * page_size
    count = max(0, min(page_size, totalno - first))
    records = [{"id": i, "title": f"book-{i}"} for i in range(first, first + count)]
    return {"totalno": totalno, "record": records}


class FakeAPI:
    """可编程 API 替身：按 curpage 返回负载，可注入各类失败。"""

    def __init__(
        self,
        totalno,
        page_size=10,
        fail_times=None,       # {page: 先失败 N 次再成功}
        fail_pages=None,       # {page: 始终失败}
        fail_exc=None,         # 失败时抛出的异常类型
        http_error_pages=None, # {page: HTTP 状态码}
        bad_json_pages=None,   # {page: 非法 JSON 文本}
        payload_override=None, # {page: 自定义负载}
    ):
        self.totalno = totalno
        self.page_size = page_size
        self.fail_times = dict(fail_times or {})
        self.fail_pages = set(fail_pages or ())
        self.fail_exc = fail_exc or requests.exceptions.ConnectionError
        self.http_error_pages = dict(http_error_pages or {})
        self.bad_json_pages = dict(bad_json_pages or {})
        self.payload_override = dict(payload_override or {})
        self.calls = []  # 记录的请求页码

    def get(self, url, headers=None, timeout=None):
        page = int(
            urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["curpage"][0]
        )
        self.calls.append(page)
        if self.fail_times.get(page, 0) > 0:
            self.fail_times[page] -= 1
            raise self.fail_exc(f"simulated failure on page {page}")
        if page in self.fail_pages:
            raise self.fail_exc(f"simulated failure on page {page}")
        if page in self.http_error_pages:
            return FakeResponse(
                status_code=self.http_error_pages[page], text="server error"
            )
        if page in self.bad_json_pages:
            return FakeResponse(status_code=200, text=self.bad_json_pages[page])
        payload = self.payload_override.get(
            page, make_payload(self.totalno, page, self.page_size)
        )
        return FakeResponse(
            status_code=200, text=json.dumps(payload, ensure_ascii=False)
        )


START = {
    "card_value": "0440050012345",
    "start_date": "20260527",
    "end_date": "20260626",
    "cookie_str": "SESSIONID=test",
}
OUTPUT_FILE = "szlib_20260527_20260626.json"
CHECKPOINT_FILE = ".szlib_20260527_20260626.checkpoint.json"


def run_scraper(monkeypatch, capsys, api, output_dir, sleep_recorder=None):
    """安装 FakeAPI 并执行抓取；返回 (返回值, stdout)。"""
    monkeypatch.setattr(szlib_scraper.requests, "get", api.get)
    if sleep_recorder is None:
        sleep_recorder = lambda delay: None
    monkeypatch.setattr(szlib_scraper.time, "sleep", sleep_recorder)
    result = szlib_scraper.fetch_all_records(**START, output_dir=str(output_dir))
    return result, capsys.readouterr().out


def test_page_capacity_derived_from_response(monkeypatch, capsys, tmp_path):
    """页容量从首页响应推导：totalno=25、每页 5 条 → 5 页。"""
    api = FakeAPI(totalno=25, page_size=5)
    result, out = run_scraper(monkeypatch, capsys, api, tmp_path)
    assert api.calls == [1, 2, 3, 4, 5]
    assert len(result) == 25
    assert "从响应推导每页 5 条" in out
    output = tmp_path / OUTPUT_FILE
    assert output.exists()
    assert len(json.loads(output.read_text(encoding="utf-8"))) == 25
    # 全部完成后 checkpoint 应被删除
    assert not (tmp_path / CHECKPOINT_FILE).exists()


def test_page_capacity_ten_per_page(monkeypatch, capsys, tmp_path):
    """默认每页 10 条：totalno=23 → 3 页，末页 3 条。"""
    api = FakeAPI(totalno=23)
    result, out = run_scraper(monkeypatch, capsys, api, tmp_path)
    assert api.calls == [1, 2, 3]
    assert len(result) == 23
    assert "从响应推导每页 10 条" in out


def test_transport_failure_retries_with_backoff_then_succeeds(
    monkeypatch, capsys, tmp_path
):
    """transport 错误按指数退避重试：前两次失败、第三次成功。"""
    sleeps = []
    api = FakeAPI(totalno=10, fail_times={1: 2})
    result, out = run_scraper(
        monkeypatch, capsys, api, tmp_path, sleep_recorder=sleeps.append
    )
    # 单页场景：失败后分别退避 2s、4s，无页间延时
    assert sleeps == [2, 4]
    assert api.calls == [1, 1, 1]
    assert len(result) == 10
    assert "ConnectionError" in out
    assert "重试" in out


def test_retry_exhaustion_saves_checkpoint_and_resumes(monkeypatch, capsys, tmp_path):
    """第 2 页持续失败 → 重试耗尽后中止并写 checkpoint；
    重跑同一命令自动跳过已抓页，完成后输出并删除 checkpoint。"""
    sleeps = []
    recorder = sleeps.append
    api1 = FakeAPI(totalno=25, fail_pages={2})
    result1, out1 = run_scraper(monkeypatch, capsys, api1, tmp_path, recorder)
    assert api1.calls == [1, 2, 2, 2]  # 第 2 页重试 3 次后放弃
    assert len(result1) == 10
    assert not (tmp_path / OUTPUT_FILE).exists()  # 部分数据不得冒充完整导出
    checkpoint = tmp_path / CHECKPOINT_FILE
    assert checkpoint.exists()
    cp = json.loads(checkpoint.read_text(encoding="utf-8"))
    assert cp["total_pages"] == 3
    assert set(cp["pages"]) == {"1"}
    assert len(cp["pages"]["1"]) == 10
    assert "断点" in out1

    # 断点续传：第 2 页恢复后，不再请求已抓的第 1 页
    api2 = FakeAPI(totalno=25)
    result2, out2 = run_scraper(monkeypatch, capsys, api2, tmp_path, recorder)
    assert api2.calls == [2, 3]
    assert len(result2) == 25
    assert "跳过" in out2
    output = tmp_path / OUTPUT_FILE
    assert output.exists()
    assert len(json.loads(output.read_text(encoding="utf-8"))) == 25
    assert not checkpoint.exists()


def test_error_classification_transport_http_status(monkeypatch, capsys, tmp_path):
    """HTTP 5xx 归为 transport 错误（含重试），不误标 JSON 解析失败。"""
    api = FakeAPI(totalno=25, http_error_pages={1: 500})
    result, out = run_scraper(monkeypatch, capsys, api, tmp_path)
    assert api.calls == [1, 1, 1]  # HTTPError 属 RequestException，同样重试
    assert "HTTP 请求失败" in out
    assert "HTTPError" in out
    assert "JSON 解析失败" not in out
    assert "响应数据结构异常" not in out
    assert not (tmp_path / OUTPUT_FILE).exists()


def test_error_classification_json_parse(monkeypatch, capsys, tmp_path):
    """非法 JSON 归为 JSON 解析失败，且为确定性错误不重试。"""
    api = FakeAPI(totalno=25, bad_json_pages={1: "<html>502 bad gateway</html>"})
    result, out = run_scraper(monkeypatch, capsys, api, tmp_path)
    assert api.calls == [1]
    assert "JSON 解析失败" in out
    assert "JSONDecodeError" in out
    assert "HTTP 请求失败" not in out
    assert "响应数据结构异常" not in out


@pytest.mark.parametrize(
    ("override", "exc_name", "hint"),
    [
        ({"totalno": "abc", "record": []}, "ValueError", "totalno 字段无法解析为整数"),
        ({"totalno": 5, "record": []}, "ValueError", "无法从响应推导每页容量"),
        ([1, 2, 3], "AttributeError", "AttributeError"),
    ],
)
def test_error_classification_data_shape(
    monkeypatch, capsys, tmp_path, override, exc_name, hint
):
    """JSON 合法但结构/类型不符归为数据结构异常（区别于 JSON 解析失败）。"""
    api = FakeAPI(totalno=25, payload_override={1: override})
    result, out = run_scraper(monkeypatch, capsys, api, tmp_path)
    assert api.calls == [1]
    assert "响应数据结构异常" in out
    assert exc_name in out
    assert hint in out
    assert "JSON 解析失败" not in out
    assert "HTTP 请求失败" not in out
    assert not (tmp_path / OUTPUT_FILE).exists()


def test_page_cap_protection(monkeypatch, capsys, tmp_path):
    """totalno 病态巨大（总页数超安全上限）→ 中止且不写输出。"""
    api = FakeAPI(totalno=10001, page_size=10)  # 1001 页 > MAX_PAGES=1000
    result, out = run_scraper(monkeypatch, capsys, api, tmp_path)
    assert api.calls == [1]  # 第一页后即中止，不继续翻页
    assert "安全上限" in out
    assert not (tmp_path / OUTPUT_FILE).exists()


def test_zero_records_no_output(monkeypatch, capsys, tmp_path):
    """totalno=0：提示无记录，不写输出与 checkpoint。"""
    api = FakeAPI(totalno=0)
    result, out = run_scraper(monkeypatch, capsys, api, tmp_path)
    assert api.calls == [1]
    assert "没有查询到任何记录" in out
    assert result == []
    assert not (tmp_path / OUTPUT_FILE).exists()
    assert not (tmp_path / CHECKPOINT_FILE).exists()


def test_corrupt_checkpoint_is_ignored(monkeypatch, capsys, tmp_path):
    """损坏的 checkpoint 被忽略，从头抓取。"""
    (tmp_path / CHECKPOINT_FILE).write_text("{not valid json", encoding="utf-8")
    api = FakeAPI(totalno=10)
    result, out = run_scraper(monkeypatch, capsys, api, tmp_path)
    assert api.calls == [1]
    assert "无法读取" in out
    assert len(result) == 10
    assert (tmp_path / OUTPUT_FILE).exists()
