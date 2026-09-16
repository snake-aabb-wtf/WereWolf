from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.goto("http://localhost:5173/")
    page.wait_for_load_state("networkidle")
    assert page.get_by_role("heading", name="每一句话").is_visible()
    page.screenshot(path="artifacts/welcome.png", full_page=True)
    page.get_by_role("button", name="进入夜色").click()
    page.wait_for_selector(".table-panel")
    page.wait_for_timeout(1200)
    assert page.locator(".player-card").count() == 8
    assert page.get_by_text("PUBLIC RECORD").is_visible()
    page.screenshot(path="artifacts/table.png", full_page=True)
    print({"title": page.title(), "players": page.locator(".player-card").count(), "console_errors": console_errors})
    browser.close()
