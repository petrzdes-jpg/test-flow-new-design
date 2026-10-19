/* Shared project navigation. The route and facts belong to each project; the
   structure and disclosure behavior belong to DSFlow. */
window.DSFlowProject = Object.freeze({
  sidebar({ main, grouped, item, groupOpen = false, groupId = 'project-data', groupTitle = 'Данные и отчёты' }) {
    const expanded = Boolean(groupOpen);
    return `<div class="sb-sec">Проект</div>
      ${main.map(item).join('')}
      <div class="sb-group${expanded ? ' open' : ''}">
        <button class="sb-gh" type="button" data-act="nav-group" aria-expanded="${expanded}" aria-controls="${groupId}" title="${groupTitle}">
          <span class="nl">${groupTitle}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        </button>
        <div class="sb-gb" id="${groupId}" role="group" aria-label="${groupTitle}"><div class="sb-gi" ${expanded ? '' : 'inert'}>${grouped.map(item).join('')}</div></div>
      </div>`;
  },
  toggleSidebar(root, open) {
    root.querySelectorAll('.sb-group').forEach(group => {
      group.classList.toggle('open', open);
      group.querySelector('.sb-gh').setAttribute('aria-expanded', String(open));
      group.querySelector('.sb-gi').inert = !open;
    });
  },
  milestones({ list, today, action = 'data-go' }) {
    if (!list.length) return '<p class="faint">Вехи пока не переданы.</p>';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const stateColor = {done:'var(--good)',over:'var(--crit)',risk:'var(--warn)',plan:'var(--line-strong)',unknown:'var(--line-strong)'};
    const counts = {done:0,over:0,risk:0,plan:0,unknown:0};
    list.forEach(item => { counts[item.state in counts ? item.state : 'unknown']++; });
    const current = list.findIndex(item => item.iso >= today);
    const position = current < 0 ? 100 : Math.max(0, Math.min(100, (current + 0.5) / list.length * 100));
    const dot = item => `background:${item.state === 'done' ? stateColor.done : 'var(--surface)'};border-color:${stateColor[item.state] || stateColor.unknown}`;
    const status = item => `<span class="chip ${item.state === 'unknown' ? 'neutral' : item.state === 'over' ? 'crit' : item.state === 'plan' ? 'neutral' : item.state === 'done' ? 'good' : 'warn'}">${escape(item.status)}</span>`;
    const attr = item => `${action}="${escape(item.target)}"`;
    return `<div class="dsf-ms-counts"><span><b style="color:var(--good)">${counts.done}</b> выполнено</span><span><b style="color:var(--crit)">${counts.over}</b> просрочено</span><span><b style="color:var(--warn-ink)">${counts.risk}</b> под угрозой</span><span><b>${counts.plan + counts.unknown}</b> в плане / без факта</span></div>
      <div class="ms-scroll"><div class="ms-track" style="min-width:${list.length * 120}px"><span class="dsf-ms-line"></span><span class="dsf-ms-done" style="width:${position}%"></span><span class="dsf-ms-today" style="left:${position}%">Сегодня · ${escape(today.split('-').reverse().join('.'))}</span>
        <div class="ms-grid" style="grid-template-columns:repeat(${list.length},minmax(0,1fr))">${list.map(item => `<button class="ms" type="button" ${attr(item)}><span class="md" style="${dot(item)}"></span><span class="mn">${escape(item.name)}</span><span class="mdt">${escape(item.date)}</span>${status(item)}<span class="msub">${escape(item.sub || '')}</span></button>`).join('')}</div></div></div>
      <div class="msv">${list.map((item,index) => `<button class="msv-i" type="button" ${attr(item)}><span class="rail"><i style="background:${index === list.length-1 ? 'transparent' : item.iso <= today ? 'var(--accent)' : 'var(--track)'}"></i><b style="${dot(item)}"></b></span><span class="dsf-ms-mobile-label"><span>${escape(item.name)}</span><small>${escape(item.date)} · ${escape(item.sub || '')}</small></span>${status(item)}</button>`).join('')}</div>`;
  },
  calendarYears({ start, end, today, events = [], action = 'data-calendar-month', target = month => month }) {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    const colors = {done:'var(--good)',over:'var(--crit)',risk:'var(--warn)',plan:'var(--ink-2)',unknown:'var(--ink-2)'};
    const years = [];
    for (let year=Number(start.slice(0,4)); year<=Number(end.slice(0,4)); year++) {
      const cells=[];
      for (let month=1;month<=12;month++) {
        const ym=`${year}-${String(month).padStart(2,'0')}`;
        const first=ym+'-01';
        const last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
        const outside=last<start||first>end;
        const hits=events.filter(event=>event.iso?.startsWith(ym));
        const priority={over:4,risk:3,done:2,plan:1,unknown:0};
        const event=hits.sort((a,b)=>(priority[b.state]||0)-(priority[a.state]||0))[0];
        const current=today>=first&&today<=last;
        const past=last<today;
        const future=first>end;
        const color=outside?'var(--surface-2)':current?'var(--accent)':past?'var(--past,var(--surface-2))':'var(--surface-2)';
        const title=`${monthNames[month-1]} ${year}${hits.map(hit=>' · '+hit.name).join('')}`;
        cells.push(`<button type="button" class="cal-c" ${action}="${escape(target(ym))}" title="${escape(title)}" aria-label="${escape(title)}" style="background:${color};opacity:${outside?0:1};${future?'border:1.5px dashed var(--warn);':''}"><i style="background:${event?colors[event.state]||colors.unknown:'transparent'}"></i></button>`);
      }
      years.push(`<div class="cal-r"><span class="dsf-cal-year">${year}</span>${cells.join('')}</div>`);
    }
    return years.join('');
  },
  photoChronicle({ dates, activeDate, photos, dateAttr, viewerAttr, formatDate, workLabel = photo => photo.work || '' }) {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    if (!dates.length) return '<section class="panel dsf-photo-chronicle"><header><h2>Фотографии площадки</h2></header><div class="pad"><div class="empty">Фотографии площадки ещё не добавлены.</div></div></section>';
    const index=dates.findIndex(item=>item.date===activeDate);
    const prev=dates[index+1], next=dates[index-1];
    return `<section class="panel dsf-photo-chronicle"><header><h2>Отчёты по датам</h2></header><div class="pad"><div class="days">${dates.map(item=>`<button class="day" type="button" ${dateAttr(item.date)} aria-current="${item.date===activeDate}"><img src="${escape(item.src)}" alt="" loading="lazy"><span class="num">${escape(formatDate(item.date))}</span><span class="faint">${item.count} фото</span></button>`).join('')}</div></div></section>
      <section class="panel dsf-photo-chronicle"><header><button class="icon-btn" type="button" ${prev?dateAttr(prev.date):'disabled'} aria-label="Предыдущая дата">←</button><h2>Отчёт за ${escape(formatDate(activeDate))}</h2><button class="icon-btn" type="button" ${next?dateAttr(next.date):'disabled'} aria-label="Следующая дата">→</button><span class="sub dsf-photo-count">${photos.length} фото</span></header><div class="pad"><div class="pgrid">${photos.map(photo=>`<button class="pcard" type="button" ${viewerAttr(photo)}><img src="${escape(photo.src)}" alt="${escape(photo.caption)}" loading="lazy"><span class="pc"><b>${escape(photo.caption)}</b><span class="faint">${escape(photo.zone || '')}</span><span class="dsf-photo-work">${escape(workLabel(photo))}</span></span></button>`).join('')}</div></div></section>`;
  },
  aiModal({ closeAction, bodyId = 'ai-body' }) {
    return `<div class="modal-bg" data-bg="1"><div class="modal wide" role="dialog" aria-modal="true" aria-label="Обновление данных из файлов"><header><div><div class="eyebrow">Ввод данных</div><h2 style="margin-top:4px">Обновить факт из файлов</h2></div><button class="icon-btn" type="button" ${closeAction} aria-label="Закрыть"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></header><div class="body" id="${bodyId}"></div></div></div>`;
  },
  dataHub({ manualAction, aiAction, manualText = 'Вручную: работа, дата и прирост выполнения.', aiText = 'Сводки, таблицы и документы — ИИ предложит изменения для подтверждения.' }) {
    return `<div class="hub"><button class="hub-opt" type="button" ${manualAction}><span class="hub-ic">＋</span><span><b>Внести факт</b><span class="faint">${manualText}</span></span><span>›</span></button><button class="hub-opt" type="button" ${aiAction}><span class="hub-ic">↑</span><span><b>Загрузить отчёт ИИ</b><span class="faint">${aiText}</span></span><span>›</span></button></div>`;
  },
  implementationHead({ active, subtitle, action = 'data-go', target = key => '#/impl/' + key }) {
    const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const tabs=[['structure','Структура'],['gantt','Диаграмма Ганта'],['milestones','Ключевые вехи']];
    return `<div class="head dsf-implementation-head"><div class="ttl"><div class="eyebrow">Уровень 2 · Структура</div><h1 style="margin-top:6px">Реализация проекта</h1><div class="meta">${esc(subtitle)}</div></div><div class="seg" role="tablist">${tabs.map(([key,title])=>`<button role="tab" type="button" ${action}="${esc(target(key))}" aria-selected="${active===key}">${title}</button>`).join('')}</div></div>`;
  }
});
