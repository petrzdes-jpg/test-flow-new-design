/* Ogni daily-report input: manual summary values and Claude-only AI parsing of daily reports.
   Opened from the shared DSFlow data hub («Внести данные ИИ»).
   A proposal changes local facts only after explicit review and confirmation. */
(() => {
  'use strict';
  const layer=document.createElement('div');layer.id='ogni-ai-layer';document.body.append(layer);
  const fields={
    bns_rep:['БНС · выполнено свай','шт.'],dw_zah:['СВГ · выполнено захваток','шт.'],dw_m3:['СВГ · объём','м³'],
    fs_pm:['Форшахта · погонные метры','п.м.'],fs_m3:['Форшахта · объём','м³'],
    slope:['Укрепление откоса','м²'],dis_pm:['Демонтаж форшахты','п.м.'],beam_m3:['Обвязочная балка','м³'],
    svg_top_pm:['Срубка верха СВГ','п.м.'],gas_done:['Газовая труба','п.м.'],cages:['Армокаркасы · поставлено','шт.'],
    wrk_d:['Рабочие · дневная смена','чел.'],wrk_n:['Рабочие · ночная смена','чел.'],
    itr_d:['ИТР · дневная смена','чел.'],itr_n:['ИТР · ночная смена','чел.'],
    trk_d:['Самосвалы · день','шт.'],trk_n:['Самосвалы · ночь','шт.']
  };
  const state={files:[],proposals:[],summary:'',stage:'hub',error:'',sample:null,ctl:null,reportDate:'',hint:''};
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const todayLocal=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const latest=()=>DATA.rows[DATA.rows.length-1];
  const valueOf=key=>key==='gas_done'?DATA.targets.gas_done:latest()[key];
  const fmt=value=>value==null?'—':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2});
  const model=async()=>{if(state.sample)return state.sample;const C=window.claude;if(C&&typeof C.use==='function')state.sample=await C.use('sample').catch(()=>null);return state.sample;};
  function shell(){layer.innerHTML=DSFlowProject.aiModal({closeAction:'data-ogni-ai-close',bodyId:'ogni-ai-body'});}
  function close(){if(state.ctl)state.ctl.abort();layer.innerHTML='';state.stage='hub';state.ctl=null;}
  function showHub(){shell();layer.querySelector('h2').textContent='Внести данные ИИ';layer.querySelector('.body').innerHTML=DSFlowProject.dataHub({manualAction:'data-ogni-ai-manual',aiAction:'data-ogni-ai-open'});state.stage='hub';}
  function fileList(){return state.files.map((file,index)=>`<div class="fitem"><span class="fn">${esc(file.name)}</span><span class="faint">${esc(file.note)}</span><button class="icon-btn" type="button" data-ogni-ai-remove="${index}" aria-label="Убрать файл">×</button></div>`).join('');}
  function pick(){
    shell();state.stage='pick';const canAi=Boolean(state.sample);
    layer.querySelector('.body').innerHTML=`<p class="faint" style="font-size:13px">Загрузите сводку или документ. ${canAi?'ИИ прочитает файлы и предложит изменения; применение потребует вашего подтверждения.':'Анализ ИИ доступен, когда страница открыта в Claude. На обычном сайте сервер модели пока не подключён.'}</p>
      <label class="drop" for="ogni-ai-files"><b>Выберите файлы</b> или перетащите сюда<br><small>PDF · Excel · Word · CSV · TXT · XML · JPG/PNG</small><input id="ogni-ai-files" type="file" multiple accept=".pdf,.xlsx,.xls,.docx,.csv,.tsv,.txt,.md,.json,.xml,.jpg,.jpeg,.png,.webp" style="position:absolute;width:1px;height:1px;opacity:0"></label>
      ${state.files.length?`<div class="flist">${fileList()}</div>`:''}
      <div class="row-f"><div class="fld"><label for="ogni-ai-date">Дата документов</label><input id="ogni-ai-date" type="date" value="${esc(state.reportDate||todayLocal())}"></div><div class="fld"><label for="ogni-ai-hint">Пояснение для ИИ</label><input id="ogni-ai-hint" type="text" value="${esc(state.hint)}" placeholder="Например: суточная сводка по БНС"></div></div>
      ${state.error?`<div class="note warn" role="alert">${esc(state.error)}</div>`:''}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span class="faint" style="font-size:12px">Подтверждённые изменения сохранятся только в этом браузере.</span><button class="btn primary" type="button" data-ogni-ai-run ${canAi&&state.files.some(f=>f.text||f.image)?'':'disabled'}>Проанализировать</button></div>`;
    const inp=layer.querySelector('#ogni-ai-files'),drop=layer.querySelector('.drop');
    inp.addEventListener('change',()=>addFiles([...inp.files]));
    drop.addEventListener('dragover',event=>event.preventDefault());
    drop.addEventListener('drop',event=>{event.preventDefault();addFiles([...event.dataTransfer.files]);});
    layer.querySelector('#ogni-ai-date').addEventListener('change',event=>{state.reportDate=event.target.value;});
    layer.querySelector('#ogni-ai-hint').addEventListener('input',event=>{state.hint=event.target.value;});
  }
  const loaded=new Map();
  function loadScript(src){if(loaded.has(src))return loaded.get(src);const p=new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>reject(new Error('Библиотека для чтения файла недоступна'));document.head.append(el);});loaded.set(src,p);return p;}
  async function read(file){
    const ext=file.name.split('.').pop().toLowerCase();
    if(file.type.startsWith('image/'))return {file,name:file.name,image:file,note:'изображение'};
    if(ext==='mpp')return {file,name:file.name,note:'Формат MPP не читается в браузере; сохраните график как XML'};
    try{
      const buffer=await file.arrayBuffer();let text='';let note='текст';
      if(ext==='pdf'){
        await loadScript('../assets/vendor/pdf.min.js');window.pdfjsLib.GlobalWorkerOptions.workerSrc='../assets/vendor/pdf.worker.min.js';
        const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(buffer)}).promise;
        const pages=[];for(let i=1;i<=Math.min(pdf.numPages,60);i++){const page=await pdf.getPage(i);const words=(await page.getTextContent()).items.map(item=>item.str);pages.push(`Страница ${i}: ${words.join(' ')}`);}
        text=pages.join('\n');note=`PDF · ${pdf.numPages} стр.`;
      }else if(['xlsx','xls','xlsm'].includes(ext)){
        await loadScript('../assets/vendor/xlsx.full.min.js');const book=window.XLSX.read(buffer,{type:'array',cellDates:true});
        text=book.SheetNames.map(name=>`Лист ${name}\n`+window.XLSX.utils.sheet_to_csv(book.Sheets[name],{FS:';',blankrows:false,dateNF:'dd.mm.yyyy'})).join('\n\n');note=`Excel · ${book.SheetNames.length} лист(а)`;
      }else if(ext==='docx'){
        await loadScript('../assets/vendor/mammoth.browser.min.js');text=(await window.mammoth.extractRawText({arrayBuffer:buffer})).value;note='Word';
      }else if(['csv','tsv','txt','md','json','xml'].includes(ext)){
        text=new TextDecoder('utf-8').decode(buffer);if((text.match(/\uFFFD/g)||[]).length>5)text=new TextDecoder('windows-1251').decode(buffer);
      }else return {file,name:file.name,note:'Формат не поддерживается'};
      return {file,name:file.name,text,note:text.trim()?note:'Текст не извлечён; сканируйте документ или загрузите изображение'};
    }catch(error){return {file,name:file.name,note:'Не удалось прочитать: '+(error.message||error)};}
  }
  async function addFiles(files){
    state.error='';state.files.push(...files.map(file=>({file,name:file.name,note:'Читаю…'})));pick();
    const tail=await Promise.all(files.map(read));state.files.splice(state.files.length-files.length,files.length,...tail);pick();
  }
  function manual(){
    shell();state.stage='manual';
    layer.querySelector('.body').innerHTML=`<p class="faint" style="font-size:13px">Внесите только подтверждённые показатели. Неизменённые поля сохранят предыдущий факт и будут помечены как не обновлённые.</p><div class="fld"><label for="ogni-manual-date">Дата сводки</label><input type="date" id="ogni-manual-date" value="${todayLocal()}"></div>
      <div class="row-f">${Object.entries(fields).map(([key,[label,unit]])=>`<div class="fld"><label for="ogni-field-${key}">${label} · ${unit}</label><input type="number" step="any" min="0" id="ogni-field-${key}" data-manual-field="${key}" placeholder="Сейчас ${fmt(valueOf(key))}"></div>`).join('')}</div>
      <div class="fld"><label for="ogni-manual-note">Источник / примечание</label><textarea id="ogni-manual-note" placeholder="Название сводки, причина корректировки"></textarea></div>
      ${state.error?`<div class="note warn" role="alert">${esc(state.error)}</div>`:''}<button class="btn primary" type="button" data-ogni-ai-manual-review>Проверить изменения</button>`;
  }
  function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='2026-09-30'&&value<=todayLocal();}
  function manualReview(){
    const date=layer.querySelector('#ogni-manual-date').value;
    if(!validDate(date)){layer.querySelector('.body').insertAdjacentHTML('beforeend','<div class="note warn" role="alert">Дата сводки должна быть после исходного отчёта 29.09.2026 и не позже сегодняшнего дня.</div>');return;}
    const proposals=[...layer.querySelectorAll('[data-manual-field]')].filter(input=>input.value!=='').map(input=>({key:input.dataset.manualField,value:Number(input.value),quote:'Введено вручную',file:'Ручной ввод'})).filter(p=>Number.isFinite(p.value)&&p.value>=0);
    if(!proposals.length){layer.querySelector('.body').insertAdjacentHTML('beforeend','<div class="note warn" role="alert">Заполните хотя бы один показатель.</div>');return;}
    state.reportDate=date;state.summary=layer.querySelector('#ogni-manual-note').value.trim()||'Ручной ввод';state.proposals=proposals;review();
  }
  function review(){
    shell();state.stage='review';const prior=latest();
    layer.querySelector('.body').innerHTML=`<div class="note">${esc(state.summary||'Проверьте предложенные значения перед сохранением.')}</div><p class="faint" style="font-size:12px">Дата ${esc(state.reportDate)} · текущий срез ${esc(prior.d)}. Данные без новой сводки останутся прежними. Изменения видны только в этом браузере.</p>
      ${state.proposals.length?`<div class="flist">${state.proposals.map((p,i)=>`<label class="dsf-ai-proposal"><input type="checkbox" data-proposal="${i}" ${p.confirmed?'checked':''}><span><b>${esc(fields[p.key][0])}</b><small>${esc(p.file||'')} · ${esc(p.quote||'Без цитаты')}</small></span><b>${fmt(valueOf(p.key))} → ${fmt(p.value)} ${esc(fields[p.key][1])}</b></label>`).join('')}</div>`:'<div class="note warn">Подходящих показателей не найдено. Исторические данные не изменены.</div>'}
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn" type="button" data-ogni-ai-back>Назад</button><button class="btn primary" type="button" data-ogni-ai-apply ${state.proposals.length?'':'disabled'}>Применить выбранное</button></div>`;
  }
  async function analyze(){
    state.reportDate=layer.querySelector('#ogni-ai-date').value;state.hint=layer.querySelector('#ogni-ai-hint').value.trim();
    if(!validDate(state.reportDate)){state.error='Дата документов должна быть после исходного отчёта 29.09.2026 и не позже сегодняшнего дня.';pick();return;}
    const files=state.files.filter(file=>file.text||file.image);if(!files.length)return;
    if(!state.sample){state.error='Анализ ИИ доступен только в Claude.';pick();return;}
    state.stage='thinking';shell();layer.querySelector('.body').innerHTML='<div class="note">ИИ анализирует файлы и сопоставляет показатели БЦ «Огни»…</div><button class="btn" type="button" data-ogni-ai-stop>Остановить</button>';
    const schema=Object.entries(fields).map(([key,[label,unit]])=>`${key}: ${label} (${unit})`).join('\n');
    const documents=files.filter(file=>file.text).map(file=>`=== ${file.name} ===\n${file.text.slice(0,25000)}`).join('\n\n').slice(0,65000);
    const prompt=`Ты структурируешь суточные отчёты БЦ «Огни». Дата: ${state.reportDate}. ${state.hint}. Возвращай только JSON: {"summary":"...","values":{"bns_rep":96},"quotes":{"bns_rep":"дословное подтверждение из файла"},"unmatched":["..."]}. Допустимые ключи (только если в источнике явно указан факт):\n${schema}\nНе вычисляй и не придумывай бюджет, планы, прогнозы, отсутствующие факты и завершение работ. Для каждого значения приведи короткую цитату. Не перепутай план с фактом, накопительный факт с суточным приростом. Если сомневаешься, пропусти показатель.\n${documents}`;
    const ctl=new AbortController();state.ctl=ctl;
    try{
      const images=files.filter(file=>file.image).map(file=>file.image).slice(0,4);
      const answer=await state.sample.json(prompt,{modelTier:'default',signal:ctl.signal,...(images.length?{images}:{})});
      state.summary=String(answer.summary||'');
      state.proposals=Object.entries(answer.values||{}).filter(([key,value])=>fields[key]&&typeof value==='number'&&Number.isFinite(value)&&value>=0)
        .map(([key,value])=>({key,value,quote:String(answer.quotes?.[key]||''),file:files.map(file=>file.name).join(', '),confirmed:Boolean(answer.quotes?.[key])}));
      state.ctl=null;review();
    }catch(error){state.ctl=null;state.error=error?.code==='cancelled'?'Анализ остановлен.':'Анализ не удался: '+(error?.message||'попробуйте ещё раз');pick();}
  }
  function apply(){
    const selected=[...layer.querySelectorAll('[data-proposal]:checked')].map(input=>state.proposals[Number(input.dataset.proposal)]);
    if(!selected.length){state.error='Выберите хотя бы одно подтверждённое изменение.';review();return;}
    const values=Object.fromEntries(selected.map(p=>[p.key,p.value]));
    const imports=JSON.parse(localStorage.getItem(DSF_OGNI_IMPORT_KEY)||'[]');
    imports.push({date:state.reportDate,values,note:state.summary.slice(0,500),sources:selected.map(p=>({key:p.key,quote:p.quote,file:p.file})),at:Date.now()});
    try{localStorage.setItem(DSF_OGNI_IMPORT_KEY,JSON.stringify(imports));location.reload();}
    catch(error){state.error='Не удалось сохранить данные в этом браузере.';review();}
  }
  document.addEventListener('click',async event=>{
    if(event.target.closest('[data-ai-hub]')){event.preventDefault();try{showHub();}catch(error){layer.textContent='Не удалось открыть ввод данных: '+(error?.message||error);console.error(error);}return;}
    if(event.target.closest('[data-ogni-ai-open],[data-ogni-ai-manual]')&&!layer.contains(event.target)){window.DSFEngine?.closeLayer();}
    else if(!layer.contains(event.target))return;
    if(event.target.closest('[data-ogni-ai-close]')||event.target.classList.contains('modal-bg')){close();return;}
    if(event.target.closest('[data-ogni-ai-open]')){await model();state.error='';pick();return;}
    if(event.target.closest('[data-ogni-ai-manual]')){state.error='';manual();return;}
    if(event.target.closest('[data-ogni-ai-remove]')){state.files.splice(Number(event.target.closest('[data-ogni-ai-remove]').dataset.ogniAiRemove),1);pick();return;}
    if(event.target.closest('[data-ogni-ai-manual-review]')){manualReview();return;}
    if(event.target.closest('[data-ogni-ai-run]')){analyze();return;}
    if(event.target.closest('[data-ogni-ai-stop]')){state.ctl?.abort();return;}
    if(event.target.closest('[data-ogni-ai-back]')){state.files.length?pick():manual();return;}
    if(event.target.closest('[data-ogni-ai-apply]')){apply();}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&layer.innerHTML)close();});
  window.OgniAI={hub:showHub,manual,pick:async()=>{await model();state.error='';pick();}};
})();
