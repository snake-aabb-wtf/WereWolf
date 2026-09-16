from playwright.sync_api import sync_playwright
import re
import os


BASE_URL = os.environ.get("SMOKE_BASE_URL", "http://localhost:5173")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.goto(f"{BASE_URL}/")
    page.wait_for_load_state("networkidle")
    assert page.get_by_role("heading", name="每一句话").is_visible()
    assert page.get_by_role("heading", name="你的存档库").is_visible()
    page.screenshot(path="artifacts/welcome.png", full_page=True)
    page.get_by_role("button", name="开始第一局").click()
    page.wait_for_url(re.compile(r"/game/"))
    page.wait_for_selector(".table-panel")
    page.wait_for_timeout(1200)
    assert page.locator(".player-card").count() == 12
    assert page.get_by_text("12 SEATS / PRIVATE ROOM").is_visible()
    assert page.get_by_text("PUBLIC RECORD").is_visible()
    page.screenshot(path="artifacts/table.png", full_page=True)
    assert page.get_by_text("已自动保存").is_visible()
    page.get_by_role("link", name="← 存档库").click()
    page.wait_for_url(f"{BASE_URL}/")
    page.wait_for_selector(".save-card")
    assert page.locator(".save-card").count() == 1
    page.get_by_label("重命名存档").click()
    page.locator(".save-name-edit input").fill("测试存档")
    page.get_by_role("button", name="保存").click()
    page.get_by_text("测试存档").first.wait_for()
    assert page.get_by_text("测试存档").first.is_visible()
    page.get_by_role("button", name="删除").click()
    page.get_by_role("button", name="移入回收站").click()
    page.get_by_text("没有未结束的牌局。").wait_for()
    assert page.get_by_text("没有未结束的牌局。").is_visible()
    page.get_by_role("link", name="回收站").click()
    page.wait_for_url(f"{BASE_URL}/trash")
    page.get_by_text("测试存档").first.wait_for()
    assert page.get_by_text("测试存档").is_visible()
    page.get_by_role("button", name="恢复").click()
    page.get_by_text("回收站是空的。").wait_for()
    page.wait_for_url(f"{BASE_URL}/trash")
    assert page.get_by_text("回收站是空的。").is_visible()
    mobile = browser.new_page(viewport={"width": 390, "height": 844})
    mobile.goto(f"{BASE_URL}/")
    mobile.wait_for_load_state("networkidle")
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    mobile.get_by_role("button", name="开始第一局").click()
    mobile.wait_for_selector(".table-panel")
    assert mobile.locator(".player-card").count() == 12
    assert mobile.locator(".player-card").last.is_visible()
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    mobile.close()
    print({"title": page.title(), "players": page.locator(".player-card").count(), "console_errors": console_errors})
    browser.close()
