  /* =======================
     イデアのAI時間割 ネイティブ .ide エクスポート（マスタデータ）
  ======================= */
  function exportIdeaFile() {
    const schoolName = prompt('学校名を入力', state.settings.schoolName || '');
    if (schoolName === null) return;

    const now2 = new Date();
    const dateStr = now2.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');
    const timeStr = now2.toTimeString().slice(0, 8);

    // 曜日・時限設定
    const DAY_JA = { Mon: '月曜日', Tue: '火曜日', Wed: '水曜日', Thu: '木曜日', Fri: '金曜日', Sat: '土曜日', Sun: '日曜日' };
    const activeDays = DAYS.filter(d => (state.settings.periodsByDay[d] || 0) > 0);
    const numDays = activeDays.length || 5;
    const numPeriods = Math.max(...activeDays.map(d => state.settings.periodsByDay[d] || 6), 6);
    // 【A-5】曜日ごとの実時限数を可用性ブロックに反映（readerは '01' ペア数=時限数と解釈）
    const perDayPeriods = activeDays.map(d => state.settings.periodsByDay[d] || numPeriods);
    const availBlock = (pd) => '00' + '01'.repeat(Math.max(0, pd)); // '00'ヘッダ + pd個の'01'

    // 可用性ビット列（全コマ利用可能）
    // フォーマット: 各日 numPeriods+1 ビット（先頭0 + 各コマ1）を16ビット幅で表現
    function availBits(allAvail) {
      // "0001010101010101" style: 3 leading 0s, then pairs "10" per period
      const bits = '000' + '10'.repeat(numPeriods <= 7 ? numPeriods : 7);
      const padded = bits.padEnd(16, '0').slice(0, 16);
      return allAvail ? padded : '0'.repeat(16);
    }
    const AVAIL_DAY = availBits(true);
    const AVAIL_NONE = availBits(false);
    const avail5 = Array(5).fill(AVAIL_DAY).join('-');
    const avail5full = avail5 + '-CJ' + '0001010101010101'.repeat(1) + '010000000000000000';

    // 行ビルダ
    const lines = [];
    const L = (...parts) => lines.push(parts.map(p => typeof p === 'string' && p !== '0' ? `"${p}"` : String(p)).join(','));
    const R = (raw) => lines.push(raw);  // raw line (no quoting)

    // ── バージョン行 ──
    R(`2000,0,0,"${dateStr}","${timeStr}",0`);

    // ── HEAD ──
    const PAD14 = (arr, n) => { const a = arr.slice(); while (a.length < n) a.push('""'); return a.join(','); };
    R('"HEAD:",0');
    R(`0,0,1,0,0,0,"${schoolName}"`);
    R(`"${schoolName || '時間割'}",4`);
    const dayFields = activeDays.map(d => `"${DAY_JA[d] || d}"`);
    R(`${numDays},${PAD14(dayFields, 14)}`);
    const periodFields = ['１','２','３','４','５','６','７','８'].slice(0, numPeriods).map(n => `"${n}"`);
    R(`${numPeriods},${PAD14(periodFields, 15)}`);
    R(`"${perDayPeriods.map(availBlock).join('-')}-CJ0001010101010101010000000000000000"`);

    // ── OPTION ──
    R('"OPTION:",0');
    R('1');
    R('0,0,0,0');
    R('0,0,0,0');
    R('18,0,1,4,4,1,0');
    R(`-5,1,0,"${'0'.repeat(16)}-${'0'.repeat(16)}-${'0'.repeat(16)}-${'0'.repeat(16)}-${'0'.repeat(16)}-CJ${'0'.repeat(34)}","10","0"`);

    // 【A-5】クラス/教室のマスタをitemから収集し、ID対応表を作る
    const classSet = new Set(), roomSet = new Set();
    for (const it of Object.values(state.items)) {
      (it.cls || []).forEach(c => c && classSet.add(c));
      (it.rooms || []).forEach(r => r && roomSet.add(r));
    }
    const classList = Array.from(classSet).sort((a, b) => a.localeCompare(b, 'ja'));
    const classIdOf = new Map(classList.map((c, i) => [c, i + 1]));
    const dayNumOf = (d) => activeDays.indexOf(d) + 1; // activeDays順の1始まり曜日番号
    const availFull = Array(numDays).fill(AVAIL_DAY).join('-'); // 全コマ利用可

    // ── CLASS ──
    R(`"CLASS:",${classList.length}`);
    R('0,"","","","　　高　　　"');
    R('0,1,"","",""');
    R(`0,"${avail5}-CJ${'0'.repeat(34)}"`);
    classList.forEach((cls, i) => {
      const id = i + 1;
      const short = cls.replace(/-/, '−');
      const grade = cls.match(/^(\d)/) ? cls[0] + '年' : '';
      R(`${id},"${short}","${cls}","${id}","　　高　　　"`);
      R(`0,1,"${grade}","",""`);
      R(`${id},"${availFull}-CJ${'0'.repeat(34)}"`);
    });

    // ── ROOM (実際の教室) ──
    const roomList = Array.from(roomSet).sort((a, b) => a.localeCompare(b, 'ja'));
    const roomIdOf = new Map(roomList.map((r, i) => [r, i + 1]));
    R(`"ROOM:",${roomList.length}`);
    R('0,"","","","　　高　　　"');
    R('0,1,"","",""');
    R(`0,"${'0'.repeat(16)}-${availFull}-CJ${'0'.repeat(34)}"`);
    roomList.forEach((rm, i) => {
      const id = i + 1;
      R(`${id},"${rm}","${rm}","${id}","　　高　　　"`);
      R('0,1,"","",""');
      R(`${id},"${availFull}-CJ${'0'.repeat(34)}"`);
    });

    // ── LESSON (科目: 正式名称を name に、略称を f1[3] に置く) ──
    const subjEntries = Object.entries(state.subjectCfg).filter(([, v]) => v && v.abbr);
    const lessonIdOf = new Map(subjEntries.map(([k], i) => [k, i + 1]));
    R(`"LESSON:",${subjEntries.length}`);
    R('0,"","","","　　高　　　"');
    R('0,0,"","",""');
    R(`0,"${availFull}-CJ${'0'.repeat(34)}"`);
    subjEntries.forEach(([key, v], i) => {
      const id = i + 1;
      const fullName = key;        // 正式名称（キー）
      const abbr = v.abbr || key;  // 略称
      const dept = v.dept ? v.dept + '科' : '';
      R(`${id},"${fullName}","${fullName}","${abbr}","　　高　　　"`);
      R(`0,1,"","${dept}",""`);
      R(`${id},"${availFull}-CJ${'0'.repeat(34)}"`);
    });

    // ── TEACH ──
    const teachEntries = Object.entries(state.teacherCfg).filter(([n]) => n);
    const teachIdOf = new Map(teachEntries.map(([n], i) => [n, i + 1]));
    R(`"TEACH:",${teachEntries.length}`);
    R('0,"","","","　　高　　　"');
    R('0,1,"","","","","","00-1"');
    R(`0,0,0,0,"${availFull}-CJ${'0'.repeat(34)}"`);
    teachEntries.forEach(([name, v], i) => {
      const id = i + 1;
      const abbr = v.abbr || name;
      const dept = v.dept ? v.dept + '科' : '';
      R(`${id},"${name}","${abbr}","${abbr}","　　高　　　"`);
      R(`0,1,"","${dept}","","","","00-1"`);
      R(`0,0,0,0,"${availFull}-CJ${'0'.repeat(34)}"`);
    });

    // ── SJYUGYO (空) ──
    R('"SJYUGYO:",0');
    R('0,"","",""');
    R(`0,"${availFull}-CJ${'0'.repeat(34)}"`);
    R('0');
    R('0,0,0,0,"                                 ","同時展開            同時展開            同時展開            "');
    R('0');

    // ── JUGYO (item署名でグループ化し、2連(span)・配置を保持) ──
    // 署名: クラス集合 | 科目 | 教員集合 | 教室集合 | span
    const jugyoGroups = [], jugyoSig = new Map();
    for (const it of Object.values(state.items)) {
      const span = it.span || 1;
      const sig = (it.cls || []).slice().sort().join('+') + '|' + (it.subjKey || it.subj) + '|' +
        (it.teas || []).slice().sort().join('+') + '|' + (it.rooms || []).slice().sort().join('+') + '|' + span;
      let g = jugyoSig.get(sig);
      if (!g) { g = { cls: it.cls || [], subj: it.subj, subjKey: it.subjKey || it.subj, teas: it.teas || [], rooms: it.rooms || [], span, sessions: [] }; jugyoSig.set(sig, g); jugyoGroups.push(g); }
      const pl = state.placements[it.id];
      if (pl && pl.day) g.sessions.push({ day: pl.day, period: pl.period });
      else g.unplaced = (g.unplaced || 0) + 1; // 【6】未配置(在庫)のコマも数えて出力する
    }
    // (エンティティID → セル配置[]) を作りながらJUGYOを出力
    const jClassCells = {}, jTeachCells = {}, jRoomCells = {};
    R(`"JUGYO:",${jugyoGroups.length}`);
    R('0,"","",""');
    R(`0,"${availFull}-CJ${'0'.repeat(34)}"`);
    R('0,0,0,0,"                                 "');
    R('0');
    jugyoGroups.forEach((g, gi) => {
      const jid = gi + 1;
      const cId = classIdOf.get(g.cls[0]) || 0;
      const lId = lessonIdOf.get(g.subjKey) || 0;
      const rId = roomIdOf.get(g.rooms[0]) || 0;
      const perLines = [];
      for (const s of g.sessions) {
        const dn = dayNumOf(s.day);
        if (dn < 1) continue;
        for (let dp = 0; dp < g.span; dp++) {
          const per = s.period + dp;
          if (per > numPeriods) continue;
          perLines.push(`${dn},${per},${rId},1,${dp + 1}`); // st=1,en=dp+1 で連続数を表現
          for (const c of g.cls) { const ci = classIdOf.get(c); if (ci) (jClassCells[ci] || (jClassCells[ci] = [])).push({ day: s.day, period: per, jid }); }
          for (const t of g.teas) { const ti = teachIdOf.get(t); if (ti) (jTeachCells[ti] || (jTeachCells[ti] = [])).push({ day: s.day, period: per, jid }); }
          for (const rm of g.rooms) { const ki = roomIdOf.get(rm); if (ki) (jRoomCells[ki] || (jRoomCells[ki] = [])).push({ day: s.day, period: per, jid }); }
        }
      }
      // 【6】未配置のコマは「曜日0・時限0」の時限行として出力（週あたりコマ数を保持）
      for (let u = 0; u < (g.unplaced || 0); u++) {
        for (let dp = 0; dp < g.span; dp++) perLines.push(`0,0,${rId},1,${dp + 1}`);
      }
      // 未配置コマを含む授業は、配置が無くても担当が分かるよう4列目に教員IDを書く
      const tId = g.unplaced ? (teachIdOf.get(g.teas[0]) || 0) : 0;
      // 一度も配置されていない授業は J-Room に現れないため、3列目に教室IDを書く（配置済みは従来どおり）
      const roomCol = (g.unplaced && !g.sessions.length && rId) ? rId : cId;
      const nSess = g.sessions.length + (g.unplaced || 0);
      const name = g.subj;
      R(`${jid},"${name}","${name}","${name}"`);
      R(`0,"${availFull}-CJ${'0'.repeat(34)}"`);
      R(`${cId},${lId},${roomCol},${tId},"${'○'.repeat(Math.min(nSess, 8))}${'　'.repeat(Math.max(0, 8 - nSess))}                       "`);
      R(String(perLines.length));
      perLines.forEach(pl => R(pl));
    });

    // ── J-CLASS / J-Teach / J-Room: パディング格子 (numDays+1)×(numPeriods+1) に実配置を書く ──
    const gridDays = numDays + 1, gridP = numPeriods + 1;
    const emitJSection = (label, entityCount, cellsByEntity) => {
      R(`"${label}:",${entityCount}`);
      for (let e = 0; e <= entityCount; e++) {
        const cellMap = {};
        for (const rec of (cellsByEntity[e] || [])) {
          const dn = dayNumOf(rec.day);
          if (dn < 1 || rec.period < 1 || rec.period > numPeriods) continue;
          (cellMap[dn + '#' + rec.period] || (cellMap[dn + '#' + rec.period] = [])).push(rec.jid);
        }
        for (let dayIdx = 0; dayIdx < gridDays; dayIdx++) {
          for (let perIdx = 0; perIdx < gridP; perIdx++) {
            const jids = (dayIdx >= 1 && perIdx >= 1) ? (cellMap[dayIdx + '#' + perIdx] || []) : [];
            if (!jids.length) { R('0'); R('0,0,0,0'); R('0,0,0,0,0,0'); }
            else {
              R(String(jids.length));
              R(String(jids.length));
              jids.forEach(jid => R(`${jid},0,0,0,0,0`));
              R('0,0,0,0');
            }
          }
        }
      }
    };
    emitJSection('J-CLASS', classList.length, jClassCells);
    emitJSection('J-Teach', teachEntries.length, jTeachCells);
    emitJSection('J-Room', roomList.length, jRoomCells);

    // ── Shift-JIS エンコード & ダウンロード ──
    const content = lines.join('\r\n');
    let bytes;
    if (typeof Encoding !== 'undefined') {
      bytes = Encoding.convert(content, { to: 'SJIS', from: 'UNICODE', type: 'array' });
    } else {
      // フォールバック: UTF-8
      bytes = Array.from(new TextEncoder().encode(content));
    }
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const ts2 = now2.toISOString().slice(0, 10);
    const safeName = (schoolName || '時間割').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
    const a = document.createElement('a');
    a.href = url; a.download = `${safeName}_${ts2}.ide`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    flash(`📤 「${safeName}_${ts2}.ide」をイデア形式で出力しました`);
  }

  function exportProjectFile() {
    const now2 = new Date();
    const ts = now2.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const projectName = prompt('プロジェクト名を入力（ファイル名に使用）', `時間割_${ts.slice(0, 10)}`);
    if (projectName === null) return; // キャンセル

    const payload = buildProjectPayload(projectName || `時間割_${ts.slice(0, 10)}`);

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeNameBase = (projectName || 'timetable').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    const filename = `${safeNameBase}_${ts.slice(0, 10)}.ide`;
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    flash(`💾 「${filename}」を保存しました`);
  }

  /* イデアのAI時間割 ネイティブ .ide ファイル（Shift-JIS CSV形式）をパースして
     classmatch の state に変換するユーティリティ関数群 */
  function _parseIdeaNativeIde(buffer) {
    // Shift-JIS デコード
    let text;
    try {
      text = new TextDecoder('shift-jis').decode(buffer);
    } catch (e) {
      text = new TextDecoder('shift_jis').decode(buffer);
    }
    const lines = text.split(/\r?\n/);

    // CSV フィールドパーサ（引用符対応）
    function parseLine(s) {
      // 【A-3】標準的なCSV行パーサ。"" (引用符内の二重引用符=リテラルの")と
      // 末尾の空フィールド(行末カンマ)に対応する。
      const fields = [];
      let field = '', i = 0, inQ = false;
      const n = s.length;
      while (i < n) {
        const c = s[i];
        if (inQ) {
          if (c === '"') {
            if (s[i + 1] === '"') { field += '"'; i += 2; continue; } // "" → "
            inQ = false; i++; continue;
          }
          field += c; i++; continue;
        }
        if (c === '"') { inQ = true; i++; continue; }
        if (c === ',') { fields.push(field); field = ''; i++; continue; }
        field += c; i++;
      }
      fields.push(field); // 末尾フィールド（行末カンマの空欄も含む）
      return fields;
    }

    // セクション先頭行を検索 → { sectionName: lineIndex }
    const sectionIdx = {};
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^"([A-Za-z\-]+):"/);
      if (m) sectionIdx[m[1]] = i;
    }

    // ── HEAD パース (学校名・曜日数・時限数・可用性) ──
    let schoolName = '', numDays = 5, numPeriods = 6;
    let headDayBlocks = [];  // 曜日ごとの可用性ブロック（禁則計算に使用）

    // 可用性文字列を探すヘルパー: "00..." / "01..." で始まる行を検索
    function findAvailStr(startLine, maxLines) {
      for (let i = startLine; i < startLine + maxLines && i < lines.length; i++) {
        const m = lines[i].match(/"(0[01][0-9-]+CJ[^"]*|0[01][0-9-]+)"/);
        if (m) return m[1];
      }
      return '';
    }

    if (sectionIdx['HEAD'] != null) {
      const hi = sectionIdx['HEAD'];
      const row1 = parseLine(lines[hi + 1] || '');
      schoolName = row1[6] || '';

      // 曜日リスト・時限リスト行を探す（特殊ファイルで余分な行がある場合に対応）
      let daysRow = null, perRow = null;
      for (let off = 2; off <= 5; off++) {
        const r = parseLine(lines[hi + off] || '');
        const n = parseInt(r[0]);
        if (!isNaN(n) && n >= 1 && n <= 7 && r[1] && r[1].includes('曜') && !daysRow) {
          daysRow = r; numDays = n;
        } else if (!isNaN(n) && n >= 1 && n <= 10 && r[1] && !daysRow && !perRow) {
          // 時限リストかも
        }
        if (!isNaN(n) && n >= 1 && n <= 10 && !daysRow && !perRow) {
          // check next line
        }
      }
      // より確実に: 数字で始まり２番目要素が曜日名 or 数字名の行を探す
      for (let off = 2; off <= 6; off++) {
        const raw = lines[hi + off] || '';
        const r = parseLine(raw);
        const n = parseInt(r[0]);
        if (isNaN(n)) continue;
        if (!daysRow && n >= 1 && n <= 7 && r.slice(1).some(s => s.includes('曜') || s.match(/^[月火水木金土日]/))) {
          daysRow = r; numDays = n;
        } else if (!perRow && n >= 1 && n <= 12 && daysRow && r.slice(1).some(s => s.match(/^[１２３４５６７８９０\d]/))) {
          perRow = r; numPeriods = n;
        }
      }
      if (!daysRow) numDays = 5;
      if (!perRow) numPeriods = 6;

      // HEAD 可用性文字列から曜日ごとの実時限数を取得
      const headAvail = findAvailStr(hi + 1, 8);
      if (headAvail) {
        const mainPart = headAvail.includes('CJ') ? headAvail.split('CJ')[0].replace(/-$/, '') : headAvail;
        // 可用性は「日index0＝パディング日」を含む。ブロックが曜日数より多ければ先頭を捨てる。
        const allBlocks = mainPart.split('-');
        headDayBlocks = allBlocks.length > numDays ? allBlocks.slice(1, numDays + 1) : allBlocks.slice(0, numDays);
        // 各ブロックで '01' ペアの数 = その曜日の実時限数
        // ブロック先頭2文字は曜日ヘッダー, 以降2文字ずつが各時限
        numPeriods = Math.max(numPeriods, headDayBlocks.reduce((mx, b) => {
          let cnt = 0;
          for (let p = 0; p < 12; p++) { if (b.slice(2 + p * 2, 4 + p * 2) === '01') cnt++; }
          return Math.max(mx, cnt);
        }, 0));
      }
    }

    const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].slice(0, numDays);
    const periodsByDay = {};
    DAY_KEYS.forEach((d, di) => {
      const block = headDayBlocks[di] || '';
      // 可用性ブロックが取得できていれば実時限数を使用、なければ numPeriods
      let cnt = 0;
      for (let p = 0; p < numPeriods + 2; p++) {
        if (block.slice(2 + p * 2, 4 + p * 2) === '01') cnt++;
      }
      periodsByDay[d] = cnt > 0 ? cnt : numPeriods;
    });

    // ── CLASS パース ──
    const classes = {};  // id -> { short, full }
    if (sectionIdx['CLASS'] != null) {
      const ci = sectionIdx['CLASS'];
      const count = parseInt(parseLine(lines[ci])[1]) || 0;
      let idx = ci + 1;
      for (let c = 0; c <= count; c++) {
        if (idx >= lines.length) break;
        const f1 = parseLine(lines[idx]);
        const id = parseInt(f1[0]);
        const short = (f1[1] || '').replace(/[　\s]/g, '').replace(/[１２３４５６７８９０]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[−－]/g, '-').replace(/(\d)ー(?=\d)/g, '$1-');
        const full = (f1[2] || '').replace(/[　\s]/g, '');
        classes[id] = { short, full };
        idx += 3;
      }
    }

    // 可用性ブロックから禁則時限を取得するヘルパー
    // availStr: "0001...CJ..." 形式, headBlocks: HEAD の曜日ブロック配列
    // forbidden: HEAD が '01'（授業あり）なのに対象が '00' or '90' のコマ
    function parseFixedForbid(availStr, headBlocks, forbidden_values) {
      const forbid = {};
      const mainPart = availStr.includes('CJ') ? availStr.split('CJ')[0].replace(/-$/, '') : availStr;
      // headBlocks と同様、パディング日(先頭ブロック)を捨てて曜日と揃える
      const allBlocks = mainPart.split('-');
      const dayBlocks = allBlocks.length > numDays ? allBlocks.slice(1, numDays + 1) : allBlocks.slice(0, numDays);
      DAY_KEYS.forEach((dayKey, di) => {
        const hb = headBlocks[di] || '';
        const db = dayBlocks[di] || '';
        const maxP = periodsByDay[dayKey] || numPeriods;
        const badPeriods = [];
        for (let p = 0; p < maxP; p++) {
          const hp = hb.slice(2 + p * 2, 4 + p * 2);
          const dp = db.slice(2 + p * 2, 4 + p * 2);
          if (hp === '01' && forbidden_values.includes(dp)) badPeriods.push(p + 1);
        }
        if (badPeriods.length) forbid[dayKey] = badPeriods;
      });
      return forbid;
    }

    // ── LESSON パース (教科) ──
    const lessons = {};  // id -> { name, dept, fixedForbid }
    if (sectionIdx['LESSON'] != null) {
      const li = sectionIdx['LESSON'];
      const count = parseInt(parseLine(lines[li])[1]) || 0;
      let idx = li + 1;
      for (let c = 0; c <= count; c++) {
        if (idx >= lines.length) break;
        const f1 = parseLine(lines[idx]);
        const f2 = parseLine(lines[idx + 1] || '');
        const id = parseInt(f1[0]);
        const name = f1[1] || '';
        const abbr = f1[3] || f1[2] || name;
        const dept = (f2[3] || '').replace(/科$/, '');
        // 可用性文字列から禁則取得 ('00' = 明示的禁則コマ)
        const availLine = lines[idx + 2] || '';
        const availMatch = availLine.match(/"([0-9][^"]+)"/);
        const fixedForbid = availMatch && headDayBlocks.length
          ? parseFixedForbid(availMatch[1], headDayBlocks, ['00'])
          : {};
        lessons[id] = { name, abbr, dept, fixedForbid };
        idx += 3;
      }
    }

    // ── TEACH パース (教員) ──
    const teachers = {};  // id -> { name, abbr, dept, homeroom, unavailable }
    if (sectionIdx['TEACH'] != null) {
      const ti = sectionIdx['TEACH'];
      const count = parseInt(parseLine(lines[ti])[1]) || 0;
      let idx = ti + 1;
      for (let c = 0; c <= count; c++) {
        if (idx >= lines.length) break;
        const f1 = parseLine(lines[idx]);
        const f2 = parseLine(lines[idx + 1] || '');
        const id = parseInt(f1[0]);
        const name = f1[1] || '';
        const abbr = f1[3] || f1[2] || name; // 【A-3】科目と同じ f1[3]||f1[2] にそろえる
        const dept = (f2[3] || '').replace(/科$/, '');
        const homeroom = (f2[4] || '').replace(/[　\s]/g, '').replace(/[１２３４５６７８９０]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[−－]/g, '-').replace(/(\d)ー(?=\d)/g, '$1-');
        // 可用性文字列から出勤不可コマを取得 ('90' = 非勤務)
        const availLine = lines[idx + 2] || '';
        const availMatch = availLine.match(/"([0-9][^"]+)"/);
        const unavailable = availMatch && headDayBlocks.length
          ? parseFixedForbid(availMatch[1], headDayBlocks, ['90', '09', '99'])
          : {};
        teachers[id] = { name, abbr, dept, homeroom, unavailable };
        idx += 3;
      }
    }

    // ── ROOM パース (教室) ──
    const rooms = {};  // id -> { name, abbr }
    if (sectionIdx['ROOM'] != null) {
      const ri = sectionIdx['ROOM'];
      const count = parseInt(parseLine(lines[ri])[1]) || 0;
      let idx = ri + 1;
      for (let c = 0; c <= count; c++) {
        if (idx >= lines.length) break;
        const f1 = parseLine(lines[idx]);
        const id = parseInt(f1[0]);
        const name = (f1[1] || '').replace(/[　\s]/g, '').replace(/[１２３４５６７８９０]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[−－]/g, '-').replace(/(\d)ー(?=\d)/g, '$1-');
        const abbr = (f1[2] || name).replace(/[　\s]/g, '');
        if (id > 0 && name) rooms[id] = { name, abbr };
        idx += 3;
      }
    }

    // ── JUGYO パース (授業単位) ── jugyo_id → {classId, lessonId, weeklyCount}
    const jugyoMeta = {};  // jid -> { classId, lessonId, weeklyCount }
    if (sectionIdx['JUGYO'] != null) {
      const ji = sectionIdx['JUGYO'];
      const count = parseInt(parseLine(lines[ji])[1]) || 0;
      let idx = ji + 1;
      for (let c = 0; c <= count; c++) {
        if (idx >= lines.length) break;
        const f1 = parseLine(lines[idx]);
        const f3 = parseLine(lines[idx + 2] || '');
        const jid = parseInt(f1[0]);
        const classId = parseInt(f3[0]) || 0;
        const lessonId = parseInt(f3[1]) || 0;
        const weeklyCount = parseInt((lines[idx + 3] || '').trim()) || 0;
        // span(連続コマ)は時限行の「開始,終了」フィールド(末尾2つ)で表現される。
        // 例: "5,4,23,1,2" → 開始1・終了2 = 2連。f1[5]は実ファイルに存在しないため使えない。
        let jugyoSpan = 1;
        // 時限行 field0=曜日(1-5) field1=時限。授業本来の(曜日,時限)集合を確定スケジュールとする
        const schedKeys = new Set();
        let unplacedLines = 0; // 【6】曜日0(未配置)の時限行の数
        for (let k = 0; k < weeklyCount; k++) {
          const pl = parseLine(lines[idx + 4 + k] || '');
          const st = parseInt(pl[3], 10), en = parseInt(pl[4], 10);
          if (!isNaN(st) && !isNaN(en) && en > st) jugyoSpan = Math.max(jugyoSpan, en - st + 1);
          const dnum = parseInt(pl[0], 10), pnum = parseInt(pl[1], 10);
          if (!isNaN(dnum) && dnum >= 1 && dnum <= numDays && !isNaN(pnum) && pnum >= 1) schedKeys.add(DAY_KEYS[dnum - 1] + '#' + pnum);
          else if (dnum === 0) unplacedLines++;
        }
        const teacherIdHint = parseInt(f3[3]) || 0;
        const roomIdHint = parseInt(f3[2]) || 0;
        jugyoMeta[jid] = { classId, lessonId, weeklyCount, name: f1[1] || '', span: jugyoSpan, schedKeys, unplacedLines, teacherIdHint, roomIdHint };
        // 1エントリ = ヘッダ4行 + weeklyCount本の時限行。従来は固定5行でズレていた。
        idx += 4 + (weeklyCount > 0 ? weeklyCount : 0);
      }
    }

    // 指定セクションの次に来るセクションの開始行（本体の終端）を返す
    function nextSectionLine(startIdx) {
      let best = lines.length;
      for (const k in sectionIdx) { const v = sectionIdx[k]; if (v > startIdx && v < best) best = v; }
      return best;
    }

    // ── J-* 配置ブロック共通パーサ ──
    // イデアは各エンティティ(クラス/教員/教室)ごとに固定グリッド（日ブロック×時限スロット）を持つ。
    // 日/時限のindex0はパディング（実データは1始まり）である場合が多い。
    // 【A-2】従来は (numDays+1)×(numPeriods+1) を決め打ちしていたが、1つでもずれると
    //   以降の配置が全てずれる。そこで「総マス数 ÷ (エンティティ数)」から1エンティティの
    //   マス数を実測し、候補格子(曜日5〜8 × 時限6〜9, パディング有無)と照合して決める。
    //   割り切れない/候補が無い場合は警告を出す。
    const parseWarnings = _parseIdeaNativeIde._warnings = [];
    const classCountHint = Object.keys(classes).length;
    const teacherCountHint = Object.keys(teachers).length;
    const roomCountHint = Object.keys(rooms).length;
    const _geomCache = {};
    function countJSlots(start, end) {
      let idx = start + 1, total = 0;
      while (idx < end) {
        const first = (lines[idx] || '').trim().split(',')[0];
        const slotCount = parseInt(first, 10);
        if (isNaN(slotCount)) break;
        if (slotCount === 0) idx += 3;
        else { const ec = parseInt((lines[idx + 1] || '').split(',')[0], 10) || 0; idx += 2 + ec + 1; }
        total++;
      }
      return total;
    }
    function solveJGeometry(sectionName, entityHint) {
      if (_geomCache[sectionName]) return _geomCache[sectionName];
      const res = { gridDays: numDays + 1, gridP: numPeriods + 1, padDay: true, padPeriod: true, ok: true, warn: null, total: 0, E: entityHint };
      const start = sectionIdx[sectionName];
      if (start == null) return (_geomCache[sectionName] = res);
      const end = nextSectionLine(start);
      const total = res.total = countJSlots(start, end);
      const cands = [];
      for (let gd = 5; gd <= 8; gd++) for (let gp = 6; gp <= 9; gp++) {
        const per = gd * gp;
        if (total === 0 || total % per !== 0) continue;
        cands.push({ gridDays: gd, gridP: gp, E: total / per, padDay: gd > numDays, padPeriod: gp > numPeriods });
      }
      if (!cands.length) {
        res.ok = false;
        res.warn = sectionName + '：総マス数(' + total + ')が想定の格子に割り切れません。読込形式が想定と異なる可能性があります。';
        return (_geomCache[sectionName] = res);
      }
      cands.sort((a, b) => {
        const sc = (x) => Math.abs(x.E - entityHint) * 100 + Math.abs(x.gridDays - (numDays + 1)) * 10 + Math.abs(x.gridP - (numPeriods + 1));
        return sc(a) - sc(b);
      });
      Object.assign(res, cands[0], { ok: true });
      if (res.gridDays !== numDays + 1 || res.gridP !== numPeriods + 1) {
        res.warn = sectionName + '：データから推定した格子 ' + res.gridDays + '×' + res.gridP +
          ' がHEADの ' + (numDays + 1) + '×' + (numPeriods + 1) + ' と異なります（推定値を使用）。';
      }
      return (_geomCache[sectionName] = res);
    }
    function walkJSection(sectionName, cb) {
      const start = sectionIdx[sectionName];
      if (start == null) return;
      const end = nextSectionLine(start);
      const hint = sectionName === 'J-CLASS' ? classCountHint
        : sectionName === 'J-Teach' ? teacherCountHint
          : sectionName === 'J-Room' ? roomCountHint : classCountHint;
      const geom = solveJGeometry(sectionName, hint);
      if (geom.warn && !parseWarnings.includes(geom.warn)) parseWarnings.push(geom.warn);
      const gridP = geom.gridP;
      const perEntity = geom.gridDays * geom.gridP;
      const dayOffset = geom.padDay ? 1 : 0;
      const perOffset = geom.padPeriod ? 1 : 0;
      let idx = start + 1, s = 0, ent = 0;
      while (idx < end) {
        const first = (lines[idx] || '').trim().split(',')[0];
        const slotCount = parseInt(first, 10);
        if (isNaN(slotCount)) break;
        const dayIdx = Math.floor(s / gridP);
        const perIdx = s % gridP;
        if (slotCount === 0) {
          idx += 3;
        } else {
          const entryCount = parseInt((lines[idx + 1] || '').split(',')[0], 10) || 0;
          const dayNum = dayIdx - dayOffset;   // 0始まりの曜日index
          const perNum = perIdx - perOffset;   // 0始まりの時限index
          if (dayNum >= 0 && dayNum < numDays && perNum >= 0 && perNum < numPeriods) {
            const seen = new Set();
            for (let e = 0; e < entryCount; e++) {
              const ef = (lines[idx + 2 + e] || '').split(',');
              const jugyoId = parseInt(ef[0], 10) || 0;
              // 4番目の数値の十の位: 1x/2x=通常授業(JUGYO)の番号、3x/4x=同時展開ブロック(SJYUGYO)の番号。
              // 従来は全てJUGYO番号として読み、例えば同時展開54「文/C312」を授業54「歴史総合」と取り違えていた。
              const kind = Math.floor((parseInt(ef[3], 10) || 0) / 10);
              const sk = (kind >= 3 ? 'S' : 'J') + jugyoId;
              if (jugyoId > 0 && !seen.has(sk)) { seen.add(sk); cb(ent, jugyoId, DAY_KEYS[dayNum], perNum + 1, kind >= 3); }
            }
          }
          idx += 2 + entryCount + 1;
        }
        s++; if (s >= perEntity) { s = 0; ent++; }
      }
    }

    // ── J-CLASS パース (クラス×時限→JUGYO配置) ──
    // 配置は (jugyo, 曜日, 時限) 単位のインスタンス。同一インスタンスに複数クラスが
    // 乗る場合が合同授業。クラス集合はインスタンス単位で保持する（jugyo全体で束ねると
    // 別クラスのコマを誤って別クラスへ配置してしまうため）。
    const jugyoInstances = {}; // jugyo_id → { "day#period": {day, period, classes, teachers, rooms} }
    const sjInstances = {};    // SJYUGYO id → 同上（同時展開ブロック: 選択講座・校務分掌・自由選択など）
    const instOf = (isSJ, id, dayKey, period, create) => {
      const store = isSJ ? sjInstances : jugyoInstances;
      if (!store[id]) { if (!create) return null; store[id] = {}; }
      const key = dayKey + '#' + period;
      if (!store[id][key]) { if (!create) return null; store[id][key] = { day: dayKey, period, classes: new Set(), teachers: new Set(), rooms: new Set() }; }
      return store[id][key];
    };
    walkJSection('J-CLASS', (ent, jugyoId, dayKey, period, isSJ) => {
      if (isSJ) {
        const r = instOf(true, jugyoId, dayKey, period, true);
        const c = classes[ent]; if (c) { const nm = c.full || c.short; if (nm) r.classes.add(nm); }
        return;
      }
      const inst = jugyoInstances[jugyoId] || (jugyoInstances[jugyoId] = {});
      const key = dayKey + '#' + period;
      const rec = inst[key] || (inst[key] = { day: dayKey, period, classes: new Set(), teachers: new Set(), rooms: new Set() });
      const cls = classes[ent];
      if (cls) { const nm = cls.full || cls.short; if (nm) rec.classes.add(nm); }
    });

    // ── J-Teach パース (教員→JUGYO割当) ── entityIdx = teacherId
    // 教員/教室もクラス同様インスタンス(jugyo,曜日,時限)単位で割当てる。jugyo全体で
    // 束ねると、インスタンスごとに担当が違う場合に別担当を全コマへ誤付与し二重予約になる。
    const jugyoToTeachers = {};  // 表示・未配置item用の全体集合（フォールバック）
    walkJSection('J-Teach', (ent, jugyoId, dayKey, period, isSJ) => {
      const teacher = teachers[ent];
      const teacherName = teacher ? teacher.name : null;
      if (!teacherName) return;
      if (isSJ) { instOf(true, jugyoId, dayKey, period, true).teachers.add(teacherName); return; }
      const arr = jugyoToTeachers[jugyoId] || (jugyoToTeachers[jugyoId] = []);
      if (!arr.includes(teacherName)) arr.push(teacherName);
      const rec = jugyoInstances[jugyoId] && jugyoInstances[jugyoId][dayKey + '#' + period];
      if (rec) rec.teachers.add(teacherName);
    });

    // ── J-Room パース (教室→JUGYO割当) ── entityIdx = roomId
    const jugyoRooms = {};
    walkJSection('J-Room', (ent, jugyoId, dayKey, period, isSJ) => {
      const room = rooms[ent];
      const roomName = room ? room.name : null;
      if (!roomName) return;
      if (isSJ) { instOf(true, jugyoId, dayKey, period, true).rooms.add(roomName); return; }
      const arr = jugyoRooms[jugyoId] || (jugyoRooms[jugyoId] = []);
      if (!arr.includes(roomName)) arr.push(roomName);
      const rec = jugyoInstances[jugyoId] && jugyoInstances[jugyoId][dayKey + '#' + period];
      if (rec) rec.rooms.add(roomName);
    });

    // 教員名→略名 逆引きマップ
    const teacherAbbrByName = {};
    for (const t of Object.values(teachers)) {
      if (t.name) teacherAbbrByName[t.name] = t.abbr || t.name;
    }

    // ── items / rawRows 構築 ──
    const items = {};
    const rawRows = [];
    let itemIdCounter = 0;
    // jugyo_id → [item_id, ...] (配置対応用)
    const jugyoItemIds = {};

    for (const [jidStr, meta] of Object.entries(jugyoMeta)) {
      const jid = parseInt(jidStr);
      const { classId, lessonId, weeklyCount, name: jname } = meta;
      if (jid === 0 || classId === 0 || weeklyCount === 0) continue;

      const cls = classes[classId];
      const lesson = lessons[lessonId] || { name: jname, abbr: jname, dept: '' };
      const clsName = cls ? (cls.full || cls.short) : String(classId);
      const clsList = [clsName]; // 既定は単一クラス。合同授業は配置時にインスタンスのクラス集合で上書き
      const subjName = lesson.name || jname;
      const subjAbbr = lesson.abbr || subjName;
      const dept = lesson.dept || '';
      // 【6】一度も配置されていない授業は J-Teach に現れないため、JUGYO 4列目の教員IDで補う
      let teacherNames = jugyoToTeachers[jid] || [];
      if (!teacherNames.length && !(meta.schedKeys && meta.schedKeys.size) && meta.teacherIdHint && teachers[meta.teacherIdHint]?.name) {
        teacherNames = [teachers[meta.teacherIdHint].name];
      }
      // 同様に、一度も配置されていない授業の教室は JUGYO 3列目の教室IDで補う
      if (!(jugyoRooms[jid] || []).length && !(meta.schedKeys && meta.schedKeys.size) && meta.roomIdHint && rooms[meta.roomIdHint]?.name) {
        jugyoRooms[jid] = [rooms[meta.roomIdHint].name];
      }
      const tea = teacherNames.join(',');
      const teaAbbr = teacherNames.map(n => teacherAbbrByName[n] || n).join(',');

      const span = parseInt(meta.span || 1) || 1;
      // weeklyCount は JUGYO の時限行数。2連続コマは 1セッションが2行で現れるため、
      // 連続コマの先頭のみを数えた「実セッション数」でitemを生成する
      // （そうしないと2連が2つの授業として重複生成され、片方が未配置で余る）。
      let sessionCount = weeklyCount;
      if (span >= 2) {
        sessionCount = 0;
        for (const k of (meta.schedKeys || [])) {
          const hash = k.lastIndexOf('#');
          const d = k.slice(0, hash), pr = parseInt(k.slice(hash + 1), 10);
          if (!meta.schedKeys.has(d + '#' + (pr - 1))) sessionCount++; // 連続の先頭のみ
        }
        // 【6】未配置(曜日0)の時限行は span 行で1コマ
        sessionCount += Math.ceil((meta.unplacedLines || 0) / span);
        if (sessionCount < 1) sessionCount = 1;
      }
      jugyoItemIds[jid] = [];
      for (let p = 0; p < sessionCount; p++) {
        const id = String(itemIdCounter++);
        jugyoItemIds[jid].push(id);
        items[id] = {
          id,
          subj: subjName,
          subjKey: subjName,
          cls: clsList.slice(),
          teas: teacherNames,
          rooms: jugyoRooms[jid] || [],
          span,
        };
      }

      rawRows.push({
        cls: clsList.join(','),
        subj: subjName,
        subjAbbr,
        dept,
        tea,
        teaAbbr,
        room: (jugyoRooms[jid] || []).join(','),
        count: sessionCount,
        span,
      });
    }

    // ── subjectCfg 構築（キー = フルネーム、fixedForbid を含む）──
    const subjectCfg = {};
    for (const lesson of Object.values(lessons)) {
      if (!lesson.name) continue;
      if (!subjectCfg[lesson.name]) {
        subjectCfg[lesson.name] = {
          abbr: lesson.abbr || lesson.name,
          dept: lesson.dept || '',
          fixedForbid: lesson.fixedForbid || {},
          noSameDay: false,
          noConsec: false,
          maxPerDay: null,
        };
      }
    }

    // ── teacherCfg 構築 ──
    const teacherCfg = {};
    for (const t of Object.values(teachers)) {
      if (!t.name) continue;
      teacherCfg[t.name] = {
        abbr: t.abbr || t.name,
        dept: t.dept || '',
        unavailable: t.unavailable || {},
        maxDaily: null,
        maxConsec: null,
      };
    }

    // ── roomCfg 構築 (教室マスタ) ──
    const roomCfg = {};
    for (const r of Object.values(rooms)) {
      if (!r.name) continue;
      roomCfg[r.name] = { abbr: r.abbr || r.name };
    }

    // ── placements 構築 (J-CLASS の配置データがある場合) ──
    const placements = {};
    let placedCount = 0;
    for (const [jidStr, inst] of Object.entries(jugyoInstances)) {
      const jid = parseInt(jidStr);
      const itemIds = jugyoItemIds[jid];
      if (!itemIds) continue;
      let instList = Object.values(inst);
      // 2連コマは J-CLASS に連続する時限として現れる。開始時限だけ残して1配置に畳む。
      // 【A-3】従来は「前の時限があれば消す」だけだったため、1-2限と3-4限のように
      // 2連が2つ続く場合に全体を1ブロックに潰していた。曜日ごとに連続時限をまとめ、
      // span個ごとの先頭だけを残すことで、独立した複数の2連を正しく保持する。
      if (jugyoMeta[jid] && jugyoMeta[jid].span >= 2) {
        const span = jugyoMeta[jid].span;
        const byDay = {};
        for (const r of instList) (byDay[r.day] || (byDay[r.day] = [])).push(r);
        const kept = [];
        for (const day in byDay) {
          const arr = byDay[day].sort((a, b) => a.period - b.period);
          let runStart = null, prev = null;
          for (const r of arr) {
            if (prev !== null && r.period === prev + 1) {
              if ((r.period - runStart) % span === 0) { kept.push(r); runStart = r.period; }
            } else {
              kept.push(r); runStart = r.period;
            }
            prev = r.period;
          }
        }
        instList = kept;
      }
      instList.sort((a, b) =>
        DAY_KEYS.indexOf(a.day) - DAY_KEYS.indexOf(b.day) || a.period - b.period
      );
      // 選択科目等でweeklyCountより多くのインスタンス(曜日,時限)がある場合、
      // 全て配置できるようitemを追加生成する（従来はcapで後半曜日を取りこぼしていた）。
      const template = items[itemIds[0]];
      while (itemIds.length < instList.length && template) {
        const nid = String(itemIdCounter++);
        items[nid] = {
          id: nid, subj: template.subj, subjKey: template.subjKey,
          cls: template.cls.slice(), teas: (template.teas || []).slice(),
          rooms: (template.rooms || []).slice(), span: template.span,
        };
        itemIds.push(nid);
      }
      const schedKeys = (jugyoMeta[jid] && jugyoMeta[jid].schedKeys) || null;
      for (let i = 0; i < instList.length && i < itemIds.length; i++) {
        const r = instList[i];
        const it = items[itemIds[i]];
        placements[itemIds[i]] = { day: r.day, period: r.period, locked: false };
        // このインスタンスのクラス/教員/教室をitemへ反映（合同授業・インスタンス別担当に対応）
        if (it) {
          if (r.classes && r.classes.size) it.cls = Array.from(r.classes);
          if (r.teachers && r.teachers.size) it.teas = Array.from(r.teachers);
          if (r.rooms && r.rooms.size) it.rooms = Array.from(r.rooms);
          // 授業本来のスケジュールに無い(曜日,時限)は同時展開/相乗りのコマ。
          // 各コマの科目は一意に定まる(分析でクラス×時限あたり科目1つを確認)ため、
          // 実科目名を表示したまま「同時展開」フラグを立てる（従来は一律「選択」に潰していた）。
          // 真の生徒選択制(自選(月/水/金))はこの後SJYUGYO側でグループ名にラベルし直す。
          if (schedKeys && schedKeys.size && !schedKeys.has(r.day + '#' + r.period)) {
            it.simul = true;
          }
        }
        placedCount++;
      }
    }

    // ── SJYUGYO パース (同時展開授業: 総合的な探究の時間・LHR・校務分掌・選択講座) ──
    // 各エントリ: header(id,name) / avail / memberCount / group-header / member×N / weeklyCount / 時限行×wc
    //   member = [代表jugyoId, lessonId, roomId, teacherId] … teacherId→homeroomでクラス確定
    //   時限行 = [曜日(1-5), 時限, 教室, 開始, 終了]
    // 該当クラス全てにその授業を配置し、同セルのJ-CLASS由来の相乗り参照を上書きする。
    if (sectionIdx['SJYUGYO'] != null) {
      const sji = sectionIdx['SJYUGYO'];
      const sjCount = parseInt(parseLine(lines[sji])[1]) || 0;
      let sidx = sji + 1;
      const sjCells = new Set();  // "class#day#period" 上書き対象
      const sjPlace = [];         // {subj, cls, teas, day, period, span}
      const electiveCells = {};   // "class#day#period" -> {label, real} 自選ブロックのラベル付け
      const sjMeta = {};          // SJYUGYO id -> {name, real[], span, isHR}
      for (let c = 0; c <= sjCount; c++) {
        if (sidx >= lines.length) break;
        const hdr = parseLine(lines[sidx]);
        const name = hdr[1] || '';
        const sjId = parseInt(hdr[0], 10) || 0;
        const memN = parseInt((lines[sidx + 2] || '').trim()) || 0;
        const members = [];
        for (let m = 0; m < memN; m++) members.push(parseLine(lines[sidx + 4 + m] || ''));
        const wcLine = sidx + 4 + memN;
        const wc = parseInt((lines[wcLine] || '').trim()) || 0;
        const perPeriods = [];
        for (let k = 0; k < wc; k++) perPeriods.push(parseLine(lines[wcLine + 1 + k] || ''));
        sidx = wcLine + 1 + wc;
        if (!memN || !wc) continue;
        const lessonId = parseInt(members[0][1]) || 0;
        const lesson = lessons[lessonId];
        const subj = (lesson && lesson.name) || name;
        if (!subj) continue;
        {
          // 同時展開ブロックの名前と開講科目（member = [クラス番号, 科目番号, 教室番号, 教員番号]）
          const real = [];
          for (const mem of members) { const ln = lessons[parseInt(mem[1]) || 0]?.name; if (ln && !real.includes(ln)) real.push(ln); }
          let bspan = 1;
          for (const pp of perPeriods) { const st = parseInt(pp[3], 10), en = parseInt(pp[4], 10); if (!isNaN(st) && !isNaN(en) && en > st) bspan = Math.max(bspan, en - st + 1); }
          const hw = subj.replace(/[Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
          // 表示名はイデアの時間割出力と同じ3つ目の名前（例: 数学Ⅰ11・情13・自由選択(月)1）。同じ正式名のブロックを区別できる
          sjMeta[sjId] = { name: ((hdr[3] || '').trim() || (name || subj).trim()), real, span: bspan,
            isHR: subj.includes('総合的な探究') || /LHR|ロングホーム|ホームルーム/.test(hw) };
        }
        // 学年一斉の「総合的な探究の時間」「LHR/ホームルーム」のみ対象。
        // 選択講座はJ-CLASSに既にあり(担任≠受講クラスのため展開不可)、
        // 校務分掌(進路G等)は生徒授業でないため除外する。
        // ＬＨＲ(全角)にも対応するため全角ラテンを半角化して判定する。
        const subjHW = subj.replace(/[Ａ-Ｚａ-ｚ]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        // ── 自選・自由選択の同時展開ブロック ──
        // 科目は生徒選択制でクラスに一意化できないため、該当セルをグループ名(自選(金)等)で
        // ラベルし、相乗り科目一覧をrealSubjに保持する（既存の「選択」相乗りコマを上書き）。
        if (/自選|自由選択/.test(name) || /自選|自由選択/.test(subj)) {
          const label = (name || subj).replace(/[　\s]/g, '');
          // member = [表示index, lessonId, roomId, teacherId]。member[1]=lessonId が開講科目。
          // 受講クラスは生徒選択制で同時展開ブロックからは一意化できないため、
          // ブロックの(曜日,時限)で既存の「選択」相乗りコマを一致させてラベル付けする。
          const realNames = new Set();
          for (const mem of members) {
            const lid = parseInt(mem[1]) || 0;
            const ln = lessons[lid] && lessons[lid].name;
            if (ln) realNames.add(ln);
          }
          const realStr = [...realNames].join(' / ');
          for (const pp of perPeriods) {
            const dnum = parseInt(pp[0], 10), pnum = parseInt(pp[1], 10);
            const st = parseInt(pp[3], 10), en = parseInt(pp[4], 10);
            const span = (!isNaN(st) && !isNaN(en) && en > st) ? (en - st + 1) : 1;
            if (isNaN(dnum) || dnum < 1 || dnum > numDays || isNaN(pnum) || pnum < 1) continue;
            const dayKey = DAY_KEYS[dnum - 1];
            for (let dp = 0; dp < span; dp++) electiveCells[dayKey + '#' + (pnum + dp)] = { label, real: realStr };
          }
          continue;
        }
        if (!(subj.includes('総合的な探究') || /LHR|ロングホーム|ホームルーム/.test(subjHW))) continue;
        // メンバーのteacherId→homeroomクラス、クラスごとに担当教員をまとめる
        const clsTeas = {};
        for (const mem of members) {
          const tid = parseInt(mem[3]) || 0;
          const t = teachers[tid];
          if (!t || !t.homeroom) continue;
          (clsTeas[t.homeroom] || (clsTeas[t.homeroom] = new Set())).add(t.name);
        }
        for (const pp of perPeriods) {
          const dnum = parseInt(pp[0], 10), pnum = parseInt(pp[1], 10);
          const st = parseInt(pp[3], 10), en = parseInt(pp[4], 10);
          const span = (!isNaN(st) && !isNaN(en) && en > st) ? (en - st + 1) : 1;
          if (isNaN(dnum) || dnum < 1 || dnum > numDays || isNaN(pnum) || pnum < 1) continue;
          const dayKey = DAY_KEYS[dnum - 1];
          for (const cn in clsTeas) {
            sjPlace.push({ subj, cls: [cn], teas: Array.from(clsTeas[cn]), day: dayKey, period: pnum, span });
            for (let dp = 0; dp < span; dp++) sjCells.add(cn + '#' + dayKey + '#' + (pnum + dp));
          }
        }
      }
      // SJYUGYOが占有するセルと重なるJ-CLASS由来の配置を除去（相乗り参照の上書き）
      for (const itemId in placements) {
        const plc = placements[itemId]; if (!plc || !plc.day) continue;
        const it = items[itemId]; if (!it) continue;
        const span = it.span || 1;
        let overlap = false;
        for (const cn of (it.cls || [])) {
          for (let dp = 0; dp < span && !overlap; dp++) if (sjCells.has(cn + '#' + plc.day + '#' + (plc.period + dp))) overlap = true;
          if (overlap) break;
        }
        if (overlap) { delete placements[itemId]; delete items[itemId]; placedCount--; }
      }
      // SJYUGYO配置をitem化して追加
      const sjSubjs = new Set();
      const sjRawAgg = {}; // "subj|cls|span" -> count（データ入力画面に集約表示するため）
      for (const sp of sjPlace) {
        const id = String(itemIdCounter++);
        items[id] = { id, subj: sp.subj, subjKey: sp.subj, cls: sp.cls, teas: sp.teas, rooms: [], span: sp.span };
        placements[id] = { day: sp.day, period: sp.period, locked: false };
        placedCount++;
        sjSubjs.add(sp.subj);
        if (!subjectCfg[sp.subj]) subjectCfg[sp.subj] = { abbr: sp.subj, dept: '', fixedForbid: {}, noSameDay: false, noConsec: false, maxPerDay: null };
        const rk = sp.subj + '|' + (sp.cls || []).join(',') + '|' + (sp.span || 1);
        sjRawAgg[rk] = sjRawAgg[rk] || { subj: sp.subj, cls: (sp.cls || []).join(','), teas: sp.teas || [], span: sp.span || 1, count: 0 };
        sjRawAgg[rk].count++;
      }
      // 総合的な探究・LHR等の同時展開授業をデータ入力画面(rawRows)にも反映
      for (const k in sjRawAgg) {
        const a = sjRawAgg[k];
        rawRows.push({ cls: a.cls, subj: a.subj, subjAbbr: '', dept: '', tea: (a.teas || []).join(','), teaAbbr: '', room: '', count: a.count, span: a.span });
      }
      // JUGYO由来の未配置プレースホルダ(総合/LHR等, スケジュール無し)は重複なので除去
      for (const iid of Object.keys(items)) {
        const plc = placements[iid];
        if ((!plc || !plc.day) && sjSubjs.has(items[iid].subj)) { delete items[iid]; delete placements[iid]; }
      }
      // ── 自選ブロックのラベル付け（自選時限の同時展開コマをグループ名で上書き）──
      // 受講クラスは特定できないが、自選ブロックの時限に置かれた同時展開コマは自選と判断できる。
      // 真の生徒選択制のため、ここでは実科目名でなくグループ名(自選(月)等)を表示し、
      // 開講科目一覧をrealSubjに保持する。通常授業(simulでない)は対象外。
      if (Object.keys(electiveCells).length) {
        let relabeled = 0;
        for (const itemId in placements) {
          const plc = placements[itemId]; if (!plc || !plc.day) continue;
          const it = items[itemId]; if (!it) continue;
          if (!it.simul) continue; // 同時展開コマのみラベル付け
          const span = it.span || 1;
          let hit = null;
          for (let dp = 0; dp < span && !hit; dp++) hit = electiveCells[plc.day + '#' + (plc.period + dp)] || null;
          if (hit) {
            it.realSubj = hit.real || it.subj; // 開講科目一覧を保持
            it.subj = hit.label; it.subjKey = hit.label;
            if (!subjectCfg[hit.label]) subjectCfg[hit.label] = { abbr: hit.label, dept: '選択', fixedForbid: {}, noSameDay: false, noConsec: false, maxPerDay: null };
            relabeled++;
          }
        }
        _parseIdeaNativeIde._electiveRelabeled = relabeled;
      }

      // ── 同時展開ブロック（選択講座・校務分掌・自由選択）を、J-CLASS/J-Teach/J-Room の
      //    ブロック参照からそのまま1コマずつ作る。科目名はブロック名（例: 文/C312）、
      //    開講科目一覧は realSubj に入れる。総合的な探究・LHR は上の担任別展開を使う。
      let sjBuilt = 0;
      for (const [sidStr, inst] of Object.entries(sjInstances)) {
        const meta = sjMeta[parseInt(sidStr, 10)];
        if (!meta || meta.isHR) continue;
        let list = Object.values(inst).sort((a, b) => DAY_KEYS.indexOf(a.day) - DAY_KEYS.indexOf(b.day) || a.period - b.period);
        if (meta.span >= 2) {
          const kept = []; let prev = null, runStart = null;
          for (const r of list) {
            if (prev && prev.day === r.day && r.period === prev.period + 1 && (r.period - runStart) % meta.span !== 0) { prev = r; continue; }
            kept.push(r); runStart = r.period; prev = r;
          }
          list = kept;
        }
        for (const r of list) {
          if (!r.classes.size && !r.teachers.size) continue;
          const id = String(itemIdCounter++);
          items[id] = {
            id, subj: meta.name, subjKey: meta.name,
            cls: Array.from(r.classes), teas: Array.from(r.teachers), rooms: Array.from(r.rooms),
            span: meta.span, simul: true, realSubj: meta.real.join(' / '),
          };
          placements[id] = { day: r.day, period: r.period, locked: false };
          placedCount++; sjBuilt++;
          if (!subjectCfg[meta.name]) subjectCfg[meta.name] = { abbr: meta.name, dept: '', fixedForbid: {}, noSameDay: false, noConsec: false, maxPerDay: null };
        }
      }
      _parseIdeaNativeIde._sjBuilt = sjBuilt;
    }

    // ── rawRows を最終itemから再構築し、item ID を reflect と一致させる ──
    // 「データ登録 → 保存して作成画面へ」(reflectRawToItems)は rawRows から item を
    // ${_id}__${k} 形式のIDで作り直す。読込時のIDと形式が違うと配置が対応付かず全消えするため、
    // ここで最終itemを (科目/クラス/教員/教室/連続/同時展開) の署名でグループ化して行を作り、
    // 各itemのIDを ${_id}__${k} に振り直しておく（合同授業や時限別担当は署名が異なるので自然に別行になる）。
    {
      const sigOf = (it) => JSON.stringify([
        it.subj || '', (it.cls || []).slice().sort(), (it.teas || []).slice().sort(),
        (it.rooms || []).slice().sort(), it.span || 1, !!it.simul, it.realSubj || ''
      ]);
      const groups = new Map();
      for (const id of Object.keys(items)) {
        const it = items[id]; if (!it) continue;
        const s = sigOf(it);
        let g = groups.get(s); if (!g) { g = { rep: it, ids: [] }; groups.set(s, g); }
        g.ids.push(id);
      }
      const newItems = {}, newPlacements = {};
      rawRows.length = 0;
      let gi = 0;
      for (const g of groups.values()) {
        const rid = 'ide_' + (gi++);
        const rep = g.rep;
        const span = rep.span || 1;
        let k = 0;
        for (const oldId of g.ids) {
          k++;
          const nid = rid + '__' + k;
          newItems[nid] = Object.assign({}, items[oldId], { id: nid, srcId: rid, countIdx: k });
          if (placements[oldId]) newPlacements[nid] = placements[oldId];
        }
        const scfg = subjectCfg[rep.subj] || {};
        rawRows.push({
          _id: rid,
          cls: (rep.cls || []).join(','),
          subj: rep.subj,
          subjAbbr: scfg.abbr || rep.subj,
          dept: scfg.dept || '',
          tea: (rep.teas || []).join(','),
          teaAbbr: (rep.teas || []).map(n => teacherAbbrByName[n] || n).join(','),
          room: (rep.rooms || []).join(','),
          count: g.ids.length,
          span,
          dbl: span >= 2,
          parallel: false,
          simul: !!rep.simul,
          realSubj: rep.realSubj || '',
        });
      }
      for (const key of Object.keys(items)) delete items[key];
      Object.assign(items, newItems);
      for (const key of Object.keys(placements)) delete placements[key];
      Object.assign(placements, newPlacements);
    }

    // ── per-class 時限数（早帰り等）──
    // 完成時間割の実配置末尾から各クラス・各曜日の最終時限を求め、全体設定より短い場合のみ
    // classPeriodOverride に記録する。これにより授業の無い余分なコマがグレー表示になる
    // （例: 1・2年は月曜7限だが3年は月曜6限まで、の違いを反映）。
    const classPeriodOverride = {};
    {
      const lastFilled = {};
      for (const id in placements) {
        const pl = placements[id]; if (!pl || !pl.day) continue;
        const it = items[id]; if (!it) continue;
        const span = it.span || 1;
        for (const c of (it.cls || [])) {
          // 【A-3】通常クラスのみ対象（校務分掌G等は除外）。「3-1」に加え「1年1組」「1-A」等にも対応。
          // クラス名は学年数字で始まる。校務分掌グループ(学務G/生徒会G等)は漢字始まりなので除外される。
          if (!/^\d/.test(c) || /[GＧ]$/.test(c)) continue;
          const rec = lastFilled[c] || (lastFilled[c] = {});
          rec[pl.day] = Math.max(rec[pl.day] || 0, pl.period + span - 1);
        }
      }
      for (const c in lastFilled) {
        for (const d of DAY_KEYS) {
          const glob = periodsByDay[d] || 0, last = lastFilled[c][d] || 0;
          if (glob > 0 && last > 0 && last < glob) (classPeriodOverride[c] || (classPeriodOverride[c] = {}))[d] = last;
        }
      }
    }

    // 【A-4】読込結果の自己検証用の診断情報
    const KNOWN_SECTIONS = ['HEAD', 'CLASS', 'LESSON', 'TEACH', 'ROOM', 'JUGYO', 'J-CLASS', 'J-Teach', 'J-Room', 'SJYUGYO'];
    const jGeom = _geomCache['J-CLASS'] || null;
    const diag = {
      classNames: [...new Set(Object.values(items).flatMap(it => it.cls || []))].sort((a, b) => a.localeCompare(b, 'ja')),
      slotsPerClass: jGeom ? jGeom.gridDays * jGeom.gridP : null,
      jGeom,
      sectionsFound: Object.keys(sectionIdx),
      sectionsSkipped: Object.keys(sectionIdx).filter(s => !KNOWN_SECTIONS.includes(s)),
      warnings: parseWarnings.slice(),
      totalItems: Object.keys(items).length,
    };

    return { schoolName, numDays, periodsByDay, subjectCfg, teacherCfg, roomCfg, items, rawRows, placements, placedCount, classPeriodOverride, diag };
  }

  async function importProjectFile(file) {
    let buffer;
    try { buffer = await file.arrayBuffer(); } catch (e) { showModal('読込失敗', 'ファイルを読めませんでした: ' + e.message); return; }

    // イデアのAI時間割 ネイティブ形式の検出（Shift-JIS, "HEAD:", が先頭付近に出現）
    const head8 = new Uint8Array(buffer.slice(0, 100));
    const headAscii = String.fromCharCode(...head8).replace(/\0/g, '');
    const isIdeaNative = headAscii.includes('"HEAD:"');

    if (isIdeaNative) {
      let parsed;
      try { parsed = _parseIdeaNativeIde(buffer); } catch (e) {
        showModal('読込失敗', 'イデアファイルの解析に失敗しました: ' + e.message); return;
      }
      const clsCount = Object.values(parsed.items).length;
      const teaCount = Object.keys(parsed.teacherCfg).length;
      const subCount = Object.keys(parsed.subjectCfg).length;
      const hasTeacherAssign = Object.values(parsed.items).some(it => it.teas && it.teas.length > 0);
      const placedCount = parsed.placedCount || 0;
      // ── インポート品質レポート（未設定検出）──
      const _isNoRoomSubj = (s) => /総合的な探究|LHR|ロングホーム|ホームルーム/.test((s || '').replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)));
      let noRoomCnt = 0, noTeaCnt = 0;
      for (const it of Object.values(parsed.items)) {
        const hasRoom = it.rooms && it.rooms.length > 0;
        const hasTea = it.teas && it.teas.length > 0;
        if (!hasRoom && !_isNoRoomSubj(it.subj)) noRoomCnt++;
        if (!hasTea && !_isNoRoomSubj(it.subj)) noTeaCnt++;
      }
      const qualityNote =
        `  ── 品質チェック ──\n` +
        `  ${noRoomCnt === 0 ? '✓' : '⚠'} 教室未設定: ${noRoomCnt}コマ${noRoomCnt ? '（総合/LHRを除く）' : ''}\n` +
        `  ${noTeaCnt === 0 ? '✓' : '⚠'} 教員未設定: ${noTeaCnt}コマ${noTeaCnt ? '（総合/LHRを除く）' : ''}`;
      const teaNote = hasTeacherAssign
        ? `  ✓ J-Teachセクションから教員割当を読み込みました。`
        : `  ※ このファイルに教員割当データがないため、教員は未設定です。`;
      const placeNote = placedCount > 0
        ? `  ✓ J-CLASSセクションから時間割配置（${placedCount}コマ）を読み込みました。`
        : `  ※ このファイルに配置データがないため、配置は空になります。`;
      const lockOpt = placedCount > 0
        ? `<label class="chk" style="display:flex;gap:6px;align-items:center;margin-top:10px;padding:8px;background:rgba(59,130,246,.08);border-radius:6px;cursor:pointer">
             <input type="checkbox" id="ide-import-lock"> 読み込んだ配置を<strong>固定（ロック）</strong>して取り込む
             <span class="muted small">（AIや操作で動かない固定コマになります）</span>
           </label>`
        : '';
      let lockAll = false;
      // 【A-4】読込結果の自己検証: 統計と例示ミニ時間割
      const _diag = parsed.diag || {};
      const _classNames = _diag.classNames || [];
      const _slots = _diag.slotsPerClass;
      const _jg = _diag.jGeom;
      const _skipped = _diag.sectionsSkipped || [];
      const _warns = _diag.warnings || [];
      const _unplaced = Math.max(0, (_diag.totalItems || clsCount) - placedCount);
      const _sampleClass = _classNames.find(c => /^\d/.test(c)) || _classNames[0] || '';
      const buildMini = (cls) => {
        if (!cls) return '';
        const days = Object.keys(parsed.periodsByDay).filter(d => parsed.periodsByDay[d] > 0);
        const maxP = Math.max(1, ...days.map(d => parsed.periodsByDay[d]));
        const cellMap = {};
        for (const [id, it] of Object.entries(parsed.items)) {
          if (!(it.cls || []).includes(cls)) continue;
          const pl = parsed.placements[id]; if (!pl || !pl.day) continue;
          const ab = (parsed.subjectCfg[it.subj] && parsed.subjectCfg[it.subj].abbr) || it.subj;
          for (let dp = 0; dp < (it.span || 1); dp++) cellMap[pl.day + '#' + (pl.period + dp)] = dp === 0 ? ab : '〃';
        }
        const th = 'border:1px solid #cbd5e1;padding:2px 6px;background:#f1f5f9';
        const td = 'border:1px solid #cbd5e1;padding:2px 6px;text-align:center;min-width:38px';
        let h = '<table style="border-collapse:collapse;font-size:11px;margin-top:4px"><tr><th style="' + th + '"></th>';
        for (const d of days) h += '<th style="' + th + '">' + (DAYJP[d] || d) + '</th>';
        h += '</tr>';
        for (let p = 1; p <= maxP; p++) {
          h += '<tr><th style="' + th + '">' + p + '</th>';
          for (const d of days) h += '<td style="' + td + '">' + escapeHtml(cellMap[d + '#' + p] || '') + '</td>';
          h += '</tr>';
        }
        return h + '</table>';
      };
      // 授業の実寸法（曜日数・最大時限）。マス数は読取格子(パディング込み)なので別途明記する。
      const _numDays = parsed.numDays || Object.values(parsed.periodsByDay || {}).filter(v => v > 0).length;
      const _maxPer = Math.max(0, ...Object.values(parsed.periodsByDay || {}).map(v => v || 0));
      const statsHtml =
        `<div style="margin-top:10px;padding:8px 10px;background:rgba(15,23,42,.04);border-radius:6px;line-height:1.7;font-size:13px">` +
        `<div style="font-weight:700;margin-bottom:2px">読込内容の確認</div>` +
        `<div>クラス数: ${_classNames.length}　授業曜日: ${_numDays}日　最大時限: ${_maxPer}限</div>` +
        `<div>1クラスの読取マス数: ${_slots || '不明'}${_jg ? `（内部格子 ${_jg.gridDays}×${_jg.gridP}＝余白1列/1行込み）` : ''}</div>` +
        `<div>配置できたコマ: <strong>${placedCount}</strong>　配置できなかったコマ: <strong>${_unplaced}</strong></div>` +
        (_skipped.length ? `<div>読み飛ばしたセクション: ${escapeHtml(_skipped.join(', '))}</div>` : `<div>読み飛ばしたセクション: なし</div>`) +
        (_warns.length ? `<div style="color:#b45309;margin-top:4px">⚠ ${_warns.map(escapeHtml).join('<br>⚠ ')}</div>` : '') +
        `</div>` +
        (_sampleClass ? `<div style="margin-top:8px;font-size:13px"><div class="muted small">例: クラス <strong>${escapeHtml(_sampleClass)}</strong> の時間割（イデアの画面と見比べてください）</div>${buildMini(_sampleClass)}</div>` : '');
      showModalHTML(
        'イデアファイル読込',
        `<div style="white-space:pre-wrap;line-height:1.6">` +
        escapeHtml(`イデアのAI時間割ファイル「${file.name}」を読み込みます。\n\n` +
          `  教員: ${teaCount}名　教科: ${subCount}科目　授業コマ: ${clsCount}コマ\n` +
          `${teaNote}\n${placeNote}\n\n${qualityNote}\n\n現在の作業内容はすべて上書きされます。`) +
        `</div>` + statsHtml + lockOpt,
        () => {
          pushHistory('ideaImport');
          state.rawRows = parsed.rawRows;
          state.subjectCfg = parsed.subjectCfg;
          state.teacherCfg = parsed.teacherCfg;
          state.items = normalizeItems(parsed.items);
          state.placements = parsed.placements || {};
          try { markRawBaseline(); } catch (e) { }
          // 固定として取込: 全配置をロック
          if (lockAll) { for (const id in state.placements) { const p = state.placements[id]; if (p && p.day) p.locked = true; } }
          state.snapshots = [];
          // 【A-3】学校名を反映
          if (parsed.schoolName) state.settings.schoolName = parsed.schoolName;
          // 【A-3】土曜(6日制)等に対応: 読込ファイルの曜日数だけ表示曜日を伸縮
          if (parsed.numDays) setActiveDayCount(parsed.numDays);
          // 【A-3】曜日ごとの時限数。ファイルに無い曜日は0(非表示)にする（Object.assignの上書き残りを防ぐ）
          if (parsed.periodsByDay) {
            for (const d in state.settings.periodsByDay) state.settings.periodsByDay[d] = 0;
            Object.assign(state.settings.periodsByDay, parsed.periodsByDay);
          }
          // 教室マスタ（classmatch に roomCfg があれば格納）
          if (parsed.roomCfg) state.roomCfg = parsed.roomCfg;
          // per-class 時限数（早帰り等で授業の無い余分なコマをグレー表示）
          state.settings.classPeriodOverride = parsed.classPeriodOverride || {};
          sanitizeState('イデア読込');
          invalidateIndex();
          markDirty('ideaImport');
          rerenderAll();
          saveNow();
          const placeMsg = placedCount > 0 ? `、配置: ${placedCount}コマ${lockAll ? '（固定）' : ''}` : '';
          flash(`📂 イデアファイルを読み込みました（授業: ${clsCount}コマ, 教員: ${teaCount}名${placeMsg}）`);
        },
        '読み込む', 'キャンセル',
        () => { const el = document.getElementById('ide-import-lock'); if (el) el.addEventListener('change', () => { lockAll = el.checked; }); }
      );
      return;
    }

    // JSON 形式（classmatch 独自形式）
    let text;
    try { text = new TextDecoder('utf-8').decode(buffer); } catch (e) { showModal('読込失敗', 'ファイルを読めませんでした: ' + e.message); return; }

    let data;
    try { data = JSON.parse(text); } catch (e) { showModal('読込失敗', 'JSONの解析に失敗しました: ' + e.message); return; }

    // フォーマット確認
    if (data.format !== PROJECT_FORMAT && data.format !== 'classmatch-project') {
      // 旧形式（.classmatch / スナップショットのみJSONなど）も許容
      if (!Array.isArray(data) && !data.rawRows) {
        showModal('形式エラー', 'このファイルはサポートされていない形式です。classmatch (.ide JSON) またはイデアのAI時間割 (.ide) ファイルを選択してください。');
        return;
      }
    }

    const savedAt = data.savedAt ? new Date(data.savedAt).toLocaleString('ja-JP') : '不明';
    const name = data.projectName || file.name;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const kindLabel = ext === 'ide'
      ? 'classmatchプロジェクト（.ide / JSON形式）'
      : ext === 'classmatch' ? 'classmatchプロジェクト（.classmatch）'
      : 'classmatchプロジェクト（JSON形式）';
    const pItems = (data.items && typeof data.items === 'object') ? Object.keys(data.items).length : 0;
    const pPlaced = (data.placements && typeof data.placements === 'object') ? Object.keys(data.placements).length : 0;

    const lockOpt = pPlaced > 0
      ? `<label class="chk" style="display:flex;gap:6px;align-items:center;margin-top:10px;padding:8px;background:rgba(59,130,246,.08);border-radius:6px;cursor:pointer">
           <input type="checkbox" id="proj-import-lock"> 読み込んだ配置を<strong>固定（ロック）</strong>して取り込む
           <span class="muted small">（AIや操作で動かない固定コマになります）</span>
         </label>`
      : '';
    let lockAll = false;
    showModalHTML(
      'プロジェクト読込',
      `<div style="white-space:pre-wrap;line-height:1.6">` +
      escapeHtml(`📁 種別: ${kindLabel}\nファイル名: ${file.name}\n\n` +
        `「${name}」（保存日時: ${savedAt}）を読み込みますか？\n` +
        `  授業コマ: ${pItems}　配置済み: ${pPlaced}\n\n現在の作業内容はすべて上書きされます。`) +
      `</div>` + lockOpt,
      () => {
        applyProjectData(data, { lockAll, reason: 'projectImport' });
        flash(`📂 「${name}」を読み込みました${lockAll ? '（配置を固定）' : ''}`);
      },
      '読み込む', 'キャンセル',
      () => { const el = document.getElementById('proj-import-lock'); if (el) el.addEventListener('change', () => { lockAll = el.checked; }); }
    );
  }

  // プロジェクトデータ（ファイル・クラウド共通）を今の作業に反映する。元に戻す(Ctrl+Z)で直前に戻せる
  function applyProjectData(data, opts = {}) {
    pushHistory(opts.reason || 'projectImport');
    if (Array.isArray(data.rawRows)) state.rawRows = data.rawRows;
    if (data.subjectCfg && typeof data.subjectCfg === 'object') state.subjectCfg = data.subjectCfg;
    if (data.teacherCfg && typeof data.teacherCfg === 'object') state.teacherCfg = data.teacherCfg;
    if (data.settings && typeof data.settings === 'object') {
      // 既存settingsに上書き（不完全なキーで壊れないよう）
      Object.assign(state.settings, data.settings);
    }
    if (data.placements && typeof data.placements === 'object') state.placements = data.placements;
    if (data.items && typeof data.items === 'object') state.items = normalizeItems(data.items);
    if (opts.lockAll) { for (const id in state.placements) { const p = state.placements[id]; if (p && p.day) p.locked = true; } }
    if (Array.isArray(data.snapshots)) state.snapshots = data.snapshots;
    sanitizeState(opts.reason === 'cloudOpen' ? 'クラウドから開く' : 'プロジェクト読込');
    invalidateIndex();
    markDirty(opts.reason || 'projectImport');
    try { markRawBaseline(); } catch (e) { } // 読み込んだ内容を基準にする（読込そのものを「変更」と取り違えない）
    rerenderAll();
    saveNow();
  }

  // 今の作業をプロジェクトデータ（ファイル保存・クラウド保存で共通の形）にする
  function buildProjectPayload(projectName) {
    sanitizeState('書き出し前');
    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      savedAt: new Date().toISOString(),
      projectName: projectName || '時間割',
      appVersion: document.querySelector('.ver')?.textContent || 'v61',
      rawRows: state.rawRows,
      subjectCfg: state.subjectCfg,
      teacherCfg: state.teacherCfg,
      settings: state.settings,
      placements: state.placements,
      items: state.items,
      snapshots: state.snapshots,
    };
  }

  // 外部データ（プロジェクト/スナップショット/localStorage）から復元したitemsに
  // teas/cls/rooms 配列が欠けていると print/export 等で .join が落ちるため正規化する
  function normalizeItems(items) {
    if (!items || typeof items !== 'object') return {};
    for (const id in items) {
      const it = items[id];
      if (!it || typeof it !== 'object') continue;
      if (!Array.isArray(it.teas)) it.teas = it.teas != null ? [].concat(it.teas) : [];
      if (!Array.isArray(it.cls)) it.cls = it.cls != null ? [].concat(it.cls) : [];
      if (!Array.isArray(it.rooms)) it.rooms = it.rooms != null ? [].concat(it.rooms) : [];
    }
    return items;
  }

