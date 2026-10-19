/* Flow: параметры размещения (один файл на весь сайт).
   api — адрес Flow API (FastAPI, Timeweb App Platform). Пустая строка — API на том же домене.
   Для локальной проверки адрес можно временно переопределить: localStorage.setItem('flow.api', 'http://127.0.0.1:8000') */
window.FLOW_ENV = {
  api: 'https://dailybuildreport-dsflow-9ab6.twc1.net',
  version: '2026.10.07-flow.1'
};
