"""Демонстрационный комплект документов объекта «Кристалл Парк» (только демо-режим).

Создаёт PDF-файлы в api/demo_data/files/, их реестр files/manifest.json (доступ проверяет сервер)
и записи реестра документов tools/demo-docs.json (их включает tools/export-demo-data.js).

Все документы помечены «ДЕМО — НЕ ДЛЯ ПРОИЗВОДСТВА РАБОТ». Организации, люди, номера и реквизиты
вымышлены; печатей и подписей нет; номера сертификатов имеют префикс «ДЕМО».
Запуск: python3 tools/make-demo-docs.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "api" / "demo_data" / "files"
OUT.mkdir(parents=True, exist_ok=True)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
pdfmetrics.registerFont(TTFont("D", FONT))
pdfmetrics.registerFont(TTFont("DB", FONT_B))

MARK = "ДЕМО — НЕ ДЛЯ ПРОИЗВОДСТВА РАБОТ"
CUST = "ООО «Кристалл Девелопмент»"
CONTR = "ООО «Монолит Инжиниринг»"
TZ = "ООО «ТехЗаказчик Про»"
DESIGN = "ООО «Проектное бюро «Линия»»"
OBJ = "Бизнес-центр «Кристалл Парк», корпус 1"
K_NO, K_DATE = "КП-26/МР-015", "15.09.2026"
PID = "kristall"


def fid(name: str) -> str:
    return "demo-" + hashlib.sha1(name.encode()).hexdigest()[:12]


def watermark(c: canvas.Canvas, w: float, h: float) -> None:
    c.saveState()
    c.setFillColor(colors.Color(0.85, 0.1, 0.1, alpha=0.13))
    c.setFont("DB", 34 if w < 700 else 52)
    c.translate(w / 2, h / 2)
    c.rotate(32)
    c.drawCentredString(0, 0, MARK)
    c.restoreState()
    c.setFont("DB", 8)
    c.setFillColor(colors.Color(0.75, 0.1, 0.1))
    c.drawString(12 * mm, h - 8 * mm, MARK + " · вымышленные организации, люди и реквизиты · без печатей и подписей")
    c.setFillColor(colors.black)


class Doc:
    """Простой текстовый документ А4 с переносами строк и нумерацией страниц."""

    def __init__(self, path: Path, title: str):
        self.c = canvas.Canvas(str(path), pagesize=A4)
        self.c.setTitle(title + " (ДЕМО)")
        self.c.setAuthor("Flow — демонстрационные данные")
        self.w, self.h = A4
        self.y = self.h - 22 * mm
        self.page = 1
        watermark(self.c, self.w, self.h)

    def _new(self) -> None:
        self.foot()
        self.c.showPage()
        self.page += 1
        watermark(self.c, self.w, self.h)
        self.y = self.h - 22 * mm

    def foot(self) -> None:
        self.c.setFont("D", 8)
        self.c.setFillColor(colors.grey)
        self.c.drawRightString(self.w - 15 * mm, 10 * mm, f"Стр. {self.page} · {MARK}")
        self.c.setFillColor(colors.black)

    def need(self, dy: float) -> None:
        if self.y - dy < 20 * mm:
            self._new()

    def text(self, s: str, size: float = 10, bold: bool = False, indent: float = 0, gap: float = 1.35, center: bool = False) -> None:
        font = "DB" if bold else "D"
        maxw = self.w - 36 * mm - indent
        words, line, lines = s.split(), "", []
        for wd in words:
            t = (line + " " + wd).strip()
            if pdfmetrics.stringWidth(t, font, size) > maxw:
                lines.append(line)
                line = wd
            else:
                line = t
        lines.append(line)
        for ln in lines:
            self.need(size * gap)
            self.c.setFont(font, size)
            if center:
                self.c.drawCentredString(self.w / 2, self.y, ln)
            else:
                self.c.drawString(18 * mm + indent, self.y, ln)
            self.y -= size * gap
        self.y -= 2

    def space(self, v: float = 6) -> None:
        self.y -= v

    def table(self, rows: list[list[str]], widths: list[float], size: float = 8.5) -> None:
        x0 = 18 * mm
        for i, r in enumerate(rows):
            hgt = size * 1.9
            self.need(hgt)
            x = x0
            for j, cell in enumerate(r):
                w = widths[j] * mm
                self.c.rect(x, self.y - hgt + size * 0.9, w, hgt, stroke=1, fill=0)
                self.c.setFont("DB" if i == 0 else "D", size)
                txt = cell
                while pdfmetrics.stringWidth(txt, "D", size) > w - 4 and len(txt) > 3:
                    txt = txt[:-2]
                self.c.drawString(x + 2, self.y - hgt + size * 1.5, txt)
                x += w
            self.y -= hgt
        self.y -= 6

    def signs(self, parties: list[str]) -> None:
        self.space(10)
        for p in parties:
            self.need(30)
            self.c.setFont("D", 9.5)
            self.c.drawString(18 * mm, self.y, p)
            self.c.drawString(110 * mm, self.y, "__________________ / Ф. И. О. (демо) /")
            self.y -= 12
            self.c.setFont("D", 7.5)
            self.c.setFillColor(colors.grey)
            self.c.drawString(110 * mm, self.y, "подпись не ставится — демонстрационный документ")
            self.c.setFillColor(colors.black)
            self.y -= 16

    def save(self) -> None:
        self.foot()
        self.c.save()


def drawing(path: Path, code: str, title: str, sheet: str, kind: str, sheets: int = 1) -> None:
    """Чертёж А3 со штампом и условной графикой (оси, контуры, элементы)."""
    c = canvas.Canvas(str(path), pagesize=landscape(A3))
    c.setTitle(code + " " + title + " (ДЕМО)")
    W, H = landscape(A3)
    for s in range(1, sheets + 1):
        watermark(c, W, H)
        c.setLineWidth(1.2)
        c.rect(20 * mm, 5 * mm, W - 25 * mm, H - 10 * mm)
        # оси
        xs = [60 + i * 90 for i in range(9)]
        ys = [100 + i * 78 for i in range(6)]
        c.setDash(6, 3)
        c.setLineWidth(0.4)
        c.setStrokeColor(colors.Color(0.3, 0.3, 0.3))
        for i, x in enumerate(xs):
            c.line(x * mm / 2.6 + 30 * mm, 35 * mm, x * mm / 2.6 + 30 * mm, H - 25 * mm)
            c.setFont("D", 9)
            c.circle(x * mm / 2.6 + 30 * mm, H - 20 * mm, 4 * mm)
            c.drawCentredString(x * mm / 2.6 + 30 * mm, H - 21.3 * mm, str(i + 1))
        for j, y in enumerate(ys):
            c.line(25 * mm, y * mm / 2.2 + 25 * mm, W - 150 * mm, y * mm / 2.2 + 25 * mm)
            c.circle(20.5 * mm + 5 * mm, y * mm / 2.2 + 25 * mm, 4 * mm)
            c.drawCentredString(25.5 * mm, y * mm / 2.2 + 23.7 * mm, "АБВГДЕ"[j])
        c.setDash()
        c.setStrokeColor(colors.black)
        x0, x1 = xs[0] * mm / 2.6 + 30 * mm, xs[-1] * mm / 2.6 + 30 * mm
        y0, y1 = ys[0] * mm / 2.2 + 25 * mm, ys[-1] * mm / 2.2 + 25 * mm
        c.setLineWidth(1.6)
        if kind in ("kzh", "pd"):
            c.rect(x0 - 8 * mm, y0 - 8 * mm, x1 - x0 + 16 * mm, y1 - y0 + 16 * mm)
            for x in xs:
                for y in ys:
                    c.setFillColor(colors.Color(0.35, 0.35, 0.35))
                    c.rect(x * mm / 2.6 + 30 * mm - 3 * mm, y * mm / 2.2 + 25 * mm - 3 * mm, 6 * mm, 6 * mm, fill=1)
            c.setFillColor(colors.black)
            c.setLineWidth(0.5)
            for k in range(0, int((x1 - x0) / (6 * mm))):
                c.line(x0 + k * 6 * mm, y0 - 6 * mm, x0 + k * 6 * mm, y0 - 2 * mm)
        elif kind == "ar":
            c.rect(x0, y0, x1 - x0, y1 - y0)
            for x in xs[1:-1:2]:
                c.line(x * mm / 2.6 + 30 * mm, y0, x * mm / 2.6 + 30 * mm, y1)
            c.setLineWidth(0.6)
            for y in ys[1:-1]:
                c.line(x0, y * mm / 2.2 + 25 * mm, x0 + 60 * mm, y * mm / 2.2 + 25 * mm)
        else:
            c.rect(x0, y0, x1 - x0, y1 - y0)
            c.setLineWidth(1)
            col = {"ov": colors.Color(0.1, 0.4, 0.8), "vk": colors.Color(0.1, 0.6, 0.6), "eom": colors.Color(0.8, 0.5, 0.1)}.get(kind, colors.black)
            c.setStrokeColor(col)
            for j, y in enumerate(ys[1:-1]):
                yy = y * mm / 2.2 + 25 * mm + 6 * mm
                c.line(x0 + 10 * mm, yy, x1 - 10 * mm, yy)
                for x in xs[1:-1]:
                    c.circle(x * mm / 2.6 + 30 * mm + 10 * mm, yy, 2.2 * mm)
            c.setStrokeColor(colors.black)
        # штамп
        bx, by = W - 190 * mm, 5 * mm
        c.setLineWidth(1)
        c.rect(bx, by, 185 * mm, 55 * mm)
        for k, (lbl, val) in enumerate([("Объект", OBJ), ("Шифр", code), ("Наименование", title), ("Лист", f"{s} из {sheets}"), ("Стадия", "П" if kind == "pd" else "Р"), ("Разработчик", DESIGN)]):
            yy = by + 55 * mm - (k + 1) * 9 * mm
            c.line(bx, yy, bx + 185 * mm, yy)
            c.setFont("D", 7)
            c.drawString(bx + 2 * mm, yy + 3 * mm, lbl)
            c.setFont("DB" if lbl in ("Шифр", "Наименование") else "D", 8.5)
            c.drawString(bx + 30 * mm, yy + 3 * mm, val[:80])
        c.setFont("DB", 9)
        c.setFillColor(colors.Color(0.75, 0.1, 0.1))
        c.drawString(bx + 2 * mm, by + 57 * mm, MARK)
        c.setFillColor(colors.black)
        c.setFont("D", 9)
        c.drawString(30 * mm, 15 * mm, sheet + " · условное изображение (демонстрационный чертёж, размеры и армирование не указываются)")
        c.showPage()
    c.save()


FILES: dict[str, dict] = {}
DOCS: list[dict] = []


def reg(name: str, title: str, meta: dict, kind: str, **doc) -> str:
    f = fid(name)
    p = OUT / name
    FILES[f] = {"id": f, "path": name, "name": name, "project": PID, "type": "application/pdf", "ext": "pdf", "size": p.stat().st_size,
                "public": meta.get("public", False), "org": meta.get("org"), "contract": meta.get("contract"), "finance": meta.get("finance", False), "demo": True}
    did = "rd-" + f[5:]
    rev = {"rev": doc.pop("rev", 0), "date": doc.get("date"), "file": {"id": f, "name": name, "ext": "pdf", "size": p.stat().st_size}, "note": "Демонстрационный файл", "by": meta.get("org") or "Flow"}
    DOCS.append(dict({"id": did, "kind": kind, "title": title, "org": meta.get("org"), "contract": meta.get("contract"), "public": meta.get("public", False),
                      "demo": True, "revisions": [rev]}, **doc))
    return did


# ---------------------------------------------------------------- договор
def make_contract() -> str:
    name = "KP-26-MR-015_dogovor.pdf"
    d = Doc(OUT / name, f"Договор подряда № {K_NO}")
    d.text(f"ДОГОВОР ПОДРЯДА № {K_NO}", 14, True, center=True)
    d.text("на выполнение строительно-монтажных работ", 10, center=True)
    d.space(4)
    d.text(f"г. Москва                                                                                              {K_DATE} г.", 9.5)
    d.space(4)
    d.text(f"{CUST}, именуемое в дальнейшем «Заказчик», в лице генерального директора (вымышленное лицо), действующего на основании Устава, с одной стороны, и {CONTR}, именуемое в дальнейшем «Подрядчик», в лице генерального директора (вымышленное лицо), действующего на основании Устава, с другой стороны, заключили настоящий Договор о нижеследующем.", 9.5)
    secs = [
        ("1. Предмет договора", [
            f"1.1. Подрядчик обязуется выполнить работы по устройству монолитных железобетонных конструкций надземной части объекта «{OBJ}», этажи 1–6 (далее — Работы), в соответствии с рабочей документацией шифров КЖ-01, КЖ-02, КЖ-03, а Заказчик обязуется принять и оплатить результат Работ.",
            "1.2. Состав и объём Работ определяются локальным сметным расчётом (Приложение № 1) и рабочей документацией, переданной в производство работ по акту.",
            "1.3. Виды работ по Договору: «Надземный каркас» (монолитные колонны, стены, перекрытия)."]),
        ("2. Цена договора", [
            "2.1. Цена Договора составляет 185 000 000 (сто восемьдесят пять миллионов) рублей 00 копеек, в том числе НДС 20 % — 30 833 333 рубля 33 копейки.",
            "2.2. Цена Договора является твёрдой и может быть изменена только дополнительным соглашением Сторон.",
            "2.3. Стоимость выполненных Работ определяется по позициям утверждённой сметы на основании принятых объёмов (форма КС-2) и справки о стоимости (форма КС-3)."]),
        ("3. Сроки выполнения работ", [
            "3.1. Начало Работ — 01 октября 2026 г. Окончание Работ — 30 апреля 2027 г.",
            "3.2. Промежуточные сроки определяются графиком производства работ (Приложение № 2). Изменение сроков допускается только через процедуру корректировки графика: Подрядчик → Технический заказчик → Директор по строительству."]),
        ("4. Порядок расчётов", [
            "4.1. Заказчик перечисляет аванс в размере 10 % цены Договора в течение 10 рабочих дней после подписания Договора.",
            "4.2. Оплата выполненных Работ — в течение 30 календарных дней после подписания форм КС-2 и КС-3 за отчётный период с удержанием пропорциональной части аванса.",
            "4.3. Гарантийное удержание — 5 % от стоимости каждой принятой КС-2; возвращается после окончания гарантийного срока."]),
        ("5. Приёмка работ", [
            "5.1. Подрядчик направляет КС-2 по позициям сметы с исполнительной документацией (АОСР, исполнительные схемы, документы о качестве материалов).",
            "5.2. Технический заказчик проверяет объёмы и качество Работ; при выявлении замечаний КС-2 возвращается Подрядчику с указанием замечаний.",
            "5.3. Превышение объёмов над сметными подлежит отдельному согласованию."]),
        ("6. Обязанности сторон", [
            "6.1. Подрядчик назначает приказом ответственных за производство работ, строительный контроль подрядчика и ведение исполнительной документации.",
            "6.2. Подрядчик применяет материалы, имеющие документы о качестве (паспорта, сертификаты), и передаёт их копии Техническому заказчику.",
            "6.3. Заказчик передаёт рабочую документацию со штампом «В производство работ» и обеспечивает строительный контроль через Технического заказчика " + TZ + "."]),
        ("7. Гарантии", ["7.1. Гарантийный срок на результат Работ — 5 лет с даты подписания акта приёмки законченного строительством объекта."]),
        ("8. Ответственность сторон", ["8.1. За нарушение сроков выполнения Работ Подрядчик уплачивает неустойку в размере 0,05 % от стоимости невыполненных в срок Работ за каждый день просрочки, но не более 10 % цены Договора.",
                                       "8.2. За нарушение сроков оплаты Заказчик уплачивает неустойку в размере 0,03 % от неоплаченной суммы за каждый день просрочки."]),
        ("9. Прочие условия", ["9.1. Документ является демонстрационным образцом системы Flow и не порождает прав и обязанностей.",
                               "9.2. Приложения: № 1 — локальный сметный расчёт (ДЕМО); № 2 — график производства работ; № 3 — перечень рабочей документации."]),
    ]
    for t, ps in secs:
        d.space(4)
        d.text(t, 10.5, True)
        for p in ps:
            d.text(p, 9.5)
    d.space(6)
    d.text("Приложение № 3. Перечень рабочей документации", 10.5, True)
    d.table([["Шифр", "Наименование", "Статус"], ["КЖ-01", "Колонны и пилоны 1–6 этажей", "В производство работ"], ["КЖ-02", "Плиты перекрытий 1–6 этажей", "В производство работ"],
             ["КЖ-03", "Лестничные клетки, стены ядра жёсткости", "На проверке"], ["АР-01", "Планы этажей 1–6", "Согласован"]], [25, 110, 40])
    d.text("Реквизиты сторон", 10.5, True)
    d.table([["", "Заказчик", "Подрядчик"], ["Наименование", CUST, CONTR], ["ИНН / КПП", "ДЕМО / ДЕМО", "ДЕМО / ДЕМО"], ["Адрес", "г. Москва (демо)", "г. Москва (демо)"], ["Банк", "реквизиты не указываются", "реквизиты не указываются"]], [35, 70, 70])
    d.signs(["Заказчик", "Подрядчик"])
    d.save()
    return reg(name, f"Договор подряда № {K_NO} от {K_DATE}", {"org": CONTR, "contract": "kc6", "finance": True}, "contract", code=K_NO, date="2026-09-15",
               status="accepted", section="Договоры", fields={"customer": CUST, "contractor": CONTR, "amount": "185 000 000 ₽ с НДС", "term": "01.10.2026 – 30.04.2027"})


# ---------------------------------------------------------------- ПД / РД
def make_pdrd() -> dict:
    ids = {}
    name = "KP-PD-KR_poyasnitelnaya.pdf"
    d = Doc(OUT / name, "ПД раздел КР")
    d.text("ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ", 13, True, center=True)
    d.text("Раздел 4. Конструктивные решения (КР)", 11, True, center=True)
    d.text(f"Объект: {OBJ}. Шифр: КП-П-КР. Стадия П. Разработчик: {DESIGN}.", 9.5, center=True)
    d.space(8)
    for t in ["1. Конструктивная схема здания — монолитный железобетонный каркас с несущими колоннами, стенами ядер жёсткости и безбалочными плитами перекрытий.",
              "2. Фундамент — монолитная плита на свайном основании (буронабивные сваи), см. раздел КР, том 4.1.",
              "3. Материалы: бетон класса B30 W6 F150 для конструкций надземной части; арматура классов А500С и А240.",
              "4. Пространственная жёсткость обеспечивается совместной работой колонн, ядер жёсткости и дисков перекрытий.",
              "5. Данный документ — демонстрационный образец; расчёты и параметры не приводятся."]:
        d.text(t, 9.5)
    d.save()
    drawing(OUT / "KP-PD-KR_list.pdf", "КП-П-КР", "Схема каркаса (демо)", "Лист ПД КР", "pd", 1)
    pd = reg(name, "ПД. Раздел 4 «Конструктивные решения». Пояснительная записка", {"public": True, "org": DESIGN}, "pd", code="КП-П-КР", section="КР", set="КП-П-КР",
             date="2025-11-10", status="approved")
    DOCS[-1]["revisions"].append({"rev": 0, "date": "2025-11-10", "file": {"id": fid("KP-PD-KR_list.pdf"), "name": "KP-PD-KR_list.pdf", "ext": "pdf", "size": (OUT / "KP-PD-KR_list.pdf").stat().st_size}, "note": "Графическая часть", "by": DESIGN, "extra": True})
    reg("KP-PD-KR_list.pdf", "ПД КР — графическая часть", {"public": True, "org": DESIGN}, "pd-sheet", code="КП-П-КР", section="КР")
    DOCS.pop()
    ids["pd"] = pd
    rd = [("КЖ-01", "Колонны и пилоны 1–6 этажей", "kzh", "КЖ", "production", 2, ["k15"]),
          ("КЖ-02", "Плиты перекрытий 1–6 этажей", "kzh", "КЖ", "production", 2, ["k15"]),
          ("КЖ-03", "Лестничные клетки и стены ядра жёсткости", "kzh", "КЖ", "review", 1, ["k15"]),
          ("АР-01", "Планы этажей 1–6", "ar", "АР", "approved", 1, []),
          ("ОВ-01", "Отопление и вентиляция. Планы сетей 1–6 этажей", "ov", "ОВ", "approved", 1, []),
          ("ВК-01", "Водоснабжение и канализация. Планы сетей", "vk", "ВК", "remarks", 1, []),
          ("ЭОМ-01", "Электроосвещение и силовое оборудование", "eom", "ЭОМ", "draft", 1, [])]
    for code, title, kind, sec, status, sheets, tasks in rd:
        nm = "KP-RD-" + code.replace("-", "").translate(str.maketrans({"К": "K", "Ж": "Zh", "А": "A", "Р": "R", "О": "O", "В": "V", "Э": "E", "М": "M"})) + ".pdf"
        drawing(OUT / nm, "КП-Р-" + code, title, "Лист " + code, kind, sheets)
        ids[code] = reg(nm, f"РД {code}. {title}", {"public": True, "org": DESIGN}, "rd", code="КП-Р-" + code, section=sec, set=code, date="2026-08-20" if status == "production" else "2026-09-10",
                        status=status, tasks=tasks, rev=1 if code == "КЖ-01" else 0)
    # у КЖ-01 — две редакции: изм. 0 заменена изм. 1
    k = next(x for x in DOCS if x["id"] == ids["КЖ-01"])
    k["revisions"].insert(0, {"rev": 0, "date": "2026-07-30", "file": dict(k["revisions"][0]["file"]), "note": "Первая редакция (заменена)", "by": DESIGN, "replaced": True})
    return ids


# ---------------------------------------------------------------- приказы, паспорта, сертификаты, ИД
def simple(name: str, title: str, lines: list[str], table: list[list[str]] | None = None, widths: list[float] | None = None, parties: list[str] | None = None) -> None:
    d = Doc(OUT / name, title)
    d.text(title.upper(), 12, True, center=True)
    d.space(6)
    for ln in lines:
        d.text(ln, 9.5)
    if table:
        d.space(4)
        d.table(table, widths or [60, 60, 55])
    d.signs(parties or ["Ответственное лицо"])
    d.save()


def make_rest(rdids: dict) -> None:
    ords = [("prikaz-01.pdf", "Приказ № ДЕМО-12 о назначении ответственного за производство работ", CONTR, "Ответственный за производство работ (прораб)", "Надземный каркас", "2026-09-25"),
            ("prikaz-02.pdf", "Приказ № ДЕМО-13 о назначении ответственного за ведение исполнительной документации", CONTR, "Инженер ПТО", "Надземный каркас", "2026-09-25"),
            ("prikaz-03.pdf", "Приказ № ДЕМО-07 о назначении специалиста строительного контроля", TZ, "Специалист строительного контроля", "Все виды работ", "2026-09-20")]
    oids = []
    for nm, t, org, pos, wt, dt in ords:
        simple(nm, t, [f"Организация: {org}.", f"Объект: {OBJ}.", f"Назначить ответственным: должность — {pos}; Ф. И. О. — вымышленное лицо (демо).",
                       f"Зона ответственности: вид работ «{wt}», договор {K_NO}.", f"Срок действия: с {dt[8:]}.{dt[5:7]}.{dt[:4]} до окончания работ по договору.",
                       "Основание: требования СП 48.13330 и договора подряда. Документ демонстрационный."], parties=["Руководитель организации"])
        oids.append(reg(nm, t, {"org": org, "contract": "kc6" if org == CONTR else None, "public": org == TZ}, "order", code=t.split(" о ")[0], date=dt, status="accepted",
                        fields={"position": pos, "person": "вымышленное лицо (демо)", "workType": "frame" if wt != "Все виды работ" else None, "validFrom": dt}))
    simple("pasport-beton-B30.pdf", "Документ о качестве бетонной смеси (паспорт) № ДЕМО-П-2041",
           ["Изготовитель: БСУ «Демо-Бетон» (вымышленное предприятие).", "Бетонная смесь БСТ B30 П4 F150 W6, партия № ДЕМО-2041 от 02.10.2026, объём 48 м³.",
            "Прочность на сжатие в возрасте 28 сут: соответствует классу (данные демонстрационные)."],
           [["Показатель", "Требование", "Факт (демо)"], ["Класс прочности", "B30", "B30"], ["Подвижность", "П4", "П4"], ["Морозостойкость", "F150", "F150"], ["Водонепроницаемость", "W6", "W6"]], [60, 55, 55])
    pq = reg("pasport-beton-B30.pdf", "Паспорт качества бетонной смеси B30, партия ДЕМО-2041", {"org": CONTR, "contract": "kc6"}, "passport", code="ДЕМО-П-2041", date="2026-10-02", status="accepted",
             fields={"material": "Бетонная смесь B30 П4 F150 W6", "manufacturer": "БСУ «Демо-Бетон»", "batch": "ДЕМО-2041", "volume": "48 м³"}, workType="frame")
    simple("sert-armatura-A500C.pdf", "Сертификат соответствия № ДЕМО-СС-0001 (демонстрационный образец)",
           ["Продукция: прокат арматурный класса А500С, Ø10–28 мм.", "Изготовитель: «Демо-Металл» (вымышленное предприятие).",
            "Срок действия: с 01.03.2026 по 28.02.2029.", "Номер сертификата вымышленный; документ не подтверждает соответствие продукции."],
           [["Диаметр", "Партия", "Масса, т"], ["Ø12", "ДЕМО-А-118", "6,4"], ["Ø25", "ДЕМО-А-119", "11,2"]], [50, 60, 50])
    ce = reg("sert-armatura-A500C.pdf", "Сертификат соответствия на арматуру А500С (ДЕМО-СС-0001)", {"org": CONTR, "contract": "kc6"}, "cert", code="ДЕМО-СС-0001", date="2026-03-01", status="accepted",
             fields={"material": "Арматура А500С Ø10–28", "manufacturer": "«Демо-Металл»", "validTo": "2029-02-28", "batch": "ДЕМО-А-118, ДЕМО-А-119"}, workType="frame")
    simple("pasport-armatura.pdf", "Документ о качестве металлопроката № ДЕМО-ДК-5530",
           ["Прокат арматурный А500С Ø25, партия ДЕМО-А-119, масса 11,2 т.", "Механические свойства соответствуют требованиям (данные демонстрационные)."],
           [["Показатель", "Норма", "Факт (демо)"], ["σт, Н/мм²", "≥ 500", "540"], ["σв, Н/мм²", "≥ 600", "655"], ["δ5, %", "≥ 14", "17"]], [60, 55, 55])
    pq2 = reg("pasport-armatura.pdf", "Документ о качестве арматуры А500С Ø25, партия ДЕМО-А-119", {"org": CONTR, "contract": "kc6"}, "passport", code="ДЕМО-ДК-5530", date="2026-09-28", status="review",
              fields={"material": "Арматура А500С Ø25", "manufacturer": "«Демо-Металл»", "batch": "ДЕМО-А-119", "volume": "11,2 т"}, workType="frame")
    simple("pasport-oborudovanie-P1.pdf", "Паспорт оборудования: приточная установка П1 (демонстрационный образец)",
           ["Наименование: установка приточная П1, модель ДЕМО-ПУ-4000.", "Изготовитель: «Демо-Климат» (вымышленное предприятие). Заводской № ДЕМО-0042.",
            "Гарантия изготовителя: 24 месяца с даты ввода в эксплуатацию.", "Место установки: корпус 1, венткамера, отм. +24,000 (по РД ОВ-01)."],
           [["Параметр", "Значение (демо)", ""], ["Расход воздуха", "4000 м³/ч", ""], ["Мощность", "5,5 кВт", ""]], [60, 60, 50])
    eq = reg("pasport-oborudovanie-P1.pdf", "Паспорт оборудования: приточная установка П1", {"org": CONTR}, "equipment", code="ДЕМО-0042", date="2026-09-30", status="draft",
             fields={"equipment": "Приточная установка П1", "model": "ДЕМО-ПУ-4000", "serial": "ДЕМО-0042", "manufacturer": "«Демо-Климат»", "warranty": "24 мес.", "location": "венткамера, отм. +24,000"}, workType="mep")
    # исполнительная схема, журналы, АОСР, акт передачи РД
    drawing(OUT / "isp-shema-kolonny-1et.pdf", "ИС-КЖ-01-1", "Исполнительная схема колонн 1 этажа (демо)", "Исполнительная геодезическая схема", "kzh", 1)
    sc = reg("isp-shema-kolonny-1et.pdf", "Исполнительная схема колонн 1 этажа", {"org": CONTR, "contract": "kc6"}, "scheme", code="ИС-КЖ-01-1", date="2026-10-03", status="review", tasks=["k15"], workType="frame",
             links=[rdids["КЖ-01"]])
    simple("zhurnal-betonnyh-rabot.pdf", "Журнал бетонных работ (выписка) — демонстрационный образец",
           ["Объект: " + OBJ + ". Подрядчик: " + CONTR + ".", "Записи демонстрационные; подписи не ставятся."],
           [["Дата", "Конструкция", "Объём, м³"], ["03.10.2026", "Колонны 1 эт., оси 1–5/А–В", "18"], ["04.10.2026", "Колонны 1 эт., оси 5–9/А–В", "17"]], [40, 90, 40])
    jr = reg("zhurnal-betonnyh-rabot.pdf", "Журнал бетонных работ (выписка)", {"org": CONTR, "contract": "kc6"}, "journal", code="ЖБР-ДЕМО", date="2026-10-04", status="review", tasks=["k15"], workType="frame")
    simple("aosr-01-armirovanie.pdf", "Акт освидетельствования скрытых работ № ДЕМО-АОСР-01",
           ["Объект: " + OBJ + ".", "Работы: армирование колонн 1 этажа, оси 1–9/А–Е.", "Работы выполнены по РД КП-Р-КЖ-01 изм. 1.",
            "Применены материалы: арматура А500С (сертификат ДЕМО-СС-0001, документ о качестве ДЕМО-ДК-5530).", "Исполнительная схема: ИС-КЖ-01-1.",
            "Разрешается производство последующих работ: бетонирование колонн 1 этажа."],
           parties=["Представитель застройщика", "Представитель подрядчика", "Представитель строительного контроля"])
    a1 = reg("aosr-01-armirovanie.pdf", "АОСР № ДЕМО-01 — армирование колонн 1 этажа", {"org": CONTR, "contract": "kc6"}, "aosr", code="ДЕМО-АОСР-01", date="2026-10-02", status="review",
             tasks=["k15"], workType="frame", links=[rdids["КЖ-01"], ce, pq2, sc, "order:" + oids[1]])
    simple("aosr-02-betonirovanie.pdf", "Акт освидетельствования скрытых работ № ДЕМО-АОСР-02",
           ["Работы: бетонирование колонн 1 этажа, оси 1–5/А–В.", "Применены материалы: бетонная смесь B30 (паспорт ДЕМО-П-2041).", "Журнал бетонных работ: записи от 03.10.2026."],
           parties=["Представитель застройщика", "Представитель подрядчика", "Представитель строительного контроля"])
    a2 = reg("aosr-02-betonirovanie.pdf", "АОСР № ДЕМО-02 — бетонирование колонн 1 этажа", {"org": CONTR, "contract": "kc6"}, "aosr", code="ДЕМО-АОСР-02", date="2026-10-04", status="draft",
             tasks=["k15"], workType="frame", links=[rdids["КЖ-01"], pq, jr])
    simple("akt-peredachi-RD.pdf", "Акт передачи рабочей документации в производство работ № ДЕМО-3",
           ["Передаются комплекты РД со штампом «В производство работ»:", "КП-Р-КЖ-01 изм. 1 — Колонны и пилоны 1–6 этажей;", "КП-Р-КЖ-02 изм. 0 — Плиты перекрытий 1–6 этажей.",
            "Получатель: " + CONTR + ", договор " + K_NO + "."], parties=["Передал (технический заказчик)", "Принял (подрядчик)"])
    reg("akt-peredachi-RD.pdf", "Акт передачи РД в производство работ № ДЕМО-3", {"org": TZ, "public": True}, "act", code="ДЕМО-3", date="2026-09-29", status="accepted",
        links=[rdids["КЖ-01"], rdids["КЖ-02"]])
    for x in DOCS:
        x.setdefault("tasks", [])
        x.setdefault("links", [])


cid = make_contract()
ids = make_pdrd()
make_rest(ids)
(OUT / "manifest.json").write_text(json.dumps(FILES, ensure_ascii=False, indent=1), encoding="utf-8")
(ROOT / "tools" / "demo-docs.json").write_text(json.dumps({PID: DOCS}, ensure_ascii=False, indent=1), encoding="utf-8")
print("файлов:", len(FILES), "документов:", len(DOCS))
