  /* =======================
     Misc helpers
  ======================= */
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  // 【7】吹き出しはマウスを少し止めてから表示し、カーソルから離して出す（周りのコマを隠しにくく）。
  //   クリック（選択）したらすぐ消す（詳細はプロパティ欄に出るため）。
  let _hoverTipTimer = null, _hoverTipPending = null;
  function showHoverTip(text, x, y) {
    const tip = document.getElementById('hover-tip');
    if (!tip) return;
    if (tip.style.display !== 'block' || tip.textContent !== text) {
      _hoverTipPending = { text, x, y };
      if (tip.style.display === 'block') tip.style.display = 'none';
      clearTimeout(_hoverTipTimer);
      _hoverTipTimer = setTimeout(() => {
        const pnd = _hoverTipPending; _hoverTipPending = null;
        if (pnd) _placeHoverTip(tip, pnd.text, pnd.x, pnd.y);
      }, 450);
      return;
    }
    _placeHoverTip(tip, text, x, y);
  }
  document.addEventListener('mousemove', (ev) => { if (_hoverTipPending) { _hoverTipPending.x = ev.clientX; _hoverTipPending.y = ev.clientY; } }, true);
  document.addEventListener('mousedown', () => hideHoverTip(), true);
  function _placeHoverTip(tip, text, x, y) {
    tip.textContent = text;
    tip.style.display = 'block';
    const pad = 22;
    const vw = window.innerWidth, vh = window.innerHeight;

    // measure after display
    const rect = tip.getBoundingClientRect();
    const w = rect.width || 320;
    const h = rect.height || 120;

    const left = Math.min(x + pad, vw - w - 10);
    const top = Math.min(y + pad, vh - h - 10);
    tip.style.left = Math.max(6, left) + 'px';
    tip.style.top = Math.max(6, top) + 'px';
  }
  function hideHoverTip() {
    clearTimeout(_hoverTipTimer); _hoverTipPending = null;
    const tip = document.getElementById('hover-tip');
    if (tip) tip.style.display = 'none';
  }
  function itemDetailText(id) {
    const it = state.items[id];
    const plc = state.placements[id];
    if (!it) return '';
    const scfg = state.subjectCfg[it.subjKey] || {};
    const abbr = scfg.abbr || it.subj || '';
    const cls = it.cls.join(',') || '(未)';
    const teas = it.teas.join(',') || '(未)';
    const rooms = it.rooms.join(',') || '(未)';
    const when = plc ? (`${DAYJP[plc.day]}${plc.period}` + ((it.span || 1) >= 2 ? `〜${plc.period + it.span - 1}` : '')) : '(未配置)';
    const lock = (plc && plc.locked) ? '🔒ロック' : '';
    const span = (it.span || 1) >= 2 ? `${it.span}連` : '1コマ';
    // コマ上のマークを廃止した分、種別（合同/同時展開/並列/違反）はホバー説明で示す
    const kinds = [];
    if ((it.cls || []).length > 1) kinds.push('合同授業');
    if (it.simul) kinds.push('同時展開' + (it.realSubj ? '（' + it.realSubj + '）' : ''));
    if (it.parallel) kinds.push('並列');
    let vio = ''; try { vio = violationSummary(id) || ''; } catch (e) { }
    return `科目: ${abbr} (${it.subj})\nクラス: ${cls}\n教員: ${teas}\n教室: ${rooms}\n時刻: ${when}\n${span} ${lock}` +
      (kinds.length ? `\n連動: ${kinds.join('・')}` : '') + (vio ? `\n⚠ ${vio}` : '');
  }
  function hexWithAlpha(hex, a) {
    const m = hex.replace('#', '');
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /* =======================
     CSV import / export
  ======================= */
  async function readFileText(file, enc) {
    const buf = await file.arrayBuffer();
    if (enc === 'utf-8') {
      return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }
    if (enc === 'shift-jis') {
      return new TextDecoder('shift-jis', { fatal: false }).decode(buf);
    }
    // auto: try utf-8 then shift-jis
    let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    // if too many replacement chars, fallback
    const rep = (t.match(/\uFFFD/g) || []).length;
    if (rep > 5) {
      try { t = new TextDecoder('shift-jis', { fatal: false }).decode(buf); } catch (e) { }
    }
    return t;
  }
  function parseCSV(text) {
    // basic CSV parser for quoted fields
    const rows = [];
    let i = 0, field = '', row = [], inQ = false;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { rows.push(row); row = []; };
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
        if (c === '"') { inQ = false; i++; continue; }
        field += c; i++; continue;
      } else {
        if (c === '"') { inQ = true; i++; continue; }
        if (c === ',') { pushField(); i++; continue; }
        if (c === '\r') { i++; continue; }
        if (c === '\n') { pushField(); pushRow(); i++; continue; }
        field += c; i++; continue;
      }
    }
    pushField(); pushRow();
    // remove last empty row
    if (rows.length && rows[rows.length - 1].every(x => x === '')) rows.pop();
    return rows;
  }
  function importCSVText(text) {
    const rows = parseCSV(text);
    if (!rows.length) return;
    const header = rows[0].map(h => h.trim());
    const hasHeader = header.includes('クラス') || header.includes('科目');
    const start = hasHeader ? 1 : 0;
    const idx = (name) => header.indexOf(name);
    const get = (arr, i) => (i >= 0 && i < arr.length) ? arr[i] : '';
    // 【C-5】見出しがある列は、その見出し位置の値だけを使う（空欄でも別列の値を拾わない）。
    // 見出しが無い(位置指定)ファイルのみ、既定の列位置(0〜8)を使う。
    const col = (a, name, pos) => {
      const i = idx(name);
      if (i >= 0) return get(a, i);          // 見出しあり → その列のみ
      return hasHeader ? '' : get(a, pos);   // 見出しはあるがこの列名が無い場合は空。無ければ位置で取得
    };
    pushHistory('csvImport');
    for (let r = start; r < rows.length; r++) {
      const a = rows[r];
      const row = {
        _id: null,
        cls: col(a, 'クラス', 0),
        subj: col(a, '科目', 1),
        subjAbbr: col(a, '科目略', 2),
        dept: col(a, '教科', 3),
        tea: col(a, '教員', 4),
        teaAbbr: col(a, '教員略', 5),
        room: col(a, '教室', 6),
        count: parseInt(col(a, 'コマ数', 7) || '1', 10) || 1,
        dbl: (() => { const v = String(col(a, '2連', 8) || '').trim().toLowerCase(); return v === '1' || v === 'true'; })()
      };
      ensureRowId(row);
      state.rawRows.push(row);
    }
    markDirty('csvImport');
    rebuildMastersFromRaw();
    renderInputTable();
  }

  function exportCSV() {
    const header = ['クラス', '科目', '科目略', '教科', '教員', '教員略', '教室', 'コマ数', '2連'];
    const lines = [];
    lines.push(header.map(csvEscape).join(','));
    for (const r of state.rawRows) {
      lines.push([
        r.cls || '', r.subj || '', r.subjAbbr || '', r.dept || '',
        r.tea || '', r.teaAbbr || '', r.room || '',
        r.count || 1, r.dbl ? 1 : 0
      ].map(csvEscape).join(','));
    }
    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'timetable_stock.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }


  function exportTeacherMatrixCSV() {
    // rows: teachers, cols: Mon1..FriN (N=max(6, max periods))
    const idx = buildIndex();
    const teachers = getAxisKeys('teacher'); // respects sort settings
    const maxP = Math.max(6, ...DAYS.map(d => maxPeriod(d)));
    const header = ['教員'];
    for (const d of DAYS) {
      for (let p = 1; p <= maxP; p++) {
        header.push(`${DAYJP[d]}${p}`);
      }
    }
    const lines = [];
    lines.push(header.map(csvEscape).join(','));
    for (const t of teachers) {
      const row = [t];
      for (const d of DAYS) {
        for (let p = 1; p <= maxP; p++) {
          if (p > maxPeriod(d)) { row.push(''); continue; }
          const ids = idsInCellForRow('teacher', t, d, p, idx) || [];
          if (!ids.length) { row.push(''); continue; }
          const vals = [];
          for (const id of ids) {
            const it = state.items[id]; if (!it) continue;
            const scfg = state.subjectCfg[it.subjKey] || {};
            const abbr = (scfg.abbr || it.subj || it.subjKey || '').trim();
            const cls = (it.cls || []).join(',');
            const room = (it.rooms || []).join(',');
            let s = `${cls} ${abbr}`.trim();
            if (room) s += `@${room}`;
            vals.push(s);
          }
          row.push(vals.join(' | '));
        }
      }
      lines.push(row.map(csvEscape).join(','));
    }
    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'teachers_timetable_matrix.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function exportClassMatrixCSV() {
    const idx = buildIndex();
    const classes = getAxisKeys('class');
    const maxP = Math.max(6, ...DAYS.map(d => maxPeriod(d)));
    const header = ['クラス'];
    for (const d of DAYS) {
      for (let p = 1; p <= maxP; p++) {
        header.push(`${DAYJP[d]}${p}`);
      }
    }
    const lines = [];
    lines.push(header.map(csvEscape).join(','));
    for (const cls of classes) {
      const row = [cls];
      for (const d of DAYS) {
        for (let p = 1; p <= maxP; p++) {
          if (p > maxPeriod(d)) { row.push(''); continue; }
          const ids = idsInCellForRow('class', cls, d, p, idx) || [];
          if (!ids.length) { row.push(''); continue; }
          const vals = [];
          for (const id of ids) {
            const it = state.items[id]; if (!it) continue;
            const scfg = state.subjectCfg[it.subjKey] || {};
            const abbr = (scfg.abbr || it.subj || it.subjKey || '').trim();
            const tea = (it.teas || []).map(t => state.teacherCfg[t]?.abbr || t).join(',');
            let s = abbr;
            if (tea) s += `(${tea})`;
            vals.push(s);
          }
          row.push(vals.join(' | '));
        }
      }
      lines.push(row.map(csvEscape).join(','));
    }
    const bom = '﻿';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'classes_timetable_matrix.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }


  /* =======================
     XLSX export (teacher / class matrix)
     Format mirrors the school's 先生の授業時間割一覧 xlsx:
       Row 1: title
       Row 2: day headers (merged)
       Row 3: period numbers
       Per entity: 2 rows — row A = class names, row B = subject names
       Col A = entity name (merged A/B), Col B = homeroom/担当, Col C = role (merged)
  ======================= */
  function _xlsxDownload(wb, filename) {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function _buildXlsxMatrixSheet(axisType) {
    const idx = buildIndex();
    const maxP = Math.max(6, ...DAYS.map(d => maxPeriod(d)));
    const DAY_NAMES = { Mon: '月曜日', Tue: '火曜日', Wed: '水曜日', Thu: '木曜日', Fri: '金曜日' };

    // 教科順ソート（教員のみ）
    const DEPT_ORDER = ['国語','地歴公民','数学','情報','理科','保健体育','芸術','外国語','家庭科'];
    let keys;
    if (axisType === 'teacher') {
      const set = new Set();
      for (const it of Object.values(state.items)) {
        (it.teas && it.teas.length ? it.teas : ['(未)']).forEach(t => set.add(t));
      }
      keys = Array.from(set).sort((a, b) => {
        // 画面の「教科順」と同じ順番（国語→地歴→公民→数学→情報→理科→保健体育→芸術→外国語→家庭）
        const ra = teacherDeptRank(a), rb = teacherDeptRank(b);
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, 'ja');
      });
    } else {
      keys = getAxisKeys(axisType);
    }

    const LEAD = 3; // A=name, B=homeroom, C=role
    const totalCols = LEAD + DAYS.length * maxP;
    const dataStartRow = 3; // rows 0=title,1=day,2=period

    // ボーダーオブジェクトは毎回新規生成（共有参照によるxlsx-js-style内部mutation回避）
    const T = () => ({ style: 'thin', color: { rgb: '000000' } });
    const H = () => ({ style: 'hair', color: { rgb: '000000' } });

    const bdr = (t, b, l, r) => {
      const o = {};
      if (t) o.top = t; if (b) o.bottom = b;
      if (l) o.left = l; if (r) o.right = r;
      return o;
    };

    // セルスタイル適用（空セルは t:'s' で確実に書き込み）
    const setS = (ws, r, c, s) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = s;
    };

    // 曜日境界=thin、時限間=hair（毎回新規オブジェクト）
    const slotL = (sc) => sc % maxP === 0 ? T() : H();
    const slotR = (sc) => sc % maxP === maxP - 1 ? T() : H();

    // ── AOA ──
    const aoa = [];
    const titleRow = Array(totalCols).fill(null);
    titleRow[0] = axisType === 'teacher' ? '＜先生の授業時間割一覧＞' : '＜クラス時間割一覧＞';
    aoa.push(titleRow);

    const dayRow = Array(totalCols).fill(null);
    let col = LEAD;
    for (const d of DAYS) { dayRow[col] = DAY_NAMES[d]; col += maxP; }
    aoa.push(dayRow);

    const pRow = Array(totalCols).fill(null);
    col = LEAD;
    for (const d of DAYS) { for (let p = 1; p <= maxP; p++) pRow[col++] = p; }
    aoa.push(pRow);

    for (const key of keys) {
      const rowA = Array(totalCols).fill(null);
      const rowB = Array(totalCols).fill(null);
      rowA[0] = key;
      if (axisType === 'teacher') {
        const hrItem = Object.values(state.items).find(it =>
          (it.teas || []).includes(key) && (it.subj || '').includes('HR'));
        rowA[1] = hrItem ? (hrItem.cls || [])[0] || '' : '';
        rowB[1] = '担';
        rowA[2] = (state.teacherCfg[key] || {}).role || '';
      } else {
        rowA[1] = key; rowB[1] = '担'; rowA[2] = '';
      }
      col = LEAD;
      for (const d of DAYS) {
        for (let p = 1; p <= maxP; p++) {
          if (p <= maxPeriod(d)) {
            const ids = idsInCellForRow(axisType, key, d, p, idx) || [];
            if (ids.length) {
              const it = state.items[ids[0]];
              if (it) {
                const scfg = state.subjectCfg[it.subjKey] || {};
                const abbr = (scfg.abbr || it.subj || it.subjKey || '').trim();
                if (axisType === 'teacher') {
                  rowA[col] = (it.cls || []).join(',') || '';
                  rowB[col] = abbr;
                } else {
                  rowA[col] = abbr;
                  rowB[col] = (it.teas || []).map(t => state.teacherCfg[t]?.abbr || t).join(',');
                }
              }
            }
          }
          col++;
        }
      }
      aoa.push(rowA);
      aoa.push(rowB);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // ── マージ ──
    // 曜日ヘッダー行のマージはxlsx-js-styleの列オフセットバグで正常に動作しないため使用しない。
    // 名前・役割列（col 0, 2）の2行マージと、lead block（rows 1-2, cols 0-2）のみ設定する。
    const merges = [];
    merges.push({ s: { r: 1, c: 0 }, e: { r: 2, c: 2 } }); // lead block rows1-2, cols0-2
    for (let i = 0; i < keys.length; i++) {
      const r = dataStartRow + i * 2;
      merges.push({ s: { r, c: 0 }, e: { r: r + 1, c: 0 } }); // 名前列 2行マージ
      merges.push({ s: { r, c: 2 }, e: { r: r + 1, c: 2 } }); // 役割列 2行マージ
    }
    ws['!merges'] = merges;

    // 列幅: 4.80 wch = 55px相当（参考Excel準拠）
    const CW = 4.80;
    ws['!cols'] = Array(totalCols).fill(null).map(() => ({ wch: CW }));

    // 行高さ: 16.5pt = 22px相当
    const RH = 16.5;
    const rows = [];
    rows[0] = { hpt: RH };
    rows[1] = { hpt: RH };
    rows[2] = { hpt: RH };
    for (let i = 0; i < keys.length; i++) {
      rows[dataStartRow + i * 2]     = { hpt: RH };
      rows[dataStartRow + i * 2 + 1] = { hpt: RH };
    }
    ws['!rows'] = rows;

    // ── スタイル: 全セルに4辺の罫線を必ず設定 ──
    const ctr = { horizontal: 'center', vertical: 'center' };
    const ctrW = { horizontal: 'center', vertical: 'center', wrapText: true };
    const sz10 = { sz: 10 };

    // Row 0: タイトル（罫線なし）
    setS(ws, 0, 0, { font: { sz: 11 }, alignment: { vertical: 'center' } });

    // Rows 1-2: ヘッダー lead 3列（マージ範囲内の全セルにも罫線を設定）
    setS(ws, 1, 0, { border: bdr(T(),T(),T(),T()), alignment: ctr, font: sz10 });
    setS(ws, 2, 0, { border: bdr(T(),T(),T(),T()), alignment: ctr, font: sz10 });
    setS(ws, 1, 1, { border: bdr(T(),T(),H(),H()), alignment: ctr, font: sz10 });
    setS(ws, 2, 1, { border: bdr(T(),T(),H(),H()), alignment: ctr, font: sz10 });
    setS(ws, 1, 2, { border: bdr(T(),T(),H(),T()), alignment: ctr, font: sz10 });
    setS(ws, 2, 2, { border: bdr(T(),T(),H(),T()), alignment: ctr, font: sz10 });

    // row1-2 スロット列（マージ内部セルを含む全セルに罫線）
    for (let sc = 0; sc < DAYS.length * maxP; sc++) {
      setS(ws, 1, LEAD + sc, { border: bdr(T(),T(),slotL(sc),slotR(sc)), alignment: ctr, font: sz10 });
      setS(ws, 2, LEAD + sc, { border: bdr(T(),T(),slotL(sc),slotR(sc)), alignment: ctr, font: sz10 });
    }

    // エンティティ行
    for (let i = 0; i < keys.length; i++) {
      const rA = dataStartRow + i * 2;
      const rB = rA + 1;

      // Col A: 2行マージ
      setS(ws, rA, 0, { border: bdr(T(),T(),T(),H()), alignment: ctrW, font: sz10 });
      setS(ws, rB, 0, { border: bdr(T(),T(),T(),H()), alignment: ctrW, font: sz10 });

      // Col B
      setS(ws, rA, 1, { border: bdr(T(),H(),H(),H()), alignment: ctr, font: sz10 });
      setS(ws, rB, 1, { border: bdr(H(),T(),H(),H()), alignment: ctr, font: sz10 });

      // Col C: 2行マージ
      setS(ws, rA, 2, { border: bdr(T(),T(),H(),T()), alignment: ctr, font: sz10 });
      setS(ws, rB, 2, { border: bdr(T(),T(),H(),T()), alignment: ctr, font: sz10 });

      // スロット列: rA=上半分(top=thin,bot=hair), rB=下半分(top=hair,bot=thin)
      for (let sc = 0; sc < DAYS.length * maxP; sc++) {
        setS(ws, rA, LEAD + sc, { border: bdr(T(),H(),slotL(sc),slotR(sc)), alignment: ctrW, font: sz10 });
        setS(ws, rB, LEAD + sc, { border: bdr(H(),T(),slotL(sc),slotR(sc)), alignment: ctrW, font: sz10 });
      }
    }

    return ws;
  }

  function _ensureXLSX(cb) {
    if (typeof XLSX !== 'undefined') { cb(); return; }
    // 動的ロード: xlsx.min.js が未読込の場合にスクリプトを挿入して待つ
    const s = document.createElement('script');
    s.src = 'xlsx.min.js';
    s.onload = () => { if (typeof XLSX !== 'undefined') { cb(); } else { alert('xlsx.min.js の読み込みに失敗しました。ファイルが存在するか確認してください。'); } };
    s.onerror = () => alert('xlsx.min.js が見つかりません。リポジトリに xlsx.min.js が含まれているか確認してください。');
    document.head.appendChild(s);
  }

  function exportTeacherMatrixXLSX() {
    _ensureXLSX(() => {
      const wb = XLSX.utils.book_new();
      const ws = _buildXlsxMatrixSheet('teacher');
      XLSX.utils.book_append_sheet(wb, ws, '教員時間割');
      _xlsxDownload(wb, 'teachers_timetable.xlsx');
    });
  }

  function exportClassMatrixXLSX() {
    _ensureXLSX(() => {
      const wb = XLSX.utils.book_new();
      const ws = _buildXlsxMatrixSheet('class');
      XLSX.utils.book_append_sheet(wb, ws, 'クラス時間割');
      _xlsxDownload(wb, 'classes_timetable.xlsx');
    });
  }

  function _buildEntityTimetableSheet(kind, key, idx) {
    const adays = DAYS.filter(d => maxPeriod(d) > 0);
    const maxP = Math.max(...adays.map(d => maxPeriod(d)));

    const T = () => ({ style: 'thin', color: { rgb: '000000' } });
    const H = () => ({ style: 'hair', color: { rgb: '000000' } });
    const bdr = (t, b, l, r) => { const o = {}; if(t) o.top=t; if(b) o.bottom=b; if(l) o.left=l; if(r) o.right=r; return o; };
    const setS = (ws, r, c, s) => { const addr = XLSX.utils.encode_cell({r, c}); if(!ws[addr]) ws[addr] = {t:'s',v:''}; ws[addr].s = s; };
    const ctr = { horizontal: 'center', vertical: 'center', wrapText: true };
    const sz9 = { sz: 9 };

    const aoa = [];
    // Row 0: title
    const titleRow = Array(1 + adays.length).fill(null);
    titleRow[0] = key;
    aoa.push(titleRow);
    // Row 1: day headers
    const dayRow = Array(1 + adays.length).fill(null);
    dayRow[0] = '時限';
    adays.forEach((d, i) => { dayRow[1 + i] = {Mon:'月',Tue:'火',Wed:'水',Thu:'木',Fri:'金',Sat:'土',Sun:'日'}[d] || d; });
    aoa.push(dayRow);
    // Data rows
    for (let p = 1; p <= maxP; p++) {
      const rowA = Array(1 + adays.length).fill(null);
      const rowB = Array(1 + adays.length).fill(null);
      rowA[0] = p;
      adays.forEach((d, di) => {
        if (p > maxPeriod(d)) return;
        const ids = (kind === 'class'
          ? (idx.cls?.[key]?.[d]?.[p] || [])
          : (idx.tea?.[key]?.[d]?.[p] || [])
        ); // 【4】2連の2コマ目も出力（従来は空欄）
        if (!ids.length) return;
        const it = state.items[ids[0]];
        if (!it) return;
        const scfg = state.subjectCfg[it.subjKey] || {};
        const subjAbbr = scfg.abbr || it.subj || '';
        if (kind === 'class') {
          rowA[1 + di] = subjAbbr;
          rowB[1 + di] = it.teas.map(t => state.teacherCfg[t]?.abbr || t).join(',') + (it.rooms.length ? ' ' + it.rooms.join(',') : '');
        } else {
          rowA[1 + di] = (it.cls || []).join(',');
          rowB[1 + di] = subjAbbr + (it.rooms.length ? ' ' + it.rooms.join(',') : '');
        }
      });
      aoa.push(rowA);
      aoa.push(rowB);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const totalCols = 1 + adays.length;

    ws['!cols'] = [{ wch: 5 }, ...adays.map(() => ({ wch: 10 }))];
    ws['!rows'] = aoa.map(() => ({ hpt: 14 }));

    const merges = [];
    for (let p = 0; p < maxP; p++) {
      const r = 2 + p * 2;
      merges.push({ s: {r, c: 0}, e: {r: r+1, c: 0} });
    }
    ws['!merges'] = merges;

    setS(ws, 0, 0, { font: { sz: 11, bold: true }, alignment: { vertical: 'center' } });
    for (let c = 0; c < totalCols; c++) {
      setS(ws, 1, c, { border: bdr(T(),T(),T(),T()), alignment: ctr, font: { ...sz9, bold: true } });
    }
    for (let p = 0; p < maxP; p++) {
      const rA = 2 + p * 2, rB = rA + 1;
      setS(ws, rA, 0, { border: bdr(T(),T(),T(),T()), alignment: ctr, font: sz9 });
      setS(ws, rB, 0, { border: bdr(T(),T(),T(),T()), alignment: ctr, font: sz9 });
      for (let di = 0; di < adays.length; di++) {
        const c = 1 + di;
        setS(ws, rA, c, { border: bdr(T(),H(),T(),T()), alignment: ctr, font: sz9 });
        setS(ws, rB, c, { border: bdr(H(),T(),T(),T()), alignment: ctr, font: sz9 });
      }
    }

    return ws;
  }

  // Excelのシート名は31文字以内・:\/?*[]禁止・重複不可。安全名を採番して返す
  function _uniqueSheetName(rawKey, used) {
    let base = String(rawKey || '').replace(/[:\\\/\?\*\[\]]/g, '').slice(0, 31) || 'Sheet';
    let name = base, n = 2;
    while (used.has(name)) {
      const suffix = '_' + n++;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name);
    return name;
  }

  function exportClassSheetsXLSX() {
    _ensureXLSX(() => {
      const idx = buildIndex();
      const keys = getAxisKeys('class');
      if (!keys.length) { flash('クラスがありません'); return; }
      const wb = XLSX.utils.book_new();
      const used = new Set();
      for (const key of keys) {
        const ws = _buildEntityTimetableSheet('class', key, idx);
        XLSX.utils.book_append_sheet(wb, ws, _uniqueSheetName(key, used));
      }
      _xlsxDownload(wb, 'classes_sheets.xlsx');
      flash(`📊 クラス別シートXLSX（${keys.length}クラス）を出力しました`);
    });
  }

  function exportTeacherSheetsXLSX() {
    _ensureXLSX(() => {
      const idx = buildIndex();
      const keys = getAxisKeys('teacher');
      if (!keys.length) { flash('教員がありません'); return; }
      const wb = XLSX.utils.book_new();
      const used = new Set();
      for (const key of keys) {
        const ws = _buildEntityTimetableSheet('teacher', key, idx);
        XLSX.utils.book_append_sheet(wb, ws, _uniqueSheetName(key, used));
      }
      _xlsxDownload(wb, 'teachers_sheets.xlsx');
      flash(`📊 教員別シートXLSX（${keys.length}名）を出力しました`);
    });
  }

  /* =======================
     Snapshots
  ======================= */
  function renderSnapshotList() {
    const sel = $('#snap-list'); if (!sel) return;
    sel.innerHTML = '';
    for (const s of state.snapshots) {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = `${s.name} (${new Date(s.savedAt).toLocaleString('ja-JP')})`;
      sel.appendChild(opt);
    }
  }
  function saveSnapshot(name) {
    name = (name || '').trim() || `Snapshot ${state.snapshots.length + 1}`;
    pushHistory('snapSave');
    const data = { placements: deepClone(state.placements) };
    const snap = { name, savedAt: now(), data };
    // overwrite if same name
    const i = state.snapshots.findIndex(x => x.name === name);
    if (i >= 0) state.snapshots[i] = snap; else state.snapshots.push(snap);
    markDirty('snapshot');
    renderSnapshotList();
    flash('保存しました');
  }
  function loadSnapshot(name) {
    const snap = state.snapshots.find(x => x.name === name);
    if (!snap) { flash('見つかりません'); return; }
    pushHistory('snapLoad');
    state.placements = deepClone(snap.data.placements);
    // restore locked flags if missing
    for (const id in state.items) {
      if (!state.placements[id]) state.placements[id] = null;
      if (state.placements[id] && state.placements[id].locked == null) state.placements[id].locked = false;
    }
    state.ui.selectedId = null;
    sanitizeState('スナップショット復元');
    markDirty('snapshot');
    rerenderAll();
    broadcastState();
  }
  function deleteSnapshot(name) {
    pushHistory('snapDel');
    state.snapshots = state.snapshots.filter(x => x.name !== name);
    markDirty('snapshot');
    renderSnapshotList();
  }

  /* v47-B4: スナップショット差分表示 */
  let _snapDiffActive = false;
  let _snapDiffData = null; // {name, placements}

  function showSnapDiff(name) {
    const snap = state.snapshots.find(x => x.name === name);
    if (!snap) { flash('スナップが見つかりません'); return; }
    _snapDiffActive = true;
    _snapDiffData = { name, placements: snap.data.placements };
    const banner = document.getElementById('snap-diff-banner');
    const label = document.getElementById('snap-diff-label');
    if (banner) banner.style.display = 'flex';
    if (label) label.textContent = `差分表示中: 「${name}」との比較 — 青:移動後 橙:移動元(スナップ時)`;
    rerenderAll();
    flash(`「${name}」との差分をグリッドにハイライト`);
  }

  function hideSnapDiff() {
    _snapDiffActive = false;
    _snapDiffData = null;
    const banner = document.getElementById('snap-diff-banner');
    if (banner) banner.style.display = 'none';
    rerenderAll();
  }

  // v48: スナップ差分テキストレポート生成
  function showSnapDiffReport() {
    if (!_snapDiffData) { flash('差分表示モードで実行してください'); return; }
    const oldPlc = _snapDiffData.placements;
    const newPlc = state.placements;
    const allIds = new Set([...Object.keys(oldPlc), ...Object.keys(newPlc)]);

    const lines = [];
    const added = [], removed = [], moved = [], unchanged = [];

    for (const id of allIds) {
      const it = state.items[id]; if (!it) continue;
      const scfg = state.subjectCfg[it.subjKey] || {};
      const name = `「${scfg.abbr || it.subj}」${it.cls.join(',')}`;
      const cur = newPlc[id];
      const old2 = oldPlc[id];
      const curStr = cur?.day ? `${DAYJP[cur.day]}${cur.period}${it.span === 2 ? `-${cur.period + 1}` : ''}` : null;
      const oldStr = old2?.day ? `${DAYJP[old2.day]}${old2.period}${it.span === 2 ? `-${old2.period + 1}` : ''}` : null;
      if (curStr === oldStr) continue;
      if (curStr && !oldStr) added.push(`  + ${name}  →  ${curStr} に新規配置`);
      else if (!curStr && oldStr) removed.push(`  - ${name}  ${oldStr} → 在庫に戻す`);
      else moved.push(`  ↔ ${name}  ${oldStr} → ${curStr}`);
    }

    if (!added.length && !removed.length && !moved.length) {
      showModal('差分なし', `「${_snapDiffData.name}」と現在の配置に変化はありません。`);
      return;
    }

    lines.push(`=== 差分レポート: 「${_snapDiffData.name}」との比較 ===`);
    lines.push(`作成日時: ${new Date().toLocaleString('ja-JP')}`);
    lines.push('');
    if (moved.length) { lines.push(`【移動】 ${moved.length}件`); lines.push(...moved); lines.push(''); }
    if (added.length) { lines.push(`【新規配置】 ${added.length}件`); lines.push(...added); lines.push(''); }
    if (removed.length) { lines.push(`【在庫戻し】 ${removed.length}件`); lines.push(...removed); lines.push(''); }
    lines.push(`合計変更: ${moved.length + added.length + removed.length}件`);

    const text = lines.join('\n');
    const html = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="muted small">変更: 移動${moved.length}件 / 新規${added.length}件 / 在庫戻し${removed.length}件</div>
      <textarea style="width:100%;height:300px;font-family:monospace;font-size:12px;border:1px solid #e2e8f0;border-radius:8px;padding:8px" readonly>${escapeHtml(text)}</textarea>
      <button class="btn secondary" onclick="this.previousElementSibling.select();document.execCommand('copy');this.textContent='✅ コピーしました'">📋 クリップボードにコピー</button>
    </div>`;
    showModalHTML('📋 差分レポート', html, null, '閉じる', '閉じる');
  }

  // 差分情報を取得（レンダリング時に参照）
  function getSnapDiffForId(id) {
    if (!_snapDiffActive || !_snapDiffData) return null;
    const cur = state.placements[id];
    const old = _snapDiffData.placements[id];
    const curStr = cur?.day ? `${cur.day}-${cur.period}` : null;
    const oldStr = old?.day ? `${old.day}-${old.period}` : null;
    if (curStr === oldStr) return null; // 変化なし
    if (curStr && !oldStr) return 'diff-added';      // 新しく配置された
    if (!curStr && oldStr) return 'diff-removed';    // 在庫に戻った
    return 'diff-moved';                            // 別の場所に移動
  }

