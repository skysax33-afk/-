/**
 * トランジット通知Bot — mail.gs（Step 4: メール送信）
 *
 * evaluateDay（interpret.gs）の評価を、HTMLメール（テキスト版も同梱）で自分のアドレスへ送る。
 *   件名: 「11/21（土）の星回り  仕事4 恋愛3 心5 体調3 お金5」
 *   本文: HTML 版は mailHtml_、テキスト版は renderMessage（HTMLを表示しないアプリ用）
 * 宛先はスクリプトを動かすアカウントのアドレス。アドレスはコードに書かない。
 * ※ 他ファイルの定数・関数はトップレベルでは参照せず、関数の中でだけ使う。
 */

const MAIL_SENDER_NAME = '星回り通知';

// 件名の★要約で使う短い名前（ここにないテーマはそのままの名前）
const SUBJECT_THEME_LABEL = { '恋愛/人間関係': '恋愛' };

const MAIL_COLORS = {
  harmony: '#1c64b5', // 調和・追い風
  tension: '#c0392b', // 緊張・注意点
  neutral: '#6b6b6b', // 中立の合
  star: '#e0a100',
  starOff: '#cccccc',
  text: '#222222',
  sub: '#777777',
};

/** Date かどうか（トリガーから呼ばれるとイベントオブジェクトが渡るため） */
function isDate_(x) {
  return Object.prototype.toString.call(x) === '[object Date]' && !isNaN(x.getTime());
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 件名: 「11/21（土）の星回り  仕事4 恋愛3 心5 体調3 お金5」 */
function mailSubject_(ev) {
  const d = jst_(ev.date);
  const stars = ev.stars.map((s) => `${SUBJECT_THEME_LABEL[s.theme] || s.theme}${s.stars}`).join(' ');
  return `${d.m}/${d.d}（${d.w}）の星回り  ${stars}`;
}

/**
 * HTML 版の見出し行（「火星 → 出生の月　調和的な120°（トライン）・接近中」）の3つのまとまり
 * スマホ幅でまとまりの途中で折り返さないよう、分けて返す
 */
function itemTitleParts_(hit) {
  const motion = hit.orb < EXACT_ORB ? 'ほぼ正確' : hit.applying ? '接近中' : '分離中';
  const adj = hit.angle === 0 ? '' : hit.category === 'harmony' ? '調和的な' : '緊張をはらむ';
  return [
    `${hit.transit}${hit.retro ? '（逆行中）' : ''} → 出生の${hit.natal}`,
    `${adj}${hit.angle}°（${hit.aspect}）`,
    motion,
  ];
}

/** アスペクト1件の HTML（左の線と見出しの色は 調和=青・緊張=赤・中立=灰） */
function itemHtml_(hit, ref) {
  const c = MAIL_COLORS;
  const color = c[hit.category];
  const sub = [`${TRANSIT_TEXT[hit.transit].kw} × ${NATAL_TEXT[hit.natal].kw}`];
  if (hit.period) sub.push(periodText_(hit.period, ref).slice(1, -1)); // 外側の（）を外す
  const [who, aspect, motion] = itemTitleParts_(hit).map((s) => `<span style="white-space:nowrap;">${escapeHtml_(s)}</span>`);
  return `<div style="border-left:4px solid ${color};padding:2px 0 2px 10px;margin:8px 0;">` +
    `<div style="font-weight:bold;color:${color};">${who}　${aspect}・${motion}</div>` +
    `<div style="font-size:13px;color:${c.sub};">${sub.map(escapeHtml_).join('<br>')}</div>` +
    `<div>${escapeHtml_(itemText_(hit)[1])}</div>` +
    '</div>';
}

/** HTML 版の本文（メールアプリで崩れにくいよう、スタイルはすべてインライン） */
function mailHtml_(ev) {
  const c = MAIL_COLORS;
  const d = jst_(ev.date);
  const h3 = (title, color) =>
    `<h3 style="font-size:16px;margin:20px 0 6px;color:${color || c.text};">${escapeHtml_(title)}</h3>`;
  const out = [
    `<div style="font-family:-apple-system,'Hiragino Sans','Noto Sans JP','Yu Gothic',Meiryo,sans-serif;` +
      `font-size:15px;line-height:1.7;color:${c.text};max-width:600px;">`,
    `<h2 style="font-size:19px;margin:0 0 4px;">${escapeHtml_(`${d.m}/${d.d}（${d.w}）の星回り`)}</h2>`,
    h3('テーマ別'),
    '<table style="border-collapse:collapse;">',
  ];
  ev.stars.forEach((s) => {
    out.push(`<tr><td style="padding:1px 14px 1px 0;">${escapeHtml_(s.theme)}</td>` +
      `<td style="font-size:17px;letter-spacing:1px;"><span style="color:${c.star};">${'★'.repeat(s.stars)}</span>` +
      `<span style="color:${c.starOff};">${'☆'.repeat(5 - s.stars)}</span></td></tr>`);
  });
  out.push('</table>');
  const section = (title, items, color) => {
    out.push(h3(title, color));
    if (!items.length) {
      out.push(`<div style="color:${c.sub};">目立つ配置はありません</div>`);
      return;
    }
    items.forEach((h) => out.push(itemHtml_(h, ev.date)));
  };
  section('今日の流れ', ev.today);
  section('追い風', ev.good, c.harmony);
  section('注意点', ev.caution, c.tension);
  section('この時期のテーマ', ev.period);
  out.push(`<p style="font-size:12px;color:${c.sub};margin-top:24px;">トランジット通知Bot（自動送信）</p>`, '</div>');
  return out.join('\n');
}

/**
 * その日の通知メールを自分のアドレスへ送る
 * @param {Date=} date 省略時（またはトリガーのイベントオブジェクトが渡ったとき）は現在時刻
 * @return {Object} { to, subject }
 */
function sendDailyMail(date) {
  const when = isDate_(date) ? date : new Date();
  const ev = evaluateDay(when);
  const to = Session.getEffectiveUser().getEmail();
  if (!to) throw new Error('送信先のメールアドレスを取得できませんでした（スクリプトの承認を確認してください）');
  const subject = mailSubject_(ev);
  MailApp.sendEmail(to, subject, renderMessage(ev), { htmlBody: mailHtml_(ev), name: MAIL_SENDER_NAME });
  return { to: to, subject: subject };
}

// ===== 動作確認用（実際に自分宛てに1通送る） =====
function testStep4() {
  const r = sendDailyMail(new Date());
  Logger.log(`自分のアドレス宛てに送信しました: ${r.subject}（今日あと ${MailApp.getRemainingDailyQuota()} 通送れます）`);
}
