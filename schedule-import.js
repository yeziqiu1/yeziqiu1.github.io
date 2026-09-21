const previewEvents = window.__previewDefaultEvents || [];
const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const dayOffsets = { '周一': 0, '周二': 1, '周三': 2, '周四': 3, '周五': 4, '周六': 5, '周日': 6 };
const icsDayCodes = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
const elements = {
  grid: document.getElementById('grid'),
  weekbar: document.getElementById('weekbar'),
  range: document.getElementById('range'),
  parity: document.getElementById('parity'),
  dropZone: document.getElementById('icsDropZone'),
  fileInput: document.getElementById('icsFileInput'),
  chooseButton: document.getElementById('chooseIcsButton'),
  resetButton: document.getElementById('resetPreviewButton'),
  status: document.getElementById('importStatus'),
  week1Input: document.getElementById('previewWeek1'),
  downloadLink: document.getElementById('downloadIcsLink'),
};
let currentEvents = previewEvents.map((event) => ({ ...event }));
let parsedOccurrences = [];
let currentWeek = 1;
let totalWeeks = 18;
let week1Date = parseInputDate(elements.week1Input.value);
let importedDownloadUrl = '';

function parseInputDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : new Date(2026, 7, 31, 12);
}
function addDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}
function startOfWeek(date) {
  const result = new Date(date);
  const offset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - offset);
  result.setHours(12, 0, 0, 0);
  return result;
}
function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function formatTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function unfoldIcs(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}
function unescapeIcs(value) {
  return String(value ?? '').replace(/\\[nN]/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
function parseProperty(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(';');
  const name = parts.shift().toUpperCase();
  const params = {};
  for (const part of parts) {
    const equals = part.indexOf('=');
    if (equals > 0) params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}
function parseIcsDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (match[4] === undefined) return new Date(year, month, day, 12, 0, 0);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  return match[7] === 'Z'
    ? new Date(Date.UTC(year, month, day, hour, minute, second))
    : new Date(year, month, day, hour, minute, second);
}
function parseRule(value) {
  const rule = {};
  for (const token of String(value || '').split(';')) {
    const equals = token.indexOf('=');
    if (equals > 0) rule[token.slice(0, equals).toUpperCase()] = token.slice(equals + 1);
  }
  return rule;
}

function parseIcsOccurrences(text) {
  const occurrences = [];
  const blocks = unfoldIcs(text).split(/BEGIN:VEVENT/i).slice(1);
  for (const block of blocks) {
    const body = block.split(/END:VEVENT/i)[0];
    const properties = {};
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const property = parseProperty(line);
      if (!property) continue;
      if (!properties[property.name]) properties[property.name] = [];
      properties[property.name].push(property);
    }
    const startProperty = properties.DTSTART?.[0];
    if (!startProperty) continue;
    const start = parseIcsDate(startProperty.value);
    if (!start) continue;
    const allDay = startProperty.params.VALUE === 'DATE' || !/T\d{6}/.test(startProperty.value);
    const endProperty = properties.DTEND?.[0];
    let end = endProperty ? parseIcsDate(endProperty.value) : null;
    if (!end) end = new Date(start.getTime() + (allDay ? 86400000 : 3600000));
    const duration = Math.max(0, end.getTime() - start.getTime());
    const summary = unescapeIcs(properties.SUMMARY?.[0]?.value || '未命名课程');
    const location = unescapeIcs(properties.LOCATION?.[0]?.value || '');
    const description = unescapeIcs(properties.DESCRIPTION?.[0]?.value || '');
    const rule = properties.RRULE?.[0] ? parseRule(properties.RRULE[0].value) : null;
    const excludedDates = new Set();
    for (const property of properties.EXDATE || []) {
      for (const item of property.value.split(',')) {
        const excluded = parseIcsDate(item);
        if (excluded) excludedDates.add(formatDate(excluded));
      }
    }
    const dates = [];
    const seenDates = new Set();
    const pushDate = (date) => {
      const key = date ? formatDate(date) : '';
      if (!date || date < start || excludedDates.has(key) || seenDates.has(key)) return;
      seenDates.add(key);
      dates.push(new Date(date));
    };
    pushDate(start);
    if (rule) {
      const frequency = String(rule.FREQ || '').toUpperCase();
      const interval = Math.max(1, Number(rule.INTERVAL) || 1);
      const count = Number(rule.COUNT) || 0;
      const until = rule.UNTIL ? parseIcsDate(rule.UNTIL) : null;
      const byDay = String(rule.BYDAY || '').split(',').map((item) => item.trim()).filter(Boolean);
      const limit = 2500;
      if (frequency === 'WEEKLY') {
        if (byDay.length) {
          const firstWeek = startOfWeek(start);
          for (let week = 0; dates.length < limit; week += 1) {
            const weekStart = addDays(firstWeek, week * 7 * interval);
            let addedInWeek = false;
            for (const code of byDay.sort((a, b) => icsDayCodes[a] - icsDayCodes[b])) {
              const candidate = addDays(weekStart, icsDayCodes[code]);
              candidate.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
              if (candidate < start) continue;
              if (until && candidate > until) break;
              if (count && dates.length >= count) break;
              pushDate(candidate);
              addedInWeek = true;
            }
            if (count && dates.length >= count) break;
            if (until && weekStart > until) break;
            if (!addedInWeek && until && addDays(weekStart, 7) > until) break;
          }
        } else {
          for (let index = 0; dates.length < limit; index += 1) {
            const date = new Date(start.getTime() + index * 7 * interval * 86400000);
            if (until && date > until) break;
            if (count && index >= count) break;
            pushDate(date);
          }
        }
      } else if (frequency === 'DAILY') {
        for (let index = 0; dates.length < limit; index += 1) {
          const date = new Date(start.getTime() + index * interval * 86400000);
          if (until && date > until) break;
          if (count && index >= count) break;
          pushDate(date);
        }
      }
    }
    for (const property of properties.RDATE || []) {
      for (const item of property.value.split(',')) pushDate(parseIcsDate(item));
    }
    for (const date of dates) {
      occurrences.push({
        date,
        startTime: allDay ? '全天' : formatTime(date),
        endTime: allDay ? '' : formatTime(new Date(date.getTime() + duration)),
        allDay,
        summary,
        location,
        description,
      });
    }
  }
  return occurrences;
}

function compactWeeks(weeks) {
  const list = [...new Set(weeks)].sort((a, b) => a - b);
  const parts = [];
  for (let index = 0; index < list.length;) {
    let end = index;
    while (end + 1 < list.length && list[end + 1] === list[end] + 1) end += 1;
    parts.push(index === end ? `第${list[index]}周` : `第${list[index]}-${list[end]}周`);
    index = end + 1;
  }
  return parts.join('、');
}
function eventsFromOccurrences(occurrences) {
  const grouped = new Map();
  for (const occurrence of occurrences) {
    const day = dayNames[(occurrence.date.getDay() + 6) % 7];
    const week = Math.round((startOfWeek(occurrence.date) - week1Date) / (7 * 86400000)) + 1;
    if (week < 1 || week > 60) continue;
    const periodMatch = occurrence.description.match(/节次：([^\n]+)/);
    const teacherMatch = occurrence.description.match(/教师：([^\n]+)/);
    let periods = periodMatch ? periodMatch[1].replace(/\s+\d{1,2}:\d{2}.*$/, '').trim() : '';
    if (occurrence.allDay) periods = '全天';
    const key = JSON.stringify([occurrence.summary, day, occurrence.startTime, occurrence.endTime, occurrence.location, periods, teacherMatch?.[1] || '']);
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `import-${grouped.size}`,
        title: occurrence.summary,
        code: '',
        section: '',
        day,
        periods,
        start: occurrence.startTime,
        end: occurrence.endTime,
        weeks: [],
        weekRule: '',
        teacher: teacherMatch?.[1] || '',
        location: occurrence.location,
        classes: '',
        description: occurrence.description,
      });
    }
    grouped.get(key).weeks.push(week);
  }
  return [...grouped.values()].map((event) => {
    event.weeks = [...new Set(event.weeks)].sort((a, b) => a - b);
    event.weekRule = compactWeeks(event.weeks);
    return event;
  });
}
function slotsFromEvents(events) {
  const slots = new Map();
  for (const event of events) {
    const key = `${event.start}|${event.end}`;
    if (!slots.has(key)) slots.set(key, { p: event.periods || '', s: event.start, e: event.end });
  }
  return [...slots.values()].sort((a, b) => String(a.s).localeCompare(String(b.s)));
}

function card(event) {
  const colorMap = {
    '机械制图及CAD': 'green',
    '通用英语基础（一）': 'yellow',
    '电工电子技术': 'red',
    '机电测控电工电子综合实训': 'cyan',
    '液压与气压传动': 'purple',
    '设计素描': 'green',
    '设计色彩': 'cyan',
    '大学英语': 'yellow',
    '构成艺术': 'purple',
    '体育（一）': 'red',
  };
  const className = colorMap[event.title] || '';
  const code = event.code
    ? `<div class="meta">${escapeHtml(event.code)}${event.section ? ` · ${escapeHtml(event.section)}班` : ''}</div>`
    : '';
  const period = `${event.periods ? `${escapeHtml(event.periods)} ` : ''}${escapeHtml(event.start)}${event.end ? `-${escapeHtml(event.end)}` : ''}`;
  const location = event.location ? `<div class="meta">${escapeHtml(event.location)}</div>` : '';
  const teacher = event.teacher ? `<div class="meta">${escapeHtml(event.teacher)}</div>` : '';
  return `<div class="card ${className}"><b>${escapeHtml(event.title)}</b>${code}<div class="meta">${period}</div>${location}${teacher}</div>`;
}
function renderWeekBar() {
  elements.weekbar.replaceChildren();
  for (let week = 1; week <= totalWeeks; week += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `第${week}周`;
    button.addEventListener('click', () => showWeek(week));
    if (week === currentWeek) button.classList.add('active');
    elements.weekbar.appendChild(button);
  }
}
function showWeek(week) {
  currentWeek = Math.max(1, Math.min(week, totalWeeks));
  [...elements.weekbar.children].forEach((button, index) => button.classList.toggle('active', index + 1 === currentWeek));
  const monday = addDays(week1Date, (currentWeek - 1) * 7);
  const sunday = addDays(monday, 6);
  elements.range.textContent = `第 ${currentWeek} 周 · ${formatDate(monday)} 至 ${formatDate(sunday)}`;
  elements.parity.textContent = currentWeek % 2 ? '单周' : '双周';
  elements.parity.className = `parity ${currentWeek % 2 ? '' : 'even'}`;
  const slots = slotsFromEvents(currentEvents);
  elements.grid.innerHTML = '<div class="cell head">节次</div>' + dayNames.map((day, index) =>
    `<div class="cell head">${day}<br><span style="font-weight:400;color:#738096">${formatDate(addDays(monday, index))}</span></div>`
  ).join('');
  if (!slots.length) {
    elements.grid.insertAdjacentHTML('beforeend', '<div class="cell time">暂无课程</div><div class="cell" style="grid-column:span 7;min-height:160px"></div>');
    return;
  }
  for (const slot of slots) {
    elements.grid.insertAdjacentHTML('beforeend', `<div class="cell time"><b>${escapeHtml(slot.p || '课程')}</b><span>${escapeHtml(slot.s)}${slot.e ? `<br>${escapeHtml(slot.e)}` : ''}</span></div>`);
    for (const day of dayNames) {
      const list = currentEvents.filter((event) => event.day === day && event.start === slot.s && event.end === slot.e && event.weeks.includes(currentWeek));
      elements.grid.insertAdjacentHTML('beforeend', `<div class="cell">${list.length ? list.map(card).join('') : '<div class="empty">无课</div>'}</div>`);
    }
  }
}
function applyEvents(events, statusText, statusType = '') {
  currentEvents = events;
  currentWeek = 1;
  totalWeeks = Math.max(18, ...events.flatMap((event) => event.weeks || []));
  renderWeekBar();
  showWeek(1);
  elements.status.textContent = statusText;
  elements.status.className = `import-status ${statusType}`;
}

async function importIcs(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    elements.status.textContent = 'ICS 文件过大，请控制在 8 MB 以内';
    elements.status.className = 'import-status error';
    return;
  }
  try {
    const occurrences = parseIcsOccurrences(await file.text());
    if (!occurrences.length) throw new Error('没有在文件中找到可显示的日程');
    parsedOccurrences = occurrences;
    if (importedDownloadUrl) URL.revokeObjectURL(importedDownloadUrl);
    importedDownloadUrl = URL.createObjectURL(file);
    elements.downloadLink.href = importedDownloadUrl;
    elements.downloadLink.download = file.name;
    applyEvents(eventsFromOccurrences(occurrences), `已载入 ${file.name}，共 ${occurrences.length} 条日程`, 'ok');
  } catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : 'ICS 读取失败';
    elements.status.className = 'import-status error';
  }
}
function resetPreview() {
  parsedOccurrences = [];
  if (importedDownloadUrl) URL.revokeObjectURL(importedDownloadUrl);
  importedDownloadUrl = '';
  elements.downloadLink.href = './files/2026-marketing-class1.ics';
  elements.downloadLink.download = '';
  elements.week1Input.value = '2026-08-31';
  week1Date = parseInputDate(elements.week1Input.value);
  applyEvents(previewEvents.map((event) => ({ ...event })), '当前显示内置示例');
}
elements.dropZone.addEventListener('click', () => elements.fileInput.click());
elements.dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    elements.fileInput.click();
  }
});
elements.chooseButton.addEventListener('click', (event) => {
  event.stopPropagation();
  elements.fileInput.click();
});
elements.fileInput.addEventListener('change', () => importIcs(elements.fileInput.files?.[0]));
for (const name of ['dragenter', 'dragover']) {
  elements.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('dragover');
  });
}
for (const name of ['dragleave', 'drop']) {
  elements.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('dragover');
  });
}
elements.dropZone.addEventListener('drop', (event) => importIcs(event.dataTransfer?.files?.[0]));
elements.resetButton.addEventListener('click', resetPreview);
elements.week1Input.addEventListener('change', () => {
  week1Date = parseInputDate(elements.week1Input.value);
  if (parsedOccurrences.length) {
    applyEvents(eventsFromOccurrences(parsedOccurrences), elements.status.textContent, 'ok');
  } else {
    applyEvents(previewEvents.map((event) => ({ ...event })), '当前显示内置示例');
  }
});
applyEvents(currentEvents, '当前显示内置示例');
