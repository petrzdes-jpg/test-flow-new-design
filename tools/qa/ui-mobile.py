"""Проверка интерфейса на телефоне (iPhone 14, 390×844): нет горизонтальной прокрутки, нижняя навигация,
блокировка прокрутки под модальным окном и восстановление позиции, ошибки JavaScript.

Запуск: сервер API (127.0.0.1:8000) и статический сервер public/ (127.0.0.1:8802) должны работать.
python3 tools/qa/ui-mobile.py [логин ...]
"""
import asyncio, sys
from playwright.async_api import async_playwright

B = "http://127.0.0.1:8802"
API = "http://127.0.0.1:8000"
PAGES = ["", "projects", "pcal", "notify", "kristall", "kristall.schedule", "kristall.corrections", "kristall.calendar", "kristall.docs",
         "kristall.docs.reg-pdrd", "kristall.docs.reg-id", "kristall.estimates", "kristall.budget", "kristall.quality", "kristall.production",
         "admin.users", "admin.roles", "admin.matrix", "admin.access", "admin.history", "base"]


async def run(user):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await c.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        await pg.goto(B + "/demo/login.html")
        await pg.evaluate(f"localStorage.setItem('flow.api','{API}')")
        await pg.goto(B + "/demo/login.html")
        await pg.fill("#login", user); await pg.fill("#pwd", "1234"); await pg.click("#go")
        await pg.wait_for_function("window.DSF && DSF.projects && DSF.projects.length && document.querySelector('#app .head, #app .stamp, #app .panel')", timeout=30000)
        bad = []
        for h in PAGES:
            await pg.evaluate(f"location.hash='{h}'"); await pg.wait_for_timeout(500)
            sw = await pg.evaluate("document.documentElement.scrollWidth - innerWidth")
            if sw > 1:
                bad.append(f"{h or 'портфель'}: горизонтальная прокрутка {sw}px")
        nav = await pg.evaluate("[...document.querySelectorAll('#botnav button')].map(b=>[b.innerText.trim(), Math.round(b.getBoundingClientRect().height)])")
        small = [n for n in nav if n[1] < 44]
        # блокировка прокрутки под модальным окном
        await pg.evaluate("location.hash='kristall.schedule'"); await pg.wait_for_timeout(600)
        await pg.evaluate("window.scrollTo(0, 900)"); await pg.wait_for_timeout(200)
        y0 = await pg.evaluate("scrollY")
        await pg.evaluate("document.querySelector('[data-act=more]').click()"); await pg.wait_for_timeout(300)
        locked = await pg.evaluate("getComputedStyle(document.body).position === 'fixed' && document.documentElement.classList.contains('scroll-lock')")
        await pg.mouse.wheel(0, 600); await pg.wait_for_timeout(200)
        await pg.evaluate("document.querySelector('.sheet-bg').click()"); await pg.wait_for_timeout(400)
        y1 = await pg.evaluate("scrollY")
        print(f"[{user}] страниц: {len(PAGES)}, с горизонтальной прокруткой: {len(bad)}", *bad, sep="\n  ")
        print(f"[{user}] нижняя навигация: {nav}; меньше 44px: {small}")
        print(f"[{user}] блокировка прокрутки: {locked}; позиция до/после: {y0}/{y1}")
        print(f"[{user}] ошибки JS: {errs}")
        await b.close()
        return not bad and not small and locked and abs(y0 - y1) < 2 and not errs


async def main():
    users = sys.argv[1:] or ["admin", "director", "tech", "contractor1", "smeta", "gip", "investor"]
    res = [await run(u) for u in users]
    print("ИТОГ:", "OK" if all(res) else "ЕСТЬ ЗАМЕЧАНИЯ")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
